/**
 * Scraper Registry v2 — Patch 3.
 *
 * Improvements over v1:
 *   1. DB cache check before issuing HTTP: if the problem was scraped within
 *      the TTL window, return the cached result immediately.
 *   2. Typed failure states for Cloudflare/rate-limit blocks:
 *        { success: false, reason: 'BLOCKED', requiresManualPaste: true }
 *      so the UI can prompt the user to paste the problem text manually.
 *   3. Retry budget: 1 automatic retry on transient 5xx errors.
 */

import type {
  ISubmissionScraper,
  IProblemScraper,
  SubmissionScrapeResult,
} from './types.js';

import { CodeforcesSubmissionScraper } from './platforms/codeforces-submissions.js';
import { LeetCodeSubmissionScraper } from './platforms/leetcode-submissions.js';
import { LeetCodeProblemScraper } from './platforms/leetcode-problems.js';
import { CodeforcesProblemScraper } from './platforms/codeforces-problems.js';
import type { ScrapedProblem } from './types.js';
import { tagProblemTopics } from './classifier.js';
import type { ClassificationResult, LlmCall } from './classifier.js';

// ── Typed result ──────────────────────────────────────────────────────────────

export type ProblemScrapeSuccess = {
  success: true;
  problem: ScrapedProblem;
  fromCache: boolean;
};

/**
 * Extended success result that includes an auto-classification of the problem
 * into concept topic slugs with confidence weights.
 * Returned by `scrapeProblemAndClassify()`.
 */
export type ProblemScrapeClassifiedResult =
  | (ProblemScrapeSuccess & { classification: ClassificationResult })
  | ProblemScrapeBlocked
  | ProblemScrapeNotFound
  | ProblemScrapeError;

export type ProblemScrapeBlocked = {
  success: false;
  reason: 'BLOCKED';
  /** If true, the UI should prompt the user to manually paste the problem text. */
  requiresManualPaste: true;
  statusCode: number;
  url: string;
};

export type ProblemScrapeNotFound = {
  success: false;
  reason: 'NOT_FOUND';
  requiresManualPaste: false;
  url: string;
};

export type ProblemScrapeError = {
  success: false;
  reason: 'SCRAPE_ERROR' | 'NO_SCRAPER';
  requiresManualPaste: false;
  error: string;
  url: string;
};

export type ProblemScrapeResult =
  | ProblemScrapeSuccess
  | ProblemScrapeBlocked
  | ProblemScrapeNotFound
  | ProblemScrapeError;

// ── Cache port ────────────────────────────────────────────────────────────────

/**
 * Interface the caller must implement with a real DB lookup.
 * Returning null means "not in cache."
 */
export interface ProblemCachePort {
  /** Return the cached problem if it was scraped within TTL, else null. */
  findByUrl(url: string, maxAgeMs?: number): Promise<ScrapedProblem | null>;
}

/** Default TTL: 7 days. Re-scrape stale problems. */
const DEFAULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ── Registry ──────────────────────────────────────────────────────────────────

export class ScraperRegistry {
  private readonly submissionScrapers: Map<string, ISubmissionScraper>;
  private readonly problemScrapers: IProblemScraper[];
  private readonly cache: ProblemCachePort | null;

  constructor(opts: { cache?: ProblemCachePort } = {}) {
    this.cache = opts.cache ?? null;

    this.submissionScrapers = new Map<string, ISubmissionScraper>([
      ['codeforces', new CodeforcesSubmissionScraper()],
      ['leetcode', new LeetCodeSubmissionScraper()],
    ]);

    this.problemScrapers = [
      new LeetCodeProblemScraper(),
      new CodeforcesProblemScraper(),
    ];
  }

  // ── Submission scraping (unchanged interface) ───────────────────────────────

  async scrapeSubmissions(
    platform: string,
    username: string,
    afterTimestamp?: Date
  ): Promise<SubmissionScrapeResult> {
    const scraper = this.submissionScrapers.get(platform.toLowerCase());
    if (!scraper) {
      return {
        platform,
        username,
        submissions: [],
        totalAvailable: null,
        error: `Unsupported platform: "${platform}". Supported: ${[...this.submissionScrapers.keys()].join(', ')}`,
      };
    }
    return scraper.scrapeSubmissions(username, afterTimestamp);
  }

  // ── Problem scraping with cache + typed failure states ─────────────────────

  async scrapeProblem(
    url: string,
    opts: { cacheTtlMs?: number } = {}
  ): Promise<ProblemScrapeResult> {
    const ttl = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;

    // ── 1. Check DB cache first ───────────────────────────────────────────────
    if (this.cache) {
      try {
        const cached = await this.cache.findByUrl(url, ttl);
        if (cached) {
          return { success: true, problem: cached, fromCache: true };
        }
      } catch {
        // Cache failure is non-fatal — fall through to live scrape.
      }
    }

    // ── 2. Find the right scraper ─────────────────────────────────────────────
    const scraper = this.problemScrapers.find((s) => s.canHandle(url));
    if (!scraper) {
      return {
        success: false,
        reason: 'NO_SCRAPER',
        requiresManualPaste: false,
        error: `No scraper found for URL: "${url}". Supported: LeetCode, Codeforces`,
        url,
      };
    }

    // ── 3. Scrape with 1 retry on transient errors ────────────────────────────
    for (let attempt = 1; attempt <= 2; attempt++) {
      const result = await scraper.scrapeProblem(url);

      if (result.problem) {
        return { success: true, problem: result.problem, fromCache: false };
      }

      // Classify the error.
      const err = result.error ?? '';

      // Cloudflare / rate-limit block — do NOT retry, surface to UI.
      if (/403|429|cloudflare|rate.?limit|blocked|captcha/i.test(err)) {
        const codeMatch = err.match(/\b(403|429)\b/);
        return {
          success: false,
          reason: 'BLOCKED',
          requiresManualPaste: true,
          statusCode: codeMatch ? parseInt(codeMatch[1], 10) : 403,
          url,
        };
      }

      // 404 / not found — don't retry.
      if (/404|not found|no problem|unknown/i.test(err)) {
        return {
          success: false,
          reason: 'NOT_FOUND',
          requiresManualPaste: false,
          url,
        };
      }

      // Transient 5xx — retry once after a short delay.
      if (attempt === 1 && /5\d\d|timeout|network|econnreset/i.test(err)) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }

      // Any other error — surface it.
      return {
        success: false,
        reason: 'SCRAPE_ERROR',
        requiresManualPaste: false,
        error: err || 'Unknown scraping error',
        url,
      };
    }

    // Should never reach here, but TypeScript needs a return.
    return {
      success: false,
      reason: 'SCRAPE_ERROR',
      requiresManualPaste: false,
      error: 'Max retries exceeded',
      url,
    };
  }

  // ── Problem scraping + auto-classification ────────────────────────────────

  /**
   * Scrape a problem **and** automatically classify it into concept topic slugs.
   *
   * This is the recommended entry point for the full problem ingestion pipeline.
   * It chains `scrapeProblem()` (cache-first, typed failure states) with
   * `tagProblemTopics()` from the classifier so every newly stored problem
   * automatically has its `problem_topics` populated.
   *
   * @param url      - The problem URL to scrape.
   * @param llmCall  - Optional LLM call for richer topic classification.
   *                   If omitted, falls back to fast keyword matching.
   * @param opts     - Cache TTL override (default 7 days).
   *
   * @example
   * const result = await registry.scrapeProblemAndClassify(
   *   'https://leetcode.com/problems/two-sum/',
   *   async (prompt) => await gemini.generateText(prompt)
   * );
   * if (result.success) {
   *   await db.insert(scrapedProblems).values(result.problem);
   *   await db.insert(problemTopics).values(
   *     result.classification.tags.map((t) => ({ topicSlug: t.topicSlug, weight: t.weight }))
   *   );
   * }
   */
  async scrapeProblemAndClassify(
    url: string,
    llmCall?: LlmCall,
    opts: { cacheTtlMs?: number } = {}
  ): Promise<ProblemScrapeClassifiedResult> {
    const scrapeResult = await this.scrapeProblem(url, opts);

    // If the scrape failed for any reason, propagate the typed failure as-is.
    // Classification is only meaningful when we have a problem statement.
    if (!scrapeResult.success) {
      return scrapeResult;
    }

    // Run the classifier against the freshly scraped (or cached) problem.
    const classification = await tagProblemTopics(
      {
        title: scrapeResult.problem.title,
        statement: scrapeResult.problem.statement,
        tags: scrapeResult.problem.tags,
      },
      llmCall
    );

    return {
      ...scrapeResult,
      classification,
    };
  }

  /** List all supported platforms for submission scraping. */
  get supportedPlatforms(): string[] {
    return [...this.submissionScrapers.keys()];
  }
}
