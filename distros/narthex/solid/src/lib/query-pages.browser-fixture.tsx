import { Errored, Loading, flush } from "solid-js";
import { render } from "@solidjs/web";
import { createRouter, memoryHistory } from "@solidjs/router";
import { CHECKPOINT_VALUE_ENCODING, decodeCheckpointValue, encodeCheckpointValue } from "@fenel/engine/checkpoint-json";
import { setBrowserAccountScope } from "./browser-session";
import { ApiClientContext, createAccountApiClient, createPublicApiClient, defaultApiClient, useApiClient, type ApiClient } from "./api";

// Production pages, router queries, field editors and apiFetch stay intact.
// Only Fetch IO is intercepted, with the actual request bytes and provenance
// recorded before the mock service uses the shared native codec.
type Saved = { id: string; slug: string; name: string; query: Record<string, unknown>; createdAt: string; updatedAt: string };
type RequestLog = { account: string; path: string; method: string; encoding: string | null; raw: string; value: unknown };
type Scenario = "normal" | "load-errors" | "data-load-errors" | "seed-switch";
const header = "X-Fenel-Value-Encoding";
const timestamp = "2026-09-08T10:00:00.000Z";
const marker = { $fenelCheckpoint: ["number", "+infinity"] };
const unbounded = { $tag: "SePattern", pattern: { t: "rep", min: 0, max: Infinity, child: { t: "eps" } } };
const row = () => ({ id: "native-event", bytes: Uint8Array.of(0, 128, 255), buffer: Uint8Array.of(1, 254).buffer, bound: Infinity, negativeZero: -0, business: marker });
const saved = (id: string, name: string, query: Record<string, unknown>): Saved => ({ id, slug: id, name, query, createdAt: timestamp, updatedAt: timestamp });
function defaults(account: string): Saved[] {
  return [
    saved(`${account}-native`, "Native events", { entity: "event", filter: { label: unbounded }, includeTotal: true }),
    saved(`${account}-empty`, "Zero total", { entity: "event", filter: { id: { $tag: "SeEnum", values: ["absent"] } }, includeTotal: true }),
    saved(`${account}-search`, account === "account-b" ? "Account B preset" : "Data preset", { kind: "data-search", text: account === "account-b" ? "Account B preset" : "fixture-search" }),
  ];
}
let account = "account-a";
let scenario: Scenario = "normal";
let rowsByAccount = new Map<string, Saved[]>();
let requests: RequestLog[] = [];
let unexpected: string[] = [];
let componentErrors: string[] = [];
let schemaFailures = 0;
let savedFailures = 0;
let nextId = 0;
let heldResponses: (() => void)[] = [];
let holdNextCreate = false;
let holdQuery = false;
let dispose: (() => void) | undefined;
const originalFetch = globalThis.fetch.bind(globalThis);
const nativeResponse = (value: unknown, status = 200) => new Response(JSON.stringify(encodeCheckpointValue(value)), { status, headers: { "Content-Type": "application/json", [header]: CHECKPOINT_VALUE_ENCODING } });
// Endpoint failures exercise each page's Retry; a 5xx enters the separately
// covered server-readiness recovery loop before a page can show its error.
const failure = (message: string) => new Response(message, { status: 422 });

Object.assign(globalThis, { fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  if (!url.pathname.startsWith("/api/")) return originalFetch(input, init);
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  const raw = typeof init?.body === "string" ? init.body : input instanceof Request ? await input.clone().text() : "";
  const encoding = headers.get(header);
  const value = raw ? decodeCheckpointValue(JSON.parse(raw), encoding) : undefined;
  const requestAccount = account;
  const path = url.pathname.slice(4);
  console.log(`[query-fixture] ${requestAccount} ${method} ${path}`);
  requests.push({ account: requestAccount, path, method, encoding, raw, value });
  if (path === "/query/schema" && method === "GET") {
    if (schemaFailures-- > 0) return failure("fixture schema unavailable");
    return nativeResponse({ entities: Object.fromEntries(["profile", "event"].map(name => [name, {
      fields: [{ name: "label", type: { $ref: "String" } }, { name: "id", type: { $ref: "String" } }], relations: {},
    }])) });
  }
  if (path === "/saved-queries" && method === "GET") {
    if (savedFailures-- > 0) return failure("fixture saved queries unavailable");
    return nativeResponse({ queries: rowsByAccount.get(requestAccount) ?? [], categories: [] });
  }
  if (path === "/saved-queries" && method === "POST") {
    if (encoding !== CHECKPOINT_VALUE_ENCODING) return new Response("Missing native request provenance", { status: 400 });
    const body = value as { name: string; slug: string; query: Record<string, unknown> };
    const result = saved(`created-${++nextId}`, body.name, body.query);
    result.slug = body.slug;
    rowsByAccount.set(requestAccount, [...(rowsByAccount.get(requestAccount) ?? []), result]);
    const response = nativeResponse({ query: result });
    if (holdNextCreate) {
      holdNextCreate = false;
      return new Promise(resolve => heldResponses.push(() => resolve(response)));
    }
    return response;
  }
  if (path.startsWith("/saved-queries/") && method === "DELETE") {
    const id = decodeURIComponent(path.slice("/saved-queries/".length));
    rowsByAccount.set(requestAccount, (rowsByAccount.get(requestAccount) ?? []).filter(entry => entry.id !== id));
    return nativeResponse({ ok: true });
  }
  if (path === "/query" && method === "POST") {
    if (encoding !== CHECKPOINT_VALUE_ENCODING) return new Response("Missing native request provenance", { status: 400 });
    const body = value as { entity: string; filter?: { id?: { values?: unknown[] } } };
    const empty = body.filter?.id?.values?.includes("absent");
    const response = nativeResponse({ rows: empty ? [] : [row()], total: empty ? 0 : 1, meta: { entity: body.entity } });
    if (holdQuery) {
      holdQuery = false;
      return new Promise(resolve => heldResponses.push(() => resolve(response)));
    }
    return response;
  }
  if (path === "/types" && method === "GET") return nativeResponse({ types: [] });
  if (path === "/functions" && method === "GET") return nativeResponse({ functions: [] });
  if (path === "/auth/me") return nativeResponse({ subject: { $tag: "User", accountId: requestAccount, userId: "fixture-user" } });
  unexpected.push(`${method} ${path}`);
  return new Response(`Unconfigured fixture endpoint: ${method} ${path}`, { status: 404 });
} });

function releaseResponses() {
  const pending = heldResponses;
  heldResponses = [];
  for (const release of pending) release();
}

async function renderPage(page: "query" | "data") {
  console.log(`[query-fixture] importing ${page}`);
  const Component = (page === "query" ? await import("../routes/app/query") : await import("../routes/app/data")).default;
  console.log(`[query-fixture] rendering ${page}`);
  const host = document.getElementById("fixture")!;
  host.replaceChildren();
  const FixtureRouter = createRouter({
    history: memoryHistory("/"),
    routes: [{ path: "/", component: Component }],
  });
  dispose = render(() => <Errored fallback={(error) => {
    const value = error();
    componentErrors.push(value instanceof Error ? value.message : String(value));
    return <pre role="alert" data-fixture-error>{String(value)}</pre>;
  }}><Loading fallback={<p data-fixture-loading>Loading page…</p>}>
    <FixtureRouter />
  </Loading></Errored>, host);
  console.log(`[query-fixture] rendered ${page}`);
}

Object.assign(globalThis, { queryPagesFixture: {
  contextClients() {
    const privateClient = createAccountApiClient("context-private");
    const publicClient = createPublicApiClient();
    const observed: Record<string, ApiClient> = {};
    function Capture(props: { name: string }) {
      observed[props.name] = useApiClient();
      return null;
    }
    const stop = render(() => <>
      <Capture name="default" />
      <ApiClientContext value={privateClient}>
        <Capture name="private" />
        <ApiClientContext value={publicClient}><Capture name="public" /></ApiClientContext>
        <Capture name="privateAfter" />
      </ApiClientContext>
      <Capture name="defaultAfter" />
    </>, document.createElement("div"));
    try {
      flush();
      return {
        default: observed.default === defaultApiClient,
        private: observed.private === privateClient,
        public: observed.public === publicClient,
        privateAfter: observed.privateAfter === privateClient,
        defaultAfter: observed.defaultAfter === defaultApiClient,
      };
    } finally { stop(); privateClient.dispose(); publicClient.dispose(); }
  },
  async mount(page: "query" | "data", nextScenario: Scenario = "normal") {
    dispose?.(); dispose = undefined;
    releaseResponses();
    scenario = nextScenario;
    account = "account-a";
    requests = []; unexpected = []; componentErrors = []; nextId = 0;
    rowsByAccount = new Map([[account, defaults(account)], ["account-b", defaults("account-b")]]);
    schemaFailures = scenario === "load-errors" ? 1 : 0;
    savedFailures = scenario === "load-errors" || scenario === "data-load-errors" ? 1 : 0;
    holdNextCreate = scenario === "seed-switch";
    holdQuery = false;
    if (scenario === "seed-switch" || scenario === "data-load-errors") rowsByAccount.set(account, []);
    setBrowserAccountScope(account, true);
    await renderPage(page);
  },
  async remount(page: "query" | "data") { dispose?.(); dispose = undefined; setBrowserAccountScope(account, true); await renderPage(page); },
  switchAccount(next: string) { account = next; setBrowserAccountScope(account, true); },
  holdNextQuery() { holdQuery = true; },
  releaseResponses,
  async settle() { await Promise.resolve(); await Promise.resolve(); await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); },
  state() {
    return {
      account, scenario, held: heldResponses.length, unexpected, componentErrors,
      requests: requests.map(request => ({ ...request,
        // Return observations in a JSON-compatible form so Playwright's
        // serialization is never the feature under test.
        value: undefined,
        query: request.value && typeof request.value === "object" ? JSON.parse(JSON.stringify(encodeCheckpointValue(request.value))) : request.value,
      })),
      saved: [...rowsByAccount].map(([owner, rows]) => ({ owner, rows: JSON.parse(JSON.stringify(encodeCheckpointValue(rows))) })),
    };
  },
  requestChecks() {
    return requests.filter(request => request.method === "POST" && (request.path === "/query" || request.path === "/saved-queries")).map(request => {
      const body = request.value as { query?: Record<string, unknown>; filter?: Record<string, unknown>; entity?: unknown };
      const query = request.path === "/saved-queries" ? body.query : body;
      const label = (query?.filter as { label?: { pattern?: { max?: unknown } } } | undefined)?.label;
      return { account: request.account, path: request.path, encoding: request.encoding, entity: query?.entity,
        unbounded: label?.pattern?.max === Infinity, rawHasNullMax: /"max"\s*:\s*null/.test(request.raw),
      };
    });
  },
} });
