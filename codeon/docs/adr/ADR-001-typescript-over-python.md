# ADR-001: TypeScript Monorepo Over Python Backend

**Date:** 2025-07-11  
**Status:** Accepted  
**Deciders:** Engineering team

## Context

The initial implementation plan proposed FastAPI (Python) as the backend. The product requires:
- WebSocket real-time hint streaming
- Shared types between frontend and backend
- Complex domain modeling (Knowledge Graph, Elo, SM-2)
- IDE integration (Monaco Editor)
- Production deployment with CI/CD

## Decision

Use a TypeScript monorepo (pnpm + Turborepo) with:
- `apps/web` — Next.js 15 (App Router)
- `apps/api` — Node.js tRPC server
- `packages/core` — Pure domain logic (zero framework dependencies)

Python may be introduced later as a **separate microservice** for ML-specific workloads (embedding generation, fine-tuning) if needed.

## Consequences

**Positive:**
- End-to-end type safety without code generation
- Single language for the full stack — no context switching
- tRPC provides native WebSocket subscriptions
- Shared `packages/shared` types eliminate frontend/backend sync issues

**Negative:**
- Some ML libraries (PyTorch, sentence-transformers) are Python-only
- Node.js async model requires careful handling for CPU-bound work

**Mitigation:**
- CPU-bound analysis (Tree-sitter AST) runs in worker threads
- ML embedding generation extracted to a Python sidecar if needed
