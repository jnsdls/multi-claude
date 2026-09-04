#!/bin/sh
# Publishes the four platform packages, then @jnsdls/multi-claude itself, so the
# optionalDependencies resolve the moment the main package lands. Run after
# `bun run build:binaries`. Same script for the release workflow and the
# one-off first publish by hand.
set -eu
cd "$(dirname "$0")/.."
for dir in npm/multi-claude-*/; do
  [ -f "$dir/bin/mclaude" ] || { echo "missing binary in $dir; run bun run build:binaries" >&2; exit 1; }
  npm publish --access public "$dir"
done
npm publish --access public
