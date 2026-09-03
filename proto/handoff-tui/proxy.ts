// PROTOTYPE, throwaway. Forwards Anthropic API traffic and injects a 429
// "usage limit" when /tmp/mclaude-proto/limit exists (contents = window type
// or "after:N" to reject only the Nth request seen after the file appeared).
import { existsSync, readFileSync, appendFileSync } from "node:fs";
const P = "/tmp/mclaude-proto";
const UP = "https://api.anthropic.com";
const log = (s: string) => appendFileSync(`${P}/proxy.log`, `${new Date().toISOString()} ${s}\n`);
let seenSinceTrigger = 0, triggerSeen = false;
Bun.serve({
  port: Number(process.argv[2] ?? 8788),
  async fetch(req) {
    const url = new URL(req.url);
    const body = req.method === "POST" ? await req.arrayBuffer() : undefined;
    let snippet = "";
    if (body) { try { const j = JSON.parse(Buffer.from(body).toString()); const sys = Array.isArray(j.system) ? j.system.map((b: any) => b.text ?? "").join(" ") : (j.system ?? ""); snippet = `model=${j.model} msgs=${j.messages?.length} sys=${JSON.stringify(sys.slice(0, 130))}`; } catch {} }
    const trig = process.env.INJECT === "1" && existsSync(`${P}/limit`) ? readFileSync(`${P}/limit`, "utf8").trim() : "";
    if (trig && url.pathname.startsWith("/v1/messages")) {
      if (!triggerSeen) { triggerSeen = true; seenSinceTrigger = 0; }
      seenSinceTrigger++;
      let win = trig, reject = true;
      const m = /^after:(\d+):?(.*)$/.exec(trig);
      if (m) { reject = seenSinceTrigger >= Number(m[1]); win = m[2] || "five_hour"; }
      const mm = /^msgs:(\d+)$/.exec(trig);
      if (mm) { let n = 0; try { n = JSON.parse(Buffer.from(body!).toString()).messages.length; } catch {} reject = n >= Number(mm[1]) && !snippet.includes("cc_is_subagent") && snippet.includes("You are Claude Code"); win = "five_hour"; }
      if (trig === "sub") { reject = snippet.includes("cc_is_subagent=t"); win = "five_hour"; }
      if (reject) {
        log(`429 -> ${url.pathname} ${snippet}`);
        const reset = Math.floor(Date.now() / 1000) + 3600;
        return new Response(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "You have reached your usage limit." } }), {
          status: 429,
          headers: {
            "content-type": "application/json",
            "anthropic-ratelimit-unified-status": "rejected",
            "anthropic-ratelimit-unified-representative-claim": win,
            "anthropic-ratelimit-unified-reset": String(reset),
            "anthropic-ratelimit-unified-5h-status": "rejected",
            "anthropic-ratelimit-unified-5h-reset": String(reset),
            "anthropic-ratelimit-unified-5h-utilization": "1.0",
            "retry-after": "3600",
          },
        });
      }
    } else { triggerSeen = false; }
    log(`fwd ${req.method} ${url.pathname} ${snippet}`);
    const h = new Headers(req.headers); h.delete("host"); h.delete("content-length");
    const r = await fetch(UP + url.pathname + url.search, { method: req.method, headers: h, body, redirect: "manual" } as any);
    log(`  <- ${r.status}`);
    const rh = new Headers(r.headers); rh.delete("content-encoding"); rh.delete("content-length");
    return new Response(r.body, { status: r.status, headers: rh });
  },
});
log(`proxy up on ${process.argv[2] ?? 8788} inject=${process.env.INJECT}`);
