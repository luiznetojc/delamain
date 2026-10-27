# ADR 004: Runtime Capability Triad (`declared`, `detected`, `verified`)

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

Different agent runtimes (**Claude Code**, **Codex CLI**, **Google Antigravity (`agy`)**, **Orca**) have distinct native mechanisms for hooks, skills, subagents, session resumption, and model selection. Assuming feature equivalence or treating a static capability flag as proof of operational readiness leads to silent runtime failures (for example, when a binary is installed on `$PATH`, or when `orca` is installed at `/usr/local/bin/orca` but the Orca Desktop daemon is not running).

## Decision

Every runtime adapter in `src/adapters/` reports a 3-state capability matrix (`RuntimeCapabilityTriad`) for each capability (`skills`, `hooks`, `subagents`, `structured_events`, `session_resume`, `model_selection`, `mcp`, `worktree_isolation`):

1. **`declared`:** Whether the runtime architecture and adapter specification support the capability.
2. **`detected`:** Whether the host binary and required project artifacts (`.claude/settings.json`, `AGENTS.md`, `.gemini/skills/`, etc.) are present in the environment/workspace.
3. **`verified`:** Whether the capability was actively verified by probing the CLI/files/daemon (e.g., checking `orca status --json` for `runtime.state === "running"`, verifying executable bits on `dlm-hook.mjs`, and validating JSON schemas).

## Consequences

- `dlm doctor` and `dlm sync` provide transparent, non-deceptive diagnostics.
- Partial support is never masked as full support.
- Degraded environments (such as `orca` binary installed while the Orca Desktop daemon is stopped) are cleanly reported with actionable remediation without breaking local CLI operations.
