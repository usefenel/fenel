// Exercises the actual Home renderer and persistence path against in-memory IO.
import { Errored, Loading, flush } from "solid-js";
import { render } from "@solidjs/web";
import { createRouter, memoryHistory } from "@solidjs/router";
import { CHECKPOINT_VALUE_ENCODING, decodeCheckpointValue, encodeCheckpointValue } from "@fenel/engine/checkpoint-json";
import { ensureAccountFieldRegistryLoaded } from "../account-field-registry";
import { setBrowserAccountScope } from "../browser-session";
import { _setSubject } from "../auth";
import { prepareCommittedAuthoringSession, accountAuthoringSession } from "../expression-runner/authoring-session";
import { userFunctions } from "../user-registries";
import { evaluateAuthoringExpression } from "../expression-runner";
import { inferAuthoringExpression } from "@fenel/engine/authoring/expression";
import { transferContainerShape, adaptTransferToTarget, typeForTransfer } from "./expressions";
import { itemFromText } from "./index";
import WorkspaceAuthoringProvider from "../workspace-authoring-provider";
import HomePage from "../../routes/app/home";
import "../../routes/app.css";
import "../../global.css";

const account = "data-transfer-fixture";
let home: { id: string; name: string; active: boolean; view: { kind: string; items: any[] } };
const saved: any[] = [];
const errors: string[] = [];
const writes: string[] = [];
let holdSavedWrites = false;
let releaseSavedWrites: (() => void)[] = [];
let dispose: (() => void) | undefined;
let ready = false;
const originalFetch = globalThis.fetch.bind(globalThis);
const response = (body: unknown) => Response.json(encodeCheckpointValue(body), {
  headers: { "X-Fenel-Value-Encoding": CHECKPOINT_VALUE_ENCODING },
});

const fixture = {
  async mount(items: any[] = [], savedValues?: any[]) {
    dispose?.(); errors.length = 0; writes.length = 0;
    holdSavedWrites = false;
    for (const release of releaseSavedWrites.splice(0)) release();
    saved.splice(0, saved.length, ...(savedValues ?? [{ id: "transfer-saved-number", name: "Saved seven",
      query: { kind: "expression", expr: { kind: "literal", value: 7 } } }]));
    home = { id: "transfer-home", name: "Clipboard view", active: true, view: { kind: "canvas", items } };
    Object.assign(globalThis, { fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (!url.pathname.startsWith("/api/")) return originalFetch(input, init);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (method !== "GET") {
        writes.push(`${method} ${url.pathname}`);
        const body = typeof init?.body === "string" ? decodeCheckpointValue(JSON.parse(init.body), CHECKPOINT_VALUE_ENCODING) as any : {};
        if (method === "PUT" && url.pathname === `/api/locus-views/${home.id}`) {
          home = { ...home, ...body }; return response({ locusView: home });
        }
        if (method === "PUT" && url.pathname.startsWith("/api/saved-queries/")) {
          if (holdSavedWrites) await new Promise<void>((resolve) => releaseSavedWrites.push(resolve));
          const id = decodeURIComponent(url.pathname.slice("/api/saved-queries/".length));
          const index = saved.findIndex((row) => row.id === id);
          if (index < 0) return new Response("Saved value not found", { status: 404 });
          saved[index] = { ...saved[index], ...body };
          return response({ query: saved[index] });
        }
        return new Response(`Unexpected fixture write ${method} ${url.pathname}`, { status: 500 });
      }
      if (url.pathname === "/api/locus-views") return response({ locusViews: [home] });
      if (url.pathname === "/api/locus-views/active") return response({ locusView: home });
      if (url.pathname === "/api/saved-queries") return response({ queries: saved, categories: [] });
      if (url.pathname === "/api/types") return response({ types: [] });
      if (url.pathname === "/api/functions") return response({ functions: [] });
      if (url.pathname === "/api/views") return response({ views: [] });
      if (url.pathname === "/api/modules/installed") return response({ modules: [] });
      return response({ fields: [], instances: [], rows: [] });
    } });
    if (!ready) {
      _setSubject({ $tag: "User", accountId: account, userId: "fixture-user" });
      setBrowserAccountScope(account, true);
      const snapshot = { owners: [], fields: [], facets: [] };
      const registry = await ensureAccountFieldRegistryLoaded(account, { load: async () => snapshot });
      await prepareCommittedAuthoringSession(registry, account, snapshot, []);
      ready = true;
    }
    const { revalidate } = await import("@solidjs/router");
    revalidate(["locusViews", "activeLocusView", "savedQueries"]);
    flush();
    const Router = createRouter({ history: memoryHistory("/"), routes: [{ path: "/", component: HomePage }] });
    const host = document.getElementById("fixture")!;
    host.replaceChildren();
    dispose = render(() => <Errored fallback={(error) => {
      errors.push(String(error()));
      return <pre data-fixture-error>{String(error())}</pre>;
    }}><Loading fallback={<p>Loading test view…</p>}><WorkspaceAuthoringProvider><Router /></WorkspaceAuthoringProvider></Loading></Errored>, host);
  },
  state: () => ({ home: structuredClone(home), saved: structuredClone(saved), errors: [...errors], writes: [...writes], pendingSavedWrites: releaseSavedWrites.length }),
  pauseSavedWrites() { holdSavedWrites = true; },
  resumeSavedWrites() { holdSavedWrites = false; for (const release of releaseSavedWrites.splice(0)) release(); },
  diagnostics(index: number) {
    const item = home.view.items[index];
    const session = accountAuthoringSession({ accountId: account, functions: userFunctions() });
    const expr = item?.source?.expr;
    const value = evaluateAuthoringExpression(expr, undefined, session).result;
    const options = { registry: session.registry, evaluateContext: session.evaluateContext };
    const inferred = inferAuthoringExpression(expr, session.environment);
    const type = item.valueType ?? typeForTransfer({ value, typeName: "List", source: "fenel" }, session.environment, options);
    return { stored: item, value, inferred, type,
      shape: type ? transferContainerShape(type, session.environment, session.evaluateContext) : undefined,
      next: adaptTransferToTarget([itemFromText("3")], { type, currentValue: value, environment: session.environment, ...options }),
    };
  },
  unmount() { dispose?.(); dispose = undefined; },
};
declare global { var transferFixture: typeof fixture; }
globalThis.transferFixture = fixture;
