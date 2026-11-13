import "../../../../../../implementations/typescript/engine/src/engine-body-host-install";
import { describe, expect, test } from "bun:test";
import type { AuthoringSession } from "./account-authoring-session";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { FenelType, TypeScheme } from "@fenel/engine/types";

// Demo 1 typed entry (2026-11-07): the Local type builder stores a picked std
// type as its exact identity handle (Phone = `{$ref: <PhoneStr UUID>}`), as it
// stores a Local type (Person) and time.CalendarDate. Entering data of those
// types must decide membership of a typed phone, a nested plain Person record
// and a CalendarDate record, and the saved-value picker must find a saved
// Person. One actual Local registry; run alone in the shared heavy slot:
//   bun --no-env-file test --timeout 600000 ./src/lib/expression-runner/local-typed-entry.test.ts  (distro dir)
const SOURCE = "fenel-browser-local-typed-entry";
const [reader, catalogue, artifact, detached, mint, membershipModule, validation, environmentModule] = await Promise.all([
  import("../reader-registry"), import("./authoring-catalog"),
  import("./authoring-catalogue-artifact"), import("./detached-authoring-environment"),
  import("../../../../../../implementations/typescript/runtime/src/authority-mint"), import("./literal-membership"),
  import("./creation-validation"), import("@fenel/engine/authoring/environment"),
]);
const nothing = { $tag: "Nothing" } as const;
const ids = {
  person: "6f1c1d8e-3a43-4c6e-9d55-0b7a9c2f4e12", transaction: "0b2e7a55-8f3d-4f8b-a4a1-5d9c3e6b7f23",
  name: "1c4f0e2a-6b5d-4a3e-8f7c-9d2b1a0e3c45", phone: "2d5a1f3b-7c6e-4b4f-9a8d-0e3c2b1f4d56",
  amount: "3e6b2a4c-8d7f-4c5a-ab9e-1f4d3c2a5e67", personField: "4f7c3b5d-9e8a-4d6b-bc0f-2a5e4d3b6f78",
  date: "5a8d4c6e-af9b-4e7c-8d1a-3b6f5e4c7a89",
};
const field = (id: string, name: string, type: unknown) => ({ name, key: { $tag: "NamedField", ref: { $ref: id } }, type,
  label: nothing, ui: nothing, meta: {} });
const durable = (id: string, name: string) => ({ id, currentCodeName: name, status: "live" as const, realm: "account" as const, reuseVisibility: "account" as const });
const bootstrap = await reader.buildLocalReaderFieldRegistry(SOURCE, { owners: [], fields: [], facets: [] }, { preparation: "inline", representations: [] });
// The type builder's handles: the exact repository identities, as stored in the real app.
const phoneUuid = bootstrap.getUuid("PhoneStr");
const calendarDate = bootstrap.getUuid("CalendarDate");
if (!phoneUuid || !calendarDate) throw new Error("PhoneStr / CalendarDate have no repository identity; regenerate the identity artifacts first.");
const saved = await reader.planLocalDefinitionBundle(SOURCE, { owners: [], fields: [
  durable(ids.name, "name"), durable(ids.phone, "phone"), durable(ids.amount, "amount"), durable(ids.personField, "person"), durable(ids.date, "date"),
], facets: [] }, { ownerMutations: [
  { kind: "upsert", owner: { kind: "type", ownerKey: `type:${ids.person}`, storageName: ids.person,
    definition: { id: ids.person, type: { $record: { fields: [field(ids.name, "name", { $ref: "String" }), field(ids.phone, "phone", { $ref: phoneUuid })] } } } } },
  { kind: "upsert", owner: { kind: "type", ownerKey: `type:${ids.transaction}`, storageName: ids.transaction,
    definition: { id: ids.transaction, type: { $record: { fields: [field(ids.amount, "amount", { $ref: "Number" }),
      field(ids.personField, "person", { $ref: ids.person }), field(ids.date, "date", { $ref: calendarDate })] } } } } },
] } as never);
const registry = await reader.buildLocalReaderFieldRegistry(SOURCE, saved, { preparation: "inline", representations: [] });
const frame = Object.freeze({ ...catalogue.evaluateContextForCatalog(registry), _authority: mint.mintAnonymousAuthority(registry),
  _activeTags: Object.freeze([SOURCE]) as unknown as string[] });
const { catalog } = await artifact.localCatalogue(registry, frame,
  { localSourceId: SOURCE, snapshot: saved, entities: [], functions: [], localRepresentations: [] }, undefined,
  { catalogueSourceId: SOURCE, graceMs: 0 });
const environment = detached.createDetachedAuthoringEnvironment(catalogue.environmentForCatalog(catalog, registry));
const session: AuthoringSession = Object.freeze({ mode: "detached", registry, catalog: environment.catalog, environment, evaluateContext: frame });
const options = { registry, evaluateContext: frame };
const judge = membershipModule.literalMembershipFor(environment, options);
const exact = (handle: string): TypeScheme => ({ quantified: [], body: { $ref: handle } });
const log = (label: string, value: unknown) => console.info(`[typed-entry] ${label}`, JSON.stringify(value)?.slice(0, 1500));

// The Local type constructors, as the construct editor reaches them.
const constructorOf = (typeId: string) => {
  // As creation-seed's constructorsForType: the catalogue constructors whose
  // parent entity is the type's catalogue row.
  const rows = environment.catalog.types.filter(row => row.entityId === typeId || row.id === typeId);
  const owners = new Set(rows.flatMap(row => [row.entityId, row.name, row.id]).filter(Boolean));
  const candidates = (environment.catalog.patternConstructors ?? environment.catalog.functions)
    .filter(entry => entry.kind === "constructor" && entry.parentEntity !== undefined && owners.has(entry.parentEntity));
  log(`constructor candidates ${typeId}`, { rows: rows.map(row => ({ id: row.id, entityId: row.entityId, name: row.name })),
    candidates: candidates.map(entry => ({ id: entry.id, targetId: entry.targetId, parentEntity: entry.parentEntity })) });
  const target = candidates.length === 1 ? candidates[0]!.targetId ?? candidates[0]!.id : environment.resolveConstructorTarget?.(typeId);
  const entry = target === undefined ? undefined : environment.getFunctionEntry?.(target) ?? candidates[0];
  log(`constructor ${typeId}`, { target, kind: entry?.kind, outcome: entry?.signatureOutcome?.$tag, params: entry?.params.map(p => p.name) });
  if (!target || !entry?.scheme || entry.kind !== "constructor") throw new Error(`No Local constructor for ${typeId}`);
  return { target, entry };
};
const paramScheme = (typeId: string, name: string) => {
  const { entry } = constructorOf(typeId);
  const index = entry.params.findIndex(param => param.name === name);
  const projected = environmentModule.projectAuthoringScheme(entry.scheme!, ["$arrow", "params", String(index), "type"]);
  log(`param ${typeId}.${name}`, { body: projected?.body, nominals: projected?.nominals });
  if (!projected) throw new Error(`No projected scheme for ${typeId}.${name}`);
  return projected;
};
const lit = (value: unknown): ExprNode => ({ kind: "literal", value } as ExprNode);
const construct = (typeId: string, fields: Record<string, ExprNode>): ExprNode => {
  const { target } = constructorOf(typeId);
  return lit({ __construct: { tag: target, fields: Object.entries(fields).map(([name, value]) => ({ name, value })) } });
};
const PHONE = "+14155552671";

describe("Local typed entry: exact identity handles", () => {
  test("P0: the frameless reader resolves exact type handles (std refinement, Local type, CalendarDate)", () => {
    const verdicts = Object.fromEntries([["phone", phoneUuid], ["person", ids.person], ["calendarDate", calendarDate]].map(([label, handle]) =>
      [label, registry.callSiteTyping.resolveType({ $ref: handle! }, undefined).ok]));
    log("P0 resolveType", verdicts);
    expect(verdicts).toEqual({ phone: true, person: true, calendarDate: true });
  }, 600_000);

  test("P1: a typed phone is a member of the Phone handle; a short number is not", () => {
    const valid = judge(PHONE, exact(phoneUuid));
    const invalid = judge("12", exact(phoneUuid));
    log("P1", { valid, invalid });
    expect(valid).toEqual({ $tag: "Just", _0: true });
    expect(invalid).toEqual({ $tag: "Just", _0: false });
  }, 600_000);

  test("P2/P3: constructor-projected parameter schemes decide the phone, the nested Person and the date", () => {
    const phone = paramScheme(ids.person, "phone");
    const verdicts = {
      phone: judge(PHONE, phone), badPhone: judge("12", phone),
      person: judge({ name: "Sam", phone: PHONE }, paramScheme(ids.transaction, "person")),
      badPerson: judge({ name: "Sam", phone: "12" }, paramScheme(ids.transaction, "person")),
      date: judge({ year: 2026, month: 11, day: 3 }, paramScheme(ids.transaction, "date")),
      badDate: judge({ year: 2026, month: 2, day: 30 }, paramScheme(ids.transaction, "date")),
    };
    log("P2/P3", verdicts);
    expect(verdicts).toEqual({
      phone: { $tag: "Just", _0: true }, badPhone: { $tag: "Just", _0: false },
      person: { $tag: "Just", _0: true }, badPerson: { $tag: "Just", _0: false },
      date: { $tag: "Just", _0: true }, badDate: { $tag: "Just", _0: false },
    });
  }, 600_000);

  test("P4: Save admits a typed Person and a Transaction with a nested plain Person; invalid inputs stay refused", () => {
    const person = (phone: string, withName = true) => construct(ids.person, {
      ...(withName ? { name: lit("Alex") } : {}), phone: lit(phone) });
    const transaction = (phone: string) => construct(ids.transaction, {
      amount: lit(40), person: lit({ name: "Sam", phone }), date: lit({ year: 2026, month: 11, day: 3 }) });
    const issue = (node: ExprNode, typeId: string) => validation.draftSaveIssue(node, environment, { ...options, expectedType: { $ref: typeId } as FenelType });
    const issues = {
      person: issue(person(PHONE), ids.person), transaction: issue(transaction(PHONE), ids.transaction),
      badPhone: issue(person("12"), ids.person), missingName: issue(person(PHONE, false), ids.person),
      badNestedPhone: issue(transaction("12"), ids.transaction),
    };
    log("P4", issues);
    expect(issues.person).toBeUndefined();
    expect(issues.transaction).toBeUndefined();
    expect(issues.badPhone).toBeDefined();
    expect(issues.missingName).toBeDefined();
    expect(issues.badNestedPhone).toBeDefined();
  }, 600_000);

  test("P5: a saved plain Person record is compatible with the Transaction's person parameter (the saved-value picker)", () => {
    const expected = paramScheme(ids.transaction, "person");
    // As the picker's worker job: infer the saved expression under the expected
    // scheme, then judge compatibility (authoring-catalog-worker-main.ts readerCompatibility).
    const compatibilityOf = (node: ExprNode) => {
      const inferred = environmentModule.inferAuthoringExpressionWithLiteralWitnesses(node,
        { ...environment, literalMembership: judge, bindings: {} }, { expectedScheme: expected });
      const compatibility = inferred.scheme === undefined ? "unknown"
        : environmentModule.judgeAuthoringSchemeCompatibility(inferred.scheme, expected, { registry });
      log("P5 inferred", { outcome: inferred.outcome, body: inferred.scheme?.body, compatibility });
      return compatibility;
    };
    expect(compatibilityOf(lit({ name: "Alex", phone: PHONE }))).toBe("compatible");
    expect(compatibilityOf(construct(ids.person, { name: lit("Alex"), phone: lit(PHONE) }))).toBe("compatible");
    void session;
  }, 600_000);

  test("P6: a CalendarDate reads through the built-in calendar-date view (Viewable CalendarDate)", async () => {
    const { resolveEffect } = await import("@fenel/engine");
    const dispatch = frame._specRegistry;
    const rows = (dispatch?.listInstances("Viewable") ?? []).filter(row => JSON.stringify(row.args).includes("CalendarDate"));
    const keys = { uuid: calendarDate, name: "CalendarDate", qualified: "time.CalendarDate",
      owner: registry.getEntityNominalIdentity(calendarDate) };
    const byKey = Object.fromEntries(Object.entries(keys).map(([label, key]) =>
      [label, key && dispatch ? resolveEffect(frame, dispatch, "Viewable", key)?.methods : undefined]));
    log("P6 Viewable CalendarDate", { rows: rows.map(row => ({ args: row.args, methods: row.methods })), keys, byKey });
    // The reader presentation asks through the exact handle's aliases, which
    // include the identified type's own entity id (reader-presentation.ts aliases).
    expect(registry.getIdentifiedEntity(calendarDate)?.id).toBe("CalendarDate");
    const methods = byKey.name;
    const name = (value: unknown) => typeof value === "string" ? value
      : (value as { $tag?: string; _0?: unknown } | undefined)?.$tag === "Just" ? (value as { _0: unknown })._0 : undefined;
    expect(name(methods?.defaultView)).toBe("calendar-date");
    expect(name(methods?.defaultInlineView)).toBe("calendar-date");
  }, 600_000);
});
