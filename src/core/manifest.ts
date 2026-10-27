import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { validateLockfileSchema, validateManifestSchema } from "./schemas.js";
import { resolveSafeWorkspacePath, validateSafeCommand } from "./security.js";
import type { HarnessCatalog } from "./catalog.js";
import type {
  HarnessLockfile,
  HarnessManifest,
  ProfileId,
  ValidationIssue
} from "./types.js";

export const MANIFEST_RELATIVE_PATH = ".agents/harness.yaml";
export const LOCKFILE_RELATIVE_PATH = ".agents/harness.lock";

export function sanitizeProjectId(rawName: string): string {
  const cleaned = rawName
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (cleaned.length < 2) {
    return "project-app";
  }
  return cleaned.slice(0, 62);
}

export function createManifestFromProfile(
  catalog: HarnessCatalog,
  workspaceRoot: string,
  profileId: ProfileId,
  projectNameOverride?: string
): HarnessManifest {
  const profile = catalog.getProfile(profileId);
  const rawName = projectNameOverride ?? path.basename(path.resolve(workspaceRoot));
  const projectId = sanitizeProjectId(rawName);

  return {
    schemaVersion: "1.0",
    project: {
      id: projectId,
      name: rawName,
      description: `${rawName} AI Development Harness (${profileId} profile)`,
      primaryLanguage: profile.primaryLanguage
    },
    profile: profileId,
    harnessSource: {
      version: catalog.getHarnessVersion()
    },
    runtimes: [...profile.runtimes],
    coordinator: profile.coordinator ? { ...profile.coordinator } : undefined,
    skills: [...profile.skills],
    workflows: {
      default: profile.workflows.default,
      enabled: [...profile.workflows.enabled]
    },
    hooks: profile.hooks ? { ...profile.hooks } : { telemetry: true, safetyGuards: true },
    validators: profile.validators.map((v) => ({ ...v, args: v.args ? [...v.args] : undefined })),
    policies: {
      allowDestructiveCommands: profile.policies.allowDestructiveCommands,
      allowBypassPermissions: false,
      redactSecretsInLogs: true,
      protectedBranches: profile.policies.protectedBranches ? [...profile.policies.protectedBranches] : ["main"],
      forbiddenPaths: profile.policies.forbiddenPaths ? [...profile.policies.forbiddenPaths] : [".env"]
    }
  };
}

export function readManifest(workspaceRoot: string): HarnessManifest {
  const manifestPath = resolveSafeWorkspacePath(workspaceRoot, MANIFEST_RELATIVE_PATH);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Harness manifest not found at ${MANIFEST_RELATIVE_PATH}. Run 'dlm init' first.`);
  }
  const raw = fs.readFileSync(manifestPath, "utf8");
  const parsed = YAML.parse(raw) as unknown;
  const check = validateManifestSchema(parsed);
  if (!check.valid || !check.manifest) {
    const details = check.issues.map((i) => `${i.path}: ${i.message}`).join("; ");
    throw new Error(`Invalid harness manifest (${MANIFEST_RELATIVE_PATH}): ${details}`);
  }
  return check.manifest;
}

export function writeManifest(workspaceRoot: string, manifest: HarnessManifest): string {
  const check = validateManifestSchema(manifest);
  if (!check.valid) {
    const details = check.issues.map((i) => `${i.path}: ${i.message}`).join("; ");
    throw new Error(`Cannot write invalid manifest: ${details}`);
  }
  const manifestPath = resolveSafeWorkspacePath(workspaceRoot, MANIFEST_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  const serialized = YAML.stringify(manifest, { indent: 2 });
  fs.writeFileSync(manifestPath, serialized, "utf8");
  return manifestPath;
}

export function readLockfile(workspaceRoot: string): HarnessLockfile | null {
  const lockPath = resolveSafeWorkspacePath(workspaceRoot, LOCKFILE_RELATIVE_PATH);
  if (!fs.existsSync(lockPath)) {
    return null;
  }
  const raw = fs.readFileSync(lockPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const check = validateLockfileSchema(parsed);
  if (!check.valid || !check.lockfile) {
    const details = check.issues.map((i) => `${i.path}: ${i.message}`).join("; ");
    throw new Error(`Invalid harness lockfile (${LOCKFILE_RELATIVE_PATH}): ${details}`);
  }
  return check.lockfile;
}

export function writeLockfile(workspaceRoot: string, lockfile: HarnessLockfile): string {
  const check = validateLockfileSchema(lockfile);
  if (!check.valid) {
    const details = check.issues.map((i) => `${i.path}: ${i.message}`).join("; ");
    throw new Error(`Cannot write invalid lockfile: ${details}`);
  }
  const lockPath = resolveSafeWorkspacePath(workspaceRoot, LOCKFILE_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify(lockfile, null, 2) + "\n", "utf8");
  return lockPath;
}

export function validateManifestPoliciesAndDependencies(
  manifest: HarnessManifest,
  catalog: HarnessCatalog
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!manifest.workflows.enabled.includes(manifest.workflows.default)) {
    issues.push({
      code: "DEFAULT_WORKFLOW_NOT_ENABLED",
      severity: "error",
      path: "$.workflows.default",
      message: `Default workflow '${manifest.workflows.default}' must be listed in workflows.enabled`
    });
  }

  const catalogSkills = new Set(catalog.listSkills().map((s) => s.name));
  for (const skillName of manifest.skills) {
    if (!catalogSkills.has(skillName)) {
      issues.push({
        code: "UNKNOWN_CATALOG_SKILL",
        severity: "warning",
        path: `$.skills`,
        message: `Skill '${skillName}' is not in the central catalog (must exist locally in .agents/skills/${skillName}/SKILL.md)`
      });
    }
  }

  for (const validator of manifest.validators ?? []) {
    const cmdSafety = validateSafeCommand(
      validator.command,
      validator.args ?? [],
      manifest.policies.allowDestructiveCommands
    );
    if (!cmdSafety.safe) {
      issues.push({
        code: "UNSAFE_VALIDATOR_COMMAND",
        severity: "error",
        path: `$.validators[${validator.id}]`,
        message: cmdSafety.reason ?? "Unsafe validator command"
      });
    }
  }

  return issues;
}
