---
name: security-review
description: >-
  Audit code and configuration changes for path traversal, command injection,
  credential exposure, sandbox weakening, and policy violations.
---

# Security Review Skill

Use this skill during `security-review` stages or whenever touching authentication, filesystem, subprocesses, or configuration.

## Procedure

1. **No Arbitrary Command Execution**: Ensure shell commands use argument arrays (`spawnSync(cmd, args)`) rather than unsanitized shell interpolation.
2. **Path Traversal Protection**: Resolve and verify that all target paths remain strictly within the allowed workspace root.
3. **Secret Hygiene**: Never commit, print, or log `.env` values, tokens, private keys, or credentials.
4. **Sandbox & Approval Integrity**: Verify that no configuration introduces `bypassPermissions`, `--dangerously-skip-permissions`, or `--dangerously-bypass-approvals-and-sandbox`.
