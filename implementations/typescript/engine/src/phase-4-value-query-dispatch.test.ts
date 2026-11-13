// Phase 4 of typeclass-substrate-completion — conformance tests for the
// VALUE-QUERY dispatch model: an instance is a typed value, and dispatch is a
// **type-indexed query over the registered values**, keyed by each value's
// DECLARED type-constructor (design/unified-dispatch.md §§ "An instance is a
// typed value", "Resolution is a type-indexed query over the value registry").
//
// What this phase landed (and what it pins):
//   - `DispatchRegistry.registerValue(declaredType, value)` — register a
//     typed value under the `(type-constructor, type-args)` key DERIVED from
//     its declared type. The `instances` Map is the derived index; the
//     observable `resolve`/`satisfies`/`findInstance` reads are type-queries.
//   - The substrate is **suffix-agnostic**: `typeName` is just a type-name
//     string, keyed verbatim. A class resolves under whatever its declared
//     type-name is — `TestMonoid` (like 3.5's `Monad`/`Monoid`) keys under
//     `TestMonoid`. Phase 3.4c completed the `<X>Spec` → `<X>` clean break, so
//     there is no suffix-strip step anymore — the corpus + Constraint
//     entityIds are all suffix-free and nothing needs converging.
//   - Swap-invariance: the Phase 3.5 method-dispatch surface (`resolveMethod`)
//     rides on the value-query index UNCHANGED — re-asserted here against a
//     fresh `registerValue`-populated registry. (The untouched
//     `phase-3.5-method-dispatch-surface.test.ts` is the primary oracle.)
//
// NOTE (scope): the `<X>Spec` → `<X>` mass rename landed across Phases 3.4a–c
// (corpus + persistence + catalog + the 162 Constraint entityIds + every
// suffix-strip bridge). This test proves the resolution SUBSTRATE keys by the
// literal declared type-name with no suffix transform; the renamed live corpus
// is exercised by `phase-3.4b-drop-spec-suffix.test.ts`.
//
// All fixtures use a FRESH `createDispatchRegistry()` — isolated from the
// shared `dispatchRegistry`, so this file is audit / system-entity delta-neutral.

import { describe, it, expect } from "bun:test";
import { createDispatchRegistry } from "./dispatch-registry";
import {
  resolveMethod,
  methodDispatchPosition,
  RETURN_POSITION,
} from "./effect-dispatch";
import { Nothing } from "./type-foundation";
import type { FenelType, FieldDef, Interface } from "./types";
import { GLOBAL_ONLY } from "./dispatch-registry";

// A full FieldDef param — the dispatch derivation only reads `.type`, but the
// type wants the whole shape (mirrors the 3.5 fixture helper).
const fp = (name: string, type: FenelType): FieldDef => ({
  name,
  type,
  label: Nothing,
  ui: Nothing,
  meta: {},
});

// TestMonoid a — `mappend : a -> a -> a` (class param `a` heads arg 0 →
// arg-0 dispatch). Suffix-FREE class name (the point: the substrate doesn't
// care). Distinct method descriptors make the projected method observable
// without placing host callables in Fenel values.
const monoidSeed: Interface = {
  name: "TestMonoid",
  params: [{ name: "a" }],
  methods: [
    {
      name: "mappend",
      params: [fp("_0", { $var: "a" }), fp("_1", { $var: "a" })],
      returns: { $var: "a" },
    },
  ],
};

// The declared type of an instance value: `TestMonoid <T>` as the parser emits
// a type application — `{$el: {call: [Head, ...args]}}`.
const monoidAt = (t: string): FenelType => ({
  $el: { call: ["TestMonoid", { $ref: t }] },
});

const STRING_MAPPEND = "test:phase4MappendString";
const LIST_MAPPEND = "test:phase4MappendList";
const SWAP_MAPPEND = "test:phase4SwapMappend";

function freshRegistry() {
  const reg = createDispatchRegistry();
  reg.defineClass(monoidSeed);
  // Register two instances AS TYPED VALUES — the key is DERIVED from the
  // declared type, never separately authored.
  reg.registerValue(monoidAt("String"), {
    mappend: STRING_MAPPEND,
  });
  reg.registerValue(monoidAt("List"), {
    mappend: LIST_MAPPEND,
  });
  return reg;
}

// ---------------------------------------------------------------------------
// (a) registerValue derives the dispatch key from the declared type.
// ---------------------------------------------------------------------------

describe("Phase 4 (a) — registerValue derives the (type-constructor, type-args) key", () => {
  it("a value registered at `TestMonoid String` is queryable by its declared type", () => {
    const reg = freshRegistry();
    expect(reg.satisfies("String", "TestMonoid", GLOBAL_ONLY)).toBe(true);
    expect(reg.satisfies("List", "TestMonoid", GLOBAL_ONLY)).toBe(true);
    // A type with no registered value → the query misses.
    expect(reg.satisfies("Number", "TestMonoid", GLOBAL_ONLY)).toBe(false);
  });

  it("the derived index key is the type-constructor, NOT a separately-authored name", () => {
    const reg = freshRegistry();
    // listInstances(typeName) returns exactly the values whose declared
    // type-constructor is `typeName` — the index is keyed by the derived head.
    const insts = reg.listInstances("TestMonoid");
    expect(insts).toHaveLength(2);
    expect(insts.map((i) => i.args[0]).sort()).toEqual(["List", "String"]);
    // No phantom "TestMonoidSpec" key — the derivation produced the bare head.
    expect(reg.listInstances("TestMonoidSpec")).toHaveLength(0);
  });

  it("resolve returns the projected method record for the matched type", () => {
    const reg = freshRegistry();
    const dict = reg.resolve("String", "TestMonoid", GLOBAL_ONLY);
    expect(dict).toBeDefined();
    expect(dict!.mappend).toBe(STRING_MAPPEND);
  });
});

// ---------------------------------------------------------------------------
// (b) The type-query discriminates by type-args — multiple dispatch.
// ---------------------------------------------------------------------------

describe("Phase 4 (b) — the query discriminates by type-args (multiple dispatch)", () => {
  it("two values at different type-args resolve to DIFFERENT methods", () => {
    const reg = freshRegistry();
    const strDict = reg.resolve("String", "TestMonoid", GLOBAL_ONLY)!;
    const listDict = reg.resolve("List", "TestMonoid", GLOBAL_ONLY)!;
    expect(strDict.mappend).toBe(STRING_MAPPEND);
    expect(listDict.mappend).toBe(LIST_MAPPEND);
  });

  it("findInstance returns the value whose declared type-args match the query", () => {
    const reg = freshRegistry();
    expect(reg.implementedBy("String", GLOBAL_ONLY).map((c) => c.name)).toContain("TestMonoid");
    expect(reg.implementedBy("Number", GLOBAL_ONLY).map((c) => c.name)).not.toContain("TestMonoid");
  });
});

// ---------------------------------------------------------------------------
// (c) Suffix-agnostic — keys by the literal declared type-name (no transform).
// ---------------------------------------------------------------------------

describe("Phase 4 (c) — the substrate is suffix-agnostic; it keys by the literal type-name", () => {
  it("a suffix-FREE class name resolves end-to-end (the model, no `Spec` anywhere)", () => {
    const reg = freshRegistry();
    // Nothing in the resolution path required a `Spec` suffix.
    expect(reg.resolve("String", "TestMonoid", GLOBAL_ONLY)).toBeDefined();
    expect(reg.getClass("TestMonoid")?.name).toBe("TestMonoid");
  });

  it("a declaration keys under its literal declared type-name — no suffix transform (Phase 3.4c clean break)", () => {
    const reg = createDispatchRegistry();
    reg.defineClass({ name: "Foo", params: [{ name: "a" }], methods: [] });
    // Phase 3.4c — the suffix-strip scaffolding is gone. A `Foo a` declaration
    // keys verbatim under typeName "Foo"; there is no `<X>Spec` → `<X>`
    // convergence step anymore (the corpus + Constraint entityIds are all
    // suffix-free, so nothing needs converging).
    reg.registerValue({ $el: { call: ["Foo", { $ref: "Bar" }] } }, { m: 1 });
    expect(reg.satisfies("Bar", "Foo", GLOBAL_ONLY)).toBe(true);
    expect(reg.listInstances("Foo")).toHaveLength(1);
  });

  it("registerValue (type-derived) and addInstance (pre-keyed) produce the same index entry", () => {
    const viaValue = createDispatchRegistry();
    viaValue.defineClass(monoidSeed);
    viaValue.registerValue(monoidAt("String"), { mappend: SWAP_MAPPEND });

    const viaInstance = createDispatchRegistry();
    viaInstance.defineClass(monoidSeed);
    viaInstance.addInstance({
      typeName: "TestMonoid",
      args: ["String"],
      methods: { mappend: SWAP_MAPPEND },
    });

    const a = viaValue.listInstances("TestMonoid")[0]!;
    const b = viaInstance.listInstances("TestMonoid")[0]!;
    expect(a.typeName).toBe(b.typeName);
    expect(a.args).toEqual(b.args);
    expect(viaValue.satisfies("String", "TestMonoid", GLOBAL_ONLY)).toBe(
      viaInstance.satisfies("String", "TestMonoid", GLOBAL_ONLY),
    );
  });
});

// ---------------------------------------------------------------------------
// (d) Swap-invariance — the Phase 3.5 method-dispatch surface rides on the
//     value-query index UNCHANGED (re-asserted on a fresh registry).
// ---------------------------------------------------------------------------

describe("Phase 4 (d) — the 3.5 resolveMethod surface rides on the value-query index unchanged", () => {
  it("resolveMethod reflects the dispatch arg, queries the value index, projects + returns Unique", () => {
    const reg = freshRegistry();
    // Dispatch on a String value → reflects to "String" → queries the value
    // registered at `TestMonoid String` → projects `mappend`. ctx=undefined is
    // fine: String reflection needs no `_caseOwner`, and the scope walk falls
    // straight through to the registry (global) query.
    const r = resolveMethod("TestMonoid", "mappend", ["hi", "there"], undefined, reg);
    expect(r.$tag).toBe("Unique");
    if (r.$tag === "Unique") {
      expect(r.key).toBe("String");
      expect(r.method).toBe(STRING_MAPPEND);
    }
  });

  it("multiple dispatch through resolveMethod: a List arg picks the List value's method", () => {
    const reg = freshRegistry();
    const r = resolveMethod("TestMonoid", "mappend", [[1], [2]], undefined, reg);
    expect(r.$tag).toBe("Unique");
    if (r.$tag === "Unique") {
      expect(r.key).toBe("List");
      expect(r.method).toBe(LIST_MAPPEND);
    }
  });

  it("a type with no registered value surfaces None (the type-query miss is a value)", () => {
    const reg = freshRegistry();
    const r = resolveMethod("TestMonoid", "mappend", [42, 43], undefined, reg);
    expect(r.$tag).toBe("None");
  });

  it("the dispatch position is still derived from the class signature (3.5 step 2, unchanged)", () => {
    const reg = freshRegistry();
    expect(methodDispatchPosition(reg, "TestMonoid", "mappend")).toBe(0);
    // An unknown class has no signature to derive from → RETURN_POSITION.
    expect(methodDispatchPosition(reg, "Unknown", "nope")).toBe(RETURN_POSITION);
  });
});
