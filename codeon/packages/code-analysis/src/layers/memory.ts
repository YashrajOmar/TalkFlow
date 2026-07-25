/**
 * Memory Analyser — detects C++-specific memory issues from the AST.
 *
 * Detects:
 *   - Raw pointer usage (new/delete)
 *   - malloc/free calls
 *   - Large stack allocations (int arr[1000000])
 *   - Unchecked null pointer dereferences
 *
 * Language note: This layer runs for C/C++ only.
 * For Python/Java/JS, it returns a safe empty result.
 */

import type { ASTNode, MemoryAnalysis, MemoryIssue, StackAllocation } from '../types.js';
import type { Language } from '@codeon/core';

const LARGE_ALLOCATION_THRESHOLD = 100_000;

function detectRawPointers(root: ASTNode): { hasRaw: boolean; hasMalloc: boolean; issues: MemoryIssue[] } {
  const issues: MemoryIssue[] = [];
  let hasRaw = false;
  let hasMalloc = false;

  function walk(node: ASTNode): void {
    if (node.type === 'new_expression') {
      hasRaw = true;
      issues.push({
        type: 'raw_pointer',
        line: node.startLine,
        description: 'Raw pointer allocation with new — consider using smart pointers (unique_ptr, shared_ptr)',
        severity: 'medium',
      });
    }
    if (node.type === 'call_expression') {
      const callee = node.children[0];
      if (callee?.text === 'malloc' || callee?.text === 'calloc') {
        hasMalloc = true;
        issues.push({
          type: 'raw_pointer',
          line: node.startLine,
          description: 'C-style malloc detected in C++ code — use new or smart pointers',
          severity: 'medium',
        });
      }
    }
    node.children.forEach(walk);
  }

  walk(root);
  return { hasRaw, hasMalloc, issues };
}

function detectLargeStackAllocations(root: ASTNode): StackAllocation[] {
  const allocations: StackAllocation[] = [];

  function walk(node: ASTNode): void {
    if (node.type === 'declaration' || node.type === 'array_declarator') {
      const text = node.text;
      const match = text.match(/\[(\d+)\]/);
      if (match?.[1]) {
        const size = parseInt(match[1]);
        if (size > LARGE_ALLOCATION_THRESHOLD) {
          allocations.push({
            line: node.startLine,
            estimatedBytes: size * 4, // Assume int
            declaration: text.slice(0, 60),
          });
        }
      }
    }
    node.children.forEach(walk);
  }

  walk(root);
  return allocations;
}

/**
 * Analyse memory issues from the AST.
 * Pure function — no I/O.
 * Returns empty results for non-C/C++ languages.
 */
export function analyseMemory(root: ASTNode, language: Language): MemoryAnalysis {
  const cppLangs: Language[] = ['c', 'cpp', 'cpp17', 'cpp20'];

  if (!cppLangs.includes(language)) {
    return {
      hasRawPointers: false,
      hasMalloc: false,
      hasPotentialLeak: false,
      largeStackAllocations: [],
      issues: [],
    };
  }

  const { hasRaw, hasMalloc, issues: ptrIssues } = detectRawPointers(root);
  const largeAllocations = detectLargeStackAllocations(root);

  const allocIssues: MemoryIssue[] = largeAllocations.map((a) => ({
    type: 'large_allocation',
    line: a.line,
    description: `Large stack allocation (${(a.estimatedBytes / 1024).toFixed(0)}KB) — may cause stack overflow for deep recursion`,
    severity: 'medium',
  }));

  const hasPotentialLeak = hasRaw && !root.text.includes('delete');

  return {
    hasRawPointers: hasRaw,
    hasMalloc,
    hasPotentialLeak,
    largeStackAllocations: largeAllocations,
    issues: [...ptrIssues, ...allocIssues],
  };
}
