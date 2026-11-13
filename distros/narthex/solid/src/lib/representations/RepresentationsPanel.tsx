// ---------------------------------------------------------------------------
// RepresentationsPanel -- temporary compatibility wrapper.
//
// Phase 3 of ux-parity replaces the old fixed representation authoring model
// with the general InstanceEditor substrate. This wrapper keeps the old import
// path and draft prop shape alive for existing create flows while translating
// everything to ordinary Instance drafts keyed by `typeName`.
// ---------------------------------------------------------------------------

import { Show, createMemo, createSignal } from "solid-js";
import { createAsyncValue } from "~/lib/async-value";
import {
  dispatchRegistry,
  type Instance,
} from "@fenel/engine";
import { InstanceEditor, type InstanceApiRow, type InstanceDraft } from "~/lib/instances";
import {
  draftsToRepresentationMethods,
  representationMethodsToDrafts,
} from "~/lib/instances/instance-draft";
import { decodedRepresentationBody, persistRepresentation, persistInstanceDraft } from "./persist";
import { defaultApiClient, useApiClient } from "~/lib/api";
import { sessionEpoch } from "~/lib/browser-session";
import { accountFieldRegistry } from "~/lib/account-field-registry";
import { useFieldPresentationRegistry } from "~/lib/field-renderer/field-presentation-context";
import { useReaderRuntime } from "~/lib/reader-runtime";
import { GLOBAL_ONLY, instanceVisible } from "@fenel/engine";

export type RepresentationsPanelProps = {
  targetLabel?: string;
  startOpen?: readonly string[];
  structuralForType?: string;
} & (
  | {
      mode?: "live";
      targetId: string;
      onPersist?: (typeName: string, methods: Record<string, unknown>) => void;
    }
  | {
      mode: "draft";
      drafts: Record<string, Record<string, unknown>>;
      onDraftsChange: (next: Record<string, Record<string, unknown>>) => void;
    }
);

function rowFromInstance(inst: Instance): InstanceApiRow {
  return {
    typeName: inst.typeName,
    args: inst.args as unknown[],
    instance: inst,
  };
}

export function RepresentationsPanel(props: RepresentationsPanelProps) {
  const client = useApiClient();
  const readerRegistry = useFieldPresentationRegistry();
  const reader = useReaderRuntime();
  const [revision, setRevision] = createSignal(0);

  const accountRows = createAsyncValue(
    () => props.mode === "draft" || !props.targetId ? false : { target: props.targetId, revision: revision(), epoch: sessionEpoch() },
    async (scope) => {
      const response = await client.apiFetch<{ dispatchInstances?: InstanceApiRow[]; specInstances?: InstanceApiRow[] }>("/dispatch-instances");
      return { ...scope, rows: (response.dispatchInstances ?? response.specInstances ?? []).filter((row) => (row.args ?? row.instance?.args)?.[0] === scope.target) };
    },
  );

  const rows = createMemo<InstanceApiRow[]>(() => {
    void revision();
    if (props.mode === "draft") return [];
    if (!props.targetId) return [];
    // Editable rows are actual attached instances. Calling the dispatch
    // resolver here also derives predicates and can execute expensive proofs.
    // Derived introspection is an explicit section in InstanceEditor instead.
    // rights R3a — GLOBAL_ONLY, DECLARED (§8.1b). The panel lists the
    // representation rows ATTACHED to a target; the browser registry derives no
    // account, so it lists the repository's. An account's own attached rows are
    // still fetched separately below (`accountRows`), through a server call that
    // does know the account.
    const explicit = reader?.kind === "local" ? [] : dispatchRegistry.listInstances().filter((instance) => instance.args[0] === props.targetId && instanceVisible(instance, GLOBAL_ONLY)).map(rowFromInstance);
    const loaded = accountRows.error ? undefined : accountRows();
    return loaded?.target === props.targetId && loaded.epoch === sessionEpoch()
      ? [...explicit, ...loaded.rows]
      : explicit;
  });

  const draftInstances = createMemo<Record<string, InstanceDraft>>(() => {
    if (props.mode !== "draft") return {};
    return representationMethodsToDrafts(props.drafts);
  });

  return (
    <>
    <Show when={accountRows.error}><div class="admin-form-error">Could not load saved representations.</div></Show>
    <InstanceEditor
      mode={props.mode ?? "live"}
      variant="display"
      title="Representations"
      targetId={props.mode === "draft" ? undefined : props.targetId}
      targetLabel={props.targetLabel}
      structuralForType={props.structuralForType}
      interfaceFamily="representational"
      defaultOpenInterfaces={props.startOpen}
      rows={rows()}
      drafts={draftInstances()}
      onDraftsChange={(next) => {
        if (props.mode === "draft") {
          props.onDraftsChange(draftsToRepresentationMethods(next));
        }
      }}
      onSave={async (body, row, capturedEncoding) => {
        if (props.mode === "draft") return;
        const targetId = props.targetId, rowId = row?.id, onPersist = props.onPersist;
        const canContinue = (current: RepresentationsPanelProps = props) =>
          current.mode !== "draft" && current.targetId === targetId && current.onPersist === onPersist;
        const assertCurrent = () => {
          if (!canContinue()) throw new Error("This data changed while preparing the edit. Try again with its current contents.");
        };
        const rowArgs = row?.args ?? row?.instance?.args;
        if (body.instance.args[0] !== targetId || rowArgs && rowArgs[0] !== targetId)
          throw new Error("This data changed while preparing the edit. Try again with its current contents.");
        // B4 unit E: a Local reader encodes and decodes in its own worker.
        const registry = reader?.kind === "local" ? capturedEncoding ?? client.instanceEncoding!()
          : readerRegistry() ?? (client === defaultApiClient ? accountFieldRegistry() ?? undefined : undefined);
        // A successful Local write publishes a new snapshot. Decode the
        // callback data while its captured encoding still belongs to this one.
        const current = await decodedRepresentationBody(body, registry);
        assertCurrent();
        if (rowId) await persistInstanceDraft(body.instance, rowId, body.valueEncoding, client, registry, canContinue);
        else await persistRepresentation(body.typeName, targetId, body.instance.methods, body.valueEncoding, client, registry, canContinue);
        if (!canContinue()) return;
        onPersist?.(body.typeName, current.methods as Record<string, unknown>);
        if (canContinue()) setRevision((r) => r + 1);
      }}
    />
    </>
  );
}
