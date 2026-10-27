import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { HARNESS_ROOT } from "./schemas.js";
import { computeFileSha256 } from "./security.js";
import type { ProfileDefinition, ProfileId, SkillCatalogEntry, SkillFrontmatter } from "./types.js";
import type { WorkflowDefinition } from "../workflow/types.js";

export function parseSkillFrontmatter(markdown: string): SkillFrontmatter {
  const normalized = markdown.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    throw new Error("SKILL.md is missing opening YAML frontmatter delimiter (---)");
  }
  const endIdx = normalized.indexOf("\n---\n", 4);
  if (endIdx === -1) {
    throw new Error("SKILL.md is missing closing YAML frontmatter delimiter (---)");
  }
  const rawYaml = normalized.slice(4, endIdx);
  const parsed = YAML.parse(rawYaml) as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("SKILL.md frontmatter is not a valid YAML object");
  }
  if (typeof parsed.name !== "string" || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(parsed.name)) {
    throw new Error(`SKILL.md frontmatter has invalid 'name': ${String(parsed.name)}`);
  }
  if (typeof parsed.description !== "string" || parsed.description.trim().length === 0) {
    throw new Error(`SKILL.md frontmatter for '${parsed.name}' is missing non-empty 'description'`);
  }
  return {
    name: parsed.name,
    description: parsed.description.trim(),
    version: typeof parsed.version === "string" ? parsed.version : "1.0.0",
    license: typeof parsed.license === "string" ? parsed.license : undefined
  };
}

export class HarnessCatalog {
  constructor(public readonly rootDir: string = HARNESS_ROOT) {}

  getHarnessVersion(): string {
    const pkgPath = path.join(this.rootDir, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version?: string };
      if (pkg.version) return pkg.version;
    }
    return "0.1.0";
  }

  listProfiles(): ProfileDefinition[] {
    const profilesDir = path.join(this.rootDir, "profiles");
    if (!fs.existsSync(profilesDir)) return [];
    const files = fs.readdirSync(profilesDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    return files.map((file) => {
      const raw = fs.readFileSync(path.join(profilesDir, file), "utf8");
      return YAML.parse(raw) as ProfileDefinition;
    });
  }

  getProfile(profileId: ProfileId): ProfileDefinition {
    if (profileId === "minimal") {
      return {
        schemaVersion: "1.0",
        profile: "minimal",
        description: "Minimal runtime-agnostic AI harness profile",
        primaryLanguage: "polyglot",
        runtimes: ["claude-code", "codex"],
        coordinator: {
          preferredRuntime: "claude-code",
          useOrcaWhenAvailable: true,
          maxParallelAgents: 2
        },
        skills: ["planning", "tdd", "code-review", "handoff"],
        workflows: {
          default: "feature",
          enabled: ["feature", "bugfix"]
        },
        hooks: {
          telemetry: true,
          safetyGuards: true
        },
        validators: [],
        policies: {
          allowDestructiveCommands: false,
          allowBypassPermissions: false,
          redactSecretsInLogs: true,
          protectedBranches: ["main", "master"],
          forbiddenPaths: [".env"]
        }
      };
    }

    const profilePath = path.join(this.rootDir, "profiles", `${profileId}.yaml`);
    if (!fs.existsSync(profilePath)) {
      throw new Error(`Profile '${profileId}' not found in catalog (${profilePath})`);
    }
    return YAML.parse(fs.readFileSync(profilePath, "utf8")) as ProfileDefinition;
  }

  listSkills(): SkillCatalogEntry[] {
    const skillsDir = path.join(this.rootDir, "skills");
    if (!fs.existsSync(skillsDir)) return [];
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    const skills: SkillCatalogEntry[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillFile = path.join(skillsDir, entry.name, "SKILL.md");
      if (!fs.existsSync(skillFile)) continue;
      const content = fs.readFileSync(skillFile, "utf8");
      const fm = parseSkillFrontmatter(content);
      skills.push({
        name: fm.name,
        description: fm.description,
        version: fm.version ?? "1.0.0",
        sourceDir: path.join(skillsDir, entry.name),
        skillFilePath: skillFile,
        sha256: computeFileSha256(skillFile)
      });
    }
    return skills.sort((a, b) => a.name.localeCompare(b.name));
  }

  getSkill(name: string): SkillCatalogEntry {
    const found = this.listSkills().find((s) => s.name === name);
    if (!found) {
      throw new Error(`Skill '${name}' not found in central catalog`);
    }
    return found;
  }

  listWorkflows(): WorkflowDefinition[] {
    const workflowsDir = path.join(this.rootDir, "workflows");
    if (!fs.existsSync(workflowsDir)) return [];
    const files = fs.readdirSync(workflowsDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    return files
      .map((file) => YAML.parse(fs.readFileSync(path.join(workflowsDir, file), "utf8")) as WorkflowDefinition)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  getWorkflow(workflowId: string): { definition: WorkflowDefinition; filePath: string; sha256: string } {
    const filePath = path.join(this.rootDir, "workflows", `${workflowId}.yaml`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Workflow '${workflowId}' not found in central catalog`);
    }
    const definition = YAML.parse(fs.readFileSync(filePath, "utf8")) as WorkflowDefinition;
    return {
      definition,
      filePath,
      sha256: computeFileSha256(filePath)
    };
  }

  getTemplate(name: string): string {
    const tplPath = path.join(this.rootDir, "templates", name);
    if (!fs.existsSync(tplPath)) {
      throw new Error(`Template '${name}' not found at ${tplPath}`);
    }
    return fs.readFileSync(tplPath, "utf8");
  }

  getSharedHookScriptPath(): string {
    return path.join(this.rootDir, "hooks", "shared", "dlm-hook.mjs");
  }
}
