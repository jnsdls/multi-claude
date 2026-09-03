---
status: accepted
---
# The child inherits stdio; mclaude never sits in the data path

Claude Code runs with mclaude's own stdin, stdout and stderr file descriptors. mclaude neither pipes nor tees them. This is what makes Passthrough byte-for-byte for free: the TUI's raw mode, SDK hosts writing stream-json to stdin and reading it from stdout, and shell pipes all behave exactly as they do against `claude` itself. The cost is that mclaude cannot observe stream-json, so it never sees a `rate_limit_event`. Limits reach mclaude through one channel in both interactive and headless modes: the Limit hook, which writes a Signal into the directory named by `MCLAUDE_LIMIT_DIR`. The hook reaches Claude Code by `--settings` on every launch, not by a settings file; see [ADR 0008](0008-limit-hook-rides-on-settings-flag.md). Hooks run under `-p` as well as in the TUI, so one code path covers both.

mclaude forwards `SIGTERM` and `SIGHUP` to the child. `SIGINT` from a terminal reaches the child through the process group already. On exit, mclaude mirrors the child's exit code; when the child dies by signal, mclaude re-raises that signal on itself so a parent checking `signal` sees the truth.

## Considered options

Tee stdout in headless mode and parse stream-json for `rate_limit_event`. Rejected because it gives mclaude two Limit code paths and puts a copy loop between an SDK host and Claude Code on the hot path. It stays the fallback if a prototype shows the hook not firing under `-p`.

Pipe stdin so mclaude can push a Handoff's resend into the new child. Adopted for the headless path only, on the evidence of the SDK Handoff prototype (`proto/handoff-sdk`, 2026-09-03). A positional prompt is ignored under `--input-format stream-json`, so the resend has nothing to ride on but the child's stdin. When the scan sees that flag, mclaude reads the host's stdin itself and forwards each line to the child; stdout and stderr stay inherited, so the host still reads Claude Code's own bytes. From the Signal until the new child is up, host lines queue in mclaude and flush after the resend. The host's `initialize` request is not replayed: the relaunched child routes `can_use_tool` and the rest of the control protocol without it. The TUI path stays inherit.
