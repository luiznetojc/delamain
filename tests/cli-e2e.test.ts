import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  DelamainCliApp,
  HARNESS_ROOT
} from "../dist/index.js";

describe("CLI End-to-End — All 15 MVP Acceptance Criteria Across Two Real Projects", () => {
  const cli = new DelamainCliApp();

  it("executes full MVP lifecycle on Project 1 (.NET 10 / xUnit) and Project 2 (TypeScript / Node)", () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "dlm-e2e-"));
    const dotnetDir = path.join(tmpBase, "dotnet-project");
    const tsDir = path.join(tmpBase, "ts-project");

    try {
      // Copy both example projects into isolated temp git repositories
      fs.cpSync(path.join(HARNESS_ROOT, "examples/dotnet-project"), dotnetDir, { recursive: true });
      fs.cpSync(path.join(HARNESS_ROOT, "examples/ts-project"), tsDir, { recursive: true });

      for (const repoDir of [dotnetDir, tsDir]) {
        spawnSync("git", ["init", "-b", "main"], { cwd: repoDir });
        spawnSync("git", ["config", "user.email", "test@delamain.dev"], { cwd: repoDir });
        spawnSync("git", ["config", "user.name", "Delamain E2E"], { cwd: repoDir });
        // Pre-populate a developer-authored AGENTS.md to verify non-destructive merge
        fs.writeFileSync(
          path.join(repoDir, "AGENTS.md"),
          "# Existing Developer Instructions\n\nNever delete this section.\n",
          "utf8"
        );
        spawnSync("git", ["add", "."], { cwd: repoDir });
        spawnSync("git", ["commit", "-m", "Initial project state"], { cwd: repoDir });
      }

      // =========================================================================
      // PROJECT 1: .NET 10 + xUnit (`dlm init --profile dotnet`)
      // =========================================================================

      // Criterion 2 & 3: Execute `dlm init --profile dotnet` without destroying existing files
      const initDotnet = cli.run(["init", "--profile", "dotnet", "--cwd", dotnetDir, "--json"]);
      assert.equal(initDotnet.exitCode, 0, initDotnet.stderr);

      const agentsMdContent = fs.readFileSync(path.join(dotnetDir, "AGENTS.md"), "utf8");
      assert.ok(
        agentsMdContent.includes("Never delete this section."),
        "Existing developer content in AGENTS.md must be preserved"
      );
      assert.ok(agentsMdContent.includes("<!-- dlm:managed:start -->"));
      assert.ok(fs.existsSync(path.join(dotnetDir, ".agents/harness.yaml")));
      assert.ok(fs.existsSync(path.join(dotnetDir, ".agents/harness.lock")));

      // Criterion 4: Execute `dlm sync` idempotently
      const sync1 = cli.run(["sync", "--cwd", dotnetDir, "--json"]);
      assert.equal(sync1.exitCode, 0);
      const sync1Data = JSON.parse(sync1.stdout) as { changedFiles: string[]; syncedSkills: string[] };
      assert.equal(
        sync1Data.changedFiles.length,
        0,
        `Second sync must be strictly idempotent, got changedFiles: ${sync1Data.changedFiles.join(", ")}`
      );

      // Criterion 7: Install and load at least two shared skills
      assert.ok(sync1Data.syncedSkills.length >= 2);
      assert.ok(fs.existsSync(path.join(dotnetDir, ".agents/skills/dotnet-backend/SKILL.md")));
      assert.ok(fs.existsSync(path.join(dotnetDir, ".agents/skills/tdd/SKILL.md")));
      assert.ok(fs.existsSync(path.join(dotnetDir, ".claude/skills/dotnet-backend/SKILL.md")));

      // Also test targeted runtime sync (`dlm sync --runtime claude-code` and `--runtime codex`)
      assert.equal(cli.run(["sync", "--runtime", "claude-code", "--cwd", dotnetDir]).exitCode, 0);
      assert.equal(cli.run(["sync", "--runtime", "codex", "--cwd", dotnetDir]).exitCode, 0);

      // Criterion 5 & 13: Validate configuration and execute .NET validators (`dotnet build` & `dotnet test`)
      const valDotnet = cli.run([
        "validate",
        "--run-validators",
        "--session",
        "sess-dotnet-val",
        "--cwd",
        dotnetDir,
        "--json"
      ]);
      assert.equal(valDotnet.exitCode, 0, valDotnet.stdout);
      const valReport = JSON.parse(valDotnet.stdout) as {
        valid: boolean;
        validatorResults: Array<{ validatorId: string; status: string }>;
      };
      assert.equal(valReport.valid, true);
      assert.ok(
        valReport.validatorResults.some(
          (r) => r.validatorId === "dotnet-build" && r.status === "passed"
        )
      );
      assert.ok(
        valReport.validatorResults.some(
          (r) => r.validatorId === "dotnet-test" && r.status === "passed"
        )
      );

      // Criterion 6: Identify capabilities of Claude Code and Codex with `dlm doctor`
      const doctorRes = cli.run(["doctor", "--cwd", dotnetDir, "--json"]);
      assert.equal(doctorRes.exitCode, 0);
      const doctorData = JSON.parse(doctorRes.stdout) as {
        runtimes: Array<{ runtime: string; installed: boolean }>;
      };
      assert.ok(doctorData.runtimes.some((r) => r.runtime === "claude-code"));
      assert.ok(doctorData.runtimes.some((r) => r.runtime === "codex"));

      // Criterion 8 & 9: Configure feature workflow and disable a stage for a specific execution without modifying the template
      const wfShow = cli.run([
        "workflow",
        "show",
        "feature",
        "--disable-stage",
        "architecture",
        "--orca-plan",
        "--cwd",
        dotnetDir,
        "--json"
      ]);
      assert.equal(wfShow.exitCode, 0);
      const wfShowData = JSON.parse(wfShow.stdout) as {
        workflow: { stages: Array<{ id: string; enabled: boolean }> };
        plan: { skippedStages: Array<{ id: string }> };
      };
      assert.deepEqual(
        wfShowData.plan.skippedStages.map((s) => s.id),
        ["architecture"]
      );
      // Verify versioned file on disk still has architecture enabled = true
      const rawFeatureYaml = fs.readFileSync(
        path.join(dotnetDir, ".agents/workflows/feature.yaml"),
        "utf8"
      );
      assert.ok(rawFeatureYaml.includes("id: architecture\n    name: \"Architecture & Contract Design\"\n    description: \"Design module boundaries, interfaces, and file ownership.\"\n    role: architect\n    enabled: true"));

      // Criterion 10: Execute workflow and record stage start/end events in SQLite
      const wfRun = cli.run([
        "workflow",
        "run",
        "feature",
        "--disable-stage",
        "architecture",
        "--session",
        "sess-dotnet-feature-1",
        "--experiment",
        "claude+codex",
        "--run-validators",
        "--cwd",
        dotnetDir,
        "--json"
      ]);
      assert.equal(wfRun.exitCode, 0, wfRun.stderr);

      // Criterion 11 & 12: Persist structured handoff (from Claude Code) and consume it from another runtime (Codex)
      const handoffCreate = cli.run([
        "handoff",
        "create",
        "--session",
        "sess-dotnet-feature-1",
        "--from",
        "claude-code",
        "--to",
        "codex",
        "--objective",
        "Add PLATINUM discount tier to OrderPricingService",
        "--completed",
        "planning,implementation",
        "--pending",
        "code-review,security-review,verification",
        "--run-validators",
        "--cwd",
        dotnetDir,
        "--json"
      ]);
      assert.equal(handoffCreate.exitCode, 0, handoffCreate.stderr);

      const handoffVerify = cli.run(["handoff", "verify", "latest", "--cwd", dotnetDir, "--json"]);
      assert.equal(handoffVerify.exitCode, 0, handoffVerify.stdout);

      const handoffConsume = cli.run([
        "handoff",
        "consume",
        "latest",
        "--runtime",
        "codex",
        "--cwd",
        dotnetDir,
        "--json"
      ]);
      assert.equal(handoffConsume.exitCode, 0);
      const consumedData = JSON.parse(handoffConsume.stdout) as {
        consistent: boolean;
        artifact: { consumedByRuntime: string };
      };
      assert.equal(consumedData.consistent, true);
      assert.equal(consumedData.artifact.consumedByRuntime, "codex");

      // Criterion 14: Produce a CLI analytics report of the session (with .NET quality snapshot)
      const analyticsRes = cli.run([
        "analytics",
        "report",
        "--session",
        "sess-dotnet-feature-1",
        "--collect-quality",
        "--cwd",
        dotnetDir
      ]);
      assert.equal(analyticsRes.exitCode, 0);
      assert.ok(analyticsRes.stdout.includes("sess-dotnet-feature-1"));
      assert.ok(analyticsRes.stdout.includes("Engineering Quality Snapshot (dotnet)"));
      assert.ok(analyticsRes.stdout.includes("PASSED [measured]"));

      // =========================================================================
      // PROJECT 2: TypeScript / Node (`examples/ts-project`) — Criterion 15
      // =========================================================================
      const initTs = cli.run(["init", "--profile", "typescript", "--cwd", tsDir, "--json"]);
      assert.equal(initTs.exitCode, 0);

      const syncTs = cli.run(["sync", "--cwd", tsDir, "--json"]);
      assert.equal(syncTs.exitCode, 0);
      assert.equal((JSON.parse(syncTs.stdout) as { changedFiles: string[] }).changedFiles.length, 0);

      const valTs = cli.run(["validate", "--run-validators", "--cwd", tsDir, "--json"]);
      assert.equal(valTs.exitCode, 0, valTs.stdout);

      const runTs = cli.run([
        "workflow",
        "run",
        "feature",
        "--session",
        "sess-ts-feature-1",
        "--run-validators",
        "--cwd",
        tsDir
      ]);
      assert.equal(runTs.exitCode, 0);

      const reportTs = cli.run([
        "analytics",
        "report",
        "--session",
        "sess-ts-feature-1",
        "--collect-quality",
        "--cwd",
        tsDir
      ]);
      assert.equal(reportTs.exitCode, 0);
      assert.ok(reportTs.stdout.includes("Engineering Quality Snapshot (typescript)"));
    } finally {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });
});
