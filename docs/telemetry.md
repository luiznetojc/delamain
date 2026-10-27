# Observability, Telemetry & Analytics (`docs/telemetry.md`)

## 1. Runtime-Independent Event Contract

All telemetry events conform to [`schemas/telemetry-event.schema.json`](../schemas/telemetry-event.schema.json) (`schemaVersion: "1.0"`) and are persisted locally in `.ai-harness-state/telemetry/telemetry.sqlite` (SQLite WAL mode).

### Canonical Event Types (23)

- **Session Lifecycle:** `session.started`, `session.completed`, `session.failed`
- **Workflow Lifecycle:** `workflow.started`, `workflow.completed`, `workflow.failed`
- **Stage Lifecycle:** `stage.started`, `stage.completed`, `stage.failed`, `stage.skipped`
- **Agent Delegation:** `agent.dispatched`, `agent.started`, `agent.completed`, `agent.failed`
- **Skills:** `skill.loaded`, `skill.invoked`
- **Tools:** `tool.called`, `tool.completed`, `tool.failed`
- **Validation Gates:** `validation.started`, `validation.completed`
- **Cross-Runtime Handoffs:** `handoff.created`, `handoff.consumed`

### Correlation & Deduplication

Every event includes:
- `eventId` (UUID, primary key with `INSERT OR IGNORE` deduplication)
- `traceId`, `spanId`, and optional `parentSpanId` (OpenTelemetry-compatible span hierarchy relating sessions -> workflows -> stages -> agents/tools/validations)
- `projectId`, `sessionId`, `workflowId`, `stageId`, `agentId`, `runtime`, `model`, `harnessVersion`

## 2. Strict 4-Tier Skill Observability

Delamain never assumes a skill was used merely because its `SKILL.md` file exists in the repository. `TelemetryStore.getSkillObservability(sessionId)` tracks four distinct sets:

1. **`available`**: Skills listed in `.agents/harness.yaml` at session start.
2. **`loaded`**: Skills whose `skill.loaded` event was observed.
3. **`invoked`**: Skills whose `skill.invoked` event was observed.
4. **`verifiedProcedures`**: Validator IDs whose `validation.completed` event finished with `status: "passed"`.

## 3. Metric Provenance & Cost Separation

Every numeric metric in `SessionAnalyticsReport` and `ProjectQualityReport` carries an explicit provenance tag:
- **`measured`**: Directly observed from runtime output or command execution.
- **`estimated`**: Calculated from measured inputs using reference models (e.g., `estimatedApiCostUsd` computed from token counts and reference API list pricing, explicitly separated from flat-rate subscription billing).
- **`derived`**: Computed deterministically from other measured metrics (e.g., `totalTokens = inputTokens + outputTokens`).
- **`unavailable`**: Not exposed by the runtime or not configured in the repository (`value: null` — never fabricated).

## 4. Experiment & Cohort Comparison

`dlm analytics report --compare <sessA,sessB>` and `dlm analytics report --experiment <tagA,tagB>` compare sessions or experiment cohorts across:
- Duration (`avgDurationMs`)
- Estimated API cost (`avgEstimatedApiCostUsd`)
- Total tokens (`avgTotalTokens`)
- Human interventions (`avgHumanInterventions`)
- Stage/agent failures (`avgStageFailures`)
- Completion success rate (`successRatePct`)

When sample sizes are small ($N < 5$ or $N = 1$), the evaluator automatically attaches explicit statistical limitation warnings so single-run noise is never misrepresented as causal proof.
