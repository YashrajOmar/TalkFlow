import { describe, it, expect } from 'vitest';
import {
  applySM2Update,
  createInitialForgettingState,
  getConceptsDueForReview,
} from '../src/learning-engine/forgetting-curve.js';

describe('ForgettingCurveEngine (SM-2)', () => {
  const now = new Date('2025-01-15T10:00:00Z');
  const conceptId = 'binary-search';

  it('creates initial state with correct defaults', () => {
    const state = createInitialForgettingState(conceptId, now);
    expect(state.conceptId).toBe(conceptId);
    expect(state.repetitions).toBe(0);
    expect(state.easeFactor).toBe(2.5);
    expect(state.intervalDays).toBe(1);
    expect(state.forgettingProbability).toBe(0);
  });

  it('increases interval on successful recall (quality >= 3)', () => {
    const initial = createInitialForgettingState(conceptId, now);
    const after1 = applySM2Update({ currentState: initial, quality: 5, reviewedAt: now });
    expect(after1.repetitions).toBe(1);
    expect(after1.intervalDays).toBe(1); // First review: interval = 1

    const after2 = applySM2Update({ currentState: after1, quality: 5, reviewedAt: now });
    expect(after2.repetitions).toBe(2);
    expect(after2.intervalDays).toBe(6); // Second review: interval = 6
  });

  it('resets repetitions on poor recall (quality < 3)', () => {
    let state = createInitialForgettingState(conceptId, now);
    state = applySM2Update({ currentState: state, quality: 5, reviewedAt: now });
    state = applySM2Update({ currentState: state, quality: 5, reviewedAt: now });
    expect(state.repetitions).toBe(2);

    // Poor recall resets
    state = applySM2Update({ currentState: state, quality: 1, reviewedAt: now });
    expect(state.repetitions).toBe(0);
    expect(state.intervalDays).toBe(1);
  });

  it('ease factor never drops below 1.3', () => {
    let state = createInitialForgettingState(conceptId, now);
    // Apply many poor reviews to drive down ease factor
    for (let i = 0; i < 20; i++) {
      state = applySM2Update({ currentState: state, quality: 0, reviewedAt: now });
    }
    expect(state.easeFactor).toBeGreaterThanOrEqual(1.3);
  });

  it('identifies overdue reviews correctly', () => {
    const pastDate = new Date('2025-01-01T00:00:00Z');
    const futureDate = new Date('2025-12-31T00:00:00Z');

    const overdueState = {
      ...createInitialForgettingState('overdue', now),
      nextReviewAt: pastDate,
      forgettingProbability: 0.8,
    };
    const notDueState = {
      ...createInitialForgettingState('future', now),
      nextReviewAt: futureDate,
      forgettingProbability: 0.1,
    };

    const due = getConceptsDueForReview([overdueState, notDueState], now);
    expect(due).toHaveLength(1);
    expect(due[0]?.conceptId).toBe('overdue');
  });

  it('sorts overdue reviews by forgetting probability (highest first)', () => {
    const makeState = (id: string, fp: number, nextReview: Date) => ({
      ...createInitialForgettingState(id, now),
      nextReviewAt: nextReview,
      forgettingProbability: fp,
    });

    const past = new Date('2025-01-01T00:00:00Z');
    const states = [
      makeState('a', 0.6, past),
      makeState('b', 0.9, past),
      makeState('c', 0.7, past),
    ];

    const due = getConceptsDueForReview(states, now);
    expect(due[0]?.conceptId).toBe('b');
    expect(due[1]?.conceptId).toBe('c');
    expect(due[2]?.conceptId).toBe('a');
  });
});
