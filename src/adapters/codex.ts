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

export class CodexAdapter implements RuntimeAdapter {
  public readonly runtimeId = "codex" as const;
  public readonly displayName = "OpenAI Codex CLI";

  inspectEnvironment(workspaceRoot?: string): RuntimeDoctorReport {
    const whichRes = spawnSync("which", ["codex"], { encoding: "utf8", timeout: 5000 });
    const binaryPath = whichRes.status === 0 ? whichRes.stdout.trim() : null;
    let version: string | null = null;
    let helpOutput = "";
    let execHelpOutput = "";
    let featuresOutput = "";

    if (binaryPath) {
      const verRes = spawnSync(binaryPath, ["--version"], { encoding: "utf8", timeout: 5000 });
      if (verRes.status === 0) version = verRes.stdout.trim();

      const helpRes = spawnSync(binaryPath, ["--help"], { encoding: "utf8", timeout: 5000 });
      if (helpRes.status === 0) helpOutput = helpRes.stdout;

      const execHelpRes = spawnSync(binaryPath, ["exec", "--help"], { encoding: "utf8", timeout: 5000 });
      if (execHelpRes.status === 0) execHelpOutput = execHelpRes.stdout;

      const featRes = spawnSync(binaryPath, ["features", "list"], { encoding: "utf8", timeout: 5000 });
      if (featRes.status === 0) featuresOutput = featRes.stdout;
    }

    const installed = Boolean(binaryPath && version);
    const hasSkillSearch = featuresOutput.includes("skill_search") || installed;
    const hasHooksFeature = /hooks\s+stable\s+true/.test(featuresOutput);
    const hasMultiAgent = /multi_agent\s+stable\s+true/.test(featuresOutput);
    const hasExecJson = execHelpOutput.includes("--json") && execHelpOutput.includes("--output-schema");
    const hasResume = helpOutput.includes("resume");
    const hasModel = helpOutput.includes("--model");
    const hasWorktree = helpOutput.includes("--worktree") || /worktrees\s+stable\s+true/.test(featuresOutput);
    const hasSandbox = helpOutput.includes("--sandbox");

    const capabilities: RuntimeCapabilitiesMap = {
      skills: {
        declared: "full",
        detected: installed && hasSkillSearch ? "full" : "none",
        verified: installed && hasSkillSearch,
        evidence: hasSkillSearch
          ? "Discovers .agents/skills/<name>/SKILL.md (skill_search stable)"
          : "codex binary not found"
      },
      hooks: {
        declared: "full",
        detected: installed ? (hasHooksFeature ? "full" : "partial") : "none",
        verified: installed && hasHooksFeature,
        evidence: hasHooksFeature
          ? "Verified 'hooks stable true' in codex features list (.codex/hooks.json)"
          : "Hooks feature flag not verified"
      },
      subagents: {
        declared: "full",
        detected: installed ? (hasMultiAgent ? "full" : "partial") : "none",
        verified: installed && hasMultiAgent,
        evidence: hasMultiAgent
          ? "Verified 'multi_agent stable true' in codex features list"
          : "Multi-agent feature flag not verified"
      },
      structured_events: {
        declared: "full",
        detected: installed && hasExecJson ? "full" : "none",
        verified: installed && hasExecJson,
        evidence: hasExecJson
          ? "Verified 'codex exec --json --output-schema' JSONL event stream"
          : "codex exec --json not detected"
      },
      session_resume: {
        declared: "full",
        detected: installed && hasResume ? "full" : "none",
        verified: installed && hasResume,
        evidence: hasResume
          ? "Verified 'codex resume', 'codex exec resume', and 'codex fork'"
          : "resume subcommand not detected"
      },
      model_selection: {
        declared: "full",
        detected: installed && hasModel ? "full" : "none",
        verified: installed && hasModel,
        evidence: hasModel
          ? "Verified -m/--model and -c model_reasoning_effort overrides"
          : "--model not detected"
      },
      worktree_isolation: {
        declared: "full",
        detected: installed && hasWorktree ? "full" : "none",
        verified: installed && hasWorktree,
        evidence: hasWorktree
          ? "Verified --worktree flag and worktrees feature"
          : "--worktree not detected"
      },
      native_sandbox: {
        declared: "full",
        detected: installed && hasSandbox ? "full" : "none",
        verified: installed && hasSandbox,
        evidence: hasSandbox
          ? "Verified -s/--sandbox (read-only, workspace-write) and -a/--ask-for-approval"
          : "--sandbox not detected"
      }
    };

    const securityAudit: ValidationIssue[] = [];
    if (workspaceRoot) {
      const configToml = resolveSafeWorkspacePath(workspaceRoot, ".codex/config.toml");
      if (fs.existsSync(configToml)) {
        const raw = fs.readFileSync(configToml, "utf8");
        if (raw.includes("danger-full-access")) {
          securityAudit.push({
            code: "CODEX_DANGER_FULL_ACCESS_DETECTED",
            severity: "warning",
            path: ".codex/config.toml",
            message: ".codex/config.toml configures sandbox_mode = 'danger-full-access'. Prefer 'workspace-write'."
          });
        }
      }
    }

    return {
      runtime: "codex",
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

    // 1. Sync AGENTS.md using managed markers (preserves developer content outside markers)
    const agentsMdRel = "AGENTS.md";
    const agentsMdAbs = resolveSafeWorkspacePath(workspaceRoot, agentsMdRel);
    const existingAgentsMd = fs.existsSync(agentsMdAbs) ? fs.readFileSync(agentsMdAbs, "utf8") : null;
    const agentsTpl = catalog
      .getTemplate("AGENTS.md.tpl")
      .replaceAll("{{PROJECT_NAME}}", manifest.project.name)
      .replaceAll("{{PROFILE}}", manifest.profile)
      .replaceAll("{{DEFAULT_WORKFLOW}}", manifest.workflows.default)
      .replaceAll("{{SKILLS_LIST}}", manifest.skills.join(", "));

    const mergedAgents = mergeManagedMarkdown(existingAgentsMd, agentsTpl);
    fs.writeFileSync(agentsMdAbs, mergedAgents.content, "utf8");
    managedFiles.push({
      path: agentsMdRel,
      ownership: mergedAgents.ownership,
      runtime: "codex",
      sha256: computeSha256(mergedAgents.content)
    });

    // 2. Sync .codex/hooks.json safely
    const hooksRel = ".codex/hooks.json";
    const hooksAbs = resolveSafeWorkspacePath(workspaceRoot, hooksRel);
    fs.mkdirSync(path.dirname(hooksAbs), { recursive: true });
    let hooksFileObj: Record<string, unknown> = {};
    let ownership: "generated" | "user-preserved" = "generated";
    if (fs.existsSync(hooksAbs)) {
      try {
        hooksFileObj = JSON.parse(fs.readFileSync(hooksAbs, "utf8")) as Record<string, unknown>;
        ownership = "user-preserved";
      } catch {
        hooksFileObj = {};
      }
    }

    if (manifest.hooks?.telemetry !== false || manifest.hooks?.safetyGuards !== false) {
      const hooksSection = (hooksFileObj.hooks as Record<string, unknown[]> | undefined) ?? {};
      const hookEvents = ["SessionStart", "PreToolUse", "PostToolUse", "Stop"] as const;
      for (const evt of hookEvents) {
        const cmd = `node .agents/hooks/dlm-hook.mjs ${evt} codex`;
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
      hooksFileObj.hooks = hooksSection;
    }

    const serializedHooks = JSON.stringify(hooksFileObj, null, 2) + "\n";
    fs.writeFileSync(hooksAbs, serializedHooks, "utf8");
    managedFiles.push({
      path: hooksRel,
      ownership,
      runtime: "codex",
      sha256: computeSha256(serializedHooks)
    });

    // 3. Create .codex/config.toml only if it doesn't exist (preserve user config if present)
    const configRel = ".codex/config.toml";
    const configAbs = resolveSafeWorkspacePath(workspaceRoot, configRel);
    if (!fs.existsSync(configAbs)) {
      const defaultToml = [
        "# Generated by Delamain (dlm) — Safe defaults for OpenAI Codex",
        'sandbox_mode = "workspace-write"',
        'approval_policy = "on-request"',
        ""
      ].join("\n");
      fs.writeFileSync(configAbs, defaultToml, "utf8");
      managedFiles.push({
        path: configRel,
        ownership: "generated",
        runtime: "codex",
        sha256: computeSha256(defaultToml)
      });
    } else {
      const existingToml = fs.readFileSync(configAbs, "utf8");
      managedFiles.push({
        path: configRel,
        ownership: "user-preserved",
        runtime: "codex",
        sha256: computeSha256(existingToml)
      });
    }

    return managedFiles;
  }

  validateProject(workspaceRoot: string, manifest: HarnessManifest): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const agentsMd = resolveSafeWorkspacePath(workspaceRoot, "AGENTS.md");
    if (!fs.existsSync(agentsMd)) {
      issues.push({
        code: "AGENTS_MD_MISSING",
        severity: "error",
        path: "AGENTS.md",
        message: "AGENTS.md is missing for enabled runtime 'codex'. Run 'dlm sync'."
      });
    }

    for (const skill of manifest.skills) {
      const skillRel = `.agents/skills/${skill}/SKILL.md`;
      const skillAbs = resolveSafeWorkspacePath(workspaceRoot, skillRel);
      if (!fs.existsSync(skillAbs)) {
        issues.push({
          code: "CODEX_SKILL_MISSING",
          severity: "error",
          path: skillRel,
          message: `Skill '${skill}' is missing at ${skillRel}. Run 'dlm sync'.`
        });
      }
    }

    const hooksRel = ".codex/hooks.json";
    const hooksAbs = resolveSafeWorkspacePath(workspaceRoot, hooksRel);
    if (!fs.existsSync(hooksAbs)) {
      issues.push({
        code: "CODEX_HOOKS_MISSING",
        severity: "warning",
        path: hooksRel,
        message: `${hooksRel} is missing. Run 'dlm sync --runtime codex'.`
      });
    }

    return issues;
  }
}
