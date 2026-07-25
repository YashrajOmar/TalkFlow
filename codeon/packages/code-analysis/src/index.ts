/**
 * @codeon/code-analysis — public API
 */

export { CodeAnalysisEngine } from './engine.js';
export { parseCode, mockParse, initializeParser } from './parser.js';
export { buildCFG } from './cfg-builder.js';
export { analyseComplexity } from './layers/complexity.js';
export { detectOptimizationSignals } from './layers/optimization-signals.js';
export { analyseStyle } from './layers/style.js';
export { analyseSyntax } from './layers/syntax.js';
export { analyseSemantic } from './layers/semantic.js';
export { analyseMemory } from './layers/memory.js';

export type {
  AnalysisInput,
  ASTNode,
  ParseResult,
  ControlFlowGraph,
  CFGNode,
  CFGEdge,
  CodeAnalysisReport,
  ComplexityAnalysis,
  OptimizationSignals,
  StyleAnalysis,
  SyntaxAnalysis,
  SemanticAnalysis,
  MemoryAnalysis,
} from './types.js';
