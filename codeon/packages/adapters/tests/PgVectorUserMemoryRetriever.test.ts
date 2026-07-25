/**
 * PgVectorUserMemoryRetriever unit tests.
 *
 * Strategy:
 *   - queryEmbedder → stub returning a fixed 768-dim zero vector
 *   - db.execute → vi.fn() returning mock embedding rows
 *   - db.query[sessionHints] → vi.fn() returning mock hint rows
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgVectorUserMemoryRetriever } from '../src/retrieval/PgVectorUserMemoryRetriever.js';
import type { RetrieverDb } from '../src/retrieval/PgVectorUserMemoryRetriever.js';
import type { UserId, TeachingStyle } from '@codeon/core/entities';
import type { UserMemorySearchOptions } from '@codeon/core/ports';

// ── Stubs ─────────────────────────────────────────────────────────────────────

const ZERO_VECTOR = new Array(768).fill(0);
const stubEmbedder = vi.fn(async (_text: string) => ZERO_VECTOR);

function makeUserId(id = 'user-abc'): UserId {
  return id as UserId;
}

function makeEmbeddingRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'emb-001',
    submissionId: 'sub-001',
    userId: 'user-abc',
    chunkType: 'mistake_pattern',
    content: 'for (int i=0;i<n;i++) for(int j=0;j<n;j++) ...',
    metadata: {
      language: 'cpp17',
      verdict: 'WA',
      problem_slug: 'two-sum',
      difficulty: 'easy',
      was_ac: false,
    },
    ...overrides,
  };
}

function makeAcEmbeddingRow(overrides: Partial<Record<string, unknown>> = {}) {
  return makeEmbeddingRow({
    id: 'emb-002',
    chunkType: 'full_code',
    metadata: {
      language: 'python3',
      verdict: 'AC',
      problem_slug: 'two-sum',
      difficulty: 'easy',
      was_ac: true,
    },
    ...overrides,
  });
}

function makeMockDb(
  executeRows: unknown[] = [],
  sessionHintRows: unknown[] = []
): RetrieverDb {
  return {
    query: {
      sessionHints: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue(sessionHintRows),
      },
    },
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
    execute: vi.fn().mockResolvedValue(executeRows),
  } as unknown as RetrieverDb;
}

function makeOptions(overrides: Partial<UserMemorySearchOptions> = {}): UserMemorySearchOptions {
  return { userId: makeUserId(), limit: 5, ...overrides };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PgVectorUserMemoryRetriever — findSimilarMistakes', () => {
  beforeEach(() => {
    stubEmbedder.mockClear();
  });

  it('calls queryEmbedder with the query string', async () => {
    const db = makeMockDb([]);
    const retriever = new PgVectorUserMemoryRetriever(db, stubEmbedder);

    await retriever.findSimilarMistakes('nested loop TLE', makeOptions());
    expect(stubEmbedder).toHaveBeenCalledOnce();
    expect(stubEmbedder).toHaveBeenCalledWith('nested loop TLE');
  });

  it('calls db.execute for vector similarity search', async () => {
    const db = makeMockDb([makeEmbeddingRow()]);
    const retriever = new PgVectorUserMemoryRetriever(db, stubEmbedder);

    await retriever.findSimilarMistakes('nested loop TLE', makeOptions());
    expect(db.execute).toHaveBeenCalledOnce();
  });

  it('returns empty array when no similar mistakes found', async () => {
    const db = makeMockDb([]);
    const retriever = new PgVectorUserMemoryRetriever(db, stubEmbedder);

    const result = await retriever.findSimilarMistakes('hash map usage', makeOptions());
    expect(result).toEqual([]);
  });

  it('maps embedding rows to MistakeRecord objects', async () => {
    const db = makeMockDb([makeEmbeddingRow(), makeEmbeddingRow({ id: 'emb-002' })]);
    const retriever = new PgVectorUserMemoryRetriever(db, stubEmbedder);

    const mistakes = await retriever.findSimilarMistakes('O(n²) loop', makeOptions());
    expect(mistakes).toHaveLength(2);
    expect(mistakes[0].id).toBe('emb-001');
    expect(mistakes[0].userId).toBe('user-abc');
    expect(mistakes[0].isResolved).toBe(false);
    expect(mistakes[0].description).toContain('two-sum');
  });

  it('sets conceptId to null (enriched downstream)', async () => {
    const db = makeMockDb([makeEmbeddingRow()]);
    const retriever = new PgVectorUserMemoryRetriever(db, stubEmbedder);

    const mistakes = await retriever.findSimilarMistakes('TLE', makeOptions());
    expect(mistakes[0].conceptId).toBeNull();
  });
});

describe('PgVectorUserMemoryRetriever — findSuccessfulStrategies', () => {
  it('returns only AC submissions as successful strategies', async () => {
    // Two rows — one WA, one AC — only AC should appear
    const db = makeMockDb([
      makeEmbeddingRow({ metadata: { was_ac: false, verdict: 'WA', language: 'cpp17', problem_slug: 'two-sum', difficulty: 'easy' } }),
      makeAcEmbeddingRow(),
    ]);
    const retriever = new PgVectorUserMemoryRetriever(db, stubEmbedder);

    const strategies = await retriever.findSuccessfulStrategies('sliding window', makeOptions());
    expect(strategies).toHaveLength(1);
    expect(strategies[0].description).toContain('two-sum');
    expect(strategies[0].description).toContain('python3');
  });

  it('returns empty array when all retrieved submissions are WA', async () => {
    const db = makeMockDb([makeEmbeddingRow()]);
    const retriever = new PgVectorUserMemoryRetriever(db, stubEmbedder);

    const strategies = await retriever.findSuccessfulStrategies('hash map', makeOptions());
    expect(strategies).toEqual([]);
  });
});

describe('PgVectorUserMemoryRetriever — findEffectiveExplanations', () => {
  it('queries sessionHints filtered by userId and wasHelpful', async () => {
    const hintRows = [
      { id: 'hint-001', userId: 'user-abc', hintType: 'complexity_question', hintText: 'What is O?', wasHelpful: true },
      { id: 'hint-002', userId: 'user-abc', hintType: 'socratic_question', hintText: 'What if sorted?', wasHelpful: true },
    ];
    const db = makeMockDb([], hintRows);
    const retriever = new PgVectorUserMemoryRetriever(db, stubEmbedder);

    const records = await retriever.findEffectiveExplanations('socratic', makeOptions());
    expect(records).toHaveLength(2);
    expect(records[0].exampleHint).toBe('What is O?');
    expect(records[0].wasHelpful).toBe(true);
    expect(records[0].teachingStyle).toBe('socratic');
  });

  it('returns empty array when no helpful hints exist', async () => {
    const db = makeMockDb([], []);
    const retriever = new PgVectorUserMemoryRetriever(db, stubEmbedder);

    const records = await retriever.findEffectiveExplanations('analogy', makeOptions());
    expect(records).toEqual([]);
  });
});

describe('PgVectorUserMemoryRetriever — save + resolve', () => {
  it('saveMistake returns a MistakeRecord with a generated id', async () => {
    const db = makeMockDb();
    const retriever = new PgVectorUserMemoryRetriever(db, stubEmbedder);

    const saved = await retriever.saveMistake({
      userId: makeUserId(),
      conceptId: null,
      description: 'Forgot to handle n=0',
      codeSnippet: 'int f(int n) { return n/2; }',
      correction: 'Check n===0 first',
      frequency: 1,
      lastOccurredAt: new Date(),
      isResolved: false,
    });

    expect(saved.id).toBeTruthy();
    expect(typeof saved.id).toBe('string');
    expect(saved.description).toBe('Forgot to handle n=0');
  });

  it('saveSuccessfulStrategy returns a SuccessfulStrategy with generated id', async () => {
    const db = makeMockDb();
    const retriever = new PgVectorUserMemoryRetriever(db, stubEmbedder);

    const saved = await retriever.saveSuccessfulStrategy({
      userId: makeUserId(),
      description: 'Drawing the graph on paper',
      context: 'Graph problems',
      usedCount: 1,
    });

    expect(saved.id).toBeTruthy();
    expect(saved.description).toBe('Drawing the graph on paper');
  });

  it('saveExplanationRecord returns an ExplanationRecord with generated id', async () => {
    const db = makeMockDb();
    const retriever = new PgVectorUserMemoryRetriever(db, stubEmbedder);

    const saved = await retriever.saveExplanationRecord({
      userId: makeUserId(),
      teachingStyle: 'socratic',
      exampleHint: 'What would happen if you sorted first?',
      wasHelpful: true,
      conceptId: null,
    });

    expect(saved.id).toBeTruthy();
    expect(saved.wasHelpful).toBe(true);
  });

  it('resolveMistake calls db.update', async () => {
    const whereReturn = vi.fn().mockResolvedValue([]);
    const setReturn = vi.fn().mockReturnValue({ where: whereReturn });
    const db = makeMockDb();
    (db.update as ReturnType<typeof vi.fn>) = vi.fn().mockReturnValue({ set: setReturn });

    const retriever = new PgVectorUserMemoryRetriever(db, stubEmbedder);
    await retriever.resolveMistake('mistake-001', makeUserId());

    expect(db.update).toHaveBeenCalledOnce();
    expect(setReturn).toHaveBeenCalledWith({ isResolved: true });
  });
});

describe('PgVectorUserMemoryRetriever — embedding construction', () => {
  it('passes the query string verbatim to the embedder', async () => {
    const db = makeMockDb([]);
    const retriever = new PgVectorUserMemoryRetriever(db, stubEmbedder);
    const query = 'forgot to mod answer by 1e9+7';

    await retriever.findSimilarMistakes(query, makeOptions());
    expect(stubEmbedder).toHaveBeenCalledWith(query);
  });

  it('uses the full embedding vector in the SQL query', async () => {
    const db = makeMockDb([]);
    const retriever = new PgVectorUserMemoryRetriever(db, stubEmbedder);

    await retriever.findSimilarMistakes('mod error', makeOptions());
    const executedQuery = (db.execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    // The 768-dim zero vector should appear as [0,0,0,...] in the query
    expect(executedQuery).toContain('[0,0,0');
  });
});
