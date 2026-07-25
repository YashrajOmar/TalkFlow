/**
 * Row → Domain entity mappers for PostgresRepository.
 *
 * Each mapper is a pure function: no I/O, no side effects.
 * These keep the repository methods clean and testable.
 */

import type {
  UserId,
  SessionId,
  ProblemId,
  ConceptId,
  HintId,
  EventId,
  Language,
  TeachingStyle,
  StyleStage,
  SessionMode,
  AlgorithmicLevel,
  ExecutionVerdict,
} from '@codeon/core/entities';
import type {
  StudentProfile,
  StudentProfileSummary,
  CodingStyleProfile,
  ConceptConfidenceMap,
} from '@codeon/core/entities';
import type { CodingSession, Hint, CodeSubmission, TrailProgress } from '@codeon/core/entities';
import type { ConceptNode, KnowledgeGraph, ConceptEdge } from '@codeon/core/entities';
import type { LearningEvent } from '@codeon/core/entities';

// ── Row types (inferred from Drizzle select) ──────────────────────────────────

export type UserRow = {
  id: string;
  email: string;
  displayName: string;
  primaryLanguage: string;
  inferredElo: number;
  createdAt: Date;
  updatedAt: Date;
  // Extended profile stored as JSONB — populated by JOIN queries
  profileJson?: unknown;
};

export type SessionRow = {
  id: string;
  userId: string;
  problemId: string | null;
  startedAt: Date;
  endedAt: Date | null;
  status: string;
  currentCode: string;
  currentLanguage: string;
  hintsGiven: number;
  solvedWithoutHints: boolean;
  detectedComplexity: string | null;
  detectedLevel: string | null;
};

export type HintRow = {
  id: string;
  sessionId: string;
  userId: string;
  sequenceNumber: number;
  hintText: string;
  hintType: string;
  codeSnapshot: string;
  complexityAtTime: string | null;
  levelAtTime: string | null;
  ragSubmissionIds: string[] | null;
  wasHelpful: boolean | null;
  generatedAt: Date;
};

export type ConceptTopicRow = {
  id: string;
  slug: string;
  displayName: string;
  category: string;
  description: string | null;
  difficultyLevel: number;
  // Prerequisites from join with topic_prerequisites
  prerequisites?: Array<{ prerequisiteId: string; strength: number }>;
  // Dependent topic IDs from join
  dependentIds?: string[];
};

export type LearningEventRow = {
  id: string;
  userId: string;
  type: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  insertedAt: Date;
};

// ── User / Profile mappers ────────────────────────────────────────────────────

/**
 * Maps a users row to a minimal StudentProfile.
 * Most profile fields (elo, style, mastery) require additional query data
 * passed as `profileExtension`. This keeps the DB query flexible.
 */
export function mapRowToProfile(
  row: UserRow,
  profileExtension?: {
    globalElo?: number;
    interviewReadinessScore?: number;
    cpRating?: number;
    preferredTeachingStyle?: TeachingStyle;
    codingStyle?: CodingStyleProfile;
    conceptMastery?: ConceptConfidenceMap;
    supportedLanguages?: Language[];
    totalSessionsCompleted?: number;
    totalProblemsAttempted?: number;
    totalProblemsSolved?: number;
    currentStreak?: number;
    longestStreak?: number;
    isNewUser?: boolean;
  }
): StudentProfile {
  const ext = profileExtension ?? {};
  const defaultStyle: CodingStyleProfile = {
    currentStage: 'naive' as StyleStage,
    preferredLanguage: (row.primaryLanguage as Language) || 'cpp17',
    usesDescriptiveNames: false,
    usesHelperFunctions: false,
    usesModernFeatures: false,
    commentingHabit: 'none',
    loopPreference: 'index',
    recursionPreference: 'iterative',
    prescribedNextImprovement: null,
  };

  return {
    id: row.id as UserId,
    displayName: row.displayName,
    email: row.email,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    globalElo: ext.globalElo ?? row.inferredElo,
    conceptMastery: ext.conceptMastery ?? {},
    preferredTeachingStyle: ext.preferredTeachingStyle ?? 'socratic',
    codingStyle: ext.codingStyle ?? defaultStyle,
    primaryLanguage: (row.primaryLanguage as Language) || 'cpp17',
    supportedLanguages: ext.supportedLanguages ?? [(row.primaryLanguage as Language) || 'cpp17'],
    interviewReadinessScore: ext.interviewReadinessScore ?? 0,
    cpRating: ext.cpRating ?? row.inferredElo,
    totalSessionsCompleted: ext.totalSessionsCompleted ?? 0,
    totalProblemsAttempted: ext.totalProblemsAttempted ?? 0,
    totalProblemsSolved: ext.totalProblemsSolved ?? 0,
    currentStreak: ext.currentStreak ?? 0,
    longestStreak: ext.longestStreak ?? 0,
    isNewUser: ext.isNewUser ?? (row.inferredElo === 0),
  };
}

export function mapRowToProfileSummary(
  row: UserRow,
  ext: {
    globalElo?: number;
    interviewReadinessScore?: number;
    preferredTeachingStyle?: TeachingStyle;
    codingStyle?: CodingStyleProfile;
    weakestConceptIds?: ConceptId[];
    strongestConceptIds?: ConceptId[];
  } = {}
): StudentProfileSummary {
  const defaultStyle: CodingStyleProfile = {
    currentStage: 'naive' as StyleStage,
    preferredLanguage: (row.primaryLanguage as Language) || 'cpp17',
    usesDescriptiveNames: false,
    usesHelperFunctions: false,
    usesModernFeatures: false,
    commentingHabit: 'none',
    loopPreference: 'index',
    recursionPreference: 'iterative',
    prescribedNextImprovement: null,
  };
  return {
    userId: row.id as UserId,
    displayName: row.displayName,
    globalElo: ext.globalElo ?? row.inferredElo,
    interviewReadinessScore: ext.interviewReadinessScore ?? 0,
    preferredTeachingStyle: ext.preferredTeachingStyle ?? 'socratic',
    codingStyle: ext.codingStyle ?? defaultStyle,
    primaryLanguage: (row.primaryLanguage as Language) || 'cpp17',
    weakestConceptIds: ext.weakestConceptIds ?? [],
    strongestConceptIds: ext.strongestConceptIds ?? [],
    isNewUser: row.inferredElo === 0,
  };
}

// ── Session mapper ─────────────────────────────────────────────────────────────

export function mapRowToSession(row: SessionRow): CodingSession {
  const mode: SessionMode =
    (row.status === 'active' || row.status === 'solved' || row.status === 'abandoned')
      ? 'problem'
      : 'scratchpad';

  const duration =
    row.endedAt
      ? Math.round((row.endedAt.getTime() - row.startedAt.getTime()) / 60000)
      : null;

  return {
    id: row.id as SessionId,
    userId: row.userId as UserId,
    problemId: row.problemId ? (row.problemId as ProblemId) : null,
    mode,
    language: (row.currentLanguage as Language) || 'cpp17',
    startedAt: row.startedAt,
    endedAt: row.endedAt ?? null,
    durationMinutes: duration,
    submissions: [],       // Loaded separately if needed
    latestCode: row.currentCode,
    hints: [],             // Loaded separately if needed
    totalHintsRequested: row.hintsGiven,
    trailProgress: row.detectedLevel
      ? {
          currentLevel: row.detectedLevel as AlgorithmicLevel,
          targetLevel: 'optimal' as AlgorithmicLevel,
          stepsRemaining: 1,
          hintsUsedAtCurrentLevel: row.hintsGiven,
        }
      : null,
    solved: row.status === 'solved',
    finalVerdict: row.status === 'solved' ? 'AC' as ExecutionVerdict : null,
    reflectionGenerated: false,
  };
}

// ── Hint mapper ───────────────────────────────────────────────────────────────

export function mapRowToHint(row: HintRow): Hint {
  return {
    id: row.id as HintId,
    sessionId: row.sessionId as SessionId,
    sequenceNumber: row.sequenceNumber,
    content: row.hintText,
    hintType: row.hintType as Hint['hintType'],
    trailStepTarget: (row.levelAtTime as AlgorithmicLevel) ?? null,
    wasHelpful: row.wasHelpful ?? null,
    generatedAt: row.generatedAt,
  };
}

// ── ConceptNode mapper ────────────────────────────────────────────────────────

export function mapRowToConceptNode(row: ConceptTopicRow): ConceptNode {
  const prerequisites: ConceptEdge[] = (row.prerequisites ?? []).map((p) => ({
    targetConceptId: p.prerequisiteId as ConceptId,
    prerequisiteStrength: p.strength,
    relationship: 'requires' as const,
  }));

  return {
    id: row.id as ConceptId,
    name: row.displayName,
    description: row.description ?? '',
    category: row.category as ConceptNode['category'],
    prerequisites,
    dependents: (row.dependentIds ?? []).map((id) => id as ConceptId),
    interviewImportance: 0.5,  // Default — enriched by analytics layer
    cpImportance: 0.5,
    typicalEloToLearn: row.difficultyLevel * 200,
    averageDaysToMaster: row.difficultyLevel * 7,
    tags: [row.slug],
  };
}

// ── LearningEvent mapper ──────────────────────────────────────────────────────

export function mapRowToLearningEvent(row: LearningEventRow): LearningEvent {
  // The payload is stored as the full discriminated union object.
  // We trust the write path to store valid payloads.
  return {
    ...row.payload,
    id: row.id as EventId,
    userId: row.userId as UserId,
    occurredAt: row.occurredAt,
  } as LearningEvent;
}
