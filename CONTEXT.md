# mclaude

A launcher that runs the Claude Code CLI under one of several subscription accounts, picking the account with headroom and moving the conversation to another account when a limit is hit.

## Language

**Account**:
One Claude subscription login (Pro, Max, Team or Enterprise seat) registered with mclaude. Two logins are the same Account when both the account uuid and the organization uuid match; the same person in two organizations is two Accounts.
_Avoid_: Profile, slot, credential, user

**Account id**:
The short opaque name mclaude mints for an Account when it is added, fixed for the Account's whole life. Names the Account dir and the Record.
_Avoid_: Slug, handle, key

**Alias**:
The human label for an Account, shown by `list` and accepted wherever an Account id is. Defaults to the Account's email and can be renamed at any time.
_Avoid_: Name, label, nickname

**Record**:
What mclaude remembers about one Account: its identity, its alias, the last usage reading and the last Limit it reported. An Account exists once its Record exists.
_Avoid_: State entry, profile, cache

**Orphan**:
An Account dir with no Record, left when adding an Account did not reach a completed login. Not an Account; `list` points it out so it can be removed.
_Avoid_: Pending account, half-added

**Account dir**:
The private directory mclaude gives an Account, passed to Claude Code as its config dir so login state stays separate from every other Account.
_Avoid_: Profile dir, config dir (that is Claude Code's name for the mechanism, not ours)

**Shared home**:
The user's real Claude Code directory, holding settings, memory, plugins, skills and session history. Every Account dir links back to it so all Accounts see one setup.

**Window**:
One usage budget with its own reset time. Claude reports a session window (5 hours), a weekly window (all models) and per-model weekly windows.
_Avoid_: Bucket, quota, limit (see Limit)

**Utilization**:
How much of a Window has been used, as a percentage.
_Avoid_: Usage, consumption

**Headroom**:
What is left in the Window that matters for a launch: the tightest of the Windows that apply to the requested model. Credits never count as Headroom.
_Avoid_: Remaining, budget, credits

**Limit**:
The event of Claude rejecting a request because a Window is fully used. Recorded against the Account and its Window, and trusted until that Window's Reset or a later reading showing the Window open.
_Avoid_: Rate limit (Claude's transient 429 backoff is not a Limit), wall, exhaustion (see Exhausted)

**Reset**:
The moment a Window's Utilization returns to zero.

**Active account**:
The Account mclaude last launched under. Selection is sticky: the Active account keeps being chosen until it has no Headroom.
_Avoid_: Current, default, primary

**Selection**:
The rule that chooses the Account for a Session start: stay on the Active account unless it is past the Switch threshold or holds a Limit for the Requested model, else the Account with the most Headroom whose Utilization is under the Switch threshold; when no Account qualifies, stay put.
_Avoid_: Rotation, balancing, strategy

**Switch threshold**:
The Utilization of the Active account's tightest applicable Window above which Selection looks for another Account. A preference, never a wall: an Account past it still has Headroom.
_Avoid_: Limit, cutoff, budget

**Requested model**:
The model a Session start will run under, as far as mclaude can tell from the arguments, environment and settings. When it cannot tell, every per-model Window counts toward Headroom.
_Avoid_: Target model, default model

**Handoff**:
Relaunching Claude Code on another Account with the same conversation resumed and the original arguments intact, after a Limit.
_Avoid_: Switch, swap, failover, migration

**Exhausted**:
The state where no Account has Headroom for the requested model. An Account has no Headroom only when the tightest Window reads full or it reported a Limit in that Window; a Selection threshold never makes an Account Exhausted.

**Credits**:
Anthropic's pay-as-you-go extra usage enabled on an Account, spent once its Windows are full. Never Headroom; the second tier of Fallback.
_Avoid_: Overage, extra usage, budget

**Fallback**:
The Account launched when Exhausted: an Unknown Account first, then one with Credits and its spend limit not reached, then the one whose tightest Window resets soonest. A Fallback Account is never sticky.
_Avoid_: Least-bad, last resort, degraded

**Unknown**:
The state of an Account whose Headroom cannot currently be read (endpoint throttled, hollow response, token unreadable). Distinct from Exhausted: an Unknown Account may still be tried.
_Avoid_: Stale, unavailable, failed

**Passthrough**:
Any invocation mclaude forwards to Claude Code unchanged apart from choosing the Account and appending a session id. Everything whose first word is not a Reserved word.
_Avoid_: Proxy, wrapper mode

**Reserved word**:
A first argument mclaude keeps for itself instead of forwarding: `account`, which holds the management commands, and `version`. A bare `--` forces Passthrough of whatever follows.
_Avoid_: Subcommand, namespace

**Session start**:
A Passthrough that opens or resumes a conversation, so it spends tokens and runs Selection. Every other Passthrough runs on the Active account with no usage reading.
_Avoid_: Launch (that is mclaude's own act), interactive
