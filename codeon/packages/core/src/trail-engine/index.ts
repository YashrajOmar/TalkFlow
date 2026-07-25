/**
 * Trail Engine — Native Optimization Trail.
 *
 * Detects the student's current algorithmic level from code characteristics
 * and constructs an ordered trail from their current position to the optimal solution.
 *
 * Key principle: The trail is always derived from VERIFIED editorial data, not from
 * LLM inference. The LLM only generates the Socratic hint to guide the next step.
 *
 * Levels are detected by recognizing patterns in:
 *   - Data structures used
 *   - Complexity signals from static analysis
 *   - Loop nesting depth
 *   - Known algorithmic patterns (two pointers, sliding window, etc.)
 */

import type { AlgorithmicLevel } from '../entities/common.js';
import type { OptimizationStep, OptimizationTrail } from '../entities/problem.js';

export interface CodePatternSignals {
  /** Number of nested loop levels (e.g., 2 = O(n²) at minimum) */
  readonly nestedLoopDepth: number;
  /** True if any sorting call is detected (sort/qsort/priority_queue) */
  readonly hasSortingCall: boolean;
  /** True if binary search pattern is detected */
  readonly hasBinarySearch: boolean;
  /** True if a hash map / unordered_map is used */
  readonly hasHashMap: boolean;
  /** True if a two-pointer pattern is detectable */
  readonly hasTwoPointers: boolean;
  /** True if a monotonic stack/queue pattern is present */
  readonly hasMonotonicStructure: boolean;
  /** True if dynamic programming table/memo is detected */
  readonly hasDPTable: boolean;
  /** True if graph adjacency list or matrix is present */
  readonly hasGraphStructure: boolean;
  /** True if a heap / priority_queue is used */
  readonly hasHeap: boolean;
  /** True if a segment tree or BIT/Fenwick is used */
  readonly hasAdvancedDS: boolean;
  /** True if union-find (DSU) is detected */
  readonly hasDSU: boolean;
  /** True if prefix sum array is built */
  readonly hasPrefixSum: boolean;
  /** True if a sliding window variable tracking max/min is present */
  readonly hasSlidingWindow: boolean;
}

/**
 * Detect the most likely algorithmic level from code pattern signals.
 * Returns the HIGHEST level supported by the detected signals.
 * Pure function — no I/O.
 */
export function detectAlgorithmicLevel(signals: CodePatternSignals): AlgorithmicLevel {
  // Check from most advanced to least — return first match
  if (signals.hasAdvancedDS) return 'advanced_data_structure';
  if (signals.hasDSU && signals.hasGraphStructure) return 'advanced_data_structure';
  if (signals.hasDPTable) return 'dynamic_programming';
  if (signals.hasGraphStructure && (signals.hasHeap || signals.hasBinarySearch)) {
    return 'advanced_data_structure';
  }
  if (signals.hasGraphStructure) return 'graph_traversal';
  if (signals.hasHeap || signals.hasMonotonicStructure) return 'greedy';
  if (signals.hasSlidingWindow) return 'sliding_window';
  if (signals.hasPrefixSum) return 'prefix_sum';
  if (signals.hasHashMap) return 'hash_map';
  if (signals.hasBinarySearch) return 'binary_search';
  if (signals.hasTwoPointers) return 'two_pointer';
  if (signals.hasSortingCall) return 'sorting';
  if (signals.nestedLoopDepth === 2) return 'naive_optimized';
  return 'brute_force';
}

/**
 * Ordered sequence of all algorithmic levels from worst to best.
 */
const LEVEL_ORDER: AlgorithmicLevel[] = [
  'brute_force',
  'naive_optimized',
  'sorting',
  'two_pointer',
  'binary_search',
  'hash_map',
  'prefix_sum',
  'sliding_window',
  'greedy',
  'divide_and_conquer',
  'dynamic_programming',
  'graph_traversal',
  'advanced_data_structure',
  'mathematical',
  'optimal',
];

/**
 * Get the index of a level in the ordered sequence.
 */
export function getLevelIndex(level: AlgorithmicLevel): number {
  return LEVEL_ORDER.indexOf(level);
}

/**
 * Compute the trail from the student's current position to the optimal.
 * Returns only the steps AHEAD of the student's current level.
 * Pure function — requires pre-computed trail from editorial data.
 */
export function computeRemainingTrail(
  fullTrail: OptimizationTrail,
  currentLevel: AlgorithmicLevel
): OptimizationStep[] {
  const currentIndex = getLevelIndex(currentLevel);
  return fullTrail.steps.filter((step) => {
    const stepIndex = getLevelIndex(step.level as AlgorithmicLevel);
    return stepIndex > currentIndex;
  });
}

/**
 * Get the immediate next step on the optimization trail.
 * This is the step the student should be guided toward next.
 */
export function getNextTrailStep(
  fullTrail: OptimizationTrail,
  currentLevel: AlgorithmicLevel
): OptimizationStep | null {
  const remaining = computeRemainingTrail(fullTrail, currentLevel);
  return remaining[0] ?? null;
}

/**
 * Compute how many optimization steps remain to the optimal.
 */
export function computeDistanceToOptimal(
  fullTrail: OptimizationTrail,
  currentLevel: AlgorithmicLevel
): number {
  return computeRemainingTrail(fullTrail, currentLevel).length;
}

/**
 * Determine if the student has reached the optimal solution for this problem.
 */
export function hasReachedOptimal(
  fullTrail: OptimizationTrail,
  currentLevel: AlgorithmicLevel
): boolean {
  return computeDistanceToOptimal(fullTrail, currentLevel) === 0;
}
