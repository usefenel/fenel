import "@fenel/engine";
import { createSignal, flush, latest, onSettled } from "solid-js";
import { render } from "@solidjs/web";
import { Bool, Nat, Int, Rational, Str, List, Maybe, Nothing } from "@fenel/engine/type-foundation";
import { evaluate } from "@fenel/engine";
import type { FenelType } from "@fenel/engine/types";
import { VariantValueEditor, RawValueEditor } from "./VariantValueEditor";
import { VariantValueRenderer } from "./VariantValueRenderer";
import { FieldRenderer } from "../field-renderer/FieldRenderer";
import { InstanceEditor } from "../instances/InstanceEditor";
import { ConstraintsEditor } from "../instances/ConstraintsEditor";
import { functionStore } from "../function-editor/store";
import { draftValueFingerprint } from "../native-draft";
import { FunctionCanvas } from "../function-editor/FunctionCanvas";
import { AuthoringSessionContext, type AuthoringSession } from "../expression-runner/authoring-session";
import { createDetachedAuthoringEnvironment } from "../expression-runner/detached-authoring-environment";
import { createAuthoringEnvironment } from "@fenel/engine/authoring/environment";
import { createRegistry } from "@fenel/engine/registry";
import { valueToJsonWire, valueFromJsonWire, VALUE_JSON_ENCODING } from "@fenel/engine/authoring/type";

let dispose: (() => void) | undefined;
let read: () => unknown = () => undefined;
let emitted: unknown[] = [];
let saves: unknown[] = [];
let replaceValue: (value: unknown) => void = () => {};
let saveReopen: () => unknown = () => undefined;
const field = (name: string, type: FenelType) => ({ name, type, label: Nothing, ui: Nothing, meta: {} });
const fixtures: Record<string, FenelType> = {
  bool: Bool, int: Int, string: Str, list: List({ $ref: "Int" }), maybe: Maybe({ $ref: "Int" }),
  map: { $map: { keys: { $tag: "SeRef", handle: "String" }, values: { $record: { fields: [field("count", Int)] } } } },
  tuple: { $tuple: [Int, Bool] },
  recursive: { $mu: { var: "Tree", body: { $variant: { cases: [{ name: "Node", label: Nothing, fields: [field("child", { $var: "Tree" })] }, { name: "End", label: Nothing }] } } } },
  arrow: { $arrow: { params: [field("x", Int)], returns: Int } },
  dependent: { $record: { fields: [field("type", { $type: true }), field("value", { $el: { var: "type" } })] } },
  nat: Nat, rational: Rational,
};
let session: AuthoringSession | undefined;
function fixtureSession(): AuthoringSession {
  if (session) return session;
  const types = Object.entries({ Bool, Boolean: Bool, Nat, Int, Rational, String: Str }).map(([name, type]) => ({ id: name, name, type, description: "", category: "fixture" }));
  const environment = createDetachedAuthoringEnvironment(createAuthoringEnvironment({ types, capabilities: [], catalogTypes: types.map((entry) => entry.type), functions: [], operatorCodeNameByNotation: new Map() }));
  let registry: ReturnType<typeof createRegistry> | undefined;
  return session = { mode: "detached", environment, catalog: environment.catalog, get registry() { return registry ??= createRegistry([]); }, evaluateContext: {} };
}
(globalThis as any).valueInstanceFixture = {
  mount(kind: string, type: string | FenelType, value: unknown) {
    dispose?.(); emitted = []; saves = [];
    const host = document.getElementById("fixture")!; host.replaceChildren();
    if (kind === "requires") functionStore.load({ id: "fixture:fn", name: "fixture", active: true, body: false });
    if (kind === "function") functionStore.load({ id: "fixture:fn", name: "fixture:fn", active: true, body: value as any, params: [field("x", Int)] });
    flush();
    dispose = render(() => {
      let alive = true;
      onSettled(() => () => { alive = false; });
      const initial = kind === "bytes" ? Uint8Array.from(value as number[])
        : kind === "evaluated-closure" ? evaluate({ fn: ["x", 7] }, { captured: { call: ["business-data", false] } }, fixtureSession().evaluateContext)
        : kind === "evaluated-partial" ? evaluate({ call: [{ fn: ["x", "y", null] }, { var: "argument" }] }, { argument: { call: ["business-data", false] } }, fixtureSession().evaluateContext)
        : kind === "native-closure" ? evaluate({ fn: [[], { var: "captured" }] }, { captured: Uint8Array.of(1, 2), limit: Infinity, business: { $fenelCheckpoint: ["number", "+infinity"] } }, fixtureSession().evaluateContext)
        : value;
      const [current, setCurrent] = createSignal(initial); read = current;
      replaceValue = (next) => setCurrent(() => next);
      const onChange = (next: unknown) => { emitted.push(next); setCurrent(() => next); };
      const t = typeof type === "string" ? fixtures[type]! : type;
      saveReopen = () => {
        const wire = valueToJsonWire(t, current(), undefined, VALUE_JSON_ENCODING);
        const decoded = valueFromJsonWire(t, JSON.parse(JSON.stringify(wire)), undefined, VALUE_JSON_ENCODING);
        saves.push({ valueEncoding: VALUE_JSON_ENCODING, data: wire });
        setCurrent(() => decoded);
        const result = evaluate({ call: [{ var: "saved" }] }, { saved: decoded }, fixtureSession().evaluateContext);
        return result instanceof Uint8Array ? Array.from(result) : result;
      };
      if (kind === "raw") return <RawValueEditor value={current()} onChange={onChange} />;
      if (kind === "render") return <VariantValueRenderer type={t} value={current()} />;
      if (kind === "field") return <FieldRenderer identityMode="transient" field={field("value", t)} value={current()} onChange={onChange} />;
      if (kind === "instance") return <InstanceEditor variant="display" targetId="target" allowedInterfaces={["Labelable"]} rows={[{ id: "stored-row", instance: { typeName: "Labelable", args: ["target"], methods: { label: "Before" }, where: [{ class: { $tag: "Id", entityId: "Named" }, args: ["String"] }] } }]} onSave={async (body) => { saves.push(body); }} />;
      if (kind === "instance-bytes") return <InstanceEditor variant="display" targetId="Bytes" allowedInterfaces={["Exemplifiable"]} rows={[{ id: "bytes-row", valueEncoding: "fenel-instance-json-v1", instance: { typeName: "Exemplifiable", args: ["Bytes"], methods: { examples: [[0, 255]] }, scope: { kind: "tag", tag: "fixture" }, priority: 3 } }]} onSave={async (body) => { saves.push(body); }} />;
      if (kind === "draft") return <InstanceEditor mode="draft" variant="display" targetId="target" allowedInterfaces={["Labelable"]} drafts={current() as any} onDraftsChange={onChange} />;
      if (kind === "requires") {
        read = () => functionStore.serialize();
        const captureTarget = () => latest(() => {
          if (!alive) return undefined;
          const document = functionStore.nativeDocumentKey, rows = functionStore.requires;
          const fingerprint = draftValueFingerprint(functionStore.serialize());
          return () => latest(() => alive && document === functionStore.nativeDocumentKey
            && rows === functionStore.requires && fingerprint === draftValueFingerprint(functionStore.serialize()));
        });
        return <ConstraintsEditor value={functionStore.requires ?? []} captureTarget={captureTarget}
          onChange={(next) => { if (alive) functionStore.setRequires(next); }} />;
      }
      if (kind === "function") {
        read = () => functionStore.serialize();
        return <AuthoringSessionContext value={fixtureSession()}><FunctionCanvas /></AuthoringSessionContext>;
      }
      if (["arrow", "bytes", "pure", "evaluated-closure", "evaluated-partial", "native-closure"].includes(kind)) return <AuthoringSessionContext value={fixtureSession()}><VariantValueEditor type={t} value={current()} onChange={onChange} /></AuthoringSessionContext>;
      return <VariantValueEditor type={t} value={current()} onChange={onChange} />;
    }, host);
  },
  replaceValue: (value: unknown) => replaceValue(value),
  saveReopen: () => saveReopen(),
  state: () => ({ value: read(), emitted, saves, isBytes: read() instanceof Uint8Array, bytes: read() instanceof Uint8Array ? Array.from(read() as Uint8Array) : undefined }),
};
