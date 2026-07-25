/**
 * @codeon/scrapers — barrel export.
 */

// Types
export type {
  ScrapedSubmission,
  SubmissionScrapeResult,
  ScrapedProblem,
  ProblemScrapeResult as LegacyProblemScrapeResult,
  ISubmissionScraper,
  IProblemScraper,
} from './types.js';

// Platform scrapers
export { CodeforcesSubmissionScraper } from './platforms/codeforces-submissions.js';
export { LeetCodeSubmissionScraper } from './platforms/leetcode-submissions.js';
export { LeetCodeProblemScraper } from './platforms/leetcode-problems.js';
export { CodeforcesProblemScraper } from './platforms/codeforces-problems.js';

// Registry v2 — typed failure states + cache port
export { ScraperRegistry } from './registry.js';
export type {
  ProblemScrapeResult,
  ProblemScrapeSuccess,
  ProblemScrapeBlocked,
  ProblemScrapeNotFound,
  ProblemScrapeError,
  ProblemScrapeClassifiedResult,
  ProblemCachePort,
} from './registry.js';

// Sync job v2 — tiered backfill
export { SubmissionSyncJob } from './sync-job.js';
export type {
  LinkedProfile,
  SyncRepository,
  SyncResult,
  SyncJobResult,
  Tier1Result,
} from './sync-job.js';

// Problem auto-classifier
export { tagProblemTopics, CANONICAL_SLUGS } from './classifier.js';
export type {
  TopicTag,
  ClassificationResult,
  LlmCall,
  TopicSlug,
} from './classifier.js';
