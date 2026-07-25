/**
 * Code Analysis Engine — main orchestrator.
 *
 * Runs all 6 analysis layers in a defined pipeline:
 *   Parse → CFG → [Syntax, Complexity, Semantic, Memory, Style, Optimization]
 *
 * All layers run synchronously after parsing.
 * The report is assembled from all layer results.
 *
 * Usage:
 *   const engine = new CodeAnalysisEngine();
 *   const report = await engine.analyse({ code, language });
 */

import { parseCode } from './parser.js';
import { buildCFG } from './cfg-builder.js';
import { analyseSyntax } from './layers/syntax.js';
import { analyseComplexity } from './layers/complexity.js';
import { analyseSemantic } from './layers/semantic.js';
import { analyseMemory } from './layers/memory.js';
import { analyseStyle } from './layers/style.js';
import { detectOptimizationSignals } from './layers/optimization-signals.js';
import type { AnalysisInput, CodeAnalysisReport } from './types.js';

export class CodeAnalysisEngine {
  /**
   * Run the full 6-layer analysis pipeline.
   * Never throws — errors are captured in the report.
   */
  async analyse(input: AnalysisInput): Promise<CodeAnalysisReport> {
    const startTime = Date.now();

    // Layer 0: Parse
    const parseResult = await parseCode(input.code, input.language);

    // Layer 0.5: CFG (intermediate representation used by layers 1–6)
    const cfg = buildCFG(parseResult.root);

    // Layers 1–6 run in parallel on the same parseResult/cfg
    const [syntax, complexity, semantic, memory, style, optimization] = [
      analyseSyntax(parseResult.root, parseResult.hasParseErrors),
      analyseComplexity(cfg, parseResult.root),
      analyseSemantic(parseResult.root),
      analyseMemory(parseResult.root, input.language),
      analyseStyle(parseResult.root, parseResult.linesOfCode),
      detectOptimizationSignals(parseResult.root),
    ];

    return {
      input,
      parseResult,
      cfg,
      syntax,
      complexity,
      semantic,
      memory,
      style,
      optimization,
      analysisTimeMs: Date.now() - startTime,
      analysisTimestamp: new Date(),
    };
  }

  /**
   * Convenience: analyse and return only the optimization signals.
   * Used by the Trail Engine integration point.
   */
  async getOptimizationSignals(input: AnalysisInput) {
    const report = await this.analyse(input);
    return report.optimization;
  }

  /**
   * Convenience: analyse and return only style signals.
   * Used by the StyleEvolution engine integration point.
   */
  async getStyleSignals(input: AnalysisInput) {
    const report = await this.analyse(input);
    return report.style;
  }
}
