// C1 browser harness: complete production public form hosts and native DOM.
// The isolated Vite config controls domain preparation/rendering seams; Fetch
// responses are held so request races do not depend on network timing.
import { createSignal, Errored, flush, Loading } from "solid-js";
import { render } from "@solidjs/web";
import { createRouter, memoryHistory, useNavigate } from "@solidjs/router";
import type { FieldPersistenceSnapshot } from "@fenel/engine/field-authoring";
import { FenelForm } from "./widget/FenelForm";
import { WIDGET_CSS } from "./widget/styles";
import PublicPage from "../routes/p/[accountSlug]/[pageSlug]";
import "../global.css";

type Host = "widget" | "page";
type Outcome = "success" | "http-error" | "network-error" | "json-error" | "redirect" | "invalid-redirect" | "null-success";
const fieldId = "11111111-1111-4111-8111-111111111111";
const rootTypeName = "submission-fixture-contact";
const snapshot: FieldPersistenceSnapshot = {
  owners: [{ ownerKey: `type:${rootTypeName}`, kind: "type", storageName: rootTypeName,
    definition: { id: rootTypeName, type: { $record: { fields: [{ name: "email",
      key: { $tag: "NamedField", ref: { $ref: fieldId } }, type: { $ref: "String" },
      label: { $tag: "Nothing" }, ui: { $tag: "Nothing" }, meta: {},
    }] } } } }],
  fields: [{ id: fieldId, currentCodeName: "email", status: "live", realm: "account", reuseVisibility: "account" }],
  facets: [
    { fieldId, typeName: "Codeable", methods: { codeName: "email" }, scope: "account", priority: 100 },
    { fieldId, typeName: "Labelable", methods: { label: "Email" }, scope: "account", priority: 100 },
  ],
};
const fieldRegistry = { rootTypeName, snapshot };
const requests: Array<{ path: string; method: string; data: unknown }> = [];
const callbacks: Array<{ kind: "submit" | "error"; value: unknown }> = [];
const errors: string[] = [];
let held: Array<{ resolve: (response: Response) => void; reject: (error: Error) => void }> = [];
let dispose: (() => void) | undefined;
let navigate: ReturnType<typeof useNavigate> | undefined;
let successReentry: HTMLFormElement | undefined;
const [slug, setSlug] = createSignal("alpha");
const [revision, setRevision] = createSignal(0);
const originalFetch = globalThis.fetch.bind(globalThis);

function PageHost() {
  navigate = useNavigate();
  return <PublicPage />;
}

const fixture = {
  mount(host: Host) {
    dispose?.();
    requests.length = 0;
    callbacks.length = 0;
    errors.length = 0;
    held = [];
    navigate = undefined;
    successReentry = undefined;
    setSlug("alpha");
    setRevision(0);
    flush();
    Object.assign(globalThis, { fetch: (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (!url.pathname.startsWith("/api/embed/forms/") && !url.pathname.startsWith("/api/p/fixture/")) return originalFetch(input, init);
      if (init?.method === "POST") {
        requests.push({ path: url.pathname, method: "POST", data: JSON.parse(String(init.body)).data });
        setRevision(value => value + 1);
        return new Promise((resolve, reject) => held.push({ resolve, reject }));
      }
      const currentSlug = url.pathname.split("/").at(-1)!;
      const response = host === "widget" ? { slug: currentSlug, fieldRegistry } : {
        page: { slug: currentSlug, name: "Contact us", config: { thankYouMessage: "Thanks — your message was received." } },
        form: { typeName: rootTypeName, typeRef: rootTypeName, submitLabel: "Send message" }, fieldRegistry,
      };
      return Promise.resolve(Response.json(response));
    } });
    const Router = createRouter({ history: memoryHistory("/p/fixture/alpha"), routes: [
      { path: "/p/:accountSlug/:pageSlug", component: PageHost },
    ] });
    const element = document.getElementById("fixture")!;
    element.replaceChildren();
    dispose = render(() => <>
      <style>{WIDGET_CSS + `
        body { margin: 0; background: #f4f4f6; color: #24252a; font: 16px system-ui, sans-serif; }
        .fixture-heading { max-width: 620px; margin: 38px auto 24px; padding: 0 24px; }
        .fixture-heading h1 { font-size: 25px; margin: 0 0 12px; }
        .fixture-heading p { line-height: 1.5; margin: 8px 0; }
        .fixture-status { border: 1px solid #cfd1d8; border-radius: 9px; background: white; padding: 14px 18px; }
        .fixture-form { padding: 28px 24px; background: white; border: 1px solid #dddfe4; border-radius: 12px; max-width: 540px; margin: 0 auto; }
        .fixture-form .public-page-wrap { min-height: 0; padding: 0; background: white; }
        .fixture-form .public-page-card { box-shadow: none; padding: 0; margin: 0 auto; width: 100%; }
        @media (max-width: 600px) { .fixture-heading { margin-top: 24px; padding: 0 18px; } .fixture-form { margin: 0 16px; padding: 24px 18px; } }
      `}</style>
      <header class="fixture-heading">
        <h1>{host === "widget" ? "Embedded form" : "Published form"}</h1>
        <p>Two submit events are dispatched together while the server response is held.</p>
        <div class="fixture-status" data-request-summary>
          {revision()} POST request{revision() === 1 ? "" : "s"} · Form {slug()}
        </div>
      </header>
      <main class="fixture-form"><Errored fallback={error => {
        errors.push(String(error()));
        return <pre data-fixture-error>{String(error())}</pre>;
      }}><Loading fallback={<p>Loading form…</p>}>
        {host === "widget" ? <FenelForm apiUrl="/api" accountId="fixture-account" formSlug={slug()}
          submitLabel="Send message" onSubmit={value => {
            callbacks.push({ kind: "submit", value });
            const form = successReentry;
            successReentry = undefined;
            form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
            queueMicrotask(() => form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
          }}
          onError={value => callbacks.push({ kind: "error", value })} /> : <Router />}
      </Loading></Errored></main>
    </>, element);
  },
  async switchTo(next: "alpha" | "beta") {
    setSlug(next);
    if (navigate) await navigate(`/p/fixture/${next}`);
    flush();
  },
  submitTwice() {
    const form = document.querySelector("form")!;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  },
  armSuccessReentry() { successReentry = document.querySelector("form")!; },
  release(index = 0, outcome: Outcome = "success") {
    const [response] = held.splice(index, 1);
    if (!response) throw new Error(`No held response at ${index}`);
    if (outcome === "network-error") response.reject(new Error("Fixture network error. Please retry."));
    else if (outcome === "json-error") response.resolve(new Response("not-json", { headers: { "Content-Type": "application/json" } }));
    else if (outcome === "http-error") response.resolve(Response.json({ error: "Please retry your submission." }, { status: 422 }));
    else if (outcome === "redirect") response.resolve(Response.json({ redirect: "/fixture-stale-navigation" }));
    else if (outcome === "invalid-redirect") response.resolve(Response.json({ redirect: "http://[" }));
    else if (outcome === "null-success") response.resolve(Response.json(null));
    else response.resolve(Response.json({ message: "Received" }));
  },
  state: () => ({ requests: [...requests], callbacks: [...callbacks], errors: [...errors], held: held.length }),
  unmount() { dispose?.(); dispose = undefined; },
  restore() { fixture.unmount(); globalThis.fetch = originalFetch; },
};

declare global { var formSubmissionFixture: typeof fixture; }
globalThis.formSubmissionFixture = fixture;
