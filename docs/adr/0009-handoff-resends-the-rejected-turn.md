---
status: accepted
---
# Handoff kills the TUI and relaunches with the rejected turn as the prompt

At the wall the interactive TUI never exits: it renders the Limit, arms its own auto-continue and waits for the Reset, and a prompt typed meanwhile is sent into the same wall. So Handoff ends the child with SIGTERM, which exits in under a second and restores the terminal, escalates to SIGKILL after a timeout and resets the tty itself only after a SIGKILL. It waits for the transcript's mtime to settle, then relaunches `claude --resume <session-id>` with the original arguments under the Account Selection picked. The session id survives the resume, so the Signal dir and its settings file are reused.

A plain resume shows the rejected turn and idles: the transcript holds the user message followed by the `rate_limit` error entry, and nothing on either side re-runs it. A task the user walked away from would stall on the new Account in silence. So Handoff passes a positional prompt, which Claude Code submits on resume. When the wall hit before the turn started, the prompt is the rejected user message verbatim. When it hit mid-turn, after tool results, the prompt is a fixed nudge to continue from where it left off because the previous attempt stopped at a usage limit.

Any `rate_limit` Signal triggers Handoff, a subagent's included. A subagent wall fires `StopFailure` with `agent_id` while the main thread keeps going on the tool error; mclaude does not wait for the main thread to hit the same wall. Running subagents are lost, and the resumed session gets Claude Code's own note that no completion record was found and carries on.

## Considered options

Relaunch idle and let the user re-send. Rejected: unattended agentic sessions are the case Handoff exists for, and they would stop without a word.

Always send the fixed nudge, never the user's text. Rejected: the model then has to infer the request from a transcript whose last entry is an error; re-sending the exact message costs one duplicate line in history and nothing else.

Wait for the main thread's own `StopFailure` after a subagent wall so in-flight tool results land first. Rejected: a second rule and a timer for a case the resumed session already recovers from.

Prototype: branch `proto/handoff-tui`, run against Claude Code 2.1.259 with an injected 429 on `ANTHROPIC_BASE_URL`.
