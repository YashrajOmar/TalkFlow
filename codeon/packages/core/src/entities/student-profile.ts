import type {
  UserId,
  ConceptId,
  TeachingStyle,
  StyleStage,
  Language,
} from './common.js';

/**
 * Represents the student's mastery of a single concept.
 * This is the per-student overlay on a ConceptNode in the Knowledge Graph.
 */
export interface ConceptMastery {
  readonly conceptId: ConceptId;
  readonly mastery: number;              // 0.0–1.0: how well they know this
  readonly confidence: number;           // 0.0–1.0: how confident they feel
  readonly elo: number;                  // Elo rating for this specific concept
  readonly forgettingProbability: number;// 0.0–1.0: SM-2 derived decay estimate
  readonly lastPracticed: Date;
  readonly sessionsPracticed: number;
}

/**
 * Coding style profile — tracks both current state and prescribed evolution target.
 */
export interface CodingStyleProfile {
  readonly currentStage: StyleStage;
  readonly preferredLanguage: Language;
  readonly usesDescriptiveNames: boolean;
  readonly usesHelperFunctions: boolean;
  readonly usesModernFeatures: boolean;
  readonly commentingHabit: 'none' | 'sparse' | 'adequate' | 'thorough';
  readonly loopPreference: 'index' | 'range' | 'stl' | 'mixed';
  readonly recursionPreference: 'recursive' | 'iterative' | 'mixed';
  // The next improvement to prescribe
  readonly prescribedNextImprovement: StyleImprovement | null;
}

export interface StyleImprovement {
  readonly description: string;
  readonly exampleBefore: string;
  readonly exampleAfter: string;
  readonly rationale: string;
  readonly targetStage: StyleStage;
}

/**
 * Summary of the student's confidence across all studied concepts.
 * Used by the Prompt Builder to construct the UserContext.
 */
export interface ConceptConfidenceMap {
  readonly [conceptId: string]: ConceptMastery;
}

/**
 * The student's complete persistent profile.
 * This is the root aggregate for the student domain.
 */
export interface StudentProfile {
  readonly id: UserId;
  readonly displayName: string;
  readonly email: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  // Learning state
  readonly globalElo: number;            // Overall coding ability estimate
  readonly conceptMastery: ConceptConfidenceMap;
  readonly preferredTeachingStyle: TeachingStyle;
  readonly codingStyle: CodingStyleProfile;
  readonly primaryLanguage: Language;
  readonly supportedLanguages: Language[];

  // Interview readiness
  readonly interviewReadinessScore: number; // 0–100
  readonly cpRating: number;             // Competitive programming estimated rating

  // Meta
  readonly totalSessionsCompleted: number;
  readonly totalProblemsAttempted: number;
  readonly totalProblemsSolved: number;
  readonly currentStreak: number;        // Days
  readonly longestStreak: number;

  // Cold-start flag — true until enough data points exist
  readonly isNewUser: boolean;
}

/**
 * Lightweight summary used inside PromptContext to avoid loading full profile.
 */
export interface StudentProfileSummary {
  readonly userId: UserId;
  readonly displayName: string;
  readonly globalElo: number;
  readonly interviewReadinessScore: number;
  readonly preferredTeachingStyle: TeachingStyle;
  readonly codingStyle: CodingStyleProfile;
  readonly primaryLanguage: Language;
  readonly weakestConceptIds: ConceptId[];
  readonly strongestConceptIds: ConceptId[];
  readonly isNewUser: boolean;
}
