// A local stand-in for GET /api/oauth/usage. Answers per token from the scenario.
export interface UsageResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Delay before answering, to trip the client timeout. */
  delayMs?: number;
  /** Never answer (the client times out). */
  hang?: boolean;
}

export interface UsageScenario {
  /** Keyed by bearer token; `*` is the default. */
  byToken?: Record<string, UsageResponse | UsageResponse[]>;
  default?: UsageResponse;
}

export interface UsageRequest {
  token: string | null;
  headers: Record<string, string>;
  path: string;
  at: number;
}

export interface UsageServer {
  url: string;
  requests: UsageRequest[];
  scenario: UsageScenario;
  stop(): void;
}

export async function startUsageServer(scenario: UsageScenario = {}): Promise<UsageServer> {
  const requests: UsageRequest[] = [];
  const perTokenIndex = new Map<string, number>();
  const holder: { scenario: UsageScenario } = { scenario };
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const auth = req.headers.get("authorization");
      const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
      const headers: Record<string, string> = {};
      req.headers.forEach((v, k) => {
        headers[k] = v;
      });
      requests.push({ token, headers, path: url.pathname, at: Date.now() });
      const s = holder.scenario;
      let resp: UsageResponse | undefined;
      const entry = (token ? s.byToken?.[token] : undefined) ?? s.byToken?.["*"];
      if (Array.isArray(entry)) {
        const key = token ?? "*";
        const i = perTokenIndex.get(key) ?? 0;
        perTokenIndex.set(key, i + 1);
        resp = entry[Math.min(i, entry.length - 1)];
      } else resp = entry;
      resp ??= s.default ?? { status: 200, body: {} };
      if (resp.hang) {
        await new Promise(() => {});
      }
      if (resp.delayMs) await Bun.sleep(resp.delayMs);
      const body = typeof resp.body === "string" ? resp.body : JSON.stringify(resp.body ?? {});
      return new Response(body, {
        status: resp.status ?? 200,
        headers: { "content-type": "application/json", ...(resp.headers ?? {}) },
      });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    get scenario() {
      return holder.scenario;
    },
    set scenario(s: UsageScenario) {
      holder.scenario = s;
    },
    stop: () => server.stop(true),
  };
}
