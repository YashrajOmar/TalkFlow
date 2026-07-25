/**
 * Problem Auto-Classifier — Patch 2.
 *
 * When a problem is scraped, we need to tag it with concept topics and weights
 * so the Knowledge Graph knows which skills this problem exercises.
 *
 * Strategy:
 *   - Primary:  Use an LLM (via the provided `llmCall` dependency) to read the
 *               problem statement and classify it against our canonical topic slugs.
 *   - Fallback: Map problem tags (from LeetCode / Codeforces) directly to our
 *               slug vocabulary using a keyword dictionary.
 *
 * This module is framework-agnostic — it takes the LLM call as a dependency
 * so the caller can inject Gemini, OpenAI, or a mock in tests.
 */

// ── Topic tag output type ─────────────────────────────────────────────────────

/** A single topic classification result. */
export interface TopicTag {
  /** Matches a slug in the concept_topics table. */
  topicSlug: string;
  /**
   * Confidence / relevance weight (0.0–1.0).
   * 1.0 = this problem is primarily about this topic.
   * 0.3 = secondary involvement.
   */
  weight: number;
}

/** The full output of a classification run. */
export interface ClassificationResult {
  tags: TopicTag[];
  /** How the classification was produced. */
  method: 'llm' | 'keyword_fallback' | 'empty';
}

// ── LLM dependency port ───────────────────────────────────────────────────────

/**
 * The caller injects this function. It must send the given prompt to an LLM
 * and return the raw text response.
 */
export type LlmCall = (prompt: string) => Promise<string>;

// ── Canonical slug list ───────────────────────────────────────────────────────
// Keep this in sync with the seed data in packages/db/src/seeds/concept-topics.ts.

export const CANONICAL_SLUGS = [
  'two_pointers', 'sliding_window', 'binary_search', 'prefix_sum', 'sorting',
  'bit_manipulation', 'recursion', 'topological_sort', 'hash_map', 'stack',
  'queue', 'heap', 'linked_list', 'tree', 'binary_search_tree', 'segment_tree',
  'trie', 'union_find', 'graph', 'dynamic_programming', 'greedy',
  'divide_and_conquer', 'backtracking', 'bfs', 'dfs', 'shortest_path', 'mst',
  'number_theory', 'combinatorics', 'geometry', 'string_matching', 'string_hashing',
] as const;

export type TopicSlug = typeof CANONICAL_SLUGS[number];

// ── Keyword fallback dictionary ───────────────────────────────────────────────
// Maps common platform tag strings / keywords to our slugs.

const KEYWORD_MAP: Array<{ patterns: RegExp[]; slug: TopicSlug; weight: number }> = [
  { patterns: [/two.?pointer/i, /\bopposite end/i], slug: 'two_pointers', weight: 0.9 },
  { patterns: [/sliding.?window/i, /subarray.{0,20}size k/i], slug: 'sliding_window', weight: 0.9 },
  { patterns: [/binary.?search/i, /\bbisect\b/i, /log n/i], slug: 'binary_search', weight: 0.85 },
  { patterns: [/prefix.?sum/i, /running.?sum/i, /cumulative/i], slug: 'prefix_sum', weight: 0.85 },
  { patterns: [/\bsort/i], slug: 'sorting', weight: 0.6 },
  { patterns: [/bit.?manip/i, /bitwise/i, /\bXOR\b/i, /\bAND\b.*\bOR\b/i], slug: 'bit_manipulation', weight: 0.85 },
  { patterns: [/\brecurs/i, /\bdivide.{0,10}conquer/i], slug: 'recursion', weight: 0.7 },
  { patterns: [/topolog/i, /\bDAG\b/i, /dependency/i], slug: 'topological_sort', weight: 0.9 },
  { patterns: [/hash.?map/i, /hash.?table/i, /\bdict\b/i, /\bfrequency\b/i], slug: 'hash_map', weight: 0.85 },
  { patterns: [/\bstack\b/i, /parenthes/i, /monoton/i], slug: 'stack', weight: 0.8 },
  { patterns: [/\bqueue\b/i, /\bdeque\b/i, /\bbuffer\b/i], slug: 'queue', weight: 0.75 },
  { patterns: [/\bheap\b/i, /priority.?queue/i, /\bpq\b/i], slug: 'heap', weight: 0.85 },
  { patterns: [/linked.?list/i, /\bnode.next\b/i], slug: 'linked_list', weight: 0.9 },
  { patterns: [/\btree\b/i, /\broot\b.*\bleaf\b/i, /\bLCA\b/i, /tree.?traversal/i], slug: 'tree', weight: 0.8 },
  { patterns: [/\bBST\b/i, /binary.?search.?tree/i], slug: 'binary_search_tree', weight: 0.9 },
  { patterns: [/segment.?tree/i, /range.?query/i, /\bRMQ\b/i], slug: 'segment_tree', weight: 0.95 },
  { patterns: [/\btrie\b/i, /prefix.?tree/i, /\bauto.?complete\b/i], slug: 'trie', weight: 0.9 },
  { patterns: [/union.?find/i, /\bDSU\b/i, /disjoint.?set/i, /connected.?component/i], slug: 'union_find', weight: 0.9 },
  { patterns: [/\bgraph\b/i, /\badjacen/i, /\bnode.*edge\b/i, /\bedge.*node\b/i], slug: 'graph', weight: 0.75 },
  { patterns: [/dynamic.?prog/i, /\bDP\b/i, /\bmemoiz/i, /\btabulat/i, /\bopt[io]m.*subproblem/i], slug: 'dynamic_programming', weight: 0.9 },
  { patterns: [/\bgreedy\b/i, /\blocally.?optimal\b/i], slug: 'greedy', weight: 0.85 },
  { patterns: [/divide.{0,10}conquer/i, /\bmerge.?sort\b/i], slug: 'divide_and_conquer', weight: 0.9 },
  { patterns: [/backtrack/i, /\bpermut/i, /\bsubset/i, /\bprunin/i], slug: 'backtracking', weight: 0.85 },
  { patterns: [/\bBFS\b/i, /breadth.?first/i, /\blevel.?order\b/i, /shortest.?path.*unweight/i], slug: 'bfs', weight: 0.9 },
  { patterns: [/\bDFS\b/i, /depth.?first/i, /\bpreorder\b/i, /\binorder\b/i, /\bpostorder\b/i], slug: 'dfs', weight: 0.9 },
  { patterns: [/dijkstra/i, /bellman.?ford/i, /floyd.?warshall/i, /shortest.?path.*weight/i], slug: 'shortest_path', weight: 0.95 },
  { patterns: [/\bMST\b/i, /minimum.?spanning/i, /\bkruskal\b/i, /\bprim\b/i], slug: 'mst', weight: 0.95 },
  { patterns: [/\bGCD\b/i, /\bLCM\b/i, /modular/i, /\bprime\b/i, /\bsieve\b/i, /number.?theory/i], slug: 'number_theory', weight: 0.85 },
  { patterns: [/\bcombinatori/i, /\bpermut/i, /\bnCr\b/i, /pascal/i, /inclusion.?exclusion/i], slug: 'combinatorics', weight: 0.85 },
  { patterns: [/\bgeometr/i, /\bconvex.?hull\b/i, /\bline.?intersect/i], slug: 'geometry', weight: 0.9 },
  { patterns: [/\bKMP\b/i, /\bZ.?algorithm\b/i, /\brabin.?karp\b/i, /pattern.?match/i, /string.?search/i], slug: 'string_matching', weight: 0.9 },
  { patterns: [/string.?hash/i, /rolling.?hash/i, /polynomial.?hash/i], slug: 'string_hashing', weight: 0.9 },
];

// ── LLM prompt builder ────────────────────────────────────────────────────────

function buildClassificationPrompt(
  title: string,
  statement: string,
  validSlugs: readonly string[]
): string {
  const slugList = validSlugs.join(', ');
  const truncated = statement.slice(0, 1500); // Avoid huge context

  return `You are an expert competitive programming coach. Classify the following problem into algorithmic topics.

PROBLEM TITLE: ${title}

PROBLEM STATEMENT (truncated):
${truncated}

VALID TOPIC SLUGS (you MUST only use slugs from this list):
${slugList}

Return a JSON array of objects with shape: [{ "topicSlug": "<slug>", "weight": <0.0-1.0> }]
- Include 1–4 topics maximum.
- weight 0.8–1.0: primary topic (the core skill this problem tests).
- weight 0.4–0.7: secondary topic (helpful but not the main skill).
- weight 0.1–0.3: peripheral involvement.
- Return ONLY the JSON array. No explanation, no markdown fences.`;
}

// ── JSON parser with safety ───────────────────────────────────────────────────

function parseLlmResponse(raw: string, validSlugs: readonly string[]): TopicTag[] | null {
  try {
    // Strip markdown fences if present.
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);

    if (!Array.isArray(parsed)) return null;

    const tags: TopicTag[] = [];
    for (const item of parsed) {
      if (
        typeof item?.topicSlug === 'string' &&
        typeof item?.weight === 'number' &&
        validSlugs.includes(item.topicSlug) &&
        item.weight >= 0 &&
        item.weight <= 1
      ) {
        tags.push({ topicSlug: item.topicSlug, weight: item.weight });
      }
    }

    return tags.length > 0 ? tags : null;
  } catch {
    return null;
  }
}

// ── Keyword fallback ──────────────────────────────────────────────────────────

function keywordFallback(title: string, statement: string, existingTags: string[]): TopicTag[] {
  const corpus = [title, statement, ...existingTags].join(' ');
  const found: Map<string, number> = new Map();

  for (const entry of KEYWORD_MAP) {
    for (const pattern of entry.patterns) {
      if (pattern.test(corpus)) {
        const existing = found.get(entry.slug) ?? 0;
        found.set(entry.slug, Math.max(existing, entry.weight));
        break;
      }
    }
  }

  return Array.from(found.entries())
    .map(([topicSlug, weight]) => ({ topicSlug, weight }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5); // Cap at 5 topics
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Classify a scraped problem into concept topic slugs with weights.
 *
 * @param problem  - The scraped problem data.
 * @param llmCall  - Optional LLM call dependency. If omitted, falls back to keyword matching.
 * @returns        - Classification result with method tag for observability.
 *
 * @example
 * const result = await tagProblemTopics(
 *   { title: 'Two Sum', statement: '...', tags: ['array', 'hash-table'] },
 *   async (prompt) => await gemini.generateText(prompt)
 * );
 * // result.tags = [{ topicSlug: 'hash_map', weight: 0.9 }, { topicSlug: 'sorting', weight: 0.4 }]
 */
export async function tagProblemTopics(
  problem: { title: string; statement: string; tags?: string[] },
  llmCall?: LlmCall
): Promise<ClassificationResult> {
  const { title, statement, tags = [] } = problem;

  // ── 1. Try LLM classification ─────────────────────────────────────────────
  if (llmCall) {
    try {
      const prompt = buildClassificationPrompt(title, statement, CANONICAL_SLUGS);
      const raw = await llmCall(prompt);
      const llmTags = parseLlmResponse(raw, CANONICAL_SLUGS);

      if (llmTags && llmTags.length > 0) {
        return { tags: llmTags, method: 'llm' };
      }
    } catch {
      // LLM call failed — fall through to keyword fallback.
    }
  }

  // ── 2. Keyword fallback ───────────────────────────────────────────────────
  const kwTags = keywordFallback(title, statement, tags);
  if (kwTags.length > 0) {
    return { tags: kwTags, method: 'keyword_fallback' };
  }

  // ── 3. Empty (unclassifiable) ─────────────────────────────────────────────
  return { tags: [], method: 'empty' };
}
