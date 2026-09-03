# Reading an Account's access token without Keychain prompts

Research for [#3](https://github.com/jnsdls/multi-claude/issues/3), part of [#1](https://github.com/jnsdls/multi-claude/issues/1). Backs [ADR 0002](../adr/0002-tokens-read-only.md). Checked on 2026-09-03 against Claude Code 2.1.259 (native arm64 build) on this Mac, the Claude Code docs, claude-swap `70f1058` and CCSwitcher `ed09ce5`.

## Answer in short

1. On macOS, `security find-generic-password -s <service> -w` from any process returns the credential JSON with no GUI prompt. Verified here: 510 bytes in under a second. The item's ACL grants decrypt to exactly one app, `/usr/bin/security`, because Claude Code creates it with `security -i` and never passes `-T`. Any caller that goes through that binary inherits the grant.
2. Claude Code itself reads and writes the item through the `security` CLI, not Security.framework. claude-swap #279's claim that it reads in-process does not hold for 2.1.259.
3. The service name for an Account dir is `Claude Code-credentials-` plus the first 8 hex chars of `sha256(NFC(dir))`, where `dir` is `CLAUDE_SECURESTORAGE_CONFIG_DIR` if set, else `CLAUDE_CONFIG_DIR`. The keychain account attribute is `$USER`.
4. On Linux, and on macOS when the Keychain refuses writes, the same JSON sits in `<dir>/.credentials.json`, mode 0600.
5. `claude auth status` does not await a refresh. It reads the stored token, reports `loggedIn: true` as long as an access token string exists, and exits. Init kicks off a background refresh when the token is within five minutes of expiry, but the command can exit before the refresh lands. mclaude needs a different trigger; see "Expiry flow".

## macOS: where the item lives

Claude Code's secure storage module (`chunk-3qezkvja` and `chunk-rf6seg6s` in the 2.1.259 bundle) derives the item like this:

- Service: `Claude Code` + `OAUTH_FILE_SUFFIX` (empty for prod, `-staging-oauth` etc. otherwise) + `-credentials` + suffix. The suffix is empty when neither env var is set, otherwise `-` + `sha256(dir.normalize("NFC")).hex[0:8]`. `CLAUDE_SECURESTORAGE_CONFIG_DIR` wins when defined; an empty value means "the default store", which maps to `~/.claude`. Source:

  ```js
  function Gx(n=""){let e=process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR,t=e!==void 0?!e:!process.env.CLAUDE_CONFIG_DIR,r=e!==void 0?e.normalize("NFC"):ye(),c=t?"":`-${a("sha256").update(r).digest("hex").substring(0,8)}`;return`Claude Code${Jt().OAUTH_FILE_SUFFIX}${n}${c}`}
  ```

- Account attribute: `process.env.USER || os.userInfo().username`, replaced by `claude-code-user` if it fails `^[a-zA-Z0-9._-]+$`.
- Read: `security find-generic-password -a "<user>" -w -s "<service>"` with a 2 s timeout. Exit codes 44 (item not found) and 36 are treated as "no credential". Results are cached in-process for 30 s; a failed read backs off 1 s and serves the stale cache.
- Write: a single `security -i` invocation fed `add-generic-password -U -a "<user>" -s "<service>" -X "<hex of JSON>"` on stdin, no `-T`. Payloads over 4032 bytes fall back to the same arguments in argv. The write runs under a `<dir>/.storage-write` lock.
- Delete: `security delete-generic-password -a "<user>" -s "<service>"`.
- Locked-keychain probe: `security show-keychain-info` exit code 36 means locked, which routes writes to the plaintext file. The docs describe the same fallback ([authentication](https://code.claude.com/docs/en/authentication#credential-management), [troubleshoot-install](https://code.claude.com/docs/en/troubleshoot-install#not-logged-in-or-token-expired)).

claude-swap encodes the same derivation in `src/claude_swap/session.py::keychain_service_name` and cites Claude's `envUtils.ts`/`macOsKeychainHelpers.ts`. The two agree.

`claude auth status` with `CLAUDE_CONFIG_DIR=CLAUDE_SECURESTORAGE_CONFIG_DIR=/tmp/mclaude-research-fresh` on a fresh dir returned `{"loggedIn": false, "authMethod": "none", "apiProvider": "firstParty", "analyticsDisabled": false, "projectsDirectory": ".../projects"}`, exit 1, and created `.claude.json`, `.claude.json.lock/` and `backups/` in that dir. It did not create a Keychain item. The service name for that dir would be `Claude Code-credentials-993f0726`.

## macOS: the ACL as observed on this Mac

Attributes-only query (`security find-generic-password -s "Claude Code-credentials"`, no `-w`) on the default item:

```
class: "genp"
"acct"<blob>="jnsdls"
"svce"<blob>="Claude Code-credentials"
"cdat" = "mdat" = 20260903193046Z
```

`cdat` equals `mdat`, which matches a delete-then-add write rather than an in-place update. Only one `Claude Code-credentials*` item exists on this machine; no hashed variants yet.

ACL, from `security dump-keychain -a` filtered to this item:

```
access: 5 entries
  entry 0: decrypt derive export_clear export_wrapped mac sign
           applications (1): /usr/bin/security  requirement: identifier "com.apple.security" and anchor apple
  entry 1: encrypt        applications: <null>
  entry 2: integrity
  entry 3: partition_id   description: apple-tool:
  entry 4: change_acl     applications (0)
```

`partition_id = apple-tool:` and the single trusted app are exactly what `security add-generic-password` without `-T` produces. So every process that shells out to `/usr/bin/security` decrypts silently, and a process calling `SecItemCopyMatching` directly gets the "wants to use your keychain" dialog.

The prompt test, `security find-generic-password -s "Claude Code-credentials" -w | wc -c` from a non-Claude shell, returned `510` in 0 s. No dialog. The keychain was unlocked (`security show-keychain-info` exit 0, `no-timeout`); a locked keychain would prompt for the keychain password instead, which is a different failure and the reason Claude Code probes `show-keychain-info`.

## Prior art

**CCSwitcher** ([README section 5](https://github.com/XueshiQiao/CCSwitcher#5-security-cli-keychain-reader), `CCSwitcher/Services/KeychainService.swift`). Reads with `Process` running `/usr/bin/security find-generic-password -s "Claude Code-credentials" -a <NSUserName()> -w`, trims whitespace. Their README says the first read prompts once and "Always Allow" persists; on this Mac it never prompted, consistent with the ACL above. Their explanation in `ARCHITECTURE.md` ("we don't own the ACL") is right in spirit. The trick is that `security` owns it. Writes go delete-then-add through the same CLI, which is the pattern ADR 0001 rejects.

**claude-swap** (`src/claude_swap/macos_keychain.py`). Same read command, hard-coded `/usr/bin/security` to defeat PATH hijack, `-i` stdin for writes so the secret stays out of argv, a per-call timeout because a locked keychain on a headless host hangs forever, and an attributes-only `item_exists` probe that can never prompt. [#279](https://github.com/realiti4/claude-swap/issues/279) (open, 2026-08-25) reports that their `add-generic-password -U` without `-T` re-pins the ACL to `security` only and claims Claude Code then prompts because it reads in-process. The second half is wrong for 2.1.259. Claude Code's read is `security find-generic-password` via `execSync`. The bug they see is real for any tool that reads through the framework, and it is another reason mclaude never writes the item.

## Payload shape

Both the Keychain value and `.credentials.json` hold the same JSON object. Keys are the storage module's; verified against `formatTokens` and `YUe` (refresh write-back) in the binary and claude-swap's `credentials.py`:

```jsonc
{
  "claudeAiOauth": {
    "accessToken": "sk-ant-oat01-...",
    "refreshToken": "sk-ant-ort01-...",
    "expiresAt": 1757000000000,             // ms since epoch
    "refreshTokenExpiresAt": 1780000000000,  // ms, may be absent
    "scopes": ["user:inference", "user:profile", "user:sessions:claude_code", "user:mcp_servers"],
    "subscriptionType": "max",              // "pro" | "max" | "team" | "enterprise" | null
    "rateLimitTier": "...",
    "clientId": "...",                       // absent for the first-party client
    "tokenAccount": { "uuid": "", "emailAddress": "", "organizationUuid": "", "organizationName": "", "workspaceId": "", "workspaceName": "" }
  },
  // machine-shared siblings, not per account (claude-swap's allowlist):
  "mcpOAuth": {}, "mcpOAuthClientConfig": {}, "mcpXaaIdp": {}, "mcpXaaIdpConfig": {}, "pluginSecrets": {},
  // per account:
  "trustedDeviceToken": "..."
}
```

A Console login that created an API key stores a bare `sk-ant-api...` string under the same service instead of JSON; out of scope for mclaude but the parser must not choke on it.

Identity lives next door in `<dir>/.claude.json` under `oauthAccount`: `accountUuid`, `emailAddress`, `organizationUuid`, `organizationName`, `billingType`, `organizationRateLimitTier`, `userRateLimitTier`, `seatTier`, `hasExtraUsageEnabled`, `profileFetchedAt` and a few more. That file is where an Account's email and uuid come from; the token payload only carries them in `tokenAccount`.

To read it, mclaude runs `/usr/bin/security find-generic-password -a "$USER" -w -s "<service>"` with `execFile` (no shell) and a 2 s timeout, treats exit 44 as "not logged in", then takes `JSON.parse(stdout.trim()).claudeAiOauth`. On Linux, or when the Keychain read returns nothing, read `<securestore-dir>/.credentials.json`. Same order Claude Code uses: Keychain first, file second.

## Linux

The docs say "On Linux, credentials are stored in `~/.claude/.credentials.json` with file mode `0600`" and "If you've set the `CLAUDE_CONFIG_DIR` environment variable, Claude Code keeps the `.credentials.json` file under that directory instead" ([authentication](https://code.claude.com/docs/en/authentication#credential-management)). In the binary, the plaintext backend writes `JSON.stringify(obj)` to `join(z_(), ".credentials.json")` with mode 384 (0o600) and chmods it again after the write; `z_()` is `CLAUDE_SECURESTORAGE_CONFIG_DIR` when defined (empty string meaning `~/.claude`), else the config dir. claude-swap resolves the same path (`paths.py::get_credentials_path`). Their README adds that Claude Code re-reads the file when it changes, so a Linux Account dir has no 30 s cache lag.

## Expiry flow

What Claude Code does, from the binary:

- "Needs refresh" is `Date.now() + 300000 >= expiresAt` (`function _1`). Five minutes of margin, the same number claude-swap uses (`OAUTH_EXPIRY_BUFFER_MS`).
- The refresh path (`T_`, wrapped by `QUe`/`Li`) takes a lock in `z_()`, re-reads the stored credential, POSTs `grant_type=refresh_token` to `platform.claude.com/v1/oauth/token`, then writes back with a compare-and-swap: the stored `refreshToken` must still equal the one it posted, otherwise it adopts the sibling's newer write. An `invalid_grant` marks the refresh token dead and zeroes `accessToken`, `refreshToken` and `expiresAt` on disk, which is the state the docs call [Login expired](https://code.claude.com/docs/en/errors#login-expired). Five lock retries, then `lock_busy`/`lock_timeout`, surfaced to the user as "another Claude Code process is refreshing it or exited mid-refresh".
- Every first-party API request awaits `QUe` before sending (`refreshOAuth:!0` on the request options), so `claude -p` and the TUI always refresh before a model call. Claude Code's own `/usage` fetch (`fetchUtilization`, `GET /api/oauth/usage`) uses the same request wrapper, so a 401 there triggers refresh and one retry.
- `claude auth status` (`authStatus` in `chunk-57qfe0qj`) calls `Yl()`, which calls `tn()`, which reads `claudeAiOauth` and checks only `scopes` and that `accessToken` is a string. No `expiresAt` check, no `Li`. Commander's `preAction` hook runs `init()` for every subcommand, and `init()` fires `JRn(...).catch(h)`, which does `await Li(...)` and then a profile fetch, but nothing awaits that promise; `authStatus` renders, `await a.waitUntilExit()`, then `process.exit(loggedIn ? 0 : 1)`. Whether the refresh finishes before exit is a race. claude-swap's own comment in `session.py` reads "Local check only (`claude auth status` makes no API call)". CCSwitcher's README says the opposite, that a background `claude auth status` "lets the official Claude CLI ... fetch a new token and write it back to the keychain"; nothing in the 2.1.259 code guarantees that.

What mclaude does when `expiresAt` has passed, or is within five minutes:

1. Do not call the usage endpoint with that token. A 401 is wasted, and Claude Code treats an on-disk `expiresAt` of 0 as a dead login.
2. Ask Claude Code to refresh by running a command that awaits the refresh and stays alive until the write-back completes. The cheapest known candidate is `claude -p` with a trivial prompt inside the Account dir; it costs one model request. `claude auth status` is the cheap candidate but only works if the background refresh wins the race, which has to be measured, not assumed. Test procedure once an Account with a near-expiry token exists: record `expiresAt`, run `claude auth status`, re-read; repeat ten times; if it ever fails to advance, drop it.
3. Re-read the credential. If `expiresAt` still has not moved and `refreshToken` is empty, the Account is in "needs re-login" (the open item in #1) and `list` should say so instead of retrying.
4. Never race a running session: the refresh lock lives in the Account dir, and a refresh token is single-use, so mclaude's trigger must be the same `claude` binary in the same dir, never a second refresher.

Two things worth a follow-up ticket:

- Ask Anthropic (or watch releases) for `claude auth status` to await the refresh, or for a `claude auth refresh`. The `--text` path already prints `Login: Expired` rows from `/status` data, so the plumbing is close.
- For SDK hosts: the CLI can send an `oauth_token_refresh` control request to its host (`requestOAuthTokenRefresh`, `tengu_sdk_oauth_refresh_unfulfilled`). That is the CLI asking the host, not a way for mclaude to ask the CLI, but it means a host that answers `null` does no harm.

## Sources

- Claude Code 2.1.259 native binary, `strings` of `~/.local/share/claude/versions/2.1.259`: secure storage (`Gx`, `Hv`, keychain backend `R`, plaintext backend `V`), refresh (`_1`, `T_`, `QUe`, `Li`, `YUe`, `GU`), `authStatus` (`le` in `chunk-57qfe0qj`), commander wiring (`preAction`, `R.command("status")`), `fetchUtilization` (`ZO`).
- `security find-generic-password -s "Claude Code-credentials"` and `security dump-keychain -a` on this Mac, 2026-09-03.
- https://code.claude.com/docs/en/authentication (Credential management, Renew an expiring login), https://code.claude.com/docs/en/troubleshoot-install (Not logged in or token expired), https://code.claude.com/docs/en/errors (Login expired), https://code.claude.com/docs/en/cli-reference (`claude auth status`).
- claude-swap `70f1058`: `src/claude_swap/macos_keychain.py`, `credentials.py`, `session.py`, `oauth.py`, `paths.py`; issue #279.
- CCSwitcher `ed09ce5`: `README.md` sections 3 and 5, `ARCHITECTURE.md`, `CCSwitcher/Services/KeychainService.swift`, `ClaudeService.swift`.
