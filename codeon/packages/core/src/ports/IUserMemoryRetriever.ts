import type { UserId, ConceptId, TeachingStyle } from '../entities/common.js';

/**
 * A semantic record of a mistake the student made.
 */
export interface MistakeRecord {
  readonly id: string;
  readonly userId: UserId;
  readonly conceptId: ConceptId | null;
  readonly description: string;
  readonly codeSnippet: string;      // The problematic code
  readonly correction: string;       // What the fix was
  readonly frequency: number;        // How many times this pattern appeared
  readonly lastOccurredAt: Date;
  readonly isResolved: boolean;
}

/**
 * A strategy that previously worked for this student.
 */
export interface SuccessfulStrategy {
  readonly id: string;
  readonly userId: UserId;
  readonly description: string;     // e.g., "Drawing the graph on paper first"
  readonly context: string;         // What kind of problem this helped with
  readonly usedCount: number;
}

/**
 * An explanation style that the student responded positively to.
 */
export interface ExplanationRecord {
  readonly id: string;
  readonly userId: UserId;
  readonly teachingStyle: TeachingStyle;
  readonly exampleHint: string;
  readonly wasHelpful: boolean;
  readonly conceptId: ConceptId | null;
}

export interface UserMemorySearchOptions {
  readonly userId: UserId;
  readonly limit?: number;
  readonly conceptIds?: ConceptId[];
}

/**
 * RAG #1 — User Memory retrieval port.
 *
 * Purpose: Understand WHO the student is.
 * Surfaces past mistakes, successful strategies, and preferred explanations.
 * Used by the Prompt Builder to construct personalized UserContext.
 *
 * Implementation: pgvector semantic search over user-specific memory vectors.
 */
export interface IUserMemoryRetriever {
  /**
   * Find past mistakes semantically similar to the current code/context.
   */
  findSimilarMistakes(
    query: string,
    options: UserMemorySearchOptions
  ): Promise<MistakeRecord[]>;

  /**
   * Find strategies that previously helped this student.
   */
  findSuccessfulStrategies(
    context: string,
    options: UserMemorySearchOptions
  ): Promise<SuccessfulStrategy[]>;

  /**
   * Find explanation records matching a teaching style preference.
   */
  findEffectiveExplanations(
    teachingStyle: TeachingStyle,
    options: UserMemorySearchOptions
  ): Promise<ExplanationRecord[]>;

  /**
   * Save a new mistake to the user's memory.
   */
  saveMistake(mistake: Omit<MistakeRecord, 'id'>): Promise<MistakeRecord>;

  /**
   * Save a successful strategy.
   */
  saveSuccessfulStrategy(strategy: Omit<SuccessfulStrategy, 'id'>): Promise<SuccessfulStrategy>;

  /**
   * Save an explanation effectiveness record.
   */
  saveExplanationRecord(record: Omit<ExplanationRecord, 'id'>): Promise<ExplanationRecord>;

  /**
   * Mark a recurring mistake as resolved.
   */
  resolveMistake(mistakeId: string, userId: UserId): Promise<void>;
}
