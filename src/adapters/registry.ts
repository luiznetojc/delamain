import type { RuntimeId } from "../core/types.js";
import { AgyAdapter } from "./agy.js";
import { ClaudeCodeAdapter } from "./claude-code.js";
import { CodexAdapter } from "./codex.js";
import { OrcaIntegrationAdapter, type OrcaStatusSummary } from "./orca.js";
import type { RuntimeAdapter, RuntimeDoctorReport } from "./types.js";

export interface FullDoctorReport {
  checkedAt: string;
  workspaceRoot?: string;
  runtimes: RuntimeDoctorReport[];
  orca: OrcaStatusSummary;
}

export class RuntimeAdapterRegistry {
  private readonly adapters = new Map<RuntimeId, RuntimeAdapter>();
  public readonly orca = new OrcaIntegrationAdapter();

  constructor() {
    this.register(new ClaudeCodeAdapter());
    this.register(new CodexAdapter());
    this.register(new AgyAdapter());
  }

  register(adapter: RuntimeAdapter): void {
    this.adapters.set(adapter.runtimeId, adapter);
  }

  get(runtimeId: RuntimeId): RuntimeAdapter {
    const adapter = this.adapters.get(runtimeId);
    if (!adapter) {
      throw new Error(`No runtime adapter registered for '${runtimeId}'`);
    }
    return adapter;
  }

  list(): RuntimeAdapter[] {
    return Array.from(this.adapters.values());
  }

  runDoctor(workspaceRoot?: string): FullDoctorReport {
    return {
      checkedAt: new Date().toISOString(),
      workspaceRoot,
      runtimes: this.list().map((adapter) => adapter.inspectEnvironment(workspaceRoot)),
      orca: this.orca.inspectStatus()
    };
  }
}
