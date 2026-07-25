import { describe, it, expect } from 'vitest';
import {
  detectAlgorithmicLevel,
  computeRemainingTrail,
  computeDistanceToOptimal,
  hasReachedOptimal,
} from '../src/trail-engine/index.js';
import type { OptimizationTrail } from '../src/entities/problem.js';
import type { CodePatternSignals } from '../src/trail-engine/index.js';

const makeSignals = (overrides: Partial<CodePatternSignals> = {}): CodePatternSignals => ({
  nestedLoopDepth: 1,
  hasSortingCall: false,
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
  ...overrides,
});

const sampleTrail: OptimizationTrail = {
  problemId: 'two-sum' as never,
  steps: [
    {
      level: 'brute_force',
      description: 'O(n²) nested loop',
      complexity: { time: 'O(n²)', space: 'O(1)', explanation: 'Check all pairs' },
      requiredConceptIds: [],
      socrticHintToReach: 'What if you tried every pair?',
    },
    {
      level: 'sorting',
      description: 'Sort then two pointer',
      complexity: { time: 'O(n log n)', space: 'O(1)', explanation: 'Sort + two pointer' },
      requiredConceptIds: [],
      socrticHintToReach: 'What if you sorted first?',
    },
    {
      level: 'hash_map',
      description: 'Hash map O(n)',
      complexity: { time: 'O(n)', space: 'O(n)', explanation: 'Store complements' },
      requiredConceptIds: [],
      socrticHintToReach: 'Can you look up each complement in O(1)?',
    },
    {
      level: 'optimal',
      description: 'Hash map — optimal',
      complexity: { time: 'O(n)', space: 'O(n)', explanation: 'Single pass' },
      requiredConceptIds: [],
      socrticHintToReach: '',
    },
  ],
};

describe('TrailEngine - detectAlgorithmicLevel', () => {
  it('detects brute_force for simple loops', () => {
    expect(detectAlgorithmicLevel(makeSignals({ nestedLoopDepth: 1 }))).toBe('brute_force');
  });

  it('detects naive_optimized for 2 nested loops', () => {
    expect(detectAlgorithmicLevel(makeSignals({ nestedLoopDepth: 2 }))).toBe('naive_optimized');
  });

  it('detects sorting when sort call present', () => {
    expect(detectAlgorithmicLevel(makeSignals({ hasSortingCall: true }))).toBe('sorting');
  });

  it('detects binary_search', () => {
    expect(detectAlgorithmicLevel(makeSignals({ hasBinarySearch: true }))).toBe('binary_search');
  });

  it('detects hash_map', () => {
    expect(detectAlgorithmicLevel(makeSignals({ hasHashMap: true }))).toBe('hash_map');
  });

  it('detects dp as higher priority than hash_map', () => {
    expect(
      detectAlgorithmicLevel(makeSignals({ hasHashMap: true, hasDPTable: true }))
    ).toBe('dynamic_programming');
  });

  it('detects advanced_data_structure as highest priority', () => {
    expect(
      detectAlgorithmicLevel(
        makeSignals({ hasAdvancedDS: true, hasDPTable: true, hasHashMap: true })
      )
    ).toBe('advanced_data_structure');
  });
});

describe('TrailEngine - trail traversal', () => {
  it('returns remaining steps from current position', () => {
    const remaining = computeRemainingTrail(sampleTrail, 'brute_force');
    expect(remaining.length).toBe(3); // sorting, hash_map, optimal
    expect(remaining[0]?.level).toBe('sorting');
  });

  it('returns empty array when already at optimal', () => {
    const remaining = computeRemainingTrail(sampleTrail, 'optimal');
    expect(remaining).toHaveLength(0);
  });

  it('computes distance to optimal correctly', () => {
    expect(computeDistanceToOptimal(sampleTrail, 'brute_force')).toBe(3);
    expect(computeDistanceToOptimal(sampleTrail, 'sorting')).toBe(2);
    expect(computeDistanceToOptimal(sampleTrail, 'hash_map')).toBe(1);
    expect(computeDistanceToOptimal(sampleTrail, 'optimal')).toBe(0);
  });

  it('correctly identifies when optimal is reached', () => {
    expect(hasReachedOptimal(sampleTrail, 'optimal')).toBe(true);
    expect(hasReachedOptimal(sampleTrail, 'hash_map')).toBe(false);
  });
});
