import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { RuntimeAdapterRegistry } from "../adapters/registry.js";
import { WorkflowEngine } from "../workflow/engine.js";
import type { WorkflowDefinition } from "../workflow/types.js";
import { HarnessCatalog } from "./catalog.js";
import {
  createManifestFromProfile,
  LOCKFILE_RELATIVE_PATH,
  MANIFEST_RELATIVE_PATH,
  readLockfile,
  readManifest,
  validateManifestPoliciesAndDependencies,
  writeLockfile,
  writeManifest
} from "./manifest.js";
import {
  BackupManager,
  computeFileSha256,
  computeSha256,
  redactSecrets,
  resolveSafeWorkspacePath,
  validateSafeCommand
} from "./security.js";
import type {
  HarnessLockfile,
  HarnessManifest,
  LockedSkillEntry,
  LockedWorkflowEntry,
  ManagedFileEntry,
  ProfileId,
  RuntimeId,
  ValidationIssue,
  ValidationReport,
  ValidatorExecutionResult
} from "./types.js";

export interface InitOptions {
  workspaceRoot: string;
  profile?: ProfileId;
  projectName?: string;
  runtimes?: RuntimeId[];
  force?: boolean;
}

export interface InitResult {
  manifestPath: string;
  lockfilePath: string;
  manifest: HarnessManifest;
  lockfile: HarnessLockfile;
  createdManifest: boolean;
}

export interface SyncOptions {
  workspaceRoot: string;
  runtime?: RuntimeId;
}

export interface SyncResult {
  lockfile: HarnessLockfile;
  syncedSkills: string[];
  syncedWorkflows: string[];
  syncedRuntimes: RuntimeId[];
  changedFiles: string[];
}

export class HarnessInstaller {
  public readonly catalog: HarnessCatalog;
  public readonly adapters: RuntimeAdapterRegistry;
  private readonly workflowEngine = new WorkflowEngine();

  constructor(catalog?: HarnessCatalog, adapters?: RuntimeAdapterRegistry) {
    this.catalog = catalog ?? new HarnessCatalog();
    this.adapters = adapters ?? new RuntimeAdapterRegistry();
  }

  init(options: InitOptions): InitResult {
    const workspaceRoot = path.resolve(options.workspaceRoot);
    const profileId: ProfileId = options.profile ?? this.detectDefaultProfile(workspaceRoot);
    const manifestAbs = resolveSafeWorkspacePath(workspaceRoot, MANIFEST_RELATIVE_PATH);

    let manifest: HarnessManifest;
    let createdManifest = false;

    if (fs.existsSync(manifestAbs) && !options.force) {
      // Idempotent init: read existing manifest without overwriting user configuration
      manifest = readManifest(workspaceRoot);
    } else {
      if (fs.existsSync(manifestAbs) && options.force) {
        const backup = new BackupManager(workspaceRoot);
        backup.createBackup([MANIFEST_RELATIVE_PATH, LOCKFILE_RELATIVE_PATH], "dlm init --force");
      }
      manifest = createManifestFromProfile(
        this.catalog,
        workspaceRoot,
        profileId,
        options.projectName
      );
      if (options.runtimes && options.runtimes.length > 0) {
        manifest.runtimes = [...options.runtimes];
      }
      writeManifest(workspaceRoot, manifest);
      createdManifest = true;
    }

    // Ensure local state directory structure (.ai-harness-state) and .gitignore entry
    this.ensureLocalStateDirs(workspaceRoot);
    this.ensureGitignoreHasLocalState(workspaceRoot);

    const syncRes = this.sync({ workspaceRoot });
    return {
      manifestPath: manifestAbs,
      lockfilePath: resolveSafeWorkspacePath(workspaceRoot, LOCKFILE_RELATIVE_PATH),
      manifest,
      lockfile: syncRes.lockfile,
      createdManifest
    };
  }

  sync(options: SyncOptions): SyncResult {
    const workspaceRoot = path.resolve(options.workspaceRoot);
    const manifest = readManifest(workspaceRoot);
    const existingLock = readLockfile(workspaceRoot);

    const lockedSkills: Record<string, LockedSkillEntry> = { ...(existingLock?.skills ?? {}) };
    const lockedWorkflows: Record<string, LockedWorkflowEntry> = { ...(existingLock?.workflows ?? {}) };
    const managedFiles: Record<string, ManagedFileEntry> = { ...(existingLock?.managedFiles ?? {}) };
    const changedFiles: string[] = [];

    // 1. Sync shared skills into .agents/skills/<name>/SKILL.md
    const syncedSkills: string[] = [];
    for (const skillName of manifest.skills) {
      const targetRel = `.agents/skills/${skillName}/SKILL.md`;
      const targetAbs = resolveSafeWorkspacePath(workspaceRoot, targetRel);
      try {
        const catalogSkill = this.catalog.getSkill(skillName);
        fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
        const srcContent = fs.readFileSync(catalogSkill.skillFilePath, "utf8");
        const prevSha = fs.existsSync(targetAbs) ? computeFileSha256(targetAbs) : null;
        if (prevSha !== catalogSkill.sha256) {
          fs.writeFileSync(targetAbs, srcContent, "utf8");
          changedFiles.push(targetRel);
        }
        lockedSkills[skillName] = {
          name: skillName,
          version: catalogSkill.version,
          sourcePath: `catalog:skills/${skillName}/SKILL.md`,
          installedPath: targetRel,
          sha256: catalogSkill.sha256
        };
        managedFiles[targetRel] = {
          path: targetRel,
          ownership: "generated",
          sha256: catalogSkill.sha256
        };
        syncedSkills.push(skillName);
      } catch {
        // Skill may be project-local in .agents/skills/<name>/SKILL.md
        if (fs.existsSync(targetAbs)) {
          const localSha = computeFileSha256(targetAbs);
          lockedSkills[skillName] = {
            name: skillName,
            version: "local",
            sourcePath: targetRel,
            installedPath: targetRel,
            sha256: localSha
          };
          managedFiles[targetRel] = {
            path: targetRel,
            ownership: "user-preserved",
            sha256: localSha
          };
          syncedSkills.push(skillName);
        }
      }
    }

    // 2. Sync enabled workflows into .agents/workflows/<id>.yaml (preserving user modifications if already edited)
    const syncedWorkflows: string[] = [];
    for (const wfId of manifest.workflows.enabled) {
      const targetRel = `.agents/workflows/${wfId}.yaml`;
      const targetAbs = resolveSafeWorkspacePath(workspaceRoot, targetRel);
      fs.mkdirSync(path.dirname(targetAbs), { recursive: true });

      if (!fs.existsSync(targetAbs)) {
        const catWf = this.catalog.getWorkflow(wfId);
        const content = fs.readFileSync(catWf.filePath, "utf8");
        fs.writeFileSync(targetAbs, content, "utf8");
        changedFiles.push(targetRel);
        lockedWorkflows[wfId] = {
          id: wfId,
          version: catWf.definition.version,
          installedPath: targetRel,
          sha256: catWf.sha256
        };
        managedFiles[targetRel] = {
          path: targetRel,
          ownership: "generated",
          sha256: catWf.sha256
        };
      } else {
        const currentSha = computeFileSha256(targetAbs);
        const parsed = YAML.parse(fs.readFileSync(targetAbs, "utf8")) as WorkflowDefinition;
        lockedWorkflows[wfId] = {
          id: wfId,
          version: parsed.version ?? "1.0.0",
          installedPath: targetRel,
          sha256: currentSha
        };
        managedFiles[targetRel] = {
          path: targetRel,
          ownership: managedFiles[targetRel]?.ownership ?? "user-preserved",
          sha256: currentSha
        };
      }
      syncedWorkflows.push(wfId);
    }

    // 3. Sync shared rules (.agents/rules/) and hook script (.agents/hooks/dlm-hook.mjs)
    const rulesToSync = ["harness-core.md"];
    if (manifest.profile === "dotnet") rulesToSync.push("dotnet-conventions.md");
    if (manifest.profile === "node" || manifest.profile === "typescript") {
      rulesToSync.push("typescript-conventions.md");
    }

    for (const ruleFile of rulesToSync) {
      const ruleRel = `.agents/rules/${ruleFile}`;
      const ruleAbs = resolveSafeWorkspacePath(workspaceRoot, ruleRel);
      fs.mkdirSync(path.dirname(ruleAbs), { recursive: true });
      const tplContent = this.catalog.getTemplate(`rules/${ruleFile}`);
      const tplSha = computeSha256(tplContent);
      const existingSha = fs.existsSync(ruleAbs) ? computeFileSha256(ruleAbs) : null;
      if (existingSha !== tplSha) {
        fs.writeFileSync(ruleAbs, tplContent, "utf8");
        changedFiles.push(ruleRel);
      }
      managedFiles[ruleRel] = {
        path: ruleRel,
        ownership: "generated",
        sha256: tplSha
      };
    }

    const hookScriptRel = ".agents/hooks/dlm-hook.mjs";
    const hookScriptAbs = resolveSafeWorkspacePath(workspaceRoot, hookScriptRel);
    fs.mkdirSync(path.dirname(hookScriptAbs), { recursive: true });
    const srcHookContent = fs.readFileSync(this.catalog.getSharedHookScriptPath(), "utf8");
    const srcHookSha = computeSha256(srcHookContent);
    const curHookSha = fs.existsSync(hookScriptAbs) ? computeFileSha256(hookScriptAbs) : null;
    if (curHookSha !== srcHookSha) {
      fs.writeFileSync(hookScriptAbs, srcHookContent, "utf8");
      fs.chmodSync(hookScriptAbs, 0o755);
      changedFiles.push(hookScriptRel);
    }
    managedFiles[hookScriptRel] = {
      path: hookScriptRel,
      ownership: "generated",
      sha256: srcHookSha
    };

    // 4. Sync runtime adapters (either all in manifest.runtimes or the single requested --runtime)
    const targetRuntimes: RuntimeId[] = options.runtime
      ? [options.runtime]
      : manifest.runtimes;

    for (const rt of targetRuntimes) {
      const adapter = this.adapters.get(rt);
      const beforeHashes = new Map<string, string | null>();
      for (const rel of ["AGENTS.md", "CLAUDE.md", ".claude/settings.json", ".codex/hooks.json", ".codex/config.toml", ".agents/hooks.json"]) {
        const p = resolveSafeWorkspacePath(workspaceRoot, rel);
        beforeHashes.set(rel, fs.existsSync(p) ? computeFileSha256(p) : null);
      }
      const rtManaged = adapter.syncProject(workspaceRoot, manifest, this.catalog);
      for (const entry of rtManaged) {
        const prev = beforeHashes.get(entry.path);
        if (prev !== undefined && prev !== entry.sha256) {
          changedFiles.push(entry.path);
        }
        const prevOwnership = existingLock?.managedFiles[entry.path]?.ownership;
        managedFiles[entry.path] = {
          ...entry,
          ownership: prevOwnership ?? entry.ownership
        };
      }
    }

    // 5. Write deterministic lockfile (preserving generatedAt if nothing changed for strict idempotency!)
    const nextLockWithoutTime = {
      lockfileVersion: 1 as const,
      harnessVersion: this.catalog.getHarnessVersion(),
      profile: manifest.profile,
      skills: lockedSkills,
      workflows: lockedWorkflows,
      managedFiles
    };

    const prevComparable = existingLock
      ? JSON.stringify({
          lockfileVersion: existingLock.lockfileVersion,
          harnessVersion: existingLock.harnessVersion,
          profile: existingLock.profile,
          skills: existingLock.skills,
          workflows: existingLock.workflows,
          managedFiles: existingLock.managedFiles
        })
      : null;
    const nextComparable = JSON.stringify(nextLockWithoutTime);

    const lockfile: HarnessLockfile = {
      ...nextLockWithoutTime,
      generatedAt:
        prevComparable === nextComparable && existingLock
          ? existingLock.generatedAt
          : new Date().toISOString()
    };

    if (prevComparable !== nextComparable || !existingLock) {
      writeLockfile(workspaceRoot, lockfile);
      changedFiles.push(LOCKFILE_RELATIVE_PATH);
    }

    return {
      lockfile,
      syncedSkills,
      syncedWorkflows,
      syncedRuntimes: targetRuntimes,
      changedFiles
    };
  }

  validate(workspaceRoot: string, runValidators = false): ValidationReport {
    const absRoot = path.resolve(workspaceRoot);
    const issues: ValidationIssue[] = [];

    let manifest: HarnessManifest | null = null;
    try {
      manifest = readManifest(absRoot);
    } catch (err) {
      issues.push({
        code: "MANIFEST_INVALID_OR_MISSING",
        severity: "error",
        path: MANIFEST_RELATIVE_PATH,
        message: (err as Error).message
      });
    }

    let lockfile: HarnessLockfile | null = null;
    try {
      lockfile = readLockfile(absRoot);
      if (!lockfile) {
        issues.push({
          code: "LOCKFILE_MISSING",
          severity: "error",
          path: LOCKFILE_RELATIVE_PATH,
          message: `Lockfile not found at ${LOCKFILE_RELATIVE_PATH}. Run 'dlm sync'.`
        });
      }
    } catch (err) {
      issues.push({
        code: "LOCKFILE_INVALID",
        severity: "error",
        path: LOCKFILE_RELATIVE_PATH,
        message: (err as Error).message
      });
    }

    if (manifest) {
      issues.push(...validateManifestPoliciesAndDependencies(manifest, this.catalog));

      // Validate workflows
      for (const wfId of manifest.workflows.enabled) {
        const wfRel = `.agents/workflows/${wfId}.yaml`;
        const wfAbs = resolveSafeWorkspacePath(absRoot, wfRel);
        if (!fs.existsSync(wfAbs)) {
          issues.push({
            code: "WORKFLOW_FILE_MISSING",
            severity: "error",
            path: wfRel,
            message: `Enabled workflow '${wfId}' is missing at ${wfRel}`
          });
        } else {
          try {
            const wfDef = YAML.parse(fs.readFileSync(wfAbs, "utf8")) as WorkflowDefinition;
            const plan = this.workflowEngine.validateAndPlan(wfDef);
            for (const wfIssue of plan.issues) {
              issues.push({
                ...wfIssue,
                path: `${wfRel}:${wfIssue.path ?? ""}`
              });
            }
          } catch (err) {
            issues.push({
              code: "WORKFLOW_PARSE_ERROR",
              severity: "error",
              path: wfRel,
              message: `Failed to parse workflow '${wfId}': ${(err as Error).message}`
            });
          }
        }
      }

      // Validate runtime adapters
      for (const rt of manifest.runtimes) {
        const adapter = this.adapters.get(rt);
        issues.push(...adapter.validateProject(absRoot, manifest));
      }
    }

    // Verify lockfile checksums for generated files
    if (lockfile) {
      for (const [relPath, entry] of Object.entries(lockfile.managedFiles)) {
        const absPath = resolveSafeWorkspacePath(absRoot, relPath);
        if (!fs.existsSync(absPath)) {
          issues.push({
            code: "MANAGED_FILE_MISSING",
            severity: "error",
            path: relPath,
            message: `Managed file '${relPath}' tracked in lockfile is missing on disk.`
          });
        } else if (entry.ownership === "generated") {
          const actualSha = computeFileSha256(absPath);
          if (actualSha !== entry.sha256) {
            issues.push({
              code: "MANAGED_FILE_CHECKSUM_DRIFT",
              severity: "warning",
              path: relPath,
              message: `Generated file '${relPath}' has drifted from lockfile checksum. Run 'dlm sync' to reconcile.`
            });
          }
        }
      }
    }

    let validatorResults: ValidatorExecutionResult[] | undefined;
    if (runValidators && manifest) {
      validatorResults = this.executeValidators(absRoot, manifest);
      for (const res of validatorResults) {
        if (res.status === "failed") {
          issues.push({
            code: "VALIDATOR_EXECUTION_FAILED",
            severity: "error",
            path: `validators[${res.validatorId}]`,
            message: `Validator '${res.name}' (${res.validatorId}) failed with exit code ${res.exitCode}: ${res.summary}`
          });
        }
      }
    }

    return {
      valid: !issues.some((i) => i.severity === "error"),
      checkedAt: new Date().toISOString(),
      workspaceRoot: absRoot,
      issues,
      validatorResults
    };
  }

  executeValidators(
    workspaceRoot: string,
    manifest: HarnessManifest,
    filterIds?: string[]
  ): ValidatorExecutionResult[] {
    const results: ValidatorExecutionResult[] = [];
    const validators = manifest.validators ?? [];
    const allowAll = !filterIds || filterIds.length === 0 || filterIds.includes("*");

    for (const val of validators) {
      if (val.enabled === false) continue;
      if (!allowAll && !filterIds!.includes(val.id)) continue;

      const safety = validateSafeCommand(
        val.command,
        val.args ?? [],
        manifest.policies.allowDestructiveCommands
      );
      const startTime = Date.now();
      const executedAt = new Date().toISOString();

      if (!safety.safe) {
        results.push({
          validatorId: val.id,
          name: val.name,
          kind: val.kind,
          command: [val.command, ...(val.args ?? [])].join(" "),
          status: "failed",
          exitCode: null,
          durationMs: 0,
          executedAt,
          summary: safety.reason ?? "Blocked by command safety policy"
        });
        continue;
      }

      const proc = spawnSync(val.command, val.args ?? [], {
        cwd: workspaceRoot,
        encoding: "utf8",
        timeout: val.timeoutMs ?? 120000
      });
      const durationMs = Date.now() - startTime;
      const stdout = redactSecrets((proc.stdout ?? "").trim());
      const stderr = redactSecrets((proc.stderr ?? "").trim());

      if (proc.error && (proc.error as NodeJS.ErrnoException).code === "ENOENT") {
        results.push({
          validatorId: val.id,
          name: val.name,
          kind: val.kind,
          command: [val.command, ...(val.args ?? [])].join(" "),
          status: val.required ? "failed" : "unavailable",
          exitCode: null,
          durationMs,
          executedAt,
          summary: `Command '${val.command}' not found on host`,
          stdout,
          stderr
        });
        continue;
      }

      const passed = proc.status === 0;
      const tailLine =
        (passed ? stdout : stderr || stdout)
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(-2)
          .join(" | ") || (passed ? "OK" : `Failed (exit ${proc.status})`);

      results.push({
        validatorId: val.id,
        name: val.name,
        kind: val.kind,
        command: [val.command, ...(val.args ?? [])].join(" "),
        status: passed ? "passed" : "failed",
        exitCode: proc.status,
        durationMs,
        executedAt,
        summary: tailLine.slice(0, 240),
        stdout,
        stderr
      });
    }

    return results;
  }

  upgrade(workspaceRoot: string, options?: { rollback?: string; dryRun?: boolean }): {
    action: "upgraded" | "rolled-back" | "dry-run";
    backupId?: string;
    harnessVersion: string;
    changedFiles: string[];
  } {
    const absRoot = path.resolve(workspaceRoot);
    const backupMgr = new BackupManager(absRoot);

    if (options?.rollback !== undefined) {
      const meta = backupMgr.rollback(options.rollback || undefined);
      return {
        action: "rolled-back",
        backupId: meta.backupId,
        harnessVersion: this.catalog.getHarnessVersion(),
        changedFiles: meta.files.map((f) => f.relativePath)
      };
    }

    const manifest = readManifest(absRoot);
    const existingLock = readLockfile(absRoot);
    const filesToBackup = [
      MANIFEST_RELATIVE_PATH,
      LOCKFILE_RELATIVE_PATH,
      ...Object.keys(existingLock?.managedFiles ?? {})
    ];

    if (options?.dryRun) {
      return {
        action: "dry-run",
        harnessVersion: this.catalog.getHarnessVersion(),
        changedFiles: filesToBackup
      };
    }

    const backupMeta = backupMgr.createBackup(filesToBackup, "dlm upgrade");
    try {
      manifest.harnessSource = {
        ...manifest.harnessSource,
        version: this.catalog.getHarnessVersion()
      };
      writeManifest(absRoot, manifest);
      const syncRes = this.sync({ workspaceRoot: absRoot });
      return {
        action: "upgraded",
        backupId: backupMeta.backupId,
        harnessVersion: this.catalog.getHarnessVersion(),
        changedFiles: syncRes.changedFiles
      };
    } catch (err) {
      // Automatic rollback on upgrade failure!
      backupMgr.rollback(backupMeta.backupId);
      throw new Error(
        `Upgrade failed and was automatically rolled back to ${backupMeta.backupId}: ${(err as Error).message}`
      );
    }
  }

  private detectDefaultProfile(workspaceRoot: string): ProfileId {
    const files = fs.existsSync(workspaceRoot) ? fs.readdirSync(workspaceRoot) : [];
    if (files.some((f) => f.endsWith(".sln") || f.endsWith(".csproj"))) {
      return "dotnet";
    }
    if (files.includes("tsconfig.json")) {
      return "typescript";
    }
    if (files.includes("package.json")) {
      return "node";
    }
    return "node";
  }

  private ensureLocalStateDirs(workspaceRoot: string): void {
    for (const sub of ["handoffs", "sessions", "telemetry", "backups"]) {
      const dir = resolveSafeWorkspacePath(workspaceRoot, `.ai-harness-state/${sub}`);
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private ensureGitignoreHasLocalState(workspaceRoot: string): void {
    const gitignorePath = resolveSafeWorkspacePath(workspaceRoot, ".gitignore");
    const entry = ".ai-harness-state/";
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, `${entry}\n`, "utf8");
      return;
    }
    const content = fs.readFileSync(gitignorePath, "utf8");
    if (!content.includes(".ai-harness-state")) {
      const prefix = content.endsWith("\n") ? content : `${content}\n`;
      fs.writeFileSync(gitignorePath, `${prefix}${entry}\n`, "utf8");
    }
  }
}
