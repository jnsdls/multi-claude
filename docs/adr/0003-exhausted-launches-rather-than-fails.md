---
status: accepted
---
# When every account is exhausted, launch anyway

When no Account has Headroom for the requested model, mclaude still launches Claude Code, on the Fallback Account, and prints one stderr line saying so. It does not fail and does not sleep until the earliest Reset. Claude Code already waits at its own wall: the interactive session keeps the process alive, saves progress and auto-continues at Reset, and in headless and stream-json modes the host already understands Claude Code's own rate-limit signals. A launcher that fails or sleeps instead would replace that with a second failure mode every host must learn, and would throw away the auto-continue. The same holds mid-session: if a Limit hits and no Account has Headroom, mclaude leaves the child alive rather than trading one wall for another.

Callers that would rather fail set `onExhausted=fail`, carried by a config key, a `--on-exhausted` flag and the `MCLAUDE_ON_EXHAUSTED` env var (flag over env over config). That path exits 75, `EX_TEMPFAIL` from sysexits, with one stderr line naming the earliest Reset, so scripts can tell exhaustion from a crash. The knob applies only at launch, never mid-session.

## Considered options

Fail by default with exit 75. Rejected because the common case, a person at the TUI, would lose the free wait and have to relaunch by hand.

An mclaude-side wait until the earliest Reset. Rejected as out of scope: the TUI already waits, and a headless caller can loop on exit 75.

Counting Credits as Headroom during normal Selection. Rejected because it spends money while other Accounts still have free budget; Credits are the second Fallback tier instead, and a Fallback Account is dropped as soon as any Account regains Headroom.
