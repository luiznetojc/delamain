# Delamain (`dlm`) — Portable AI Development Harness

**Delamain** (`dlm` / `delamain`) is an IDE- and provider-independent **AI Development Harness** designed for software engineering teams operating across multiple agent runtimes (**Claude Code**, **OpenAI Codex CLI**, **Google Antigravity (`agy`)**, and **Orca Orchestration**).

It provides a central catalog of reusable skills, declarative DAG workflows, runtime adapters, verifiable cross-runtime handoffs, SQLite telemetry, and experiment evaluation—while keeping project-specific configurations versioned cleanly inside each repository.

---

## Key Capabilities

1. **Reusable Central Harness + Per-Project Versioning**
   - Install, sync, validate, and upgrade the harness across any repository (`dlm init`, `dlm sync`, `dlm validate`, `dlm upgrade`, `dlm doctor`).
   - Built-in profiles for **C# / .NET 10 (`dotnet`)**, **Node.js (`node`)**, and **TypeScript (`typescript`)**.
   - Preserves developer edits in `CLAUDE.md` and `AGENTS.md` via non-destructive managed section markers (`<!-- delamain:managed:start -->` ... `<!-- delamain:managed:end -->`) and automatic pre-sync backups with rollback support.
2. **Multi-Runtime Adapters with Capability Triads (`declared` / `detected` / `verified`)**
   - **Claude Code (`claude-code`)**: `.claude/settings.json` hooks, `.claude/skills/`, `CLAUDE.md`, and security audit against `bypassPermissions`.
   - **OpenAI Codex (`codex`)**: `AGENTS.md` workflow/skill/rule projection, `.agents/skills/`, and `.codex/config.toml` verification.
   - **Google Antigravity (`agy`)**: `.gemini/skills/`, `.gemini/rules/`, and `.gemini/settings.json`.
   - **Orca (`orca`)**: Detects `orca` CLI and live daemon state (`orca status --json`) and compiles validated workflow DAG waves into canonical `orca dispatch` / `orca watch` orchestration plans without creating a competing agent scheduler.
3. **Declarative DAG Workflow Engine**
   - Built-in workflows: `feature`, `bugfix`, `refactor`, `security-review`, and `test-improvement`.
   - Full cycle detection, dependency validation, transitive dependency reconciliation when intermediate stages are disabled, mandatory gate protection (`mandatoryGate: true`), and explicit runtime state transitions.
   - Per-task execution overrides (`--disable-stage`, `--enable-stage`, `--model-override`) that never mutate the versioned workflow YAML.
4. **Verifiable Cross-Runtime Handoff (`Claude Code <-> Codex <-> agy`)**
   - Dual-artifact contract (`.ai-harness/state/handoffs/latest.json` + `HANDOFF-LATEST.md`).
   - Records task objective, plan, completed/pending stages, live Git state (`branch`, `commitSha`, `modifiedFiles`, `diffStatHash`), SHA-256 digests of relevant files, and validator exit codes.
   - `dlm handoff verify` actively checks the live repository against the persisted contract to detect file tampering, missing files, branch/commit drift, or validator regressions.
5. **SQLite Telemetry, Cost Provenance & A/B Experiment Comparison**
   - Local zero-config SQLite store (`.ai-harness/state/telemetry.sqlite` via `node:sqlite` in WAL mode).
   - Tracks 22 canonical event types with `idempotencyKey` deduplication.
   - Explicitly separates **skill catalog availability** (`skill.catalog_synced`) from **confirmed invocation** (`skill.invoked`).
   - Tracks token/cost provenance (`reported_exact`, `reported_estimated`, `heuristic_estimated`, `unknown`) and compares workflow/model runs (`dlm analytics compare`).

---

## Quick Start

### Build & Run Tests

```bash
npm install
npm run typecheck
npm run build
npm test
```

### Initialize in a Repository

```bash
# Initialize with the .NET or TypeScript profile
node dist/cli/bin.js init --profile dotnet --cwd /path/to/repo
# or
node dist/cli/bin.js init --profile typescript --cwd /path/to/repo

# Inspect runtime readiness and security compliance
node dist/cli/bin.js doctor --cwd /path/to/repo

# Validate manifest, lockfile, workflows, and synced runtime artifacts
node dist/cli/bin.js validate --cwd /path/to/repo
```

### Inspect & Plan Workflows

```bash
node dist/cli/bin.js workflow list
node dist/cli/bin.js workflow show feature --disable-stage architecture_review
node dist/cli/bin.js workflow validate feature
```

### Cross-Runtime Handoff (`Claude Code` -> `Codex`)

```bash
# 1. Create a verifiable handoff snapshot with real validator execution
node dist/cli/bin.js handoff create \
  --from claude-code \
  --to codex \
  --workflow feature \
  --objective "Implement tiered discount rules" \
  --completed-stages intake_and_context,planning \
  --pending-stages implementation,unit_and_integration_tests \
  --next-actions "Complete implementation stage and run tests" \
  --run-validators

# 2. Verify repository integrity from the receiving runtime
node dist/cli/bin.js handoff verify --run-validators
```

### Telemetry & Experiment Comparison

```bash
node dist/cli/bin.js session list
node dist/cli/bin.js analytics report --format markdown
node dist/cli/bin.js analytics compare --baseline exp-a --candidate exp-b --format markdown
```

---

## Repository Structure

- [`schemas/`](file:///Users/adm/Works/delamain/schemas) — JSON Schemas (`2020-12`) for manifests, lockfiles, workflows, handoffs, and telemetry events.
- [`profiles/`](file:///Users/adm/Works/delamain/profiles) — Stack profiles (`dotnet.yaml`, `node.yaml`, `typescript.yaml`).
- [`workflows/`](file:///Users/adm/Works/delamain/workflows) — Declarative DAG workflows (`feature`, `bugfix`, `refactor`, `security-review`, `test-improvement`).
- [`skills/`](file:///Users/adm/Works/delamain/skills) — Reusable Agent Skills (`SKILL.md` with YAML frontmatter).
- [`hooks/`](file:///Users/adm/Works/delamain/hooks) & [`scripts/`](file:///Users/adm/Works/delamain/scripts) — Cross-platform Node `.mjs` hook forwarders and `.NET`/TypeScript validation scripts.
- [`src/core/`](file:///Users/adm/Works/delamain/src/core) — Manifest/lockfile manager, schema validator, security boundaries, and transactional installer.
- [`src/adapters/`](file:///Users/adm/Works/delamain/src/adapters) — Runtime adapters (`claude-code`, `codex`, `agy`, `orca`) and future Orca plugin contracts.
- [`src/workflow/`](file:///Users/adm/Works/delamain/src/workflow) — DAG validator, wave planner, task override engine, and state machine.
- [`src/persistence/`](file:///Users/adm/Works/delamain/src/persistence) — Verifiable cross-runtime handoff manager and `.ai-harness-state/progress.json` tracker.
- [`src/telemetry/`](file:///Users/adm/Works/delamain/src/telemetry) & [`src/analytics/`](file:///Users/adm/Works/delamain/src/analytics) — SQLite event store, static quality analyzers (`.NET` & `TS`), and A/B experiment comparator.
- [`examples/`](file:///Users/adm/Works/delamain/examples) — Real executable target projects ([`examples/dotnet-project`](file:///Users/adm/Works/delamain/examples/dotnet-project) and [`examples/ts-project`](file:///Users/adm/Works/delamain/examples/ts-project)).
- [`docs/`](file:///Users/adm/Works/delamain/docs) — Architecture, CLI reference, configuration, runtime compatibility, telemetry, security, prior-art research, roadmap, and ADRs.
