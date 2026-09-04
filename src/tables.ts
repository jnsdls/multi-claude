// The four tables that track a Claude Code release (ADR 0012). Each carries the
// Checked version in src/version.ts. Move them together, in one PR, after a human
// re-reads all four against `claude --help` and a fresh login's .claude.json.
// The flag arity table is checked against fixtures/claude-help.json by
// test/version.test.ts, so regenerating the fixture shows what to move.

/** Flags mclaude reads without consuming. Value flags take `--flag value` and `--flag=value`. */
export const SCAN_VALUE_FLAGS = new Set([
  "--model",
  "--fallback-model",
  "--output-format",
  "--input-format",
  "--session-id",
  "--settings",
]);

/** Flags with an optional value: `--resume` and `-r` take one only when the next argv is not a flag. */
export const SCAN_OPTIONAL_VALUE_FLAGS = new Set(["--resume", "-r"]);

/** Boolean flags mclaude reads. */
export const SCAN_BOOL_FLAGS = new Set([
  "-p",
  "--print",
  "-c",
  "--continue",
  "--fork-session",
  "--bg",
  "--background",
  "--bare",
  "--safe-mode",
]);

/**
 * claude's own subcommands. A first positional that is one of these is a plain
 * Passthrough (no Selection, no poll). Any other positional is a prompt, which is a
 * Session start. mclaude never refuses an unknown word; drift here only changes
 * whether a launch polls.
 */
export const CLAUDE_COMMANDS = new Set([
  "agents",
  "attach",
  "auth",
  "auto-mode",
  "doctor",
  "gateway",
  "import",
  "install",
  "logs",
  "mcp",
  "plugin",
  "plugins",
  "project",
  "respawn",
  "rm",
  "setup-token",
  "stop",
  "kill",
  "ultrareview",
  "update",
  "upgrade",
]);

/**
 * Every flag claude takes and how many values it consumes: `none` (boolean),
 * `one`, `optional` (a value only when the next token is not a flag) and
 * `variadic` (every following token up to the next flag). A Handoff relaunch
 * walks the user argv with this so a value is never mistaken for the prompt;
 * a flag not listed here is read as boolean.
 */
export type FlagArity = "none" | "one" | "optional" | "variadic";

export const CLAUDE_FLAG_ARITY: Record<string, FlagArity> = {
  "--add-dir": "variadic",
  "--agent": "one",
  "--agents": "one",
  "--allow-dangerously-skip-permissions": "none",
  "--allowed-tools": "variadic",
  "--allowedTools": "variadic",
  "--append-system-prompt": "one",
  "--autocompact": "one",
  "--ax-screen-reader": "none",
  "--background": "none",
  "--bare": "none",
  "--betas": "variadic",
  "--bg": "none",
  "--brief": "none",
  "--chrome": "none",
  "--cloud": "optional",
  "--continue": "none",
  "--dangerously-skip-permissions": "none",
  "--debug": "optional",
  "--debug-file": "one",
  "--disable-slash-commands": "none",
  "--disallowed-tools": "variadic",
  "--disallowedTools": "variadic",
  "--effort": "one",
  "--environment": "one",
  "--exclude-dynamic-system-prompt-sections": "none",
  "--fallback-model": "one",
  "--file": "variadic",
  "--fork-session": "none",
  "--forward-subagent-text": "none",
  "--from-pr": "optional",
  "--help": "none",
  "--ide": "none",
  "--include-hook-events": "none",
  "--include-partial-messages": "none",
  "--input-format": "one",
  "--json-schema": "one",
  "--max-budget-usd": "one",
  "--mcp-config": "variadic",
  "--model": "one",
  "--name": "one",
  "--no-chrome": "none",
  "--no-session-persistence": "none",
  "--output-format": "one",
  "--permission-mode": "one",
  "--permission-prompts": "one",
  "--plugin-dir": "one",
  "--plugin-url": "one",
  "--print": "none",
  "--prompt-suggestions": "optional",
  "--remote-control": "optional",
  "--remote-control-session-name-prefix": "one",
  "--replay-user-messages": "none",
  "--restricted": "none",
  "--resume": "optional",
  "--safe-mode": "none",
  "--session-id": "one",
  "--setting-sources": "one",
  "--settings": "one",
  "--strict-mcp-config": "none",
  "--system-prompt": "one",
  "--system-prompt-snapshot": "one",
  "--teleport": "optional",
  "--tmux": "none",
  "--tools": "variadic",
  "--verbose": "none",
  "--version": "none",
  "--worktree": "optional",
  "-c": "none",
  "-d": "optional",
  "-h": "none",
  "-n": "one",
  "-p": "none",
  "-r": "optional",
  "-v": "none",
  "-w": "optional",
};

/** Top-level .claude.json keys that are Preferences (ADR 0010). */
export const PREFERENCE_KEYS_TOP = [
  "theme",
  "editorMode",
  "autoUpdates",
  "verbose",
  "mcpServers",
  "autoConnectIde",
  "autoInstallIdeExtension",
  "hasIdeOnboardingBeenShown",
  "hasCompletedOnboarding",
] as const;

/** Per-project .claude.json keys that are Preferences (ADR 0010). */
export const PREFERENCE_KEYS_PROJECT = [
  "mcpServers",
  "mcpContextUris",
  "enabledMcpjsonServers",
  "disabledMcpjsonServers",
  "hasTrustDialogAccepted",
  "hasClaudeMdExternalIncludesApproved",
  "hasClaudeMdExternalIncludesWarningShown",
  "allowedTools",
] as const;

/** The three per-project approval booleans that merge as OR. */
export const APPROVAL_BOOLEAN_KEYS = [
  "hasTrustDialogAccepted",
  "hasClaudeMdExternalIncludesApproved",
  "hasClaudeMdExternalIncludesWarningShown",
] as const;

/** The two mcpjson lists that merge as a union. */
export const MCPJSON_LIST_KEYS = ["enabledMcpjsonServers", "disabledMcpjsonServers"] as const;

/** Entries of an Account dir that are never symlinked into the Shared home. */
export const PRIVATE_ENTRIES = new Set([
  ".credentials.json",
  ".credentials.lock",
  ".claude.json",
  ".claude.json.lock",
  "backups",
  "remote-settings.json",
  "policy-limits.json",
  "stats-cache.json",
  "telemetry",
  ".mclaude",
]);
