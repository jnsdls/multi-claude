---
status: accepted
---
# Tokens are read, never written or refreshed

Proactive account selection needs each account's headroom, which only the undocumented `api.anthropic.com/api/oauth/usage` endpoint exposes, and it needs the account's OAuth access token. mclaude reads that token from wherever Claude Code stored it and sends it to that endpoint only. It never writes a token, never calls the token refresh endpoint, and never sends the token anywhere else. When a stored access token has expired, mclaude asks Claude Code to refresh it by running the claude binary inside that account dir rather than refreshing itself, because refresh tokens are single-use and a second refresher revokes the chain. Which invocation reliably awaits the refresh is being verified; `claude auth status` starts one without waiting for it.

## Considered options

Never touching tokens at all would keep mclaude purely reactive (switch only after Claude reports a limit) and would drop headroom from `list`. Rejected because the last few percent of a window would always be spent hitting the wall mid-turn.
