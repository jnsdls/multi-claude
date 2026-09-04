// `account add [alias] [--email <e>] [--sso]`: mint an id, make the dir, log in
// through claude, keep the Record only when every check passes.
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { EXIT, ExitError } from "../../exit.ts";
import { warn } from "../../log.ts";
import { accountDir, sharedClaudeJson } from "../../paths.ts";
import { readClaudeJson, seedClaudeJson, accountClaudeJson } from "../../prefs.ts";
import {
  EMPTY_USAGE,
  listRecords,
  mintId,
  nowIso,
  writeActiveId,
  writeFileAtomic,
  writeRecord,
  type AccountRecord,
} from "../../record.ts";
import { runSymlinkFarm } from "../../symlink-farm.ts";
import { describeOutcome, pollAccount } from "../../usage.ts";
import { LIST_TIMEOUT_MS } from "../../windows.ts";
import {
  assertAliasFree,
  claudeForLogin,
  identityLine,
  loginInDir,
  logoutInDir,
  parseLoginFlags,
  sameIdentity,
} from "./common.ts";

export async function runAdd(args: string[]): Promise<number> {
  const { positionals, flags } = parseLoginFlags(args);
  if (positionals.length > 1) throw new ExitError(EXIT.USAGE, "account add takes at most one alias");
  const requestedAlias = positionals[0];
  const claudePath = claudeForLogin();
  const before = listRecords();
  if (requestedAlias !== undefined) assertAliasFree(requestedAlias, before);

  // The dir exists before login because Claude Code hashes its path into the
  // Keychain service name (ADR 0004).
  let id = mintId();
  while (existsSync(accountDir(id))) id = mintId();
  const dir = accountDir(id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  runSymlinkFarm(dir);
  const seed = seedClaudeJson(readClaudeJson(sharedClaudeJson()) ?? {});
  writeFileAtomic(accountClaudeJson(dir), `${JSON.stringify(seed, null, 2)}\n`);

  let record: AccountRecord;
  try {
    const identity = await loginInDir(claudePath, dir, id, flags);
    const existing = before.find((r) => sameIdentity(r.identity, identity));
    if (existing) {
      throw new ExitError(
        EXIT.DUPLICATE,
        `${identity.email} is already added as ${existing.alias} (${existing.id}); run \`mclaude account login ${existing.alias}\` to log in again`,
      );
    }
    record = {
      version: 1,
      id,
      alias: chooseAlias(requestedAlias, identity.email, id, before),
      addedAt: nowIso(),
      disabled: false,
      identity,
      usage: { ...EMPTY_USAGE },
      lastLimit: null,
    };
  } catch (e) {
    await logoutInDir(claudePath, dir, id);
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  writeRecord(record);
  if (before.length === 0) writeActiveId(id);
  // One Reading so `list` has something to show; a failed poll is not a failed add.
  const polled = await pollAccount(record, { timeoutMs: LIST_TIMEOUT_MS, claudePath });
  const line = describeOutcome(record.alias, polled);
  if (line) warn(line);
  process.stdout.write(identityLine(record));
  return EXIT.OK;
}

/** The Alias defaults to the email; when that is taken the id stands in, with a pointer at rename. */
function chooseAlias(requested: string | undefined, email: string, id: string, records: AccountRecord[]): string {
  if (requested !== undefined) return requested;
  const taken = records.some((r) => r.alias === email || r.id === email);
  if (email && !taken) return email;
  warn(
    `Alias "${email || "(no email)"}" is taken, using the id ${id}; run \`mclaude account rename ${id} <alias>\` to change it`,
  );
  return id;
}
