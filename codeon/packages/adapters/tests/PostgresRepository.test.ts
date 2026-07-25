/**
 * PostgresRepository unit tests.
 *
 * Strategy: mock db.query[table].findFirst / findMany at the call-site level
 * using vi.fn(). No real database is started.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PostgresRepository } from '../src/storage/PostgresRepository.js';
import type { DrizzleDb } from '../src/storage/PostgresRepository.js';
import type { UserId, SessionId, HintId } from '@codeon/core/entities';
import type { StudentProfile, CodingStyleProfile } from '@codeon/core/entities';
import type { CodingSession, Hint } from '@codeon/core/entities';
import type { LearningEvent, ProblemAttemptedEvent } from '@codeon/core/entities';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeUserId(id = 'user-123'): UserId {
  return id as UserId;
}

function makeUserRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'user-123',
    email: 'alice@example.com',
    displayName: 'Alice',
    primaryLanguage: 'cpp17',
    inferredElo: 1200,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-06-01'),
    ...overrides,
  };
}

function makeSessionRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'session-abc',
    userId: 'user-123',
    problemId: 'prob-789',
    startedAt: new Date('2025-06-15T10:00:00Z'),
    endedAt: new Date('2025-06-15T11:00:00Z'),
    status: 'solved',
    currentCode: 'int main() { return 0; }',
    currentLanguage: 'cpp17',
    hintsGiven: 2,
    solvedWithoutHints: false,
    detectedComplexity: 'O(n)',
    detectedLevel: 'two_pointer',
    ...overrides,
  };
}

function makeHintRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'hint-001',
    sessionId: 'session-abc',
    userId: 'user-123',
    sequenceNumber: 1,
    hintText: 'What is the time complexity of your current approach?',
    hintType: 'complexity_nudge',
    codeSnapshot: 'for (int i=0;i<n;i++) for(int j=0;j<n;j++) ...',
    complexityAtTime: 'O(n²)',
    levelAtTime: 'brute_force',
    ragSubmissionIds: null,
    wasHelpful: null,
    generatedAt: new Date('2025-06-15T10:30:00Z'),
    ...overrides,
  };
}

function makeLearningEventRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'event-001',
    userId: 'user-123',
    type: 'PROBLEM_ATTEMPTED',
    payload: {
      type: 'PROBLEM_ATTEMPTED',
      sessionId: 'session-abc',
      problemId: 'prob-789',
      solved: true,
      hintsUsed: 2,
      durationMinutes: 60,
      finalAlgorithmicLevel: 'two_pointer',
      eloDelta: 15,
    },
    occurredAt: new Date('2025-06-15T11:00:00Z'),
    insertedAt: new Date('2025-06-15T11:00:01Z'),
    ...overrides,
  };
}

// ── Mock DB builder ───────────────────────────────────────────────────────────

function makeMockDb(overrides: Partial<DrizzleDb> = {}): DrizzleDb {
  const mockQuery = (firstReturn: unknown = null, manyReturn: unknown[] = []) => ({
    findFirst: vi.fn().mockResolvedValue(firstReturn),
    findMany: vi.fn().mockResolvedValue(manyReturn),
  });

  return {
    query: {
      users: mockQuery(),
      codingSessions: mockQuery(),
      sessionHints: mockQuery(),
      scrapedProblems: mockQuery(),
      problemTopics: mockQuery(),
      conceptTopics: mockQuery(),
      learningEvents: mockQuery(),
    },
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    ...overrides,
  } as unknown as DrizzleDb;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PostgresRepository — Student Profile', () => {
  it('findProfileById returns null when user not found', async () => {
    const db = makeMockDb();
    (db.query['users'].findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const repo = new PostgresRepository(db);

    const result = await repo.findProfileById(makeUserId());
    expect(result).toBeNull();
  });

  it('findProfileById maps a user row to a StudentProfile', async () => {
    const db = makeMockDb();
    const row = makeUserRow({ inferredElo: 1400, primaryLanguage: 'python3' });
    (db.query['users'].findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(row);
    const repo = new PostgresRepository(db);

    const result = await repo.findProfileById(makeUserId());
    expect(result).not.toBeNull();
    expect(result!.email).toBe('alice@example.com');
    expect(result!.displayName).toBe('Alice');
    expect(result!.globalElo).toBe(1400);
    expect(result!.primaryLanguage).toBe('python3');
  });

  it('findProfileByEmail returns null when user not found', async () => {
    const db = makeMockDb();
    (db.query['users'].findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const repo = new PostgresRepository(db);

    const result = await repo.findProfileByEmail('ghost@example.com');
    expect(result).toBeNull();
  });

  it('findProfileSummaryById returns a summary with correct userId', async () => {
    const db = makeMockDb();
    const row = makeUserRow({ inferredElo: 1250 });
    (db.query['users'].findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(row);
    const repo = new PostgresRepository(db);

    const summary = await repo.findProfileSummaryById(makeUserId());
    expect(summary).not.toBeNull();
    expect(summary!.userId).toBe('user-123');
    expect(summary!.displayName).toBe('Alice');
    expect(summary!.globalElo).toBe(1250);
  });

  it('saveProfile calls db.insert with the correct user fields', async () => {
    const db = makeMockDb();
    const insertValuesMock = vi.fn().mockResolvedValue([]);
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values: insertValuesMock });
    const repo = new PostgresRepository(db);

    const profile = {
      id: makeUserId(),
      email: 'alice@example.com',
      displayName: 'Alice',
      primaryLanguage: 'cpp17',
      globalElo: 1200,
    } as unknown as StudentProfile;

    await repo.saveProfile(profile);
    expect(db.insert).toHaveBeenCalledOnce();
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'alice@example.com', displayName: 'Alice' })
    );
  });

  it('isNewUser is true when inferredElo is 0', async () => {
    const db = makeMockDb();
    const row = makeUserRow({ inferredElo: 0 });
    (db.query['users'].findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(row);
    const repo = new PostgresRepository(db);

    const profile = await repo.findProfileById(makeUserId());
    expect(profile!.isNewUser).toBe(true);
  });
});

describe('PostgresRepository — Sessions', () => {
  it('findSessionById returns null when session not found', async () => {
    const db = makeMockDb();
    (db.query['codingSessions'].findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const repo = new PostgresRepository(db);

    const result = await repo.findSessionById('no-such-session' as SessionId);
    expect(result).toBeNull();
  });

  it('findSessionById maps a session row to a CodingSession', async () => {
    const db = makeMockDb();
    const row = makeSessionRow();
    (db.query['codingSessions'].findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(row);
    const repo = new PostgresRepository(db);

    const session = await repo.findSessionById('session-abc' as SessionId);
    expect(session).not.toBeNull();
    expect(session!.id).toBe('session-abc');
    expect(session!.userId).toBe('user-123');
    expect(session!.solved).toBe(true);
    expect(session!.latestCode).toBe('int main() { return 0; }');
    expect(session!.totalHintsRequested).toBe(2);
  });

  it('findSessionById calculates durationMinutes from timestamps', async () => {
    const db = makeMockDb();
    const row = makeSessionRow({
      startedAt: new Date('2025-06-15T10:00:00Z'),
      endedAt: new Date('2025-06-15T10:30:00Z'),
    });
    (db.query['codingSessions'].findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(row);
    const repo = new PostgresRepository(db);

    const session = await repo.findSessionById('session-abc' as SessionId);
    expect(session!.durationMinutes).toBe(30);
  });

  it('findSessionsByUserId returns mapped sessions', async () => {
    const db = makeMockDb();
    const rows = [makeSessionRow(), makeSessionRow({ id: 'session-xyz', status: 'active', endedAt: null, solvedWithoutHints: false })];
    (db.query['codingSessions'].findMany as ReturnType<typeof vi.fn>).mockResolvedValue(rows);
    const repo = new PostgresRepository(db);

    const sessions = await repo.findSessionsByUserId(makeUserId());
    expect(sessions).toHaveLength(2);
    expect(sessions[0].id).toBe('session-abc');
    expect(sessions[1].id).toBe('session-xyz');
  });

  it('saveSession calls db.insert', async () => {
    const db = makeMockDb();
    const insertValuesMock = vi.fn().mockResolvedValue([]);
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values: insertValuesMock });
    const repo = new PostgresRepository(db);

    const session = { id: 'session-abc', userId: makeUserId(), latestCode: '', language: 'cpp17', totalHintsRequested: 0, solved: false } as unknown as CodingSession;
    await repo.saveSession(session);
    expect(db.insert).toHaveBeenCalledOnce();
  });
});

describe('PostgresRepository — Hints', () => {
  it('findHintsBySessionId returns mapped hints in order', async () => {
    const db = makeMockDb();
    const rows = [makeHintRow({ sequenceNumber: 1 }), makeHintRow({ id: 'hint-002', sequenceNumber: 2, hintText: 'Second hint' })];
    (db.query['sessionHints'].findMany as ReturnType<typeof vi.fn>).mockResolvedValue(rows);
    const repo = new PostgresRepository(db);

    const hints = await repo.findHintsBySessionId('session-abc' as SessionId);
    expect(hints).toHaveLength(2);
    expect(hints[0].sequenceNumber).toBe(1);
    expect(hints[1].sequenceNumber).toBe(2);
    expect(hints[0].content).toBe('What is the time complexity of your current approach?');
  });

  it('findHintsBySessionId returns empty array when no hints', async () => {
    const db = makeMockDb();
    (db.query['sessionHints'].findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const repo = new PostgresRepository(db);

    const hints = await repo.findHintsBySessionId('no-hints-session' as SessionId);
    expect(hints).toEqual([]);
  });

  it('saveHint calls db.insert', async () => {
    const db = makeMockDb();
    const insertValuesMock = vi.fn().mockResolvedValue([]);
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values: insertValuesMock });
    const repo = new PostgresRepository(db);

    const hint = {
      id: 'hint-001' as HintId,
      sessionId: 'session-abc' as SessionId,
      sequenceNumber: 1,
      content: 'Think about two pointers',
      hintType: 'data_structure_hint',
      trailStepTarget: null,
      wasHelpful: null,
      generatedAt: new Date(),
    } as Hint;

    await repo.saveHint(hint);
    expect(db.insert).toHaveBeenCalledOnce();
  });
});

describe('PostgresRepository — Problems', () => {
  it('findProblemById returns null when problem not found', async () => {
    const db = makeMockDb();
    (db.query['scrapedProblems'].findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const repo = new PostgresRepository(db);

    const result = await repo.findProblemById('no-such-problem' as import('@codeon/core/entities').ProblemId);
    expect(result).toBeNull();
  });

  it('findProblemById maps a scraped_problems row to a Problem', async () => {
    const db = makeMockDb();
    const row = {
      id: 'prob-789',
      url: 'https://leetcode.com/problems/two-sum',
      platform: 'leetcode',
      externalId: '1',
      title: 'Two Sum',
      statement: 'Given an array of integers...',
      constraints: ['2 <= nums.length <= 10^4'],
      inputFormat: 'An array of integers',
      outputFormat: 'Array of indices',
      difficulty: 'easy',
      tags: ['array', 'hash_table'],
      editorialCode: null,
      editorialLanguage: null,
      editorialExplanation: 'Use a hash map',
      optimalComplexity: 'O(n)',
      timeLimitMs: 2000,
      memoryLimitKb: 65536,
      scrapedAt: new Date('2025-01-01'),
      lastVerifiedAt: new Date('2025-06-01'),
    };
    (db.query['scrapedProblems'].findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(row);
    const repo = new PostgresRepository(db);

    const prob = await repo.findProblemById('prob-789' as import('@codeon/core/entities').ProblemId);
    expect(prob).not.toBeNull();
    expect(prob!.title).toBe('Two Sum');
    expect(prob!.source).toBe('leetcode');
    expect(prob!.difficultyTier).toBe('easy');
    expect(prob!.tags).toEqual(['array', 'hash_table']);
    expect(prob!.editorial.complexity.time).toBe('O(n)');
  });
});

describe('PostgresRepository — Learning Events', () => {
  it('findLearningEventsByUserId returns empty array when no events', async () => {
    const db = makeMockDb();
    (db.query['learningEvents'].findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const repo = new PostgresRepository(db);

    const events = await repo.findLearningEventsByUserId(makeUserId());
    expect(events).toEqual([]);
  });

  it('findLearningEventsByUserId maps rows to LearningEvent discriminated union', async () => {
    const db = makeMockDb();
    const row = makeLearningEventRow();
    (db.query['learningEvents'].findMany as ReturnType<typeof vi.fn>).mockResolvedValue([row]);
    const repo = new PostgresRepository(db);

    const events = await repo.findLearningEventsByUserId(makeUserId());
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('PROBLEM_ATTEMPTED');
    expect(events[0].userId).toBe('user-123');
    const e = events[0] as ProblemAttemptedEvent;
    expect(e.solved).toBe(true);
    expect(e.hintsUsed).toBe(2);
  });

  it('saveLearningEvent calls db.insert with type + payload + occurredAt', async () => {
    const db = makeMockDb();
    const insertValuesMock = vi.fn().mockResolvedValue([]);
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values: insertValuesMock });
    const repo = new PostgresRepository(db);

    const event: LearningEvent = {
      id: 'event-001' as import('@codeon/core/entities').EventId,
      type: 'PROBLEM_ATTEMPTED',
      userId: makeUserId(),
      occurredAt: new Date(),
      sessionId: 'session-abc' as SessionId,
      problemId: 'prob-789' as import('@codeon/core/entities').ProblemId,
      solved: true,
      hintsUsed: 0,
      durationMinutes: 45,
      finalAlgorithmicLevel: 'two_pointer',
      eloDelta: 20,
    };

    await repo.saveLearningEvent(event);
    expect(db.insert).toHaveBeenCalledOnce();
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'PROBLEM_ATTEMPTED', occurredAt: event.occurredAt })
    );
  });
});

describe('PostgresRepository — Knowledge Graph', () => {
  it('findConceptById returns null when concept not found', async () => {
    const db = makeMockDb();
    (db.query['conceptTopics'].findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const repo = new PostgresRepository(db);

    const result = await repo.findConceptById('no-concept' as import('@codeon/core/entities').ConceptId);
    expect(result).toBeNull();
  });

  it('findConceptsByCategory returns mapped concepts', async () => {
    const db = makeMockDb();
    const rows = [
      { id: 'ct-1', slug: 'binary_search', displayName: 'Binary Search', category: 'algorithm', description: 'Divide and conquer search', difficultyLevel: 3 },
      { id: 'ct-2', slug: 'two_pointers', displayName: 'Two Pointers', category: 'algorithm', description: 'Two pointer technique', difficultyLevel: 2 },
    ];
    (db.query['conceptTopics'].findMany as ReturnType<typeof vi.fn>).mockResolvedValue(rows);
    const repo = new PostgresRepository(db);

    const concepts = await repo.findConceptsByCategory('algorithm');
    expect(concepts).toHaveLength(2);
    expect(concepts[0].name).toBe('Binary Search');
    expect(concepts[1].name).toBe('Two Pointers');
    expect(concepts[0].typicalEloToLearn).toBe(600); // 3 * 200
  });
});
