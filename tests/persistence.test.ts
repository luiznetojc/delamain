import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  ContinuityStateStore,
  HandoffManager
} from "../dist/index.js";

describe("Persistence & Cross-Runtime Handoff", () => {
  it("creates, verifies, detects file tampering, and consumes cross-runtime handoffs", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dlm-handoff-"));
    try {
      spawnSync("git", ["init", "-b", "main"], { cwd: tmp });
      spawnSync("git", ["config", "user.email", "test@delamain.dev"], { cwd: tmp });
      spawnSync("git", ["config", "user.name", "Delamain Test"], { cwd: tmp });

      const srcFile = path.join(tmp, "service.ts");
      fs.writeFileSync(srcFile, "export const v = 1;\n", "utf8");
      spawnSync("git", ["add", "service.ts"], { cwd: tmp });
      spawnSync("git", ["commit", "-m", "initial commit"], { cwd: tmp });

      const mgr = new HandoffManager(tmp);
      const created = mgr.createHandoff({
        sourceRuntime: "claude-code",
        targetRuntime: "codex",
        objective: "Implement tiered discount calculation",
        requirements: ["Support GOLD and SILVER tiers", "Add unit tests"],
        plan: ["Design interface", "Implement service", "Run tests"],
        workflowId: "feature",
        completedStages: ["planning", "architecture"],
        pendingStages: ["implementation", "code-review", "security-review", "verification"],
        architecturalDecisions: [
          {
            id: "ADR-01",
            title: "Strategy Pattern for Discount",
            decision: "Inject IDiscountPolicy into OrderPricingService",
            rationale: "Allows testing discount rules in isolation"
          }
        ],
        relevantFiles: [{ path: "service.ts", role: "target-module" }],
        validationResults: [
          {
            validatorId: "ts-build",
            status: "passed",
            executedAt: new Date().toISOString(),
            command: "npm run build",
            exitCode: 0,
            summary: "Compiled cleanly"
          }
        ],
        nextActions: ["Implement discount logic in service.ts using Codex"]
      });

      assert.ok(fs.existsSync(created.jsonPath));
      assert.ok(fs.existsSync(created.markdownPath));

      // Verify untouched handoff is consistent
      const verified = mgr.verifyHandoff(created.artifact.handoffId);
      assert.equal(verified.consistent, true);
      assert.equal(verified.inconsistencies.length, 0);

      // Simulate unexpected modification to service.ts before receiving agent consumes handoff
      fs.writeFileSync(srcFile, "export const v = 999; // tampered\n", "utf8");
      const tamperedCheck = mgr.verifyHandoff(created.artifact.handoffId);
      assert.equal(tamperedCheck.consistent, false);
      assert.ok(
        tamperedCheck.inconsistencies.some((i) => i.code === "HANDOFF_FILE_HASH_DRIFT")
      );
      assert.throws(
        () => mgr.consumeHandoff("codex", created.artifact.handoffId, false),
        /Refusing to consume inconsistent handoff/
      );

      // Restore file to original hash and consume handoff as Codex
      fs.writeFileSync(srcFile, "export const v = 1;\n", "utf8");
      const consumed = mgr.consumeHandoff("codex", created.artifact.handoffId);
      assert.equal(consumed.consistent, true);
      assert.equal(consumed.artifact.consumedByRuntime, "codex");
      assert.ok(consumed.artifact.consumedAt);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("persists and reloads continuity progress state (.ai-harness-state/progress.json)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dlm-progress-"));
    try {
      const store = new ContinuityStateStore(tmp);
      store.saveProgress({
        schemaVersion: "1.0",
        updatedAt: new Date().toISOString(),
        lastCompletedMilestone: "Milestone 4 — Persistence & Handoff",
        lastVerificationExecuted: {
          executedAt: new Date().toISOString(),
          command: "npm test",
          passedTests: 15,
          failedTests: 0,
          status: "passed"
        },
        pendingDecisions: [],
        importantFiles: ["src/persistence/handoff.ts"],
        nextTasks: ["Implement Milestone 5"],
        knownBlockersAndLimitations: []
      });

      const loaded = store.loadProgress();
      assert.ok(loaded);
      assert.equal(loaded.lastCompletedMilestone, "Milestone 4 — Persistence & Handoff");
      assert.equal(loaded.lastVerificationExecuted.passedTests, 15);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
