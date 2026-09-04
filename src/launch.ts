// Passthrough: everything whose first word is not a Reserved word. Chooses the
// Account, builds the child environment, spawns claude with inherited stdio and
// mirrors its exit. Session starts additionally run Selection and carry the Limit
// hook; the pieces those need plug in here.
import { existsSync } from "node:fs";
import { classify, isStreamJsonInput, scanArgv, stripOwnFlags, type OwnFlags, type Scan } from "./argv.ts";
import { resolveClaude } from "./claude-path.ts";
import { loadConfigFile, resolveSettings, type Settings } from "./config.ts";
import { buildChildEnv } from "./env.ts";
import { EXIT, ExitError } from "./exit.ts";
import { warn } from "./log.ts";
import { accountDir } from "./paths.ts";
import { readActiveId, readRecord, writeActiveId, type AccountRecord } from "./record.ts";
import { writeRunMarker } from "./runmarker.ts";
import { exitLike, forwardSignals, runCaptured, spawnClaude } from "./spawn.ts";
import { runSymlinkFarm } from "./symlink-farm.ts";
import { compareVersions, parseVersion, VERSION, VERSION_FLOOR } from "./version.ts";

export const HELP_FOOTER = [
  "mclaude: runs Claude Code under the Account with headroom. Reserved words: account, version, hook.",
  "mclaude: own flags: --account <id|alias>, --switch-threshold <n>, --on-exhausted <launch|fail>.",
  "mclaude: `mclaude -- <args>` forwards everything after the -- to claude unchanged.",
].join("\n");

export interface LaunchContext {
  own: OwnFlags;
  forwarded: string[];
  scan: Scan;
  settings: Settings;
  claudePath: string;
}

/** The Account a launch runs on. */
export interface Chosen {
  record: AccountRecord;
  dir: string;
  /** Whether this launch writes `active`. False on a Fallback or Override launch. */
  makeActive: boolean;
}

export async function runPassthrough(argv: string[], opts: { forced: boolean }): Promise<number> {
  const stripped = opts.forced ? { own: {}, forwarded: argv, errors: [] } : stripOwnFlags(argv);
  if (stripped.errors.length) throw new ExitError(EXIT.USAGE, stripped.errors[0]!);
  const scan = scanArgv(stripped.forwarded);
  const kind = classify(scan);

  // Passthrough reads all three config keys.
  const settings = resolveSettings(stripped.own, loadConfigFile());
  const claudePath = resolveClaude(settings);
  const ctx: LaunchContext = { own: stripped.own, forwarded: stripped.forwarded, scan, settings, claudePath };

  switch (kind) {
    case "version":
      return runVersionFlag(ctx);
    case "auth-refused":
      throw new ExitError(
        EXIT.USAGE,
        `auth ${scan.positionals[1]} is refused: use \`mclaude account add\` and \`mclaude account remove\` so an Account dir never desyncs`,
      );
    case "help":
      return runHelp(ctx);
    case "passthrough":
      return runPlainPassthrough(ctx);
    case "session-start":
      return runSessionStart(ctx);
  }
}

/** `--version`/`-v`: claude's own string on stdout, mclaude's on stderr, same resolved path. */
async function runVersionFlag(ctx: LaunchContext): Promise<number> {
  const active = readActiveId();
  const env = buildChildEnv(active ? { accountDir: accountDir(active), accountId: active } : {});
  const child = spawnClaude(ctx.claudePath, { argv: ctx.forwarded, env });
  await child.exited;
  process.stderr.write(`mclaude ${VERSION}\n`);
  exitLike(child);
}

async function runHelp(ctx: LaunchContext): Promise<number> {
  const active = readActiveId();
  const env = buildChildEnv(active ? { accountDir: accountDir(active), accountId: active } : {});
  const child = spawnClaude(ctx.claudePath, { argv: ctx.forwarded, env });
  await child.exited;
  process.stderr.write(`${HELP_FOOTER}\n`);
  exitLike(child);
}

/** The Active account, or exit 1 with a pointer at `account add`. */
export function requireActiveAccount(): Chosen {
  const id = readActiveId();
  if (!id) {
    throw new ExitError(EXIT.REFUSED, "no Active account. Run `mclaude account add` to log in to one");
  }
  const record = readRecord(id)!;
  return { record, dir: accountDir(id), makeActive: true };
}

/** Maintenance commands run on the Active account with no poll and no Version floor check. */
async function runPlainPassthrough(ctx: LaunchContext): Promise<number> {
  const chosen = chooseForPlainPassthrough(ctx);
  return spawnOn(ctx, chosen, ctx.forwarded, { limitDir: undefined });
}

/** Override, then Pin, then the Active account. Selection never runs here. */
function chooseForPlainPassthrough(_ctx: LaunchContext): Chosen {
  return requireActiveAccount();
}

async function runSessionStart(ctx: LaunchContext): Promise<number> {
  await checkVersionFloor(ctx);
  const chosen = chooseForSessionStart(ctx);
  if (ctx.scan.bare || ctx.scan.safeMode) {
    warn(`${ctx.scan.bare ? "--bare" : "--safe-mode"} skips hooks, so Handoff is off for this launch`);
  }
  return spawnOn(ctx, chosen, ctx.forwarded, { limitDir: undefined });
}

/** Override, then Pin, then Selection. */
function chooseForSessionStart(_ctx: LaunchContext): Chosen {
  return requireActiveAccount();
}

/** A Session start on a claude below the Version floor is refused with exit 69. Unparseable output proceeds. */
export async function checkVersionFloor(ctx: LaunchContext): Promise<void> {
  const active = readActiveId();
  const env = buildChildEnv(active ? { accountDir: accountDir(active), accountId: active } : {});
  const r = await runCaptured(ctx.claudePath, ["--version"], env, { timeoutMs: 10_000 });
  const found = parseVersion(r.stdout);
  if (!found) return;
  if (compareVersions(found, parseVersion(VERSION_FLOOR)!) < 0) {
    throw new ExitError(
      EXIT.NO_CLAUDE,
      `claude ${found.join(".")} is below the version floor ${VERSION_FLOOR}; Handoff would lose the conversation. Update Claude Code`,
    );
  }
}

/** Spawns claude on the chosen Account with inherited stdio and mirrors its exit. */
export async function spawnOn(
  ctx: LaunchContext,
  chosen: Chosen,
  argv: string[],
  opts: { limitDir: string | undefined; cwd?: string },
): Promise<never> {
  if (!existsSync(chosen.dir)) {
    throw new ExitError(EXIT.REFUSED, `Account dir for ${chosen.record.alias} (${chosen.record.id}) is missing`);
  }
  runSymlinkFarm(chosen.dir);
  if (chosen.makeActive) writeActiveId(chosen.record.id);
  const env = buildChildEnv({ accountDir: chosen.dir, accountId: chosen.record.id, limitDir: opts.limitDir });
  const releaseMarker = writeRunMarker(chosen.dir);
  const child = spawnClaude(ctx.claudePath, {
    argv,
    env,
    cwd: opts.cwd,
    stdin: isStreamJsonInput(ctx.scan) ? "inherit" : "inherit",
  });
  const stopForwarding = forwardSignals(() => child);
  try {
    await child.exited;
  } finally {
    stopForwarding();
    releaseMarker();
  }
  exitLike(child);
}
