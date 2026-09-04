---
status: accepted
---
# The child never inherits a parent Claude Code session's markers

A Claude Code session sets markers on every Bash tool and hook child, and mclaude launched from one inherits them. One of them, `CLAUDE_CODE_CHILD_SESSION`, turns transcript saving off for an interactive child, and a child with no transcript is one `--resume` cannot find, so Handoff would fail on it. mclaude therefore builds every child environment through one function that copies its own environment, deletes the five names Claude Code's own background daemon spawner deletes before it spawns a claude (`CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_EVAL_INTERVIEW_SESSION`, `CLAUDE_CODE_BRIDGE_SESSION_ID`), and sets the four mclaude variables. The same builder serves Session starts, every other Passthrough, the Refresh trigger, `account add`, `account login` and the `--version` probe, so no spawn path can drift. Nothing is printed when a name was removed. Evidence and the vendor list are in `docs/research/inherited-markers.md` on `research/inherited-markers` (Claude Code 2.1.259, 2026-09-03).

`CLAUDE_CODE_ENTRYPOINT` and `CLAUDE_AGENT_SDK_VERSION` are never on the list. An SDK host such as t3/code sets them on mclaude itself and the child must see them. The remaining markers (`CLAUDE_PID`, `AI_AGENT`, `CLAUDE_EFFORT`, `TRACEPARENT`, the messaging socket pair, `CLAUDE_CODE_EXECPATH`) pass through: the child overwrites or ignores each of them.

The rule also covers a nested mclaude, one started from inside a claude that mclaude launched. mclaude reads none of the variables it sets: `CLAUDE_CONFIG_DIR` and `CLAUDE_SECURESTORAGE_CONFIG_DIR` are always overwritten and never consulted, the Shared home is the user's real `~/.claude` and nothing else, `MCLAUDE_LIMIT_DIR` is set fresh per launch, and `MCLAUDE_ACCOUNT` is output only per [ADR 0011](0011-pin-and-override-are-absolute.md). The inner launch runs Selection like any other and may land on a different Account than its parent; it is a separate conversation.

## Considered options

Set `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1` on every child, the override the docs name for this case. Rejected: it also overrides a user who set the marker on purpose, and it leaves the parent's session id in place until the child replaces it. Deleting what the vendor deletes needs no second opinion.

Forward untouched and warn once on stderr. Rejected: stderr is inherited, so an SDK host reads the line, and the user can do nothing with it. Handoff would still break in the one case where the marker bites.

Refuse the launch. Rejected: Claude Code itself has no nested-session refusal, so mclaude would be stricter than the tool it wraps.
