# mclaude

A launcher that runs the Claude Code CLI under one of several subscription accounts, picking the account with headroom and moving the conversation to another account when a limit is hit.

## Language

**Account**:
One Claude subscription login (Pro, Max, Team or Enterprise seat) registered with mclaude. Identified by the email and account uuid Claude Code reports for it.
_Avoid_: Profile, slot, credential, user

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
What is left in the Window that matters for a launch: the tightest of the Windows that apply to the requested model.
_Avoid_: Remaining, budget, credits

**Limit**:
The event of Claude rejecting a request because a Window is fully used. Carries which Window and when it resets.
_Avoid_: Rate limit (Claude's transient 429 backoff is not a Limit), wall, exhaustion (see Exhausted)

**Reset**:
The moment a Window's Utilization returns to zero.

**Active account**:
The Account mclaude last launched under. Selection is sticky: the Active account keeps being chosen until it has no Headroom.
_Avoid_: Current, default, primary

**Selection**:
The rule that chooses the Account for a launch: stay on the Active account unless it is past the switch threshold or reported a Limit, else the Account with the most Headroom.
_Avoid_: Rotation, balancing, strategy

**Handoff**:
Relaunching Claude Code on another Account with the same conversation resumed and the original arguments intact, after a Limit.
_Avoid_: Switch, swap, failover, migration

**Exhausted**:
The state where no Account has Headroom for the requested model.

**Passthrough**:
Any invocation mclaude forwards to Claude Code unchanged apart from choosing the Account. Everything that is not one of mclaude's own management commands.
