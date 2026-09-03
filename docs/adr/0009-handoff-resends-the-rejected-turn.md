---
status: accepted
---
# Handoff kills the TUI and relaunches with the rejected turn as the prompt

At the wall the interactive TUI never exits: it renders the Limit, arms its own auto-continue and waits for the Reset, and a prompt typed meanwhile is sent into the same wall. So Handoff ends the child with SIGTERM, which exits in under a second and restores the terminal, escalates to SIGKILL after a timeout and resets the tty itself only after a SIGKILL. It waits for the transcript's mtime to settle, then relaunches `claude --resume <session-id>` with the original arguments under the Account Selection picked. The session id survives the resume, so the Signal dir and its settings file are reused.

A plain resume shows the rejected turn and idles: the transcript holds the user message followed by the `rate_limit` error entry, and nothing on either side re-runs it. A task the user walked away from would stall on the new Account in silence. So Handoff passes a positional prompt, which Claude Code submits on resume. When the wall hit before the turn started, the prompt is the rejected user message verbatim. When it hit mid-turn, after tool results, the prompt is a fixed nudge to continue from where it left off because the previous attempt stopped at a usage limit. Stated as a rule over the transcript: the last user text message with no assistant content after it is resent verbatim; otherwise the nudge. "No assistant content after it" rather than "followed by the rate_limit error", because a host retry that reaches the old child inside the kill window leaves a dangling user message with no error entry, and that retry is what should run.

## Under a stream-json host

The child writes the failed `result` before `StopFailure` runs, so the host always sees the rejected turn end in Claude Code's own vocabulary. mclaude cannot hide it and does not try. The relaunch then delivers the answer as a turn the host never asked for: `system/init`, the assistant message, a `result`. Claude Code emits `init` on every turn under stream-json, so the swap is invisible to the host; t3/code opens a synthetic turn for the assistant message and closes it on the result. The resend goes into the new child's stdin as a stream-json user message ([ADR 0006](0006-child-inherits-stdio.md)). A queued host line whose user text equals the resend is sent once, so a host that retries the same prompt does not get two answers.

Any `rate_limit` Signal triggers Handoff, a subagent's included. A subagent wall fires `StopFailure` with `agent_id` while the main thread keeps going on the tool error; mclaude does not wait for the main thread to hit the same wall. Running subagents are lost, and the resumed session gets Claude Code's own note that no completion record was found and carries on.

## Considered options

Relaunch idle and let the user re-send. Rejected: unattended agentic sessions are the case Handoff exists for, and they would stop without a word.

Always send the fixed nudge, never the user's text. Rejected: the model then has to infer the request from a transcript whose last entry is an error; re-sending the exact message costs one duplicate line in history and nothing else.

Wait for the main thread's own `StopFailure` after a subagent wall so in-flight tool results land first. Rejected: a second rule and a timer for a case the resumed session already recovers from.

Relaunch idle under a host and let it retry. Rejected: t3/code maps the wall result (`subtype: success`, `is_error: true`) to a completed turn and never retries, so the turn would sit unanswered until a person resends.

Prototypes: branch `proto/handoff-tui` for the TUI and `proto/handoff-sdk` for an Agent SDK host, both against Claude Code 2.1.259 with an injected 429 on `ANTHROPIC_BASE_URL`.
