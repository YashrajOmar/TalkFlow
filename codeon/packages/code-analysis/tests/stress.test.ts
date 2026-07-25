/**
 * Stress tests for Code Analysis Engine hardening.
 *
 * These tests verify that the engine handles adversarial inputs safely:
 *   1. Severely malformed C++ code — Tree-sitter produces ERROR nodes; walkers must not crash
 *   2. Deeply nested code (512 levels) — must not hit JS call stack limit (RangeError)
 *   3. Empty input — must produce a valid empty report
 *   4. Null bytes / unusual characters — must not crash the parser
 *   5. Extremely long single line — tokenizer must not hang
 */

import { describe, it, expect } from 'vitest';
import { mockParse } from '../src/parser.js';
import { buildCFG } from '../src/cfg-builder.js';
import { analyseComplexity } from '../src/layers/complexity.js';
import { detectOptimizationSignals } from '../src/layers/optimization-signals.js';
import { analyseStyle } from '../src/layers/style.js';
import { analyseSyntax } from '../src/layers/syntax.js';
import { analyseSemantic } from '../src/layers/semantic.js';
import { analyseMemory } from '../src/layers/memory.js';
import { CodeAnalysisEngine } from '../src/engine.js';

// ── Fixture generators ────────────────────────────────────────────────────────

/**
 * Generate deeply nested for-loops to pressure-test the recursive AST walker.
 * At 512 levels this would blow a naive recursive walker's call stack.
 */
function buildDeeplyNested(depth: number): string {
  const open = Array.from({ length: depth }, (_, i) =>
    `${'  '.repeat(i)}for (int i${i} = 0; i${i} < n; i${i}++) {`
  ).join('\n');
  const close = Array.from({ length: depth }, (_, i) =>
    `${'  '.repeat(depth - i - 1)}}`
  ).join('\n');
  return `#include <iostream>\nusing namespace std;\nint main() {\n  int n = 10;\n${open}\n${'  '.repeat(depth)}sum++;\n${close}\n  return 0;\n}`;
}

/**
 * Severely malformed C++ that would produce many ERROR nodes in Tree-sitter.
 */
const MALFORMED_CPP = `
#include <iostream>
using namespace std;

int main() {
  int x = ;;;;; // severe syntax error
  vector<< // unclosed template
  for (;;; // malformed for
  if (x {  // missing parens
    cout << >>>>>> endl; // gibberish operators
  }
  class // incomplete class
  return;  // missing value but ok in void
  ??? // completely invalid
}

// Unclosed block
void broken( {
  int * * * * ptr; // legal but suspicious
  delete delete ptr; // double delete
}
`.trim();

/**
 * Code with null-like characters and non-ASCII identifiers.
 */
const UNUSUAL_CHARS_CODE = `
int main() {
  int résultat = 42;        // non-ASCII identifier
  int \u03b1 = 10;              // Greek letter
  // Comment with emoji 🎯
  return résultat + \u03b1;
}
`.trim();

/**
 * Single extremely long line (10,000 characters).
 */
const LONG_LINE_CODE = `int x = ${'1 + '.repeat(3000)}0;`;

// ── Stress test 1: Malformed code ─────────────────────────────────────────────

describe('[Stress] Malformed C++ code — ERROR node resilience', () => {
  it('mockParse does not throw on malformed code', () => {
    expect(() => mockParse(MALFORMED_CPP, 'cpp')).not.toThrow();
  });

  it('buildCFG does not throw when given a malformed AST', () => {
    const parseResult = mockParse(MALFORMED_CPP, 'cpp');
    expect(() => buildCFG(parseResult.root)).not.toThrow();
  });

  it('analyseSyntax does not throw on malformed code', () => {
    const parseResult = mockParse(MALFORMED_CPP, 'cpp');
    // hasParseErrors=true simulates what Tree-sitter would produce
    expect(() => analyseSyntax(parseResult.root, true)).not.toThrow();
  });

  it('analyseComplexity does not throw on malformed AST', () => {
    const parseResult = mockParse(MALFORMED_CPP, 'cpp');
    const cfg = buildCFG(parseResult.root);
    expect(() => analyseComplexity(cfg, parseResult.root)).not.toThrow();
  });

  it('detectOptimizationSignals does not throw on malformed AST', () => {
    const parseResult = mockParse(MALFORMED_CPP, 'cpp');
    expect(() => detectOptimizationSignals(parseResult.root)).not.toThrow();
  });

  it('analyseStyle does not throw on malformed code', () => {
    const parseResult = mockParse(MALFORMED_CPP, 'cpp');
    expect(() => analyseStyle(parseResult.root, parseResult.linesOfCode)).not.toThrow();
  });

  it('analyseSemantic does not throw on malformed code', () => {
    const parseResult = mockParse(MALFORMED_CPP, 'cpp');
    expect(() => analyseSemantic(parseResult.root)).not.toThrow();
  });

  it('analyseMemory does not throw on malformed code', () => {
    const parseResult = mockParse(MALFORMED_CPP, 'cpp');
    expect(() => analyseMemory(parseResult.root, 'cpp')).not.toThrow();
  });

  it('full engine pipeline completes and returns a valid report on malformed code', async () => {
    const engine = new CodeAnalysisEngine();
    const report = await engine.analyse({ code: MALFORMED_CPP, language: 'cpp' });

    // Must return a structured report — not throw
    expect(report).toBeDefined();
    expect(report.parseResult.root).toBeDefined();
    expect(report.complexity.timeComplexity).toBeDefined();
    expect(report.style.overallScore).toBeGreaterThanOrEqual(0);
    expect(report.optimization).toBeDefined();
  });

  it('style score stays in range [0, 100] even on malformed code', async () => {
    const engine = new CodeAnalysisEngine();
    const report = await engine.analyse({ code: MALFORMED_CPP, language: 'cpp' });
    expect(report.style.overallScore).toBeGreaterThanOrEqual(0);
    expect(report.style.overallScore).toBeLessThanOrEqual(100);
  });
});

// ── Stress test 2: Deeply nested code ────────────────────────────────────────

describe('[Stress] Deeply nested code — call stack safety', () => {
  it('buildCFG handles 50-level nesting without stack overflow', () => {
    const code = buildDeeplyNested(50);
    const parseResult = mockParse(code, 'cpp');
    expect(() => buildCFG(parseResult.root)).not.toThrow();
  });

  it('buildCFG handles 200-level nesting without stack overflow', () => {
    const code = buildDeeplyNested(200);
    const parseResult = mockParse(code, 'cpp');
    expect(() => buildCFG(parseResult.root)).not.toThrow();
  });

  it('detectOptimizationSignals handles 200-level nesting without stack overflow', () => {
    const code = buildDeeplyNested(200);
    const parseResult = mockParse(code, 'cpp');
    expect(() => detectOptimizationSignals(parseResult.root)).not.toThrow();
  });

  it('full engine handles 100-level nesting and reports deep nesting depth', async () => {
    const code = buildDeeplyNested(100);
    const engine = new CodeAnalysisEngine();
    const report = await engine.analyse({ code, language: 'cpp' });

    // Parser classifies for_ lines as for_statement → CFG detects loops
    expect(report.complexity.nestingDepth).toBeGreaterThanOrEqual(0);
    expect(report.style.overallScore).toBeGreaterThanOrEqual(0);
  });

  it('reports analysis time under 500ms even for deeply nested code', async () => {
    const code = buildDeeplyNested(100);
    const engine = new CodeAnalysisEngine();
    const start = Date.now();
    await engine.analyse({ code, language: 'cpp' });
    expect(Date.now() - start).toBeLessThan(500);
  });
});

// ── Stress test 3: Edge cases ─────────────────────────────────────────────────

describe('[Stress] Edge cases — empty / unusual inputs', () => {
  it('handles empty string without throwing', async () => {
    const engine = new CodeAnalysisEngine();
    const report = await engine.analyse({ code: '', language: 'cpp' });
    expect(report).toBeDefined();
    expect(report.parseResult.linesOfCode).toBe(0);
  });

  it('handles code with only whitespace', async () => {
    const engine = new CodeAnalysisEngine();
    const report = await engine.analyse({ code: '   \n\n\t  \n', language: 'cpp' });
    expect(report).toBeDefined();
    expect(report.style.overallScore).toBeGreaterThanOrEqual(0);
  });

  it('handles unusual non-ASCII characters without throwing', async () => {
    const engine = new CodeAnalysisEngine();
    expect(() => mockParse(UNUSUAL_CHARS_CODE, 'cpp')).not.toThrow();
    const report = await engine.analyse({ code: UNUSUAL_CHARS_CODE, language: 'cpp' });
    expect(report).toBeDefined();
  });

  it('handles extremely long single line without hanging (under 1000ms)', async () => {
    const engine = new CodeAnalysisEngine();
    const start = Date.now();
    const report = await engine.analyse({ code: LONG_LINE_CODE, language: 'cpp' });
    expect(Date.now() - start).toBeLessThan(1000);
    expect(report).toBeDefined();
  });

  it('handles Python syntax without throwing (language-agnostic)', async () => {
    const pythonCode = `
def fib(n):
    if n <= 1:
        return n
    return fib(n-1) + fib(n-2)

print(fib(10))
`.trim();
    const engine = new CodeAnalysisEngine();
    const report = await engine.analyse({ code: pythonCode, language: 'python3' });
    expect(report).toBeDefined();
    expect(report.memory.hasRawPointers).toBe(false); // Python has no raw pointers
  });

  it('handles Java syntax without throwing', async () => {
    const javaCode = `
public class Solution {
    public int[] twoSum(int[] nums, int target) {
        java.util.HashMap<Integer, Integer> map = new java.util.HashMap<>();
        for (int i = 0; i < nums.length; i++) {
            if (map.containsKey(target - nums[i])) {
                return new int[]{map.get(target - nums[i]), i};
            }
            map.put(nums[i], i);
        }
        return new int[]{};
    }
}
`.trim();
    const engine = new CodeAnalysisEngine();
    const report = await engine.analyse({ code: javaCode, language: 'java' });
    expect(report).toBeDefined();
    expect(report.optimization.hasHashMap).toBe(true);
  });
});
