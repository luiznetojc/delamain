# ADR 002: Declarative Workflow DAG & Orca Orchestration Bridge

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

Software tasks require configurable multi-stage workflows (planning, architecture, implementation, parallel code/security reviews, and mandatory verification gates), while Orca (`orca orchestration`) already provides a supervised worker runtime when the Orca host is running.

## Decision

1. Define workflows declaratively in versioned YAML (`.agents/workflows/*.yaml`) validated by `schemas/workflow.schema.json`.
2. Implement topological wave planning, cycle detection, mandatory gate protection, and automatic dependency reconciliation when intermediate stages are disabled per task.
3. Do not build a competing background process scheduler; instead, compile validated `WorkflowExecutionPlan` waves into canonical `orca orchestration` CLI commands (`run-create`, `task-create --deps`, `worker-start`, `gate-create`, `check --wait`) while keeping `dlm` fully functional standalone when Orca is not running.
