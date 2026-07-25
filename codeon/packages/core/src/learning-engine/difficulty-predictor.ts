/**
 * Difficulty Predictor — estimates Expected Success Rate for a problem.
 *
 * Instead of raw difficulty labels, the system computes:
 *   Expected Success Rate (0.0–1.0) for THIS student on THIS problem.
 *
 * Uses:
 *   - Student's concept mastery vs. required concepts
 *   - Forgetting probability for relevant concepts
 *   - Student's Elo vs. problem's estimated difficulty Elo
 *   - Historical performance on similar problem types
 */

import type { ConceptId } from '../entities/common.js';
import type { ConceptMastery } from '../entities/student-profile.js';

export interface ProblemDifficultyInput {
  readonly problemElo: number;                 // Estimated Elo of the problem
  readonly requiredConceptIds: ConceptId[];
  readonly studentElo: number;
  readonly studentMastery: Map<ConceptId, ConceptMastery>;
  readonly recentSuccessRate: number;          // 0.0–1.0, last 10 problems
}

export type RecommendationStrength = 'too_easy' | 'slightly_easy' | 'optimal' | 'slightly_hard' | 'too_hard';

export interface DifficultyPrediction {
  readonly expectedSuccessRate: number;        // 0.0–1.0
  readonly estimatedTimeMinutes: number;
  readonly requiredConceptIds: ConceptId[];
  readonly missingPrerequisites: ConceptId[];  // Not yet mastered
  readonly weakPrerequisites: ConceptId[];     // Partially mastered (< 0.5)
  readonly recommendationStrength: RecommendationStrength;
  readonly reasoning: string;                  // Human-readable explanation
}

const MASTERY_THRESHOLD_ADEQUATE = 0.6;
const MASTERY_THRESHOLD_STRONG = 0.8;

/**
 * Compute the Expected Success Rate using a logistic model.
 * P(success) = sigmoid(k * (studentElo - problemElo) / 400 + conceptBonus)
 */
function logisticSigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Compute concept mastery bonus: average normalized mastery across required concepts.
 * Range: -1.0 to +1.0
 *   +1.0 = all concepts mastered perfectly
 *   -1.0 = all concepts completely unknown
 */
function computeConceptBonus(
  requiredConceptIds: ConceptId[],
  masteryMap: Map<ConceptId, ConceptMastery>
): number {
  if (requiredConceptIds.length === 0) return 0;

  const masteryValues = requiredConceptIds.map((id) => {
    const m = masteryMap.get(id);
    return m ? m.mastery * (1 - m.forgettingProbability) : 0;
  });

  const avgMastery = masteryValues.reduce((a, b) => a + b, 0) / masteryValues.length;
  return (avgMastery - 0.5) * 2; // Scale 0–1 range to -1–1
}

/**
 * Estimate time to solve based on Elo gap and concept mastery.
 */
function estimateSolveTime(eloDelta: number, missingCount: number): number {
  const baseTime = 20; // minutes
  const eloPenalty = Math.max(0, eloDelta / 100) * 10;
  const conceptPenalty = missingCount * 15;
  return Math.round(baseTime + eloPenalty + conceptPenalty);
}

/**
 * Convert a success rate into a recommendation strength label.
 */
function classifyStrength(successRate: number): RecommendationStrength {
  if (successRate > 0.9) return 'too_easy';
  if (successRate > 0.75) return 'slightly_easy';
  if (successRate >= 0.45) return 'optimal'; // "Optimal challenge zone"
  if (successRate >= 0.25) return 'slightly_hard';
  return 'too_hard';
}

/**
 * Predict difficulty for a student-problem pair.
 * Pure function — no I/O.
 */
export function predictDifficulty(input: ProblemDifficultyInput): DifficultyPrediction {
  const { problemElo, studentElo, requiredConceptIds, studentMastery, recentSuccessRate } = input;

  const eloDelta = problemElo - studentElo;
  const conceptBonus = computeConceptBonus(requiredConceptIds, studentMastery);

  // Logistic model: k=1.5 gives a reasonable S-curve slope
  const rawP = logisticSigmoid(-1.5 * eloDelta / 400 + conceptBonus);

  // Blend with recent success rate (10% weight) to account for current performance state
  const expectedSuccessRate = rawP * 0.9 + recentSuccessRate * 0.1;

  const missingPrerequisites = requiredConceptIds.filter((id) => {
    const m = studentMastery.get(id);
    return !m || m.mastery < 0.2;
  });

  const weakPrerequisites = requiredConceptIds.filter((id) => {
    const m = studentMastery.get(id);
    return m && m.mastery >= 0.2 && m.mastery < MASTERY_THRESHOLD_ADEQUATE;
  });

  const recommendationStrength = classifyStrength(expectedSuccessRate);
  const estimatedTimeMinutes = estimateSolveTime(eloDelta, missingPrerequisites.length);

  const reasoning =
    `Student Elo: ${studentElo}, Problem Elo: ${problemElo} (gap: ${eloDelta > 0 ? '+' : ''}${eloDelta}). ` +
    `Concept readiness: ${requiredConceptIds.length - missingPrerequisites.length}/${requiredConceptIds.length}. ` +
    `Expected success: ${Math.round(expectedSuccessRate * 100)}%.`;

  return {
    expectedSuccessRate,
    estimatedTimeMinutes,
    requiredConceptIds,
    missingPrerequisites,
    weakPrerequisites,
    recommendationStrength,
    reasoning,
  };
}
