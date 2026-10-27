import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  HarnessCatalog,
  WorkflowEngine,
  WorkflowRepository,
  WorkflowStageStateMachine,
  type WorkflowDefinition
} from "../dist/index.js";

describe("Workflow Engine — DAG Validation, Parallel Waves, Overrides & State Machine", () => {
  const catalog = new HarnessCatalog();
  const engine = new WorkflowEngine();

  it("validates all 5 built-in workflows and computes parallel DAG waves for feature workflow", () => {
    for (const wf of catalog.listWorkflows()) {
      const plan = engine.validateAndPlan(wf);
      assert.equal(plan.valid, true, `Workflow ${wf.id} should be valid`);
    }

    const feature = catalog.getWorkflow("feature").definition;
    const plan = engine.validateAndPlan(feature);
    assert.equal(plan.waves.length, 5);
    // Wave 3 (index 3) contains code-review and security-review in parallel!
    const parallelWave = plan.waves.find((w) => w.parallel);
    assert.ok(parallelWave, "feature workflow should have a parallel execution wave");
    assert.deepEqual(
      parallelWave.stages.map((s) => s.id).sort(),
      ["code-review", "security-review"]
    );
  });

  it("detects cycles and non-existent dependencies in invalid workflows", () => {
    const cyclic: WorkflowDefinition = {
      schemaVersion: "1.0",
      id: "cyclic",
      name: "Cyclic Workflow",
      version: "1.0.0",
      stages: [
        { id: "a", name: "Stage A", role: "planner", enabled: true, dependsOn: ["b"] },
        { id: "b", name: "Stage B", role: "implementer", enabled: true, dependsOn: ["a"] }
      ]
    };

    const cyclicPlan = engine.validateAndPlan(cyclic);
    assert.equal(cyclicPlan.valid, false);
    assert.ok(cyclicPlan.issues.some((i) => i.code === "WORKFLOW_CYCLE_DETECTED"));

    const missingDep: WorkflowDefinition = {
      schemaVersion: "1.0",
      id: "missing-dep",
      name: "Missing Dep Workflow",
      version: "1.0.0",
      stages: [
        { id: "a", name: "Stage A", role: "planner", enabled: true, dependsOn: ["nonexistent"] }
      ]
    };
    const missingPlan = engine.validateAndPlan(missingDep);
    assert.equal(missingPlan.valid, false);
    assert.ok(missingPlan.issues.some((i) => i.code === "WORKFLOW_MISSING_DEPENDENCY"));
  });

  it("reconciles dependencies when an intermediate stage is disabled for a task without mutating the source definition", () => {
    const feature = catalog.getWorkflow("feature").definition;
    const plan = engine.validateAndPlan(feature, {
      disableStages: ["architecture"]
    });

    assert.equal(plan.valid, true);
    // Original definition remains untouched
    assert.equal(feature.stages.find((s) => s.id === "architecture")?.enabled, true);

    // In the execution plan, `implementation` (which depended on `architecture` -> `planning`)
    // now depends directly on `planning`!
    const implStage = plan.enabledStages.find((s) => s.id === "implementation");
    assert.ok(implStage);
    assert.deepEqual(implStage.effectiveDependsOn, ["planning"]);
    assert.deepEqual(plan.skippedStages.map((s) => s.id), ["architecture"]);
  });

  it("protects mandatory gates from being disabled and prevents unsafe stage transitions", () => {
    const feature = catalog.getWorkflow("feature").definition;
    const blockedPlan = engine.validateAndPlan(feature, {
      disableStages: ["verification"]
    });
    assert.equal(blockedPlan.valid, false);
    assert.ok(blockedPlan.issues.some((i) => i.code === "WORKFLOW_MANDATORY_GATE_PROTECTED"));

    const sm = new WorkflowStageStateMachine(feature.stages);
    sm.transition("planning", "ready");
    sm.transition("planning", "running");

    assert.throws(
      () => sm.assertSafeToRemoveOrDisable("planning"),
      /WORKFLOW_STAGE_IN_PROGRESS/
    );

    sm.transition("planning", "completed");
    // Prevent duplicate execution of an already completed stage
    assert.throws(() => sm.transition("planning", "running"), /Invalid stage state transition|Duplicate execution/);
  });

  it("supports creating, enabling, disabling, adding, and removing stages in WorkflowRepository", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dlm-wf-repo-"));
    try {
      const repo = new WorkflowRepository(tmp);
      const created = repo.createWorkflow("custom-flow", "Custom Flow");
      assert.equal(created.stages.length, 3);

      repo.addStage(
        "custom-flow",
        {
          id: "security-audit",
          name: "Security Audit",
          role: "security-auditor",
          enabled: true,
          dependsOn: ["implementation"]
        },
        "implementation"
      );

      repo.setStageEnabled("custom-flow", "security-audit", false);
      const afterDisable = repo.loadWorkflow("custom-flow");
      assert.equal(afterDisable.stages.find((s) => s.id === "security-audit")?.enabled, false);

      repo.removeStage("custom-flow", "security-audit");
      const afterRemove = repo.loadWorkflow("custom-flow");
      assert.equal(afterRemove.stages.length, 3);

      // Mandatory gate cannot be removed
      assert.throws(
        () => repo.removeStage("custom-flow", "verification"),
        /WORKFLOW_MANDATORY_GATE_PROTECTED/
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
