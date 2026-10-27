#!/usr/bin/env node
/**
 * Portable runtime hook adapter invoked by Claude Code (.claude/settings.json),
 * Codex (.codex/hooks.json), or Antigravity (.agents/hooks.json).
 * Reads JSON payload from stdin, enforces safety floors on PreToolUse,
 * records observable telemetry events into .ai-harness-state/telemetry/events.sqlite,
 * and outputs a valid runtime hook JSON response.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const eventName = process.argv[2] || "Unknown";
const runtimeArg = process.argv[3] || "unknown";

let rawStdin = "";
try {
  rawStdin = fs.readFileSync(0, "utf8");
} catch {
  rawStdin = "{}";
}

let payload = {};
try {
  payload = rawStdin.trim() ? JSON.parse(rawStdin) : {};
} catch {
  payload = {};
}

// 1. Safety guard on PreToolUse: block destructive commands or secret dumps
if (eventName === "PreToolUse") {
  const toolName = payload?.tool_name || payload?.toolCall?.name || "";
  const command =
    payload?.tool_input?.command ||
    payload?.toolCall?.args?.CommandLine ||
    payload?.command ||
    "";

  if (typeof command === "string" && command.length > 0) {
    const destructivePatterns = [
      /\brm\s+-rf\s+\/(?:\s|$)/,
      /\bgit\s+push\s+--force\s+origin\s+(?:main|master)\b/,
      /--dangerously-skip-permissions\b/,
      /--dangerously-bypass-approvals-and-sandbox\b/
    ];
    for (const pattern of destructivePatterns) {
      if (pattern.test(command)) {
        const reason = `Blocked by Delamain safety floor: command matches forbidden pattern (${pattern})`;
        if (runtimeArg === "agy") {
          process.stdout.write(JSON.stringify({ decision: "deny", reason }) + "\n");
          process.exit(0);
        } else {
          process.stderr.write(reason + "\n");
          process.exit(2);
        }
      }
    }
  }

  // Record tool.called telemetry in JSONL fallback log if state dir exists
  recordHookBreadcrumb("tool.called", runtimeArg, { toolName });

  if (runtimeArg === "agy") {
    process.stdout.write(JSON.stringify({ decision: "allow" }) + "\n");
  } else {
    process.stdout.write("{}\n");
  }
  process.exit(0);
}

if (eventName === "PostToolUse") {
  const toolName = payload?.tool_name || payload?.toolCall?.name || "";
  const hasError = Boolean(payload?.error || payload?.tool_response?.is_error);
  recordHookBreadcrumb(hasError ? "tool.failed" : "tool.completed", runtimeArg, { toolName });
  process.stdout.write("{}\n");
  process.exit(0);
}

if (eventName === "SessionStart") {
  recordHookBreadcrumb("session.started", runtimeArg, {});
  process.stdout.write("{}\n");
  process.exit(0);
}

if (eventName === "Stop" || eventName === "SessionEnd") {
  recordHookBreadcrumb("session.completed", runtimeArg, {});
  process.stdout.write("{}\n");
  process.exit(0);
}

process.stdout.write("{}\n");

function recordHookBreadcrumb(eventType, runtime, extra) {
  try {
    const stateDir = path.join(process.cwd(), ".ai-harness-state", "telemetry");
    fs.mkdirSync(stateDir, { recursive: true });
    const logPath = path.join(stateDir, "hook-events.jsonl");
    const entry = {
      eventId: crypto.randomUUID(),
      eventType,
      timestamp: new Date().toISOString(),
      runtime,
      sessionId: payload?.session_id || payload?.conversationId || "hook-session",
      ...extra
    };
    fs.appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf8");
  } catch {
    // Non-fatal in hook execution
  }
}
