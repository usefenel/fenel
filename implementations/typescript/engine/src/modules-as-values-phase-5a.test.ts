// ---------------------------------------------------------------------------
// modules-as-values Phase 5a, slice E — every named member is reachable by dot
// (`workstreams/modules-as-values/briefs/phase-5a-named-members-by-dot.md`,
// "Outcome", settled design 1 and 4(b), amendments A1, A3, A4).
//
// The evaluator half: ONE walk (`resolveBundleMemberPath`, json-logic.ts) takes
// a dotted path whose head is an unbound bundle name to the bundle's member of
// any named kind (`_moduleMember`, slice L) and projects the remaining
// segments out of its value. `resolveVar` (value position), `methodOp` (an
// uppercase bundle head) and `invokeFunction` (every string call head: `callOp`,
// `|>`, `pipe`, `apply`, `$`, the HOF path, recognised key-form calls) share it,
// so a path means the same thing as a value and as a call.
//
//   (V) the outcome table in value position, on a real registry;
//   (C) the same rows in call position, through every string-name path;
//   (S) shadowing: a local binder wins in value and call position, and data
//       never captures a string call head (the run-time decision);
//   (A) ambiguity and selection in small registries: one name with two
//       targets throws in value AND call position, and a selected reference
//       performs nothing until it is called.
// ---------------------------------------------------------------------------

import { beforeAll, describe, expect, test } from "bun:test";
import { loadFenelModule, resolveLocalCallHeads } from "./fenel-module";
import { parse } from "./fenel-parser";
import { evaluate, pureEvaluateContext, type EvaluateContext } from "./json-logic";
import { modulesFor } from "./module-manifest";
import { algebraModule } from "./modules/algebra";
import { createRegistry, type ModuleRegistry } from "./registry";
import { createAccountRegistry } from "./repository-registry";
import { dispatchRegistry } from "./system-entities";
import type { FenelModule } from "./types";

const LONG = 600_000;
const src = (...lines: string[]): string => lines.join("\n");
const HELLO = new Uint8Array([104, 101, 108, 108, 111]);
const HI = new Uint8Array([104, 105]);
const OK_HELLO = { $tag: "Ok", _0: HELLO };

/** Account-authored parameters are positional (the field-identity rule). */
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

// A real Fenel module, loaded by the loader, so its call heads are in loaded
// form (the shadowing rewrite included). `state` is a bundle of the execute
// registry (`state.listInstances` is its IO leaf); the lambda parameters named
// `state` shadow it (account parameters are positional, `_n`). The `as` alias
// rides on the module value: the import grammar reads an uppercase module name
// only, and every bundle is lowercase.
const DEMO = src(
  "module p5demo where",
  "AliasScope5a = AliasScope5a",
  "decodeVia : String -> Result String Bytes",
  "decodeVia _0 = codec.isoBase64.decode _0",
  "decodeAlias : String -> Result String Bytes",
  "decodeAlias _0 = c.isoBase64.decode _0",
  "wrap : Number -> List Number",
  "wrap _0 = [_0]",
  "shadowCall : Number -> List Number",
  "shadowCall _0 = (\\state -> state.error _0) { error = wrap }",
  "shadowMember : Number -> List Number",
  // Two fields: a ONE-field record literal whose key names a function is read
  // as a key-form call (`{listInstances: …}`), an unrelated existing ambiguity.
  "shadowMember _0 = (\\state -> state.listInstances _0) { listInstances = wrap, note = 0 }",
);

let reg: ModuleRegistry;
let ctx: EvaluateContext;
const run = (source: string, data: Record<string, unknown> = {}): unknown => evaluate(parse(source), data, ctx);

beforeAll(() => {
  // The execute registry carries codec, std, telegram and state; the algebra
  // bundle (which holds `maybeFunctor`) joins it.
  reg = createAccountRegistry(
    [...modulesFor("execute"), algebraModule],
    [{ ...positionalParams(loadFenelModule(DEMO, "p5demo")), imports: [{ module: "codec", as: "c" }] }],
    { dispatchRegistry },
  );
  ctx = reg.evaluateContext();
}, LONG);

// ===========================================================================
// (V) Value position.
// ===========================================================================

describe("(V) a dotted path reaches a member of any named kind", () => {
  // The member's value is the registry's answer (slice L owns its exact
  // spelling); this file pins that the walk serves it and projects out of it.
  const instanceValue = (bundle: string, name: string): Record<string, unknown> => {
    const resolved = reg.resolveModuleMember(bundle, name);
    expect(resolved.kind).toBe("instance");
    return (resolved as { value: Record<string, unknown> }).value;
  };
  const target = (value: unknown): string | undefined =>
    reg.getFunction((value as { $ref: string }).$ref)?.id;

  test("codec.isoBase64 is the instance value", () => {
    const value = run("codec.isoBase64") as Record<string, unknown>;
    expect(value).toEqual(instanceValue("codec", "isoBase64"));
    expect(Object.keys(value).sort()).toEqual(["$tag", "decode", "encode", "label"]);
    expect(value.$tag).toBe("Iso");
    expect(value.label).toBe("Base64 (RFC 4648)");
    expect(target(value.encode)).toBe("codec:base64Encode");
  }, LONG);

  test("codec.isoBase64.decode is the reference its decode field holds", () => {
    const decode = run("codec.isoBase64.decode");
    expect(decode).toEqual(instanceValue("codec", "isoBase64").decode);
    expect(Object.keys(decode as object)).toEqual(["$ref"]);
    expect(target(decode)).toBe("codec:base64Decode");
  }, LONG);

  test("algebra.maybeFunctor.fmap is the reference the algebra bundle's instance holds", () => {
    const fmap = run("algebra.maybeFunctor.fmap");
    expect(fmap).toEqual(instanceValue("algebra", "maybeFunctor").fmap);
    expect(target(fmap)).toBe("algebra:maybeFmap");
  }, LONG);

  test("telegram.Update is the type, as the UUID handle that resolves back to telegram's Update", () => {
    const handle = run("telegram.Update") as { $ref: string };
    expect(Object.keys(handle)).toEqual(["$ref"]);
    expect(handle.$ref).toBe(reg.getUuid("Update")!);
    expect(reg.getEntity(handle.$ref)?.module).toBe("telegram");
  }, LONG);

  test("a type with two owners is an error naming both", () => {
    expect(() => run("telegram.Animation")).toThrow(
      /telegram\.Animation is ambiguous: the type Animation is declared by 2 owners \(animation, telegram\)/,
    );
    // Per-owner type identity (Phase 5 S2): each owner has its own UUID,
    // resolving back to it, yet the projection stays refused until an owner
    // can be selected, saved and printed (amendment A1).
    const telegramUuid = reg.getTypeUuid("telegram", "Animation")!;
    const animationUuid = reg.getTypeUuid("animation", "Animation")!;
    expect(telegramUuid).not.toBe(animationUuid);
    expect(reg.getEntity(telegramUuid)?.module).toBe("telegram");
    expect(reg.getEntity(animationUuid)?.module).toBe("animation");
    expect(() => run("telegram.Animation")).toThrow(telegramUuid);
  }, LONG);

  test("an uppercase bundle head reaches its named instance through the {method} fork", () => {
    const viewable = run("DrawingDemo.pointLineChartViewable") as Record<string, unknown>;
    expect(viewable.$tag).toBe("Viewable");
    expect(viewable.defaultView).toBe("point-line-chart");
  }, LONG);

  test("a missing member, a missing field and projection past a reference stay misses", () => {
    expect(run("codec.ghost")).toBeNull();
    expect(run("codec.isoBase64.ghost")).toBeNull();
    expect(run("codec.isoBase64.decode.inner")).toBeNull();
    expect(run("codec.base64Decode.inner")).toBeNull();
    expect(run("telegram.Update.inner")).toBeNull();
    expect(evaluate({ var: ["codec.isoBase64.ghost", 9] }, {}, ctx)).toBe(9);
  }, LONG);
});

// ===========================================================================
// (C) Call position.
// ===========================================================================

describe("(C) a projected callable applies, through every string-name path", () => {
  test("codec.isoBase64.decode \"aGVsbG8=\" equals the typed (Iso.decode … : Result String Bytes)", () => {
    const typed = run('(Iso.decode "aGVsbG8=" : Result String Bytes)');
    expect(typed).toEqual(OK_HELLO);
    expect(run('codec.isoBase64.decode "aGVsbG8="')).toEqual(typed);
  }, LONG);

  test("in a loaded body, directly and through an `as` alias", () => {
    expect(evaluate({ call: ["p5demo:decodeVia", "aGVsbG8="] }, {}, ctx)).toEqual(OK_HELLO);
    expect(evaluate({ call: ["p5demo:decodeAlias", "aGVsbG8="] }, {}, ctx)).toEqual(OK_HELLO);
  }, LONG);

  test("an observed declaration scope retains its actual nested-member alias", () => {
    const resolved = ctx._callSiteTyping?.resolveType({ $ref: "p5demo.AliasScope5a" }, undefined);
    const owner = resolved?.ok ? resolved.type.nominals?.find(row => row.path.length === 0) : undefined;
    const scope = owner === undefined ? undefined : ctx._typeDeclarationScope?.(owner.identity);
    const fn = reg.getFunction("p5demo:decodeAlias");
    const imports = fn === undefined ? undefined : ctx.getFunctionImportFrame?.(fn.id);
    if (owner === undefined || scope === undefined || imports === undefined) throw new Error("Missing actual p5demo declaration scope");
    expect(scope.owner).toBe(owner.identity);
    expect(scope.sourceFunction).toBeDefined();
    const local = ctx._callSiteTyping?.resolveType({ $ref: "AliasScope5a" }, scope.sourceFunction);
    expect(local?.ok ? local.type.nominals?.find(row => row.path.length === 0)?.identity : undefined).toBe(owner.identity);
    expect(scope.names).toBe(imports.names);
    expect(scope.aliases).toBe(imports.aliases);
    expect(scope.aliases?.c).toBe("codec");
    const declaration = { ...ctx, _sourceFunction: scope.sourceFunction,
      _importStack: [{ names: scope.names, aliases: scope.aliases ?? {} }],
    };
    const expected = run("codec.isoBase64.encode");
    expect(expected).not.toBeNull();
    expect(evaluate(parse("c.isoBase64.encode"), {}, declaration)).toEqual(expected);
    expect(evaluate(parse("c.isoBase64.encode"), {}, { ...declaration,
      _importStack: [{ names: scope.names, aliases: {} }],
    })).toBeNull();
  }, LONG);

  test("algebra.maybeFunctor.fmap applies the algebra bundle's fmap", () => {
    expect(run("algebra.maybeFunctor.fmap (\\x -> add x 1) (Just 1)")).toEqual({ $tag: "Just", _0: 2 });
  }, LONG);

  test("passed to a HOF, through |>, pipe, apply and $", () => {
    expect(run('map codec.isoBase64.decode ["aGVsbG8=", "aGk="]')).toEqual([OK_HELLO, { $tag: "Ok", _0: HI }]);
    expect(run('["aGVsbG8="] |> map codec.isoBase64.decode')).toEqual([OK_HELLO]);
    expect(run('"aGVsbG8=" |> codec.isoBase64.decode')).toEqual(OK_HELLO);
    expect(run('codec.isoBase64.decode $ "aGVsbG8="')).toEqual(OK_HELLO);
    expect(evaluate({ pipe: ["aGVsbG8=", "codec.isoBase64.decode"] }, {}, ctx)).toEqual(OK_HELLO);
    expect(evaluate({ apply: ["codec.isoBase64.decode", ["aGVsbG8="]] }, {}, ctx)).toEqual(OK_HELLO);
  }, LONG);

  test("an instance, a type and a data field are not callable: a clear error", () => {
    expect(() => run('codec.isoBase64 "x"')).toThrow("codec.isoBase64 is an instance value, not a function");
    expect(() => run('codec.isoBase64.label "x"')).toThrow(
      "codec.isoBase64.label is a field of an instance value, not a function",
    );
    expect(() => run("telegram.Update 1")).toThrow("telegram.Update is a type value, not a function");
    expect(() => run("DrawingDemo.pointLineChartViewable 1")).toThrow(
      "DrawingDemo.pointLineChartViewable is an instance value, not a function",
    );
  }, LONG);

  test("a two-owner type is the same error in call position", () => {
    expect(() => run("telegram.Animation 1")).toThrow(/telegram\.Animation is ambiguous/);
  }, LONG);

  test("a missing member stays a miss in call position", () => {
    expect(run("codec.ghost 1")).toBeNull();
    expect(run("codec.isoBase64.ghost 1")).toBeNull();
  }, LONG);
});

// ===========================================================================
// (S) Shadowing.
// ===========================================================================

describe("(S) a local binder shadows the bundle; data never captures a call head", () => {
  const local = (field: string) => ({ [field]: { $ref: "p5demo:wrap" } });

  test("value position: state.error and state.listInstances read the local record", () => {
    expect(run("state.error", { state: local("error") })).toEqual({ $ref: "p5demo:wrap" });
    expect(run("state.listInstances", { state: local("listInstances") })).toEqual({ $ref: "p5demo:wrap" });
    // Unbound, `state.listInstances` is the bundle's function.
    expect(run("state.listInstances")).toEqual({ $ref: reg.getUuid("state:listInstances") ?? "state:listInstances" });
  }, LONG);

  test("call position, loaded: state.error x applies the local record's field", () => {
    const body = reg.getFunction("p5demo:shadowCall")?.body as { apply: unknown[] };
    expect(body.apply[0]).toEqual({ fn: ["state", { call: [{ var: "state.error" }, { var: "_0" }] }] });
    expect(evaluate({ call: ["p5demo:shadowCall", 5] }, {}, ctx)).toEqual([5]);
    // A member the `state` bundle really has (its IO leaf) is shadowed too.
    expect(evaluate({ call: ["p5demo:shadowMember", 6] }, {}, ctx)).toEqual([6]);
  }, LONG);

  test("an expression built by parse() gets the same shadowing from the static pass", () => {
    const lambda = resolveLocalCallHeads(parse("\\state -> state.error 7"), []);
    expect(lambda).toEqual({ fn: ["state", { call: [{ var: "state.error" }, 7] }] });
    expect(evaluate({ call: [lambda, { var: "s" }] }, { s: local("error") }, ctx)).toEqual([7]);
  }, LONG);

  test("run-time decision: a string call head is a bundle path, never a read of the data context", () => {
    // `data` is not always a lexical scope (a `$where` predicate's data is the
    // record under test): a field named like a bundle must not choose the code.
    const hijack = { codec: { base64Decode: { $ref: "p5demo:wrap" }, isoBase64: { decode: { $ref: "p5demo:wrap" } } } };
    expect(evaluate({ call: ["codec.base64Decode", "aGVsbG8="] }, hijack, ctx)).toEqual(OK_HELLO);
    expect(evaluate({ call: ["codec.isoBase64.decode", "aGVsbG8="] }, hijack, ctx)).toEqual(OK_HELLO);
  }, LONG);
});

// ===========================================================================
// (A) Ambiguity and selection, in small registries.
// ===========================================================================

describe("(A) one name, one target — in value and call position alike", () => {
  const SHAPES = src(
    "module shapes where",
    "Shape a = Shape name: String size: a",
    "Pinger = Pinger go: (Number -> Number)",
  );
  const instanceBundle = (bundle: string, ...lines: string[]): FenelModule => ({
    name: bundle,
    label: bundle,
    instances: loadFenelModule(src(...lines), bundle, { dispatchInstanceFile: true }).instances ?? [],
  });
  let pings = 0;
  // A bodyless leaf whose native counts its runs.
  const iox: FenelModule = {
    ...loadFenelModule(src("module iox where", "@native", "ping : Number -> Number"), "iox"),
    nativeImpls: { "iox:ping": (x: unknown) => { pings += 1; return x; } },
  };
  let small: EvaluateContext;
  beforeAll(() => {
    small = createRegistry([
      loadFenelModule(SHAPES, "shapes"),
      // `selfCall` spells its own bundle's ambiguous member: the registry's
      // lexical frame maps `twice.dup` (an own-module entry) to the function.
      loadFenelModule(src("module twice where", "dup x = x", "selfCall x = twice.dup x"), "twice"),
      instanceBundle("twice", "dup : Shape Number", 'dup = Shape { name = "sq", size = 4 }'),
      // An `as` alias of `twice` (on the module value: the import grammar reads
      // uppercase module names only); the frame maps `t.dup` to the function.
      {
        ...loadFenelModule(src("module useT where", "viaAlias x = t.dup x"), "useT"),
        imports: [{ module: "twice", as: "t" }],
      },
      iox,
      instanceBundle("pings", "pinger : Pinger", "pinger = Pinger { go = iox.ping }"),
      // A global bundle `picture`, and a module that imports `drawing` AS
      // `picture`: inside `useP` the REGISTERED bundle still wins (see the
      // test "a registered bundle wins over an in-scope `as` alias").
      loadFenelModule(src("module picture where", 'render x = Shape { name = "global", size = x }'), "picture"),
      loadFenelModule(src("module drawing where", "render x = x"), "drawing"),
      {
        ...loadFenelModule(src(
          "module useP where",
          "callAlias x = picture.render x",
        ), "useP"),
        imports: [{ module: "drawing", as: "picture" }],
      },
      // Projected references that spell bundle paths, cyclically.
      instanceBundle(
        "cyc",
        "loop : Pinger",
        "loop = Pinger { go = cyc.loop.go }",
        "one : Pinger",
        "one = Pinger { go = cyc.two.go }",
        "two : Pinger",
        "two = Pinger { go = cyc.one.go }",
      ),
    ]).evaluateContext();
  }, LONG);

  test("a function and an instance under one name: value position throws", () => {
    expect(() => evaluate(parse("twice.dup"), {}, small)).toThrow(/twice\.dup is ambiguous/);
  });

  test("…and every call position throws the same, before any function shortcut", () => {
    const ambiguous = /twice\.dup is ambiguous/;
    expect(() => evaluate(parse("twice.dup 1"), {}, small)).toThrow(ambiguous);
    expect(() => evaluate({ "twice.dup": [1] }, {}, small)).toThrow(ambiguous);
    expect(() => evaluate({ pipe: [1, "twice.dup"] }, {}, small)).toThrow(ambiguous);
    expect(() => evaluate({ apply: ["twice.dup", [1]] }, {}, small)).toThrow(ambiguous);
    expect(() => evaluate({ call: ["$", "twice.dup", 1] }, {}, small)).toThrow(ambiguous);
  });

  test("a qualified spelling the import frame also maps is still the member walk's: alias and own bundle", () => {
    // The lexical frames map `t.dup` (alias) and, inside `twice`, `twice.dup`
    // (own module) to the FUNCTION; the import rewriting must not discard the
    // qualified spelling before the walk sees the ambiguity.
    const ambiguous = /twice\.dup is ambiguous/;
    expect(() => evaluate({ call: ["useT:viaAlias", 1] }, {}, small)).toThrow(ambiguous);
    expect(() => evaluate({ call: ["twice:selfCall", 1] }, {}, small)).toThrow(ambiguous);
  });

  test("a cyclic chain of projected references is a clear error, never a stack overflow", () => {
    const unsettled = (path: string) => `${path}: the projected reference does not settle on a function`;
    // Selecting it performs nothing and stays a value.
    expect(Object.keys(evaluate(parse("cyc.loop.go"), {}, small) as object)).toEqual(["$ref"]);
    expect(() => evaluate(parse("cyc.loop.go 1"), {}, small)).toThrow(unsettled("cyc.loop.go"));
    expect(() => evaluate(parse("cyc.one.go 1"), {}, small)).toThrow(unsettled("cyc.one.go"));
    expect(() => evaluate(parse("1 |> cyc.loop.go"), {}, small)).toThrow(unsettled("cyc.loop.go"));
    expect(() => evaluate({ call: ["$", { var: "cyc.loop.go" }, 1] }, {}, small)).toThrow(unsettled("cyc.loop.go"));
  });

  test("a registered bundle wins over an in-scope `as` alias of the same name: value, call and pipe position", () => {
    // Inside `useP`, `picture` is both a registered bundle and the alias of
    // `drawing`; the REGISTERED bundle wins in every position, so the
    // interpreter agrees with the registry's source routing (registry.ts
    // ~4708 functions, ~4872 nominal types, ~5152 constructors: a registered
    // module head first, aliases only after `_moduleNames` misses), with
    // inference's member rows and with the durable runtime. Whether the alias
    // should shadow the global bundle lexically, or the collision be an error,
    // is Phase 5c's one-scope-stack decision (TODO.md, "An import alias named
    // like a registered bundle").
    const global = { $tag: "Shape", name: "global", size: 1 };
    expect(evaluate({ call: ["useP:callAlias", 1] }, {}, small)).toEqual(global);
    // In `useP`'s lexical frame: a pipe stage, a call, and value position.
    const inUseP: EvaluateContext = { ...small, _importStack: [small.getFunctionImportFrame!("useP:callAlias")!] };
    expect(evaluate({ pipe: [2, "picture.render"] }, {}, inUseP)).toEqual({ ...global, size: 2 });
    expect(evaluate(parse("picture.render 3"), {}, inUseP)).toEqual({ ...global, size: 3 });
    const read = evaluate(parse("picture.render"), {}, inUseP) as { $ref: string };
    expect(small.getFunction?.(read.$ref)?.id).toBe("picture:render");
    // Outside `useP` the same global bundle answers.
    expect(evaluate(parse("picture.render 4"), {}, small)).toEqual({ ...global, size: 4 });
    const outside = evaluate(parse("picture.render"), {}, small) as { $ref: string };
    expect(small.getFunction?.(outside.$ref)?.id).toBe("picture:render");
    // The alias still reaches `drawing` for a head no registered bundle owns:
    // `useT`'s `t.dup` (above) goes through the alias.
  });

  test("a selected reference performs nothing until it is called", () => {
    pings = 0;
    const go = evaluate(parse("pings.pinger.go"), {}, small) as { $ref: string };
    expect(Object.keys(go)).toEqual(["$ref"]);
    expect(small.getFunction?.(go.$ref)?.id).toBe("iox:ping");
    expect(evaluate(parse("pings.pinger"), {}, small)).toEqual({ $tag: "Pinger", go });
    expect(pings).toBe(0);
    expect(evaluate(parse("pings.pinger.go 3"), {}, small)).toBe(3);
    expect(pings).toBe(1);
    expect(evaluate(parse("4 |> pings.pinger.go"), {}, small)).toBe(4);
    expect(pings).toBe(2);
  });
});

// ===========================================================================
// (T) A type member's handle applied through a local: an error, never no value.
// ===========================================================================

describe("(T) a type handle applied through a local is an error, as in the durable runtime", () => {
  // `p5ty.Fetcher` is a type member: its value is a `{$ref}` handle (the type's
  // name in a lockless registry, its UUID in a locked one) that names no
  // function. Applied directly (`p5ty.Fetcher 1`) the walk refuses it; applied
  // through a local (`let t = p5ty.Fetcher in t 1`), a pipe, or as a literal
  // handle, the reference is consumed by `invokeFunction` and must be refused
  // the same way the durable runtime refuses it (`rtTypeHandleNotAFunction`),
  // never end in no value.
  const TYPES = src(
    "module p5ty where",
    "Fetcher = Fetcher go: (Number -> Number)",
    "same x = x",
  );
  const UUID = "5a5a5a5a-0f0f-4e4e-8d8d-0000000000a1";
  let lockless: ModuleRegistry;
  let locked: ModuleRegistry;
  beforeAll(() => {
    lockless = createRegistry([loadFenelModule(TYPES, "p5ty")]);
    // Type rows are keyed by their owner (per-owner type identity).
    locked = createRegistry([loadFenelModule(TYPES, "p5ty")], {
      codeNameLock: new Map([["type/module/p5ty/Fetcher", UUID]]),
    });
  }, LONG);

  // The registry's own full context carries the type facts
  // (`_entityNominalIdentity`, `getEntityNominalIdentity`'s answer, published
  // by `registry.ts` `evaluateContext()`): the product path, with no test help.
  const withTypeFacts = (r: ModuleRegistry): EvaluateContext => {
    const ctx = r.evaluateContext();
    expect(ctx._entityNominalIdentity?.("Fetcher")).toBe(r.getEntityNominalIdentity("Fetcher"));
    return ctx;
  };
  const LOCAL = { let: { t: { var: "p5ty.Fetcher" } } };
  const programs = (handle: string): Array<{ readonly program: unknown; readonly message: string }> => [
    // Statement position.
    { program: { do: [LOCAL, { call: [{ var: "t" }, 1] }] }, message: "t is a type value, not a function" },
    // A let value, then read.
    {
      program: { do: [LOCAL, { let: { r: { call: [{ var: "t" }, 1] } } }, { var: "r" }] },
      message: "t is a type value, not a function",
    },
    // Nested: an argument of another call.
    {
      program: { do: [LOCAL, { call: ["p5ty:same", { call: [{ var: "t" }, 1] }] }] },
      message: "t is a type value, not a function",
    },
    // Through a pipe and `$`: the reference itself is all the spelling there is.
    { program: { do: [LOCAL, { "|>": [1, { var: "t" }] }] }, message: `${handle} is a type value, not a function` },
    { program: { do: [LOCAL, { call: ["$", { var: "t" }, 1] }] }, message: `${handle} is a type value, not a function` },
    // A literal handle.
    { program: { call: [{ $ref: handle }, 1] }, message: `${handle} is a type value, not a function` },
  ];

  for (const [label, registry, handle] of [
    ["lockless (the name handle)", () => lockless, "Fetcher"],
    ["locked (the UUID handle)", () => locked, UUID],
  ] as const) {
    test(`${label}: statement and nested positions throw the durable runtime's message`, () => {
      const ctx = withTypeFacts(registry());
      expect(evaluate({ var: "p5ty.Fetcher" }, {}, ctx)).toEqual({ $ref: handle });
      for (const { program, message } of programs(handle)) {
        let thrown: string | undefined;
        try {
          evaluate(program, {}, ctx);
        } catch (error) {
          thrown = error instanceof Error ? error.message : String(error);
        }
        expect({ program, thrown }).toEqual({ program, thrown: message });
      }
    }, LONG);

    test(`${label}: a function reference applied through a local still runs`, () => {
      const ctx = withTypeFacts(registry());
      const F = { let: { f: { var: "p5ty.same" } } };
      expect(evaluate({ do: [F, { call: [{ var: "f" }, 1] }] }, {}, ctx)).toBe(1);
      expect(evaluate({ do: [F, { call: ["p5ty:same", { call: [{ var: "f" }, 2] }] }] }, {}, ctx)).toBe(2);
      expect(evaluate({ do: [F, { "|>": [3, { var: "f" }] }] }, {}, ctx)).toBe(3);
      expect(evaluate({ do: [F, { call: ["$", { var: "f" }, 4] }] }, {}, ctx)).toBe(4);
    }, LONG);

    test(`${label}: a context without the registry's type facts keeps the no-value exit`, () => {
      // `pureEvaluateContext` (the validator's door) and the empty context are
      // built from named slots and carry no type facts: a literal handle there
      // is still a name no function answers to, as before.
      const literal = { call: [{ $ref: handle }, 1] };
      expect(evaluate(literal, {}, pureEvaluateContext(withTypeFacts(registry())))).toBeNull();
      expect(evaluate(literal, {})).toBeNull();
    }, LONG);
  }
});
