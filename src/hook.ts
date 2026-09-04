// `mclaude hook`: what the Limit hook runs (ADR 0008). Reads all stdin, no-ops
// unless MCLAUDE_LIMIT_DIR is set, writes one Signal by tmp plus rename, exits 0
// whatever happens. Never opens config.json.
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Signal {
  payload: Record<string, unknown>;
  accountId: string | null;
  receivedAt: string;
}

export function signalFileName(event: string, epochMs: number): string {
  const safe = /^[A-Za-z0-9_-]+$/.test(event) ? event : "unknown";
  return `${safe}-${epochMs}.json`;
}

export async function runHook(): Promise<void> {
  try {
    const raw = await Bun.stdin.text();
    const dir = process.env.MCLAUDE_LIMIT_DIR;
    if (!dir) return;
    let payload: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") payload = parsed;
    } catch {
      payload = { raw };
    }
    const event = typeof payload.hook_event_name === "string" ? payload.hook_event_name : "unknown";
    const signal: Signal = {
      payload,
      accountId: process.env.MCLAUDE_ACCOUNT ?? null,
      receivedAt: new Date().toISOString(),
    };
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const name = signalFileName(event, Date.now());
    const tmp = join(dir, `.${name}.${process.pid}.tmp`);
    writeFileSync(tmp, JSON.stringify(signal), { mode: 0o600 });
    renameSync(tmp, join(dir, name));
  } catch {
    // exit 0 whatever happens
  }
}
