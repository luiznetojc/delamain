# Prior Art & Ecosystem Analysis (`docs/research/prior-art.md`)

> **Date:** 2026-10-21  
> **Project:** Delamain (`dlm` / `delamain`) AI Development Harness  
> **Scope:** Inventory of the existing `JarvisBot` harness (`/Users/adm/Works/JarvisBot`) + primary-source analysis of Orca, Superharness, Superpowers, Paperclip, Dorothy, claude-mem, Hermes Agent, Claude Code / Claude Agent SDK, OpenAI Codex CLI / App Server, Antigravity (`agy`), Agent Skills (`SKILL.md`), and Model Context Protocol (MCP).

---

## 0. Inventory of Existing Harness in `/Users/adm/Works/JarvisBot`

Before designing or writing any new component, we inspected `/Users/adm/Works/JarvisBot` and the local host environment (`~/.claude`, `~/.codex`, `~/.gemini`).

### 0.1 Installed Runtimes & Tools on Host (Verified)
- **Node.js:** `v26.11.1` (includes native `node:sqlite` `DatabaseSync` and native TypeScript type-stripping)
- **npm:** `11.20.0`
- **.NET SDK:** `10.0.100` (`/usr/local/share/dotnet/dotnet`)
- **Claude Code CLI:** `2.1.304` (`/Users/adm/.local/bin/claude`)
- **OpenAI Codex CLI:** `codex-cli 0.163.0` (`/opt/homebrew/bin/codex`)
- **Orca CLI:** `1.4.235` (`/opt/homebrew/bin/orca`)
- **Antigravity CLI:** `agy 1.4.4` (`/Users/adm/.local/bin/agy`)
- **SQLite CLI:** `/usr/bin/sqlite3`

### 0.2 Inventory of `JarvisBot` Harness Components

| Category | Existing Implementation in `JarvisBot` | Contract / Location | Findings, Duplications & Conflicts |
| :--- | :--- | :--- | :--- |
| **Skills & Contracts** | 26 skills in `.agents/skills/` (`cavecrew`, `caveman*`, `investigate-first`, `lean-build`, `megacave`, `migration`, `safe-refactor`, `supabase`, `supabase-postgres-best-practices`, `surgical-patch`, `ultracave`, `verify-and-stop`) + 1 custom orchestrator skill in `skills/delamain/SKILL.md`. Tracked in `skills-lock.json` (version 1, SHA-256 `computedHash`). | Standard `SKILL.md` with YAML frontmatter (`name`, `description`). | **Duplication found:** 24 skills are duplicated verbatim between `.agents/skills/` and `.claude/skills/`. `skills/delamain/SKILL.md` lives in a third location (`skills/`). Delamain (`dlm sync`) resolves this by using `.agents/skills/` as canonical and syncing/linking to `.claude/skills/` with lockfile hash verification (`harness.lock`). |
| **Hooks & Events** | Git hooks in `.husky/` (`pre-commit` running `npm run precommit`; `post-commit` and `post-checkout` running `graphify` AST rebuilds). User-global hooks in `~/.claude/settings.json` and `~/.codex/hooks.json` (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `SubagentStart`, `SubagentStop`, `Stop`, `SessionEnd`) invoking `rtk`, `caveman-proxy`, `caveman-blocks`, and `cc-status`. | Claude `.claude/settings.json` (`hooks`), Codex `.codex/hooks.json` (`hooks`), Husky `.husky/*`. | **Portability conflict found:** `HANDOFF-2026-10-14.md` explicitly notes that `.claude/settings.json` could not be committed in `JarvisBot` because it contained hardcoded machine paths (`/Users/adm/.local/bin/graphify`, `/Users/adm/.nvm/...`). `dlm` solves this via portable relative/PATH-resolved hook wrappers and separates committed `.claude/settings.json` from machine-local `.claude/settings.local.json`. |
| **Scripts & Validators** | `scripts/harness-change.mjs` (scaffolds `harness/changes/active/<name>`), `scripts/harness-evolve.mjs` (stub), `scripts/lint-ecl.mjs`, `scripts/lint-arch.mjs` (runs restricted imports, `dependency-cruiser`, `size-check.mjs`, `jscpd`, `knip`), `scripts/lint-encoding.mjs`, `scripts/quality/scorecard.mjs` (computes 0–10 grades per engineering dimension). | Node `.mjs` scripts invoked via `npm run verify-harness`, `npm run lint:arch`, and `scorecard.mjs`. | `scripts/harness-change.mjs` (`archive`, `park`, `unpark`) and `scripts/harness-evolve.mjs` are incomplete stubs in `JarvisBot`, whereas `lint-arch.mjs` and `scorecard.mjs` are battle-tested quality gates. `dlm` generalizes quality gates and change/session lifecycles into reusable validators. |
| **Agents & Subagents** | `skills/delamain/SKILL.md` defines a 3-subagent pipeline (**Planner** → **Developer** → **Reviewer/Tester**). `docs/audit/2026-09/09-ORQUESTRACAO-AGENTES.md` defines roles: **Coordenador**, **Agente de tarefa** (`isolation: "worktree"`, exclusive file ownership), **Pesquisa** (`Explore` read-only), and **Revisor** (`/code-review high`). | Prompt contracts + runtime subagent tools (`Agent` in Claude, `collaboration.spawn_agent` in Codex, `define_subagent`/`invoke_subagent` in `agy`). | Worktree and file-ownership rules are currently enforced only by prose in `09-ORQUESTRACAO-AGENTES.md`. `dlm` turns these into declarative workflow stages, file-ownership contracts, and verifiable gates. |
| **Rules & Instructions** | `AGENTS.md` (5.9 KB), `CLAUDE.md` (2.0 KB, points to `AGENTS.md` and `docs/ECL.md`), `AI_CONTEXT.md` (4.4 KB), `docs/ECL.md`. | Root Markdown instruction files. | Good pattern: `CLAUDE.md` is concise and references `AGENTS.md`. However, `AGENTS.md` mixes permanent harness rules with temporary sprint/audit notes (`2026-09-28`, `2026-10-19`). `dlm` separates stable project/harness rules (`.agents/rules/`, `AGENTS.md`, `CLAUDE.md`) from transient session/handoff state. |
| **MCP Servers** | None committed at repo root (`AGENTS.md` line 39 confirms no `.mcp.json` in `JarvisBot`). Global environment uses Context7 and optional Supabase MCP. | `.mcp.json` (Claude), `.codex/config.toml` (Codex), `mcp_config.json` (Antigravity). | `dlm` treats MCP as optional and never fabricates or copies credentials across environments. |
| **Workflows & Delegation** | Evidence-based Continuous Learning (ECL): `Intake & Discovery` → `Spec & Plan` (`spec.md`, `plan.md`) → `Execution` (`tasks.md`) → `Review` (`reviews/review.md`, `V-LOCAL`) → `Archive & Handoff` (`docs/STATUS.md`). | Prose in `docs/ECL.md` and `skills/delamain/SKILL.md`. | Currently sequential and hardcoded in prose. `dlm` replaces this with versioned declarative YAML/JSON DAG workflows (`feature`, `bugfix`, `refactor`, `security-review`, `test-improvement`) supporting parallel stages, stage overrides, and Orca integration. |
| **Memory & Persistence** | Markdown trackers: `docs/STATUS.md`, `harness/changes/active/<name>/{spec.md,plan.md,tasks.md,summary.md,HANDOFF-*.md}`, `harness/evolution/state.json`. | Git-tracked Markdown files. | Prose handoffs (`HANDOFF-2026-10-14.md`, `docs/STATUS.md`) require manual writing and are not machine-validated against actual git branch/commit/diff/test status. `dlm` introduces a versioned, schema-validated `handoff` contract that verifies git state and validation evidence on consumption. |
| **Security Rules** | `.gitleaks.toml`, production tester isolation, never reading production `.env` in tests, draft-first PRs, coordinator-only merge to `main`. | Prose rules + `.gitleaks.toml` + `.claude/settings.local.json`. | **Security conflict found:** `JarvisBot/.claude/settings.local.json` contains `"defaultMode": "bypassPermissions"`. `dlm` strictly forbids auto-enabling `bypassPermissions` or `--dangerously-*` flags and audits for them in `dlm doctor` / `dlm validate`. |

---

## 1. Analysis of External Prior Art

### 1.1 Orca (`https://www.onorca.dev/` / `https://github.com/stablyai/orca`)
- **Existing Features (Verified via `orca 1.4.235` local binary & repo):**
  - Electron + TypeScript Agent Development Environment (ADE) with a rich JSON CLI (`orca --json`).
  - **Structured Orchestration (`orca orchestration`):** Provides `run-create`, `run-use`, `run-current`, `run-list`, `run-show`, `task-create` (with `--deps <json_array>`), `task-list` (`--ready`), `task-update`, `worker-start` (`--task`, `--spec`, `--worktree`, `--agent`, `--model`, `--effort`, `--terminal`), `worker-show`, `worker-read`, `worker-stop`, `worker-abandon`, `worker-release`, `worker-retain`, `worker-list`, `dispatch`, `send`, `check` (`--wait`, `--ack`, `--peek`), `reply`, `inbox`, `ask`, `gate-create`, `gate-resolve`, `gate-list`, and `reset`.
  - **Binary-Served Skill Guides:** `orca skills get orchestration --full` serves version-matched operational guides directly from the installed binary.
  - **Distinction between Handoff vs. Supervised Orchestration:** Uses `orca-cli` (`orca worktree create --agent` / `orca agent launch`) for unsupervised ownership transfer, and `orca orchestration` for supervised DAG runs with layered liveness (`projection.liveness` vs PTY `observation.status`) and mandatory post-settlement terminal accounting (`reuse`, `worker-retain`, `worker-release`).
- **Directly Reusable:**
  - `orca orchestration` task DAG and worker dispatch primitives when Orca runtime is reachable (`orca status --json` -> `result.runtime.reachable === true`).
  - Binary-served skill guide pattern and Task-Spec contract (`Target`, `Change`, `Constraints`, `Ownership`, `Observable acceptance`).
- **Requires Adapters:**
  - Translating `dlm` declarative workflows and stage specs into `orca orchestration` commands (`run-create`, `task-create --deps`, `worker-start`, `gate-create`), while falling back gracefully when the Orca runtime is not running (`runtime.state: "not_running"`).
- **Do NOT Re-implement:**
  - Terminal multiplexers, WebGL PTY rendering, or a duplicate worker process scheduler when Orca is active.
- **Gaps Justifying `dlm`:**
  - Orca requires its desktop/headless runtime to be running for orchestration, and does not manage cross-repo harness distribution (`init`/`sync`/lockfiles), declarative project workflow templates with per-run stage overrides, cross-runtime verifiable handoff artifacts, or SQLite quality/experiment analytics across sessions.
- **License:** **MIT License**.

### 1.2 Superharness (`https://github.com/artificemachine/superharness`)
- **Existing Features (Verified):**
  - Python CLI (`shux`) with SQLite state (`state.db`), task state machine (`todo` → `plan_proposed` → `plan_approved` → `in_progress` → `report_ready` → `done`), pre-flight checks, TDD gates, and Claude Code hooks (`branch-guard`, `scope-guard`, `ledger-append`).
- **Directly Reusable:**
  - Architectural concepts: pre-flight task/TDD validation, branch/scope hook guards, and append-only event ledger.
- **Requires Adapters / Custom Code:**
  - Written in Python with tightly coupled local scripts; `dlm` implements a clean, type-safe TypeScript architecture with JSON Schema validation and multi-runtime adapters.
- **License:** **Apache-2.0**.

### 1.3 Superpowers (`https://github.com/obra/superpowers`)
- **Existing Features (Verified):**
  - Declarative Markdown `SKILL.md` library (`test-driven-development`, `systematic-debugging`, `verification-before-completion`, `subagent-driven-development`, `writing-plans`, `using-git-worktrees`, etc.) and multi-host plugin manifests.
- **Directly Reusable:**
  - Composable `SKILL.md` design patterns and two-stage review separation (Spec Compliance vs. Code Quality).
- **Gaps Justifying `dlm`:**
  - Relies purely on soft LLM prompt adherence. `dlm` adds deterministic validation, schema-enforced workflows, verifiable handoffs, and SQLite telemetry/analytics.
- **License:** **MIT License**.

### 1.4 Paperclip (`https://github.com/paperclipai/paperclip`)
- **Existing Features (Verified):**
  - TypeScript/React/PostgreSQL control plane modeling "autonomous companies" (Org charts, Goal Ancestry, per-agent token/cost budgets, adapter registry in `packages/adapters/`).
- **Directly Reusable:**
  - Runtime adapter capability declaration pattern and cost/token provenance tracking concepts.
- **Do NOT Re-implement:**
  - Heavy PostgreSQL + React web server or "virtual company / CEO / HR" simulation.
- **License:** **MIT License**.

### 1.5 Dorothy (`https://github.com/Charlie85270/Dorothy`)
- **Existing Features (Verified):**
  - Electron + Next.js desktop app exposing internal MCP servers (`mcp-orchestrator`, `mcp-kanban`, `mcp-vault`) and GitHub/Jira polling automations.
- **Directly Reusable:**
  - Exposing harness inspection/contracts via clean CLI JSON and MCP-compatible schemas.
- **Do NOT Re-implement:**
  - Desktop GUI, 2D/3D virtual office (`mcp-world`), or auto-enabling `--dangerously-skip-permissions`.
- **License:** **MIT License**.

### 1.6 claude-mem (`https://github.com/thedotmack/claude-mem`)
- **Existing Features (Verified):**
  - Hook-driven observation capture (`SessionStart`, `PostToolUse`, `Stop`) → background worker LLM compression → SQLite FTS5 + Chroma vector DB → progressive-disclosure search tools.
- **Directly Reusable:**
  - Hook-driven event capture into local SQLite and `<private>` / secret redaction before persistence.
- **Do NOT Re-implement:**
  - Heavy background LLM compression daemon or Chroma vector database in the MVP ("Explicitamente, NÃO implemente: Um sistema complexo de memória vetorial sem evidência de necessidade").
- **License:** **Apache-2.0**.

### 1.7 Hermes Agent (`https://github.com/nousresearch/hermes-agent`)
- **Existing Features (Verified):**
  - Standalone Python agent with SQLite WAL state modules (`hermes_state_*.py`), approval floors (`approval_floors.py`), and skill extraction from trajectories.
- **Directly Reusable:**
  - SQLite WAL concurrency practices and immutable safety floors (never downgrading sandbox/approval settings).
- **Do NOT Re-implement:**
  - Standalone agent loop or messaging bridges (WhatsApp/Telegram/Discord).
- **License:** **MIT License**.

### 1.8 Official Runtime Mechanisms (Claude Code, Codex, Antigravity `agy`)

| Capability | Claude Code (`2.1.304`) | OpenAI Codex (`0.163.0`) | Antigravity (`agy 1.4.4`) |
| :--- | :--- | :--- | :--- |
| **Instruction Files** | `CLAUDE.md`, `.claude/CLAUDE.md`, `.claude/rules/*.md`, `@path` includes | `AGENTS.md`, `AGENTS.override.md` (hierarchical root-to-leaf) | `GEMINI.md`, `AGENTS.md`, `.agents/rules/*.md` |
| **Skills Path** | `.claude/skills/<name>/SKILL.md` (and `.agents/skills/`) | `.agents/skills/<name>/SKILL.md`, `.codex/skills/` | `.agents/skills/<name>/SKILL.md` |
| **Hooks Config** | `.claude/settings.json` (`"hooks": { ... }`) | `.codex/hooks.json` (`"hooks": { ... }`) | `.agents/hooks.json` (`{ "<hookName>": { ... } }`) |
| **Hook Events** | `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `Notification`, `PreCompact`, `SubagentStart`, `SubagentStop`, `Stop`, `StopFailure` | `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `SubagentStart`, `SubagentStop`, `Stop`, `SessionEnd` | `SessionStart`, `PreToolUse`, `PostToolUse`, `PreInvocation`, `PostInvocation`, `Stop` |
| **Subagents** | `.claude/agents/<name>.md`, `--agents`, `Agent` tool (`isolation: "worktree"`) | `multi_agent` feature (`collaboration.spawn_agent`, `send_message`) | `define_subagent`, `invoke_subagent`, `send_message` |
| **Structured Output / Events** | `--print --output-format json\|stream-json --json-schema <schema> --include-hook-events` | `codex exec --json --output-schema <file> -o <file>` | `agy --print --output-format json\|stream-json --json-schema <schema>` |
| **Session Resume** | `--resume <id>`, `--continue`, `--fork-session` | `codex resume`, `codex exec resume`, `codex fork` | `--continue`, `--conversation <id>` |
| **Model & Effort Selection** | `--model <model> --effort <low\|medium\|high\|xhigh\|max>` | `-m <model> -c model_reasoning_effort="..."` | `--model <model> --effort <low\|medium\|high\|xhigh\|max>` |
| **Native Sandbox** | `--permission-mode`, `--restricted`, `--allowedTools`, `--disallowedTools` | `-s <read-only\|workspace-write\|danger-full-access> -a <on-request\|never>` | `--sandbox`, `--mode <accept-edits\|auto\|plan>` |

---

## 2. Synthesis: What Delamain (`dlm`) Builds vs. Reuses

1. **Directly Reused:**
   - Standard `.agents/skills/<name>/SKILL.md` format (Agent Skills specification).
   - Native runtime instruction files (`AGENTS.md`, `CLAUDE.md`) and native hook runners (`.claude/settings.json`, `.codex/hooks.json`, `.agents/hooks.json`).
   - Native agent loops (`claude`, `codex`, `agy`) and native OS sandboxes.
   - `orca orchestration` CLI contracts when Orca is running.
2. **Adapted via Runtime Adapters (`src/adapters/`):**
   - Capability detection separating **declared**, **detected** (binary/version/features), and **verified** (contract test) capabilities.
   - Config generation & synchronization (`dlm sync`) that maps `.agents/harness.yaml` into `.claude/`, `.codex/`, `.agents/`, `AGENTS.md`, and `CLAUDE.md` idempotently without clobbering developer edits.
   - Hook event translation (`dlm hook <event>`) normalizing Claude, Codex, and Antigravity hook payloads into canonical Delamain telemetry events.
3. **Explicitly NOT Implemented:**
   - Custom IDE, custom LLM gateway, custom agent loop, vector database / background daemon, or duplicate process scheduler when Orca is available.
4. **Custom Code in Delamain (`dlm`):**
   - **Harness Core & Distribution (`src/core/`, `src/cli/`):** Manifest (`harness.yaml`), deterministic lockfile (`harness.lock` with SHA-256 checksums and managed-file ownership tracking), profiles (`dotnet`, `node`), safe backups & rollback on update, `dlm init`, `dlm sync`, `dlm validate`, `dlm doctor`, `dlm upgrade`.
   - **Declarative Workflow Engine (`src/workflow/`):** Versioned DAG workflow schema (`feature`, `bugfix`, `refactor`, `security-review`, `test-improvement`), cycle detection, dependency reconciliation when stages are disabled, mandatory gate preservation, task-specific non-destructive overrides, and Orca Orchestration bridge.
   - **Verifiable Cross-Runtime Handoff (`src/persistence/`):** Versioned handoff artifact contract capturing objective, requirements, plan, completed/pending stages, architectural decisions, known issues, relevant files, git branch/commit/worktree, and validation evidence—plus an active verifier that checks actual git working tree/commit state and flags inconsistencies rather than blindly trusting LLM prose.
   - **SQLite Telemetry & Quality/Experiment Analytics (`src/telemetry/`, `src/analytics/`):** Runtime-neutral event schema (`session.*`, `workflow.*`, `stage.*`, `agent.*`, `skill.*`, `tool.*`, `validation.*`, `handoff.*`) with `traceId`/`spanId`/`parentSpanId`, deduplication, explicit metric provenance (`measured`, `estimated`, `derived`, `unavailable`), TypeScript & .NET quality collectors, and multi-session/experiment comparison with statistical sample-size warnings.
