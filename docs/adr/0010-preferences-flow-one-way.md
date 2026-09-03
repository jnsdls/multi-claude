---
status: accepted
---
# Preferences flow one way, from the Shared home into each Account dir

Claude Code keeps Preferences (theme, editor mode, user-scope MCP servers, per-project trust and MCP approvals) in the same `.claude.json` that holds the login identity, and rewrites that file whole from memory every few minutes. So each Account dir owns a private copy, and mclaude copies an allowlist of preference keys from the Shared home into it before every Passthrough and at `account add` and `account login`. It takes Claude Code's own `.claude.json.lock` first and skips the copy, silently, when a Run marker shows a launch already running in that dir or the lock is not free within two seconds. mclaude never writes to the Shared `.claude.json`. Two writers on that file would need sync state to avoid a lost update between concurrently running Accounts, and both prior-art tools (caam, claude-swap) landed on one-way for the same reason.

## Consequences

A `/config` change or `claude mcp add -s user` made inside an mclaude session lives in that Account's copy until the next launch replaces it. Preferences are edited with plain `claude` or in `~/.claude.json`. Approval keys are the one exception to Shared wins: the per-project trust and external-includes booleans merge as OR, and the `.mcp.json` enabled and disabled lists as a union with the Shared side winning a conflict, so no Account is re-asked for an approval it already gave. A Handoff copies the current project's approval keys from the source Account into the target before relaunch, so the resumed session opens without a trust dialog. `account add` seeds the new file from the same allowlist plus `hasCompletedOnboarding: true`; the first launch skips onboarding, and seed and sync cannot disagree. Keys outside the allowlist are left alone on both sides, so a preference Claude Code adds later needs a list entry before it syncs.
