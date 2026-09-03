# `GET /api/oauth/usage`: contract and polling policy

Research for issue #5, part of the map in #1. Written 2026-09-03 against Claude Code 2.1.259.

Anthropic does not document this endpoint. Everything below comes from four places, cited per claim:

- **binary**: strings from the installed Claude Code binary (`~/.local/share/claude/versions/2.1.259`, built 2026-09-02, git sha `9b549c8d`). Function names are minifier output and change per release; the string literals do not.
- **live**: one call made from this machine on 2026-09-03 20:14 UTC with the Keychain token. Full body reproduced below, nothing in it is secret.
- **cswap**: realiti4/claude-swap at `70f1058` (0.27.0b1), `src/claude_swap/oauth.py`, `usage_store.py`, `poll_policy.py`, and issues #146, #220, #306.
- **cux**: inulute/cux at `1127967`, `internal/usage/usage.go`, `internal/monitor/monitor.go`, `internal/wrapper/wrapper.go`, and issues #8, #37.
- anthropics/claude-code issues #31021 and #41185.

Vocabulary follows `CONTEXT.md`: Account, Window, Utilization, Headroom, Limit, Reset, Active account, Selection, Handoff, Exhausted. One term the glossary lacks and this doc needs is **Unknown**, the state of an Account whose Headroom mclaude cannot currently read. It is not Exhausted. Worth adding to `CONTEXT.md`.

## 1. Request

```
GET https://api.anthropic.com/api/oauth/usage
Authorization: Bearer <claudeAiOauth.accessToken>
anthropic-beta: oauth-2025-04-20
Accept: application/json
User-Agent: mclaude/<version>
```

What the sources say about each part:

- Path and method. Claude Code calls `St.get("/api/oauth/usage", {timeout: 5000, headers: {"Content-Type": "application/json"}, refreshOAuth: true})` (binary, `fetchUtilization`). cux and cswap use the same URL with a GET.
- `Authorization: Bearer`. The OAuth client attaches `Bearer ${accessToken}` plus the beta header on every `/api/oauth/*` call (binary, `gd="oauth-2025-04-20"`).
- `anthropic-beta: oauth-2025-04-20`. Constant in the binary, cswap (`OAUTH_BETA_HEADER`) and cux (`defaultBetaHdr`). cux reads it from `CUX_USAGE_BETA` so a rotated tag does not need a rebuild. Worth copying.
- Scope. Claude Code refuses to call the endpoint unless the token carries `user:profile` (binary: `Sp()` checks `scopes.includes("user:profile")`; the fetch returns `{}` without it). Env-var and `setup-token` sessions get only `user:inference` (binary, the Claude-in-Chrome diagnostic string says so). So an Account registered from a normal `claude login` works; a setup-token Account has no readable Headroom and should be shown as Unknown, not probed.
- User-Agent. The ticket assumed `claude-code/<ver>`. The first-party string is `claude-cli/2.1.259 (external, ...)` (binary, `Ax()`). cswap sends `claude-swap/1.0`, cux sends Go's default. All get 200, and cswap #220 measured identical 429 behaviour under `claude-swap/1.0` and the first-party string. The UA is not a gate. Send an honest `mclaude/<ver>` rather than impersonating Claude Code.
- Query variant `?at_wall=1&skip_spend=1`. Present in the binary, used only by the `juniper_tide` "reset rate limits" experiment status probe (`ZO(e, {atWall: true})`). What `skip_spend` drops is not verified (presumably the `spend` block). mclaude has no need for it.
- Timeout. Claude Code 5 s, cswap 5 s, cux 10 s. Live call answered in 0.2 s. Use 5 s.
- 401. Claude Code refreshes the token and retries once (binary, `F_` wrapper, log line `401→refresh→retry succeeded`). Per ADR 0002 mclaude must not refresh; it runs `claude auth status` inside the Account dir and re-reads the token. If that still 401s the Account is in the "needs re-login" state the map lists as unspecified. cux treats 401 as `ErrTokenExpired` and marks the slot (cux, `usage.go`).

Response headers seen live: `anthropic-organization-id`, `anthropic-workspace-id`, `request-id`, `cf-ray`, `cf-cache-status: DYNAMIC`. No `Cache-Control`, no `anthropic-ratelimit-*`, no remaining-request counter. The endpoint sits behind Cloudflare.

## 2. Response

### 2.1 Live body, 2026-09-03

Max plan, one seat, session 29% used, weekly 7%, Fable weekly 13%. Reproduced verbatim except for whitespace.

```json
{
  "five_hour": {
    "utilization": 29.0,
    "resets_at": "2026-09-04T00:29:59.563764+00:00",
    "limit_dollars": null, "used_dollars": null, "remaining_dollars": null,
    "locked_reason": null
  },
  "seven_day": {
    "utilization": 7.0,
    "resets_at": "2026-09-07T04:59:59.563787+00:00",
    "limit_dollars": null, "used_dollars": null, "remaining_dollars": null,
    "locked_reason": null
  },
  "seven_day_oauth_apps": null,
  "seven_day_opus": null,
  "seven_day_sonnet": null,
  "seven_day_cowork": null,
  "seven_day_omelette": null,
  "tangelo": null,
  "iguana_necktie": null,
  "omelette_promotional": null,
  "nimbus_quill": {
    "utilization": 0.0, "resets_at": null,
    "limit_dollars": null, "used_dollars": null, "remaining_dollars": null,
    "locked_reason": null
  },
  "cinder_cove": null,
  "amber_ladder": null,
  "juniper_tide": null,
  "extra_usage": {
    "is_enabled": false, "monthly_limit": null, "used_credits": null,
    "utilization": null, "currency": null, "decimal_places": null,
    "disabled_reason": null, "user_disabled": false,
    "spend_limit_reached": false, "credits_ever_enabled": false,
    "daily": null, "weekly": null
  },
  "limits": [
    { "kind": "session", "group": "session", "percent": 29, "severity": "normal",
      "resets_at": "2026-09-04T00:29:59.563764+00:00", "scope": null, "is_active": true },
    { "kind": "weekly_all", "group": "weekly", "percent": 7, "severity": "normal",
      "resets_at": "2026-09-07T04:59:59.563787+00:00", "scope": null, "is_active": false },
    { "kind": "weekly_scoped", "group": "weekly", "percent": 13, "severity": "normal",
      "resets_at": "2026-09-07T04:59:59.563968+00:00",
      "scope": { "model": { "id": null, "display_name": "Fable" }, "surface": null },
      "is_active": false }
  ],
  "spend": {
    "used": { "amount_minor": 0, "currency": "USD", "exponent": 2 },
    "limit": null, "percent": 0, "severity": "normal", "enabled": false,
    "disabled_reason": null, "cap": null, "balance": null, "auto_reload": null,
    "disclaimer": "Usage credits cover you when you hit your plan limits. [Learn more](https://support.claude.com/articles/12429409)",
    "can_purchase_credits": false, "can_toggle": false
  },
  "member_dashboard_available": false
}
```

### 2.2 What Claude Code parses

Claude Code's zod schema for the persisted copy (binary, `Hso`) is the authoritative minimum. Everything is `.passthrough()`, so unknown keys survive.

```
Window        = { utilization: number | null, resets_at: string | null }
Body          = {
  five_hour, seven_day, seven_day_oauth_apps, seven_day_opus,
  seven_day_sonnet, cinder_cove:              Window | null | undefined
  extra_usage: { is_enabled: boolean, monthly_limit: number|null,
                 used_credits: number|null, utilization: number|null,
                 currency?: string|null, disabled_reason?: string|null } | null
  limits: Array<{ kind: string, group: string, percent: number,
                  resets_at: string|null,
                  scope?: { model?: { display_name: string } | null,
                            surface?: { display_name: string } | null } | null }> | null
}
```

The "is this a real body" test is key presence: a 200 whose object has none of `five_hour, seven_day, seven_day_oauth_apps, seven_day_opus, seven_day_sonnet, cinder_cove, extra_usage, limits` is treated as an in-band error (binary, `wso` list and `hgt()`; log line "Usage fetch returned a fieldless or non-object body (in-band error)"). If such a body carries `error.type === "rate_limit_error"` it is recorded as `rateLimitedVia: "envelope"`.

### 2.3 Field meanings and scales

Windows. Each top-level Window is `{utilization, resets_at}` plus four dollar fields that are null on subscription plans (live). `utilization` is a float percent, 0 to 100 (`29.0` live; cux types it `0.0–100.0`; cswap stores it as `pct`). `resets_at` is ISO 8601 with microseconds and a `+00:00` offset, or null. Null means the window has not started (nothing consumed in it yet); see section 4. `locked_reason` is null in every observed response; meaning unknown.

| key | meaning | source |
| --- | --- | --- |
| `five_hour` | session Window, all models | binary label "Current session"; cux, cswap |
| `seven_day` | weekly Window, all models | binary label "Current week (all models)" |
| `seven_day_opus`, `seven_day_sonnet` | legacy per-model weekly Windows, null on this plan today | binary labels "Opus limit", "Current week (Sonnet only)"; cux still parses both |
| `seven_day_oauth_apps` | weekly Window for third-party OAuth apps | name only; exposed in the SDK `rate_limits` block |
| `seven_day_cowork`, `seven_day_omelette`, `tangelo`, `iguana_necktie`, `omelette_promotional`, `nimbus_quill`, `cinder_cove`, `amber_ladder` | codenamed experiment or promo Windows, all null or zero here | live; `cinder_cove` sits next to "Claude Code and Cowork credit / One-time credit" strings in the binary, so it looks like a one-off credit grant |
| `juniper_tide` | status block for a "reset rate limits" experiment (`eligible`, `ineligible_reason`, `arm`, `next_available_at`, `weekly_resets_at`, `resets_per_week`) | binary schema; null live |
| `extra_usage` | pay-as-you-go credits: `monthly_limit` and `used_credits` in minor units (cswap divides by 100; `spend.used.exponent: 2` agrees), `utilization` percent | binary, cswap, live |
| `spend` | newer replacement for `extra_usage` with `amount_minor` money objects and admin flags | live only; `skip_spend=1` presumably omits it |
| `member_dashboard_available` | boolean, probably Team/Enterprise admin dashboard access | live only |

`extra_usage.disabled_reason` values the binary knows: `overage_not_provisioned`, `org_level_disabled`, `org_level_disabled_until`, `out_of_credits`, `seat_tier_level_disabled`, `member_level_disabled`, `seat_tier_zero_credit_limit`, `group_zero_credit_limit`, `member_zero_credit_limit`, `org_service_level_disabled`, `no_limits_configured`, `org_spend_cap_reached`.

### 2.4 `limits[]` and per-model scoping

`limits[]` is the newer, self-describing list and the only place the current per-model weekly Window appears. Live, `seven_day_opus` and `seven_day_sonnet` are null while `limits[]` carries a `weekly_scoped` entry for Fable at 13%. Read `limits[]` first and fall back to the legacy keys only when it is absent.

Entry shape (live, plus binary schema):

- `kind`: `session`, `weekly_all`, `weekly_scoped`.
- `group`: `session` or `weekly`.
- `percent`: integer 0 to 100. Same quantity as `utilization`, rounded.
- `severity`: `normal` observed; other values unknown.
- `resets_at`: ISO string or null.
- `scope`: null for the unscoped kinds; `{model: {id, display_name}, surface}` for `weekly_scoped`. `id` was null live, so `display_name` ("Fable") is the only usable key. `surface` presumably scopes a Window to a product (Cowork, Chrome); null here.
- `is_active`: true on the session entry only. Not in Claude Code's schema. Best guess is "the Window currently binding", but the session entry at 29% vs Fable at 13% fits "highest percent" too. Do not depend on it.

How Claude Code scopes it (binary, `Ide()`): filter `kind === "weekly_scoped" && scope.model`, lower-case `scope.model.display_name`, and keep only names in the `tengu_usage_overage_included_models` GrowthBook list. Each match renders as "Current week (<display_name>)" with `utilization: percent`. The SDK's `rate_limits.model_scoped[]` is the same filtered list, described as "Per-model weekly windows from the server limits[] array, filtered by the overage-included-models allowlist. Additive, present only when the server emits them."

For mclaude, Headroom for a requested model is the minimum over `five_hour`, `seven_day`, and every `weekly_scoped` entry whose `display_name` matches the model family (case-insensitive, `Fable` matches `fable`, `claude-fable-5-1`). cswap does exactly this (`relevant_windows`, matching on lower-cased display name with an `all` sentinel). A scoped Window for a model the launch will not use does not count. Unscoped Windows always count.

### 2.5 Utilization scales elsewhere

Three surfaces report the same quantity on two scales:

| surface | scale | reset field | source |
| --- | --- | --- | --- |
| this endpoint, `utilization` and `limits[].percent` | 0 to 100 | ISO string | live |
| `anthropic-ratelimit-unified-5h-utilization` / `-7d-utilization` response headers | fraction 0 to 1 | `-5h-reset` / `-7d-reset` epoch seconds | cswap #220 sample (`0.34`); binary `H3e()` multiplies by 100 and converts epoch to ISO to seed the endpoint shape |
| stream-json `rate_limit_event.rate_limit_info.utilization` and `.unifiedWindows.{five_hour,seven_day,seven_day_overage_included}.utilization` | fraction, "usually 0-1, values above 1 occur when usage legitimately runs past a window's cap" | `resetsAt` epoch seconds int | binary schema text |

`rate_limit_info.status` is `allowed`, `allowed_warning` or `rejected`; `rateLimitType` is one of `five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet`, `seven_day_overage_included`, `overage`. `seven_day_overage_included` is the header-side name for the per-model bucket and is labelled "Fable limit" in the UI (binary, `HF` map). claude-code #41185 (March 2026) complained that `utilization` was omitted when status was `allowed`; the 2.1.259 schema adds `unifiedWindows`, "tracked on every observation" and "emitted when a window's rounded percentage or reset time moves". Headless mclaude can therefore read live Utilization of the Active account from the stream for free and should never poll the endpoint for it.

## 3. 429 handling

### 3.1 What the endpoint does

- Body on 429: `{"error":{"type":"rate_limit_error","message":"Rate limited. Please try again later."}}` (cux #37 paste; claude-code #31021).
- Budget shape (cswap `poll_policy.py`, measured 2026-07-11): about 28 to 30 requests per identity per trailing 60 minutes. Not a token bucket. Capacity returns only as old requests age out, so one burst blocks for up to an hour and pausing early buys nothing.
- Two regimes coexist across orgs (cswap `usage_store.py`, `poll_policy.py`, #146):
  - `Retry-After: 0`. The saturated-window edge. Requests keep failing intermittently until the trailing hour drains.
  - `Retry-After: N`, N almost always 3600 at block open, counting down to a fixed deadline that probing does not extend (40 of 41 blocks in one log opened at exactly 3600). A retry landing on the deadline re-blocks for a fresh hour 20 times out of 35 measured, up to 887 s late, so cswap adds a 900 s margin.
- Identity. cswap #220 measured that under the deadline regime a freshly issued token of the same account 429s identically, and a token minted 135 s earlier was already blocked, so the key is the account. Under the edge regime a fresh token was admitted while the old one stayed blocked (cswap probe4). claude-code #31021 has a comment claiming per-token and recommending a refresh to dodge it. Plan for per-account: it is the conservative case, and ADR 0002 forbids the refresh trick anyway.
- The budget is shared with everything else that reads the account: Claude Code's `/usage` dialog and extra-usage flows, statusline widgets, other machines. The #220 reporter's own 60 s statusline poll that retried every 2 s render after the first 429 kept the account saturated for weeks. Stamp attempts, not successes.
- None of the sources saw a per-IP limit. cswap #146 ran 14 accounts from one machine and an idle account answered 200 while a busy one 429d from the same IP (#220).

### 3.2 What clients do with it

- Claude Code 2.1.259 (binary, `ylt()`): on an HTTP 429 or an in-band envelope it logs, sets `rateLimitedVia: "http_429" | "envelope"`, and seeds the dialog from the running session's unified headers, else from the persisted copy if under one hour old (`Bso = 3600000`), else shows "unavailable". It never treats a 429 as a Limit.
- cux (#37): keeps the last good figures on 429; the 0.3.3 bug was elsewhere, an unknown reading fed into "all accounts exhausted". 0.3.4 fixed the decision, not the cache.
- cswap (`usage_store.py`): failure never touches `lastGood` or `fetchedAt`. `Retry-After: 0` waits at least 300 s (`EDGE_BACKOFF_S`); `Retry-After: N` waits N + 900 s capped at 4500 s; no header waits 30 s times 2^(n-1) capped at 600 s. `lastGood` stays decision-grade until its own `resets_at` passes (usage is monotone inside a Window, so an old reading is a lower bound) or 2 h for rows without one. Any 429 in the last hour floors the cadence at 360 s and grows it by 1.5x per success toward 1800 s so several machines sharing one account back off together.

### 3.3 Rules for mclaude

1. A 429 is a polling throttle. It says nothing about Headroom. Never turn it into a Limit, never mark the Account Exhausted, never trigger Handoff from it.
2. Keep the last good reading and its `fetchedAt`. Record `lastAttemptAt` on every attempt, success or not.
3. Honor `Retry-After`. Zero means wait 300 s. N means wait N + 900 s, capped at 4500 s. Missing means 30 s doubling to 600 s. While a 429 happened in the last hour, poll that Account no faster than every 6 min.
4. A last good reading stays usable for Selection until the earliest `resets_at` it carries has passed. After that the Windows are Unknown until the next successful read.
5. Unknown is not Exhausted. In Selection, an Account with a known good reading beats one that is Unknown, and Unknown beats Exhausted. If the only candidates are Unknown, launch on one anyway; the launch is the probe, and the hook or `rate_limit_event` path catches a real Limit.
6. Never refresh a token to escape a 429 (ADR 0002; also the per-account regime makes it pointless).

## 4. Hollow responses

A hollow response is a 200 whose Windows all read `utilization: 0` with `resets_at: null`. Two sightings:

- cswap #146 (2026-07-17, Team seats, 14 accounts): three accounts read `5h: {pct: 0.0}` with no reset while their `seven_day` and scoped Fable Windows on the same fetch were populated. One of them was the active account under seven concurrent sessions. The maintainer confirmed after inspecting raw bodies that this is "literally what the server sent (utilization: 0, no resets_at)" for idle accounts.
- cswap #306 (2026-09-01, coinciding with the 5.1 release): every non-active account came back fully hollow on every probe, `five_hour`, `seven_day` and the scoped Fable entry all at 0 with no `resets_at`, while the account that had just been active showed real numbers. cswap's `record()` overwrote real readings with the placeholder and stamped them fresh, so `list` showed 0% for accounts with real usage. Fix in PR #307 (not yet merged at `70f1058`): a "carries real evidence" predicate, and a hollow reading may not overwrite a row that has evidence.

The live body has the same shape on `nimbus_quill` (0.0, null), a Window this account has never used. So the shape itself is legitimate: null `resets_at` means no Window is open, which is exactly what an idle account looks like. The problem in #146 and #306 is that it also appears for accounts that were recently active, where it cannot be true, since Utilization only falls at a Reset and the previous `resets_at` had not passed.

Rules for mclaude:

1. A Window with `resets_at: null` carries no evidence. It does not count toward Headroom and does not overwrite a stored Window whose `resets_at` is still in the future.
2. Overwrite is allowed when the stored Window has no `resets_at`, when its `resets_at` has passed, or when the new Window has a `resets_at`.
3. A whole-body hollow response still counts as a successful attempt for scheduling (advance `lastAttemptAt`, keep cadence) but does not touch `fetchedAt`, so the age shown by `list` keeps counting from the last real reading.
4. For Selection, an Account with no evidence at all (never read, or only hollow reads) is Unknown, not "0% used".

## 5. Per-seat scope

The endpoint answers for the token's seat, not the org.

- cux #8: four seats in one org, four tokens, four different bodies (14/29, 2/0, 100/35, 5/1). cux had keyed its cache by `organizationUuid` and showed 14/29 for all of them. Fix keyed by `accountUuid|organizationUuid`.
- Claude Code keys its persisted copy by `accountUuid` and drops it when the logged-in account changes (binary, `hKn`/`_Kn`).
- The response carries `anthropic-organization-id` and `anthropic-workspace-id` headers, and `member_dashboard_available` hints at an org-level view existing elsewhere, but the body has no org totals.

For mclaude this confirms the map's line that two seats in one org are two Accounts. Key every cache entry by the Account's `accountUuid` as reported by `claude auth status`, never by email or org. Team and Enterprise seats can carry `extra_usage.disabled_reason` values like `seat_tier_zero_credit_limit` and `member_zero_credit_limit`, which are per seat too.

## 6. Polling policy

### 6.1 Constraints that shape it

- Per-account budget of about 28 to 30 requests per trailing hour, shared with Claude Code itself and any statusline widget the user runs. mclaude should stay under 12 per hour on any one Account and under 6 in steady state.
- Utilization is monotone inside a Window. It only changes when the Account is used, and it only falls at a Reset, which is a known timestamp. So an Account no session is using on this machine needs no polling until either its `resets_at` passes or another machine might be using it.
- In headless mode the Active account's live Utilization arrives in `rate_limit_event` on every response. In the TUI mclaude sees nothing, so a slow timer is the only source short of the hooks that report a Limit after the fact.
- Claude Code's own cache rules are a reasonable floor: refuse to refetch within 5 min (`Uso = 300000`), serve a stale copy up to 1 h when the endpoint fails (`Bso`).
- cux coalesces sibling sessions through a file lock: a reading under 20 s old at session start, or under 2 min at the idle check, is reused instead of refetched (cux `wrapper.go`, issue #39). cswap serves anything under 180 s from its store without a fetch (`SERVE_TTL_S`), polls the active account every 3 to 5 min, candidates every 5 to 10 min, exhausted accounts every 10 min, and drops to 60 s only when the active account is moving inside 15 points of the switch threshold.

### 6.2 Proposal

State lives in the shared lock-free state file the map already settled on, one record per Account:

```
{ accountUuid, lastGood: <normalized body>, fetchedAt, lastAttemptAt,
  backoffUntil, retryAfterSeen, last429At }
```

Normalized body keeps `five_hour`, `seven_day`, `limits[]` and `extra_usage.is_enabled`. Everything else is dropped on write.

Cache TTL. A reading is fresh for 180 s. Any surface (launch, Handoff, `list`) that finds a fresh reading uses it and makes no request. Above 180 s the reading is stale but still decision-grade until its earliest `resets_at` passes; after that it is Unknown. A stale reading is refreshed only when a decision needs it, never on a background sweep of every Account.

At launch:

1. Read the Active account. If its reading is fresh, or stale but under the switch threshold with every relevant `resets_at` still in the future, launch without any request. Otherwise one request.
2. If the Active account is past the threshold or Unknown, refresh candidates in order of cached Headroom, at most 8 requests, concurrency 4. Pick the best. Accounts beyond the first 8 keep their cached value.
3. Setup-token Accounts (no `user:profile` scope) and Accounts in backoff are skipped, not probed.

In session:

- Headless (stream-json): no polling at all. Update the Active account's record from `rate_limit_event.unifiedWindows` (fraction times 100, epoch to ISO) so `list` and the next launch see it.
- TUI: poll the Active account every 10 min while the session has produced a turn since the last poll, every 30 min otherwise. Tighten to 5 min when Utilization on any relevant Window is within 15 points of the threshold. Never below 5 min. Stop the timer when the session exits.
- Other Accounts: never polled in session. Their cached values age until a Handoff or `list` needs them.

At Handoff: same as launch step 2, capped at 8 requests. The Account that just hit the Limit gets its reading overwritten from the Limit event (Window at 100, `resets_at` from the event) rather than from a request.

On `list`: show cached values with their age. Refresh entries older than 10 min, concurrency 8. `list --refresh` ignores the TTL but still honors backoff. `list --cached` makes no requests.

After any `resets_at` passes, that Window is Unknown until the next read; do not assume 0.

### 6.3 Worst-case request rates

Per Account, since that is where the budget lives:

| situation | requests per hour on the busiest Account | total across all Accounts |
| --- | --- | --- |
| 5 Accounts, steady TUI session | 6 (10-min poll) | 6, plus at most 1 per other Account when a `list` runs |
| 5 Accounts, TUI session near threshold | 12 (5-min poll) | 12 |
| 5 Accounts, launch storm (Active over threshold) | 1 | 5 |
| 5 Accounts, headless | 0 | 0 in session; 1 per Account on `list` |
| 100 Accounts, steady TUI session | 6 | 6 |
| 100 Accounts, launch or Handoff | 1 | 9 (Active plus 8 candidates) |
| 100 Accounts, cold `list` | 1 | 100, one burst at concurrency 8, about 13 s |
| 100 Accounts, `list` every 10 min all day | 1 per 10 min = 6 | 600 per hour if every entry is always stale, which only happens if nothing else refreshes them |

The busiest Account never exceeds 12 per hour from mclaude, leaving 16 to 18 for Claude Code's `/usage`, the user's statusline, and other machines. Total volume at 100 Accounts is dominated by `list`, which is user-driven and bursty; the in-session timer touches one Account. If a per-IP limit ever appears the cold `list` burst is the first thing to throttle, so keep the concurrency cap configurable.

### 6.4 What would change this

- A per-IP or per-machine limit, which nobody has observed. Signal: 429s on idle Accounts right after a cold `list`.
- The hollow-response behaviour in #306 becoming permanent for non-active seats. Then only the Active account ever has real numbers, and candidate Selection has to rely on Reset timestamps and the last reading taken while each Account was active.
- `limits[]` growing `surface` scoping. Filter on `scope.surface` being null or Claude Code once it appears.
- The beta header rotating. Make it an env override like cux does.
