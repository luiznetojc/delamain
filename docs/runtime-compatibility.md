# Runtime Compatibility Matrix (`docs/runtime-compatibility.md`)

Delamain differentiates three levels of capability knowledge for every runtime adapter:
- **`declared`**: Documented in the runtime's specification or CLI interface.
- **`detected`**: Confirmed present on the host machine via binary inspection (`--version`, `--help`, `features list`).
- **`verified`**: Proven operational via contract check.

## Verified Host Compatibility (macOS Environment)

| Capability | Claude Code (`2.1.304`) | OpenAI Codex (`0.163.0`) | Antigravity (`agy 1.4.4`) | Orca (`1.4.235`) |
| :--- | :--- | :--- | :--- | :--- |
| **Instruction Discovery** | `CLAUDE.md`, `.claude/rules/*.md` (`verified`) | `AGENTS.md` hierarchical (`verified`) | `GEMINI.md`, `AGENTS.md`, `.agents/rules/*.md` (`verified`) | Via launched runtime (`verified`) |
| **Skills (`SKILL.md`)** | `.claude/skills/*/SKILL.md` (`verified`) | `.agents/skills/*/SKILL.md` (`verified`) | `.agents/skills/*/SKILL.md` (`verified`) | `orca skills get <name>` (`verified`) |
| **Lifecycle Hooks** | `.claude/settings.json` (`verified`) | `.codex/hooks.json` (`hooks stable true`, `verified`) | `.agents/hooks.json` (`verified`) | N/A |
| **Subagents** | `--agents`, `.claude/agents/` (`verified`) | `multi_agent stable true` (`verified`) | `define_subagent` / `invoke_subagent` (`verified`) | `orca orchestration worker-start` (`verified`) |
| **Structured Events** | `--print --output-format=stream-json` (`verified`) | `codex exec --json --output-schema` (`verified`) | `agy --print --output-format=stream-json` (`verified`) | `orca ... --json` (`verified`) |
| **Session Resume** | `--resume`, `--continue`, `--fork-session` (`verified`) | `codex resume`, `codex exec resume`, `codex fork` (`verified`) | `--continue`, `--conversation <id>` (`verified`) | `orca orchestration run-use` (`verified`) |
| **Model & Effort Selection** | `--model`, `--effort` (`verified`) | `-m`, `-c model_reasoning_effort=...` (`verified`) | `--model`, `--effort` (`verified`) | `worker-start --model --effort` (`verified`) |
| **Worktree Isolation** | `-w / --worktree` (`verified`) | `--worktree` (`worktrees stable true`, `verified`) | `workspace: branch / share` (`partial`, `verified`) | `orca worktree create` (`verified`) |
| **Native Sandbox** | `--permission-mode`, `--restricted` (`verified`) | `-s read-only \| workspace-write` (`verified`) | `--sandbox`, `--mode` (`verified`) | Delegated to agent host |
