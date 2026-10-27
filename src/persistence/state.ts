import fs from "node:fs";
import path from "node:path";
import { resolveSafeWorkspacePath } from "../core/security.js";
import type { ProjectProgressState } from "./types.js";

export class ContinuityStateStore {
  private readonly progressPath: string;

  constructor(private readonly workspaceRoot: string) {
    this.progressPath = resolveSafeWorkspacePath(
      workspaceRoot,
      ".ai-harness-state/progress.json"
    );
  }

  saveProgress(state: ProjectProgressState): string {
    fs.mkdirSync(path.dirname(this.progressPath), { recursive: true });
    fs.writeFileSync(this.progressPath, JSON.stringify(state, null, 2) + "\n", "utf8");
    return this.progressPath;
  }

  loadProgress(): ProjectProgressState | null {
    if (!fs.existsSync(this.progressPath)) return null;
    return JSON.parse(fs.readFileSync(this.progressPath, "utf8")) as ProjectProgressState;
  }
}
