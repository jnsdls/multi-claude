---
status: accepted
---
# The child inherits stdio; mclaude never sits in the data path

Claude Code runs with mclaude's own stdin, stdout and stderr file descriptors. mclaude neither pipes nor tees them. This is what makes Passthrough byte-for-byte for free: the TUI's raw mode, SDK hosts writing stream-json to stdin and reading it from stdout, and shell pipes all behave exactly as they do against `claude` itself. The cost is that mclaude cannot observe stream-json, so it never sees a `rate_limit_event`. Limits reach mclaude through one channel in both interactive and headless modes: the `StopFailure` hook installed in the Shared home, which writes a file into the directory named by `MCLAUDE_LIMIT_DIR`. Hooks run under `-p` as well as in the TUI, so one code path covers both.

mclaude forwards `SIGTERM` and `SIGHUP` to the child. `SIGINT` from a terminal reaches the child through the process group already. On exit, mclaude mirrors the child's exit code; when the child dies by signal, mclaude re-raises that signal on itself so a parent checking `signal` sees the truth.

## Considered options

Tee stdout in headless mode and parse stream-json for `rate_limit_event`. Rejected because it gives mclaude two Limit code paths and puts a copy loop between an SDK host and Claude Code on the hot path. It stays the fallback if a prototype shows the hook not firing under `-p`.

Pipe stdin so mclaude can replay a host's control stream to a relaunched child after a Handoff. Not decided here. The SDK Handoff ticket can amend this ADR for the headless path with evidence; the TUI path stays inherit regardless.
