# Security & Reliability Architecture (`docs/security.md`)

Delamain enforces defense-in-depth across manifest parsing, file synchronization, runtime hook execution, and telemetry persistence.

## 1. Threat Mitigations

| Threat / Risk | Mitigation Implemented in Delamain |
| :--- | :--- |
| **Arbitrary Command Execution from Untrusted Manifests** | `validateSafeCommand()` (`src/core/security.ts`) restricts validator executables to a strict allowlist (`npm`, `npx`, `node`, `dotnet`, `git`, `tsc`, `vitest`, `jest`, `eslint`, `prettier`), executes via `spawnSync(cmd, args)` without shell interpolation, and rejects shell metacharacters (`;`, `&`, `\|`, `` ` ``, `$`, `<`, `>`). |
| **Destructive Operations** | `policies.allowDestructiveCommands` defaults to `false`. Destructive flags (`rm -rf`, `reset --hard`, `clean -fd`) are blocked both in validator manifests and in the runtime `PreToolUse` hook (`hooks/shared/dlm-hook.mjs`). |
| **Sandbox & Approval Bypass** | `policies.allowBypassPermissions` is locked to `false` in the manifest schema. `validateSafeCommand`, `dlm-hook.mjs`, and `dlm doctor` / `dlm validate` actively reject and flag `bypassPermissions`, `--dangerously-skip-permissions`, and `--dangerously-bypass-approvals-and-sandbox`. |
| **Path Traversal** | `resolveSafeWorkspacePath(workspaceRoot, relativeTarget)` rejects null bytes, absolute paths, and any `..` traversal that resolves outside `workspaceRoot`. |
| **Secret Leakage in Logs / Telemetry / Handoffs** | `redactSecrets()` and `redactObjectSecrets()` strip Anthropic (`sk-ant-*`), OpenAI (`sk-*`), GitHub (`ghp_*`), Google (`AIza*`), Bearer tokens, PostgreSQL connection strings, and sensitive keys (`password`, `secret`, `token`, `apiKey`, `privateKey`) before writing to SQLite or handoff files. |
| **Silent Overwrite of Developer Files** | `mergeManagedMarkdown()` updates only content inside `<!-- dlm:managed:start --> ... <!-- dlm:managed:end -->` markers in `AGENTS.md` and `CLAUDE.md`. User edits outside markers are preserved. |
| **Failed Upgrades** | `BackupManager` snapshots all managed files into `.ai-harness-state/backups/<backupId>/` prior to `dlm upgrade` and automatically rolls back on failure (`dlm upgrade --rollback`). |
| **Dependency Supply Chain** | Runtime dependencies are minimized and pinned (`yaml: 2.9.1`, `0 vulnerabilities` verified by `npm audit`), using Node's built-in `node:sqlite` and `node:crypto`. |
