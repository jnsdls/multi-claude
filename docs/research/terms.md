# What Anthropic's terms say about subscription OAuth tokens used outside Claude Code

Research for issue #33, part of the map in #1. Written 2026-09-03. Feeds the README wording ticket.

Three acts of mclaude are on trial, in `CONTEXT.md` words:

1. The **usage call**: `GET https://api.anthropic.com/api/oauth/usage` with the access token Claude Code stored in an Account dir, sent once per Reading with an honest `User-Agent: mclaude/<ver>`. Never a prompt, never a token write or refresh (ADR 0002).
2. **Several Accounts on one machine**: N subscription logins, each in its own Account dir, Selection picking the one with Headroom.
3. **Handoff**: after a Limit, relaunching Claude Code on another Account with `--resume` and the rejected turn sent again.

Quotes are verbatim, including Anthropic's own em dashes. Every page was read on 2026-09-03 unless a snapshot date is given. Secondhand reports are marked as such.

## 1. Sources

| tag | page | date the page shows |
| --- | --- | --- |
| **CT** | [Consumer Terms of Service](https://www.anthropic.com/legal/consumer-terms) | "Effective October 8, 2025" |
| **AUP** | [Usage Policy](https://www.anthropic.com/legal/aup) | "Effective September 15, 2025" |
| **CoT** | [Commercial Terms of Service](https://www.anthropic.com/legal/commercial-terms) | "Effective June 17, 2025" |
| **LEGAL** | [Claude Code docs, Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance) | undated; history from Wayback snapshots in section 5.2 |
| **AUTH** | [Claude Code docs, Authentication](https://code.claude.com/docs/en/authentication) | undated |
| **DATA** | [Claude Code docs, Data usage](https://code.claude.com/docs/en/data-usage) | undated |
| **LOGIN** | [Support: Log in to your Claude account](https://support.claude.com/en/articles/13189465-logging-in-to-your-claude-account) | "May 19, 2026" |
| **SDK** | [Support: Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) | "June 16, 2026" |
| **PROMAX** | [Support: Using Claude Code with your Pro or Max plan](https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan) | "Updated over 2 weeks ago" (relative only) |
| **TEAM** | [Support: What is the Team plan?](https://support.claude.com/en/articles/9266767-what-is-the-team-plan) | "Updated over 2 weeks ago" |
| **binary** | Claude Code 2.1.259 (`~/.local/share/claude/versions/2.1.259`) | built 2026-09-02 |

`docs.claude.com/en/docs/claude-code/legal-and-compliance` and `.../data-usage` both 301 to `code.claude.com/docs/en/...`; the old URLs in the ticket are dead.

## 2. Consumer Terms (Free, Pro, Max)

LEGAL, "License": "Your use of Claude Code is subject to: Commercial Terms of Service - for Team, Enterprise, and Claude API users; Consumer Terms of Service - for Free, Pro, and Max users".

CT preamble defines the Services as "Claude.ai, Claude Pro, and other products and services that we may offer for individuals, along with any associated apps, software, and websites (together, our 'Services')". The Terms "include our Acceptable Use Policy".

### 2.1 Account sharing (CT section 2, "Your Anthropic Account")

> You may not share your Account login information, Anthropic API key, or Account credentials with anyone else. You also may not make your Account available to anyone else. You are responsible for all activity occurring under your Account, and you agree to notify us immediately if you become aware of any unauthorized access to your Account by sending an email to support@anthropic.com.

### 2.2 Multiple accounts

No clause. CT never addresses one person holding several Accounts. The only multi-account language is in AUP (section 3).

### 2.3 Automated access (CT section 3, "Use of our Services")

The section opens: "You are responsible for all activity under the account through which you access the Services. You may not access or use, or help another person to access or use, our Services in the following ways:" and the relevant bullets are:

> To decompile, reverse engineer, disassemble, or otherwise reduce our Services to human-readable form, except when these restrictions are prohibited by applicable law.

> To crawl, scrape, or otherwise harvest data or information from our Services other than as permitted under these Terms.

> Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it, to access the Services through automated or non-human means, whether through a bot, script, or otherwise.

### 2.4 Circumventing limits (CT section 3, closing sentence)

> You also must not abuse, harm, interfere with, or disrupt our Services, including, for example, introducing viruses or malware, spamming or DDoSing Services, or bypassing any of our systems or protective measures.

No clause names usage limits, rate limits, or plan quotas. "Protective measures" is the closest phrase.

### 2.5 Third-party tools (CT section 7, "Third-party services and links")

> Our Services may use or be used in connection with third-party content ("Third-Party Content"), services, or integrations. We do not control or accept responsibility for any loss or damage that may arise from your use of any Third-Party Content, services, and integrations, for which we make no representations or warranties. Your use of any Third-Party Content, services, and integrations is at your own risk and subject to any terms, conditions, or policies (including privacy policies) applicable to such third-party content, services, and integrations.

This is a liability disclaimer, not a permission or a prohibition. CT nowhere says Claude Pro or Max may not be used through a third-party tool; that language lives only in LEGAL and LOGIN (section 5).

### 2.6 Changes and enforcement (CT section 12, "General terms")

> Unless we specifically agree otherwise in a separate agreement with you, we reserve the right to modify, suspend, or discontinue the Services or your access to the Services, in whole or in part, at any time without notice to you.

## 3. Usage Policy (all plans)

AUP applies "to anyone who can submit inputs to Anthropic's products and/or services, including via any authorized resellers or passthrough access". Under the heading "Do Not Abuse our Platform", "This includes using our products or services to:"

> Coordinate malicious activity across multiple accounts to avoid detection or circumvent product guardrails or generating identical or similar inputs that otherwise violate our Usage Policy

> Utilize automation in account creation or to engage in spammy behavior

> Circumvent a ban through the use of a different account, such as the creation of a new account, use of an existing account, or providing access to a person or entity that was previously banned

> Intentionally bypass capabilities, restrictions, or guardrails established within our products for the purposes of instructing the model to produce harmful outputs (e.g., jailbreaking or prompt injection) without prior authorization from Anthropic

Elsewhere (deceptive practices): "Engage in actions or behaviors that circumvent the guardrails or terms of other platforms or services". AUP has no clause on account sharing, on holding several accounts for a lawful purpose, or on usage limits. It never mentions Claude Code, OAuth or tokens.

## 4. Commercial Terms (Team, Enterprise seats)

CoT governs "Customer's use of Anthropic API keys and any other Anthropic offerings that references these Terms, as well as all related Anthropic tools, documentation and services (the 'Services')". A.1 lets Customer use the Services "including to power products and services Customer makes available to its own customers and end users ('Users')".

The clauses that exist:

> D.2. Policies and Service Terms. Customer and its Users may only use the Services in compliance with these Terms, including (a) the Usage Policy

> D.4. Use Restrictions. Customer may not and must not attempt to (a) access the Services to build a competing product or service, including to train competing AI models or resell the Services except as expressly approved by Anthropic; (b) reverse engineer or duplicate the Services; or (c) support any third party's attempt at any of the conduct restricted in this sentence.

> D.5. Service Account. Customer is responsible for all activity under its account. Customer will promptly notify Anthropic if Customer believes the account it uses to access the Services has been compromised, or is subject to a denial of service or similar malicious attack that may negatively impact the Services.

I.3.a lets Anthropic suspend access when "Customer or any User is using the Services in violation of Sections D.1 (Compliance), D.2 (Policies and Service Terms) or D.4 (Use Restrictions)".

CoT has no clause on credential sharing, multiple accounts, automated access, or circumventing limits. The seat model comes from support articles instead. TEAM: "Usage limits on Team plans are per-member, rather than applied to the team as a whole." and "Each team member has their own set of usage limits." The seats article ([12004354](https://support.claude.com/en/articles/12004354-purchasing-and-managing-seats), "Updated yesterday") says owners "assign users to different seat types"; nothing about one user holding two seats or seats being personal, in so many words. The subscriber-only rule for seats is in LOGIN (section 5.3): "Subscription plans can only be used by subscribers".

## 5. Claude Code docs and support center

### 5.1 LEGAL, current text (2026-09-03)

"Acceptable use":

> Claude Code usage is subject to the Anthropic Usage Policy. Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK.

"Authentication and credential use":

> Claude Code authenticates with Anthropic's servers using OAuth tokens or API keys. These authentication methods serve different purposes:
>
> **OAuth authentication** is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications. For the sign-in steps, see Logging in to your Claude account; for how Claude Code performs OAuth authentication, see Authentication.
>
> **Developers** building products or services that interact with Claude's capabilities, including those using the Agent SDK, should use API key authentication through Claude Console or a supported cloud provider. Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow.
>
> This does not restrict how customers provision and manage their own API keys or third-party inference provider credentials — for example, configuring an API key in a development environment, secrets manager, or machine image for use by the customer's own authorized users — provided the resulting usage is billed to the key owner under their agreement with Anthropic (or the applicable provider) and is not resold or intermediated as described above. Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code as described under *Can customers offer Claude Code in their products?* above.
>
> Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice.

"Can customers offer Claude Code in their products?" adds two conditions for anyone "preinstalling or running Claude Code in your products or services": "The Claude Code binary must not be modified" and "customers may not remove, disable, or restrict any authentication method built into it", and "Each end user must authenticate with their own Anthropic API key, Claude subscription plan credentials, or 3P inference provider credential".

### 5.2 LEGAL, how the wording moved (Wayback, `web.archive.org/web/<ts>/https://code.claude.com/docs/en/legal-and-compliance`)

| snapshot (UTC) | "Authentication and credential use" said |
| --- | --- |
| 2026-02-01 06:42 | No "Usage policy" section on the page at all. |
| 2026-02-18 17:15 through 2026-04-01 18:07 | "**OAuth authentication** (used with Free, Pro, and Max plans) is intended exclusively for Claude Code and Claude.ai. Using OAuth tokens obtained through Claude Free, Pro, or Max accounts in any other product, tool, or service — including the Agent SDK — is not permitted and constitutes a violation of the Consumer Terms of Service." Developers paragraph ended at "on behalf of their users." |
| 2026-04-13 02:18 through 2026-08-04 11:38 | The "not permitted ... violation" sentence is gone. Replaced by today's "intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications", linking to LOGIN. |
| 2026-08-30 09:47 to now | Adds "into their own applications", the "Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens" sentence, and the "This does not restrict ... Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription" paragraph. |

So the flat ban on tokens "in any other product, tool, or service" lived on the page for about eight weeks (mid February to early April 2026) and was withdrawn in the same fortnight as the April 4 subscription change (section 6). What replaced it targets developers acting "on behalf of their users" and anyone who would "collect, store, or intermediate" tokens.

### 5.3 LOGIN (May 19, 2026), section "Authenticating to subscription plans"

> Claude offers subscription plans (Free, Pro, Max, Team, Enterprise) that let subscribers authenticate using OAuth tokens or other methods. Subscription plans can only be used by subscribers, and the usage included in these plans is designed to support ordinary use of native Anthropic applications, including the Claude web, desktop, and mobile applications and Claude Code.
>
> The preferred way to access Anthropic services using third-party software, tools, or services ("third-party tools"), including open-source projects, is through API key authentication through Claude Console or a supported cloud provider. Anthropic may at its discretion allow paid subscribers who have enabled usage credits to use certain third-party tools to access Anthropic services included in paid subscription plans, but reserves the right to draw use of such third-party tools from usage credits rather than subscription limits. Users are responsible for any usage credit charges incurred this way. Use of third-party tools that misrepresent their identity to Anthropic's servers, attempt to route third-party traffic against subscription limits, or otherwise violate applicable terms or policies is prohibited and such use may be enforced against.

"Developers":

> If you're building a product, application, or tool for others, use API key authentication through Claude Console or a supported cloud provider. Applications that misrepresent their identity to Anthropic's servers, attempt to route third-party traffic against subscription limits, or otherwise violate applicable terms or policies are prohibited and may be enforced against.

This is the only Anthropic page that spells out what makes a third-party tool prohibited: misrepresenting identity, routing third-party traffic against subscription limits, or otherwise breaking the terms.

### 5.4 SDK (June 16, 2026)

Banner: "Update June 15: We're pausing the changes to Claude Agent SDK usage described below. For now, nothing has changed: Claude Agent SDK, `claude -p`, and third-party app usage still draw from your subscription's usage limits. The previously announced monthly credit, which would have been available to eligible claimants in connection with these changes, isn't available."

The paused plan would have covered "Third-party apps that authenticate with your Claude subscription through the Agent SDK" from a separate monthly credit, and said "Credits belong to individual accounts. They can't be shared or pooled across teammates." Relevant to mclaude only as evidence that Anthropic currently lets `claude -p` and SDK hosts (t3/code) draw on the subscription.

### 5.5 PROMAX, AUTH, DATA

PROMAX: "log in with the same credentials you use for Claude"; "Both Pro and Max plans offer usage limits that are shared across Claude and Claude Code, meaning all activity in both tools counts against the same usage limits."

AUTH documents the per-directory login mclaude relies on: "If you've set the `CLAUDE_CONFIG_DIR` environment variable, Claude Code keeps the `.credentials.json` file under that directory instead, including the file the macOS fallback writes, and keys the macOS Keychain entry to that directory too, so a session with a different `CLAUDE_CONFIG_DIR` reads a different entry." And: "Claude Code manages `.credentials.json` through `/login` and `/logout`." Nothing on that page says a second program may or may not read the file.

DATA has no clause on third-party tools or tokens. It says "Claude Code is compatible with most popular VPNs and LLM proxies" and lists retention by plan.

## 6. Anthropic statements in 2026 on third-party harnesses

Only Anthropic's own words are quoted. Everything here reached me through a news report, so treat each as secondhand unless the source is Anthropic's page.

- **2026-01-09, Thariq Shihipar (Anthropic), X** ([post](https://x.com/trq212/status/2009689809875591565), quoted by [VentureBeat 2026-01-09](https://venturebeat.com/technology/anthropic-cracks-down-on-unauthorized-claude-usage-by-third-party-harnesses)): Anthropic had "tightened our safeguards against spoofing the Claude Code harness." Secondhand.
- **2026-02-18, Thariq Shihipar, X** (quoted by [Gigazine 2026-02-20](https://gigazine.net/gsc_news/en/20260220-anthropic-third-party-block/)): "If you're building a business on top of the Agent SDK, you should use an API key instead." and "We want to encourage local development and experimentation with the Agent SDK and claude." Secondhand.
- **2026-02-20, Thariq Shihipar, on the record to [The Register](https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access/)**: "Third-party harnesses using Claude subscriptions create problems for users and are prohibited by our Terms of Service. They generate unusual traffic patterns without any of the usual telemetry that the Claude Code harness provides, making it really hard for us to help debug when they have questions about rate limit usage or account bans and they don't have any other avenue for this support." The Register also reports Anthropic describing the February docs edit as clarifying "existing policy language to make it consistent throughout company documentation." Secondhand.
- **2026-04-03, Boris Cherny (head of Claude Code), X** (quoted by [VentureBeat 2026-04-03](https://venturebeat.com/technology/anthropic-cuts-off-the-ability-to-use-claude-subscriptions-with-openclaw-and), [TechCrunch 2026-04-04](https://techcrunch.com/2026/04/04/anthropic-says-claude-code-subscribers-will-need-to-pay-extra-for-openclaw-support/), [Engadget 2026-04-04](https://www.engadget.com/ai/its-no-longer-free-to-use-claude-through-third-party-tools-like-openclaw-160912082.html)): from 2026-04-04 12:00 PT "Claude subscriptions will no longer include usage through third-party applications such as OpenClaw"; "We've been working hard to meet the increase in demand for Claude, and our subscriptions weren't built for the usage patterns of these third-party tools. Capacity is a resource we manage thoughtfully and we are prioritizing our customers using our products and API." and later "This is more about engineering constraints". Secondhand.
- **2026-05-13, Anthropic (@ClaudeDevs) and Lydia Hallie, X** (quoted by [VentureBeat 2026-05-13](https://venturebeat.com/technology/anthropic-reinstates-openclaw-and-third-party-agent-usage-on-claude-subscriptions-with-a-catch)): "introducing a new subcategory of 'Agent SDK' credits"; "you don't pay extra. It's the same subscription, same price per month." Secondhand. Superseded by the June 15 pause in SDK (primary, section 5.4).

No Anthropic statement found, primary or reported, that names account switchers, multi-account launchers, or reading a token to call the usage endpoint. Every statement is about harnesses that send their own model traffic on a subscription.

## 7. OAuth scopes on a Claude Code login

Anthropic publishes no scope reference. The docs name none. What exists:

- **binary**, the constants: `Fy="user:inference"`, `LB="user:profile"`, `s="org:create_api_key"`, `gd="oauth-2025-04-20"`; claude.ai login requests `S8=[user:profile, user:inference, user:sessions:claude_code, user:mcp_servers, user:file_upload]`; Console login requests `[org:create_api_key, user:profile]`; optional add-ons `user:design:read`, `user:design:write` ("Added user:design:read and user:design:write to your claude.ai login (for the Design MCP connector)"), `user:projects:read`, `user:projects:write`, `user:plugins`.
- **binary**, the Chrome diagnostic: "OAuth token has no scope accepted by /api/oauth/validate (needs user:profile, user:office, or user:ccr_inference; env-var and setup-token sessions default to user:inference only)". The self-hosted runner sets `CLAUDE_CODE_OAUTH_SCOPES:"user:inference user:ccr_inference user:file_upload"` on its child.
- **AUTH** on `claude setup-token`: "This token authenticates with your Claude subscription and requires a Pro, Max, Team, or Enterprise plan. It can only make model requests, so it can't establish Remote Control sessions or fetch claude.ai connectors."
- **binary**, Remote Control diagnostic rows: "Sign-in includes the user:profile scope" / "Sign-in is missing the user:profile scope".
- Usage endpoint gate: Claude Code refuses `/api/oauth/usage` without `user:profile` (research note for #5, section 1). Community reports agree ([anthropics/claude-code#22450](https://github.com/anthropics/claude-code/issues/22450): setup-token lacks `user:profile`, so `claude usage` fails). Secondhand.

What each permits, read from the strings above rather than any Anthropic text: `user:inference` is model requests; `user:profile` is the profile and usage reads plus Remote Control eligibility; `user:sessions:claude_code` is session sync; `user:mcp_servers` is claude.ai connectors; `user:file_upload` is uploads; `org:create_api_key` mints Console keys. Scopes say what a token can do. No scope, and no page, says who may present it. The token mclaude reads is the browser-login one with all five, and the only scope the usage call exercises is `user:profile`.

## 8. Prior art wording

- **caam** ([Dicklesworthstone/coding_agent_account_manager](https://github.com/Dicklesworthstone/coding_agent_account_manager), README at `d224a49`, 2026-09-03), FAQ: "**Q: Is this against terms of service?** No. You're using your own legitimately-purchased subscriptions. `caam` just manages local auth files—it doesn't share accounts, bypass rate limits, or modify API traffic. Each account still respects its individual usage limits." A flat "No", no citation. Its LICENSE is "MIT License (with OpenAI/Anthropic Rider)" barring Anthropic and OpenAI from any use.
- **cux** ([inulute/cux](https://github.com/inulute/cux), README at `1127967`, 2026-08-31, GPL-3.0): no terms disclaimer anywhere in README, `docs/`, CHANGELOG or cux.inulute.com. The README's "Security" section covers file modes and sockets only.
- **claude-swap** ([realiti4/claude-swap](https://github.com/realiti4/claude-swap), README at `70f1058`, 2026-09-02, MIT): no terms disclaimer. Closest line, under "How it works": "Usage numbers refresh every few minutes ... keeping cswap comfortably inside Anthropic's rate limits however many dashboards you keep open on a machine."

So of the three, one asserts compliance without evidence and two say nothing. None quotes a clause.

## 9. Verdicts, clause by clause

"Text" is what the page says. "Reading" is mine.

### 9.1 The usage call

| clause | text | reading |
| --- | --- | --- |
| CT 2, sharing | Bars sharing credentials with "anyone else". | Not engaged. Same person, own token, own machine. |
| CT 3, automated means | Bars access "through automated or non-human means, whether through a bot, script, or otherwise" unless via an API key "or where we otherwise explicitly permit it". | The clause most directly on point, and it cuts against. mclaude is a script presenting a subscription token, and nothing explicitly permits this endpoint (it is undocumented). The counter-reading is that Claude Code itself is a permitted script, the call is byte-identical to its `/usage`, and it reads the user's own meter. That is a fair-use argument, not text. |
| CT 3, "bypassing any of our systems or protective measures" | Bars bypassing. | Not engaged. A read of a meter bypasses nothing. |
| CT 3, scraping | Bars harvesting data "other than as permitted". | Thin. One JSON body per Reading about the caller's own account is not what "crawl, scrape, or otherwise harvest" describes, but a strict reader could stretch it. |
| LEGAL, OAuth "designed to support ordinary use of Claude Code and other native Anthropic applications" | States intent, not a prohibition. The February-to-April wording ("in any other product, tool, or service ... is not permitted") was a prohibition and was withdrawn. | Against the spirit, since the call is made outside Claude Code. The withdrawal of the flat ban matters: Anthropic chose softer words. |
| LEGAL, developers "may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow" | Addressed to "third-party developers" acting "on behalf of their users". | mclaude does not collect or store a token (Claude Code writes it, in Claude Code's own store, after Claude Code's own login) and does not proxy requests. It does read the token out. "Intermediate" is the word a hostile reader would use; I read the clause as aimed at services that sit between a user and Anthropic. Sign-in completes through Claude Code's flow, which is Anthropic's own. |
| LOGIN, prohibited tools "misrepresent their identity", "route third-party traffic against subscription limits", "otherwise violate applicable terms" | Three tests. | Passes the first two: honest `mclaude/<ver>` user agent, zero model traffic. The third loops back to CT 3. |
| AUP | Nothing applies. | Not engaged. |

Verdict: the one clause squarely against is CT 3 automated means, with no explicit permission to point at. Everything Anthropic has written or said in 2026 about third-party tools targets inference traffic on subscriptions, and this call carries none; that is why I put it in the grey zone rather than the red one. It is also the only act of mclaude's that touches Anthropic's servers directly, so it is the one to disclose in the README in plain words, and the one to drop first if Anthropic objects. A zero-call design exists: headroom from the `rate_limit_event` stream under `-p` and from the usage body Claude Code itself persists in the Account dir (note for #5, sections 2.5 and 3.2). Worth keeping on the shelf.

### 9.2 Several Accounts on one machine

| clause | text | reading |
| --- | --- | --- |
| CT 2, sharing | Bars making your Account "available to anyone else". Silent on one person holding several. | Allowed when every Account is the user's own login. Prohibited the moment any Account is someone else's Pro or Max, whatever the tooling. |
| AUP, multiple accounts | Bars multi-account use only for "malicious activity", "automation in account creation", or circumventing a ban. | Not engaged for a person who paid for N plans and uses them one at a time. |
| LEGAL, "Advertised usage limits for Pro and Max plans assume ordinary, individual usage" | Describes the assumption behind the limits. | Individual, yes. "Ordinary" is undefined; N plans is more than the typical subscriber, but the sentence is about how limits are sized, not a cap on plans per person. |
| LOGIN, "Subscription plans can only be used by subscribers" | The subscriber-only rule. | Same as CT 2: fine for own plans, not for borrowed ones. |
| CoT D.5, TEAM per-member limits | Customer answers for its account; limits are per member. | A Team or Enterprise seat is one member's. Two seats of the same person in two organizations are two Accounts (CONTEXT.md) and fine. Using a colleague's seat is sharing. An org admin can also pin logins with `forceLoginOrgUUID` (AUTH); mclaude must not help around that. |

Verdict: permitted by silence when all Accounts are the user's own, prohibited by CT 2 and LOGIN when any is not. The README line writes itself: every Account must be a login you hold yourself.

### 9.3 Handoff

| clause | text | reading |
| --- | --- | --- |
| CT 3, "bypassing any of our systems or protective measures" | The only sentence a hostile reader can cite. | A usage limit is an entitlement of one plan ("included usage", TEAM and PROMAX), enforced per account, and it stays enforced: the walled Account stays walled until its Reset, the next Account spends its own. Nothing is bypassed on either. But "protective measures" is broad and Anthropic decides what it covers. |
| AUP, "bypass capabilities, restrictions, or guardrails ... for the purposes of instructing the model to produce harmful outputs" | Scoped to harmful outputs. | Not engaged. |
| LOGIN, "attempt to route third-party traffic against subscription limits" | The traffic must be third-party. | The traffic after Handoff is Claude Code's own, from the user's own subscription, with the user's own prompt sent once more. Not third-party traffic. |
| LEGAL, "ordinary, individual usage" | Assumption behind limits. | Same as 9.2. Handoff is individual usage of two plans in sequence. |
| Cherny, "subscriptions weren't built for the usage patterns of these third-party tools" | Said of OpenClaw-style agents in April 2026. | Signals what Anthropic worries about: aggregate demand on subscriptions. mclaude does not add demand beyond what N plans already entitle, but it makes spending all of them easier. |
| Transcript moves between Accounts | No clause anywhere on a local transcript resumed under another login. | Silent. The data lives on the user's disk and each Account sees only what is sent to it. |

Verdict: the text is silent on moving your own conversation between your own plans; the reading turns on whether a plan's usage limit is a "protective measure" or an entitlement. I read it as an entitlement, because Anthropic's own pages call it "included usage" and sell credits past it, and because switching accounts by hand after a wall (log out, log in) is exactly what the login flow supports. The risk is not the clause, it is CT 12 and LEGAL: Anthropic "may do so without prior notice". Handoff is the act most likely to look like a harness to a traffic classifier, and the resend of a rejected turn is the one behaviour mclaude should describe honestly.

### 9.4 Where the text is silent

- One person holding several subscriptions.
- A second program reading the credential Claude Code stored, for the same user.
- The usage endpoint itself: undocumented, ungated by user agent, and never mentioned on any Anthropic page.
- What "ordinary" and "individual" mean in "ordinary, individual usage".
- Resuming a transcript under another login.
- Whether "where we otherwise explicitly permit it" (CT 3) covers Claude Code's own hooks, SDK hosts and the `-p` mode that SDK says "still draw from your subscription's usage limits".
- Team and Enterprise: CoT never mentions seats; per-member limits and the subscriber-only rule live in support articles, which CoT does not incorporate by name.
- Enforcement outcome. Every page ends the same way: Anthropic may act "without prior notice".

## 10. What this means for the README

Facts to state, in this order, each traceable to a line above:

1. mclaude runs the unmodified Claude Code binary and Claude Code does every login (LEGAL, "Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription").
2. Every Account must be a subscription you hold yourself. Using anyone else's login breaks the Consumer Terms (CT 2) and the subscriber-only rule (LOGIN), whatever tool you use.
3. mclaude makes one request of its own with your token, a read of your usage meter at `api.anthropic.com/api/oauth/usage`, the same request Claude Code's `/usage` makes, sent as `mclaude/<ver>`. It never sends prompts and never writes or refreshes a token.
4. Anthropic's Consumer Terms bar automated access outside an API key unless explicitly permitted, and Anthropic's docs say OAuth is "designed to support ordinary use of Claude Code and other native Anthropic applications". Anthropic withdrew a flat ban on token use outside Claude Code in April 2026 but "reserves the right to take measures to enforce these restrictions and may do so without prior notice". Link CT, LEGAL and LOGIN.
5. Handoff resumes your own conversation on another of your own Accounts and sends the rejected turn again. Each Account's limit still applies to that Account.
6. Do not write "this is not against the terms" (caam's line). Write what mclaude does, quote the two governing sentences, and say the reader carries the risk. Team and Enterprise members should check with their admin, because `forceLoginOrgUUID` and org policy sit above anything mclaude does.
