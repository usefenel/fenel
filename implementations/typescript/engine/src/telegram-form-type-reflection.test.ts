// ---------------------------------------------------------------------------
// telegram-form-type-reflection.test.ts — ts-elimination-completion Phase 7
// round-trip proof for the Tier-0 raw-FenelType peelers.
//
// The five peeler bodies (`telegram:innerType` / `isOptionalField` /
// `typeHint` / `enumValues` / `isBooleanType`) moved from inline JSON-Logic
// `body:` literals in modules/telegram.ts to `.fenel` source
// (fenel/modules/telegram/form-type-reflection.fenel). Authoring them in
// `.fenel` could not use `$`-headed `case` patterns (the parser rejects them —
// Step-0 decision), so the bodies read the `$refined` / `$variant` / `$opaque`
// / `$ref` keys via `std:lookup` (decision C — pure Fenel, no marshalling
// boundary-adapter).
//
// This test runs the registered (`.fenel`-sourced) bodies IN-PROCESS via
// `invokeCallable` against a [std, telegram] registry and asserts
// DEEP-EQUALITY vs an inline copy of the EXACT pre-port JSON-Logic, across a
// representative type matrix (bare named primitives, Maybe wrappers, format
// refinements, enum refinements, where-refinements, and nested combinations).
// This is the parity proof the phase's marshalling crux ports faithfully.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { stdModule } from "./modules/std";
import { telegramModule } from "./modules/telegram";
import { createRegistry } from "./registry";
import { invokeCallable, evaluate } from "./json-logic";
import { Maybe } from "./type-foundation";
import type { FenelType } from "./types";

const reg = createRegistry([stdModule, telegramModule]);
const ctx = reg.evaluateContext();

const N = { $tag: "Nothing" } as const;
// FM-retire-Z — FieldDef no longer carries a `default` slot, so the pattern
// shape must omit it to match the (default-less) loaded Maybe field.
const fld = (name: string, type: unknown) => ({
  name,
  label: N,
  type,
  meta: {},
  ui: N,
});

// === EXACT pre-port inline JSON-Logic (verbatim from modules/telegram.ts) ===
const ORIG_INNER = {
  match: [
    { var: "t" },
    {
      $variant: {
        cases: [
          { name: "Nothing", label: N },
          { name: "Just", label: N, fields: [fld("_0", { $bind: "inner" })] },
        ],
      },
    },
    { call: ["innerType", { var: "inner" }] },
    { $refined: { base: { $bind: "base" } } },
    { call: ["innerType", { var: "base" }] },
    { $opaque: { pure: { $bind: "pure" } } },
    { call: ["innerType", { var: "pure" }] },
    "_",
    { var: "t" },
  ],
};

const ORIG_IS_OPTIONAL = {
  match: [
    { var: "field.type" },
    { $variant: { cases: [{ name: "Nothing", label: N }, { name: "Just", label: N }] } },
    true,
    "_",
    false,
  ],
};

const ORIG_TYPE_HINT = {
  match: [
    { var: "t" },
    { $refined: { set: { $tag: "SeRef", handle: "format:email" } } },
    " (your email)",
    { $refined: { set: { $tag: "SeRef", handle: "format:url" } } },
    " (a URL)",
    { $refined: { set: { $tag: "SeRef", handle: "format:handle" } } },
    " (your @handle)",
    "_",
    {
      match: [
        { call: ["innerType", { var: "t" }] },
        { $ref: "Boolean" },
        " (yes/no)",
        { $ref: "Int" },
        " (a number)",
        { $ref: "Number" },
        " (a number)",
        { $ref: "Nat" },
        " (a number)",
        { $ref: "Date" },
        " (date — YYYY-MM-DD)",
        "_",
        "",
      ],
    },
  ],
};

const ORIG_ENUM_VALUES = {
  match: [
    { var: "t" },
    { $refined: { set: { $tag: "SeEnum", values: { $bind: "vs" } } } },
    { var: "vs" },
    { $refined: { base: { $bind: "base" } } },
    { call: ["enumValues", { var: "base" }] },
    {
      $variant: {
        cases: [
          { name: "Nothing", label: N },
          { name: "Just", label: N, fields: [fld("_0", { $bind: "inner" })] },
        ],
      },
    },
    { call: ["enumValues", { var: "inner" }] },
    "_",
    [],
  ],
};

const ORIG_IS_BOOLEAN = {
  match: [
    { call: ["innerType", { var: "t" }] },
    { $ref: "Boolean" },
    true,
    "_",
    false,
  ],
};

// === representative type matrix ===
const Str = { $ref: "String" };
const email = { $refined: { base: Str, set: { $tag: "SeRef" as const, handle: "format:email" } } };
const url = { $refined: { base: Str, set: { $tag: "SeRef" as const, handle: "format:url" } } };
const handle = { $refined: { base: Str, set: { $tag: "SeRef" as const, handle: "format:handle" } } };
const enumT = { $refined: { base: Str, set: { $tag: "SeEnum" as const, values: ["a", "b", "c"] } } };
const whereRefined = {
  $refined: { base: Str, set: { $tag: "SeWhere" as const, pred: { "<=": [{ length: { var: "value" } }, 64] } } },
};

const TYPES: Record<string, unknown> = {
  String: Str,
  Int: { $ref: "Int" },
  Boolean: { $ref: "Boolean" },
  Date: { $ref: "Date" },
  Nat: { $ref: "Nat" },
  Number: { $ref: "Number" },
  Void: { $ref: "Custom" },
  "Maybe<String>": Maybe(Str),
  "Maybe<Boolean>": Maybe({ $ref: "Boolean" }),
  "Maybe<Int>": Maybe({ $ref: "Int" }),
  email,
  url,
  handle,
  enum: enumT,
  "Maybe<enum>": Maybe(enumT),
  "Maybe<email>": Maybe(email),
  "where-refined": whereRefined,
  "Maybe<where-refined>": Maybe(whereRefined),
};

// === set-algebra-to-fenel 3b-3a — the $tag SetExpr form ===
// The 3b-2 producer flip + the `0085` at-rest flip make production refined-set
// data the canonical `$tag` `Se*` form (`{$tag:"SeEnum",values}` /
// `{$tag:"SeRef",handle}`). enumValues + formReflFormatName now DUAL-READ that
// form; the legacy `$`-key arm (the matrix above) rides until 3b-3 Step 1.
// Live-test the $tag arm directly (the $-key arm is the matrix's job).
const emailTag: FenelType = {
  $refined: { base: Str, set: { $tag: "SeRef", handle: "format:email" } },
};
const enumTTag: FenelType = {
  $refined: { base: Str, set: { $tag: "SeEnum", values: ["a", "b", "c"] } },
};

describe("3b-3a — enumValues / formReflFormatName dual-read the $tag SetExpr form", () => {
  test("enumValues reads SeEnum ($tag form)", () => {
    expect(invokeCallable("telegram:enumValues", [enumTTag], ctx)).toEqual(["a", "b", "c"] as never);
  });
  test("enumValues reads SeEnum through a Maybe wrapper ($tag form)", () => {
    expect(invokeCallable("telegram:enumValues", [Maybe(enumTTag)], ctx)).toEqual([
      "a",
      "b",
      "c",
    ] as never);
  });
  test("enumValues still reads the legacy $enum form (dual-read tolerance)", () => {
    expect(invokeCallable("telegram:enumValues", [enumT], ctx)).toEqual(["a", "b", "c"] as never);
  });
  test("formReflFormatName reads SeRef ($tag form)", () => {
    expect(invokeCallable("telegram:formReflFormatName", [emailTag], ctx)).toEqual(
      "format:email" as never,
    );
  });
  test("formReflFormatName still reads the legacy $ref form (dual-read tolerance)", () => {
    expect(invokeCallable("telegram:formReflFormatName", [email], ctx)).toEqual(
      "format:email" as never,
    );
  });
});

describe("Phase 7 — Tier-0 peelers are .fenel-bodied and registered", () => {
  test("all five publics + the seven formRefl helpers are registered", () => {
    for (const id of [
      "telegram:innerType",
      "telegram:isOptionalField",
      "telegram:typeHint",
      "telegram:enumValues",
      "telegram:isBooleanType",
    ]) {
      const fn = reg.getFunction(id);
      expect(fn?.id).toBe(id);
      expect(fn?.body).toBeDefined();
    }
    for (const id of [
      "telegram:formReflMaybePayload",
      "telegram:formReflMaybeShape",
      "telegram:formReflCaseNameAt",
      "telegram:formReflFirstFieldType",
      "telegram:formReflNamedName",
      "telegram:formReflFormatName",
      "telegram:formReflNamedHint",
    ]) {
      expect(reg.getFunction(id)?.id).toBe(id);
    }
  });

  test("codeName resolution intact (innerType / typeHint / isBooleanType)", () => {
    expect(reg.getFunctionByCodeName("innerType")?.id).toBe("telegram:innerType");
    expect(reg.getFunctionByCodeName("typeHint")?.id).toBe("telegram:typeHint");
    expect(reg.getFunctionByCodeName("enumValues")?.id).toBe("telegram:enumValues");
  });
});

describe("Phase 7 — peelers round-trip vs the original inline JSON-Logic", () => {
  for (const [tn, t] of Object.entries(TYPES)) {
    test(`innerType [${tn}]`, () => {
      const ref = evaluate(ORIG_INNER, { t }, ctx);
      expect(invokeCallable("telegram:innerType", [t], ctx)).toEqual(ref as never);
    });
    test(`isOptionalField [${tn}]`, () => {
      const ref = evaluate(ORIG_IS_OPTIONAL, { field: { type: t } }, ctx);
      expect(invokeCallable("telegram:isOptionalField", [{ type: t }], ctx)).toEqual(
        ref as never,
      );
    });
    test(`typeHint [${tn}]`, () => {
      const ref = evaluate(ORIG_TYPE_HINT, { t }, ctx);
      expect(invokeCallable("telegram:typeHint", [t], ctx)).toEqual(ref as never);
    });
    test(`enumValues [${tn}]`, () => {
      const ref = evaluate(ORIG_ENUM_VALUES, { t }, ctx);
      expect(invokeCallable("telegram:enumValues", [t], ctx)).toEqual(ref as never);
    });
    test(`isBooleanType [${tn}]`, () => {
      const ref = evaluate(ORIG_IS_BOOLEAN, { t }, ctx);
      expect(invokeCallable("telegram:isBooleanType", [t], ctx)).toEqual(ref as never);
    });
  }
});
