/**
 * Optimization Signal Detector — extracts CodePatternSignals for the Trail Engine.
 *
 * Scans the AST for identifiable data structures and algorithmic patterns.
 * The signals are consumed directly by the Trail Engine's detectAlgorithmicLevel().
 *
 * Detection strategy:
 *   - Known identifier names (unordered_map, priority_queue, etc.)
 *   - Known call expressions (lower_bound, binary_search)
 *   - Structural patterns (two adjacent iterating pointers)
 *   - Template type arguments (vector<pair<...>>)
 *
 * All detection is purely syntactic — no execution or type inference required.
 */

import type { ASTNode, OptimizationSignals } from '../types.js';

interface DetectionAccumulator {
  hasSortingCall: boolean;
  hasBinarySearch: boolean;
  hasHashMap: boolean;
  hasTwoPointers: boolean;
  hasMonotonicStructure: boolean;
  hasDPTable: boolean;
  hasGraphStructure: boolean;
  hasHeap: boolean;
  hasAdvancedDS: boolean;
  hasDSU: boolean;
  hasPrefixSum: boolean;
  hasSlidingWindow: boolean;
  detectedStructures: Set<string>;
}

const SORT_CALLS = new Set(['sort', 'stable_sort', 'qsort', 'partial_sort']);
const BINARY_SEARCH_CALLS = new Set([
  'binary_search', 'lower_bound', 'upper_bound', 'equal_range',
]);
const HASH_MAP_TYPES = new Set([
  'unordered_map', 'unordered_set', 'HashMap', 'HashSet', 'dict', 'set',
]);
const HEAP_TYPES = new Set(['priority_queue', 'PriorityQueue', 'heapq']);
const ADVANCED_DS_TYPES = new Set([
  'segment_tree', 'SegmentTree', 'BIT', 'FenwickTree', 'Trie', 'treap',
  'SegTree', 'bit',
]);
const DSU_INDICATORS = new Set(['find', 'union', 'parent', 'rank', 'DSU', 'UnionFind']);
const GRAPH_TYPES = new Set([
  'adj', 'graph', 'adjList', 'adjacency', 'edges', 'neighbors',
]);
const MONOTONIC_TYPES = new Set(['monotonic', 'stack', 'deque', 'Deque']);

function scanText(acc: DetectionAccumulator, text: string): void {
  // Sorting
  for (const s of SORT_CALLS) {
    if (text.includes(s + '(')) {
      acc.hasSortingCall = true;
      acc.detectedStructures.add(s);
    }
  }

  // Binary search
  for (const s of BINARY_SEARCH_CALLS) {
    if (text.includes(s)) {
      acc.hasBinarySearch = true;
      acc.detectedStructures.add(s);
    }
  }

  // Hash map
  for (const s of HASH_MAP_TYPES) {
    if (text.includes(s)) {
      acc.hasHashMap = true;
      acc.detectedStructures.add(s);
    }
  }

  // Heap
  for (const s of HEAP_TYPES) {
    if (text.includes(s)) {
      acc.hasHeap = true;
      acc.detectedStructures.add(s);
    }
  }

  // Advanced DS
  for (const s of ADVANCED_DS_TYPES) {
    if (text.includes(s)) {
      acc.hasAdvancedDS = true;
      acc.detectedStructures.add(s);
    }
  }

  // DSU
  if (
    (text.includes('find(') || text.includes('union(')) &&
    (text.includes('parent') || text.includes('rank'))
  ) {
    acc.hasDSU = true;
    acc.detectedStructures.add('UnionFind');
  }

  // Graph
  for (const s of GRAPH_TYPES) {
    if (text.includes(s)) {
      acc.hasGraphStructure = true;
      acc.detectedStructures.add(s);
    }
  }

  // BFS/DFS explicit call
  if (text.includes('bfs(') || text.includes('dfs(') || text.includes('BFS') || text.includes('DFS')) {
    acc.hasGraphStructure = true;
    acc.detectedStructures.add('graph_traversal');
  }

  // Prefix sum
  if (
    text.includes('prefix') ||
    text.includes('prefixSum') ||
    text.includes('cumSum') ||
    (text.includes('[i]') && text.includes('[i-1]') && text.includes('+='))
  ) {
    acc.hasPrefixSum = true;
    acc.detectedStructures.add('prefix_sum');
  }

  // Sliding window — window size variable or l/r pointer shrink
  if (
    text.includes('window') ||
    (text.includes('left') && text.includes('right') && text.includes('while'))
  ) {
    acc.hasSlidingWindow = true;
    acc.detectedStructures.add('sliding_window');
  }

  // Monotonic stack/deque
  if (text.includes('mono') || (text.includes('stack') && text.includes('.back()'))) {
    acc.hasMonotonicStructure = true;
    acc.detectedStructures.add('monotonic_stack');
  }

  // DP table
  if (
    text.includes('dp[') ||
    text.includes('memo[') ||
    text.includes('memo.') ||
    (text.includes('vector<vector') && text.includes('dp'))
  ) {
    acc.hasDPTable = true;
    acc.detectedStructures.add('dp_table');
  }
}

/**
 * Detect two-pointer pattern: two named variables (l/r, left/right, i/j)
 * both moving over the same array/string in a single loop.
 */
function detectTwoPointers(root: ASTNode): boolean {
  const twoPointerPairs = [
    ['left', 'right'],
    ['l', 'r'],
    ['i', 'j'],
    ['lo', 'hi'],
    ['start', 'end'],
    ['low', 'high'],
  ];

  const text = root.text;
  return twoPointerPairs.some(
    ([a, b]) =>
      text.includes(` ${a}`) &&
      text.includes(` ${b}`) &&
      (text.includes(`${a}++`) || text.includes(`++${a}`)) &&
      (text.includes(`${b}--`) || text.includes(`--${b}`))
  );
}

/**
 * Iterative BFS text collector — collects all text from the AST without recursion.
 * Safe for arbitrarily deep trees (no call stack overflow).
 */
function collectAllText(root: ASTNode): string {
  const parts: string[] = [];
  const queue: ASTNode[] = [root];
  while (queue.length > 0) {
    const node = queue.shift()!;
    parts.push(node.text);
    for (const child of node.children) {
      queue.push(child);
    }
  }
  return parts.join('');
}

/**
 * Count maximum nesting depth of loops from AST using an iterative DFS.
 * Safe for arbitrarily deep trees (no call stack overflow).
 */
function countMaxNestingDepth(root: ASTNode): number {
  const loopTypes = new Set([
    'for_statement', 'for_range_loop', 'while_statement', 'do_statement',
    'for_in_statement', 'for_of_statement', 'for_clause',
  ]);

  let maxDepth = 0;
  // Stack holds [node, currentDepth]
  const stack: Array<[ASTNode, number]> = [[root, 0]];

  while (stack.length > 0) {
    const [node, depth] = stack.pop()!;
    const newDepth = loopTypes.has(node.type) ? depth + 1 : depth;
    if (newDepth > maxDepth) maxDepth = newDepth;
    for (const child of node.children) {
      stack.push([child, newDepth]);
    }
  }

  return maxDepth;
}

/**
 * Detect all optimization signals from the AST root.
 * Pure function — no I/O.
 * Never throws — returns zeroed signals on any unexpected error.
 */
export function detectOptimizationSignals(root: ASTNode): OptimizationSignals {
  try {
    const acc: DetectionAccumulator = {
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
      detectedStructures: new Set(),
    };

    const fullText = collectAllText(root);
    scanText(acc, fullText);
    acc.hasTwoPointers = detectTwoPointers(root);

    const nestedLoopDepth = countMaxNestingDepth(root);

    return {
      nestedLoopDepth,
      hasSortingCall: acc.hasSortingCall,
      hasBinarySearch: acc.hasBinarySearch,
      hasHashMap: acc.hasHashMap,
      hasTwoPointers: acc.hasTwoPointers,
      hasMonotonicStructure: acc.hasMonotonicStructure,
      hasDPTable: acc.hasDPTable,
      hasGraphStructure: acc.hasGraphStructure,
      hasHeap: acc.hasHeap,
      hasAdvancedDS: acc.hasAdvancedDS,
      hasDSU: acc.hasDSU,
      hasPrefixSum: acc.hasPrefixSum,
      hasSlidingWindow: acc.hasSlidingWindow,
      detectedStructures: [...acc.detectedStructures],
    };
  } catch {
    // Fallback: return safe zeroed signals — never let analysis crash the pipeline
    return {
      nestedLoopDepth: 0,
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
      detectedStructures: [],
    };
  }
}

