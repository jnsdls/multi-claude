// claude is resolved as MCLAUDE_CLAUDE_PATH, then claudePath in config, then claude
// on PATH, then ~/.local/bin/claude. A configured path that is missing never falls
// through.
import { accessSync, constants, statSync } from "node:fs";
import { join } from "node:path";
import { expandTilde, type Settings } from "./config.ts";
import { EXIT, ExitError } from "./exit.ts";
import { homeDir } from "./paths.ts";

function isExecutableFile(p: string): boolean {
  try {
    if (!statSync(p).isFile()) return false;
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveClaude(settings: Pick<Settings, "claudePath">): string {
  if (settings.claudePath) {
    const { value, source } = settings.claudePath;
    const p = expandTilde(value);
    if (isExecutableFile(p)) return p;
    if (source === "config") {
      throw new ExitError(EXIT.CONFIG, `config.json: claudePath "${value}" is not an executable file`);
    }
    throw new ExitError(EXIT.NO_CLAUDE, `MCLAUDE_CLAUDE_PATH "${value}" is not an executable file`);
  }
  const onPath = Bun.which("claude");
  if (onPath) return onPath;
  const local = join(homeDir(), ".local", "bin", "claude");
  if (isExecutableFile(local)) return local;
  throw new ExitError(
    EXIT.NO_CLAUDE,
    "claude not found. Install Claude Code, or set MCLAUDE_CLAUDE_PATH or claudePath in config.json",
  );
}
