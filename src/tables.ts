// The three tables that track a Claude Code release (ADR 0012). Each carries the
// Checked version in src/version.ts. Move them together, in one PR, after a human
// re-reads all three against `claude --help` and a fresh login's .claude.json.

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
