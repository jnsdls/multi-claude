# multi-claude

`mclaude` runs the Claude Code CLI under one of several subscription accounts. It picks the account with headroom, and when a session hits a usage limit it relaunches Claude Code on another account with the same conversation resumed. See [CONTEXT.md](CONTEXT.md) for the terms used below.

## Install

mclaude needs Claude Code installed. It finds `claude` through `MCLAUDE_CLAUDE_PATH`, then `claudePath` in its config, then `PATH`, then `~/.local/bin/claude`.

### npm or bun

The npm package is a Bun program. Bun must be on `PATH` for the `mclaude` command to run, whichever package manager installed it.

```sh
npm install -g mclaude
bun add -g mclaude
bunx mclaude --version
```

### Release tarball

Each release on GitHub carries one tarball per platform and a checksum file. No Bun or Node needed.

```
mclaude-darwin-arm64.tar.gz
mclaude-darwin-x64.tar.gz
mclaude-linux-x64.tar.gz
mclaude-linux-arm64.tar.gz
SHASUMS256.txt
```

```sh
v=0.1.0; t=darwin-arm64
curl -fsSLO "https://github.com/jnsdls/multi-claude/releases/download/v$v/mclaude-$t.tar.gz"
curl -fsSLO "https://github.com/jnsdls/multi-claude/releases/download/v$v/SHASUMS256.txt"
shasum -a 256 --check --ignore-missing SHASUMS256.txt
tar xzf "mclaude-$t.tar.gz"
install -m 755 mclaude ~/.local/bin/mclaude
```

The Linux builds link against glibc. Alpine and other musl systems have no build yet. The macOS builds carry an ad-hoc signature, which is enough for a `curl` download but not for a file that came through a browser; Developer ID signing is open too. Neither blocks a release.

### Pointing a host at mclaude

Any host that takes a path to the Claude Code binary can take `mclaude` instead: T3 Code's Binary path setting, or `pathToClaudeCodeExecutable` in the Agent SDK. Give it the full path to `mclaude` (from `which mclaude`) or to the extracted binary. `mclaude --version` prints Claude Code's own version line on stdout, so a host's version check reads the right number.

### T3 Code

In T3 Code's settings, on the Claude Code provider, set Binary path to the full path of `mclaude`. A bare `mclaude` also works when the app's `PATH` reaches it. Nothing else changes. T3 Code's own flags, its `--session-id` and its MCP config are forwarded as they are, and every Account links back to the Shared home, so settings, memory and skills are the ones you had under plain `claude`.

To check it took, ask the session to print `MCLAUDE_ACCOUNT`. It holds the Account id the launch chose, and `CLAUDE_CONFIG_DIR` points inside `~/.mclaude/accounts/`.

On a Limit, T3 Code shows the rejected turn end the way Claude Code reports it. The Handoff then delivers the answer as a turn of its own on the next Account. To hold T3 Code on one Account, `mclaude account pin <id|alias>`.

## Usage

Anything whose first word is not one of mclaude's Reserved words is forwarded to `claude` in order and unchanged, apart from the Account choice and, on a Session start, a `--session-id` and a `--settings` file carrying the Limit hook.

```sh
mclaude                          # the TUI, on the Account with headroom
mclaude -p "summarise this"      # same, non-interactive
mclaude doctor                   # runs on the Active account, no usage poll
```

Reserved words are `account`, `version` and `hook`:

```sh
mclaude account add              # log in to another Account
mclaude account list
mclaude account rename <id|alias> <alias>
mclaude account login <id|alias> # sign in again on an Account that Needs login
mclaude account pin <id|alias>   # every launch on this Account until unpin
mclaude account unpin
mclaude account disable <id|alias>
mclaude account enable <id|alias>
mclaude account remove <id|alias>
mclaude version                  # mclaude, claude, bun, Checked version, Version floor
```

`mclaude hook` is what the Limit hook runs inside Claude Code. You never call it.

`account list` answers from the last reading; `account list --refresh` reads every Account's usage meter again. An access token within five minutes of expiry is renewed first by the Refresh trigger, a `claude -p` run inside the Account dir pointed at a closed local port, so Claude Code rotates the token itself and no prompt reaches a model. That write path is verified on macOS against a real claude; on Linux, where the credential is a file, it is untested.

mclaude's own flags work anywhere before a bare `--` and are stripped before forwarding:

| Flag | Effect |
| --- | --- |
| `--account <id\|alias>` | Override: this launch on the named Account, whatever its headroom |
| `--switch-threshold <n>` | Utilization above which Selection looks for another Account (0 to 100) |
| `--on-exhausted <launch\|fail>` | When no Account has headroom: launch on the Fallback, or exit 75 |

## Pin, override and disable

`account pin <id|alias>` holds every launch on one Account until `account unpin`. Past the Switch threshold it launches silently. Holding a Limit it launches after one stderr line, or exits 75 under `onExhausted=fail`. A Limit hit mid-session is written to the Record and the child stays; Handoff never leaves a pinned Account. A pinned launch becomes the Active account.

`--account <id|alias>` is the same order for one launch and leaves the Active account alone. `MCLAUDE_USE_ACCOUNT` does the same for a host that sets the environment but not the argv. The flag wins over the variable, and both win over a Pin. An unknown name exits 64. An Account that Needs login, or an Orphan id, exits 1 pointing at `account login` or `account remove`. Nothing falls through to Selection.

`account disable <id|alias>` keeps an Account out of Selection, Fallback and Handoff. `list` still shows it and `list --refresh` still reads it. A Pin or `--account` launches a Disabled Account anyway, with one stderr line. `account enable` reverses it. All four commands exit 0 when nothing changes.

A bare `--` forces Passthrough of whatever follows, so a prompt that begins with a Reserved word still reaches Claude Code:

```sh
mclaude -- account "what does this word mean"
```

mclaude drops the `--` itself and forwards everything after it. The compiled binaries and the npm shim both keep it on the way in.

`mclaude --version` prints Claude Code's version on stdout and `mclaude <version>` on stderr. `mclaude --help` prints Claude Code's help and a three-line footer on stderr.

`mclaude auth login` and `auth logout` are refused with exit 64. Use `account add` and `account remove`.

A Session start on a Claude Code older than the Version floor (2.1.223) exits 69, because a Handoff on that release loses the conversation.

Limit detection rides on a hook. `disableAllHooks` in your Claude Code settings, and `--bare` or `--safe-mode` on the command line, turn hooks off, and with them Handoff.

## Configuration

`$MCLAUDE_HOME/config.json` (default `~/.mclaude/config.json`). Hand-edited; mclaude never creates or rewrites it. Missing means every default. JSONC: comments and trailing commas are fine.

```jsonc
{
  // Schema version. Optional; must be 1 when present.
  "version": 1,

  // When no Account has headroom: "launch" on the Fallback account (default),
  // or "fail" with exit 75.
  "onExhausted": "launch",

  // Utilization (0 to 100) of the Active account's tightest Window above which
  // Selection looks for another Account. Default 90. Never a wall: an Account
  // past it still launches when nothing better exists.
  "switchThreshold": 90,

  // Where claude is. Absolute or ~-prefixed. When set, a missing or
  // non-executable file exits 78; it never falls through to PATH.
  "claudePath": "~/.local/bin/claude",
}
```

| Key | Type | Default | Rule |
| --- | --- | --- | --- |
| `version` | number | absent | must be 1 |
| `onExhausted` | `"launch"` or `"fail"` | `"launch"` | |
| `switchThreshold` | number | 90 | 0 to 100 |
| `claudePath` | string | absent | absolute or `~`-prefixed |

An unknown key earns one stderr warning and is ignored. A file that does not parse, a wrong type, or a value outside its rule exits 78 with one line naming the key. Only invocations that use a key open the file: a Passthrough reads all three, `account add` and `account login` read `claudePath`, and `version`, `hook` and the other `account` commands never open it.

Precedence for each key is flag, then environment variable, then the file, then the default.

| Variable | Meaning |
| --- | --- |
| `MCLAUDE_HOME` | State root instead of `~/.mclaude`. Taken literally, never resolved through symlinks |
| `MCLAUDE_ON_EXHAUSTED` | Same values as `onExhausted` |
| `MCLAUDE_SWITCH_THRESHOLD` | Same values as `switchThreshold` |
| `MCLAUDE_CLAUDE_PATH` | Where claude is; beats `claudePath` |
| `MCLAUDE_USE_ACCOUNT` | Override by id or alias, the same as `--account`; for hosts that set the environment but not the argv |

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | ok |
| 1 | refused: failed login, live session, Needs login under a Pin or Override |
| 64 | usage error |
| 65 | duplicate Account or identity mismatch |
| 69 | claude not found, or below the Version floor |
| 75 | Exhausted with `onExhausted=fail` |
| 78 | bad `config.json` |

A Passthrough otherwise exits with the child's code, or re-raises the signal that ended it.

## Terms

mclaude runs the unmodified Claude Code binary. Claude Code does every login in its own flow and stores the token in its own credential store. mclaude never writes, refreshes or copies a token.

Every account you add must be a Claude subscription you hold yourself. Using anyone else's login breaks Anthropic's Consumer Terms and the subscriber-only rule for plans, whatever tool you use.

mclaude makes one request of its own with your token: a read of your usage meter at `api.anthropic.com/api/oauth/usage`. It is the same request Claude Code's `/usage` command makes, sent with the user agent `mclaude/<version>`. mclaude never sends a prompt.

When an account hits a usage limit, mclaude ends Claude Code and relaunches it on another of your accounts with the same conversation resumed and the rejected turn sent again. The limit on the first account still applies to it until its reset. The second account spends its own.

Anthropic's Consumer Terms bar access through automated means outside an API key unless Anthropic explicitly permits it. Anthropic's Claude Code documentation says subscription OAuth is meant for ordinary use of Claude Code and other native Anthropic applications, and Anthropic reserves the right to enforce that without notice. The usage read is a script presenting a subscription token, and no Anthropic page permits it by name. You carry that risk. Read these before you add an account:

- [Consumer Terms of Service](https://www.anthropic.com/legal/consumer-terms), section 3, "Use of our Services"
- [Claude Code: Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance), "Authentication and credential use"
- [Logging in to your Claude account](https://support.claude.com/en/articles/13189465-logging-in-to-your-claude-account), "Authenticating to subscription plans"

Team and Enterprise members should check with their admin. An organization can pin which login Claude Code accepts, and its policy governs the seat above anything mclaude does.

## License

MIT. See [LICENSE](LICENSE).
