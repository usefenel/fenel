import { createEffect, createMemo, createSignal, Errored, For, Loading, Show, untrack } from "solid-js";
import { entitySchemaFields } from "@fenel/engine";
import { Just, Nothing, type Maybe } from "@fenel/engine/type-foundation";
import { DETACHED_AUTHORING_SESSION } from "./expression-runner/authoring-session";
import { FieldRenderer } from "./field-renderer";
import { ModalOverlay } from "./confirm-modal";
import { defaultLensShortcuts, textLensShortcuts, type LensShortcut } from "./lens-shortcuts";
import { ReaderRuntimeProvider, type ReaderRuntime } from "./reader-runtime";
import { localTextShortcuts } from "./expression-runner/local-editor-reads";
import { sessionEpoch } from "./browser-session";
import type { WorkspaceBar, WorkspacePreferences } from "./workspace-wire";

export default function WorkspaceSettings(props: { value: WorkspacePreferences; persistent: boolean; onClose: () => void;
  reader?: ReaderRuntime;
  onSave: (bar: WorkspaceBar, lens?: { id: string; shortcuts: Maybe<LensShortcut[]> }) => void | Promise<void> }) {
  // A background active-lens change must not redirect an open settings draft.
  const origin = untrack(() => ({ epoch: sessionEpoch(),
    lens: props.value.lenses.find(lens => lens.id === props.value.activeLensId) }));
  const matchesOrigin = (reader: ReaderRuntime | undefined) => {
    const source = origin.lens?.source;
    return !!reader && reader.epoch === origin.epoch && !!source
      && (source.$tag === "PublicSource" || source.$tag === "AllDataSource" ? reader.kind === "public"
        : source.$tag === "ThisTabSource" ? reader.kind === "local"
        : reader.kind === "account" && reader.accountId === source.accountId);
  };
  // Opening settings can precede reader readiness. Adopt its first matching
  // runtime without changing the lens/draft or admitting a later replacement.
  const [capturedReader, setCapturedReader] = createSignal<ReaderRuntime | undefined>(
    untrack(() => matchesOrigin(props.reader) ? props.reader : undefined));
  createEffect(() => props.reader, reader => {
    if (!untrack(capturedReader) && matchesOrigin(reader)) setCapturedReader(reader);
  });
  const [draft, setDraft] = createSignal(untrack(() => ({ bar: props.value.bar,
    shortcuts: origin.lens?.shortcuts ?? Nothing as Maybe<LensShortcut[]> })));
  const [issue, setIssue] = createSignal<string>();
  const [saving, setSaving] = createSignal(false);
  const fields = createMemo(() => {
    try {
      const reader = capturedReader();
      const registry = reader?.registry() ?? DETACHED_AUTHORING_SESSION.registry;
      // B4 F1: a Local reader resolves its two definitions inertly over its
      // own and its worker-published declarations (`resolveTypeName`); its
      // registry is only the field owner handed to FieldRenderer.
      const local = reader?.kind === "local" && reader.resolveTypeName ? reader.resolveTypeName : undefined;
      const declared = (name: string) => {
        if (!local) return registry.getIdentifiedEntity(name);
        const type = local(name);
        return type ? { type } : undefined;
      };
      const definition = declared("WorkspacePreferences");
      const lensDefinition = reader && declared("WorkspaceLens");
      return { registry, bar: definition ? entitySchemaFields(definition).filter(field => field.name === "bar") : [],
        shortcuts: lensDefinition ? entitySchemaFields(lensDefinition).find(field => field.name === "shortcuts") : undefined,
        issue: definition ? undefined : "Lens settings are preparing. Close this dialog and retry when the data is ready." };
    } catch (problem) {
      return { registry: undefined, bar: [], shortcuts: undefined,
        issue: problem instanceof Error ? problem.message : "This reader could not prepare lens settings." };
    }
  });
  const [preparingShortcuts, setPreparingShortcuts] = createSignal(false);
  function useTextShortcuts() {
    try {
      const reader = capturedReader();
      if (!reader) throw new Error("The text shortcuts are preparing. Try again when this lens's data is ready.");
      if (reader.kind === "local") {
        // B4 wave 4 lane E: a Local reader prepares them in its worker
        // (`project-reader-text-shortcuts`); its page frame is never read. The
        // answer is applied only while this dialog keeps the same reader.
        setPreparingShortcuts(true);
        setIssue(undefined);
        void localTextShortcuts(reader, () => reader.session()).then(list => {
          if (capturedReader() !== reader) return;
          setDraft(current => ({ ...current, shortcuts: Just(list) }));
          setIssue(undefined);
        }, (problem: unknown) => {
          if (capturedReader() !== reader) return;
          setIssue(problem instanceof Error ? problem.message : "The text shortcuts could not be prepared.");
        }).finally(() => setPreparingShortcuts(false));
        return;
      }
      const session = reader.session();
      const shortcuts = Just([...defaultLensShortcuts(session), ...textLensShortcuts(session)]);
      setDraft(current => ({ ...current, shortcuts }));
      setIssue(undefined);
    } catch (problem) {
      setIssue(problem instanceof Error ? problem.message : "The text shortcuts could not be prepared.");
    }
  }
  async function save() {
    if (saving()) return;
    if (capturedReader() && origin.lens && !fields().shortcuts) {
      setIssue("Shortcut editing is preparing. Close this dialog and retry when the data is ready.");
      return;
    }
    setSaving(true);
    setIssue(undefined);
    try {
      await props.onSave(draft().bar, capturedReader() && origin.lens
        ? { id: origin.lens.id, shortcuts: draft().shortcuts } : undefined);
    } catch (problem) {
      setIssue(problem instanceof Error ? problem.message : "The lens settings could not be saved.");
    } finally { setSaving(false); }
  }
  return <ModalOverlay class="confirm-modal__overlay" onClick={event => { if (event.target === event.currentTarget) props.onClose(); }}
    onKeyDown={event => { if (event.key === "Escape") props.onClose(); }}>
    <div class="confirm-modal__box workspace-settings" role="dialog" aria-modal="true" aria-label="Lens settings">
      <h2>Lens settings</h2>
      <For each={fields().bar}>{field => <FieldRenderer field={field} registry={fields().registry} value={draft().bar}
        onChange={next => setDraft(current => ({ ...current, bar: next as WorkspaceBar }))} />}</For>
      <Show when={fields().issue}>{message => <p role="alert">{message()}</p>}</Show>
      <section aria-label="Saved lens shortcuts">
        <h3>Shortcuts for this lens</h3>
        <p class="text-muted">Choose the buttons for this lens. Each shortcut is data you can edit below.</p>
        <Show when={origin.lens && capturedReader()} fallback={<p role="status">Shortcut editing is preparing for this lens…</p>}>
          <Show when={fields().shortcuts} fallback={<p role="status">Shortcut editing is preparing. Close this dialog and retry when this lens's data is ready.</p>}>
            {field => <>
              <button type="button" class="btn" onClick={useTextShortcuts} disabled={saving() || preparingShortcuts()}
                aria-busy={preparingShortcuts() ? "true" : "false"}>{preparingShortcuts() ? "Preparing text shortcuts…" : "Use text shortcuts"}</button>
              <Errored fallback={problem => <p role="alert">{(() => {
                const error = problem();
                return error instanceof Error ? error.message : "The shortcut editor could not be prepared.";
              })()}</p>}>
                <Loading fallback={<p role="status">Preparing shortcut editing…</p>}>
                  <ReaderRuntimeProvider runtime={capturedReader()!}>
                    <FieldRenderer field={field()} registry={fields().registry} callableRegistry={capturedReader()!.registry()}
                      value={draft().shortcuts} onChange={next => {
                        setDraft(current => ({ ...current, shortcuts: next as Maybe<LensShortcut[]> }));
                        setIssue(undefined);
                      }} />
                  </ReaderRuntimeProvider>
                </Loading>
              </Errored>
            </>}
          </Show>
        </Show>
      </section>
      <Show when={issue()}>{message => <p role="alert">{message()}</p>}</Show>
      <Show when={!props.persistent}><p class="text-muted">Sign in to keep your lenses between visits.</p></Show>
      <div class="confirm-modal__actions"><button class="confirm-modal__btn confirm-modal__btn--cancel" onClick={props.onClose}>Cancel</button>
        <button class="confirm-modal__btn confirm-modal__btn--primary" disabled={saving() || fields().bar.length === 0}
          onClick={() => { void save(); }}>{saving() ? "Saving…" : "Save"}</button></div>
    </div>
  </ModalOverlay>;
}
