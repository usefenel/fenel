// ---------------------------------------------------------------------------
// list-string-repr.test.ts — representation-substrate Phase 3. The round-trip
// discharge for the two HOT-PATH `Reprable JsRuntime` instances:
//   * `Reprable JsRuntime List`   — the cons-spine ↔ native-array spine bridge
//     (listToArray / arrayToList), ELEMENT-TRANSPARENT (the spine is the only
//     thing re-encoded; each element rides through untouched).
//   * `Reprable JsRuntime String` — the JS-string ↔ List Char bridge
//     (charListToString / stringToCharList), which DOES touch elements (split /
//     rejoin via chars/join) because the native is a flat code-point sequence.
//
// The instances OMIT their two `Verified Boolean` round-trip law fields (the
// isoBase64 / Bool / Nat / Int / Rational precedent); this file is the honest
// sample discharge, keyed off each instance's DECLARED method fnIds (binding the
// law to the .fenel instance). Ledgered test-tooling (the nat-peano.test.ts /
// int-tower.test.ts / bool-opaque.test.ts precedent).
//
// PARAMETRIC-HEAD FALLBACK (Step-0 verdict, notes/phase-3-step0-probe.md): the
// List instance head is the BARE `List` (`Reprable JsRuntime List`), recording
// `args = ["JsRuntime","List"]`. The natural parametric head `(List a)` does NOT
// register cleanly — the parser EXPANDS the registered type-app to its full
// `$opaque`, so `args[1]` would be that object, not the string the dispatch index
// keys on. Parametricity lives in the body's element-transparency, not the head.
//
// CODEPOINT vs CODE-UNIT (String): the bridge uses `chars`, which splits by
// Unicode CODE POINT (emoji / non-BMP scalars stay grouped — NOT UTF-16 code
// units), so a 🦊 (a surrogate pair in UTF-16) is ONE Char element and round-trips
// intact. The pin below asserts this.
// ---------------------------------------------------------------------------

import { test, expect } from "bun:test";
import listReprSrc from "../../../../fenel/modules/std/list/list-repr.fenel?raw";
import stringReprSrc from "../../../../fenel/modules/std/string/string-repr.fenel?raw";
import { loadFenelModuleUnion } from "./fenel-module";
import { stdModule } from "./modules/std";
import { createRegistry } from "./registry";
import { evaluate } from "./json-logic";
import { dispatchRegistry } from "./system-entities";

const LIST_IDS = ["std:listToArray", "std:arrayToList"];
const STRING_IDS = ["std:stringToCharList", "std:charListToString"];

test("list-repr.fenel + string-repr.fenel parse to exactly the 4 expected fnIds", () => {
  const mod = loadFenelModuleUnion(
    [listReprSrc, stringReprSrc].map((src) => ({ src, name: "std" })),
  ).find((m) => m.name === "std")!;
  const ids = (mod.functions ?? []).map((f) => f.id).sort();
  expect(ids).toEqual([...LIST_IDS, ...STRING_IDS].sort());
  for (const f of mod.functions ?? []) expect(f.body).toBeDefined();
});

test("the four bridges are wired into stdModule with Fenel bodies", () => {
  for (const id of [...LIST_IDS, ...STRING_IDS]) {
    const fn = (stdModule.functions ?? []).find((f) => f.id === id);
    expect(fn).toBeDefined();
    expect(fn!.body).toBeDefined();
  }
});

// The registry + evaluator harness (the int-tower.test.ts pattern). systemEntities
// (incl. List + String — registered as catalog entities in this phase via
// foundation.fenel `@directives`) are pulled into the registry automatically, so
// the `$opaque`-peel indexes List's `Nil`/`Cons` and the positional bridge bodies
// build/match the canonical `{$tag:"Cons",_0,_1}` / `{$tag:"Nil"}` surface.
const reg = createRegistry([stdModule]);
const ctx = reg.evaluateContext();
// modules-as-values Phase 2b: an instance's lift / lower is a qualified function
// reference (`{$ref: "std.natToNumber"}`); this registry resolves it to the id of
// the function the harness runs.
const declaredId = (ref: unknown): string => {
  const handle = (ref as { $ref?: unknown } | undefined)?.$ref;
  const id = typeof handle === "string" ? reg.getFunction(handle)?.id : undefined;
  if (id === undefined) throw new Error(`unresolvable lift/lower reference ${JSON.stringify(ref)}`);
  return id;
};
const body = (id: string) => (stdModule.functions ?? []).find((f) => f.id === id)!.body;
const run = (id: string, data: Record<string, unknown>) => evaluate(body(id), data, ctx);
// pass every bridge param key — each body resolves only the var it references.
const call1 = (id: string, v: unknown) =>
  run(id, { xs: v, arr: v, s: v, cs: v });

const toNat = (n: number) => run("std:numberToNat", { n });
const toInt = (n: number) => run("std:numberToInt", { n });

// ---------------------------------------------------------------------------
// Instance projections (the int-tower precedent).
// ---------------------------------------------------------------------------

const reprable = (typeName: string) => {
  const i = [...dispatchRegistry.listInstances("Reprable")].find(
    (x) => x.args[0] === "JsRuntime" && x.args[1] === typeName,
  );
  if (!i) throw new Error(`Reprable JsRuntime ${typeName} instance not registered`);
  return i;
};

test("Reprable JsRuntime List — instance projected with native type-ref + spine bridges (bare-List head fallback)", () => {
  const list = reprable("List");
  expect(list.typeName).toBe("Reprable");
  expect(list.args).toEqual(["JsRuntime", "List"]);
  // `native = List` lowered to a type ref via typeValuedFields ({$ref}, the
  // Phase-1 finding); lift/lower reference the spine bridges.
  expect(list.methods.native).toEqual({ $ref: "List" });
  expect(list.methods.lift).toEqual({ $ref: "std.listToArray" });
  expect(list.methods.lower).toEqual({ $ref: "std.arrayToList" });
});

test("Reprable JsRuntime String — instance projected with native type-ref + char bridges", () => {
  const str = reprable("String");
  expect(str.typeName).toBe("Reprable");
  expect(str.args).toEqual(["JsRuntime", "String"]);
  expect(str.methods.native).toEqual({ $ref: "String" });
  expect(str.methods.lift).toEqual({ $ref: "std.charListToString" });
  expect(str.methods.lower).toEqual({ $ref: "std.stringToCharList" });
});

test("Reprable family count = 16 (8 JsRuntime atoms + 8 Jsonb, +Real Phase 4)", () => {
  // Bool + Nat + Int + Rational (=4) + List + String (this phase, =6) + Char
  // (Phase 4, =7) `Reprable JsRuntime` instances + the 7 storage-target
  // `Reprable Jsonb` siblings (Phase 5c) = 14, PLUS numeric-tower Phase 4's 8th
  // atom Real under both targets (JsRuntime + Jsonb) = 16. The count re-pins
  // downstream as the family grows; the per-instance projections above pin THIS
  // phase's additions.
  expect([...dispatchRegistry.listInstances("Reprable")].length).toBe(18);
});

// ---------------------------------------------------------------------------
// List round-trip — via the instance's DECLARED lift/lower (listToArray /
// arrayToList). lift = cons-spine → array; lower = array → cons-spine.
// ---------------------------------------------------------------------------

const LIST_SAMPLES: unknown[][] = [
  [],
  [42],
  [1, 2, 3, 4, 5],
  ["a", "b", "c"],
  [true, false, true],
];

test("Reprable JsRuntime List — round-trip on the native + List sides", () => {
  const list = reprable("List");
  const lift = declaredId(list.methods.lift); // List -> array (cons-spine → array)
  const lower = declaredId(list.methods.lower); // array -> List (array → cons-spine)
  for (const arr of LIST_SAMPLES) {
    // reprLiftLowerRoundtrip: lift (lower arr) ≡ arr   (native array side)
    expect(call1(lift, call1(lower, arr))).toEqual(arr);
    // reprLowerLiftRoundtrip: lower (lift spine) ≡ spine   (cons-spine side)
    const spine = call1(lower, arr);
    expect(call1(lower, call1(lift, spine))).toEqual(spine);
  }
});

test("Reprable JsRuntime List — lower builds the canonical cons-spine; empty ⇒ Nil", () => {
  const lower = declaredId(reprable("List").methods.lower);
  expect(call1(lower, [])).toEqual({ $tag: "Nil" });
  expect(call1(lower, [7])).toEqual({ $tag: "Cons", _0: 7, _1: { $tag: "Nil" } });
  expect(call1(lower, [1, 2])).toEqual({
    $tag: "Cons",
    _0: 1,
    _1: { $tag: "Cons", _0: 2, _1: { $tag: "Nil" } },
  });
});

test(
  "Reprable JsRuntime List — element-TRANSPARENT: Nat / Int / String elements round-trip byte-identical",
  () => {
    const list = reprable("List");
    const lift = declaredId(list.methods.lift);
    const lower = declaredId(list.methods.lower);
    // Elements are themselves in THEIR repr (pure Peano Nat / sign-magnitude Int /
    // plain strings); the spine bridge must NOT touch them.
    const elemGrids: unknown[][] = [
      [toNat(0), toNat(3), toNat(7)],
      [toInt(-5), toInt(0), toInt(42)],
      ["", "x", "the quick brown fox"],
    ];
    for (const arr of elemGrids) {
      const back = call1(lift, call1(lower, arr));
      // byte-identical: the elements survive untouched through the spine bridge.
      expect(back).toEqual(arr);
    }
  },
  20000, // SLOW — interpreter materialization of the Peano/sign-magnitude elements.
);

// ---------------------------------------------------------------------------
// String round-trip — via the instance's DECLARED lift/lower (charListToString /
// stringToCharList). lift = List Char → JS string; lower = JS string → List Char.
// ---------------------------------------------------------------------------

const STRING_SAMPLES = [
  "",
  "a",
  "Hello",
  "the quick brown fox",
  "rom@usefenel.com",
  "héllo wörld", // multi-byte (BMP) accents
  "🦊 unicode", // emoji = a surrogate pair in UTF-16, ONE Char by code point
];

test("Reprable JsRuntime String — round-trip on the string + List Char sides", () => {
  const str = reprable("String");
  const lift = declaredId(str.methods.lift); // List Char -> String
  const lower = declaredId(str.methods.lower); // String -> List Char
  for (const s of STRING_SAMPLES) {
    // reprLiftLowerRoundtrip: lift (lower s) ≡ s   (JS string side)
    expect(call1(lift, call1(lower, s))).toBe(s);
    // reprLowerLiftRoundtrip: lower (lift cs) ≡ cs   (List Char cons-spine side)
    const cs = call1(lower, s);
    expect(call1(lower, call1(lift, cs))).toEqual(cs);
  }
});

test("Reprable JsRuntime String — code-POINT granularity: emoji is ONE Char, not two code units", () => {
  const lower = declaredId(reprable("String").methods.lower);
  // "🦊" is a single Unicode scalar (U+1F98A) → ONE Cons cell, not two.
  expect(call1(lower, "🦊")).toEqual({
    $tag: "Cons",
    _0: "🦊",
    _1: { $tag: "Nil" },
  });
  // ASCII char list shape.
  expect(call1(lower, "ab")).toEqual({
    $tag: "Cons",
    _0: "a",
    _1: { $tag: "Cons", _0: "b", _1: { $tag: "Nil" } },
  });
});
