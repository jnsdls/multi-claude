# Release checklist

## Before the tag

- Link the open `claude-drift` issue in the release PR, if there is one. A release may ship with it open (ADR 0012).
- If you are moving the Checked version: re-read the three tables in `src/tables.ts` against the installed `claude --help` and a fresh login's `.claude.json`, then in one PR change `CHECKED_VERSION` in `src/version.ts` and regenerate `fixtures/claude-help.json` with `bun run scripts/extract-claude-help.ts > fixtures/claude-help.json`. `test/version.test.ts` fails when the two disagree. Close the drift issue in that PR.
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
- `npm view mclaude version` prints the new version.

Requires the `NPM_TOKEN` repository secret (an npm automation token with publish rights on `mclaude`).
