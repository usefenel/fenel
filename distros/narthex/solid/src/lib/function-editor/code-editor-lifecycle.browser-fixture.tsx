import { createSignal, createMemo, Show, flush } from "solid-js";
import { render } from "@solidjs/web";
import { EditorView } from "@codemirror/view";
import { FenelCodeEditor, InlineCodeEditor } from "./FenelCodeEditor";
import { functionStore } from "./store";
import type { StepPath } from "./types";
import { printFenel as print } from "@fenel/engine";
import { parse, ParseError } from "@fenel/engine/fenel-parser";
import type { Expression } from "@fenel/engine/types";
import { IconAlertTriangle } from "../icons";
import { cloneDraftValue, draftValueFingerprint } from "../native-draft";
import { desiredFieldFacetValues, fieldFacetReplacementIds } from "../field-occurrence/model";

let dispose: (() => void) | undefined;
let patch: (next: Partial<{ value: string; documentKey: string; readonly: boolean; wrap: boolean; height: string; placeholder: string }>) => void;
let read: () => unknown;
let destroys = 0;
let originalView: EditorView | null;
let originalInlineView: EditorView | null;
let originalFunctionView: EditorView | null;
let readFunction: () => unknown;
let saveFunctionHandler: () => Promise<void>;
let changeFunctionLens: (lens: "code" | "expression") => void;
let loadFunction: (body: Expression, id?: string) => void;
let resetFunction: () => void;
const destroy = EditorView.prototype.destroy;
EditorView.prototype.destroy = function () { destroys++; return destroy.call(this); };

// The build plugin replaces these markers with the exact production function.
// FUNCTION_CODE_SOURCE_START
function FunctionCodeView(): never {
  throw new Error("The actual FunctionCodeView source was not injected.");
}
// FUNCTION_CODE_SOURCE_END

globalThis.codeEditorLifecycle = {
  mount() {
    dispose?.();
    const host = document.getElementById("fixture")!;
    host.replaceChildren();
    dispose = render(() => {
      const [state, setState] = createSignal({ value: "1", documentKey: "initial", readonly: true, wrap: false, height: "120px", placeholder: "Initial" });
      const edits: string[] = [];
      patch = next => { setState(prior => ({ ...prior, ...next })); flush(); };
      read = () => ({ ...state(), edits, destroys });
      return <>
        <FenelCodeEditor class="full-code" value={state().value} documentKey={state().documentKey} readonly={state().readonly}
          wrapLines={state().wrap} minHeight={state().height} onChange={value => edits.push(value)} />
        <InlineCodeEditor class="inline-code" value={state().value} documentKey={state().documentKey} placeholder={state().placeholder}
          onChange={value => edits.push(value)} />
      </>;
    }, host);
    flush();
  },
  patch: next => patch(next),
  state: () => read(),
  remember() {
    originalView = EditorView.findFromDOM(document.querySelector<HTMLElement>(".full-code .cm-content")!);
    originalInlineView = EditorView.findFromDOM(document.querySelector<HTMLElement>(".inline-code .cm-content")!);
  },
  details() {
    const view = EditorView.findFromDOM(document.querySelector<HTMLElement>(".full-code .cm-content")!);
    const inlineView = EditorView.findFromDOM(document.querySelector<HTMLElement>(".inline-code .cm-content")!);
    return { sameView: view === originalView, sameInlineView: inlineView === originalInlineView,
      readonly: view?.state.readOnly, value: view?.state.doc.toString(), inlineValue: inlineView?.state.doc.toString() };
  },
  mountFunction() {
    dispose?.();
    const host = document.getElementById("fixture")!;
    host.replaceChildren();
    functionStore.reset();
    flush();
    functionStore.load({ id: "row-A", functionId: "fn-A", name: "draft", active: true,
      params: [], returns: { $ref: "Number" }, body: 1 });
    flush();
    functionStore.markClean();
    flush();
    dispose = render(() => {
      const [lens, setLens] = createSignal<"code" | "expression">("code");
      const [error, setError] = createSignal<string | null>(null);
      const [saving, setSaving] = createSignal(false);
      const [persistedActive, setPersistedActive] = createSignal(true);
      const [requestCount, setRequestCount] = createSignal(0);
      let editorGeneration = 0;
      const requests: unknown[] = [];
      const navigations: unknown[] = [];
      const fnData = (): { sourceRegistryId?: string } | undefined => undefined;
      const isNew = () => false;
      const navigate = (to: string, options?: unknown) => { navigations.push({ to, options }); };
      const api = {
        definitionBundleSave: async (request: any) => {
          requests.push(cloneDraftValue(request));
          setRequestCount(requests.length);
          return { snapshot: { owners: request.ownerMutations.map((mutation: any) => ({
            kind: mutation.owner.kind, storageName: mutation.owner.storageName,
            storageId: functionStore.state.id ?? "row-A",
          })) } };
        },
        functionSetActive: async (id: string, active: boolean) => ({ id, active }),
      };

      // Replaced with the route's actual saveFingerprint/saveDraft/handleSave.
      // FUNCTION_SAVE_SOURCE_START
      function saveFingerprint() { return ""; }
      function saveDraft() { return {}; }
      async function handleSave() {
        throw new Error("The actual function route save source was not injected.");
      }
      // FUNCTION_SAVE_SOURCE_END

      saveFunctionHandler = handleSave;
      changeFunctionLens = next => { setLens(next); flush(); };
      loadFunction = (body, id = "row-B") => {
        editorGeneration++;
        functionStore.load({ id, functionId: `fn-${id}`, name: id === "row-A" ? "draft" : id,
          active: true, params: [], returns: { $ref: "Number" }, body });
        flush();
        functionStore.markClean();
        flush();
      };
      resetFunction = () => { editorGeneration++; functionStore.reset(); flush(); };
      readFunction = () => {
        const draft = functionStore.bodySourceDraft;
        return { body: cloneDraftValue(functionStore.body), dirty: functionStore.dirty,
          bodyEditIssue: functionStore.bodyEditIssue, bodySourceDraft: cloneDraftValue(draft),
          sourceDraft: cloneDraftValue(draft), sourceText: draft?.text,
          codeSource: (functionStore as typeof functionStore & { codeSource?: unknown }).codeSource,
          nativeDocumentKey: functionStore.nativeDocumentKey, selectedPath: functionStore.selectedPath,
          requests: cloneDraftValue(requests), navigations: cloneDraftValue(navigations),
          error: error(), saving: saving(), lens: lens(), destroys };
      };
      return <section class="function-code-fixture">
        <button type="button" data-function-save onClick={() => void handleSave()}>Save</button>
        <button type="button" data-function-lens="expression" onClick={() => setLens("expression")}>Expression</button>
        <button type="button" data-function-lens="code" onClick={() => setLens("code")}>Code</button>
        <div data-function-error role="alert">{error()}</div>
        <div data-function-saving>{saving() ? "Saving" : "Idle"}</div>
        <div data-function-admitted-body>Admitted body: {JSON.stringify(functionStore.body)}</div>
        <div data-function-request-count>Bundle calls: {requestCount()}</div>
        <Show when={lens() === "code"} fallback={<div data-function-expression>Expression lens</div>}>
          <FunctionCodeView />
        </Show>
      </section>;
    }, host);
    flush();
  },
  functionSnapshot() { flush(); return readFunction(); },
  async saveFunction() { await saveFunctionHandler(); flush(); },
  functionLens: lens => changeFunctionLens(lens),
  loadFunction: (body, id) => loadFunction(body, id),
  resetFunction: () => resetFunction(),
  replaceFunctionBody(body) { functionStore.replaceBody(body); flush(); },
  selectFunctionStep(path) { functionStore.select(path); flush(); },
  rememberFunctionView() {
    originalFunctionView = EditorView.findFromDOM(document.querySelector<HTMLElement>(".function-code-fixture .cm-content")!);
  },
  functionDetails() {
    const content = document.querySelector<HTMLElement>(".function-code-fixture .cm-content");
    const view = content ? EditorView.findFromDOM(content) : null;
    return { sameView: view === originalFunctionView, value: view?.state.doc.toString() };
  },
  unmount() { dispose?.(); dispose = undefined; flush(); },
};

declare global {
  var codeEditorLifecycle: {
    mount(): void;
    patch(next: Partial<{ value: string; documentKey: string; readonly: boolean; wrap: boolean; height: string; placeholder: string }>): void;
    state(): unknown;
    remember(): void;
    details(): { sameView: boolean; sameInlineView: boolean; readonly?: boolean; value?: string; inlineValue?: string };
    mountFunction(): void;
    functionSnapshot(): any;
    saveFunction(): Promise<void>;
    functionLens(lens: "code" | "expression"): void;
    loadFunction(body: Expression, id?: string): void;
    resetFunction(): void;
    replaceFunctionBody(body: Expression): void;
    selectFunctionStep(path: StepPath | null): void;
    rememberFunctionView(): void;
    functionDetails(): { sameView: boolean; value?: string };
    unmount(): void;
  };
}
