export type RuntimeId = "claude-code" | "codex" | "agy";
export type TelemetryRuntimeId = RuntimeId | "cli" | "orca";
export type ProfileId = "dotnet" | "node" | "typescript" | "minimal";
export type PrimaryLanguage = "typescript" | "javascript" | "csharp" | "polyglot";

export type ValidatorKind =
  | "build"
  | "unit-test"
  | "integration-test"
  | "lint"
  | "typecheck"
  | "coverage"
  | "mutation"
  | "sonarqube"
  | "custom";

export interface ValidatorDefinition {
  id: string;
  name: string;
  kind: ValidatorKind;
  command: string;
  args?: string[];
  timeoutMs?: number;
  required?: boolean;
  enabled?: boolean;
}

export interface PolicyDefinition {
  allowDestructiveCommands: boolean;
  allowBypassPermissions: false;
  redactSecretsInLogs: true;
  protectedBranches?: string[];
  forbiddenPaths?: string[];
}

export interface CoordinatorConfig {
  preferredRuntime?: RuntimeId;
  useOrcaWhenAvailable?: boolean;
  maxParallelAgents?: number;
}

export interface HooksConfig {
  telemetry?: boolean;
  safetyGuards?: boolean;
}

export interface HarnessManifest {
  schemaVersion: "1.0";
  project: {
    id: string;
    name: string;
    description?: string;
    primaryLanguage?: PrimaryLanguage;
  };
  profile: ProfileId;
  harnessSource?: {
    version?: string;
    path?: string;
  };
  runtimes: RuntimeId[];
  coordinator?: CoordinatorConfig;
  skills: string[];
  workflows: {
    default: string;
    enabled: string[];
  };
  hooks?: HooksConfig;
  validators?: ValidatorDefinition[];
  policies: PolicyDefinition;
}

export interface ProfileDefinition {
  schemaVersion: "1.0";
  profile: ProfileId;
  description: string;
  primaryLanguage: PrimaryLanguage;
  runtimes: RuntimeId[];
  coordinator?: CoordinatorConfig;
  skills: string[];
  workflows: {
    default: string;
    enabled: string[];
  };
  hooks?: HooksConfig;
  validators: ValidatorDefinition[];
  policies: PolicyDefinition;
}

export interface LockedSkillEntry {
  name: string;
  version: string;
  sourcePath: string;
  installedPath: string;
  sha256: string;
}

export interface LockedWorkflowEntry {
  id: string;
  version: string;
  installedPath: string;
  sha256: string;
}

export type FileOwnershipMode = "generated" | "merged-markers" | "user-preserved";

export interface ManagedFileEntry {
  path: string;
  ownership: FileOwnershipMode;
  runtime?: string;
  sha256: string;
}

export interface HarnessLockfile {
  lockfileVersion: 1;
  harnessVersion: string;
  generatedAt: string;
  profile: string;
  skills: Record<string, LockedSkillEntry>;
  workflows: Record<string, LockedWorkflowEntry>;
  managedFiles: Record<string, ManagedFileEntry>;
}

export interface SkillFrontmatter {
  name: string;
  description: string;
  version?: string;
  license?: string;
}

export interface SkillCatalogEntry {
  name: string;
  description: string;
  version: string;
  sourceDir: string;
  skillFilePath: string;
  sha256: string;
}

export interface ValidationIssue {
  code: string;
  severity: "error" | "warning" | "info";
  path?: string;
  message: string;
}

export interface ValidatorExecutionResult {
  validatorId: string;
  name: string;
  kind: ValidatorKind;
  command: string;
  status: "passed" | "failed" | "skipped" | "unavailable";
  exitCode: number | null;
  durationMs: number;
  executedAt: string;
  summary: string;
  stdout?: string;
  stderr?: string;
}

export interface ValidationReport {
  valid: boolean;
  checkedAt: string;
  workspaceRoot: string;
  issues: ValidationIssue[];
  validatorResults?: ValidatorExecutionResult[];
}
