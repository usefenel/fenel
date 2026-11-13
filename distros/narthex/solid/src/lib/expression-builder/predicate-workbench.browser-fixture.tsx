// Isolated DOM fixture. Production editors, codecs, registry, field rendering,
// and membership all run unchanged; only the observable predicate is synthetic.
import "@fenel/engine";
import { createSignal } from "solid-js";
import { render } from "@solidjs/web";
import type { FenelType, SetExpr } from "@fenel/engine/types";
import { createRegistry } from "@fenel/engine/registry";
import { createAuthoringEnvironment, type AuthoringCatalogSnapshot } from "@fenel/engine/authoring/environment";
import { Nothing } from "@fenel/engine/type-foundation";
import { stdNatives } from "@fenel/engine";
import { SetExprEditor } from "./SetExprEditor";
import { ExprFieldContext } from "~/lib/field-renderer";
import { createDetachedAuthoringEnvironment } from "~/lib/expression-runner/detached-authoring-environment";
import {
  AuthoringSessionContext,
  type AuthoringSession,
} from "~/lib/expression-runner/authoring-session";

let dispose: (() => void) | undefined;
let calls = 0;
let emitted: SetExpr[] = [];
let readValue: () => SetExpr | undefined = () => undefined;
let replaceValue: (value: SetExpr) => void = () => {};
let replaceBaseType: (type: FenelType) => void = () => {};
let session: AuthoringSession | undefined;

export function fixtureSession(): AuthoringSession {
  if (session) return session;
  // This fixture exercises the public authoring-session boundary with a small
  // catalog. Full repository hydration has separate session tests and is not
  // part of this component gate.
  const field = (name: string) => ({ name, type: { $ref: "Number" } as FenelType, label: Nothing, meta: {}, ui: Nothing });
  const catalog: AuthoringCatalogSnapshot = {
    types: [], capabilities: [], catalogTypes: [], operatorCodeNameByNotation: new Map(),
    functions: [
      { id: "std:gt", label: "greater than", description: "", kind: "function", params: [field("a"), field("b")], returns: { $ref: "Boolean" } },
      { id: "std:neq", label: "not equal", description: "", kind: "function", params: [field("a"), field("b")], returns: { $ref: "Boolean" } },
      { id: "fixture:observe", label: "observe", description: "", kind: "function", params: [field("value")], returns: { $ref: "Boolean" } },
    ],
  };
  const environment = createDetachedAuthoringEnvironment(createAuthoringEnvironment(catalog));
  let registry: ReturnType<typeof createRegistry> | undefined;
  session = {
    mode: "detached",
    get registry() { return registry ??= createRegistry([]); },
    catalog: environment.catalog,
    environment,
    evaluateContext: {
      natives: {
        ...stdNatives,
        "fixture:observe": (value: unknown) => {
          calls++;
          return typeof value === "number" && value > 0;
        },
      },
    },
  };
  return session;
}

const api = {
  mount(value: SetExpr, baseType: FenelType = { $ref: "Number" }) {
    dispose?.();
    calls = 0;
    emitted = [];
    const host = document.getElementById("fixture")!;
    host.replaceChildren();
    dispose = render(() => {
      const [current, setCurrent] = createSignal<SetExpr | undefined>(value);
      const [inputType, setInputType] = createSignal(baseType);
      readValue = current;
      replaceValue = (next) => setCurrent(next);
      replaceBaseType = (next) => setInputType(next);
      return (
        <AuthoringSessionContext value={fixtureSession()}>
          <ExprFieldContext value={{ Wrapper: () => <button class="fixture-expression-control">Unexpected expression control</button> }}>
          <SetExprEditor
            value={current()}
            baseType={inputType()}
            valueType="number"
            onChange={(next) => {
              if (next) emitted.push(next);
              setCurrent(next);
            }}
          />
          </ExprFieldContext>
        </AuthoringSessionContext>
      );
    }, host);
  },
  state: () => ({ value: readValue(), emitted, calls }),
  replace: (value: SetExpr) => replaceValue(value),
  replaceBaseType: (type: FenelType) => replaceBaseType(type),
};

declare global {
  var predicateWorkbench: typeof api;
}
globalThis.predicateWorkbench = api;
