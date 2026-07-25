/**
 * Code Analysis Engine — shared types across all analysis layers.
 *
 * Pipeline:
 *   Source Code
 *     ↓  [1] Tree-sitter AST Parse
 *   ParsedAST
 *     ↓  [2] CFG Builder
 *   ControlFlowGraph
 *     ↓  [3–8] Six parallel analysis layers
 *   CodeAnalysisReport
 *
 * All types are plain data — no methods, no I/O.
 */

import type { Language } from '@codeon/core';

// ── Source Input ──────────────────────────────────────────────────────────────

export interface AnalysisInput {
  readonly code: string;
  readonly language: Language;
  /** Optional: compiler/runtime error output for deeper mistake detection */
  readonly errorOutput?: string;
  /** Optional: execution verdict for context-aware analysis */
  readonly executionVerdict?: string;
  /** Failing test input — helps detect off-by-one / edge case patterns */
  readonly failingTestInput?: string;
}

// ── AST Types (Tree-sitter wrapper) ──────────────────────────────────────────

export interface ASTNode {
  readonly type: string;
  readonly text: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly startCol: number;
  readonly endCol: number;
  readonly children: ASTNode[];
  readonly isNamed: boolean;
  readonly hasError: boolean;
}

export interface ParseResult {
  readonly root: ASTNode;
  readonly language: Language;
  readonly hasParseErrors: boolean;
  readonly parseErrorMessages: string[];
  readonly linesOfCode: number;
  readonly characterCount: number;
}

// ── Control Flow Graph ────────────────────────────────────────────────────────

export type CFGNodeType =
  | 'entry'
  | 'exit'
  | 'statement'
  | 'condition'        // if/else branch point
  | 'loop_header'      // for/while condition check
  | 'loop_body'
  | 'loop_increment'
  | 'switch_case'
  | 'return'
  | 'break'
  | 'continue'
  | 'function_call'
  | 'try'
  | 'catch';

export interface CFGNode {
  readonly id: string;              // Unique within the CFG (e.g., "n_12")
  readonly type: CFGNodeType;
  readonly statements: ASTNode[];   // AST nodes in this basic block
  readonly startLine: number;
  readonly endLine: number;
}

export type CFGEdgeType =
  | 'sequential'       // Normal control flow
  | 'true_branch'      // Condition evaluated to true
  | 'false_branch'     // Condition evaluated to false
  | 'loop_back'        // Back edge (creates cycle)
  | 'exception'        // Exception thrown
  | 'break_exit'       // break statement
  | 'continue_back';   // continue statement

export interface CFGEdge {
  readonly from: string;   // CFGNode id
  readonly to: string;     // CFGNode id
  readonly type: CFGEdgeType;
}

export interface ControlFlowGraph {
  readonly nodes: Map<string, CFGNode>;
  readonly edges: CFGEdge[];
  readonly entryNodeId: string;
  readonly exitNodeId: string;
  /** Back edges (loop_back) — presence indicates loops */
  readonly backEdges: CFGEdge[];
  /** Maximum nesting depth computed from DFS */
  readonly maxNestingDepth: number;
  /** All cycles (loops) detected in the graph */
  readonly loopCount: number;
}

// ── Analysis Layer Results ────────────────────────────────────────────────────

/** Layer 1: Syntax validation */
export interface SyntaxAnalysis {
  readonly isValid: boolean;
  readonly errors: SyntaxError[];
  readonly warnings: SyntaxWarning[];
}

export interface SyntaxError {
  readonly line: number;
  readonly column: number;
  readonly message: string;
  readonly severity: 'error' | 'fatal';
}

export interface SyntaxWarning {
  readonly line: number;
  readonly column: number;
  readonly message: string;
}

/** Layer 2: Complexity estimation from CFG */
export interface ComplexityAnalysis {
  /** Big-O time complexity string (e.g., "O(n²)") */
  readonly timeComplexity: string;
  /** Big-O space complexity string (e.g., "O(n)") */
  readonly spaceComplexity: string;
  /** Raw nesting depth from CFG (1 = no loops, 2 = single loop, etc.) */
  readonly nestingDepth: number;
  /** Number of distinct loops */
  readonly loopCount: number;
  /** Whether recursion is detected */
  readonly hasRecursion: boolean;
  /** Confidence in the estimation: 'certain' | 'probable' | 'estimated' */
  readonly confidence: 'certain' | 'probable' | 'estimated';
  /** Human-readable explanation */
  readonly explanation: string;
}

/** Layer 3: Semantic analysis */
export interface SemanticAnalysis {
  /** Variables declared but never used */
  readonly unusedVariables: VariableInfo[];
  /** Variables used before initialization */
  readonly uninitializedVariables: VariableInfo[];
  /** Code blocks that can never be reached */
  readonly unreachableCode: UnreachableBlock[];
  /** Functions defined but never called */
  readonly unusedFunctions: FunctionInfo[];
}

export interface VariableInfo {
  readonly name: string;
  readonly line: number;
  readonly type?: string;
}

export interface UnreachableBlock {
  readonly startLine: number;
  readonly endLine: number;
  readonly reason: string;
}

export interface FunctionInfo {
  readonly name: string;
  readonly line: number;
  readonly paramCount: number;
}

/** Layer 4: Memory analysis (C++ focused) */
export interface MemoryAnalysis {
  readonly hasRawPointers: boolean;
  readonly hasMalloc: boolean;
  readonly hasPotentialLeak: boolean;
  readonly largeStackAllocations: StackAllocation[];
  readonly issues: MemoryIssue[];
}

export interface StackAllocation {
  readonly line: number;
  readonly estimatedBytes: number;
  readonly declaration: string;
}

export interface MemoryIssue {
  readonly type: 'potential_leak' | 'large_allocation' | 'raw_pointer' | 'unchecked_null';
  readonly line: number;
  readonly description: string;
  readonly severity: 'low' | 'medium' | 'high';
}

/** Layer 5: Style analysis → feeds StyleSignals for StyleEvolution engine */
export interface StyleAnalysis {
  /** 0.0–1.0 score for naming quality */
  readonly namingScore: number;
  readonly singleLetterVariables: VariableInfo[];
  readonly magicNumbers: MagicNumber[];
  readonly longFunctions: FunctionInfo[];
  /** Average function length in lines */
  readonly avgFunctionLength: number;
  /** Max function length in lines */
  readonly maxFunctionLength: number;
  /** Whether helper functions are used */
  readonly usesHelperFunctions: boolean;
  /** Whether modern C++ features (auto, range-for, constexpr) are used */
  readonly usesModernFeatures: boolean;
  /** Whether descriptive variable names are used (len >= 3 chars generally) */
  readonly usesDescriptiveNames: boolean;
  /** Comment density (comments per 10 lines) */
  readonly commentDensity: number;
  /** Overall style score 0–100 */
  readonly overallScore: number;
}

export interface MagicNumber {
  readonly value: string;
  readonly line: number;
  readonly context: string;
}

/** Layer 6: Optimization signal detection → feeds Trail Engine */
export interface OptimizationSignals {
  /** Mirrors CodePatternSignals from trail-engine for direct consumption */
  readonly nestedLoopDepth: number;
  readonly hasSortingCall: boolean;
  readonly hasBinarySearch: boolean;
  readonly hasHashMap: boolean;
  readonly hasTwoPointers: boolean;
  readonly hasMonotonicStructure: boolean;
  readonly hasDPTable: boolean;
  readonly hasGraphStructure: boolean;
  readonly hasHeap: boolean;
  readonly hasAdvancedDS: boolean;
  readonly hasDSU: boolean;
  readonly hasPrefixSum: boolean;
  readonly hasSlidingWindow: boolean;
  /** Raw detected data structures and algorithms */
  readonly detectedStructures: string[];
}

// ── Aggregated Report ─────────────────────────────────────────────────────────

export interface CodeAnalysisReport {
  readonly input: AnalysisInput;
  readonly parseResult: ParseResult;
  readonly cfg: ControlFlowGraph;
  readonly syntax: SyntaxAnalysis;
  readonly complexity: ComplexityAnalysis;
  readonly semantic: SemanticAnalysis;
  readonly memory: MemoryAnalysis;
  readonly style: StyleAnalysis;
  readonly optimization: OptimizationSignals;
  /** Total time to complete all analysis layers in milliseconds */
  readonly analysisTimeMs: number;
  readonly analysisTimestamp: Date;
}
