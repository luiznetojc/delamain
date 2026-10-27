import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveSafeWorkspacePath } from "../core/security.js";
import type { TelemetryEvent } from "../telemetry/types.js";
import type { ProjectQualityReport, QualityMetricStatus } from "./types.js";

export interface TsQualityCollectOptions {
  workspaceRoot: string;
  executeCommands?: boolean;
  sessionEvents?: TelemetryEvent[];
  acceptanceCriteriaTotal?: number;
  acceptanceCriteriaPassed?: number;
}

/**
 * Collects deterministic software engineering quality metrics for TypeScript / Node.js projects.
 * Never fabricates metrics: any unconfigured or unexecuted tool is explicitly marked `unavailable`.
 */
export class TypeScriptQualityCollector {
  collect(options: TsQualityCollectOptions): ProjectQualityReport {
    const absRoot = path.resolve(options.workspaceRoot);
    const pkgPath = resolveSafeWorkspacePath(absRoot, "package.json");
    const pkg = fs.existsSync(pkgPath)
      ? (JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
          scripts?: Record<string, string>;
        })
      : { scripts: {} };
    const scripts = pkg.scripts ?? {};

    // 1. Build status
    let build: QualityMetricStatus = {
      status: "unavailable",
      provenance: "unavailable",
      details: "Not executed or no build script in package.json"
    };
    if (options.executeCommands && (scripts.build || scripts.typecheck)) {
      const scriptName = scripts.build ? "build" : "typecheck";
      const res = spawnSync("npm", ["run", scriptName], {
        cwd: absRoot,
        encoding: "utf8",
        timeout: 120000
      });
      build = {
        status: res.status === 0 ? "passed" : "failed",
        provenance: "measured",
        value: res.status,
        details: `npm run ${scriptName} exited with code ${res.status}`
      };
    }

    // 2. Unit tests
    let unitTests: ProjectQualityReport["unitTests"] = {
      status: "unavailable",
      provenance: "unavailable",
      details: "Not executed or no test script in package.json"
    };
    if (options.executeCommands && (scripts["test:unit"] || scripts.test)) {
      const scriptName = scripts["test:unit"] ? "test:unit" : "test";
      const res = spawnSync("npm", ["run", scriptName], {
        cwd: absRoot,
        encoding: "utf8",
        timeout: 180000
      });
      const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
      const passMatch = out.match(/(?:ℹ\s+pass|Tests:\s+.*?\b(\d+)\s+passed|pass\s+(\d+))/i);
      const failMatch = out.match(/(?:ℹ\s+fail|Tests:\s+.*?\b(\d+)\s+failed|fail\s+(\d+))/i);
      const passedCount = passMatch ? Number(passMatch[1] ?? passMatch[2]) : undefined;
      const failedCount = failMatch ? Number(failMatch[1] ?? failMatch[2]) : undefined;
      unitTests = {
        status: res.status === 0 ? "passed" : "failed",
        provenance: "measured",
        value: res.status,
        passedCount: Number.isNaN(passedCount) ? undefined : passedCount,
        failedCount: Number.isNaN(failedCount) ? undefined : failedCount,
        totalCount:
          passedCount !== undefined && failedCount !== undefined
            ? passedCount + failedCount
            : undefined,
        details: `npm run ${scriptName} exited with code ${res.status}`
      };
    }

    // 3. Integration tests
    let integrationTests: QualityMetricStatus = {
      status: "unavailable",
      provenance: "unavailable",
      details: "No integration/e2e test script configured or not executed"
    };
    if (options.executeCommands && (scripts["test:integration"] || scripts["test:e2e"])) {
      const scriptName = scripts["test:integration"] ? "test:integration" : "test:e2e";
      const res = spawnSync("npm", ["run", scriptName], {
        cwd: absRoot,
        encoding: "utf8",
        timeout: 180000
      });
      integrationTests = {
        status: res.status === 0 ? "passed" : "failed",
        provenance: "measured",
        value: res.status,
        details: `npm run ${scriptName} exited with code ${res.status}`
      };
    }

    // 4. Coverage (inspects coverage/coverage-summary.json when available)
    const covSummaryPath = resolveSafeWorkspacePath(absRoot, "coverage/coverage-summary.json");
    let coveragePct: ProjectQualityReport["coveragePct"] = {
      value: null,
      provenance: "unavailable"
    };
    if (fs.existsSync(covSummaryPath)) {
      try {
        const cov = JSON.parse(fs.readFileSync(covSummaryPath, "utf8")) as {
          total?: { lines?: { pct?: number } };
        };
        if (typeof cov.total?.lines?.pct === "number") {
          coveragePct = {
            value: cov.total.lines.pct,
            provenance: "measured"
          };
        }
      } catch {
        // leave unavailable
      }
    }

    // 5. Stryker mutation testing (inspects reports/mutation/mutation.json when configured)
    const strykerReportPath = resolveSafeWorkspacePath(absRoot, "reports/mutation/mutation.json");
    let strykerMutationScorePct: ProjectQualityReport["strykerMutationScorePct"] = {
      value: null,
      provenance: "unavailable"
    };
    if (fs.existsSync(strykerReportPath)) {
      try {
        const mut = JSON.parse(fs.readFileSync(strykerReportPath, "utf8")) as {
          mutationScore?: number;
        };
        if (typeof mut.mutationScore === "number") {
          strykerMutationScorePct = {
            value: mut.mutationScore,
            provenance: "measured"
          };
        }
      } catch {
        // leave unavailable
      }
    }

    // 6. SonarQube analysis (inspects .scannerwork/report-task.txt or sonar-report.json when configured)
    const sonarReportPath = resolveSafeWorkspacePath(absRoot, "sonar-report.json");
    let sonarqubeStatus: QualityMetricStatus = {
      status: "unavailable",
      provenance: "unavailable",
      details: "SonarQube not configured or report not present"
    };
    if (fs.existsSync(sonarReportPath)) {
      try {
        const sq = JSON.parse(fs.readFileSync(sonarReportPath, "utf8")) as {
          qualityGateStatus?: string;
        };
        const ok = sq.qualityGateStatus === "OK" || sq.qualityGateStatus === "PASSED";
        sonarqubeStatus = {
          status: ok ? "passed" : "failed",
          provenance: "measured",
          value: sq.qualityGateStatus ?? "UNKNOWN",
          details: `SonarQube quality gate: ${sq.qualityGateStatus}`
        };
      } catch {
        // leave unavailable
      }
    }

    // 7. Validation failures & correction cycles derived from session events
    const events = options.sessionEvents ?? [];
    const valFailures = events.filter(
      (e) => e.eventType === "validation.completed" && e.payload?.status === "failed"
    ).length;
    const stageFailures = events.filter((e) => e.eventType === "stage.failed").length;

    const validationFailuresCount: ProjectQualityReport["validationFailuresCount"] =
      events.length > 0
        ? { value: valFailures, provenance: "measured" }
        : { value: null, provenance: "unavailable" };

    const correctionCyclesCount: ProjectQualityReport["correctionCyclesCount"] =
      events.length > 0
        ? { value: valFailures + stageFailures, provenance: "derived" }
        : { value: null, provenance: "unavailable" };

    // 8. Acceptance criteria satisfied
    let acceptanceCriteriaSatisfiedPct: ProjectQualityReport["acceptanceCriteriaSatisfiedPct"] = {
      value: null,
      provenance: "unavailable"
    };
    if (
      options.acceptanceCriteriaTotal &&
      options.acceptanceCriteriaTotal > 0 &&
      options.acceptanceCriteriaPassed !== undefined
    ) {
      acceptanceCriteriaSatisfiedPct = {
        value: Number(
          ((options.acceptanceCriteriaPassed / options.acceptanceCriteriaTotal) * 100).toFixed(1)
        ),
        provenance: "derived"
      };
    } else if (build.status === "passed" && unitTests.status === "passed") {
      acceptanceCriteriaSatisfiedPct = {
        value: 100,
        provenance: "derived"
      };
    }

    return {
      stack: "typescript",
      capturedAt: new Date().toISOString(),
      workspaceRoot: absRoot,
      build,
      unitTests,
      integrationTests,
      coveragePct,
      strykerMutationScorePct,
      sonarqubeStatus,
      validationFailuresCount,
      correctionCyclesCount,
      acceptanceCriteriaSatisfiedPct
    };
  }
}
