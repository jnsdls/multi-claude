// Builds dist/main.js (what the tests and `bun dist/main.js` run) and, with
// --compile, one binary per target under out/ plus the five npm packages under
// npm/ (see stage.ts). The version comes from package.json and is injected at
// build time; nothing reads package.json at runtime.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";
import { TARGETS } from "./platforms.ts";
import { readRootManifest, stageMainPackage, stagePlatformPackage } from "./stage.ts";

const root = join(import.meta.dir, "..");
const version = readRootManifest(root).version as string;
const define = { MCLAUDE_VERSION: JSON.stringify(version) };
const entry = join(root, "src/main.ts");

const compile = process.argv.includes("--compile");
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
  for (const t of TARGETS) {
    if (only && only !== t) continue;
    const outfile = join(root, "out", `mclaude-${t}`);
    await $`bun build --compile --target=bun-${t} --define MCLAUDE_VERSION=${JSON.stringify(version)} ${entry} --outfile ${outfile}`;
    // Ad-hoc signature: enough for a curl download, not for Gatekeeper on a browser
    // download. --force because bun 1.4 already signs a cross-compiled darwin output.
    if (t.startsWith("darwin") && process.platform === "darwin") await $`codesign --force --sign - ${outfile}`;
    console.log(`built out/mclaude-${t} (${version})`);
    stagePlatformPackage(root, t, outfile);
    console.log(`staged npm/multi-claude-${t}`);
  }
  stageMainPackage(root);
  console.log("staged npm/multi-claude");
}
