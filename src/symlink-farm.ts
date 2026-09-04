// Every entry of the Shared home is a per-entry symlink into the Account dir,
// unknown entries included, except the private list. Idempotent; reruns before
// every launch.
import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { sharedHome } from "./paths.ts";
import { PRIVATE_ENTRIES } from "./tables.ts";

export function runSymlinkFarm(accountDirPath: string, shared: string = sharedHome()): void {
  mkdirSync(accountDirPath, { recursive: true, mode: 0o700 });
  if (!existsSync(shared)) return;
  for (const entry of readdirSync(shared)) {
    if (PRIVATE_ENTRIES.has(entry)) continue;
    const target = join(shared, entry);
    const link = join(accountDirPath, entry);
    let st;
    try {
      st = lstatSync(link);
    } catch {
      st = null;
    }
    if (st) {
      if (st.isSymbolicLink()) {
        try {
          if (readlinkSync(link) === target) continue;
        } catch {
          // fall through and relink
        }
        rmSync(link, { force: true });
      } else {
        // A real file or dir Claude Code created before the farm ran. Leave it: it
        // may hold data, and a private entry is always safe.
        continue;
      }
    }
    try {
      symlinkSync(target, link);
    } catch {
      // Racing launch created it first.
    }
  }
}
