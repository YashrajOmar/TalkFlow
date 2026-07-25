import type { UserId, SessionId, ProblemId, ConceptId, EventId, AlgorithmicLevel } from './common.js';

/**
 * Base fields present on every learning event.
 */
interface LearningEventBase {
  readonly id: EventId;
  readonly userId: UserId;
  readonly occurredAt: Date;
}

/**
 * Student attempted a problem (regardless of outcome).
 */
export interface ProblemAttemptedEvent extends LearningEventBase {
  readonly type: 'PROBLEM_ATTEMPTED';
  readonly sessionId: SessionId;
  readonly problemId: ProblemId;
  readonly solved: boolean;
  readonly hintsUsed: number;
  readonly durationMinutes: number;
  readonly finalAlgorithmicLevel: AlgorithmicLevel | null;
  readonly eloDelta: number;
}

/**
 * Student's understanding of a concept has changed.
 */
export interface ConceptMasteryChangedEvent extends LearningEventBase {
  readonly type: 'CONCEPT_MASTERY_CHANGED';
  readonly conceptId: ConceptId;
  readonly previousMastery: number;
  readonly newMastery: number;
  readonly trigger: 'problem_solved' | 'hint_interaction' | 'mistake' | 'review';
}

/**
 * A spaced repetition review is due.
 */
export interface ReviewDueEvent extends LearningEventBase {
  readonly type: 'REVIEW_DUE';
  readonly conceptId: ConceptId;
  readonly problemId: ProblemId;  // Problem recommended for review
  readonly daysOverdue: number;
  readonly forgettingProbability: number;
}

/**
 * Student's coding style evolved to a new stage.
 */
export interface StyleEvolvedEvent extends LearningEventBase {
  readonly type: 'STYLE_EVOLVED';
  readonly sessionId: SessionId;
  readonly previousStage: string;
  readonly newStage: string;
}

/**
 * A post-session reflection was generated.
 */
export interface ReflectionGeneratedEvent extends LearningEventBase {
  readonly type: 'REFLECTION_GENERATED';
  readonly sessionId: SessionId;
  readonly problemId: ProblemId | null;
}

/**
 * Union of all possible learning events — the full Learning Timeline.
 */
export type LearningEvent =
  | ProblemAttemptedEvent
  | ConceptMasteryChangedEvent
  | ReviewDueEvent
  | StyleEvolvedEvent
  | ReflectionGeneratedEvent;

/**
 * A chronological list of learning events — the student's Learning Timeline.
 */
export interface LearningTimeline {
  readonly userId: UserId;
  readonly events: LearningEvent[];
  readonly totalEvents: number;
}
