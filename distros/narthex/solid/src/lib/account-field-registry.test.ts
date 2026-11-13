import { readFile } from "node:fs/promises";
// @ts-ignore -- bun:test is provided by the test runtime, not the browser tsconfig.
import { afterEach, describe, expect, test } from "bun:test";
import type { FieldPersistenceSnapshot } from "@fenel/engine/field-authoring";
import type { ModuleRegistry } from "@fenel/engine/registry";
import {
  accountFieldRegistry,
  accountFieldRegistryState,
  buildLocalAccountFieldRegistry,
  clearAccountFieldRegistry,
  ensureAccountFieldRegistryLoaded,
  installCommittedAccountFieldSnapshot,
  reloadAccountFieldRegistry,
  resolveLocalIdentifiedType,
  StaleAccountFieldRegistryLoadError,
} from "./account-field-registry";
import { fieldEditPlan } from "@fenel/engine/authoring/field-render";
import {
  filterAuthoringFunctionsByReturn,
  type AuthoringCatalogFunctionEntry,
} from "@fenel/engine/authoring/environment";
import { createAccountFieldRegistry } from "@fenel/engine/account-field-registry";
import { getSystemRegistry } from "@fenel/engine/system-registry";
import type { FenelType, FieldDef } from "@fenel/engine/types";
import { createMemo } from "solid-js";

const EMPTY: FieldPersistenceSnapshot = { owners: [], fields: [], facets: [] };

afterEach(() => clearAccountFieldRegistry());

describe("account field registry atomic lifecycle", () => {
  test("production filtering observes R1 → R2 → R1 → revision through the live accessor", async () => {
    const fieldId = "a1000000-0000-4000-8000-000000000101";
    const field = (type: FenelType): FieldDef => ({
      name: "amount",
      key: { $tag: "NamedField", ref: { $ref: fieldId } },
      label: { $tag: "Nothing" },
      type,
      meta: {},
      ui: { $tag: "Nothing" },
    });
    const record = (type: FenelType): FenelType => ({
      $record: { fields: [field(type)] },
    });
    const candidate: AuthoringCatalogFunctionEntry = {
      id: "p1a6-live-candidate",
      label: "Live candidate",
      description: "P1(a.6) registry-scope probe",
      kind: "function",
      params: [],
      // type-substrate P1(a.8): the candidate's return is now the EMPTY record
      // and the wanted type carries the coordinate, so the exclusion below is a
      // record-WIDTH refutation. See the comment on `expected`.
      returns: { $record: { fields: [] } },
    };
    // type-substrate P1(a.6): this pair used to be Number-against-Int, but
    // Number/Int/Nat are ONE validation population (`t.sub.named-arm`), so that
    // exclusion was a false definite and the enforcing scope can no longer make
    // it. The discrimination this test exists to prove — that the LIVE accessor
    // observes each registry revision — needs a want the live faces actually
    // separate.
    //
    // type-substrate P1(a.8): the `$void` coordinate that replaced it ALSO stops
    // discriminating. `record{amount: Number} ⊆ record{amount: $void}` was never
    // derived from `$void`'s emptiness — there is no void-want arm — it fell
    // through to `resolveHaveStep`, i.e. it was `t.sub.resolve` condition 2's
    // CLOSED-WORLD MISS refuting a name it could not resolve. That refutation is
    // retired, and through the `¬¬` transit the picker's `Nothing -> true`
    // default then ADMITS the candidate under every scope — a pre-authorised
    // ACCEPT-GAIN, but it leaves this test passing by uniform admission.
    //
    // The discrimination is re-sited onto a RESOLVER-FREE record-WIDTH
    // refutation: the candidate returns `record{}` and the want carries the
    // coordinate, so `record{} ⊆ record{amount: Number}` refutes for a MISSING
    // REQUIRED FIELD, decided structurally inside the same scoped product fold.
    // R1 (enforcing, no widget) projects the coordinate and still EXCLUDES; the
    // expression-widget scopes cannot and still abstain, so they admit.
    const expected: FenelType = {
      $complement: {
        $complement: record({ $ref: "Number" } as FenelType),
      },
    };
    const scopedRegistry = (wireName: string, widgetName: string): ModuleRegistry => ({
      getFieldRepresentation: (typeName: string, candidateId: string) => {
        if (typeName !== "Codeable" || candidateId !== fieldId) return undefined;
        return {
          typeName: "Codeable",
          args: [fieldId],
          methods: { codeName: wireName },
        };
      },
      resolveFieldPresentation: (candidateId: string) => {
        if (candidateId !== fieldId) throw new Error(`unresolved field ${candidateId}`);
        return {
          label: wireName,
          ...(widgetName.length === 0
            ? {}
            : { display: { widget: { $tag: "Just", _0: widgetName } } }),
          source: "uuid-field-facet",
        };
      },
    } as unknown as ModuleRegistry);
    const r1 = scopedRegistry("amount", "");
    const r2 = scopedRegistry("amountR2", "string-expression");
    const r1Revision2 = scopedRegistry("currentAmount", "markup-expression");
    const liveIds = (): string[] => filterAuthoringFunctionsByReturn(
      [candidate],
      expected,
      { registry: accountFieldRegistry() },
    ).map((fn) => fn.id);

    await installCommittedAccountFieldSnapshot("R1", EMPTY, () => r1);
    expect(accountFieldRegistryState()?.revision).toBe(1);
    expect(liveIds()).toEqual([]);

    await installCommittedAccountFieldSnapshot("R2", EMPTY, () => r2);
    expect(accountFieldRegistryState()?.revision).toBe(2);
    expect(liveIds()).toEqual([candidate.id]);

    // Warm the independent process-wide registry and an opposite detached
    // scope between live reads. Neither is presentation authority here.
    const system = getSystemRegistry();
    system.getFieldRepresentation("Codeable", fieldId);
    expect(filterAuthoringFunctionsByReturn(
      [candidate],
      expected,
      { registry: r1Revision2 },
    ).map((fn) => fn.id)).toEqual([candidate.id]);

    await installCommittedAccountFieldSnapshot("R1", EMPTY, () => r1);
    expect(accountFieldRegistryState()?.revision).toBe(3);
    expect(liveIds()).toEqual([]);

    await installCommittedAccountFieldSnapshot("R1", EMPTY, () => r1Revision2);
    expect(accountFieldRegistryState()?.revision).toBe(4);
    expect(liveIds()).toEqual([candidate.id]);
  }, 900_000);

  test("publishes only after a successful build and retains the prior registry on failure", async () => {
    const first = { marker: "first" } as unknown as ModuleRegistry;
    const second = { marker: "second" } as unknown as ModuleRegistry;

    await installCommittedAccountFieldSnapshot("acct", EMPTY, () => first);
    expect(accountFieldRegistryState()?.registry).toBe(first);
    expect(accountFieldRegistryState()?.revision).toBe(1);

    await expect(installCommittedAccountFieldSnapshot("acct", EMPTY, () => {
      throw new Error("invalid committed graph");
    })).rejects.toThrow("invalid committed graph");
    expect(accountFieldRegistryState()?.registry).toBe(first);
    expect(accountFieldRegistryState()?.revision).toBe(1);

    await installCommittedAccountFieldSnapshot("acct", EMPTY, () => second);
    expect(accountFieldRegistryState()?.registry).toBe(second);
    expect(accountFieldRegistryState()?.revision).toBe(2);
  });

  test("an older account hydration cannot overwrite a newer account", async () => {
    let resolveA!: (snapshot: FieldPersistenceSnapshot) => void;
    let resolveB!: (snapshot: FieldPersistenceSnapshot) => void;
    const loads = new Map<string, Promise<FieldPersistenceSnapshot>>([
      ["A", new Promise((resolve) => { resolveA = resolve; })],
      ["B", new Promise((resolve) => { resolveB = resolve; })],
    ]);
    const dependencies = {
      load: (accountId: string) => loads.get(accountId)!,
      build: (accountId: string) => ({ accountId } as unknown as ModuleRegistry),
    };

    const oldLoad = ensureAccountFieldRegistryLoaded("A", dependencies)
      .catch((error) => error);
    const newLoad = ensureAccountFieldRegistryLoaded("B", dependencies);
    resolveB(EMPTY);
    await newLoad;
    expect(accountFieldRegistryState()?.accountId).toBe("B");

    resolveA(EMPTY);
    expect(await oldLoad).toBeInstanceOf(StaleAccountFieldRegistryLoadError);
    expect(accountFieldRegistryState()?.accountId).toBe("B");
  });

  test("an older same-account hydration cannot overwrite a committed mutation response", async () => {
    let resolveOld!: (snapshot: FieldPersistenceSnapshot) => void;
    const oldLoad = ensureAccountFieldRegistryLoaded("A", {
      load: () => new Promise((resolve) => { resolveOld = resolve; }),
      build: () => ({ marker: "old" } as unknown as ModuleRegistry),
    }).catch((error) => error);

    const fresh = { marker: "fresh" } as unknown as ModuleRegistry;
    await reloadAccountFieldRegistry("A", {
      load: async () => EMPTY,
      build: () => fresh,
    });
    expect(accountFieldRegistryState()?.registry).toBe(fresh);

    resolveOld(EMPTY);
    expect(await oldLoad).toBeInstanceOf(StaleAccountFieldRegistryLoadError);
    expect(accountFieldRegistryState()?.registry).toBe(fresh);
  });

  test("bundle saves capture the initiating account before network IO", async () => {
    const apiSource = (await readFile(new URL("./api.ts", import.meta.url), "utf8"))
      .replaceAll("\r\n", "\n");
    expect(apiSource.indexOf("const initiatingAccountId")).toBeLessThan(
      apiSource.indexOf("const response = await apiFetch<{ snapshot: FieldPersistenceSnapshot }>(\"/definition-bundles\""),
    );
    expect(apiSource).toContain("currentAccountId === initiatingAccountId");
    expect(apiSource).toContain("await reloadAccountFieldRegistry(initiatingAccountId)");
    expect(apiSource).toContain("Definition bundle committed, but the account field registry could not refresh:");
  });

  test("out-of-order post-commit refetches publish only the newest graph", async () => {
    const newestRegistry = { marker: "new" } as unknown as ModuleRegistry;
    let resolveOld!: (snapshot: FieldPersistenceSnapshot) => void;
    let resolveNew!: (snapshot: FieldPersistenceSnapshot) => void;
    const oldRefresh = reloadAccountFieldRegistry("A", {
      load: () => new Promise((resolve) => { resolveOld = resolve; }),
      build: () => ({ marker: "old" } as unknown as ModuleRegistry),
    }).catch((error) => error);
    const newRefresh = reloadAccountFieldRegistry("A", {
      load: () => new Promise((resolve) => { resolveNew = resolve; }),
      build: () => newestRegistry,
    });

    resolveNew(EMPTY);
    await newRefresh;
    resolveOld(EMPTY);
    expect(await oldRefresh).toBeInstanceOf(StaleAccountFieldRegistryLoadError);
    expect(accountFieldRegistryState()?.registry).toBe(newestRegistry);
  });

  test("synthetic editors explicitly fence inherited account identity", async () => {
    const [rendererSource, instanceEditorSource, stepEditorSource] = await Promise.all([
      readFile(new URL("./field-renderer/FieldRenderer.tsx", import.meta.url), "utf8"),
      readFile(new URL("./instances/InstanceEditor.tsx", import.meta.url), "utf8"),
      readFile(new URL("./function-editor/StepEditor.tsx", import.meta.url), "utf8"),
    ]);
    expect(rendererSource).toContain('identityMode?: "identified" | "transient"');
    expect(rendererSource).toContain("<FieldPresentationRegistryProvider registry={undefined}>");
    expect(instanceEditorSource).toContain('identityMode="transient"');
    expect(stepEditorSource).toContain('identityMode={isKnown() ? "identified" : "transient"}');
  });

  test("the browser-local public builder resolves scoped facets and fails closed on an unknown UUID", async () => {
    const fieldId = "11111111-1111-4111-8111-111111111111";
    const occurrence = (id: string) => ({
      name: "email",
      key: { $tag: "NamedField" as const, ref: { $ref: id } },
      type: { $ref: "String" as const },
      label: { $tag: "Nothing" as const },
      ui: { $tag: "Nothing" as const },
      meta: {},
    });
    const snapshot: FieldPersistenceSnapshot = {
      owners: [{
        ownerKey: "type:contact",
        kind: "type",
        storageName: "contact",
        definition: {
          id: "contact",
          type: { $record: { fields: [occurrence(fieldId)] } },
        },
      }],
      fields: [{
        id: fieldId,
        currentCodeName: "email",
        status: "live",
        realm: "account",
        reuseVisibility: "account",
      }],
      facets: [
        {
          fieldId,
          typeName: "Codeable",
          methods: { codeName: "email" },
          scope: "account",
          priority: 100,
        },
        {
          fieldId,
          typeName: "Labelable",
          methods: { label: "Public email" },
          scope: "account",
          priority: 100,
        },
      ],
    };
    const registry = await buildLocalAccountFieldRegistry(
      "public:account",
      snapshot,
      (accountId, snapshot) => createAccountFieldRegistry([], accountId, snapshot),
    );
    const identifiedType = resolveLocalIdentifiedType(registry, {
      rootTypeName: "contact",
      snapshot,
    });
    const identifiedField = "$record" in identifiedType
      ? identifiedType.$record.fields[0]!
      : occurrence("missing");

    expect(identifiedField.key).toEqual({ $tag: "NamedField", ref: { $ref: fieldId } });
    expect(fieldEditPlan({ registry, field: identifiedField }).label).toBe("Public email");
    expect(() => fieldEditPlan({
      registry,
      field: occurrence("99999999-9999-4999-8999-999999999999"),
    })).toThrow("unresolved field presentation");
  }, 600_000);

  test("public page and embed consumers hydrate before product planning and propagate the local registry", async () => {
    const [pageSource, widgetSource] = await Promise.all([
      readFile(new URL("../routes/p/[accountSlug]/[pageSlug].tsx", import.meta.url), "utf8"),
      readFile(new URL("./widget/FenelForm.tsx", import.meta.url), "utf8"),
    ]);
    expect(pageSource).toContain("await buildLocalAccountFieldRegistry(");
    expect(pageSource).toContain("resolveLocalIdentifiedType(registry, data.fieldRegistry)");
    expect(pageSource).toContain("registry: data?.registry");
    expect(pageSource).toContain("registry={data().registry}");
    expect(pageSource).toContain("const routeSource = createMemo(");
    expect(pageSource).toContain("data?.routeKey === routeSource().routeKey");
    expect(pageSource).toContain("if (activeSubmission === submission && routeSource() === request)");
    expect(widgetSource).toContain("await buildLocalAccountFieldRegistry(");
    expect(widgetSource).toContain("resolveLocalIdentifiedType(registry, definition.fieldRegistry)");
    expect(widgetSource).toContain("definition: data?.definition");
    expect(widgetSource).toContain("registry: data?.registry");
    expect(widgetSource).toContain("registry={data().registry}");
    expect(widgetSource).toContain("const requestSource = createMemo(");
    expect(widgetSource).toContain("/embed/forms/${encodeURIComponent(request.formSlug)}");
    expect(widgetSource).toContain("d?.requestKey === requestSource().requestKey");
    expect(widgetSource).toContain("setResult(undefined)");
    const propsBlock = widgetSource.slice(
      widgetSource.indexOf("export type FenelFormProps"),
      widgetSource.indexOf("type FormDef"),
    );
    expect(propsBlock).not.toContain("registry:");
  });

  test("authenticated routes gate on the matching account registry and private clients rely on session auth", async () => {
    const [layoutSource, apiSource, querySource, tableSource, homeSource] = await Promise.all([
      readFile(new URL("../routes/app.tsx", import.meta.url), "utf8"),
      readFile(new URL("./api.ts", import.meta.url), "utf8"),
      readFile(new URL("../routes/app/query.tsx", import.meta.url), "utf8"),
      readFile(new URL("./data-table/DataTable.tsx", import.meta.url), "utf8"),
      readFile(new URL("./home-entry.tsx", import.meta.url), "utf8"),
    ]);
    expect(layoutSource).toContain("current?.accountId === accountId ? current.registry : undefined");
    expect(layoutSource).toContain("when={isHomeSurface() || readyFieldRegistry()}");
    expect(layoutSource).toContain("registry={readyFieldRegistry()}");
    // Only the lightweight Home shell may mount before hydration. Its typed
    // workspace still requires the current session's checked registry.
    expect(homeSource).toContain("const showingWorkspace = createMemo(() => !!(props.pane || requested()) && currentReads() && !failed() && workspace.ready()");
    expect(homeSource).toContain("<Show when={showingWorkspace()}");
    expect(homeSource).toContain("request()?.epoch === sessionEpoch()");
    // One root read since 2026-09-23 (it replaced the view-list and active-view reads).
    expect(homeSource).toContain("rootData().epoch === sessionEpoch()");
    expect(layoutSource).toContain("setApiAccountScope(accountId)");
    expect(apiSource).not.toContain("VITE_ACCOUNT_ID");
    expect(apiSource).not.toContain('"X-Account-Id"');
    expect(querySource).not.toContain("X-Account-Id");
    expect(tableSource).not.toContain("X-Account-Id");
  });
});
