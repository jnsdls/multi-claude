// `account rename <account> <alias>`: the Alias is the one thing about an
// Account that may change (ADR 0004).
import { EXIT, ExitError } from "../../exit.ts";
import { listRecords, updateRecord } from "../../record.ts";
import { assertAliasFree, requireAccount } from "./common.ts";

export async function runRename(args: string[]): Promise<number> {
  if (args.length !== 2 || args.some((a) => a.startsWith("-"))) {
    throw new ExitError(EXIT.USAGE, "usage: mclaude account rename <account> <alias>");
  }
  const [name, alias] = args as [string, string];
  const records = listRecords();
  const record = requireAccount(name, records);
  if (record.alias === alias) return EXIT.OK;
  assertAliasFree(alias, records, record.id);
  updateRecord(record.id, (current) => ({ ...(current ?? record), alias }));
  return EXIT.OK;
}
