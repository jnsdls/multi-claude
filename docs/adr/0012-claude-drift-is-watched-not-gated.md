---
status: accepted
---
# Claude Code drift is watched nightly, surfaced only by `version`, and floored at 2.1.223

Three tables in mclaude track a Claude Code release: the scanned flags and the Session start list from the passthrough contract, and the Preferences allowlist from ADR 0010. Claude Code ships several releases a week, so the tables drift. mclaude carries two constants beside them: the Checked version, the release a human last read the three tables against, and the Version floor, 2.1.223, the oldest release whose `--resume` finds a session in any project, which Handoff depends on (`StopFailure` arrived in 2.1.78, `--session-id` in 2.0.73, `--settings` in 1.0.61). A nightly GitHub Actions job installs the latest claude, extracts the flag and command names from `claude --help`, diffs them against a committed fixture, and opens or updates one issue labelled `claude-drift`. It never fails a pull request. The Checked version and the fixture move together, in one PR, only after a human re-reads all three tables. A release may ship with the drift issue open.

The user sees drift in one place, `mclaude version`, which prints the Checked version and the floor beside the resolved claude's own version and marks it `newer than checked`. Nothing is printed at launch: upstream was already one release past the Checked version on the day this was decided, so a per-launch line would be a permanent nag, and under the Agent SDK the host captures stderr. Every drift failure mode degrades on its own: a Session start the table does not know runs unpolled on the Active account, a model flag it does not know makes every Window count, a preference key it does not know stays unsynced.

The floor is the one hard edge. A Session start spawns `claude --version` (20 ms) on the resolved path and exits 69 with one stderr line naming both versions when claude is below 2.1.223, because a Handoff on such a claude loses the conversation silently. Other Passthroughs and `version` still run. Output that does not parse is no evidence, so the launch proceeds, the same reading Unknown gets elsewhere.

## Considered options

A pull-request gate on the `--help` diff. Rejected because it would sit red on Anthropic's cadence, not ours, with nobody in the PR to act on it.

Diffing the top-level keys of a fresh login's `.claude.json` against the allowlist. Rejected as unrunnable and noisy: CI has no Account to log in with, the file has over sixty top-level keys that churn every release, and ADR 0010 already leaves unknown keys alone, so the human re-review covers it.

Diffing the full `--help` text. Rejected because wording changes most weeks; only a flag or command name added or removed touches the tables.

A per-launch stderr line or a `doctor` Reserved word when claude is newer than checked. Rejected: the line is a permanent nag, and `doctor` adds a Reserved word and ships the fixture inside the binary for a check `version` already answers.

Setting the floor at the Checked version. Rejected because it would refuse a claude a week old after every mclaude release.
