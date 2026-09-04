#!/bin/sh
# Writes Formula/mclaude.rb for one release into jnsdls/homebrew-tap through
# the GitHub contents API, one commit per release. Runs last in the release
# workflow, after the tarballs and SHASUMS256.txt are on the GitHub release the
# formula points at. HOMEBREW_TAP_TOKEN is a fine-grained token with contents:
# write on the tap repo alone; the workflow's own token cannot reach it.
#
#   HOMEBREW_TAP_TOKEN=... sh scripts/publish-brew.sh <version> <SHASUMS256.txt>
set -eu
cd "$(dirname "$0")/.."
version="${1:?version, with or without the v}"
sums="${2:?path to SHASUMS256.txt}"
version="${version#v}"
tap="jnsdls/homebrew-tap"
path="repos/$tap/contents/Formula/mclaude.rb"
: "${HOMEBREW_TAP_TOKEN:?set HOMEBREW_TAP_TOKEN to a token that can write $tap}"
export GH_TOKEN="$HOMEBREW_TAP_TOKEN"

formula="$(mktemp)"
bun run scripts/homebrew.ts "$version" "$sums" > "$formula"

# The API needs the current blob sha to replace a file; absent on the first release.
sha="$(gh api "$path" -q .sha 2>/dev/null || true)"
gh api -X PUT "$path" \
  -f message="mclaude $version" \
  -f content="$(base64 < "$formula" | tr -d '\n')" \
  ${sha:+-f sha="$sha"} \
  -q '.commit.html_url'
rm -f "$formula"
