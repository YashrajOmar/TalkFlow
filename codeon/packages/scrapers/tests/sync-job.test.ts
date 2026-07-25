/**
 * Sync Job unit tests.
 *
 * Tests the orchestration logic of SubmissionSyncJob with in-memory mocks.
 * No network calls, no database — pure logic testing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LinkedProfile, SyncRepository, SubmissionScraper } from '../src/sync-job.js';
import { SubmissionSyncJob } from '../src/sync-job.js';
import type { ScrapedSubmission, SubmissionScrapeResult } from '../src/types.js';

// ── Mock factories ────────────────────────────────────────────────────────────

function makeSub(overrides: Partial<ScrapedSubmission> = {}): ScrapedSubmission {
  return {
    platformSubmissionId: `sub_${Math.random().toString(36).slice(2, 8)}`,
    problemSlug: 'two-sum',
    problemTitle: 'Two Sum',
    problemUrl: 'https://leetcode.com/problems/two-sum/',
    language: 'cpp17',
    code: '#include <iostream>\nint main() { return 0; }',
    verdict: 'AC',
    runtimeMs: 4,
    memoryKb: 7200,
    problemDifficulty: 'easy',
    submittedAt: new Date('2024-01-15T10:00:00Z'),
    ...overrides,
  };
}

function makeProfile(overrides: Partial<LinkedProfile> = {}): LinkedProfile {
  return {
    id: 'profile_1',
    userId: 'user_1',
    platform: 'leetcode',
    platformUsername: 'testuser',
    lastSyncedAt: null,
    totalSyncedCount: 0,
    ...overrides,
  };
}

function makeMockRepo(opts: {
  profiles?: LinkedProfile[];
  existingIds?: Set<string>;
} = {}): SyncRepository & { insertedSubs: ScrapedSubmission[] } {
  const existingIds = opts.existingIds ?? new Set<string>();
  const insertedSubs: ScrapedSubmission[] = [];

  return {
    insertedSubs,
    getProfilesToSync: vi.fn().mockResolvedValue(opts.profiles ?? []),
    markSyncRunning: vi.fn().mockResolvedValue(undefined),
    markSyncComplete: vi.fn().mockResolvedValue(undefined),
    markSyncFailed: vi.fn().mockResolvedValue(undefined),
    submissionExists: vi.fn().mockImplementation(async (id: string) => existingIds.has(id)),
    insertSubmissions: vi.fn().mockImplementation(async (_uid, _pid, _platform, subs: ScrapedSubmission[]) => {
      insertedSubs.push(...subs);
      return subs.length;
    }),
  };
}

function makeMockScraper(result: SubmissionScrapeResult): SubmissionScraper {
  return {
    scrapeSubmissions: vi.fn().mockResolvedValue(result),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SubmissionSyncJob', () => {
  it('syncs new submissions from a fresh profile (no previous sync)', async () => {
    const sub1 = makeSub({ platformSubmissionId: 'lc_001' });
    const sub2 = makeSub({ platformSubmissionId: 'lc_002', verdict: 'WA' });

    const repo = makeMockRepo({ profiles: [makeProfile()] });
    const scraper = makeMockScraper({
      platform: 'leetcode',
      username: 'testuser',
      submissions: [sub1, sub2],
      totalAvailable: 50,
      error: null,
    });

    const job = new SubmissionSyncJob(repo, scraper);
    const result = await job.syncUser('user_1');

    expect(result.totalNewSubmissions).toBe(2);
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0].newSubmissions).toBe(2);
    expect(result.profiles[0].error).toBeNull();
    expect(repo.insertedSubs).toHaveLength(2);
    expect(repo.markSyncComplete).toHaveBeenCalledTimes(1);
  });

  it('deduplicates submissions that already exist in the database', async () => {
    const sub1 = makeSub({ platformSubmissionId: 'lc_001' });
    const sub2 = makeSub({ platformSubmissionId: 'lc_002' });
    const sub3 = makeSub({ platformSubmissionId: 'lc_003' });

    const repo = makeMockRepo({
      profiles: [makeProfile()],
      existingIds: new Set(['lc_001', 'lc_003']), // sub1 and sub3 already exist
    });
    const scraper = makeMockScraper({
      platform: 'leetcode',
      username: 'testuser',
      submissions: [sub1, sub2, sub3],
      totalAvailable: null,
      error: null,
    });

    const job = new SubmissionSyncJob(repo, scraper);
    const result = await job.syncUser('user_1');

    // Only sub2 is new
    expect(result.totalNewSubmissions).toBe(1);
    expect(repo.insertedSubs).toHaveLength(1);
    expect(repo.insertedSubs[0].platformSubmissionId).toBe('lc_002');
  });

  it('handles scraper errors gracefully', async () => {
    const repo = makeMockRepo({ profiles: [makeProfile()] });
    const scraper = makeMockScraper({
      platform: 'leetcode',
      username: 'testuser',
      submissions: [],
      totalAvailable: null,
      error: 'User "testuser" not found on LeetCode',
    });

    const job = new SubmissionSyncJob(repo, scraper);
    const result = await job.syncUser('user_1');

    expect(result.totalNewSubmissions).toBe(0);
    expect(result.profiles[0].error).toBe('User "testuser" not found on LeetCode');
    expect(repo.markSyncFailed).toHaveBeenCalledTimes(1);
  });

  it('syncs multiple profiles for the same user', async () => {
    const lcProfile = makeProfile({ id: 'p1', platform: 'leetcode', platformUsername: 'lcuser' });
    const cfProfile = makeProfile({ id: 'p2', platform: 'codeforces', platformUsername: 'cfuser' });

    const repo = makeMockRepo({ profiles: [lcProfile, cfProfile] });
    const scraper: SubmissionScraper = {
      scrapeSubmissions: vi.fn()
        .mockResolvedValueOnce({
          platform: 'leetcode',
          username: 'lcuser',
          submissions: [makeSub({ platformSubmissionId: 'lc_001' })],
          totalAvailable: 10,
          error: null,
        })
        .mockResolvedValueOnce({
          platform: 'codeforces',
          username: 'cfuser',
          submissions: [
            makeSub({ platformSubmissionId: 'cf_001' }),
            makeSub({ platformSubmissionId: 'cf_002' }),
          ],
          totalAvailable: 200,
          error: null,
        }),
    };

    const job = new SubmissionSyncJob(repo, scraper);
    const result = await job.syncUser('user_1');

    expect(result.profiles).toHaveLength(2);
    expect(result.totalNewSubmissions).toBe(3);
    expect(result.profiles[0].newSubmissions).toBe(1);
    expect(result.profiles[1].newSubmissions).toBe(2);
  });

  it('uses lastSyncedAt for incremental sync', async () => {
    const lastSync = new Date('2024-06-01T00:00:00Z');
    const profile = makeProfile({ lastSyncedAt: lastSync, totalSyncedCount: 42 });

    const repo = makeMockRepo({ profiles: [profile] });
    const mockScrapeSubmissions = vi.fn().mockResolvedValue({
      platform: 'leetcode',
      username: 'testuser',
      submissions: [makeSub({ platformSubmissionId: 'lc_new' })],
      totalAvailable: 43,
      error: null,
    });
    const scraper: SubmissionScraper = { scrapeSubmissions: mockScrapeSubmissions };

    const job = new SubmissionSyncJob(repo, scraper);
    await job.syncUser('user_1');

    // Verify the scraper was called with the afterTimestamp cursor
    expect(mockScrapeSubmissions).toHaveBeenCalledWith('leetcode', 'testuser', lastSync);

    // Verify sync count was updated: 42 + 1 = 43
    expect(repo.markSyncComplete).toHaveBeenCalledWith(
      'profile_1',
      43,
      expect.any(Date)
    );
  });

  it('handles no submissions gracefully (empty profile)', async () => {
    const repo = makeMockRepo({ profiles: [makeProfile()] });
    const scraper = makeMockScraper({
      platform: 'leetcode',
      username: 'testuser',
      submissions: [],
      totalAvailable: 0,
      error: null,
    });

    const job = new SubmissionSyncJob(repo, scraper);
    const result = await job.syncUser('user_1');

    expect(result.totalNewSubmissions).toBe(0);
    expect(result.profiles[0].error).toBeNull();
    expect(repo.markSyncComplete).toHaveBeenCalledTimes(1);
  });

  it('handles unexpected exceptions during scraping', async () => {
    const repo = makeMockRepo({ profiles: [makeProfile()] });
    const scraper: SubmissionScraper = {
      scrapeSubmissions: vi.fn().mockRejectedValue(new Error('Network timeout')),
    };

    const job = new SubmissionSyncJob(repo, scraper);
    const result = await job.syncUser('user_1');

    expect(result.totalNewSubmissions).toBe(0);
    expect(result.profiles[0].error).toBe('Network timeout');
    expect(repo.markSyncFailed).toHaveBeenCalledTimes(1);
  });
});
