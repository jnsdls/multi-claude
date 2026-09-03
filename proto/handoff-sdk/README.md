# Prototype: Handoff under an SDK stream-json session

Throwaway. Answers [#14](https://github.com/jnsdls/multi-claude/issues/14) on the
[mclaude map](https://github.com/jnsdls/multi-claude/issues/1). Run 2026-09-03
against Claude Code 2.1.259 and `@anthropic-ai/claude-agent-sdk` 0.3.259 on macOS,
Bun 1.4.0, one real Max account standing in for both Accounts. Reuses the proxy and
Account dirs from `proto/handoff-tui`.

## Parts

- `host.ts`: stands in for t3/code. A real `query()` with streaming input, the wrapper
  as `pathToClaudeCodeExecutable`, a generated `sessionId`, inline `settings`,
  `settingSources`, `canUseTool`, `includePartialMessages`. Plays a scenario of
  prompts (`wall`, `midturn`, `retry`) and injects the 429 through the proxy where the
  scenario says. Logs every message it receives with a timestamp.
- `mclaude-sdk`: the wrapper, an extensionless bun script because the SDK execs a path
  without a script extension directly. Reads the session id from `--session-id=` or
  `--resume=`, merges the host's inline `--settings` JSON with the Limit hook into
  `limits/<sid>/settings.json`, launches Account a. On a `StopFailure` Signal: stop
  forwarding stdin, wait for the transcript to settle, SIGTERM, relaunch Account b
  with `--resume=<sid>`, push the resend into the new child's stdin, flush queued host
  lines. `PROTO_STDIN=pipe|late`, `PROTO_REPLAY_INIT`, `PROTO_RESEND` pick the variant.
- `proxy.ts`, `hook.ts`: from the TUI prototype. The proxy gained `main:N`, a wall on
  the first main-thread request with at least N messages.
- `run.sh <name> <scenario>`: one run, logs archived under `/tmp/mclaude-proto/runs/<name>`.

## Findings

**The SDK passes `settings` on argv.** `--settings <json>`, built through the same
`extraArgs` path as everything else; the control protocol's `initialize` carries hooks
callbacks, system prompt and agents, not settings. So "last `--settings` wins" applies
and the ADR 0008 merge covers it. The hook fired under `-p` stream-json in every run.

**The host gets the error result before mclaude gets the Signal.** The child writes
`rate_limit_event`, the synthetic assistant message and `result` (`subtype: success`,
`is_error: true`), then runs `StopFailure`; the Signal file landed 18 to 50 ms after the
result. Nothing mclaude does can hide the failed turn from the host.

**The host does not notice the swap.** Claude Code emits `system/init` at the start of
every turn under stream-json, so the relaunched child's init looks like any other. No
stream error, no stderr. The SDK only errors when *mclaude* exits or dies by signal,
and mclaude outlives the swap.

**A positional prompt is ignored under `--input-format stream-json`.** With or without
stdin open: no output, exit 0. The resend has to go into the child's stdin, so mclaude
must hold a pipe on this path. stdout can stay inherited.

**No initialize replay needed.** Child 2 never saw the host's `initialize` and still
sent `can_use_tool` to the host (verified with `permissionMode: default`), ran tools,
and answered. Replaying it changed nothing visible.

**The resend shows up as an unsolicited turn.** About 1.4 s after the error result:
init, assistant, result. t3/code opens a synthetic turn for an assistant message
outside a turn and closes it on the result. `turnStatusFromResult` maps the wall's
`subtype: success` to `completed`, so t3/code never retries by itself.

**Mid-turn wall.** After two of three tool calls, the nudge on resume ran the third and
delivered `one, two, three` as the unsolicited turn.

**Host retry inside the kill window is swallowed.** A retry 20 ms after the error
result reached child 1, which died before answering. The transcript then ended in a
dangling user message with no error after it, the prototype's rule picked the nudge,
and Claude Code prepended its own `No response requested.` on resume. The rule should
be "resend the last user text message with no assistant content after it". A retry
after the kill is queued and flushed to child 2 after the resend, so both run.

**Relaunch idle** (`PROTO_RESEND=0`): the host sees nothing at all; the next host
message runs on Account b; the rejected turn stays in the transcript unanswered.

**Signal to relaunch** 670 to 890 ms, of which about 300 ms is the transcript settle.

**SessionStart hook is visible to the host** as `system/hook_started` and
`hook_response`; t3/code maps them to `hook.started` and `hook.completed` events.
