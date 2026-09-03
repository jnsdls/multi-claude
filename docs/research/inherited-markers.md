# Which inherited Claude Code markers change a child claude

Task for [#32](https://github.com/jnsdls/multi-claude/issues/32), part of [#1](https://github.com/jnsdls/multi-claude/issues/1). Follows [refresh-trigger](refresh-trigger.md), whose run 4 left the transcript question open. Run on 2026-09-03 against Claude Code 2.1.259 (native arm64) on this Mac, from a Bash tool inside a Claude Code session that t3/code launched through the Agent SDK, so every run below inherited the real markers.

## Answer in short

1. Claude Code sets seven variables on a Bash tool or hook child: `CLAUDECODE=1`, `CLAUDE_CODE_CHILD_SESSION=1`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_PID`, `AI_AGENT`, `CLAUDE_EFFORT` and, with OTel propagation on, `TRACEPARENT`. Four more leak through because the parent set them on its own process: `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_EXECPATH`, `CLAUDE_CODE_MESSAGING_SOCKET` and `CLAUDE_CODE_MESSAGING_TOKEN`. Under the Agent SDK the host adds `CLAUDE_AGENT_SDK_VERSION`.
2. One marker governs transcripts: `CLAUDE_CODE_CHILD_SESSION`. It turns persistence off only for an interactive launch. `claude -p`, stream-json included, persists with every marker intact. `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1` overrides it.
3. The map's claim holds for the TUI and fails for print mode. An interactive child with the marker wrote nothing under `projects/` and `--resume` answered `No conversation found with session ID`. Every `-p` and stream-json child wrote a transcript and resumed from a scrubbed shell.
4. There is no nested-session refusal. The binary has no message that declines to start inside another session. What the marker does change: a one-line TUI notice, prompt history off, `claude agents` registration off, `-y/--yes` ignored on `claude plugin install`, and the skill-proposals tool disabled.
5. `CLAUDECODE` on its own changes nothing a launcher cares about. The other markers are reporting, not behaviour: the child overwrites `CLAUDE_CODE_SESSION_ID` and `AI_AGENT` with its own values, keeps `CLAUDE_CODE_ENTRYPOINT` and reports it in its User-Agent and transcript, and reads `CLAUDE_PID`, `CLAUDE_EFFORT`, `CLAUDE_CODE_EXECPATH` and the messaging pair only inside shell integration or not at all.

## What the parent sets

One function builds the marker block (`oLe` in the bundle):

```js
{CLAUDECODE:"1", CLAUDE_CODE_SESSION_ID:e.sessionId, CLAUDE_CODE_CHILD_SESSION:"1", CLAUDE_PID:String(process.pid)}
// plus AI_AGENT="claude-code_<ver>_agent" when source is "agent", CLAUDE_EFFORT when an effort level is set,
// TRACEPARENT when CLAUDE_CODE_PROPAGATE_TRACEPARENT is on
```

Where it is spread in, and what else rides along:

| Spawn                       | Marker block | Extra                                                          | Not set                                  |
| --------------------------- | ------------ | -------------------------------------------------------------- | ---------------------------------------- |
| Bash tool (`rUo`, `f$n`)    | yes, source `agent` | `SHELL`, `GIT_EDITOR=true`, `CLAUDE_CODE_EXECPATH`, `CLAUDE_CODE_TMPDIR`, `TMPPREFIX` |                                          |
| Hook command                | yes          | `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`, `CLAUDE_PLUGIN_OPTION_*`, `CLAUDE_ENV_FILE` on SessionStart, Setup, CwdChanged, FileChanged | `AI_AGENT` override |
| Status line command         | yes, source `harness` | `CLAUDE_PROJECT_DIR`                                     | `AI_AGENT` override                      |
| stdio MCP server            | partial      | `CLAUDECODE=1`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_PROJECT_DIR` | `CLAUDE_CODE_CHILD_SESSION` is destructured out on purpose |
| Shell snapshot and env probe | no          | `CLAUDECODE=1` only                                            |                                          |

Subagents spawned by the Agent tool run in the parent process, so their Bash tools get the same block with the parent's pid and session id. This note was written from one; the observed environment was:

```
AI_AGENT=claude-code_2-1-259_agent
CLAUDECODE=1
CLAUDE_AGENT_SDK_VERSION=0.3.170
CLAUDE_CODE_CHILD_SESSION=1
CLAUDE_CODE_ENTRYPOINT=sdk-ts
CLAUDE_CODE_EXECPATH=/Users/jnsdls/.local/share/claude/versions/2.1.259
CLAUDE_CODE_MESSAGING_SOCKET=/tmp/cc-socks/85071.sock
CLAUDE_CODE_MESSAGING_TOKEN=<32 hex>
CLAUDE_CODE_SESSION_ID=a2457743-bc1c-4f96-aec0-ee547a6175e8
CLAUDE_EFFORT=high
CLAUDE_PID=85071
```

The four that are not in the block come from the parent's own `process.env`. `CLAUDE_CODE_EXECPATH` is set by the Bash tool's environment overrides (`F[kdt]=process.execPath`) so that the `claude` shell function in the snapshot execs the same binary. The messaging pair is written to `process.env` when the parent binds its inbox socket. `CLAUDE_CODE_ENTRYPOINT` and `CLAUDE_AGENT_SDK_VERSION` come from whatever launched the parent; the SDK sets `sdk-ts`.

The docs page [env-vars](https://code.claude.com/docs/en/env-vars) lists `CLAUDECODE`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_PID`, `CLAUDE_EFFORT`, `CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDE_CODE_MESSAGING_TOKEN`, `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE` and `CLAUDE_CODE_SKIP_PROMPT_HISTORY` and agrees with the binary on each. `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_EXECPATH`, `CLAUDE_AGENT_SDK_VERSION` and `AI_AGENT` are undocumented.

## What each marker changes when a child claude reads it

At startup the child copies three of them into a host object (`Qur`): `setEntrypoint(CLAUDE_CODE_ENTRYPOINT)`, `setChildSession(Boolean(CLAUDE_CODE_CHILD_SESSION))`, `setClaudecode(Boolean(CLAUDECODE))`. Everything below traces from those getters or from direct `process.env` reads.

| Marker                        | Read back | What it changes in the child                                                                                                                  |
| ----------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE_CODE_CHILD_SESSION`   | yes       | Transcript, prompt history and `claude agents` registration off in interactive mode (`uke`, below). Marks the auto-mode classifier as a subagent loop (`tO`). Disables the skill-proposals tool. `-y/--yes` on `plugin install` ignored. Turns off the "host owned" gates for Desktop, Cowork and VS Code hosts (`q_`, `Zvt`, `k1`, `Kur`). |
| `CLAUDECODE`                  | yes       | Same `-y/--yes` and skill-proposals effects. Otherwise only consulted by Cowork `local-agent` and VS Code host gates (`eRt`, `k1`). No persistence effect. |
| `CLAUDE_CODE_ENTRYPOINT`      | yes       | Kept as-is when already set (`_`: only `local_agent` is normalised and `cli` becomes `sdk-cli` in print mode). Goes into the User-Agent `claude-cli/2.1.259 (external, sdk-ts, agent-sdk/0.3.170)`, every analytics event's `entrypoint`, and the transcript's `entrypoint` field. With an `sdk-*` value (`aO`): child-process memory accounting on, feedback relay off, unchained-transcript warning printed to stderr. |
| `CLAUDE_CODE_SESSION_ID`      | overwritten | `if(a.CLAUDE_CODE_SESSION_ID) process.env.CLAUDE_CODE_SESSION_ID=Q()` at session start, so the child's own children see the child's id. Only other read latches a CCR session id when the value is not a plain uuid. Never adopted as the child's session id. |
| `AI_AGENT`                    | overwritten | `f0t`: any missing value or one starting `claude-code_` or `claude-code/` becomes `claude-code_<ver>_harness`.                                |
| `CLAUDE_PID`                  | shell only | Read by the `pkill` shell function in the Bash tool snapshot, on Linux, to refuse a pattern that would kill the parent. Claude Code itself never reads it. |
| `CLAUDE_EFFORT`               | shell only | Substituted into skill text as `${CLAUDE_EFFORT}`. Not the child's own effort; that is `CLAUDE_CODE_EFFORT_LEVEL` or `--effort`.               |
| `CLAUDE_CODE_EXECPATH`        | shell only | The `claude` shell function in the Bash tool snapshot execs `${CLAUDE_CODE_EXECPATH:-}` when it is executable, so `claude` inside a Bash tool is always the parent's binary. Not read by Claude Code's own code path. |
| `CLAUDE_CODE_MESSAGING_SOCKET`, `_TOKEN` | yes | Used to exclude the session's own socket from peer lists (`nU`) and to decide replay of user messages under stream-json (`socketBound`). Each session rebinds and overwrites both when it starts its inbox; the docs say an inherited value is never reused. |
| `CLAUDE_AGENT_SDK_VERSION`    | yes       | Appended as `agent-sdk/<ver>` to the User-Agent and analytics. A child of an SDK-hosted session reports the SDK version it did not come from. |
| `TRACEPARENT`                 | yes       | OTel parent span, only when propagation is on. Not observed here.                                                                            |

### The persistence gate

```js
function uke(){
  if(a.CLAUDE_CODE_FORCE_SESSION_PERSISTENCE) return false;
  if(!(a.CLAUDE_CODE_CHILD_SESSION && rd() && !sa())) return false;   // rd(): launchOptions.isInteractive(); sa(): agent-team teammate
  return !n().isChildSessionMarkerAmbientInTmux();                    // tmux show-environment -g CLAUDE_CODE_CHILD_SESSION
}
function Jyt(){
  if(XL()) return "explicit_disable";                                  // --no-session-persistence
  if(a.CLAUDE_CODE_SKIP_PROMPT_HISTORY) return "skip_prompt_history";
  if(uke()) return "nested_marker";
  return null;
}
```

`Eu()` is `Jyt()!==null` and every transcript writer checks it (`shouldSkipPersistence`, `materializeSessionFile`, the append and resume re-append paths). `isInteractive` is the negation of print mode, where print mode means `-p`, `--print`, `--init-only`, `--sdk-url`, or stdout not a TTY (`vs`). So the gate needs all of: the marker, a TTY on stdout, no `-p`, not a teammate, no tmux carrying the marker globally, and no force flag.

Two consequences for a launcher. A Bash tool never hands its child a TTY, so `claude` started from a tool call cannot hit the gate no matter what it inherits. The marker only bites an interactive claude when it arrives through something that outlives the tool call: a `screen` or tmux server started from inside Claude Code, a daemon or launcher the Bash tool left running, a terminal opened by a hook. The docs name exactly those cases as the reason `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE` exists, and say tmux is detected automatically since v2.1.178. Claude Code's own precedent for a spawned claude is to delete the markers: the background daemon spawner (`Br`) deletes `CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_EVAL_INTERVIEW_SESSION` and `CLAUDE_CODE_BRIDGE_SESSION_ID`, and the spare-session spawner scrubs the same two plus a session-scoped list (`Knn`, `cce`).

### What the TUI shows

The notice is one dim line under the prompt, present from first render:

```
⚠ Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION marker · restart with CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1 to keep future transcripts
```

The `CLAUDE_CODE_SKIP_PROMPT_HISTORY` variant reads `--resume will not find this session; if unintended, unset it and restart`. Nothing is printed in print mode, and nothing refuses to start.

## Reproduction

Every run used the Refresh trigger recipe against the user's real Claude Code home, from a fresh cwd under `/tmp/mclaude-markers/<label>` so the project key was unique. Dead base URL, retries off, MCP config emptied, `--session-id` passed so the transcript path was known in advance. The resume leg ran from the same cwd with every `CLAUDE*` variable and `AI_AGENT` dropped (`env -u`), same dead URL, so "found" shows as the API error and "not found" as Claude Code's own message. A control resume of a never-used id printed `No conversation found with session ID: 00000000-...`, exit 1.

```sh
ANTHROPIC_BASE_URL=http://127.0.0.1:9 CLAUDE_CODE_MAX_RETRIES=0 \
  claude -p hi --max-turns 1 --session-id $sid --strict-mcp-config --mcp-config '{"mcpServers":{}}' </dev/null
```

### Print mode, `-p`

| Run                              | Exit | Wall   | `projects/<key>/<sid>.jsonl` | `--resume <sid> -p hi` from scrubbed shell |
| -------------------------------- | ---- | ------ | ---------------------------- | ------------------------------------------- |
| environment intact               | 1    | 0.77 s | yes, 45 651 B                | found, API error, exit 1                    |
| unset `CLAUDECODE`               | 1    | 0.86 s | yes                          | found                                       |
| unset `CLAUDE_CODE_CHILD_SESSION`| 1    | 1.13 s | yes                          | found                                       |
| unset `CLAUDE_CODE_ENTRYPOINT`   | 1    | 0.82 s | yes                          | found                                       |
| unset `CLAUDE_CODE_SESSION_ID`   | 1    | 0.83 s | yes                          | found                                       |
| unset `CLAUDE_PID`               | 1    | 1.05 s | yes                          | found                                       |
| unset `CLAUDE_CODE_EXECPATH`     | 1    | 0.84 s | yes                          | found                                       |
| unset `CLAUDE_CODE_MESSAGING_SOCKET` | 1 | 0.87 s | yes                         | found                                       |
| unset `CLAUDE_CODE_MESSAGING_TOKEN`  | 1 | 0.80 s | yes                         | found                                       |
| unset `CLAUDE_AGENT_SDK_VERSION` | 1    | 0.83 s | yes                          | found                                       |
| unset `CLAUDE_EFFORT`            | 1    | 0.85 s | yes                          | found                                       |
| unset `AI_AGENT`                 | 1    | 0.87 s | yes                          | found                                       |
| all eleven unset                 | 1    | 0.93 s | yes, 45 616 B                | found                                       |
| intact, `--input-format stream-json --output-format stream-json --verbose`, one user message on stdin | 1 | 0.86 s | yes, 45 651 B | found |

Thirteen of thirteen `-p` runs persisted and resumed. The transcript's `entrypoint` field read `sdk-ts` with the environment intact and `sdk-cli` with it scrubbed; nothing else in the metadata differed. The resume leg appended to the same file (45 651 B to 49 345 B), which is the map's Handoff path working as expected under inherited markers.

### Interactive, under a pty

A Python `pty.fork` driver with a 140x40 window sent Enter at 3 s, `hi` at 5 s and `/exit` at 10 s, capturing the screen. `--session-id` passed as above. Every run reached the API error, then exited 0 on `/exit`.

| Run                                       | Transcript | Notice on screen | `--resume` from scrubbed shell |
| ----------------------------------------- | ---------- | ---------------- | ------------------------------ |
| environment intact                        | no         | yes              | `No conversation found`         |
| unset `CLAUDE_CODE_CHILD_SESSION`         | yes, 51 256 B | no            | found                          |
| unset `CLAUDECODE`                        | no         | yes              | not run                        |
| intact plus `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1` | yes, 51 206 B | no  | found                          |
| all eleven unset                          | yes, 58 161 B | no            | not run                        |

The empty `projects/<key>/memory/` directory appeared in every run, persisted or not, as the refresh-trigger note already saw.

### A side finding on the scrubbed shell

The first resume leg used `env -i PATH=... HOME=...` and every resume answered `Not logged in · Please run /login`. `claude auth status` under the same `env -i` said `loggedIn: false`; adding `USER` back made it `true`. Claude Code reads the Keychain item with the account name from `USER`, so a launcher that builds a child environment from scratch must carry `USER` (and on Linux whatever `.credentials.json` needs, which is only `HOME`). Not a marker effect, but it will bite the first person who tries a clean-room spawn.

## What else a launcher should know

- Nothing refuses. The only nested-shaped messages in the binary are the transcript notice, `-y/--yes is ignored inside a Claude Code session: run this in your own terminal to accept the command shown above` from `claude plugin install`, and the `[remote agent] isolation:'remote' is unavailable (already inside a CCR session)` log line, which keys on `CLAUDE_CODE_REMOTE`, not on these markers.
- `CLAUDE_CODE_ENTRYPOINT` values the binary recognises: `cli`, `sdk-cli`, `sdk-ts`, `sdk-py`, `mcp` (set for `claude mcp serve`), `claude-code-github-action` (from `CLAUDE_CODE_ACTION`), `claude-vscode`, `claude-desktop`, `claude-desktop-3p`, `local-agent`, `remote`, `remote_baku`, `remote_cowork`, `remote_trigger`, `remote_cowork_trigger`, `remote_desktop`, `remote_mobile`, `claude_in_slack`, `claude-in-slack`, `claude-in-teams`, `claude-security`, `ssh-remote`, `claude-coworker`, `claude-coworker-terminal`, `bench`. An unset value becomes `cli` interactive or `sdk-cli` in print mode. The `remote_*`, `claude-desktop*`, `local-agent` and `claude-vscode` values switch on host-owned rendering, cowork frame artifacts, settings-hint suppression and similar; none of those apply to a child that only inherits `sdk-ts` or `cli`.
- Telemetry: the only marker that reaches an event is `CLAUDE_CODE_ENTRYPOINT` (plus `CLAUDE_AGENT_SDK_VERSION` in the User-Agent). `CLAUDECODE` and `CLAUDE_CODE_CHILD_SESSION` are not reported.
- Hooks in the child run as normal. No marker suppresses them; the child's own hook commands get a fresh marker block with the child's pid and session id.
- `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` and `CLAUDE_CODE_DONT_INHERIT_ENV` change what the parent hands down (credentials stripped, or the snapshot built from an empty environment), not what a child reads.
- `CLAUDE_CODE_SKIP_PROMPT_HISTORY=1` is the environment equivalent of `--no-session-persistence` and works in any mode. It is the right variable for the Refresh trigger if the flag is ever unwanted; it is not something a parent sets on children.

## Sources

- Claude Code 2.1.259 binary, `strings` and byte-offset context over `~/.local/share/claude/versions/2.1.259`: marker block `oLe` and its three callers (Bash `rUo`/`f$n`, hooks, status line `pde`), MCP spawn env, shell snapshot env, `Ucn`/`Mco` spawn-env key list, `Qur`/`_`/`vn`/`vs` startup, `uke`/`Jyt`/`Eu` persistence gate and its tmux probe, `f0t` for `AI_AGENT`, `Ax`/`UP` User-Agent, `o3t` session metadata, `aO`/`q_`/`Zvt`/`k1`/`eRt` host gates, `pl` for `-y/--yes`, `Br`/`Knn`/`cce` scrub lists, `bdt`/`yBo` shell functions for `CLAUDE_CODE_EXECPATH` and `CLAUDE_PID`, the two TUI notice strings.
- [env-vars](https://code.claude.com/docs/en/env-vars) rows for `CLAUDECODE`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_SKIP_PROMPT_HISTORY`, `CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDE_CODE_MESSAGING_TOKEN`, `CLAUDE_EFFORT`, `CLAUDE_PID`, `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`; [cli-reference](https://code.claude.com/docs/en/cli-reference) for `--no-session-persistence`; [hooks](https://code.claude.com/docs/en/hooks) for `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`.
- Runs on this Mac, 2026-09-03, as tabled above. Test project directories under `~/.claude/projects/-private-tmp-mclaude-markers-*` were deleted afterwards.
- [refresh-trigger](refresh-trigger.md) for run 4 and the `--no-session-persistence` recipe this note explains.
