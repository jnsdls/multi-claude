// Stages the five npm packages under npm/: one platform package per compiled
// binary and the main package that depends on them. The main package's
// manifest is generated here rather than checked in, so the repo's
// package.json never lists the platform packages and bun.lock stays free of
// release artifacts.
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { platformPackage, TARGETS, type Target } from "./platforms.ts";

export const MAIN_PACKAGE = "@jnsdls/multi-claude";

type Manifest = Record<string, unknown>;

export function readRootManifest(root: string): Manifest {
  return JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
}

/** The published @jnsdls/multi-claude manifest, from the repo's package.json. */
export function mainManifest(pkg: Manifest): Manifest {
  const version = pkg.version as string;
  return {
    name: MAIN_PACKAGE,
    version,
    description: pkg.description,
    license: pkg.license,
    repository: pkg.repository,
    homepage: pkg.homepage,
    bugs: pkg.bugs,
    bin: { mclaude: "bin/mclaude" },
    engines: { node: ">=18" },
    optionalDependencies: Object.fromEntries(TARGETS.map((t) => [platformPackage(t), version])),
  };
}

export function platformManifest(pkg: Manifest, t: Target): Manifest {
  const [os, cpu] = t.split("-");
  return {
    name: platformPackage(t),
    version: pkg.version,
    description: `The mclaude binary for ${t}. Installed by the ${MAIN_PACKAGE} package; not for direct use.`,
    license: pkg.license,
    repository: pkg.repository,
    homepage: pkg.homepage,
    bugs: pkg.bugs,
    os: [os],
    cpu: [cpu],
    files: ["bin"],
    preferUnplugged: true,
  };
}

function fresh(dir: string) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "bin"), { recursive: true });
}

function writeManifest(dir: string, manifest: Manifest) {
  writeFileSync(join(dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** npm/multi-claude/: the launcher, README, LICENSE and the generated manifest. */
export function stageMainPackage(root: string): string {
  const dir = join(root, "npm", "multi-claude");
  fresh(dir);
  copyFileSync(join(root, "bin", "mclaude"), join(dir, "bin", "mclaude"));
  chmodSync(join(dir, "bin", "mclaude"), 0o755);
  copyFileSync(join(root, "README.md"), join(dir, "README.md"));
  copyFileSync(join(root, "LICENSE"), join(dir, "LICENSE"));
  writeManifest(dir, mainManifest(readRootManifest(root)));
  return dir;
}

/** npm/multi-claude-<target>/: the binary, a short README, LICENSE and its manifest. */
export function stagePlatformPackage(root: string, t: Target, binary: string): string {
  const name = platformPackage(t);
  const dir = join(root, "npm", name);
  fresh(dir);
  copyFileSync(binary, join(dir, "bin", "mclaude"));
  chmodSync(join(dir, "bin", "mclaude"), 0o755);
  copyFileSync(join(root, "LICENSE"), join(dir, "LICENSE"));
  writeFileSync(
    join(dir, "README.md"),
    `# ${name}\n\nThe compiled \`mclaude\` binary for ${t}. The [${MAIN_PACKAGE}](https://www.npmjs.com/package/${MAIN_PACKAGE}) package depends on it and picks the one for your platform; install that instead.\n`,
  );
  writeManifest(dir, platformManifest(readRootManifest(root), t));
  return dir;
}
