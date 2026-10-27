---
name: planning
description: >-
  Structured engineering discovery, requirement decomposition, file ownership mapping,
  and verifiable acceptance criteria definition before code changes.
---

# Planning Skill

Use this skill during the `planning` or `diagnosis` stage of any workflow before modifying product code.

## Procedure

1. **Inspect Context**: Read `.agents/harness.yaml`, active handoffs (`dlm handoff show`), and affected source files.
2. **Define Objective & Scope**: State the exact problem and expected outcome in 1-3 sentences.
3. **Map File Ownership**: List the exact files to be created or modified and identify any shared boundaries.
4. **Formulate Acceptance Criteria**: Write concrete, machine-verifiable acceptance criteria (commands and expected outputs).
5. **Propose Stage Adjustments**: If a stage is unnecessary for the task, record an explicit runtime override rather than editing the versioned workflow template.
