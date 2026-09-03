---
status: accepted
---
# One Record file per Account, written lock-free with newest-reading-wins

mclaude's state is one JSON file per Account at `state/<id>.json` plus a one-line `active` file naming the Active account, not one shared state file. Concurrent sessions run on different Accounts almost all the time, so per-Account files mean a session only ever rewrites its own Record and cannot clobber a sibling's fresh usage reading. Writes go to a temp file in the same directory and rename into place; before writing, the writer re-reads the current file and applies only its own change on top, never replacing a usage reading with an older `fetchedAt` or a Limit with an older `reportedAt`. A torn or unparseable file counts as absent. No file lock is taken anywhere, because a lock that hangs on a headless host is a worse failure than a lost cache line.

## Consequences

`list` has to read N files. `remove` deletes the Record, the dir and, if it matches, the `active` pointer. Every file carries `version: 1` and ISO 8601 UTC timestamps; Claude Code's millisecond epochs are converted on the way in. `config.json` at the root is hand-edited and never rewritten by a launch.
