import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { TelemetryEvent } from "../telemetry/types.js";
import type { ProjectQualityReport, QualityMetricStatus } from "./types.js";

export interface DotnetQualityCollectOptions {
  workspaceRoot: string;
  executeCommands?: boolean;
  sessionEvents?: TelemetryEvent[];
}

export class DotnetQualityCollector {
  collect(options: DotnetQualityCollectOptions): ProjectQualityReport {
    const absRoot = path.resolve(options.workspaceRoot);

    let build: QualityMetricStatus = {
      status: "unavailable",
      provenance: "unavailable",
      details: "Not executed"
    };

    let unitTests: ProjectQualityReport["unitTests"] = {
      status: "unavailable",
      provenance: "unavailable",
      details: "Not executed"
    };

    if (options.executeCommands) {
      const buildRes = spawnSync("dotnet", ["build", "--nologo", "-v", "minimal"], {
        cwd: absRoot,
        encoding: "utf8",
        timeout: 120000
      });
      build = {
        status: buildRes.status === 0 ? "passed" : "failed",
        provenance: "measured",
        value: buildRes.status,
        details: `dotnet build exited with code ${buildRes.status}`
      };

      const testRes = spawnSync("dotnet", ["test", "--no-build", "--nologo", "-v", "minimal"], {
        cwd: absRoot,
        encoding: "utf8",
        timeout: 180000
      });
      const out = `${testRes.stdout ?? ""}\n${testRes.stderr ?? ""}`;
      const passedMatch = out.match(/Passed:\s*(\d+)/i) ?? out.match(/Aprovados:\s*(\d+)/i);
      const failedMatch = out.match(/Failed:\s*(\d+)/i) ?? out.match(/Com falha:\s*(\d+)/i);
      const totalMatch = out.match(/Total:\s*(\d+)/i);

      const passedCount = passedMatch ? Number(passedMatch[1]) : undefined;
      const failedCount = failedMatch ? Number(failedMatch[1]) : undefined;
      const totalCount = totalMatch ? Number(totalMatch[1]) : undefined;

      unitTests = {
        status: testRes.status === 0 ? "passed" : "failed",
        provenance: "measured",
        value: testRes.status,
        passedCount,
        failedCount,
        totalCount,
        details: `dotnet test exited with code ${testRes.status}`
      };
    }

    const events = options.sessionEvents ?? [];
    const valFailures = events.filter(
      (e) => e.eventType === "validation.completed" && e.payload?.status === "failed"
    ).length;
    const stageFailures = events.filter((e) => e.eventType === "stage.failed").length;

    const cobPath = path.join(absRoot, "TestResults", "coverage.cobertura.xml");
    let coveragePct: ProjectQualityReport["coveragePct"] = {
      value: null,
      provenance: "unavailable"
    };
    if (fs.existsSync(cobPath)) {
      const xml = fs.readFileSync(cobPath, "utf8");
      const m = xml.match(/line-rate="([0-9.]+)"/);
      if (m?.[1]) {
        coveragePct = {
          value: Number(( Number(m[1]) * 100 ).toFixed(1)),
          provenance: "measured"
        };
      }
    }

    return {
      stack: "dotnet",
      capturedAt: new Date().toISOString(),
      workspaceRoot: absRoot,
      build,
      unitTests,
      integrationTests: {
        status: "unavailable",
        provenance: "unavailable",
        details: "No separate integration test project configured"
      },
      coveragePct,
      strykerMutationScorePct: { value: null, provenance: "unavailable" },
      sonarqubeStatus: {
        status: "unavailable",
        provenance: "unavailable",
        details: "SonarQube not configured"
      },
      validationFailuresCount:
        events.length > 0
          ? { value: valFailures, provenance: "measured" }
          : { value: null, provenance: "unavailable" },
      correctionCyclesCount:
        events.length > 0
          ? { value: valFailures + stageFailures, provenance: "derived" }
          : { value: null, provenance: "unavailable" },
      acceptanceCriteriaSatisfiedPct:
        build.status === "passed" && unitTests.status === "passed"
          ? { value: 100, provenance: "derived" }
          : { value: null, provenance: "unavailable" }
    };
  }
}
