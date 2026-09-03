# Which files in an Account dir stay private, and how `.claude.json` splits

Research for [issue #2](https://github.com/jnsdls/multi-claude/issues/2), part of the [map in #1](https://github.com/jnsdls/multi-claude/issues/1). Vocabulary from `CONTEXT.md`: an **Account dir** is the private directory mclaude passes to Claude Code as `CLAUDE_CONFIG_DIR`; the **Shared home** is the user's real `~/.claude`.

Date: 2026-09-03. Claude Code 2.1.259, native install, macOS 24.6.

## Sources

Primary, in the order I trust them:

1. The real `~/.claude` and `~/.claude.json` on this Mac (structure only, no values).
2. A fresh run: `CLAUDE_CONFIG_DIR=/tmp/mclaude-research-fresh claude auth status`.
3. A probe run with `projects/` symlinked into a temp config dir (details under "Symlinked `projects/` and `--resume`").
4. Official docs at code.claude.com: [claude-directory](https://code.claude.com/docs/en/claude-directory) (the "Application data" tables), [settings](https://code.claude.com/docs/en/settings), [settings-reference](https://code.claude.com/docs/en/settings-reference#global-config-settings), [mcp](https://code.claude.com/docs/en/mcp#mcp-installation-scopes), [authentication](https://code.claude.com/docs/en/authentication#credential-management), [env-vars](https://code.claude.com/docs/en/env-vars), [sessions](https://code.claude.com/docs/en/sessions), [cli-reference](https://code.claude.com/docs/en/cli-reference).
5. caam `internal/shallow/shallow.go` and `internal/shallow/claude_config.go` at HEAD of [Dicklesworthstone/coding_agent_account_manager](https://github.com/Dicklesworthstone/coding_agent_account_manager), plus issues [#92](https://github.com/Dicklesworthstone/coding_agent_account_manager/issues/92) and [#93](https://github.com/Dicklesworthstone/coding_agent_account_manager/issues/93).
6. claude-swap `src/claude_swap/session.py` and README at HEAD of [realiti4/claude-swap](https://github.com/realiti4/claude-swap).

Designs only were borrowed from 5 and 6, per the map's standing preference.

## What a fresh config dir contains

`claude auth status` in an empty `CLAUDE_CONFIG_DIR` exits 1 (not logged in) and leaves exactly this behind:

```
.claude.json          343 bytes, mode 0600
.claude.json.lock/    empty directory (mkdir-style lock)
backups/.claude.json.backup.<ms>
```

The seed `.claude.json` holds `firstStartTime`, `firstStartVersion`, a freshly generated `machineID` (different from the one in `~/.claude.json`), `opusProMigrationComplete`, `sonnet1m45MigrationComplete`, `seenNotifications`, `hasResetAutoModeOptInForDefaultOffer`, `migrationVersion`. No `userID`: a fresh dir does not get one before login, so treat it as account-derived rather than installation-derived (caam's comment in `claude_config.go` calls it "the installation's anonymous id" and carries it over; the fresh run gives no reason to).

`auth status` also prints `"projectsDirectory": "<config dir>/projects"`, which is the path `--resume` searches.

Everything else in the table below appears on first login or during use. The [claude-directory](https://code.claude.com/docs/en/claude-directory) doc states: "If you set `CLAUDE_CONFIG_DIR`, every `~/.claude` path on this page lives under that directory instead." The [env-vars](https://code.claude.com/docs/en/env-vars) entry adds that `.claude.json` moves too ("All settings, session history, and plugins are stored under this path"), and the fresh run confirms it: `.claude.json` was written inside the config dir, not in `$HOME`.

## Where the token lives

Per the [authentication](https://code.claude.com/docs/en/authentication#credential-management) doc: macOS stores the login in the Keychain, falling back to `<config dir>/.credentials.json` (mode 0600) when the Keychain rejects the write; Linux always uses the file. "If you've set the `CLAUDE_CONFIG_DIR` environment variable, Claude Code keeps the `.credentials.json` file under that directory instead [...] and keys the macOS Keychain entry to that directory too, so a session with a different `CLAUDE_CONFIG_DIR` reads a different entry."

On this Mac the only Keychain item is service `Claude Code-credentials` (the unsuffixed name for the default dir). claude-swap's `keychain_service_name` documents the suffixed form as `Claude Code-credentials-` plus the first 8 hex chars of sha256 over the raw, NFC-normalized, unresolved `CLAUDE_CONFIG_DIR` string. Consequence for mclaude: pass the identical string on every launch. A trailing slash or a realpath'd variant is a different account as far as the Keychain is concerned.

`CLAUDE_SECURESTORAGE_CONFIG_DIR` appears 12 times in the 2.1.259 binary but nowhere in the docs, and neither caam nor claude-swap knows it. Setting it to `/Users/jnsdls/.claude` while `CLAUDE_CONFIG_DIR` pointed at a temp dir did not pick up the unsuffixed item, so it is hashed the same way. The map's claim that the pair "fully isolates an account" holds; the pair does not give a way to share one Keychain item between dirs, and mclaude should not want one.

## Verdict per path

Three verdicts, as the ticket asked:

- **private**: a real file or dir inside the Account dir. Never linked to the Shared home.
- **symlink**: `<Account dir>/<entry>` is a symlink to `~/.claude/<entry>`.
- **recreate**: mclaude leaves it alone; Claude Code creates it inside the Account dir when it needs it. Same effect as private, but mclaude never creates or copies it.

Sizes are from this machine, for a sense of what is worth sharing.

| Path under the config dir | Seen | Verdict | Why |
| --- | --- | --- | --- |
| Keychain item `Claude Code-credentials-<hash>` / `.credentials.json` | Keychain on this Mac; file on Linux and on Keychain fallback | private | The whole point of ADR 0001. Keyed to the config dir string by Claude Code itself. |
| `.credentials.lock` | Not present here (Keychain path); caam creates it | recreate | caam says it is Claude Code's flock target on the file path and a shared one would serialize concurrent sessions (`shallow.go` header comment). Let Claude Code create it if it wants one. |
| `.claude.json` | 83 KB, 0600, rewritten about every 5 minutes (five backups spanning 22 minutes) | private | Holds `oauthAccount`. Rewritten whole via `tmp` plus rename (a stale `~/.claude.json.tmp.<pid>.<hex>` from Aug 5 shows the pattern), so a symlink would be replaced by a real file on the first write anyway. Split strategy below. |
| `.claude.json.lock/` | Empty dir, created by `auth status` | recreate | Lock directory next to the file. Must be per file, so per Account. claude-swap takes the same lock (`proper_lockfile(config_path.parent / ".claude.json.lock")`) before splicing keys in; mclaude should too. |
| `backups/` | 5 x 83 KB copies of `.claude.json` | recreate | Copies of the private file, so they carry the identity. Docs: keeps the five newest plus any unparseable version. |
| `remote-settings.json`, `policy-limits.json` | Not present here (no org policy) | recreate | Docs: org-scoped caches that Claude Code deletes on logout. Bound to the Account's org. |
| `stats-cache.json` | Not present here | recreate | Docs: "aggregated token and cost counts shown by `/usage`". Usage is per Account, and it is a whole-file rewrite, which detaches file symlinks. |
| `telemetry/` | 185 x 230 KB `1p_failed_events.<uuid>.<uuid>.json` | recreate | Undocumented spool of failed first-party event uploads. Sent under the Account's token, so keep it with the Account. Nothing user-facing. |
| `.last-cleanup`, `.last-update-result.json` | Timestamps for the retention sweep and the autoupdater | recreate | Small whole-file rewrites (file symlinks would detach). Cost of being private is one extra sweep per Account dir over the shared `projects/`, which is idempotent. |
| `settings.json` | 118 bytes, user settings | symlink | Docs: user preferences and permission rules. claude-swap: "Claude's settings writer detects symlinks and writes through to the target, so in-session `/config` changes persist" (`session.py` header). This user's `CLAUDE.md` in `~/.claude` is already a symlink and works. |
| `CLAUDE.md`, `skills/`, `commands/`, `agents/`, `rules/`, `output-styles/`, `workflows/`, `keybindings.json`, `themes/`, `agent-memory/` | `skills/` is 38 symlinks into `~/.agents`; `commands/` empty | symlink | Authored config, docs list all as "global" files. Both prior-art tools share them (claude-swap `SHARED_ITEMS`, caam symlinks every non-identity child of `.claude`). |
| `plugins/` | 6.4 MB: `blocklist.json`, `known_marketplaces.json`, `marketplaces/` | symlink | Docs: "Don't delete `~/.claude.json`, `~/.claude/settings.json`, or `~/.claude/plugins/`: those hold your auth, preferences, and installed plugins." Installed once, used everywhere. Plugin and MCP OAuth logins are not here; they sit in the credential store, so they are per Account (claude-swap README: "HTTP servers may ask you to authenticate once per profile via `/mcp`"). |
| `projects/` | 1.3 GB, 435 project dirs; each holds `<session>.jsonl`, `<session>/subagents/`, `<session>/tool-results/`, `memory/` | symlink | Transcripts, auto memory, and what `--resume` searches. Sharing is what makes Handoff a resume rather than a fresh start. Verified below. |
| `history.jsonl` | 123 KB, one JSON line per prompt with `project` and `sessionId` | symlink | Up-arrow recall. Append-only, so a file symlink survives writes. Docs note `claude --purge --all` deletes it outright, which would detach the link; acceptable, and mclaude's per-launch farm step recreates it. |
| `sessions/` | `<pid>.json` (cwd, sessionId, socket path) and `<pid>.<hash>.key` (0600 peer token) per running process | symlink | Docs: "one small file per running session, used to detect concurrent sessions and crashes." Cross-session messaging and the agents view need to see every running session, whichever Account launched it. Filenames are pid-keyed, so no collisions. |
| `ide/` | Empty here | symlink | IDE lock files for auto-connect. The IDE looks in one place. |
| `session-env/`, `tasks/`, `plans/`, `file-history/`, `debug/`, `image-cache/`, `uploads/`, `paste-cache/`, `usage-data/`, `feedback-bundles/`, `feedback/` | `session-env/` 1161 empty session dirs; `tasks/` per session id with `.lock` and `N.json`; `plans/` two md files | symlink | Session-keyed data listed in the docs' "Cleaned up automatically" table. A Handoff resumes the same session id under another Account dir; if these were private, the resumed session would lose its task list, plan file and checkpoints. |
| `shell-snapshots/` | 3 x 366 KB `snapshot-zsh-<ms>-<rand>.sh` | symlink | Per-session, unique names, swept by the retention job. Sharing keeps one sweep. Private would also work. |
| `cache/` | `changelog.md` 610 KB, `my-closed-issues.json` | symlink | Docs: refreshed in the background, nothing user-facing. Dir symlink, so the whole-file rewrites inside it are fine. |
| `downloads/` | Empty | symlink | Nothing account-bound. |
| `todos/`, `statsig/`, `logs/` | Not present here | recreate | Docs: "Legacy directories from older versions. No longer written. The sweep removes their contents and then the empty directory." Do not create; do not link. |
| Anything not listed | | symlink by default | New Claude Code features land as new entries in `~/.claude`. The private set is the identity set and is short; defaulting unknown entries to shared means a new feature works under mclaude before mclaude learns about it. caam's `populateInnerSymlinks` takes the same stance. |

Two mechanics follow from the table.

Link entries, not the directory. The Account dir itself must be real because `.claude.json`, its lock and the credential file live in it. mclaude links each child of `~/.claude` individually, skipping the private list. caam does this in `populateInnerSymlinks`; claude-swap does the same for its `SHARED_ITEMS` and records what it created in a manifest so `--no-share` only ever removes its own links.

Re-run the farm before every launch. New entries in `~/.claude` (a `workflows/` dir created last week, a `history.jsonl` recreated after a purge) need a link, and `symlink` on an existing correct link is a no-op. caam runs its farm at `shallow-spawn`; claude-swap at `cswap run`.

## Splitting `.claude.json`

### What the file holds

The [settings](https://code.claude.com/docs/en/settings) doc: "`~/.claude.json` [...] holds your sign-in session, MCP server configurations, per-project state such as trust decisions, and the global config keys that `/config` writes for you." The [mcp](https://code.claude.com/docs/en/mcp#mcp-installation-scopes) doc puts user-scope servers at top-level `mcpServers` and local-scope servers under `projects.<path>.mcpServers`.

Top-level keys in this machine's file, grouped by what they are bound to. Names are from the real file; the identity group also carries what the [settings-reference](https://code.claude.com/docs/en/settings-reference#global-config-settings) and caam's `claudeAccountKeys` list.

**Identity and account-derived caches. Stay in the Account dir, never copied in either direction.**

`oauthAccount` (20 fields: `accountUuid`, `emailAddress`, `organizationUuid`, `organizationName`, `organizationType`, `organizationRole`, `workspaceRole`, `billingType`, `seatTier`, `hasExtraUsageEnabled`, `organizationRateLimitTier`, `userRateLimitTier`, `accountCreatedAt`, `subscriptionCreatedAt`, `claudeCodeTrialEndsAt`, `claudeCodeTrialDurationDays`, `ccOnboardingFlags`, `displayName`, `fullName`, `profileFetchedAt`), `userID`, `cachedUsageUtilization` (caam lists it; absent here), `hasAvailableSubscription`, `subscriptionNoticeCount`, `cachedExtraUsageDisabledReason`, `overageCreditGrantCache` and `passesEligibilityCache` (both keyed by account uuid), `passesLastSeenRemaining`, `groveConfigCache` (keyed by org uuid), `modelAccessCache`, `orgModelDefaultCache`, `additionalModelOptionsCache`, `additionalModelCostsCache`, `autoCompactWindowsCache`, `penguinModeOrgEnabled`, `metricsStatusCache`, `clientDataCacheSlots`, `replBridgePlaceholders`, `cachedGrowthBookFeatures`, `cachedGrowthBookFeaturesAt`, `cachedExperimentFeatures`, `cachedExperimentData`.

The feature-flag caches are evaluated for a user and org, so they are treated as account-bound; there is no harm in an Account refetching them.

**Preferences. Shared home is the source of truth; copied into the Account dir at every launch.**

Top level: `theme`, `editorMode`, `preferredNotifChannel`, `autoUpdates`, `verbose`, `autoCompactEnabled`, `diffTool`, `parallelTasksCount`, `todoFeatureEnabled`, `messageIdleNotifThresholdMs`, `autoConnectIde`, `autoInstallIdeExtension`, `externalEditorContext`, `shiftEnterKeyBindingInstalled`, `optionAsMetaKeyInstalled`, `showSpinnerTree`, `mcpServers`, `hasCompletedOnboarding`, `lastOnboardingVersion`.

Per project, for every `projects.<path>` the Shared home knows (entry created in the Account copy if missing): `mcpServers`, `mcpContextUris`, `enabledMcpjsonServers`, `disabledMcpjsonServers`, `hasTrustDialogAccepted`, `hasClaudeMdExternalIncludesApproved`, `hasClaudeMdExternalIncludesWarningShown`, `allowedTools`.

`allowedTools` is an empty list in all 14 project entries here; the docs say standing permission approvals now go to `.claude/settings.local.json`. It stays on the list for older files.

**Volatile per-Account state. Left alone on both sides.**

`numStartups`, `firstStartTime`, `firstStartVersion`, `machineID`, `migrationVersion`, `installMethod`, `tipsHistory`, `tipLifetimeShownCounts`, `lastShownEmergencyTip`, `promptQueueUseCount`, `btwUseCount`, `skillUsage`, `seenNotifications`, `announcementImpressions`, `feedbackSurveyState`, the `*UpsellSeenCount` and `hasVisited*` flags, `changelogLastFetched`, `closedIssuesLastChecked`, `routineFiredWatermark`, `githubRepoPaths`, `appleTerminal*`, the `unpin*LaunchEffort` and `*MigrationComplete` flags, and under each project `lastCost`, `lastSessionId`, `lastSessionMetrics`, `lastModelUsage`, the `last*` duration and token counters, `exampleFiles`, `activeWorktreeSession`, `hasUnseenTeamArtifacts`, `lastGracefulShutdown`.

### How the two prior-art tools handle it

caam (shallow mode) keeps `.claude.json` real per profile. On create it seeds from the real `~/.claude.json` minus `claudeAccountKeys` (issue #92: before that, every new profile reported the real account's identity and usage). On every `shallow-spawn` it runs `SyncClaudeConfig`: copy `claudeSharedPreferenceKeys` and, per project, `claudeSharedProjectKeys` from the real file into the profile, real side winning, writing nothing when nothing changed, refusing a symlinked profile file so it can never write through to the real HOME. Issue #93 records why it is an allowlist rather than "everything except identity": the file "is written by a fast-moving tool and most of its top-level keys are volatile per-session state", so a blanket copy "would overwrite each profile's own state". Flow is one-way; `--no-sync-config` opts out.

claude-swap (session mode) also keeps the file real per profile, seeded from the account's backup with `oauthAccount`, `hasCompletedOnboarding: true` and a `theme` (its comment: Claude shows onboarding when `!config.theme || !config.hasCompletedOnboarding`). It mirrors exactly one key from the default profile, top-level `mcpServers`, on every `cswap run`, under Claude Code's own `.claude.json.lock`, stashing any session-local definitions the first mirror would displace. Per-project keys are not mirrored. Its README states the rule plainly: "manage them there; changes made inside a session don't persist."

Both converge on the same shape: private file, one-way copy from the real home at launch, allowlisted keys, take Claude Code's lock, never write back.

### Proposed strategy for mclaude

1. **Register** (`mclaude add`): create the Account dir, run the symlink farm, and seed `.claude.json` from `~/.claude.json` with the identity group removed and `hasCompletedOnboarding: true` set (keeping the Shared home's `theme`, which the seed carries). Then hand off to `claude auth login` in that dir. The seed makes the first launch skip theme setup; without it, an authenticated Account still walks through first-run onboarding (caam issue #80, quoted in `ensureClaudeOnboarding`).

2. **Every launch**, before exec, copy the preference group from `~/.claude.json` into the Account's `.claude.json`. Read the Shared file without a lock (Claude Code writes it atomically via rename, and `backups/` holds a copy of every version). Take the Account dir's `.claude.json.lock` (mkdir; it is the lock a running Claude Code in that dir uses), give up after a few seconds, and skip the copy rather than block the launch. Write nothing when nothing changed. Two exceptions to "Shared wins": the three per-project approval booleans merge as OR, so an approval given inside an mclaude session is never revoked at the next launch and the user is not re-prompted for trust on every Handoff; and `hasCompletedOnboarding` is forced true.

3. **Never write to `~/.claude.json`.** That is what rules out a sync loop: data flows one way, the merge is idempotent, and there is no sync state to get out of step. The cost is the same one claude-swap documents: a `/config` change, `claude mcp add -s user`, or a per-project MCP added inside an mclaude session lives in that Account's copy until the next launch overwrites it. Preferences are changed in the Shared home, meaning plain `claude` (whatever account is logged in there) or a text editor on `~/.claude.json`.

4. **Keep the private and preference lists in one place** in the source tree, the way caam's `claude_config.go` shares them between seed and sync, so seeding and refreshing can never disagree about which side a key is on. Unknown top-level keys default to volatile (left alone), the safe side.

Write-back (Account copy to Shared home for keys a session changed, detected against a snapshot taken at launch) would remove the cost in step 3 but adds a sidecar, a second writer to `~/.claude.json`, and a real chance of a loop between two concurrently running Accounts. Not recommended for the first version; worth its own ticket if users hit the `mcp add` case often.

## Symlinked `projects/` and `--resume`

Confirmed, three ways.

Docs. [cli-reference](https://code.claude.com/docs/en/cli-reference): "When you pass a session ID, Claude Code searches the current project directory and its git worktrees, then every other project on this machine. Before v2.1.223, the ID search covered only the current project directory and its git worktrees." [sessions](https://code.claude.com/docs/en/sessions): "The cross-project search resolves the ID only when exactly one other project holds a transcript with messages for it." `auth status` reports `projectsDirectory` as `<config dir>/projects`, so the search root is the entry mclaude links.

Probe. In a temp config dir holding only `projects -> /Users/jnsdls/.claude/projects` and no login:

```
claude -p --resume 0c0413e6-4047-441d-a621-d49fe76a9d36 "..."   ->  Not logged in · Please run /login
claude -p --resume 00000000-0000-0000-0000-000000000000 "..."   ->  No conversation found with session ID: 0000...
```

The real id got past session lookup and failed on auth; the bogus id failed on lookup. The lookup went through the symlink. The session id belongs to a different cwd than the one the probe ran from, so the cross-project search also works through the link.

Prior art. claude-swap's `--share-history` symlinks exactly `projects` and `history.jsonl` (`HISTORY_ITEMS`), and its README says "a session started under one account shows up in `--resume` under the others, and nothing already saved is lost." caam links `projects/` by default.

Two consequences for Handoff. The resumed session appends to the same `<session>.jsonl`, so no fork and no second transcript, unless mclaude passes `--fork-session`. And because `tasks/`, `plans/`, `file-history/` and `session-env/` are keyed by session id, they must be shared too, or the resumed session comes up without its task list and checkpoints (that is why they are symlinks in the table).

One caveat outside mclaude's control: a session's Anthropic-side prompt cache belongs to the account that built it, so the first turn after a Handoff pays full input cost (claude-swap README notes the same).

## Open questions for the spec

- Whether `sessions/` should be shared is a judgment call; pid-keyed names make it safe, and sharing keeps the agents view whole. Flip to private if cross-Account messaging turns out to be unwanted.
- `CLAUDE_CODE_PROJECT_DIR_NAME` (docs, v2.1.234+) pins the `projects/<name>` directory when `CLAUDE_CONFIG_DIR` is set. A host like t3/code could set it; mclaude should pass it through untouched.
- `claude auth logout` deletes `remote-settings.json` and `policy-limits.json` and "resets your first-launch setup state" (authentication doc). `mclaude remove` runs logout then deletes the dir, so this only matters if a future command logs out without removing.
