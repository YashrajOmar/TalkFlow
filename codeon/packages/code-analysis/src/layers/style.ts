/**
 * Style Analyser — detects code style quality signals that feed the StyleEvolution engine.
 *
 * Produces StyleAnalysis which maps directly onto StyleSignals from style-evolution.ts.
 * Every signal is purely syntactic — no AI needed.
 *
 * Detection:
 *   - Variable name quality (length, descriptiveness)
 *   - Magic numbers (literal numbers that should be named constants)
 *   - Helper function usage
 *   - Modern C++ feature usage (auto, constexpr, range-for)
 *   - Comment density
 *   - Function length violations
 */

import type { ASTNode, StyleAnalysis, VariableInfo, MagicNumber, FunctionInfo } from '../types.js';

const SINGLE_LETTER_EXCEPTIONS = new Set(['i', 'j', 'k', 'n', 'm', 'x', 'y', 'z']);
const MAGIC_NUMBER_EXCEPTIONS = new Set(['0', '1', '2', '-1', '10', '100', '1000']);

/**
 * Check if a variable name is "descriptive" (>= 3 chars, not a single letter).
 */
function isDescriptiveName(name: string): boolean {
  if (name.length <= 1) return false;
  if (name.length === 1 && !SINGLE_LETTER_EXCEPTIONS.has(name)) return false;
  return name.length >= 3;
}

function extractVariableDeclarations(root: ASTNode): ASTNode[] {
  const vars: ASTNode[] = [];
  function walk(node: ASTNode): void {
    if (
      node.type === 'declaration' ||
      node.type === 'variable_declarator' ||
      node.type === 'init_declarator'
    ) {
      vars.push(node);
    }
    node.children.forEach(walk);
  }
  walk(root);
  return vars;
}

function extractFunctionDefinitions(root: ASTNode): ASTNode[] {
  const fns: ASTNode[] = [];
  function walk(node: ASTNode): void {
    if (node.type === 'function_definition') {
      fns.push(node);
    }
    node.children.forEach(walk);
  }
  walk(root);
  return fns;
}

function extractCommentNodes(root: ASTNode): ASTNode[] {
  const comments: ASTNode[] = [];
  function walk(node: ASTNode): void {
    if (node.type === 'comment' || node.type === 'line_comment' || node.type === 'block_comment') {
      comments.push(node);
    }
    node.children.forEach(walk);
  }
  walk(root);
  return comments;
}

function detectMagicNumbers(root: ASTNode): MagicNumber[] {
  const magic: MagicNumber[] = [];

  // Strategy 1: structured walk for number_literal nodes (real Tree-sitter)
  function walk(node: ASTNode): void {
    if (node.type === 'number_literal' || node.type === 'integer_literal') {
      if (!MAGIC_NUMBER_EXCEPTIONS.has(node.text)) {
        magic.push({
          value: node.text,
          line: node.startLine,
          context: node.text,
        });
      }
    }
    node.children.forEach(walk);
  }
  walk(root);

  // Strategy 2: text-based fallback for mock/flat ASTs
  // Scan root text for large number literals not in exception set
  if (magic.length === 0) {
    const matches = root.text.matchAll(/\b(\d{5,})\b/g);
    let line = 0;
    for (const match of matches) {
      const val = match[1];
      if (!MAGIC_NUMBER_EXCEPTIONS.has(val)) {
        magic.push({ value: val, line, context: val });
        line++;
      }
      if (magic.length >= 10) break;
    }
  }

  return magic.slice(0, 10);
}

function detectModernFeatures(root: ASTNode): boolean {
  const fullText = root.text;
  return (
    fullText.includes('auto ') ||
    fullText.includes('constexpr') ||
    fullText.includes('auto&') ||
    fullText.includes('range') ||
    fullText.includes('emplace_back') ||
    fullText.includes('structured_binding') ||
    fullText.includes('auto [')
  );
}

function detectHelperFunctions(root: ASTNode): boolean {
  // More than 1 function definition suggests helper function usage
  let functionCount = 0;
  function walk(node: ASTNode): void {
    if (node.type === 'function_definition') functionCount++;
    node.children.forEach(walk);
  }
  walk(root);
  return functionCount > 1;
}

/**
 * Analyse style signals from the AST root.
 * Pure function — no I/O.
 */
export function analyseStyle(root: ASTNode, totalLines: number): StyleAnalysis {
  const varDecls = extractVariableDeclarations(root);
  const fnDefs = extractFunctionDefinitions(root);
  const comments = extractCommentNodes(root);
  const magicNumbers = detectMagicNumbers(root);

  // Single letter variables
  const singleLetterVars: VariableInfo[] = [];
  let descriptiveCount = 0;

  for (const decl of varDecls) {
    const nameNode = decl.children.find(
      (c) => c.type === 'identifier' || c.type === 'declarator_id'
    );
    if (!nameNode) continue;
    const name = nameNode.text.trim();

    if (name.length === 1 && !SINGLE_LETTER_EXCEPTIONS.has(name)) {
      singleLetterVars.push({ name, line: nameNode.startLine });
    } else if (isDescriptiveName(name)) {
      descriptiveCount++;
    }
  }

  const namingScore =
    varDecls.length > 0
      ? Math.max(0, 1 - singleLetterVars.length / varDecls.length)
      : 1.0;
  const usesDescriptiveNames = descriptiveCount > varDecls.length * 0.6;

  // Function analysis
  const longFunctions: FunctionInfo[] = [];
  let totalFnLines = 0;
  let maxFnLines = 0;

  for (const fn of fnDefs) {
    const fnLines = fn.endLine - fn.startLine;
    totalFnLines += fnLines;
    maxFnLines = Math.max(maxFnLines, fnLines);

    if (fnLines > 30) {
      const nameNode = fn.children.find((c) => c.type === 'identifier');
      longFunctions.push({
        name: nameNode?.text ?? 'anonymous',
        line: fn.startLine,
        paramCount: 0,
      });
    }
  }

  const avgFunctionLength = fnDefs.length > 0 ? totalFnLines / fnDefs.length : 0;
  const commentDensity = totalLines > 0 ? (comments.length / totalLines) * 10 : 0;

  const usesModernFeatures = detectModernFeatures(root);
  const usesHelperFunctions = detectHelperFunctions(root);

  // Overall score (0–100)
  let score = 50;
  score += namingScore * 20;
  if (usesDescriptiveNames) score += 10;
  if (usesHelperFunctions) score += 10;
  if (usesModernFeatures) score += 10;
  if (commentDensity > 0.5) score += 5;
  if (magicNumbers.length > 3) score -= 10;
  if (longFunctions.length > 0) score -= 5;
  score = Math.max(0, Math.min(100, score));

  return {
    namingScore,
    singleLetterVariables: singleLetterVars,
    magicNumbers,
    longFunctions,
    avgFunctionLength,
    maxFunctionLength: maxFnLines,
    usesHelperFunctions,
    usesModernFeatures,
    usesDescriptiveNames,
    commentDensity,
    overallScore: Math.round(score),
  };
}
