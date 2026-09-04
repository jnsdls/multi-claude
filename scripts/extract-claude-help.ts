// Extracts the flag and command names from `claude --help` (ADR 0012). Only
// names are kept, so wording changes never show up in the drift diff.
//
//   bun run scripts/extract-claude-help.ts [path-to-claude] > fixtures/claude-help.json
//
// The parser is exported so a test can feed it a fixed help text.
import { parseVersion } from "../src/version.ts";

export interface HelpNames {
  version: string;
  flags: string[];
  commands: string[];
}

/** Section headings in commander's help output. */
const SECTION = /^(\S.*):\s*$/;

/**
 * Pulls flag names from the Options section and command names from the Commands
 * section. An entry line is indented by exactly two spaces; deeper indents are
 * description continuations. `--allowedTools, --allowed-tools <tools...>` gives
 * both names; `plugin|plugins` gives both commands.
 */
export function parseHelpNames(help: string): { flags: string[]; commands: string[] } {
  const flags = new Set<string>();
  const commands = new Set<string>();
  let section = "";
  for (const line of help.split("\n")) {
    const heading = SECTION.exec(line);
    if (heading) {
      section = heading[1]!.toLowerCase();
      continue;
    }
    const entry = /^ {2}(\S.*)$/.exec(line);
    if (!entry) continue;
    const text = entry[1]!;
    if (section === "options") {
      const spec = text.split(/ {2,}/)[0]!;
      for (const part of spec.split(",")) {
        const name = part.trim().split(/\s+/)[0];
        if (name && name.startsWith("-")) flags.add(name);
      }
    } else if (section === "commands") {
      const word = text.split(/\s+/)[0]!;
      for (const name of word.split("|")) {
        if (/^[A-Za-z][\w-]*$/.test(name)) commands.add(name);
      }
    }
  }
  return { flags: [...flags].sort(), commands: [...commands].sort() };
}

async function capture(claude: string, argv: string[]): Promise<string> {
  const p = Bun.spawn([claude, ...argv], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const out = await new Response(p.stdout as ReadableStream).text();
  const code = await p.exited;
  if (code !== 0) throw new Error(`${claude} ${argv.join(" ")} exited ${code}`);
  return out;
}

/** Runs the given claude binary and returns its names plus its version. */
export async function extractFromClaude(claude: string): Promise<HelpNames> {
  const [help, versionText] = await Promise.all([capture(claude, ["--help"]), capture(claude, ["--version"])]);
  const parsed = parseVersion(versionText);
  const version = parsed ? parsed.join(".") : versionText.trim();
  return { version, ...parseHelpNames(help) };
}

export function resolveClaudeForScripts(argv: string[]): string {
  const given = argv[0] ?? process.env.MCLAUDE_CLAUDE_PATH ?? Bun.which("claude");
  if (!given) {
    console.error("claude not found: pass a path or put claude on PATH");
    process.exit(69);
  }
  return given;
}

if (import.meta.main) {
  const names = await extractFromClaude(resolveClaudeForScripts(process.argv.slice(2)));
  console.log(JSON.stringify(names, null, 2));
}
