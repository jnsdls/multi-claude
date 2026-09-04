declare const MCLAUDE_VERSION: string;

/** mclaude's own version, injected from package.json at build time. */
export const VERSION: string =
  typeof MCLAUDE_VERSION === "string" ? MCLAUDE_VERSION : "0.0.0-dev";

/** The Claude Code release a person last read the four tables against (ADR 0012). */
export const CHECKED_VERSION = "2.1.259";

/** The oldest Claude Code release a Session start will run on (ADR 0012). */
export const VERSION_FLOOR = "2.1.223";

/** Parses "2.1.259 (Claude Code)" into [2, 1, 259]. Returns null when no version is found. */
export function parseVersion(text: string): [number, number, number] | null {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function compareVersions(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}
