/**
 * Learning Engine — barrel export for all sub-engines.
 * The core intellectual property of codeOn.
 */

export {
  computeEloUpdate,
  computeGlobalElo,
  type EloUpdateInput,
  type EloUpdateOutput,
  type EloResult,
} from './elo-engine.js';

export {
  applySM2Update,
  createInitialForgettingState,
  getConceptsDueForReview,
  refreshForgettingProbabilities,
  type ForgettingCurveState,
  type RecallQuality,
  type SM2UpdateInput,
} from './forgetting-curve.js';

export {
  propagateConfidence,
  findPrerequisitePath,
  getOrderedPrerequisites,
  findWeakPrerequisites,
} from './learning-knowledge-graph.js';

export {
  inferStyleStage,
  getNextStyleStage,
  getPrescribedImprovement,
  isReadyToAdvance,
  type StyleSignals,
} from './style-evolution.js';

export {
  analyzeMistakeHeuristics,
  isMistakeResolved,
  rankMistakesByUrgency,
  type MistakeCategory,
  type MistakePattern,
  type MistakeAnalysisInput,
  type MistakeAnalysisResult,
} from './mistake-tracker.js';

export {
  updateStrategyWeights,
  selectTeachingStyle,
  createDefaultStrategyWeights,
  type StrategyFeedback,
  type StrategyWeights,
} from './teaching-strategy.js';

export {
  predictDifficulty,
  type DifficultyPrediction,
  type ProblemDifficultyInput,
  type RecommendationStrength,
} from './difficulty-predictor.js';

export {
  computeSessionSummary,
  buildReflectionData,
  type SessionSummary,
  type ReflectionData,
} from './reflection-engine.js';

export {
  buildRecommendationSet,
  type RecommendationInput,
  type RecommendationSet,
  type ProblemRecommendation,
  type ConceptRecommendation,
  type ReviewRecommendation,
  type SimulationRecommendation,
} from './recommendation.js';
