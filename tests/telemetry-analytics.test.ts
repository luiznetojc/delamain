import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  AnalyticsEvaluator,
  formatComparisonReportText,
  formatSessionReportText,
  TelemetryStore
} from "../dist/index.js";

describe("Observability, SQLite Telemetry & Experiment Analytics", () => {
  it("records deduplicated events, separates skill availability from invocation, and compares experiments with provenance", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dlm-telemetry-"));
    const store = new TelemetryStore(tmp);
    try {
      // Session A: with-tdd experiment
      const sessA = store.startSession({
        sessionId: "sess-tdd-1",
        projectId: "order-service",
        workflowId: "feature",
        runtime: "claude-code",
        model: "claude-sonnet-4-6",
        experimentTag: "with-tdd",
        availableSkills: ["planning", "tdd", "code-review", "security-review"]
      });

      // Test deduplication on identical eventId
      const fixedId = "11111111-2222-3333-4444-555555555555";
      const firstInsert = store.emit({
        eventId: fixedId,
        eventType: "skill.loaded",
        projectId: "order-service",
        sessionId: sessA.sessionId,
        runtime: "claude-code",
        payload: { skillName: "tdd" }
      });
      const duplicateInsert = store.emit({
        eventId: fixedId,
        eventType: "skill.loaded",
        projectId: "order-service",
        sessionId: sessA.sessionId,
        runtime: "claude-code",
        payload: { skillName: "tdd" }
      });
      assert.equal(firstInsert.inserted, true);
      assert.equal(duplicateInsert.inserted, false);

      // Load planning + tdd, but only explicitly invoke tdd
      store.emit({
        eventType: "skill.loaded",
        projectId: "order-service",
        sessionId: sessA.sessionId,
        runtime: "claude-code",
        payload: { skillName: "planning" }
      });
      store.emit({
        eventType: "skill.invoked",
        projectId: "order-service",
        sessionId: sessA.sessionId,
        runtime: "claude-code",
        payload: { skillName: "tdd" }
      });

      // Record stage start/complete with measured tokens & duration
      store.emit({
        eventType: "stage.started",
        projectId: "order-service",
        sessionId: sessA.sessionId,
        stageId: "implementation",
        runtime: "codex",
        model: "gpt-5-codex"
      });
      store.emit({
        eventType: "stage.completed",
        projectId: "order-service",
        sessionId: sessA.sessionId,
        stageId: "implementation",
        runtime: "codex",
        model: "gpt-5-codex",
        metrics: {
          inputTokens: { value: 10000, provenance: "measured" },
          outputTokens: { value: 2500, provenance: "measured" },
          durationMs: { value: 4200, provenance: "measured" }
        }
      });

      store.emit({
        eventType: "validation.completed",
        projectId: "order-service",
        sessionId: sessA.sessionId,
        runtime: "cli",
        payload: { validatorId: "dotnet-test", status: "passed", exitCode: 0 }
      });

      store.completeSession(sessA.sessionId, "completed");

      // Verify strict 4-tier skill observability breakdown
      const skillObs = store.getSkillObservability(sessA.sessionId);
      assert.deepEqual(skillObs.available, ["planning", "tdd", "code-review", "security-review"]);
      assert.deepEqual(skillObs.loaded.sort(), ["planning", "tdd"]);
      assert.deepEqual(skillObs.invoked, ["tdd"]);
      assert.deepEqual(skillObs.verifiedProcedures, ["dotnet-test"]);

      // Session B: without-tdd experiment
      const sessB = store.startSession({
        sessionId: "sess-no-tdd-1",
        projectId: "order-service",
        workflowId: "feature",
        runtime: "claude-code",
        model: "claude-sonnet-4-6",
        experimentTag: "without-tdd",
        availableSkills: ["planning", "code-review"]
      });
      store.emit({
        eventType: "stage.started",
        projectId: "order-service",
        sessionId: sessB.sessionId,
        stageId: "implementation",
        runtime: "claude-code"
      });
      store.emit({
        eventType: "stage.failed",
        projectId: "order-service",
        sessionId: sessB.sessionId,
        stageId: "implementation",
        runtime: "claude-code",
        metrics: {
          inputTokens: { value: 20000, provenance: "measured" },
          outputTokens: { value: 5000, provenance: "measured" },
          durationMs: { value: 8500, provenance: "measured" }
        },
        payload: { humanIntervention: true }
      });
      store.completeSession(sessB.sessionId, "failed");

      const evaluator = new AnalyticsEvaluator(store);
      const reportA = evaluator.evaluateSession(sessA.sessionId);
      assert.equal(reportA.tokens.inputTokens.value, 10000);
      assert.equal(reportA.tokens.inputTokens.provenance, "measured");
      assert.equal(reportA.tokens.totalTokens.value, 12500);
      assert.equal(reportA.tokens.totalTokens.provenance, "derived");
      assert.equal(reportA.estimatedApiCostUsd.provenance, "estimated");
      assert.ok(reportA.estimatedApiCostUsd.value! > 0);
      assert.equal(reportA.tokens.reasoningTokens.provenance, "unavailable");

      const formattedSession = formatSessionReportText(reportA);
      assert.ok(formattedSession.includes("[measured]"));
      assert.ok(formattedSession.includes("[estimated]"));

      const comparison = evaluator.compareCohorts(
        "with-tdd",
        [sessA.sessionId],
        "without-tdd",
        [sessB.sessionId]
      );
      assert.equal(comparison.cohortA.successRatePct.value, 100);
      assert.equal(comparison.cohortB.successRatePct.value, 0);
      assert.ok(comparison.statisticalLimitations.length >= 2);

      const formattedComp = formatComparisonReportText(comparison);
      assert.ok(formattedComp.includes("Statistical Limitations & Caveats"));
    } finally {
      store.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
