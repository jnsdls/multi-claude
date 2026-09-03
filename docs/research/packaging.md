# Packaging: npm package and Bun compiled binary from one source

Research for [#6](https://github.com/jnsdls/multi-claude/issues/6), part of [#1](https://github.com/jnsdls/multi-claude/issues/1). Measured on 2026-09-03 with Bun 1.4.0, Node 24.15.0, npm 11, `@anthropic-ai/claude-agent-sdk` 0.3.259, Claude Code 2.1.259, T3 Code Nightly (the build installed in `/Applications`), macOS arm64. Prototype lives in `/tmp/mclaude-pkg-r` (not in the repo; everything needed to redo it is below).

## Answer in one paragraph

One `src/main.ts`, two build commands. The npm channel ships `dist/main.js` (a `bun build --target=bun` bundle) behind `bin/mclaude`, a two-line file with a `#!/usr/bin/env bun` shebang and no extension. The binary channel ships `bun build --compile --target=bun-<os>-<arch>` output, one file per target, attached to a GitHub release tagged `v<version>`. Both channels read the version from the same `package.json` field via `--define MCLAUDE_VERSION`. Tarball is under 1 KB; binaries are 61 to 79 MB uncompressed, 19 to 30 MB with zstd, because each carries the Bun runtime. `mclaude --version` prints `claude --version` output unchanged on stdout and its own version on stderr, which is what T3 Code's regex needs.

## The two hard constraints

### The Agent SDK spawn rule

The SDK decides whether to exec the configured path directly or hand it to a JS runtime with one check ([sdk.mjs 0.3.259](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk/v/0.3.259), minified name `D$e`):

```js
function D$e(e){return![".js",".mjs",".tsx",".ts",".jsx"].some((n)=>e.endsWith(n))}
```

When it returns true the SDK runs `spawn(path, [...flags])`. When false it runs `spawn(executable, [path, ...flags])`, where `executable` defaults to `"bun"` if `process.versions.bun` is set and `"node"` otherwise (`getDefaultExecutable(){return al()?"bun":"node"}`). T3 Code runs the SDK under Node (Electron), so a `.js` path would be handed to `node`, and our code uses `Bun.spawn`. Confirmed: the `--target=node` build of the prototype dies with `ReferenceError: Bun is not defined`.

So the file the host points at must have no JS extension. `bin/mclaude` (no extension) satisfies this, and so does a compiled binary. The shebang then does the work of picking Bun. Checked by replaying the rule in Node against all three artifacts:

```
/tmp/mclaude-pkg-r/prefix/bin/mclaude        -> exec'd directly, status 0, stdout "2.1.259 (Claude Code)"
/tmp/mclaude-pkg-r/out/mclaude-darwin-arm64  -> exec'd directly, status 0, stdout "2.1.259 (Claude Code)"
/tmp/mclaude-pkg-r/dist/main.js              -> handed to a runtime as argv[1]
```

The SDK also ships an `executable_launch_failed` message that names the musl/glibc mismatch explicitly ("spawning a musl-linked binary on a glibc Linux host fails because the musl dynamic loader is missing"). Relevant if we ever ship musl builds; see targets below.

### The version string T3 Code parses

T3 Code's health check (`apps/server/src/provider/Layers/ClaudeProvider.ts`, recovered from `apps/server/dist/bin.mjs.map` inside the app's `app.asar`) runs the configured binary path with `["--version"]`, waits up to its default timeout, then:

```ts
const parsedVersion = parseGenericCliVersion(`${version.stdout}\n${version.stderr}`);
```

with (`apps/server/src/provider/providerSnapshot.ts`):

```ts
export function parseGenericCliVersion(output: string): string | null {
  const match = output.match(/\b(\d+\.\d+\.\d+)\b/);
  return match?.[1] ?? null;
}
```

So it takes the first `\d+.\d+.\d+` anywhere in stdout followed by stderr. A non-zero exit is logged as a warning but the parsed version still stands. The parsed value then feeds `resolveClaudeModelsForVersion` and `formatClaudeVersionUpgradeMessage`, which is why it has to be Claude's version, not ours. If mclaude printed `mclaude 0.1.0` first, T3 Code would think Claude Code is 0.1.0 and nag about upgrading.

Format that works, matching what `claude --version` itself prints today:

```
stdout: 2.1.259 (Claude Code)
stderr: mclaude 0.1.0 (bun 1.4.0, darwin-arm64, standalone=true, execPath=...)
```

Rule: the first semver on stdout is the wrapped Claude's. Anything about mclaude goes after it or on stderr. On non-Windows T3 Code passes `binaryPath` to the SDK's `pathToClaudeCodeExecutable` untouched (`resolveClaudeSdkExecutablePath` only rewrites `.cmd` shims on win32), and spawns the probe with `shell: false`, so a path to `bin/mclaude` or to the compiled binary works for both the health check and the session.

## The prototype

Three files. `src/main.ts`:

```ts
declare const MCLAUDE_VERSION: string;
const version = typeof MCLAUDE_VERSION === "string" ? MCLAUDE_VERSION : "0.0.0-dev";

async function claudeVersion(): Promise<string> {
  const proc = Bun.spawn(["claude", "--version"], { stdout: "pipe", stderr: "pipe" });
  const out = (await new Response(proc.stdout).text()).trim();
  await proc.exited;
  return out;
}

if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.log(await claudeVersion());
  console.error(`mclaude ${version} (bun ${Bun.version}, ${process.platform}-${process.arch}, standalone=${Bun.isStandaloneExecutable}, execPath=${process.execPath})`);
  process.exit(0);
}
console.log("mclaude: no-op prototype");
```

`bin/mclaude` (mode 755):

```
#!/usr/bin/env bun
import "../dist/main.js";
```

`package.json`:

```json
{
  "name": "mclaude",
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "bin": { "mclaude": "bin/mclaude" },
  "files": ["bin", "dist"],
  "engines": { "bun": ">=1.4.0" }
}
```

### npm channel

```sh
bun build src/main.ts --target=bun --outfile dist/main.js --define MCLAUDE_VERSION='"0.1.0"'
npm pack
```

Output: `dist/main.js` 635 bytes, `mclaude-0.1.0.tgz` 628 bytes containing `package/bin/mclaude`, `package/dist/main.js`, `package/package.json`.

All three install paths produce a `mclaude` symlink with no extension and run `--version` correctly:

| Install | Symlink | Result |
| --- | --- | --- |
| `npm install -g --prefix P ./mclaude-0.1.0.tgz` | `P/bin/mclaude -> ../lib/node_modules/mclaude/bin/mclaude` | exit 0 |
| `BUN_INSTALL=H bun add -g ./mclaude-0.1.0.tgz` | `H/bin/mclaude -> ../../node_modules/mclaude/bin/mclaude` | exit 0 |
| `bun add ./mclaude-0.1.0.tgz` then `bunx mclaude` | `node_modules/.bin/mclaude -> ../mclaude/bin/mclaude` | exit 0 |

The npm docs say the `bin` file should start with `#!/usr/bin/env node` "otherwise the scripts are started without the node executable" ([package.json, bin](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#bin)). That is advice, not enforcement: npm symlinks whatever file we name, and the kernel reads the shebang. `bunx` "respects shebangs" and spins up `node` for a node shebang, so the `bun` shebang is what makes `bunx mclaude` run under Bun without `--bun` ([bunx docs](https://bun.sh/docs/cli/bunx)). Consequence for `npm i -g mclaude` users: Bun must be on PATH. The `engines.bun` field documents it; npm does not enforce `engines` without `engine-strict`. The README should say so.

Bun's bundler, when given `--target=bun`, marks output with `// @bun` so Bun skips re-transpiling; the `.js` entry never gets a shebang of its own, which is fine because the shim is the thing on PATH ([bundler docs, target](https://bun.sh/docs/bundler#target)).

### Binary channel

One command per target, run on the macOS laptop. Bun downloads the runtime for each foreign target once into `~/.bun/install/cache/bun-<os>-<arch>-v<bun version>` (observed: `bun-linux-x64-v1.4.0`, 80,761,952 bytes; `bun-linux-aarch64-v1.4.0`; `bun-linux-x64-musl-v1.4.0`) and stitches the bundle onto it. The docs describe cross-compilation as compiling "for a different operating system, architecture, or version of Bun than the machine you're running `bun build` on" ([executables docs, cross-compile](https://bun.sh/docs/bundler/executables#cross-compile-to-other-platforms)).

```sh
for t in darwin-arm64 darwin-x64 linux-x64 linux-arm64; do
  bun build --compile --target=bun-$t --minify --sourcemap \
    --define MCLAUDE_VERSION='"0.1.0"' src/main.ts --outfile out/mclaude-$t
done
```

Sizes:

| Target | Bytes | MB | gzip -6 | zstd -19 | `file` |
| --- | ---: | ---: | ---: | ---: | --- |
| bun-darwin-arm64 | 63,910,514 | 60.9 | 25.9 MB | 19.5 MB | Mach-O arm64 |
| bun-darwin-x64 | 70,704,544 | 67.4 | 28.6 MB | 21.8 MB | Mach-O x86_64 |
| bun-linux-x64 | 82,535,624 | 78.7 | 36.7 MB | 29.8 MB | ELF, interpreter `/lib64/ld-linux-x86-64.so.2`, GNU/Linux 3.2.0 |
| bun-linux-arm64 | 82,495,480 | 78.7 | 36.6 MB | 29.3 MB | ELF, interpreter `/lib/ld-linux-aarch64.so.1`, GNU/Linux 3.7.0 |
| bun-linux-x64-musl (not in scope, measured for reference) | 76,281,304 | 72.7 | | | ELF, interpreter `/lib/ld-musl-x86_64.so.1` |

The size is the runtime. `~/.bun/bin/bun` on this machine is 63,558,256 bytes; the darwin-arm64 binary is 352 KB more. `--minify` changed nothing (identical 63,910,514 with and without) because the bundle is 635 bytes. `--bytecode` also changed nothing on size, and it refuses top-level `await` ("await can only be used inside an async function"), so if we want it later the entry needs an explicit `main()`. `strip` on the Mach-O grows it by 166 bytes and it still runs; not worth it. The docs themselves say "Bun's binary is still way too big and we need to make it smaller."

Running the darwin-arm64 build:

```
$ ./out/mclaude-darwin-arm64 --version
2.1.259 (Claude Code)
mclaude 0.1.0 (bun 1.4.0, darwin-arm64, standalone=true, execPath=/private/tmp/mclaude-pkg-r/out/mclaude-darwin-arm64)
```

`Bun.version` inside the binary is the version of the `bun` that built it (1.4.0, commit 34cbb9a40 per `strings`), so the Bun version is pinned by the CI toolchain, not by the source. Pin it in CI (`oven-sh/setup-bun` with an exact `bun-version`) so a Bun point release doesn't silently change what ships.

Target notes:

- The docs' target table lists exactly the eight names above plus windows; `-baseline` and `-modern` suffixes are accepted but resolve to the same binary because x64 builds target Nehalem and pick AVX paths at runtime. No choice to make there.
- glibc is the default for linux targets. The compiled ELF wants `ld-linux-x86-64.so.2` and GNU/Linux 3.2.0 or newer, which is every mainstream distro. Alpine users need the `-musl` variant; the SDK's own error text covers the mismatch case. Claude Code's own releases ship both (`claude-linux-x64.tar.gz` and `claude-linux-x64-musl.tar.gz` on [v2.1.259](https://github.com/anthropics/claude-code/releases/tag/v2.1.259)). Suggest glibc only for now, musl if someone asks.
- macOS: the output is unsigned (`codesign -dv` shows `Identifier=a.out`, no signature). Docs recommend `codesign --deep --force --sign <id> --entitlements entitlements.plist` with the JIT entitlements (`allow-jit`, `allow-unsigned-executable-memory`, `disable-executable-page-protection`, `allow-dyld-environment-variables`, `disable-library-validation`) to fix Gatekeeper warnings ([executables docs, code signing](https://bun.sh/docs/bundler/executables#code-signing-on-macos)). For a CLI downloaded with curl and marked executable there is no quarantine attribute, so an unsigned build runs; a browser download would be quarantined and blocked. Ad-hoc signing (`--sign -`) is free and enough for the curl path. Notarization needs a Developer ID; defer until there is a reason.

## Sharing one version between channels

Single source of truth: `version` in `package.json`. Both builds inject it with `--define MCLAUDE_VERSION="\"$(jq -r .version package.json)\""` (or `Bun.build({ define })` in a `build.ts`). Nothing reads `package.json` at runtime; compiled binaries don't autoload it anyway ([executables docs, configuration loading](https://bun.sh/docs/bundler/executables)), and reading it from `dist/` would need a relative path that breaks under `bunx`.

Release flow:

1. `npm version <patch|minor|major>` bumps `package.json`, commits, and tags `v<version>` ([npm-version docs](https://docs.npmjs.com/cli/v11/commands/npm-version)). Push with tags.
2. CI on tag `v*`, one job, macOS runner (cross-compiles all four targets; no Linux runner needed):
   - `bun build --target=bun` into `dist/`, then `npm publish --provenance`.
   - four `bun build --compile` invocations, `codesign --sign -` on the two darwin outputs, `tar czf` each, `shasum -a 256` into `SHASUMS256.txt`.
   - `gh release create v<version> out/*.tar.gz out/SHASUMS256.txt`.
3. `mclaude --version` on stderr and a future `mclaude version` subcommand print `MCLAUDE_VERSION` so a user can tell which channel and version they have.

Proposed release asset names, copying Claude Code's own layout so `os-arch` strings line up with `process.platform`/`process.arch` and a future self-update or install script can compute them:

```
v0.1.0
  mclaude-darwin-arm64.tar.gz
  mclaude-darwin-x64.tar.gz
  mclaude-linux-x64.tar.gz
  mclaude-linux-arm64.tar.gz
  SHASUMS256.txt
npm: mclaude@0.1.0   (bin/mclaude -> dist/main.js)
```

Tarball rather than bare binary so the executable bit and the file name survive a browser download. The npm package does not include the binaries (that would be 300 MB per publish); it depends on Bun already being installed. The two channels are for two audiences: `bunx mclaude` for people who already have Bun, the release tarball for people who don't want it.

## Things not settled here

- Whether `mclaude --version` should also accept `-v`. The prototype does; Claude Code's `-v` is the same as `--version`, so passthrough would give the same answer.
- The `claude` lookup. The prototype spawns `claude` from PATH. How the real launcher finds it (PATH, `~/.local/bin/claude`, a config key) is a separate ticket; whatever it picks, `--version` must probe that same binary.
- `--bytecode` and `--minify` are no-ops at this size. Revisit when the bundle is measured in hundreds of KB.
- npm `os`/`cpu` fields: not needed for the npm channel since the JS is portable; the binary channel doesn't go through npm.
