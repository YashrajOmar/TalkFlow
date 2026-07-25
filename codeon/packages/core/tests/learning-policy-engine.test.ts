import { describe, it, expect } from 'vitest';
import { evaluatePolicy } from '../src/learning-policy-engine.js';
import type { PolicyContext } from '../src/learning-policy-engine.js';

const baseContext: PolicyContext = {
  hintsGivenThisSession: 0,
  secondsSinceLastHint: 0,
  studentGlobalElo: 1200,
  currentAlgorithmicLevel: 'brute_force',
  mistakesThisSession: 0,
  minutesStuckAtCurrentLevel: 0,
  studentRequestedHint: false,
  sessionMode: 'problem',
  lastVerdict: null,
  isNewUser: false,
  dailyHintCount: 0,
};

describe('LearningPolicyEngine', () => {
  describe('explicit hint request', () => {
    it('delivers hint when student explicitly requests one', () => {
      const result = evaluatePolicy({ ...baseContext, studentRequestedHint: true });
      expect(result.action).toBe('deliver_hint');
    });

    it('recommends revision when daily hint limit is reached', () => {
      const result = evaluatePolicy({
        ...baseContext,
        studentRequestedHint: true,
        dailyHintCount: 50,
      });
      expect(result.action).toBe('recommend_revision');
    });
  });

  describe('contest mode', () => {
    it('never delivers a hint in contest mode', () => {
      const result = evaluatePolicy({
        ...baseContext,
        sessionMode: 'contest',
        studentRequestedHint: true, // Even explicit requests are blocked
      });
      // Contest mode returns wait immediately before checking explicit request
      expect(result.action).toBe('wait');
    });
  });

  describe('interview mode', () => {
    it('waits indefinitely without explicit request', () => {
      const result = evaluatePolicy({
        ...baseContext,
        sessionMode: 'interview',
        minutesStuckAtCurrentLevel: 999,
      });
      expect(result.action).toBe('wait');
    });

    it('delivers hint when explicitly requested in interview mode', () => {
      const result = evaluatePolicy({
        ...baseContext,
        sessionMode: 'interview',
        studentRequestedHint: true,
      });
      expect(result.action).toBe('deliver_hint');
    });
  });

  describe('time-based intervention', () => {
    it('waits when student has not been stuck long enough', () => {
      const result = evaluatePolicy({
        ...baseContext,
        minutesStuckAtCurrentLevel: 3, // < 10 minute threshold
      });
      expect(result.action).toBe('wait');
    });

    it('delivers hint after threshold time has passed', () => {
      const result = evaluatePolicy({
        ...baseContext,
        minutesStuckAtCurrentLevel: 12,     // > 10 minute threshold
        secondsSinceLastHint: 400,           // > 5 minute between-hints interval
      });
      expect(result.action).toBe('deliver_hint');
    });
  });

  describe('experienced student policy', () => {
    it('prescribes longer struggle for high-Elo students', () => {
      const result = evaluatePolicy({
        ...baseContext,
        studentGlobalElo: 2000,
        minutesStuckAtCurrentLevel: 12, // Would trigger hint for normal student
      });
      // High-Elo threshold is doubled (20 minutes), so 12 minutes → prescribe struggle
      expect(result.action).toBe('prescribe_struggle');
    });
  });

  describe('hint type selection', () => {
    it('selects edge_case_probe after Wrong Answer', () => {
      const result = evaluatePolicy({
        ...baseContext,
        studentRequestedHint: true,
        lastVerdict: 'WA',
      });
      expect(result.action).toBe('deliver_hint');
      if (result.action === 'deliver_hint') {
        expect(result.hintType).toBe('edge_case_probe');
      }
    });

    it('selects complexity_question after TLE', () => {
      const result = evaluatePolicy({
        ...baseContext,
        studentRequestedHint: true,
        lastVerdict: 'TLE',
      });
      expect(result.action).toBe('deliver_hint');
      if (result.action === 'deliver_hint') {
        expect(result.hintType).toBe('complexity_question');
      }
    });
  });

  describe('revision recommendation', () => {
    it('recommends revision when mistakes and hint limit both exceeded', () => {
      const result = evaluatePolicy({
        ...baseContext,
        mistakesThisSession: 4,
        hintsGivenThisSession: 9, // > maxHintsBeforeRevision (8) for problem mode
        minutesStuckAtCurrentLevel: 20,
        secondsSinceLastHint: 600,
      });
      expect(result.action).toBe('recommend_revision');
    });
  });

  describe('new user policy', () => {
    it('uses lower time threshold for new users', () => {
      // New users get hints sooner (threshold reduced by 5 minutes)
      const newUser = evaluatePolicy({
        ...baseContext,
        isNewUser: true,
        minutesStuckAtCurrentLevel: 6,  // < 10 normally, but threshold is 5 for new users
        secondsSinceLastHint: 300,
      });
      const existingUser = evaluatePolicy({
        ...baseContext,
        isNewUser: false,
        minutesStuckAtCurrentLevel: 6,
        secondsSinceLastHint: 300,
      });

      // New user should get hint sooner
      expect(newUser.action).toBe('deliver_hint');
      expect(existingUser.action).toBe('wait');
    });
  });
});
