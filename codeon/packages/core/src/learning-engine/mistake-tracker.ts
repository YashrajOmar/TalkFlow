/**
 * Mistake Tracker — identifies, categorizes, and surfaces repeating mistake patterns.
 *
 * A "mistake" is more than a wrong answer. It is a categorized failure pattern
 * that persists across sessions and is used to:
 *   1. Personalize hints ("You've made this same off-by-one error 3 times")
 *   2. Build the UserContext for the Prompt Builder
 *   3. Feed the Recommendation Engine
 */

import type { ConceptId } from '../entities/common.js';

export type MistakeCategory =
  | 'off_by_one'
  | 'integer_overflow'
  | 'null_pointer'
  | 'wrong_data_structure'
  | 'incorrect_complexity_analysis'
  | 'edge_case_missed'
  | 'wrong_algorithm_choice'
  | 'infinite_loop'
  | 'incorrect_base_case'
  | 'modular_arithmetic'
  | 'premature_optimization'
  | 'incorrect_sorting'
  | 'uninitialized_variable'
  | 'out_of_bounds'
  | 'graph_direction'          // Treating undirected as directed or vice versa
  | 'dp_state_definition'      // Incorrectly defining DP state
  | 'greedy_not_applicable'    // Applying greedy when it doesn't hold
  | 'other';

export interface MistakePattern {
  readonly category: MistakeCategory;
  readonly relatedConceptId: ConceptId | null;
  readonly description: string;           // e.g., "Using int instead of long long for n*n"
  readonly codeSnippetExample: string;    // Anonymized snippet showing the pattern
  readonly frequency: number;             // Times this pattern appeared
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
  readonly isResolved: boolean;           // Has the student stopped making this mistake?
}

export interface MistakeAnalysisInput {
  readonly code: string;
  readonly language: string;
  readonly errorMessage?: string;         // Compiler error or runtime error output
  readonly executionVerdict?: string;     // 'WA', 'RE', 'TLE', etc.
  readonly failingTestInput?: string;
  readonly failingTestExpected?: string;
  readonly failingTestActual?: string;
}

export interface MistakeAnalysisResult {
  readonly detectedCategories: MistakeCategory[];
  readonly severity: 'minor' | 'moderate' | 'critical';
  readonly explanation: string;
  readonly relatedConceptIds: ConceptId[];
}

/**
 * Heuristic-based mistake detection from static information.
 * This runs BEFORE the AI — it catches common patterns deterministically.
 * The AI then refines and contextualizes these findings.
 */
export function analyzeMistakeHeuristics(
  input: MistakeAnalysisInput
): MistakeAnalysisResult {
  const categories: MistakeCategory[] = [];
  const conceptIds: ConceptId[] = [];

  const { code, errorMessage, executionVerdict, failingTestInput } = input;

  // Integer overflow detection
  if (
    code.includes('int') &&
    !code.includes('long long') &&
    !code.includes('int64_t') &&
    /\b[0-9]{9,}\b/.test(code)
  ) {
    categories.push('integer_overflow');
  }

  // Off-by-one detection: common patterns
  if (
    /for\s*\(.*;\s*\w+\s*<=\s*\w+\.size\(\)/.test(code) ||
    /for\s*\(.*;\s*\w+\s*<\s*\w+\.size\(\)\s*\+\s*1/.test(code)
  ) {
    categories.push('off_by_one');
  }

  // Uninitialized variable (simple heuristic for C++)
  if (/int\s+\w+\s*;(?!\s*=)/.test(code) && executionVerdict === 'RE') {
    categories.push('uninitialized_variable');
  }

  // TLE with O(n^2) pattern (nested loops over large n)
  if (executionVerdict === 'TLE' && /for.*for/.test(code)) {
    categories.push('incorrect_complexity_analysis');
  }

  // Wrong answer with edge case
  if (executionVerdict === 'WA' && failingTestInput) {
    const n = parseInt(failingTestInput.split('\n')[0] ?? '0');
    if (n === 0 || n === 1) {
      categories.push('edge_case_missed');
    }
  }

  // Modular arithmetic: forgot to mod
  if (
    code.includes('MOD') &&
    !code.includes('% MOD') &&
    executionVerdict === 'WA'
  ) {
    categories.push('modular_arithmetic');
  }

  const severity =
    categories.length === 0
      ? 'minor'
      : categories.includes('integer_overflow') ||
        categories.includes('off_by_one') ||
        categories.includes('incorrect_complexity_analysis')
      ? 'critical'
      : 'moderate';

  return {
    detectedCategories: categories.length > 0 ? categories : ['other'],
    severity,
    explanation:
      categories.length > 0
        ? `Detected potential issues: ${categories.join(', ')}`
        : 'No specific pattern detected. AI analysis recommended.',
    relatedConceptIds: conceptIds,
  };
}

/**
 * Determine if a mistake pattern qualifies as "resolved".
 * A mistake is resolved when it hasn't appeared in the last N sessions.
 */
export function isMistakeResolved(
  pattern: MistakePattern,
  recentSessionCount: number,
  windowSize = 5
): boolean {
  if (pattern.frequency <= 1) return false;
  // Check if the mistake appeared in the most recent window
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - windowSize * 2); // Rough heuristic
  return pattern.lastSeenAt < windowStart;
}

/**
 * Rank mistakes by urgency.
 * Critical recurring mistakes should be surfaced first.
 */
export function rankMistakesByUrgency(
  patterns: MistakePattern[]
): MistakePattern[] {
  return [...patterns]
    .filter((p) => !p.isResolved)
    .sort((a, b) => {
      // Frequent and recent mistakes first
      const recencyA = new Date().getTime() - a.lastSeenAt.getTime();
      const recencyB = new Date().getTime() - b.lastSeenAt.getTime();
      const scoreA = b.frequency * 1000 - recencyA / 86400000; // frequency * 1000 - days ago
      const scoreB = a.frequency * 1000 - recencyB / 86400000;
      return scoreB - scoreA;
    });
}
