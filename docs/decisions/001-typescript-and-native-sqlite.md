# ADR 001: TypeScript Core & Native `node:sqlite` Persistence

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

The harness must run reliably across macOS, Linux, and Windows with minimal external dependencies, while supporting both TypeScript/Node.js and C#/.NET consumer repositories.

## Decision

1. Implement Delamain Core and CLI (`dlm` / `delamain`) in strict modern TypeScript targeting Node.js `>=22.5.0`.
2. Use Node's built-in `node:sqlite` (`DatabaseSync` with WAL mode) for local telemetry and session persistence instead of native C++ addon packages (`better-sqlite3` / `sqlite3`) or an external database server.
3. Provide first-class profiles, validators, and quality collectors for both TypeScript/Node (`typescript`, `node`) and C#/.NET (`dotnet`).

## Consequences

- Zero native compilation failures across OS/Node upgrades and only one pinned runtime npm dependency (`yaml@2.9.1`).
- Native support for both TypeScript and .NET engineering workflows.
