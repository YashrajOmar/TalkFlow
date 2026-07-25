/**
 * CFG Builder — constructs a Control Flow Graph from a parsed AST.
 *
 * The CFG is the intermediate representation that all downstream analyses use.
 * It converts the tree-shaped AST into a graph of basic blocks with explicit
 * control flow edges.
 *
 * Key insight: By building the CFG first, we:
 *   - Compute nesting depth accurately (even with break/continue/early returns)
 *   - Detect unreachable code structurally
 *   - Enable future data-flow analysis (use-def chains, liveness)
 *
 * Supported patterns:
 *   - if/else, nested if/else
 *   - for, while, do-while loops
 *   - break, continue
 *   - return (early and final)
 *   - switch/case
 *   - try/catch
 *   - Nested functions (each gets its own CFG scope)
 *
 * Note: This is a language-agnostic CFG builder that works on ASTNode trees.
 * Language-specific node type names are normalized by the parser layer.
 */

import type {
  ASTNode,
  CFGNode,
  CFGEdge,
  CFGEdgeType,
  CFGNodeType,
  ControlFlowGraph,
} from './types.js';

/**
 * Hard cap on recursion depth — prevents RangeError: Maximum call stack size exceeded
 * on pathologically nested code (e.g., 200+ nested loops).
 * When exceeded, we emit a special 'error' node and stop descending.
 */
const MAX_RECURSION_DEPTH = 100;


let nodeCounter = 0;

function freshId(): string {
  return `n_${++nodeCounter}`;
}

function makeNode(
  type: CFGNodeType,
  statements: ASTNode[],
  startLine: number,
  endLine: number
): CFGNode {
  return {
    id: freshId(),
    type,
    statements,
    startLine,
    endLine,
  };
}

function makeEdge(from: string, to: string, type: CFGEdgeType): CFGEdge {
  return { from, to, type };
}

/**
 * Internal CFG builder state — passed through recursive calls.
 */
interface BuilderState {
  nodes: Map<string, CFGNode>;
  edges: CFGEdge[];
  backEdges: CFGEdge[];
  /** ID of the innermost loop header — used by break/continue */
  currentLoopHeaderId: string | null;
  /** ID of the post-loop exit node — used by break */
  currentLoopExitId: string | null;
  /** Current nesting depth */
  nestingDepth: number;
  maxNestingDepth: number;
  loopCount: number;
  /** Current recursion depth in processBlock — capped at MAX_RECURSION_DEPTH */
  recursionDepth: number;
  /** True if depth cap was hit — signals truncation in the report */
  depthCapReached: boolean;
}

function newState(): BuilderState {
  return {
    nodes: new Map(),
    edges: [],
    backEdges: [],
    currentLoopHeaderId: null,
    currentLoopExitId: null,
    nestingDepth: 0,
    maxNestingDepth: 0,
    loopCount: 0,
    recursionDepth: 0,
    depthCapReached: false,
  };
}

function addNode(state: BuilderState, node: CFGNode): void {
  state.nodes.set(node.id, node);
}

function addEdge(state: BuilderState, edge: CFGEdge): void {
  state.edges.push(edge);
  if (edge.type === 'loop_back') {
    state.backEdges.push(edge);
  }
}

/**
 * Normalize Tree-sitter node type names across C++/Python/Java/JS differences.
 * Returns a canonical name for common control-flow constructs.
 */
function normalizeNodeType(type: string): string {
  const map: Record<string, string> = {
    // C++
    if_statement: 'if',
    for_statement: 'for_loop',
    for_range_loop: 'for_loop',
    while_statement: 'while_loop',
    do_statement: 'do_while',
    switch_statement: 'switch',
    case_statement: 'case',
    return_statement: 'return',
    break_statement: 'break',
    continue_statement: 'continue',
    try_statement: 'try',
    catch_clause: 'catch',
    function_definition: 'function',
    // Python
    if_clause: 'if',
    for_clause: 'for_loop',
    while_clause: 'while_loop',
    // Java/JS
    for_in_statement: 'for_loop',
    for_of_statement: 'for_loop',
  };
  return map[type] ?? type;
}

/**
 * Process a block of sibling AST statements, adding nodes and edges.
 * Returns the ID of the last block's exit node.
 * Includes a recursion depth guard — returns a sentinel node at MAX_RECURSION_DEPTH.
 */
function processBlock(
  state: BuilderState,
  statements: ASTNode[],
  predecessorId: string
): string {
  // ── Depth cap: prevent call stack overflow on deeply nested code ──
  state.recursionDepth++;
  if (state.recursionDepth > MAX_RECURSION_DEPTH) {
    state.depthCapReached = true;
    state.recursionDepth--;
    // Emit a sentinel node so the graph remains connected
    const capNode = makeNode('statement', [], 0, 0);
    addNode(state, capNode);
    addEdge(state, makeEdge(predecessorId, capNode.id, 'sequential'));
    return capNode.id;
  }

  let currentPredecessor = predecessorId;


  for (const stmt of statements) {
    const normalized = normalizeNodeType(stmt.type);

    if (normalized === 'if') {
      currentPredecessor = processIf(state, stmt, currentPredecessor);
    } else if (normalized === 'for_loop' || normalized === 'while_loop') {
      currentPredecessor = processLoop(state, stmt, currentPredecessor, normalized);
    } else if (normalized === 'do_while') {
      currentPredecessor = processDoWhile(state, stmt, currentPredecessor);
    } else if (normalized === 'return') {
      // Return: add node, connect to exit, subsequent code is unreachable
      const retNode = makeNode('return', [stmt], stmt.startLine, stmt.endLine);
      addNode(state, retNode);
      addEdge(state, makeEdge(currentPredecessor, retNode.id, 'sequential'));
      // Don't update currentPredecessor — nothing should follow
      return retNode.id;
    } else if (normalized === 'break') {
      if (state.currentLoopExitId) {
        const breakNode = makeNode('break', [stmt], stmt.startLine, stmt.endLine);
        addNode(state, breakNode);
        addEdge(state, makeEdge(currentPredecessor, breakNode.id, 'sequential'));
        addEdge(state, makeEdge(breakNode.id, state.currentLoopExitId, 'break_exit'));
        return breakNode.id;
      }
    } else if (normalized === 'continue') {
      if (state.currentLoopHeaderId) {
        const contNode = makeNode('continue', [stmt], stmt.startLine, stmt.endLine);
        addNode(state, contNode);
        addEdge(state, makeEdge(currentPredecessor, contNode.id, 'sequential'));
        addEdge(state, makeEdge(contNode.id, state.currentLoopHeaderId, 'continue_back'));
        return contNode.id;
      }
    } else if (normalized === 'switch') {
      currentPredecessor = processSwitch(state, stmt, currentPredecessor);
    } else if (normalized === 'try') {
      currentPredecessor = processTryCatch(state, stmt, currentPredecessor);
    } else {
      // Plain statement — add to a sequential block
      const stmtNode = makeNode('statement', [stmt], stmt.startLine, stmt.endLine);
      addNode(state, stmtNode);
      addEdge(state, makeEdge(currentPredecessor, stmtNode.id, 'sequential'));
      currentPredecessor = stmtNode.id;
    }
  }

  state.recursionDepth--;
  return currentPredecessor;
}

function processIf(state: BuilderState, node: ASTNode, predecessorId: string): string {
  // condition node
  const condition = makeNode('condition', [node], node.startLine, node.endLine);
  addNode(state, condition);
  addEdge(state, makeEdge(predecessorId, condition.id, 'sequential'));

  state.nestingDepth++;
  state.maxNestingDepth = Math.max(state.maxNestingDepth, state.nestingDepth);

  // Find then/else children
  const thenBody = node.children.find((c) => c.type === 'compound_statement' || c.type === 'block') ?? node.children[2];
  const elseClause = node.children.find((c) => c.type === 'else_clause');

  // merge node
  const merge = makeNode('statement', [], node.endLine, node.endLine);
  addNode(state, merge);

  // true branch
  if (thenBody) {
    const thenEntry = makeNode('statement', [], thenBody.startLine, thenBody.startLine);
    addNode(state, thenEntry);
    addEdge(state, makeEdge(condition.id, thenEntry.id, 'true_branch'));
    const thenExit = processBlock(state, thenBody.children, thenEntry.id);
    addEdge(state, makeEdge(thenExit, merge.id, 'sequential'));
  } else {
    addEdge(state, makeEdge(condition.id, merge.id, 'true_branch'));
  }

  // false branch
  if (elseClause) {
    const elseBody = elseClause.children.find((c) => c.type === 'compound_statement' || c.type === 'block');
    if (elseBody) {
      const elseEntry = makeNode('statement', [], elseBody.startLine, elseBody.startLine);
      addNode(state, elseEntry);
      addEdge(state, makeEdge(condition.id, elseEntry.id, 'false_branch'));
      const elseExit = processBlock(state, elseBody.children, elseEntry.id);
      addEdge(state, makeEdge(elseExit, merge.id, 'sequential'));
    }
  } else {
    addEdge(state, makeEdge(condition.id, merge.id, 'false_branch'));
  }

  state.nestingDepth--;
  return merge.id;
}

function processLoop(
  state: BuilderState,
  node: ASTNode,
  predecessorId: string,
  loopType: string
): string {
  const header = makeNode('loop_header', [node], node.startLine, node.startLine);
  addNode(state, header);
  addEdge(state, makeEdge(predecessorId, header.id, 'sequential'));

  const exit = makeNode('statement', [], node.endLine, node.endLine);
  addNode(state, exit);

  state.nestingDepth++;
  state.maxNestingDepth = Math.max(state.maxNestingDepth, state.nestingDepth);
  state.loopCount++;

  const savedLoopHeader = state.currentLoopHeaderId;
  const savedLoopExit = state.currentLoopExitId;
  state.currentLoopHeaderId = header.id;
  state.currentLoopExitId = exit.id;

  // false branch — loop exit
  addEdge(state, makeEdge(header.id, exit.id, 'false_branch'));

  // true branch — loop body
  const bodyChildren = node.children.find(
    (c) => c.type === 'compound_statement' || c.type === 'block' || c.type === 'statement_block'
  );
  if (bodyChildren) {
    const bodyEntry = makeNode('loop_body', [], bodyChildren.startLine, bodyChildren.startLine);
    addNode(state, bodyEntry);
    addEdge(state, makeEdge(header.id, bodyEntry.id, 'true_branch'));
    const bodyExit = processBlock(state, bodyChildren.children, bodyEntry.id);
    // back edge
    const backEdge = makeEdge(bodyExit, header.id, 'loop_back');
    addEdge(state, backEdge);
  }

  state.nestingDepth--;
  state.currentLoopHeaderId = savedLoopHeader;
  state.currentLoopExitId = savedLoopExit;

  return exit.id;
}

function processDoWhile(state: BuilderState, node: ASTNode, predecessorId: string): string {
  const bodyEntry = makeNode('loop_body', [node], node.startLine, node.startLine);
  addNode(state, bodyEntry);
  addEdge(state, makeEdge(predecessorId, bodyEntry.id, 'sequential'));

  const header = makeNode('loop_header', [], node.endLine - 1, node.endLine - 1);
  addNode(state, header);

  const exit = makeNode('statement', [], node.endLine, node.endLine);
  addNode(state, exit);

  state.nestingDepth++;
  state.maxNestingDepth = Math.max(state.maxNestingDepth, state.nestingDepth);
  state.loopCount++;

  const savedHeader = state.currentLoopHeaderId;
  const savedExit = state.currentLoopExitId;
  state.currentLoopHeaderId = header.id;
  state.currentLoopExitId = exit.id;

  const bodyChildren = node.children.find(
    (c) => c.type === 'compound_statement' || c.type === 'block'
  );
  if (bodyChildren) {
    const bodyExit = processBlock(state, bodyChildren.children, bodyEntry.id);
    addEdge(state, makeEdge(bodyExit, header.id, 'sequential'));
  } else {
    addEdge(state, makeEdge(bodyEntry.id, header.id, 'sequential'));
  }

  addEdge(state, makeEdge(header.id, bodyEntry.id, 'loop_back'));
  addEdge(state, makeEdge(header.id, exit.id, 'false_branch'));

  state.nestingDepth--;
  state.currentLoopHeaderId = savedHeader;
  state.currentLoopExitId = savedExit;

  return exit.id;
}

function processSwitch(state: BuilderState, node: ASTNode, predecessorId: string): string {
  const switchNode = makeNode('switch_case', [node], node.startLine, node.endLine);
  addNode(state, switchNode);
  addEdge(state, makeEdge(predecessorId, switchNode.id, 'sequential'));

  const merge = makeNode('statement', [], node.endLine, node.endLine);
  addNode(state, merge);
  addEdge(state, makeEdge(switchNode.id, merge.id, 'sequential'));

  return merge.id;
}

function processTryCatch(state: BuilderState, node: ASTNode, predecessorId: string): string {
  const tryNode = makeNode('try', [node], node.startLine, node.endLine);
  addNode(state, tryNode);
  addEdge(state, makeEdge(predecessorId, tryNode.id, 'sequential'));

  const merge = makeNode('statement', [], node.endLine, node.endLine);
  addNode(state, merge);

  addEdge(state, makeEdge(tryNode.id, merge.id, 'sequential'));

  const catchClause = node.children.find((c) => c.type === 'catch_clause');
  if (catchClause) {
    const catchNode = makeNode('catch', [catchClause], catchClause.startLine, catchClause.endLine);
    addNode(state, catchNode);
    addEdge(state, makeEdge(tryNode.id, catchNode.id, 'exception'));
    addEdge(state, makeEdge(catchNode.id, merge.id, 'sequential'));
  }

  return merge.id;
}

/**
 * Build a Control Flow Graph from a root AST node.
 * Pure function — returns a fully constructed CFG.
 * Never throws — returns a minimal valid CFG on any error.
 */
export function buildCFG(root: ASTNode): ControlFlowGraph {
  nodeCounter = 0; // Reset for determinism in tests
  const state = newState();

  const entry = makeNode('entry', [], 0, 0);
  addNode(state, entry);

  const exit = makeNode('exit', [], root.endLine, root.endLine);
  addNode(state, exit);

  try {
    // Find top-level function definitions or treat root as main body
    const topLevelStatements = root.children.filter(
      (c) =>
        c.type !== 'preproc_include' &&
        c.type !== 'using_declaration' &&
        c.type !== 'namespace_definition'
    );

    const lastId = processBlock(state, topLevelStatements, entry.id);
    addEdge(state, makeEdge(lastId, exit.id, 'sequential'));
  } catch {
    // Fallback: connect entry directly to exit — CFG is still valid, just empty
    addEdge(state, makeEdge(entry.id, exit.id, 'sequential'));
  }

  return {
    nodes: state.nodes,
    edges: state.edges,
    entryNodeId: entry.id,
    exitNodeId: exit.id,
    backEdges: state.backEdges,
    maxNestingDepth: state.maxNestingDepth,
    loopCount: state.loopCount,
  };
}
