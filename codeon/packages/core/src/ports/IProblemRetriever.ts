import type { ConceptId, DifficultyTier, Language, ProblemId, ProblemSource } from '../entities/common.js';
import type { Problem, Editorial, Solution } from '../entities/problem.js';

export interface ProblemSearchOptions {
  readonly source?: ProblemSource;
  readonly language?: Language;
  readonly difficultyTier?: DifficultyTier;
  readonly conceptIds?: ConceptId[];
  readonly tags?: string[];
  readonly limit?: number;
}

/**
 * RAG #2 — Problem Knowledge Base retrieval port.
 *
 * Purpose: Understand WHAT problem is being solved.
 * Only retrieves verified data — never generates or infers.
 *
 * Implementation: pgvector semantic search + relational joins.
 */
export interface IProblemRetriever {
  /**
   * Fetch the full problem entity by its canonical ID.
   */
  fetchProblem(problemId: ProblemId): Promise<Problem | null>;

  /**
   * Fetch the verified editorial for a problem.
   * Returns null if no editorial has been indexed for this problem.
   */
  fetchEditorial(problemId: ProblemId): Promise<Editorial | null>;

  /**
   * Fetch accepted solutions, optionally filtered by language or optimality.
   */
  fetchSolutions(
    problemId: ProblemId,
    options?: { language?: Language; optimalOnly?: boolean }
  ): Promise<Solution[]>;

  /**
   * Semantic search: find problems similar to a given problem.
   * Used by the Recommendation Engine to find related practice.
   */
  findSimilarProblems(
    problemId: ProblemId,
    options?: ProblemSearchOptions
  ): Promise<Problem[]>;

  /**
   * Search problems by text query (semantic vector search).
   */
  searchProblems(query: string, options?: ProblemSearchOptions): Promise<Problem[]>;

  /**
   * Retrieve problems that specifically require the given concept IDs.
   */
  findProblemsByConceptIds(conceptIds: ConceptId[], options?: ProblemSearchOptions): Promise<Problem[]>;
}
