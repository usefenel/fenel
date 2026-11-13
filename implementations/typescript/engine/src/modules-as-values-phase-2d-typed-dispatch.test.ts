// modules-as-values Phase 2d, slice S3 — the evaluator's typed method path and
// the source-function coordinate.
//
// `(Iso.decode s : Result String JsonValue)` selects `Iso String JsonValue`
// because the written type fixes the class parameter the argument cannot. The
// evaluator carries the written type to the call it wraps (never through a
// context field), resolves written types where they are written (the
// source-function coordinate), runs the Fenel call-site rule, selects by the
// complete type, and checks evidence and result by strict membership.
//
// One registry serves every case: the product account registry over the whole
// repository module set (so every Iso / Decodable / Migration value, class and
// scheme is the corpus's own) plus two small account modules, `s3a` and `s3b`,
// which place annotations in named bodies of two different modules.
import { beforeAll, describe, expect, test } from "bun:test";

import { loadFenelModule } from "./fenel-module";
import { parse } from "./fenel-parser";
import { evaluate, type EvaluateContext } from "./json-logic";
import type { ModuleRegistry } from "./registry";
import { createAccountRegistry } from "./repository-registry";
import { dispatchRegistry } from "./system-entities";
import { SYSTEM_REGISTRY_MODULES } from "./system-registry-modules";
import { mintTestAuthorityFor, mintTestAuthorityForNothing, testPerformTable } from "./authority-test-support";
import type { FenelModule, FenelType } from "./types";

const LONG = 600_000;

// Account-authored parameters must be positional (`_n`) or carry a UUID key.
function positionalParams(mod: FenelModule): FenelModule {
  return {
    ...mod,
    functions: (mod.functions ?? []).map((fn) => ({
      ...fn,
      params: fn.params.map((param, index) => ({
        ...param,
        key: { $tag: "PositionalField", index } as const,
      })),
    })),
  };
}

// Module s3a imports JsonValue from codec; module s3b does not, so the same
// written type resolves in s3a and not in s3b.
const MODULE_A = String.raw`module s3a where
import codec (JsonValue)
decodeHere : String -> Result String JsonValue
decodeHere _0 = (Iso.decode _0 : Result String JsonValue)
mkDecoder : Unit -> (String -> Result String JsonValue)
mkDecoder _0 = (\s -> (Iso.decode s : Result String JsonValue))
`;
const MODULE_B = String.raw`module s3b where
applyTo : (String -> Result String a) -> Result String a
applyTo _0 = _0 "42"
decodeThere _0 = (Iso.decode _0 : Result String JsonValue)
`;

let registry: ModuleRegistry;
let ctx: EvaluateContext;

beforeAll(() => {
  registry = createAccountRegistry(
    SYSTEM_REGISTRY_MODULES,
    [
      positionalParams(loadFenelModule(MODULE_A, "s3a", { bootstrapParser: "typescript" })),
      positionalParams(loadFenelModule(MODULE_B, "s3b", { bootstrapParser: "typescript" })),
    ],
    { dispatchRegistry },
  );
  ctx = registry.evaluateContext();
  // Warm the call-site rule once (the first dispatch loads the inference engine).
  evaluate(parse(`(Iso.decode "1" : Result String codec.JsonValue)`), {}, ctx);
}, LONG);

/** Evaluate as the body of `functionId` evaluates (the durable runtime sets the
 *  same coordinate from its function id). */
const at = (functionId: string, base: EvaluateContext = ctx): EvaluateContext =>
  ({ ...base, _sourceFunction: functionId });
const IN_CODEC = "codec:jsonDecode";
const IN_MIGRATION = "migration:profileDemoV1ToV2";

const run = (source: string, data: Record<string, unknown> = {}, context: EvaluateContext = at(IN_CODEC)) =>
  evaluate(parse(source), data, context);
/** The FenelType the parser writes for `T`. */
const typeOf = (source: string): FenelType =>
  (parse(`(x : ${source})`) as { ann: [unknown, FenelType] }).ann[1];

/** A context whose codec natives record each call. */
function spying(base: EvaluateContext): { context: EvaluateContext; calls: string[] } {
  const calls: string[] = [];
  const natives = Object.assign(Object.create(null), base.natives) as Record<string, (...args: unknown[]) => unknown>;
  for (const id of ["codec:jsonDecode", "codec:canonicalJsonDecode", "codec:base64Decode"]) {
    const original = natives[id];
    expect(typeof original).toBe("function");
    natives[id] = (...args: unknown[]) => {
      calls.push(id);
      return original!(...args);
    };
  }
  return { context: { ...base, natives }, calls };
}

const jsonNumber = (value: number) => ({ $tag: "JsonNumber", value });

describe("the typed path over the corpus", () => {
  test("(Iso.decode \"42\" : Result String JsonValue) selects isoJson", () => {
    const { context, calls } = spying(at(IN_CODEC));
    expect(run(`(Iso.decode "42" : Result String JsonValue)`, {}, context))
      .toEqual({ $tag: "Ok", _0: jsonNumber(42) });
    expect(calls).toEqual(["codec:jsonDecode"]);
  }, LONG);

  test("a decoded JSON array or object fails its result check as undecided, never a false yes or no", () => {
    // JsonArray items and JsonObject pairs are host arrays at run time, and
    // strict membership does not read the List host carrier (tcb-ledger row
    // mem.ctor: runtime pattern matching does not read it either). So the
    // result check answers unknown and the typed path fails closed, although
    // the instance was selected and ran. FOLLOW-UP: runtime pattern matching
    // and every compiler must read the List host carrier before membership
    // may; then the first call returns Ok (JsonArray [JsonNumber 1, JsonNumber 2]).
    const { context, calls } = spying(at(IN_CODEC));
    const decode = (s: string) => run(`(Iso.decode s : Result String JsonValue)`, { s }, context);
    const undecided = /^Iso\.decode: the result is not shown to be a value of the written type \(strict membership answered unknown\)/;
    expect(() => decode("[1,2]")).toThrow(undecided);
    expect(() => decode("[]")).toThrow(undecided);
    expect(() => decode("{\"a\":1}")).toThrow(undecided);
    expect(calls).toEqual(["codec:jsonDecode", "codec:jsonDecode", "codec:jsonDecode"]);
    // A JSON scalar holds no host array: decided, and returned.
    expect(decode("42")).toEqual({ $tag: "Ok", _0: jsonNumber(42) });
    expect(decode("\"x\"")).toEqual({ $tag: "Ok", _0: { $tag: "JsonString", value: "x" } });
  }, LONG);

  test("(Iso.decode \"aGVsbG8=\" : Result String Bytes) selects Base64 and checks its byte result", () => {
    const bytes = registry.callSiteTyping.resolveType({ $ref: "Bytes" }, "codec:base64Decode");
    expect(bytes.ok).toBe(true);
    const { context, calls } = spying(at("codec:base64Decode"));
    expect(run(`(Iso.decode "aGVsbG8=" : Result String Bytes)`, {}, context))
      .toEqual({ $tag: "Ok", _0: Uint8Array.of(104, 101, 108, 108, 111) });
    expect(run(`(Iso.decode "" : Result String Bytes)`, {}, context))
      .toEqual({ $tag: "Ok", _0: new Uint8Array(0) });
    expect(calls).toEqual(["codec:base64Decode", "codec:base64Decode"]);
    // A forged carrier returned by the selected instance cannot pass its
    // declared result check merely by inheriting the Uint8Array prototype.
    const forged = { ...context, natives: { ...context.natives,
      "codec:base64Decode": () => ({ $tag: "Ok", _0: Object.create(Uint8Array.prototype) }),
    } };
    expect(() => run(`(Iso.decode "aGVsbG8=" : Result String Bytes)`, {}, forged))
      .toThrow(/the result is not shown to be a value of the written type \(strict membership answered no\)/);
  }, LONG);

  test("an argument written (s : CanonicalJsonString) selects isoCanonicalJson", () => {
    const { context, calls } = spying(at(IN_CODEC));
    expect(run(`(Iso.decode (s : CanonicalJsonString) : Result String JsonValue)`, { s: "42" }, context))
      .toEqual({ $tag: "Ok", _0: jsonNumber(42) });
    // The CanonicalJsonString predicate decodes once while membership checks the
    // evidence; the selected instance's own decode is the canonical one.
    expect(calls).toEqual(["codec:jsonDecode", "codec:canonicalJsonDecode"]);
  }, LONG);

  test("a forged refinement is refused: a written argument type must hold of its value", () => {
    const { context, calls } = spying(at(IN_CODEC));
    expect(() => run(`(Iso.decode (s : CanonicalJsonString) : Result String JsonValue)`, { s: "{ \"a\": 1 }" }, context))
      .toThrow(/Iso\.decode: argument 1 is written with a type its value is not shown to have \(strict membership answered no\)/);
    // Only the predicate ran (membership); no instance was selected or run.
    expect(calls).toEqual(["codec:jsonDecode"]);
  }, LONG);

  test("the four Decodable JsonValue targets, each selected by the written result type", () => {
    const decode = (type: string, x: unknown) => run(`(Decodable.decode x : Result String ${type})`, { x });
    expect(decode("Int", jsonNumber(3))).toEqual({ $tag: "Ok", _0: 3 });
    expect(decode("Number", jsonNumber(3.5))).toEqual({ $tag: "Ok", _0: 3.5 });
    expect(decode("String", { $tag: "JsonString", value: "x" })).toEqual({ $tag: "Ok", _0: "x" });
    expect(decode("Boolean", { $tag: "JsonBool", value: true })).toEqual({ $tag: "Ok", _0: true });
    // The same value, two written types, two instances.
    expect(decode("Int", jsonNumber(3.5)))
      .toEqual({ $tag: "Err", _0: "decodeJsonInt: expected Int, got fractional Number" });
    expect(decode("Number", jsonNumber(3.5))).toEqual({ $tag: "Ok", _0: 3.5 });
  }, LONG);

  test("an unannotated Iso.decode names the parameter nothing fixes", () => {
    expect(() => run(`Iso.decode "42"`)).toThrow(
      /^Iso\.decode: the class parameter a is not fixed by the arguments; write the type, or select the instance/,
    );
    expect(() => run(`Iso.encode x`, { x: jsonNumber(3) })).toThrow(
      /^Iso\.encode: the class parameter s is not fixed by the arguments; write the type, or select the instance/,
    );
    // Written, the same call is typed.
    expect(run(`(Iso.encode x : Result String String)`, { x: jsonNumber(3) })).toEqual({ $tag: "Ok", _0: "3" });
  }, LONG);

  test("a wrong, an incomplete and a contradictory annotation are errors", () => {
    expect(() => run(`(Iso.decode "42" : Maybe JsonValue)`))
      .toThrow(/Iso\.decode: the call does not fit the declared method type: inference\.constructor-mismatch/);
    expect(() => run(`(Iso.decode "42" : Result String a)`))
      .toThrow(/Iso\.decode: the written result type cannot be resolved here \("a"\)/);
    expect(() => evaluate({ ann: [{ method: ["Iso", "decode", "42"] }, { $var: "a" }] }, {}, at(IN_CODEC)))
      .toThrow(/Iso\.decode: the written result type cannot be resolved here \("a"\): a written type must be ground/);
    expect(() => run(`(Iso.decode "42" : Result Int JsonValue)`))
      .toThrow(/Iso\.decode: the call does not fit the declared method type: inference\.nominal-mismatch/);
  }, LONG);

  test("a class parameter solved to an application is rejected, never collapsed to its head", () => {
    expect(() => run(`(Monoid.mempty : List Int)`)).toThrow(/Monoid\.mempty: .*call-site\.non-nominal-parameter/);
  }, LONG);

  test("an argument the value cannot fix is fixed by its written type, which is checked", () => {
    const profile = { firstName: "Ada", lastName: "Lovelace" };
    // An untagged record reflects to nothing: v1 stays open.
    expect(() => run(`(Migration.forward p : Result MigrationError ProfileDemoV2)`, { p: profile }, at(IN_MIGRATION)))
      .toThrow(/^Migration\.forward: the class parameter v1 is not fixed by the arguments or the written type/);
    expect(run(`(Migration.forward (p : ProfileDemoV1) : Result MigrationError ProfileDemoV2)`, { p: profile }, at(IN_MIGRATION)))
      .toEqual({ $tag: "Ok", _0: { firstName: "Ada", lastName: "Lovelace", email: "" } });
    expect(() => run(
      `(Migration.forward (p : ProfileDemoV1) : Result MigrationError ProfileDemoV2)`,
      { p: { firstName: "Ada" } },
      at(IN_MIGRATION),
    )).toThrow(/Migration\.forward: argument 1 is written with a type its value is not shown to have/);
  }, LONG);

  test("no instance of the complete type, and a top-priority tie, are errors", () => {
    expect(() => run(`(Decodable.decode x : Result String JsonValue)`, { x: jsonNumber(3) }))
      .toThrow(/^no Decodable JsonValue JsonValue instance in scope \(Decodable\.decode\)$/);
    // A second `Decodable JsonValue Int` row at the same priority, visible only
    // under a tag this test alone activates.
    dispatchRegistry.addInstance({
      typeName: "Decodable",
      args: ["JsonValue", "Int"],
      methods: { decode: { $ref: "codec.decodeJsonNumber" } },
      scope: { kind: "tag", tag: "mav2d-s3-tie" },
    });
    expect(run(`(Decodable.decode x : Result String Int)`, { x: jsonNumber(3) })).toEqual({ $tag: "Ok", _0: 3 });
    expect(() => run(
      `(Decodable.decode x : Result String Int)`,
      { x: jsonNumber(3) },
      { ...at(IN_CODEC), _activeTags: ["mav2d-s3-tie"] },
    )).toThrow(/^ambiguous Decodable\.decode dispatch for type "JsonValue Int" — 2 instances tie in scope$/);
  }, LONG);

  test("frame shadowing through withInstance compares the complete tuple", () => {
    const shadow = (args: unknown[], body: unknown = parse(`(Iso.decode "42" : Result String JsonValue)`)) => ({
      withInstance: [
        {
          typeName: "Iso",
          args,
          methods: { decode: { fn: [["s"], { $tag: "Ok", _0: { $tag: "JsonString", value: "shadowed" } }] } },
        },
        body,
      ],
    });
    const shadowed = { $tag: "Ok", _0: { $tag: "JsonString", value: "shadowed" } };
    expect(evaluate(shadow(["String", "JsonValue"]), {}, at(IN_CODEC))).toEqual(shadowed);
    // `Iso String Bytes` shares the first argument and does not shadow.
    expect(evaluate(shadow(["String", "Bytes"]), {}, at(IN_CODEC))).toEqual({ $tag: "Ok", _0: jsonNumber(42) });
    // A same-class frame without a complete tuple cannot be compared.
    expect(() => evaluate(shadow([{ $var: "x" }, "JsonValue"]), {}, at(IN_CODEC)))
      .toThrow(/Iso\.decode: Iso String JsonValue cannot be selected by its complete type here/);
    // The frame's method result is checked like any other.
    const lying = {
      withInstance: [
        { typeName: "Iso", args: ["String", "JsonValue"], methods: { decode: { fn: [["s"], 7] } } },
        parse(`(Iso.decode "42" : Result String JsonValue)`),
      ],
    };
    expect(() => evaluate(lying, {}, at(IN_CODEC)))
      .toThrow(/Iso\.decode: the result is not shown to be a value of the written type \(strict membership answered no\)/);
  }, LONG);

  test("module-member precedence is unchanged: an annotated member call strips its annotation", () => {
    expect(evaluate({ ann: [{ method: ["codec", "jsonDecode", "42"] }, typeOf("Maybe Int")] }, {}, at(IN_CODEC)))
      .toEqual({ $tag: "Ok", _0: jsonNumber(42) });
  }, LONG);

  test("an argument-dispatched method under an annotation is unchanged (the annotation is stripped)", () => {
    const data = { f: parse(String.raw`\x -> x + 1`) };
    const f = evaluate(data.f, {}, ctx);
    expect(run(`(Functor.fmap f [1, 2] : List Int)`, { f })).toEqual([2, 3]);
    expect(run(`(Functor.fmap f [1, 2] : String)`, { f })).toEqual([2, 3]);
  }, LONG);

  test("no expected type leaks into argument evaluation or into the selected method's body", () => {
    // The inner Iso.encode is unannotated: the outer written type is not its.
    expect(() => run(`(Iso.decode (Iso.encode x) : Result String JsonValue)`, { x: jsonNumber(3) }))
      .toThrow(/^Iso\.encode: the class parameter s is not fixed by the arguments; write the type/);
    // The selected method's body calls Iso.decode unannotated.
    const frame = {
      withInstance: [
        {
          typeName: "Iso",
          args: ["String", "JsonValue"],
          methods: { decode: { fn: [["s"], { method: ["Iso", "decode", { var: "s" }] }] } },
        },
        parse(`(Iso.decode "42" : Result String JsonValue)`),
      ],
    };
    expect(() => evaluate(frame, {}, at(IN_CODEC)))
      .toThrow(/^Iso\.decode: the class parameter a is not fixed by the arguments; write the type/);
  }, LONG);

  test("each argument is evaluated exactly once", () => {
    let count = 0;
    const counted: EvaluateContext = {
      ...at(IN_CODEC),
      natives: { ...ctx.natives, "s3:fortyTwo": () => { count += 1; return "42"; } },
    };
    expect(evaluate({ ann: [{ method: ["Iso", "decode", { call: ["s3:fortyTwo"] }] }, typeOf("Result String JsonValue")] }, {}, counted))
      .toEqual({ $tag: "Ok", _0: jsonNumber(42) });
    expect(count).toBe(1);
    expect(evaluate({ ann: [{ method: ["Iso", "decode", { ann: [{ call: ["s3:fortyTwo"] }, typeOf("String")] }] }, typeOf("Result String JsonValue")] }, {}, counted))
      .toEqual({ $tag: "Ok", _0: jsonNumber(42) });
    expect(count).toBe(2);
  }, LONG);

  test("only an exact full application is typed", () => {
    expect(() => evaluate({ method: ["Iso", "decode"] }, {}, at(IN_CODEC)))
      .toThrow(/^Iso\.decode: a method selected by its complete type must be fully applied: it declares 1 parameter\(s\), the call supplies 0$/);
    expect(() => evaluate({ ann: [{ method: ["Iso", "decode", "42", "43"] }, typeOf("Result String JsonValue")] }, {}, at(IN_CODEC)))
      .toThrow(/the call supplies 2$/);
  }, LONG);

  test("a method with no authoritative declared type is a clear error", () => {
    expect(() => evaluate({ ann: [{ method: ["Reprable", "native"] }, typeOf("String")] }, {}, at(IN_CODEC)))
      .toThrow(/^Reprable\.native has no authoritative declared type, so its instance cannot be selected by type/);
  }, LONG);

  test("an evaluation context without call-site typing fails closed", () => {
    const bare: EvaluateContext = { _specRegistry: dispatchRegistry };
    expect(() => evaluate({ method: ["Iso", "decode", "42"] }, {}, bare))
      .toThrow(/^Iso\.decode: this method is selected by its complete type, and this evaluation context has no call-site typing$/);
  }, LONG);
});

describe("selection grants no authority", () => {
  // Decision 8: a typed call runs its selected method exactly as an untyped
  // `Class.method` call does — same frame, same perform gate. The selected
  // method performs the host act `time:now` (a mediated native act), then
  // answers. Compared with an untyped, argument-dispatched `Functor.fmap`
  // whose selected method performs the same act.
  const answer = { $tag: "Ok", _0: { $tag: "JsonString", value: "timed" } };
  const performing = (params: string[]) => ({ fn: [params, { if: [{ call: ["time:now"] }, answer, answer] }] });
  const typed = () => ({
    withInstance: [
      { typeName: "Iso", args: ["String", "JsonValue"], methods: { decode: performing(["s"]) } },
      parse(`(Iso.decode "42" : Result String JsonValue)`),
    ],
  });
  const untyped = () => ({
    withInstance: [
      { typeName: "Functor", args: ["List"], methods: { fmap: performing(["f", "xs"]) } },
      parse(`Functor.fmap f [1, 2]`),
    ],
  });
  /** A frame under `authority`, whose `time:now` implementation counts. */
  const framed = (authority: unknown) => {
    const table = testPerformTable(registry);
    let hits = 0;
    table.register("time:now", () => { hits += 1; return 1; }, 1);
    const context = { ...at(IN_CODEC), _authority: authority, _performTable: table.handle } as EvaluateContext;
    return { context, hits: () => hits };
  };
  const refusal = (fn: () => unknown): string => {
    try {
      fn();
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error("expected a refusal");
  };
  const identity = () => evaluate(parse(String.raw`\x -> x`), {}, ctx);

  test("a frame that does not permit the act refuses the typed call exactly as the untyped one", () => {
    const typedFrame = framed(mintTestAuthorityForNothing(registry));
    const untypedFrame = framed(mintTestAuthorityForNothing(registry));
    const typedRefusal = refusal(() => evaluate(typed(), {}, typedFrame.context));
    const untypedRefusal = refusal(() => evaluate(untyped(), { f: identity() }, untypedFrame.context));
    expect(typedRefusal).toMatch(/authority refused "time:now" \(refused\)/);
    expect(typedRefusal).toBe(untypedRefusal);
    expect(typedFrame.hits()).toBe(0);
    expect(untypedFrame.hits()).toBe(0);
  }, LONG);

  test("a frame that permits the act runs it once, typed or untyped", () => {
    const typedFrame = framed(mintTestAuthorityFor(["time:now"], registry));
    const untypedFrame = framed(mintTestAuthorityFor(["time:now"], registry));
    expect(evaluate(typed(), {}, typedFrame.context)).toEqual(answer);
    expect(evaluate(untyped(), { f: identity() }, untypedFrame.context)).toEqual(answer);
    expect(typedFrame.hits()).toBe(1);
    expect(untypedFrame.hits()).toBe(1);
  }, LONG);
});

describe("the source-function coordinate", () => {
  test("a named body resolves its annotation in its own module", () => {
    expect(evaluate({ call: ["s3a:decodeHere", "42"] }, {}, ctx)).toEqual({ $tag: "Ok", _0: jsonNumber(42) });
    expect(() => evaluate({ call: ["s3b:decodeThere", "42"] }, {}, ctx))
      .toThrow(/Iso\.decode: the written result type cannot be resolved here \("JsonValue"\): the type JsonValue is not visible here/);
  }, LONG);

  test("a function of module A called from a body of module B resolves in A", () => {
    expect(evaluate({ call: ["s3b:applyTo", { $ref: "s3a:decodeHere" }] }, {}, ctx))
      .toEqual({ $tag: "Ok", _0: jsonNumber(42) });
  }, LONG);

  test("a closure defined in module A and called from module B resolves its annotation in A", () => {
    const decoder = evaluate({ call: ["s3a:mkDecoder", null] }, {}, ctx) as Record<string, unknown>;
    expect(decoder.sourceFunction).toBe("s3a:mkDecoder");
    expect(evaluate({ call: ["s3b:applyTo", { var: "f" }] }, { f: decoder }, ctx))
      .toEqual({ $tag: "Ok", _0: jsonNumber(42) });
  }, LONG);

  test("a lambda captures the coordinate in force where it is written", () => {
    const lambda = { fn: [["s"], { var: "s" }] };
    expect((evaluate(lambda, {}, at("s3a:decodeHere")) as Record<string, unknown>).sourceFunction)
      .toBe("s3a:decodeHere");
    expect(Object.getOwnPropertyDescriptor(evaluate(lambda, {}, ctx) as object, "sourceFunction")).toBeUndefined();
  }, LONG);

  test("a closure is invoked with its own coordinate, never the caller's", () => {
    const body = { ann: [{ method: ["Iso", "decode", { var: "s" }] }, typeOf("Result String JsonValue")] };
    const apply = { apply: [{ var: "f" }, ["42"]] };
    const carrying = { __fenelFn: true, params: ["s"], body, closure: {}, sourceFunction: "s3a:decodeHere" };
    const bare = { __fenelFn: true, params: ["s"], body, closure: {} };
    // Restored under a detached caller and under a caller in another module.
    expect(evaluate(apply, { f: carrying }, ctx)).toEqual({ $tag: "Ok", _0: jsonNumber(42) });
    expect(evaluate(apply, { f: carrying }, at(IN_MIGRATION))).toEqual({ $tag: "Ok", _0: jsonNumber(42) });
    // A closure with none runs detached even inside a caller that has one.
    expect(() => evaluate(apply, { f: bare }, at("s3a:decodeHere")))
      .toThrow(/the type JsonValue is not visible without a source function/);
  }, LONG);

  test("a closure's coordinate slot is read as caller data: own data string, or absent", () => {
    const apply = { apply: [{ var: "f" }, ["42"]] };
    const accessor = { __fenelFn: true, params: ["s"], body: { var: "s" }, closure: {} };
    Object.defineProperty(accessor, "sourceFunction", { get: () => "s3a:decodeHere", enumerable: true });
    expect(() => evaluate(apply, { f: accessor }, ctx)).toThrow(/closure sourceFunction must be an own data property/);
    const numeric = { __fenelFn: true, params: ["s"], body: { var: "s" }, closure: {}, sourceFunction: 7 };
    expect(() => evaluate(apply, { f: numeric }, ctx)).toThrow(/closure sourceFunction must be a string/);
  }, LONG);

  test("an unfrozen body that gains an annotation after a warm call resolves it in its own module", () => {
    // A registered function served with an UNFROZEN body (as the engine
    // harness serves bodies). Its first entry has no annotation; a negative
    // scan must not be memoized for it, or the annotation added below would
    // run detached.
    const registered = registry.getFunction("s3a:decodeHere")!;
    expect(Object.isFrozen(registered.body)).toBe(true);
    const body: Record<string, unknown> = { var: "_0" };
    const mutable = { ...registered, body };
    const served: EvaluateContext = {
      ...ctx,
      getFunction: (name: string) => (name === "s3a:decodeHere" ? mutable : ctx.getFunction?.(name)),
    } as EvaluateContext;
    expect(evaluate({ call: ["s3a:decodeHere", "42"] }, {}, served)).toBe("42");
    delete body.var;
    body.ann = [{ method: ["Iso", "decode", { var: "_0" }] }, typeOf("Result String JsonValue")];
    expect(evaluate({ call: ["s3a:decodeHere", "42"] }, {}, served)).toEqual({ $tag: "Ok", _0: jsonNumber(42) });
    // The same annotation, detached, does not resolve: the coordinate did it.
    expect(() => evaluate(body, { _0: "42" }, ctx)).toThrow(/the type JsonValue is not visible without a source function/);
  }, LONG);

  test("detached evaluation resolves qualified names and the system scalars only", () => {
    expect(run(`(Iso.decode "42" : Result String codec.JsonValue)`, {}, ctx)).toEqual({ $tag: "Ok", _0: jsonNumber(42) });
    expect(() => run(`(Iso.decode "42" : Result String JsonValue)`, {}, ctx))
      .toThrow(/the type JsonValue is not visible without a source function/);
  }, LONG);
});
