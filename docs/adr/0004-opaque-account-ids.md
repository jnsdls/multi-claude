---
status: accepted
---
# Account dirs are named by an opaque id minted before login

Claude Code hashes the config dir path into its Keychain service name, so an Account dir can never be renamed or moved once `claude auth login` has run in it, and `add` has to create the dir before that login. The name therefore cannot come from anything learned at login (email, account uuid) and cannot be a label the user might want to change later. mclaude mints a short random id at `add`, names the dir `accounts/<id>/`, and keeps the human-facing Alias in the Account's Record where it is free to change. Identity for duplicate checks and cache keys is the account uuid plus organization uuid read from the dir's `.claude.json` after login, never the email, which repeats across organizations and can change.

## Consequences

The path is built from the literal `$HOME` (or `MCLAUDE_HOME`) and never resolved through symlinks, because a different string is a different Keychain item. Changing `MCLAUDE_HOME` after Accounts exist orphans every stored token; `list` then shows those Accounts as needing re-login.

## Considered options

Alias as the dir name (`mclaude add work`). Rejected because the alias would be frozen forever and `add` would demand a name before the user knows which login they are about to do.

Sequential numbers. Rejected because a removed number could never be reused without colliding with a stale Keychain item, so it needs a counter in state anyway.
