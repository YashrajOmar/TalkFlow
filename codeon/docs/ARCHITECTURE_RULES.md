# Architecture Rules

## Dependency Direction

Dependencies ONLY flow inward:

```
apps/* ──────────────────────────────────────────────────────┐
  │                                                          │
  └──► packages/adapters ──► packages/core ◄─── packages/db ┘
                                    ▲
                              packages/shared
                              packages/config
```

**The Core rule (most important):**
> `packages/core` MUST NEVER import from `packages/adapters` or `apps/*`.

This is enforced by `eslint-plugin-boundaries` — violations cause CI to fail.

## Package Responsibilities

| Package | Allowed to import | CANNOT import |
|---------|-------------------|---------------|
| `core` | `shared` | `adapters`, `apps/*`, `db` |
| `adapters` | `core`, `shared`, `config` | `apps/*` |
| `db` | `shared`, `config` | `core`, `adapters`, `apps/*` |
| `shared` | nothing | everything |
| `config` | nothing | everything |
| `apps/api` | `adapters`, `core`, `db`, `shared`, `config` | nothing |
| `apps/web` | `shared` (types only) | `adapters`, `db` |

## Port/Adapter Rule

- Every external system (database, AI, event bus, sandbox) MUST be behind a port interface in `packages/core/src/ports/`
- Port interfaces must be pure TypeScript types — no third-party imports
- Adapter implementations live exclusively in `packages/adapters/`

## Entity Rule

- All domain entities are immutable (`readonly` on every field)
- Entities MUST NOT contain methods that perform I/O
- Entities CAN contain pure validation or factory functions

## Naming Rules

| Element | Convention | Example |
|---------|------------|---------|
| Interfaces | `I` prefix | `IStorageRepository` |
| Branded IDs | PascalCase + Id suffix | `UserId`, `SessionId` |
| Event types | PascalCase | `HintGenerated`, `LearningUpdated` |
| Files | kebab-case | `elo-engine.ts`, `learning-knowledge-graph.ts` |
| Tests | `.test.ts` suffix | `elo-engine.test.ts` |
| Benchmarks | `.bench.ts` suffix | `elo-engine.bench.ts` |
| ADRs | `ADR-NNN-title.md` | `ADR-001-typescript-over-python.md` |
