import { Errored, Loading, Show, createMemo, createSignal, untrack } from "solid-js";
import type { FenelType, FieldDef } from "@fenel/engine/types";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { queryFieldReuseCatalogCandidates, type FieldReuseCatalogCandidate, type FieldReuseCatalogRow } from "@fenel/engine/field-authoring";
import { canonical } from "@fenel/engine/locale";
import { typeCode } from "@fenel/engine/authoring/expression";
import { printFenel } from "@fenel/engine";
import { Nothing } from "@fenel/engine/type-foundation";
import { AuthoringSessionContext, type AuthoringSession } from "./expression-runner/authoring-session";
import { isInertAuthoringSession } from "./expression-runner/account-authoring-session";
import { authoringWorkerSnapshot, preparedReaderWorkerForSession, runPreparedReaderWorker } from "./expression-runner/authoring-catalog-worker";
import type { AuthoringSetMembership } from "./expression-runner/authoring-worker-reader-extensions";
import { typeToSetExpr } from "@fenel/engine/fenel-check";
import type { Maybe } from "@fenel/engine/type-foundation";
import { inlineWidgetFor } from "./expression-runner/inline-widgets";
import { checkScopedDataMembership } from "./expression-runner/literal-membership";
import { TypeBuilder } from "./type-builder/TypeBuilder";
import { FieldRenderer } from "./field-renderer";
import { TypedReadValue } from "./layout-renderer/TypedReadValue";
import { DataValueSurface } from "./data-transfer/DataValueSurface";
import { cloneDraftValue } from "./native-draft";
import { ApiClientContext, useApiClient, type ApiClient, type FieldAuthoringCatalogRow } from "./api";
import { FieldAuthoringProvider, forgetFieldFacetDrafts, namedFieldId, type FieldFacetDraftMap } from "./field-occurrence";
import "./type-data-playground.css";

/** B4 wave 4 lane S: a frameless (Local) session checks in its worker
 * (`check-set-membership`, as `SetExprExamples` does). The reply counts only
 * for the worker snapshot it was asked of; without a worker, or for a replaced
 * one, it refuses with the existing copy. Undecided stays `Nothing`. */
export async function checkTypePlaygroundMembershipInWorker(type: FenelType, value: unknown,
  session: AuthoringSession): Promise<Maybe<boolean>> {
  let worker: ReturnType<typeof preparedReaderWorkerForSession>, snapshot: object | undefined;
  try { worker = preparedReaderWorkerForSession(session); snapshot = authoringWorkerSnapshot(session); }
  catch { worker = undefined; }
  if (!worker || !snapshot) throw new Error(FRAMELESS_TOOLS_PENDING);
  const reply = await runPreparedReaderWorker(worker, { method: "check-set-membership", set: typeToSetExpr(type), values: [value] });
  if (authoringWorkerSnapshot(session) !== snapshot) throw new Error("This authoring snapshot was replaced. Retry with the current data.");
  const verdict = reply && typeof reply === "object" && Array.isArray((reply as AuthoringSetMembership).verdicts)
    ? (reply as AuthoringSetMembership).verdicts[0] : undefined;
  if (!verdict || typeof verdict !== "object" || (verdict.$tag !== "Just" && verdict.$tag !== "Nothing")
    || verdict.$tag === "Just" && typeof verdict._0 !== "boolean") throw new Error("This data's check could not be read.");
  return verdict as Maybe<boolean>;
}
const FRAMELESS_TOOLS_PENDING = "This reader's editing tools are not ready. Prepare them and try again.";

/** Solid/B3 catalogue composition only. Resolve the captured type definitions
 * to the existing SetExpr boundary; Fenel owns reference walking and
 * capture-avoiding substitution. Opaque host representations keep their
 * nominal leaf, whose membership the existing dispatched set instance owns. */
export function checkTypePlaygroundMembership(type: FenelType, value: unknown, session: AuthoringSession) {
  return checkScopedDataMembership(type, value, session.environment, { evaluateContext: session.evaluateContext });
}

/** The field catalogue module holds every repository field (33,758 rows, 10 MB of
 * script) and freezes them all when it loads. Only a field picker of this editor
 * asks for its interface names: load it then, never with the read surface that
 * imports this file (the same rule the engine barrel and the worker follow). */
const fieldRepresentationalInterfaceNames = async () =>
  (await import("@fenel/engine/repository-field-catalog")).fieldRepresentationalInterfaceNames();

const repositoryReuseByRegistry = new WeakMap<ModuleRegistry, readonly FieldReuseCatalogCandidate[]>();

/** Browser metadata composition for this local editor. Positive repository
 * facts come from its captured registry; only explicit Add events prove a new
 * local field. Unknown or account identities keep the original API behavior.
 * B4 wave 4 lane S: a `frameless` (Local) session has no page registry (its
 * registry is a token): identities and the reuse catalogue come from the
 * inherited Local API client (its worker answers them), and an Add records its
 * field without a registry probe; a durable identity the client knows wins. */
export function createTypePlaygroundFieldClient(registry: ModuleRegistry, inherited: ApiClient, mode: AuthoringSession["mode"],
  frameless = false) {
  const createdFieldIds = new Set<string>();
  const repositoryFields = () => {
    const existing = repositoryReuseByRegistry.get(registry);
    if (existing) return existing;
    const fields = registry.listRepositoryReusableFieldIds().flatMap(fieldId => {
      const identity = registry.getFieldIdentityByHandle(fieldId);
      if (identity?.realm !== "repository-source") return [];
      const codeName = registry.getFieldRepresentation("Codeable", fieldId, "repository")?.methods.codeName;
      return [{
        fieldId,
        codeName: typeof codeName === "string" ? codeName : identity.field.name,
        owners: [identity.ownerLookupKey],
        occurrenceTypes: [identity.field.type],
        status: "live" as const,
        realm: "repository" as const,
        reuseVisibility: "repository" as const,
      }];
    });
    repositoryReuseByRegistry.set(registry, fields);
    return fields;
  };
  const catalogRow = (field: FieldReuseCatalogRow): FieldAuthoringCatalogRow => ({
    fieldId: field.fieldId,
    codeName: field.codeName,
    realm: field.realm,
    reuseVisibility: field.reuseVisibility,
    ...(field.label === undefined ? {} : { label: canonical(field.label) }),
    owners: [...field.owners],
    occurrenceTypes: field.occurrenceTypes.map(type => typeCode(type)),
  });
  const client: ApiClient = {
    ...inherited,
    async getFieldAuthoringIdentity(fieldId) {
      if (frameless) {
        if (!createdFieldIds.has(fieldId)) return inherited.getFieldAuthoringIdentity(fieldId);
        try {
          const known = await inherited.getFieldAuthoringIdentity(fieldId);
          if (known.field) return known;
        } catch { /* A field minted here has no durable identity to read. */ }
        return { field: null };
      }
      const identity = registry.getFieldIdentityByHandle(fieldId);
      if (identity?.realm === "repository-source") {
        const codeName = registry.getFieldRepresentation("Codeable", fieldId, "repository")?.methods.codeName;
        return { field: {
          fieldId,
          codeName: typeof codeName === "string" ? codeName : identity.field.name,
          owners: [identity.ownerLookupKey],
          occurrenceTypes: [],
          realm: "repository",
          reuseVisibility: "owner",
        } };
      }
      if (createdFieldIds.has(fieldId)) return { field: null };
      return inherited.getFieldAuthoringIdentity(fieldId);
    },
    async getFieldAuthoringCatalog(search = "", cursor) {
      if (frameless || mode !== "detached") return inherited.getFieldAuthoringCatalog(search, cursor);
      const page = queryFieldReuseCatalogCandidates(repositoryFields(), { search, cursor });
      return {
        fields: page.fields.map(catalogRow),
        facetInterfaceNames: [...await fieldRepresentationalInterfaceNames()],
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      };
    },
  };
  return {
    client,
    onFieldCreated(field: FieldDef) {
      const fieldId = namedFieldId(field);
      // A captured durable identity wins even if a broken entropy source
      // collides with it. Registry absence alone never registers a new field.
      if (fieldId && (frameless || !registry.getFieldIdentityByHandle(fieldId))) createdFieldIds.add(fieldId);
    },
    reset() { createdFieldIds.clear(); },
  };
}

/** A local composition of the universal type, data and read surfaces. The
 * captured source declaration stays unchanged; no persistence is offered. */
export function TypeDataPlayground(props: {
  type: FenelType;
  /** Positive definition already resolved by the captured reader's catalogue.
   * The original reference remains separate for source inspection. */
  initialType?: FenelType;
  session: AuthoringSession;
}) {
  const inheritedClient = useApiClient();
  const frameless = untrack(() => isInertAuthoringSession(props.session));
  const fieldMetadata = untrack(() => createTypePlaygroundFieldClient(props.session.registry, inheritedClient, props.session.mode, frameless));
  const [fieldFacets, setFieldFacets] = createSignal<FieldFacetDraftMap>({});
  const sourceType = untrack(() => cloneDraftValue(props.type));
  const initialType = untrack(() => cloneDraftValue(props.initialType ?? ("$ref" in sourceType
    ? props.session.environment.resolveTypeRef?.(sourceType)
      ?? props.session.environment.resolveNamedType?.(sourceType.$ref) ?? sourceType
    : sourceType)));
  const initialValue = untrack(() => {
    const widget = inlineWidgetFor(initialType, undefined, props.session.environment);
    return cloneDraftValue(widget?.seedValue);
  });
  const [draft, setDraft] = createSignal(cloneDraftValue(initialType));
  const [value, setValue] = createSignal<unknown>(cloneDraftValue(initialValue));
  const [decision, setDecision] = createSignal<"accepted" | "refused" | "unknown">();
  const [checkError, setCheckError] = createSignal<string>();
  const field = createMemo<FieldDef>(() => ({ name: "data", type:
    inlineWidgetFor(draft(), undefined, props.session.environment)?.type ?? draft(),
    label: Nothing, meta: {}, ui: Nothing }));
  const sourceCode = createMemo(() => printFenel({ type_sig: { name: "data", type: sourceType } }));
  const draftCode = createMemo(() => printFenel({ type_sig: { name: "data", type: draft() } }));

  function changeType(next: FenelType) {
    setDraft(cloneDraftValue(next));
    setDecision(undefined);
    setCheckError(undefined);
  }
  function changeValue(next: unknown) {
    setValue(() => cloneDraftValue(next));
    setDecision(undefined);
    setCheckError(undefined);
  }
  function reset() {
    fieldMetadata.reset();
    setFieldFacets({});
    setDraft(cloneDraftValue(initialType));
    setValue(() => cloneDraftValue(initialValue));
    setDecision(undefined);
    setCheckError(undefined);
  }
  let checking = 0;
  function check() {
    setDecision(undefined);
    setCheckError(undefined);
    if (frameless) {
      // A reply counts only for the draft and data it was asked of.
      const run = ++checking, type = draft(), data = value();
      const current = () => run === checking && type === draft() && data === value();
      void checkTypePlaygroundMembershipInWorker(type, data, props.session).then(verdict => {
        if (current()) setDecision(verdict.$tag === "Just" ? verdict._0 ? "accepted" : "refused" : "unknown");
      }, error => { if (current()) setCheckError(error instanceof Error ? error.message : String(error)); });
      return;
    }
    try {
      const verdict = checkTypePlaygroundMembership(draft(), value(), props.session);
      setDecision(verdict.$tag === "Just" ? verdict._0 ? "accepted" : "refused" : "unknown");
    } catch (error) {
      setCheckError(error instanceof Error ? error.message : String(error));
    }
  }

  return <AuthoringSessionContext value={props.session}><ApiClientContext value={fieldMetadata.client}>
    <div class="type-data-playground">
      <div class="type-data-playground__intro">
        <p>Change the type and its input changes with it. Try adding a field, then fill it in.</p>
        <button type="button" class="btn" onClick={reset}>Reset example</button>
      </div>
      <p class="type-data-playground__local">The type and data are temporary. The original stays unchanged.</p>
      <div class="type-data-playground__columns">
        <section class="type-data-playground__panel" aria-label="Draft type">
          <h3>Type</h3>
          <FieldAuthoringProvider facetsByFieldId={fieldFacets()}
            onFieldCreated={fieldMetadata.onFieldCreated}
            onFieldFacetsChange={(fieldId, next) => setFieldFacets(current => ({ ...current, [fieldId]: next }))}
            onFieldFacetsForget={fieldId => setFieldFacets(current => forgetFieldFacetDrafts(current, fieldId))}>
            <TypeBuilder value={draft()} onChange={changeType} authoringSession={props.session} />
          </FieldAuthoringProvider>
          <details class="type-data-playground__source"><summary>Fenel type</summary><pre>{draftCode()}</pre></details>
          <details class="type-data-playground__source"><summary>Original type</summary><pre>{sourceCode()}</pre></details>
        </section>
        <section class="type-data-playground__panel" aria-label="Generated input">
          <h3>Input from this type</h3>
          <Errored fallback={error => <p class="data-error" role="alert">{String(error())}</p>}>
            <Loading fallback={<p class="text-muted">Preparing input…</p>}>
              <FieldRenderer field={field()} value={value()} onChange={changeValue}
                identityMode="transient" callableRegistry={props.session.registry} compact />
            </Loading>
          </Errored>
          <div class="type-data-playground__check">
            <button type="button" class="btn" onClick={check} disabled={value() === undefined}>Check data</button>
            <Show when={decision()}>{result => <p role="status" data-type-data-verdict={result()}>
              {result() === "accepted" ? "This data belongs to the type."
                : result() === "refused" ? "This data does not satisfy the type."
                : "Membership is undecided."}
            </p>}</Show>
            <Show when={checkError()}>{message => <p class="data-error" role="alert">Could not check this data: {message()}</p>}</Show>
          </div>
          <details class="type-data-playground__data" open><summary>Current data</summary>
            <Show when={value() !== undefined} fallback={<p class="text-muted">Fill in the input to create data.</p>}>
              <Errored fallback={error => <p class="data-error" role="alert">{String(error())}</p>}>
                <Loading fallback={<p class="text-muted">Preparing data…</p>}>
                  <DataValueSurface value={value()} type={draft()} label="Current data" session={() => props.session}
                    presentation={<TypedReadValue value={value()} type={draft()} fieldRegistry={props.session.registry} templateOnly />} />
                </Loading>
              </Errored>
            </Show>
          </details>
        </section>
      </div>
    </div>
  </ApiClientContext></AuthoringSessionContext>;
}
