---
status: accepted
---
# A Pin or Override names the Account absolutely, and Handoff stays off

When the user pins an Account or names one for a launch with `--account` or `MCLAUDE_USE_ACCOUNT`, mclaude launches on that Account no matter what its Record says. Past the Switch threshold it launches silently. Holding a Limit for the Requested model it launches after one stderr line and lets Claude Code wait at its own wall, the same choice ADR 0003 makes for an Exhausted pool; `onExhausted=fail` exits 75 as there. A Limit Signal during such a session is still written to the Record, so other sessions learn about it, but Handoff does not run: Selection under a Pin would return the same Account, and a relaunch that lands where it started only loses the auto-continue.

The reason a pin exists is that the conversation belongs to that Account: a Team organization whose data must not cross into a personal login, a bill that has to land on one plan, or a test of one login. In every one of those cases moving to another Account is the wrong outcome, and a launcher that quietly did so on a Limit would be defeating the order it was given. So a Pin holds through a Limit rather than breaking on it.

A Disabled Account follows the same reading. Disabling means "do not choose this for me", so Selection, Fallback and Handoff skip it, but a Pin or Override still launches it, with one stderr line. Nothing short of `remove` makes an Account unlaunchable by name; a Needs login Account fails the launch with exit 1 rather than falling through to Selection, because the user asked for that Account and a silent substitute is worse than an error.

## Considered options

A pin that holds through the threshold but breaks on a Limit, running Handoff and dropping the pin. Rejected because the cases that need a pin are exactly the ones where crossing Accounts is wrong, and a pin that vanishes under load is not one the user can rely on.

A pin that never leaves the Account but keeps Handoff armed for the moment the pin is lifted mid-session. Rejected as machinery for a case that has not come up; `unpin` followed by a plain relaunch covers it.

Storing the pin as a `pinned: true` field in each Record. Rejected because only one Account can be pinned and the Records are written lock-free per file (ADR 0005), so uniqueness would need N writes; a one-line `pinned` file beside `active` is the same shape as the Active pointer.

Reading `MCLAUDE_ACCOUNT` as the override input. Rejected because mclaude already sets it on the child to report the chosen Account, and a nested launch from inside a Claude Code session would inherit it and be silently forced onto the parent's Account.
