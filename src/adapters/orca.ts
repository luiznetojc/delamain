import { spawnSync } from "node:child_process";
import type { WorkflowExecutionPlan } from "../workflow/types.js";

export interface OrcaStatusSummary {
  installed: boolean;
  binaryPath: string | null;
  version: string | null;
  runtimeReachable: boolean;
  runtimeState: string;
  orchestrationSkillAvailable: boolean;
}

export interface OrcaCommandSpec {
  step: string;
  stageId?: string;
  command: string;
  args: string[];
  description: string;
}

/**
 * Adapter & contract bridge for Orca Orchestration (https://www.onorca.dev/).
 * Uses verified Orca CLI commands (`orca status --json`, `orca orchestration ...`)
 * and never invents unsupported flags or forces Orca open when running headlessly.
 */
export class OrcaIntegrationAdapter {
  inspectStatus(): OrcaStatusSummary {
    const whichRes = spawnSync("which", ["orca"], { encoding: "utf8", timeout: 5000 });
    const binaryPath = whichRes.status === 0 ? whichRes.stdout.trim() : null;
    if (!binaryPath) {
      return {
        installed: false,
        binaryPath: null,
        version: null,
        runtimeReachable: false,
        runtimeState: "not_installed",
        orchestrationSkillAvailable: false
      };
    }

    const verRes = spawnSync(binaryPath, ["--version"], { encoding: "utf8", timeout: 5000 });
    const version = verRes.status === 0 ? verRes.stdout.trim() : null;

    let runtimeReachable = false;
    let runtimeState = "unknown";
    const statusRes = spawnSync(binaryPath, ["status", "--json"], {
      encoding: "utf8",
      timeout: 5000
    });
    if (statusRes.status === 0 && statusRes.stdout.trim()) {
      try {
        const parsed = JSON.parse(statusRes.stdout) as {
          result?: { runtime?: { reachable?: boolean; state?: string } };
        };
        runtimeReachable = Boolean(parsed.result?.runtime?.reachable);
        runtimeState = parsed.result?.runtime?.state ?? "unknown";
      } catch {
        runtimeState = "parse_error";
      }
    }

    const skillsRes = spawnSync(binaryPath, ["skills", "list"], {
      encoding: "utf8",
      timeout: 5000
    });
    const orchestrationSkillAvailable =
      skillsRes.status === 0 && skillsRes.stdout.includes("orchestration:");

    return {
      installed: true,
      binaryPath,
      version,
      runtimeReachable,
      runtimeState,
      orchestrationSkillAvailable
    };
  }

  /**
   * Compiles a validated Delamain WorkflowExecutionPlan into canonical, verified
   * `orca orchestration` CLI commands (Run creation, Task DAG creation, parallel
   * wave worker-start dispatches, and decision gates).
   */
  buildOrchestrationCommands(
    objective: string,
    plan: WorkflowExecutionPlan
  ): OrcaCommandSpec[] {
    const commands: OrcaCommandSpec[] = [
      {
        step: "status-check",
        command: "orca",
        args: ["status", "--json"],
        description: "Verify Orca runtime reachability and caller session"
      },
      {
        step: "run-create",
        command: "orca",
        args: ["orchestration", "run-create", "--objective", objective, "--json"],
        description: "Create and bind an authoritative Orca orchestration Run"
      }
    ];

    for (const wave of plan.waves) {
      for (const stage of wave.stages) {
        const taskSpec = this.formatTaskSpec(objective, stage);
        const depsJson = JSON.stringify(stage.effectiveDependsOn);
        commands.push({
          step: "task-create",
          stageId: stage.id,
          command: "orca",
          args: [
            "orchestration",
            "task-create",
            "--spec",
            taskSpec,
            "--deps",
            depsJson,
            "--json"
          ],
          description: `Register task '${stage.id}' (${stage.name}) in Orca DAG`
        });

        if (stage.approvalGate?.required && stage.approvalGate.approver === "human") {
          commands.push({
            step: "gate-create",
            stageId: stage.id,
            command: "orca",
            args: [
              "orchestration",
              "gate-create",
              "--task",
              `<task_id:${stage.id}>`,
              "--reason",
              stage.approvalGate.reason ?? `Approval required for ${stage.name}`,
              "--json"
            ],
            description: `Create human decision gate for stage '${stage.id}'`
          });
        }

        const agentArg =
          stage.preferredRuntime === "codex"
            ? "codex"
            : stage.preferredRuntime === "agy"
              ? "antigravity"
              : "claude";

        const workerArgs = [
          "orchestration",
          "worker-start",
          "--task",
          `<task_id:${stage.id}>`,
          "--worktree",
          "current",
          "--agent",
          agentArg
        ];
        if (stage.preferredModel) {
          workerArgs.push("--model", stage.preferredModel);
        }
        workerArgs.push("--json");

        commands.push({
          step: "worker-start",
          stageId: stage.id,
          command: "orca",
          args: workerArgs,
          description: `Dispatch supervised worker for stage '${stage.id}' (wave ${wave.waveIndex})`
        });
      }

      commands.push({
        step: `wave-${wave.waveIndex}-wait`,
        command: "orca",
        args: [
          "orchestration",
          "check",
          "--wait",
          "--types",
          "worker_done,escalation,question",
          "--timeout-ms",
          "900000",
          "--json"
        ],
        description: `Wait for wave ${wave.waveIndex} workers (${wave.stages.map((s) => s.id).join(", ")}) to settle`
      });
    }

    return commands;
  }

  private formatTaskSpec(
    objective: string,
    stage: WorkflowExecutionPlan["waves"][number]["stages"][number]
  ): string {
    const criteria = (stage.acceptanceCriteria ?? []).join("; ") || "Stage validators pass";
    const skills = (stage.skills ?? []).join(", ") || "none";
    return [
      `Target: Stage ${stage.id} (${stage.name}) for objective "${objective}"`,
      `Change: ${stage.description ?? stage.name}`,
      `Constraints: Follow Delamain harness rules; required skills: [${skills}]`,
      `Ownership: Role=${stage.role}`,
      `Observable acceptance: ${criteria}`
    ].join(" | ");
  }
}
