import type {
  ExperimentComparisonReport,
  SessionAnalyticsReport,
  StageTimingEntry
} from "../analytics/types.js";
import type {
  HarnessLockfile,
  HarnessManifest,
  ValidationReport
} from "../core/types.js";
import type {
  SkillObservabilityBreakdown,
  TelemetryEvent
} from "../telemetry/types.js";
import type {
  WorkflowDefinition,
  WorkflowExecutionPlan
} from "../workflow/types.js";
import type { FullDoctorReport } from "./registry.js";

/**
 * Shared, UI-neutral contracts for future Orca visual plugin integration (Section 3.I).
 * Every view consumes the exact same domain objects produced by the Delamain CLI (`dlm --json`),
 * ensuring zero duplication of business rules between the CLI and future Orca panels.
 */

/** 1. Workflow Editor View Contract */
export interface OrcaWorkflowEditorViewModel {
  workflow: WorkflowDefinition;
  executionPlan: WorkflowExecutionPlan;
}

/** 2. Stage Timeline View Contract */
export interface OrcaStageTimelineViewModel {
  sessionId: string;
  workflowId: string | null;
  stages: StageTimingEntry[];
}

/** 3. Agent Execution Tree View Contract */
export interface AgentTreeNode {
  spanId: string;
  parentSpanId: string | null;
  agentId: string;
  runtime: string;
  model: string | null;
  stageId: string | null;
  status: "running" | "completed" | "failed";
  events: TelemetryEvent[];
  children: AgentTreeNode[];
}

export interface OrcaAgentExecutionTreeViewModel {
  sessionId: string;
  traceId: string;
  roots: AgentTreeNode[];
}

/** 4. Skills Inspector View Contract */
export interface OrcaSkillsInspectorViewModel {
  sessionId: string;
  observability: SkillObservabilityBreakdown;
  lockedSkills: HarnessLockfile["skills"];
}

/** 5. Session Analytics View Contract */
export type OrcaSessionAnalyticsViewModel = SessionAnalyticsReport;

/** 6. Model Usage Analytics View Contract */
export interface ModelUsageSummaryRow {
  runtime: string;
  model: string;
  sessionsCount: number;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  estimatedApiCostUsd: number | null;
}

export interface OrcaModelUsageAnalyticsViewModel {
  projectId: string;
  models: ModelUsageSummaryRow[];
}

/** 7. Experiment Comparison View Contract */
export type OrcaExperimentComparisonViewModel = ExperimentComparisonReport;

/** 8. Harness Manager View Contract */
export interface OrcaHarnessManagerViewModel {
  manifest: HarnessManifest;
  lockfile: HarnessLockfile | null;
  validation: ValidationReport;
  doctor: FullDoctorReport;
}
