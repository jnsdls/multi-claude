// Builds dist/main.js (npm channel) and, with --compile, one binary per target.
// The version comes from package.json and is injected at build time; nothing
// reads package.json at runtime.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

const root = join(import.meta.dir, "..");
const pkg = await Bun.file(join(root, "package.json")).json();
const version: string = pkg.version;
const define = { MCLAUDE_VERSION: JSON.stringify(version) };
const entry = join(root, "src/main.ts");

const compile = process.argv.includes("--compile");
const targets = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"] as const;
const only = process.argv.find((a) => a.startsWith("--target="))?.slice("--target=".length);

if (!compile) {
  mkdirSync(join(root, "dist"), { recursive: true });
  const result = await Bun.build({
    entrypoints: [entry],
    outdir: join(root, "dist"),
    target: "bun",
    naming: "main.js",
    define,
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
  console.log(`built dist/main.js (${version})`);
} else {
  mkdirSync(join(root, "out"), { recursive: true });
  for (const t of targets) {
    if (only && only !== t) continue;
    const outfile = join(root, "out", `mclaude-${t}`);
    await $`bun build --compile --target=bun-${t} --define MCLAUDE_VERSION=${JSON.stringify(version)} ${entry} --outfile ${outfile}`;
    console.log(`built out/mclaude-${t} (${version})`);
  }
}
