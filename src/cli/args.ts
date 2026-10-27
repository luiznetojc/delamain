export interface ParsedCliArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token.startsWith("--")) {
      const eqIdx = token.indexOf("=");
      if (eqIdx !== -1) {
        const key = token.slice(2, eqIdx);
        const val = token.slice(eqIdx + 1);
        flags[key] = val;
      } else {
        const key = token.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("-")) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else if (token === "-h") {
      flags.help = true;
    } else if (token === "-v" || token === "-V") {
      flags.version = true;
    } else {
      positionals.push(token);
    }
  }

  return { positionals, flags };
}

export function splitCsvFlag(value: string | boolean | undefined): string[] {
  if (typeof value !== "string" || value.trim().length === 0) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
