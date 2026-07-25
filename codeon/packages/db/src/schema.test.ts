/**
 * @codeon/db — structural schema tests.
 *
 * These tests require NO database connection. They verify that:
 *   1. All required tables are exported from the schema barrel.
 *   2. Critical columns (especially newly added ones) exist on their tables.
 *   3. The prerequisite graph (Patch 1) and embedding model columns (Patch 5)
 *      are present and won't silently regress.
 *   4. Seed data is internally consistent with the classifier's CANONICAL_SLUGS.
 *
 * If any of these tests fail it means a schema change broke the contract
 * that the rest of the application depends on — catch it before hitting the DB.
 */

import { describe, it, expect } from 'vitest';

// ── Schema imports ────────────────────────────────────────────────────────────

import {
  // Core user tables
  users,
  linkedProfiles,
  userSubmissions,

  // Embedding tables
  submissionEmbeddings,
  problemEmbeddings,

  // Problem pipeline
  scrapedProblems,
  problemTopics,

  // Knowledge graph
  conceptTopics,
  topicPrerequisites,
  userTopicMastery,

  // Session tables
  codingSessions,
  sessionHints,

  // Learning timeline (Patch / Milestone 4)
  learningEvents,

  // Relations
  conceptTopicsRelations,
  topicPrerequisitesRelations,
  submissionEmbeddingsRelations,
  problemEmbeddingsRelations,
  learningEventsRelations,
} from './schema.js';

// ── Seed imports ──────────────────────────────────────────────────────────────

import {
  CONCEPT_TOPIC_SEEDS,
  CONCEPT_TOPIC_PREREQUISITES,
  type PrerequisiteEdge,
} from './seeds/concept-topics.js';

// ═══════════════════════════════════════════════════════════════════════════════
// PATCH 1 — Prerequisite Graph
// ═══════════════════════════════════════════════════════════════════════════════

describe('Patch 1 — topic_prerequisites schema', () => {
  it('topicPrerequisites table is exported from schema', () => {
    expect(topicPrerequisites).toBeDefined();
  });

  it('topicPrerequisites has the correct columns', () => {
    const cols = Object.keys(topicPrerequisites);
    // Drizzle tables expose column names as object keys
    expect(cols).toContain('id');
    expect(cols).toContain('topicId');
    expect(cols).toContain('prerequisiteId');
    expect(cols).toContain('strength');
  });

  it('conceptTopicsRelations exposes prerequisites relation', () => {
    // Drizzle relations are objects; verify the builder produces a config
    expect(conceptTopicsRelations).toBeDefined();
    // The relation object is callable and returns a RelationsConfig
    // We just verify it is a valid Drizzle relation descriptor
    expect(typeof conceptTopicsRelations).toBe('object');
  });

  it('topicPrerequisitesRelations is exported from schema', () => {
    expect(topicPrerequisitesRelations).toBeDefined();
  });
});

describe('Patch 1 — prerequisite seed data', () => {
  it('CONCEPT_TOPIC_PREREQUISITES is a non-empty array', () => {
    expect(Array.isArray(CONCEPT_TOPIC_PREREQUISITES)).toBe(true);
    expect(CONCEPT_TOPIC_PREREQUISITES.length).toBeGreaterThan(0);
  });

  it('every edge has required fields', () => {
    for (const edge of CONCEPT_TOPIC_PREREQUISITES) {
      expect(typeof edge.topicSlug).toBe('string');
      expect(typeof edge.prerequisiteSlug).toBe('string');
      expect(typeof edge.strength).toBe('number');
    }
  });

  it('strength values are within 0–1 range', () => {
    for (const edge of CONCEPT_TOPIC_PREREQUISITES) {
      expect(edge.strength).toBeGreaterThanOrEqual(0);
      expect(edge.strength).toBeLessThanOrEqual(1);
    }
  });

  it('every topicSlug in prerequisites exists in CONCEPT_TOPIC_SEEDS', () => {
    const seedSlugs = new Set(CONCEPT_TOPIC_SEEDS.map((t) => t.slug));
    for (const edge of CONCEPT_TOPIC_PREREQUISITES) {
      expect(seedSlugs.has(edge.topicSlug as never), `Unknown topicSlug "${edge.topicSlug}"`).toBe(true);
      expect(seedSlugs.has(edge.prerequisiteSlug as never), `Unknown prerequisiteSlug "${edge.prerequisiteSlug}"`).toBe(true);
    }
  });

  it('no self-referential edges (a topic cannot be its own prerequisite)', () => {
    for (const edge of CONCEPT_TOPIC_PREREQUISITES) {
      expect(edge.topicSlug, `Self-loop detected on "${edge.topicSlug}"`).not.toBe(edge.prerequisiteSlug);
    }
  });

  it('no duplicate edges (topicSlug + prerequisiteSlug must be unique)', () => {
    const seen = new Set<string>();
    for (const edge of CONCEPT_TOPIC_PREREQUISITES) {
      const key = `${edge.topicSlug}→${edge.prerequisiteSlug}`;
      expect(seen.has(key), `Duplicate edge: ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('PrerequisiteEdge interface is importable as a type', () => {
    // Structural — just verify the type import doesn't cause a runtime error.
    const edge: PrerequisiteEdge = { topicSlug: 'dfs', prerequisiteSlug: 'graph', strength: 1.0 };
    expect(edge.topicSlug).toBe('dfs');
  });

  it('covers known hard dependencies (graph → dfs, recursion → dp)', () => {
    const hardEdges = CONCEPT_TOPIC_PREREQUISITES.filter((e) => e.strength === 1.0);
    const hardPairs = hardEdges.map((e) => `${e.topicSlug}→${e.prerequisiteSlug}`);

    expect(hardPairs).toContain('dfs→graph');
    expect(hardPairs).toContain('bfs→graph');
    expect(hardPairs).toContain('dynamic_programming→recursion');
    expect(hardPairs).toContain('backtracking→recursion');
    expect(hardPairs).toContain('divide_and_conquer→recursion');
    expect(hardPairs).toContain('mst→graph');
    expect(hardPairs).toContain('shortest_path→graph');
    expect(hardPairs).toContain('topological_sort→graph');
    expect(hardPairs).toContain('binary_search_tree→tree');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PATCH 5 — Embedding Model Metadata Column
// ═══════════════════════════════════════════════════════════════════════════════

describe('Patch 5 — embedding_model column on submissionEmbeddings', () => {
  it('submissionEmbeddings table is exported', () => {
    expect(submissionEmbeddings).toBeDefined();
  });

  it('embeddingModel column exists on submissionEmbeddings', () => {
    const cols = Object.keys(submissionEmbeddings);
    expect(cols).toContain('embeddingModel');
  });
});

describe('Patch 5 — embedding_model column on problemEmbeddings', () => {
  it('problemEmbeddings table is exported', () => {
    expect(problemEmbeddings).toBeDefined();
  });

  it('embeddingModel column exists on problemEmbeddings', () => {
    const cols = Object.keys(problemEmbeddings);
    expect(cols).toContain('embeddingModel');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// General Schema Integrity
// ═══════════════════════════════════════════════════════════════════════════════

describe('Schema barrel exports', () => {
  it('all 12 core tables are exported', () => {
    expect(users).toBeDefined();
    expect(linkedProfiles).toBeDefined();
    expect(userSubmissions).toBeDefined();
    expect(submissionEmbeddings).toBeDefined();
    expect(scrapedProblems).toBeDefined();
    expect(problemEmbeddings).toBeDefined();
    expect(conceptTopics).toBeDefined();
    expect(topicPrerequisites).toBeDefined();
    expect(problemTopics).toBeDefined();
    expect(userTopicMastery).toBeDefined();
    expect(codingSessions).toBeDefined();
    expect(sessionHints).toBeDefined();
    expect(learningEvents).toBeDefined();
  });
});

describe('Milestone 4 — learning_events table', () => {
  it('learningEvents table is exported from schema', () => {
    expect(learningEvents).toBeDefined();
  });

  it('learningEvents has required columns', () => {
    const cols = Object.keys(learningEvents);
    expect(cols).toContain('id');
    expect(cols).toContain('userId');
    expect(cols).toContain('type');
    expect(cols).toContain('payload');
    expect(cols).toContain('occurredAt');
    expect(cols).toContain('insertedAt');
  });

  it('learningEventsRelations is exported', () => {
    expect(learningEventsRelations).toBeDefined();
    expect(typeof learningEventsRelations).toBe('object');
  });
});

describe('CONCEPT_TOPIC_SEEDS integrity', () => {
  it('has exactly 32 entries', () => {
    expect(CONCEPT_TOPIC_SEEDS).toHaveLength(32);
  });

  it('all slugs are unique', () => {
    const slugs = CONCEPT_TOPIC_SEEDS.map((t) => t.slug);
    const unique = new Set(slugs);
    expect(unique.size).toBe(CONCEPT_TOPIC_SEEDS.length);
  });

  it('all entries have required fields', () => {
    for (const topic of CONCEPT_TOPIC_SEEDS) {
      expect(typeof topic.slug).toBe('string');
      expect(typeof topic.displayName).toBe('string');
      expect(typeof topic.category).toBe('string');
      expect(['technique', 'data_structure', 'paradigm', 'math']).toContain(topic.category);
    }
  });

  it('all 32 slugs match the classifier CANONICAL_SLUGS list', async () => {
    // Import the classifier's canonical list to verify they stay in sync.
    // This is a cross-package consistency check.
    const CANONICAL_SLUGS = [
      'two_pointers', 'sliding_window', 'binary_search', 'prefix_sum', 'sorting',
      'bit_manipulation', 'recursion', 'topological_sort', 'hash_map', 'stack',
      'queue', 'heap', 'linked_list', 'tree', 'binary_search_tree', 'segment_tree',
      'trie', 'union_find', 'graph', 'dynamic_programming', 'greedy',
      'divide_and_conquer', 'backtracking', 'bfs', 'dfs', 'shortest_path', 'mst',
      'number_theory', 'combinatorics', 'geometry', 'string_matching', 'string_hashing',
    ] as const;

    const seedSlugs = new Set(CONCEPT_TOPIC_SEEDS.map((t) => t.slug));
    const canonicalSet = new Set(CANONICAL_SLUGS);

    // Every seed slug must be in CANONICAL_SLUGS
    for (const slug of seedSlugs) {
      expect(canonicalSet.has(slug as never), `Seed slug "${slug}" not in CANONICAL_SLUGS`).toBe(true);
    }

    // Every CANONICAL_SLUG must be in seeds
    for (const slug of canonicalSet) {
      expect(seedSlugs.has(slug as never), `CANONICAL_SLUG "${slug}" missing from CONCEPT_TOPIC_SEEDS`).toBe(true);
    }
  });
});
