import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { resolveSafeWorkspacePath } from "../core/security.js";
import { WorkflowEngine } from "./engine.js";
import type {
  StageState,
  WorkflowDefinition,
  WorkflowStageDefinition
} from "./types.js";

export class WorkflowRepository {
  private readonly engine = new WorkflowEngine();

  constructor(private readonly workspaceRoot: string) {}

  getWorkflowPath(workflowId: string): string {
    return resolveSafeWorkspacePath(this.workspaceRoot, `.agents/workflows/${workflowId}.yaml`);
  }

  listWorkflows(): WorkflowDefinition[] {
    const dir = resolveSafeWorkspacePath(this.workspaceRoot, ".agents/workflows");
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    return files
      .map((f) => YAML.parse(fs.readFileSync(path.join(dir, f), "utf8")) as WorkflowDefinition)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  loadWorkflow(workflowId: string): WorkflowDefinition {
    const filePath = this.getWorkflowPath(workflowId);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Workflow '${workflowId}' not found at .agents/workflows/${workflowId}.yaml`);
    }
    return YAML.parse(fs.readFileSync(filePath, "utf8")) as WorkflowDefinition;
  }

  saveWorkflow(workflow: WorkflowDefinition): string {
    const plan = this.engine.validateAndPlan(workflow);
    if (!plan.valid) {
      const details = plan.issues.map((i) => `${i.code} (${i.path}): ${i.message}`).join("; ");
      throw new Error(`Refusing to save invalid workflow '${workflow.id}': ${details}`);
    }
    const filePath = this.getWorkflowPath(workflow.id);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, YAML.stringify(workflow, { indent: 2 }), "utf8");
    return filePath;
  }

  createWorkflow(
    id: string,
    name: string,
    description = "Custom Delamain workflow"
  ): WorkflowDefinition {
    const filePath = this.getWorkflowPath(id);
    if (fs.existsSync(filePath)) {
      throw new Error(`Workflow '${id}' already exists at .agents/workflows/${id}.yaml`);
    }
    const wf: WorkflowDefinition = {
      schemaVersion: "1.0",
      id,
      name,
      description,
      version: "1.0.0",
      stages: [
        {
          id: "planning",
          name: "Planning",
          role: "planner",
          enabled: true,
          mandatoryGate: false,
          dependsOn: [],
          preferredRuntime: "claude-code",
          skills: ["planning"],
          acceptanceCriteria: ["Task scope and acceptance criteria defined"]
        },
        {
          id: "implementation",
          name: "Implementation",
          role: "implementer",
          enabled: true,
          mandatoryGate: false,
          dependsOn: ["planning"],
          preferredRuntime: "codex",
          skills: ["tdd"],
          acceptanceCriteria: ["Implementation and unit tests complete"]
        },
        {
          id: "verification",
          name: "Verification Gate",
          role: "tester",
          enabled: true,
          mandatoryGate: true,
          dependsOn: ["implementation"],
          preferredRuntime: "any",
          skills: ["handoff"],
          validators: ["*"],
          acceptanceCriteria: ["All required validators pass"],
          approvalGate: {
            required: true,
            approver: "automated-validators",
            reason: "Mandatory verification gate"
          }
        }
      ]
    };
    this.saveWorkflow(wf);
    return wf;
  }

  setStageEnabled(
    workflowId: string,
    stageId: string,
    enabled: boolean,
    activeStageStates?: Record<string, StageState>
  ): WorkflowDefinition {
    const wf = this.loadWorkflow(workflowId);
    const stage = wf.stages.find((s) => s.id === stageId);
    if (!stage) {
      throw new Error(`Stage '${stageId}' not found in workflow '${workflowId}'`);
    }
    if (!enabled && activeStageStates?.[stageId] === "running") {
      throw new Error(
        `WORKFLOW_STAGE_IN_PROGRESS: Cannot disable stage '${stageId}' while it is running`
      );
    }
    if (!enabled && stage.mandatoryGate) {
      throw new Error(
        `WORKFLOW_MANDATORY_GATE_PROTECTED: Cannot disable mandatory gate stage '${stageId}'`
      );
    }
    stage.enabled = enabled;
    this.saveWorkflow(wf);
    return wf;
  }

  addStage(
    workflowId: string,
    newStage: WorkflowStageDefinition,
    afterStageId?: string
  ): WorkflowDefinition {
    const wf = this.loadWorkflow(workflowId);
    if (wf.stages.some((s) => s.id === newStage.id)) {
      throw new Error(`Stage '${newStage.id}' already exists in workflow '${workflowId}'`);
    }

    if (afterStageId) {
      const idx = wf.stages.findIndex((s) => s.id === afterStageId);
      if (idx === -1) {
        throw new Error(`Reference stage '${afterStageId}' not found in workflow '${workflowId}'`);
      }
      if (!newStage.dependsOn.includes(afterStageId)) {
        newStage.dependsOn.push(afterStageId);
      }
      wf.stages.splice(idx + 1, 0, newStage);
    } else {
      wf.stages.push(newStage);
    }

    this.saveWorkflow(wf);
    return wf;
  }

  removeStage(
    workflowId: string,
    stageId: string,
    activeStageStates?: Record<string, StageState>
  ): WorkflowDefinition {
    const wf = this.loadWorkflow(workflowId);
    const target = wf.stages.find((s) => s.id === stageId);
    if (!target) {
      throw new Error(`Stage '${stageId}' not found in workflow '${workflowId}'`);
    }
    if (activeStageStates?.[stageId] === "running") {
      throw new Error(
        `WORKFLOW_STAGE_IN_PROGRESS: Cannot remove stage '${stageId}' while it is running`
      );
    }
    if (target.mandatoryGate) {
      throw new Error(
        `WORKFLOW_MANDATORY_GATE_PROTECTED: Cannot remove mandatory gate stage '${stageId}'`
      );
    }

    // Rewire any downstream stages that depended on `stageId` to depend on `target.dependsOn`
    for (const s of wf.stages) {
      if (s.dependsOn.includes(stageId)) {
        const replaced = new Set(s.dependsOn.filter((d) => d !== stageId));
        for (const parentDep of target.dependsOn) {
          if (parentDep !== s.id) replaced.add(parentDep);
        }
        s.dependsOn = Array.from(replaced);
      }
    }

    wf.stages = wf.stages.filter((s) => s.id !== stageId);
    this.saveWorkflow(wf);
    return wf;
  }
}
