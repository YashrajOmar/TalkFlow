import type {
  UserId,
  SessionId,
  ProblemId,
  HintId,
  Language,
  SessionMode,
  AlgorithmicLevel,
  ExecutionVerdict,
} from './common.js';

/**
 * A single hint delivered to the student during a session.
 * Never contains a full implementation — only Socratic guidance.
 */
export interface Hint {
  readonly id: HintId;
  readonly sessionId: SessionId;
  readonly sequenceNumber: number;  // 1st hint, 2nd hint, etc.
  readonly content: string;         // The actual hint text
  readonly hintType: HintType;
  readonly trailStepTarget: AlgorithmicLevel | null; // Which trail step this hint targets
  readonly wasHelpful: boolean | null;  // Student feedback; null if not yet rated
  readonly generatedAt: Date;
}

export type HintType =
  | 'clarifying_question'   // Ask the student to re-read constraints
  | 'logical_flaw'          // Point out incorrect reasoning
  | 'complexity_nudge'      // "What's the time complexity of your current approach?"
  | 'data_structure_hint'   // Suggest exploring a data structure
  | 'optimization_question' // "Can you do better than O(n^2)?"
  | 'bug_locator'           // "Look at line X — what happens when input is 0?"
  | 'style_suggestion'      // Gentle style improvement
  | 'reflection_prompt';    // Post-solve reflection question

/**
 * The result of running the student's code in the execution sandbox.
 */
export interface ExecutionResult {
  readonly verdict: ExecutionVerdict;
  readonly passedCases: number;
  readonly totalCases: number;
  readonly firstFailingInput?: string;
  readonly firstFailingExpected?: string;
  readonly firstFailingActual?: string;
  readonly runtimeMs: number;
  readonly memoryKb: number;
  readonly stderr?: string;
  readonly compilationError?: string;
}

/**
 * A single code submission from the student within a session.
 */
export interface CodeSubmission {
  readonly sequenceNumber: number;
  readonly code: string;
  readonly language: Language;
  readonly submittedAt: Date;
  readonly executionResult: ExecutionResult | null; // null while PENDING
  readonly algorithmicLevel: AlgorithmicLevel | null; // Detected by Trail Engine
  readonly linesOfCode: number;
}

/**
 * Tracks the student's position on the optimization trail.
 */
export interface TrailProgress {
  readonly currentLevel: AlgorithmicLevel;
  readonly targetLevel: AlgorithmicLevel;  // The optimal level from editorial
  readonly stepsRemaining: number;
  readonly hintsUsedAtCurrentLevel: number;
}

/**
 * A full coding session — the primary aggregate for session-scoped behavior.
 */
export interface CodingSession {
  readonly id: SessionId;
  readonly userId: UserId;
  readonly problemId: ProblemId | null;   // null in scratchpad mode
  readonly mode: SessionMode;
  readonly language: Language;

  // Timeline
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  readonly durationMinutes: number | null;

  // Code history
  readonly submissions: CodeSubmission[];
  readonly latestCode: string;

  // Hint history
  readonly hints: Hint[];
  readonly totalHintsRequested: number;

  // Trail progress (null in scratchpad/interview modes)
  readonly trailProgress: TrailProgress | null;

  // Outcome
  readonly solved: boolean;
  readonly finalVerdict: ExecutionVerdict | null;
  readonly reflectionGenerated: boolean;
}
