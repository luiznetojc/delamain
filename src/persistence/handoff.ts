import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { validateAgainstSchema } from "../core/schemas.js";
import {
  computeFileSha256,
  computeSha256,
  redactObjectSecrets,
  resolveSafeWorkspacePath
} from "../core/security.js";
import type { RuntimeId, ValidationIssue } from "../core/types.js";
import type {
  HandoffArchitecturalDecision,
  HandoffArtifact,
  HandoffGitState,
  HandoffKnownIssue,
  HandoffRelevantFile,
  HandoffRuntimeId,
  HandoffValidationRecord,
  HandoffVerificationReport
} from "./types.js";

export interface CreateHandoffInput {
  sessionId?: string;
  sourceRuntime: HandoffRuntimeId;
  targetRuntime?: RuntimeId | "any";
  objective: string;
  requirements?: string[];
  plan?: string[];
  workflowId?: string;
  completedStages?: string[];
  pendingStages?: string[];
  skippedStages?: string[];
  activeStage?: string;
  architecturalDecisions?: HandoffArchitecturalDecision[];
  knownIssues?: HandoffKnownIssue[];
  relevantFiles?: Array<{ path: string; role: string }>;
  validationResults?: HandoffValidationRecord[];
  nextActions: string[];
}

export class HandoffManager {
  private readonly handoffsDir: string;

  constructor(private readonly workspaceRoot: string) {
    this.handoffsDir = resolveSafeWorkspacePath(workspaceRoot, ".ai-harness-state/handoffs");
  }

  inspectGitState(): HandoffGitState {
    const absRoot = path.resolve(this.workspaceRoot);
    const branchRes = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: absRoot,
      encoding: "utf8"
    });
    const commitRes = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: absRoot,
      encoding: "utf8"
    });
    const statusRes = spawnSync("git", ["status", "--porcelain"], {
      cwd: absRoot,
      encoding: "utf8"
    });
    const diffRes = spawnSync("git", ["diff", "--stat"], {
      cwd: absRoot,
      encoding: "utf8"
    });

    const branch = branchRes.status === 0 ? branchRes.stdout.trim() : "unborn-or-detached";
    const commitSha = commitRes.status === 0 ? commitRes.stdout.trim() : "uncommitted";
    const statusLines =
      statusRes.status === 0 && statusRes.stdout.length > 0
        ? statusRes.stdout
            .replace(/\r?\n$/, "")
            .split(/\r?\n/)
            .filter((line) => line.length > 3)
            .map((line) => line.slice(3).trim())
            .filter(Boolean)
        : [];
    const diffStatHash =
      diffRes.status === 0 ? computeSha256(diffRes.stdout.trim()) : undefined;

    return {
      branch,
      commitSha,
      worktreePath: absRoot,
      isDirty: statusLines.length > 0,
      modifiedFiles: statusLines,
      diffStatHash
    };
  }

  createHandoff(input: CreateHandoffInput): {
    artifact: HandoffArtifact;
    jsonPath: string;
    markdownPath: string;
  } {
    fs.mkdirSync(this.handoffsDir, { recursive: true });
    const handoffId = `handoff-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const gitState = this.inspectGitState();

    const relevantFiles: HandoffRelevantFile[] = [];
    const rawFiles =
      input.relevantFiles ??
      gitState.modifiedFiles
        .filter((p) => {
          if (p.endsWith("/")) return false;
          if (/(^|\/)(bin|obj|node_modules|dist|\.ai-harness\/state)\//.test(p)) return false;
          try {
            const absFile = resolveSafeWorkspacePath(this.workspaceRoot, p);
            return fs.existsSync(absFile) && fs.statSync(absFile).isFile();
          } catch {
            return false;
          }
        })
        .map((p) => ({ path: p, role: "modified-in-worktree" }));

    for (const rf of rawFiles) {
      let sha256: string | undefined;
      try {
        const absFile = resolveSafeWorkspacePath(this.workspaceRoot, rf.path);
        if (fs.existsSync(absFile) && fs.statSync(absFile).isFile()) {
          sha256 = computeFileSha256(absFile);
        }
      } catch {
        // ignore outside/missing file
      }
      relevantFiles.push({
        path: rf.path,
        role: rf.role,
        ...(sha256 ? { sha256 } : {})
      });
    }

    const rawArtifact: HandoffArtifact = {
      schemaVersion: "1.0",
      handoffId,
      createdAt: new Date().toISOString(),
      sessionId: input.sessionId ?? `session-${Date.now()}`,
      sourceRuntime: input.sourceRuntime,
      targetRuntime: input.targetRuntime ?? "any",
      task: {
        objective: input.objective,
        requirements: input.requirements && input.requirements.length > 0 ? input.requirements : [input.objective],
        plan: input.plan && input.plan.length > 0 ? input.plan : ["Complete remaining workflow stages"]
      },
      workflow: {
        workflowId: input.workflowId ?? "feature",
        completedStages: input.completedStages ?? [],
        pendingStages: input.pendingStages ?? [],
        ...(input.skippedStages ? { skippedStages: input.skippedStages } : {}),
        ...(input.activeStage ? { activeStage: input.activeStage } : {})
      },
      gitState,
      architecturalDecisions: input.architecturalDecisions ?? [],
      knownIssues: input.knownIssues ?? [],
      relevantFiles,
      validationResults: input.validationResults ?? [],
      nextActions: input.nextActions.length > 0 ? input.nextActions : ["Verify handoff state and continue pending stages"]
    };

    // Redact any accidental secrets before validation & persistence
    const artifact = redactObjectSecrets(rawArtifact);
    const schemaIssues = validateAgainstSchema("handoff", artifact);
    if (schemaIssues.length > 0) {
      throw new Error(
        `Invalid handoff contract: ${schemaIssues.map((i) => `${i.path}: ${i.message}`).join("; ")}`
      );
    }

    const jsonPath = path.join(this.handoffsDir, `${handoffId}.json`);
    const latestJsonPath = path.join(this.handoffsDir, "latest.json");
    const markdownPath = path.join(this.handoffsDir, `${handoffId}.md`);
    const latestMdPath = path.join(this.handoffsDir, "HANDOFF-LATEST.md");

    const jsonStr = JSON.stringify(artifact, null, 2) + "\n";
    const mdStr = this.renderMarkdownSummary(artifact);

    fs.writeFileSync(jsonPath, jsonStr, "utf8");
    fs.writeFileSync(latestJsonPath, jsonStr, "utf8");
    fs.writeFileSync(markdownPath, mdStr, "utf8");
    fs.writeFileSync(latestMdPath, mdStr, "utf8");

    return { artifact, jsonPath, markdownPath };
  }

  loadHandoff(handoffIdOrLatest = "latest"): HandoffArtifact {
    const fileName =
      handoffIdOrLatest === "latest"
        ? "latest.json"
        : handoffIdOrLatest.endsWith(".json")
          ? handoffIdOrLatest
          : `${handoffIdOrLatest}.json`;
    const filePath = path.join(this.handoffsDir, fileName);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Handoff '${handoffIdOrLatest}' not found in .ai-harness-state/handoffs/`);
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    const issues = validateAgainstSchema("handoff", parsed);
    if (issues.length > 0) {
      throw new Error(
        `Corrupted or invalid handoff file '${fileName}': ${issues.map((i) => i.message).join("; ")}`
      );
    }
    return parsed as HandoffArtifact;
  }

  listHandoffs(): HandoffArtifact[] {
    if (!fs.existsSync(this.handoffsDir)) return [];
    const files = fs
      .readdirSync(this.handoffsDir)
      .filter((f) => f.startsWith("handoff-") && f.endsWith(".json"));
    return files
      .map((f) => JSON.parse(fs.readFileSync(path.join(this.handoffsDir, f), "utf8")) as HandoffArtifact)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Receiving agent verification step:
   * Actively compares persisted handoff state against actual Git branch, commit,
   * relevant file SHA-256 hashes, and validation results so the resuming runtime
   * never blindly trusts an LLM summary.
   */
  verifyHandoff(handoffIdOrLatest = "latest"): HandoffVerificationReport {
    const artifact = this.loadHandoff(handoffIdOrLatest);
    const currentGit = this.inspectGitState();
    const inconsistencies: ValidationIssue[] = [];

    if (
      artifact.gitState.branch !== "unborn-or-detached" &&
      currentGit.branch !== artifact.gitState.branch
    ) {
      inconsistencies.push({
        code: "HANDOFF_BRANCH_MISMATCH",
        severity: "error",
        path: "$.gitState.branch",
        message: `Handoff recorded branch '${artifact.gitState.branch}', but current branch is '${currentGit.branch}'`
      });
    }

    if (
      artifact.gitState.commitSha !== "uncommitted" &&
      currentGit.commitSha !== artifact.gitState.commitSha
    ) {
      inconsistencies.push({
        code: "HANDOFF_COMMIT_DRIFT",
        severity: "warning",
        path: "$.gitState.commitSha",
        message: `Handoff recorded commit '${artifact.gitState.commitSha}', but HEAD is now '${currentGit.commitSha}'`
      });
    }

    for (const rf of artifact.relevantFiles) {
      try {
        const absFile = resolveSafeWorkspacePath(this.workspaceRoot, rf.path);
        if (!fs.existsSync(absFile)) {
          inconsistencies.push({
            code: "HANDOFF_RELEVANT_FILE_MISSING",
            severity: "error",
            path: rf.path,
            message: `Relevant file '${rf.path}' listed in handoff does not exist on disk`
          });
        } else if (rf.sha256) {
          const actualSha = computeFileSha256(absFile);
          if (actualSha !== rf.sha256) {
            inconsistencies.push({
              code: "HANDOFF_FILE_HASH_DRIFT",
              severity: "error",
              path: rf.path,
              message: `Relevant file '${rf.path}' was modified since handoff creation (expected sha256 ${rf.sha256.slice(0, 12)}..., got ${actualSha.slice(0, 12)}...)`
            });
          }
        }
      } catch (err) {
        inconsistencies.push({
          code: "HANDOFF_INVALID_FILE_PATH",
          severity: "error",
          path: rf.path,
          message: (err as Error).message
        });
      }
    }

    for (const val of artifact.validationResults) {
      if (val.status === "failed") {
        inconsistencies.push({
          code: "HANDOFF_HAS_FAILED_VALIDATOR",
          severity: "warning",
          path: `$.validationResults[${val.validatorId}]`,
          message: `Previous runtime reported failed validator '${val.validatorId}': ${val.summary ?? val.command}`
        });
      }
    }

    for (const issue of artifact.knownIssues) {
      if (issue.severity === "blocker") {
        inconsistencies.push({
          code: "HANDOFF_HAS_BLOCKER_ISSUE",
          severity: "warning",
          path: `$.knownIssues[${issue.id}]`,
          message: `Handoff reports unresolved blocker '${issue.id}': ${issue.description}`
        });
      }
    }

    return {
      handoffId: artifact.handoffId,
      consistent: !inconsistencies.some((i) => i.severity === "error"),
      verifiedAt: new Date().toISOString(),
      currentGitState: currentGit,
      inconsistencies,
      artifact
    };
  }

  consumeHandoff(
    consumingRuntime: RuntimeId | "cli",
    handoffIdOrLatest = "latest",
    allowInconsistent = false
  ): HandoffVerificationReport {
    const report = this.verifyHandoff(handoffIdOrLatest);
    if (!report.consistent && !allowInconsistent) {
      const errs = report.inconsistencies
        .filter((i) => i.severity === "error")
        .map((i) => `${i.code}: ${i.message}`)
        .join("; ");
      throw new Error(
        `Refusing to consume inconsistent handoff '${report.handoffId}': ${errs}`
      );
    }

    report.artifact.consumedAt = new Date().toISOString();
    report.artifact.consumedByRuntime = consumingRuntime;

    const jsonPath = path.join(this.handoffsDir, `${report.artifact.handoffId}.json`);
    const latestJsonPath = path.join(this.handoffsDir, "latest.json");
    const serialized = JSON.stringify(report.artifact, null, 2) + "\n";
    if (fs.existsSync(jsonPath)) {
      fs.writeFileSync(jsonPath, serialized, "utf8");
    }
    if (fs.existsSync(latestJsonPath)) {
      const latestObj = JSON.parse(fs.readFileSync(latestJsonPath, "utf8")) as HandoffArtifact;
      if (latestObj.handoffId === report.artifact.handoffId) {
        fs.writeFileSync(latestJsonPath, serialized, "utf8");
      }
    }

    return report;
  }

  renderMarkdownSummary(artifact: HandoffArtifact): string {
    const lines: string[] = [
      `# Delamain Handoff — \`${artifact.handoffId}\``,
      "",
      `- **Created At:** ${artifact.createdAt}`,
      `- **Session ID:** \`${artifact.sessionId}\``,
      `- **Source Runtime:** \`${artifact.sourceRuntime}\` -> **Target Runtime:** \`${artifact.targetRuntime}\``,
      `- **Workflow:** \`${artifact.workflow.workflowId}\``,
      `- **Git State:** branch \`${artifact.gitState.branch}\` @ \`${artifact.gitState.commitSha.slice(0, 12)}\` (dirty: \`${artifact.gitState.isDirty}\`)`,
      "",
      "## 1. Objective & Plan",
      "",
      `**Objective:** ${artifact.task.objective}`,
      "",
      "### Requirements",
      ...artifact.task.requirements.map((r) => `- ${r}`),
      "",
      "### Plan",
      ...artifact.task.plan.map((p, i) => `${i + 1}. ${p}`),
      "",
      "## 2. Workflow Stages",
      "",
      `- **Completed:** ${artifact.workflow.completedStages.join(", ") || "none"}`,
      `- **Pending:** ${artifact.workflow.pendingStages.join(", ") || "none"}`,
      "",
      "## 3. Architectural Decisions",
      ...(artifact.architecturalDecisions.length > 0
        ? artifact.architecturalDecisions.map(
            (d) => `- **[${d.id}] ${d.title}:** ${d.decision} (_Rationale: ${d.rationale}_)`
          )
        : ["- None recorded"]),
      "",
      "## 4. Validation Evidence",
      ...(artifact.validationResults.length > 0
        ? artifact.validationResults.map(
            (v) =>
              `- \`${v.validatorId}\` (\`${v.command}\`): **${v.status.toUpperCase()}** (exit: ${v.exitCode ?? "n/a"}) — ${v.summary ?? ""}`
          )
        : ["- No validator runs recorded"]),
      "",
      "## 5. Known Issues",
      ...(artifact.knownIssues.length > 0
        ? artifact.knownIssues.map(
            (k) => `- **[${k.severity.toUpperCase()}] ${k.id}:** ${k.description}`
          )
        : ["- None"]),
      "",
      "## 6. Relevant Files",
      ...(artifact.relevantFiles.length > 0
        ? artifact.relevantFiles.map(
            (f) => `- \`${f.path}\` (${f.role})${f.sha256 ? ` [sha256: \`${f.sha256.slice(0, 12)}\`]` : ""}`
          )
        : ["- None"]),
      "",
      "## 7. Recommended Next Actions",
      ...artifact.nextActions.map((a, i) => `${i + 1}. ${a}`),
      ""
    ];
    return lines.join("\n");
  }
}
