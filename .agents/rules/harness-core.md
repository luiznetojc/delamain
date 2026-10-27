# Delamain Harness Core Rules

1. **Evidence Over Claims**: Every completion report or handoff must include verifiable command exit codes and affected file paths.
2. **File Ownership**: When multiple agents operate in parallel across worktrees, each agent must restrict edits strictly to its assigned file scope.
3. **No Silent Destructive Operations**: Never overwrite developer modifications outside `<!-- dlm:managed:start --> ... <!-- dlm:managed:end -->` markers without an explicit backup.
4. **Secret Redaction**: Never log or persist API keys, tokens, passwords, or connection strings in telemetry or handoff artifacts.
