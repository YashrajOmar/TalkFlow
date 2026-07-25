import { describe, it, expect } from 'vitest';
import { computeEloUpdate, computeGlobalElo } from '../src/learning-engine/elo-engine.js';

describe('EloEngine', () => {
  describe('computeEloUpdate', () => {
    it('increases Elo on win', () => {
      const result = computeEloUpdate({
        currentElo: 1200,
        opponentElo: 1200,
        result: 'win',
        sessionCount: 5,
        hintsUsed: 0,
      });
      expect(result.newElo).toBeGreaterThan(1200);
      expect(result.delta).toBeGreaterThan(0);
    });

    it('decreases Elo on loss', () => {
      const result = computeEloUpdate({
        currentElo: 1200,
        opponentElo: 1200,
        result: 'loss',
        sessionCount: 5,
        hintsUsed: 0,
      });
      expect(result.newElo).toBeLessThan(1200);
      expect(result.delta).toBeLessThan(0);
    });

    it('hint penalty reduces win reward', () => {
      const noHints = computeEloUpdate({
        currentElo: 1200,
        opponentElo: 1200,
        result: 'win',
        sessionCount: 5,
        hintsUsed: 0,
      });
      const manyHints = computeEloUpdate({
        currentElo: 1200,
        opponentElo: 1200,
        result: 'win',
        sessionCount: 5,
        hintsUsed: 6,
      });
      expect(noHints.delta).toBeGreaterThan(manyHints.delta);
    });

    it('uses higher K-factor for new students', () => {
      const newStudent = computeEloUpdate({
        currentElo: 1000,
        opponentElo: 1000,
        result: 'win',
        sessionCount: 3,
        hintsUsed: 0,
      });
      const experienced = computeEloUpdate({
        currentElo: 1000,
        opponentElo: 1000,
        result: 'win',
        sessionCount: 50,
        hintsUsed: 0,
      });
      expect(newStudent.kFactor).toBe(40);
      expect(experienced.kFactor).toBe(16);
      expect(newStudent.delta).toBeGreaterThan(experienced.delta);
    });

    it('clamps Elo to minimum of 400', () => {
      const result = computeEloUpdate({
        currentElo: 400,
        opponentElo: 3000,
        result: 'loss',
        sessionCount: 100,
        hintsUsed: 0,
      });
      expect(result.newElo).toBeGreaterThanOrEqual(400);
    });

    it('clamps Elo to maximum of 3000', () => {
      const result = computeEloUpdate({
        currentElo: 3000,
        opponentElo: 400,
        result: 'win',
        sessionCount: 100,
        hintsUsed: 0,
      });
      expect(result.newElo).toBeLessThanOrEqual(3000);
    });
  });

  describe('computeGlobalElo', () => {
    it('returns default Elo for empty concept list', () => {
      expect(computeGlobalElo([])).toBe(1000);
    });

    it('computes weighted average correctly', () => {
      const result = computeGlobalElo([
        { elo: 1000, interviewImportance: 1.0 },
        { elo: 2000, interviewImportance: 1.0 },
      ]);
      expect(result).toBe(1500);
    });

    it('weights higher-importance concepts more', () => {
      const result = computeGlobalElo([
        { elo: 800, interviewImportance: 0.1 },
        { elo: 2000, interviewImportance: 0.9 },
      ]);
      expect(result).toBeGreaterThan(1400); // Skewed toward 2000
    });
  });
});
