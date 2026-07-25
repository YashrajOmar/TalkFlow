# ADR-002: pgvector Over Dedicated Vector Database

**Date:** 2025-07-11  
**Status:** Accepted  
**Deciders:** Engineering team

## Context

The system requires two independent vector retrieval systems:
1. RAG #1 — User Memory (mistakes, strategies, explanations)
2. RAG #2 — Problem Knowledge Base (editorials, solutions, related problems)

Options evaluated:
- Qdrant (dedicated vector DB)
- Pinecone (managed cloud)
- pgvector (Postgres extension)
- ChromaDB (local-first)

## Decision

Use **pgvector** as a Postgres extension.

## Consequences

**Positive:**
- One operational database for all data (relational + vector)
- Standard SQL for hybrid queries (filter by userId + semantic similarity)
- Drizzle ORM supports pgvector natively
- No additional infrastructure to manage, monitor, or secure
- Backup and replication handled by existing Postgres tooling

**Negative:**
- Cannot scale vector search independently of relational queries
- HNSW index performance at 10M+ vectors may require dedicated infra

**Migration path:**
- If vector search becomes a bottleneck at scale, the `IUserMemoryRetriever` and `IProblemRetriever` port interfaces allow swapping to Qdrant or Pinecone without changing domain logic.
