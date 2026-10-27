---
name: typescript-backend
description: >-
  Best practices and validation procedures for modern TypeScript and Node.js services,
  enforcing strict types, explicit error handling, and deterministic test suites.
---

# TypeScript Backend Skill

Use this skill when developing or validating TypeScript / Node.js projects.

## Procedure

1. **Strict Type Safety**: Never introduce `any` or unsafe type assertions without explicit narrowing; keep `strict: true` and `noUncheckedIndexedAccess: true` green.
2. **Explicit Error Boundaries**: Return structured results or typed errors rather than swallowing exceptions.
3. **Validation Commands**:
   - Typecheck: `npm run typecheck --if-present`
   - Build: `npm run build --if-present`
   - Test: `npm test`
