/**
 * Session Classifier — deterministic mode detection.
 *
 * Classifies each incoming session into one of four operating modes:
 *   problem    — Known problem URL/ID present and resolvable
 *   scratchpad — No known problem; open-ended engineering session
 *   interview  — Explicit interview simulation request
 *   contest    — Explicit contest mode; Teaching Engine gated
 *
 * This is purely deterministic — no AI involved.
 * The session mode gates which pipeline is activated downstream.
 */

import type { SessionMode, Language } from './entities/common.js';

export interface SessionClassifierInput {
  /** Direct problem URL (e.g., https://leetcode.com/problems/two-sum/) */
  readonly problemUrl?: string;
  /** Pre-resolved problem ID if already known */
  readonly problemId?: string;
  /** Explicit mode override from the client (e.g., from a UI toggle) */
  readonly explicitMode?: SessionMode;
  /** The programming language selected in the IDE */
  readonly language: Language;
  /** Custom problem text pasted by the user (no URL) */
  readonly customProblemText?: string;
}

export interface SessionClassifierResult {
  readonly mode: SessionMode;
  readonly detectedProblemId: string | null;   // null if not detectable
  readonly detectedProblemSource: string | null;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly reason: string;
}

/**
 * Known competitive programming platform URL patterns.
 */
const PLATFORM_PATTERNS: Array<{
  pattern: RegExp;
  source: string;
  extractId: (match: RegExpMatchArray) => string | null;
}> = [
  {
    pattern: /leetcode\.com\/problems\/([\w-]+)/,
    source: 'leetcode',
    extractId: (m) => m[1] ?? null,
  },
  {
    pattern: /codeforces\.com\/(?:problemset\/problem|contest\/\d+\/problem)\/([\w/]+)/,
    source: 'codeforces',
    extractId: (m) => m[1] ?? null,
  },
  {
    pattern: /atcoder\.jp\/contests\/([\w-]+)\/tasks\/([\w-]+)/,
    source: 'atcoder',
    extractId: (m) => (m[1] && m[2] ? `${m[1]}/${m[2]}` : null),
  },
  {
    pattern: /codechef\.com\/problems\/([\w]+)/,
    source: 'codechef',
    extractId: (m) => m[1] ?? null,
  },
  {
    pattern: /hackerrank\.com\/challenges\/([\w-]+)/,
    source: 'hackerrank',
    extractId: (m) => m[1] ?? null,
  },
];

/**
 * Signals that a custom problem text is a real problem statement.
 */
function looksLikeProblemStatement(text: string): boolean {
  const keywords = ['input', 'output', 'constraints', 'example', 'note'];
  const lowered = text.toLowerCase();
  const matches = keywords.filter((k) => lowered.includes(k)).length;
  return matches >= 3 && text.length > 200;
}

/**
 * Classify a session based on available inputs.
 * Pure function — no I/O.
 */
export function classifySession(input: SessionClassifierInput): SessionClassifierResult {
  // Explicit override takes priority
  if (input.explicitMode) {
    return {
      mode: input.explicitMode,
      detectedProblemId: input.problemId ?? null,
      detectedProblemSource: null,
      confidence: 'high',
      reason: `Explicit mode override: '${input.explicitMode}'`,
    };
  }

  // Pre-resolved problem ID
  if (input.problemId) {
    return {
      mode: 'problem',
      detectedProblemId: input.problemId,
      detectedProblemSource: null,
      confidence: 'high',
      reason: 'Known problem ID provided.',
    };
  }

  // URL-based detection
  if (input.problemUrl) {
    for (const { pattern, source, extractId } of PLATFORM_PATTERNS) {
      const match = input.problemUrl.match(pattern);
      if (match) {
        const id = extractId(match);
        return {
          mode: 'problem',
          detectedProblemId: id,
          detectedProblemSource: source,
          confidence: 'high',
          reason: `Recognized ${source} problem URL.`,
        };
      }
    }

    // URL present but not recognized
    return {
      mode: 'problem',
      detectedProblemId: null,
      detectedProblemSource: 'unknown',
      confidence: 'medium',
      reason: 'URL provided but platform not recognized. Will attempt semantic lookup.',
    };
  }

  // Custom problem text
  if (input.customProblemText && looksLikeProblemStatement(input.customProblemText)) {
    return {
      mode: 'problem',
      detectedProblemId: null,
      detectedProblemSource: 'custom',
      confidence: 'medium',
      reason: 'Custom problem text detected with problem statement structure.',
    };
  }

  // Default: scratchpad mode
  return {
    mode: 'scratchpad',
    detectedProblemId: null,
    detectedProblemSource: null,
    confidence: 'high',
    reason: 'No problem URL, ID, or statement provided. Entering scratchpad mode.',
  };
}
