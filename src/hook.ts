// `mclaude hook`: what the Limit hook runs (ADR 0008). Reads all stdin, no-ops
// unless MCLAUDE_LIMIT_DIR is set, writes one Signal atomically, exits 0
// whatever happens. Never opens config.json.
import { join } from "node:path";
import { writeFileAtomic } from "./record.ts";

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
    writeFileAtomic(join(dir, signalFileName(event, Date.now())), JSON.stringify(signal));
  } catch {
    // exit 0 whatever happens
  }
}
