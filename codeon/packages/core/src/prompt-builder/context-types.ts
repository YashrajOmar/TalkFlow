/**
 * Shared types used by the Prompt Builder contexts.
 * These are simplified views of domain entities for prompt construction.
 */

export interface ProblemStatement {
  readonly title: string;
  readonly statement: string;
  readonly constraints: string[];
  readonly inputFormat: string;
  readonly outputFormat: string;
  readonly examples: Array<{ input: string; output: string }>;
}

export interface EditorialSummary {
  readonly keyInsight: string;
  readonly approachOverview: string;  // High-level approach description, no code
  readonly pitfalls: string[];
  readonly optimalComplexity: string;
}
