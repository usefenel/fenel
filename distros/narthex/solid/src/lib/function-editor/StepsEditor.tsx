import { Show, createEffect } from "solid-js";
import { closeModalDialog, openModalDialog } from "../confirm-modal";
import type { FenelFunction, FieldDef } from "@fenel/engine/types";
import { cloneDraftValue, draftValueFingerprint } from "~/lib/native-draft";
import { TreeStepList } from "./TreeView";
import { StepEditor } from "./StepEditor";
import { createFunctionEditorStore, FunctionEditorContext } from "./store";
import "../../routes/app/function-editor.css";

/** A body lens over the existing step editor, with an isolated composer draft. */
export function StepsEditor(props: {
  body: FenelFunction["body"];
  params: FieldDef[];
  name: string;
  onChange: (body: FenelFunction["body"]) => void;
  /** A local source draft must be completed before its unchanged IR can save. */
  onIssueChange?: (issue: string | undefined) => void;
}) {
  const store = createFunctionEditorStore();
  let dialog: HTMLDialogElement | undefined;
  let installedExternal: string | undefined;
  let syncingBody: string | undefined;

  createEffect(() => ({ body: cloneDraftValue(props.body), fingerprint: draftValueFingerprint(props.body), current: draftValueFingerprint(store.body) }),
    (draft) => {
      if (installedExternal === draft.fingerprint) return;
      installedExternal = draft.fingerprint;
      if (draft.current !== draft.fingerprint) {
        syncingBody = draft.fingerprint;
        store.replaceBody(draft.body);
      }
    });
  createEffect(() => ({ params: cloneDraftValue(props.params), name: props.name }), (draft) => {
    store.setParams(draft.params);
    store.setName(draft.name);
  });
  createEffect(() => ({
    body: cloneDraftValue(store.body), dirty: store.dirty,
    fingerprint: draftValueFingerprint(store.body), external: draftValueFingerprint(props.body),
  }), (draft) => {
    if (syncingBody !== undefined) {
      if (draft.fingerprint === syncingBody) syncingBody = undefined;
      return;
    }
    if (draft.dirty && draft.fingerprint !== draft.external) props.onChange(draft.body);
  });
  createEffect(() => store.pendingDelete, (pending) => {
    if (!dialog) return;
    if (pending) openModalDialog(dialog); else closeModalDialog(dialog);
  });
  createEffect(() => store.bodyEditIssue, (issue) => { props.onIssueChange?.(issue); });

  return <FunctionEditorContext value={store}>
    <div class="function-composer-steps">
      <Show when={!store.bodyRequiresCode} fallback={
        <div>
          <p class="text-muted">This body has no matching steps lens. Use the expression lens to keep editing it.</p>
          <button type="button" class="btn" onClick={() => props.onChange({ do: [] })}>Replace body with empty steps</button>
        </div>
      }>
        <TreeStepList steps={store.state.steps} basePath={[]} />
        <Show when={store.selectedPath}>
          <div class="function-composer-steps__detail">
            <div class="function-composer-steps__detail-head">
              <strong>Edit step</strong>
              <button type="button" class="btn" onClick={() => store.select(null)}>Close step</button>
            </div>
            <StepEditor />
          </div>
        </Show>
      </Show>
      <dialog ref={(element) => { dialog = element; }} class="fe-dialog" onClose={() => store.cancelDelete()}
        onCancel={event => { event.preventDefault(); store.cancelDelete(); }}>
        <div class="fe-dialog-body">
          <p>Delete this step?</p>
          <div class="fe-dialog-actions">
            <button type="button" class="fe-btn" onClick={() => store.cancelDelete()}>Cancel</button>
            <button type="button" class="fe-btn fe-btn--danger" onClick={() => store.confirmDelete()}>Delete</button>
          </div>
        </div>
      </dialog>
    </div>
  </FunctionEditorContext>;
}
