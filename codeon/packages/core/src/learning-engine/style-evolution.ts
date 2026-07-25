/**
 * Style Evolution Engine — prescriptive coding style progression.
 *
 * Tracks the student's current style stage and prescribes the NEXT concrete
 * improvement. Progression is always one stage at a time — never jumps.
 *
 * The engine observes style signals from code analysis reports and
 * determines when the student is ready to move to the next stage.
 *
 * Important: The engine does NOT enforce style. It prescribes.
 * The Teaching Engine delivers the prescription as a Socratic suggestion.
 */

import type { StyleStage } from '../entities/common.js';
import type { StyleImprovement } from '../entities/student-profile.js';

/**
 * Signals extracted from code analysis that indicate style level.
 */
export interface StyleSignals {
  readonly averageVariableNameLength: number;     // < 3 chars = naive naming
  readonly hasHelperFunctions: boolean;
  readonly hasConstexprOrConst: boolean;
  readonly usesRangeBasedFor: boolean;
  readonly usesAutoKeyword: boolean;
  readonly usesStdRanges: boolean;
  readonly usesStructuredBindings: boolean;
  readonly magicNumberCount: number;              // Unaliased numeric literals
  readonly maxFunctionLength: number;             // In lines of code
  readonly hasComments: boolean;
  readonly singleLetterVariableCount: number;
  readonly hasGodFunction: boolean;               // Single function > 50 lines
}\n\n/**\n * Prescriptions for each transition between style stages.\n * Key: `${fromStage}->${toStage}`\n */\nconst STYLE_PRESCRIPTIONS: Partial<Record<string, StyleImprovement>> = {\n  'naive->descriptive': {\n    description: 'Use descriptive variable names instead of single letters',\n    exampleBefore: 'int a, b, c;\\nfor (int i = 0; i < n; i++)',\n    exampleAfter: 'int left, right, mid;\\nfor (int index = 0; index < size; index++)',\n    rationale:\n      'Descriptive names make code self-documenting and easier to debug during interviews.',\n    targetStage: 'descriptive',\n  },\n  'descriptive->structured': {\n    description: 'Extract repeated logic into helper functions',\n    exampleBefore: '// 80-line main function doing everything',\n    exampleAfter:\n      'bool isValid(int x) { ... }\\nvoid processRange(vector<int>& v) { ... }',\n    rationale:\n      'Single-responsibility functions are easier to reason about and test independently.',\n    targetStage: 'structured',\n  },\n  'structured->modern': {\n    description: \"Use 'const' and 'constexpr' for immutable values\",\n    exampleBefore: 'int MOD = 1e9 + 7;',\n    exampleAfter: 'constexpr int MOD = 1e9 + 7;',\n    rationale:\n      \"Compile-time constants communicate intent and enable compiler optimizations.\",\n    targetStage: 'modern',\n  },\n  'modern->idiomatic': {\n    description: 'Use range-based for loops and structured bindings',\n    exampleBefore: 'for (int i = 0; i < v.size(); i++) { auto p = v[i]; }',\n    exampleAfter: 'for (auto& [key, value] : map) { }',\n    rationale: 'Modern C++ idioms reduce boilerplate and make intent clearer.',\n    targetStage: 'idiomatic',\n  },\n  'idiomatic->interview_quality': {\n    description: 'Add brief inline comments for non-obvious logic',\n    exampleBefore: 'while (left < right) { int mid = left + (right - left) / 2; }',\n    exampleAfter:\n      '// Avoid overflow: mid = left + (right - left) / 2\\nwhile (left < right) { int mid = left + (right - left) / 2; }',\n    rationale:\n      'Comments during interviews signal clarity of thought and communication skill.',\n    targetStage: 'interview_quality',\n  },\n  'interview_quality->production_quality': {\n    description: 'Use std::ranges algorithms and proper abstractions',\n    exampleBefore: 'sort(v.begin(), v.end());',\n    exampleAfter: 'std::ranges::sort(v);',\n    rationale:\n      'Production code should use the highest-level abstractions available to minimize error surface.',\n    targetStage: 'production_quality',\n  },\n};\n\nconst STAGE_ORDER: StyleStage[] = [\n  'naive',\n  'descriptive',\n  'structured',\n  'modern',\n  'idiomatic',\n  'interview_quality',\n  'production_quality',\n];\n\n/**\n * Infer the student's current style stage from code signals.\n * Returns the LOWEST stage whose signals are NOT yet met (i.e., current stage).\n */\nexport function inferStyleStage(signals: StyleSignals): StyleStage {\n  if (signals.usesStdRanges && signals.usesStructuredBindings && signals.hasComments) {\n    return 'production_quality';\n  }\n  if (signals.hasComments && signals.usesRangeBasedFor && signals.hasHelperFunctions) {\n    return 'interview_quality';\n  }\n  if (signals.usesRangeBasedFor || signals.usesStructuredBindings || signals.usesAutoKeyword) {\n    return 'idiomatic';\n  }\n  if (signals.hasConstexprOrConst && signals.magicNumberCount === 0) {\n    return 'modern';\n  }\n  if (signals.hasHelperFunctions && !signals.hasGodFunction) {\n    return 'structured';\n  }\n  if (\n    signals.averageVariableNameLength >= 4 &&\n    signals.singleLetterVariableCount <= 2\n  ) {\n    return 'descriptive';\n  }\n  return 'naive';\n}\n\n/**\n * Get the next style stage after the current one.\n */\nexport function getNextStyleStage(current: StyleStage): StyleStage | null {\n  const index = STAGE_ORDER.indexOf(current);\n  if (index === -1 || index === STAGE_ORDER.length - 1) return null;\n  return STAGE_ORDER[index + 1] ?? null;\n}\n\n/**\n * Get the prescribed improvement for moving from current to next stage.\n */\nexport function getPrescribedImprovement(current: StyleStage): StyleImprovement | null {\n  const next = getNextStyleStage(current);\n  if (!next) return null;\n  const key = `${current}->${next}`;\n  return STYLE_PRESCRIPTIONS[key] ?? null;\n}\n\n/**\n * Determine if the student is ready to advance to the next style stage.\n * Uses a threshold: the student must have demonstrated the current stage's\n * signals consistently across recent sessions.\n */\nexport function isReadyToAdvance(\n  currentStage: StyleStage,\n  signals: StyleSignals,\n  consecutiveSessions: number\n): boolean {\n  const inferredStage = inferStyleStage(signals);\n  const inferredIndex = STAGE_ORDER.indexOf(inferredStage);\n  const currentIndex = STAGE_ORDER.indexOf(currentStage);\n\n  // Student must demonstrate at least current-stage signals for 2+ sessions\n  return inferredIndex > currentIndex && consecutiveSessions >= 2;\n}\n
