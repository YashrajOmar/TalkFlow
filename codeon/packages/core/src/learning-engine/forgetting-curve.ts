/**
 * Forgetting Curve Engine — implements the SM-2 spaced repetition algorithm.
 *
 * SM-2 (SuperMemo 2) schedules reviews based on:
 *   - How well the student recalled the concept (quality 0–5)
 *   - The interval since the last review
 *   - The ease factor (EF) — difficulty modifier
 *
 * References: https://www.supermemo.com/en/archives1990-2015/english/ol/sm2
 */

export interface ForgettingCurveState {
  readonly conceptId: string;
  readonly easeFactor: number;          // Min 1.3. Default: 2.5
  readonly intervalDays: number;        // Days until next review
  readonly repetitions: number;         // Number of successful reviews
  readonly lastReviewedAt: Date;
  readonly nextReviewAt: Date;
  readonly forgettingProbability: number; // 0.0–1.0 (1.0 = almost certainly forgotten)
}

/**
 * Quality rating for a recall event.
 * 5 = Perfect recall with no hesitation
 * 4 = Correct response after brief hesitation
 * 3 = Correct response with significant difficulty
 * 2 = Wrong answer; correct answer felt familiar
 * 1 = Wrong answer; correct answer partially recognized
 * 0 = Complete blackout
 */
export type RecallQuality = 0 | 1 | 2 | 3 | 4 | 5;

export interface SM2UpdateInput {
  readonly currentState: ForgettingCurveState;
  readonly quality: RecallQuality;
  readonly reviewedAt: Date;
}

const MIN_EASE_FACTOR = 1.3;
const DEFAULT_EASE_FACTOR = 2.5;
const INITIAL_INTERVALS: Record<number, number> = { 0: 1, 1: 6 }; // First two intervals are fixed

/**
 * Estimate forgetting probability using the Ebbinghaus formula.
 * P(forget) = 1 - e^(-t / (S * EF))
 * where t = days since last review, S = stability (repetitions-based), EF = ease factor
 */
function computeForgettingProbability(
  state: ForgettingCurveState,
  now: Date
): number {
  const daysSinceReview =
    (now.getTime() - state.lastReviewedAt.getTime()) / (1000 * 60 * 60 * 24);
  const stability = Math.max(1, state.repetitions * 2);
  const exponent = -daysSinceReview / (stability * state.easeFactor);
  return Math.min(1.0, 1 - Math.exp(exponent));
}

/**
 * Apply SM-2 update and return the new state.
 * Pure function — no side effects.
 */
export function applySM2Update(input: SM2UpdateInput): ForgettingCurveState {
  const { currentState, quality, reviewedAt } = input;

  let { easeFactor, repetitions } = currentState;

  // Quality < 3 resets the repetition counter
  const isSuccessful = quality >= 3;

  let nextIntervalDays: number;

  if (!isSuccessful) {
    repetitions = 0;
    nextIntervalDays = 1;
  } else {
    repetitions += 1;
    if (repetitions <= 2) {
      nextIntervalDays = INITIAL_INTERVALS[repetitions - 1] ?? 1;
    } else {
      nextIntervalDays = Math.round(currentState.intervalDays * easeFactor);
    }

    // Update ease factor using SM-2 formula
    easeFactor = Math.max(
      MIN_EASE_FACTOR,
      easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    );
  }

  const nextReviewAt = new Date(reviewedAt);
  nextReviewAt.setDate(nextReviewAt.getDate() + nextIntervalDays);

  const updatedState: ForgettingCurveState = {
    conceptId: currentState.conceptId,
    easeFactor,
    intervalDays: nextIntervalDays,
    repetitions,
    lastReviewedAt: reviewedAt,
    nextReviewAt,
    forgettingProbability: 0, // Will be re-computed below
  };

  return {
    ...updatedState,
    forgettingProbability: computeForgettingProbability(updatedState, reviewedAt),
  };
}

/**
 * Create an initial SM-2 state for a concept the student is encountering for the first time.
 */
export function createInitialForgettingState(
  conceptId: string,
  now: Date
): ForgettingCurveState {
  const nextReviewAt = new Date(now);
  nextReviewAt.setDate(nextReviewAt.getDate() + 1);

  return {
    conceptId,
    easeFactor: DEFAULT_EASE_FACTOR,
    intervalDays: 1,
    repetitions: 0,
    lastReviewedAt: now,
    nextReviewAt,
    forgettingProbability: 0,
  };
}

/**
 * Get all concepts that are due for review.
 */
export function getConceptsDueForReview(
  states: ForgettingCurveState[],
  now: Date
): ForgettingCurveState[] {
  return states
    .filter((s) => s.nextReviewAt <= now)
    .sort((a, b) => {
      // Prioritize by forgetting probability (highest first)
      return b.forgettingProbability - a.forgettingProbability;
    });
}

/**
 * Refresh forgetting probabilities for all states without triggering a full review.
 */
export function refreshForgettingProbabilities(
  states: ForgettingCurveState[],
  now: Date
): ForgettingCurveState[] {
  return states.map((state) => ({
    ...state,
    forgettingProbability: computeForgettingProbability(state, now),
  }));
}
