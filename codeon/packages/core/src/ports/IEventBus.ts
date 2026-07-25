import type { UserId, SessionId, ProblemId, ConceptId } from '../entities/common.js';
import type { AlgorithmicLevel, StyleStage } from '../entities/common.js';

// ── Domain Events ────────────────────────────────────────────────────────────

export interface HintGeneratedPayload {
  readonly sessionId: SessionId;
  readonly userId: UserId;
  readonly hintSequenceNumber: number;
  readonly hintType: string;
}

export interface CodeSubmittedPayload {
  readonly sessionId: SessionId;
  readonly userId: UserId;
  readonly submissionNumber: number;
  readonly language: string;
  readonly verdict: string | null;
}

export interface TrailStepAdvancedPayload {
  readonly sessionId: SessionId;
  readonly userId: UserId;
  readonly previousLevel: AlgorithmicLevel;
  readonly newLevel: AlgorithmicLevel;
  readonly stepsToOptimal: number;
}

export interface LearningUpdatedPayload {
  readonly userId: UserId;
  readonly conceptId: ConceptId;
  readonly previousElo: number;
  readonly newElo: number;
  readonly previousMastery: number;
  readonly newMastery: number;
}

export interface StyleEvolutionPrescribedPayload {
  readonly userId: UserId;
  readonly sessionId: SessionId;
  readonly previousStage: StyleStage;
  readonly prescribedStage: StyleStage;
  readonly prescriptionDescription: string;
}

export interface ReflectionCompletedPayload {
  readonly sessionId: SessionId;
  readonly userId: UserId;
  readonly problemId: ProblemId | null;
  readonly conceptsLearned: string[];
}

export interface RecommendationUpdatedPayload {
  readonly userId: UserId;
  readonly nextProblemId: ProblemId | null;
  readonly nextConceptId: ConceptId | null;
  readonly reason: string;
}

// ── Event Union Type ──────────────────────────────────────────────────────────

export type DomainEvent =
  | { readonly type: 'HintGenerated';               readonly payload: HintGeneratedPayload }
  | { readonly type: 'CodeSubmitted';               readonly payload: CodeSubmittedPayload }
  | { readonly type: 'TrailStepAdvanced';           readonly payload: TrailStepAdvancedPayload }
  | { readonly type: 'LearningUpdated';             readonly payload: LearningUpdatedPayload }
  | { readonly type: 'StyleEvolutionPrescribed';    readonly payload: StyleEvolutionPrescribedPayload }
  | { readonly type: 'ReflectionCompleted';         readonly payload: ReflectionCompletedPayload }
  | { readonly type: 'RecommendationUpdated';       readonly payload: RecommendationUpdatedPayload };

export type DomainEventType = DomainEvent['type'];

export type EventPayloadOf<T extends DomainEventType> = Extract<DomainEvent, { type: T }>['payload'];

export type EventHandler<T extends DomainEventType> = (
  event: Extract<DomainEvent, { type: T }>
) => Promise<void>;

/**
 * Port interface for the event bus.
 *
 * Implementations:
 *   - InMemoryEventBus: Development — synchronous, in-process
 *   - RedisEventBus: Production — BullMQ-backed, persistent, retryable
 */
export interface IEventBus {
  publish(event: DomainEvent): Promise<void>;

  subscribe<T extends DomainEventType>(
    eventType: T,
    handler: EventHandler<T>
  ): void;

  unsubscribe<T extends DomainEventType>(
    eventType: T,
    handler: EventHandler<T>
  ): void;
}
