// Diffs the installed claude's flag and command names against the committed
// fixture. Run by the nightly claude-drift workflow, never by tests or launches.
// Prints a Markdown report and exits 1 when any name was added or removed.
//
//   bun run scripts/check-drift.ts [path-to-claude]
import { join } from "node:path";
import { extractFromClaude, resolveClaudeForScripts, type HelpNames } from "./extract-claude-help.ts";

export const FIXTURE_PATH = join(import.meta.dir, "..", "fixtures", "claude-help.json");

export interface Drift {
  installed: string;
  checked: string;
  flags: { added: string[]; removed: string[] };
  commands: { added: string[]; removed: string[] };
}

function diff(before: string[], after: string[]): { added: string[]; removed: string[] } {
  const b = new Set(before);
  const a = new Set(after);
  return {
    added: after.filter((x) => !b.has(x)).sort(),
    removed: before.filter((x) => !a.has(x)).sort(),
  };
}

export function driftBetween(fixture: HelpNames, installed: HelpNames): Drift {
  return {
    installed: installed.version,
    checked: fixture.version,
    flags: diff(fixture.flags, installed.flags),
    commands: diff(fixture.commands, installed.commands),
  };
}

export function hasDrift(d: Drift): boolean {
  return [d.flags.added, d.flags.removed, d.commands.added, d.commands.removed].some((l) => l.length > 0);
}

function list(names: string[]): string {
  return names.length ? names.map((n) => `- \`${n}\``).join("\n") : "- none";
}

export function report(d: Drift): string {
  const lines = [
    `Installed claude: ${d.installed}. Fixture: ${d.checked}.`,
    "",
    "## Flags added",
    list(d.flags.added),
    "",
    "## Flags removed",
    list(d.flags.removed),
    "",
    "## Commands added",
    list(d.commands.added),
    "",
    "## Commands removed",
    list(d.commands.removed),
  ];
  if (hasDrift(d)) {
    lines.push(
      "",
      "Re-read the four tables in `src/tables.ts`, regenerate `fixtures/claude-help.json` with",
      "`bun run scripts/extract-claude-help.ts > fixtures/claude-help.json`, and move `CHECKED_VERSION`",
      "in `src/version.ts` in the same PR. See `docs/release-checklist.md`.",
    );
  }
  return lines.join("\n");
}

if (import.meta.main) {
  const fixture = (await Bun.file(FIXTURE_PATH).json()) as HelpNames;
  const installed = await extractFromClaude(resolveClaudeForScripts(process.argv.slice(2)));
  const d = driftBetween(fixture, installed);
  console.log(report(d));
  process.exit(hasDrift(d) ? 1 : 0);
}
