# codeOn — Personalized AI Coding Coach

A production-grade AI mentor platform that transforms students from their current coding style into engineers who naturally write clean, interview-quality, optimized software.

## Architecture

Clean Architecture (Hexagonal/Ports and Adapters) TypeScript monorepo.

```
apps/
  web/          Next.js 15 frontend with Monaco editor
  api/          tRPC server with WebSocket streaming

packages/
  core/         Pure domain — zero I/O, zero frameworks
    entities/              Branded domain types
    learning-engine/       Elo, SM-2, Knowledge Graph, Style Evolution, Recommendations
    trail-engine/          Native Optimization Trail (Brute Force → Optimal)
    prompt-builder/        Split context assembly for Teaching Engine
    session-classifier/    Deterministic Problem/Scratchpad/Interview/Contest detection
    ports/                 All interface definitions
  code-analysis/    Tree-sitter AST-based code analysis (6 layers)
  adapters/         Port implementations (AI, Storage, Retrieval, Sandbox, Events)
  db/               Drizzle ORM schema + migrations (Postgres + pgvector)
  shared/           Zod schemas, shared types
  config/           Type-safe environment configuration
```

## Quick Start

```bash
# Install dependencies
pnpm install

# Run all unit tests
pnpm test:unit

# Type check all packages
pnpm type-check

# Lint all packages
pnpm lint
```

## Milestones

| # | Status | Milestone |
|---|--------|-----------|
| 1 | ✅ | Monorepo + Domain Scaffold |
| 2 | 🔜 | Learning Engine (full unit tests) |
| 3 | 🔜 | Trail Engine + Code Analysis (Tree-sitter) |
| 4 | 🔜 | Storage + Retrieval + Events |
| 5 | 🔜 | Teaching Engine + Prompt Builder |
| 6 | 🔜 | API Layer (tRPC + WebSocket) |
| 7 | 🔜 | Frontend IDE (Monaco + Profile Dashboard) |
| 8 | 🔜 | Observability + CI/CD |

## Design Principles

- **Never write the student's code** — Socratic hints only
- **Trail before AI** — optimization path from verified editorial, not LLM inference
- **Analysis before AI** — Tree-sitter static analysis runs before every LLM call
- **Cold-start safe** — Standard Strict Interviewer persona until profile is built
- **Provider-agnostic** — Gemini / GPT-4o / Claude / Ollama via `IReasoningProvider`
