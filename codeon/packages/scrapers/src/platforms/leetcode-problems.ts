/**
 * LeetCode Problem Scraper.
 *
 * When a user pastes a LeetCode problem URL, this scraper:
 *   1. Extracts the title slug from the URL.
 *   2. Calls the LeetCode GraphQL API to fetch the problem statement.
 *   3. Calls a second query to fetch the editorial (official solution).
 *   4. Returns a ScrapedProblem with both the statement and the editorial target.
 *
 * The editorial is stored server-side and NEVER shown to the user until
 * they solve the problem. The Teaching Engine uses it to measure how far
 * the user's current code is from optimal.
 */

import type { IProblemScraper, ProblemScrapeResult, ScrapedProblem } from '../types.js';

// ── GraphQL response types ────────────────────────────────────────────────────

interface LCQuestionResponse {
  question: {
    questionId: string;
    title: string;
    titleSlug: string;
    content: string;
    difficulty: string;
    categoryTitle: string;
    topicTags: Array<{ name: string; slug: string }>;
    hints: string[];
    exampleTestcaseList: string[];
    metaData: string; // JSON string with constraints
  } | null;
}

interface LCEditorialResponse {
  question: {
    solution: {
      id: string;
      content: string; // HTML/markdown editorial
    } | null;
  } | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const LC_GRAPHQL_URL = 'https://leetcode.com/graphql';

// ── Queries ───────────────────────────────────────────────────────────────────

const QUESTION_QUERY = `
  query getQuestion($titleSlug: String!) {
    question(titleSlug: $titleSlug) {
      questionId
      title
      titleSlug
      content
      difficulty
      categoryTitle
      topicTags { name slug }
      hints
      exampleTestcaseList
      metaData
    }
  }
`;

const EDITORIAL_QUERY = `
  query getEditorial($titleSlug: String!) {
    question(titleSlug: $titleSlug) {
      solution {
        id
        content
      }
    }
  }
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function lcGraphQL<T>(
  query: string,
  variables: Record<string, unknown>
): Promise<{ data: T; errors?: Array<{ message: string }> }> {
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
    throw new Error(`LeetCode GraphQL HTTP ${response.status}`);
  }

  return response.json() as Promise<{ data: T; errors?: Array<{ message: string }> }>;
}

/**
 * Extract the slug from a LeetCode URL.
 * Supports:
 *   https://leetcode.com/problems/two-sum/
 *   https://leetcode.com/problems/two-sum/description/
 *   https://leetcode.com/problems/two-sum
 */
function extractSlug(url: string): string | null {
  const match = url.match(/leetcode\.com\/problems\/([a-z0-9-]+)/i);
  return match ? match[1] : null;
}

/**
 * Strip HTML tags from the problem statement.
 * We keep the text structure — the frontend will render it.
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
 * Extract code blocks from the editorial HTML/markdown.
 * We want the actual solution code, not the explanation prose.
 */
function extractCodeFromEditorial(content: string): {
  code: string | null;
  language: string | null;
  explanation: string | null;
} {
  // Look for ```lang\n...code...\n``` blocks.
  const codeBlockMatch = content.match(/```(\w+)\n([\s\S]*?)```/);
  if (codeBlockMatch) {
    return {
      code: codeBlockMatch[2].trim(),
      language: codeBlockMatch[1],
      explanation: stripHtml(content),
    };
  }

  // Look for <pre><code> blocks.
  const preMatch = content.match(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/);
  if (preMatch) {
    return {
      code: stripHtml(preMatch[1]),
      language: null,
      explanation: stripHtml(content),
    };
  }

  // No code found — just return the explanation.
  return {
    code: null,
    language: null,
    explanation: stripHtml(content),
  };
}

/**
 * Extract constraints from the problem HTML.
 * LeetCode puts them in a <ul> inside a section titled "Constraints:".
 */
function extractConstraints(html: string): string[] {
  const constraintSection = html.match(/Constraints:\s*<\/[^>]+>\s*<ul>([\s\S]*?)<\/ul>/i);
  if (!constraintSection) return [];

  const items = constraintSection[1].match(/<li>([\s\S]*?)<\/li>/gi);
  if (!items) return [];

  return items.map((item) => stripHtml(item).trim()).filter(Boolean);
}

// ── Scraper ───────────────────────────────────────────────────────────────────

export class LeetCodeProblemScraper implements IProblemScraper {
  readonly platform = 'leetcode';

  canHandle(url: string): boolean {
    return /leetcode\.com\/problems\//i.test(url);
  }

  async scrapeProblem(url: string): Promise<ProblemScrapeResult> {
    const slug = extractSlug(url);
    if (!slug) {
      return { problem: null, error: `Could not extract problem slug from URL: ${url}` };
    }

    try {
      // Step 1: Fetch problem statement.
      const questionRes = await lcGraphQL<LCQuestionResponse>(
        QUESTION_QUERY,
        { titleSlug: slug }
      );

      if (questionRes.errors?.length) {
        return { problem: null, error: questionRes.errors[0].message };
      }

      const q = questionRes.data.question;
      if (!q) {
        return { problem: null, error: `Problem "${slug}" not found on LeetCode` };
      }

      await sleep(2000);

      // Step 2: Fetch editorial (the target solution).
      let editorialCode: string | null = null;
      let editorialLanguage: string | null = null;
      let editorialExplanation: string | null = null;

      try {
        const editorialRes = await lcGraphQL<LCEditorialResponse>(
          EDITORIAL_QUERY,
          { titleSlug: slug }
        );

        const sol = editorialRes.data.question?.solution;
        if (sol?.content) {
          const extracted = extractCodeFromEditorial(sol.content);
          editorialCode = extracted.code;
          editorialLanguage = extracted.language;
          editorialExplanation = extracted.explanation;
        }
      } catch {
        // Editorial fetch failed — not critical. Problem statement is still valid.
        // Some problems don't have a public editorial.
      }

      const problem: ScrapedProblem = {
        url,
        platform: 'leetcode',
        externalId: q.questionId,
        title: q.title,
        statement: stripHtml(q.content),
        constraints: extractConstraints(q.content),
        inputFormat: null,
        outputFormat: null,
        difficulty: q.difficulty.toLowerCase(),
        tags: q.topicTags.map((t) => t.slug),
        editorialCode,
        editorialLanguage,
        editorialExplanation,
        optimalComplexity: null, // Will be inferred by the Teaching Engine.
        timeLimitMs: null,
        memoryLimitKb: null,
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
