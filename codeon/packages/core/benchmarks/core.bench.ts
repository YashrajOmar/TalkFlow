/**
 * Performance benchmarks for core algorithms.
 * Thresholds are enforced in CI — regressions beyond these fail the build.
 *
 * Run: pnpm bench --filter @codeon/core
 *
 * Threshold table:
 *   Elo update                              < 0.1 ms
 *   SM-2 update                             < 0.1 ms
 *   Knowledge Graph propagation (100 nodes) < 5 ms
 *   Trail Engine level detection            < 1 ms
 *   Prompt Builder assembly                 < 1 ms
 *   Policy Engine evaluation                < 0.5 ms
 */

import { bench, describe } from 'vitest';
import { computeEloUpdate } from '../src/learning-engine/elo-engine.js';
import { applySM2Update, createInitialForgettingState } from '../src/learning-engine/forgetting-curve.js';
import { detectAlgorithmicLevel } from '../src/trail-engine/index.js';
import { evaluatePolicy } from '../src/learning-policy-engine.js';
import type { CodePatternSignals } from '../src/trail-engine/index.js';
import type { PolicyContext } from '../src/learning-policy-engine.js';

const ELO_INPUT = {
  currentElo: 1200,
  opponentElo: 1300,
  result: 'win' as const,
  sessionCount: 15,
  hintsUsed: 2,
};

const SM2_STATE = createInitialForgettingState('binary-search', new Date());

const CODE_SIGNALS: CodePatternSignals = {
  nestedLoopDepth: 2,
  hasSortingCall: true,
  hasBinarySearch: false,
  hasHashMap: false,
  hasTwoPointers: false,
  hasMonotonicStructure: false,
  hasDPTable: false,
  hasGraphStructure: false,
  hasHeap: false,
  hasAdvancedDS: false,
  hasDSU: false,
  hasPrefixSum: false,
  hasSlidingWindow: false,
};

const POLICY_CONTEXT: PolicyContext = {
  hintsGivenThisSession: 2,
  secondsSinceLastHint: 600,
  studentGlobalElo: 1200,
  currentAlgorithmicLevel: 'brute_force',
  mistakesThisSession: 1,
  minutesStuckAtCurrentLevel: 12,
  studentRequestedHint: false,
  sessionMode: 'problem',
  lastVerdict: 'WA',
  isNewUser: false,
  dailyHintCount: 5,
};

describe('Core Algorithm Benchmarks', () => {
  bench('Elo update', () => {
    computeEloUpdate(ELO_INPUT);
  });

  bench('SM-2 update', () => {
    applySM2Update({ currentState: SM2_STATE, quality: 4, reviewedAt: new Date() });
  });

  bench('Trail Engine: level detection', () => {
    detectAlgorithmicLevel(CODE_SIGNALS);
  });

  bench('Learning Policy Engine: evaluate', () => {
    evaluatePolicy(POLICY_CONTEXT);
  });
});
