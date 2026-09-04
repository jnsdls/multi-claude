# Release checklist

## Before the tag

- Link the open `claude-drift` issue in the release PR, if there is one. A release may ship with it open (ADR 0012).
- If you are moving the Checked version: re-read the four tables in `src/tables.ts` against the installed `claude --help` and a fresh login's `.claude.json`, then in one PR change `CHECKED_VERSION` in `src/version.ts` and regenerate `fixtures/claude-help.json` with `bun run scripts/extract-claude-help.ts > fixtures/claude-help.json`. `test/version.test.ts` fails when the two disagree, and it also compares the fixture's `flagArity` map with `CLAUDE_FLAG_ARITY`, so copy the regenerated map into the table in the same PR. Close the drift issue in that PR.
- Verify these four by hand against a real claude. No test covers them.
  1. Keychain read path: `mclaude account add` on macOS, then `mclaude account list` shows the Account without a Needs login mark.
  2. Refresh trigger write-back: plant an Account whose token expires within the hour, run a Session start, confirm `.credentials.json` in the Account dir carries a later `expiresAt`.
  3. Real `--resume`: start a session, note its id, `mclaude --resume <id>` from another directory picks up the same conversation.
  4. Terminal restoration after SIGKILL: run the TUI, `kill -9` the claude child, confirm the shell prompt is usable (no raw mode left behind).

## Tag and publish

```sh
npm version <patch|minor|major>   # bumps package.json, commits, tags v<version>
git push --follow-tags
```

The `release` workflow runs on the tag. Confirm on the run:

- the version check passed (package.json equals the tag),
- `gh release view v<version>` lists `mclaude-darwin-arm64.tar.gz`, `mclaude-darwin-x64.tar.gz`, `mclaude-linux-x64.tar.gz`, `mclaude-linux-arm64.tar.gz` and `SHASUMS256.txt`,
- `npm view @jnsdls/multi-claude version` prints the new version, and so does each of `multi-claude-darwin-arm64`, `multi-claude-darwin-x64`, `multi-claude-linux-x64`, `multi-claude-linux-arm64`,
- `Formula/mclaude.rb` in [jnsdls/homebrew-tap](https://github.com/jnsdls/homebrew-tap) has a fresh commit named `mclaude <version>`, and `brew upgrade mclaude` on a Mac with the tap installs it.

npm gets five packages: the four platform packages, each carrying one compiled binary, then `@jnsdls/multi-claude`, whose `optionalDependencies` pin them at the same version. `bun run build:binaries` stages all five under `npm/` from the repo's `package.json` version (`scripts/stage.ts`); the repo's own `package.json` is private and never published. The workflow publishes by trusted publishing (OIDC), so no npm token is stored anywhere. npm only lets a trusted publisher be configured for a package that already exists, which makes the first release a one-off by hand:

1. Make the repo public. npm refuses provenance from a private repo.
2. From a clean checkout of `main` on a Mac, `npm login`, then:

   ```sh
   bun run build:binaries      # cross-compiles all four and stages npm/
   bun run publish:npm         # the four platform packages, then @jnsdls/multi-claude
   ```

3. Register the workflow as each package's trusted publisher, with npm 11.15 or later:

   ```sh
   for p in @jnsdls/multi-claude multi-claude-darwin-arm64 multi-claude-darwin-x64 multi-claude-linux-x64 multi-claude-linux-arm64; do
     npm trust github "$p" --repo jnsdls/multi-claude --file release.yml
   done
   ```

   The same setting is under Trusted publishing on each package's npm page. Then turn on "Require two-factor authentication and disallow tokens" under Publishing access on each, so the workflow is the only publisher.

Every later release is the tag alone.

## Homebrew

`brew install jnsdls/tap/mclaude` reads `Formula/mclaude.rb` from the `jnsdls/homebrew-tap` repo. The formula is generated, never edited: `scripts/homebrew.ts` renders it from the version and `SHASUMS256.txt`, and `scripts/publish-brew.sh` commits it to the tap through the GitHub contents API. The workflow runs that last, after npm, so a tap failure never holds back a release.

The workflow's own token cannot write to another repo, so the step reads `HOMEBREW_TAP_TOKEN`, a repo secret. One-off setup, by hand:

1. On GitHub, Settings, Developer settings, Personal access tokens, Fine-grained tokens: a token for the `jnsdls` account, repository access limited to `homebrew-tap`, permission Contents: read and write. Set an expiry; a year is fine.
2. Store it as the `HOMEBREW_TAP_TOKEN` secret on `jnsdls/multi-claude`:

   ```sh
   gh secret set HOMEBREW_TAP_TOKEN --repo jnsdls/multi-claude
   ```

   The token expiry is the one thing that can break this step later. When it does, the release run fails on "Update the Homebrew formula" alone, and the fix is a new token plus the same `gh secret set`.

To push the formula by hand for a release that is already on GitHub:

```sh
gh release download v<version> --pattern SHASUMS256.txt -O /tmp/SHASUMS256.txt
HOMEBREW_TAP_TOKEN="$(gh auth token)" bun run publish:brew v<version> /tmp/SHASUMS256.txt
```

To check a formula change before it ships: `bun run scripts/homebrew.ts <version> SHASUMS256.txt > /opt/homebrew/Library/Taps/jnsdls/homebrew-tap/Formula/mclaude.rb`, then `brew audit --strict --online jnsdls/tap/mclaude`, `brew style jnsdls/tap/mclaude`, `brew reinstall jnsdls/tap/mclaude` and `brew test jnsdls/tap/mclaude`.
