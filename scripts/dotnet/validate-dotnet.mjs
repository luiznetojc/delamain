#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const build = spawnSync("dotnet", ["build", "--nologo", "-v", "minimal"], { stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

const test = spawnSync("dotnet", ["test", "--no-build", "--nologo", "-v", "minimal"], { stdio: "inherit" });
process.exit(test.status ?? 0);
