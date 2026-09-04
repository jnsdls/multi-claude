// Builds dist/main.js (what the tests and `bun dist/main.js` run) and, with
// --compile, one binary per target under out/ plus the npm platform package
// for it under npm/<package>/. The version comes from package.json and is
// injected at build time; nothing reads package.json at runtime.
import { chmodSync, copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";
import { platformPackage, TARGETS, type Target } from "./platforms.ts";

const root = join(import.meta.dir, "..");
const pkg = await Bun.file(join(root, "package.json")).json();
const version: string = pkg.version;
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
    stagePlatformPackage(t, outfile);
  }
}

/** Writes npm/<package>/ ready for `npm publish`: the binary, a manifest, README, LICENSE. */
function stagePlatformPackage(t: Target, binary: string) {
  const name = platformPackage(t);
  const [os, cpu] = t.split("-");
  const dir = join(root, "npm", name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "bin"), { recursive: true });
  copyFileSync(binary, join(dir, "bin", "mclaude"));
  chmodSync(join(dir, "bin", "mclaude"), 0o755);
  copyFileSync(join(root, "LICENSE"), join(dir, "LICENSE"));
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify(
      {
        name,
        version,
        description: `The mclaude binary for ${t}. Installed by the multi-claude package; not for direct use.`,
        license: pkg.license,
        repository: pkg.repository,
        homepage: pkg.homepage,
        bugs: pkg.bugs,
        os: [os],
        cpu: [cpu],
        files: ["bin"],
        preferUnplugged: true,
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(dir, "README.md"),
    `# ${name}\n\nThe compiled \`mclaude\` binary for ${t}. The [multi-claude](https://www.npmjs.com/package/multi-claude) package depends on it and picks the one for your platform; install that instead.\n`,
  );
  console.log(`staged npm/${name}`);
}
