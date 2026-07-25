/**
 * Complexity Analyser — derives Big-O estimates from the Control Flow Graph.
 *
 * Key design: All complexity analysis reads from the CFG, NOT from the raw AST.
 * This gives accurate nesting depth even with break/continue/early returns.
 *
 * Algorithm:
 *   1. maxNestingDepth from CFG → time complexity tier
 *   2. Recursion detection from AST (function calling itself)
 *   3. Space complexity from data structure declarations
 *
 * Limitations (intentional — keep deterministic):
 *   - Cannot distinguish O(n log n) from O(n²) without semantic analysis
 *   - Marks ambiguous cases as 'estimated' confidence
 *   - Does NOT hallucinate — prefers conservative estimates
 */

import type { ASTNode, ComplexityAnalysis, ControlFlowGraph } from './types.js';

/**
 * Map nesting depth to a Big-O time complexity tier.
 * Conservatively: depth N means at least O(n^N) in the worst case.
 */
function nestingDepthToComplexity(
  depth: number,
  hasRecursion: boolean,
  hasSorting: boolean
): { time: string; confidence: 'certain' | 'probable' | 'estimated'; explanation: string } {
  if (hasRecursion) {
    return {
      time: 'O(2ⁿ) or better',
      confidence: 'estimated',
      explanation: 'Recursion detected — complexity depends on recurrence relation. Could be O(log n), O(n), O(n²), or exponential.',
    };
  }

  if (depth === 0) {
    return {
      time: 'O(1)',
      confidence: 'certain',
      explanation: 'No loops detected. Constant time.',
    };
  }

  if (depth === 1) {
    if (hasSorting) {
      return {
        time: 'O(n log n)',
        confidence: 'probable',
        explanation: 'Single loop with sorting call detected.',
      };
    }
    return {
      time: 'O(n)',
      confidence: 'certain',
      explanation: 'Single loop over input.',
    };
  }

  if (depth === 2) {
    if (hasSorting) {
      return {
        time: 'O(n log n)',
        confidence: 'estimated',
        explanation: 'Two nesting levels with sort — outer loop may iterate over sorted result.',
      };
    }
    return {
      time: 'O(n²)',
      confidence: 'probable',
      explanation: 'Two nested loops detected. Likely quadratic.',
    };
  }

  if (depth === 3) {
    return {
      time: 'O(n³)',
      confidence: 'probable',
      explanation: 'Three nested loops detected. Likely cubic.',
    };
  }

  return {
    time: `O(n^${depth})`,
    confidence: 'estimated',
    explanation: `${depth} levels of nested loops detected.`,
  };
}

/**
 * Detect recursion: check if any function calls itself by name.
 * Strategy 1: Walk AST for function_definition + call_expression pairs
 * Strategy 2 (fallback): text-scan for direct self-call patterns
 */
function detectRecursion(root: ASTNode): boolean {
  // Strategy 1: structured AST walk
  const functionNames = new Set<string>();
  const calledNames = new Set<string>();

  function walk(node: ASTNode): void {
    if (node.type === 'function_definition' || node.type === 'function_declarator') {
      const nameNode = node.children.find(
        (c) => c.type === 'identifier' || c.type === 'function_declarator'
      );
      if (nameNode) functionNames.add(nameNode.text);
    }
    if (node.type === 'call_expression') {
      const callee = node.children[0];
      if (callee) calledNames.add(callee.text);
    }
    for (const child of node.children) {
      walk(child);
    }
  }

  walk(root);

  for (const name of functionNames) {
    if (calledNames.has(name)) return true;
  }

  // Strategy 2: text-based fallback for mock/flat ASTs
  // If a function name appears both in a definition context and a call context
  // e.g., "int fib(" present and "fib(n" also present in the code
  const fullText = root.text;
  const defMatch = fullText.match(/(?:int|long|void|bool|double)\s+(\w+)\s*\(/g);
  if (defMatch) {
    for (const match of defMatch) {
      const name = match.match(/(?:int|long|void|bool|double)\s+(\w+)\s*\(/)?.[1];
      if (name && name !== 'main') {
        // Count occurrences of name followed by ( — more than 1 means it's called
        const callPattern = new RegExp(`\\b${name}\\s*\\(`, 'g');
        const occurrences = (fullText.match(callPattern) ?? []).length;
        if (occurrences > 1) return true;
      }
    }
  }

  return false;
}

/**
 * Detect whether a sorting call (std::sort, sort, qsort, etc.) is present.
 */
function detectSortingCall(root: ASTNode): boolean {
  const sortNames = new Set(['sort', 'stable_sort', 'qsort', 'partial_sort', 'nth_element']);

  function walk(node: ASTNode): boolean {
    if (node.type === 'call_expression') {
      const callee = node.children[0];
      if (callee) {
        const name = callee.text.split('::').pop() ?? callee.text;
        if (sortNames.has(name)) return true;
      }
    }
    return node.children.some(walk);
  }

  return walk(root);
}

/**
 * Estimate space complexity from data structure declarations.
 */
function estimateSpaceComplexity(root: ASTNode): string {
  let hasVectorOrArray = false;
  let has2DStructure = false;

  function walk(node: ASTNode): void {
    const text = node.text;
    if (
      text.includes('vector<vector') ||
      text.includes('int[][]') ||
      text.includes('dp[') ||
      text.includes('memo[')
    ) {
      has2DStructure = true;
    }
    if (
      text.includes('vector<') ||
      text.includes('unordered_map') ||
      text.includes('set<') ||
      text.includes('map<') ||
      node.type === 'array_declarator'
    ) {
      hasVectorOrArray = true;
    }
    for (const child of node.children) {
      walk(child);
    }
  }

  walk(root);

  if (has2DStructure) return 'O(n²)';
  if (hasVectorOrArray) return 'O(n)';
  return 'O(1)';
}

/**
 * Analyse time and space complexity from the CFG + AST.
 * Pure function — no I/O.
 */
export function analyseComplexity(
  cfg: ControlFlowGraph,
  root: ASTNode
): ComplexityAnalysis {
  const hasRecursion = detectRecursion(root);
  const hasSorting = detectSortingCall(root);

  const { time, confidence, explanation } = nestingDepthToComplexity(
    cfg.maxNestingDepth,
    hasRecursion,
    hasSorting
  );

  const spaceComplexity = estimateSpaceComplexity(root);

  return {
    timeComplexity: time,
    spaceComplexity,
    nestingDepth: cfg.maxNestingDepth,
    loopCount: cfg.loopCount,
    hasRecursion,
    confidence,
    explanation,
  };
}
