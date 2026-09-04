// The Run marker: <Account dir>/.mclaude/run/<mclaude pid>, written for as long
// as a launch runs there. Readers treat a pid that fails kill -0 as stale.
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runMarkerDir } from "./paths.ts";
import { writeFileAtomic } from "./record.ts";

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function writeRunMarker(accountDirPath: string, pid = process.pid): () => void {
  const file = join(runMarkerDir(accountDirPath), String(pid));
  writeFileAtomic(file, `${new Date().toISOString()}\n`);
  return () => rmSync(file, { force: true });
}

/** Live pids with a Run marker in the dir. Stale markers are deleted on the way. */
export function liveRunMarkers(accountDirPath: string): number[] {
  const dir = runMarkerDir(accountDirPath);
  if (!existsSync(dir)) return [];
  const live: number[] = [];
  for (const name of readdirSync(dir)) {
    const pid = Number(name);
    if (!Number.isInteger(pid) || pid <= 0) {
      rmSync(join(dir, name), { force: true });
      continue;
    }
    if (pidAlive(pid)) live.push(pid);
    else rmSync(join(dir, name), { force: true });
  }
  return live;
}
