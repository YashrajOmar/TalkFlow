/**
 * Codeforces Submission Scraper.
 *
 * Uses the official Codeforces API (no auth required):
 *   GET https://codeforces.com/api/user.status?handle={username}&from=1&count=100
 *
 * The API returns submissions in reverse chronological order.
 * We paginate through all submissions using `from` parameter.
 *
 * Codeforces rate limit: ~1 request per 2 seconds for unauthenticated calls.
 *
 * Note: Codeforces API returns the source code in the submission object
 * only for contest submissions. For practice, the `programmingLanguage`
 * and verdict are available but `source` may not be. We handle both cases.
 */

import type {
  ISubmissionScraper,
  ScrapedSubmission,
  SubmissionScrapeResult,
} from '../types.js';

// ── Codeforces API response types ─────────────────────────────────────────────

interface CFApiResponse {
  status: 'OK' | 'FAILED';
  comment?: string;
  result?: CFSubmission[];
}

interface CFSubmission {
  id: number;
  contestId?: number;
  creationTimeSeconds: number;
  problem: {
    contestId?: number;
    index: string;
    name: string;
    rating?: number;
    tags: string[];
  };
  programmingLanguage: string;
  verdict?:
    | 'OK'
    | 'WRONG_ANSWER'
    | 'TIME_LIMIT_EXCEEDED'
    | 'MEMORY_LIMIT_EXCEEDED'
    | 'RUNTIME_ERROR'
    | 'COMPILATION_ERROR'
    | 'CHALLENGED'
    | 'SKIPPED'
    | 'PARTIAL'
    | 'TESTING';
  timeConsumedMillis: number;
  memoryConsumedBytes: number;
}

// ── Verdict mapping ───────────────────────────────────────────────────────────

function mapCFVerdict(
  v: CFSubmission['verdict']
): ScrapedSubmission['verdict'] {
  switch (v) {
    case 'OK':
      return 'AC';
    case 'WRONG_ANSWER':
      return 'WA';
    case 'TIME_LIMIT_EXCEEDED':
      return 'TLE';
    case 'MEMORY_LIMIT_EXCEEDED':
      return 'MLE';
    case 'RUNTIME_ERROR':
      return 'RE';
    case 'COMPILATION_ERROR':
      return 'CE';
    default:
      return 'UNKNOWN';
  }
}

// ── Language normalization ────────────────────────────────────────────────────

function normalizeCFLanguage(lang: string): string {
  const lower = lang.toLowerCase();
  if (lower.includes('c++20') || lower.includes('gnu c++20')) return 'cpp20';
  if (lower.includes('c++17') || lower.includes('gnu c++17')) return 'cpp17';
  if (lower.includes('c++14') || lower.includes('gnu c++14')) return 'cpp14';
  if (lower.includes('c++')) return 'cpp';
  if (lower.includes('python 3') || lower.includes('pypy 3')) return 'python3';
  if (lower.includes('python 2') || lower.includes('pypy 2')) return 'python2';
  if (lower.includes('java')) return 'java';
  if (lower.includes('javascript')) return 'javascript';
  if (lower.includes('kotlin')) return 'kotlin';
  if (lower.includes('rust')) return 'rust';
  if (lower.includes('go ')) return 'go';
  return lower.replace(/\s+/g, '_');
}

// ── Problem URL builder ───────────────────────────────────────────────────────

function buildCFProblemUrl(contestId: number | undefined, index: string): string {
  if (contestId) {
    return `https://codeforces.com/problemset/problem/${contestId}/${index}`;
  }
  return `https://codeforces.com/problemset/problem/0/${index}`;
}

function buildCFProblemSlug(contestId: number | undefined, index: string): string {
  return contestId ? `${contestId}${index}` : index;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CF_API_BASE = 'https://codeforces.com/api';
const PAGE_SIZE = 100;
/** Codeforces rate limit: ~1 request per 2 seconds. */
const RATE_LIMIT_MS = 2100;
/** Max pages to fetch per sync to avoid hammering the API. */
const MAX_PAGES = 50;

// ── Sleep utility ─────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Scraper ───────────────────────────────────────────────────────────────────

export class CodeforcesSubmissionScraper implements ISubmissionScraper {
  readonly platform = 'codeforces';

  async scrapeSubmissions(
    username: string,
    afterTimestamp?: Date
  ): Promise<SubmissionScrapeResult> {
    const submissions: ScrapedSubmission[] = [];
    const afterEpoch = afterTimestamp ? afterTimestamp.getTime() / 1000 : 0;

    let from = 1;
    let hitEnd = false;
    let pagesRead = 0;

    try {
      while (!hitEnd && pagesRead < MAX_PAGES) {
        const url = `${CF_API_BASE}/user.status?handle=${encodeURIComponent(username)}&from=${from}&count=${PAGE_SIZE}`;

        const response = await fetch(url);
        if (!response.ok) {
          if (response.status === 429) {
            // Rate limited — wait and retry once.
            await sleep(RATE_LIMIT_MS * 2);
            continue;
          }
          return {
            platform: this.platform,
            username,
            submissions,
            totalAvailable: null,
            error: `HTTP ${response.status}: ${response.statusText}`,
          };
        }

        const data = (await response.json()) as CFApiResponse;
        if (data.status !== 'OK' || !data.result) {
          return {
            platform: this.platform,
            username,
            submissions,
            totalAvailable: null,
            error: data.comment ?? 'Unknown API error',
          };
        }

        if (data.result.length === 0) {
          hitEnd = true;
          break;
        }

        for (const sub of data.result) {
          // Skip submissions before the cursor for incremental sync.
          if (sub.creationTimeSeconds <= afterEpoch) {
            hitEnd = true;
            break;
          }

          submissions.push({
            platformSubmissionId: String(sub.id),
            problemSlug: buildCFProblemSlug(sub.problem.contestId, sub.problem.index),
            problemTitle: sub.problem.name,
            problemUrl: buildCFProblemUrl(sub.problem.contestId, sub.problem.index),
            language: normalizeCFLanguage(sub.programmingLanguage),
            // CF API does not return source code via user.status endpoint.
            // Code will be fetched separately if needed, or left empty.
            code: '',
            verdict: mapCFVerdict(sub.verdict),
            runtimeMs: sub.timeConsumedMillis,
            memoryKb: Math.round(sub.memoryConsumedBytes / 1024),
            problemDifficulty: sub.problem.rating ? String(sub.problem.rating) : null,
            submittedAt: new Date(sub.creationTimeSeconds * 1000),
          });
        }

        from += PAGE_SIZE;
        pagesRead++;

        // Respect rate limit between pages.
        if (!hitEnd && pagesRead < MAX_PAGES) {
          await sleep(RATE_LIMIT_MS);
        }
      }

      return {
        platform: this.platform,
        username,
        submissions,
        totalAvailable: null, // CF API doesn't tell us total count upfront.
        error: null,
      };
    } catch (err) {
      return {
        platform: this.platform,
        username,
        submissions,
        totalAvailable: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
