# Implementing mclaude

The launcher lives in `src/`, one TypeScript program on Bun. `scripts/build.ts` builds `dist/main.js` (what the tests run) and, with `--compile`, the four binaries plus an npm platform package for each under `npm/`. `bin/mclaude` is the npm launcher: a Node script that execs the binary from the platform package npm installed.

## Commands

```sh
bun install
bun run build          # dist/main.js; the tests spawn it under bun
bun test               # after a build; `bun run test` builds first
bunx tsc --noEmit      # typecheck
```

## Module map

| File | Owns |
| --- | --- |
| `src/main.ts` | dispatch on argv position zero |
| `src/argv.ts` | the argv contract: mode, own flags, scan-only flags, Session start classification; pure |
| `src/tables.ts` | the four drift tables (scanned flags, claude commands, Preferences keys, flag arity) and the private-entry list; Checked version lives in `src/version.ts` |
| `src/config.ts` | `config.json` parsing, precedence flag > env > file > default |
| `src/claude-path.ts` | where claude is |
| `src/env.ts` | the one child-environment builder (ADR 0013) |
| `src/spawn.ts` | spawn with inherited stdio, signal forwarding, exit mirroring, captured runs |
| `src/record.ts` | Record type, write rule, pointers (`active`, `pinned`), Orphans, name resolution |
| `src/runmarker.ts`, `src/symlink-farm.ts` | Run marker; per-entry symlinks into the Shared home |
| `src/usage.ts` | the usage request, its outcomes, the Record write, `pollAccount` and `pollMany` |
| `src/windows.ts` | pure Window rules (applicable, tightest, fresh, stands, Unknown) and the polling constants |
| `src/refresh.ts` | the Refresh trigger (ADR 0002) |
| `src/hook.ts` | `mclaude hook` |
| `src/launch.ts` | Passthrough: choose the Account, spawn, mirror exit; `LiveSession` and the relaunch seam |
| `src/handoff.ts` | Handoff: Selection at the wall, the kill, the relaunch with `--resume` and the resend |
| `src/transcript.ts` | the resend rule over the transcript; pure |
| `src/stdin-pump.ts` | the stream-json stdin pump: forward, queue during a swap, flush |
| `src/commands/account/*.ts` | one file per `account` subcommand |
| `src/commands/version.ts` | `mclaude version` |

## Test seams

Pure rules get table tests (`test/argv.test.ts`, `test/record.test.ts`, `test/config.test.ts`, `test/windows.test.ts`, `test/usage-merge.test.ts`, `test/transcript.test.ts`). Everything else drives the built `dist/main.js` through `test/harness/harness.ts`:

- `new Harness()` makes a temp `HOME` (with `.claude/` and `.claude.json`), a temp `MCLAUDE_HOME`, and a fake claude.
- `h.scenario({...})` scripts the fake claude (`test/harness/fake-claude.ts`): `--version` output, `auth login` outcome, refresh-trigger outcome, per-launch behaviour (exit code, sleep, hooks to fire from the `--settings` file, stdin echo, ignoring SIGTERM).
- `h.run(args)` spawns mclaude and returns stdout, stderr, exit code and signal. `h.spawn(args)` returns the process.
- `h.calls()` and `h.launches()` are what the fake recorded: argv, env, cwd, stdin lines.
- `h.plantAccount({...})` plants an Account dir and Record by hand; `h.startUsage(scenario)` starts the local usage endpoint and sets `MCLAUDE_USAGE_URL`.

Tests never import module internals for behaviour that has a process-seam observation. Add scenario fields to the fake claude when a ticket needs a new behaviour; keep it a script, not a framework.

## Conventions

- Every user-facing stderr line goes through `warn()` in `src/log.ts` and starts with `mclaude:`.
- Exit codes are `EXIT.*` in `src/exit.ts`; throw `ExitError` to unwind.
- Timestamps in Records are ISO 8601 UTC. Claude Code's millisecond epochs are converted on the way in.
- Files under `MCLAUDE_HOME` are 0600, dirs 0700, written by `writeFileAtomic`.
- No locks anywhere. No config keys for caps, ages or timeouts.
