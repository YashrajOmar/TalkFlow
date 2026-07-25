/**
 * Scraper unit tests — tests pure logic only, no network calls.
 *
 * Tests:
 *   - URL routing via canHandle() (no network)
 *   - Platform detection
 *   - Scraper registry routing
 *   - Edge cases (invalid URLs, unknown platforms)
 *   - Module exports
 */

import { describe, it, expect } from 'vitest';
import { ScraperRegistry } from '../src/registry.js';
import { LeetCodeProblemScraper } from '../src/platforms/leetcode-problems.js';
import { CodeforcesProblemScraper } from '../src/platforms/codeforces-problems.js';

// ── ScraperRegistry routing ───────────────────────────────────────────────────

describe('ScraperRegistry', () => {
  const registry = new ScraperRegistry();

  it('lists supported platforms', () => {
    const platforms = registry.supportedPlatforms;
    expect(platforms).toContain('codeforces');
    expect(platforms).toContain('leetcode');
  });

  it('returns error for unsupported submission platform', async () => {
    const result = await registry.scrapeSubmissions('hackerrank', 'user123');
    expect(result.error).toContain('Unsupported platform');
    expect(result.submissions).toEqual([]);
  });

  it('returns error for unsupported problem URL', async () => {
    const result = await registry.scrapeProblem('https://hackerrank.com/challenges/fizzbuzz');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('NO_SCRAPER');
      expect(result.error).toContain('No scraper found');
    }
  });
});

// ── LeetCode canHandle (no network) ──────────────────────────────────────────

describe('LeetCodeProblemScraper.canHandle', () => {
  const scraper = new LeetCodeProblemScraper();

  it('matches leetcode.com/problems/slug/', () => {
    expect(scraper.canHandle('https://leetcode.com/problems/two-sum/')).toBe(true);
  });

  it('matches leetcode.com/problems/slug/description/', () => {
    expect(scraper.canHandle('https://leetcode.com/problems/two-sum/description/')).toBe(true);
  });

  it('matches without trailing slash', () => {
    expect(scraper.canHandle('https://leetcode.com/problems/two-sum')).toBe(true);
  });

  it('rejects non-problem leetcode URLs', () => {
    expect(scraper.canHandle('https://leetcode.com/contest/weekly-100')).toBe(false);
  });

  it('rejects non-leetcode URLs', () => {
    expect(scraper.canHandle('https://codeforces.com/problems/1/A')).toBe(false);
  });
});

// ── Codeforces canHandle (no network) ────────────────────────────────────────

describe('CodeforcesProblemScraper.canHandle', () => {
  const scraper = new CodeforcesProblemScraper();

  it('matches /problemset/problem/1/A', () => {
    expect(scraper.canHandle('https://codeforces.com/problemset/problem/1/A')).toBe(true);
  });

  it('matches /contest/1/problem/A', () => {
    expect(scraper.canHandle('https://codeforces.com/contest/1/problem/A')).toBe(true);
  });

  it('matches /gym/100001/problem/A', () => {
    expect(scraper.canHandle('https://codeforces.com/gym/100001/problem/A')).toBe(true);
  });

  it('rejects blog URLs', () => {
    expect(scraper.canHandle('https://codeforces.com/blog/entry/12345')).toBe(false);
  });

  it('rejects profile URLs', () => {
    expect(scraper.canHandle('https://codeforces.com/profile/tourist')).toBe(false);
  });
});

// ── Import verification ───────────────────────────────────────────────────────

describe('Module exports', () => {
  it('exports all expected scrapers', async () => {
    const mod = await import('../src/index.js');
    expect(mod.ScraperRegistry).toBeDefined();
    expect(mod.CodeforcesSubmissionScraper).toBeDefined();
    expect(mod.LeetCodeSubmissionScraper).toBeDefined();
    expect(mod.LeetCodeProblemScraper).toBeDefined();
    expect(mod.CodeforcesProblemScraper).toBeDefined();
    expect(mod.SubmissionSyncJob).toBeDefined();
  });
});
