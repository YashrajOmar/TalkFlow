/**
 * Teaching Strategy Selector — adapts the hint delivery style per student.
 *
 * The system learns HOW each student learns best by tracking:
 *   - Which teaching style they rated as helpful
 *   - Which hints led to faster progression on the optimization trail
 *   - Whether the student self-reported understanding
 *
 * Strategies:
 *   analogy       — Real-world comparisons
 *   proof_based   — Formal correctness reasoning
 *   visual        — Step-by-step traces, dry runs
 *   counterexample — Disprove wrong assumptions with a specific failing case
 *   step_by_step  — Incremental guided steps
 *   minimal_hints — Tiny nudges, student discovers independently
 *   socratic      — Pure question-based Socratic dialogue (default)
 */

import type { TeachingStyle } from '../entities/common.js';

export interface StrategyFeedback {
  readonly style: TeachingStyle;
  readonly wasHelpful: boolean;
  readonly ledToTrailAdvancement: boolean;  // Did student improve after this hint?
  readonly sessionCount: number;             // Total sessions when this was used
}

export interface StrategyWeights {
  readonly [style: string]: number;  // 0.0–1.0, higher = more likely to use
}

const DEFAULT_STRATEGY_WEIGHTS: StrategyWeights = {
  socratic: 0.8,
  step_by_step: 0.6,
  minimal_hints: 0.5,
  counterexample: 0.4,
  analogy: 0.4,
  visual: 0.3,
  proof_based: 0.2,
};

/**
 * Update strategy weights based on student feedback.
 * Uses exponential moving average to weight recent feedback more.
 */
export function updateStrategyWeights(
  currentWeights: StrategyWeights,
  feedback: StrategyFeedback
): StrategyWeights {
  const alpha = 0.3; // EMA learning rate
  const reward = feedback.wasHelpful
    ? feedback.ledToTrailAdvancement
      ? 1.0  // Helped AND led to improvement
      : 0.6  // Helpful but no trail advancement
    : 0.1;   // Not helpful

  const updatedWeight =
    currentWeights[feedback.style] !== undefined
      ? (1 - alpha) * (currentWeights[feedback.style] as number) + alpha * reward
      : reward;

  return {
    ...currentWeights,
    [feedback.style]: Math.max(0.05, Math.min(1.0, updatedWeight)),
  };
}

/**
 * Select the best teaching style given current weights and context.
 * Adds contextual modifiers: new users prefer step_by_step, advanced users prefer socratic.
 */
export function selectTeachingStyle(
  weights: StrategyWeights,
  context: {
    isNewUser: boolean;
    hintNumberInSession: number;  // 1st hint vs 5th hint
    studentGlobalElo: number;
    sessionMode: string;
  }
): TeachingStyle {
  const adjustedWeights = { ...weights };

  // New users get more scaffolding
  if (context.isNewUser) {
    adjustedWeights['step_by_step'] = Math.min(
      1.0,
      ((adjustedWeights['step_by_step'] as number | undefined) ?? 0.5) + 0.3
    );
    adjustedWeights['socratic'] = Math.max(
      0.1,
      ((adjustedWeights['socratic'] as number | undefined) ?? 0.5) - 0.3
    );
  }

  // Interview mode forces minimal hints (simulates real interview pressure)
  if (context.sessionMode === 'interview') {
    return 'minimal_hints';
  }

  // Later hints in a session can be slightly more direct if student is stuck
  if (context.hintNumberInSession > 4) {
    adjustedWeights['step_by_step'] = Math.min(
      1.0,
      ((adjustedWeights['step_by_step'] as number | undefined) ?? 0.5) + 0.2
    );
  }

  // High Elo students get more Socratic
  if (context.studentGlobalElo > 1800) {
    adjustedWeights['socratic'] = Math.min(
      1.0,
      ((adjustedWeights['socratic'] as number | undefined) ?? 0.5) + 0.2
    );
  }

  // Pick the style with the highest adjusted weight
  const best = Object.entries(adjustedWeights).reduce(
    (max, [style, weight]) => (weight > max.weight ? { style, weight } : max),
    { style: 'socratic', weight: 0 }
  );

  return best.style as TeachingStyle;
}

/**
 * Initialize default weights for a new user.
 */
export function createDefaultStrategyWeights(): StrategyWeights {
  return { ...DEFAULT_STRATEGY_WEIGHTS };
}
