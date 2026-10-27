#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const res = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8" });
if (res.status !== 0) {
  console.error("verify-git-clean: Not a git repository or git failed.");
  process.exit(1);
}
console.log(JSON.stringify({ clean: res.stdout.trim().length === 0, modifiedCount: res.stdout.trim() ? res.stdout.trim().split("\n").length : 0 }));
process.exit(0);
