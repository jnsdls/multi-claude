// The one child-environment builder every claude spawn goes through (ADR 0013).

/** The markers Claude Code's own daemon spawner deletes before spawning a claude. */
export const SCRUBBED_MARKERS = [
  "CLAUDECODE",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_EVAL_INTERVIEW_SESSION",
  "CLAUDE_CODE_BRIDGE_SESSION_ID",
] as const;

/** The variables mclaude sets. Always overwritten, never read back. */
export const MCLAUDE_CHILD_VARS = [
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_SECURESTORAGE_CONFIG_DIR",
  "MCLAUDE_LIMIT_DIR",
  "MCLAUDE_ACCOUNT",
] as const;

/** mclaude's own test seam. Never reaches a child, so claude keeps talking to the real endpoint. */
export const MCLAUDE_PRIVATE_VARS = ["MCLAUDE_USAGE_URL"] as const;

export interface ChildEnvOptions {
  /** The Account dir, passed byte-identical every launch. Omitted only for the bare `--version` probe with no Account. */
  accountDir?: string;
  accountId?: string;
  /** The Signal dir. Set on Session starts only; the hook no-ops without it. */
  limitDir?: string;
  /** Extra variables for one spawn, such as the Refresh trigger's base URL. */
  extra?: Record<string, string>;
  base?: NodeJS.ProcessEnv;
}

/**
 * Copies mclaude's environment, deletes the five session markers, keeps everything
 * else (CLAUDE_CODE_ENTRYPOINT, CLAUDE_AGENT_SDK_VERSION and USER included), and sets
 * the two config dir variables, MCLAUDE_LIMIT_DIR and MCLAUDE_ACCOUNT. Nothing is
 * printed when a name was removed.
 */
export function buildChildEnv(opts: ChildEnvOptions): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.base ?? process.env)) {
    if (v !== undefined) env[k] = v;
  }
  for (const name of SCRUBBED_MARKERS) delete env[name];
  for (const name of MCLAUDE_CHILD_VARS) delete env[name];
  for (const name of MCLAUDE_PRIVATE_VARS) delete env[name];
  if (opts.accountDir !== undefined) {
    env.CLAUDE_CONFIG_DIR = opts.accountDir;
    env.CLAUDE_SECURESTORAGE_CONFIG_DIR = opts.accountDir;
  }
  if (opts.accountId !== undefined) env.MCLAUDE_ACCOUNT = opts.accountId;
  if (opts.limitDir !== undefined) env.MCLAUDE_LIMIT_DIR = opts.limitDir;
  if (opts.extra) Object.assign(env, opts.extra);
  return env;
}
