import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const MANAGED_START_MARKER = "<!-- dlm:managed:start -->";
export const MANAGED_END_MARKER = "<!-- dlm:managed:end -->";

const ALLOWED_VALIDATOR_EXECUTABLES = new Set([
  "npm",
  "npx",
  "node",
  "dotnet",
  "git",
  "tsc",
  "vitest",
  "jest",
  "eslint",
  "prettier"
]);

const FORBIDDEN_ARG_PATTERNS = [
  /--dangerously-skip-permissions/i,
  /--dangerously-bypass-approvals-and-sandbox/i,
  /--dangerously-bypass-hook-trust/i,
  /\bbypassPermissions\b/i,
  /[;&|`$<>]/
];

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bsk-ant-[a-zA-Z0-9_-]{10,}\b/g, "[REDACTED_ANTHROPIC_KEY]"],
  [/\bsk-(?:proj-)?[a-zA-Z0-9_-]{16,}\b/g, "[REDACTED_OPENAI_KEY]"],
  [/\bgh[pousr]_[a-zA-Z0-9]{16,}\b/g, "[REDACTED_GITHUB_TOKEN]"],
  [/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[REDACTED_GOOGLE_API_KEY]"],
  [/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[REDACTED_BEARER_TOKEN]"],
  [/((?:PASSWORD|SECRET|TOKEN|API_KEY|PRIVATE_KEY|DATABASE_URL|DIRECT_URL)\s*[=:]\s*)(["']?)[^\s"',;]+(\2)/gi, "$1$2[REDACTED]$3"],
  [/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+(@)/gi, "$1[REDACTED]$2"]
];

export function computeSha256(content: string | Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function computeFileSha256(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return computeSha256(buf);
}

/**
 * Resolves a relative path inside a workspace root and throws if it traverses outside.
 */
export function resolveSafeWorkspacePath(workspaceRoot: string, relativeTarget: string): string {
  if (relativeTarget.includes("\0")) {
    throw new Error(`Security violation: path contains null byte: ${relativeTarget}`);
  }
  if (path.isAbsolute(relativeTarget)) {
    throw new Error(`Security violation: expected relative path within workspace, got absolute path: ${relativeTarget}`);
  }
  const realRoot = path.resolve(workspaceRoot);
  const resolved = path.resolve(realRoot, relativeTarget);
  const rel = path.relative(realRoot, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Security violation: path traversal detected outside workspace root: ${relativeTarget}`);
  }
  return resolved;
}

/**
 * Validates that a validator command from a manifest does not execute arbitrary shells
 * or include dangerous permission-bypass flags.
 */
export function validateSafeCommand(
  command: string,
  args: string[] = [],
  allowDestructive = false
): { safe: boolean; reason?: string } {
  const baseCmd = path.basename(command);
  if (!ALLOWED_VALIDATOR_EXECUTABLES.has(baseCmd)) {
    return {
      safe: false,
      reason: `Executable '${command}' is not in the trusted validator allowlist (${Array.from(ALLOWED_VALIDATOR_EXECUTABLES).join(", ")})`
    };
  }

  if (/[;&|`$<>]/.test(command)) {
    return {
      safe: false,
      reason: `Executable '${command}' contains shell metacharacters`
    };
  }

  for (const arg of args) {
    for (const pattern of FORBIDDEN_ARG_PATTERNS) {
      if (pattern.test(arg)) {
        return {
          safe: false,
          reason: `Argument '${arg}' matches forbidden security pattern ${pattern}`
        };
      }
    }
    if (!allowDestructive && /\b(rm|-rf|drop|reset\s+--hard|clean\s+-fd)\b/i.test(arg)) {
      return {
        safe: false,
        reason: `Destructive argument '${arg}' is blocked by policy (allowDestructiveCommands=false)`
      };
    }
  }

  return { safe: true };
}

/**
 * Redacts known secret patterns from strings before logging or persistence.
 */
export function redactSecrets(input: string): string {
  let out = input;
  for (const [regex, replacement] of SECRET_PATTERNS) {
    out = out.replace(regex, replacement);
  }
  return out;
}

export function redactObjectSecrets<T>(value: T): T {
  if (typeof value === "string") {
    return redactSecrets(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactObjectSecrets(item)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/^(password|secret|token|apiKey|privateKey|authorization|cookie)$/i.test(k) && typeof v === "string") {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redactObjectSecrets(v);
      }
    }
    return out as T;
  }
  return value;
}

/**
 * Merges a Delamain-managed markdown block into an existing file without overwriting
 * developer content outside the managed markers.
 */
export function mergeManagedMarkdown(existingContent: string | null, managedBlock: string): {
  content: string;
  ownership: "generated" | "merged-markers";
} {
  const normalizedBlock = managedBlock.trim();
  const wrappedBlock = normalizedBlock.startsWith(MANAGED_START_MARKER)
    ? normalizedBlock
    : `${MANAGED_START_MARKER}\n${normalizedBlock}\n${MANAGED_END_MARKER}`;

  if (existingContent === null || existingContent.trim().length === 0) {
    return { content: `${wrappedBlock}\n`, ownership: "generated" };
  }

  const startIdx = existingContent.indexOf(MANAGED_START_MARKER);
  const endIdx = existingContent.indexOf(MANAGED_END_MARKER);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = existingContent.slice(0, startIdx);
    const after = existingContent.slice(endIdx + MANAGED_END_MARKER.length);
    const merged = `${before}${wrappedBlock}${after}`;
    return {
      content: merged.endsWith("\n") ? merged : `${merged}\n`,
      ownership: before.trim().length > 0 || after.trim().length > 0 ? "merged-markers" : "generated"
    };
  }

  // Developer has custom content without markers -> preserve all existing content and append managed block
  const trimmedExisting = existingContent.trimEnd();
  return {
    content: `${trimmedExisting}\n\n${wrappedBlock}\n`,
    ownership: "merged-markers"
  };
}

export interface BackupMetadata {
  backupId: string;
  createdAt: string;
  reason: string;
  files: Array<{
    relativePath: string;
    existed: boolean;
    sha256?: string;
  }>;
}

export class BackupManager {
  private readonly backupsRoot: string;

  constructor(private readonly workspaceRoot: string) {
    this.backupsRoot = resolveSafeWorkspacePath(workspaceRoot, ".ai-harness-state/backups");
  }

  createBackup(relativePaths: string[], reason: string): BackupMetadata {
    const backupId = `backup-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const backupDir = path.join(this.backupsRoot, backupId);
    fs.mkdirSync(backupDir, { recursive: true });

    const files: BackupMetadata["files"] = [];
    for (const relPath of relativePaths) {
      const absPath = resolveSafeWorkspacePath(this.workspaceRoot, relPath);
      if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
        const destPath = path.join(backupDir, "files", relPath);
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(absPath, destPath);
        files.push({
          relativePath: relPath,
          existed: true,
          sha256: computeFileSha256(absPath)
        });
      } else {
        files.push({
          relativePath: relPath,
          existed: false
        });
      }
    }

    const metadata: BackupMetadata = {
      backupId,
      createdAt: new Date().toISOString(),
      reason,
      files
    };
    fs.writeFileSync(path.join(backupDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8");
    return metadata;
  }

  rollback(backupId?: string): BackupMetadata {
    if (!fs.existsSync(this.backupsRoot)) {
      throw new Error("No backups directory found in .ai-harness-state/backups");
    }
    const targetId = backupId ?? this.getLatestBackupId();
    if (!targetId) {
      throw new Error("No backups available to rollback");
    }
    const backupDir = path.join(this.backupsRoot, targetId);
    const metaPath = path.join(backupDir, "metadata.json");
    if (!fs.existsSync(metaPath)) {
      throw new Error(`Backup metadata not found for '${targetId}'`);
    }
    const metadata = JSON.parse(fs.readFileSync(metaPath, "utf8")) as BackupMetadata;

    for (const entry of metadata.files) {
      const targetPath = resolveSafeWorkspacePath(this.workspaceRoot, entry.relativePath);
      if (entry.existed) {
        const srcPath = path.join(backupDir, "files", entry.relativePath);
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.copyFileSync(srcPath, targetPath);
      } else if (fs.existsSync(targetPath)) {
        fs.rmSync(targetPath, { force: true });
      }
    }

    return metadata;
  }

  listBackups(): BackupMetadata[] {
    if (!fs.existsSync(this.backupsRoot)) return [];
    const entries = fs.readdirSync(this.backupsRoot, { withFileTypes: true });
    const metas: BackupMetadata[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const metaPath = path.join(this.backupsRoot, entry.name, "metadata.json");
      if (fs.existsSync(metaPath)) {
        try {
          metas.push(JSON.parse(fs.readFileSync(metaPath, "utf8")) as BackupMetadata);
        } catch {
          // ignore malformed backup dir
        }
      }
    }
    return metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private getLatestBackupId(): string | undefined {
    return this.listBackups()[0]?.backupId;
  }
}
