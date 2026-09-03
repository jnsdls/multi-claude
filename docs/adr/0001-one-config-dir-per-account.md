---
status: accepted
---
# One Claude Code config dir per account

Claude Code keys its Keychain item, `.claude.json` identity and session state to `CLAUDE_CONFIG_DIR` (and `CLAUDE_SECURESTORAGE_CONFIG_DIR`). mclaude gives every account its own dir and sets both variables before launching, so Claude Code owns every token for its whole life. The alternative, rewriting the live Keychain item before each launch, is what most existing switchers do, and their issue trackers show why it fails: refresh tokens are single-use, so a running session and a restored copy revoke each other's chain; `security add-generic-password -U` resets the item's ACL and triggers GUI prompts; and Claude Code changed the Keychain layout twice in 2026, breaking four of them.

## Consequences

Settings, plugins and session history are per dir by default, so mclaude links them back to the user's real `~/.claude`. Which files stay per account is decided separately.
