import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  HarnessCatalog,
  RuntimeAdapterRegistry,
  WorkflowEngine
} from "../dist/index.js";

describe("Runtime Adapters & Orca Integration Bridge", () => {
  it("inspects Claude Code, Codex, Antigravity (agy), and Orca with capability triads", () => {
    const registry = new RuntimeAdapterRegistry();
    const report = registry.runDoctor();

    const claude = report.runtimes.find((r) => r.runtime === "claude-code");
    const codex = report.runtimes.find((r) => r.runtime === "codex");
    const agy = report.runtimes.find((r) => r.runtime === "agy");

    assert.ok(claude);
    assert.ok(codex);
    assert.ok(agy);

    // Every capability must declare declared, detected, verified, and evidence
    for (const rt of [claude, codex, agy]) {
      for (const triad of Object.values(rt.capabilities)) {
        assert.ok(["full", "partial", "none", "unconfirmed"].includes(triad.declared));
        assert.ok(["full", "partial", "none", "unconfirmed"].includes(triad.detected));
        assert.equal(typeof triad.verified, "boolean");
        assert.ok(triad.evidence.length > 0);
      }
    }

    assert.equal(typeof report.orca.installed, "boolean");
  });

  it("detects security policy violations (bypassPermissions) in .claude/settings.json", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dlm-adapter-sec-"));
    try {
      fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, ".claude/settings.json"),
        JSON.stringify({ permissions: { defaultMode: "bypassPermissions" } }),
        "utf8"
      );

      const registry = new RuntimeAdapterRegistry();
      const claudeAdapter = registry.get("claude-code");
      const doc = claudeAdapter.inspectEnvironment(tmp);
      assert.ok(
        doc.securityAudit.some((i) => i.code === "CLAUDE_BYPASS_PERMISSIONS_DETECTED")
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("compiles a validated WorkflowExecutionPlan into canonical Orca orchestration commands", () => {
    const catalog = new HarnessCatalog();
    const engine = new WorkflowEngine();
    const registry = new RuntimeAdapterRegistry();

    const featureWf = catalog.getWorkflow("feature").definition;
    const plan = engine.validateAndPlan(featureWf);
    assert.equal(plan.valid, true);

    const commands = registry.orca.buildOrchestrationCommands(
      "Implement order discount tier",
      plan
    );

    assert.ok(commands.some((c) => c.step === "status-check" && c.args[0] === "status"));
    assert.ok(commands.some((c) => c.step === "run-create" && c.args[1] === "run-create"));
    assert.ok(commands.some((c) => c.step === "task-create" && c.stageId === "implementation"));
    assert.ok(commands.some((c) => c.step === "worker-start" && c.stageId === "code-review"));
    assert.ok(commands.some((c) => c.step === "worker-start" && c.stageId === "security-review"));
  });
});
