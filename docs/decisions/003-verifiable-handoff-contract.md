# ADR 003: Verifiable Cross-Runtime Handoff Contract (`v1.0`)

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

When switching a task in progress from **Claude Code** to **Codex CLI** (or **Antigravity (`agy`)**), LLM-generated summaries alone are unreliable:
1. Summaries may hallucinate that a file was created or modified when it was not.
2. Summaries may omit uncommitted changes, branch divergence, or failing builds.
3. Full LLM conversation transcripts contain sensitive tokens/credentials and are runtime-specific, making them unsuitable for git-friendly or cross-runtime handoff.

## Decision

1. **Dual-Artifact Verifiable Handoff (`schemas/handoff.schema.json` v1.0):**
   - `.ai-harness/state/handoffs/latest.json`: Machine-verifiable JSON contract containing task objective, requirements, plan, completed/pending stages, `gitState` (`branch`, `commitSha`, `worktreePath`, `isDirty`, `modifiedFiles`, `diffStatHash`), `relevantFiles` with SHA-256 digests, `validationResults` with exit codes, and `nextActions`.
   - `.ai-harness/state/handoffs/HANDOFF-LATEST.md`: Portable human- and agent-readable Markdown summary with an explicit **Verification Checklist for Receiving Agent**.
2. **Active Discrepancy Detection (`dlm handoff verify`):**
   - Never trust the handoff summary blindly.
   - Compare persisted `gitState.branch` and `gitState.commitSha` against live `git status` and `git rev-parse HEAD`.
   - Recompute SHA-256 hashes of every file in `relevantFiles` and report `HANDOFF_RELEVANT_FILE_MISSING` or `HANDOFF_FILE_HASH_MISMATCH`.
   - Optionally re-execute real validation commands (`--run-validators`) and detect `HANDOFF_VALIDATION_REGRESSION` if a validator that passed during handoff creation now fails.
3. **Automatic Secret Redaction:**
   - All handoff artifacts pass through `redactObjectSecrets` before disk persistence.

## Consequences

- Any runtime (`claude-code`, `codex`, `agy`) can deterministically verify workspace integrity before resuming a workflow stage.
- Zero vendor lock-in or reliance on opaque cloud session storage.
