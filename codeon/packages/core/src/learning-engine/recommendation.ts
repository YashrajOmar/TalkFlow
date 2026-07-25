/**
 * Recommendation Engine — multidimensional next-step recommendations.
 *
 * Produces a RecommendationSet with 6 dimensions:
 *   1. next_problem       — Problem optimally challenging for the student
 *   2. next_topic         — Concept to study based on Knowledge Graph gaps
 *   3. next_article       — External resource for weak concepts
 *   4. next_visualization — Animated explanation for hard concepts
 *   5. next_review        — Spaced repetition due item
 *   6. next_simulation    — Interview simulation when student is ready
 *
 * Combines: Elo + Knowledge Graph + Spaced Repetition + Failure Patterns
 */

import type { ConceptId, ProblemId } from '../entities/common.js';
import type { DifficultyPrediction } from './difficulty-predictor.js';
import type { ForgettingCurveState } from './forgetting-curve.js';

export interface ProblemCandidate {
  readonly problemId: ProblemId;
  readonly problemElo: number;
  readonly requiredConceptIds: ConceptId[];
  readonly tags: string[];
  readonly slug: string;
  readonly title: string;
}

export interface ConceptCandidate {
  readonly conceptId: ConceptId;
  readonly name: string;
  readonly mastery: number;
  readonly interviewImportance: number;
}

export interface ResourceItem {
  readonly title: string;
  readonly url: string;
  readonly type: 'article' | 'video' | 'visualization' | 'interactive';
  readonly conceptId: ConceptId;
  readonly estimatedMinutes: number;
}

export interface RecommendationInput {
  readonly studentElo: number;
  readonly studentMastery: Map<ConceptId, number>;
  readonly forgettingStates: ForgettingCurveState[];
  readonly recentFailedConceptIds: ConceptId[];
  readonly recentSolvedProblemIds: ProblemId[];
  readonly interviewReadinessScore: number;
  readonly availableProblemCandidates: ProblemCandidate[];
  readonly availableConceptCandidates: ConceptCandidate[];
  readonly availableResources: ResourceItem[];
}

export interface ProblemRecommendation {
  readonly problemId: ProblemId;
  readonly title: string;
  readonly slug: string;
  readonly prediction: DifficultyPrediction;
  readonly reason: string;
}

export interface ConceptRecommendation {
  readonly conceptId: ConceptId;
  readonly name: string;
  readonly currentMastery: number;
  readonly reason: string;
}

export interface ReviewRecommendation {
  readonly conceptId: ConceptId;
  readonly problemId: ProblemId | null;
  readonly forgettingProbability: number;
  readonly daysOverdue: number;
  readonly urgency: 'low' | 'medium' | 'high';
}

export interface SimulationRecommendation {
  readonly mode: 'google' | 'meta' | 'amazon' | 'generic';
  readonly estimatedDuration: number;
  readonly reason: string;
}

export interface RecommendationSet {
  readonly nextProblem: ProblemRecommendation | null;
  readonly nextTopic: ConceptRecommendation | null;
  readonly nextArticle: ResourceItem | null;
  readonly nextVisualization: ResourceItem | null;
  readonly nextReview: ReviewRecommendation | null;
  readonly nextInterviewSimulation: SimulationRecommendation | null;
  readonly generatedAt: Date;
}

const OPTIMAL_SUCCESS_RATE_MIN = 0.45;
const OPTIMAL_SUCCESS_RATE_MAX = 0.75;

/**
 * Find the most urgent spaced repetition review.
 */
function findUrgentReview(states: ForgettingCurveState[]): ReviewRecommendation | null {
  const overdue = states
    .filter((s) => s.forgettingProbability > 0.5 && s.nextReviewAt <= new Date())
    .sort((a, b) => b.forgettingProbability - a.forgettingProbability);

  if (overdue.length === 0) return null;

  const top = overdue[0];
  if (!top) return null;

  const daysOverdue = Math.round(
    (new Date().getTime() - top.nextReviewAt.getTime()) / (1000 * 60 * 60 * 24)
  );

  return {
    conceptId: top.conceptId as ConceptId,
    problemId: null, // Problem assignment happens at the API layer
    forgettingProbability: top.forgettingProbability,
    daysOverdue,
    urgency:
      top.forgettingProbability > 0.8
        ? 'high'
        : top.forgettingProbability > 0.65
        ? 'medium'
        : 'low',
  };
}

/**
 * Find the weakest concept that is high-importance and not in active study.
 */
function findWeakestImportantConcept(
  candidates: ConceptCandidate[],
  recentFailed: ConceptId[]
): ConceptRecommendation | null {
  // Prioritize recently failed concepts
  const recentFailedConcept = candidates.find(
    (c) => recentFailed.includes(c.conceptId) && c.mastery < 0.5
  );

  if (recentFailedConcept) {
    return {
      conceptId: recentFailedConcept.conceptId,
      name: recentFailedConcept.name,
      currentMastery: recentFailedConcept.mastery,
      reason: 'You struggled with this concept recently. Focused practice will help.',
    };
  }

  // Otherwise pick lowest mastery * highest importance
  const scored = candidates
    .filter((c) => c.mastery < 0.7)
    .map((c) => ({ ...c, score: (1 - c.mastery) * c.interviewImportance }))
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  if (!top) return null;

  return {
    conceptId: top.conceptId,
    name: top.name,
    currentMastery: top.mastery,
    reason: `This is a high-importance concept with current mastery at ${Math.round(top.mastery * 100)}%.`,
  };
}

/**
 * Determine if the student is ready for interview simulation.
 */
function maybeRecommendSimulation(
  interviewReadinessScore: number
): SimulationRecommendation | null {
  if (interviewReadinessScore < 60) return null;

  return {
    mode: interviewReadinessScore >= 80 ? 'google' : 'generic',
    estimatedDuration: 45,
    reason: `Your interview readiness score is ${interviewReadinessScore}/100. Time to practice under pressure.`,
  };
}

/**\n * Build a multidimensional recommendation set.\n * Pure function — all input must be pre-loaded.\n */\nexport function buildRecommendationSet(\n  input: RecommendationInput,\n  problemPredictions: Map<ProblemId, DifficultyPrediction>\n): RecommendationSet {\n  // 1. Next Problem — find the one closest to optimal challenge zone\n  const optimalProblem = input.availableProblemCandidates\n    .map((p) => ({ candidate: p, prediction: problemPredictions.get(p.problemId) }))\n    .filter(\n      (x): x is { candidate: ProblemCandidate; prediction: DifficultyPrediction } =>\n        x.prediction !== undefined &&\n        x.prediction.expectedSuccessRate >= OPTIMAL_SUCCESS_RATE_MIN &&\n        x.prediction.expectedSuccessRate <= OPTIMAL_SUCCESS_RATE_MAX\n    )\n    .filter((x) => !input.recentSolvedProblemIds.includes(x.candidate.problemId))\n    .sort(\n      (a, b) =>\n        Math.abs(a.prediction.expectedSuccessRate - 0.6) -\n        Math.abs(b.prediction.expectedSuccessRate - 0.6)\n    )[0];\n\n  const nextProblem = optimalProblem\n    ? {\n        problemId: optimalProblem.candidate.problemId,\n        title: optimalProblem.candidate.title,\n        slug: optimalProblem.candidate.slug,\n        prediction: optimalProblem.prediction,\n        reason: `Expected success rate: ${Math.round(optimalProblem.prediction.expectedSuccessRate * 100)}%. Optimal challenge level for you.`,\n      }\n    : null;\n\n  // 2. Next Topic\n  const nextTopic = findWeakestImportantConcept(\n    input.availableConceptCandidates,\n    input.recentFailedConceptIds\n  );\n\n  // 3. Resources\n  const weakConceptId = nextTopic?.conceptId;\n  const nextArticle = weakConceptId\n    ? (input.availableResources.find(\n        (r) => r.conceptId === weakConceptId && r.type === 'article'\n      ) ?? null)\n    : null;\n\n  const nextVisualization = weakConceptId\n    ? (input.availableResources.find(\n        (r) =>\n          r.conceptId === weakConceptId &&\n          (r.type === 'visualization' || r.type === 'interactive')\n      ) ?? null)\n    : null;\n\n  // 4. Spaced Repetition Review\n  const nextReview = findUrgentReview(input.forgettingStates);\n\n  // 5. Interview Simulation\n  const nextInterviewSimulation = maybeRecommendSimulation(input.interviewReadinessScore);\n\n  return {\n    nextProblem,\n    nextTopic,\n    nextArticle,\n    nextVisualization,\n    nextReview,\n    nextInterviewSimulation,\n    generatedAt: new Date(),\n  };\n}\n
