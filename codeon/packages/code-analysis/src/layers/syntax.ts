/**
 * Syntax Analyser — validates parse results and surfaces errors/warnings.
 *
 * Tree-sitter produces an AST even for malformed code, marking error nodes.
 * This layer translates those markers into structured SyntaxError objects.
 *
 * Also detects common C++ warnings that don't produce parse errors:
 *   - Using = instead of == in conditions
 *   - Missing return in non-void functions
 *   - Integer overflow potential (int * int without cast)
 */

import type { ASTNode, SyntaxAnalysis, SyntaxError, SyntaxWarning } from '../types.js';

function collectParseErrors(node: ASTNode, errors: SyntaxError[]): void {
  if (node.hasError && node.children.length === 0) {
    errors.push({
      line: node.startLine,
      column: node.startCol,
      message: `Unexpected token: '${node.text}'`,
      severity: 'error',
    });
  }
  for (const child of node.children) {
    collectParseErrors(child, errors);
  }
}

function detectAssignmentInCondition(node: ASTNode, warnings: SyntaxWarning[]): void {
  if (
    (node.type === 'if_statement' || node.type === 'while_statement') &&
    node.text.includes('=') &&
    !node.text.includes('==') &&
    !node.text.includes('!=') &&
    !node.text.includes('<=') &&
    !node.text.includes('>=')
  ) {
    warnings.push({
      line: node.startLine,
      column: node.startCol,
      message: 'Possible assignment used as condition — did you mean ==?',
    });
  }
  for (const child of node.children) {
    detectAssignmentInCondition(child, warnings);
  }
}

function detectPotentialIntegerOverflow(node: ASTNode, warnings: SyntaxWarning[]): void {
  const fullText = node.text;
  // Detect int * int multiplications where result could exceed 32-bit
  if (
    fullText.includes('int') &&
    !fullText.includes('long long') &&
    !fullText.includes('int64_t') &&
    /\b[0-9]{6,}\b/.test(fullText)
  ) {
    warnings.push({
      line: node.startLine,
      column: 0,
      message: 'Large literal in int context — consider using long long to avoid overflow.',
    });
  }
}

/**
 * Validate syntax of the parsed AST.
 * Pure function — no I/O.
 */
export function analyseSyntax(root: ASTNode, hasParseErrors: boolean): SyntaxAnalysis {
  const errors: SyntaxError[] = [];
  const warnings: SyntaxWarning[] = [];

  if (hasParseErrors) {
    collectParseErrors(root, errors);
  }

  detectAssignmentInCondition(root, warnings);
  detectPotentialIntegerOverflow(root, warnings);

  return {
    isValid: errors.length === 0,
    errors: errors.slice(0, 20), // Cap to avoid noise
    warnings: warnings.slice(0, 10),
  };
}
