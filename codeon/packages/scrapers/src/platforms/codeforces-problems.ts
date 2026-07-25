/**
 * Codeforces Problem Scraper.
 *
 * When a user pastes a Codeforces problem URL, this scraper:
 *   1. Extracts the contest ID and problem index from the URL.
 *   2. Uses the Codeforces API to fetch problem metadata.
 *   3. Scrapes the problem page HTML for the full statement
 *      (the API only returns tags and rating, not the statement text).
 *
 * Note: Codeforces does not provide editorials via API. The editorial
 * is typically in a separate blog post. We attempt to find it but
 * editorial_code may be null for many CF problems.
 */

import type { IProblemScraper, ProblemScrapeResult, ScrapedProblem } from '../types.js';

// ── URL parsing ───────────────────────────────────────────────────────────────

interface CFProblemId {
  contestId: string;
  index: string;
}

/**
 * Extract contestId and problem index from CF URLs.
 * Supports:
 *   https://codeforces.com/problemset/problem/1/A
 *   https://codeforces.com/contest/1/problem/A
 *   https://codeforces.com/gym/100001/problem/A
 */
function extractCFProblemId(url: string): CFProblemId | null {
  const patterns = [
    /codeforces\.com\/problemset\/problem\/(\d+)\/([A-Za-z]\d?)/i,
    /codeforces\.com\/contest\/(\d+)\/problem\/([A-Za-z]\d?)/i,
    /codeforces\.com\/gym\/(\d+)\/problem\/([A-Za-z]\d?)/i,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return { contestId: match[1], index: match[2].toUpperCase() };
    }
  }
  return null;
}

// ── CF API types ──────────────────────────────────────────────────────────────

interface CFProblemInfo {
  contestId: number;
  index: string;
  name: string;
  rating?: number;
  tags: string[];
  timeLimit?: string;
  memoryLimit?: string;
}

interface CFApiProblemsResponse {
  status: 'OK' | 'FAILED';
  result?: {
    problems: CFProblemInfo[];
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Strip HTML tags from Codeforces problem statement HTML.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<\/?[^>]+(>|$)/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Fetch the full problem statement by scraping the contest problem page.
 * The CF API doesn't provide the statement text — only tags and rating.
 */
async function fetchCFProblemStatement(
  contestId: string,
  index: string
): Promise<{ statement: string; inputFormat: string | null; outputFormat: string | null; timeLimitMs: number | null; memoryLimitKb: number | null }> {
  const pageUrl = `https://codeforces.com/problemset/problem/${contestId}/${index}`;
  const response = await fetch(pageUrl, {
    headers: { 'User-Agent': 'codeOn/1.0 (AI Coding Coach)' },
  });

  if (!response.ok) {
    return { statement: '', inputFormat: null, outputFormat: null, timeLimitMs: null, memoryLimitKb: null };
  }

  const html = await response.text();

  // Extract problem statement div.
  const statementMatch = html.match(/<div class="problem-statement">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/);
  const statement = statementMatch ? stripHtml(statementMatch[1]) : '';

  // Extract time limit.
  const tlMatch = html.match(/time limit per test<\/div>\s*<div[^>]*>([\d.]+)\s*second/i);
  const timeLimitMs = tlMatch ? Math.round(parseFloat(tlMatch[1]) * 1000) : null;

  // Extract memory limit.
  const mlMatch = html.match(/memory limit per test<\/div>\s*<div[^>]*>(\d+)\s*megabytes/i);
  const memoryLimitKb = mlMatch ? parseInt(mlMatch[1], 10) * 1024 : null;

  // Extract input/output format.
  const inputMatch = html.match(/<div class="section-title">Input<\/div>([\s\S]*?)(?=<div class="section-title">)/i);
  const outputMatch = html.match(/<div class="section-title">Output<\/div>([\s\S]*?)(?=<div class="section-title">|<\/div>\s*<\/div>)/i);

  return {
    statement,
    inputFormat: inputMatch ? stripHtml(inputMatch[1]) : null,
    outputFormat: outputMatch ? stripHtml(outputMatch[1]) : null,
    timeLimitMs,
    memoryLimitKb,
  };
}

// ── Difficulty mapping ────────────────────────────────────────────────────────

function cfRatingToDifficulty(rating?: number): string | null {
  if (!rating) return null;
  if (rating < 1000) return 'easy';
  if (rating < 1400) return 'easy-medium';
  if (rating < 1800) return 'medium';
  if (rating < 2200) return 'hard';
  return 'expert';
}

// ── Scraper ───────────────────────────────────────────────────────────────────

export class CodeforcesProblemScraper implements IProblemScraper {
  readonly platform = 'codeforces';

  canHandle(url: string): boolean {
    return /codeforces\.com\/(problemset\/problem|contest\/\d+\/problem|gym\/\d+\/problem)/i.test(url);
  }

  async scrapeProblem(url: string): Promise<ProblemScrapeResult> {
    const parsed = extractCFProblemId(url);
    if (!parsed) {
      return { problem: null, error: `Could not extract contest/problem from URL: ${url}` };
    }

    try {
      // Step 1: Fetch metadata via CF API.
      const apiUrl = `https://codeforces.com/api/problemset.problems?tags=`;
      const apiRes = await fetch(apiUrl);

      let cfProblem: CFProblemInfo | undefined;

      if (apiRes.ok) {
        const data = (await apiRes.json()) as CFApiProblemsResponse;
        if (data.status === 'OK' && data.result) {
          cfProblem = data.result.problems.find(
            (p) =>
              String(p.contestId) === parsed.contestId &&
              p.index === parsed.index
          );
        }
      }

      await sleep(2000);

      // Step 2: Scrape the full statement from the problem page.
      const pageData = await fetchCFProblemStatement(
        parsed.contestId,
        parsed.index
      );

      const problem: ScrapedProblem = {
        url,
        platform: 'codeforces',
        externalId: `${parsed.contestId}${parsed.index}`,
        title: cfProblem?.name ?? `Problem ${parsed.contestId}${parsed.index}`,
        statement: pageData.statement,
        constraints: [], // CF doesn't have a separate constraints section.
        inputFormat: pageData.inputFormat,
        outputFormat: pageData.outputFormat,
        difficulty: cfProblem?.rating
          ? `${cfProblem.rating} (${cfRatingToDifficulty(cfProblem.rating)})`
          : null,
        tags: cfProblem?.tags ?? [],
        // CF editorials are blog posts — not easily extractable automatically.
        editorialCode: null,
        editorialLanguage: null,
        editorialExplanation: null,
        optimalComplexity: null,
        timeLimitMs: pageData.timeLimitMs,
        memoryLimitKb: pageData.memoryLimitKb,
      };

      return { problem, error: null };
    } catch (err) {
      return {
        problem: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
