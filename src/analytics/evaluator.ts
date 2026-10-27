import type { TelemetryStore } from "../telemetry/store.js";
import type { ProvenanceMetric, TelemetryEvent } from "../telemetry/types.js";
import type {
  CohortSummary,
  ExperimentComparisonReport,
  ProjectQualityReport,
  SessionAnalyticsReport,
  StageTimingEntry
} from "./types.js";

/**
 * Public API per-1M token reference pricing (USD) used strictly for `estimated` API cost calculations.
 * Explicitly labeled as an API estimate and never conflated with flat-rate subscriptions (Claude Max, ChatGPT Pro, etc.).
 */
const MODEL_PRICING_PER_1M_USD: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-4-6": { input: 15.0, output: 75.0, cacheRead: 1.5 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0, cacheRead: 0.3 },
  "gpt-5-codex": { input: 2.5, output: 10.0, cacheRead: 0.25 },
  default: { input: 3.0, output: 15.0, cacheRead: 0.3 }
};

export class AnalyticsEvaluator {
  constructor(private readonly store: TelemetryStore) {}

  evaluateSession(sessionId: string): SessionAnalyticsReport {
    const session = this.store.getSession(sessionId);
    if (!session) {
      throw new Error(`Session '${sessionId}' not found in telemetry database`);
    }
    const events = this.store.getSessionEvents(sessionId);
    const skills = this.store.getSkillObservability(sessionId);
    const snapshots = this.store.getQualitySnapshots(sessionId);
    const latestQuality = snapshots[0]?.report as ProjectQualityReport | undefined;

    const inputTokens = this.sumMetric(events, "inputTokens");
    const outputTokens = this.sumMetric(events, "outputTokens");
    const cacheReadTokens = this.sumMetric(events, "cacheReadTokens");
    const cacheWriteTokens = this.sumMetric(events, "cacheWriteTokens");
    const reasoningTokens = this.sumMetric(events, "reasoningTokens");

    const totalTokens: ProvenanceMetric =
      inputTokens.value !== null || outputTokens.value !== null
        ? {
            value: (inputTokens.value ?? 0) + (outputTokens.value ?? 0),
            provenance: "derived"
          }
        : { value: null, provenance: "unavailable" };

    // Estimate API cost if either explicit estimatedApiCostUsd was recorded or tokens were measured
    const explicitCost = this.sumMetric(events, "estimatedApiCostUsd");
    let estimatedApiCostUsd: ProvenanceMetric = explicitCost;
    if (
      estimatedApiCostUsd.value === null &&
      (inputTokens.value !== null || outputTokens.value !== null)
    ) {
      const modelKey = session.model && MODEL_PRICING_PER_1M_USD[session.model] ? session.model : "default";
      const rate = MODEL_PRICING_PER_1M_USD[modelKey]!;
      const cost =
        ((inputTokens.value ?? 0) / 1_000_000) * rate.input +
        ((outputTokens.value ?? 0) / 1_000_000) * rate.output +
        ((cacheReadTokens.value ?? 0) / 1_000_000) * rate.cacheRead;
      estimatedApiCostUsd = {
        value: Number(cost.toFixed(6)),
        provenance: "estimated"
      };
    }

    // Duration
    const explicitDuration = this.sumMetric(events, "durationMs");
    let durationMs: ProvenanceMetric = explicitDuration;
    if (durationMs.value === null && session.startedAt && session.completedAt) {
      const diff = Date.parse(session.completedAt) - Date.parse(session.startedAt);
      if (!Number.isNaN(diff) && diff >= 0) {
        durationMs = { value: diff, provenance: "measured" };
      }
    }

    // Stage timings & retries
    const stageTimings = this.computeStageTimings(events);
    const totalRetries = stageTimings.reduce((acc, s) => acc + s.retries, 0);

    const toolCallsCount = events.filter((e) => e.eventType === "tool.called").length;
    const toolFailuresCount = events.filter((e) => e.eventType === "tool.failed").length;
    const stageFailuresCount = events.filter(
      (e) => e.eventType === "stage.failed" || e.eventType === "agent.failed"
    ).length;
    const humanInterventionsCount = events.filter(
      (e) => Boolean(e.payload?.humanIntervention)
    ).length;
    const maxParallel = this.computeMaxParallelAgents(events);

    return {
      sessionId: session.sessionId,
      projectId: session.projectId,
      workflowId: session.workflowId,
      runtime: session.runtime,
      model: session.model,
      experimentTag: session.experimentTag,
      status: session.status,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      tokens: {
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        reasoningTokens,
        totalTokens
      },
      durationMs,
      estimatedApiCostUsd,
      billingNote:
        "Estimated API cost is calculated from token usage and reference list pricing; it does not represent flat-rate subscription billing.",
      counts: {
        retries: { value: totalRetries, provenance: "measured" },
        toolCalls: { value: toolCallsCount, provenance: "measured" },
        toolFailures: { value: toolFailuresCount, provenance: "measured" },
        stageFailuresAndBlocks: { value: stageFailuresCount, provenance: "measured" },
        maxParallelAgents: { value: maxParallel, provenance: "derived" },
        humanInterventions: { value: humanInterventionsCount, provenance: "measured" }
      },
      stageTimings,
      skills,
      ...(latestQuality ? { latestQuality } : {})
    };
  }

  compareCohorts(
    labelA: string,
    sessionIdsA: string[],
    labelB: string,
    sessionIdsB: string[]
  ): ExperimentComparisonReport {
    const reportsA = sessionIdsA.map((id) => this.evaluateSession(id));
    const reportsB = sessionIdsB.map((id) => this.evaluateSession(id));

    const cohortA = this.summarizeCohort(labelA, reportsA);
    const cohortB = this.summarizeCohort(labelB, reportsB);

    const statisticalLimitations: string[] = [];
    if (cohortA.sampleSize < 5 || cohortB.sampleSize < 5) {
      statisticalLimitations.push(
        `Small sample size (N_A=${cohortA.sampleSize}, N_B=${cohortB.sampleSize}): insufficient statistical power to claim causal superiority. Treat deltas as exploratory observations.`
      );
    }
    if (cohortA.sampleSize === 1 || cohortB.sampleSize === 1) {
      statisticalLimitations.push(
        "Single-run comparison detected (N=1): variance from LLM non-determinism, prompt caching, or task complexity cannot be separated from treatment effect."
      );
    }

    const diffOrNull = (a: number | null, b: number | null): number | null =>
      a !== null && b !== null ? Number((b - a).toFixed(4)) : null;

    return {
      comparedAt: new Date().toISOString(),
      cohortA,
      cohortB,
      deltas: {
        durationDiffMs: diffOrNull(cohortA.avgDurationMs.value, cohortB.avgDurationMs.value),
        costDiffUsd: diffOrNull(
          cohortA.avgEstimatedApiCostUsd.value,
          cohortB.avgEstimatedApiCostUsd.value
        ),
        successRateDiffPct: diffOrNull(cohortA.successRatePct.value, cohortB.successRatePct.value),
        humanInterventionDiff: diffOrNull(
          cohortA.avgHumanInterventions.value,
          cohortB.avgHumanInterventions.value
        )
      },
      statisticalLimitations
    };
  }

  private summarizeCohort(
    label: string,
    reports: SessionAnalyticsReport[]
  ): CohortSummary {
    const n = reports.length;
    if (n === 0) {
      const unavail: ProvenanceMetric = { value: null, provenance: "unavailable" };
      return {
        label,
        sampleSize: 0,
        sessionIds: [],
        avgDurationMs: unavail,
        avgEstimatedApiCostUsd: unavail,
        avgTotalTokens: unavail,
        avgHumanInterventions: unavail,
        avgStageFailures: unavail,
        successRatePct: unavail
      };
    }

    const avgMetric = (
      getter: (r: SessionAnalyticsReport) => ProvenanceMetric,
      prov: ProvenanceMetric["provenance"] = "derived"
    ): ProvenanceMetric => {
      const valid = reports.map((r) => getter(r).value).filter((v): v is number => v !== null);
      if (valid.length === 0) return { value: null, provenance: "unavailable" };
      const sum = valid.reduce((a, b) => a + b, 0);
      return { value: Number((sum / valid.length).toFixed(4)), provenance: prov };
    };

    const completedCount = reports.filter((r) => r.status === "completed").length;

    return {
      label,
      sampleSize: n,
      sessionIds: reports.map((r) => r.sessionId),
      avgDurationMs: avgMetric((r) => r.durationMs, "derived"),
      avgEstimatedApiCostUsd: avgMetric((r) => r.estimatedApiCostUsd, "estimated"),
      avgTotalTokens: avgMetric((r) => r.tokens.totalTokens, "derived"),
      avgHumanInterventions: avgMetric((r) => r.counts.humanInterventions, "derived"),
      avgStageFailures: avgMetric((r) => r.counts.stageFailuresAndBlocks, "derived"),
      successRatePct: {
        value: Number(((completedCount / n) * 100).toFixed(1)),
        provenance: "derived"
      }
    };
  }

  private sumMetric(
    events: TelemetryEvent[],
    key: keyof NonNullable<TelemetryEvent["metrics"]>
  ): ProvenanceMetric {
    let sum = 0;
    let found = false;
    let provenance: ProvenanceMetric["provenance"] = "measured";

    for (const evt of events) {
      const m = evt.metrics?.[key];
      if (m && m.value !== null) {
        sum += m.value;
        found = true;
        if (m.provenance === "estimated") provenance = "estimated";
      }
    }

    if (!found) {
      return { value: null, provenance: "unavailable" };
    }
    return { value: sum, provenance };
  }

  private computeStageTimings(events: TelemetryEvent[]): StageTimingEntry[] {
    const map = new Map<
      string,
      {
        startedAt?: number;
        durationMs: number | null;
        provenance: ProvenanceMetric["provenance"];
        status: StageTimingEntry["status"];
        startsCount: number;
      }
    >();

    for (const evt of events) {
      if (!evt.stageId) continue;
      const cur = map.get(evt.stageId) ?? {
        durationMs: null,
        provenance: "unavailable" as const,
        status: "running" as const,
        startsCount: 0
      };

      if (evt.eventType === "stage.started") {
        cur.startedAt = Date.parse(evt.timestamp);
        cur.startsCount++;
        cur.status = "running";
      } else if (evt.eventType === "stage.skipped") {
        cur.status = "skipped";
        cur.durationMs = 0;
        cur.provenance = "measured";
      } else if (evt.eventType === "stage.completed" || evt.eventType === "stage.failed") {
        cur.status = evt.eventType === "stage.completed" ? "completed" : "failed";
        if (evt.metrics?.durationMs?.value !== undefined && evt.metrics.durationMs.value !== null) {
          cur.durationMs = evt.metrics.durationMs.value;
          cur.provenance = evt.metrics.durationMs.provenance;
        } else if (cur.startedAt !== undefined) {
          const endMs = Date.parse(evt.timestamp);
          if (!Number.isNaN(endMs) && endMs >= cur.startedAt) {
            cur.durationMs = endMs - cur.startedAt;
            cur.provenance = "measured";
          }
        }
      }
      map.set(evt.stageId, cur);
    }

    return Array.from(map.entries()).map(([stageId, info]) => ({
      stageId,
      status: info.status,
      durationMs: {
        value: info.durationMs,
        provenance: info.provenance
      },
      retries: Math.max(0, info.startsCount - 1)
    }));
  }

  private computeMaxParallelAgents(events: TelemetryEvent[]): number {
    let active = 0;
    let max = 0;
    for (const evt of events) {
      if (evt.eventType === "agent.started" || evt.eventType === "agent.dispatched") {
        active++;
        if (active > max) max = active;
      } else if (evt.eventType === "agent.completed" || evt.eventType === "agent.failed") {
        active = Math.max(0, active - 1);
      }
    }
    return max;
  }
}
