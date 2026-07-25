import type { ConceptId, DifficultyTier, Language, ProblemId, ProblemSource } from './common.js';

/**
 * A single test case that can be run against user code in the execution sandbox.
 */
export interface TestCase {
  readonly id: string;
  readonly input: string;
  readonly expectedOutput: string;
  readonly isHidden: boolean;    // Hidden test cases not shown to student
  readonly isSample: boolean;   // Sample cases shown in the problem statement
  readonly notes?: string;       // Edge case description
}

/**
 * Complexity bound at a specific algorithmic level.
 */
export interface ComplexityBound {
  readonly time: string;    // e.g., 'O(n log n)'
  readonly space: string;   // e.g., 'O(n)'
  readonly explanation: string;
}

/**
 * A verified accepted solution for a problem.
 */
export interface Solution {
  readonly language: Language;
  readonly code: string;
  readonly algorithmicLevel: string;
  readonly complexity: ComplexityBound;
  readonly isOptimal: boolean;
  readonly explanation: string;
}

/**
 * The editorial for a problem — retrieved from the knowledge base, never from LLM.
 */
export interface Editorial {
  readonly problemId: ProblemId;
  readonly summary: string;
  readonly approachDescription: string;
  readonly keyInsight: string;       // The "aha" moment
  readonly pitfalls: string[];       // Common wrong approaches
  readonly complexity: ComplexityBound;
  readonly solutions: Solution[];    // Multiple complexity tiers
}

/**
 * The optimization trail — ordered steps from naive to optimal.
 * Generated from editorial data, not from LLM inference.
 */
export interface OptimizationStep {
  readonly level: string;
  readonly description: string;
  readonly complexity: ComplexityBound;
  readonly requiredConceptIds: ConceptId[];
  readonly socrticHintToReach: string; // Hint to guide student to this step
}

export interface OptimizationTrail {
  readonly problemId: ProblemId;
  readonly steps: OptimizationStep[];  // Ordered from naive to optimal
}

/**
 * Full problem entity — the canonical representation of a programming problem.
 */
export interface Problem {
  readonly id: ProblemId;
  readonly externalId: string;          // e.g., LeetCode #1, CF 1234A
  readonly source: ProblemSource;
  readonly title: string;
  readonly slug: string;                // URL-friendly identifier
  readonly statement: string;           // Full problem statement
  readonly constraints: string[];       // Formatted constraint list
  readonly inputFormat: string;
  readonly outputFormat: string;
  readonly examples: TestCase[];        // Sample test cases
  readonly hiddenTestCases: TestCase[]; // Judge test cases
  readonly difficultyTier: DifficultyTier;
  readonly codeforcesRating?: number;   // Raw CF rating if applicable
  readonly requiredConceptIds: ConceptId[]; // Concepts needed to solve
  readonly relatedProblemIds: ProblemId[];  // Similar problems
  readonly editorial: Editorial;
  readonly optimizationTrail: OptimizationTrail;
  readonly tags: string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
