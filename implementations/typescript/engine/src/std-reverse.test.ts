import { beforeAll, describe, expect, test } from "bun:test";
import { loadFenelModule } from "./fenel-module";
import { withInterpretedResolver } from "./engine-bodies-dispatch";
import { invokeCallable, withInstance, withRuntimeRepresentationProjection, type EvaluateContext } from "./json-logic";
import { stdModule } from "./modules/std";
import { createRegistry, type ModuleRegistry } from "./registry";
import { invokeSelfHostSourceBody } from "./self-host-body-oracle";
import type { FenelFunction, TypeScheme } from "./types";

// Existing C1/A5 actual-source harness. Representation callbacks remain Fenel
// references; observer natives count host invocations and then run their source.
// The receipts are value/representation evidence, not static requires checking.
let registry: ModuleRegistry;
let context: EvaluateContext;
beforeAll(() => withInterpretedResolver(() => {
  const probe = loadFenelModule(`module ReverseProbe where
import std (arrayToList, chars, charCode, charFromCode, map, join, listToArray, drop)
lower : String -> List Char
lower text = arrayToList (map charCode (chars text))
lift : List Char -> String
lift points = join (map charFromCode (listToArray points)) ""
badLower : String -> List Char
badLower text = 42
badLift : List Char -> String
badLift points = 42
nativeListLower : String -> List Char
nativeListLower text = chars text
scopedListLower : List a -> List a
scopedListLower items = arrayToList (drop 1 items)
arrayListLower : List a -> List a
arrayListLower items = items
`, "ReverseProbe");
  registry = createRegistry([stdModule, probe]);
  context = registry.evaluateContext();
}), 180_000);

const call = (value: unknown, frame = context): unknown => withInterpretedResolver(() => invokeCallable({ $ref: "std:reverse" }, [value], frame));
const cons = (head: unknown, tail: unknown): unknown => ({ $tag: "Cons", _0: head, _1: tail });
const nil = { $tag: "Nil" };
const stringScope = (frame = context, lower = "ReverseProbe:lower", lift = "ReverseProbe:lift") => withInstance(frame, {
  typeName: "Reprable", args: ["JsRuntime", "String"], methods: {
    native: { $ref: "String" }, lower: { $ref: lower }, lift: { $ref: lift },
  },
}, inner => inner);

describe("one pure list reverse, with its scoped runtime representations", () => {
  test("the public identity/type stay List a -> List a and the source contains no String branch", () => {
    const fn = registry.getFunction("std:reverse")!;
    expect(fn.id).toBe("std:reverse");
    expect(fn.params.map(param => param.name)).toEqual(["arr"]);
    expect(fn.params[0]?.type).toEqual(fn.returns);
    expect(fn.params[0]?.type).toHaveProperty("$opaque.name", "List");
    const scheme = registry.getFunctionSignatureInfo(fn.id)?.scheme as TypeScheme | undefined;
    expect(scheme?.quantified).toHaveLength(1);
    expect(fn.body).toBeDefined();
    expect(JSON.stringify(fn.body)).not.toMatch(/String|isString|chars|join/);
    expect(stdModule.nativeImpls?.[fn.id]).toBeUndefined();
    expect(stdModule.nativeImplsCtx?.[fn.id]).toBeDefined();
    expect(registry.getFunction("std:stringReverse")).toBeUndefined();
    expect(stdModule.nativeImpls?.["std:stringReverse"]).toBeUndefined();
    expect(stdModule.nativeImplsCtx?.["std:stringReverse"]).toBeUndefined();
  });

  test("lists retain every element and the native list form, including empty data", () => {
    const items = [1, { nested: [2, 3] }, false];
    expect(call(items)).toEqual([false, { nested: [2, 3] }, 1]);
    expect(Array.isArray(call(items))).toBe(true);
    expect(items).toEqual([1, { nested: [2, 3] }, false]);
    expect(call([])).toEqual([]);
    const long = Array.from({ length: 4096 }, (_, index) => index);
    expect(call(long)).toEqual([...long].reverse());
  });

  test("the native String form reverses code points and retains String output", () => {
    for (const [input, expected] of [["", ""], ["ab🦊", "🦊ba"], ["A🦊e\u0301", "\u0301e🦊A"], ["👩‍💻", "💻‍👩"]]) {
      expect(call(input)).toBe(expected);
      expect(typeof call(input)).toBe("string");
      expect(call(call(input))).toBe(input);
    }
    expect(call("🦊".repeat(4096))).toBe("🦊".repeat(4096));
  });

  test("the actual pure Cons/Nil source path remains a pure list", () => {
    const value = cons("a", cons("🦊", nil));
    const fn = registry.getFunction("std:reverse")!;
    const pure = withInterpretedResolver(() => withRuntimeRepresentationProjection(context, frame => invokeSelfHostSourceBody(fn, [value], frame)));
    expect(pure).toEqual(cons("🦊", cons("a", nil)));
    expect(call(value)).toEqual(pure);
    expect(call(nil)).toEqual(nil);
  });

  test("a scoped String representation uses both selected Fenel bridges", () => {
    const lower = registry.getFunction("ReverseProbe:lower")!;
    const lift = registry.getFunction("ReverseProbe:lift")!;
    const observed: string[] = [];
    const frame = stringScope({ ...context, nativesCtx: {
      ...context.nativesCtx,
      [lower.id]: (ctx: EvaluateContext, ...args: unknown[]) => { observed.push("lower"); return invokeSelfHostSourceBody(lower, args, ctx); },
      [lift.id]: (ctx: EvaluateContext, ...args: unknown[]) => { observed.push("lift"); return invokeSelfHostSourceBody(lift, args, ctx); },
    } });
    expect(call("ab🦊", frame)).toBe("🦊ba");
    expect(observed).toEqual(["lower", "lift"]);
    expect(call("ab🦊")).toBe("🦊ba");
  });

  test("a scoped List representation retains its selected crossing", () => {
    const frame = withInstance(context, { typeName: "Reprable", args: ["JsRuntime", "List"], methods: {
      native: { $ref: "List" }, lower: { $ref: "ReverseProbe:scopedListLower" }, lift: { $ref: "std:listToArray" },
    } }, inner => inner);
    expect(call([1, 2, 3], frame)).toEqual([3, 2]);
    const nonCrossing = withInstance(frame, { typeName: "Reprable", args: ["JsRuntime", "List"], methods: {
      native: { $ref: "List" }, lower: { $ref: "ReverseProbe:arrayListLower" }, lift: { $ref: "std:listToArray" },
    } }, inner => inner);
    expect(() => call([1, 2], nonCrossing)).toThrow();
  });

  test("an overridden stock dependency retains the selected source conversion", () => {
    const chars = registry.getFunction("std:chars")!;
    let calls = 0;
    const frame: EvaluateContext = { ...context, natives: { ...context.natives, [chars.id]: () => { calls++; return ["x"]; } } };
    expect(call("abc", frame)).toBe("x");
    expect(calls).toBe(1);
  });

  test("a nonstandard array iterator cannot replace the authoritative element sequence", () => {
    const items = [1, 2];
    items[Symbol.iterator] = function* () { yield 9; return undefined; };
    expect(call(items)).toEqual([2, 1]);
  });

  test("an altered actual crossing cannot borrow the canonical declaration's shortcut", () => {
    const stock = registry.getFunction("std:stringToCharList")!;
    const changed: FenelFunction = { ...stock, body: { construct: ["Nil"] } };
    const frame: EvaluateContext = { ...context, getFunction: name => name === "std:stringToCharList" ? changed : context.getFunction?.(name) };
    expect(call("abc", frame)).toBe("");
  });

  test("a missing native dependency cannot select the host shortcut", () => {
    const frame: EvaluateContext = { ...context, natives: { ...context.natives, "std:chars": undefined as never } };
    expect(() => call("abc", frame)).toThrow();
  });

  test("changed source carrier admission cannot be skipped by the host shortcut", () => {
    const stock = registry.getFunction("std:representationSelfNativeAdmission")!;
    const changed: FenelFunction = { ...stock, body: { construct: ["Just", false] } };
    const frame: EvaluateContext = { ...context, getFunction: name => name === stock.id ? changed : context.getFunction?.(name) };
    expect(() => call("abc", frame)).toThrow();
    expect(() => call([1, 2], frame)).toThrow();
  });

  test("source lexical bindings remain authoritative", () => {
    const frame: EvaluateContext = { ...context, getFunctionImportFrame: id => {
      const imports = context.getFunctionImportFrame?.(id);
      return id === "std:reverse" && imports !== undefined
        ? { ...imports, names: { ...imports.names, reverseOnto: "ReverseProbe:badLower" } } : imports;
    } };
    expect(() => call("abc", frame)).toThrow();
  });

  test("ordinary List literals remain valid at selected source boundaries", () => {
    expect(call("ab🦊", stringScope(context, "ReverseProbe:nativeListLower", "std:charListToString"))).toBe("🦊ba");
    const stock = registry.getFunction("std:reverse")!;
    const changed: FenelFunction = { ...stock, body: [] };
    const frame: EvaluateContext = { ...context, getFunction: name => name === stock.id ? changed : context.getFunction?.(name) };
    expect(call("abc", frame)).toBe("");
    expect(call([1, 2], frame)).toEqual([]);
    const changedNonempty: FenelFunction = { ...stock, body: ["z", "y"] };
    const nonempty: EvaluateContext = { ...context, getFunction: name => name === stock.id ? changedNonempty : context.getFunction?.(name) };
    expect(call("abc", nonempty)).toBe("zy");
  });

  test("missing or malformed selected bridges and invalid native outputs refuse", () => {
    const missing = withInstance(context, { typeName: "Reprable", args: ["JsRuntime", "String"], methods: {} }, inner => inner);
    expect(() => call("abc", missing)).toThrow();
    expect(() => call("abc", stringScope(context, "ReverseProbe:badLower"))).toThrow();
    expect(() => call("abc", stringScope(context, "ReverseProbe:lower", "ReverseProbe:badLift"))).toThrow();
    expect(() => call(42)).toThrow();
    expect(() => call({ $tag: "Cons", _0: "x" })).toThrow();
  });
});
