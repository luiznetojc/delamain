---
name: code-review
description: >-
  Perform evidence-based two-stage code review covering specification compliance,
  architectural boundaries, test quality, and regression risks.
---

# Code Review Skill

Use this skill during the `code-review` or `verification` stage.

## Procedure

1. **Stage 1 — Spec Compliance**: Verify that every requirement and acceptance criterion in the task specification is implemented and tested.
2. **Stage 2 — Code & Test Quality**:
   - Inspect `git diff` completely; do not rely solely on agent prose summaries.
   - Verify tests check real invariants rather than tautologies or mocks of the unit under test.
   - Check for out-of-scope edits, dead code, or accidental config changes.
3. **Evidence Report**: Record exact file/line findings, severity (`low`, `medium`, `high`, `blocker`), and validation command outputs.
