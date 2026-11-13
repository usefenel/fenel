import { createSignal, onSettled } from "solid-js";
import { Portal, render } from "@solidjs/web";
import type { FenelType } from "@fenel/engine/types";
import { Bool, Int, Nat, Nothing, Rational, Str } from "@fenel/engine/type-foundation";
import { prepareEngineBodyDispatch } from "@fenel/engine/engine-bodies-dispatch";
import { createRegistry } from "@fenel/engine/registry";
import { createAuthoringEnvironment } from "@fenel/engine/authoring/environment";
import { TypeBuilder } from "./type-builder/TypeBuilder";
import { TypeDataPlayground } from "./type-data-playground";
import { AuthoringSessionContext, createDetachedAuthoringEnvironment, type AuthoringSession } from "./expression-runner/authoring-session";
import { ApiClientContext, defaultApiClient, type ApiClient } from "./api";
import { namedFieldOccurrence } from "./field-occurrence";
import { FieldRenderer } from "./field-renderer";
import { cloneDraftValue } from "./native-draft";
import { LocusContextMenu, type LocusMenuItem } from "./locus-context-menu";
import { ValueCard, ValueCardCaption } from "./value-card";
import "../global.css";
import "../routes/app.css";

let type: FenelType;

function TypeActionsMenuFixture(props: { after: boolean }) {
  const create = { instantiateValueType: (_type: FenelType) => {} };
  const data = { canAdd: () => false };
  const menu = () => ({ type: { $type: true } as FenelType });
  const setInspectingType = (_type: FenelType) => {};
  // Exact two-item array from .tmp-diag/gp14/home-before.tsx; the after
  // comparison appends only the new shared action. The menu owns its real
  // keyboard, icon, disabled-control, geometry and animation rendering.
  const items: LocusMenuItem[] = [
    { id: "new-of-type", label: "Create data of this type", icon: "plus", disabled: !create || data?.canAdd() === false,
      onSelect: () => create?.instantiateValueType(menu().type) },
    { id: "inspect-type", label: "Inspect type", icon: "shapes", onSelect: () => setInspectingType(menu().type) },
    ...(props.after ? [{ id: "explore-type", label: "Explore this type", icon: "shapes" as const, onSelect: () => {} }] : []),
  ];
  return <main style="padding:24px;width:min(28rem,calc(100vw - 48px))">
    <ValueCard heading={<ValueCardCaption caption="Contact input" typeLabel="Record" typeIcon="list-details" />}>
      <p class="text-muted">Type actions</p>
    </ValueCard>
    <LocusContextMenu x={32} y={110} label="Type actions" items={items} onClose={() => {}} />
  </main>;
}

function fixtureSession(): AuthoringSession {
  const types = Object.entries({ String: Str, Number: Rational, Nat, Int, Boolean: Bool })
    .map(([name, type]) => ({ id: name, name, type, description: "", category: "fixture" }));
  const environment = createDetachedAuthoringEnvironment(createAuthoringEnvironment({
    types, capabilities: [], catalogTypes: types.map(entry => entry.type), functions: [], operatorCodeNameByNotation: new Map(),
  }));
  const registry = createRegistry([{ name: "TypeDataFixture", label: "Type data fixture",
    entities: [{ id: "TypeDataFixtureRecord", type }] }]);
  return { mode: "detached", registry, environment, catalog: environment.catalog, evaluateContext: {} };
}

// These drafts have no persisted Field rows. The normal field editor consumes
// that decided absence; it must not query an unrelated signed-in account.
const fixtureClient: ApiClient = {
  ...defaultApiClient,
  getFieldAuthoringCatalog: async () => ({ fields: [], facetInterfaceNames: [] }),
  getFieldAuthoringIdentity: async () => {
    if (new URL(location.href).searchParams.get("metadata401") === "1") throw new Error("Field metadata HTTP 401");
    return { field: null };
  },
};

// Exact previous dialog body from the working tree, saved before this slice.
// Only its function name changes to coexist with the current composition.
function TypeInspectionDialogBefore(props: { type: FenelType; onClose: () => void }) {
  const [draft, setDraft] = createSignal(() => cloneDraftValue(props.type));
  let dialog!: HTMLDialogElement;
  onSettled(() => {
    const previous = document.activeElement;
    const opening = requestAnimationFrame(() => { if (dialog.isConnected) dialog.showModal(); });
    return () => {
      cancelAnimationFrame(opening);
      dialog.close();
      requestAnimationFrame(() => {
        const open = document.querySelector("dialog[open]");
        if (previous instanceof HTMLElement && previous.isConnected && (!open || open.contains(previous))) previous.focus();
      });
    };
  });
  return <Portal><dialog ref={dialog} class="value-expression-dialog" role="dialog" aria-label="Inspect type"
    onCancel={event => { event.preventDefault(); props.onClose(); }}
    onClick={event => { if (event.target === dialog) props.onClose(); }}>
    <div class="value-expression-dialog__content"><header class="value-expression-dialog__header"><h2>Type</h2>
      <button type="button" class="btn" onClick={props.onClose}>Close</button></header>
      <p class="text-muted">Explore this type. Changes here are a temporary draft.</p>
      <TypeBuilder value={draft()} onChange={setDraft} />
    </div>
  </dialog></Portal>;
}

function CurrentDialog(props: { session: AuthoringSession }) {
  let dialog!: HTMLDialogElement;
  onSettled(() => {
    const opening = requestAnimationFrame(() => { if (dialog.isConnected) dialog.showModal(); });
    return () => { cancelAnimationFrame(opening); dialog.close(); };
  });
  return <Portal><dialog ref={dialog} class="value-expression-dialog type-data-dialog" aria-label="Inspect type">
    <div class="value-expression-dialog__content"><header class="value-expression-dialog__header"><h2>Type → input</h2>
      <button type="button" class="btn" onClick={() => dialog.close()}>Close</button></header>
      <TypeDataPlayground type={type} session={props.session} />
    </div>
  </dialog></Portal>;
}

function BlankField() {
  const [value, setValue] = createSignal<unknown>();
  const changes: unknown[] = [];
  Object.assign(globalThis, { typeDataBlankField: { state: () => ({ value: value(), changes: [...changes] }) } });
  return <main style="padding:24px"><FieldRenderer identityMode="transient"
    field={{ name: "age", type: { $ref: "Number" }, label: Nothing, ui: Nothing, meta: {} }}
    value={value()} onChange={next => { changes.push(next); setValue(() => next); }} /></main>;
}

async function start() {
  const menuMode = new URL(location.href).searchParams.get("menu");
  if (menuMode === "before" || menuMode === "after") {
    render(() => <TypeActionsMenuFixture after={menuMode === "after"} />, document.body);
    return;
  }
  // Field creation/normalization uses its existing Fenel-owned kernel. Prepare
  // its canonical browser dispatcher before mounting or minting any fields.
  await prepareEngineBodyDispatch();
  type = { $record: { fields: [
    namedFieldOccurrence("00000000-0000-4000-8000-000000000141", "name", { $ref: "String" }),
    namedFieldOccurrence("00000000-0000-4000-8000-000000000142", "quantity", { $ref: "Number" }),
    namedFieldOccurrence("00000000-0000-4000-8000-000000000143", "notes", { $ref: "String" }),
  ] } };
  const session = fixtureSession();
  const before = new URL(location.href).searchParams.get("before") === "1";
  const blank = new URL(location.href).searchParams.get("blank") === "1";
  render(() => <ApiClientContext value={fixtureClient}><AuthoringSessionContext value={session}>
    {blank ? <BlankField /> : before ? <TypeInspectionDialogBefore type={type} onClose={() => {}} /> : <CurrentDialog session={session} />}
  </AuthoringSessionContext></ApiClientContext>, document.body);
}
void start().catch(error => { document.body.textContent = error instanceof Error ? error.message : String(error); });
