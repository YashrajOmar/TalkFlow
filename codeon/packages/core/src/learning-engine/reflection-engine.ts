/**
 * Reflection Engine — generates structured post-session reflections.
 *
 * After every solved problem (or on explicit request), the Reflection Engine
 * assembles a structured summary of what happened in the session.
 *
 * This summary is both:
 *   1. Shown to the student as a learning card
 *   2. Persisted as a LearningEvent that feeds the Recommendation Engine
 *
 * The engine itself is pure — it only computes; the Teaching Engine uses
 * its output to render a human-readable reflection via the LLM.
 */

import type { AlgorithmicLevel, ConceptId } from '../entities/common.js';
import type { CodingSession, Hint } from '../entities/session.js';

export interface SessionSummary {
  readonly sessionDurationMinutes: number;
  readonly totalSubmissions: number;
  readonly totalHints: number;
  readonly hintTypes: string[];
  readonly finalAlgorithmicLevel: AlgorithmicLevel | null;
  readonly optimizationStepsAdvanced: number;   // How many trail steps did student advance?
  readonly conceptsEncountered: ConceptId[];
  readonly mistakeCategories: string[];
  readonly solvedSuccessfully: boolean;
}

export interface ReflectionData {
  readonly sessionSummary: SessionSummary;
  readonly improvements: string[];              // What got better this session
  readonly persistentWeaknesses: string[];      // What still needs work
  readonly conceptsIntroduced: ConceptId[];     // New concepts encountered
  readonly conceptsReinforced: ConceptId[];     // Previously known, practiced again
  readonly optimizationAchieved: string | null; // e.g., "O(n²) → O(n log n)"
  readonly styleFeedback: string | null;         // Style improvement observed
  readonly recommendedNextActions: string[];     // Specific action items
  readonly eloDelta: number;                    // Elo change this session
  readonly newGlobalElo: number;
}

/**
 * Compute a session summary from raw session data.
 * Pure function — no I/O.
 */
export function computeSessionSummary(session: CodingSession): SessionSummary {
  const hintTypes = [...new Set(session.hints.map((h: Hint) => h.hintType))];

  const algorithmicLevels = session.submissions
    .map((s) => s.algorithmicLevel)
    .filter((l): l is AlgorithmicLevel => l !== null);

  const finalLevel =
    algorithmicLevels.length > 0
      ? algorithmicLevels[algorithmicLevels.length - 1] ?? null
      : null;

  // Count optimization steps advanced (simplified — Trail Engine provides detailed data)
  const uniqueLevels = new Set(algorithmicLevels);
  const optimizationStepsAdvanced = Math.max(0, uniqueLevels.size - 1);

  const durationMinutes = session.durationMinutes ?? 0;

  return {
    sessionDurationMinutes: durationMinutes,
    totalSubmissions: session.submissions.length,
    totalHints: session.hints.length,
    hintTypes,
    finalAlgorithmicLevel: finalLevel,
    optimizationStepsAdvanced,
    conceptsEncountered: [],   // Populated by Trail Engine context
    mistakeCategories: [],     // Populated by Mistake Tracker context
    solvedSuccessfully: session.solved,
  };
}

/**\n * Build a structured ReflectionData from session + external context.\n * Called after the session ends; requires Elo update already computed.\n */\nexport function buildReflectionData(\n  session: CodingSession,\n  context: {\n    eloDelta: number;\n    newGlobalElo: number;\n    conceptsIntroduced: ConceptId[];\n    conceptsReinforced: ConceptId[];\n    persistentMistakeCategories: string[];\n    styleImprovement: string | null;\n  }\n): ReflectionData {\n  const summary = computeSessionSummary(session);\n\n  const improvements: string[] = [];\n\n  if (summary.optimizationStepsAdvanced > 0) {\n    improvements.push(\n      `Advanced ${summary.optimizationStepsAdvanced} optimization step(s) toward the optimal solution.`\n    );\n  }\n  if (context.eloDelta > 0) {\n    improvements.push(`Elo increased by ${Math.round(context.eloDelta)} points.`);\n  }\n  if (context.conceptsIntroduced.length > 0) {\n    improvements.push(`Encountered ${context.conceptsIntroduced.length} new concept(s).`);\n  }\n  if (context.styleImprovement) {\n    improvements.push(context.styleImprovement);\n  }\n\n  const optimizationAchieved =\n    summary.finalAlgorithmicLevel && summary.optimizationStepsAdvanced > 0\n      ? `Improved from initial approach to ${summary.finalAlgorithmicLevel}`\n      : null;\n\n  const recommendedNextActions: string[] = [];\n  if (context.persistentMistakeCategories.includes('integer_overflow')) {\n    recommendedNextActions.push('Practice: Review integer overflow — use long long for large n.');\n  }\n  if (context.persistentMistakeCategories.includes('edge_case_missed')) {\n    recommendedNextActions.push('Practice: Always check n=0, n=1, empty input before submitting.');\n  }\n  if (!session.solved) {\n    recommendedNextActions.push('Re-attempt this problem after reviewing the required concepts.');\n  }\n\n  return {\n    sessionSummary: summary,\n    improvements,\n    persistentWeaknesses: context.persistentMistakeCategories.slice(0, 3),\n    conceptsIntroduced: context.conceptsIntroduced,\n    conceptsReinforced: context.conceptsReinforced,\n    optimizationAchieved,\n    styleFeedback: context.styleImprovement,\n    recommendedNextActions,\n    eloDelta: context.eloDelta,\n    newGlobalElo: context.newGlobalElo,\n  };\n}\n
