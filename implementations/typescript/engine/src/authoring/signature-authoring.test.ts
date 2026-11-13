import { describe, expect, test } from "bun:test";
import type { FenelFunction, TypeScheme } from "../types";
import { Nothing } from "../type-foundation";
import { finalizeRegistryFunctionSignatures } from "../signature-inference";
import { dispatchEngineBody, marshalStoredBodyForValidation } from "../engine-bodies-dispatch";
import {
  buildAuthoringSignatureDeclaration,
  authoringResultMismatchMessage,
  projectAuthoringInferenceOutcome,
} from "./signature-authoring";

const input = {
  functionId: "draft-identity",
  declarationName: "identity",
  codeName: "identity",
  ownerModule: "account:editor-owner",
  parameterCount: 1,
  inferResult: true,
  scheme: { quantified: [], body: { $unit: true } } as TypeScheme,
};

describe("source-owned refusal wording", () => {
  const item = (identity?: string): TypeScheme => ({ quantified: [], body: { $ref: "Item" },
    ...(identity === undefined ? {} : { nominals: [{ path: [], identity, publicName: "Item" }] }),
  });
  const generic = "Both types are displayed as Item, but their full types do not match. Check the required type's structure and constraints before saving.";

  test("explains captured root declarations without exposing their identities", () => {
    expect(authoringResultMismatchMessage("Item", "Item", item(), item("private-owner-A")))
      .toBe("This result is called Item, but it is missing the required type's declaration. Use the required Item type before saving.");
    expect(authoringResultMismatchMessage("Item", "Item", item("private-owner-A"), item()))
      .toBe("This result carries the Item declaration, but the required type does not share it. Use the required Item type before saving.");
    expect(authoringResultMismatchMessage("Item", "Item", item("private-owner-A"), item("private-owner-B")))
      .toBe("Both types are called Item, but they come from different declarations. Use the required Item type before saving.");
    expect(authoringResultMismatchMessage("Number", "String", item(), item()))
      .toBe("This expression returns Number. Finish with String before saving.");
  });

  test("does not assign a root identity cause to nested evidence or hidden constraints", () => {
    const nested = (identity: string): TypeScheme => ({ ...item("same-root"), nominals: [
      { path: [], identity: "same-root", publicName: "Item" },
      { path: ["$record", "fields", "0", "type"], identity, publicName: "Child" },
    ] });
    expect(authoringResultMismatchMessage("Item", "Item", nested("child-A"), nested("child-B"))).toBe(generic);
    expect(authoringResultMismatchMessage("Item", "Item", item(), item())).toBe(generic);
    expect(authoringResultMismatchMessage("Item", "Item", undefined, item("owner"))).toBe(generic);
  });

  test("unsupported transport falls back atomically without reading accessors", () => {
    let reads = 0;
    const accessor = Object.defineProperty(item(), "nominals", { enumerable: true, get() { reads++; return []; } });
    const hidden = Object.defineProperty(item(), "nominals", { value: item("hidden-owner").nominals, enumerable: false });
    const cyclic = item() as TypeScheme & { cycle?: unknown };
    cyclic.cycle = cyclic;
    const symbolic = { ...item(), [Symbol("unsupported")]: true };
    for (const unsupported of [accessor, hidden, cyclic, symbolic, new Date() as unknown as TypeScheme]) {
      expect(authoringResultMismatchMessage("Item", "Item", unsupported, item("owner"))).toBe(generic);
      expect(authoringResultMismatchMessage("Item", "Item", item("owner"), unsupported)).toBe(generic);
    }
    expect(reads).toBe(0);
  });

  test("wrapped roots do not turn absent root metadata into a declaration claim", () => {
    const number: TypeScheme = { quantified: [], body: { $ref: "Number" },
      nominals: [{ path: [], identity: '["system","Number"]', publicName: "Number" }] };
    const refined: TypeScheme = { quantified: [], body: { $refined: {
      base: number.body, set: { $tag: "SeInterval", interval: {
        lo: { $tag: "Just", _0: { value: 2, inclusive: true } },
        hi: { $tag: "Just", _0: { value: 12, inclusive: true } },
      } },
    } } };
    const application: TypeScheme = { ...item("application-A"), body: { $el: { var: "Item" } } };
    for (const [actual, wanted, label] of [[number, refined, "Number"], [refined, number, "Number"],
      [application, { ...application, nominals: item("application-B").nominals }, "Item"]] as const) {
      const message = authoringResultMismatchMessage(label, label, actual, wanted);
      expect(message).toContain("their full types do not match");
      expect(message).not.toContain("declaration");
    }
  });
});

describe("source-owned signature authoring ingress", () => {
  test("raw completeness preserves false, zero and empty scalars while finding nested null slots", () => {
    const hasEmpty = (value: unknown) => dispatchEngineBody("engine:authoringExpressionHasEmptySlot", [marshalStoredBodyForValidation(value)]);
    for (const value of [false, 0, "", [], {}, { $tag: "Nothing" }, { do: [false, 0, ""] }]) expect(hasEmpty(value)).toBe(false);
    for (const value of [null, undefined, { call: ["f", null] }, { $tag: "Just", _0: undefined }, { a: [{ b: null }] }]) expect(hasEmpty(value)).toBe(true);
  });
  test("save projection preserves explicit annotation tolerance and inference obligations", () => {
    const save = (infer: boolean, tag: string) => dispatchEngineBody("engine:authoringFunctionSaveVerdict", [infer, { $tag: tag, diagnostics: [] }]);
    expect(save(true, "Solved")).toEqual({ invalid: false, needsAnnotation: false });
    expect(save(true, "Invalid")).toEqual({ invalid: true, needsAnnotation: false });
    expect(save(false, "Invalid")).toEqual({ invalid: true, needsAnnotation: false });
    expect(save(true, "AnnotationRequired")).toEqual({ invalid: false, needsAnnotation: true });
    expect(save(false, "AnnotationRequired")).toEqual({ invalid: false, needsAnnotation: false });
  });
  test("inferred result is absent ingress and explicit parameters are authored", () => {
    const declaration = buildAuthoringSignatureDeclaration(input);
    expect(declaration.params).toEqual([{
      $tag: "Authored",
      source: { $tag: "HostSpec", module: "account:editor-owner" },
    }]);
    expect(declaration.returns).toEqual({ $tag: "Absent" });
    expect(declaration.scheme).toBe(input.scheme);
  });

  test("explicit result is authored and nullary inputs stay empty", () => {
    const declaration = buildAuthoringSignatureDeclaration({ ...input, parameterCount: 0, inferResult: false });
    expect(declaration.params).toEqual([]);
    expect(declaration.returns.$tag).toBe("Authored");
  });

  test("authored scheme and complete sidecars retain their original identity", () => {
    const scheme: TypeScheme = {
      quantified: [{ id: "unique-binder", sourceName: "a", kind: { $tag: "KType" } }],
      body: { $var: "a" },
      applications: [],
      nominals: [{ path: [], identity: "type-owner", publicName: "Example" }],
      diagnostics: [{ code: "pending", declaration: "identity", path: [], spelling: "a", message: "Retained" }],
    };
    const declaration = buildAuthoringSignatureDeclaration({ ...input, scheme });
    expect(declaration.scheme).toBe(scheme);
    expect(declaration.returns.$tag).toBe("Absent");
  });

  test("all existing verdicts project without manufacturing inference evidence", () => {
    expect(projectAuthoringInferenceOutcome({ $tag: "Solved" })).toEqual({
      status: "solved", label: "Inferred result", needsAnnotation: false, invalid: false,
    });
    expect(projectAuthoringInferenceOutcome({ $tag: "AnnotationRequired", diagnostics: [] }).needsAnnotation).toBe(true);
    expect(projectAuthoringInferenceOutcome({ $tag: "Invalid", diagnostics: [] }).invalid).toBe(true);
    const declaration = buildAuthoringSignatureDeclaration({ ...input, outcome: { $tag: "Solved", derivation: "untrusted preview" } } as typeof input);
    expect(declaration.returns).toEqual({ $tag: "Absent" });
    expect(declaration).not.toHaveProperty("trust");
  });

  test("the canonical inference boundary resolves an absent result independently of its placeholder", () => {
    const fn: FenelFunction = {
      id: "authoring-test:identity",
      params: [{ name: "value", key: { $tag: "PositionalField", index: 0 }, type: { $unit: true }, label: Nothing, ui: Nothing, meta: {} }],
      returns: { $void: true },
      body: { var: "value" },
    };
    const scheme: TypeScheme = { quantified: [], body: { $arrow: { params: fn.params, returns: fn.returns } } };
    const declaration = buildAuthoringSignatureDeclaration({ ...input, functionId: fn.id, scheme });
    const [result] = finalizeRegistryFunctionSignatures([{
      fn, declaration, implementationOrigin: { $tag: "FenelBody" },
    }], { resolutions: [] });
    expect(result?.info.outcome.$tag).toBe("Solved");
    expect(result?.fn.returns).toEqual({ $unit: true });
    expect(result?.info.returns.$tag).toBe("Inferred");
    expect(declaration.returns.$tag).toBe("Absent");
    expect(declaration.scheme).toBe(scheme);
  });

  test("explicit empty quantification never binds a stray type variable by scanning", () => {
    const fn: FenelFunction = {
      id: "authoring-test:unbound",
      params: [{ name: "value", key: { $tag: "PositionalField", index: 0 }, type: { $var: "stray" }, label: Nothing, ui: Nothing, meta: {} }],
      returns: { $void: true },
      body: { var: "value" },
    };
    const declaration = buildAuthoringSignatureDeclaration({ ...input, functionId: fn.id,
      scheme: { quantified: [], body: { $arrow: { params: fn.params, returns: fn.returns } } },
    });
    expect(() => finalizeRegistryFunctionSignatures([{
      fn, declaration, implementationOrigin: { $tag: "FenelBody" },
    }], { resolutions: [] })).toThrow(/unbound|Unbound/);
  });
});
