/**
 * Submission Sync Job v2 — Patch 4.
 *
 * Two-tier backfill strategy:
 *
 *   Tier 1 — IMMEDIATE (synchronous):
 *     Fetch and embed the 30 most recent submissions right away so the
 *     RAG system has context within seconds of linking a new profile.
 *
 *   Tier 2 — BACKGROUND (async, chunked):
 *     The remaining historical submissions are processed in batches of
 *     BATCH_SIZE with RATE_LIMIT_PAUSE_MS between each batch.
 *     The caller controls when this runs (cron job, queue worker, etc.)
 *     by calling `processBackgroundTier()`.
 *
 * Framework-agnostic: takes a SyncRepository port and a scraper as
 * constructor dependencies. No direct DB or HTTP coupling.
 */

import type { ScrapedSubmission, SubmissionScrapeResult } from './types.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Number of most-recent submissions fetched immediately for RAG context. */
const TIER1_SIZE = 30;

/** Batch size for the background historical backfill. */
const BATCH_SIZE = 50;

/** Pause between background batches to avoid rate-limiting. */
const RATE_LIMIT_PAUSE_MS = 3000;

// ── Ports ─────────────────────────────────────────────────────────────────────

export interface LinkedProfile {
  id: string;
  userId: string;
  platform: string;
  platformUsername: string;
  lastSyncedAt: Date | null;
  totalSyncedCount: number;
}

export interface SyncRepository {
  getProfilesToSync(userId?: string): Promise<LinkedProfile[]>;
  markSyncRunning(profileId: string): Promise<void>;
  markSyncComplete(profileId: string, newCount: number, syncedAt: Date): Promise<void>;
  markSyncFailed(profileId: string, error: string): Promise<void>;
  submissionExists(platformSubmissionId: string): Promise<boolean>;
  insertSubmissions(
    userId: string,
    profileId: string,
    platform: string,
    submissions: ScrapedSubmission[]
  ): Promise<number>;
}

export interface SubmissionScraper {
  scrapeSubmissions(
    platform: string,
    username: string,
    afterTimestamp?: Date
  ): Promise<SubmissionScrapeResult>;
}

// ── Result types ──────────────────────────────────────────────────────────────

export interface Tier1Result {
  profileId: string;
  platform: string;
  username: string;
  /** Submissions inserted in Tier 1 (immediate). */
  tier1Inserted: number;
  /** Submissions queued for Tier 2 (background). */
  tier2Queued: number;
  /** Total available on the platform (if the platform reports it). */
  totalAvailable: number | null;
  error: string | null;
  durationMs: number;
}

export interface SyncResult {
  profileId: string;
  platform: string;
  username: string;
  newSubmissions: number;
  totalAvailable: number | null;
  error: string | null;
  durationMs: number;
}

export interface SyncJobResult {
  userId: string;
  profiles: SyncResult[];
  totalNewSubmissions: number;
  durationMs: number;
}

// ── Dedup helper ──────────────────────────────────────────────────────────────

async function filterNew(
  subs: ScrapedSubmission[],
  repo: SyncRepository
): Promise<ScrapedSubmission[]> {
  const results: ScrapedSubmission[] = [];
  for (const sub of subs) {
    if (!(await repo.submissionExists(sub.platformSubmissionId))) {
      results.push(sub);
    }
  }
  return results;
}

// ── Sleep ─────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── The job ───────────────────────────────────────────────────────────────────

export class SubmissionSyncJob {
  constructor(
    private readonly repo: SyncRepository,
    private readonly scraper: SubmissionScraper
  ) {}

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Full sync for all linked profiles of a user.
   * Backward-compatible with existing callers.
   */
  async syncUser(userId: string): Promise<SyncJobResult> {
    const start = Date.now();
    const profiles = await this.repo.getProfilesToSync(userId);
    const results: SyncResult[] = [];
    let totalNew = 0;

    for (const profile of profiles) {
      const result = await this.syncProfile(profile);
      results.push(result);
      totalNew += result.newSubmissions;
    }

    return {
      userId,
      profiles: results,
      totalNewSubmissions: totalNew,
      durationMs: Date.now() - start,
    };
  }

  /**
   * Tier 1 — Immediate sync.
   *
   * Fetches all available submissions, inserts the TIER1_SIZE most recent
   * synchronously so the RAG system has context right away.
   * Returns the remaining submissions so the caller can schedule Tier 2.
   */
  async syncTier1(profile: LinkedProfile): Promise<{
    result: Tier1Result;
    tier2Pending: ScrapedSubmission[];
  }> {
    const start = Date.now();
    await this.repo.markSyncRunning(profile.id);

    try {
      const scrapeResult = await this.scraper.scrapeSubmissions(
        profile.platform,
        profile.platformUsername,
        profile.lastSyncedAt ?? undefined
      );

      if (scrapeResult.error) {
        await this.repo.markSyncFailed(profile.id, scrapeResult.error);
        return {
          result: {
            profileId: profile.id,
            platform: profile.platform,
            username: profile.platformUsername,
            tier1Inserted: 0,
            tier2Queued: 0,
            totalAvailable: scrapeResult.totalAvailable,
            error: scrapeResult.error,
            durationMs: Date.now() - start,
          },
          tier2Pending: [],
        };
      }

      // Deduplicate all scraped submissions.
      const allNew = await filterNew(scrapeResult.submissions, this.repo);

      // Tier 1: most recent TIER1_SIZE submissions (already sorted by scraper — newest first).
      const tier1Subs = allNew.slice(0, TIER1_SIZE);
      const tier2Subs = allNew.slice(TIER1_SIZE);

      let tier1Inserted = 0;
      if (tier1Subs.length > 0) {
        tier1Inserted = await this.repo.insertSubmissions(
          profile.userId,
          profile.id,
          profile.platform,
          tier1Subs
        );
      }

      // Update sync state with what we've done so far.
      await this.repo.markSyncComplete(
        profile.id,
        profile.totalSyncedCount + tier1Inserted,
        new Date()
      );

      return {
        result: {
          profileId: profile.id,
          platform: profile.platform,
          username: profile.platformUsername,
          tier1Inserted,
          tier2Queued: tier2Subs.length,
          totalAvailable: scrapeResult.totalAvailable,
          error: null,
          durationMs: Date.now() - start,
        },
        tier2Pending: tier2Subs,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await this.repo.markSyncFailed(profile.id, errMsg).catch(() => {});
      return {
        result: {
          profileId: profile.id,
          platform: profile.platform,
          username: profile.platformUsername,
          tier1Inserted: 0,
          tier2Queued: 0,
          totalAvailable: null,
          error: errMsg,
          durationMs: Date.now() - start,
        },
        tier2Pending: [],
      };
    }
  }

  /**
   * Tier 2 — Background backfill.
   *
   * Processes remaining historical submissions in safe batches with rate-limit
   * pauses. Designed to be called from a queue worker or cron job.
   *
   * @param profile   - The profile being synced.
   * @param pending   - Submissions returned by syncTier1().tier2Pending.
   * @param onProgress - Optional callback after each batch (for progress reporting).
   * @returns Total submissions inserted.
   */
  async processBackgroundTier(
    profile: LinkedProfile,
    pending: ScrapedSubmission[],
    onProgress?: (inserted: number, remaining: number) => void
  ): Promise<number> {
    let totalInserted = 0;
    let currentCount = profile.totalSyncedCount;

    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE);

      try {
        const inserted = await this.repo.insertSubmissions(
          profile.userId,
          profile.id,
          profile.platform,
          batch
        );
        totalInserted += inserted;
        currentCount += inserted;

        await this.repo.markSyncComplete(profile.id, currentCount, new Date());

        onProgress?.(totalInserted, pending.length - i - batch.length);

        // Pause between batches to avoid hammering the DB or triggering rate limits.
        if (i + BATCH_SIZE < pending.length) {
          await sleep(RATE_LIMIT_PAUSE_MS);
        }
      } catch (err) {
        // On batch error, mark the profile as failed but return what we have.
        const errMsg = err instanceof Error ? err.message : String(err);
        await this.repo.markSyncFailed(profile.id, `Tier 2 batch error: ${errMsg}`).catch(() => {});
        break;
      }
    }

    return totalInserted;
  }

  // ── Legacy single-profile sync (used by syncUser) ─────────────────────────

  async syncProfile(profile: LinkedProfile): Promise<SyncResult> {
    const start = Date.now();

    try {
      await this.repo.markSyncRunning(profile.id);

      const scrapeResult = await this.scraper.scrapeSubmissions(
        profile.platform,
        profile.platformUsername,
        profile.lastSyncedAt ?? undefined
      );

      if (scrapeResult.error) {
        await this.repo.markSyncFailed(profile.id, scrapeResult.error);
        return {
          profileId: profile.id,
          platform: profile.platform,
          username: profile.platformUsername,
          newSubmissions: 0,
          totalAvailable: scrapeResult.totalAvailable,
          error: scrapeResult.error,
          durationMs: Date.now() - start,
        };
      }

      const newSubs = await filterNew(scrapeResult.submissions, this.repo);

      let inserted = 0;
      if (newSubs.length > 0) {
        inserted = await this.repo.insertSubmissions(
          profile.userId,
          profile.id,
          profile.platform,
          newSubs
        );
      }

      await this.repo.markSyncComplete(
        profile.id,
        profile.totalSyncedCount + inserted,
        new Date()
      );

      return {
        profileId: profile.id,
        platform: profile.platform,
        username: profile.platformUsername,
        newSubmissions: inserted,
        totalAvailable: scrapeResult.totalAvailable,
        error: null,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await this.repo.markSyncFailed(profile.id, errMsg).catch(() => {});
      return {
        profileId: profile.id,
        platform: profile.platform,
        username: profile.platformUsername,
        newSubmissions: 0,
        totalAvailable: null,
        error: errMsg,
        durationMs: Date.now() - start,
      };
    }
  }
}
