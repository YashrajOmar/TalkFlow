/**
 * PostgresRepository — Drizzle-backed implementation of IStorageRepository.
 *
 * All database interactions go through this single class. The domain layer
 * depends on the IStorageRepository port; this class lives in the adapter layer
 * and never leaks Drizzle types into the domain.
 *
 * Design notes:
 *   - Constructor accepts a Drizzle `db` instance (injected) so tests can pass
 *     a mock without a real database connection.
 *   - All methods are individually testable via vi.fn() mocks on the db object.
 *   - The `mappers.ts` module handles all row→entity conversions.
 */

import type { IStorageRepository } from '@codeon/core/ports';
import type {
  UserId,
  SessionId,
  ProblemId,
  ConceptId,
} from '@codeon/core/entities';
import type {
  StudentProfile,
  StudentProfileSummary,
} from '@codeon/core/entities';
import type { CodingSession, Hint } from '@codeon/core/entities';
import type { Problem } from '@codeon/core/entities';
import type { KnowledgeGraph, ConceptNode } from '@codeon/core/entities';
import type { LearningEvent } from '@codeon/core/entities';

import {
  mapRowToProfile,
  mapRowToProfileSummary,
  mapRowToSession,
  mapRowToHint,
  mapRowToConceptNode,
  mapRowToLearningEvent,
} from './mappers.js';

// ── Drizzle DB type (minimal interface for injection / testing) ────────────────

/**
 * Minimal interface that describes the Drizzle database client.
 * This allows tests to inject a mock without importing the full Drizzle library.
 */
export interface DrizzleDb {
  select: () => unknown;
  insert: (table: unknown) => { values: (data: unknown) => Promise<unknown[]> };
  update: (table: unknown) => {
    set: (data: unknown) => {
      where: (cond: unknown) => { returning: () => Promise<unknown[]> };
    };
  };
  query: Record<string, {
    findFirst: (opts?: unknown) => Promise<unknown>;
    findMany: (opts?: unknown) => Promise<unknown[]>;
  }>;
}

// ── Repository ────────────────────────────────────────────────────────────────

export class PostgresRepository implements IStorageRepository {
  constructor(private readonly db: DrizzleDb) {}

  // ── Student Profile ────────────────────────────────────────────────────────

  async findProfileById(id: UserId): Promise<StudentProfile | null> {
    const row = await this.db.query['users'].findFirst({
      where: (u: { id: unknown }, { eq }: { eq: (a: unknown, b: unknown) => unknown }) => eq(u.id, id as string),
    });
    if (!row) return null;
    return mapRowToProfile(row as Parameters<typeof mapRowToProfile>[0]);
  }

  async findProfileByEmail(email: string): Promise<StudentProfile | null> {
    const row = await this.db.query['users'].findFirst({
      where: (u: { email: unknown }, { eq }: { eq: (a: unknown, b: unknown) => unknown }) => eq(u.email, email),
    });
    if (!row) return null;
    return mapRowToProfile(row as Parameters<typeof mapRowToProfile>[0]);
  }

  async saveProfile(profile: StudentProfile): Promise<void> {
    await this.db.insert({} /* users */).values({
      id: profile.id as string,
      email: profile.email,
      displayName: profile.displayName,
      primaryLanguage: profile.primaryLanguage,
      inferredElo: profile.globalElo,
    });
  }

  async updateProfile(id: UserId, partial: Partial<StudentProfile>): Promise<StudentProfile> {
    const rows = await this.db.update({} /* users */)
      .set({
        ...(partial.displayName && { displayName: partial.displayName }),
        ...(partial.primaryLanguage && { primaryLanguage: partial.primaryLanguage }),
        ...(partial.globalElo !== undefined && { inferredElo: partial.globalElo }),
        updatedAt: new Date(),
      })
      .where({} /* eq(users.id, id) */)
      .returning() as unknown[];

    if (rows.length === 0) throw new Error(`User ${id} not found`);
    return mapRowToProfile(rows[0] as Parameters<typeof mapRowToProfile>[0], {
      globalElo: partial.globalElo,
    });
  }

  async findProfileSummaryById(id: UserId): Promise<StudentProfileSummary | null> {
    const row = await this.db.query['users'].findFirst({
      where: (u: { id: unknown }, { eq }: { eq: (a: unknown, b: unknown) => unknown }) => eq(u.id, id as string),
    });
    if (!row) return null;
    return mapRowToProfileSummary(row as Parameters<typeof mapRowToProfileSummary>[0]);
  }

  // ── Sessions ───────────────────────────────────────────────────────────────

  async findSessionById(id: SessionId): Promise<CodingSession | null> {
    const row = await this.db.query['codingSessions'].findFirst({
      where: (s: { id: unknown }, { eq }: { eq: (a: unknown, b: unknown) => unknown }) => eq(s.id, id as string),
    });
    if (!row) return null;
    return mapRowToSession(row as Parameters<typeof mapRowToSession>[0]);
  }

  async findSessionsByUserId(userId: UserId, limit = 20): Promise<CodingSession[]> {
    const rows = await this.db.query['codingSessions'].findMany({
      where: (s: { userId: unknown }, { eq }: { eq: (a: unknown, b: unknown) => unknown }) => eq(s.userId, userId as string),
      limit,
      orderBy: (s: { startedAt: unknown }, { desc }: { desc: (a: unknown) => unknown }) => [desc(s.startedAt)],
    });
    return (rows as Parameters<typeof mapRowToSession>[0][]).map(mapRowToSession);
  }

  async saveSession(session: CodingSession): Promise<void> {
    await this.db.insert({} /* codingSessions */).values({
      id: session.id as string,
      userId: session.userId as string,
      problemId: session.problemId as string | null,
      currentCode: session.latestCode,
      currentLanguage: session.language,
      hintsGiven: session.totalHintsRequested,
      status: session.solved ? 'solved' : 'active',
    });
  }

  async updateSession(id: SessionId, partial: Partial<CodingSession>): Promise<CodingSession> {
    const rows = await this.db.update({} /* codingSessions */)
      .set({
        ...(partial.latestCode !== undefined && { currentCode: partial.latestCode }),
        ...(partial.totalHintsRequested !== undefined && { hintsGiven: partial.totalHintsRequested }),
        ...(partial.solved !== undefined && { status: partial.solved ? 'solved' : 'active' }),
        ...(partial.endedAt !== undefined && { endedAt: partial.endedAt }),
      })
      .where({} /* eq(codingSessions.id, id) */)
      .returning() as unknown[];

    if (rows.length === 0) throw new Error(`Session ${id} not found`);
    return mapRowToSession(rows[0] as Parameters<typeof mapRowToSession>[0]);
  }

  // ── Hints ──────────────────────────────────────────────────────────────────

  async saveHint(hint: Hint): Promise<void> {
    await this.db.insert({} /* sessionHints */).values({
      id: hint.id as string,
      sessionId: hint.sessionId as string,
      userId: '' /* resolved by caller context */,
      sequenceNumber: hint.sequenceNumber,
      hintText: hint.content,
      hintType: hint.hintType,
      codeSnapshot: '',
      generatedAt: hint.generatedAt,
    });
  }

  async findHintsBySessionId(sessionId: SessionId): Promise<Hint[]> {
    const rows = await this.db.query['sessionHints'].findMany({
      where: (h: { sessionId: unknown }, { eq }: { eq: (a: unknown, b: unknown) => unknown }) => eq(h.sessionId, sessionId as string),
      orderBy: (h: { sequenceNumber: unknown }, { asc }: { asc: (a: unknown) => unknown }) => [asc(h.sequenceNumber)],
    });
    return (rows as Parameters<typeof mapRowToHint>[0][]).map(mapRowToHint);
  }

  // ── Problems ───────────────────────────────────────────────────────────────

  async findProblemById(id: ProblemId): Promise<Problem | null> {
    const row = await this.db.query['scrapedProblems'].findFirst({
      where: (p: { id: unknown }, { eq }: { eq: (a: unknown, b: unknown) => unknown }) => eq(p.id, id as string),
    });
    if (!row) return null;
    return this._mapScrapedProblemRow(row as Record<string, unknown>, id);
  }

  async findProblemBySlug(slug: string): Promise<Problem | null> {
    // scraped_problems uses url as key; slug maps to externalId or derived title slug
    const rows = await this.db.query['scrapedProblems'].findMany({
      where: (p: { externalId: unknown }, { eq }: { eq: (a: unknown, b: unknown) => unknown }) => eq(p.externalId, slug),
      limit: 1,
    });
    if (rows.length === 0) return null;
    const row = rows[0] as Record<string, unknown>;
    return this._mapScrapedProblemRow(row, row['id'] as ProblemId);
  }

  async saveProblem(problem: Problem): Promise<void> {
    await this.db.insert({} /* scrapedProblems */).values({
      id: problem.id as string,
      url: `https://${problem.source}.com/problems/${problem.slug}`,
      platform: problem.source,
      externalId: problem.externalId,
      title: problem.title,
      statement: problem.statement,
      difficulty: problem.difficultyTier,
      tags: problem.tags,
    });
  }

  async findProblemsByConceptIds(conceptIds: ConceptId[], limit = 10): Promise<Problem[]> {
    // Join through problem_topics → scraped_problems
    const rows = await this.db.query['problemTopics'].findMany({
      where: (pt: { topicId: unknown }, { inArray }: { inArray: (a: unknown, b: unknown[]) => unknown }) =>
        inArray(pt.topicId, conceptIds as string[]),
      limit,
      with: { problem: true },
    });
    return (rows as Array<{ problem: Record<string, unknown> }>)
      .filter((r) => r.problem)
      .map((r) => this._mapScrapedProblemRow(r.problem, r.problem['id'] as ProblemId));
  }

  // ── Knowledge Graph ────────────────────────────────────────────────────────

  async loadKnowledgeGraph(): Promise<KnowledgeGraph> {
    const rows = await this.db.query['conceptTopics'].findMany({
      with: {
        prerequisites: {
          with: { prerequisite: true },
        },
      },
    });
    const nodes = new Map<ConceptId, ConceptNode>();
    for (const row of rows as Parameters<typeof mapRowToConceptNode>[0][]) {
      const node = mapRowToConceptNode(row);
      nodes.set(node.id, node);
    }
    return { nodes, version: '2025.1', updatedAt: new Date() };
  }

  async findConceptById(id: ConceptId): Promise<ConceptNode | null> {
    const row = await this.db.query['conceptTopics'].findFirst({
      where: (c: { id: unknown }, { eq }: { eq: (a: unknown, b: unknown) => unknown }) => eq(c.id, id as string),
      with: { prerequisites: true },
    });
    if (!row) return null;
    return mapRowToConceptNode(row as Parameters<typeof mapRowToConceptNode>[0]);
  }

  async findConceptsByCategory(category: string): Promise<ConceptNode[]> {
    const rows = await this.db.query['conceptTopics'].findMany({
      where: (c: { category: unknown }, { eq }: { eq: (a: unknown, b: unknown) => unknown }) => eq(c.category, category),
    });
    return (rows as Parameters<typeof mapRowToConceptNode>[0][]).map(mapRowToConceptNode);
  }

  async saveConceptNode(node: ConceptNode): Promise<void> {
    await this.db.insert({} /* conceptTopics */).values({
      id: node.id as string,
      slug: node.name.toLowerCase().replace(/\s+/g, '_'),
      displayName: node.name,
      category: node.category,
      description: node.description,
    });
  }

  // ── Learning Timeline ──────────────────────────────────────────────────────

  async saveLearningEvent(event: LearningEvent): Promise<void> {
    await this.db.insert({} /* learningEvents */).values({
      userId: event.userId as string,
      type: event.type,
      payload: event as unknown as Record<string, unknown>,
      occurredAt: event.occurredAt,
    });
  }

  async findLearningEventsByUserId(
    userId: UserId,
    options: { limit?: number; fromDate?: Date; toDate?: Date } = {}
  ): Promise<LearningEvent[]> {
    const rows = await this.db.query['learningEvents'].findMany({
      where: (e: { userId: unknown }, { eq }: { eq: (a: unknown, b: unknown) => unknown }) => eq(e.userId, userId as string),
      limit: options.limit ?? 100,
      orderBy: (e: { occurredAt: unknown }, { desc }: { desc: (a: unknown) => unknown }) => [desc(e.occurredAt)],
    });
    return (rows as Parameters<typeof mapRowToLearningEvent>[0][]).map(mapRowToLearningEvent);
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  private _mapScrapedProblemRow(
    row: Record<string, unknown>,
    id: ProblemId
  ): Problem {
    return {
      id: (row['id'] as string ?? id) as ProblemId,
      externalId: (row['externalId'] as string) ?? '',
      source: (row['platform'] as Problem['source']) ?? 'leetcode',
      title: (row['title'] as string) ?? '',
      slug: (row['externalId'] as string) ?? '',
      statement: (row['statement'] as string) ?? '',
      constraints: (row['constraints'] as string[]) ?? [],
      inputFormat: (row['inputFormat'] as string) ?? '',
      outputFormat: (row['outputFormat'] as string) ?? '',
      examples: [],
      hiddenTestCases: [],
      difficultyTier: (row['difficulty'] as Problem['difficultyTier']) ?? 'medium',
      requiredConceptIds: [],
      relatedProblemIds: [],
      editorial: {
        problemId: (row['id'] as string ?? id) as ProblemId,
        summary: (row['editorialExplanation'] as string) ?? '',
        approachDescription: (row['editorialExplanation'] as string) ?? '',
        keyInsight: '',
        pitfalls: [],
        complexity: { time: row['optimalComplexity'] as string ?? 'O(n)', space: 'O(1)', explanation: '' },
        solutions: [],
      },
      optimizationTrail: {
        problemId: (row['id'] as string ?? id) as ProblemId,
        steps: [],
      },
      tags: (row['tags'] as string[]) ?? [],
      createdAt: (row['scrapedAt'] as Date) ?? new Date(),
      updatedAt: (row['lastVerifiedAt'] as Date) ?? new Date(),
    };
  }
}
