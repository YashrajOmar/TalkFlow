# Commit Convention

codeOn uses [Conventional Commits](https://www.conventionalcommits.org/).

## Format

```
<type>(<scope>): <short description>

[optional body]

[optional footer]
```

## Types

| Type | When to use |
|------|-------------|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `test` | Adding or fixing tests |
| `refactor` | Code change with no behavior change |
| `arch` | Architectural change — requires an ADR |
| `perf` | Performance improvement |
| `docs` | Documentation only |
| `chore` | Build, CI, tooling, dependencies |
| `style` | Formatting, whitespace (not CSS) |

## Scopes

| Scope | Area |
|-------|------|
| `core` | `packages/core` domain |
| `learning` | Learning Engine sub-engines |
| `trail` | Native Trail Engine |
| `analysis` | Code Analysis Engine |
| `adapters` | `packages/adapters` |
| `api` | `apps/api` |
| `web` | `apps/web` |
| `db` | `packages/db` |
| `infra` | Docker, CI, K8s |
| `config` | Configuration |

## Examples

```
feat(learning): add SM-2 forgetting curve with Ebbinghaus probability
fix(trail): handle edge case when student is already at optimal level
test(core): add 95% coverage to elo-engine
arch(core): introduce Learning Policy Engine between Learning and Teaching
perf(trail): memoize level-order index lookup
docs(adr): ADR-003 control flow graph before complexity estimation
chore(infra): add docker-compose healthchecks for postgres and redis
```

## Rules

1. Subject line: imperative mood, no period, max 72 characters
2. Scope is required for all types except `chore` and `docs`
3. `arch:` commits MUST reference an ADR in the footer
4. Breaking changes: add `!` after type/scope and `BREAKING CHANGE:` in footer
