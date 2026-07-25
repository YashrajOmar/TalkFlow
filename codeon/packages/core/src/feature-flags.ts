/**
 * Feature Flags — gradual feature rollout control.
 *
 * Flags are read from environment at startup and can be overridden
 * per-user via database (for A/B testing and gradual rollout).
 *
 * Usage in application code:
 *   if (flags.experimental_native_trail) { ... }
 *
 * New features ALWAYS start behind a flag. The flag is removed only
 * when the feature is fully validated and rolled out to 100% of users.
 */

export interface FeatureFlags {
  /** Native Optimization Trail Engine (Trail before AI) */
  readonly experimental_native_trail: boolean;
  /** Learning Knowledge Graph with confidence propagation */
  readonly experimental_learning_graph: boolean;
  /** 6-dimensional Recommendation Engine */
  readonly experimental_recommendations: boolean;
  /** Learning Twin — predicts mistakes before they happen */
  readonly experimental_learning_twin: boolean;
  /** Contest Mode — AI gated during competition */
  readonly experimental_contest_mode: boolean;
  /** Interview Mode — strict interviewer persona */
  readonly experimental_interview_mode: boolean;
  /** Learning Policy Engine — pedagogical decision layer */
  readonly experimental_learning_policy_engine: boolean;
  /** Control Flow Graph in Code Analysis */
  readonly experimental_cfg_analysis: boolean;
}

const DEFAULT_FLAGS: FeatureFlags = {
  experimental_native_trail: true,
  experimental_learning_graph: true,
  experimental_recommendations: false,
  experimental_learning_twin: false,
  experimental_contest_mode: false,
  experimental_interview_mode: true,
  experimental_learning_policy_engine: true,
  experimental_cfg_analysis: false,
};

/**
 * Load feature flags from environment variables.
 * Environment variable format: FEATURE_EXPERIMENTAL_NATIVE_TRAIL=true
 */
export function loadFeatureFlagsFromEnv(): FeatureFlags {
  function readBoolFlag(key: string, defaultValue: boolean): boolean {
    const value = process.env[key];
    if (value === undefined) return defaultValue;
    return value.toLowerCase() === 'true';
  }

  return {
    experimental_native_trail: readBoolFlag('FEATURE_EXPERIMENTAL_NATIVE_TRAIL', DEFAULT_FLAGS.experimental_native_trail),
    experimental_learning_graph: readBoolFlag('FEATURE_EXPERIMENTAL_LEARNING_GRAPH', DEFAULT_FLAGS.experimental_learning_graph),
    experimental_recommendations: readBoolFlag('FEATURE_EXPERIMENTAL_RECOMMENDATIONS', DEFAULT_FLAGS.experimental_recommendations),
    experimental_learning_twin: readBoolFlag('FEATURE_EXPERIMENTAL_LEARNING_TWIN', DEFAULT_FLAGS.experimental_learning_twin),
    experimental_contest_mode: readBoolFlag('FEATURE_EXPERIMENTAL_CONTEST_MODE', DEFAULT_FLAGS.experimental_contest_mode),
    experimental_interview_mode: readBoolFlag('FEATURE_EXPERIMENTAL_INTERVIEW_MODE', DEFAULT_FLAGS.experimental_interview_mode),
    experimental_learning_policy_engine: readBoolFlag('FEATURE_EXPERIMENTAL_LEARNING_POLICY_ENGINE', DEFAULT_FLAGS.experimental_learning_policy_engine),
    experimental_cfg_analysis: readBoolFlag('FEATURE_EXPERIMENTAL_CFG_ANALYSIS', DEFAULT_FLAGS.experimental_cfg_analysis),
  };
}

/**
 * Override flags for a specific user (per-user A/B testing).
 * User overrides take priority over environment flags.
 */
export function applyUserOverrides(
  baseFlags: FeatureFlags,
  userOverrides: Partial<FeatureFlags>
): FeatureFlags {
  return { ...baseFlags, ...userOverrides };
}

/**
 * All flags disabled — for testing scenarios where features must be isolated.
 */
export const ALL_FLAGS_OFF: FeatureFlags = {
  experimental_native_trail: false,
  experimental_learning_graph: false,
  experimental_recommendations: false,
  experimental_learning_twin: false,
  experimental_contest_mode: false,
  experimental_interview_mode: false,
  experimental_learning_policy_engine: false,
  experimental_cfg_analysis: false,
};

/**
 * All flags enabled — for integration testing of the full pipeline.
 */
export const ALL_FLAGS_ON: FeatureFlags = {
  experimental_native_trail: true,
  experimental_learning_graph: true,
  experimental_recommendations: true,
  experimental_learning_twin: true,
  experimental_contest_mode: true,
  experimental_interview_mode: true,
  experimental_learning_policy_engine: true,
  experimental_cfg_analysis: true,
};
