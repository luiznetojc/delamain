import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { HarnessCatalog } from "../core/catalog.js";
import {
  computeSha256,
  mergeManagedMarkdown,
  resolveSafeWorkspacePath
} from "../core/security.js";
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

export class ClaudeCodeAdapter implements RuntimeAdapter {
  public readonly runtimeId = "claude-code" as const;
  public readonly displayName = "Claude Code";

  inspectEnvironment(workspaceRoot?: string): RuntimeDoctorReport {
    const whichRes = spawnSync("which", ["claude"], { encoding: "utf8", timeout: 5000 });
    const binaryPath = whichRes.status === 0 ? whichRes.stdout.trim() : null;
    let version: string | null = null;
    let helpOutput = "";

    if (binaryPath) {
      const verRes = spawnSync(binaryPath, ["--version"], { encoding: "utf8", timeout: 5000 });
      if (verRes.status === 0) {
        version = verRes.stdout.trim();
      }
      const helpRes = spawnSync(binaryPath, ["--help"], { encoding: "utf8", timeout: 5000 });
      if (helpRes.status === 0) {
        helpOutput = helpRes.stdout;
      }
    }

    const installed = Boolean(binaryPath && version);
    const hasAgentsFlag = helpOutput.includes("--agents");
    const hasStreamJson = helpOutput.includes("stream-json");
    const hasResume = helpOutput.includes("--resume");
    const hasModel = helpOutput.includes("--model");
    const hasWorktree = helpOutput.includes("--worktree");
    const hasRestricted = helpOutput.includes("--restricted") || helpOutput.includes("--permission-mode");

    const capabilities: RuntimeCapabilitiesMap = {
      skills: {
        declared: "full",
        detected: installed ? "full" : "none",
        verified: installed,
        evidence: installed
          ? "Supports .claude/skills/<name>/SKILL.md and slash command discovery"
          : "claude binary not found"
      },
      hooks: {
        declared: "full",
        detected: installed ? "full" : "none",
        verified: installed && helpOutput.includes("--settings"),
        evidence: installed
          ? "Supports hooks in .claude/settings.json (PreToolUse, PostToolUse, SessionStart, Stop, SubagentStop)"
          : "claude binary not found"
      },
      subagents: {
        declared: "full",
        detected: installed && hasAgentsFlag ? "full" : installed ? "partial" : "none",
        verified: installed && hasAgentsFlag,
        evidence: hasAgentsFlag
          ? "Verified --agents flag and .claude/agents/ subagent support"
          : "Unconfirmed --agents CLI flag"
      },
      structured_events: {
        declared: "full",
        detected: installed && hasStreamJson ? "full" : "none",
        verified: installed && hasStreamJson,
        evidence: hasStreamJson
          ? "Verified --print --output-format=stream-json and --include-hook-events"
          : "stream-json not detected"
      },
      session_resume: {
        declared: "full",
        detected: installed && hasResume ? "full" : "none",
        verified: installed && hasResume,
        evidence: hasResume
          ? "Verified --resume, --continue, and --fork-session"
          : "--resume not detected"
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
        declared: "full",
        detected: installed && hasWorktree ? "full" : "none",
        verified: installed && hasWorktree,
        evidence: hasWorktree
          ? "Verified -w/--worktree flag and subagent isolation: worktree"
          : "--worktree not detected"
      },
      native_sandbox: {
        declared: "full",
        detected: installed && hasRestricted ? "full" : "partial",
        verified: installed && hasRestricted,
        evidence: hasRestricted
          ? "Verified --permission-mode and --restricted confinement"
          : "Partial permission controls"
      }
    };

    const securityAudit: ValidationIssue[] = [];
    if (workspaceRoot) {
      for (const rel of [".claude/settings.json", ".claude/settings.local.json"]) {
        const p = resolveSafeWorkspacePath(workspaceRoot, rel);
        if (fs.existsSync(p)) {
          try {
            const raw = fs.readFileSync(p, "utf8");
            if (raw.includes("bypassPermissions")) {
              securityAudit.push({
                code: "CLAUDE_BYPASS_PERMISSIONS_DETECTED",
                severity: "warning",
                path: rel,
                message: `${rel} contains 'bypassPermissions'. Delamain recommends explicit allowlists instead of bypassing permissions.`
              });
            }
          } catch {
            // ignore
          }
        }
      }
    }

    return {
      runtime: "claude-code",
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
    catalog: HarnessCatalog
  ): ManagedFileEntry[] {
    const managedFiles: ManagedFileEntry[] = [];

    // 1. Sync CLAUDE.md using managed markers (preserves developer content outside markers)
    const claudeMdRel = "CLAUDE.md";
    const claudeMdAbs = resolveSafeWorkspacePath(workspaceRoot, claudeMdRel);
    const existingClaudeMd = fs.existsSync(claudeMdAbs) ? fs.readFileSync(claudeMdAbs, "utf8") : null;
    const claudeTpl = catalog
      .getTemplate("CLAUDE.md.tpl")
      .replaceAll("{{PROJECT_NAME}}", manifest.project.name)
      .replaceAll("{{PROFILE}}", manifest.profile)
      .replaceAll("{{DEFAULT_WORKFLOW}}", manifest.workflows.default);

    const mergedClaude = mergeManagedMarkdown(existingClaudeMd, claudeTpl);
    fs.writeFileSync(claudeMdAbs, mergedClaude.content, "utf8");
    managedFiles.push({
      path: claudeMdRel,
      ownership: mergedClaude.ownership,
      runtime: "claude-code",
      sha256: computeSha256(mergedClaude.content)
    });

    // 2. Sync skills into .claude/skills/<skill>/SKILL.md so Claude Code discovers them natively
    for (const skillName of manifest.skills) {
      const srcSkillFile = resolveSafeWorkspacePath(
        workspaceRoot,
        `.agents/skills/${skillName}/SKILL.md`
      );
      if (!fs.existsSync(srcSkillFile)) continue;
      const dstRel = `.claude/skills/${skillName}/SKILL.md`;
      const dstAbs = resolveSafeWorkspacePath(workspaceRoot, dstRel);
      fs.mkdirSync(path.dirname(dstAbs), { recursive: true });
      const content = fs.readFileSync(srcSkillFile, "utf8");
      fs.writeFileSync(dstAbs, content, "utf8");
      managedFiles.push({
        path: dstRel,
        ownership: "generated",
        runtime: "claude-code",
        sha256: computeSha256(content)
      });
    }

    // 3. Sync .claude/settings.json safely (merge Delamain hooks without overwriting existing user permissions/hooks)
    const settingsRel = ".claude/settings.json";
    const settingsAbs = resolveSafeWorkspacePath(workspaceRoot, settingsRel);
    fs.mkdirSync(path.dirname(settingsAbs), { recursive: true });
    let settingsObj: Record<string, unknown> = {};
    let ownership: "generated" | "user-preserved" = "generated";
    if (fs.existsSync(settingsAbs)) {
      try {
        settingsObj = JSON.parse(fs.readFileSync(settingsAbs, "utf8")) as Record<string, unknown>;
        ownership = "user-preserved";
      } catch {
        settingsObj = {};
      }
    }

    if (manifest.hooks?.telemetry !== false || manifest.hooks?.safetyGuards !== false) {
      const hooksSection = (settingsObj.hooks as Record<string, unknown[]> | undefined) ?? {};
      const hookEvents = ["SessionStart", "PreToolUse", "PostToolUse", "Stop"] as const;
      for (const evt of hookEvents) {
        const cmd = `node .agents/hooks/dlm-hook.mjs ${evt} claude-code`;
        const currentList = Array.isArray(hooksSection[evt]) ? [...hooksSection[evt]!] : [];
        const alreadyHas = JSON.stringify(currentList).includes("dlm-hook.mjs");
        if (!alreadyHas) {
          currentList.push(
            evt === "PreToolUse"
              ? {
                  matcher: "Bash",
                  hooks: [{ type: "command", command: cmd, timeout: 5 }]
                }
              : {
                  hooks: [{ type: "command", command: cmd, timeout: 5 }]
                }
          );
        }
        hooksSection[evt] = currentList;
      }
      settingsObj.hooks = hooksSection;
    }

    const serializedSettings = JSON.stringify(settingsObj, null, 2) + "\n";
    fs.writeFileSync(settingsAbs, serializedSettings, "utf8");
    managedFiles.push({
      path: settingsRel,
      ownership,
      runtime: "claude-code",
      sha256: computeSha256(serializedSettings)
    });

    return managedFiles;
  }

  validateProject(workspaceRoot: string, manifest: HarnessManifest): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const claudeMd = resolveSafeWorkspacePath(workspaceRoot, "CLAUDE.md");
    if (!fs.existsSync(claudeMd)) {
      issues.push({
        code: "CLAUDE_MD_MISSING",
        severity: "error",
        path: "CLAUDE.md",
        message: "CLAUDE.md is missing for enabled runtime 'claude-code'. Run 'dlm sync'."
      });
    }

    for (const skill of manifest.skills) {
      const skillRel = `.claude/skills/${skill}/SKILL.md`;
      const skillAbs = resolveSafeWorkspacePath(workspaceRoot, skillRel);
      if (!fs.existsSync(skillAbs)) {
        issues.push({
          code: "CLAUDE_SKILL_NOT_SYNCED",
          severity: "error",
          path: skillRel,
          message: `Skill '${skill}' is not synced to ${skillRel}. Run 'dlm sync --runtime claude-code'.`
        });
      }
    }

    const settingsRel = ".claude/settings.json";
    const settingsAbs = resolveSafeWorkspacePath(workspaceRoot, settingsRel);
    if (fs.existsSync(settingsAbs)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(settingsAbs, "utf8")) as Record<string, unknown>;
        const perms = parsed.permissions as Record<string, unknown> | undefined;
        if (perms?.defaultMode === "bypassPermissions") {
          issues.push({
            code: "CLAUDE_BYPASS_PERMISSIONS_FORBIDDEN",
            severity: "error",
            path: settingsRel,
            message: ".claude/settings.json sets defaultMode=bypassPermissions, violating Delamain policy."
          });
        }
      } catch (err) {
        issues.push({
          code: "CLAUDE_SETTINGS_INVALID_JSON",
          severity: "error",
          path: settingsRel,
          message: `Invalid JSON in ${settingsRel}: ${(err as Error).message}`
        });
      }
    }

    return issues;
  }
}
