# Delamain CLI Reference (`dlm` / `delamain`)

All commands support `--cwd <path>` to target a specific project directory and `--json` for machine-readable output.

## 1. Core Distribution & Validation Commands

```bash
# Initialize harness in a repository (auto-detects profile or uses --profile)
dlm init
dlm init --profile dotnet
dlm init --profile node
dlm init --profile typescript

# Synchronize skills, workflows, rules, and runtime configs idempotently
dlm sync
dlm sync --runtime claude-code
dlm sync --runtime codex
dlm sync --runtime agy

# Inspect installed runtimes, capability triads (declared/detected/verified), and Orca status
dlm doctor
dlm doctor --json

# Validate manifest, lockfile checksums, workflow DAGs, and optionally run project validators
dlm validate
dlm validate --run-validators

# Upgrade managed harness files with automatic backup and rollback support
dlm upgrade
dlm upgrade --dry-run
dlm upgrade --rollback
```

## 2. Workflow Management & Execution Commands

```bash
# List installed project workflows
dlm workflow list

# Show workflow stages, parallel DAG waves, task overrides, and Orca dispatch plan
dlm workflow show feature
dlm workflow show feature --disable-stage architecture
dlm workflow show feature --orca-plan --objective "Implement user authentication"

# Validate one or all project workflows
dlm workflow validate
dlm workflow validate feature --disable-stage architecture

# Create and mutate workflows safely
dlm workflow create hotfix --name "Hotfix Workflow"
dlm workflow disable feature security-review
dlm workflow enable feature security-review
dlm workflow add-stage feature --id integration-test --name "Integration Tests" --role tester --depends-on implementation --after implementation
dlm workflow remove-stage feature integration-test

# Execute a workflow session (with optional non-destructive stage overrides and validator runs)
dlm workflow run feature --disable-stage architecture --run-validators --experiment with-tdd
```

## 3. Cross-Runtime Handoff Commands

```bash
# Create a versioned handoff artifact (JSON + Markdown) with live Git state & file SHA-256 hashes
dlm handoff create \
  --from claude-code \
  --to codex \
  --objective "Implement order discount calculation" \
  --completed planning,architecture \
  --pending implementation,code-review,verification \
  --run-validators

# Inspect a handoff
dlm handoff show latest

# Actively verify a handoff against current Git branch, commit, and file SHA-256 hashes
dlm handoff verify latest

# Consume a verified handoff from the receiving runtime
dlm handoff consume latest --runtime codex
```

## 4. Session & Analytics Commands

```bash
# List recorded telemetry sessions
dlm session list

# Show detailed metrics, skill observability, and events for a session
dlm session show <session-id>

# Generate session analytics report (optionally executing stack quality collectors)
dlm analytics report --session <session-id> --collect-quality

# Compare two sessions or two experiment cohorts
dlm analytics report --compare <session-a>,<session-b>
dlm analytics report --experiment with-tdd,without-tdd
```
