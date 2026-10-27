---
name: tdd
description: >-
  Enforce Red-Green-Refactor Test-Driven Development for new features and bugfixes.
---

# Test-Driven Development (TDD) Skill

Use this skill during implementation, bugfix, and test-improvement stages.

## Procedure

1. **RED — Write a Failing Test First**: Express the desired behavior or bug reproduction in an automated test and confirm it fails for the expected reason.
2. **GREEN — Implement Minimal Passing Code**: Write only the production code required to make the failing test pass without breaking existing suites.
3. **REFACTOR — Clean Up with Green Tests**: Remove duplication and improve naming/structure while keeping all tests green.
4. **Regression Proof**: Never claim a bug is fixed without a test that fails before the fix and passes after.
