#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const build = spawnSync("npm", ["run", "build", "--if-present"], { stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

const test = spawnSync("npm", ["test", "--if-present"], { stdio: "inherit" });
process.exit(test.status ?? 0);
