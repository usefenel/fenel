import { For, createMemo, createSignal } from "solid-js";
import { render } from "@solidjs/web";
import { evaluate, printFenel, type FenelModule, type FenelType } from "@fenel/engine";
import { loadFenelModule } from "../../../../../../implementations/typescript/engine/src/fenel-module";
import { stdModule } from "@fenel/engine/modules/std";
import { createRegistry } from "@fenel/engine/registry";
import { createAuthoringEnvironment } from "@fenel/engine/authoring/environment";
import { prepareEngineBodyDispatch } from "@fenel/engine/engine-bodies-dispatch";
import { Bool, Nat, Nothing, Rational, Str } from "@fenel/engine/type-foundation";
import { createDetachedAuthoringEnvironment } from "../expression-runner/detached-authoring-environment";
import { AuthoringSessionContext, type AuthoringSession } from "../expression-runner/authoring-session";
import { ReaderRuntimeContext, type ReaderRuntime } from "../reader-runtime";
import { createReaderPresentation } from "../reader-presentation";
import { createReaderTemplateRegistry } from "../web-template-registry";
import { ApiClientContext, defaultApiClient, type ApiClient } from "../api";
import { FieldRenderer } from "../field-renderer";
import { TypedReadValue } from "../layout-renderer/TypedReadValue";
import { DataValueSurface } from "../data-transfer/DataValueSurface";
import SOURCE from "../../../../../../fenel/modules/std/document.fenel?raw";
import DEMO from "../../../../../../fenel/modules/publicdemo/document-demo.fenel?raw";
import INSTANCES from "../../../../../../fenel/modules/std/document-instances.fenel?raw";
import EMAIL from "../../../../../../fenel/modules/email/email.fenel?raw";
import "../../global.css";
import "../../routes/app.css";

// C2 fixture: the real canonical type, source and universal renderer. The only
// external facts supplied are the already-authorized reader and field catalog.
async function start() {
  await prepareEngineBodyDispatch();
  const documentModule = loadFenelModule(SOURCE, "std");
  const std: FenelModule = { ...stdModule,
    functions: [...(stdModule.functions ?? []).filter(fn => !(documentModule.functions ?? []).some(other => other.id === fn.id)), ...(documentModule.functions ?? [])],
    entities: [...(stdModule.entities ?? []).filter(entity => !documentModule.entities?.some(other => other.id === entity.id)), ...(documentModule.entities ?? [])],
    instances: [...(stdModule.instances ?? []), ...(loadFenelModule(INSTANCES, "std", { dispatchInstanceFile: true }).instances ?? [])],
  };
  const email = loadFenelModule(EMAIL, "email");
  const registry = createRegistry([std, { ...email, functions: email.functions?.filter(fn =>
    ["email:address", "email:formatAddress", "email:bodyText"].includes(fn.id)) }, loadFenelModule(DEMO, "DocumentDemo")]);
  const types = [...Object.entries({ String: Str, Number: Rational, Nat, Boolean: Bool }).map(([name, type]) => ({ id: name, name, type })),
    ...[...(documentModule.entities ?? []), ...(email.entities ?? [])].map(entity => ({ id: entity.id, name: entity.id, type: entity.type }))]
    .map(entry => ({ ...entry, description: "", category: "fixture" }));
  const environment = createDetachedAuthoringEnvironment(createAuthoringEnvironment({ types, capabilities: [],
    catalogTypes: types.map(entry => entry.type), functions: [], operatorCodeNameByNotation: new Map() }));
  const session: AuthoringSession = { mode: "detached", registry, environment, catalog: environment.catalog,
    evaluateContext: registry.evaluateContext() };
  const presentation = createReaderPresentation(() => ({ registry, session, catalog: [] }));
  const templates = createReaderTemplateRegistry([{ name: "rich-document", display: Nothing, readComponent: "rich-document" }]);
  const reader = { session: () => session, registry: () => registry, templates: () => templates,
    representation: presentation.representation } as ReaderRuntime;
  const sample = evaluate({ call: ["DocumentDemo:documentSample"] }, {}, session.evaluateContext);
  const [value, setValue] = createSignal(sample);
  const story = new URL(location.href).searchParams.get("story") === "email";
  const mailFn = registry.getFunction("DocumentDemo:composeDocumentEmail")!;
  const starting = story ? (evaluate({ call: ["DocumentDemo:documentDemoStartingInputs"] }, {}, session.evaluateContext) as
    Array<{ function: { $ref: string }; arguments: unknown[] }>).find(row => row.function.$ref === mailFn.id)!.arguments : [];
  const [mailInputs, setMailInputs] = createSignal(starting.slice(0, 3));
  const outline = createMemo(() => evaluate({ call: ["std:documentOutline", value()] }, {}, session.evaluateContext));
  const plainText = createMemo(() => evaluate({ call: ["std:documentPlainText", value()] }, {}, session.evaluateContext));
  const mail = createMemo(() => evaluate({ call: [mailFn.id, ...mailInputs(), value()] }, {}, session.evaluateContext));
  const mailPreview = createMemo(() => evaluate({ call: ["DocumentDemo:previewDocumentEmail", ...mailInputs(), value()] }, {}, session.evaluateContext));
  const client: ApiClient = { ...defaultApiClient,
    getFieldAuthoringCatalog: async () => ({ fields: [], facetInterfaceNames: [] }),
    getFieldAuthoringIdentity: async () => ({ field: null }),
  };
  const type = { $ref: "RichDocument" } as FenelType;
  render(() => <ApiClientContext value={client}><AuthoringSessionContext value={session}><ReaderRuntimeContext value={reader}>
    <main style="max-width:1180px;padding:24px;margin:auto;min-width:0">
      <h1>Document · one typed tree</h1>
      <p class="text-muted">Change its ordinary typed data. Source and preview follow the same document.</p>
      <details data-document-editor><summary>Edit document with the shared field editor</summary>
        <FieldRenderer identityMode="transient" field={{ name: "document", type, label: Nothing, ui: Nothing, meta: {} }}
          value={value()} onChange={next => setValue(() => next)} />
      </details>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:24px;margin-top:20px">
        <section data-document-source><h2>Fenel source</h2><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;border:1px solid #ddd;border-radius:8px;padding:12px">{printFenel(value() as never)}</pre></section>
        <section data-document-preview><h2>Preview</h2><TypedReadValue value={value()} type={type} /></section>
      </div>
      {story && <section data-document-story>
        <h2>Functions of the same document</h2>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:24px">
          <section data-document-outline style="min-width:0"><h3>Outline</h3><DataValueSurface value={outline()} type={registry.getFunction("std:documentOutline")!.returns} label="Outline" session={() => session}
            presentation={<TypedReadValue templateOnly value={outline()} type={registry.getFunction("std:documentOutline")!.returns} />} /></section>
          <section data-document-text style="min-width:0"><h3>Plain text</h3><DataValueSurface value={plainText()} type={Str} label="Plain text" session={() => session}
            presentation={<TypedReadValue templateOnly value={plainText()} type={Str} />} /></section>
        </div>
        <details data-document-email-editor><summary>Edit the email's sender, recipients and subject</summary>
          <For each={mailFn.params.slice(0, 3)}>{(param, index) => <FieldRenderer identityMode="transient"
            field={{ name: param.name, type: param.type, label: Nothing, ui: Nothing, meta: {} }} value={mailInputs()[index()]}
            onChange={next => setMailInputs(previous => previous.map((entry, position) => position === index() ? next : entry))} />}</For>
        </details>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:24px;margin-top:20px">
          <section data-document-email-source style="min-width:0"><h3>Typed Email · Fenel source</h3><pre style="white-space:pre-wrap;overflow-wrap:anywhere">{printFenel(mail() as never)}</pre></section>
          <section data-document-email-preview style="min-width:0"><h3>Email preview</h3><DataValueSurface value={mailPreview()} type={type} label="Email preview" session={() => session}
            presentation={<TypedReadValue templateOnly value={mailPreview()} type={type} />} /></section>
        </div>
      </section>}
    </main>
  </ReaderRuntimeContext></AuthoringSessionContext></ApiClientContext>, document.body);
  Object.assign(globalThis, { fenelDocumentFixture: {
    value,
    reset: () => setValue(() => sample),
    replace: (replacement: unknown) => setValue(() => replacement),
    outline, plainText, mail, mailPreview,
    methods: () => presentation.representation("Viewable", "RichDocument"),
    debug: () => ({ entity: registry.getEntity("RichDocument"), identified: registry.getIdentifiedEntity("RichDocument"),
      methods: presentation.representation("Viewable", "RichDocument"), template: templates.resolve("rich-document"),
      component: !!templates.getComponent("rich-document"),
      plan: evaluate({ call: ["std:documentReadPlan", value()] }, {}, session.evaluateContext),
    }),
  } });
}
void start().catch(error => { document.body.textContent = error instanceof Error ? error.message : String(error); console.error(error); });
