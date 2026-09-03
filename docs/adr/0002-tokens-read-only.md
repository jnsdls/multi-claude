---
status: accepted
---
# Tokens are read, never written or refreshed

Proactive account selection needs each account's headroom, which only the undocumented `api.anthropic.com/api/oauth/usage` endpoint exposes, and it needs the account's OAuth access token. mclaude reads that token from wherever Claude Code stored it and sends it to that endpoint only. It never writes a token, never calls the token refresh endpoint, and never sends the token anywhere else. When a stored access token is within five minutes of expiry, mclaude runs the Refresh trigger rather than refreshing itself, because refresh tokens rotate and a second refresher leaves one side with a dead chain. The trigger is `claude -p` inside that account dir with the API base URL pointed at a closed local port, retries off and MCP config emptied: Claude Code awaits its own refresh, writes the result back and exits in about a second without a model request (verified 2026-09-03 on 2.1.259, `docs/research/refresh-trigger.md`). `claude auth status` starts the refresh without waiting for it and never wrote back in ten runs, so it is not the trigger. A credential that comes back zeroed means the Account is Needs login.

## Considered options

Never touching tokens at all would keep mclaude purely reactive (switch only after Claude reports a limit) and would drop headroom from `list`. Rejected because the last few percent of a window would always be spent hitting the wall mid-turn.
