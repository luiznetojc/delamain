import type { HarnessCatalog } from "../core/catalog.js";
import type {
  HarnessManifest,
  ManagedFileEntry,
  RuntimeId,
  ValidationIssue
} from "../core/types.js";

export type CapabilitySupportLevel = "full" | "partial" | "none" | "unconfirmed";

export interface CapabilityTriad {
  declared: CapabilitySupportLevel;
  detected: CapabilitySupportLevel;
  verified: boolean;
  evidence: string;
}

export interface RuntimeCapabilitiesMap {
  skills: CapabilityTriad;
  hooks: CapabilityTriad;
  subagents: CapabilityTriad;
  structured_events: CapabilityTriad;
  session_resume: CapabilityTriad;
  model_selection: CapabilityTriad;
  worktree_isolation: CapabilityTriad;
  native_sandbox: CapabilityTriad;
}

export interface RuntimeDoctorReport {
  runtime: RuntimeId;
  installed: boolean;
  binaryPath: string | null;
  version: string | null;
  capabilities: RuntimeCapabilitiesMap;
  securityAudit: ValidationIssue[];
}

export interface RuntimeAdapter {
  readonly runtimeId: RuntimeId;
  readonly displayName: string;
  inspectEnvironment(workspaceRoot?: string): RuntimeDoctorReport;
  syncProject(
    workspaceRoot: string,
    manifest: HarnessManifest,
    catalog: HarnessCatalog
  ): ManagedFileEntry[];
  validateProject(workspaceRoot: string, manifest: HarnessManifest): ValidationIssue[];
}
