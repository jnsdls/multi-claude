#!/bin/sh
# Publishes the four platform packages, then @jnsdls/multi-claude, so the
# optionalDependencies resolve the moment the main package lands. Run after
# `bun run build:binaries`, which stages all five under npm/. Same script for
# the release workflow and the one-off first publish by hand.
set -eu
cd "$(dirname "$0")/.."
# Paths carry a ./ prefix: npm reads a bare npm/multi-claude as the GitHub
# shorthand github:npm/multi-claude.
for dir in ./npm/multi-claude-*/; do
  [ -f "$dir/bin/mclaude" ] || { echo "missing binary in $dir; run bun run build:binaries" >&2; exit 1; }
  npm publish --access public "$dir"
done
[ -f ./npm/multi-claude/package.json ] || { echo "npm/multi-claude is not staged; run bun run build:binaries" >&2; exit 1; }
npm publish --access public ./npm/multi-claude
