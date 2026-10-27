import type { TelemetryRuntimeId } from "../core/types.js";

export type TelemetryEventType =
  | "session.started"
  | "session.completed"
  | "session.failed"
  | "workflow.started"
  | "workflow.completed"
  | "workflow.failed"
  | "stage.started"
  | "stage.completed"
  | "stage.failed"
  | "stage.skipped"
  | "agent.dispatched"
  | "agent.started"
  | "agent.completed"
  | "agent.failed"
  | "skill.loaded"
  | "skill.invoked"
  | "tool.called"
  | "tool.completed"
  | "tool.failed"
  | "validation.started"
  | "validation.completed"
  | "handoff.created"
  | "handoff.consumed";

export type MetricProvenance = "measured" | "estimated" | "derived" | "unavailable";

export interface ProvenanceMetric {
  value: number | null;
  provenance: MetricProvenance;
}

export interface EventMetricsBundle {
  inputTokens?: ProvenanceMetric;
  outputTokens?: ProvenanceMetric;
  cacheReadTokens?: ProvenanceMetric;
  cacheWriteTokens?: ProvenanceMetric;
  reasoningTokens?: ProvenanceMetric;
  durationMs?: ProvenanceMetric;
  estimatedApiCostUsd?: ProvenanceMetric;
}

export interface TelemetryEvent {
  schemaVersion: "1.0";
  eventId: string;
  eventType: TelemetryEventType;
  timestamp: string;
  projectId: string;
  sessionId: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  workflowId?: string;
  stageId?: string;
  agentId?: string;
  runtime: TelemetryRuntimeId;
  model?: string;
  harnessVersion: string;
  metrics?: EventMetricsBundle;
  payload?: Record<string, unknown>;
}

export interface SessionRecord {
  sessionId: string;
  projectId: string;
  workflowId: string | null;
  runtime: TelemetryRuntimeId;
  model: string | null;
  experimentTag: string | null;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt: string | null;
  availableSkills: string[];
}

export interface SkillObservabilityBreakdown {
  available: string[];
  loaded: string[];
  invoked: string[];
  verifiedProcedures: string[];
}
