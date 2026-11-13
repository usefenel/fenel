import { describe, expect, spyOn, test } from "bun:test";
import { CHECKPOINT_VALUE_ENCODING, decodeCheckpointValue, encodeCheckpointValue } from "@fenel/engine/checkpoint-json";
import { ApiConnectionError, ApiResponseError } from "./api-read-recovery";

// Execute production transport and method closures without instantiating the
// router or account registry. Fetch/session notifications are the only host IO.
const source = await Bun.file(new URL("./api.ts", import.meta.url)).text();
const prefixStart = source.indexOf('const API_BASE = ');
if (prefixStart < 0 || !source.includes("function createEndpointClient(")) throw new Error("Production API transport boundaries changed");
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(
  source.slice(prefixStart).replace(/^export /gm, "").replace('import("./authoring-json")', "loadAuthoringJsonModule()")
    .replace('import("./account-field-registry")', "loadAccountFieldRegistryModule()"),
);
const homeSource = (await Bun.file(new URL("../routes/app/home.tsx", import.meta.url)).text()).replace(/\r\n/g, "\n");
const homeStart = homeSource.indexOf("function useHomeReader()");
const homeEnd = homeSource.indexOf("\n}\n", homeStart) + 3;
if (homeStart < 0 || homeEnd <= homeStart) throw new Error("Home reader lifecycle boundary changed");
// Refresh-only C1 controls have no synchronization provider; memos remain
// callbacks, as in the sibling Home source fixtures. No authoring frame is read.
const homeReader = new Function("useLocusSynchronization", "createMemo", "useReaderRuntime", "useApiClient", "reloadUserRegistries", "persistRepresentations",
  `${new Bun.Transpiler({ loader: "ts" }).transformSync(homeSource.slice(homeStart, homeEnd))}; return useHomeReader();`).bind(undefined, () => undefined, (compute: () => unknown) => compute);
function homeRefresh(client: import("./api").ApiClient, reload: () => Promise<void>, kind?: "account" | "local") {
  return homeReader(() => kind ? { kind, reload } : undefined, () => client, reload).reloadUserRegistries as
    (result?: unknown) => Promise<void>;
}
const header = "X-Fenel-Value-Encoding";
const marker = encodeCheckpointValue(Infinity);
const native = {
  bytes: Uint8Array.of(0, 128, 255),
  type: { $refined: { base: { $ref: "String" }, set: { $tag: "SePattern", pattern: { t: "rep", min: 0, max: Infinity, child: { t: "eps" } } } } },
  nan: NaN,
  negativeZero: -0,
  business: marker,
};
function response(value: unknown, encoding: string | null = CHECKPOINT_VALUE_ENCODING): Response {
  return new Response(JSON.stringify(value), { headers: encoding === null ? {} : { [header]: encoding } });
}
function harness(reply: (path: string, init: RequestInit) => Response | Promise<Response>, account?: string,
  recover: (read: () => Promise<unknown>) => Promise<unknown> = read => read()) {
  const requests: { path: string; init: RequestInit }[] = [];
  let mutations = 0;
  let accountChanges = 0;
  let epoch = 1;
  const fieldRegistryLoads: string[] = [];
  const sessionListeners = new Set<() => void>();
  const queryCache = new Map<string, unknown>();
  const routerQuery = Object.assign((fn: (...args: any[]) => unknown, name: string) => {
    const keyFor = (...args: unknown[]) => JSON.stringify([name, ...args]);
    return Object.assign((...args: unknown[]) => {
      const key = keyFor(...args);
      if (!queryCache.has(key)) queryCache.set(key, fn(...args));
      return queryCache.get(key);
    }, { key: name, keyFor });
  }, { clear: () => queryCache.clear() });
  const scope = {
    bindCoreAuthoringOwner: () => {}, discardEarlyAuthoringRealm: () => {}, repositoryAuthoringRealmOwner: () => Object.freeze({}),
    CHECKPOINT_VALUE_ENCODING, encodeCheckpointValue, decodeCheckpointValue, ApiConnectionError, ApiResponseError,
    fetch: async (path: string, init: RequestInit) => { requests.push({ path, init }); return reply(path, init); },
    sessionEpoch: () => epoch,
    // This suite models resolved sessions; boot-cookie ingress is a separate seam.
    inBootFrame: () => false,
    assertCurrentSession: (captured: number) => { if (captured !== epoch) throw new Error("Stale test session"); },
    expireBrowserSession: () => {},
    notifyApiMutation: () => { mutations++; },
    onBrowserSessionChange: (listener: () => void) => { sessionListeners.add(listener); return () => sessionListeners.delete(listener); },
    browserAccountScope: () => account,
    setBrowserAccountScope: (next: string | undefined) => { account = next; },
    reportAccountChangedElsewhere: () => { accountChanges++; },
    routerQuery, routerRevalidate: () => {}, isServer: false,
    createContext: (value: unknown) => value, useContext: (value: unknown) => value,
    recoveringReads: new Map(), publishReadConnectionStatus: () => {},
    recoverApiRead: recover,
    loadAuthoringJsonModule: async () => ({ viewRowFromJsonWire: (row: unknown) => row,
      stringifyAuthoringJson: JSON.stringify, definitionBundleToJsonWire: (value: unknown) => value,
      fenelTypeToJsonWire: (value: unknown) => value,
      fieldDefinitionSnapshotFromJsonWire: (value: unknown) => value }),
    loadAccountFieldRegistryModule: async () => ({
      reloadAccountFieldRegistry: async (id: string) => { fieldRegistryLoads.push(id); },
      StaleAccountFieldRegistryLoadError: class extends Error {},
    }),
  };
  const factory = new Function(...Object.keys(scope), `${code}; return { api, apiFetch, defaultApiClient, AccountChangedError, createAccountApiClient, createPublicApiClient };`);
  const production = factory(...Object.values(scope)) as Pick<typeof import("./api"), "api" | "apiFetch" | "defaultApiClient" | "AccountChangedError" | "createAccountApiClient" | "createPublicApiClient">;
  return { ...production, requests, fieldRegistryLoads, mutations: () => mutations, accountChanges: () => accountChanges,
    account: () => account, nextSession: () => { epoch++; for (const listener of sessionListeners) listener(); } };
}

describe("definition save refresh completion", () => {
  const bundle = { ownerMutations: [] };
  const reply = () => response({ snapshot: { owners: [], fields: [], facets: [] } }, null);

  test("Home reuses this exact reader's successful post-commit refresh", async () => {
    const h = harness(reply, "legacy");
    let refreshes = 0;
    const reload = async () => { refreshes++; };
    const client = h.createAccountApiClient("account-a", { onDefinitionsChanged: reload });
    const committed = await client.api.definitionBundleSave(bundle);
    await homeRefresh(client, reload, "account")(committed);
    expect(refreshes).toBe(1);
    expect(client.didRefreshDefinitions(committed)).toBe(true);
    expect(h.requests).toHaveLength(1);
    expect(new Headers(h.requests[0]!.init.headers).get("X-Fenel-Reader-Account")).toBe("account-a");
    client.dispose();
  });

  test("a failed first refresh keeps the committed save and Home retries once", async () => {
    const h = harness(reply);
    let refreshes = 0;
    const reload = async () => { if (++refreshes === 1) throw new Error("Snapshot unavailable"); };
    const client = h.createAccountApiClient("account-a", { onDefinitionsChanged: reload });
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      const committed = await client.api.definitionBundleSave(bundle);
      expect(client.didRefreshDefinitions(committed)).toBe(false);
      await homeRefresh(client, reload, "account")(committed);
      expect(refreshes).toBe(2);
      expect(h.requests).toHaveLength(1);
      expect(log).toHaveBeenCalledTimes(1);
    } finally { log.mockRestore(); client.dispose(); }
  });

  test("default-client saves still refresh the separate function roster", async () => {
    const h = harness(reply, "account-a");
    let rosterRefreshes = 0;
    const committed = await h.api.definitionBundleSave(bundle);
    await homeRefresh(h.defaultApiClient, async () => { rosterRefreshes++; })(committed);
    expect(h.fieldRegistryLoads).toEqual(["account-a"]);
    expect(rosterRefreshes).toBe(1);
    expect(h.defaultApiClient.didRefreshDefinitions(committed)).toBe(false);
  });

  test("another reader of the same account cannot consume the completion", async () => {
    const h = harness(reply);
    const a = h.createAccountApiClient("account-a", { onDefinitionsChanged: async () => {} });
    const b = h.createAccountApiClient("account-a", { onDefinitionsChanged: async () => {} });
    const committed = await a.api.definitionBundleSave(bundle);
    let refreshes = 0;
    await homeRefresh(b, async () => { refreshes++; }, "account")(committed);
    expect(a.didRefreshDefinitions(committed)).toBe(true);
    expect(b.didRefreshDefinitions(committed)).toBe(false);
    expect(refreshes).toBe(1);
    a.dispose(); b.dispose();
  });

  test("failed representation metadata refresh revokes completion and keeps Home's retry", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const operation of ["create", "update", "delete"] as const) {
        const h = harness(reply);
        let refreshes = 0;
        const reload = async () => { refreshes++; };
        const client = h.createAccountApiClient("account-a", { onDefinitionsChanged: reload,
          onMetadataChanged: async () => { throw new Error("Metadata unavailable"); } });
        const committed = await client.api.definitionBundleSave(bundle);
        expect(client.didRefreshDefinitions(committed)).toBe(true);
        const instance = { typeName: "Labelable", args: ["identity"], methods: { label: "Example" } };
        if (operation === "create") await client.api.dispatchInstanceCreate({ typeName: instance.typeName, args: instance.args, instance });
        else if (operation === "update") await client.api.dispatchInstanceUpdate("representation", instance);
        else await client.api.dispatchInstanceDelete("representation");
        expect(client.didRefreshDefinitions(committed)).toBe(false);
        await homeRefresh(client, reload, "account")(committed);
        expect(refreshes).toBe(2);
        expect(h.requests).toHaveLength(2);
        client.dispose();
      }
      expect(log).toHaveBeenCalledTimes(3);
    } finally { log.mockRestore(); }
  });

  test("successful metadata refresh retains a completed definition refresh", async () => {
    const h = harness(reply);
    let refreshes = 0;
    let metadataRefreshes = 0;
    const reload = async () => { refreshes++; };
    const client = h.createAccountApiClient("account-a", { onDefinitionsChanged: reload,
      onMetadataChanged: async () => { metadataRefreshes++; } });
    const committed = await client.api.definitionBundleSave(bundle);
    await client.api.dispatchInstanceDelete("representation");
    await homeRefresh(client, reload, "account")(committed);
    expect(client.didRefreshDefinitions(committed)).toBe(true);
    expect(refreshes).toBe(1);
    expect(metadataRefreshes).toBe(1);
    client.dispose();
  });

  test("a changed epoch or closed reader cannot reuse a completed refresh", async () => {
    for (const close of [false, true]) {
      const h = harness(reply);
      const client = h.createAccountApiClient("account-a", { onDefinitionsChanged: async () => {} });
      const committed = await client.api.definitionBundleSave(bundle);
      let retries = 0;
      if (close) client.dispose(); else h.nextSession();
      expect(() => homeRefresh(client, async () => { retries++; }, "account")(committed)).toThrow();
      expect(retries).toBe(0);
      client.dispose();
    }
  });

  test("closing during the callback rejects its late acknowledgement", async () => {
    let start!: () => void;
    let finish!: () => void;
    const started = new Promise<void>(resolve => { start = resolve; });
    const finishing = new Promise<void>(resolve => { finish = resolve; });
    const h = harness(reply);
    const client = h.createAccountApiClient("account-a", { onDefinitionsChanged: async () => { start(); await finishing; } });
    const pending = client.api.definitionBundleSave(bundle);
    await started;
    client.dispose(); finish();
    await expect(pending).rejects.toThrow("reader was closed");
    expect(h.requests).toHaveLength(1);
  });

  test("Home representation batches keep the captured client and current reader registry", async () => {
    const h = harness(reply);
    const client = h.createAccountApiClient("account-a");
    const registry = {};
    const representations = { Labelable: { label: "Example" }, Iconable: { icon: "star" } };
    const writes: unknown[][] = [];
    const reader = { kind: "account", registry: () => registry };
    const home = homeReader(() => reader, () => client, async () => {}, async (...args: unknown[]) => { writes.push(args); });
    const canContinue = () => true;
    await home.persistRepresentations("identity", representations, canContinue);
    expect(writes).toEqual([["identity", representations, undefined, client, registry, canContinue]]);
    client.dispose();
  });
});

describe("a request states the account its tab was rendered for", () => {
  test("the bound account travels as a header, and no header is sent without one", async () => {
    const bound = harness(() => response({ ok: true }, null), "account-a");
    await bound.apiFetch("/stats");
    expect(new Headers(bound.requests[0]!.init.headers).get("X-Fenel-Account")).toBe("account-a");
    const unbound = harness(() => response({ ok: true }, null));
    await unbound.apiFetch("/stats");
    expect(new Headers(unbound.requests[0]!.init.headers).has("X-Fenel-Account")).toBe(false);
  });

  test("a refusal for another account reports it and is not an ordinary conflict", async () => {
    const h = harness(() => new Response(JSON.stringify({ error: "changed", code: "account-changed" }), { status: 409 }), "account-a");
    await expect(h.apiFetch("/locus-root")).rejects.toBeInstanceOf(h.AccountChangedError);
    expect(h.accountChanges()).toBe(1);
    const conflict = harness(() => new Response(JSON.stringify({ error: "revision" }), { status: 409 }), "account-a");
    await expect(conflict.apiFetch("/locus-root")).rejects.toBeInstanceOf(ApiResponseError);
    expect(conflict.accountChanges()).toBe(0);
  });
});

describe("simultaneous account readers", () => {
  test("a transient views failure recovers before reader preparation can fail", async () => {
    let attempts = 0;
    let recoveryCalls = 0;
    const h = harness(() => ++attempts === 1
      ? new Response("temporarily busy", { status: 503 }) : response({ views: [] }, null),
    "account-a", async read => {
      recoveryCalls++;
      try { return await read(); }
      catch (error) {
        if (!(error instanceof ApiResponseError) || error.status !== 503) throw error;
        return read();
      }
    });
    const client = h.createAccountApiClient("account-a");
    expect(await client.getViews.uncached()).toEqual({ views: [] });
    expect(recoveryCalls).toBe(1);
    expect(h.requests.map(request => request.path)).toEqual(["/api/views", "/api/views"]);
    expect(h.requests.every(request => new Headers(request.init.headers).get("X-Fenel-Reader-Account") === "account-a")).toBe(true);
    client.dispose();
  });

  test("the same query stays partitioned by reader and cannot change the legacy account", async () => {
    const h = harness((_path, init) => response({ root: { id: new Headers(init.headers).get("X-Fenel-Reader-Account") } }, null), "legacy");
    const a = h.createAccountApiClient("account-a");
    const b = h.createAccountApiClient("account-b");
    const [left, right] = await Promise.all([a.getLocusRoot(), b.getLocusRoot()]);
    expect(left.root.id).toBe("account-a");
    expect(right.root.id).toBe("account-b");
    expect(a.getLocusRoot.keyFor()).not.toBe(b.getLocusRoot.keyFor());
    await Promise.all([a.getLocusRoot(), b.getLocusRoot()]);
    expect(h.requests).toHaveLength(2);
    expect(h.account()).toBe("legacy");
    expect(h.requests.every((request) => !new Headers(request.init.headers).has("X-Fenel-Account"))).toBe(true);
    await a.apiFetch("/stats", { headers: { "X-Fenel-Reader-Account": "account-b", "X-Fenel-Account": "legacy" } });
    expect(new Headers(h.requests[2]!.init.headers).get("X-Fenel-Reader-Account")).toBe("account-a");
    a.dispose(); b.dispose();
  });

  test("a denied reader never retries through the default account", async () => {
    const h = harness(() => new Response("Not a member", { status: 403 }), "legacy");
    const client = h.createAccountApiClient("revoked");
    await expect(client.apiFetch("/locus-root")).rejects.toBeInstanceOf(ApiResponseError);
    expect(h.requests).toHaveLength(1);
    expect(h.accountChanges()).toBe(0);
    expect(h.account()).toBe("legacy");
    client.dispose();
  });

  test("public readers cannot fall through to an authenticated HTTP client", async () => {
    const h = harness(() => response({ private: true }, null), "legacy");
    const client = h.createPublicApiClient();
    await expect(client.apiRead("/locus-root")).rejects.toThrow("account reader");
    await expect(client.api.savedQueryDelete("private-value")).rejects.toThrow("account reader");
    expect(h.requests).toHaveLength(0);
    client.dispose();
  });

  test("a new login cannot reuse the same account's cached queries", async () => {
    const h = harness(() => response({ root: {} }, null));
    const previous = h.createAccountApiClient("account-a");
    await previous.getLocusRoot();
    h.nextSession();
    const next = h.createAccountApiClient("account-a");
    expect(previous.getLocusRoot.keyFor()).not.toBe(next.getLocusRoot.keyFor());
    expect(() => previous.getLocusRoot()).toThrow("Stale test session");
    await next.getLocusRoot();
    expect(h.requests).toHaveLength(2);
    previous.dispose(); next.dispose();
  });

  test("late replies and closed-reader cache hits cannot publish", async () => {
    let finish!: (value: Response) => void;
    const h = harness(() => new Promise<Response>((resolve) => { finish = resolve; }));
    const client = h.createAccountApiClient("account-a");
    const pending = client.apiFetch("/locus-root");
    h.nextSession();
    finish(response({ root: { private: "old login" } }, null));
    await expect(pending).rejects.toThrow("Stale test session");
    client.dispose();

    const closed = harness(() => response({ root: {} }, null)).createAccountApiClient("account-a");
    await closed.getLocusRoot();
    closed.dispose();
    expect(() => closed.getLocusRoot()).toThrow("reader was closed");
  });
});

describe("production frontend native JSON boundary", () => {
  test("flagged responses restore native atoms and escaped business records exactly once", async () => {
    const h = harness(() => response(encodeCheckpointValue({ value: native })));
    const result = await h.apiFetch<{ value: typeof native }>("/native-result");
    expect(result.value).toEqual(native);
    expect(result.value.bytes).toBeInstanceOf(Uint8Array);
    expect(result.value.type.$refined.set.pattern.max).toBe(Infinity);
    expect(Number.isNaN(result.value.nan)).toBe(true);
    expect(Object.is(result.value.negativeZero, -0)).toBe(true);
    expect(result.value.business).toEqual(marker);
    expect(h.requests[0]!.init.credentials).toBe("include");
    expect(h.mutations()).toBe(0);
  });

  test("legacy responses stay raw and an unknown encoding fails explicitly", async () => {
    const legacy = { value: marker, bytes: [0, 255], type: { pattern: { max: "unbounded" } } };
    const h = harness(() => response(legacy, null));
    expect(await h.apiFetch<typeof legacy>("/legacy-result")).toEqual(legacy);
    const unknown = harness(() => response({ value: marker }, "fenel-checkpoint-json-v999"));
    await expect(unknown.apiFetch("/unknown-result")).rejects.toThrow("Unsupported checkpoint encoding");
    expect(unknown.mutations()).toBe(0);
  });

  test("run, stop, prompt resolution and instance listing transmit native arguments with provenance", async () => {
    const reply = { ok: true, value: native };
    const h = harness(() => response(encodeCheckpointValue(reply)));
    const cases: [() => Promise<unknown>, string, unknown, ("POST" | "PUT")?][] = [
      [() => h.api.functionRun("fixture", "profile", native), "/api/functions/fixture/run", { profileId: "profile", payload: native }],
      [() => h.api.invokeIOAction("fixture:fn", [native], "run"), "/api/io/invoke", { fnId: "fixture:fn", args: [native], mode: "run" }],
      [() => h.api.invokeIOAction("fixture:fn", [native], "stop"), "/api/io/invoke", { fnId: "fixture:fn", args: [native], mode: "stop" }],
      [() => h.api.resolveAwaitingPrompt("instance / 1", native, "suspension"), "/api/io/awaiting/instance%20%2F%201/resolve", { value: native, suspensionId: "suspension" }],
      [() => h.api.getIOInstances("fixture:fn", [native]), "/api/io/instances", { fnId: "fixture:fn", args: [native] }],
      [() => h.api.functionRun("fixture", "profile"), "/api/functions/fixture/run", { profileId: "profile" }],
      [() => h.api.runRecordQuery({ entity: "profile", filter: { name: native.type.$refined.set } }), "/api/query", { entity: "profile", filter: { name: native.type.$refined.set } }],
      [() => h.api.runCompareQuery({ current: native, previous: native }), "/api/query/compare", { current: native, previous: native }],
      [() => h.api.runFunnelQuery({ steps: [native] }), "/api/query/funnel", { steps: [native] }],
      [() => h.api.savedQueryCreate({ slug: "native", name: "Native", query: native }), "/api/saved-queries", { slug: "native", name: "Native", query: native }],
      [() => h.api.savedQueryUpdate("native", { query: native }), "/api/saved-queries/native", { query: native }, "PUT"],
    ];
    for (const [call, path, expected, method = "POST"] of cases) {
      expect(await call()).toEqual(reply);
      const request = h.requests.at(-1)!;
      expect(request.path).toBe(path);
      expect(request.init.method).toBe(method);
      const headers = new Headers(request.init.headers);
      expect(headers.get(header)).toBe(CHECKPOINT_VALUE_ENCODING);
      expect(headers.get("Content-Type")).toBe("application/json");
      expect(typeof request.init.body).toBe("string");
      const parsed = JSON.parse(request.init.body as string);
      expect(decodeCheckpointValue(parsed, headers.get(header))).toEqual(expected);
    }
    expect(h.mutations()).toBe(cases.length);
  });
});
