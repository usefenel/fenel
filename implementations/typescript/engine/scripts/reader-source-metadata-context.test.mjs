import { describe, expect, test } from "bun:test";
import {
  beginWhereProofFrame,
  constructorDeclaredFieldNames,
  constructorTableStable,
  dynamicConstructorTableInForce,
  endWhereProofFrame,
  evaluate,
  invokeCallable,
  ownDataRead,
  pureEvaluateContext,
  readerSourceMetadataEvaluateContext,
} from "../src/json-logic.ts";
import { authenticateAuthority, mintAuthority } from "../src/authority.ts";
import { readerSourceMetadataNative } from "../../../../fenel/modules/view/ffi/source-metadata.ts";

// Actual runtime entry points only. These small IR fixtures exercise evaluator
// state ownership; they load no registry, source parser, worker or account.
const nothing = { $tag: "Nothing" };
const packet = generation => ({ $tag: "ReaderSourceMetadata", generation });
const typeDefinition = name => ({ type_def: { name, constructors: [{ name,
  fields: [{ name: "x" }, { name: "y" }] }] } });
const construct = name => ({ construct: [name, 1, 2] });
const defineOrConstruct = name => ({ if: [{ var: "flag" }, typeDefinition(name), construct(name)] });
const defineOrConstructOpPayload = name => ({ if: [{ var: "flag" }, typeDefinition(name),
  { construct: [name, { var: "flag" }] }] });
const anything = { $complement: { $void: true } };
const flagType = { $ref: "Bool" };
const fn = (id, params, body) => ({ id, params: params.map(name => ({ name, type: flagType })), returns: anything, body });
const read = { call: ["metadata:read"] };
const call = (id, ...args) => ({ call: [id, ...args] });

function context(extra = {}) {
  const functions = [
    fn("metadata:read", [], { call: ["metadata:packet"] }),
    fn("metadata:f", ["flag"], defineOrConstruct("Foo")),
    fn("metadata:factory", [], { fn: [["flag"], defineOrConstruct("ClosureFoo")] }),
    fn("metadata:shapeF", ["flag"], defineOrConstructOpPayload("ShapeFoo")),
    fn("metadata:shapeFactory", [], { fn: [["flag"], defineOrConstructOpPayload("ClosureShapeFoo")] }),
    fn("metadata:readFactory", [], { fn: [[], read] }),
  ];
  const byId = new Map(functions.map(value => [value.id, value]));
  return {
    _constructors: Object.freeze({ Static: Object.freeze(["x", "y"]) }),
    getFunction: id => byId.get(id),
    nativesCtx: Object.freeze({ "metadata:packet": readerSourceMetadataNative }),
    ...extra,
  };
}

function currentPacket(frame) {
  const found = readerSourceMetadataNative(frame);
  return found.$tag === "Just" ? found._0 : undefined;
}

describe("reader source metadata frame transport", () => {
  test("absence without an own prior slot returns the exact original context", () => {
    for (const freeze of [false, true]) {
      const base = context();
      if (freeze) Object.freeze(base);
      expect(readerSourceMetadataEvaluateContext(base, undefined)).toBe(base);
      expect(Object.hasOwn(base, "_readerSourceMetadata")).toBe(false);
      expect(dynamicConstructorTableInForce(base)).toBe(false);
    }
  });

  test("copies descriptors without reading getters and preserves prototype and freeze posture", () => {
    for (const freeze of [false, true]) {
      let reads = 0;
      const symbol = Symbol("retained descriptor");
      const prototype = Object.create(null);
      const base = Object.create(prototype, {
        trap: { get() { reads++; throw new Error("Accessor must stay unread"); }, enumerable: true, configurable: true },
        hidden: { value: 19, enumerable: false, writable: false, configurable: false },
        [symbol]: { value: Object.freeze({ held: true }), enumerable: false, writable: false, configurable: false },
        _readerSourceMetadata: { get() { reads++; throw new Error("Prior packet getter must stay unread"); }, enumerable: true, configurable: true },
      });
      if (freeze) Object.freeze(base);
      const nextPacket = packet("new");
      const next = readerSourceMetadataEvaluateContext(base, nextPacket);
      expect(reads).toBe(0);
      expect(next).not.toBe(base);
      expect(Object.getPrototypeOf(next)).toBe(prototype);
      expect(Object.isFrozen(next)).toBe(Object.isFrozen(base));
      for (const key of ["trap", "hidden", symbol]) {
        expect(Object.getOwnPropertyDescriptor(next, key)).toEqual(Object.getOwnPropertyDescriptor(base, key));
      }
      expect(currentPacket(next)).toBe(nextPacket);
      const cleared = readerSourceMetadataEvaluateContext(next, undefined);
      expect(ownDataRead(cleared, "_readerSourceMetadata")).toEqual({ found: true, value: undefined });
      expect(readerSourceMetadataNative(cleared)).toEqual(nothing);
      expect(reads).toBe(0);
      expect(Object.isFrozen(cleared)).toBe(freeze);
    }
  });

  test("retains the same authenticated AuthorityRef without minting a replacement", () => {
    const record = { envelope: Object.freeze({ $tag: "TestEnvelope" }), issuer: "test", accountId: null,
      principal: null, lane: null, grant: null, mintedAt: 0 };
    const authority = mintAuthority({ evaluateAuthorityFunction: () => nothing }, record);
    const base = Object.freeze(context({ _authority: authority }));
    const first = readerSourceMetadataEvaluateContext(base, packet("A"));
    const next = readerSourceMetadataEvaluateContext(first, packet("B"));
    const cleared = readerSourceMetadataEvaluateContext(next, undefined);
    for (const frame of [base, first, next, cleared, pureEvaluateContext(next)]) {
      expect(frame._authority).toBe(authority);
      expect(authenticateAuthority(frame._authority)).toBe(authenticateAuthority(authority));
    }
  });

  test("reusing the same packet returns its existing fork but replacement and clearing do not mutate it", () => {
    const base = context();
    const firstPacket = packet("A");
    const first = readerSourceMetadataEvaluateContext(base, firstPacket);
    expect(readerSourceMetadataEvaluateContext(first, firstPacket)).toBe(first);
    const secondPacket = packet("A");
    const second = readerSourceMetadataEvaluateContext(first, secondPacket);
    const cleared = readerSourceMetadataEvaluateContext(second, undefined);
    expect(second).not.toBe(first);
    expect(currentPacket(first)).toBe(firstPacket);
    expect(currentPacket(second)).toBe(secondPacket);
    expect(currentPacket(cleared)).toBeUndefined();
    expect(currentPacket(base)).toBeUndefined();
  });
});

describe("metadata forks preserve existing dynamic constructor state", () => {
  test("a root declaration made before forking is visible through every packet frame", () => {
    const base = context();
    evaluate(typeDefinition("RootFoo"), {}, base);
    const expected = evaluate(construct("RootFoo"), {}, base);
    const first = readerSourceMetadataEvaluateContext(base, packet("A"));
    const second = readerSourceMetadataEvaluateContext(first, packet("B"));
    for (const frame of [first, second, readerSourceMetadataEvaluateContext(second, undefined)]) {
      expect(dynamicConstructorTableInForce(frame)).toBe(true);
      expect(constructorDeclaredFieldNames(frame, "RootFoo")).toEqual(constructorDeclaredFieldNames(base, "RootFoo"));
      expect(evaluate(construct("RootFoo"), {}, frame)).toEqual(expected);
      expect(constructorTableStable(frame, "Static")).toBe(constructorTableStable(base, "Static"));
    }
  });

  test("forking creates no empty dynamic table and new declarations use the original root owner", () => {
    const base = Object.freeze(context());
    const first = readerSourceMetadataEvaluateContext(base, packet("A"));
    const second = readerSourceMetadataEvaluateContext(first, packet("B"));
    for (const frame of [base, first, second]) {
      expect(dynamicConstructorTableInForce(frame)).toBe(false);
      expect(constructorDeclaredFieldNames(frame, "Absent")).toBeUndefined();
      expect(constructorTableStable(frame, "Static")).toBe(true);
    }
    evaluate(typeDefinition("NewRootFoo"), {}, second);
    const expected = evaluate(construct("NewRootFoo"), {}, second);
    for (const frame of [base, first, second]) {
      expect(dynamicConstructorTableInForce(frame)).toBe(true);
      expect(constructorDeclaredFieldNames(frame, "NewRootFoo")).toEqual(["x", "y"]);
      expect(evaluate(construct("NewRootFoo"), {}, frame)).toEqual(expected);
      expect(constructorTableStable(frame, "Static")).toBe(false);
    }
    const cleared = readerSourceMetadataEvaluateContext(second, undefined);
    evaluate(typeDefinition("AfterClearFoo"), {}, cleared);
    expect(evaluate(construct("AfterClearFoo"), {}, base)).toEqual(evaluate(construct("AfterClearFoo"), {}, cleared));
  });

  test("named f(flag) retains its baseline type_def state across packet A and B lexical frames", () => {
    const baseline = context();
    const baselineDefined = evaluate(call("metadata:f", true), {}, baseline);
    const expected = evaluate(call("metadata:f", false), {}, baseline);
    expect(expected).toEqual({ $tag: "Foo", _0: 1, _1: 2 });
    const base = context();
    const first = readerSourceMetadataEvaluateContext(base, packet("A"));
    expect(evaluate(call("metadata:f", true), {}, first)).toEqual(baselineDefined);
    const second = readerSourceMetadataEvaluateContext(base, packet("B"));
    expect(evaluate(call("metadata:f", false), {}, second)).toEqual(expected);
    expect(evaluate(call("metadata:f", false), {}, base)).toEqual(expected);
    expect(evaluate(call("metadata:f", false), {}, readerSourceMetadataEvaluateContext(second, undefined))).toEqual(expected);
  });

  test("a normal factory closure keeps baseline state while each invocation receives its caller packet", () => {
    const baseline = context();
    const original = evaluate(call("metadata:factory"), {}, baseline);
    const baselineDefined = invokeCallable(original, [true], baseline);
    const expected = invokeCallable(original, [false], baseline);
    expect(expected).toEqual({ $tag: "ClosureFoo", _0: 1, _1: 2 });
    const base = context();
    const first = readerSourceMetadataEvaluateContext(base, packet("A"));
    const closure = evaluate(call("metadata:factory"), {}, first);
    expect(invokeCallable(closure, [true], first)).toEqual(baselineDefined);
    const second = readerSourceMetadataEvaluateContext(base, packet("B"));
    expect(invokeCallable(closure, [false], second)).toEqual(expected);
    expect(invokeCallable(closure, [false], base)).toEqual(expected);
    expect(invokeCallable(closure, [false], readerSourceMetadataEvaluateContext(second, undefined))).toEqual(expected);
  });

  test("named lexical state keeps the registered-versus-unregistered construct distinction", () => {
    const baseline = context();
    const unregistered = evaluate(call("metadata:shapeF", false), {}, baseline);
    evaluate(call("metadata:shapeF", true), {}, baseline);
    const expected = evaluate(call("metadata:shapeF", false), {}, baseline);
    expect(unregistered).toEqual({ $tag: "ShapeFoo", var: "flag" });
    expect(expected).toEqual({ $tag: "ShapeFoo", _0: false });
    expect(expected).not.toEqual(unregistered);
    const base = context();
    evaluate(call("metadata:shapeF", true), {}, readerSourceMetadataEvaluateContext(base, packet("A")));
    const next = readerSourceMetadataEvaluateContext(base, packet("B"));
    for (const frame of [base, next, readerSourceMetadataEvaluateContext(next, undefined)]) {
      expect(evaluate(call("metadata:shapeF", false), {}, frame)).toEqual(expected);
    }
  });

  test("factory closure state keeps the same discriminating baseline construct behavior", () => {
    const baseline = context();
    const original = evaluate(call("metadata:shapeFactory"), {}, baseline);
    const unregistered = invokeCallable(original, [false], baseline);
    invokeCallable(original, [true], baseline);
    const expected = invokeCallable(original, [false], baseline);
    expect(unregistered).toEqual({ $tag: "ClosureShapeFoo", var: "flag" });
    expect(expected).toEqual({ $tag: "ClosureShapeFoo", _0: false });
    expect(expected).not.toEqual(unregistered);
    const base = context();
    const first = readerSourceMetadataEvaluateContext(base, packet("A"));
    const closure = evaluate(call("metadata:shapeFactory"), {}, first);
    invokeCallable(closure, [true], first);
    const next = readerSourceMetadataEvaluateContext(base, packet("B"));
    for (const frame of [base, next, readerSourceMetadataEvaluateContext(next, undefined)]) {
      expect(invokeCallable(closure, [false], frame)).toEqual(expected);
    }
  });

  test("frozen static-table certification and dynamic abstention match each original context", () => {
    for (const freeze of [false, true]) {
      const base = context();
      if (freeze) Object.freeze(base);
      const first = readerSourceMetadataEvaluateContext(base, packet("A"));
      expect(Object.isFrozen(first)).toBe(freeze);
      for (const name of ["Static", "Missing"]) {
        expect(constructorTableStable(first, name)).toBe(constructorTableStable(base, name));
      }
      evaluate(typeDefinition("Dynamic"), {}, first);
      const second = readerSourceMetadataEvaluateContext(base, packet("B"));
      expect(dynamicConstructorTableInForce(base)).toBe(true);
      for (const frame of [first, second]) {
        expect(dynamicConstructorTableInForce(frame)).toBe(dynamicConstructorTableInForce(base));
        expect(constructorTableStable(frame, "Static")).toBe(constructorTableStable(base, "Static"));
        expect(constructorTableStable(frame, "Dynamic")).toBe(false);
      }
    }
  });
});

describe("metadata stays fresh across lexical, pure and where evaluation", () => {
  test("a named lexical family never reuses packet A for packet B or absence", () => {
    const base = context();
    const firstPacket = packet("A");
    const secondPacket = packet("B");
    const first = readerSourceMetadataEvaluateContext(base, firstPacket);
    const second = readerSourceMetadataEvaluateContext(base, secondPacket);
    expect(evaluate(read, {}, first)._0).toBe(firstPacket);
    expect(evaluate(read, {}, second)._0).toBe(secondPacket);
    expect(evaluate(read, {}, first)._0).toBe(firstPacket);
    expect(evaluate(read, {}, base)).toEqual(nothing);
    const cleared = readerSourceMetadataEvaluateContext(second, undefined);
    expect(evaluate(read, {}, cleared)).toEqual(nothing);
    expect(evaluate(read, {}, second)._0).toBe(secondPacket);
  });

  test("a held closure reads its current invocation packet and cannot revive its creation packet", () => {
    const base = context();
    const firstPacket = packet("A");
    const first = readerSourceMetadataEvaluateContext(base, firstPacket);
    const closure = evaluate(call("metadata:readFactory"), {}, first);
    const nextPacket = packet("B");
    const next = readerSourceMetadataEvaluateContext(base, nextPacket);
    expect(invokeCallable(closure, [], first)._0).toBe(firstPacket);
    expect(invokeCallable(closure, [], next)._0).toBe(nextPacket);
    expect(invokeCallable(closure, [], base)).toEqual(nothing);
    expect(invokeCallable(closure, [], readerSourceMetadataEvaluateContext(next, undefined))).toEqual(nothing);
  });

  test("pure and where frames retain only the current own captured packet", () => {
    const base = context();
    const firstPacket = packet("A");
    const first = readerSourceMetadataEvaluateContext(base, firstPacket);
    const nextPacket = packet("B");
    const next = readerSourceMetadataEvaluateContext(first, nextPacket);
    const cleared = readerSourceMetadataEvaluateContext(next, undefined);
    for (const [frame, expected] of [[first, firstPacket], [next, nextPacket], [cleared, undefined], [base, undefined]]) {
      const pure = pureEvaluateContext(frame);
      expect(currentPacket(pure)).toBe(expected);
      expect(pureEvaluateContext(pure)._readerSourceMetadata).toBe(expected);
      const proof = beginWhereProofFrame();
      try {
        const actual = evaluate(read, {}, pure);
        if (expected === undefined) expect(actual).toEqual(nothing);
        else expect(actual._0).toBe(expected);
      } finally { endWhereProofFrame(proof); }
      const actualWhere = evaluate({ where: [read, { local: 1 }] }, {}, pure);
      if (expected === undefined) expect(actualWhere).toEqual(nothing);
      else expect(actualWhere._0).toBe(expected);
    }
  });

  test("an inherited or accessor packet is never recovered by absent or pure contexts", () => {
    let getterReads = 0;
    const stale = packet("old");
    const inherited = Object.assign(Object.create({ _readerSourceMetadata: stale }), context());
    expect(readerSourceMetadataEvaluateContext(inherited, undefined)).toBe(inherited);
    expect(currentPacket(inherited)).toBeUndefined();
    expect(currentPacket(pureEvaluateContext(inherited))).toBeUndefined();
    const accessor = context();
    Object.defineProperty(accessor, "_readerSourceMetadata", { get() { getterReads++; return stale; }, enumerable: true });
    expect(currentPacket(accessor)).toBeUndefined();
    expect(currentPacket(pureEvaluateContext(accessor))).toBeUndefined();
    expect(currentPacket(readerSourceMetadataEvaluateContext(accessor, undefined))).toBeUndefined();
    expect(getterReads).toBe(0);
  });
});
