import path from "node:path";
import { AnalyticsEvaluator } from "../analytics/evaluator.js";
import { DotnetQualityCollector } from "../analytics/quality-dotnet.js";
import { TypeScriptQualityCollector } from "../analytics/quality-ts.js";
import {
  formatComparisonReportText,
  formatSessionReportText
} from "../analytics/reporter.js";
import { HarnessInstaller } from "../core/installer.js";
import { readManifest } from "../core/manifest.js";
import type {
  ProfileId,
  RuntimeId,
  TelemetryRuntimeId
} from "../core/types.js";
import { HandoffManager } from "../persistence/handoff.js";
import { TelemetryStore } from "../telemetry/store.js";
import { WorkflowEngine, WorkflowStageStateMachine } from "../workflow/engine.js";
import { WorkflowRepository } from "../workflow/mutator.js";
import type { AgentRole, TaskWorkflowOverrides } from "../workflow/types.js";
import { parseCliArgs, splitCsvFlag } from "./args.js";

export interface CliExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  data?: unknown;
}

export class DelamainCliApp {
  private readonly installer = new HarnessInstaller();
  private readonly workflowEngine = new WorkflowEngine();

  run(argv: string[], defaultCwd: string = process.cwd()): CliExecutionResult {
    const { positionals, flags } = parseCliArgs(argv);
    const cwd = typeof flags.cwd === "string" ? path.resolve(defaultCwd, flags.cwd) : path.resolve(defaultCwd);
    const jsonMode = Boolean(flags.json);

    try {
      if (flags.version) {
        const version = this.installer.catalog.getHarnessVersion();
        return this.ok(jsonMode, { version }, `dlm (Delamain AI Harness) v${version}`);
      }

      const cmd = positionals[0];
      if (!cmd || flags.help) {
        return this.ok(false, undefined, this.getHelpText());
      }

      switch (cmd) {
        case "init":
          return this.handleInit(cwd, flags, jsonMode);
        case "sync":
          return this.handleSync(cwd, flags, jsonMode);
        case "doctor":
          return this.handleDoctor(cwd, jsonMode);
        case "validate":
          return this.handleValidate(cwd, flags, jsonMode);
        case "upgrade":
          return this.handleUpgrade(cwd, flags, jsonMode);
        case "workflow":
          return this.handleWorkflow(cwd, positionals.slice(1), flags, jsonMode);
        case "handoff":
          return this.handleHandoff(cwd, positionals.slice(1), flags, jsonMode);
        case "session":
          return this.handleSession(cwd, positionals.slice(1), flags, jsonMode);
        case "analytics":
          return this.handleAnalytics(cwd, positionals.slice(1), flags, jsonMode);
        default:
          return this.fail(
            jsonMode,
            `Unknown command '${cmd}'. Run 'dlm --help' for usage.`
          );
      }
    } catch (err) {
      return this.fail(jsonMode, (err as Error).message);
    }
  }

  private handleInit(
    cwd: string,
    flags: Record<string, string | boolean>,
    jsonMode: boolean
  ): CliExecutionResult {
    const profile = typeof flags.profile === "string" ? (flags.profile as ProfileId) : undefined;
    const projectName = typeof flags.name === "string" ? flags.name : undefined;
    const force = Boolean(flags.force);
    const runtimesFlag = splitCsvFlag(flags.runtimes) as RuntimeId[];

    const res = this.installer.init({
      workspaceRoot: cwd,
      profile,
      projectName,
      runtimes: runtimesFlag.length > 0 ? runtimesFlag : undefined,
      force
    });

    const text = [
      `Initialized Delamain harness in ${cwd}`,
      `  Profile:   ${res.manifest.profile}`,
      `  Manifest:  .agents/harness.yaml (${res.createdManifest ? "created" : "preserved existing"})`,
      `  Lockfile:  .agents/harness.lock (${Object.keys(res.lockfile.skills).length} skills, ${Object.keys(res.lockfile.workflows).length} workflows)`,
      `  Runtimes:  ${res.manifest.runtimes.join(", ")}`
    ].join("\n");

    return this.ok(jsonMode, res, text);
  }

  private handleSync(
    cwd: string,
    flags: Record<string, string | boolean>,
    jsonMode: boolean
  ): CliExecutionResult {
    const runtime =
      typeof flags.runtime === "string" ? (flags.runtime as RuntimeId) : undefined;
    const res = this.installer.sync({
      workspaceRoot: cwd,
      runtime
    });

    const text = [
      `Synced Delamain harness in ${cwd}`,
      `  Runtimes synced:  ${res.syncedRuntimes.join(", ")}`,
      `  Skills synced:    ${res.syncedSkills.join(", ")}`,
      `  Workflows synced: ${res.syncedWorkflows.join(", ")}`,
      `  Changed files:    ${res.changedFiles.length === 0 ? "0 (idempotent — already up to date)" : res.changedFiles.join(", ")}`
    ].join("\n");

    return this.ok(jsonMode, res, text);
  }

  private handleDoctor(cwd: string, jsonMode: boolean): CliExecutionResult {
    const report = this.installer.adapters.runDoctor(cwd);
    const lines: string[] = [
      `=== Delamain Runtime Doctor (${report.checkedAt}) ===`
    ];

    for (const rt of report.runtimes) {
      lines.push(
        "",
        `Runtime: ${rt.runtime} (${rt.installed ? `INSTALLED: ${rt.version} @ ${rt.binaryPath}` : "NOT INSTALLED"})`
      );
      for (const [capKey, triad] of Object.entries(rt.capabilities)) {
        lines.push(
          `  - ${capKey.padEnd(20)} declared=${triad.declared.padEnd(7)} detected=${triad.detected.padEnd(7)} verified=${String(triad.verified).padEnd(5)} (${triad.evidence})`
        );
      }
      for (const sec of rt.securityAudit) {
        lines.push(`  [!] Security (${sec.severity}): ${sec.code} - ${sec.message}`);
      }
    }

    lines.push(
      "",
      `Orca Integration: ${report.orca.installed ? `INSTALLED (${report.orca.version} @ ${report.orca.binaryPath})` : "NOT INSTALLED"}`,
      `  - Runtime Reachable:     ${report.orca.runtimeReachable} (state=${report.orca.runtimeState})`,
      `  - Orchestration Skill:   ${report.orca.orchestrationSkillAvailable}`
    );

    return this.ok(jsonMode, report, lines.join("\n"));
  }

  private handleValidate(
    cwd: string,
    flags: Record<string, string | boolean>,
    jsonMode: boolean
  ): CliExecutionResult {
    const runValidators = Boolean(flags["run-validators"]);
    const report = this.installer.validate(cwd, runValidators);

    // If a session is provided alongside --run-validators, record validation events in SQLite
    if (runValidators && report.validatorResults) {
      let projectId = "project";
      try {
        projectId = readManifest(cwd).project.id;
      } catch {
        // ignore
      }
      const sessionId =
        typeof flags.session === "string" ? flags.session : `val-session-${Date.now()}`;
      const store = new TelemetryStore(cwd);
      try {
        for (const vRes of report.validatorResults) {
          store.emit({
            eventType: "validation.started",
            projectId,
            sessionId,
            runtime: "cli",
            payload: { validatorId: vRes.validatorId, command: vRes.command }
          });
          store.emit({
            eventType: "validation.completed",
            projectId,
            sessionId,
            runtime: "cli",
            metrics: {
              durationMs: { value: vRes.durationMs, provenance: "measured" }
            },
            payload: {
              validatorId: vRes.validatorId,
              status: vRes.status,
              exitCode: vRes.exitCode,
              summary: vRes.summary
            }
          });
        }
      } finally {
        store.close();
      }
    }

    const lines: string[] = [
      `Delamain Validation: ${report.valid ? "VALID" : "INVALID"} (${report.issues.length} issue(s))`
    ];
    for (const issue of report.issues) {
      lines.push(
        `  [${issue.severity.toUpperCase()}] ${issue.code}${issue.path ? ` (${issue.path})` : ""}: ${issue.message}`
      );
    }
    if (report.validatorResults) {
      lines.push("", "Validator Execution Results:");
      for (const vr of report.validatorResults) {
        lines.push(
          `  - ${vr.validatorId} (${vr.command}): ${vr.status.toUpperCase()} (${vr.durationMs}ms) — ${vr.summary}`
        );
      }
    }

    return {
      exitCode: report.valid ? 0 : 1,
      stdout: jsonMode ? JSON.stringify(report, null, 2) : lines.join("\n"),
      stderr: "",
      data: report
    };
  }

  private handleUpgrade(
    cwd: string,
    flags: Record<string, string | boolean>,
    jsonMode: boolean
  ): CliExecutionResult {
    const dryRun = Boolean(flags["dry-run"]);
    const rollback =
      flags.rollback === true
        ? ""
        : typeof flags.rollback === "string"
          ? flags.rollback
          : undefined;

    const res = this.installer.upgrade(cwd, { dryRun, rollback });
    const text =
      res.action === "rolled-back"
        ? `Rolled back harness to backup ${res.backupId} (${res.changedFiles.length} files restored)`
        : res.action === "dry-run"
          ? `Dry-run upgrade to v${res.harnessVersion}: ${res.changedFiles.length} managed files inspected`
          : `Upgraded harness to v${res.harnessVersion} (backup=${res.backupId}, changed=${res.changedFiles.length} files)`;

    return this.ok(jsonMode, res, text);
  }

  private handleWorkflow(
    cwd: string,
    subArgs: string[],
    flags: Record<string, string | boolean>,
    jsonMode: boolean
  ): CliExecutionResult {
    const sub = subArgs[0];
    const repo = new WorkflowRepository(cwd);

    if (sub === "list") {
      const workflows = repo.listWorkflows();
      const text =
        workflows.length === 0
          ? "No workflows installed in .agents/workflows/. Run 'dlm init' or 'dlm sync'."
          : workflows
              .map(
                (w) =>
                  `- ${w.id} (v${w.version}): ${w.name} [${w.stages.filter((s) => s.enabled).length}/${w.stages.length} stages enabled]`
              )
              .join("\n");
      return this.ok(jsonMode, { workflows }, text);
    }

    if (sub === "show") {
      const wfId = subArgs[1];
      if (!wfId) return this.fail(jsonMode, "Usage: dlm workflow show <workflow-id>");
      const wf = repo.loadWorkflow(wfId);
      const overrides: TaskWorkflowOverrides = {
        disableStages: splitCsvFlag(flags["disable-stage"]),
        enableStages: splitCsvFlag(flags["enable-stage"])
      };
      const plan = this.workflowEngine.validateAndPlan(wf, overrides);

      const orcaCommands = flags["orca-plan"]
        ? this.installer.adapters.orca.buildOrchestrationCommands(
            typeof flags.objective === "string" ? flags.objective : `Execute workflow ${wf.id}`,
            plan
          )
        : undefined;

      const lines: string[] = [
        `Workflow: ${wf.id} — ${wf.name} (v${wf.version})`,
        `Valid DAG: ${plan.valid}`,
        `Enabled Stages (${plan.enabledStages.length}):`,
        ...plan.waves.map(
          (wave) =>
            `  Wave ${wave.waveIndex} (${wave.parallel ? "PARALLEL" : "SEQUENTIAL"}): ${wave.stages
              .map(
                (s) =>
                  `${s.id}[role=${s.role}, deps=${s.effectiveDependsOn.join("+") || "none"}${s.mandatoryGate ? ", MANDATORY_GATE" : ""}]`
              )
              .join(", ")}`
        )
      ];
      if (plan.skippedStages.length > 0) {
        lines.push(`Skipped/Disabled Stages: ${plan.skippedStages.map((s) => s.id).join(", ")}`);
      }
      if (orcaCommands) {
        lines.push("", "Orca Orchestration Dispatch Plan:");
        for (const c of orcaCommands) {
          lines.push(`  $ ${c.command} ${c.args.join(" ")}`);
        }
      }

      return {
        exitCode: plan.valid ? 0 : 1,
        stdout: jsonMode
          ? JSON.stringify({ workflow: wf, plan, ...(orcaCommands ? { orcaCommands } : {}) }, null, 2)
          : lines.join("\n"),
        stderr: "",
        data: { workflow: wf, plan, orcaCommands }
      };
    }

    if (sub === "validate") {
      const wfId = subArgs[1];
      const workflows = wfId ? [repo.loadWorkflow(wfId)] : repo.listWorkflows();
      const overrides: TaskWorkflowOverrides = {
        disableStages: splitCsvFlag(flags["disable-stage"]),
        enableStages: splitCsvFlag(flags["enable-stage"])
      };
      const plans = workflows.map((wf) => this.workflowEngine.validateAndPlan(wf, overrides));
      const allValid = plans.every((p) => p.valid);

      const lines = plans.map(
        (p) =>
          `${p.workflowId}: ${p.valid ? "VALID" : "INVALID"} (${p.waves.length} waves, ${p.issues.length} issue(s))` +
          (p.issues.length > 0
            ? "\n" + p.issues.map((i) => `  - [${i.severity}] ${i.code}: ${i.message}`).join("\n")
            : "")
      );

      return {
        exitCode: allValid ? 0 : 1,
        stdout: jsonMode ? JSON.stringify({ valid: allValid, plans }, null, 2) : lines.join("\n"),
        stderr: "",
        data: { valid: allValid, plans }
      };
    }

    if (sub === "create") {
      const wfId = subArgs[1];
      if (!wfId) return this.fail(jsonMode, "Usage: dlm workflow create <workflow-id> [--name <name>]");
      const name = typeof flags.name === "string" ? flags.name : `${wfId} workflow`;
      const desc = typeof flags.description === "string" ? flags.description : undefined;
      const wf = repo.createWorkflow(wfId, name, desc);
      return this.ok(
        jsonMode,
        wf,
        `Created workflow '${wf.id}' at .agents/workflows/${wf.id}.yaml`
      );
    }

    if (sub === "enable" || sub === "disable") {
      const wfId = subArgs[1];
      const stageId = subArgs[2];
      if (!wfId || !stageId) {
        return this.fail(jsonMode, `Usage: dlm workflow ${sub} <workflow-id> <stage-id>`);
      }
      const wf = repo.setStageEnabled(wfId, stageId, sub === "enable");
      return this.ok(
        jsonMode,
        wf,
        `Stage '${stageId}' in workflow '${wfId}' is now ${sub === "enable" ? "enabled" : "disabled"}`
      );
    }

    if (sub === "add-stage") {
      const wfId = subArgs[1];
      const stageId = typeof flags.id === "string" ? flags.id : subArgs[2];
      if (!wfId || !stageId) {
        return this.fail(
          jsonMode,
          "Usage: dlm workflow add-stage <workflow-id> --id <stage-id> --name <name> [--role <role>] [--depends-on <d1,d2>] [--after <stage-id>]"
        );
      }
      const name = typeof flags.name === "string" ? flags.name : stageId;
      const role = (typeof flags.role === "string" ? flags.role : "implementer") as AgentRole;
      const dependsOn = splitCsvFlag(flags["depends-on"]);
      const afterStage = typeof flags.after === "string" ? flags.after : undefined;

      const wf = repo.addStage(
        wfId,
        {
          id: stageId,
          name,
          role,
          enabled: true,
          mandatoryGate: Boolean(flags["mandatory-gate"]),
          dependsOn
        },
        afterStage
      );
      return this.ok(jsonMode, wf, `Added stage '${stageId}' to workflow '${wfId}'`);
    }

    if (sub === "remove-stage") {
      const wfId = subArgs[1];
      const stageId = subArgs[2] ?? (typeof flags.id === "string" ? flags.id : undefined);
      if (!wfId || !stageId) {
        return this.fail(jsonMode, "Usage: dlm workflow remove-stage <workflow-id> <stage-id>");
      }
      const wf = repo.removeStage(wfId, stageId);
      return this.ok(jsonMode, wf, `Removed stage '${stageId}' from workflow '${wfId}'`);
    }

    if (sub === "run") {
      const wfId = subArgs[1] ?? "feature";
      return this.executeWorkflowRun(cwd, wfId, flags, jsonMode);
    }

    return this.fail(
      jsonMode,
      "Usage: dlm workflow <list|show|validate|create|enable|disable|add-stage|remove-stage|run>"
    );
  }

  private executeWorkflowRun(
    cwd: string,
    workflowId: string,
    flags: Record<string, string | boolean>,
    jsonMode: boolean
  ): CliExecutionResult {
    const manifest = readManifest(cwd);
    const repo = new WorkflowRepository(cwd);
    const wf = repo.loadWorkflow(workflowId);
    const overrides: TaskWorkflowOverrides = {
      disableStages: splitCsvFlag(flags["disable-stage"]),
      enableStages: splitCsvFlag(flags["enable-stage"])
    };

    const plan = this.workflowEngine.validateAndPlan(wf, overrides);
    if (!plan.valid) {
      const details = plan.issues.map((i) => `${i.code}: ${i.message}`).join("; ");
      return this.fail(jsonMode, `Cannot run invalid workflow '${workflowId}': ${details}`);
    }

    const runtime = (typeof flags.runtime === "string"
      ? flags.runtime
      : manifest.coordinator?.preferredRuntime ?? "claude-code") as TelemetryRuntimeId;
    const model = typeof flags.model === "string" ? flags.model : "claude-sonnet-4-6";
    const experimentTag = typeof flags.experiment === "string" ? flags.experiment : undefined;
    const runValidators = Boolean(flags["run-validators"]);

    const store = new TelemetryStore(cwd);
    try {
      const session = store.startSession({
        sessionId: typeof flags.session === "string" ? flags.session : undefined,
        projectId: manifest.project.id,
        workflowId: wf.id,
        runtime,
        model,
        experimentTag,
        availableSkills: manifest.skills,
        harnessVersion: this.installer.catalog.getHarnessVersion()
      });

      const traceId = `trace-${session.sessionId}`;
      const wfSpanId = `span-wf-${wf.id}`;

      store.emit({
        eventType: "workflow.started",
        projectId: manifest.project.id,
        sessionId: session.sessionId,
        traceId,
        spanId: wfSpanId,
        workflowId: wf.id,
        runtime,
        model
      });

      const stateMachine = new WorkflowStageStateMachine([
        ...plan.enabledStages,
        ...plan.skippedStages
      ]);

      // Emit stage.skipped for disabled stages
      for (const skipped of plan.skippedStages) {
        store.emit({
          eventType: "stage.skipped",
          projectId: manifest.project.id,
          sessionId: session.sessionId,
          traceId,
          spanId: `span-stage-${skipped.id}`,
          parentSpanId: wfSpanId,
          workflowId: wf.id,
          stageId: skipped.id,
          runtime,
          model
        });
      }

      let failed = false;
      for (const wave of plan.waves) {
        for (const stage of wave.stages) {
          stateMachine.transition(stage.id, "ready");
          stateMachine.transition(stage.id, "running");
          const stageSpanId = `span-stage-${stage.id}`;
          const stageStartMs = Date.now();

          store.emit({
            eventType: "stage.started",
            projectId: manifest.project.id,
            sessionId: session.sessionId,
            traceId,
            spanId: stageSpanId,
            parentSpanId: wfSpanId,
            workflowId: wf.id,
            stageId: stage.id,
            agentId: `agent-${stage.role}`,
            runtime: (stage.preferredRuntime && stage.preferredRuntime !== "any"
              ? stage.preferredRuntime
              : runtime) as TelemetryRuntimeId,
            model: stage.preferredModel ?? model
          });

          // Record loaded & invoked skills for the stage
          for (const skillName of stage.skills ?? []) {
            store.emit({
              eventType: "skill.loaded",
              projectId: manifest.project.id,
              sessionId: session.sessionId,
              traceId,
              parentSpanId: stageSpanId,
              workflowId: wf.id,
              stageId: stage.id,
              runtime,
              model,
              payload: { skillName }
            });
            store.emit({
              eventType: "skill.invoked",
              projectId: manifest.project.id,
              sessionId: session.sessionId,
              traceId,
              parentSpanId: stageSpanId,
              workflowId: wf.id,
              stageId: stage.id,
              runtime,
              model,
              payload: { skillName }
            });
          }

          // Run stage validators if requested
          let stageFailed = false;
          if (runValidators && stage.validators && stage.validators.length > 0) {
            const valResults = this.installer.executeValidators(
              cwd,
              manifest,
              stage.validators
            );
            for (const vr of valResults) {
              store.emit({
                eventType: "validation.started",
                projectId: manifest.project.id,
                sessionId: session.sessionId,
                traceId,
                parentSpanId: stageSpanId,
                workflowId: wf.id,
                stageId: stage.id,
                runtime,
                payload: { validatorId: vr.validatorId, command: vr.command }
              });
              store.emit({
                eventType: "validation.completed",
                projectId: manifest.project.id,
                sessionId: session.sessionId,
                traceId,
                parentSpanId: stageSpanId,
                workflowId: wf.id,
                stageId: stage.id,
                runtime,
                metrics: {
                  durationMs: { value: vr.durationMs, provenance: "measured" }
                },
                payload: {
                  validatorId: vr.validatorId,
                  status: vr.status,
                  exitCode: vr.exitCode,
                  summary: vr.summary
                }
              });
              if (vr.status === "failed") stageFailed = true;
            }
          }

          const stageDurationMs = Math.max(1, Date.now() - stageStartMs);
          if (stageFailed) {
            stateMachine.transition(stage.id, "failed");
            store.emit({
              eventType: "stage.failed",
              projectId: manifest.project.id,
              sessionId: session.sessionId,
              traceId,
              spanId: stageSpanId,
              parentSpanId: wfSpanId,
              workflowId: wf.id,
              stageId: stage.id,
              runtime,
              model,
              metrics: {
                durationMs: { value: stageDurationMs, provenance: "measured" }
              }
            });
            failed = true;
            break;
          } else {
            stateMachine.transition(stage.id, "completed");
            store.emit({
              eventType: "stage.completed",
              projectId: manifest.project.id,
              sessionId: session.sessionId,
              traceId,
              spanId: stageSpanId,
              parentSpanId: wfSpanId,
              workflowId: wf.id,
              stageId: stage.id,
              runtime,
              model,
              metrics: {
                durationMs: { value: stageDurationMs, provenance: "measured" }
              }
            });
          }
        }
        if (failed) break;
      }

      store.emit({
        eventType: failed ? "workflow.failed" : "workflow.completed",
        projectId: manifest.project.id,
        sessionId: session.sessionId,
        traceId,
        spanId: wfSpanId,
        workflowId: wf.id,
        runtime,
        model
      });

      store.completeSession(session.sessionId, failed ? "failed" : "completed");

      const summary = {
        sessionId: session.sessionId,
        workflowId: wf.id,
        status: failed ? "failed" : "completed",
        stages: stateMachine.snapshot()
      };

      return {
        exitCode: failed ? 1 : 0,
        stdout: jsonMode
          ? JSON.stringify(summary, null, 2)
          : `Workflow '${wf.id}' ${summary.status.toUpperCase()} (session: ${session.sessionId})\nStages: ${JSON.stringify(summary.stages)}`,
        stderr: "",
        data: summary
      };
    } finally {
      store.close();
    }
  }

  private handleHandoff(
    cwd: string,
    subArgs: string[],
    flags: Record<string, string | boolean>,
    jsonMode: boolean
  ): CliExecutionResult {
    const sub = subArgs[0] ?? "show";
    const mgr = new HandoffManager(cwd);

    if (sub === "create") {
      const objective =
        typeof flags.objective === "string"
          ? flags.objective
          : "Continue active workflow task";
      const sourceRuntime = (typeof flags.from === "string" ? flags.from : "claude-code") as
        | RuntimeId
        | "cli";
      const targetRuntime = (typeof flags.to === "string" ? flags.to : "codex") as
        | RuntimeId
        | "any";
      const workflowId = typeof flags.workflow === "string" ? flags.workflow : "feature";
      const completedStages = splitCsvFlag(flags.completed);
      const pendingStages = splitCsvFlag(flags.pending);
      const nextActions = splitCsvFlag(flags.next);
      const requirements = splitCsvFlag(flags.requirements);
      const planSteps = splitCsvFlag(flags.plan);

      let validationResults;
      if (flags["run-validators"]) {
        const manifest = readManifest(cwd);
        const vRes = this.installer.executeValidators(cwd, manifest);
        validationResults = vRes.map((r) => ({
          validatorId: r.validatorId,
          status: r.status,
          executedAt: r.executedAt,
          command: r.command,
          exitCode: r.exitCode ?? undefined,
          summary: r.summary
        }));
      }

      const created = mgr.createHandoff({
        sessionId: typeof flags.session === "string" ? flags.session : undefined,
        sourceRuntime,
        targetRuntime,
        objective,
        requirements: requirements.length > 0 ? requirements : undefined,
        plan: planSteps.length > 0 ? planSteps : undefined,
        workflowId,
        completedStages,
        pendingStages,
        validationResults,
        nextActions:
          nextActions.length > 0
            ? nextActions
            : [`Verify handoff with 'dlm handoff verify' and resume pending stages`]
      });

      // Emit telemetry event handoff.created
      let projectId = "project";
      try {
        projectId = readManifest(cwd).project.id;
      } catch {
        // ignore
      }
      const store = new TelemetryStore(cwd);
      try {
        store.emit({
          eventType: "handoff.created",
          projectId,
          sessionId: created.artifact.sessionId,
          workflowId,
          runtime: sourceRuntime,
          payload: {
            handoffId: created.artifact.handoffId,
            targetRuntime
          }
        });
      } finally {
        store.close();
      }

      return this.ok(
        jsonMode,
        created,
        `Created handoff '${created.artifact.handoffId}' (${sourceRuntime} -> ${targetRuntime})\n  JSON: ${created.jsonPath}\n  Markdown: ${created.markdownPath}`
      );
    }

    if (sub === "show") {
      const targetId = subArgs[1] ?? "latest";
      const artifact = mgr.loadHandoff(targetId);
      return this.ok(jsonMode, artifact, mgr.renderMarkdownSummary(artifact));
    }

    if (sub === "verify") {
      const targetId = subArgs[1] ?? "latest";
      const report = mgr.verifyHandoff(targetId);
      const lines = [
        `Handoff Verification: ${report.handoffId} — ${report.consistent ? "CONSISTENT" : "INCONSISTENT"}`,
        `  Source -> Target: ${report.artifact.sourceRuntime} -> ${report.artifact.targetRuntime}`,
        `  Branch / Commit:  ${report.currentGitState.branch} @ ${report.currentGitState.commitSha.slice(0, 12)}`,
        `  Completed Stages: ${report.artifact.workflow.completedStages.join(", ") || "none"}`,
        `  Pending Stages:   ${report.artifact.workflow.pendingStages.join(", ") || "none"}`,
        ...report.inconsistencies.map(
          (inc) => `  [${inc.severity.toUpperCase()}] ${inc.code}: ${inc.message}`
        )
      ];
      return {
        exitCode: report.consistent ? 0 : 1,
        stdout: jsonMode ? JSON.stringify(report, null, 2) : lines.join("\n"),
        stderr: "",
        data: report
      };
    }

    if (sub === "consume") {
      const targetId = subArgs[1] ?? "latest";
      const consumingRuntime = (typeof flags.runtime === "string"
        ? flags.runtime
        : "codex") as RuntimeId | "cli";
      const allowInconsistent = Boolean(flags["allow-inconsistent"]);
      const report = mgr.consumeHandoff(consumingRuntime, targetId, allowInconsistent);

      let projectId = "project";
      try {
        projectId = readManifest(cwd).project.id;
      } catch {
        // ignore
      }
      const store = new TelemetryStore(cwd);
      try {
        store.emit({
          eventType: "handoff.consumed",
          projectId,
          sessionId: report.artifact.sessionId,
          workflowId: report.artifact.workflow.workflowId,
          runtime: consumingRuntime,
          payload: {
            handoffId: report.handoffId,
            sourceRuntime: report.artifact.sourceRuntime
          }
        });
      } finally {
        store.close();
      }

      return this.ok(
        jsonMode,
        report,
        `Consumed handoff '${report.handoffId}' as runtime '${consumingRuntime}'.\nNext Actions:\n${report.artifact.nextActions.map((a, i) => `  ${i + 1}. ${a}`).join("\n")}`
      );
    }

    return this.fail(jsonMode, "Usage: dlm handoff <create|show|verify|consume>");
  }

  private handleSession(
    cwd: string,
    subArgs: string[],
    _flags: Record<string, string | boolean>,
    jsonMode: boolean
  ): CliExecutionResult {
    const sub = subArgs[0] ?? "list";
    const store = new TelemetryStore(cwd);
    try {
      store.ingestHookBreadcrumbs();
      if (sub === "list") {
        const sessions = store.listSessions();
        const text =
          sessions.length === 0
            ? "No sessions recorded in SQLite telemetry store."
            : sessions
                .map(
                  (s) =>
                    `- ${s.sessionId} [${s.status.toUpperCase()}] runtime=${s.runtime} model=${s.model ?? "n/a"} workflow=${s.workflowId ?? "n/a"} started=${s.startedAt}`
                )
                .join("\n");
        return this.ok(jsonMode, { sessions }, text);
      }

      if (sub === "show") {
        const sessionId = subArgs[1] ?? store.listSessions()[0]?.sessionId;
        if (!sessionId) {
          return this.fail(jsonMode, "Usage: dlm session show <session-id>");
        }
        const evaluator = new AnalyticsEvaluator(store);
        const report = evaluator.evaluateSession(sessionId);
        const events = store.getSessionEvents(sessionId);
        return this.ok(
          jsonMode,
          { session: report, events },
          formatSessionReportText(report)
        );
      }

      return this.fail(jsonMode, "Usage: dlm session <list|show>");
    } finally {
      store.close();
    }
  }

  private handleAnalytics(
    cwd: string,
    subArgs: string[],
    flags: Record<string, string | boolean>,
    jsonMode: boolean
  ): CliExecutionResult {
    const sub = subArgs[0] ?? "report";
    if (sub !== "report") {
      return this.fail(jsonMode, "Usage: dlm analytics report [--session <id>] [--compare <a,b>] [--experiment <tagA,tagB>]");
    }

    const store = new TelemetryStore(cwd);
    try {
      store.ingestHookBreadcrumbs();
      const evaluator = new AnalyticsEvaluator(store);

      // Compare two sessions or two experiment tags if requested
      if (typeof flags.compare === "string") {
        const parts = splitCsvFlag(flags.compare);
        if (parts.length !== 2) {
          return this.fail(jsonMode, "--compare expects two session IDs: --compare <sessA,sessB>");
        }
        const comp = evaluator.compareCohorts(parts[0]!, [parts[0]!], parts[1]!, [parts[1]!]);
        return this.ok(jsonMode, comp, formatComparisonReportText(comp));
      }

      if (typeof flags.experiment === "string") {
        const tags = splitCsvFlag(flags.experiment);
        if (tags.length !== 2) {
          return this.fail(jsonMode, "--experiment expects two experiment tags: --experiment <tagA,tagB>");
        }
        const allSessions = store.listSessions();
        const idsA = allSessions.filter((s) => s.experimentTag === tags[0]).map((s) => s.sessionId);
        const idsB = allSessions.filter((s) => s.experimentTag === tags[1]).map((s) => s.sessionId);
        const comp = evaluator.compareCohorts(tags[0]!, idsA, tags[1]!, idsB);
        return this.ok(jsonMode, comp, formatComparisonReportText(comp));
      }

      const sessions = store.listSessions();
      const targetSessionId =
        typeof flags.session === "string" ? flags.session : sessions[0]?.sessionId;

      if (!targetSessionId) {
        return this.fail(
          jsonMode,
          "No sessions available to report. Run a workflow ('dlm workflow run feature') first."
        );
      }

      if (flags["collect-quality"]) {
        let profile: ProfileId = "node";
        let projectId = "project";
        try {
          const m = readManifest(cwd);
          profile = m.profile;
          projectId = m.project.id;
        } catch {
          // fallback
        }
        const events = store.getSessionEvents(targetSessionId);
        const qualityReport =
          profile === "dotnet"
            ? new DotnetQualityCollector().collect({
                workspaceRoot: cwd,
                executeCommands: true,
                sessionEvents: events
              })
            : new TypeScriptQualityCollector().collect({
                workspaceRoot: cwd,
                executeCommands: true,
                sessionEvents: events
              });
        store.saveQualitySnapshot({
          sessionId: targetSessionId,
          projectId,
          stack: qualityReport.stack,
          report: qualityReport
        });
      }

      const report = evaluator.evaluateSession(targetSessionId);
      return this.ok(jsonMode, report, formatSessionReportText(report));
    } finally {
      store.close();
    }
  }

  private ok(jsonMode: boolean, data: unknown, text: string): CliExecutionResult {
    return {
      exitCode: 0,
      stdout: jsonMode ? JSON.stringify(data, null, 2) : text,
      stderr: "",
      data
    };
  }

  private fail(jsonMode: boolean, message: string): CliExecutionResult {
    return {
      exitCode: 1,
      stdout: jsonMode ? JSON.stringify({ error: message }, null, 2) : "",
      stderr: jsonMode ? "" : `Error: ${message}`,
      data: { error: message }
    };
  }

  private getHelpText(): string {
    return [
      "Delamain (dlm) — Reusable AI Development Harness CLI",
      "",
      "Usage: dlm <command> [options]",
      "",
      "Core Commands:",
      "  dlm init [--profile dotnet|node|typescript|minimal]   Initialize harness in a project",
      "  dlm sync [--runtime claude-code|codex|agy]            Idempotently sync skills, workflows, and configs",
      "  dlm doctor [--json]                                   Inspect runtime capabilities (declared/detected/verified)",
      "  dlm validate [--run-validators] [--json]              Validate manifest, lockfile, DAGs, and run project validators",
      "  dlm upgrade [--dry-run] [--rollback [backupId]]       Upgrade harness with automatic backup & rollback",
      "",
      "Workflow Commands:",
      "  dlm workflow list                                     List project workflows",
      "  dlm workflow show <id> [--disable-stage s1] [--orca-plan]  Inspect workflow DAG waves and overrides",
      "  dlm workflow validate [id] [--disable-stage s1]       Validate workflow DAG and stage dependencies",
      "  dlm workflow create <id> [--name <name>]              Create a new declarative workflow",
      "  dlm workflow enable <workflow-id> <stage-id>          Enable a workflow stage",
      "  dlm workflow disable <workflow-id> <stage-id>         Disable a non-mandatory workflow stage",
      "  dlm workflow add-stage <workflow-id> --id <stage-id>  Add a stage to a workflow",
      "  dlm workflow remove-stage <workflow-id> <stage-id>    Safely remove a non-mandatory workflow stage",
      "  dlm workflow run <id> [--disable-stage s1] [--run-validators] Execute workflow stages with telemetry",
      "",
      "Handoff & Persistence Commands:",
      "  dlm handoff create --objective <text> [--from r1] [--to r2] [--run-validators]",
      "  dlm handoff show [handoff-id|latest]                  Display structured handoff artifact",
      "  dlm handoff verify [handoff-id|latest]                Verify handoff against live Git & file hashes",
      "  dlm handoff consume [handoff-id|latest] --runtime <r> Verify and mark handoff consumed by receiving runtime",
      "",
      "Session & Analytics Commands:",
      "  dlm session list                                      List recorded telemetry sessions",
      "  dlm session show <session-id>                         Inspect detailed session events & metrics",
      "  dlm analytics report [--session <id>] [--compare a,b] [--experiment tagA,tagB] [--collect-quality]"
    ].join("\n");
  }
}
