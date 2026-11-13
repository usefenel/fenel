// ---------------------------------------------------------------------------
// typed-ref-frontend-readers.test.ts — typed-function-references Phase
// 7f-frontend proof. The SolidJS editor's OWN type-position readers now treat
// a type-position `{$ref}` IDENTICALLY to the `{$named}` it folds.
//
// The pure fold logic lives in the JSX-free `./type-readers` module that the
// three component `.tsx` files (TypeBuilder / expression-runner / FieldRenderer)
// delegate to — because `.tsx` modules CANNOT be loaded by `bun test` (the JSX
// runtime resolves to `react/jsx-dev-runtime`, which the solid package does not
// ship — verified empirically). This is the solid-JSX analogue of validate.ts's
// `*Shim` convention: single source of truth, a real `bun test` gate. The
// components' in-place fold sites call these exact primitives, so testing them
// here tests the readers' fold behavior.
//
// CONTROLLED, mirroring the 7e test: a 2-field entity registered via
// `registerCatalogEntities` under BOTH its code-name AND a controlled UUID
// (the 7d identity), never the global catalog. Atoms use literal names.
//
// Canonical spec: design/typed-function-references.md § "The type-layer merge".
//
// NB the lone `bun:test` solid-tsc error this file reports is test-tooling
// noise: the solid tsconfig pins `types: ["vinxi/types/client"]`, so `@types/
// bun` (which declares `bun:test`, present and used by every engine test) is
// not in scope here. A `/// <reference types="bun" />` fixes the import but
// pulls bun's GLOBAL types into the whole solid program (+13 errors), so the
// localized single error is the cleaner trade-off. No production code is
// affected; `bun test` runs the file regardless.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { Ref } from "@fenel/engine/type-foundation";
import {
  registerCatalogEntities,
  getEntityTypeByName,
  List,
  peelList,
  type FenelType,
  type FenelFunction,
} from "@fenel/engine";
import { refHandle, typePositionRefHandle, resolveRefToType, refLiteralKind } from "./type-readers";

// A controlled entity, registered under its code-name AND a controlled UUID so
// a UUID `{$ref}` resolves to the SAME type a code-name `{$ref}` does (7d).
const ENTITY_NAME = "FrontendReaderEntity7f";
const ENTITY_UUID = "7f000000-0000-4000-8000-000000000001";
const field = (name: string, type: FenelType) =>
  ({ name, label: { $tag: "Nothing" }, type, default: { $tag: "Nothing" }, meta: {}, ui: { $tag: "Nothing" } }) as unknown;
const ENTITY_TYPE: FenelType = {
  $record: {
    fields: [
      field("name", { $named: "String" } as unknown as FenelType),
      field("age", { $named: "Number" } as unknown as FenelType),
    ],
  },
} as unknown as FenelType;

registerCatalogEntities([
  { id: ENTITY_NAME, type: ENTITY_TYPE },
  { id: ENTITY_UUID, type: ENTITY_TYPE },
]);

// A stub function resolver — peelArrowType / resolveRefToType take the
// expression-runner's in-scope `getFunction`. `applyTo` resolves to an arrow.
const FN_HANDLE = "stub:applyTo";
const FN_ARROW: FenelType = {
  $arrow: { params: [{ name: "x", type: { $named: "Number" } }], returns: { $named: "String" } },
} as unknown as FenelType;
const stubGetFn = (id: string): FenelFunction | undefined =>
  id === FN_HANDLE
    ? ({ id: FN_HANDLE, params: [{ name: "x", type: { $named: "Number" } }], returns: { $named: "String" } } as unknown as FenelFunction)
    : undefined;
const noFn = (): FenelFunction | undefined => undefined;

// ---------------------------------------------------------------------------
// refHandle — the resolve-to-NAME primitive (detectKind / NamedBody /
// typeNameOf / baseTypeNameOf / typeMatches / simpleTypeName / displayTypeLabel
// / baseTag). 7g-retire-4b INVERTED `refToNamed` (the `{$ref}`→`{$named}`
// rewrite) to read the name-handle DIRECTLY via the engine's `refHandle`
// (`{$ref}` OR `{$named}` → the handle STRING, or undefined). Byte-identical
// for ANY handle BY CONSTRUCTION.
// ---------------------------------------------------------------------------

describe("7g-retire-4b — refHandle (resolve-to-NAME)", () => {
  test("{$ref:H} reads to the handle H for an entity handle", () => {
    expect(refHandle(Ref(ENTITY_NAME) as unknown as FenelType)).toBe(ENTITY_NAME);
  });

  test("{$ref:atom} reads to the atom handle — atoms are name-handles", () => {
    expect(refHandle(Ref("String") as unknown as FenelType)).toBe("String");
    expect(refHandle(Ref("Number") as unknown as FenelType)).toBe("Number");
  });

  test("{$named:H} reads to the SAME handle (dual-read tolerance / {$named} back-compat)", () => {
    // refHandle tolerates a legacy/persisted `{$named}` — the same handle.
    expect(refHandle({ $named: ENTITY_NAME } as unknown as FenelType)).toBe(ENTITY_NAME);
    // a non-name type (record) has no handle → undefined.
    expect(refHandle(ENTITY_TYPE)).toBeUndefined();
  });

  test("name-equality contract: refHandle({$ref:X}) === refHandle({$named:X}), ≢ ({$ref:Y})", () => {
    // typeMatches now compares the two handles (refHandle === refHandle).
    expect(refHandle(Ref("X") as unknown as FenelType)).toBe(refHandle({ $named: "X" } as unknown as FenelType));
    expect(refHandle(Ref("X") as unknown as FenelType)).toBe(refHandle(Ref("X") as unknown as FenelType));
    expect(refHandle(Ref("X") as unknown as FenelType)).not.toBe(refHandle(Ref("Y") as unknown as FenelType));
  });
});

// ---------------------------------------------------------------------------
// typePositionRefHandle — detectKind's primitive. A `{$ref}` is the same kind
// (`"named"`) as the `{$named}` it folds, so the NamedBody path renders it.
// ---------------------------------------------------------------------------

describe("Phase 7f-frontend — typePositionRefHandle (detectKind)", () => {
  test("returns the handle for a {$ref}, null otherwise — so detectKind({$ref}) and detectKind({$named}) both pick 'named'", () => {
    expect(typePositionRefHandle(Ref(ENTITY_NAME) as unknown as FenelType)).toBe(ENTITY_NAME);
    expect(typePositionRefHandle(Ref("String") as unknown as FenelType)).toBe("String");
    // a {$named} is NOT a ref → null → detectKind falls to its `$named` branch
    // (also "named"). Both shapes → the SAME kind.
    expect(typePositionRefHandle({ $named: ENTITY_NAME } as unknown as FenelType)).toBeNull();
    expect(typePositionRefHandle(ENTITY_TYPE)).toBeNull();
    expect(typePositionRefHandle(null)).toBeNull();
    expect(typePositionRefHandle(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveRefToType — the resolve-to-TYPE primitive (peelToRecord / peelArrowType).
// ---------------------------------------------------------------------------

describe("Phase 7f-frontend — resolveRefToType (peelToRecord / peelArrowType)", () => {
  test("the test entity resolves under its code-name AND its controlled UUID", () => {
    expect(getEntityTypeByName(ENTITY_NAME)).toEqual(ENTITY_TYPE);
    expect(getEntityTypeByName(ENTITY_UUID)).toEqual(ENTITY_TYPE);
  });

  test("an entity {$ref} resolves to its $record kind — IDENTICAL to the {$named} catalog lookup peelToRecord does", () => {
    const viaRef = resolveRefToType(Ref(ENTITY_NAME) as unknown as FenelType, noFn);
    expect(viaRef).toEqual(ENTITY_TYPE);
    // this is exactly what the `$named` arm resolves (`getEntityTypeByName`)
    expect(viaRef).toEqual(getEntityTypeByName(ENTITY_NAME));
  });

  test("7d UUID identity: a UUID {$ref} resolves to the SAME type as the code-name {$ref}", () => {
    const viaName = resolveRefToType(Ref(ENTITY_NAME) as unknown as FenelType, noFn);
    const viaUuid = resolveRefToType(Ref(ENTITY_UUID) as unknown as FenelType, noFn);
    expect(viaUuid).toEqual(viaName);
    expect(viaUuid).toEqual(ENTITY_TYPE);
  });

  test("a function {$ref} resolves to its $arrow (peelArrowType path)", () => {
    expect(resolveRefToType(Ref(FN_HANDLE) as unknown as FenelType, stubGetFn)).toEqual(FN_ARROW);
  });

  test("function-first precedence preserves value-position behavior byte-for-byte", () => {
    // a handle that is BOTH a registered function and (hypothetically) an
    // entity resolves as the function — refType consults getFunction first.
    expect(resolveRefToType(Ref(FN_HANDLE) as unknown as FenelType, stubGetFn)).toEqual(FN_ARROW);
  });

  test("a non-ref type → undefined (caller falls through to its existing path)", () => {
    expect(resolveRefToType({ $named: ENTITY_NAME } as unknown as FenelType, noFn)).toBeUndefined();
    expect(resolveRefToType(ENTITY_TYPE, noFn)).toBeUndefined();
  });

  test("graceful: an unresolvable {$ref} never throws → undefined; catalog-backed atoms resolve", () => {
    expect(() => resolveRefToType(Ref("DefinitelyNotAType7f") as unknown as FenelType, noFn)).not.toThrow();
    expect(resolveRefToType(Ref("DefinitelyNotAType7f") as unknown as FenelType, noFn)).toBeUndefined();
    // Foundation atoms are now catalog-backed, so the default resolver expands them.
    expect(resolveRefToType(Ref("String") as unknown as FenelType, noFn)).toEqual(getEntityTypeByName("String"));
  });
});

// ---------------------------------------------------------------------------
// Composite (Hard fact 1) — the engine peelers TypeBuilder/FieldRenderer import
// are ALREADY 7f-folded, so List({$ref}) detects as a list end-to-end. This
// proves detectKind(List({$ref})) === detectKind(List({$named})) (both "list").
// ---------------------------------------------------------------------------

describe("Phase 7f-frontend — composite via the already-folded engine peelers", () => {
  test("peelList(List({$ref})) is truthy, identical to List({$named}) — detectKind → 'list' for both", () => {
    const viaRef = peelList(List(Ref(ENTITY_NAME) as unknown as FenelType));
    const viaNamed = peelList(List({ $named: ENTITY_NAME } as unknown as FenelType));
    expect(viaRef).toBeTruthy();
    expect(viaNamed).toBeTruthy();
    // the inner element is carried through unchanged (the ref, resp. the named)
    expect(viaRef?.elem).toEqual(Ref(ENTITY_NAME) as unknown as FenelType);
    expect(viaNamed?.elem).toEqual({ $named: ENTITY_NAME } as unknown as FenelType);
  });
});

// ---------------------------------------------------------------------------
// Phase 7g-editor — the FIRST PRODUCER flip. The TypeBuilder type-definition
// pick (`NamedBody.pickName`) now EMITS `{ $ref: name }` where it emitted
// `{ $named: name }`. `pickName` is `.tsx`-bound (not bun-loadable), so we
// assert its OUTPUT SHAPE as a data invariant (Phase-4 precedent) and re-pin
// that the 7f-frontend consumer fold covers that exact output. `producerEmit`
// is a byte-for-byte transcription of the flipped `pickName` else-branch.
// ---------------------------------------------------------------------------

/** Byte-for-byte mirror of `TypeBuilder.NamedBody.pickName`'s flipped commit
 *  branch (the non-parameterized path) — what the GUI now persists. */
const producerEmit = (name: string): FenelType => ({ $ref: name }) as unknown as FenelType;

describe("Phase 7g-editor — the flipped producer's emitted shape", () => {
  test("emits a single-key, string-valued {$ref} record (read-back-safe literal, never an array-shaped call)", () => {
    const out = producerEmit(ENTITY_NAME) as Record<string, unknown>;
    const keys = Object.keys(out);
    expect(keys).toEqual(["$ref"]);
    expect(typeof out.$ref).toBe("string");
    expect(Array.isArray(out.$ref)).toBe(false);
    // identical to the engine `Ref(name)` form (the canonical reference value)
    expect(out).toEqual(Ref(ENTITY_NAME) as unknown as Record<string, unknown>);
  });

  test("the emitted shape folds IDENTICALLY to the pre-flip {$named} — entity handle", () => {
    const emitted = producerEmit(ENTITY_NAME);
    // refToNamed: the resolve-to-NAME fold the renderer / inference use
    expect(refHandle(emitted)).toBe(ENTITY_NAME);
    // typePositionRefHandle: detectKind picks "named" for the emitted shape
    expect(typePositionRefHandle(emitted)).toBe(ENTITY_NAME);
    // resolveRefToType: an entity handle resolves to its $record
    expect(resolveRefToType(emitted, noFn)).toEqual(ENTITY_TYPE);
  });

  test("the emitted shape folds IDENTICALLY to the pre-flip {$named} — atom handle (D3/F5)", () => {
    const emitted = producerEmit("String");
    expect(refHandle(emitted)).toBe("String");
    expect(typePositionRefHandle(emitted)).toBe("String");
    // Foundation atoms are catalog-backed; the caller can still use resolve-to-NAME for display.
    expect(resolveRefToType(emitted, noFn)).toEqual(getEntityTypeByName("String"));
  });

  test("the emitted shape folds IDENTICALLY under the 7d UUID handle", () => {
    const emitted = producerEmit(ENTITY_UUID);
    expect(refHandle(emitted)).toBe(ENTITY_UUID);
    expect(typePositionRefHandle(emitted)).toBe(ENTITY_UUID);
    // resolves to the SAME type the code-name handle does (7d identity)
    expect(resolveRefToType(emitted, noFn)).toEqual(ENTITY_TYPE);
    expect(resolveRefToType(emitted, noFn)).toEqual(resolveRefToType(producerEmit(ENTITY_NAME), noFn));
  });

  test("round-trip: a stored emitted {$ref} re-emits the SAME shape (lossless re-save)", () => {
    // detectKind → "named" (typePositionRefHandle truthy) → NamedBody shows the
    // handle (.$ref ?? .$named) → re-pick re-runs pickName → same {$ref}.
    const stored = producerEmit(ENTITY_NAME);
    const handle = typePositionRefHandle(stored)!;            // what NamedBody displays
    expect(producerEmit(handle)).toEqual(stored);             // re-save is byte-identical
  });
});

// ---------------------------------------------------------------------------
// Phase 7g-value — the SECOND producer flip + the type-vs-function ƒ-pill
// disambiguation. `pickTypeRef` (a type used AS a value) now EMITS the SAME
// type-transparent `{$ref:handle}` Phase 4's `pickFunctionRef` emits for a
// function-as-value. The editor's value-position render gate therefore receives
// `{$ref}` from two intents and DISCRIMINATES via `refLiteralKind` — resolving
// the handle FUNCTION-FIRST: a function-handle → the ƒ-pill (Phase 4, GUARDED);
// a type-handle → the new type-pill. `refLiteralKind` is `.tsx`-importable-free
// (JSX-free), so we test it directly here; the `.tsx` gate wiring + the
// type-pill DOM are asserted by solid-tsc + the manual smoke (Phase-4 precedent).
// ---------------------------------------------------------------------------

/** Byte-for-byte mirror of the flipped `pickTypeRef` commit branch — what the
 *  GUI now persists for a type used as a value. */
const typeRefProducerEmit = (name: string): Record<string, unknown> => ({ $ref: name });

// A function resolved under BOTH its code-name AND a controlled 7d UUID (the
// editor's `editorGetFunction` is keyed by id / code-name / UUID alike). An
// ENTITY handle resolves to NO function → "type"; an atom likewise.
const FN_UUID = "7f000000-0000-4000-8000-0000000000f0";
const fnExists = (id: string): FenelFunction | undefined =>
  id === FN_HANDLE || id === FN_UUID
    ? ({ id, params: [], returns: { $named: "String" } } as unknown as FenelFunction)
    : undefined;

describe("Phase 7g-value — refLiteralKind (the type-vs-function disambiguator)", () => {
  test("a function handle → 'function' (code-name AND its 7d UUID) → the ƒ-pill path", () => {
    expect(refLiteralKind(Ref(FN_HANDLE), fnExists)).toBe("function");
    expect(refLiteralKind(Ref(FN_UUID), fnExists)).toBe("function");
  });

  test("an entity handle → 'type' (code-name AND its 7d UUID) → the type-pill path", () => {
    // resolves to NO function (function-first miss) → "type". The handle being
    // a real entity is incidental — "not a function ⇒ type" is the rule.
    expect(refLiteralKind(Ref(ENTITY_NAME), fnExists)).toBe("type");
    expect(refLiteralKind(Ref(ENTITY_UUID), fnExists)).toBe("type");
  });

  test("an atom handle → 'type' (D3/F5 — atoms are type-side name-handles)", () => {
    expect(refLiteralKind(Ref("String"), fnExists)).toBe("type");
    expect(refLiteralKind(Ref("Number"), fnExists)).toBe("type");
  });

  test("a non-{$ref} value → null → the caller falls to LiteralEditor", () => {
    expect(refLiteralKind({ $named: ENTITY_NAME }, fnExists)).toBeNull();
    expect(refLiteralKind(42, fnExists)).toBeNull();
    expect(refLiteralKind("plain string", fnExists)).toBeNull();
    expect(refLiteralKind({ x: 1 } as unknown, fnExists)).toBeNull();
    expect(refLiteralKind(null, fnExists)).toBeNull();
    expect(refLiteralKind(undefined, fnExists)).toBeNull();
  });

  test("function-first precedence is byte-stable: a handle that IS a function resolves 'function' even when it also names a type", () => {
    // mirror refType's precedence — getFunction is consulted before any
    // type/entity lookup, so a collision (hypothetical) resolves as the fn.
    const bothFnAndEntity = (id: string): FenelFunction | undefined =>
      id === ENTITY_NAME ? ({ id, params: [], returns: { $named: "String" } } as unknown as FenelFunction) : undefined;
    expect(refLiteralKind(Ref(ENTITY_NAME), bothFnAndEntity)).toBe("function");
    // and with the real (function-miss) resolver it's a type — proving the
    // discrimination tracks the resolver, not the handle's casing.
    expect(refLiteralKind(Ref(ENTITY_NAME), fnExists)).toBe("type");
  });
});

describe("Phase 7g-value — the flipped pickTypeRef producer's emitted shape", () => {
  test("emits a single-key, string-valued {$ref} record (read-back-safe, identical to engine Ref)", () => {
    const out = typeRefProducerEmit(ENTITY_NAME);
    expect(Object.keys(out)).toEqual(["$ref"]);
    expect(typeof out.$ref).toBe("string");
    expect(Array.isArray(out.$ref)).toBe(false);
    expect(out).toEqual(Ref(ENTITY_NAME) as unknown as Record<string, unknown>);
  });

  test("the emitted type-ref discriminates as 'type' (function-miss resolver) — renders the type-pill, NOT the ƒ-pill", () => {
    expect(refLiteralKind(typeRefProducerEmit(ENTITY_NAME), fnExists)).toBe("type");
    expect(refLiteralKind(typeRefProducerEmit("String"), fnExists)).toBe("type");
  });

  test("round-trip: a stored type-ref {$ref} re-reads as the SAME shape (lossless re-save)", () => {
    const stored = typeRefProducerEmit(ENTITY_NAME);
    const handle = typePositionRefHandle(stored as unknown as FenelType)!; // what the pill displays
    expect(typeRefProducerEmit(handle)).toEqual(stored);
  });
});

// ---------------------------------------------------------------------------
// Phase 7g-value-nested — the THIRD + FOURTH producer flips. The two
// nested-wrapper `handlePickTypeRef` (NestedExprWrapper / NestedListItemWrapper,
// byte-identical) now EMIT `{ $ref: name }` for a type picked into a nested
// record-field / list-item Type-meta slot. Unlike 7g-value these are
// collision-FREE (emit via props.onChange, no ƒ-pill gate) AND fold-FREE: the
// value renders through the child FieldRenderer's `$type` branch
// (FieldRenderer.tsx:590) → TypeBuilder, which is ALREADY 7f-frontend-folded
// (reads `{$ref}` ≡ `{$named}`) and 7g-editor-flipped (produces `{$ref}`). So
// the same fold primitives prove the render-path lossless — no new render code.
// `nestedTypeRefEmit` is a byte-for-byte mirror of both flipped bodies.
// ---------------------------------------------------------------------------

/** Byte-for-byte mirror of both nested `handlePickTypeRef` flipped bodies
 *  (NestedExprWrapper + NestedListItemWrapper) — what the GUI persists for a
 *  type picked into a nested record-field / list-item Type-meta slot. */
const nestedTypeRefEmit = (name: string): Record<string, unknown> => ({ $ref: name });

describe("Phase 7g-value-nested — the two nested handlePickTypeRef producers' emitted shape", () => {
  test("emits a single-key, string-valued {$ref} record — IDENTICAL to engine Ref(name)", () => {
    const out = nestedTypeRefEmit(ENTITY_NAME);
    expect(Object.keys(out)).toEqual(["$ref"]);
    expect(typeof out.$ref).toBe("string");
    expect(Array.isArray(out.$ref)).toBe(false);
    expect(out).toEqual(Ref(ENTITY_NAME) as unknown as Record<string, unknown>);
    // both wrappers emit the identical shape (carbon copies)
    expect(out).toEqual(typeRefProducerEmit(ENTITY_NAME));
  });

  test("folds IDENTICALLY to the pre-flip {$named} via TypeBuilder's primitives — entity handle", () => {
    const emitted = nestedTypeRefEmit(ENTITY_NAME) as unknown as FenelType;
    // detectKind picks "named" for the emitted shape (TypeBuilder renders it)
    expect(typePositionRefHandle(emitted)).toBe(ENTITY_NAME);
    // resolve-to-NAME fold (NamedBody / displayTypeLabel)
    expect(refHandle(emitted)).toBe(ENTITY_NAME);
    // resolve-to-TYPE: an entity handle resolves to its $record
    expect(resolveRefToType(emitted, noFn)).toEqual(ENTITY_TYPE);
  });

  test("folds IDENTICALLY to the pre-flip {$named} — atom handle (D3/F5: handlePickTypeRef('String') → {$ref:'String'})", () => {
    const emitted = nestedTypeRefEmit("String") as unknown as FenelType;
    expect(typePositionRefHandle(emitted)).toBe("String");
    expect(refHandle(emitted)).toBe("String");
    // Foundation atoms are catalog-backed; TypeBuilder's NamedBody still renders the name.
    expect(resolveRefToType(emitted, noFn)).toEqual(getEntityTypeByName("String"));
  });

  test("folds IDENTICALLY under the 7d UUID handle (lock bridges name→UUID)", () => {
    const emitted = nestedTypeRefEmit(ENTITY_UUID) as unknown as FenelType;
    expect(typePositionRefHandle(emitted)).toBe(ENTITY_UUID);
    expect(refHandle(emitted)).toBe(ENTITY_UUID);
    // resolves to the SAME type the code-name handle does (7d identity)
    expect(resolveRefToType(emitted, noFn)).toEqual(ENTITY_TYPE);
    expect(resolveRefToType(emitted, noFn)).toEqual(
      resolveRefToType(nestedTypeRefEmit(ENTITY_NAME) as unknown as FenelType, noFn),
    );
  });

  test("round-trip through TypeBuilder's detectKind → typePositionRefHandle: re-save is byte-identical", () => {
    // detectKind → "named" (typePositionRefHandle truthy) → NamedBody displays the
    // handle (.$ref ?? .$named) → re-pick re-runs handlePickTypeRef → same {$ref}.
    const stored = nestedTypeRefEmit(ENTITY_NAME);
    const handle = typePositionRefHandle(stored as unknown as FenelType)!;
    expect(nestedTypeRefEmit(handle)).toEqual(stored);
  });
});
