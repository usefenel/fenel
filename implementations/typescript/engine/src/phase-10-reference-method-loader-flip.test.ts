// ---------------------------------------------------------------------------
// phase-10-reference-method-loader-flip.test.ts — typed-function-references
// Phase 10 (the spec-instance reference-method `{$ref}` loader flip).
//
// A spec instance's method can hold a point-free FUNCTION REFERENCE
// (`uuidIdentifiable = Identifiable { resolve = getInstanceById }`). The parser
// emits `resolve`'s value as `{var:"getInstanceById"}`. Before Phase 10 the
// loader's `lowerSpecMethods` passed that `{var}` straight through, so the
// persisted method was an unresolved variable node — NOT the callable `{$ref}`
// dispatch consumes — which is why every reference/arrow-method instance had to
// be a hand-written TS `Instance` const.
//
// The flip: a method value that is EXACTLY `{var:"<name>"}` lowers to the
// dispatch-ready codeableName-handle `{$ref:"<name>"}` (the LOAD-time sibling of
// the Phase-2 `resolveVar` evaluator flip). This file pins the mechanism +
// the correctness exclusions (nested `{var}` in lambdas/calls, nullary
// constructors, type-valued fields) that must NOT be flipped.
//
// Brief: workstreams/typed-function-references/briefs/
//        phase-10-spec-instance-ref-method-loader-flip.md.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { loadFenelModule } from "./fenel-module";

function methodsOf(src: string, typeName: string): Record<string, unknown> {
  const loaded = loadFenelModule(src, "probe", { dispatchInstanceFile: true });
  const inst = (loaded.instances ?? []).find((i) => i.typeName === typeName);
  if (!inst) throw new Error(`no ${typeName} instance projected from probe source`);
  return inst.methods as Record<string, unknown>;
}

describe("Phase 10 — bare point-free reference method → {$ref}", () => {
  test("a bare `{var}` method value lowers to the codeableName-handle `{$ref}`", () => {
    const methods = methodsOf(
      [
        "uuidIdentifiable : Identifiable UUID",
        "uuidIdentifiable = Identifiable { resolve = getInstanceById }",
      ].join("\n"),
      "Identifiable",
    );
    expect(methods.resolve).toEqual({ $ref: "getInstanceById" });
  });

  test("the handle is the var NAME (codeableName), not a UUID — no id lookup at load", () => {
    const methods = methodsOf(
      [
        "inst : Sampleable Animation",
        "inst = Sampleable { sample = sampleAnim }",
      ].join("\n"),
      "Sampleable",
    );
    // Pure shape rewrite: whatever the point-free name was, the {$ref} handle
    // is exactly that string — ordering-safe, no registry membership probe.
    expect(methods.sample).toEqual({ $ref: "sampleAnim" });
  });
});

describe("Phase 10 — the correctness exclusions (must NOT be flipped)", () => {
  test("an APPLICATION method value stays a `{call}`; the nested `{var}` arg is untouched", () => {
    const methods = methodsOf(
      [
        "appInst : Foo Bar",
        "appInst = Foo { method = getInstanceById someArg }",
      ].join("\n"),
      "Foo",
    );
    // Not a bare `{var}` → no flip. The inner `{var:"someArg"}` (a genuine arg
    // reference) is preserved, NOT rewritten to a `{$ref}`.
    expect(methods.method).toEqual({ call: ["getInstanceById", { var: "someArg" }] });
  });

  test("a LAMBDA method value keeps its nested `{var}` param reference (not a function ref)", () => {
    const methods = methodsOf(
      [
        "lamInst : Truthy Boolean",
        "lamInst = Truthy { truthy = \\x -> x }",
      ].join("\n"),
      "Truthy",
    );
    // `{var:"x"}` here is a lexical lambda PARAM — flipping it to `{$ref}` would
    // be a corruption. The flip is the TOP-LEVEL method value only, so the
    // nested var survives.
    expect(methods.truthy).toEqual({ fn: ["x", { var: "x" }] });
  });

  test("a nullary variant constructor method value stays `{$tag}` (arrives as `{construct}`, not `{var}`)", () => {
    const methods = methodsOf(
      [
        "noneInst : Optional Thing",
        "noneInst = Optional { fallback = Nothing }",
      ].join("\n"),
      "Optional",
    );
    expect(methods.fallback).toEqual({ $tag: "Nothing" });
  });

  test("a type-valued field routes through lowerTypeValue, NOT the {$ref} flip", () => {
    // `inputType = List` is a TYPE reference (declared type-valued), so it lowers
    // to the `{$ref}` type ref — the bare-`{var}` flip never sees it (different
    // branch). Guards the `{$ref}` dispatch-key exception from perturbation.
    const loaded = loadFenelModule(
      [
        "aggInst : Aggregable Foo",
        "aggInst = Aggregable { inputType = List }",
      ].join("\n"),
      "probe",
      { dispatchInstanceFile: true, typeValuedFields: { Aggregable: ["inputType"] } },
    );
    const inst = (loaded.instances ?? []).find((i) => i.typeName === "Aggregable")!;
    expect((inst.methods as Record<string, unknown>).inputType).toEqual({ $ref: "List" });
  });
});
