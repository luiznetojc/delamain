import type { RuntimeId, ValidationIssue } from "../core/types.js";

export type HandoffRuntimeId = RuntimeId | "cli";

export interface HandoffArchitecturalDecision {
  id: string;
  title: string;
  decision: string;
  rationale: string;
}

export interface HandoffKnownIssue {
  id: string;
  severity: "low" | "medium" | "high" | "blocker";
  description: string;
  workaround?: string;
}

export interface HandoffRelevantFile {
  path: string;
  role: string;
  sha256?: string;
}

export interface HandoffValidationRecord {
  validatorId: string;
  status: "passed" | "failed" | "skipped" | "unavailable";
  executedAt: string;
  command: string;
  exitCode?: number;
  summary?: string;
}

export interface HandoffGitState {
  branch: string;
  commitSha: string;
  worktreePath: string;
  isDirty: boolean;
  modifiedFiles: string[];
  diffStatHash?: string;
}

export interface HandoffArtifact {
  schemaVersion: "1.0";
  handoffId: string;
  createdAt: string;
  consumedAt?: string;
  consumedByRuntime?: string;
  sessionId: string;
  sourceRuntime: HandoffRuntimeId;
  targetRuntime: RuntimeId | "any";
  task: {
    objective: string;
    requirements: string[];
    plan: string[];
  };
  workflow: {
    workflowId: string;
    completedStages: string[];
    pendingStages: string[];
    skippedStages?: string[];
    activeStage?: string;
  };
  gitState: HandoffGitState;
  architecturalDecisions: HandoffArchitecturalDecision[];
  knownIssues: HandoffKnownIssue[];
  relevantFiles: HandoffRelevantFile[];
  validationResults: HandoffValidationRecord[];
  nextActions: string[];
}

export interface HandoffVerificationReport {
  handoffId: string;
  consistent: boolean;
  verifiedAt: string;
  currentGitState: HandoffGitState;
  inconsistencies: ValidationIssue[];
  artifact: HandoffArtifact;
}

export interface ProjectProgressState {
  schemaVersion: "1.0";
  updatedAt: string;
  lastCompletedMilestone: string;
  lastVerificationExecuted: {
    executedAt: string;
    command: string;
    passedTests: number;
    failedTests: number;
    status: "passed" | "failed";
  };
  pendingDecisions: string[];
  importantFiles: string[];
  nextTasks: string[];
  knownBlockersAndLimitations: string[];
}
