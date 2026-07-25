/**
 * codeOn — Drizzle ORM Schema (v2)
 *
 * Architecture:
 *   1. WhatsApp-style backup: linked_profiles → user_submissions → submission_embeddings
 *   2. URL-driven scraping:   scraped_problems → problem_embeddings
 *   3. Session tracking:      coding_sessions → session_hints
 *   4. Knowledge Graph:       concept_topics → user_topic_mastery, problem_topics
 *
 * Decisions:
 *   - vector(768) → Google text-embedding-004
 *   - HNSW indexes with vector_cosine_ops for ANN search
 *   - All jsonb columns typed with .$type<T>()
 *   - Cascading deletes on user-owned data; SET NULL on problem references
 *   - linked_profiles supports multiple usernames per user per platform
 *
 * Prerequisite: CREATE EXTENSION IF NOT EXISTS vector;
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  customType,
  serial,
  real,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// ── pgvector custom type ──────────────────────────────────────────────────────

const vector = (dimensions: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      return `vector(${dimensions})`;
    },
    toDriver(value: number[]): string {
      return `[${value.join(',')}]`;
    },
    fromDriver(value: string): number[] {
      return value
        .slice(1, -1)
        .split(',')
        .map(Number);
    },
  });

// ── Dimension constant ────────────────────────────────────────────────────────
// Google text-embedding-004 outputs 768 dimensions.
const EMBEDDING_DIM = 768;

// ── JSONB payload types ───────────────────────────────────────────────────────

/** Metadata stored alongside each submission embedding chunk. */
interface SubmissionEmbeddingMeta {
  language: string;
  verdict: string;
  problem_slug: string;
  difficulty: string | null;
  was_ac: boolean;
}

/** Constraint list scraped from a problem page. */
type ConstraintList = string[];

/** Tag list scraped from a problem page. */
type TagList = string[];

/** IDs of past submissions retrieved by RAG when generating a hint. */
type RagSubmissionIds = string[];

// ═══════════════════════════════════════════════════════════════════════════════
// TABLE: users
// ═══════════════════════════════════════════════════════════════════════════════

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  /**
   * Inferred from submission backup — NOT a user-filled dropdown.
   * Detected as the most-used language across all synced submissions.
   */
  primaryLanguage: text('primary_language').notNull().default('unknown'),
  /**
   * Derived from AC rate weighted by problem difficulty.
   * Updated after each sync and each session completion.
   */
  inferredElo: integer('inferred_elo').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// TABLE: linked_profiles
// ═══════════════════════════════════════════════════════════════════════════════
// Replaces the old sync_state. A user can link MULTIPLE usernames per platform.
// e.g., two LeetCode accounts + one Codeforces account → 3 rows.

export const linkedProfiles = pgTable(
  'linked_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 'leetcode' | 'codeforces' | 'atcoder' | 'codechef' */
    platform: text('platform').notNull(),
    /** The public username on that platform. */
    platformUsername: text('platform_username').notNull(),
    /** NULL = never synced yet. */
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    totalSyncedCount: integer('total_synced_count').notNull().default(0),
    /** 'idle' | 'running' | 'failed' */
    syncStatus: text('sync_status').notNull().default('idle'),
    /** Last error message if syncStatus = 'failed'. */
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // A user cannot link the exact same username on the same platform twice.
    uniqueIndex('uq_linked_profiles_user_platform_username').on(
      table.userId,
      table.platform,
      table.platformUsername
    ),
    index('idx_linked_profiles_user_id').on(table.userId),
  ]
);

// ═══════════════════════════════════════════════════════════════════════════════
// TABLE: user_submissions
// ═══════════════════════════════════════════════════════════════════════════════
// Every past submission pulled during the "WhatsApp backup" sync.
// Source of truth for RAG memory.

export const userSubmissions = pgTable(
  'user_submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Which linked profile pulled this submission. */
    profileId: uuid('profile_id')
      .notNull()
      .references(() => linkedProfiles.id, { onDelete: 'cascade' }),
    platform: text('platform').notNull(),
    /** External submission ID from the platform — used to deduplicate. */
    platformSubmissionId: text('platform_submission_id').notNull().unique(),
    problemSlug: text('problem_slug').notNull(),
    problemTitle: text('problem_title').notNull(),
    problemUrl: text('problem_url').notNull(),
    language: text('language').notNull(),
    code: text('code').notNull(),
    /** 'AC' | 'WA' | 'TLE' | 'MLE' | 'RE' | 'CE' */
    verdict: text('verdict').notNull(),
    runtimeMs: integer('runtime_ms'),
    memoryKb: integer('memory_kb'),
    /** 'easy' | 'medium' | 'hard' | '1400' (CF rating) */
    problemDifficulty: text('problem_difficulty'),
    /** When the user submitted it on the platform. */
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),
    /** When WE pulled it during sync. */
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_user_submissions_user_time').on(table.userId, table.submittedAt),
    index('idx_user_submissions_user_problem').on(table.userId, table.problemSlug),
    index('idx_user_submissions_user_verdict').on(table.userId, table.verdict),
  ]
);

// ═══════════════════════════════════════════════════════════════════════════════
// TABLE: submission_embeddings
// ═══════════════════════════════════════════════════════════════════════════════
// pgvector RAG memory. Each submission → 1–3 embedding chunks.
// 'full_code' — embeds the entire submission for similarity retrieval.
// 'mistake_pattern' — embeds WA/TLE code so the AI remembers past failures.
// 'style_signal' — embeds variable names, loop idioms, coding style.

export const submissionEmbeddings = pgTable(
  'submission_embeddings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => userSubmissions.id, { onDelete: 'cascade' }),
    /** Denormalized for fast vector queries filtered by user. */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 'full_code' | 'mistake_pattern' | 'style_signal' */
    chunkType: text('chunk_type').notNull(),
    /** The text that was embedded. Stored for debugging and re-embedding. */
    content: text('content').notNull(),
    embedding: vector(EMBEDDING_DIM)('embedding').notNull(),
    metadata: jsonb('metadata').$type<SubmissionEmbeddingMeta>().notNull(),
    /**
     * Which embedding model produced this vector.
     * Stored so we know which rows to re-embed when migrating models.
     * Default: 'text-embedding-004' (Google, 768 dims).
     */
    embeddingModel: text('embedding_model').notNull().default('text-embedding-004'),
  },
  (table) => [
    // HNSW index for cosine similarity search.
    index('idx_submission_embeddings_hnsw').using(
      'hnsw',
      table.embedding.op('vector_cosine_ops')
    ),
    index('idx_submission_embeddings_user_chunk').on(table.userId, table.chunkType),
    index('idx_submission_embeddings_model').on(table.embeddingModel),
  ]
);

// ═══════════════════════════════════════════════════════════════════════════════
// TABLE: scraped_problems
// ═══════════════════════════════════════════════════════════════════════════════
// URL-driven problem cache. No manual problem library.
// Scraped the instant a user pastes a link.

export const scrapedProblems = pgTable(
  'scraped_problems',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The URL the user pasted — this is the cache key. */
    url: text('url').notNull().unique(),
    platform: text('platform').notNull(),
    externalId: text('external_id'),
    title: text('title').notNull(),
    statement: text('statement').notNull(),
    constraints: jsonb('constraints').$type<ConstraintList>(),
    inputFormat: text('input_format'),
    outputFormat: text('output_format'),
    difficulty: text('difficulty'),
    tags: jsonb('tags').$type<TagList>(),

    // ── The "target" — scraped editorial, never shown to user until solved ──
    editorialCode: text('editorial_code'),
    editorialLanguage: text('editorial_language'),
    editorialExplanation: text('editorial_explanation'),
    optimalComplexity: text('optimal_complexity'),

    timeLimitMs: integer('time_limit_ms'),
    memoryLimitKb: integer('memory_limit_kb'),

    scrapedAt: timestamp('scraped_at', { withTimezone: true }).notNull().defaultNow(),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_scraped_problems_platform_ext').on(table.platform, table.externalId),
  ]
);

// ═══════════════════════════════════════════════════════════════════════════════
// TABLE: problem_embeddings
// ═══════════════════════════════════════════════════════════════════════════════
// Embeds the problem statement + editorial for "find similar problems."

export const problemEmbeddings = pgTable(
  'problem_embeddings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    problemId: uuid('problem_id')
      .notNull()
      .references(() => scrapedProblems.id, { onDelete: 'cascade' }),
    /** 'statement' | 'editorial' | 'constraints' */
    chunkType: text('chunk_type').notNull(),
    content: text('content').notNull(),
    embedding: vector(EMBEDDING_DIM)('embedding').notNull(),
    /**
     * Which embedding model produced this vector.
     * Stored so we know which rows to re-embed when migrating models.
     * Default: 'text-embedding-004' (Google, 768 dims).
     */
    embeddingModel: text('embedding_model').notNull().default('text-embedding-004'),
  },
  (table) => [
    index('idx_problem_embeddings_hnsw').using(
      'hnsw',
      table.embedding.op('vector_cosine_ops')
    ),
    index('idx_problem_embeddings_problem_chunk').on(table.problemId, table.chunkType),
    index('idx_problem_embeddings_model').on(table.embeddingModel),
  ]
);

// ═══════════════════════════════════════════════════════════════════════════════
// TABLE: concept_topics
// ═══════════════════════════════════════════════════════════════════════════════
// The Knowledge Graph nodes. Each row = an algorithmic concept or technique.
// Seeded on first deploy, extended as problems are scraped and tagged.

export const conceptTopics = pgTable('concept_topics', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** e.g. 'two_pointers', 'dynamic_programming', 'binary_search' */
  slug: text('slug').notNull().unique(),
  /** Human-readable name: 'Two Pointers', 'Dynamic Programming' */
  displayName: text('display_name').notNull(),
  /** 'technique' | 'data_structure' | 'paradigm' | 'math' */
  category: text('category').notNull(),
  /** Optional description for the user-facing knowledge graph UI. */
  description: text('description'),
  /**
   * Estimated difficulty level of this topic (1–10).
   * Used to order prerequisite chains and gate recommendations.
   * 1 = Sorting, 10 = Suffix Arrays / Matrix Exponentiation.
   */
  difficultyLevel: integer('difficulty_level').notNull().default(1),
});

// ═══════════════════════════════════════════════════════════════════════════════
// TABLE: topic_prerequisites
// ═══════════════════════════════════════════════════════════════════════════════
// Directed prerequisite graph: (topic) → requires → (prerequisite).
// Example: Segment Tree requires Binary Search + Recursion.
//
// This is a join table rather than a JSONB column so Drizzle can:
//   - Join across it with typed queries
//   - Enforce FK integrity on both sides
//   - Index prerequisite lookups efficiently

export const topicPrerequisites = pgTable(
  'topic_prerequisites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The advanced topic that has this prerequisite. */
    topicId: uuid('topic_id')
      .notNull()
      .references(() => conceptTopics.id, { onDelete: 'cascade' }),
    /** The prerequisite topic that must be learned first. */
    prerequisiteId: uuid('prerequisite_id')
      .notNull()
      .references(() => conceptTopics.id, { onDelete: 'cascade' }),
    /**
     * How critical this prerequisite is (0.0–1.0).
     * 1.0 = hard dependency (cannot proceed without it).
     * 0.5 = helpful but not strictly required.
     */
    strength: real('strength').notNull().default(1.0),
  },
  (table) => [
    uniqueIndex('uq_topic_prerequisites').on(table.topicId, table.prerequisiteId),
    index('idx_topic_prerequisites_topic').on(table.topicId),
    index('idx_topic_prerequisites_prereq').on(table.prerequisiteId),
  ]
);

// ═══════════════════════════════════════════════════════════════════════════════
// TABLE: problem_topics
// ═══════════════════════════════════════════════════════════════════════════════
// Many-to-many link between scraped problems and concept topics.
// Populated when a problem is scraped (from its tags) or inferred by the AI.

export const problemTopics = pgTable(
  'problem_topics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    problemId: uuid('problem_id')
      .notNull()
      .references(() => scrapedProblems.id, { onDelete: 'cascade' }),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => conceptTopics.id, { onDelete: 'cascade' }),
    /**
     * How strongly this problem tests this topic (0.0–1.0).
     * 1.0 = primary topic (e.g., "Two Sum" → hash_map).
     * 0.3 = secondary (e.g., "Two Sum" → array).
     */
    weight: real('weight').notNull().default(1.0),
  },
  (table) => [
    uniqueIndex('uq_problem_topics').on(table.problemId, table.topicId),
    index('idx_problem_topics_topic').on(table.topicId),
  ]
);

// ═══════════════════════════════════════════════════════════════════════════════
// TABLE: user_topic_mastery
// ═══════════════════════════════════════════════════════════════════════════════
// Per-user per-topic mastery score. Updated after each coding session.
//
// Mastery calculation:
//   solved independently (0 hints) → score UP significantly
//   solved with 1–2 hints          → score UP slightly
//   solved with 3+ hints           → score stays flat
//   abandoned / unsolved            → score DOWN
//
// This drives all three recommendation modes:
//   - Targeted Practice:   mastery_score < 0.4
//   - Momentum:            last_practiced recently AND mastery 0.4–0.8
//   - Spaced Repetition:   mastery > 0.7 AND last_practiced > 14 days ago

export const userTopicMastery = pgTable(
  'user_topic_mastery',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => conceptTopics.id, { onDelete: 'cascade' }),
    /** 0.0 = no mastery, 1.0 = fully mastered. */
    masteryScore: real('mastery_score').notNull().default(0.0),
    /** Total sessions where this topic appeared. */
    sessionsAttempted: integer('sessions_attempted').notNull().default(0),
    /** Sessions solved with ZERO hints from the AI. */
    sessionsSolvedIndependently: integer('sessions_solved_independently').notNull().default(0),
    /** Sessions solved (with or without hints). */
    sessionsSolvedTotal: integer('sessions_solved_total').notNull().default(0),
    /** Total hints received across all sessions for this topic. */
    totalHintsReceived: integer('total_hints_received').notNull().default(0),
    /** When this topic was first practiced. Used for "momentum" recommendations. */
    firstLearnedAt: timestamp('first_learned_at', { withTimezone: true }),
    /** When this topic was last practiced. Used for "spaced repetition." */
    lastPracticedAt: timestamp('last_practiced_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_user_topic_mastery').on(table.userId, table.topicId),
    // Targeted Practice query: low mastery topics for a user.
    index('idx_user_topic_mastery_score').on(table.userId, table.masteryScore),
    // Spaced Repetition query: mastered but stale topics.
    index('idx_user_topic_mastery_last_practiced').on(table.userId, table.lastPracticedAt),
  ]
);

// ═══════════════════════════════════════════════════════════════════════════════
// TABLE: coding_sessions
// ═══════════════════════════════════════════════════════════════════════════════

export const codingSessions = pgTable(
  'coding_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Links to the scraped problem. SET NULL if problem is purged from cache. */
    problemId: uuid('problem_id').references(() => scrapedProblems.id, {
      onDelete: 'set null',
    }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    /** 'active' | 'solved' | 'abandoned' */
    status: text('status').notNull().default('active'),

    /** Snapshot of the user's latest code in this session. */
    currentCode: text('current_code').notNull().default(''),
    currentLanguage: text('current_language').notNull().default('cpp'),

    /** Last measured by the Code Analysis Engine (CFG + Tree-sitter). */
    detectedComplexity: text('detected_complexity'),
    detectedLevel: text('detected_level'),

    hintsGiven: integer('hints_given').notNull().default(0),
    solvedWithoutHints: boolean('solved_without_hints').notNull().default(false),
  },
  (table) => [
    index('idx_coding_sessions_user_time').on(table.userId, table.startedAt),
    index('idx_coding_sessions_user_status').on(table.userId, table.status),
  ]
);

// ═══════════════════════════════════════════════════════════════════════════════
// TABLE: session_hints
// ═══════════════════════════════════════════════════════════════════════════════
// Every hint ever given, with a code snapshot at that moment.
// Prevents giving the same nudge twice. Records which RAG memories were used.

export const sessionHints = pgTable(
  'session_hints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => codingSessions.id, { onDelete: 'cascade' }),
    /** Denormalized — avoids join for "all hints for user X." */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 1st, 2nd, 3rd hint in this session. */
    sequenceNumber: integer('sequence_number').notNull(),

    hintText: text('hint_text').notNull(),
    /**
     * 'complexity_question'  — "What's your current time complexity?"
     * 'direction_nudge'      — "Have you considered a hash map?"
     * 'socratic_question'    — "What happens when the array is sorted?"
     * 'edge_case_probe'      — "What if n = 0?"
     * 'pattern_recognition'  — "Remember how you solved problem X? Same pattern."
     * 'style_suggestion'     — Style feedback only, not algorithmic.
     */
    hintType: text('hint_type').notNull(),

    /** User's code at the exact moment this hint was generated. */
    codeSnapshot: text('code_snapshot').notNull(),
    /** What the CFG engine detected at hint time. e.g., 'O(n²)' */
    complexityAtTime: text('complexity_at_time'),
    /** e.g., 'brute_force' */
    levelAtTime: text('level_at_time'),

    /** IDs from submission_embeddings that RAG retrieved for this hint. */
    ragSubmissionIds: jsonb('rag_submission_ids').$type<RagSubmissionIds>(),

    /** User feedback. NULL = no feedback given yet. */
    wasHelpful: boolean('was_helpful'),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_session_hints_seq').on(table.sessionId, table.sequenceNumber),
    index('idx_session_hints_session').on(table.sessionId),
    index('idx_session_hints_user_time').on(table.userId, table.generatedAt),
  ]
);

// ═══════════════════════════════════════════════════════════════════════════════
// TABLE: learning_events
// ═══════════════════════════════════════════════════════════════════════════════
// Append-only Learning Timeline. Records every significant domain event:
//   - PROBLEM_ATTEMPTED: solved/abandoned + elo delta
//   - CONCEPT_MASTERY_CHANGED: mastery went up/down after a session
//   - REVIEW_DUE: spaced repetition trigger
//   - STYLE_EVOLVED: coding style stage changed
//   - REFLECTION_GENERATED: post-session AI reflection was produced
//
// The `payload` JSONB stores the full discriminated union from the domain
// LearningEvent type. The `type` column is a discriminator index column
// so queries like "give me all PROBLEM_ATTEMPTED events for user X" are fast.

/** Payload type for the learning_events JSONB column. */
interface LearningEventPayload {
  /** Discriminator — matches LearningEvent['type'] */
  type: string;
  [key: string]: unknown;
}

export const learningEvents = pgTable(
  'learning_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * Discriminator column — mirrors LearningEvent['type'].
     * Values: 'PROBLEM_ATTEMPTED' | 'CONCEPT_MASTERY_CHANGED' |
     *         'REVIEW_DUE' | 'STYLE_EVOLVED' | 'REFLECTION_GENERATED'
     */
    type: text('type').notNull(),
    /** Full event payload serialised as JSONB. */
    payload: jsonb('payload').$type<LearningEventPayload>().notNull(),
    /** When the event occurred in the domain (may differ from insert time). */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    /** Wall-clock insert time — used for ordering within the same second. */
    insertedAt: timestamp('inserted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_learning_events_user_time').on(table.userId, table.occurredAt),
    index('idx_learning_events_user_type').on(table.userId, table.type),
  ]
);

// ═══════════════════════════════════════════════════════════════════════════════
// RELATIONS (Drizzle ORM query builder)
// ═══════════════════════════════════════════════════════════════════════════════

export const usersRelations = relations(users, ({ many }) => ({
  linkedProfiles: many(linkedProfiles),
  submissions: many(userSubmissions),
  sessions: many(codingSessions),
  topicMastery: many(userTopicMastery),
  hints: many(sessionHints),
  learningEvents: many(learningEvents),
}));

export const linkedProfilesRelations = relations(linkedProfiles, ({ one, many }) => ({
  user: one(users, { fields: [linkedProfiles.userId], references: [users.id] }),
  submissions: many(userSubmissions),
}));

export const userSubmissionsRelations = relations(userSubmissions, ({ one, many }) => ({
  user: one(users, { fields: [userSubmissions.userId], references: [users.id] }),
  profile: one(linkedProfiles, {
    fields: [userSubmissions.profileId],
    references: [linkedProfiles.id],
  }),
  embeddings: many(submissionEmbeddings),
}));

export const submissionEmbeddingsRelations = relations(submissionEmbeddings, ({ one }) => ({
  submission: one(userSubmissions, {
    fields: [submissionEmbeddings.submissionId],
    references: [userSubmissions.id],
  }),
  user: one(users, {
    fields: [submissionEmbeddings.userId],
    references: [users.id],
  }),
}));

export const scrapedProblemsRelations = relations(scrapedProblems, ({ many }) => ({
  embeddings: many(problemEmbeddings),
  sessions: many(codingSessions),
  topics: many(problemTopics),
}));

export const problemEmbeddingsRelations = relations(problemEmbeddings, ({ one }) => ({
  problem: one(scrapedProblems, {
    fields: [problemEmbeddings.problemId],
    references: [scrapedProblems.id],
  }),
}));

export const conceptTopicsRelations = relations(conceptTopics, ({ many }) => ({
  problems: many(problemTopics),
  userMastery: many(userTopicMastery),
  // Prerequisite graph: topics this node requires
  prerequisites: many(topicPrerequisites, { relationName: 'topic_requires' }),
  // Prerequisite graph: topics that require this node
  dependents: many(topicPrerequisites, { relationName: 'topic_is_prereq_for' }),
}));

/** Relations for the directed prerequisite join table. */
export const topicPrerequisitesRelations = relations(topicPrerequisites, ({ one }) => ({
  topic: one(conceptTopics, {
    fields: [topicPrerequisites.topicId],
    references: [conceptTopics.id],
    relationName: 'topic_requires',
  }),
  prerequisite: one(conceptTopics, {
    fields: [topicPrerequisites.prerequisiteId],
    references: [conceptTopics.id],
    relationName: 'topic_is_prereq_for',
  }),
}));

export const problemTopicsRelations = relations(problemTopics, ({ one }) => ({
  problem: one(scrapedProblems, {
    fields: [problemTopics.problemId],
    references: [scrapedProblems.id],
  }),
  topic: one(conceptTopics, {
    fields: [problemTopics.topicId],
    references: [conceptTopics.id],
  }),
}));

export const userTopicMasteryRelations = relations(userTopicMastery, ({ one }) => ({
  user: one(users, {
    fields: [userTopicMastery.userId],
    references: [users.id],
  }),
  topic: one(conceptTopics, {
    fields: [userTopicMastery.topicId],
    references: [conceptTopics.id],
  }),
}));

export const codingSessionsRelations = relations(codingSessions, ({ one, many }) => ({
  user: one(users, { fields: [codingSessions.userId], references: [users.id] }),
  problem: one(scrapedProblems, {
    fields: [codingSessions.problemId],
    references: [scrapedProblems.id],
  }),
  hints: many(sessionHints),
}));

export const sessionHintsRelations = relations(sessionHints, ({ one }) => ({
  session: one(codingSessions, {
    fields: [sessionHints.sessionId],
    references: [codingSessions.id],
  }),
  user: one(users, {
    fields: [sessionHints.userId],
    references: [users.id],
  }),
}));

export const learningEventsRelations = relations(learningEvents, ({ one }) => ({
  user: one(users, {
    fields: [learningEvents.userId],
    references: [users.id],
  }),
}));
