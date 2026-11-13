// C2 actual-component fixture. Reader IO is controlled; all scheme edit and
// Kind conversion decisions run through the production Fenel source policies.
import { createSignal, Errored, Loading, snapshot } from "solid-js";
import { render } from "@solidjs/web";
import { createRegistry } from "@fenel/engine/registry";
import { createAuthoringEnvironment } from "@fenel/engine/authoring/environment";
import { Str, Bool, Rational } from "@fenel/engine/type-foundation";
import type { TypeScheme } from "@fenel/engine/types";
import { editAuthoringGenericDeclaration, type AuthoringGenericDeclarationDraft, type AuthoringGenericEdit, type AuthoringGenericParameter } from "@fenel/engine/authoring/generic-parameters";
import { ApiClientContext, createPublicApiClient } from "~/lib/api";
import { createDetachedAuthoringEnvironment } from "~/lib/expression-runner/detached-authoring-environment";
import { AuthoringSessionContext, type AuthoringSession } from "~/lib/expression-runner/authoring-session";
import { GenericParametersEditor } from "./GenericParametersEditor";
import { TypeBuilder } from "~/lib/type-builder";

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
let state: () => unknown = () => undefined;
const fixture = {
  mount(initial: TypeScheme, initialParams?: readonly AuthoringGenericParameter[], showGenerics = true, presentation?: "simple" | "full") {
    dispose?.();
    const host = document.getElementById("fixture")!; host.replaceChildren();
    dispose = render(() => {
      const [scheme, setScheme] = createSignal(initial);
      const [params, setParams] = createSignal(initialParams);
      const [issue, setIssue] = createSignal<string>();
      let changes = 0;
      state = () => ({ scheme: snapshot(scheme()), params: snapshot(params()), issue: issue(), changes });
      return <Errored fallback={error => <pre data-fixture-error>{error() instanceof Error ? (error() as Error).stack : String(error())}</pre>}>
        <Loading fallback={<p>Loading type parameters…</p>}>
          <ApiClientContext value={client}><AuthoringSessionContext value={session}>
            <h2>Type declaration</h2>
            {showGenerics && <GenericParametersEditor scheme={scheme()} params={params()} onParamsChange={setParams} presentation={presentation}
              onIssueChange={setIssue} onChange={next => { changes++; setScheme(next); }} />}
            <div style="margin-top: 1.25rem"><TypeBuilder value={scheme().body} presentation="simple" onChange={body => setScheme({ ...scheme(), body })} /></div>
          </AuthoringSessionContext></ApiClientContext>
        </Loading>
      </Errored>;
    }, host);
  },
  mountOwned(initial: AuthoringGenericDeclarationDraft, refuse = false) {
    dispose?.();
    const host = document.getElementById("fixture")!; host.replaceChildren();
    dispose = render(() => {
      const [draft, setDraft] = createSignal(initial);
      const [issue, setIssue] = createSignal<string>();
      const edits: AuthoringGenericEdit[] = [];
      let legacyCalls = 0;
      state = () => ({ draft: snapshot(draft()), issue: issue(), edits: snapshot(edits), legacyCalls });
      return <Errored fallback={error => <pre data-fixture-error>{String(error())}</pre>}>
        <Loading fallback={<p>Loading type parameters…</p>}>
          <ApiClientContext value={client}><AuthoringSessionContext value={session}>
            <GenericParametersEditor scheme={draft().scheme} params={draft().params}
              onChange={() => { legacyCalls++; }} onParamsChange={() => { legacyCalls++; }}
              onIssueChange={setIssue} onEdit={edit => {
                edits.push(edit);
                if (refuse) return { ok: false, message: "Owner transaction refused" };
                const result = editAuthoringGenericDeclaration(draft(), edit);
                if (!result.ok) return result;
                setDraft(result.value);
                return { ok: true };
              }} />
          </AuthoringSessionContext></ApiClientContext>
        </Loading>
      </Errored>;
    }, host);
  },
  state: () => state(),
};
declare global { var genericParametersFixture: typeof fixture; }
globalThis.genericParametersFixture = fixture;
