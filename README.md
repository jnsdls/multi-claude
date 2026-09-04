# multi-claude

## Terms

mclaude runs the unmodified Claude Code binary. Claude Code does every login in its own flow and stores the token in its own credential store. mclaude never writes, refreshes or copies a token.

Every account you add must be a Claude subscription you hold yourself. Using anyone else's login breaks Anthropic's Consumer Terms and the subscriber-only rule for plans, whatever tool you use.

mclaude makes one request of its own with your token: a read of your usage meter at `api.anthropic.com/api/oauth/usage`. It is the same request Claude Code's `/usage` command makes, sent with the user agent `mclaude/<version>`. mclaude never sends a prompt.

When an account hits a usage limit, mclaude ends Claude Code and relaunches it on another of your accounts with the same conversation resumed and the rejected turn sent again. The limit on the first account still applies to it until its reset. The second account spends its own.

Anthropic's Consumer Terms bar access through automated means outside an API key unless Anthropic explicitly permits it. Anthropic's Claude Code documentation says subscription OAuth is meant for ordinary use of Claude Code and other native Anthropic applications, and Anthropic reserves the right to enforce that without notice. The usage read is a script presenting a subscription token, and no Anthropic page permits it by name. You carry that risk. Read these before you add an account:

- [Consumer Terms of Service](https://www.anthropic.com/legal/consumer-terms), section 3, "Use of our Services"
- [Claude Code: Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance), "Authentication and credential use"
- [Logging in to your Claude account](https://support.claude.com/en/articles/13189465-logging-in-to-your-claude-account), "Authenticating to subscription plans"

Team and Enterprise members should check with their admin. An organization can pin which login Claude Code accepts, and its policy governs the seat above anything mclaude does.
