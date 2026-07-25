/**
 * PgVectorProblemRetriever — pgvector-backed implementation of IProblemRetriever.
 *
 * Provides the Problem Knowledge Base RAG retrieval:
 *   - Exact lookups by ID or slug
 *   - Vector similarity search over problem_embeddings
 *   - Relational joins through problem_topics
 *
 * Like PgVectorUserMemoryRetriever, the queryEmbedder is injected so tests
 * can pass a stub without a real embedding API call.
 */

import type { IProblemRetriever, ProblemSearchOptions } from '@codeon/core/ports';
import type { ConceptId, DifficultyTier, Language, ProblemId, ProblemSource } from '@codeon/core/entities';
import type { Problem, Editorial, Solution } from '@codeon/core/entities';

/** Minimum shape of a db client for this retriever. */
export interface ProblemRetrieverDb {
  query: Record<string, {
    findFirst: (opts?: unknown) => Promise<unknown>;
    findMany: (opts?: unknown) => Promise<unknown[]>;
  }>;
  execute: (query: unknown) => Promise<unknown[]>;
}

/** Embed a query string into a 768-dim vector (injectable). */
export type QueryEmbedder = (text: string) => Promise<number[]>;

// ── Row type for scraped_problems ─────────────────────────────────────────────

type ScrapedProblemRow = {
  id: string;
  url: string;
  platform: string;
  externalId: string | null;
  title: string;
  statement: string;
  constraints: string[] | null;
  inputFormat: string | null;
  outputFormat: string | null;
  difficulty: string | null;
  tags: string[] | null;
  editorialCode: string | null;
  editorialLanguage: string | null;
  editorialExplanation: string | null;
  optimalComplexity: string | null;
  timeLimitMs: number | null;
  memoryLimitKb: number | null;
  scrapedAt: Date;
  lastVerifiedAt: Date;
};

// ── Implementation ────────────────────────────────────────────────────────────

export class PgVectorProblemRetriever implements IProblemRetriever {
  constructor(
    private readonly db: ProblemRetrieverDb,
    private readonly queryEmbedder: QueryEmbedder
  ) {}

  // ── fetchProblem ──────────────────────────────────────────────────────────

  async fetchProblem(problemId: ProblemId): Promise<Problem | null> {
    const row = await this.db.query['scrapedProblems'].findFirst({
      where: (p: { id: unknown }, { eq }: { eq: (a: unknown, b: unknown) => unknown }) => eq(p.id, problemId as string),
    }) as ScrapedProblemRow | null;

    if (!row) return null;
    return this._mapRow(row);
  }

  // ── fetchEditorial ────────────────────────────────────────────────────────

  async fetchEditorial(problemId: ProblemId): Promise<Editorial | null> {
    const row = await this.db.query['scrapedProblems'].findFirst({
      where: (p: { id: unknown }, { eq }: { eq: (a: unknown, b: unknown) => unknown }) => eq(p.id, problemId as string),
    }) as ScrapedProblemRow | null;

    if (!row || !row.editorialExplanation) return null;

    return {
      problemId,
      summary: row.editorialExplanation,
      approachDescription: row.editorialExplanation,
      keyInsight: '',
      pitfalls: [],
      complexity: {
        time: row.optimalComplexity ?? 'O(n)',
        space: 'O(n)',
        explanation: '',
      },
      solutions: row.editorialCode
        ? [
            {
              language: (row.editorialLanguage as Language) ?? 'cpp17',
              code: row.editorialCode,
              algorithmicLevel: 'optimal',
              complexity: { time: row.optimalComplexity ?? 'O(n)', space: 'O(n)', explanation: '' },
              isOptimal: true,
              explanation: row.editorialExplanation,
            },
          ]
        : [],
    };
  }

  // ── fetchSolutions ────────────────────────────────────────────────────────

  async fetchSolutions(
    problemId: ProblemId,
    options: { language?: Language; optimalOnly?: boolean } = {}
  ): Promise<Solution[]> {
    // Query AC user submissions for this problem
    const problemRow = await this.db.query['scrapedProblems'].findFirst({
      where: (p: { id: unknown }, { eq }: { eq: (a: unknown, b: unknown) => unknown }) => eq(p.id, problemId as string),
    }) as ScrapedProblemRow | null;

    if (!problemRow) return [];

    const rows = await this.db.query['userSubmissions'].findMany({
      where: (s: { problemUrl: unknown; verdict: unknown; language: unknown }, { and, eq }: {
        and: (...a: unknown[]) => unknown;
        eq: (a: unknown, b: unknown) => unknown;
      }) => {
        const conditions: unknown[] = [
          eq(s.problemUrl, problemRow.url),
          eq(s.verdict, 'AC'),
        ];
        if (options.language) conditions.push(eq(s.language, options.language));
        return and(...conditions);
      },
      limit: 10,
    }) as Array<{ language: string; code: string; runtimeMs: number | null; memoryKb: number | null }>;

    return rows.map((r): Solution => ({
      language: r.language as Language,
      code: r.code,
      algorithmicLevel: 'unknown',
      complexity: { time: 'O(?)', space: 'O(?)', explanation: 'Not analysed' },
      isOptimal: false,
      explanation: '',
    }));
  }

  // ── findSimilarProblems ───────────────────────────────────────────────────

  async findSimilarProblems(
    problemId: ProblemId,
    options: ProblemSearchOptions = {}
  ): Promise<Problem[]> {
    // Get the embedding for this problem's statement chunk
    const embRows = await this.db.query['problemEmbeddings'].findMany({
      where: (pe: { problemId: unknown; chunkType: unknown }, { and, eq }: {
        and: (...a: unknown[]) => unknown;
        eq: (a: unknown, b: unknown) => unknown;
      }) => and(eq(pe.problemId, problemId as string), eq(pe.chunkType, 'statement')),
      limit: 1,
    }) as Array<{ embedding: number[] }>;

    if (embRows.length === 0) return [];

    return this._vectorProblemSearch(embRows[0].embedding, options);
  }

  // ── searchProblems ────────────────────────────────────────────────────────

  async searchProblems(query: string, options: ProblemSearchOptions = {}): Promise<Problem[]> {
    const embedding = await this.queryEmbedder(query);
    return this._vectorProblemSearch(embedding, options);
  }

  // ── findProblemsByConceptIds ──────────────────────────────────────────────

  async findProblemsByConceptIds(
    conceptIds: ConceptId[],
    options: ProblemSearchOptions = {}
  ): Promise<Problem[]> {
    if (conceptIds.length === 0) return [];

    const rows = await this.db.query['problemTopics'].findMany({
      where: (pt: { topicId: unknown }, { inArray }: { inArray: (a: unknown, b: unknown[]) => unknown }) =>
        inArray(pt.topicId, conceptIds as string[]),
      limit: options.limit ?? 10,
      with: { problem: true },
    }) as Array<{ problem: ScrapedProblemRow }>;

    return rows
      .filter((r) => r.problem)
      .map((r) => this._mapRow(r.problem));
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private async _vectorProblemSearch(
    embedding: number[],
    options: ProblemSearchOptions
  ): Promise<Problem[]> {
    const vectorLiteral = `[${embedding.join(',')}]`;
    const limit = options.limit ?? 10;

    const rows = await this.db.execute(
      `SELECT sp.*
       FROM problem_embeddings pe
       JOIN scraped_problems sp ON sp.id = pe.problem_id
       WHERE pe.chunk_type = 'statement'
       ORDER BY pe.embedding <=> '${vectorLiteral}'
       LIMIT ${limit}`
    ) as ScrapedProblemRow[];

    return rows.map((r) => this._mapRow(r));
  }

  private _mapRow(row: ScrapedProblemRow): Problem {
    const id = row.id as ProblemId;
    return {
      id,
      externalId: row.externalId ?? '',
      source: row.platform as ProblemSource,
      title: row.title,
      slug: row.externalId ?? row.title.toLowerCase().replace(/\s+/g, '-'),
      statement: row.statement,
      constraints: row.constraints ?? [],
      inputFormat: row.inputFormat ?? '',
      outputFormat: row.outputFormat ?? '',
      examples: [],
      hiddenTestCases: [],
      difficultyTier: (row.difficulty as DifficultyTier) ?? 'medium',
      requiredConceptIds: [],
      relatedProblemIds: [],
      editorial: {
        problemId: id,
        summary: row.editorialExplanation ?? '',
        approachDescription: row.editorialExplanation ?? '',
        keyInsight: '',
        pitfalls: [],
        complexity: {
          time: row.optimalComplexity ?? 'O(n)',
          space: 'O(n)',
          explanation: '',
        },
        solutions: [],
      },
      optimizationTrail: { problemId: id, steps: [] },
      tags: row.tags ?? [],
      createdAt: row.scrapedAt,
      updatedAt: row.lastVerifiedAt,
    };
  }
}
