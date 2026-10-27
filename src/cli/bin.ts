#!/usr/bin/env node
import { DelamainCliApp } from "./app.js";

const app = new DelamainCliApp();
const res = app.run(process.argv.slice(2), process.cwd());

if (res.stdout) {
  process.stdout.write(res.stdout + (res.stdout.endsWith("\n") ? "" : "\n"));
}
if (res.stderr) {
  process.stderr.write(res.stderr + (res.stderr.endsWith("\n") ? "" : "\n"));
}
process.exit(res.exitCode);
