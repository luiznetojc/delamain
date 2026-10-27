import type { ProvenanceMetric } from "../telemetry/types.js";
import type {
  ExperimentComparisonReport,
  SessionAnalyticsReport
} from "./types.js";

function fmtMetric(m: ProvenanceMetric, unit = ""): string {
  if (m.value === null || m.provenance === "unavailable") {
    return "unavailable";
  }
  return `${m.value}${unit} [${m.provenance}]`;
}

export function formatSessionReportText(report: SessionAnalyticsReport): string {
  const lines: string[] = [
    `=== Delamain Session Analytics Report: ${report.sessionId} ===`,
    `Project:        ${report.projectId}`,
    `Workflow:       ${report.workflowId ?? "none"}`,
    `Runtime/Model:  ${report.runtime} / ${report.model ?? "unspecified"}`,
    `Experiment Tag: ${report.experimentTag ?? "none"}`,
    `Status:         ${report.status.toUpperCase()}`,
    `Started At:     ${report.startedAt}`,
    `Completed At:   ${report.completedAt ?? "in-progress"}`,
    `Duration:       ${fmtMetric(report.durationMs, " ms")}`,
    "",
    `--- Token & Cost Metrics (with Provenance) ---`,
    `Input Tokens:       ${fmtMetric(report.tokens.inputTokens)}`,
    `Output Tokens:      ${fmtMetric(report.tokens.outputTokens)}`,
    `Cache Read Tokens:  ${fmtMetric(report.tokens.cacheReadTokens)}`,
    `Cache Write Tokens: ${fmtMetric(report.tokens.cacheWriteTokens)}`,
    `Reasoning Tokens:   ${fmtMetric(report.tokens.reasoningTokens)}`,
    `Total Tokens:       ${fmtMetric(report.tokens.totalTokens)}`,
    `Est. API Cost:      $${fmtMetric(report.estimatedApiCostUsd)}`,
    `Note: ${report.billingNote}`,
    "",
    `--- Execution & Reliability Counts ---`,
    `Tool Calls:          ${fmtMetric(report.counts.toolCalls)} (Failures: ${fmtMetric(report.counts.toolFailures)})`,
    `Retries:             ${fmtMetric(report.counts.retries)}`,
    `Stage/Agent Fails:   ${fmtMetric(report.counts.stageFailuresAndBlocks)}`,
    `Max Parallel Agents: ${fmtMetric(report.counts.maxParallelAgents)}`,
    `Human Interventions: ${fmtMetric(report.counts.humanInterventions)}`,
    "",
    `--- Skill Observability Breakdown ---`,
    `Available in Project: ${report.skills.available.join(", ") || "none"}`,
    `Loaded in Session:    ${report.skills.loaded.join(", ") || "none"}`,
    `Explicitly Invoked:   ${report.skills.invoked.join(", ") || "none"}`,
    `Verified Procedures:  ${report.skills.verifiedProcedures.join(", ") || "none"}`,
    "",
    `--- Stage Timings ---`,
    ...(report.stageTimings.length > 0
      ? report.stageTimings.map(
          (st) =>
            `  - ${st.stageId}: ${st.status.toUpperCase()} | duration=${fmtMetric(st.durationMs, " ms")} | retries=${st.retries}`
        )
      : ["  (no stages recorded)"])
  ];

  if (report.latestQuality) {
    const q = report.latestQuality;
    lines.push(
      "",
      `--- Engineering Quality Snapshot (${q.stack}) ---`,
      `Build:                ${q.build.status.toUpperCase()} [${q.build.provenance}] (${q.build.details})`,
      `Unit Tests:           ${q.unitTests.status.toUpperCase()} [${q.unitTests.provenance}] (${q.unitTests.details})`,
      `Integration Tests:    ${q.integrationTests.status.toUpperCase()} [${q.integrationTests.provenance}]`,
      `Coverage (%):         ${fmtMetric(q.coveragePct, "%")}`,
      `Stryker Mutation (%): ${fmtMetric(q.strykerMutationScorePct, "%")}`,
      `SonarQube Gate:       ${q.sonarqubeStatus.status.toUpperCase()} [${q.sonarqubeStatus.provenance}]`,
      `Validation Failures:  ${fmtMetric(q.validationFailuresCount)}`,
      `Correction Cycles:    ${fmtMetric(q.correctionCyclesCount)}`,
      `Acceptance Satisfied: ${fmtMetric(q.acceptanceCriteriaSatisfiedPct, "%")}`
    );
  }

  return lines.join("\n");
}

export function formatComparisonReportText(comp: ExperimentComparisonReport): string {
  const lines: string[] = [
    `=== Delamain Experiment / Cohort Comparison ===`,
    `Compared At: ${comp.comparedAt}`,
    "",
    `Cohort A [${comp.cohortA.label}] (N=${comp.cohortA.sampleSize}):`,
    `  Avg Duration:            ${fmtMetric(comp.cohortA.avgDurationMs, " ms")}`,
    `  Avg Est. API Cost (USD): ${fmtMetric(comp.cohortA.avgEstimatedApiCostUsd)}`,
    `  Avg Total Tokens:        ${fmtMetric(comp.cohortA.avgTotalTokens)}`,
    `  Avg Human Interventions: ${fmtMetric(comp.cohortA.avgHumanInterventions)}`,
    `  Success Rate (%):        ${fmtMetric(comp.cohortA.successRatePct, "%")}`,
    "",
    `Cohort B [${comp.cohortB.label}] (N=${comp.cohortB.sampleSize}):`,
    `  Avg Duration:            ${fmtMetric(comp.cohortB.avgDurationMs, " ms")}`,
    `  Avg Est. API Cost (USD): ${fmtMetric(comp.cohortB.avgEstimatedApiCostUsd)}`,
    `  Avg Total Tokens:        ${fmtMetric(comp.cohortB.avgTotalTokens)}`,
    `  Avg Human Interventions: ${fmtMetric(comp.cohortB.avgHumanInterventions)}`,
    `  Success Rate (%):        ${fmtMetric(comp.cohortB.successRatePct, "%")}`,
    "",
    `--- Deltas (Cohort B - Cohort A) ---`,
    `  Duration Delta (ms):      ${comp.deltas.durationDiffMs ?? "unavailable"}`,
    `  API Cost Delta (USD):     ${comp.deltas.costDiffUsd ?? "unavailable"}`,
    `  Success Rate Delta (%):   ${comp.deltas.successRateDiffPct ?? "unavailable"}`,
    `  Human Intervention Delta: ${comp.deltas.humanInterventionDiff ?? "unavailable"}`
  ];

  if (comp.statisticalLimitations.length > 0) {
    lines.push("", `--- Statistical Limitations & Caveats ---`);
    for (const lim of comp.statisticalLimitations) {
      lines.push(`  [!] ${lim}`);
    }
  }

  return lines.join("\n");
}
