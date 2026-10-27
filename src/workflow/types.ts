import type { RuntimeId, ValidationIssue } from "../core/types.js";

export type AgentRole =
  | "coordinator"
  | "planner"
  | "architect"
  | "implementer"
  | "tester"
  | "reviewer"
  | "security-auditor"
  | "documenter";

export type StageState =
  | "pending"
  | "ready"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export interface StageRetryPolicy {
  maxRetries: number;
  backoffMs?: number;
}

export interface StageApprovalGate {
  required: boolean;
  approver?: "human" | "coordinator" | "automated-validators";
  reason?: string;
}

export interface StageHooks {
  beforeStage?: string[];
  afterStage?: string[];
}

export interface WorkflowStageDefinition {
  id: string;
  name: string;
  description?: string;
  role: AgentRole;
  enabled: boolean;
  mandatoryGate?: boolean;
  dependsOn: string[];
  preferredRuntime?: RuntimeId | "any";
  preferredModel?: string;
  skills?: string[];
  validators?: string[];
  acceptanceCriteria?: string[];
  retryPolicy?: StageRetryPolicy;
  timeoutMs?: number;
  approvalGate?: StageApprovalGate;
  hooks?: StageHooks;
}

export interface WorkflowLifecycleHooks {
  onWorkflowStart?: string[];
  onWorkflowComplete?: string[];
  onWorkflowFail?: string[];
}

export interface WorkflowDefinition {
  schemaVersion: "1.0";
  id: string;
  name: string;
  description?: string;
  version: string;
  lifecycleHooks?: WorkflowLifecycleHooks;
  stages: WorkflowStageDefinition[];
}

export interface TaskWorkflowOverrides {
  disableStages?: string[];
  enableStages?: string[];
  stageModelOverrides?: Record<string, string>;
  stageRuntimeOverrides?: Record<string, RuntimeId | "any">;
  allowDisableMandatoryGate?: boolean;
}

export interface PlannedStage extends WorkflowStageDefinition {
  effectiveDependsOn: string[];
  waveIndex: number;
}

export interface ExecutionWave {
  waveIndex: number;
  parallel: boolean;
  stages: PlannedStage[];
}

export interface WorkflowExecutionPlan {
  workflowId: string;
  workflowVersion: string;
  valid: boolean;
  issues: ValidationIssue[];
  enabledStages: PlannedStage[];
  skippedStages: WorkflowStageDefinition[];
  waves: ExecutionWave[];
}
