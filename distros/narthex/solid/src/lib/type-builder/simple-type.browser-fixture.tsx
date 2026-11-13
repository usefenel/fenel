// C2 isolated DOM harness: actual TypeBuilder, occurrence editor, and catalog.
// Reader IO is fixture data; this does not claim a saved-owner integration gate.
import { createSignal, Errored, Loading, snapshot } from "solid-js";
import { render } from "@solidjs/web";
import { createRegistry } from "@fenel/engine/registry";
import { createAuthoringEnvironment } from "@fenel/engine/authoring/environment";
import { Str, Bool, Rational, List, Maybe, Result } from "@fenel/engine/type-foundation";
import type { Expression, FenelType } from "@fenel/engine/types";
import { editTypePredicateSugar, inspectTypePredicateSugar } from "@fenel/engine/authoring/type-predicate-sugar";
import { contains } from "@fenel/engine/set-algebra";
import { typeToSetExpr } from "@fenel/engine/fenel-check";
import { ApiClientContext, createPublicApiClient } from "~/lib/api";
import { createDetachedAuthoringEnvironment } from "~/lib/expression-runner/detached-authoring-environment";
import { AuthoringSessionContext, type AuthoringSession } from "~/lib/expression-runner/authoring-session";
import { TypeBuilder } from "./TypeBuilder";
import { TypePicker } from "./TypePicker";
import { ReaderRuntimeContext } from "~/lib/reader-runtime";
import { phonePickerVisualSession as phoneSession, phonePickerVisualReader as phoneReader,
  phonePickerVisualLocalSession, phonePickerVisualLocalReader, phonePickerVisualTransport } from "./type-picker-owner.browser-fixture";
import { FieldAuthoringProvider } from "~/lib/field-occurrence/context";
import type { FieldFacetDraftMap } from "~/lib/field-occurrence/model";

const types = Object.entries({ String: Str, Boolean: Bool, Number: Rational })
  .map(([name, type]) => ({ id: name, name, type, description: "", category: "fixture" }));
const environment = createDetachedAuthoringEnvironment(createAuthoringEnvironment({
  types, capabilities: [], catalogTypes: types.map(entry => entry.type), functions: [], operatorCodeNameByNotation: new Map(),
}));
let registry: ReturnType<typeof createRegistry> | undefined;
const session: AuthoringSession = { mode: "detached", environment, catalog: environment.catalog,
  get registry() { return registry ??= createRegistry([]); },
  get evaluateContext() { return (registry ??= createRegistry([])).evaluateContext(); },
};
const client = { ...createPublicApiClient(),
  getFieldAuthoringCatalog: async () => ({ fields: [], facetInterfaceNames: [] }),
  getFieldAuthoringIdentity: async () => ({ field: null }),
  getFieldFacetInstances: async () => ({ dispatchInstances: [] }),
};
let dispose: (() => void) | undefined;
let read: () => FenelType | null = () => null;
let changes: FenelType[] = [];
let guardCalls = 0;
let forgotten: string[] = [];
let ownerCandidates: FenelType[] = [];
let forgottenAtOwner: string[][] = [];
let readFacets: () => FieldFacetDraftMap = () => ({});
let phoneSelection: unknown;
const fixture = {
  mountPhone(surface: "builder" | "picker" = "builder", initial?: FenelType, transport?: "ready" | "hold" | "refuse") {
    dispose?.(); changes = []; phoneSelection = undefined;
    phonePickerVisualTransport.reset(transport ?? "ready");
    const host = document.getElementById("fixture")!; host.replaceChildren();
    dispose = render(() => {
      const [current, setCurrent] = createSignal<FenelType>(initial ?? { $ref: "String" }); read = current;
      const pickerProps = { allowAuto: true, captureTarget: () => () => true,
        // A parameter accepting unknown compiles against both the old string
        // API and the candidate selection API; the old component is untouched.
        onPick: (selection: unknown) => { phoneSelection = selection; }, onCancel: () => {} };
      return <Errored fallback={error => <pre data-fixture-error>{String(error())}</pre>}>
        <ApiClientContext value={client}><AuthoringSessionContext value={transport ? phonePickerVisualLocalSession : phoneSession}>
          <ReaderRuntimeContext value={transport ? phonePickerVisualLocalReader : phoneReader}>
          <FieldAuthoringProvider facetsByFieldId={{}} onFieldFacetsChange={() => {}} onFieldFacetsForget={() => {}}>
            {surface === "picker" ? <TypePicker {...pickerProps} />
              : <TypeBuilder value={current()} presentation="simple" onChange={next => { changes.push(next); setCurrent(next); }} />}
          </FieldAuthoringProvider>
        </ReaderRuntimeContext></AuthoringSessionContext></ApiClientContext>
      </Errored>;
    }, host);
  },
  phoneSelection: () => snapshot(phoneSelection),
  phoneTransport: phonePickerVisualTransport,
  mount(value: FenelType | null, presentation: "simple" | "full" = "simple", refuseChanges = false,
    ownerRefuse?: boolean, initialFacets: FieldFacetDraftMap = {}) {
    dispose?.(); changes = []; guardCalls = 0; forgotten = []; ownerCandidates = []; forgottenAtOwner = [];
    const host = document.getElementById("fixture")!; host.replaceChildren();
    dispose = render(() => {
      const [current, setCurrent] = createSignal(value); read = current;
      const [facets, setFacets] = createSignal(initialFacets); readFacets = facets;
      return <Errored fallback={error => <pre data-fixture-error>{error() instanceof Error ? (error() as Error).stack : String(error())}</pre>}>
        <Loading fallback={<p>Loading type editor…</p>}>
          <ApiClientContext value={client}><AuthoringSessionContext value={session}>
            <FieldAuthoringProvider facetsByFieldId={facets()} onFieldFacetsChange={(id, value) => setFacets(current => ({ ...current, [id]: value }))}
              onFieldFacetsForget={id => { forgotten.push(id); setFacets(current => { const next = { ...current }; delete next[id]; return next; }); }}>
              <TypeBuilder value={current()} presentation={presentation}
                beforeChange={ownerRefuse === undefined ? undefined : next => {
                  ownerCandidates.push(next); forgottenAtOwner.push([...forgotten]); return !ownerRefuse;
                }}
                beforeFieldsChange={() => { guardCalls++; return !refuseChanges; }}
                onChange={next => { changes.push(next); setCurrent(next); }} />
            </FieldAuthoringProvider>
          </AuthoringSessionContext></ApiClientContext>
        </Loading>
      </Errored>;
    }, host);
  },
  state: () => ({ value: snapshot(read()), changes: snapshot(changes) }),
  guardState: () => ({ calls: guardCalls, forgotten }),
  ownerGuardState: () => ({ candidates: snapshot(ownerCandidates), forgottenAtOwner, facets: snapshot(readFacets()) }),
  wrapSugar: (kind: string, type: FenelType) => kind === "list" ? List(type) : kind === "maybe" ? Maybe(type) : Result({ $unit: true }, type),
  preparePredicates(base: FenelType, global: Expression, index: number, predicate: Expression) {
    const first = editTypePredicateSugar(base, { kind: "global", predicate: global });
    if (!first.ok) throw new Error(first.message);
    const next = editTypePredicateSugar(first.type, { kind: "case", index, predicate });
    if (!next.ok) throw new Error(next.message);
    return next.type;
  },
  projection: () => inspectTypePredicateSugar(read()!),
  membership: (value: unknown, constructorWireNames?: Record<string, string>) => contains(typeToSetExpr(read()!), value, null, undefined,
    constructorWireNames ? { _constructorWireNames: constructorWireNames } : undefined),
};
declare global { var simpleTypeFixture: typeof fixture; }
globalThis.simpleTypeFixture = fixture;

