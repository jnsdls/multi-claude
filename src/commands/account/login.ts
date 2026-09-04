// `account login <account>`: log in again inside the existing dir, keeping id,
// Alias and history. An identity that no longer matches the Record is refused
// and logged out again.
import { existsSync, mkdirSync } from "node:fs";
import { EXIT, ExitError } from "../../exit.ts";
import { accountDir, sharedClaudeJson } from "../../paths.ts";
import { accountClaudeJson, readClaudeJson, seedClaudeJson, syncPreferences } from "../../prefs.ts";
import { updateRecord, writeFileAtomic } from "../../record.ts";
import { runSymlinkFarm } from "../../symlink-farm.ts";
import { claudeForLogin, identityLine, loginInDir, logoutInDir, parseLoginFlags, requireAccount, sameIdentity } from "./common.ts";

export async function runLogin(args: string[]): Promise<number> {
  const { positionals, flags } = parseLoginFlags(args);
  if (positionals.length !== 1) throw new ExitError(EXIT.USAGE, "usage: mclaude account login <account> [--email <e>] [--sso]");
  const record = requireAccount(positionals[0]);
  const claudePath = claudeForLogin();
  const dir = accountDir(record.id);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  runSymlinkFarm(dir);
  if (!existsSync(accountClaudeJson(dir))) {
    const seed = seedClaudeJson(readClaudeJson(sharedClaudeJson()) ?? {});
    writeFileAtomic(accountClaudeJson(dir), `${JSON.stringify(seed, null, 2)}\n`);
  }
  await syncPreferences(dir);

  let identity;
  try {
    identity = await loginInDir(claudePath, dir, record.id, flags);
    if (!sameIdentity(record.identity, identity)) {
      throw new ExitError(
        EXIT.DUPLICATE,
        `login as ${identity.email} does not match ${record.alias} (${record.id}, ${record.identity.email}); logged out again. Use \`mclaude account add\` for a new Account`,
      );
    }
  } catch (e) {
    await logoutInDir(claudePath, dir, record.id);
    throw e;
  }
  const next = updateRecord(record.id, (current) => ({ ...(current ?? record), identity }));
  process.stdout.write(identityLine(next));
  return EXIT.OK;
}
