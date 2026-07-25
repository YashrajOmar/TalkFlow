/**
 * PgVectorProblemRetriever unit tests.
 *
 * Strategy:
 *   - queryEmbedder → stub returning a fixed 768-dim zero vector
 *   - db.query[table] → vi.fn() returning mock scraped_problems rows
 *   - db.execute → vi.fn() returning mock rows for vector search
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgVectorProblemRetriever } from '../src/retrieval/PgVectorProblemRetriever.js';
import type { ProblemRetrieverDb } from '../src/retrieval/PgVectorProblemRetriever.js';
import type { ProblemId, Language } from '@codeon/core/entities';

// ── Stubs ─────────────────────────────────────────────────────────────────────

const ZERO_VECTOR = new Array(768).fill(0);
const stubEmbedder = vi.fn(async (_text: string) => ZERO_VECTOR);

function makeProblemId(id = 'prob-001'): ProblemId {
  return id as ProblemId;
}

function makeProblemRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'prob-001',
    url: 'https://leetcode.com/problems/two-sum',
    platform: 'leetcode',
    externalId: '1',
    title: 'Two Sum',
    statement: 'Given an array of integers nums and an integer target...',
    constraints: ['2 <= nums.length <= 10^4', '-10^9 <= nums[i] <= 10^9'],
    inputFormat: 'An array of integers and a target',
    outputFormat: 'Array of two indices',
    difficulty: 'easy',
    tags: ['array', 'hash_table'],
    editorialCode: 'unordered_map<int,int> seen; for(int i=0;i<n;i++){...}',
    editorialLanguage: 'cpp17',
    editorialExplanation: 'Use a hash map to store complement values',
    optimalComplexity: 'O(n)',
    timeLimitMs: 2000,
    memoryLimitKb: 65536,
    scrapedAt: new Date('2025-01-01T00:00:00Z'),
    lastVerifiedAt: new Date('2025-06-01T00:00:00Z'),
    ...overrides,
  };
}

function makeMockDb(opts: {
  scrapedProblemsFirst?: unknown;
  scrapedProblemsMany?: unknown[];
  problemEmbeddingsMany?: unknown[];
  problemTopicsMany?: unknown[];
  userSubmissionsMany?: unknown[];
  executeRows?: unknown[];
} = {}): ProblemRetrieverDb {
  return {
    query: {
      scrapedProblems: {
        findFirst: vi.fn().mockResolvedValue(opts.scrapedProblemsFirst ?? null),
        findMany: vi.fn().mockResolvedValue(opts.scrapedProblemsMany ?? []),
      },
      problemEmbeddings: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue(opts.problemEmbeddingsMany ?? []),
      },
      problemTopics: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue(opts.problemTopicsMany ?? []),
      },
      userSubmissions: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue(opts.userSubmissionsMany ?? []),
      },
    },
    execute: vi.fn().mockResolvedValue(opts.executeRows ?? []),
  } as unknown as ProblemRetrieverDb;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PgVectorProblemRetriever — fetchProblem', () => {
  beforeEach(() => stubEmbedder.mockClear());

  it('returns null when problem not found', async () => {
    const db = makeMockDb({ scrapedProblemsFirst: null });
    const retriever = new PgVectorProblemRetriever(db, stubEmbedder);

    const result = await retriever.fetchProblem(makeProblemId('no-such'));
    expect(result).toBeNull();
  });

  it('maps a scraped_problems row to a Problem entity', async () => {
    const db = makeMockDb({ scrapedProblemsFirst: makeProblemRow() });
    const retriever = new PgVectorProblemRetriever(db, stubEmbedder);

    const problem = await retriever.fetchProblem(makeProblemId());
    expect(problem).not.toBeNull();
    expect(problem!.id).toBe('prob-001');
    expect(problem!.title).toBe('Two Sum');
    expect(problem!.source).toBe('leetcode');
    expect(problem!.difficultyTier).toBe('easy');
    expect(problem!.constraints).toEqual(['2 <= nums.length <= 10^4', '-10^9 <= nums[i] <= 10^9']);
    expect(problem!.tags).toEqual(['array', 'hash_table']);
  });

  it('maps editorial fields correctly', async () => {
    const db = makeMockDb({ scrapedProblemsFirst: makeProblemRow() });
    const retriever = new PgVectorProblemRetriever(db, stubEmbedder);

    const problem = await retriever.fetchProblem(makeProblemId());
    expect(problem!.editorial.summary).toBe('Use a hash map to store complement values');
    expect(problem!.editorial.complexity.time).toBe('O(n)');
  });

  it('handles null constraints and tags gracefully', async () => {
    const db = makeMockDb({ scrapedProblemsFirst: makeProblemRow({ constraints: null, tags: null }) });
    const retriever = new PgVectorProblemRetriever(db, stubEmbedder);

    const problem = await retriever.fetchProblem(makeProblemId());
    expect(problem!.constraints).toEqual([]);
    expect(problem!.tags).toEqual([]);
  });
});

describe('PgVectorProblemRetriever — fetchEditorial', () => {
  it('returns null when problem not found', async () => {
    const db = makeMockDb({ scrapedProblemsFirst: null });
    const retriever = new PgVectorProblemRetriever(db, stubEmbedder);

    const result = await retriever.fetchEditorial(makeProblemId('no-such'));
    expect(result).toBeNull();
  });

  it('returns null when problem has no editorial', async () => {
    const db = makeMockDb({
      scrapedProblemsFirst: makeProblemRow({ editorialExplanation: null }),
    });
    const retriever = new PgVectorProblemRetriever(db, stubEmbedder);

    const result = await retriever.fetchEditorial(makeProblemId());
    expect(result).toBeNull();
  });

  it('maps editorial fields including solutions when editorialCode exists', async () => {
    const db = makeMockDb({ scrapedProblemsFirst: makeProblemRow() });
    const retriever = new PgVectorProblemRetriever(db, stubEmbedder);

    const editorial = await retriever.fetchEditorial(makeProblemId());
    expect(editorial).not.toBeNull();
    expect(editorial!.summary).toBe('Use a hash map to store complement values');
    expect(editorial!.complexity.time).toBe('O(n)');
    expect(editorial!.solutions).toHaveLength(1);
    expect(editorial!.solutions[0].language).toBe('cpp17');
    expect(editorial!.solutions[0].isOptimal).toBe(true);
  });

  it('returns empty solutions when no editorial code', async () => {
    const db = makeMockDb({
      scrapedProblemsFirst: makeProblemRow({ editorialCode: null }),
    });
    const retriever = new PgVectorProblemRetriever(db, stubEmbedder);

    const editorial = await retriever.fetchEditorial(makeProblemId());
    expect(editorial!.solutions).toEqual([]);
  });
});

describe('PgVectorProblemRetriever — fetchSolutions', () => {
  it('returns empty array when problem not found', async () => {
    const db = makeMockDb({ scrapedProblemsFirst: null });
    const retriever = new PgVectorProblemRetriever(db, stubEmbedder);

    const solutions = await retriever.fetchSolutions(makeProblemId('no-such'));
    expect(solutions).toEqual([]);
  });

  it('returns AC user submissions as solutions', async () => {
    const subRows = [
      { language: 'cpp17', code: 'int f(){return 1;}', runtimeMs: 4, memoryKb: 5120 },
      { language: 'python3', code: 'def f(): return 1', runtimeMs: 12, memoryKb: 6144 },
    ];
    const db = makeMockDb({
      scrapedProblemsFirst: makeProblemRow(),
      userSubmissionsMany: subRows,
    });
    const retriever = new PgVectorProblemRetriever(db, stubEmbedder);

    const solutions = await retriever.fetchSolutions(makeProblemId());
    expect(solutions).toHaveLength(2);
    expect(solutions[0].language).toBe('cpp17');
    expect(solutions[1].language).toBe('python3');
  });
});

describe('PgVectorProblemRetriever — findSimilarProblems', () => {
  it('returns empty array when no embedding found for source problem', async () => {
    const db = makeMockDb({ problemEmbeddingsMany: [] });
    const retriever = new PgVectorProblemRetriever(db, stubEmbedder);

    const similar = await retriever.findSimilarProblems(makeProblemId());
    expect(similar).toEqual([]);
  });

  it('calls db.execute for vector similarity when embedding found', async () => {
    const db = makeMockDb({
      problemEmbeddingsMany: [{ embedding: ZERO_VECTOR }],
      executeRows: [makeProblemRow({ id: 'prob-002', title: 'Three Sum' })],
    });
    const retriever = new PgVectorProblemRetriever(db, stubEmbedder);

    const similar = await retriever.findSimilarProblems(makeProblemId());
    expect(db.execute).toHaveBeenCalledOnce();
    expect(similar).toHaveLength(1);
    expect(similar[0].title).toBe('Three Sum');
  });
});

describe('PgVectorProblemRetriever — searchProblems', () => {
  beforeEach(() => stubEmbedder.mockClear());

  it('calls queryEmbedder with the search query', async () => {
    const db = makeMockDb({ executeRows: [] });
    const retriever = new PgVectorProblemRetriever(db, stubEmbedder);

    await retriever.searchProblems('sliding window maximum');
    expect(stubEmbedder).toHaveBeenCalledOnce();
    expect(stubEmbedder).toHaveBeenCalledWith('sliding window maximum');
  });

  it('returns mapped Problem objects from execute results', async () => {
    const db = makeMockDb({
      executeRows: [makeProblemRow(), makeProblemRow({ id: 'prob-002', title: 'Longest Substring' })],
    });
    const retriever = new PgVectorProblemRetriever(db, stubEmbedder);

    const results = await retriever.searchProblems('substring');
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe('Two Sum');
    expect(results[1].title).toBe('Longest Substring');
  });

  it('returns empty array when no similar problems found', async () => {
    const db = makeMockDb({ executeRows: [] });
    const retriever = new PgVectorProblemRetriever(db, stubEmbedder);

    const results = await retriever.searchProblems('extremely obscure topic xyz');
    expect(results).toEqual([]);
  });

  it('passes vector literal to the SQL query string', async () => {
    const db = makeMockDb({ executeRows: [] });
    const retriever = new PgVectorProblemRetriever(db, stubEmbedder);

    await retriever.searchProblems('test query');
    const query = (db.execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(query).toContain('[0,0,0');
    expect(query).toContain('<=>');
  });
});

describe('PgVectorProblemRetriever — findProblemsByConceptIds', () => {
  it('returns empty array when conceptIds is empty', async () => {
    const db = makeMockDb({});
    const retriever = new PgVectorProblemRetriever(db, stubEmbedder);

    const results = await retriever.findProblemsByConceptIds([]);
    expect(results).toEqual([]);
  });

  it('returns problems from problem_topics join', async () => {
    const db = makeMockDb({
      problemTopicsMany: [
        { problem: makeProblemRow({ id: 'prob-001', title: 'Two Sum' }) },
        { problem: makeProblemRow({ id: 'prob-002', title: 'Four Sum' }) },
      ],
    });
    const retriever = new PgVectorProblemRetriever(db, stubEmbedder);

    const results = await retriever.findProblemsByConceptIds([
      'ct-hash-map' as import('@codeon/core/entities').ConceptId,
    ]);
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe('Two Sum');
    expect(results[1].title).toBe('Four Sum');
  });

  it('filters out rows where problem is null/undefined', async () => {
    const db = makeMockDb({
      problemTopicsMany: [
        { problem: makeProblemRow() },
        { problem: null },  // deleted problem
      ],
    });
    const retriever = new PgVectorProblemRetriever(db, stubEmbedder);

    const results = await retriever.findProblemsByConceptIds([
      'ct-array' as import('@codeon/core/entities').ConceptId,
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Two Sum');
  });
});

describe('PgVectorProblemRetriever — problem mapping correctness', () => {
  it('uses scrapedAt for createdAt and lastVerifiedAt for updatedAt', async () => {
    const scrapedAt = new Date('2025-01-15T00:00:00Z');
    const lastVerifiedAt = new Date('2025-06-20T00:00:00Z');
    const db = makeMockDb({
      scrapedProblemsFirst: makeProblemRow({ scrapedAt, lastVerifiedAt }),
    });
    const retriever = new PgVectorProblemRetriever(db, stubEmbedder);

    const problem = await retriever.fetchProblem(makeProblemId());
    expect(problem!.createdAt).toEqual(scrapedAt);
    expect(problem!.updatedAt).toEqual(lastVerifiedAt);
  });

  it('generates a slug from externalId', async () => {
    const db = makeMockDb({ scrapedProblemsFirst: makeProblemRow({ externalId: '1' }) });
    const retriever = new PgVectorProblemRetriever(db, stubEmbedder);

    const problem = await retriever.fetchProblem(makeProblemId());
    expect(problem!.slug).toBe('1');
  });

  it('falls back to title-based slug when externalId is null', async () => {
    const db = makeMockDb({ scrapedProblemsFirst: makeProblemRow({ externalId: null }) });
    const retriever = new PgVectorProblemRetriever(db, stubEmbedder);

    const problem = await retriever.fetchProblem(makeProblemId());
    expect(problem!.slug).toBe('two-sum');
  });
});
