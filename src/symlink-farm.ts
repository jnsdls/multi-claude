// Every entry of the Shared home is a per-entry symlink into the Account dir,
// unknown entries included, except the private list. Idempotent; reruns before
// every launch.
import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync, symlinkSync, type Stats } from "node:fs";
import { join } from "node:path";
import { warn } from "./log.ts";
import { sharedHome } from "./paths.ts";
import { PRIVATE_ENTRIES } from "./tables.ts";

function isEmptyDir(path: string): boolean {
  try {
    return readdirSync(path).length === 0;
  } catch {
    return false;
  }
}

export function runSymlinkFarm(accountDirPath: string, shared: string = sharedHome()): void {
  mkdirSync(accountDirPath, { recursive: true, mode: 0o700 });
  if (!existsSync(shared)) return;
  for (const entry of readdirSync(shared)) {
    if (PRIVATE_ENTRIES.has(entry)) continue;
    const target = join(shared, entry);
    const link = join(accountDirPath, entry);
    let st: Stats | null;
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
      } else if (st.isDirectory() && isEmptyDir(link)) {
        // Claude Code made the dir before the Shared home had the entry; nothing is lost by linking.
        rmSync(link, { recursive: true, force: true });
      } else {
        warn(
          `${link} is a real ${st.isDirectory() ? "directory" : "file"} where a link to ${target} belongs; merge it by hand`,
        );
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
