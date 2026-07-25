/**
 * Tree-sitter Parser Adapter — bridges web-tree-sitter to our internal ASTNode types.
 *
 * This is the ONLY file in the code-analysis package that touches web-tree-sitter directly.
 * Every other module works with our internal ASTNode type.
 *
 * Design decisions:
 *   1. Parser is initialized lazily and cached — WASM loading is expensive (~50ms)
 *   2. Language grammars are loaded on-demand and cached per language
 *   3. The parser is stateless after initialization — safe for concurrent use
 *   4. If WASM is unavailable (test env), falls back to a deterministic mock parser
 *
 * Supported languages: cpp, python3, java, javascript, typescript
 * (Others fall back to a text-only structural parser)
 */

import type { Language } from '@codeon/core';
import type { ASTNode, ParseResult } from './types.js';

// ── Internal Tree-sitter types (avoid importing tree-sitter directly in tests) ─

interface TreeSitterNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  children: TreeSitterNode[];
  isNamed: boolean;
  hasError: boolean;
}

interface TreeSitterTree {
  rootNode: TreeSitterNode;
}

// ── Conversion ────────────────────────────────────────────────────────────────

function convertNode(node: TreeSitterNode): ASTNode {
  return {
    type: node.type,
    text: node.text,
    startLine: node.startPosition.row,
    endLine: node.endPosition.row,
    startCol: node.startPosition.column,
    endCol: node.endPosition.column,
    children: node.children.map(convertNode),
    isNamed: node.isNamed,
    hasError: node.hasError,
  };
}

// ── Language-to-WASM mapping ──────────────────────────────────────────────────

const LANGUAGE_WASM_MAP: Partial<Record<Language, string>> = {
  cpp: 'tree-sitter-cpp.wasm',
  cpp17: 'tree-sitter-cpp.wasm',
  cpp20: 'tree-sitter-cpp.wasm',
  c: 'tree-sitter-c.wasm',
  python3: 'tree-sitter-python.wasm',
  javascript: 'tree-sitter-javascript.wasm',
  typescript: 'tree-sitter-typescript.wasm',
  java: 'tree-sitter-java.wasm',
};

// ── Mock Parser (for tests / fallback) ───────────────────────────────────────

/**
 * Structural mock parser — produces a minimal ASTNode tree from source text
 * without tree-sitter. Used in:
 *   - Unit tests (no WASM available)
 *   - Languages without grammar files
 *   - CI environments without browser context
 */
export function mockParse(code: string, language: Language): ParseResult {
  const lines = code.split('\n');
  const linesOfCode = lines.filter((l) => l.trim() && !l.trim().startsWith('//')).length;

  // Build a flat synthetic AST from the source text
  // Recognizes common C++ patterns structurally
  const children: ASTNode[] = lines.map((line, i) => ({
    type: classifyLine(line),
    text: line,
    startLine: i,
    endLine: i,
    startCol: 0,
    endCol: line.length,
    children: [],
    isNamed: true,
    hasError: false,
  }));

  const root: ASTNode = {
    type: 'translation_unit',
    text: code,
    startLine: 0,
    endLine: lines.length - 1,
    startCol: 0,
    endCol: 0,
    children,
    isNamed: true,
    hasError: false,
  };

  return {
    root,
    language,
    hasParseErrors: false,
    parseErrorMessages: [],
    linesOfCode,
    characterCount: code.length,
  };
}

function classifyLine(line: string): string {
  const trimmed = line.trim();
  if (trimmed.startsWith('for')) return 'for_statement';
  if (trimmed.startsWith('while')) return 'while_statement';
  if (trimmed.startsWith('if')) return 'if_statement';
  if (trimmed.startsWith('return')) return 'return_statement';
  if (trimmed.startsWith('//') || trimmed.startsWith('/*')) return 'comment';
  if (trimmed.includes('(') && trimmed.endsWith('{')) return 'function_definition';
  if (trimmed.includes('=') && !trimmed.includes('==')) return 'declaration';
  return 'expression_statement';
}

// ── Real Tree-sitter Parser ───────────────────────────────────────────────────

let parserModule: unknown = null;
let isInitialized = false;
const languageCache = new Map<string, unknown>();

/**
 * Initialize the tree-sitter WASM module.
 * Must be called once before parseWithTreeSitter().
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export async function initializeParser(): Promise<boolean> {
  if (isInitialized) return true;

  try {
    // Dynamic import — allows tree-sitter to be optional in test environments
    const TreeSitter = await import('web-tree-sitter').catch(() => null);
    if (!TreeSitter) {
      console.warn('[CodeAnalysis] web-tree-sitter not available — using mock parser');
      return false;
    }

    await (TreeSitter as { init: () => Promise<void> }).init();
    parserModule = TreeSitter;
    isInitialized = true;
    return true;
  } catch {
    console.warn('[CodeAnalysis] Tree-sitter initialization failed — using mock parser');
    return false;
  }
}

/**
 * Parse source code with Tree-sitter if available, otherwise fall back to mock.
 * Always returns a ParseResult — never throws.
 */
export async function parseCode(code: string, language: Language): Promise<ParseResult> {
  if (!isInitialized || !parserModule) {
    return mockParse(code, language);
  }

  const wasmFile = LANGUAGE_WASM_MAP[language];
  if (!wasmFile) {
    // Language not supported by tree-sitter grammar — use mock
    return mockParse(code, language);
  }

  try {
    const TS = parserModule as {
      default: { Language: { load: (f: string) => Promise<unknown> }; new(): { setLanguage: (l: unknown) => void; parse: (c: string) => TreeSitterTree } };
    };

    // Load language grammar (cached)
    if (!languageCache.has(language)) {
      const lang = await TS.default.Language.load(wasmFile);
      languageCache.set(language, lang);
    }

    const langGrammar = languageCache.get(language);
    const parser = new TS.default();
    parser.setLanguage(langGrammar);
    const tree = parser.parse(code);
    const root = convertNode(tree.rootNode);
    const lines = code.split('\n');
    const linesOfCode = lines.filter((l) => l.trim() && !l.trim().startsWith('//')).length;

    return {
      root,
      language,
      hasParseErrors: root.hasError,
      parseErrorMessages: root.hasError ? ['Parse error detected in source code'] : [],
      linesOfCode,
      characterCount: code.length,
    };
  } catch (err) {
    console.error('[CodeAnalysis] Parse failed:', err);
    return mockParse(code, language);
  }
}
