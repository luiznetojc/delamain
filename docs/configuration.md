# Configuration & File Ownership Guide (`docs/configuration.md`)

## 1. `.agents/harness.yaml` (Manifest)

`.agents/harness.yaml` is the single versioned source of truth for a consumer repository's harness setup. It is validated against [`schemas/harness-manifest.schema.json`](../schemas/harness-manifest.schema.json).

### Example `.agents/harness.yaml`

```yaml
schemaVersion: "1.0"
project:
  id: order-pricing
  name: OrderPricing
  description: OrderPricing AI Development Harness (dotnet profile)
  primaryLanguage: csharp
profile: dotnet
harnessSource:
  version: 0.1.0
runtimes:
  - claude-code
  - codex
  - agy
coordinator:
  preferredRuntime: claude-code
  useOrcaWhenAvailable: true
  maxParallelAgents: 4
skills:
  - planning
  - architecture
  - dotnet-backend
  - tdd
  - code-review
  - security-review
  - handoff
workflows:
  default: feature
  enabled:
    - feature
    - bugfix
    - refactor
    - security-review
    - test-improvement
hooks:
  telemetry: true
  safetyGuards: true
validators:
  - id: dotnet-build
    name: .NET Solution Build
    kind: build
    command: dotnet
    args: ["build", "--nologo", "-v", "minimal"]
    timeoutMs: 120000
    required: true
    enabled: true
  - id: dotnet-test
    name: .NET xUnit Tests
    kind: unit-test
    command: dotnet
    args: ["test", "--no-build", "--nologo", "-v", "minimal"]
    timeoutMs: 180000
    required: true
    enabled: true
policies:
  allowDestructiveCommands: false
  allowBypassPermissions: false
  redactSecretsInLogs: true
  protectedBranches:
    - main
    - master
    - production
  forbiddenPaths:
    - .env
    - .env.production
    - appsettings.Production.json
```

## 2. File Ownership Modes (`harness.lock`)

To guarantee that `dlm init` and `dlm sync` never destroy developer customizations, every managed file in `.agents/harness.lock` has an explicit `ownership` mode:

| Ownership Mode | Files | Behavior on `dlm sync` / `dlm upgrade` |
| :--- | :--- | :--- |
| `generated` | `.agents/skills/*/SKILL.md`, `.claude/skills/*/SKILL.md`, `.agents/rules/*.md`, `.agents/hooks/dlm-hook.mjs` | Managed by Delamain; verified by SHA-256 checksum in `harness.lock`. |
| `merged-markers` | `AGENTS.md`, `CLAUDE.md` | Delamain only updates the block enclosed between `<!-- dlm:managed:start -->` and `<!-- dlm:managed:end -->`. All developer content before or after the markers is preserved verbatim. |
| `user-preserved` | `.agents/harness.yaml`, edited `.agents/workflows/*.yaml`, existing `.claude/settings.json`, existing `.codex/config.toml` | Existing user settings are preserved; Delamain only merges missing hook entries or skips overwriting. |
