/**
 * Semantic Analyser — detects logical issues from the AST.
 *
 * Covers:
 *   - Unused variable declarations
 *   - Variables used before initialization (uninitialized)
 *   - Unused function definitions
 *
 * Note: Full data-flow analysis (use-def chains, liveness) requires the CFG
 * and is planned for Milestone 3. This layer provides heuristic detection
 * that catches the most common patterns without full flow analysis.
 */

import type { ASTNode, SemanticAnalysis, VariableInfo, FunctionInfo } from '../types.js';

interface VarRecord {
  name: string;
  line: number;
  declared: boolean;
  used: boolean;
  initialized: boolean;
}

function collectIdentifiers(node: ASTNode): Set<string> {
  const ids = new Set<string>();
  function walk(n: ASTNode): void {
    if (n.type === 'identifier') ids.add(n.text);
    n.children.forEach(walk);
  }
  walk(node);
  return ids;
}

function collectDeclarations(root: ASTNode): VarRecord[] {
  const records: VarRecord[] = [];
  const allIds = collectIdentifiers(root);

  function walk(node: ASTNode): void {
    if (node.type === 'declaration' || node.type === 'variable_declarator') {
      const nameNode = node.children.find((c) => c.type === 'identifier');
      if (!nameNode) return;

      const name = nameNode.text;
      const hasInit = node.children.some(
        (c) => c.type === 'init_declarator' || c.type === '=' || c.type === 'number_literal'
      );

      records.push({
        name,
        line: nameNode.startLine,
        declared: true,
        used: allIds.has(name),
        initialized: hasInit,
      });
    }
    node.children.forEach(walk);
  }

  walk(root);
  return records;
}

function collectFunctionDefs(root: ASTNode): Array<{ name: string; line: number; paramCount: number }> {
  const fns: Array<{ name: string; line: number; paramCount: number }> = [];

  function walk(node: ASTNode): void {
    if (node.type === 'function_definition') {
      const declarator = node.children.find((c) => c.type === 'function_declarator');
      const nameNode = declarator?.children.find((c) => c.type === 'identifier');
      if (nameNode && nameNode.text !== 'main') {
        const paramList = declarator?.children.find((c) => c.type === 'parameter_list');
        const paramCount = paramList?.children.filter((c) => c.type === 'parameter_declaration').length ?? 0;
        fns.push({ name: nameNode.text, line: nameNode.startLine, paramCount });
      }
    }
    node.children.forEach(walk);
  }

  walk(root);
  return fns;
}

/**
 * Analyse semantic issues from the AST.
 * Pure function — no I/O.
 */
export function analyseSemantic(root: ASTNode): SemanticAnalysis {
  const vars = collectDeclarations(root);
  const fns = collectFunctionDefs(root);

  const allText = root.text;

  const unusedVariables: VariableInfo[] = vars
    .filter((v) => {
      // A variable is "unused" if its name appears only once in the full text (its declaration)
      const occurrences = (allText.match(new RegExp(`\\b${v.name}\\b`, 'g')) ?? []).length;
      return occurrences <= 1;
    })
    .slice(0, 10)
    .map((v) => ({ name: v.name, line: v.line }));

  const uninitializedVariables: VariableInfo[] = vars
    .filter((v) => !v.initialized)
    .slice(0, 5)
    .map((v) => ({ name: v.name, line: v.line }));

  const unusedFunctions: FunctionInfo[] = fns
    .filter((fn) => {
      const callOccurrences = (allText.match(new RegExp(`\\b${fn.name}\\s*\\(`, 'g')) ?? []).length;
      return callOccurrences <= 1; // Only definition, no calls
    })
    .slice(0, 5)
    .map((fn) => ({ name: fn.name, line: fn.line, paramCount: fn.paramCount }));

  return {
    unusedVariables,
    uninitializedVariables,
    unreachableCode: [], // Full CFG-based analysis in future milestone
    unusedFunctions,
  };
}
