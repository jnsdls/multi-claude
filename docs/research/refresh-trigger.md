# The cheapest claude invocation that awaits an OAuth refresh

Task for [#16](https://github.com/jnsdls/multi-claude/issues/16), part of [#1](https://github.com/jnsdls/multi-claude/issues/1). Follows [token-read](token-read.md) and amends [ADR 0002](../adr/0002-tokens-read-only.md). Run on 2026-09-03 against Claude Code 2.1.259 (native arm64) on this Mac, Keychain unlocked.

## Answer in short

1. `claude auth status` never awaits the refresh. Ten runs, 0.13 s each, exit 0, `loggedIn: true` on a token past its expiry, nothing written back. Dropped.
2. `claude -p` awaits it by design. Every first-party API request waits for the refresh and its write-back before the request goes out, and the harness saw the write land in every run.
3. The pick is `claude -p` with the API base URL pointed at a closed local port and retries off. Claude Code refreshes, writes the credential, tries the model call, gets connection refused, exits 1. About 0.8 s. No model request, no Window usage, no transcript, no history entry.
4. A refused refresh leaves `accessToken: ""`, `refreshToken: ""`, `expiresAt: 0` on disk. That is Needs login. The trigger is the only thing that exposes a refresh token the server has quietly revoked.

## The Refresh trigger

Run inside the Account dir, with the two config dir variables set as for any Passthrough, stdin closed, cwd set to the Account dir:

```sh
ANTHROPIC_BASE_URL=http://127.0.0.1:9 CLAUDE_CODE_MAX_RETRIES=0 \
  claude -p hi --max-turns 1 --strict-mcp-config --mcp-config '{"mcpServers":{}}' </dev/null
```

Each piece earns its place:

- `-p` is what makes the run await the refresh. `--max-turns 0` awaited too, so the count is not doing the work; `1` is just the honest value.
- `ANTHROPIC_BASE_URL` at a closed port stops the model call. Port 9 on the loopback refuses instantly; any closed port does. The OAuth token URL is a separate hard-coded constant in the binary, so the refresh still goes to `platform.claude.com`. The profile fetch that follows a successful refresh goes to `api.anthropic.com` by the same constant.
- `CLAUDE_CODE_MAX_RETRIES=0` matters. Without it a refused connection goes through 11 attempts with backoff; the harness hit its 120 s timeout. With it, 1.14 s.
- `--strict-mcp-config --mcp-config '{"mcpServers":{}}'` keeps Claude Code from spawning the user's stdio MCP servers, which the Shared home symlinks make visible in every Account dir. Takes the run from 1.14 s to 0.8 s and removes a side effect.

Only run it when `Date.now() + 300000 >= expiresAt`. That is Claude Code's own "needs refresh" test; outside it the run does nothing and costs a second.

Exit code is 1 in every outcome, so the result is read from the credential, not the process:

| Credential after the run                                  | Meaning                                   |
| --------------------------------------------------------- | ----------------------------------------- |
| `expiresAt` advanced, new `accessToken`                   | fresh token, proceed                      |
| `accessToken`, `refreshToken` empty and `expiresAt` 0     | Needs login                               |
| unchanged                                                 | Unknown: network down, or the refresh lock in the Account dir was busy |

On macOS the write goes to the Keychain item for the dir and Claude Code deletes `.credentials.json` if one was there, so re-read the Keychain first and the file second, the order [token-read](token-read.md) already gives.

## What was measured

Harness: an isolated dir used as both config dirs, holding a `.credentials.json` whose tokens are fake and whose `expiresAt` is 60 s ahead. Before every run the harness deletes the dir's Keychain item and rewrites the file. Claude Code reads the file, sees the token inside its five-minute margin, posts the refresh, gets 400 `invalid_grant` from `platform.claude.com` (the debug log shows it at +0.25 s), and zeroes the credential on disk. That zeroing is the observable. The await-or-not path is the same for a successful refresh, which returns from the same function into the same awaited save.

| Invocation                                                | Runs  | Wrote back | Wall time | Exit |
| --------------------------------------------------------- | ----- | ---------- | --------- | ---- |
| `claude auth status`                                      | 10    | 0 of 10    | 0.13 s    | 0    |
| `claude auth status --text`                               | 1     | no         | 0.13 s    | 0    |
| `claude --version`                                        | 1     | no         | 0.02 s    | 0    |
| `claude plugin list`                                      | 1     | no         | 0.14 s    | 0    |
| `claude mcp list`                                         | 10    | 10 of 10   | 0.8 s     | 0    |
| `claude -p hi --max-turns 1`                              | 3     | 3 of 3     | 1.0 s     | 1    |
| `claude -p hi --max-turns 0`                              | 1     | yes        | 0.9 s     | 1    |
| `-p` with `ANTHROPIC_BASE_URL=http://127.0.0.1:9`         | 1     | yes        | 1.0 s     | 1    |

On the real login, with a valid token so no refresh happened:

| Invocation                                                | Wall time | Exit | Cost                                   |
| --------------------------------------------------------- | --------- | ---- | -------------------------------------- |
| `claude -p 'Reply with the single word ok.' --max-turns 1 --model haiku` | 2.3 s | 0 | one model request, printed `ok`  |
| dead base URL, default retries                            | over 120 s | timeout | none, 11 attempts with backoff  |
| dead base URL, `CLAUDE_CODE_MAX_RETRIES=0`                | 1.14 s    | 1    | none; spawned the playwright MCP server |
| dead base URL, retries off, MCP config emptied (3 runs)   | 0.8 s     | 1    | none, no spawn, no transcript, no history line |
| `claude mcp list`                                         | 1.14 s    | 0    | none, but connects to every configured MCP server |

`claude mcp list` is a real await, not a race: the claude.ai connector fetch calls the refresh function before asking for the token (`await Li({credentials:e})` ahead of `[claudeai-mcp] No access token`). It lost on side effects. It health-checks every configured server, which on this Mac means spawning `npx @playwright/mcp`, and the subcommand takes no flag to skip that.

## Why auth status loses

`authStatus` renders from the stored credential and exits. The refresh it starts comes from the `init()` that runs before every subcommand, as `JRn(...).catch(h)` with nothing awaiting it. The process is gone in 0.13 s and the refresh round trip is about 0.25 s, so the background refresh never wins. This is the race [token-read](token-read.md) described, now measured: it is not close.

## Needs login, seen from disk

After the refused refresh:

- Keychain item for the dir: `{"claudeAiOauth":{"accessToken":"","refreshToken":"","expiresAt":0, ...scopes and subscriptionType intact}}`. The `.credentials.json` that seeded the run is gone.
- `claude auth status` prints `"loggedIn": false, "authMethod": "none"`, exit 1.
- A second `claude -p` fails in 0.5 s with no network call. Claude Code treats `refreshToken === ""` as a dead token it already knows about (`t0`/`n0` in the bundle) and skips the refresh.
- Output on stdout in both cases: `Failed to authenticate: OAuth session expired and could not be refreshed`.

So `list` marks Needs login when the credential is absent, or `accessToken` is empty, or `refreshToken` is empty, or `expiresAt` is 0. Those are one state as far as Claude Code is concerned. A token the server has revoked while the disk still looks healthy is invisible until the trigger runs, so `list --refresh` on an Account inside the margin runs the trigger before reading usage.

Claude Code zeroes only when the stored `refreshToken` still equals the one it posted (`JUe`), so a concurrent session that already rotated the token is never clobbered.

## Not measured

The success path with a real refresh token. The only login on this machine backs the session that did this work, and Claude Code rotates refresh tokens on every refresh, so copying that credential into a test dir would have handed the rotation to the copy and left the real login with a dead token. The claim that the trigger writes a fresh token back before exiting rests on the code: `GU` returns the new tokens, the caller saves them through the same `mutate` the zeroing uses, and the API request that follows awaits all of it. It should be confirmed on the first Account added through mclaude, once its token is inside the margin; see the follow-up ticket on the map.

Linux was not run. The code path is the same and the write lands in `.credentials.json` instead of the Keychain.

## Harness

```sh
#!/bin/zsh
DIR=/tmp/mclaude-refresh-test
SVC="Claude Code-credentials-c8c82c0b"   # sha256(DIR)[:8]
export CLAUDE_CONFIG_DIR=$DIR CLAUDE_SECURESTORAGE_CONFIG_DIR=$DIR
unset CLAUDE_CODE_ENTRYPOINT CLAUDE_CODE_CHILD_SESSION CLAUDECODE

reset() {
  /usr/bin/security delete-generic-password -a "$USER" -s "$SVC" >/dev/null 2>&1
  local exp=$(( $(date +%s) * 1000 + 60000 ))
  cat > $DIR/.credentials.json <<JSON
{"claudeAiOauth":{"accessToken":"sk-ant-oat01-FAKE","refreshToken":"sk-ant-ort01-FAKE","expiresAt":$exp,"refreshTokenExpiresAt":$(( exp + 86400000 )),"scopes":["user:file_upload","user:inference","user:mcp_servers","user:profile","user:sessions:claude_code"],"subscriptionType":"max"}}
JSON
  chmod 600 $DIR/.credentials.json
  [ -f $DIR/.claude.json ] || echo '{"hasCompletedOnboarding":true,"theme":"dark"}' > $DIR/.claude.json
}

state() {
  local kc; kc=$(/usr/bin/security find-generic-password -a "$USER" -s "$SVC" -w 2>/dev/null)
  [ -n "$kc" ] && echo "keychain: $kc" || echo "keychain: (no item)"
  [ -f $DIR/.credentials.json ] && echo "file: $(cat $DIR/.credentials.json)" || echo "file: (none)"
}

run() {   # run "<label>" cmd...
  local label=$1; shift
  reset
  local t0=$(python3 -c 'import time;print(time.time())')
  "$@" > $DIR/out.txt 2> $DIR/err.txt < /dev/null
  local rc=$?
  printf '%-28s rc=%-3s %5.2fs\n' "$label" "$rc" "$(python3 -c "import time;print(time.time()-$t0)")"
  state
}

mkdir -p $DIR
for i in {1..10}; do run "auth status #$i" claude auth status; done
```

## Sources

- Claude Code 2.1.259 binary, `strings` of `~/.local/share/claude/versions/2.1.259`: OAuth config (`Jt`, `TOKEN_URL` and the three-host allowlist behind `CLAUDE_CODE_CUSTOM_OAUTH_URL`), refresh (`GU`, `_1`, `qU`, `JUe`, `t0`, `n0`), retry cap (`Uit`, `CLAUDE_CODE_MAX_RETRIES`), the claude.ai connector fetch (`await Li` before `[claudeai-mcp] No access token`).
- Runs on this Mac, 2026-09-03, as tabled above. Debug log from `claude --debug mcp list` for the refresh timestamp.
- [token-read](token-read.md) for the storage layout and the expiry flow this note closes out.
