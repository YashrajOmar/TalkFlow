/**
 * @codeon/scrapers — shared types for all platform scrapers.
 *
 * Every scraper (Codeforces, LeetCode, AtCoder) must return data
 * in these standard shapes so the sync job can insert them into
 * user_submissions and scraped_problems without platform-specific logic.
 */

// ── Submission Scraper Types ──────────────────────────────────────────────────

/** A single submission pulled from a user's public profile. */
export interface ScrapedSubmission {
  /** Platform-specific submission ID (string for portability). */
  platformSubmissionId: string;
  problemSlug: string;
  problemTitle: string;
  problemUrl: string;
  language: string;
  /** The actual source code. May be empty if platform doesn't expose it publicly. */
  code: string;
  verdict: 'AC' | 'WA' | 'TLE' | 'MLE' | 'RE' | 'CE' | 'UNKNOWN';
  runtimeMs: number | null;
  memoryKb: number | null;
  problemDifficulty: string | null;
  submittedAt: Date;
}

/** Result of scraping a user's submission history. */
export interface SubmissionScrapeResult {
  platform: string;
  username: string;
  submissions: ScrapedSubmission[];
  /** Number of submissions we attempted to fetch. */
  totalAvailable: number | null;
  /** If the scraper hit a rate limit or error, record it. */
  error: string | null;
}

// ── Problem Scraper Types ─────────────────────────────────────────────────────

/** A problem page scraped from a URL. */
export interface ScrapedProblem {
  url: string;
  platform: string;
  externalId: string | null;
  title: string;
  statement: string;
  constraints: string[];
  inputFormat: string | null;
  outputFormat: string | null;
  difficulty: string | null;
  tags: string[];
  /** The editorial / accepted solution — the "target." */
  editorialCode: string | null;
  editorialLanguage: string | null;
  editorialExplanation: string | null;
  optimalComplexity: string | null;
  timeLimitMs: number | null;
  memoryLimitKb: number | null;
}

/** Result of scraping a problem page. */
export interface ProblemScrapeResult {
  problem: ScrapedProblem | null;
  error: string | null;
}

// ── Scraper Interface ─────────────────────────────────────────────────────────

/**
 * Every platform submission scraper must implement this interface.
 * The sync job calls `scrapeSubmissions` with the public username
 * and an optional cursor for incremental sync.
 */
export interface ISubmissionScraper {
  readonly platform: string;

  /**
   * Scrape a user's public submission history.
   * @param username - The public username on the platform.
   * @param afterTimestamp - Only fetch submissions after this time (incremental sync).
   */
  scrapeSubmissions(
    username: string,
    afterTimestamp?: Date
  ): Promise<SubmissionScrapeResult>;
}

/**
 * Every platform problem scraper must implement this interface.
 * Called when a user pastes a problem URL into the app.
 */
export interface IProblemScraper {
  readonly platform: string;

  /** Returns true if this scraper can handle the given URL. */
  canHandle(url: string): boolean;

  /** Scrape the problem page at the given URL. */
  scrapeProblem(url: string): Promise<ProblemScrapeResult>;
}
