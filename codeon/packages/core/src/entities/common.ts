/**
 * Branded primitive types for type-safe IDs.
 * Using branded types prevents accidentally passing a SessionId where a UserId is expected.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

export type UserId = Brand<string, 'UserId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type ProblemId = Brand<string, 'ProblemId'>;
export type ConceptId = Brand<string, 'ConceptId'>;
export type HintId = Brand<string, 'HintId'>;
export type EventId = Brand<string, 'EventId'>;
export type EmbeddingId = Brand<string, 'EmbeddingId'>;

export function makeUserId(id: string): UserId {
  return id as UserId;
}
export function makeSessionId(id: string): SessionId {
  return id as SessionId;
}
export function makeProblemId(id: string): ProblemId {
  return id as ProblemId;
}
export function makeConceptId(id: string): ConceptId {
  return id as ConceptId;
}
export function makeHintId(id: string): HintId {
  return id as HintId;
}

/**
 * Supported programming languages for code analysis and execution.
 */
export type Language =
  | 'cpp'
  | 'cpp17'
  | 'cpp20'
  | 'c'
  | 'java'
  | 'python3'
  | 'javascript'
  | 'typescript'
  | 'go'
  | 'rust'
  | 'kotlin'
  | 'swift';

/**
 * Competitive programming / interview-focused platform sources.
 */
export type ProblemSource =
  | 'leetcode'
  | 'codeforces'
  | 'atcoder'
  | 'codechef'
  | 'hackerrank'
  | 'custom';

/**
 * Session operating modes. Each triggers a completely different pipeline.
 */
export type SessionMode =
  | 'problem'     // Known problem — full RAG + Trail Engine
  | 'scratchpad'  // No known answer — experienced engineer mode
  | 'interview'   // Google-interviewer persona; hints only on explicit request
  | 'contest';    // Teaching Engine gated; post-contest analysis only

/**
 * Difficulty tiers aligned to Codeforces rating bands.
 */
export type DifficultyTier =
  | 'beginner'    // < 800
  | 'easy'        // 800–1200
  | 'medium'      // 1200–1600
  | 'hard'        // 1600–2000
  | 'expert'      // 2000–2400
  | 'grandmaster'; // > 2400

/**
 * Concept categories in the knowledge graph.
 */
export type ConceptCategory =
  | 'data_structure'
  | 'algorithm'
  | 'paradigm'
  | 'language_feature'
  | 'system_design'
  | 'math'
  | 'bit_manipulation'
  | 'string_processing';

/**
 * Teaching strategies that the system can adapt to.
 */
export type TeachingStyle =
  | 'analogy'           // Explain via real-world comparisons
  | 'proof_based'       // Formal correctness reasoning
  | 'visual'            // Diagrams, step-by-step traces
  | 'counterexample'    // Disprove wrong assumptions
  | 'step_by_step'      // Guided incremental steps
  | 'minimal_hints'     // Minimal nudges, student discovers
  | 'socratic';         // Pure question-based dialogue

/**
 * Algorithmic levels used in the Native Optimization Trail.
 */
export type AlgorithmicLevel =
  | 'brute_force'
  | 'naive_optimized'
  | 'sorting'
  | 'two_pointer'
  | 'binary_search'
  | 'hash_map'
  | 'prefix_sum'
  | 'sliding_window'
  | 'greedy'
  | 'divide_and_conquer'
  | 'dynamic_programming'
  | 'graph_traversal'
  | 'advanced_data_structure'
  | 'mathematical'
  | 'optimal';

/**
 * Code style evolution stages — progression is always forward, never jumps.
 */
export type StyleStage =
  | 'naive'              // int a, b, c; no structure
  | 'descriptive'        // int left, right; meaningful names
  | 'structured'         // helper functions, clear separation
  | 'modern'             // constexpr, auto, range-for
  | 'idiomatic'          // std::ranges, structured bindings
  | 'interview_quality'  // clean, readable, commented
  | 'production_quality'; // well-abstracted, testable

/**
 * Verdict types returned by the execution sandbox.
 */
export type ExecutionVerdict =
  | 'AC'   // Accepted
  | 'WA'   // Wrong Answer
  | 'TLE'  // Time Limit Exceeded
  | 'MLE'  // Memory Limit Exceeded
  | 'RE'   // Runtime Error
  | 'CE'   // Compilation Error
  | 'PENDING'; // Async — result not yet available
