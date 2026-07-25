/**
 * Learning Policy Engine — pedagogical decision layer between Learning Engine and Teaching Engine.
 *
 * The Policy Engine decides HOW and WHEN to intervene in the student's learning process.
 * It separates pedagogical strategy from language generation.
 *
 * The Teaching Engine receives a PolicyDecision and acts accordingly.
 * The LLM never decides when to hint — the Policy Engine does.
 *
 * Design principle:
 *   Learning Engine (WHAT the student knows)
 *       ↓
 *   Learning Policy Engine (WHEN and HOW to intervene)
 *       ↓
 *   Teaching Engine (HOW to express the intervention in natural language)
 */

import type { SessionMode, AlgorithmicLevel } from './entities/common.js';

export interface PolicyContext {
  /** Number of hints already given this session */
  readonly hintsGivenThisSession: number;
  /** Seconds since the last hint was delivered */
  readonly secondsSinceLastHint: number;
  /** Student's global Elo rating */
  readonly studentGlobalElo: number;
  /** Current optimization trail step */
  readonly currentAlgorithmicLevel: AlgorithmicLevel;
  /** How many distinct mistakes detected this session */
  readonly mistakesThisSession: number;
  /** Minutes the student has been stuck at the current trail level */
  readonly minutesStuckAtCurrentLevel: number;
  /** Whether the student explicitly clicked "Give me a hint" */
  readonly studentRequestedHint: boolean;
  /** Session mode determines policy thresholds */
  readonly sessionMode: SessionMode;
  /** Last code submission verdict */
  readonly lastVerdict: string | null;
  /** Whether the student is a first-time user */
  readonly isNewUser: boolean;
  /** How many times the student has asked for a hint today (rate limiting) */
  readonly dailyHintCount: number;
}

export type PolicyDecision =
  | {
      readonly action: 'deliver_hint';
      readonly hintType: PolicyHintType;
      readonly reason: string;
    }
  | {
      readonly action: 'wait';
      readonly waitMinutes: number;
      readonly reason: string;
    }
  | {
      readonly action: 'ask_clarifying_question';
      readonly questionPrompt: string;
      readonly reason: string;
    }
  | {
      readonly action: 'recommend_revision';
      readonly suggestion: string;
      readonly reason: string;
    }
  | {
      readonly action: 'prescribe_struggle';
      readonly targetMinutes: number;
      readonly reason: string;
    }
  | {
      readonly action: 'increase_difficulty';
      readonly reason: string;
    }
  | {
      readonly action: 'acknowledge_progress';
      readonly message: string;
    };

export type PolicyHintType =
  | 'complexity_question'    // "What is the time complexity of your current approach?"
  | 'data_structure_nudge'   // "What data structure gives O(1) lookup?"
  | 'edge_case_probe'        // "What happens when the input is empty?"
  | 'logical_flaw_pointer'   // "Look at line X — what happens when the condition is false?"
  | 'optimization_question'  // "Can you do better than O(n log n)?"
  | 'style_suggestion'       // Style evolution prescription
  | 'encouragement';         // Positive reinforcement after trail advancement

// ─── Policy Thresholds ────────────────────────────────────────────────────────

interface PolicyThresholds {
  /** Minutes before first unsolicited hint */
  readonly minutesBeforeFirstHint: number;
  /** Additional minutes between subsequent hints */
  readonly minutesBetweenHints: number;
  /** Maximum hints before recommending revision */
  readonly maxHintsBeforeRevision: number;
  /** Whether unsolicited hints are allowed */
  readonly allowUnsolicitedHints: boolean;
}

const POLICY_THRESHOLDS: Record<SessionMode, PolicyThresholds> = {
  problem: {
    minutesBeforeFirstHint: 10,
    minutesBetweenHints: 5,
    maxHintsBeforeRevision: 8,
    allowUnsolicitedHints: true,
  },
  scratchpad: {
    minutesBeforeFirstHint: 5,
    minutesBetweenHints: 3,
    maxHintsBeforeRevision: 12,
    allowUnsolicitedHints: true,
  },
  interview: {
    minutesBeforeFirstHint: 9999, // Never unsolicited
    minutesBetweenHints: 9999,
    maxHintsBeforeRevision: 2,
    allowUnsolicitedHints: false,
  },
  contest: {
    minutesBeforeFirstHint: 9999,
    minutesBetweenHints: 9999,
    maxHintsBeforeRevision: 0,
    allowUnsolicitedHints: false,
  },
};

/**
 * Adjust thresholds based on student Elo — more experienced students struggle longer.
 */
function getAdjustedThresholds(
  base: PolicyThresholds,
  elo: number,
  isNewUser: boolean
): PolicyThresholds {
  if (isNewUser) {
    return {
      ...base,
      minutesBeforeFirstHint: Math.max(3, base.minutesBeforeFirstHint - 5),
      minutesBetweenHints: Math.max(2, base.minutesBetweenHints - 2),
    };
  }
  if (elo >= 2000) {
    return {
      ...base,
      minutesBeforeFirstHint: base.minutesBeforeFirstHint * 2,
      minutesBetweenHints: base.minutesBetweenHints * 1.5,
    };
  }
  if (elo >= 1600) {
    return {
      ...base,
      minutesBeforeFirstHint: Math.round(base.minutesBeforeFirstHint * 1.5),
    };
  }
  return base;
}

/**
 * The core policy evaluation function.
 * Pure — deterministic given the same context.
 * Called before every potential hint delivery.
 */
export function evaluatePolicy(context: PolicyContext): PolicyDecision {
  const baseThresholds = POLICY_THRESHOLDS[context.sessionMode];
  const thresholds = getAdjustedThresholds(
    baseThresholds,
    context.studentGlobalElo,
    context.isNewUser
  );

  // Contest mode: never coach
  if (context.sessionMode === 'contest') {
    return {
      action: 'wait',
      waitMinutes: 9999,
      reason: 'Contest mode: coaching disabled.',
    };
  }

  // Student explicitly requested a hint — honor it (unless daily limit hit)
  if (context.studentRequestedHint) {
    if (context.dailyHintCount >= 50) {
      return {
        action: 'recommend_revision',
        suggestion: 'You have used many hints today. Try reviewing your notes and revisiting this problem tomorrow.',
        reason: 'Daily hint limit reached.',
      };
    }
    return {
      action: 'deliver_hint',
      hintType: selectHintType(context),
      reason: 'Student explicitly requested a hint.',
    };
  }

  // Interview mode: never hint unsolicited
  if (context.sessionMode === 'interview') {
    return {
      action: 'wait',
      waitMinutes: 9999,
      reason: 'Interview mode: waiting for explicit hint request.',
    };
  }

  // Recurring mistakes: recommend revision before continuing hints
  if (
    context.mistakesThisSession >= 3 &&
    context.hintsGivenThisSession >= thresholds.maxHintsBeforeRevision
  ) {
    return {
      action: 'recommend_revision',
      suggestion:
        'You have encountered several difficulties. Consider reviewing the prerequisite concepts before continuing.',
      reason: 'High mistake count + hint limit reached.',
    };
  }

  // Student has been stuck long enough — deliver unsolicited hint
  if (
    thresholds.allowUnsolicitedHints &&
    context.minutesStuckAtCurrentLevel >= thresholds.minutesBeforeFirstHint &&
    context.secondsSinceLastHint >= thresholds.minutesBetweenHints * 60
  ) {
    return {
      action: 'deliver_hint',
      hintType: selectHintType(context),
      reason: `Student stuck for ${context.minutesStuckAtCurrentLevel} minutes at current level.`,
    };
  }

  // Progressive struggle for experienced students
  if (
    context.studentGlobalElo >= 1600 &&
    context.minutesStuckAtCurrentLevel < thresholds.minutesBeforeFirstHint
  ) {
    return {
      action: 'prescribe_struggle',
      targetMinutes: thresholds.minutesBeforeFirstHint,
      reason:
        'Experienced student — allowing productive struggle before intervention.',
    };
  }

  // Not yet time to hint
  const minutesToWait =
    thresholds.minutesBeforeFirstHint - context.minutesStuckAtCurrentLevel;
  return {
    action: 'wait',
    waitMinutes: Math.max(0, minutesToWait),
    reason: `Waiting ${Math.round(minutesToWait)} more minutes before intervention.`,
  };
}

/**
 * Select the most appropriate hint type given the current context.
 */
function selectHintType(context: PolicyContext): PolicyHintType {
  // After WA verdict — probe edge cases
  if (context.lastVerdict === 'WA') return 'edge_case_probe';
  // After TLE verdict — nudge toward complexity awareness
  if (context.lastVerdict === 'TLE') return 'complexity_question';
  // Many hints already given — be more targeted
  if (context.hintsGivenThisSession >= 4) return 'logical_flaw_pointer';
  // General case — ask about optimization
  return 'optimization_question';
}
