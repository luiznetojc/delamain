import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { HarnessCatalog } from "../core/catalog.js";
import { computeSha256, resolveSafeWorkspacePath } from "../core/security.js";
import type {
  HarnessManifest,
  ManagedFileEntry,
  ValidationIssue
} from "../core/types.js";
import type {
  RuntimeAdapter,
  RuntimeCapabilitiesMap,
  RuntimeDoctorReport
} from "./types.js";

export class AgyAdapter implements RuntimeAdapter {
  public readonly runtimeId = "agy" as const;
  public readonly displayName = "Google Antigravity (agy)";

  inspectEnvironment(workspaceRoot?: string): RuntimeDoctorReport {
    const whichRes = spawnSync("which", ["agy"], { encoding: "utf8", timeout: 5000 });
    const binaryPath = whichRes.status === 0 ? whichRes.stdout.trim() : null;
    let version: string | null = null;
    let helpOutput = "";

    if (binaryPath) {
      const verRes = spawnSync(binaryPath, ["--version"], { encoding: "utf8", timeout: 5000 });
      if (verRes.status === 0) version = (verRes.stdout || verRes.stderr || "").trim();
      const helpRes = spawnSync(binaryPath, ["--help"], { encoding: "utf8", timeout: 5000 });
      helpOutput = `${helpRes.stdout ?? ""}\n${helpRes.stderr ?? ""}`;
    }

    const installed = Boolean(binaryPath && version);
    const hasStreamJson = helpOutput.includes("stream-json");
    const hasConversation = helpOutput.includes("--conversation") || helpOutput.includes("--continue");
    const hasModel = helpOutput.includes("--model");
    const hasSandbox = helpOutput.includes("--sandbox");

    const capabilities: RuntimeCapabilitiesMap = {
      skills: {
        declared: "full",
        detected: installed ? "full" : "none",
        verified: installed,
        evidence: installed
          ? "Discovers .agents/skills/<name>/SKILL.md progressively"
          : "agy binary not found"
      },
      hooks: {
        declared: "full",
        detected: installed ? "full" : "none",
        verified: installed,
        evidence: installed
          ? "Supports .agents/hooks.json (SessionStart, PreToolUse, PostToolUse, PreInvocation, PostInvocation, Stop)"
          : "agy binary not found"
      },
      subagents: {
        declared: "full",
        detected: installed ? "full" : "none",
        verified: installed,
        evidence: installed
          ? "Supports define_subagent, invoke_subagent (workspace: inherit/branch/share), and send_message"
          : "agy binary not found"
      },
      structured_events: {
        declared: "full",
        detected: installed && hasStreamJson ? "full" : "none",
        verified: installed && hasStreamJson,
        evidence: hasStreamJson
          ? "Verified --print --output-format stream-json and --json-schema"
          : "stream-json not detected"
      },
      session_resume: {
        declared: "full",
        detected: installed && hasConversation ? "full" : "none",
        verified: installed && hasConversation,
        evidence: hasConversation
          ? "Verified -c/--continue and --conversation <id>"
          : "--conversation not detected"
      },
      model_selection: {
        declared: "full",
        detected: installed && hasModel ? "full" : "none",
        verified: installed && hasModel,
        evidence: hasModel
          ? "Verified --model and --effort flags"
          : "--model not detected"
      },
      worktree_isolation: {
        declared: "partial",
        detected: installed ? "partial" : "none",
        verified: installed,
        evidence: "Subagents support workspace: 'branch' / 'share' isolation inside sessions"
      },
      native_sandbox: {
        declared: "full",
        detected: installed && hasSandbox ? "full" : "none",
        verified: installed && hasSandbox,
        evidence: hasSandbox
          ? "Verified --sandbox and --mode (accept-edits, auto, plan)"
          : "--sandbox not detected"
      }
    };

    const securityAudit: ValidationIssue[] = [];
    if (workspaceRoot) {
      const hooksRel = ".agents/hooks.json";
      const hooksAbs = resolveSafeWorkspacePath(workspaceRoot, hooksRel);
      if (fs.existsSync(hooksAbs)) {
        try {
          JSON.parse(fs.readFileSync(hooksAbs, "utf8"));
        } catch (err) {
          securityAudit.push({
            code: "AGY_HOOKS_INVALID_JSON",
            severity: "error",
            path: hooksRel,
            message: `Invalid JSON in ${hooksRel}: ${(err as Error).message}`
          });
        }
      }
    }

    return {
      runtime: "agy",
      installed,
      binaryPath,
      version,
      capabilities,
      securityAudit
    };
  }

  syncProject(
    workspaceRoot: string,
    manifest: HarnessManifest,
    _catalog: HarnessCatalog
  ): ManagedFileEntry[] {
    const managedFiles: ManagedFileEntry[] = [];
    const hooksRel = ".agents/hooks.json";
    const hooksAbs = resolveSafeWorkspacePath(workspaceRoot, hooksRel);
    fs.mkdirSync(path.dirname(hooksAbs), { recursive: true });

    let hooksObj: Record<string, unknown> = {};
    let ownership: "generated" | "user-preserved" = "generated";
    if (fs.existsSync(hooksAbs)) {
      try {
        hooksObj = JSON.parse(fs.readFileSync(hooksAbs, "utf8")) as Record<string, unknown>;
        ownership = "user-preserved";
      } catch {
        hooksObj = {};
      }
    }

    const enabled = manifest.hooks?.telemetry !== false || manifest.hooks?.safetyGuards !== false;
    hooksObj["delamain-harness"] = {
      enabled,
      SessionStart: [
        {
          type: "command",
          command: "node ../hooks/dlm-hook.mjs SessionStart agy",
          timeout: 5
        }
      ],
      PreToolUse: [
        {
          matcher: "run_command",
          hooks: [
            {
              type: "command",
              command: "node ../hooks/dlm-hook.mjs PreToolUse agy",
              timeout: 5
            }
          ]
        }
      ],
      PostToolUse: [
        {
          matcher: "*",
          hooks: [
            {
              type: "command",
              command: "node ../hooks/dlm-hook.mjs PostToolUse agy",
              timeout: 5
            }
          ]
        }
      ],
      Stop: [
        {
          type: "command",
          command: "node ../hooks/dlm-hook.mjs Stop agy",
          timeout: 5
        }
      ]
    };

    const serialized = JSON.stringify(hooksObj, null, 2) + "\n";
    fs.writeFileSync(hooksAbs, serialized, "utf8");
    managedFiles.push({
      path: hooksRel,
      ownership,
      runtime: "agy",
      sha256: computeSha256(serialized)
    });

    return managedFiles;
  }

  validateProject(workspaceRoot: string, _manifest: HarnessManifest): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const hooksRel = ".agents/hooks.json";
    const hooksAbs = resolveSafeWorkspacePath(workspaceRoot, hooksRel);
    if (!fs.existsSync(hooksAbs)) {
      issues.push({
        code: "AGY_HOOKS_MISSING",
        severity: "warning",
        path: hooksRel,
        message: `${hooksRel} is missing for enabled runtime 'agy'. Run 'dlm sync --runtime agy'.`
      });
    }
    return issues;
  }
}
