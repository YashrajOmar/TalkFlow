/**
 * Elo Engine — computes and updates Elo ratings on a per-concept basis.
 *
 * We use standard Elo with K-factor adjustment based on session count.
 * Each concept has an independent Elo rating; global Elo is a weighted average.
 *
 * K-factor schedule:
 *   < 10 sessions:   K = 40 (fast learning, high volatility)
 *   10–30 sessions:  K = 24 (settling)
 *   > 30 sessions:   K = 16 (stable, experienced)
 */

export interface EloUpdateInput {
  readonly currentElo: number;
  readonly opponentElo: number;   // Difficulty rating of the problem
  readonly result: EloResult;
  readonly sessionCount: number;  // Total sessions student has completed
  readonly hintsUsed: number;     // More hints = treated as partial win
}

export type EloResult = 'win' | 'draw' | 'loss';

export interface EloUpdateOutput {
  readonly previousElo: number;
  readonly newElo: number;
  readonly delta: number;
  readonly kFactor: number;
  readonly expectedScore: number;
  readonly actualScore: number;
}

const MIN_ELO = 400;
const MAX_ELO = 3000;

/**
 * Compute the expected score using the standard Elo formula.
 */
function computeExpectedScore(playerElo: number, opponentElo: number): number {
  return 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
}

/**
 * Select K-factor based on experience level.
 */
function selectKFactor(sessionCount: number): number {
  if (sessionCount < 10) return 40;
  if (sessionCount < 30) return 24;
  return 16;
}

/**
 * Convert a result + hints used into a fractional score (0.0–1.0).
 * Hints reduce the "win" score to penalize dependency on guidance.
 */
function computeActualScore(result: EloResult, hintsUsed: number): number {
  const hintPenalty = Math.min(hintsUsed * 0.05, 0.3); // Max 30% penalty
  switch (result) {
    case 'win':  return Math.max(0.5, 1.0 - hintPenalty);
    case 'draw': return 0.5;
    case 'loss': return 0.0;
  }
}

/**
 * Compute a new Elo rating after a single interaction.
 * Pure function — no side effects.
 */
export function computeEloUpdate(input: EloUpdateInput): EloUpdateOutput {
  const kFactor = selectKFactor(input.sessionCount);
  const expectedScore = computeExpectedScore(input.currentElo, input.opponentElo);
  const actualScore = computeActualScore(input.result, input.hintsUsed);

  const rawDelta = kFactor * (actualScore - expectedScore);
  const newElo = Math.max(MIN_ELO, Math.min(MAX_ELO, input.currentElo + rawDelta));
  const delta = newElo - input.currentElo;

  return {
    previousElo: input.currentElo,
    newElo,
    delta,
    kFactor,
    expectedScore,
    actualScore,
  };
}

/**
 * Compute the global Elo as a weighted average across all concepts.
 * Concepts with higher interview importance contribute more weight.
 */
export function computeGlobalElo(
  conceptElos: Array<{ elo: number; interviewImportance: number }>
): number {
  if (conceptElos.length === 0) return 1000; // Default starting Elo

  const totalWeight = conceptElos.reduce((sum, c) => sum + c.interviewImportance, 0);
  if (totalWeight === 0) {
    // Unweighted average if all weights are zero
    return conceptElos.reduce((sum, c) => sum + c.elo, 0) / conceptElos.length;
  }

  const weightedSum = conceptElos.reduce(
    (sum, c) => sum + c.elo * c.interviewImportance,
    0
  );
  return Math.round(weightedSum / totalWeight);
}
