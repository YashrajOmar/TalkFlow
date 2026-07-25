# Testing Philosophy

codeOn has four test layers. Each has a specific scope and contract.

## Layer 1: Unit Tests

**Location:** `packages/*/tests/*.test.ts`  
**Command:** `pnpm test:unit`  
**Rule:** Pure functions and business logic only. No I/O. No mocks of internal modules.

Target coverage: **90%+** on `packages/core`.

Good unit tests:
- Test one function or behavior per `it` block
- Use descriptive names: `'increases Elo on win with zero hints'`
- Are deterministic — no Date.now(), no Math.random() without seeding
- Cover edge cases explicitly (n=0, empty arrays, maximum values)

## Layer 2: Contract Tests

**Location:** `tests/contract/*.contract.test.ts`  
**Command:** `pnpm test:contract`  
**Rule:** Every adapter that implements a port must pass the same contract suite.

```typescript
// Pattern:
describe.each([AdapterA, AdapterB])('IPortName contract: %s', (Adapter) => {
  it('satisfies the contract', async () => { ... });
});
```

What to contract-test:
- All `IReasoningProvider` implementations (Gemini, OpenAI, Ollama, Mock)
- All `IStorageRepository` implementations (Postgres, InMemory)
- All `IExecutionSandbox` implementations (Judge0, Docker, Mock)
- All `IEventBus` implementations (Redis, InMemory)

## Layer 3: Integration Tests

**Location:** `tests/integration/*.integration.test.ts`  
**Command:** `pnpm test:integration`  
**Rule:** Test multiple components together. May use real databases via testcontainers.

Scope:
- Storage adapter against real Postgres
- Full pipeline: session classify → code analysis → trail → prompt → mock hint → learning update

## Layer 4: Architecture Tests

**Location:** `.eslintrc.json` (enforced via `eslint-plugin-boundaries`)  
**Command:** `pnpm lint`  
**Rule:** Structural rules that prevent architectural decay.

Enforced rules:
- `packages/core` CANNOT import from `packages/adapters`
- `packages/core` CANNOT import from `apps/*`
- `packages/adapters` MAY import from `packages/core`
- `apps/*` MAY import from `packages/adapters` and `packages/core`

## Performance Benchmarks

**Location:** `packages/core/benchmarks/*.bench.ts`  
**Command:** `pnpm bench`  
**Rule:** Core algorithms must not regress beyond defined thresholds.

| Benchmark | Threshold |
|-----------|----------|
| Elo update | < 0.1 ms |
| SM-2 update | < 0.1 ms |
| Knowledge Graph propagation (100 nodes) | < 5 ms |
| Trail Engine level detection | < 1 ms |
| Prompt Builder assembly | < 1 ms |
| Full Learning Engine update | < 10 ms |

## E2E Tests

**Location:** `tests/e2e/*.e2e.test.ts`  
**Command:** `pnpm test:e2e`  
**Rule:** Black-box tests against the running API server.

Scenario: Student submits brute-force code → receives Socratic hint → submits improved code → trail advances → reflection generated.
