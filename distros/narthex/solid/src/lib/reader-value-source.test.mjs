import { describe, expect, test } from "bun:test";
import { createDispatchRegistry } from "../../../../../implementations/typescript/engine/src/dispatch-registry";
import { typeConstructorOf } from "../../../../../implementations/typescript/engine/src/effect-dispatch";
import { dispatchEngineBody, withInterpretedCompiledArtifacts } from "../../../../../implementations/typescript/engine/src/engine-bodies-dispatch";
import { resolveValueType } from "../../../../../implementations/typescript/engine/src/authoring/type-authoring";
import { normalizeTypeViewDraft, resolveSurfaceTypeView, surfaceBuiltinTypeViews, surfaceReadValuePlan } from "../../../../../implementations/typescript/engine/src/authoring/surface";
import { Anything, Just, List, Nothing } from "../../../../../implementations/typescript/engine/src/type-foundation";
import { projectReaderValueReadInSession } from "./reader-presentation";
import { fileData, hasDataPreview, isImageLike, isMarkup } from "./data-transfer/data-preview-shape";
import { isInlineImageValue } from "./expression-runner/image-canvas-data";
import { readLocusCatalogReference } from "./locus-catalog-reference";
import { previewGlyph, previewGlyphKeys } from "./thumbnail-glyph";
import { fieldSlotName, fieldWireKey } from "./layout-renderer/typed-read-field-slots";

// Execute the actual packet adapter and interpreted Fenel helpers. The fixture
// supplies only the current reader's inert declarations/dispatch rows; it never
// initializes a repository registry, authoring catalogue, worker or browser.
const underSource = work => withInterpretedCompiledArtifacts(work);
const str = { $ref: "String" }, number = { $ref: "Number" };
const field = (name, type, extra = {}) => ({ name, type, label: Nothing, ui: Nothing, meta: {}, ...extra });
const icons = ["star", "heart", "mail", "box", "type", "type-badge"];

function fixture() {
  const definitions = new Map(), environmentDefinitions = new Map(), reads = [], environmentReads = [], fieldRepresentations = new Map();
  const pool = createDispatchRegistry();
  const frame = { _specRegistry: pool, _activeTags: ["selected"], _caseOwner: { Ready: "Status" } };
  const registry = {
    getIdentifiedEntity(name) { reads.push(name); return definitions.has(name) ? { id: name, type: definitions.get(name) } : undefined; },
    getFunction: () => undefined, getUuid: () => undefined,
    getEntityNominalIdentity: name => definitions.has(name) ? name : undefined,
    getFieldRepresentation: (className, id) => fieldRepresentations.get(`${className}:${id}`),
  };
  const session = { registry, evaluateContext: frame, environment: {
    catalog: { types: [], functions: [], referenceRoutes: [], exactConstructorRoutes: [], patternConstructors: [] },
    resolveTypeRef(type) { environmentReads.push(type.$ref); return environmentDefinitions.get(type.$ref); },
  } };
  const source = { catalog: [], types: [], functionRows: [] };
  const add = (typeName, target, methods, scope = "global", priority = 0) =>
    pool.addInstance({ typeName, args: [target], methods, scope, priority });
  const project = (value, type, options = {}) => projectReaderValueReadInSession({ value, type,
    typeLookup: "session", views: [], componentNames: [], ...options }, session, source, icons);
  return { project, add, definitions, environmentDefinitions, reads, environmentReads, source, session, frame, pool, fieldRepresentations };
}

// Frozen pre-migration display policy is an oracle for its three-way choice:
// declared type, observed type, then reflected nominal type. It shares only the
// existing engine reflection/normalization helpers, not the new source policy.
function previousDisplayType(value, declared, session, fieldRegistry, observedType) {
  const resolve = name => (fieldRegistry ?? session.registry).getIdentifiedEntity(name)?.type
    ?? (fieldRegistry ? undefined : session.environment.resolveTypeRef?.({ $ref: name }));
  const generic = type => {
    if ("$var" in type) return true;
    if ("$refined" in type || "$tagged" in type) return false;
    const projected = "$ref" in type ? resolve(type.$ref) ?? type : type;
    if ("$ref" in projected || "$refined" in projected || "$tagged" in projected) return false;
    const resolved = resolveValueType(projected, resolve);
    return "$complement" in resolved && "$void" in resolved.$complement;
  };
  if (declared && !generic(declared)) return declared;
  if (observedType && !generic(observedType)) return observedType;
  const reflected = typeConstructorOf(value, session.evaluateContext);
  const resolved = reflected && ((fieldRegistry ?? session.registry).getIdentifiedEntity(reflected)?.type
    ?? (fieldRegistry ? undefined : session.environment.resolveTypeRef?.({ $ref: reflected })));
  return reflected && resolved ? { $ref: reflected } : declared ?? observedType;
}

describe("Fenel-owned arbitrary reader value packets", () => {
  test("scalar and empty values use existing source formatting and a prepared no-display result", () => underSource(() => {
    const f = fixture();
    for (const value of [null, undefined, false, true, 0, -0, 3.5, NaN, Infinity]) {
      const packet = f.project(value);
      expect(packet.root.body).toBe("scalar");
      expect(packet.root.structure).toBe("leaf");
      expect(packet.root.readPlan).toBeNull();
      expect(packet.root.scalarPlan).toEqual(surfaceReadValuePlan(value, undefined, "scalar", f.frame));
      expect(packet.children).toEqual([]);
    }
    expect(f.project("ordinary text").root.body).toBe("string");
    expect(f.project(12, { $ref: "Nat" }).root.numeric).toBe(true);
    // List thumbnails consume this same native numeric read plan. Its text
    // keeps the exact payload; clipping is the circle's browser geometry.
    for (const [value, text] of [[3, "3"], [12, "12"], [-12.375, "-12.375"], [123456789, "123456789"]]) {
      const packet = f.project(value, number, { thumbnail: true });
      expect(packet.root.numeric).toBe(true);
      expect(packet.root.scalarPlan.text).toBe(text);
      expect(packet.root.scalarPlan.raw).toBe(value);
    }
    expect(f.project({}).root.thumbnailIcon).toBeUndefined();
  }), 60_000);

  test("all 18 raw type forms survive unchanged, including higher forms and held types", () => underSource(() => {
    const f = fixture();
    const forms = [
      { $void: true }, { $unit: true }, { $ref: "Unknown" }, { $var: "a" },
      { $record: { fields: [field("title", str)] } },
      { $variant: { cases: [{ name: "A", fields: [] }, { name: "B", fields: [field("_0", number)] }] } },
      { $tuple: [str, number] }, { $map: { keys: { $tag: "SeRef", handle: "String" }, values: number } },
      { $union: [str, number] }, { $intersect: [str, Anything] }, { $complement: str },
      { $refined: { base: str, set: { $tag: "SeEnum", values: ["kept"] } } },
      { $mu: { var: "self", body: { $var: "self" } } },
      { $tagged: { value: str, phantom: { $ref: "Person" } } },
      { $opaque: { name: "Secret", pure: str } },
      { $arrow: { params: [field("argument", str)], returns: number } },
      { $type: true }, { $el: { var: "readerType" } },
    ];
    expect(forms).toHaveLength(18);
    for (const type of forms) {
      const packet = f.project({}, type);
      expect(packet.root.valueType).toBe(type);
      expect(packet.root.displayType).toBe(type);
      expect(packet.root.field.type).toBe(type);
      const held = f.project(type, { $type: true });
      expect(held.root.body).toBe("held-type");
      expect(held.root.heldType).toBe(type);
    }
    const arrow = forms[15], callable = f.project({ $ref: "doNotInvoke" }, arrow);
    expect(callable.root.body).toBe("callable-type");
    expect(callable.root.callableType).toBe(arrow);
  }), 60_000);

  test("generic display choices retain the previous declaration/observation/reflection policy", () => underSource(() => {
    const f = fixture();
    f.definitions.set("Status", { $variant: { cases: [{ name: "Ready", fields: [] }] } });
    f.definitions.set("AnyAlias", Anything);
    f.definitions.set("Indirect", { $ref: "AnyAlias" });
    const refined = { $refined: { base: Anything, set: { $tag: "SeAll" } } };
    const tagged = { $tagged: { value: Anything, phantom: str } };
    const value = { $tag: "Ready" };
    for (const declared of [undefined, { $var: "a" }, Anything, { $ref: "AnyAlias" }, { $ref: "Indirect" }, refined, tagged, str]) {
      for (const observedType of [undefined, { $var: "b" }, number]) {
        const packet = f.project(value, declared, { observedType });
        expect(packet.root.displayType).toEqual(previousDisplayType(value, declared, f.session, undefined, observedType));
      }
    }
    expect(f.project(value, { $var: "a" }).root).toMatchObject({ nominal: "Status", reflectedIdentity: "Status", valueType: { $ref: "Status" } });
    expect(f.project(value, refined).root.valueType).toBe(refined);
  }), 60_000);

  test("explicit registry misses remain misses while session lookup can use its own declaration", () => underSource(() => {
    const f = fixture(), alias = { $ref: "EnvironmentOnly" };
    f.environmentDefinitions.set("EnvironmentOnly", { $record: { fields: [field("name", str)] } });
    expect(f.project({ name: "Ada" }, alias, { typeLookup: "registry" }).root.fields).toBeUndefined();
    expect(f.environmentReads).toEqual([]);
    expect(f.project({ name: "Ada" }, alias).root.fields?.[0]?.name).toBe("name");
    expect(f.environmentReads).toContain("EnvironmentOnly");
  }), 60_000);

  test("scoped Viewable resolves inherited compact/full views and only named available components", () => underSource(() => {
    const f = fixture();
    f.definitions.set("Status", { $record: { fields: [field("name", str)] } });
    f.add("Viewable", "Status", { defaultView: "global" });
    f.add("Viewable", "Status", { defaultView: "full", defaultInlineView: Just("inline") }, { kind: "tag", tag: "selected" }, 20);
    f.add("Viewable", "Status", { defaultView: "foreign" }, { kind: "tag", tag: "other" }, 100);
    const views = [
      normalizeTypeViewDraft({ name: "base", readComponent: "card-body", readDisplay: { prefix: "State: " } }),
      normalizeTypeViewDraft({ name: "full", extends: "base" }),
      normalizeTypeViewDraft({ name: "inline", readComponent: "inline-body" }),
    ];
    const args = { views, componentNames: ["card-body", "inline-body"] };
    const resolvedBefore = resolveSurfaceTypeView(views, "full");
    expect(resolvedBefore?.readComponent).toBe("card-body");
    const full = f.project("ready", { $ref: "Status" }, args).root;
    expect(full.view).toEqual(resolvedBefore);
    expect(resolveSurfaceTypeView(views, "full")).toEqual(resolvedBefore);
    expect(full.readPlan?.text).toBe("State: ready");
    expect(full.useLayout).toBe(false);
    expect(f.project("ready", { $ref: "Status" }, { ...args, compact: true }).root.view?.name).toBe("inline");
    expect(f.project("ready", { $ref: "Status" }, { ...args, compact: true, componentNames: [] }).root.view?.name).toBe("full");
    expect(f.project("ready", { $ref: "Status" }, { views, componentNames: [] }).root.view?.name).toBe("full");
  }), 60_000);

  // Recipes demo L3: a Local item holding a recipe card (a refinement of a
  // fact list) selects the source-owned card body through its Viewable.
  test("a refinement type's Viewable selects the shared recipe-card body in the Local packet", () => underSource(() => {
    const f = fixture();
    f.definitions.set("RecipeFact", { $record: { fields: [field("title", str), field("summary", Anything), field("evidence", Anything)] } });
    f.definitions.set("RecipeCard", { $refined: { base: List({ $ref: "RecipeFact" }), set: { $tag: "SeAll" } } });
    f.add("Viewable", "RecipeCard", { defaultView: "recipe-card", defaultInlineView: "recipe-card" });
    const views = surfaceBuiltinTypeViews();
    const shipped = views.find(view => view.name === "recipe-card");
    expect(shipped?.readComponent).toBe("recipe-card");
    const card = [
      { title: "Full pantry", summary: { $tag: "Preparations", items: [[{ $tag: "Honey" }]] }, evidence: { $tag: "DirectEvaluation" } },
      { title: "Ingredient count", summary: { $tag: "IngredientCount", minimum: 4, maximum: 4 }, evidence: { $tag: "DirectEvaluation" } },
    ];
    for (const compact of [false, true]) {
      const root = f.project(card, { $ref: "RecipeCard" }, { views, componentNames: ["recipe-card"], compact }).root;
      expect(root.view?.name).toBe("recipe-card");
      expect(root.view?.readComponent).toBe("recipe-card");
    }
    // Without the registered body the list keeps its generic drawing.
    expect(f.project(card, { $ref: "RecipeCard" }, { views, componentNames: [] }).root.view?.name).not.toBe("recipe-card");
  }), 60_000);

  test("glyph precedence and reference captions stay with the captured reader", () => underSource(() => {
    const f = fixture();
    f.definitions.set("Status", { $variant: { cases: [{ name: "Ready", fields: [] }] } });
    f.add("Iconable", "Ready", { icon: "unavailable" });
    f.add("Emojiable", "Ready", { emoji: "  🧭  " });
    f.add("Iconable", "Status", { icon: "star" }, { kind: "tag", tag: "selected" }, 30);
    f.add("Iconable", "Status", { icon: "heart" }, { kind: "tag", tag: "foreign" }, 200);
    f.add("Labelable", "chosen-reference", { label: { en: "Visible data" } }, { kind: "tag", tag: "selected" }, 20);
    f.add("Codeable", "chosen-reference", { codeName: "visibleData" });
    const value = { $tag: "Ready" }, root = f.project(value, undefined, { thumbnail: true }).root;
    const expected = previewGlyph(previewGlyphKeys(value, "Status", ["Status"]), (name, key) =>
      key === "Ready" ? name === "Iconable" ? { icon: "unavailable" } : { emoji: "  🧭  " }
        : name === "Iconable" ? { icon: "star" } : undefined, Object.fromEntries(icons.map(name => [name, true])));
    expect(root.glyph).toEqual(expected);
    expect(f.project(value).root.glyph).toEqual({});
    expect(root.icon).toBe("star");
    expect(f.project({ $ref: "chosen-reference" }).root.caption).toEqual({ text: "Visible data", code: false });
    for (const bad of [{ $ref: "chosen-reference", extra: 1 }, { $ref: 3, $pin: "function", id: "chosen-reference" },
      { $ref: "", $pin: "function", id: "chosen-reference" }]) {
      expect(readLocusCatalogReference(bad)).toBeUndefined();
      expect(f.project(bad).root.caption).toBeUndefined();
    }
    expect(f.project({ $pin: "function", id: "chosen-reference", name: "Legacy hint" }).root.caption).toEqual({ text: "Visible data", code: false });
  }), 60_000);

  test("authoring Maybe drafts retain optional payload projection without requiring a FieldKey", () => underSource(() => {
    const f = fixture(), inner = { $union: [str, number] };
    const maybe = { $variant: { cases: [{ name: "Nothing", fields: [] }, { name: "Just", fields: [field("_0", inner)] }] } };
    for (const [value, present] of [[{ $tag: "Just", _0: "kept" }, true], [{ $tag: "Just", _0: null }, true],
      [{ $tag: "Nothing" }, false], [null, false], [undefined, false]]) {
      const packet = f.project(value, maybe);
      expect(packet.root.body).toBe("optional");
      expect(packet.root.optional).toEqual({ type: inner, present, key: "_0" });
      expect(packet.root.optional.type).toBe(inner);
    }
    const wrongPayload = { $variant: { cases: [{ name: "Nothing", fields: [] }, { name: "Just", fields: [field("value", inner)] }] } };
    expect(f.project({ $tag: "Just", value: "legacy" }, wrongPayload).root.optional).toBeUndefined();
  }), 60_000);

  test("record slots preserve physical paths, shared child occurrences, field identity and dollar data", () => underSource(() => {
    const f = fixture(), child = { nested: true }, childType = { $record: { fields: [field("nested", { $ref: "Boolean" })] } };
    const fields = [field("first", childType), field("second", childType), field("$ref", str)];
    const type = { $record: { fields } }, value = { first: child, second: child, $ref: "ordinary data", $tag: "not-a-declared-case" };
    const packet = f.project(value, type);
    expect(packet.root.fields).toEqual(fields);
    expect(packet.root.fields[0]).toBe(fields[0]);
    expect(packet.root.recordLabel).toBe("not-a-declared-case");
    expect(packet.children.map(row => [row.key, row.path])).toEqual([["first", ["first"]], ["second", ["second"]], ["$ref", ["$ref"]]]);
    // A runtime tag selects variant fields in the existing child policy. The
    // record's fields above remain available independently to layout planning.
    expect(packet.children.every(row => row.declaredType === undefined)).toBe(true);
    const plain = f.project({ first: child, second: child }, type);
    expect(plain.children[0].declaredType).toBe(childType);
    expect(plain.children[1].declaredType).toBe(childType);
    expect(plain.children[0].path).not.toBe(plain.children[1].path);
    expect(fields.every(item => item.key === undefined)).toBe(true);
  }), 60_000);

  test("B4 F1: record fields carry their wire key and shown name, as the page renderer derives them", () => underSource(() => {
    const f = fixture();
    const named = (name, id, extra = {}) => field(name, str, { key: { $tag: "NamedField", ref: { $ref: id } }, ...extra });
    const fields = [named("title", "f-title"), named("amount", "f-amount", { label: Just("Declared") }), named("bare", "f-bare"),
      field("plain", str), field("labelled", str, { label: Just("Plain label") })];
    f.fieldRepresentations.set("Codeable:f-title", { methods: { codeName: "headline" } });
    f.fieldRepresentations.set("Labelable:f-title", { methods: { label: "Title" } });
    f.fieldRepresentations.set("Labelable:f-amount", { methods: { label: { en: "Amount" } } });
    f.fieldRepresentations.set("Codeable:f-bare", { methods: { codeName: "" } });
    const packet = f.project({ headline: "a", amount: "b", bare: "c", plain: "d", labelled: "e" }, { $record: { fields } });
    expect(packet.root.fieldSlots).toEqual(fields.map(slot => ({ wire: fieldWireKey(slot, f.session.registry), name: fieldSlotName(slot, f.session.registry) })));
    expect(packet.root.fieldSlots.map(slot => slot.wire)).toEqual(["headline", "amount", "bare", "plain", "labelled"]);
    expect(packet.root.fieldSlots[0].name).toEqual({ text: "Title", code: false });
    // Without declared fields there is nothing to name.
    expect(f.project("text", str).root.fieldSlots).toBeUndefined();
  }), 60_000);

  test("root and earlier sibling facts never acquire a later child's reflection", () => underSource(() => {
    const f = fixture();
    f.definitions.set("Number", number);
    f.definitions.set("String", str);
    const value = { object: { nested: 2 }, text: "last" };
    const packet = f.project(value);
    expect(packet.root.reflectedIdentity).toBeUndefined();
    expect(packet.root.nominal).toBeUndefined();
    expect(packet.root.displayType).toBeUndefined();
    expect(packet.children[0].type).toBeUndefined();
    expect(packet.children[1].type).toEqual(str);
    const old = structuredClone(packet);
    f.project({ count: 7 });
    f.project([true, false]);
    expect(packet).toEqual(old);
    expect(f.project({ x: 2 }).root.reflectedIdentity).toBeUndefined();
  }), 60_000);

  test("reflection retains the existing runtime carrier policy without inherited owner names", () => underSource(() => {
    const f = fixture();
    const samples = [null, undefined, false, true, 1, NaN, "text", [], [1], {}, { x: 2 }, { $tag: "Ready" },
      { $tag: "toString" }, { $tag: "constructor" }, { $tag: "" }, { $tag: 3 }, { $ref: "heldFunction" },
      { fn: ["x", { var: "x" }] }, { __partial: { fn: "heldFunction", args: [1] } }];
    for (const value of samples) {
      expect(f.project(value).root.reflectedIdentity).toBe(typeConstructorOf(value, f.frame));
    }
    f.frame._caseOwner = Object.create({ Ready: "ForeignInheritedOwner" });
    expect(f.project({ $tag: "Ready" }).root.reflectedIdentity).toBe("Ready");
  }), 60_000);

  test("dependent container shapes use this reader's type-valued function and complete alias chain", () => underSource(() => {
    const f = fixture(), nested = { $union: [str, number] };
    f.definitions.set("Alias1", { $ref: "Alias2" });
    f.definitions.set("Alias2", { $record: { fields: [field("payload", nested)] } });
    f.frame.getFunction = id => id === "reader-type" ? { id, params: [field("type", { $type: true })],
      returns: { $type: true }, body: { var: "type" } } : undefined;
    const type = { $el: { call: ["reader-type", { $ref: "Alias1" }] } };
    const packet = f.project({ payload: "kept" }, type);
    expect(packet.root.valueType).toBe(type);
    expect(packet.children[0].declaredType).toBe(nested);
    expect(f.reads).toContain("Alias1");
    expect(f.reads).toContain("Alias2");
    f.frame.getFunction = id => id === "unavailable-type" ? { id, params: [], returns: { $type: true } } : undefined;
    const refused = f.project({ payload: "kept" }, { $el: { call: ["unavailable-type"] } });
    expect(refused.children[0].declaredType).toBeUndefined();
    let calls = 0;
    f.frame.getFunction = id => id === "held-callable" ? { id, params: [], returns: str } : undefined;
    f.frame.nativesCtx = { "held-callable": () => { calls++; return "must stay held"; } };
    expect(f.project({ $ref: "held-callable" }, { $arrow: { params: [], returns: str } }).root.body).toBe("callable-type");
    expect(calls).toBe(0);
  }), 60_000);

  test("a selected layout still applies to preview carriers that retain declared fields", () => underSource(() => {
    const f = fixture(), fields = [field("name", str, { key: { $tag: "NamedField", ref: { $ref: "a3c1c173-1c98-4c53-a0e2-7da30729a942" } } }),
      field("url", str, { key: { $tag: "NamedField", ref: { $ref: "bc41ad12-c4b9-4e26-9839-449cf962cab0" } } })];
    f.session.registry.resolveFieldPresentation = id => ({ label: id, source: "uuid-field-facet" });
    f.definitions.set("FilePreview", { $record: { fields } });
    f.add("Viewable", "FilePreview", { defaultView: "file-layout" });
    const views = [normalizeTypeViewDraft({ name: "file-layout", layout: {
      sections: [{ rows: [{ slots: [{ field: "name" }] }] }],
    } })];
    const value = { url: "https://example.org/image.png", name: "Picture", mimeType: "image/png", size: 20 };
    const root = f.project(value, { $ref: "FilePreview" }, { views }).root;
    expect(root.body).toBe("preview");
    expect(root.structure).toBe("leaf");
    expect(root.useLayout).toBe(true);
    expect(root.layoutPlan?.sections[0]?.rows[0]?.slots[0]).toMatchObject({ fieldName: "name", value: "Picture" });
    expect(root.fields?.[0]).toBe(fields[0]);
  }), 60_000);

  test("an empty component name cannot make an unpaintable inline view viable or suppress a layout", () => underSource(() => {
    const f = fixture();
    f.definitions.set("Status", { $record: { fields: [] } });
    f.add("Viewable", "Status", { defaultInlineView: "unpaintable", defaultView: "full-layout" });
    const views = [normalizeTypeViewDraft({ name: "unpaintable" }),
      normalizeTypeViewDraft({ name: "full-layout", layout: { sections: [] } })];
    const root = f.project({ payload: 2 }, { $ref: "Status" }, { compact: true, views, componentNames: [""] }).root;
    expect(root.view?.name).toBe("full-layout");
    expect(root.useLayout).toBe(true);
    expect(dispatchEngineBody("engine:surfaceReaderDemandedGlyphKeys", [false, { $tag: "Ready" }, Just("Status"), Just("Status")], f.frame)).toEqual([]);
  }), 60_000);

  test("arrays retain declared List children; tuple/map no-claim remains a recorded existing UX limitation", () => underSource(() => {
    const f = fixture(), inner = { $refined: { base: str, set: { $tag: "SeEnum", values: ["a"] } } };
    const list = f.project(["a", "a"], List(inner));
    expect(list.root.body).toBe("collection");
    expect(list.children.map(child => child.path)).toEqual([[0], [1]]);
    expect(list.children.map(child => child.label)).toEqual(["Item 1", "Item 2"]);
    expect(list.children.every(child => child.declaredType === inner && child.type === inner)).toBe(true);
    // These assertions pin the bounded migration to childValueType's current
    // coverage. They do not assert a language limit or a desired renderer rule.
    const tuple = { $tuple: [str, number] }, map = { $map: { keys: { $tag: "SeRef", handle: "String" }, values: number } };
    expect(f.project(["a", 2], tuple).children.every(child => child.declaredType === undefined)).toBe(true);
    expect(f.project({ a: 2 }, map).children[0].declaredType).toBeUndefined();
    expect(f.project(["a", 2], tuple).root.valueType).toBe(tuple);
    expect(f.project({ a: 2 }, map).root.valueType).toBe(map);
  }), 60_000);

  test("duplicate children share only completed observations within one packet and re-read the next frame", () => underSource(() => {
    const f = fixture(), reference = { $ref: "same-reference" };
    f.add("Labelable", "same-reference", { label: "First reader" }, { kind: "tag", tag: "selected" }, 10);
    f.add("Labelable", "same-reference", { label: "Other reader" }, { kind: "tag", tag: "other" }, 10);
    let observations = 0;
    f.session.registry.getFunction = () => { observations++; return undefined; };
    f.project([reference]);
    const one = observations;
    expect(one).toBeGreaterThan(0);
    observations = 0;
    const packet = f.project([reference, reference]);
    expect(packet.children.map(row => row.path)).toEqual([[0], [1]]);
    expect(packet.children.map(row => row.caption)).toEqual([{ text: "First reader", code: false }, { text: "First reader", code: false }]);
    expect(observations).toBe(one);
    f.session.evaluateContext = { ...f.frame, _activeTags: ["other"] };
    observations = 0;
    const next = f.project([reference, reference]);
    expect(next.children.map(row => row.caption)).toEqual([{ text: "Other reader", code: false }, { text: "Other reader", code: false }]);
    expect(observations).toBe(one);
    expect(packet.children[0].caption.text).toBe("First reader");
    f.definitions.set("Number", number);
    f.add("Iconable", "Number", { icon: "star" }, { kind: "tag", tag: "selected" }, 10);
    f.add("Iconable", "Number", { icon: "heart" }, { kind: "tag", tag: "other" }, 10);
    f.session.evaluateContext = f.frame;
    expect(f.project([1, 2], List(number)).children.map(row => row.typeIcon)).toEqual(["star", "star"]);
    f.session.evaluateContext = { ...f.frame, _activeTags: ["other"] };
    expect(f.project([1, 2], List(number)).children.map(row => row.typeIcon)).toEqual(["heart", "heart"]);
  }), 60_000);

  test("media leaves match existing source predicates, including native binary carriers and bounded markup", () => underSource(() => {
    const f = fixture();
    const pixel = { r: 1, g: 2, b: 3, a: 255 };
    const samples = [new ArrayBuffer(4), new Uint16Array([1, 2]), new DataView(new ArrayBuffer(4)),
      new Date("2026-01-02"), "picture.png", "picture.PNG?width=2", "picture.png\n", "picture.png\r\n", "picture.png#fragment",
      "data:image/png;base64,AA==", { url: "HTTPS://example.org/a", name: "a", mimeType: "image/png", size: 1 },
      { url: "data:application/octet-stream;base64,AA==", name: "a", mimeType: "application/octet-stream", size: 1 },
      { url: "data:text/plain;charset=utf8;base64,AA==", name: "a", mimeType: "text/plain", size: 1 },
      { width: 1, height: 1, pixels: [pixel] }, { width: 1.5, height: 1, pixels: [pixel] },
      { $tag: "Text", content: "hello" }, { $tag: "Bold", child: { $tag: "Text", content: "hello" } },
      { $tag: "Fragment", children: [{ $tag: "Image", src: "a", alt: "b" }] }, { $tag: "Fragment", children: [null] },
      { $tag: "Paragraph", children: Array.from({ length: 101 }, (_, i) => i === 100 ? null : { $tag: "Text", content: "x" }) }];
    for (const value of samples) {
      const packet = f.project(value);
      expect(packet.root.body === "preview").toBe(hasDataPreview(value));
      if (hasDataPreview(value)) {
        expect(packet.root.structure).toBe("leaf");
        expect(packet.children).toEqual([]);
      }
    }
  }), 60_000);

  test("media source helpers preserve URL, safe-integer pixel, markup depth and shared-budget boundaries", () => underSource(() => {
    const call = (name, ...args) => dispatchEngineBody(`engine:${name}`, args, {});
    for (const text of ["a.png", "a.PNG?x=1", "a.svg\n", "a.jpg\r\n", "a.png#fragment", "a.png?x\n", "data:image/png,x", "DATA:IMAGE/png,x", "not an image"]) {
      expect(call("surfaceReaderMediaImageLike", text)).toBe(isImageLike(text));
    }
    for (const url of ["http://", "HTTPS://a/x", "ftp://a/x", "data:text/plain;base64,AA==", "DATA:text/plain;BASE64,AA==",
      "data:text/plain;charset=utf8;base64,AA==", "data:;base64,AA==", "data:text/plain,AA==", "data:text/plain;base64x,AA=="]) {
      const value = { url, name: "a", mimeType: "text/plain", size: NaN };
      expect(call("surfaceReaderMediaFile", value)).toBe(!!fileData(value));
    }
    for (const channel of [-1, 0, 255, 256, 2 ** 53 - 1, 2 ** 53, 1.5, Infinity, NaN, "1"]) {
      const value = { width: 1, height: 1, pixels: [{ r: channel, g: 0, b: 0, a: 255 }] };
      expect(call("surfaceReaderMediaInlineImage", value)).toBe(isInlineImageValue(value));
    }
    const text = { $tag: "Text", content: "hello" };
    const chain = depth => { let node = text; for (let index = 0; index < depth; index++) node = { $tag: "Bold", child: node }; return node; };
    const samples = [text, null, {}, { $tag: "Image", src: "x", alt: "" }, { $tag: "Image", src: "x" },
      { $tag: "Heading" }, { $tag: "List", items: [text, null] }, chain(64), chain(65),
      { $tag: "Paragraph", children: [...Array.from({ length: 100 }, () => text), null] },
      { $tag: "Fragment", children: Array.from({ length: 5 }, () => ({ $tag: "Paragraph", children: Array.from({ length: 100 }, () => text) })) }];
    for (const value of samples) for (const remaining of [0, 1, 3, 300]) {
      const budget = { remaining };
      const valid = isMarkup(value, 0, budget);
      expect(call("surfaceReaderMediaMarkupState", value, 0, remaining)).toEqual({ valid, remaining: budget.remaining });
    }
    for (const depth of [64, 65]) {
      const budget = { remaining: 300 }, valid = isMarkup(text, depth, budget);
      expect(call("surfaceReaderMediaMarkupState", text, depth, 300)).toEqual({ valid, remaining: budget.remaining });
    }
  }), 60_000);
});

describe("closed physical classification inside scoped reader packets", () => {
  test("reader helper overrides cannot redefine carrier shape; all other scoped observations remain outside the physical scope", () => underSource(() => {
    const f = fixture(), image = { width: 1, height: 1, pixels: [{ r: 1, g: 2, b: 3, a: 255 }] };
    let scopedLookups = 0, insidePhysical = false, physicalCalls = 0;
    f.frame.getFunction = id => {
      if (insidePhysical) throw new Error("scoped reader lookup entered physical classification");
      scopedLookups++;
      return ["surfaceReaderMediaInlineImage", "engine:surfaceReaderMediaInlineImage"].includes(id)
        ? { id, params: [field("value", Anything)], returns: { $ref: "Bool" }, body: false } : undefined;
    };
    const physicalScope = operation => {
      physicalCalls++; insidePhysical = true;
      try { return operation(); } finally { insidePhysical = false; }
    };
    const input = { value: image, typeLookup: "session", views: [], componentNames: [] };
    const first = projectReaderValueReadInSession(input, f.session, f.source, icons, physicalScope);
    expect(first.root.body).toBe("preview");
    const afterFirst = scopedLookups;
    const second = projectReaderValueReadInSession(input, f.session, f.source, icons, physicalScope);
    expect(second).toEqual(first);
    expect(physicalCalls).toBe(2); expect(scopedLookups).toBeGreaterThan(afterFirst);
    expect(insidePhysical).toBe(false);
    expect(hasDataPreview(image)).toBe(true);
  }), 60_000);
});
