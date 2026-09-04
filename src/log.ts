/** One stderr line, prefixed. Every user-facing line mclaude prints goes through here. */
export function warn(line: string): void {
  process.stderr.write(`mclaude: ${line}\n`);
}
