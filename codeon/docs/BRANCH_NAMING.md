# Branch Naming Convention

## Format

```
<type>/<milestone>-<short-description>
```

## Examples

```
feat/m2-code-analysis-engine
feat/m3-postgres-storage-adapter
feat/m6a-monaco-editor-integration
fix/elo-engine-hint-penalty-overflow
test/trail-engine-contract-tests
arch/learning-policy-engine
chore/m0-github-actions-ci
refactor/prompt-builder-split-contexts
```

## Rules

- Use lowercase, hyphens only (no underscores, no slashes in description)
- Include milestone number when applicable (`m0`, `m1`, `m2a`, etc.)
- Keep description under 40 characters
- `main` is the production branch — never commit directly
- `develop` is the integration branch for completed milestones
- Feature branches are cut from `develop`

## Lifecycle

```
main          ← production releases only
  └── develop ← milestone integration
        └── feat/m2-code-analysis-engine  ← development
```
