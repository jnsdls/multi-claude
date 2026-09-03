---
status: accepted
---
# The Limit hook rides on `--settings` per launch, never in a settings file

mclaude needs a `StopFailure` hook and a `SessionStart` hook in every Session start it launches, and nowhere else. Editing the Shared home `settings.json` would put mclaude's entry into a file it does not own, need a marker so uninstall can find it again, and still go silent under `--setting-sources` without `user`. Instead mclaude writes the two entries to `limits/<session-id>/settings.json` inside the Signal dir at each launch and appends `--settings <that path>` next to `--session-id`. Claude Code merges `--settings` hooks above the user's own files, keeps them under `--restricted` and `--setting-sources`, and the file dies with the dir when the child exits. Nothing is installed, so there is nothing to uninstall.

The hook command is the absolute path of the running mclaude binary followed by the Reserved word `hook`, rewritten per launch so an upgrade or a move never leaves a stale path, and never resolved through PATH because the t3/code Binary path runs mclaude without PATH. The command reads all of stdin, no-ops unless `MCLAUDE_LIMIT_DIR` is set, writes the Signal with tmp plus rename, and exits 0 whatever happens.

## Consequences

Claude Code takes the last `--settings` on argv, so a user's own `--settings` would replace mclaude's. The scan-only read spots it, mclaude loads that value the way Claude Code does (a path or inline JSON), appends its two hook entries to the `hooks` key, writes the result to the per-session file, and passes only that. Every other key stays the user's. A value mclaude cannot parse is forwarded untouched with one stderr line saying Limit detection is off.

`--bare` and `--safe-mode` skip hooks; mclaude warns once on stderr when the scan sees either. `disableAllHooks` in the user's settings also silences the hook, and mclaude does not read that file to say so.

## Considered options

Install into the Shared home `settings.json` with a marker on each entry and a `remove` path. Rejected: mclaude would write a file Claude Code also rewrites, and hosts that pass `--setting-sources` without `user` would never load it.

Inline JSON on argv. Rejected: the entry shows in `ps` and in every payload's argv, and a merged user document makes it long.

A shell one-liner instead of `mclaude hook`. Rejected: no atomic write, no Account id in the Signal, and harder to test than a TypeScript function.
