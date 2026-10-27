import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { validateAgainstSchema } from "../core/schemas.js";
import { redactObjectSecrets, resolveSafeWorkspacePath } from "../core/security.js";
import type { TelemetryRuntimeId } from "../core/types.js";
import type {
  EventMetricsBundle,
  SessionRecord,
  SkillObservabilityBreakdown,
  TelemetryEvent,
  TelemetryEventType
} from "./types.js";

export interface EmitEventInput {
  eventId?: string;
  eventType: TelemetryEventType;
  timestamp?: string;
  projectId: string;
  sessionId: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  workflowId?: string;
  stageId?: string;
  agentId?: string;
  runtime: TelemetryRuntimeId;
  model?: string;
  harnessVersion?: string;
  metrics?: EventMetricsBundle;
  payload?: Record<string, unknown>;
}

export class TelemetryStore {
  public readonly dbPath: string;
  private db: DatabaseSync | null = null;

  constructor(private readonly workspaceRoot: string) {
    this.dbPath = resolveSafeWorkspacePath(
      workspaceRoot,
      ".ai-harness-state/telemetry/telemetry.sqlite"
    );
  }

  private getDb(): DatabaseSync {
    if (this.db) return this.db;
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    const db = new DatabaseSync(this.dbPath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA synchronous = NORMAL;");
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        workflow_id TEXT,
        runtime TEXT NOT NULL,
        model TEXT,
        experiment_tag TEXT,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        available_skills_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS telemetry_events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        project_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        trace_id TEXT NOT NULL,
        span_id TEXT NOT NULL,
        parent_span_id TEXT,
        workflow_id TEXT,
        stage_id TEXT,
        agent_id TEXT,
        runtime TEXT NOT NULL,
        model TEXT,
        harness_version TEXT NOT NULL,
        metrics_json TEXT,
        payload_json TEXT,
        raw_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_events_session ON telemetry_events(session_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_type ON telemetry_events(event_type);

      CREATE TABLE IF NOT EXISTS quality_snapshots (
        snapshot_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        stack TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        report_json TEXT NOT NULL
      );
    `);
    this.db = db;
    return db;
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  startSession(input: {
    sessionId?: string;
    projectId: string;
    workflowId?: string;
    runtime: TelemetryRuntimeId;
    model?: string;
    experimentTag?: string;
    availableSkills?: string[];
    harnessVersion?: string;
  }): SessionRecord {
    const db = this.getDb();
    const sessionId = input.sessionId ?? `sess-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const startedAt = new Date().toISOString();
    const availableSkills = input.availableSkills ?? [];

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO sessions (
        session_id, project_id, workflow_id, runtime, model,
        experiment_tag, status, started_at, completed_at, available_skills_json
      ) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, NULL, ?)
    `);
    stmt.run(
      sessionId,
      input.projectId,
      input.workflowId ?? null,
      input.runtime,
      input.model ?? null,
      input.experimentTag ?? null,
      startedAt,
      JSON.stringify(availableSkills)
    );

    this.emit({
      eventType: "session.started",
      timestamp: startedAt,
      projectId: input.projectId,
      sessionId,
      workflowId: input.workflowId,
      runtime: input.runtime,
      model: input.model,
      harnessVersion: input.harnessVersion ?? "0.1.0",
      payload: {
        experimentTag: input.experimentTag ?? null,
        availableSkillsCount: availableSkills.length
      }
    });

    return {
      sessionId,
      projectId: input.projectId,
      workflowId: input.workflowId ?? null,
      runtime: input.runtime,
      model: input.model ?? null,
      experimentTag: input.experimentTag ?? null,
      status: "running",
      startedAt,
      completedAt: null,
      availableSkills
    };
  }

  completeSession(
    sessionId: string,
    status: "completed" | "failed" = "completed",
    metrics?: EventMetricsBundle
  ): void {
    const db = this.getDb();
    const existing = this.getSession(sessionId);
    const completedAt = new Date().toISOString();
    if (existing) {
      const upd = db.prepare(`
        UPDATE sessions SET status = ?, completed_at = ? WHERE session_id = ?
      `);
      upd.run(status, completedAt, sessionId);

      this.emit({
        eventType: status === "completed" ? "session.completed" : "session.failed",
        timestamp: completedAt,
        projectId: existing.projectId,
        sessionId,
        workflowId: existing.workflowId ?? undefined,
        runtime: existing.runtime,
        model: existing.model ?? undefined,
        metrics
      });
    }
  }

  /**
   * Emits a canonical telemetry event into SQLite with schema validation,
   * secret redaction, and idempotent deduplication on `eventId`.
   */
  emit(input: EmitEventInput): { event: TelemetryEvent; inserted: boolean } {
    const db = this.getDb();
    const rawEvent: TelemetryEvent = {
      schemaVersion: "1.0",
      eventId: input.eventId ?? crypto.randomUUID(),
      eventType: input.eventType,
      timestamp: input.timestamp ?? new Date().toISOString(),
      projectId: input.projectId,
      sessionId: input.sessionId,
      traceId: input.traceId ?? `trace-${input.sessionId}`,
      spanId: input.spanId ?? `span-${crypto.randomBytes(4).toString("hex")}`,
      ...(input.parentSpanId ? { parentSpanId: input.parentSpanId } : {}),
      ...(input.workflowId ? { workflowId: input.workflowId } : {}),
      ...(input.stageId ? { stageId: input.stageId } : {}),
      ...(input.agentId ? { agentId: input.agentId } : {}),
      runtime: input.runtime,
      ...(input.model ? { model: input.model } : {}),
      harnessVersion: input.harnessVersion ?? "0.1.0",
      ...(input.metrics ? { metrics: input.metrics } : {}),
      ...(input.payload ? { payload: redactObjectSecrets(input.payload) } : {})
    };

    const issues = validateAgainstSchema("telemetry-event", rawEvent);
    if (issues.length > 0) {
      throw new Error(
        `Invalid telemetry event (${rawEvent.eventType}): ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`
      );
    }

    const stmt = db.prepare(`
      INSERT OR IGNORE INTO telemetry_events (
        event_id, event_type, timestamp, project_id, session_id,
        trace_id, span_id, parent_span_id, workflow_id, stage_id,
        agent_id, runtime, model, harness_version, metrics_json,
        payload_json, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const info = stmt.run(
      rawEvent.eventId,
      rawEvent.eventType,
      rawEvent.timestamp,
      rawEvent.projectId,
      rawEvent.sessionId,
      rawEvent.traceId,
      rawEvent.spanId,
      rawEvent.parentSpanId ?? null,
      rawEvent.workflowId ?? null,
      rawEvent.stageId ?? null,
      rawEvent.agentId ?? null,
      rawEvent.runtime,
      rawEvent.model ?? null,
      rawEvent.harnessVersion,
      rawEvent.metrics ? JSON.stringify(rawEvent.metrics) : null,
      rawEvent.payload ? JSON.stringify(rawEvent.payload) : null,
      JSON.stringify(rawEvent)
    );

    return {
      event: rawEvent,
      inserted: Number(info.changes) > 0
    };
  }

  /**
   * Ingests any hook breadcrumbs written by `.agents/hooks/dlm-hook.mjs` into SQLite.
   */
  ingestHookBreadcrumbs(defaultProjectId = "project"): number {
    const hookLogPath = resolveSafeWorkspacePath(
      this.workspaceRoot,
      ".ai-harness-state/telemetry/hook-events.jsonl"
    );
    if (!fs.existsSync(hookLogPath)) return 0;
    const lines = fs
      .readFileSync(hookLogPath, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    let count = 0;
    for (const line of lines) {
      try {
        const item = JSON.parse(line) as {
          eventId?: string;
          eventType?: TelemetryEventType;
          timestamp?: string;
          runtime?: string;
          sessionId?: string;
          toolName?: string;
        };
        if (!item.eventType) continue;
        const runtime: TelemetryRuntimeId =
          item.runtime === "claude-code" ||
          item.runtime === "codex" ||
          item.runtime === "agy" ||
          item.runtime === "orca"
            ? item.runtime
            : "cli";
        const res = this.emit({
          eventId: item.eventId,
          eventType: item.eventType,
          timestamp: item.timestamp,
          projectId: defaultProjectId,
          sessionId: item.sessionId ?? "hook-session",
          runtime,
          payload: item.toolName ? { toolName: item.toolName } : undefined
        });
        if (res.inserted) count++;
      } catch {
        // skip malformed line
      }
    }
    return count;
  }

  getSession(sessionId: string): SessionRecord | null {
    const db = this.getDb();
    const row = db
      .prepare(`SELECT * FROM sessions WHERE session_id = ?`)
      .get(sessionId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapSessionRow(row);
  }

  listSessions(): SessionRecord[] {
    const db = this.getDb();
    const rows = db
      .prepare(`SELECT * FROM sessions ORDER BY started_at DESC`)
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapSessionRow(r));
  }

  getSessionEvents(sessionId: string): TelemetryEvent[] {
    const db = this.getDb();
    const rows = db
      .prepare(
        `SELECT raw_json FROM telemetry_events WHERE session_id = ? ORDER BY timestamp ASC, rowid ASC`
      )
      .all(sessionId) as Array<{ raw_json: string }>;
    return rows.map((r) => JSON.parse(r.raw_json) as TelemetryEvent);
  }

  /**
   * Computes the strict 4-tier skill observability breakdown for a session:
   * - available (configured in manifest/session)
   * - loaded (observed via skill.loaded)
   * - invoked (observed via skill.invoked)
   * - verifiedProcedures (observed via validation.completed with passed status)
   * Never infers that a skill was invoked merely because it exists in the project!
   */
  getSkillObservability(sessionId: string): SkillObservabilityBreakdown {
    const session = this.getSession(sessionId);
    const events = this.getSessionEvents(sessionId);

    const available = new Set<string>(session?.availableSkills ?? []);
    const loaded = new Set<string>();
    const invoked = new Set<string>();
    const verifiedProcedures = new Set<string>();

    for (const evt of events) {
      const skillName = evt.payload?.skillName;
      if (evt.eventType === "skill.loaded" && typeof skillName === "string") {
        loaded.add(skillName);
      }
      if (evt.eventType === "skill.invoked" && typeof skillName === "string") {
        invoked.add(skillName);
      }
      if (
        evt.eventType === "validation.completed" &&
        evt.payload?.status === "passed" &&
        typeof evt.payload?.validatorId === "string"
      ) {
        verifiedProcedures.add(evt.payload.validatorId);
      }
    }

    return {
      available: Array.from(available),
      loaded: Array.from(loaded),
      invoked: Array.from(invoked),
      verifiedProcedures: Array.from(verifiedProcedures)
    };
  }

  saveQualitySnapshot(snapshot: {
    snapshotId?: string;
    sessionId: string;
    projectId: string;
    stack: string;
    capturedAt?: string;
    report: unknown;
  }): string {
    const db = this.getDb();
    const snapshotId = snapshot.snapshotId ?? `qual-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const capturedAt = snapshot.capturedAt ?? new Date().toISOString();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO quality_snapshots (
        snapshot_id, session_id, project_id, stack, captured_at, report_json
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      snapshotId,
      snapshot.sessionId,
      snapshot.projectId,
      snapshot.stack,
      capturedAt,
      JSON.stringify(snapshot.report)
    );
    return snapshotId;
  }

  getQualitySnapshots(sessionId: string): Array<{
    snapshotId: string;
    sessionId: string;
    projectId: string;
    stack: string;
    capturedAt: string;
    report: unknown;
  }> {
    const db = this.getDb();
    const rows = db
      .prepare(`SELECT * FROM quality_snapshots WHERE session_id = ? ORDER BY captured_at DESC`)
      .all(sessionId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      snapshotId: String(r.snapshot_id),
      sessionId: String(r.session_id),
      projectId: String(r.project_id),
      stack: String(r.stack),
      capturedAt: String(r.captured_at),
      report: JSON.parse(String(r.report_json))
    }));
  }

  private mapSessionRow(row: Record<string, unknown>): SessionRecord {
    return {
      sessionId: String(row.session_id),
      projectId: String(row.project_id),
      workflowId: row.workflow_id ? String(row.workflow_id) : null,
      runtime: String(row.runtime) as TelemetryRuntimeId,
      model: row.model ? String(row.model) : null,
      experimentTag: row.experiment_tag ? String(row.experiment_tag) : null,
      status: String(row.status) as SessionRecord["status"],
      startedAt: String(row.started_at),
      completedAt: row.completed_at ? String(row.completed_at) : null,
      availableSkills: JSON.parse(String(row.available_skills_json || "[]")) as string[]
    };
  }
}
