// C1/C2 harness: the build exports the two existing production adapters.
import { createSignal, Errored, Loading, snapshot } from "solid-js";
import { render } from "@solidjs/web";
import { Nothing, Rational, Str } from "@fenel/engine/type-foundation";
import { createRegistry } from "@fenel/engine/registry";
import { createAuthoringEnvironment } from "@fenel/engine/authoring/environment";
import type { FieldDef, FenelType } from "@fenel/engine/types";
import { AuthoringSessionContext, createDetachedAuthoringEnvironment, type AuthoringSession } from "./authoring-session";
import { ExpressionEditor, LambdaParamsContext, type ExprNode } from "./index";
// @ts-expect-error Test build exposes the actual private adapters, without a production export.
import { LambdaEditor, LambdaFormEditor, NodeEditor } from "shared-function-adapters:production";
import { ExpressionGraphAuthoringContext } from "./expression-surfaces";

const field = (name: string, type: FenelType): FieldDef => ({ name, type, label: Nothing, ui: Nothing, meta: {} });
const types = [{ id: "Number", name: "Number", type: Rational, category: "fixture", description: "" },
  { id: "String", name: "String", type: Str, category: "fixture", description: "" }];
let session: AuthoringSession;
function fixtureSession(): AuthoringSession {
  if (session) return session;
  const environment = createDetachedAuthoringEnvironment(createAuthoringEnvironment({ types, capabilities: [],
    catalogTypes: types.map(entry => entry.type), functions: [], operatorCodeNameByNotation: new Map() }));
  return session = { mode: "detached", environment, catalog: environment.catalog, registry: createRegistry([]), evaluateContext: {} };
}
let dispose: (() => void) | undefined;
let read = () => ({} as Record<string, unknown>);
let writes = 0;
const fixture = {
  mount(kind: "structural" | "field" | "inspection", scenario = "named") {
    dispose?.();
    const host = document.getElementById("fixture")!;
    host.replaceChildren();
    writes = 0;
    dispose = render(() => {
      const params = ["authored"];
      const body: ExprNode = scenario === "capture" ? { kind: "literal", value: { __lambda: {
        params: ["inner"], body: { kind: "param", name: "authored" },
      } } } : scenario === "unused" ? { kind: "literal", value: 7 } : { kind: "param", name: "authored" };
      const [value, setValue] = createSignal<unknown>(scenario === "legacy"
        ? { __lambda: { kind: "literal", value: 7 } }
        : { __lambda: { params, body, arrayParams: true } });
      const update = (next: unknown) => { writes++; setValue(next); };
      const inner = () => (value() as { __lambda: { params: string[]; body: ExprNode; arrayParams?: boolean } }).__lambda;
      read = () => ({ value: snapshot(value()), writes });
      return <Errored fallback={error => <pre data-fixture-error>{String(error())}</pre>}>
        <Loading fallback={<p>Loading editor…</p>}>
          <AuthoringSessionContext value={fixtureSession()}>
            <LambdaParamsContext value={() => [{ name: "outside", type: Rational }]}>
              {kind === "inspection" ? <ExpressionEditor expr={{ kind: "literal", value: value() }} onChange={update}
                inspection={{ callable: () => undefined, typeLabel: () => undefined }} />
                : kind === "field" ? <LambdaEditor value={value()} onChange={update}
                arrowType={{ $arrow: { params: [field("suggested", Rational)], returns: Rational } }} />
                : <LambdaFormEditor params={inner().params} body={inner().body}
                  onChange={(next: { params: string[]; body: ExprNode }) => update({ __lambda: { ...inner(), ...next } })} />}
            </LambdaParamsContext>
          </AuthoringSessionContext>
        </Loading>
      </Errored>;
    }, host);
  },
  /** Main-editor local bindings: removing the last one restores the body as
   * the whole expression (never a literal wrapping the body's node). */
  mountBindings(graphAuthoring: boolean) {
    dispose?.();
    const host = document.getElementById("fixture")!;
    host.replaceChildren();
    writes = 0;
    dispose = render(() => {
      const [node, setNode] = createSignal<ExprNode>({ kind: "literal", value: { __where: {
        body: { kind: "literal", value: "the quick brown fox" }, bindings: [{ name: "x", expr: { kind: "literal", value: 0 } }],
      } } });
      read = () => ({ value: snapshot(node()), writes });
      return <Errored fallback={error => <pre data-fixture-error>{String(error())}</pre>}>
        <Loading fallback={<p>Loading editor…</p>}>
          <AuthoringSessionContext value={fixtureSession()}>
            {/* The actual recursive node editor of the main (prepared) editor. */}
            <ExpressionGraphAuthoringContext value={() => graphAuthoring}>
              <NodeEditor node={node()} onChange={(next: ExprNode) => { writes++; setNode(next); }} typeName={undefined} viewMode="nested" />
            </ExpressionGraphAuthoringContext>
          </AuthoringSessionContext>
        </Loading>
      </Errored>;
    }, host);
  },
  editBody(body: ExprNode) {
    (globalThis as unknown as { __sharedFunctionSetBody: (body: ExprNode) => void }).__sharedFunctionSetBody(body);
  },
  state: () => read(),
};
Object.assign(globalThis, { sharedFunctionFixture: fixture });
