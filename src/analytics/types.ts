import type { TelemetryRuntimeId } from "../core/types.js";
import type {
  ProvenanceMetric,
  SkillObservabilityBreakdown
} from "../telemetry/types.js";

export interface QualityMetricStatus {
  status: "passed" | "failed" | "unavailable";
  provenance: "measured" | "derived" | "unavailable";
  value?: number | string | null;
  details: string;
}

export interface ProjectQualityReport {
  stack: "typescript" | "dotnet";
  capturedAt: string;
  workspaceRoot: string;
  build: QualityMetricStatus;
  unitTests: QualityMetricStatus & {
    passedCount?: number;
    failedCount?: number;
    totalCount?: number;
  };
  integrationTests: QualityMetricStatus;
  coveragePct: ProvenanceMetric;
  strykerMutationScorePct: ProvenanceMetric;
  sonarqubeStatus: QualityMetricStatus;
  validationFailuresCount: ProvenanceMetric;
  correctionCyclesCount: ProvenanceMetric;
  acceptanceCriteriaSatisfiedPct: ProvenanceMetric;
}

export interface StageTimingEntry {
  stageId: string;
  status: "completed" | "failed" | "skipped" | "running";
  durationMs: ProvenanceMetric;
  retries: number;
}

export interface SessionAnalyticsReport {
  sessionId: string;
  projectId: string;
  workflowId: string | null;
  runtime: TelemetryRuntimeId;
  model: string | null;
  experimentTag: string | null;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt: string | null;
  tokens: {
    inputTokens: ProvenanceMetric;
    outputTokens: ProvenanceMetric;
    cacheReadTokens: ProvenanceMetric;
    cacheWriteTokens: ProvenanceMetric;
    reasoningTokens: ProvenanceMetric;
    totalTokens: ProvenanceMetric;
  };
  durationMs: ProvenanceMetric;
  estimatedApiCostUsd: ProvenanceMetric;
  billingNote: string;
  counts: {
    retries: ProvenanceMetric;
    toolCalls: ProvenanceMetric;
    toolFailures: ProvenanceMetric;
    stageFailuresAndBlocks: ProvenanceMetric;
    maxParallelAgents: ProvenanceMetric;
    humanInterventions: ProvenanceMetric;
  };
  stageTimings: StageTimingEntry[];
  skills: SkillObservabilityBreakdown;
  latestQuality?: ProjectQualityReport;
}

export interface CohortSummary {
  label: string;
  sampleSize: number;
  sessionIds: string[];
  avgDurationMs: ProvenanceMetric;
  avgEstimatedApiCostUsd: ProvenanceMetric;
  avgTotalTokens: ProvenanceMetric;
  avgHumanInterventions: ProvenanceMetric;
  avgStageFailures: ProvenanceMetric;
  successRatePct: ProvenanceMetric;
}

export interface ExperimentComparisonReport {
  comparedAt: string;
  cohortA: CohortSummary;
  cohortB: CohortSummary;
  deltas: {
    durationDiffMs: number | null;
    costDiffUsd: number | null;
    successRateDiffPct: number | null;
    humanInterventionDiff: number | null;
  };
  statisticalLimitations: string[];
}
