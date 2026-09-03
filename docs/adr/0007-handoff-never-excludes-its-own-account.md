---
status: accepted
---
# Handoff runs plain Selection and never excludes the Account it is on

When a Limit hits, the session that saw it records the Limit in that Account's Record and then runs the same Selection it would run at a Session start, over every Account including the one it is leaving. It does not exclude its own Account, and it does not assume the Account is still full. The Limit in the Record is what disqualifies it, and only for launches whose requested model falls in the Window the Limit named.

This matters when several sessions share one Account. Each one hits the wall within seconds of the others and each one runs Handoff. Because every session ranks the same shared Records with the same rule, they all pick the same target and pile onto it, which is the intended outcome. cux ranked "every Account except the current one", so the second session, finding the first session's fresh target already Active, moved off it to a third Account, the third session to a fourth, and one wall walked the whole pool (cux issue 21). Excluding the current Account is the bug; a rule that reads state instead of position cannot cascade.

Two rules keep this from spending the usage budget or trusting stale evidence. The post-Limit usage request is skipped when the Record already holds a reading fetched after the Limit was reported, so N sessions cost one request, not N. And a Limit is cleared early only by a reading that carries evidence, a Window with a non-null `resets_at` showing under 100, never by a hollow response.

## Considered options

Exclude the current Account, as cux did. Rejected for the cascade above.

Serialise Handoffs with a lock so the second session sees the first's result. Rejected because ADR 0005 takes no locks, and it is unnecessary: a deterministic rule over shared state converges without one.
