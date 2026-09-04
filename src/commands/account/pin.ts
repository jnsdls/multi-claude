// `account pin <account>`, `unpin`, `disable <account>`, `enable <account>`
// (ADR 0011). Pin is the one-line `pinned` file beside `active`; Disabled is a
// field in the Record under the write rule. All four are idempotent and none
// opens config.json.
import { needsLogin, readCredential } from "../../credential.ts";
import { EXIT, ExitError } from "../../exit.ts";
import { warn } from "../../log.ts";
import { accountDir } from "../../paths.ts";
import { clearPinned, listOrphans, listRecords, readPinnedId, readRecord, updateRecord, writePinnedId, type AccountRecord } from "../../record.ts";
import { requireAccount } from "./common.ts";

function label(record: AccountRecord): string {
  return `${record.alias} (${record.id})`;
}

/** The one positional these commands take; any flag is a usage error. */
function oneAccount(args: string[], usage: string): AccountRecord {
  if (args.length !== 1 || args[0]!.startsWith("-")) throw new ExitError(EXIT.USAGE, `usage: mclaude account ${usage}`);
  const name = args[0]!;
  const records = listRecords();
  if (!records.some((r) => r.id === name || r.alias === name) && listOrphans().includes(name)) {
    throw new ExitError(EXIT.USAGE, `${name} is an Orphan with no Record. Run \`mclaude account remove ${name}\``);
  }
  return requireAccount(name, records);
}

export async function runPin(args: string[]): Promise<number> {
  const record = oneAccount(args, "pin <account>");
  if (record.disabled) warn(`${label(record)} is Disabled; a Pin still launches it`);
  if (needsLogin(await readCredential(accountDir(record.id)))) {
    warn(`${label(record)} needs login; no launch on it can succeed until \`mclaude account login ${record.alias}\``);
  }
  if (readPinnedId() === record.id) return EXIT.OK;
  writePinnedId(record.id);
  process.stdout.write(`pinned ${label(record)}\n`);
  return EXIT.OK;
}

export async function runUnpin(args: string[]): Promise<number> {
  if (args.length !== 0) throw new ExitError(EXIT.USAGE, "usage: mclaude account unpin");
  const id = readPinnedId();
  if (!id) return EXIT.OK;
  clearPinned();
  const record = readRecord(id);
  process.stdout.write(`unpinned ${record ? label(record) : id}\n`);
  return EXIT.OK;
}

export async function runDisable(args: string[]): Promise<number> {
  const record = oneAccount(args, "disable <account>");
  if (record.disabled) return EXIT.OK;
  if (readPinnedId() === record.id) warn(`${label(record)} is pinned; the Pin still launches it while it is Disabled`);
  updateRecord(record.id, (current) => ({ ...(current ?? record), disabled: true }));
  process.stdout.write(`disabled ${label(record)}\n`);
  return EXIT.OK;
}

export async function runEnable(args: string[]): Promise<number> {
  const record = oneAccount(args, "enable <account>");
  if (!record.disabled) return EXIT.OK;
  updateRecord(record.id, (current) => ({ ...(current ?? record), disabled: false }));
  process.stdout.write(`enabled ${label(record)}\n`);
  return EXIT.OK;
}

