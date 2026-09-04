// `account remove <account> [--yes] [--force]`: log out through claude, then
// delete the dir, the Record and a matching `active` or `pinned`. Logout failure
// never leaves the Account in place; the operator gets the Keychain name instead.
import { existsSync, rmSync } from "node:fs";
import { createInterface } from "node:readline";
import { keychainServiceName } from "../../credential.ts";
import { EXIT, ExitError } from "../../exit.ts";
import { warn } from "../../log.ts";
import { accountDir } from "../../paths.ts";
import { clearActiveIfMatches, clearPinnedIfMatches, deleteRecord, listOrphans, listRecords, resolveAccount } from "../../record.ts";
import { liveRunMarkers } from "../../runmarker.ts";
import { claudeWithoutConfig, logoutInDir } from "./common.ts";

interface Target {
  id: string;
  alias: string;
  email: string;
  orphan: boolean;
}

function parseArgs(args: string[]): { name: string; yes: boolean; force: boolean } {
  let name: string | undefined;
  let yes = false;
  let force = false;
  for (const a of args) {
    if (a === "--yes" || a === "-y") yes = true;
    else if (a === "--force" || a === "-f") force = true;
    else if (a.startsWith("-")) throw new ExitError(EXIT.USAGE, `unknown flag "${a}" for account remove`);
    else if (name === undefined) name = a;
    else throw new ExitError(EXIT.USAGE, "account remove takes one Account");
  }
  if (name === undefined) throw new ExitError(EXIT.USAGE, "usage: mclaude account remove <account> [--yes] [--force]");
  return { name, yes, force };
}

/** A Record by id or Alias, or an Orphan by id. */
function findTarget(name: string): Target {
  const record = resolveAccount(name, listRecords());
  if (record) return { id: record.id, alias: record.alias, email: record.identity.email, orphan: false };
  if (listOrphans().includes(name)) return { id: name, alias: "-", email: "-", orphan: true };
  throw new ExitError(EXIT.USAGE, `no Account or Orphan named "${name}"`);
}

async function confirm(target: Target): Promise<boolean> {
  const what = target.orphan ? `Orphan ${target.id}` : `${target.alias} (${target.email}, ${target.id})`;
  process.stderr.write(`mclaude: remove ${what}? This logs out and deletes its dir. [y/N] `);
  const rl = createInterface({ input: process.stdin, terminal: false });
  const answer = await new Promise<string>((resolve) => {
    rl.once("line", (l) => resolve(l));
    rl.once("close", () => resolve(""));
  });
  rl.close();
  const a = answer.trim().toLowerCase();
  return a === "y" || a === "yes";
}

export async function runRemove(args: string[]): Promise<number> {
  const { name, yes, force } = parseArgs(args);
  const target = findTarget(name);
  const dir = accountDir(target.id);

  const live = existsSync(dir) ? liveRunMarkers(dir) : [];
  if (live.length > 0 && !force) {
    throw new ExitError(
      EXIT.REFUSED,
      `${target.alias === "-" ? target.id : target.alias} is in use by pid ${live.join(", ")}; pass --force to remove it anyway`,
    );
  }
  if (!yes) {
    if (!process.stdin.isTTY) throw new ExitError(EXIT.USAGE, "no TTY to confirm on; pass --yes");
    if (!(await confirm(target))) throw new ExitError(EXIT.REFUSED, "not removed");
  }

  if (existsSync(dir)) {
    // remove never opens config.json, so claude comes from the environment or PATH only.
    const ok = await logoutInDir(claudeWithoutConfig(), dir, target.id);
    if (!ok) {
      warn(
        `claude auth logout failed for ${target.id}; deleting anyway. If a Keychain item named "${keychainServiceName(dir)}" remains, delete it by hand`,
      );
    }
    rmSync(dir, { recursive: true, force: true });
  }
  deleteRecord(target.id);
  clearActiveIfMatches(target.id);
  clearPinnedIfMatches(target.id);
  warn(target.orphan ? `removed Orphan ${target.id}` : `removed ${target.alias} (${target.id})`);
  return EXIT.OK;
}
