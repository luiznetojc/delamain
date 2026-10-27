---
name: handoff
description: >-
  Create and verify structured cross-runtime handoff artifacts so another agent
  (Claude Code, Codex, or Antigravity) can safely resume work.
---

# Handoff Skill

Use this skill when pausing a session, switching runtimes (e.g., Claude Code <-> Codex), or completing a workflow stage.

## Creating a Handoff

1. Run required validators so current build/test status is recorded with evidence.
2. Generate the structured handoff artifact using `dlm handoff create` (stored in `.ai-harness-state/handoffs/` and optionally exported as portable JSON/Markdown).

## Consuming a Handoff (Receiving Agent)

1. **Read & Verify State**: Run `dlm handoff verify` / `dlm handoff consume` to inspect the persisted handoff contract.
2. **Never Trust Prose Blindly**: Cross-check the handoff's `gitState` (`branch`, `commitSha`, `modifiedFiles`) against actual `git status` and `git diff`.
3. **Re-validate**: Re-run or verify the recorded validation checks before continuing pending stages.
