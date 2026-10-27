import { validateAgainstSchema } from "../core/schemas.js";
import type { ValidationIssue } from "../core/types.js";
import type {
  ExecutionWave,
  PlannedStage,
  StageState,
  TaskWorkflowOverrides,
  WorkflowDefinition,
  WorkflowExecutionPlan,
  WorkflowStageDefinition
} from "./types.js";

const VALID_STAGE_TRANSITIONS: Record<StageState, Set<StageState>> = {
  pending: new Set(["ready", "skipped"]),
  ready: new Set(["running", "skipped"]),
  running: new Set(["completed", "failed"]),
  failed: new Set(["ready", "failed"]), // retry transitions failed -> ready
  completed: new Set([]),
  skipped: new Set([])
};

export class WorkflowEngine {
  /**
   * Validates the schema and DAG integrity of a workflow definition, optionally
   * applying task-specific overrides without mutating the source WorkflowDefinition.
   */
  validateAndPlan(
    workflow: WorkflowDefinition,
    overrides?: TaskWorkflowOverrides
  ): WorkflowExecutionPlan {
    const cloned = structuredClone(workflow);
    const issues: ValidationIssue[] = validateAgainstSchema("workflow", cloned);

    // 1. Check duplicate stage IDs and self-dependencies
    const stageById = new Map<string, WorkflowStageDefinition>();
    for (const stage of cloned.stages) {
      if (stageById.has(stage.id)) {
        issues.push({
          code: "WORKFLOW_DUPLICATE_STAGE_ID",
          severity: "error",
          path: `$.stages[${stage.id}]`,
          message: `Duplicate stage ID '${stage.id}'`
        });
      }
      stageById.set(stage.id, stage);

      if (stage.dependsOn.includes(stage.id)) {
        issues.push({
          code: "WORKFLOW_SELF_DEPENDENCY",
          severity: "error",
          path: `$.stages[${stage.id}].dependsOn`,
          message: `Stage '${stage.id}' cannot depend on itself`
        });
      }
    }

    // 2. Check references to non-existent stages
    for (const stage of cloned.stages) {
      for (const depId of stage.dependsOn) {
        if (!stageById.has(depId)) {
          issues.push({
            code: "WORKFLOW_MISSING_DEPENDENCY",
            severity: "error",
            path: `$.stages[${stage.id}].dependsOn`,
            message: `Stage '${stage.id}' depends on non-existent stage '${depId}'`
          });
        }
      }
    }

    // 3. Apply task-specific overrides in-memory
    if (overrides) {
      for (const disableId of overrides.disableStages ?? []) {
        const target = stageById.get(disableId);
        if (!target) {
          issues.push({
            code: "WORKFLOW_OVERRIDE_UNKNOWN_STAGE",
            severity: "error",
            path: `overrides.disableStages`,
            message: `Cannot disable unknown stage '${disableId}'`
          });
          continue;
        }
        if (target.mandatoryGate && !overrides.allowDisableMandatoryGate) {
          issues.push({
            code: "WORKFLOW_MANDATORY_GATE_PROTECTED",
            severity: "error",
            path: `$.stages[${disableId}]`,
            message: `Stage '${disableId}' is a mandatory gate and cannot be disabled without explicit authorization`
          });
          continue;
        }
        target.enabled = false;
      }

      for (const enableId of overrides.enableStages ?? []) {
        const target = stageById.get(enableId);
        if (!target) {
          issues.push({
            code: "WORKFLOW_OVERRIDE_UNKNOWN_STAGE",
            severity: "error",
            path: `overrides.enableStages`,
            message: `Cannot enable unknown stage '${enableId}'`
          });
          continue;
        }
        target.enabled = true;
      }

      for (const [stageId, model] of Object.entries(overrides.stageModelOverrides ?? {})) {
        const target = stageById.get(stageId);
        if (target) target.preferredModel = model;
      }

      for (const [stageId, runtime] of Object.entries(overrides.stageRuntimeOverrides ?? {})) {
        const target = stageById.get(stageId);
        if (target) target.preferredRuntime = runtime;
      }
    }

    // Also verify no mandatoryGate stage was disabled directly in the definition
    for (const stage of cloned.stages) {
      if (stage.mandatoryGate && !stage.enabled && !overrides?.allowDisableMandatoryGate) {
        issues.push({
          code: "WORKFLOW_MANDATORY_GATE_DISABLED",
          severity: "error",
          path: `$.stages[${stage.id}].enabled`,
          message: `Mandatory gate stage '${stage.id}' cannot be disabled`
        });
      }
    }

    // 4. Detect cycles across the full graph before dependency reconciliation
    const cycle = this.detectCycle(cloned.stages, stageById);
    if (cycle) {
      issues.push({
        code: "WORKFLOW_CYCLE_DETECTED",
        severity: "error",
        path: "$.stages",
        message: `Cycle detected in workflow DAG: ${cycle.join(" -> ")}`
      });
    }

    if (issues.some((i) => i.severity === "error")) {
      return {
        workflowId: cloned.id,
        workflowVersion: cloned.version,
        valid: false,
        issues,
        enabledStages: [],
        skippedStages: cloned.stages.filter((s) => !s.enabled),
        waves: []
      };
    }

    // 5. Reconcile dependencies when intermediate stages are disabled:
    // If C -> B and B -> A, and B is disabled, then C's effective dependency becomes [A].
    const reconciledDeps = new Map<string, string[]>();
    const resolveEffectiveDeps = (stageId: string, visited = new Set<string>()): string[] => {
      if (reconciledDeps.has(stageId)) return reconciledDeps.get(stageId)!;
      const st = stageById.get(stageId);
      if (!st) return [];
      const result = new Set<string>();
      for (const depId of st.dependsOn) {
        if (visited.has(depId)) continue;
        visited.add(depId);
        const depStage = stageById.get(depId);
        if (!depStage) continue;
        if (depStage.enabled) {
          result.add(depId);
        } else {
          for (const transitiveId of resolveEffectiveDeps(depId, new Set(visited))) {
            result.add(transitiveId);
          }
        }
      }
      const arr = Array.from(result);
      reconciledDeps.set(stageId, arr);
      return arr;
    };

    const enabledRaw = cloned.stages.filter((s) => s.enabled);
    const skippedStages = cloned.stages.filter((s) => !s.enabled);

    // 6. Compute topological execution waves (Kahn's level-order algorithm)
    const remaining = new Map<string, WorkflowStageDefinition>();
    for (const s of enabledRaw) {
      remaining.set(s.id, s);
    }

    const settled = new Set<string>();
    const waves: ExecutionWave[] = [];
    const enabledStages: PlannedStage[] = [];
    let waveIndex = 0;

    while (remaining.size > 0) {
      const readyInWave: PlannedStage[] = [];
      for (const stage of remaining.values()) {
        const effDeps = resolveEffectiveDeps(stage.id);
        if (effDeps.every((d) => settled.has(d))) {
          readyInWave.push({
            ...stage,
            effectiveDependsOn: effDeps,
            waveIndex
          });
        }
      }

      if (readyInWave.length === 0) {
        issues.push({
          code: "WORKFLOW_UNRESOLVABLE_DAG",
          severity: "error",
          path: "$.stages",
          message: "Unable to resolve next DAG wave due to circular or unsatisfied dependencies"
        });
        break;
      }

      for (const planned of readyInWave) {
        remaining.delete(planned.id);
        settled.add(planned.id);
        enabledStages.push(planned);
      }

      waves.push({
        waveIndex,
        parallel: readyInWave.length > 1,
        stages: readyInWave
      });
      waveIndex++;
    }

    return {
      workflowId: cloned.id,
      workflowVersion: cloned.version,
      valid: !issues.some((i) => i.severity === "error"),
      issues,
      enabledStages,
      skippedStages,
      waves
    };
  }

  private detectCycle(
    stages: WorkflowStageDefinition[],
    stageById: Map<string, WorkflowStageDefinition>
  ): string[] | null {
    const state = new Map<string, "visiting" | "visited">();
    const stack: string[] = [];

    const dfs = (nodeId: string): string[] | null => {
      state.set(nodeId, "visiting");
      stack.push(nodeId);

      const node = stageById.get(nodeId);
      for (const depId of node?.dependsOn ?? []) {
        if (!stageById.has(depId)) continue;
        const depState = state.get(depId);
        if (depState === "visiting") {
          const cycleStart = stack.indexOf(depId);
          return [...stack.slice(cycleStart), depId];
        }
        if (!depState) {
          const found = dfs(depId);
          if (found) return found;
        }
      }

      stack.pop();
      state.set(nodeId, "visited");
      return null;
    };

    for (const s of stages) {
      if (!state.has(s.id)) {
        const cycle = dfs(s.id);
        if (cycle) return cycle;
      }
    }
    return null;
  }
}

export class WorkflowStageStateMachine {
  private readonly states = new Map<string, StageState>();
  private readonly completedOnce = new Set<string>();

  constructor(stages: WorkflowStageDefinition[]) {
    for (const s of stages) {
      this.states.set(s.id, s.enabled ? "pending" : "skipped");
    }
  }

  getState(stageId: string): StageState {
    const state = this.states.get(stageId);
    if (!state) {
      throw new Error(`Unknown stage '${stageId}' in state machine`);
    }
    return state;
  }

  transition(stageId: string, nextState: StageState): void {
    const current = this.getState(stageId);
    if (nextState === "running" && this.completedOnce.has(stageId)) {
      throw new Error(`Duplicate execution prevented: stage '${stageId}' has already completed`);
    }
    const allowed = VALID_STAGE_TRANSITIONS[current];
    if (!allowed || !allowed.has(nextState)) {
      throw new Error(
        `Invalid stage state transition for '${stageId}': ${current} -> ${nextState}`
      );
    }
    this.states.set(stageId, nextState);
    if (nextState === "completed") {
      this.completedOnce.add(stageId);
    }
  }

  assertSafeToRemoveOrDisable(stageId: string): void {
    const current = this.states.get(stageId);
    if (current === "running") {
      throw new Error(
        `WORKFLOW_STAGE_IN_PROGRESS: Cannot remove or disable stage '${stageId}' while it is currently running`
      );
    }
  }

  snapshot(): Record<string, StageState> {
    return Object.fromEntries(this.states.entries());
  }
}
