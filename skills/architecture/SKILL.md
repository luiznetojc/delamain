---
name: architecture
description: >-
  Enforce modular boundaries, small interfaces, dependency inversion, and clean domain separation
  when designing or refactoring TypeScript and .NET systems.
---

# Architecture Skill

Use this skill when designing module contracts, adding dependencies, or refactoring across layers.

## Procedure

1. **Small Interfaces & Dependency Inversion**: Depend on narrow interfaces in the domain/core layer; keep infrastructure, CLI, and external SDK adapters at the edges.
2. **No Circular Dependencies**: Verify that dependency flow is strictly acyclic (`core` <- `workflow`/`persistence`/`telemetry` <- `adapters`/`analytics` <- `cli`).
3. **Explicit Contracts**: Define versioned schemas for persisted artifacts, configuration files, and inter-agent messages.
4. **Avoid Premature Abstraction**: Implement the smallest clean abstraction that satisfies current requirements while preserving extension seams.
