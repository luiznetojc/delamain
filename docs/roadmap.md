# Delamain Roadmap (`docs/roadmap.md`)

## Completed Milestones (MVP v0.1.0)

- [x] **Milestone 1 — Foundation**: Prior-art research (`docs/research/prior-art.md`), `JarvisBot` harness inventory, JSON Schemas (`schemas/*.schema.json`), security guards, and core types.
- [x] **Milestone 2 — Harness Distribution**: `dlm` / `delamain` CLI (`init`, `sync`, `doctor`, `validate`, `upgrade`), profiles (`dotnet`, `node`, `typescript`, `minimal`), deterministic lockfile (`harness.lock`), and runtime adapters for `claude-code`, `codex`, and `agy`.
- [x] **Milestone 3 — Workflows**: Declarative YAML workflows (`feature`, `bugfix`, `refactor`, `security-review`, `test-improvement`), cycle detection, dependency reconciliation on stage disablement, mandatory gate preservation, and parallel wave planning.
- [x] **Milestone 4 — Persistence & Handoff**: Versioned cross-runtime handoff contract (`handoff.schema.json`), active Git/file-hash verification (`dlm handoff create|show|verify|consume`), and continuity state store (`.ai-harness-state/progress.json`).
- [x] **Milestone 5 — Observability & Analytics**: Native SQLite WAL event store (`telemetry.sqlite`), 23 canonical event types, 4-tier skill observability, TypeScript & .NET quality collectors, and multi-session/experiment comparison with provenance and statistical caveats.
- [x] **Milestone 6 — Integration & Hardening**: Orca orchestration command compiler (`--orca-plan`), future Orca visual plugin view-model contracts (`src/adapters/orca-plugin-contracts.ts`), executable `.NET 10` (`examples/dotnet-project`) and TypeScript (`examples/ts-project`) examples, and end-to-end test suite.

## Next Milestones (Post-MVP)

- **Milestone 7 — Orca Visual Plugin Implementation**: Implement the 8 visual panels (`Workflow Editor`, `Stage Timeline`, `Agent Execution Tree`, `Skills Inspector`, `Session Analytics`, `Model Usage Analytics`, `Experiment Comparison`, `Harness Manager`) consuming `src/adapters/orca-plugin-contracts.ts`.
- **Milestone 8 — Live Supervised Orca Runner**: Connect `dlm workflow run --orca` directly to a live Orca desktop/headless runtime session when `orca status --json` reports `runtime.reachable: true`.
- **Milestone 9 — OpenTelemetry OTLP Exporter**: Optional OTLP HTTP/JSON exporter bridging `telemetry.sqlite` spans to external collectors (Grafana Tempo, Honeycomb, Langfuse) when team-wide aggregation is needed.
