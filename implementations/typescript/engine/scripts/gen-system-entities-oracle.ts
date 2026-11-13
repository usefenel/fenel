// Regenerator for module-migrate-system-entities.oracle.json (FM-retire-E1 Step 2).
//
// Captures a NORMALIZED snapshot of the Step-2-batch system entities' SHAPE +
// resolved identity facets (label / description / icon / per-field labels) as
// the live registry exposes them. GENERATED BEFORE the flip (pre-port truth):
// each batch entity's facets are still `defineSystemEntity`-sourced when this
// runs, so the captured values are the ground truth the post-flip
// `module-migrate-system-entities.test.ts` re-derives from the loader-lifted
// instances and asserts byte-equal. The flip moves the SOURCE of these facets
// (hand-written `defineSystemEntity` → `.fenel` `@label`/`@fieldLabel`/… +
// auto-register loop) without moving their VALUE — this oracle is the lock.
//
// Re-run + commit the regenerated .oracle.json only when a batch entity's shape
// or facets legitimately change (the test goes red until you do).
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { systemEntities, dispatchRegistry } from "../src/system-entities";
import { getCatalogEntry } from "../src/type-catalog";
import { defaultValueFor, enumOptionLabel } from "../src/field-meta";
import { refHandle } from "../src/type-foundation";
import { peelSetExpr } from "../src/set-marker";
import type { Instance, FenelType } from "../src/types";

// The Step-2 batch — the entities whose `defineSystemEntity` is replaced by
// `.fenel` directives + the auto-register loop. Ids are byte-for-byte the
// current registered ids (lowercase where lowercase, PascalCase where Pascal).
export const STEP2_BATCH_IDS: string[] = [
  // Class S (facets only)
  "email_template", "currency", "language", "saved_query",
  // Class F (facets + fieldLabels)
  "proxy_link", "platform", "country", "query_category", "page",
  "profile_handle", "profile_phone", "profile_tag", "profile_intent", "profile_relationship",
  "entitlement", "payment_step", "reservation", "portfolio", "portfolio_member", "subscription",
  "Bot", "Conversation",
  "UsAddress", "CaAddress", "GbAddress", "DeAddress", "FrAddress", "JpAddress",
  // Extracted refined-String / enum / refined-Number atoms
  "UrlStr", "EmailStr", "PhoneStr", "ProfileType", "ProfileGender",
  "Latitude", "Longitude", "PhoneNumber", "PhoneLabel", "Importance", "Handle",
  "NonNegAmount", "PaymentStepStatus", "SubscriptionSlug", "SubscriptionSource",
  "NonNegCapacity", "InventoryEnforce", "ItemType", "PurchaseStatus", "PageSlug",
  "UsPostalCode", "CaPostalCode", "GbPostalCode", "DePostalCode", "FrPostalCode", "JpPostalCode",
];

// Shape normalization — fold {$var}/{$ref}/{$named} of a name to one token and
// canonicalize key order, so the lock is robust to cosmetic handle drift while
// still catching any real shape change. Mirrors gen-std-oracle.ts § norm.
function sortKeys(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) out[k] = o[k];
  return out;
}
export function normType(t: unknown): unknown {
  // Non-finite interval bounds (`NonNegAmount = Number | value ∈ [0..)` carries
  // `Infinity`) can't round-trip through JSON — `JSON.stringify(Infinity)` is
  // `null`, so a raw `Infinity` live value would never `toEqual` the `null` the
  // oracle file holds. Fold them to a stable string token on BOTH sides.
  if (typeof t === "number" && !Number.isFinite(t)) return t > 0 ? "@Infinity" : "@-Infinity";
  if (Array.isArray(t)) return t.map(normType);
  if (t && typeof t === "object") {
    const o = t as Record<string, unknown>;
    if (typeof o.$var === "string") return { $named: o.$var };
    if (typeof o.$ref === "string") return { $named: o.$ref };
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) out[k] = normType(o[k]);
    return sortKeys(out);
  }
  return t;
}

const labelables = dispatchRegistry.listInstances("Labelable") as Instance[];
function facet(className: string, id: string): unknown {
  const insts = dispatchRegistry.listInstances(className) as Instance[];
  const m = insts.find((i) => i.args[0] === id)?.methods;
  if (!m) return undefined;
  if (className === "Labelable") return m.label;
  if (className === "Describable") return m.description;
  if (className === "Iconable") return m.icon;
  return undefined;
}
// Top-level field names ($record fields ∪ $variant-case fields), peeling
// refined/opaque. Mirrors `topLevelFieldNames` in system-entities.ts — used to
// keep `@valueLabel` per-VALUE Labelables (`InventoryEnforce.soft`, on a
// fieldless refined atom) OUT of the per-FIELD label capture, exactly as the
// live auto-loop now gates them out (FM-retire-E1 Step 3).
function topLevelFieldNamesOf(t: FenelType): Set<string> {
  const out = new Set<string>();
  let ty: FenelType = t;
  if ("$refined" in ty) ty = ty.$refined.base;
  if ("$opaque" in ty && ty.$opaque.pure) ty = ty.$opaque.pure;
  if ("$record" in ty) for (const f of ty.$record.fields) out.add(f.name);
  if ("$variant" in ty) for (const c of ty.$variant.cases) for (const f of c.fields ?? []) out.add(f.name);
  return out;
}

function fieldLabelsFor(id: string, type: FenelType): Record<string, string> {
  const fieldNames = topLevelFieldNamesOf(type);
  const out: Record<string, string> = {};
  for (const i of labelables) {
    const a0 = i.args[0];
    if (typeof a0 === "string" && a0.startsWith(`${id}.`)) {
      const path = a0.slice(id.length + 1);
      if (fieldNames.has(path.split(".")[0]!)) out[path] = i.methods.label as string;
    }
  }
  return Object.fromEntries(Object.entries(out).sort());
}

export function captureEntity(id: string): Record<string, unknown> {
  const e = systemEntities.find((x) => x.id === id);
  if (!e) throw new Error(`gen-system-entities-oracle: entity "${id}" not in systemEntities`);
  const label = facet("Labelable", id);
  const description = facet("Describable", id);
  const icon = facet("Iconable", id);
  const fieldLabels = fieldLabelsFor(id, e.type ?? ({ $void: true } as FenelType));
  return {
    id,
    type: e.type === undefined ? null : normType(e.type),
    ...(label !== undefined ? { label } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(icon !== undefined ? { icon } : {}),
    ...(Object.keys(fieldLabels).length > 0 ? { fieldLabels } : {}),
  };
}

// ===========================================================================
// FM-retire-E1 Step 3 — the pure-enum deferred-entity flip oracle
//
// The 5 entities whose `defineSystemEntity` ALSO carried `fieldUi.options` +
// `fieldDefaults`. Step 3 dissolves both: `fieldDefaults` → a type-level
// `HasDefault` on the field's enum atom; `fieldUi.options` → DELETED, the option
// set derived from the atom's `$enum` + per-value `@valueLabel` Labelables (with
// `humanizeCodeName` fallback). What the lock captures beyond Step 2's
// {id,type,facets,fieldLabels}: the RESOLVED default (via `defaultValueFor`) +
// the per-field select option lists.
//
// `selectOptionsFor` is source-agnostic by design (so the oracle is regenerable
// either side of the flip): for each enum-typed field it labels each value from
// the surviving `fieldUi.options` (PRE-flip ground truth) when present, else
// from the derived `enumOptionLabel` path (POST-flip). Generated PRE-flip it
// captures the hand-authored labels; the post-flip test re-derives and asserts
// byte-equality — proving the derived path reproduces the deleted arrays.
// `type` strips per-field `ui`/`default` (the slots that legitimately move).
// ===========================================================================
// forms-collapse Phase 4 Stage 3 — "form" removed (the `form` entity retired).
export const STEP3_BATCH_IDS: string[] = ["profile", "item", "inventory", "purchase"];

/** Resolve an atom `{$ref: X}` name → its `$enum` member list, via the catalog
 *  (the same source the renderer resolves through). Returns null for a
 *  non-enum atom (refined-Number interval, format ref, `$tagged`, …). */
function resolveEnumValues(atomName: string): string[] | null {
  const ent = getCatalogEntry(`entity:${atomName}`) as { entity?: { type?: FenelType } } | undefined;
  let t = ent?.entity?.type;
  if (!t) return null;
  if ("$refined" in t) {
    // 3b-2 — dual-read the `$refined.set` SetExpr slot (`$`-key OR `$tag`); the
    // producer flip makes enum atoms `{$tag:"SeEnum",values:[…]}`.
    const sv = peelSetExpr(t.$refined.set);
    if (sv?.kind === "SeEnum") return sv.values.map((v) => String(v));
  }
  return null;
}

/** Per-field select option lists for an entity's enum-typed fields. Label source:
 *  surviving `fieldUi.options` (pre-flip) else `enumOptionLabel` (post-flip). */
export function selectOptionsFor(id: string): Record<string, Array<{ value: string; label: string }>> {
  const e = systemEntities.find((x) => x.id === id);
  if (!e || !e.type || !("$record" in e.type)) return {};
  const out: Record<string, Array<{ value: string; label: string }>> = {};
  for (const f of e.type.$record.fields) {
    const atom = refHandle(f.type);
    if (!atom) continue;
    const enumVals = resolveEnumValues(atom);
    if (!enumVals) continue;
    const uiOpts =
      f.ui.$tag === "Just" && f.ui._0.options.$tag === "Just"
        ? (f.ui._0.options._0 as Array<{ value: string; label: string }>)
        : null;
    out[f.name] = enumVals.map((value) => {
      const fromUi = uiOpts?.find((o) => o.value === value)?.label;
      return { value, label: fromUi ?? enumOptionLabel(atom, value, dispatchRegistry) };
    });
  }
  return Object.fromEntries(Object.entries(out).sort());
}

/** Deep-strip the per-field `ui`/`default` slots (which move off the entity in
 *  Step 3) so the shape snapshot is stable across the flip. */
function stripFieldExtras(t: unknown): unknown {
  if (Array.isArray(t)) return t.map(stripFieldExtras);
  if (t && typeof t === "object") {
    const o = t as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) {
      if (k === "ui" || k === "default") continue;
      out[k] = stripFieldExtras(o[k]);
    }
    return out;
  }
  return t;
}

/** Resolve the Step-3 raw record's default without presenting its intentionally
 * unidentified fields to a semantic traversal boundary.
 *
 * `systemEntities` is the raw loader projection: named fields have no `key`
 * until an identified registry view pins their UUIDs. `defaultValueFor` checks
 * Maybe shape before its record arm, and that Fenel-backed check correctly
 * rejects a whole raw record whose semantic slots are still unidentified.
 * The record arm itself is exactly a fieldwise recursion, so perform that one
 * outer step here and retain `defaultValueFor` as the authority for every
 * field type and `HasDefault` lookup. This keeps the migration oracle about the
 * raw source projection without weakening production field-key validation or
 * forcing an unrelated full repository-registry build. */
function rawRecordDefaultForOracle(type: FenelType): unknown {
  if (!("$record" in type)) return defaultValueFor(type, dispatchRegistry);
  return Object.fromEntries(
    type.$record.fields.map((field) => [
      field.name,
      defaultValueFor(field.type, dispatchRegistry),
    ]),
  );
}

export function captureStep3(id: string): Record<string, unknown> {
  const e = systemEntities.find((x) => x.id === id);
  if (!e || !e.type) throw new Error(`gen-system-entities-oracle: step3 entity "${id}" missing or untyped`);
  const label = facet("Labelable", id);
  const description = facet("Describable", id);
  const icon = facet("Iconable", id);
  const fieldLabels = fieldLabelsFor(id, e.type);
  return {
    id,
    type: normType(stripFieldExtras(e.type)),
    ...(label !== undefined ? { label } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(icon !== undefined ? { icon } : {}),
    ...(Object.keys(fieldLabels).length > 0 ? { fieldLabels } : {}),
    resolvedDefault: normType(rawRecordDefaultForOracle(e.type)),
    selectOptions: selectOptionsFor(id),
  };
}

// ===========================================================================
// FM-retire-E1 Step 5 — the per-field UI-hint (`@widget`/`@helpText`) facet flip
//
// The 2 entities whose `defineSystemEntity` carried a non-options WIDGET hint
// (`fieldUi: { <field>: { widget, helpText } }`): `plan` (terms → expression
// editor) + `function` (function → function-editor; ALSO `@fieldLabel` Spec, +
// the now-dropped runtime-dead `active`/`version` fieldDefaults — the DB columns
// own those, see the roadmap notes). Step 5 lifted the widget hint into source
// directives. Field-identity Phase 2b now resolves those selectors against the
// completed occurrence roster and registers UUID-keyed Displayables; raw entity
// definitions stay presentation-empty. Both `defineSystemEntity` calls remain
// deleted.
//
// The historical `widgetHints` slot remains in this migration oracle as an
// explicit empty raw-definition assertion. UUID presentation is locked by the
// repository field catalog and system-entities-load tests instead.
// ===========================================================================
export const STEP5_BATCH_IDS: string[] = ["plan", "function"];

/** Extract a `field.ui` slot value as a plain string — robust to the raw-string
 *  form (`defineSystemEntity`'s `fieldUi` literal) AND the `Just(...)`-wrapped
 *  form (the canonical EditDisplay shape). Returns undefined for an absent slot. */
function uiSlotString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && (v as { $tag?: string }).$tag === "Just") {
    const inner = (v as { _0?: unknown })._0;
    if (typeof inner === "string") return inner;
  }
  return undefined;
}

/** Historical raw inline widget/help reader. Phase 2b requires this to return
 *  an empty record for repository definitions; UUID facets are read through an
 *  explicit registry instead. */
export function widgetHintsFor(id: string): Record<string, { widget?: string; helpText?: string }> {
  const e = systemEntities.find((x) => x.id === id);
  if (!e || !e.type || !("$record" in e.type)) return {};
  const out: Record<string, { widget?: string; helpText?: string }> = {};
  for (const f of e.type.$record.fields as Array<{ name: string; ui?: { $tag?: string; _0?: Record<string, unknown> } }>) {
    const ui = f.ui && f.ui.$tag === "Just" ? f.ui._0 : undefined;
    if (!ui) continue;
    const widget = uiSlotString(ui.widget);
    const helpText = uiSlotString(ui.helpText);
    if (widget !== undefined || helpText !== undefined) {
      out[f.name] = {
        ...(widget !== undefined ? { widget } : {}),
        ...(helpText !== undefined ? { helpText } : {}),
      };
    }
  }
  return Object.fromEntries(Object.entries(out).sort());
}

export function captureStep5(id: string): Record<string, unknown> {
  const e = systemEntities.find((x) => x.id === id);
  if (!e || !e.type) throw new Error(`gen-system-entities-oracle: step5 entity "${id}" missing or untyped`);
  const label = facet("Labelable", id);
  const description = facet("Describable", id);
  const icon = facet("Iconable", id);
  const fieldLabels = fieldLabelsFor(id, e.type);
  return {
    id,
    type: normType(stripFieldExtras(e.type)),
    ...(label !== undefined ? { label } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(icon !== undefined ? { icon } : {}),
    ...(Object.keys(fieldLabels).length > 0 ? { fieldLabels } : {}),
    widgetHints: widgetHintsFor(id),
  };
}

// ===========================================================================
// FM-retire-E1 Step 6 — the inline-TS domain-record authoring port
//
// The 7 plain `$record` entities that built their `type:` as an INLINE TS
// literal (no `.fenel` file): `account` / `integration` / `entity_definition`
// (label/description/icon) + the 4 label-less PascalCase records
// (`ButtonPayload` / `PlanGrant` / `PlanStep` / `ProfileHandleInput`, each
// carrying ONLY a bare `@codeName` to trip the loader's identity-facet gate).
// Unlike Steps 2–5 these had NO `.fenel` file — Step 6 AUTHORS new ones +
// wires them into `type-foundation`'s `?raw` merge array; the Step-2
// auto-register loop then registers them.
//
// The lock captures the SAME `{id, type, label?, description?, icon?,
// fieldLabels?}` snapshot `captureEntity` produces (these records carry no
// fieldUi/fieldDefaults). Generated PRE-flip (the inline `defineSystemEntity`
// is the SOURCE — the .fenel file is loaded but the auto-loop dedups against
// the already-registered id, so `systemEntities[id]` is still the TS literal),
// re-derived POST-flip (the `defineSystemEntity` deleted → the .fenel file is
// the source), byte-equal.
// ===========================================================================
export const STEP6_BATCH_IDS: string[] = [
  "account", "integration", "entity_definition",
  "ButtonPayload", "PlanGrant", "PlanStep", "ProfileHandleInput",
];

/** Deep-strip per-field/per-case `label` slots from a type. The inline-TS
 *  literals these entities ported FROM carried `label: Nothing` on every field
 *  (they were never run through the retired label populator); the `.fenel` load path
 *  DOES populate them (`Just(humanizeCodeName(name))`). That label fill is the
 *  ONLY delta the flip introduces — the structure (field names, types, empty
 *  records, Maybe wrapping) is byte-identical. Stripping `label` makes the lock
 *  capture exactly the invariant part ("modulo the populator's label fill", per
 *  the brief), the same way `stripFieldExtras` drops the ui/default slots that
 *  legitimately move in Steps 3/5. Entity-level label/description/icon are
 *  captured separately via `facet()`, so they're unaffected. */
function stripFieldLabels(t: unknown): unknown {
  if (Array.isArray(t)) return t.map(stripFieldLabels);
  if (t && typeof t === "object") {
    const o = t as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) {
      if (k === "label") continue;
      out[k] = stripFieldLabels(o[k]);
    }
    return out;
  }
  return t;
}

/** Step-6 entities carry no fieldUi/fieldDefaults. Capture {id, type, facets} —
 *  with per-field labels stripped (the flip's only delta; see `stripFieldLabels`).
 *  No `fieldLabels` (none authored). Separate name + oracle section keeps the
 *  batch boundary explicit + parallel to Steps 3/5. */
export function captureStep6(id: string): Record<string, unknown> {
  const e = systemEntities.find((x) => x.id === id);
  if (!e || !e.type) throw new Error(`gen-system-entities-oracle: step6 entity "${id}" missing or untyped`);
  const label = facet("Labelable", id);
  const description = facet("Describable", id);
  const icon = facet("Iconable", id);
  return {
    id,
    type: normType(stripFieldLabels(e.type)),
    ...(label !== undefined ? { label } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(icon !== undefined ? { icon } : {}),
  };
}

// ===========================================================================
// FM-retire-E1 Step 7 — the residual parametric / core entities flip
//
// `Maybe` / `Result` / `Either` (foundation.fenel) + `LookupResult`
// (entities/LookupResult.fenel) + `Module` (modules/core/module.fenel): their
// inline `defineSystemEntity` calls are DELETED; identity rides on `@label`/
// `@icon`/`@description` directives, and the head params (`Maybe a` → `["a"]`)
// thread through `foundationEntityRegs` → the auto-register loop (which rewrites
// each bound `{$ref:a}` → `{$var:a}` for handle-parity with the pre-flip TS
// literal). Unlike Steps 2–6 this batch carries an EXPECTED, documented delta
// from the pre-flip shape: the param NAME (decl `a`/`e` vs the old TS `T`/`E`/
// `A`). The oracle therefore locks the POST-flip values (regenerated WITH the
// flip in place); the test ALSO asserts the structural invariants explicitly
// (params present + named, `$var` handle, facet text) so the lock is meaningful
// beyond self-reference. `normType` folds `$var`≡`$ref`≡`$named`, so the handle
// re-pin is invisible to the snapshot and only the name surfaces.
//
// What this batch does NOT cover (documented justified residuals, see the
// roadmap): `Boolean` (its `$opaque.name` "Boolean" ≠ the `Bool` decl name —
// no `@codeName`-reachable surface), `field_ui_hint` (the parser can't author
// `Maybe {}` / `Maybe (List {})` open-record type-args in field position),
// `Ref`/`LocaleString` (bare type-alias surface — D1), `GeoLevel`/`GeoPath`
// (Id-literal + case-label surface — D2), `Draft` (no `type:` slot).
// ===========================================================================
export const STEP7_BATCH_IDS: string[] = ["Maybe", "Result", "Either", "LookupResult", "Module"];

export function captureStep7(id: string): Record<string, unknown> {
  const e = systemEntities.find((x) => x.id === id);
  if (!e || !e.type) throw new Error(`gen-system-entities-oracle: step7 entity "${id}" missing or untyped`);
  const label = facet("Labelable", id);
  const description = facet("Describable", id);
  const icon = facet("Iconable", id);
  return {
    id,
    type: normType(e.type),
    ...(e.params ? { params: e.params.map((p) => p.name) } : {}),
    ...(label !== undefined ? { label } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(icon !== undefined ? { icon } : {}),
  };
}

if (import.meta.main) {
  const oracle: Record<string, unknown> = { entities: {}, step3: {}, step5: {}, step6: {}, step7: {} };
  const out = oracle.entities as Record<string, unknown>;
  for (const id of STEP2_BATCH_IDS) out[id] = captureEntity(id);
  const out3 = oracle.step3 as Record<string, unknown>;
  for (const id of STEP3_BATCH_IDS) out3[id] = captureStep3(id);
  const out5 = oracle.step5 as Record<string, unknown>;
  for (const id of STEP5_BATCH_IDS) out5[id] = captureStep5(id);
  const out6 = oracle.step6 as Record<string, unknown>;
  for (const id of STEP6_BATCH_IDS) out6[id] = captureStep6(id);
  const out7 = oracle.step7 as Record<string, unknown>;
  for (const id of STEP7_BATCH_IDS) out7[id] = captureStep7(id);
  const path = join(import.meta.dir, "..", "src", "module-migrate-system-entities.oracle.json");
  writeFileSync(path, JSON.stringify(oracle, null, 2) + "\n");
  console.log("wrote", Object.keys(out).length, "step2 +", Object.keys(out3).length, "step3 +", Object.keys(out5).length, "step5 +", Object.keys(out6).length, "step6 +", Object.keys(out7).length, "step7 entities to", path);
}
