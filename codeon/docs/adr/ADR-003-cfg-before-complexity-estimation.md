# ADR-003: Control Flow Graph as Intermediate Representation in Code Analysis

**Date:** 2025-07-11  
**Status:** Accepted  
**Deciders:** Engineering team

## Context

The Code Analysis Engine needs to estimate time complexity and detect dead code, infinite loops, and unreachable branches. The naive approach is regex or shallow AST traversal.

## Decision

Build a **Control Flow Graph (CFG)** from the Tree-sitter AST before performing any complexity or semantic analysis.

```
Tree-sitter AST
  ↓
CFG Builder
  ↓
CFG (nodes = basic blocks, edges = control flow)
  ↓
  ├── Complexity Analysis (loop nesting depth from CFG)
  ├── Dead Code Detection (unreachable nodes)
  ├── Semantic Analysis (variable liveness)
  └── Infinite Loop Detection (cycles with no exit condition)
```

## Consequences

**Positive:**
- Loop nesting depth is accurately computed even for complex control flow (break, continue, early return)
- Dead code paths are structurally identifiable
- CFG is a well-understood representation — future analyses (data flow, use-def chains) can be layered on top
- Same CFG can be reused across multiple analysis passes

**Negative:**
- Higher implementation cost in Milestone 2
- CFG construction adds ~2ms overhead per analysis

**Mitigation:**
- CFG is computed once per submission and passed to all analysis layers
- Benchmark target: CFG construction < 5ms for 300-line files
