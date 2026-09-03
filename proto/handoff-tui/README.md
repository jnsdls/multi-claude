# Prototype: Handoff in the interactive TUI

Throwaway. Answers [#13](https://github.com/jnsdls/multi-claude/issues/13) on the
[mclaude map](https://github.com/jnsdls/multi-claude/issues/1). Run 2026-09-03
against Claude Code 2.1.259 on macOS, Bun 1.4.0, one real Max account standing in
for both Accounts.

## Parts

- `proxy.ts`: forwards to api.anthropic.com through `ANTHROPIC_BASE_URL`. With
  `INJECT=1` and a `/tmp/mclaude-proto/limit` file it answers `/v1/messages` with a
  429 carrying the `anthropic-ratelimit-unified-*` headers, which is what Claude Code
  turns into the wall. File contents pick the victim: a window name, `msgs:N` (main
  thread request with at least N messages, the mid-turn case), `sub` (subagent
  request, spotted by `cc_is_subagent=true` in its system prompt).
- `hook.ts`: the Limit hook. Payload in, Signal file out, exit 0.
- `mclaude-proto.ts`: the wrapper. Two Account dirs under `/tmp/mclaude-proto/accounts`
  that share `projects/` and borrow the real Keychain item through an empty
  `CLAUDE_SECURESTORAGE_CONFIG_DIR`. Account a talks to the injecting proxy, b to a
  clean one. Launch a with `--session-id` and `--settings`, poll for a `StopFailure`
  Signal, wait for the transcript mtime to settle, kill, relaunch b with `--resume`.
  `PROTO_KILL`, `PROTO_RESET`, `PROTO_RESEND` pick the variant.
- `drive.py`: plays the user's terminal. Runs the wrapper in a pty, types, waits for
  text, reads termios, dumps the screen.
- `run.sh <name> <script>`: one run, logs archived under `/tmp/mclaude-proto/runs/<name>`.

Setup once: two proxies, `INJECT=1 bun proxy.ts 8788` and `INJECT=0 bun proxy.ts 8789`;
Account dirs with a `.claude.json` copied from `~/.claude.json` plus
`hasCompletedOnboarding: true`, and `projects` symlinked to one shared dir.

## Findings

**The TUI has to be killed.** At the wall it renders
`You've hit your session limit · resets 3:45pm` and arms auto-continue
(`Usage limit reached · continuing automatically at 3:45pm · esc or type to cancel`).
It never exits. A prompt typed during the wait is sent anyway and hits the wall again.

**Which signal.** All four tried, five runs each for SIGTERM.

| Signal  | Exit code | Time to exit | Terminal afterwards                        |
| :------ | :-------- | :----------- | :----------------------------------------- |
| SIGTERM | 143       | 220 to 530 ms | cooked; claude emits its own reset sequence |
| SIGINT  | 0         | 265 ms       | cooked                                     |
| SIGHUP  | 129       | 214 ms       | cooked                                     |
| SIGKILL | 137       | 9 to 13 ms   | left raw (`-icanon -echo`, mouse and bracketed paste still on) |

On a clean exit claude writes `?1049l ?2004l ?1000l ?1002l ?1003l ?1006l ?25h [0m`.
The relaunched claude re-initialises the terminal itself, so even after SIGKILL the
new TUI came up fine. The raw state only bites if the relaunch fails, so a reset is
cheap insurance after SIGKILL and unnecessary after SIGTERM.

**Speed.** Signal to relaunch 0.3 to 0.9 s, of which 300 to 400 ms is waiting for the
transcript mtime to settle. New banner on screen 0.9 to 1.3 s after the wall text.
The whole prior conversation, wall message included, is on screen after `--resume`.

**The queued turn is written but not run.** The transcript holds the rejected user
message followed by an assistant entry flagged `isApiErrorMessage` with
`error: "rate_limit"`. After `--resume` the TUI shows both and idles at the prompt.
Nothing re-runs the turn. Same when the wall lands mid-turn between tool calls: the
tool results are saved, the turn stops, the resumed TUI idles.

**A positional prompt on `--resume` submits it.** `claude --resume <id> "<text>"`
resumes and sends the text. Re-sending the rejected prompt got it answered on Account
b; sending `Continue where you left off` after a mid-turn wall finished the task
(`Done.`). When the next prompt lands on a transcript that ended in tool results plus
an error, Claude Code first appends its own `isMeta` pair (`Continue from where you
left off.` and a `<synthetic>` `No response requested.`) to make the message list
valid. No model call for that.

**Session id survives `--resume`.** Same id, same transcript file, so the
`limits/<session-id>/` dir and settings file are reused as is.

**A wall inside a subagent fires `StopFailure`.** Payload carries `agent_id` and
`agent_type: "Explore"` on top of the usual fields. The main thread does not stop: it
gets the tool error and keeps going (its next request went through). After Handoff the
resumed session reports `No completion record was found for background agent ...` and
the model carries on from there.

**A user's own `StopFailure` hook runs alongside.** A `rate_limit` hook in the Account
dir's `settings.json` fired on every run next to the `--settings` one.

**Two artefacts of running this from inside a Claude Code session.** The child
inherits `CLAUDE_CODE_CHILD_SESSION`, which turns transcript saving off and makes
`--resume` fail with `No conversation found with session ID`. The wrapper scrubs
`CLAUDE*` and `ANTHROPIC*` from the child's env. Also `claude auth status` with
`CLAUDE_SECURESTORAGE_CONFIG_DIR=$HOME/.claude` does not find the default Keychain
item; only the empty string maps to the default store.
