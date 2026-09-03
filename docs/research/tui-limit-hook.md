# Which hook fires on a Limit in the interactive TUI

Research for [#4](https://github.com/jnsdls/multi-claude/issues/4), part of the
[#1](https://github.com/jnsdls/multi-claude/issues/1) map. Written 2026-09-03
against Claude Code 2.1.259.

Sources, in order of trust:

- `hooks.md` and `hooks-guide.md` from code.claude.com/docs/en (fetched as raw
  Markdown), plus `interactive-mode.md` and `errors.md` for the wall behaviour.
- `strings` on the installed binary at
  `~/.local/share/claude/versions/2.1.259` (arm64 Mach-O, Bun bundle). Quoted
  identifiers below are the minified names in that build and will move between
  releases; the shapes and string literals are what matter.
- A live run of `claude -p` with a `--settings` file that logs every hook
  payload to a file. No change to `~/.claude`.
- Prior art: [inulute/cux](https://github.com/inulute/cux)
  `internal/hooks/hooks.go` and issues #39, #49;
  [fairy-pitta/cc-account-switcher](https://github.com/fairy-pitta/cc-account-switcher)
  `hooks/ccs-rate-hook.sh`.

## Short answer

`StopFailure` with `error: "rate_limit"`. It fires once per rejected turn, the
TUI does not exit, and the payload carries `session_id`, `transcript_path` and
the rendered wall text ("You've hit your session limit · resets 3:45pm"), but
not the structured window type or the reset epoch. The hook can only signal
mclaude by side effect; its stdout and exit code are discarded. Use
`--session-id <uuid>` at launch so mclaude already knows the id before any
hook runs.

## 1. Which event fires

### The docs

`StopFailure` "runs instead of Stop when the turn ends due to an API error"
and exists "to log failures, send alerts, or take recovery actions when Claude
can't complete a response due to rate limits, authentication problems, or
other API errors" (hooks.md, StopFailure). The matcher for `StopFailure` is
the error type; the documented values are `rate_limit`, `overloaded`,
`authentication_failed`, `oauth_org_not_allowed`, `account_on_hold`,
`billing_error`, `invalid_request`, `model_not_found`, `server_error`,
`max_output_tokens`, `unknown` (hooks-guide.md, matcher table).

Two events look tempting and are wrong:

- `Notification` has no rate-limit type. The binary's notification enum is
  `permission_prompt, idle_prompt, auth_success, elicitation_dialog,
  agent_needs_input, agent_completed, elicitation_url_dialog,
  worker_permission_prompt, push_notification, computer_use_enter,
  computer_use_exit, quota_auto_resume_fired, quota_auto_resume_stale,
  quota_auto_resume_disabled`. The three `quota_auto_resume_*` types fire when
  a wait ends (reset reached, stale after sleep, or cancelled), never when the
  limit is hit (hooks.md, Notification table).
- `PostToolUseFailure` fires when a tool throws. A 429 on the model call is
  not a tool failure. cux's `usage.go` comments on exactly this: the session
  limit "blocks at the UI layer before any tool use, so PostToolUseFailure
  never fires".

### The binary

The chain from a 429 to the hook, read from `strings` on 2.1.259:

1. A 429 whose response carries `anthropic-ratelimit-unified-*` headers is
   turned into an assistant message flagged `isApiErrorMessage` with
   `error: "rate_limit"`. The content is the wall text from the message
   builder (see section 2), or a fallback when no window type is present:

   ```js
   if(e instanceof Wt&&e.status===429){let y=S7(Tt()),v=Xin(e),...
     if(y&&v&&!I){let K=yot(v,n);if(K)return Vo({content:K,error:"rate_limit",quotaLimits:can(e)});
       return Vo({content:DR,error:"rate_limit"})}
   ```

   `Xin(e)` reads `anthropic-ratelimit-unified-representative-claim` into
   `rateLimitType`, `-unified-reset` into `resetsAt`, and the overage headers,
   and sets `status: "rejected"`.

2. The query loop returns that message as the turn result and calls the
   StopFailure runner before returning `{reason:"api_error", errorKind:kr.error}`:

   ```js
   if(kr?.isApiErrorMessage){ ... return WNe(kr,Ot),{reason:"api_error",errorKind:kr.error,isTransient:dbt(kr)}}
   ```

3. `WNe` is `executeStopFailureHooks`. It builds the payload from the common
   fields plus three event fields, and uses `error` as the matcher query:

   ```js
   async function WNe(e,n,r=Td){ ...
     let o=Or(e.message.content,`\n`).trim()||void 0,
         f=e.error??"unknown",
         p={...Ea(n.session,ne(),void 0,n),hook_event_name:"StopFailure",error:f,error_details:e.errorDetails,last_assistant_message:o};
     await dA({...,hookInput:p,timeoutMs:r,matchQuery:f,...})}
   ```

The hook registry lists `StopFailure` among the events whose output is
consumed locally only ("runs_locally" set) and its default timeout is 120 s
(`Uyn` map: `Stop:120, StopFailure:120`).

The same path fires for weekly, Opus and Sonnet windows. `rateLimitType` from
the header is one of `five_hour`, `seven_day`, `seven_day_opus`,
`seven_day_sonnet`, `seven_day_overage_included`, `overage`; the hook sees the
same `error: "rate_limit"` for all of them and has to read the wall text to
tell them apart.

## 2. Payload fields

Common fields the hook always gets (hooks.md, Common input fields; confirmed
by the live run): `session_id`, `transcript_path`, `cwd`, `hook_event_name`,
and after the first prompt `prompt_id`. `permission_mode` is present on some
events. In the live `-p` run the `SessionStart` payload was

```json
{"session_id":"7c1c9a3e-1b2d-4c5e-8f6a-0123456789ab",
 "transcript_path":"/Users/jnsdls/.claude/projects/-private-tmp-mcl-test/7c1c9a3e-1b2d-4c5e-8f6a-0123456789ab.jsonl",
 "cwd":"/private/tmp/mcl-test","hook_event_name":"SessionStart","source":"startup"}
```

StopFailure adds:

| Field | Value on a subscription limit | Source |
| :-- | :-- | :-- |
| `error` | `"rate_limit"` | binary, `f=e.error??"unknown"` |
| `error_details` | absent. The 429 branch builds the message with `content`, `error` and `quotaLimits` only; `errorDetails` is set on other error kinds (prompt-too-long carries the token counts) | binary, `Vo({content:K,error:"rate_limit",quotaLimits:can(e)})` |
| `last_assistant_message` | the rendered wall text, joined with newlines and trimmed | binary, `o=Or(e.message.content,"\n").trim()` |

The wall text is built by `UO(limitName, suffix, ...)`, which returns
`` `You've hit your ${e}${n}${f}` ``. `limitName` comes from
`HF = {five_hour:"session limit", seven_day:"weekly limit",
seven_day_opus:"Opus limit", seven_day_sonnet:"Sonnet limit",
seven_day_overage_included:"Fable limit", overage:"usage credit limit"}`, and
the suffix is `` ` · resets ${Iu(resetsAt,true)}` `` when the header carried a
reset. errors.md lists the four shapes users see:

```text
You've hit your session limit · resets 3:45pm
You've hit your weekly limit · resets Mon 12:00am
You've hit your Opus limit · resets 3:45pm
You've hit your Sonnet limit · resets 3:45pm
```

Two more suffixes can appear: ` · progress saved` when the auto-continue
checkpoint ran, and admin or usage-credit hints on Team and Enterprise seats
(`run /usage-credits to ask your admin for a higher limit`). On a Pro or Max
seat that switched to usage credits and then ran out, the text is `You've hit
your usage limit` or `You've hit your monthly spend limit`.

So the hook gets the limit kind and reset time as English, not as fields.
Parsing `^You've hit your (session|weekly|Opus|Sonnet|Fable) limit` is stable
enough to classify; the reset string is a local time with no date for the 5h
window, which is not worth parsing. mclaude has the structured version from
its own usage poll (`GET /api/oauth/usage`, per the #1 charting notes) and
should treat the hook as a trigger, not as the source of Reset.

Neither `rateLimitType` nor `resetsAt` reaches the hook. They exist in
`quotaLimits` on the internal message and in the `rate_limit_event` stream-json
message, which is the headless path.

## 3. Does the TUI exit at the wall?

No. Three sources agree.

interactive-mode.md, "Wait for a usage limit to reset": "Claude Code waits in
the open session and continues the task on its own after the limit resets.
Automatic continue is on by default in interactive sessions signed in with a
claude.ai subscription. Requires Claude Code v2.1.234 or later." The footer
shows `Usage limit reached · continuing automatically at 3:45pm · esc to
cancel`. When the wait is not started automatically (weekly reset more than 24
hours out, Opus or Sonnet limit while running another family, remote control,
or `autoContinueAtUsageLimit: false`), "Claude Code opens the usage-limit
options menu once per reset window".

errors.md: "Claude Code blocks further requests until the reset time shown in
the message." The process stays up and the prompt stays usable; a new prompt
"runs your prompt instead of waiting" and hits the same 429.

The binary: `openRateLimitOptions` in the REPL controller submits
`"/rate-limit-options"` on the user's behalf, keyed by
`Wd().resetsAt` so it fires once per reset window, and
`armRateLimitAutoContinue` runs `performRateLimitCheckpoint({trigger:
"rate_limited"})` (the "progress saved" suffix). Nothing in that path calls
exit. The Notification types `quota_auto_resume_fired`, `_stale`, `_disabled`
exist precisely because the process is still alive to fire them later.

Consequences for mclaude:

- The hook fires while the Claude process is still running and will keep
  running. The wrapper has to kill it (or let it idle) and relaunch with
  `--resume <session_id>`. cux does the same: the `RateLimited` signal sets a
  pending swap and `gracefulExit` stops the child.
- The transcript is flushed by the time StopFailure runs; cux's wrapper
  comment says "a StopFailure implies a session existed and a turn was
  attempted, so treat a hook-reported session as resumable". It still calls
  `waitForTranscript` before relaunching, which is cheap insurance.
- If mclaude relaunches, the old process's auto-continue wait dies with it.
  That is the wanted outcome, since the point is to not wait.
- When every Account is at its wall, letting the child live and wait is the
  right fallback. That is the `--wait` mode listed as unspecified in #1, and
  Claude Code implements it for free as long as mclaude does not kill the
  child.

## 4. How the hook tells the wrapper

Docs (hooks.md, Exit code 2 behavior per event): `StopFailure` "Output and
exit code are ignored, except `terminalSequence`". The JSON output section
repeats that "events that discard hook output entirely, like StopFailure,
ignore your JSON on every exit code". So stdout JSON cannot carry anything to
mclaude, and even if it could, stdout goes to Claude Code, not to the parent
process.

What is left is a side effect. The hook process "inherits the parent
environment" (hooks.md, Common input fields), and Claude Code inherits
mclaude's environment, so mclaude can pass a directory or socket path in an
env var and the hook can write there. Options, cheapest first:

1. **Write a file into a directory named by env.** cux does this:
   `CUX_WRAPPED=1` gates the hook, `CUX_WRAPPER_PID` names the signal
   directory, and the wrapper polls at 100 ms. Atomic rename makes it safe.
   The hook must exit 0 quickly and no-op when the env var is missing so the
   settings entry is harmless under plain `claude`.
2. **Send a signal to the wrapper PID.** Same env plumbing, no polling, but
   carries no payload and races with the file write if both are used. Only
   worth it if polling latency matters, and it does not at one event per
   turn.
3. **Unix socket or FIFO path in env.** Removes polling and carries the
   payload. More code in both halves for the same information as option 1.

Take option 1. Name the env var for what it is (`MCLAUDE_SIGNAL_DIR` or
similar), write the raw stdin JSON plus the Account id to a file named by
event and timestamp, and have the wrapper watch the directory. The hook should
also copy `session_id` in, even though mclaude already knows it, so a signal
file is self-describing when debugging.

The hook command itself should be `mclaude hook` (the same binary) rather
than a shell script, matching cux's `cux hook rate-limit`. It has to read all
of stdin before exiting or Claude Code logs a broken pipe.

Settings placement: the hook entry lives in the settings file mclaude
controls, which per ADR 0001 is the per-Account `CLAUDE_CONFIG_DIR`. The
`--settings <file-or-json>` flag also loads "additional settings" and worked
in the live run; it is the cleaner choice because it leaves the user's
settings alone and needs no install step. The hook should still gate on the
env var, since `--settings` can be copied into other invocations.

Matcher: `"matcher": "rate_limit"` on `StopFailure`. Not `.*`.

## 5. How mclaude learns the session id

Two working paths, and mclaude should use both.

`claude --session-id <uuid>` is a documented option ("Use a specific session
ID for the conversation (must be a valid UUID)", `claude --help`). The live
run started a fresh session under the given UUID and every hook payload
carried it, including `SessionStart` with `source: "startup"`. A second launch
with the same UUID failed at startup with `Error: Session ID
7c1c9a3e-1b2d-4c5e-8f6a-0123456789ab is already in use.` and no hook fired, so
mclaude must generate a new UUID per launch and never reuse one. Handoff uses
`--resume <id>`, which keeps the id, so the hook keeps reporting the same
`session_id` across Accounts. `--fork-session` would mint a new id and should
not be used for Handoff.

`SessionStart` is the belt to that suspenders. It "runs when Claude Code
starts a new session or resumes an existing session" and receives `source`
(`startup`, `resume`, `clear`, `compact`, `fork`) plus optionally `model`,
`agent_type`, `session_title`, and on resume the cache-cost fields
(hooks.md, SessionStart input). A user typing `/clear` inside the TUI mints a
new session id that `--session-id` knows nothing about; only a `SessionStart`
hook with `source: "clear"` catches that. cux reads it for the same reason
("so the wrapper does not have to fall back to mtime-scanning the transcript
directory").

The `SessionStart` payload also carries `transcript_path`, which is the
`.jsonl` under `~/.claude/projects/<cwd-slug>/<session_id>.jsonl` (the live
run put it under `-private-tmp-mcl-test`). With one config dir per Account
that path lives inside the Account's dir unless the projects directory is
symlinked into the Shared home, which the #1 charting notes say it is.

## 6. Prior-art pitfalls

**cux #39 (fixed in 0.3.5, 0.3.6).** cux installed `PostToolUseFailure` and
`StopFailure` hooks with `matcher: ".*"`, and the classifier ran a flat
substring match for "limit reached" and "rate limit" over every field. Two
real swaps on healthy accounts: a `Concurrent subagent limit reached. ... Do
not retry.` tool error, and a `WebFetch` failure whose fetched page was
Pinterest's developer docs, which contain the words "Rate limits". The second
restart killed 20 running subagents. The fix in cux is an ordered classifier
with a foreign-content guard, a denylist, strong phrases on any event, and
technical tokens only on `StopFailure`. mclaude avoids the whole class by not
registering `PostToolUseFailure` at all and by matching `StopFailure` on
`rate_limit`, so no text classification is needed. The `.*` matcher on
`PostToolUseFailure` matches tool names, so there is no subset that means
"account limit"; the issue thread says so too.

**cux #49 (open).** Hook-driven checks only run at hook boundaries. A single
long agentic turn can burn from 90% to the hard cap with no `Stop` in
between, so a threshold near 100% never fires preventively. mclaude's sticky
Selection with a switch threshold has the same exposure; the reactive
`StopFailure` path is the backstop and has to be reliable on its own.

**cc-account-switcher.** Its `PreToolUse` hook (`hooks/ccs-rate-hook.sh`)
does not detect a limit at all. It reads a usage cache written by the
statusline, and when the 5h utilization is over a threshold (default 80%) it
runs `ccs rate-check --auto-switch` before every tool call. The hook fails
open on every error. That is a polling design bolted onto the most frequent
hook event; the useful borrowings are the fail-open discipline and the
fast-path check against a cache before spawning anything.

**Exit code 1 is not a block.** hooks.md warns that "Claude Code treats exit
code 1 as a non-blocking error and proceeds with the action". Irrelevant for
`StopFailure`, which ignores exit codes, but it matters if mclaude ever adds a
`UserPromptSubmit` gate: only exit 2 or JSON `decision: "block"` stops a
prompt.

**Transcript lag.** `transcript_path` "is written asynchronously and may lag
the in-memory conversation" (hooks.md, Common input fields). For Handoff the
wrapper should wait for the file's mtime to settle before `--resume`, as cux
does.

## 7. What this settles for the spec

- TUI Limit detection is one settings entry:
  `StopFailure` with matcher `rate_limit`, command `mclaude hook`.
- The hook writes a file into `$MCLAUDE_SIGNAL_DIR` and exits 0. Nothing
  else about its output matters.
- The hook payload identifies the session and the wall text; the window type
  and Reset come from mclaude's usage poll.
- mclaude passes `--session-id` with a fresh UUID per launch, also registers
  `SessionStart` to follow `/clear`, and hands off with `--resume <id>`.
- The child does not exit at the wall. mclaude decides whether to kill and
  relaunch (another Account has headroom) or leave it waiting (none does).

Open questions this did not answer:

- Whether the `--settings` hook still fires when the user's own settings
  also define a `StopFailure` hook, and in what order. hooks.md says all
  matching hooks run in parallel, which should be fine.
- Whether `StopFailure` fires when the wall is hit inside a subagent. The
  runner returns early on `ra(n.agentContext)`, which reads like a subagent
  guard, so the main thread's own `StopFailure` may be the only one. Needs a
  live test on a limited account.
- The exact `last_assistant_message` on Team and Enterprise seats, which have
  admin-specific suffixes.

## Appendix: live run

```sh
# settings file used; no change to ~/.claude
{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"/tmp/mcl-test/hook.sh"}]}],
          "Stop":[{"hooks":[{"type":"command","command":"/tmp/mcl-test/hook.sh"}]}],
          "StopFailure":[{"hooks":[{"type":"command","command":"/tmp/mcl-test/hook.sh"}]}],
          "SessionEnd":[{"hooks":[{"type":"command","command":"/tmp/mcl-test/hook.sh"}]}]}}

# hook.sh appends stdin to /tmp/mcl-test/events.jsonl and exits 0
claude -p "reply with the single word ok" \
  --session-id 7c1c9a3e-1b2d-4c5e-8f6a-0123456789ab \
  --settings /tmp/mcl-test/settings.json --model haiku
```

Events received, in order: `SessionStart` (`source: "startup"`), `Stop`
(`last_assistant_message: "ok"`, `background_tasks: []`, `session_crons: []`),
`SessionEnd` (`reason: "other"`). All three carried the supplied
`session_id` and the same `transcript_path`. Rerunning with the same UUID
printed `Error: Session ID ... is already in use.` and fired no hook.
