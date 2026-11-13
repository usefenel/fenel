import { Errored, For, Loading, Show, createMemo, createSignal } from "solid-js";
import { render } from "@solidjs/web";
import { evaluate, printFenel } from "@fenel/engine";
import { stdModule } from "@fenel/engine/modules/std";
import { setExprEntityModule } from "../../../../../implementations/typescript/engine/src/modules/set-expr-entities";
import { proverModule } from "../../../../../implementations/typescript/engine/src/modules/prover";
import { publicClaimsDemoModule, publicGreekAlphabetDemoModule, publicEncyclopediaDemoModule, publicCheckDemoModule, publicAxiomsDemoModule } from "../../../../../implementations/typescript/engine/src/modules/public-demos";
import { decidableMembershipModule } from "../../../../../implementations/typescript/engine/src/modules/decidable-membership";
import { createRepositoryRegistry } from "@fenel/engine/repository-registry";
import { prepareEngineBodyDispatch } from "@fenel/engine/engine-bodies-dispatch";
import { createAuthoringEnvironment } from "@fenel/engine/authoring/environment";
import { Bool, Nat, Nothing, Rational, Str, refHandle } from "@fenel/engine/type-foundation";
import { AuthoringSessionContext, type AuthoringSession } from "./expression-runner/authoring-session";
import { createDetachedAuthoringEnvironment } from "./expression-runner/detached-authoring-environment";
import { toLogic, type ExprNode } from "./expression-runner";
import { ReaderRuntimeContext, type ReaderRuntime } from "./reader-runtime";
import { createReaderPresentation } from "./reader-presentation";
import { createReaderTemplateRegistry } from "./web-template-registry";
import { ApiClientContext, defaultApiClient, type ApiClient } from "./api";
import { FunctionCardBody } from "./function-card-body";
import { TypedReadValue } from "./layout-renderer/TypedReadValue";
import { DataValueSurface } from "./data-transfer/DataValueSurface";
import { scopedConcreteType } from "./data-transfer/expressions";
import { ValueCard, ValueCardCaption } from "./value-card";
import { FieldRenderer } from "./field-renderer";
import { TypeDataPlayground } from "./type-data-playground";
import type { FenelType } from "@fenel/engine/types";
import "../global.css";
import "../routes/app.css";

// C2 only: canonical source modules, the existing field editor,
// function card and shared typed result inspector. No replacement verdict UI.
async function start() {
  await prepareEngineBodyDispatch();
  const evidenceTypes = { ...proverModule, functions: [], functionSignatureDeclarations: [],
    functionNamespaceOverrides: [], instances: [], nativeImpls: {}, nativeImplsCtx: {} };
  const mode = new URL(location.href).searchParams.get("demo") ?? "greek";
  const greek = mode === "greek";
  const axioms = mode.startsWith("axioms");
  const registry = createRepositoryRegistry(axioms
    ? [stdModule, decidableMembershipModule, setExprEntityModule, evidenceTypes, publicCheckDemoModule,
      publicEncyclopediaDemoModule, publicGreekAlphabetDemoModule, publicClaimsDemoModule, publicAxiomsDemoModule]
    : greek
    ? [stdModule, decidableMembershipModule, setExprEntityModule, publicEncyclopediaDemoModule, publicGreekAlphabetDemoModule]
    : [stdModule, setExprEntityModule, evidenceTypes, publicClaimsDemoModule]);
  const moduleName = axioms ? "AxiomsDemo" : greek ? "GreekAlphabetDemo" : "ClaimsDemo";
  const sampleMode = mode === "samples" || mode === "refuted";
  const functionName = axioms ? mode : greek ? "greekAlphabetText" : sampleMode ? "positiveNumberSamples" : mode === "unknown" ? "openPositiveClaim" : "finiteNumberSubset";
  const fn = registry.getIdentifiedFunction(`${moduleName}:${functionName}`)!;
  // GLOBAL_ONLY: this read-only source fixture has no account or host effects.
  const context = registry.evaluateContext();
  const initialRows = evaluate({ call: [`${moduleName}:${axioms ? "axiomsDemoStartingInputs" : greek ? "greekAlphabetDemoStartingInputs" : "claimsDemoStartingInputs"}`] }, {}, context) as Array<{ function: { $ref: string }; arguments: unknown[] }>;
  const sourceRows = initialRows.filter(row => registry.getFunction(refHandle(row.function) ?? "")?.id === fn.id);
  const starting = fn.params.length === 0 ? [] : sourceRows.at(mode === "refuted" ? -1 : 0)!.arguments;
  const types = [...Object.entries({ String: Str, Number: Rational, Nat, Boolean: Bool })
    .map(([name, type]) => ({ id: name, name, type })),
    ...registry.listIdentifiedEntities().map(entity => ({ id: entity.id, name: entity.id, type: entity.type }))]
    .map(entry => ({ ...entry, description: "", category: "fixture" }));
  const catalog = { types, capabilities: [], catalogTypes: types.map(entry => entry.type),
    functions: [], operatorCodeNameByNotation: new Map() };
  const environment = createDetachedAuthoringEnvironment(createAuthoringEnvironment(catalog, {
    getFunction: registry.getFunction, resolveSchemaType: name => registry.getIdentifiedEntity(name)?.type,
  }));
  const session: AuthoringSession = { mode: "detached", registry, environment, catalog: environment.catalog, evaluateContext: context };
  const presentation = createReaderPresentation(() => ({ registry, session, catalog: [] }));
  const templates = createReaderTemplateRegistry([]);
  const reader = { session: () => session, registry: () => registry, templates: () => templates,
    representation: presentation.representation } as ReaderRuntime;
  const client: ApiClient = { ...defaultApiClient,
    getFieldAuthoringCatalog: async () => ({ fields: [], facetInterfaceNames: [] }),
    getFieldAuthoringIdentity: async () => ({ field: null }),
  };
  const [nodes, setNodes] = createSignal<ExprNode[]>(starting.map(value => ({ kind: "literal", value })));
  const [inspectedType, setInspectedType] = createSignal<FenelType>();
  const logic = createMemo(() => ({ call: [fn.id, ...nodes().map(node => toLogic(node, undefined, session))] }));
  const result = createMemo(() => evaluate(logic(), {}, context));
  const parameterType = (index: number) => {
    const values: Record<string, unknown> = {};
    fn.params.slice(0, index).forEach((parameter, position) => {
      const node = nodes()[position];
      if (node?.kind === "literal") values[parameter.name] = node.value;
    });
    const declared = fn.params[index]!.type;
    return scopedConcreteType(declared, context, environment, registry, values) ?? declared;
  };
  const inputs = fn.params.map(param => ({ type: param.type, label: param.name }));
  const output = { type: fn.returns, label: axioms ? "Result of foundation example" : greek ? "Greek alphabet text result" : "Result of named claim" };
  const axiomTitles: Record<string, string> = {
    axiomsLattice: "Lattice: combine sets", axiomsSingleton: "Singletons: exactly this value",
    axiomsArrow: "Arrow: a function contract", axiomsRecursion: "Recursion: the same shape again",
    axiomsDependency: "Dependency: one choice shapes another", axiomsUniverse: "Universe: types are data too",
    axiomsFreshIdentities: "Fresh identities: create a new identity",
    axiomsLatticeFamily: "Lattice family", axiomsSingletonFamily: "Singleton family",
    axiomsArrowFamily: "Arrow family", axiomsRecursionFamily: "Recursion family",
    axiomsDependencyFamily: "Dependency family", axiomsUniverseFamily: "Universe family",
    axiomsFreshIdentityFamily: "Fresh identity family",
  };
  const title = axioms ? axiomTitles[functionName] ?? functionName : greek ? "Try text against Greek letter sets" : sampleMode ? "Check positive-number samples" : mode === "unknown" ? "Inspect an open positive-number claim" : "Check a finite number subset";
  render(() => <ApiClientContext value={client}><AuthoringSessionContext value={session}><ReaderRuntimeContext value={reader}>
    <main style="max-width:1100px;margin:auto;padding:24px;min-width:0">
      <h1>{title}</h1>
      <p class="text-muted">{axioms ? "The foundation is assumed. Inspect concrete checks and actual undecided answers through the shared typed editors."
        : greek ? "Inspect actual character membership and case conversion. Latin lookalikes remain outside the selected Greek alphabet."
        : "Inspect the actual evidence grade and its exact counterexample or certificate. Samples remain distinct from theorem certificates."}</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,330px),1fr));gap:20px">
        <section data-call-inputs>
          <div style="height:180px"><ValueCard heading={<ValueCardCaption caption={title} typeLabel="Function" typeIcon="function" />}>
            <FunctionCardBody inputs={inputs} output={output}
              previewType={entry => <TypedReadValue value={entry.type} type={{ $type: true }} />}
              onOpenType={entry => setInspectedType(entry.type)} onOpenInputs={() => {}} />
          </ValueCard></div>
          <h2>Call inputs</h2>
          <For each={fn.params}>{(param, index) => <div data-call-param={param.name} style="margin:12px 0">
            <h3>{param.name}</h3>
            <FieldRenderer identityMode="transient" field={{ name: param.name, type: parameterType(index()), label: Nothing, ui: Nothing, meta: {} }}
              value={evaluate(toLogic(nodes()[index()]!, undefined, session), {}, context)}
              onChange={next => setNodes(previous => previous.map((value, position) => position === index() ? { kind: "literal", value: next } : value))} />
          </div>}</For>
          <details><summary>Fenel source</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">{printFenel(logic() as never)}</pre></details>
        </section>
        <section data-call-result><h2>Returns</h2>
          <Errored fallback={error => <p role="status">{String(error())}</p>}><Loading fallback={<p>Computing…</p>}>
            <DataValueSurface value={result()} type={fn.returns} label="Returns" session={() => session}
              presentation={<TypedReadValue templateOnly value={result()} type={fn.returns} />} />
          </Loading></Errored>
        </section>
      </div>
      <Show keyed when={inspectedType()}>{type => <section data-type-inspection style="margin-top:24px;min-width:0">
        <h2>Inspect type</h2>
        <button type="button" class="btn" onClick={() => setInspectedType(undefined)}>Close type inspection</button>
        <TypeDataPlayground type={type} session={session} />
      </section>}</Show>
    </main>
  </ReaderRuntimeContext></AuthoringSessionContext></ApiClientContext>, document.body);
  Object.assign(globalThis, { fenelLaunchDemoFixture: {
    result, nodes, reset: () => setNodes(starting.map(value => ({ kind: "literal", value }))),
    source: () => printFenel(logic() as never),
  } });
}
void start().catch(error => { document.body.textContent = error instanceof Error ? error.message : String(error); console.error(error); });
