import { join } from "node:path";

/** The literal home directory. Never resolved through symlinks (ADR 0004). */
export function homeDir(): string {
  const h = process.env.HOME;
  if (!h) throw new Error("HOME is not set");
  return h;
}

/** mclaude's state root: ~/.mclaude or the literal MCLAUDE_HOME. */
export function mclaudeHome(): string {
  return process.env.MCLAUDE_HOME || join(homeDir(), ".mclaude");
}

/** The Shared home: the user's real ~/.claude, always. mclaude reads none of the variables it sets. */
export function sharedHome(): string {
  return join(homeDir(), ".claude");
}

/** The Shared home's .claude.json. Claude Code keeps it at ~/.claude.json when no config dir is set. */
export function sharedClaudeJson(): string {
  return join(homeDir(), ".claude.json");
}

export function configPath(): string {
  return join(mclaudeHome(), "config.json");
}
export function activePath(): string {
  return join(mclaudeHome(), "active");
}
export function pinnedPath(): string {
  return join(mclaudeHome(), "pinned");
}
export function accountsDir(): string {
  return join(mclaudeHome(), "accounts");
}
export function accountDir(id: string): string {
  return join(accountsDir(), id);
}
export function stateDir(): string {
  return join(mclaudeHome(), "state");
}
export function recordPath(id: string): string {
  return join(stateDir(), `${id}.json`);
}
export function limitsDir(): string {
  return join(mclaudeHome(), "limits");
}
export function signalDir(sessionId: string): string {
  return join(limitsDir(), sessionId);
}
export function runMarkerDir(accountDirPath: string): string {
  return join(accountDirPath, ".mclaude", "run");
}
