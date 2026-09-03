// PROTOTYPE, throwaway. The Limit hook: stdin payload -> Signal file, exit 0.
import { writeFileSync, renameSync, mkdirSync } from "node:fs";
const dir = process.env.MCLAUDE_LIMIT_DIR;
if (dir) {
  const raw = await Bun.stdin.text();
  let payload: any = {}; try { payload = JSON.parse(raw); } catch {}
  const name = `${payload.hook_event_name ?? "unknown"}-${Date.now()}.json`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/.${name}.tmp`, JSON.stringify({ payload, accountId: process.env.MCLAUDE_ACCOUNT, receivedAt: new Date().toISOString() }));
  renameSync(`${dir}/.${name}.tmp`, `${dir}/${name}`);
}
process.exit(0);
