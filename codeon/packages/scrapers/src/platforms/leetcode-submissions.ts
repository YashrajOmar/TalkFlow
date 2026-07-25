/**
 * LeetCode Submission Scraper.
 *
 * LeetCode has NO official public API. We use their internal GraphQL endpoint
 * which is publicly accessible (no auth required for public profiles):
 *
 *   POST https://leetcode.com/graphql
 *
 * We query:
 *   1. recentAcSubmissionList — recent accepted submissions (public)
 *   2. userProfileUserQuestionProgressV2 — problem solve counts
 *
 * Limitations:
 *   - Only ACCEPTED submissions are visible on public profiles.
 *   - No source code is exposed publicly (we store empty string; code comes later
 *     when the user solves the problem in our editor).
 *   - Rate limiting is aggressive — we pause 3s between requests.
 *
 * This scraper is intentionally conservative to avoid being blocked.
 */

import type {
  ISubmissionScraper,
  ScrapedSubmission,
  SubmissionScrapeResult,
} from '../types.js';

// ── LeetCode GraphQL response types ──────────────────────────────────────────

interface LCRecentAcSubmission {
  id: string;
  title: string;
  titleSlug: string;
  timestamp: string; // Unix timestamp as string
  lang: string;
  runtime: string;   // e.g., "4 ms"
  memory: string;    // e.g., "7.2 MB"
}

interface LCGraphQLResponse<T> {
  data: T;
  errors?: Array<{ message: string }>;
}

interface LCRecentAcResponse {
  recentAcSubmissionList: LCRecentAcSubmission[];
}

interface LCUserProfile {
  matchedUser: {
    username: string;
    profile: {
      ranking: number;
    };
    submitStatsGlobal: {
      acSubmissionNum: Array<{
        difficulty: string;
        count: number;
      }>;
    };
  } | null;
}

// ── Language normalization ────────────────────────────────────────────────────

function normalizeLCLanguage(lang: string): string {
  const map: Record<string, string> = {
    cpp: 'cpp17',
    'c++': 'cpp17',
    c: 'c',
    java: 'java',
    python: 'python2',
    python3: 'python3',
    javascript: 'javascript',
    typescript: 'typescript',
    go: 'go',
    rust: 'rust',
    kotlin: 'kotlin',
    swift: 'swift',
    scala: 'scala',
    ruby: 'ruby',
    csharp: 'csharp',
    php: 'php',
    dart: 'dart',
  };
  return map[lang.toLowerCase()] ?? lang.toLowerCase();
}

// ── Difficulty inference from slug ────────────────────────────────────────────
// LeetCode's public API doesn't always return difficulty with submissions.
// We leave it null — the problem scraper will fill it when the user loads it.

// ── Constants ─────────────────────────────────────────────────────────────────

const LC_GRAPHQL_URL = 'https://leetcode.com/graphql';
const RATE_LIMIT_MS = 3000;
const MAX_SUBMISSIONS = 500; // Safety cap per sync

// ── Sleep utility ─────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── GraphQL query helper ──────────────────────────────────────────────────────

async function lcGraphQL<T>(
  query: string,
  variables: Record<string, unknown>
): Promise<LCGraphQLResponse<T>> {
  const response = await fetch(LC_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Referer': 'https://leetcode.com',
      'User-Agent': 'codeOn/1.0 (AI Coding Coach)',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`LeetCode GraphQL HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json() as Promise<LCGraphQLResponse<T>>;
}

// ── GraphQL queries ───────────────────────────────────────────────────────────

const RECENT_AC_QUERY = `
  query recentAcSubmissions($username: String!, $limit: Int!) {
    recentAcSubmissionList(username: $username, limit: $limit) {
      id
      title
      titleSlug
      timestamp
      lang
      runtime
      memory
    }
  }
`;

const USER_PROFILE_QUERY = `
  query getUserProfile($username: String!) {
    matchedUser(username: $username) {
      username
      profile {
        ranking
      }
      submitStatsGlobal {
        acSubmissionNum {
          difficulty
          count
        }
      }
    }
  }
`;

// ── Runtime/memory parsing ────────────────────────────────────────────────────

function parseRuntimeMs(runtime: string): number | null {
  const match = runtime.match(/(\d+)\s*ms/);
  return match ? parseInt(match[1], 10) : null;
}

function parseMemoryKb(memory: string): number | null {
  const mbMatch = memory.match(/([\d.]+)\s*MB/i);
  if (mbMatch) return Math.round(parseFloat(mbMatch[1]) * 1024);
  const kbMatch = memory.match(/([\d.]+)\s*KB/i);
  if (kbMatch) return Math.round(parseFloat(kbMatch[1]));
  return null;
}

// ── Scraper ───────────────────────────────────────────────────────────────────

export class LeetCodeSubmissionScraper implements ISubmissionScraper {
  readonly platform = 'leetcode';

  async scrapeSubmissions(
    username: string,
    afterTimestamp?: Date
  ): Promise<SubmissionScrapeResult> {
    const submissions: ScrapedSubmission[] = [];

    try {
      // Step 1: Verify user exists and get profile stats.
      const profileRes = await lcGraphQL<LCUserProfile>(
        USER_PROFILE_QUERY,
        { username }
      );

      if (profileRes.errors?.length) {
        return {
          platform: this.platform,
          username,
          submissions: [],
          totalAvailable: null,
          error: profileRes.errors[0].message,
        };
      }

      if (!profileRes.data.matchedUser) {
        return {
          platform: this.platform,
          username,
          submissions: [],
          totalAvailable: null,
          error: `User "${username}" not found on LeetCode`,
        };
      }

      await sleep(RATE_LIMIT_MS);

      // Step 2: Fetch recent AC submissions.
      // LeetCode's recentAcSubmissionList returns at most ~20 recent.
      // For a full backup, we'd need the paginated endpoint, but that
      // requires authentication. This is the best we can do publicly.
      const acRes = await lcGraphQL<LCRecentAcResponse>(
        RECENT_AC_QUERY,
        { username, limit: MAX_SUBMISSIONS }
      );

      if (acRes.errors?.length) {
        return {
          platform: this.platform,
          username,
          submissions: [],
          totalAvailable: null,
          error: acRes.errors[0].message,
        };
      }

      const afterEpoch = afterTimestamp ? afterTimestamp.getTime() / 1000 : 0;

      for (const sub of acRes.data.recentAcSubmissionList ?? []) {
        const ts = parseInt(sub.timestamp, 10);
        if (ts <= afterEpoch) continue;

        submissions.push({
          platformSubmissionId: sub.id,
          problemSlug: sub.titleSlug,
          problemTitle: sub.title,
          problemUrl: `https://leetcode.com/problems/${sub.titleSlug}/`,
          language: normalizeLCLanguage(sub.lang),
          // LeetCode does NOT expose source code on public profiles.
          code: '',
          verdict: 'AC', // recentAcSubmissionList only returns accepted.
          runtimeMs: parseRuntimeMs(sub.runtime),
          memoryKb: parseMemoryKb(sub.memory),
          problemDifficulty: null, // Not available from this endpoint.
          submittedAt: new Date(ts * 1000),
        });
      }

      // Calculate total from profile stats.
      const totalAc = profileRes.data.matchedUser.submitStatsGlobal.acSubmissionNum
        .reduce((sum, d) => sum + d.count, 0);

      return {
        platform: this.platform,
        username,
        submissions,
        totalAvailable: totalAc,
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
