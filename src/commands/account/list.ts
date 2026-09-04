// `account list [--refresh] [--json]`: every Account from cached Readings.
// Row building is pure over a Record, its state and the clock so the usage
// ticket only has to fill the Record.
import { readCredential, needsLogin } from "../../credential.ts";
import { EXIT, ExitError } from "../../exit.ts";
import { relativeAge, relativeUntil } from "../../format.ts";
import { warn } from "../../log.ts";
import { accountDir } from "../../paths.ts";
import { listOrphans, listRecords, readActiveId, readPinnedId, type AccountRecord, type Window } from "../../record.ts";

export type AccountState = "ok" | "needs login" | "orphan" | "disabled" | "unknown" | `limit ${string}`;

export const COLUMNS = ["", "ALIAS", "ID", "PLAN", "SESSION", "WEEK", "MODEL WINDOWS", "AGE", "STATE"] as const;

export interface RowInput {
  record: AccountRecord;
  state: AccountState;
  active: boolean;
  pinned: boolean;
}

/** `*` Active, `!` pinned, `*!` both. */
export function markers(active: boolean, pinned: boolean): string {
  return `${active ? "*" : ""}${pinned ? "!" : ""}`;
}

function windowCell(w: Window | null | undefined, now: number): string {
  if (!w || w.utilization === null || w.utilization === undefined) return "-";
  return `${Math.round(w.utilization)}% (${relativeUntil(w.resets_at, now)})`;
}

/** Per-model Windows: `Opus 12% (in 3d), Sonnet 4% (in 3d)`, or `-` when none. */
function modelWindowsCell(record: AccountRecord, now: number): string {
  const scoped = (record.usage.lastGood?.limits ?? []).filter((l) => l.scope?.model);
  if (scoped.length === 0) return "-";
  return scoped.map((l) => `${l.scope!.model!.display_name} ${Math.round(l.percent)}% (${relativeUntil(l.resets_at, now)})`).join(", ");
}

/** One table row's cells, in COLUMNS order. Pure. */
export function buildRow(input: RowInput, now: number = Date.now()): string[] {
  const { record } = input;
  const usage = record.usage;
  return [
    markers(input.active, input.pinned),
    record.alias,
    record.id,
    record.identity.subscriptionType ?? "-",
    windowCell(usage.lastGood?.five_hour, now),
    windowCell(usage.lastGood?.seven_day, now),
    modelWindowsCell(record, now),
    relativeAge(usage.fetchedAt, now),
    input.state,
  ];
}

export function orphanRow(id: string): string[] {
  return ["", "-", id, "-", "-", "-", "-", "-", "orphan"];
}

/** Disabled wins over ok; needs login wins over both. Limit and unknown arrive with usage. */
export function stateOf(record: AccountRecord, loggedOut: boolean): AccountState {
  if (loggedOut) return "needs login";
  if (record.disabled) return "disabled";
  return "ok";
}

/** Active first, then addedAt ascending. Pure. */
export function sortRecords(records: AccountRecord[], active: string | null): AccountRecord[] {
  return [...records].sort((a, b) => {
    if (a.id === active) return -1;
    if (b.id === active) return 1;
    return Date.parse(a.addedAt) - Date.parse(b.addedAt) || a.id.localeCompare(b.id);
  });
}

export function renderTable(rows: string[][]): string {
  const all = [[...COLUMNS], ...rows];
  const widths = COLUMNS.map((_, i) => Math.max(...all.map((r) => (r[i] ?? "").length)));
  return all
    .map((r) => r.map((cell, i) => (i === r.length - 1 ? cell : cell.padEnd(widths[i]!))).join("  ").trimEnd())
    .join("\n");
}

export async function runList(args: string[]): Promise<number> {
  let json = false;
  for (const a of args) {
    if (a === "--json") json = true;
    else if (a === "--refresh") {
      // --refresh polls every Account first; lands with #53
    } else throw new ExitError(EXIT.USAGE, `unknown flag "${a}" for account list`);
  }
  const records = listRecords();
  const orphans = listOrphans();
  const active = readActiveId();
  const pinnedRaw = readPinnedId();
  const pinned = pinnedRaw && records.some((r) => r.id === pinnedRaw) ? pinnedRaw : null;
  if (records.length === 0 && orphans.length === 0) {
    warn("no Accounts yet. Run `mclaude account add` to log in to one");
    if (json) process.stdout.write(`${JSON.stringify({ active: null, pinned: null, accounts: [], orphans: [] })}\n`);
    return EXIT.OK;
  }
  const sorted = sortRecords(records, active);
  const states = new Map<string, AccountState>();
  for (const r of sorted) states.set(r.id, stateOf(r, needsLogin(await readCredential(accountDir(r.id)))));

  if (json) {
    const body = {
      active,
      pinned,
      accounts: sorted.map((r) => ({ ...r, state: states.get(r.id) })),
      orphans: orphans.map((id) => ({ id, state: "orphan" })),
    };
    process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
    return EXIT.OK;
  }
  const now = Date.now();
  const rows = sorted.map((r) => buildRow({ record: r, state: states.get(r.id)!, active: r.id === active, pinned: r.id === pinned }, now));
  for (const id of orphans) rows.push(orphanRow(id));
  process.stdout.write(`${renderTable(rows)}\n`);
  return EXIT.OK;
}
