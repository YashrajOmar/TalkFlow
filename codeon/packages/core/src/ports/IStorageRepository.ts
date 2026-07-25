import type {
  UserId,
  SessionId,
  ProblemId,
  ConceptId,
} from '../entities/common.js';
import type { StudentProfile, StudentProfileSummary } from '../entities/student-profile.js';
import type { CodingSession, Hint } from '../entities/session.js';
import type { Problem } from '../entities/problem.js';
import type { KnowledgeGraph, ConceptNode } from '../entities/knowledge-graph.js';
import type { LearningEvent } from '../entities/learning-event.js';

/**
 * Port interface for all persistent storage operations.
 * Implementations: PostgresRepository
 * The domain layer depends on this interface, not on any database driver.
 */
export interface IStorageRepository {
  // ── Student Profile ─────────────────────────────────────────────────
  findProfileById(id: UserId): Promise<StudentProfile | null>;
  findProfileByEmail(email: string): Promise<StudentProfile | null>;
  saveProfile(profile: StudentProfile): Promise<void>;
  updateProfile(id: UserId, partial: Partial<StudentProfile>): Promise<StudentProfile>;

  // ── Sessions ─────────────────────────────────────────────────────────
  findSessionById(id: SessionId): Promise<CodingSession | null>;
  findSessionsByUserId(userId: UserId, limit?: number): Promise<CodingSession[]>;
  saveSession(session: CodingSession): Promise<void>;
  updateSession(id: SessionId, partial: Partial<CodingSession>): Promise<CodingSession>;

  // ── Hints ────────────────────────────────────────────────────────────
  saveHint(hint: Hint): Promise<void>;
  findHintsBySessionId(sessionId: SessionId): Promise<Hint[]>;

  // ── Problems ─────────────────────────────────────────────────────────
  findProblemById(id: ProblemId): Promise<Problem | null>;
  findProblemBySlug(slug: string): Promise<Problem | null>;
  saveProblem(problem: Problem): Promise<void>;
  findProblemsByConceptIds(conceptIds: ConceptId[], limit?: number): Promise<Problem[]>;

  // ── Knowledge Graph ───────────────────────────────────────────────────
  loadKnowledgeGraph(): Promise<KnowledgeGraph>;
  findConceptById(id: ConceptId): Promise<ConceptNode | null>;
  findConceptsByCategory(category: string): Promise<ConceptNode[]>;
  saveConceptNode(node: ConceptNode): Promise<void>;

  // ── Learning Timeline ─────────────────────────────────────────────────
  saveLearningEvent(event: LearningEvent): Promise<void>;
  findLearningEventsByUserId(
    userId: UserId,
    options?: { limit?: number; fromDate?: Date; toDate?: Date }
  ): Promise<LearningEvent[]>;

  // ── Profile Summary (optimized read) ─────────────────────────────────
  findProfileSummaryById(id: UserId): Promise<StudentProfileSummary | null>;
}
