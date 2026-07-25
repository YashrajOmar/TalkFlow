import type { Language, ExecutionVerdict } from '../entities/common.js';

export interface TestCase {
  readonly id: string;
  readonly input: string;
  readonly expectedOutput: string;
}

export interface ExecutionRequest {
  readonly code: string;
  readonly language: Language;
  readonly testCases: TestCase[];
  readonly timeLimitMs: number;
  readonly memoryLimitMb: number;
  readonly compileTimeoutMs?: number;
}

export interface ExecutionResult {
  readonly verdict: ExecutionVerdict;
  readonly passedCases: number;
  readonly totalCases: number;
  readonly runtimeMs: number;
  readonly memoryKb: number;
  readonly firstFailingInput?: string;
  readonly firstFailingExpected?: string;
  readonly firstFailingActual?: string;
  readonly stderr?: string;
  readonly compilationError?: string;
}

/**
 * Port interface for isolated code execution.
 *
 * Design note: submission is async — the adapter should acknowledge immediately
 * and push results via callback or event. The API layer uses WebSocket to
 * stream the result back to the client once ready.
 *
 * Implementations:
 *   - Judge0Adapter: Production — calls Judge0 REST API
 *   - DockerSandbox: Self-hosted — spawns isolated Docker container
 *   - MockSandbox: Testing — returns deterministic fixtures
 */
export interface IExecutionSandbox {
  /**
   * Execute code synchronously (blocks until result is ready).
   * Use for short-running code in scratchpad mode or in tests.
   */
  execute(request: ExecutionRequest): Promise<ExecutionResult>;

  /**
   * Submit code asynchronously. Returns a submission token.
   * Call pollResult with the token to retrieve the result.
   * The API layer should surface results via WebSocket subscription.
   */
  submit(request: ExecutionRequest): Promise<string>;

  /**
   * Poll for the result of an async submission.
   * Returns null if the submission is still PENDING.
   */
  pollResult(submissionToken: string): Promise<ExecutionResult | null>;
}
