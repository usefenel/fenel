// modules-as-values Phase 5a, slice E — projected members in the durable runtime
// (`workstreams/modules-as-values/briefs/phase-5a-named-members-by-dot.md`,
// settled design 4(c), amendment A3).
//
// A bundle-qualified dotted call head that projects a callable out of a named
// instance (`p5dio.fetcher.go "x"`, whose `go` field references an IO leaf) is
// normalised to the call it denotes BEFORE effect classification — in a
// statement head, a let value, an argument, a constructor payload — so the IO
// yields exactly once, at the referenced function's own action, and resumes.
// Selecting the reference performs nothing. The purity gate judges a projected
// reference (and a dotted function reference) by the function it names, so a
// body that hands one to `map` is no longer certified pure and inlined.
// `{var:"state.error"}` heads (the loader's shadowing form) are covered too.
import { beforeAll, describe, expect, it } from "bun:test";
import { dispatchRegistry, evaluate, invokeCallable, loadFenelModule, type EvaluateContext } from "@fenel/engine";
import { mintAuthority } from "@fenel/engine/authority";
import { createRegistry } from "@fenel/engine/registry";
import { stdModule } from "@fenel/engine/modules/std";
import { Nothing } from "@fenel/engine/type-foundation";
import type { FenelModule } from "@fenel/engine/types";
import { resumeAfterIO, turn, type EvalState, type TurnResult } from "./evaluator";
import { registerDispatchHandlers } from "./handlers/dispatch";

const LONG = 600_000;
const src = (...lines: string[]): string => lines.join("\n");

const instanceBundle = (bundle: string, ...lines: string[]): FenelModule => ({
  name: bundle,
  label: bundle,
  instances: loadFenelModule(src(...lines), bundle, { dispatchInstanceFile: true }).instances ?? [],
});

// `p5io.fetch` is a host-IO leaf (bodyless, its own action); `p5io.echo` is
// pure. `p5dio` is an instance file whose named instances hold references to
// them. `state` is a bundle whose `error` member is an IO leaf, to be shadowed.
const MODULES = (): FenelModule[] => [
  stdModule,
  loadFenelModule(src(
    "module p5types where",
    "Fetcher = Fetcher go: (String -> String)",
    "Noted = Noted go: (String -> String) note: String",
  ), "p5types"),
  loadFenelModule(src(
    "module p5io where",
    '@ioAction "p5io.fetch_action"',
    "@native",
    "fetch : String -> String",
    "echo : String -> String",
    "echo s = s",
  ), "p5io"),
  loadFenelModule(src(
    "module state where",
    '@ioAction "p5state.error_action"',
    "@native",
    "error : String -> String",
  ), "state"),
  instanceBundle(
    "p5dio",
    "fetcher : Fetcher",
    "fetcher = Fetcher { go = p5io.fetch }",
    "echoer : Fetcher",
    "echoer = Fetcher { go = p5io.echo }",
    // A data field beside a method: pure, and beside an IO reference.
    "noted : Noted",
    'noted = Noted { go = p5io.echo, note = "n" }',
    "notedIO : Noted",
    'notedIO = Noted { go = p5io.fetch, note = "io" }',
    // A method that is an effectful LAMBDA, not a reference.
    "lam : Fetcher",
    "lam = Fetcher { go = \\x -> p5io.fetch x }",
  ),
  loadFenelModule(src(
    "module p5use where",
    "wrap : String -> List String",
    "wrap s = [s]",
    "keep a b = a",
    "pair : String -> String -> List String",
    "pair a b = [a, b]",
    'isA s t = s == "a"',
    "readsNote : String -> List String",
    "readsNote s = pair s p5dio.noted.note",
    "mapFetch : List String -> List String",
    "mapFetch xs = map p5dio.fetcher.go xs",
    "mapFetchDirect : List String -> List String",
    "mapFetchDirect xs = map p5io.fetch xs",
    "mapEcho : List String -> List String",
    "mapEcho xs = map p5dio.echoer.go xs",
  ), "p5use"),
  // `selfCall` spells its own bundle's ambiguous member (the lexical frame maps
  // `twice.dup`, an own-module entry, to the function); `p5alias` reaches it
  // through an `as` alias (on the module value: the import grammar reads
  // uppercase module names only), which its frame also maps to the function.
  loadFenelModule(src("module twice where", "dup s = s", "selfCall : String -> String", "selfCall s = twice.dup s"), "twice"),
  instanceBundle("twice", "dup : Fetcher", "dup = Fetcher { go = p5io.echo }"),
  {
    ...loadFenelModule(src("module p5alias where", "viaAlias : String -> String", "viaAlias s = t.dup s"), "p5alias"),
    imports: [{ module: "twice", as: "t" }],
  },
  // A projected reference that spells its own bundle path.
  instanceBundle("cyc", "loop : Fetcher", "loop = Fetcher { go = cyc.loop.go }"),
  // Uppercase bundles: the parser emits `{method:[Bundle, member, …args]}`.
  loadFenelModule(src(
    "module P5Fn where",
    '@ioAction "p5fn.fetch_action"',
    "@native",
    "fetch : String -> String",
    "echo : String -> String",
    "echo s = s",
  ), "P5Fn"),
  instanceBundle(
    "P5Inst",
    "fetcher : Fetcher",
    "fetcher = Fetcher { go = p5io.fetch }",
    "echoer : Fetcher",
    "echoer = Fetcher { go = p5io.echo }",
  ),
  loadFenelModule(src("module P5Twice where", "dup s = s"), "P5Twice"),
  instanceBundle("P5Twice", "dup : Fetcher", "dup = Fetcher { go = p5io.echo }"),
  // Ten pure functions, each calling the next through a dotted spelling.
  dottedChain("p5chainA"),
  dottedChain("p5chainB"),
  // A global bundle `picture` and a module that imports another bundle AS
  // `picture` (on the module value: the import grammar reads uppercase module
  // names only): inside `p5usepic`, the REGISTERED bundle still wins.
  loadFenelModule(src("module picture where", "render : String -> List String", "render s = [s]"), "picture"),
  loadFenelModule(src("module p5draw where", "render : String -> String", "render s = s"), "p5draw"),
  {
    ...loadFenelModule(src(
      "module p5usepic where",
      "viaPicture : String -> String",
      "viaPicture s = picture.render s",
    ), "p5usepic"),
    imports: [{ module: "p5draw", as: "picture" }],
  },
  // Named functions that apply a class method (`{method:[Class, get, x]}`);
  // the two classes are defined by the class-method describe below.
  loadFenelModule(src(
    "module p5probeuse where",
    "viaClassIO : Number -> Number",
    "viaClassIO x = std.add 1 (ProbeFetch5a.get x)",
    "viaClassPure : Number -> Number",
    "viaClassPure x = std.add 1 (ProbePure5a.get x)",
  ), "p5probeuse"),
  // TS fix re-review (astra C2) fixtures. A named function whose body
  // overrides the pure `ProbeScope5a` instance locally with an IO leaf
  // (`withLocalOverride`); `go` imported from a pure and from an IO module; a
  // class method whose instance calls another class's method; a callable
  // factory applied by `|>`.
  withLocalOverride(),
  loadFenelModule(src("module p5cachep where", "go : Number -> Number", "go x = 5"), "p5cachep"),
  loadFenelModule(src(
    "module p5cacheio where",
    '@ioAction "p5cacheio.go_action"',
    "@native",
    "go : Number -> Number",
  ), "p5cacheio"),
  {
    ...loadFenelModule(src("module p5cacheusep where", "anchor : Number -> Number", "anchor x = x"), "p5cacheusep"),
    imports: [{ module: "p5cachep", names: ["go"] }],
  },
  {
    ...loadFenelModule(src("module p5cacheuseio where", "anchor : Number -> Number", "anchor x = x"), "p5cacheuseio"),
    imports: [{ module: "p5cacheio", names: ["go"] }],
  },
  loadFenelModule(src("module p5cacheab where", "viaB : Number -> Number", "viaB x = CacheB5a.get x"), "p5cacheab"),
  loadFenelModule(src(
    "module p5take where",
    "takeGo : Fetcher -> (String -> String)",
    "takeGo r = r.go",
    "pipeApply : Fetcher -> String -> String",
    "pipeApply r x = x |> takeGo r",
  ), "p5take"),
];

/** The block frame `withLocalOverride` and the callback tests install: the
 *  pure class `ProbeScope5a`'s `get` replaced by the IO leaf `p5io.fetch`. */
const LOCAL_OVERRIDE = { typeName: "ProbeScope5a", args: ["Number"], methods: { get: { $ref: "p5io:fetch" } } };

/** `viaOverride x = withInstance { ProbeScope5a Number: get = p5io.fetch } (std.add 1
 *  (ProbeScope5a.get x))`: the surface has no spelling for a general
 *  `withInstance` (only the evaluator-strategy blocks), so the loaded body is
 *  wrapped. */
function withLocalOverride(): FenelModule {
  const mod = loadFenelModule(src(
    "module p5scope where",
    "viaOverride : Number -> Number",
    "viaOverride x = std.add 1 (ProbeScope5a.get x)",
  ), "p5scope");
  const fn = (mod.functions ?? []).find((candidate) => candidate.id === "p5scope:viaOverride")!;
  fn.body = { withInstance: [LOCAL_OVERRIDE, fn.body] } as never;
  return mod;
}

function dottedChain(bundle: string): FenelModule {
  const lines = [`module ${bundle} where`, "f10 s = s"];
  for (let i = 9; i >= 1; i--) lines.push(`f${i} s = ${bundle}.f${i + 1} s`);
  return loadFenelModule(src(...lines), bundle);
}

type Registry = ReturnType<typeof createRegistry>;
let reg: Registry;

beforeAll(() => {
  const modules = MODULES();
  reg = createRegistry(modules);
  // The runtime reads a leaf's `@ioAction` from the process dispatch registry
  // (`getIOAction`), which only the system modules seed: register the two
  // fixture leaves' rows, so an action names the function whatever spelling
  // reached it.
  for (const mod of modules) {
    for (const inst of mod.instances ?? []) {
      if (inst.typeName === "IOInvokable") dispatchRegistry.addInstance({ ...inst, scope: { kind: "global" } });
    }
  }
}, LONG);

function authority(registry: Registry) {
  return mintAuthority(registry, {
    envelope: registry.evaluateAuthorityFunction(
      "authority:descriptorEnvelope",
      [registry.listPerformDescriptors()],
    ),
    issuer: "test",
    accountId: "mav5a-durable",
    principal: null,
    lane: null,
    grant: null,
    mintedAt: 0,
  });
}

const state = (exprs: unknown[], env: Record<string, unknown> = {}): EvalState =>
  ({ stack: [{ exprs, index: 0 }], env, letTarget: Nothing });
/** A durable checkpoint is JSON. */
const checkpoint = (value: EvalState): EvalState => JSON.parse(JSON.stringify(value));
const run = (exprs: unknown[], env: Record<string, unknown> = {}): TurnResult => turn(state(exprs, env), reg, authority(reg));
/** A turn inside a function's lexical scope (its import frame). */
const runIn = (functionId: string, exprs: unknown[]): TurnResult =>
  turn(state(exprs), reg, authority(reg), functionId);
const resume = (result: TurnResult, value: unknown): TurnResult => {
  if (result.outcome !== "io") throw new Error(`expected an io outcome, got ${result.outcome}`);
  return resumeAfterIO(checkpoint(result.state), value, reg, authority(reg));
};
const FETCH = "p5io.fetch_action";
const action = (result: TurnResult): string | undefined =>
  result.outcome === "io" ? result.request.action : undefined;

describe("a projected IO reference, called, yields once at its target and resumes", () => {
  it("a statement head: the same action and params as calling the leaf directly", () => {
    const direct = run([{ call: ["p5io.fetch", "x"] }]);
    expect(action(direct)).toBe(FETCH);
    const projected = run([{ call: ["p5dio.fetcher.go", "x"] }]);
    expect(action(projected)).toBe(FETCH);
    if (projected.outcome !== "io" || direct.outcome !== "io") return;
    expect(projected.request.params).toEqual(direct.request.params);
    expect(resume(projected, "fetched")).toMatchObject({ outcome: "done", value: "fetched" });
  }, LONG);

  it("a let value", () => {
    const first = run([{ let: { r: { call: ["p5dio.fetcher.go", "x"] } } }, { var: "r" }]);
    expect(action(first)).toBe(FETCH);
    expect(resume(first, "fetched")).toMatchObject({ outcome: "done", value: "fetched" });
  }, LONG);

  it("nested in an argument: hoisted, yielded once, then the pure outer call runs", () => {
    const first = run([{ call: ["p5use:wrap", { call: ["p5dio.fetcher.go", "x"] }] }]);
    expect(action(first)).toBe(FETCH);
    expect(resume(first, "fetched")).toMatchObject({ outcome: "done", value: ["fetched"] });
  }, LONG);

  it("nested in a constructor payload", () => {
    const first = run([{ construct: ["Just", { call: ["p5dio.fetcher.go", "x"] }] }]);
    expect(action(first)).toBe(FETCH);
    expect(resume(first, "fetched")).toMatchObject({ outcome: "done", value: { $tag: "Just", _0: "fetched" } });
  }, LONG);

  it("selecting the reference performs nothing; applying the selected value yields", () => {
    const selected = run([{ let: { g: { var: "p5dio.fetcher.go" } } }, { var: "g" }]);
    expect(selected.outcome).toBe("done");
    if (selected.outcome !== "done") return;
    expect(reg.getFunction((selected.value as { $ref: string }).$ref)?.id).toBe("p5io:fetch");
    const applied = run([{ let: { g: { var: "p5dio.fetcher.go" } } }, { call: [{ var: "g" }, "x"] }]);
    expect(action(applied)).toBe(FETCH);
    expect(resume(applied, "fetched")).toMatchObject({ outcome: "done", value: "fetched" });
  }, LONG);

  it("a projected pure reference runs inline, no yield", () => {
    expect(run([{ call: ["p5dio.echoer.go", "x"] }])).toMatchObject({ outcome: "done", value: "x" });
  }, LONG);

  it("an if condition or chosen branch, a case scrutinee or chosen arm: the target's own action", () => {
    const fetchX = { call: ["p5dio.fetcher.go", "x"] };
    const cond = run([{ if: [fetchX, "yes", "no"] }]);
    expect(action(cond)).toBe(FETCH);
    expect(resume(cond, true)).toMatchObject({ outcome: "done", value: "yes" });
    const branch = run([{ if: [true, fetchX, "no"] }]);
    expect(action(branch)).toBe(FETCH);
    expect(resume(branch, "fetched")).toMatchObject({ outcome: "done", value: "fetched" });
    const scrutinee = run([{ match: [fetchX, "fetched", "hit", "miss"] }]);
    expect(action(scrutinee)).toBe(FETCH);
    expect(resume(scrutinee, "fetched")).toMatchObject({ outcome: "done", value: "hit" });
    const arm = run([{ match: ["a", "a", fetchX, "miss"] }]);
    expect(action(arm)).toBe(FETCH);
    expect(resume(arm, "fetched")).toMatchObject({ outcome: "done", value: "fetched" });
    // An ambiguous head in those positions is an error outcome, never a yield.
    for (const program of [
      { if: [{ call: ["twice.dup", "x"] }, "yes", "no"] },
      { if: [true, { call: ["twice.dup", "x"] }, "no"] },
      { match: [{ call: ["twice.dup", "x"] }, "x", "hit", "miss"] },
      { match: ["a", "a", { call: ["twice.dup", "x"] }, "miss"] },
    ]) {
      const result = run([program]);
      expect({ program, outcome: result.outcome }).toEqual({ program, outcome: "error" });
      if (result.outcome === "error") expect(result.error).toMatch(/twice\.dup is ambiguous/);
    }
  }, LONG);
});

describe("what a projected head cannot be is an error outcome, never a yield to a made-up action", () => {
  it("a name bound to a function and an instance in one bundle", () => {
    const result = run([{ call: ["twice.dup", "x"] }]);
    expect(result.outcome).toBe("error");
    if (result.outcome === "error") expect(result.error).toMatch(/twice\.dup is ambiguous/);
  }, LONG);

  it("an instance value applied", () => {
    const result = run([{ call: ["p5dio.fetcher", "x"] }]);
    expect(result.outcome).toBe("error");
    if (result.outcome === "error") expect(result.error).toBe("p5dio.fetcher is an instance value, not a function");
  }, LONG);
});

describe("{var:\"state.error\"} heads — the loader's shadowing form", () => {
  it("unbound, the string head reaches the state bundle's IO member", () => {
    expect(action(run([{ call: ["state.error", "x"] }]))).toBe("p5state.error_action");
  }, LONG);

  it("a local state record whose error field is pure: applied inline, no yield", () => {
    const local = { state: { error: { $ref: "p5use:wrap" } } };
    expect(run([{ call: [{ var: "state.error" }, "x"] }], local)).toMatchObject({ outcome: "done", value: ["x"] });
  }, LONG);

  it("a local state record whose error field is an IO reference: yields at that reference, resumes", () => {
    const local = { state: { error: { $ref: "p5io:fetch" } } };
    const first = run([{ call: [{ var: "state.error" }, "x"] }], local);
    expect(action(first)).toBe(FETCH);
    expect(resume(first, "fetched")).toMatchObject({ outcome: "done", value: "fetched" });
  }, LONG);
});

describe("the purity gate judges a projected reference by the function it names", () => {
  it("map over a projected IO reference is not certified pure: the body runs durably", () => {
    const result = run([{ call: ["p5use:mapFetch", ["x"]] }]);
    expect(action(result)).toBe("p5use:mapFetch");
  }, LONG);

  it("map over a dotted function reference (two segments) is not certified pure either", () => {
    const result = run([{ call: ["p5use:mapFetchDirect", ["x"]] }]);
    expect(action(result)).toBe("p5use:mapFetchDirect");
  }, LONG);

  it("map over a projected pure reference stays inline", () => {
    expect(run([{ call: ["p5use:mapEcho", ["x", "y"]] }])).toMatchObject({ outcome: "done", value: ["x", "y"] });
  }, LONG);
});

// ---------------------------------------------------------------------------
// Review fixes (2026-10-02): each case below failed before its fix.
// ---------------------------------------------------------------------------

describe("a qualified spelling the import frame also maps is still the member walk's", () => {
  it("an alias call head (`t.dup`, the frame maps it to the function) is ambiguous", () => {
    const result = runIn("p5alias:viaAlias", [{ call: ["t.dup", "x"] }]);
    expect(result.outcome).toBe("error");
    if (result.outcome === "error") expect(result.error).toMatch(/twice\.dup is ambiguous/);
  }, LONG);

  it("the bundle's own spelling inside its own module (`twice.dup` in `twice`) is ambiguous", () => {
    const result = runIn("twice:selfCall", [{ call: ["twice.dup", "x"] }]);
    expect(result.outcome).toBe("error");
    if (result.outcome === "error") expect(result.error).toMatch(/twice\.dup is ambiguous/);
  }, LONG);

  it("a body that calls the ambiguous alias spelling is not certified pure", () => {
    expect(action(run([{ call: ["p5alias:viaAlias", "x"] }]))).toBe("p5alias:viaAlias");
  }, LONG);
});

describe("a captured record's field is checked, not trusted, by the closure purity gate", () => {
  const nestedMap = (head: unknown) =>
    ({ call: ["map", { fn: ["x", { call: ["map", head, [{ var: "x" }]] }] }, ["x"]] });

  it("map over a lambda applying h.go, with h = p5dio.fetcher, routes the outer map durably", () => {
    const result = run([{ let: { h: { var: "p5dio.fetcher" } } }, nestedMap({ var: "h.go" })]);
    expect(result.outcome).toBe("io");
    expect(action(result)).toBe(reg.getFunction("map")?.id);
  }, LONG);

  it("a captured record whose field is pure stays inline", () => {
    expect(run([{ let: { h: { var: "p5dio.echoer" } } }, nestedMap({ var: "h.go" })]))
      .toMatchObject({ outcome: "done", value: [["x"]] });
  }, LONG);

  it("a captured root shadows the bundle even when its projection misses (a plain data read)", () => {
    // `p5dio` is captured as a local record without `fetcher`: the read is a
    // miss, never the bundle's IO reference, so nothing yields.
    expect(run([nestedMap({ var: "p5dio.fetcher.go" })], { p5dio: { other: 1 } }).outcome).toBe("done");
  }, LONG);
});

describe("an indirect call head nested in an argument or payload yields once at its target", () => {
  const LOCAL = { let: { h: { var: "p5dio.fetcher" } } };

  it("a dotted {var} head in an argument (`p5use.wrap (h.go \"x\")`)", () => {
    const first = run([LOCAL, { call: ["p5use:wrap", { call: [{ var: "h.go" }, "x"] }] }]);
    expect(action(first)).toBe(FETCH);
    expect(resume(first, "fetched")).toMatchObject({ outcome: "done", value: ["fetched"] });
  }, LONG);

  it("a dotted {var} head in a constructor payload", () => {
    const first = run([LOCAL, { construct: ["Just", { call: [{ var: "h.go" }, "x"] }] }]);
    expect(action(first)).toBe(FETCH);
    expect(resume(first, "fetched")).toMatchObject({ outcome: "done", value: { $tag: "Just", _0: "fetched" } });
  }, LONG);

  it("a dotless {var} head bound to an IO reference, in an argument (the pre-Phase-5a shape)", () => {
    const first = run([{ call: ["p5use:wrap", { call: [{ var: "g" }, "x"] }] }], { g: { $ref: "p5io:fetch" } });
    expect(action(first)).toBe(FETCH);
    expect(resume(first, "fetched")).toMatchObject({ outcome: "done", value: ["fetched"] });
  }, LONG);

  it("a literal {$ref} head that spells a bundle path: a statement, a let value, an argument", () => {
    const head = { $ref: "p5dio.fetcher.go" };
    const statement = run([{ call: [head, "x"] }]);
    expect(action(statement)).toBe(FETCH);
    expect(resume(statement, "fetched")).toMatchObject({ outcome: "done", value: "fetched" });
    const bound = run([{ let: { r: { call: [head, "x"] } } }, { var: "r" }]);
    expect(action(bound)).toBe(FETCH);
    expect(resume(bound, "fetched")).toMatchObject({ outcome: "done", value: "fetched" });
    const nested = run([{ call: ["p5use:wrap", { call: [head, "x"] }] }]);
    expect(action(nested)).toBe(FETCH);
    expect(resume(nested, "fetched")).toMatchObject({ outcome: "done", value: ["fetched"] });
  }, LONG);

  it("a literal {$ref} head naming an IO function, nested in an argument", () => {
    const first = run([{ call: ["p5use:wrap", { call: [{ $ref: "p5io:fetch" }, "x"] }] }]);
    expect(action(first)).toBe(FETCH);
    expect(resume(first, "fetched")).toMatchObject({ outcome: "done", value: ["fetched"] });
  }, LONG);

  it("a pure indirect head nested in an argument still runs inline", () => {
    expect(run([{ let: { h: { var: "p5dio.echoer" } } }, { call: ["p5use:wrap", { call: [{ var: "h.go" }, "x"] }] }]))
      .toMatchObject({ outcome: "done", value: ["x"] });
  }, LONG);
});

describe("a miss past an existing bundle member is the interpreter's no-value, never an IO request", () => {
  const interpreted = (expr: unknown): unknown => evaluate(expr as never, {}, reg.evaluateContext());

  it("a field miss, a projection past a reference, a projection past a function: every position", () => {
    for (const head of ["p5dio.fetcher.ghost", "p5dio.fetcher.go.inner", "p5io.fetch.inner"]) {
      const call = { call: [head, "x"] };
      expect(interpreted(call)).toBeNull();
      expect(run([call])).toMatchObject({ outcome: "done", value: null });
      expect(run([{ let: { r: call } }, { var: "r" }])).toMatchObject({ outcome: "done", value: null });
      expect(run([{ call: ["p5use:wrap", call] }])).toMatchObject({ outcome: "done", value: [null] });
    }
  }, LONG);

  it("an unrecognised head, and a bundle WITHOUT the member, keep the late-bound IO routing", () => {
    // A registered late-bound action name may share a bundle's prefix
    // (`audit.effect` in durable-runtime-regressions): only a miss past an
    // existing member is certainly a member path.
    expect(action(run([{ call: ["nobundle.thing", "x"] }]))).toBe("nobundle.thing");
    expect(action(run([{ call: ["p5dio.ghost", "x"] }]))).toBe("p5dio.ghost");
  }, LONG);
});

describe("a cyclic projected reference is an error outcome", () => {
  it("statement and nested positions", () => {
    const unsettled = "cyc.loop.go: the projected reference does not settle on a function";
    expect(run([{ call: ["cyc.loop.go", "x"] }])).toMatchObject({ outcome: "error", error: unsettled });
    expect(run([{ call: ["p5use:wrap", { call: ["cyc.loop.go", "x"] }] }]))
      .toMatchObject({ outcome: "error", error: unsettled });
  }, LONG);
});

describe("uppercase {method:[Bundle, member, …]} heads are classified as the call they denote", () => {
  it("a function member that is an IO leaf yields: a statement, a let value, an argument", () => {
    const call = { method: ["P5Fn", "fetch", "x"] };
    const statement = run([call]);
    expect(action(statement)).toBe("p5fn.fetch_action");
    expect(resume(statement, "fetched")).toMatchObject({ outcome: "done", value: "fetched" });
    const bound = run([{ let: { r: call } }, { var: "r" }]);
    expect(action(bound)).toBe("p5fn.fetch_action");
    expect(resume(bound, "fetched")).toMatchObject({ outcome: "done", value: "fetched" });
    const nested = run([{ call: ["p5use:wrap", call] }]);
    expect(action(nested)).toBe("p5fn.fetch_action");
    expect(resume(nested, "fetched")).toMatchObject({ outcome: "done", value: ["fetched"] });
  }, LONG);

  it("a pure function member runs inline; a bare member is its value, performing nothing", () => {
    expect(run([{ method: ["P5Fn", "echo", "x"] }])).toMatchObject({ outcome: "done", value: "x" });
    const selected = run([{ let: { g: { method: ["P5Fn", "fetch"] } } }, { var: "g" }]);
    expect(selected.outcome).toBe("done");
  }, LONG);

  it("an instance applied and an ambiguous member are error outcomes", () => {
    expect(run([{ method: ["P5Inst", "fetcher", "x"] }]))
      .toMatchObject({ outcome: "error", error: "P5Inst.fetcher is an instance value, not a function" });
    const ambiguous = run([{ call: ["p5use:wrap", { method: ["P5Twice", "dup", "x"] }] }]);
    expect(ambiguous.outcome).toBe("error");
    if (ambiguous.outcome === "error") expect(ambiguous.error).toMatch(/P5Twice\.dup is ambiguous/);
  }, LONG);
});

// ---------------------------------------------------------------------------
// Final-review fixes (2026-10-02): each case below failed before its fix.
// ---------------------------------------------------------------------------

describe("the purity gate's READ channels: reading a non-callable bundle value is not an effect", () => {
  const lambda = (param: string, body: unknown) => ({ fn: [param, body] });
  const mapOver = (body: unknown) => ({ call: ["map", lambda("x", body), ["a", "b"]] });
  const keepWith = (path: string) => mapOver({ call: ["p5use:keep", { var: "x" }, { var: path }] });

  it("a lambda reading a type member, passed to map and to filter, runs inline", () => {
    expect(run([keepWith("p5types.Fetcher")])).toMatchObject({ outcome: "done", value: ["a", "b"] });
    const filtered = run([{
      call: ["filter", lambda("u", { call: ["p5use:isA", { var: "u" }, { var: "p5types.Fetcher" }] }), ["a", "b"]],
    }]);
    expect(filtered).toMatchObject({ outcome: "done", value: ["a"] });
  }, LONG);

  it("a lambda reading a pure instance value runs inline", () => {
    expect(run([keepWith("p5dio.echoer")])).toMatchObject({ outcome: "done", value: ["a", "b"] });
  }, LONG);

  it("a lambda reading a data field of an instance runs inline, beside a pure or an IO method", () => {
    const pairWith = (path: string) => mapOver({ call: ["p5use:pair", { var: "x" }, { var: path }] });
    expect(run([pairWith("p5dio.noted.note")])).toMatchObject({ outcome: "done", value: [["a", "n"], ["b", "n"]] });
    expect(run([pairWith("p5dio.notedIO.note")])).toMatchObject({ outcome: "done", value: [["a", "io"], ["b", "io"]] });
  }, LONG);

  it("a function body reading a data field is certified pure (the computeBodyPure channel)", () => {
    expect(run([{ call: ["p5use:readsNote", "x"] }])).toMatchObject({ outcome: "done", value: ["x", "n"] });
  }, LONG);

  it("a lambda reading a record that holds an IO reference is still not certified pure", () => {
    const mapId = reg.getFunction("map")?.id;
    for (const path of ["p5dio.fetcher", "p5dio.notedIO"]) {
      const result = run([keepWith(path)]);
      expect({ path, action: action(result) }).toEqual({ path, action: mapId });
    }
  }, LONG);

  it("a bare uppercase bundle member is a read too: pure inline, IO-holding not certified", () => {
    const keepMember = (member: string) =>
      mapOver({ call: ["p5use:keep", { var: "x" }, { method: ["P5Inst", member] }] });
    expect(run([keepMember("echoer")])).toMatchObject({ outcome: "done", value: ["a", "b"] });
    expect(action(run([keepMember("fetcher")]))).toBe(reg.getFunction("map")?.id);
  }, LONG);
});

describe("an effectful LAMBDA method applied through a local is never a silent null", () => {
  const LOCAL = { let: { h: { var: "p5dio.lam" } } };
  const apply = { call: [{ var: "h.go" }, "x"] };
  const fence = /Indirect application of an effectful closure is not durably steppable/;

  for (const [position, program] of [
    ["a statement", [LOCAL, apply]],
    ["an argument", [LOCAL, { call: ["p5use:wrap", apply] }]],
    ["a constructor payload", [LOCAL, { construct: ["Just", apply] }]],
  ] as const) {
    it(position, () => {
      const result = run([...program]);
      expect(result.outcome).toBe("error");
      if (result.outcome === "error") expect(result.error).toMatch(fence);
    }, LONG);
  }
});

describe("the projection cap counts projected values only, never plain qualified calls", () => {
  const all = (bundle: string, order: number[]) => {
    const seen: Array<[string, string]> = [];
    for (const i of order) {
      const result = run([{ call: [`${bundle}:f${i}`, "x"] }]);
      seen.push([`f${i}`, result.outcome]);
    }
    return seen;
  };
  const DOWN = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const UP = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

  it("a ten-deep dotted chain of pure functions is inline-safe, whichever end the walk starts from", () => {
    expect(all("p5chainA", DOWN)).toEqual(DOWN.map((i) => [`f${i}`, "done"]));
    expect(all("p5chainB", UP)).toEqual(UP.map((i) => [`f${i}`, "done"]));
  }, LONG);
});

describe("a type member's handle applied through a local is an error, never an IO request", () => {
  it("unlocked registry (the name handle): a statement, an argument, a literal handle", () => {
    const handle = run([{ var: "p5types.Fetcher" }]);
    expect(handle.outcome).toBe("done");
    const notAFunction = /is a type value, not a function/;
    for (const program of [
      [{ let: { t: { var: "p5types.Fetcher" } } }, { call: [{ var: "t" }, "x"] }],
      [{ let: { t: { var: "p5types.Fetcher" } } }, { let: { r: { call: [{ var: "t" }, "x"] } } }, { var: "r" }],
      [{ let: { t: { var: "p5types.Fetcher" } } }, { call: ["p5use:wrap", { call: [{ var: "t" }, "x"] }] }],
      [{ call: [(handle as { value: unknown }).value, "x"] }],
    ]) {
      const result = run(program);
      expect({ program, outcome: result.outcome, action: action(result) })
        .toEqual({ program, outcome: "error", action: undefined });
      if (result.outcome === "error") expect(result.error).toMatch(notAFunction);
    }
  }, LONG);

  it("locked registry (the UUID handle): an error outcome, no IO yield", () => {
    // A partial lock: only the type `Fetcher` has an identity, so its member
    // value is `{$ref: <uuid>}`, a handle that is no function's.
    const uuid = "5a5a5a5a-0f0f-4e4e-8d8d-000000000004";
    // Type rows are keyed by their owner (per-owner type identity).
    const locked = createRegistry(MODULES(), { codeNameLock: new Map([["type/module/p5types/Fetcher", uuid]]) });
    const runLocked = (exprs: unknown[]): TurnResult => turn(state(exprs), locked, authority(locked));
    expect(runLocked([{ var: "p5types.Fetcher" }])).toMatchObject({ outcome: "done", value: { $ref: uuid } });
    const LOCAL = { let: { t: { var: "p5types.Fetcher" } } };
    for (const program of [
      [LOCAL, { call: [{ var: "t" }, "x"] }],
      [LOCAL, { call: ["p5use:wrap", { call: [{ var: "t" }, "x"] }] }],
      [{ call: [{ $ref: uuid }, "x"] }],
    ]) {
      const result = runLocked(program);
      expect({ program, outcome: result.outcome, action: action(result) })
        .toEqual({ program, outcome: "error", action: undefined });
      if (result.outcome === "error") expect(result.error).toMatch(/is a type value, not a function/);
    }
  }, LONG);
});

describe("a type handle applied through a local: the interpreter and the durable runtime agree", () => {
  // The same statement lists, run by the durable runtime (an error outcome)
  // and by the interpreter as a `do` block (a throw), with the same message.
  // The interpreter reads the registry's type facts from the context
  // (`_entityNominalIdentity`); `registry.ts` `evaluateContext()` is to
  // publish that slot itself, and until it does the test supplies exactly
  // the registry's own answer, the fact the durable runtime reads directly.
  const withTypeFacts = (r: Registry): EvaluateContext => ({
    ...r.evaluateContext(),
    _entityNominalIdentity: (nameOrId: string) => r.getEntityNominalIdentity(nameOrId),
  });
  const LOCAL = { let: { t: { var: "p5types.Fetcher" } } };
  const programs = (handle: string): Array<{ readonly program: unknown[]; readonly message: string }> => [
    { program: [LOCAL, { call: [{ var: "t" }, "x"] }], message: "t is a type value, not a function" },
    {
      program: [LOCAL, { let: { r: { call: [{ var: "t" }, "x"] } } }, { var: "r" }],
      message: "t is a type value, not a function",
    },
    { program: [LOCAL, { call: ["p5use:wrap", { call: [{ var: "t" }, "x"] }] }], message: "t is a type value, not a function" },
    { program: [{ call: [{ $ref: handle }, "x"] }], message: `${handle} is a type value, not a function` },
  ];
  const interpreted = (program: unknown[], ctx: EvaluateContext): { thrown?: string; value?: unknown } => {
    try {
      return { value: evaluate({ do: program }, {}, ctx) };
    } catch (error) {
      return { thrown: error instanceof Error ? error.message : String(error) };
    }
  };
  const UUID = "5a5a5a5a-0f0f-4e4e-8d8d-000000000005";

  for (const [label, build, handle] of [
    ["unlocked registry (the name handle)", () => reg, "Fetcher"],
    ["locked registry (the UUID handle)", () => createRegistry(MODULES(), { codeNameLock: new Map([["type/module/p5types/Fetcher", UUID]]) }), UUID],
  ] as const) {
    it(`${label}: an error outcome and a throw, one message, statement and nested positions`, () => {
      const registry = build();
      const ctx = withTypeFacts(registry);
      for (const { program, message } of programs(handle)) {
        const durable = turn(state(program), registry, authority(registry));
        expect({ program, outcome: durable.outcome, action: action(durable) })
          .toEqual({ program, outcome: "error", action: undefined });
        if (durable.outcome === "error") expect({ program, error: durable.error }).toEqual({ program, error: message });
        expect({ program, ...interpreted(program, ctx) }).toEqual({ program, thrown: message });
      }
    }, LONG);

    it(`${label}: a function reference applied through a local still runs in both`, () => {
      const registry = build();
      const ctx = withTypeFacts(registry);
      const F = { let: { f: { var: "p5io.echo" } } };
      for (const program of [
        [F, { call: [{ var: "f" }, "x"] }],
        [F, { call: ["p5use:wrap", { call: [{ var: "f" }, "x"] }] }],
      ]) {
        const durable = turn(state(program), registry, authority(registry));
        expect(durable.outcome).toBe("done");
        if (durable.outcome !== "done") continue;
        expect(interpreted(program, ctx)).toEqual({ value: durable.value });
      }
      expect(interpreted([F, { call: [{ var: "f" }, "x"] }], ctx)).toEqual({ value: "x" });
    }, LONG);
  }
});

// The registered bundle wins over an in-scope `as` alias of the same name, in
// every position, so the durable runtime agrees with the interpreter, with the
// registry's source routing (registry.ts ~4708 functions, ~4872 nominal types,
// ~5152 constructors: a registered module head first, aliases only after
// `_moduleNames` misses) and with inference's member rows. Whether the alias
// should shadow the bundle lexically, or the collision be an error, is Phase
// 5c's one-scope-stack decision (TODO.md, "An import alias named like a
// registered bundle").
describe("a registered bundle wins over an in-scope `as` alias of the same name", () => {
  it("call position inside the importing function: the registered bundle's member", () => {
    expect(run([{ call: ["p5usepic:viaPicture", "x"] }])).toMatchObject({ outcome: "done", value: ["x"] });
    expect(runIn("p5usepic:viaPicture", [{ call: ["picture.render", "x"] }]))
      .toMatchObject({ outcome: "done", value: ["x"] });
    expect(runIn("p5usepic:viaPicture", [{ let: { r: { call: ["picture.render", "y"] } } }, { var: "r" }]))
      .toMatchObject({ outcome: "done", value: ["y"] });
  }, LONG);

  it("value position inside the importing function: the registered bundle's member", () => {
    const selected = runIn("p5usepic:viaPicture", [{ var: "picture.render" }]);
    expect(selected.outcome).toBe("done");
    if (selected.outcome !== "done") return;
    expect(reg.getFunction((selected.value as { $ref: string }).$ref)?.id).toBe("picture:render");
  }, LONG);

  it("outside the alias's scope the same registered bundle answers", () => {
    expect(run([{ call: ["picture.render", "x"] }])).toMatchObject({ outcome: "done", value: ["x"] });
  }, LONG);
});

// ---------------------------------------------------------------------------
// TS fix (2026-10-02, astra 5c review item 6): a lambda whose call head is a
// dotted `{var}` bundle path. The closure gate marked every dotted var head
// opaque, so a pure `\x -> std.add x 1` handed to a higher-order function was
// never inline-safe and its HOF routed to the Fenel body (where applying the
// closure is the "not durably steppable" fence), while the interpreter
// returned the value. The head is now resolved by the rule dotted READS use:
// a root bound by the lambda (or captured) stays opaque; a bundle path is
// judged by what it denotes.
// ---------------------------------------------------------------------------

describe("a lambda whose call head is a dotted bundle path: the closure gate resolves it", () => {
  const interpreted = (expr: unknown): unknown => evaluate(expr as never, {}, reg.evaluateContext());
  const lam = (params: string[], body: unknown) => ({ fn: [...params, body] });
  const head = (path: string, ...args: unknown[]) => ({ call: [{ var: path }, ...args] });
  const mapId = () => reg.getFunction("map")?.id;

  it("a pure dotted lambda in map, filter and fold runs inline to the interpreter's value; an IO one still routes durably", () => {
    const programs = [
      { call: ["map", lam(["x"], head("std.add", { var: "x" }, 1)), [1, 2]] },
      { call: ["map", lam(["x"], head("p5io.echo", { var: "x" })), ["a", "b"]] },
      { call: ["map", lam(["x"], head("p5dio.echoer.go", { var: "x" })), ["a", "b"]] },
      { call: ["filter", lam(["u"], head("p5use.isA", { var: "u" }, { var: "u" })), ["a", "b"]] },
      { call: ["fold", lam(["acc", "x"], head("std.add", { var: "acc" }, { var: "x" })), 0, [1, 2, 3]] },
    ];
    for (const program of programs) {
      const expected = interpreted(program);
      expect(expected).not.toBeNull();
      const durable = run([program]);
      expect({ program, outcome: durable.outcome, value: durable.outcome === "done" ? durable.value : undefined })
        .toEqual({ program, outcome: "done", value: expected });
    }
    // A dotted head that names an IO leaf, directly or through a projected
    // reference, is not inline-safe: the HOF still routes to its Fenel body.
    for (const path of ["p5io.fetch", "p5dio.fetcher.go"]) {
      const result = run([{ call: ["map", lam(["x"], head(path, { var: "x" })), ["a"]] }]);
      expect({ path, action: action(result) }).toEqual({ path, action: mapId() });
    }
  }, LONG);

  it("a dotted head rooted in the lambda's own parameter, or in a captured local, stays conservative", () => {
    // `\p5io -> p5io.echo "x"`: the root is the parameter, not the bundle (a
    // two-field record: a one-key object literal would read as an operator).
    const rooted = run([{ call: ["map", lam(["p5io"], head("p5io.echo", "x")), [{ echo: { $ref: "p5use:wrap" }, note: "n" }]] }]);
    expect(action(rooted)).toBe(mapId());
    // A captured `std` shadows the bundle: not resolved through the registry.
    const captured = run([{ let: { std: { var: "p5dio.echoer" } } }, { call: ["map", lam(["x"], head("std.go", { var: "x" })), ["a"]] }]);
    expect(action(captured)).toBe(mapId());
    // The same head with no binder in the way runs inline.
    expect(run([{ call: ["map", lam(["x"], head("p5io.echo", { var: "x" })), ["x"]] }]))
      .toMatchObject({ outcome: "done", value: ["x"] });
  }, LONG);
});

// ---------------------------------------------------------------------------
// TS fix review (2026-10-03, astra C review items 1 and 2).
//
// Item 1 — an applied CLASS method (`{method:[Class, m, …]}` whose head is no
// bundle) is dispatched on its argument's runtime type, so which method runs
// is not known where the gate looks. Both purity gates (the closure gate and
// the named-function gate) used to let it through, and the dotted-head
// refinement then admitted `\x -> std.add 1 (ProbeFetch5a.get x)` inline: the
// IO leaf the instance references ran in the pure evaluator and the result
// dropped the request. The gates now admit an applied (or read) class method
// only when EVERY method it may select — each instance row of the class, a
// block frame's instance, the class default — is itself proven inline-safe;
// otherwise the callable stays on the durable route.
//
// Item 2 — operand zero of `|>` is the piped VALUE, never a callee: a literal
// string there (`"hello" |> (\s -> s)`) made the callback look like a call of
// an unknown function, so its HOF left the inline path the interpreter takes.
// ---------------------------------------------------------------------------

describe("an applied class method is inline-safe only when every method it may select is", () => {
  const interpreted = (expr: unknown): unknown => evaluate(expr as never, {}, reg.evaluateContext());
  const lam = (params: string[], body: unknown) => ({ fn: [...params, body] });
  const head = (path: string, ...args: unknown[]) => ({ call: [{ var: path }, ...args] });
  const mapId = () => reg.getFunction("map")?.id;

  beforeAll(() => {
    // Two one-method classes over `a`, each with one `Number` instance: the
    // IO one's method is the IO leaf `p5io.fetch`, the pure one's the pure
    // `p5io.echo`.
    for (const [name, target] of [["ProbeFetch5a", "p5io:fetch"], ["ProbePure5a", "p5io:echo"]] as const) {
      dispatchRegistry.defineClass({
        name,
        params: [{ name: "a" }],
        methods: [{ name: "get", params: [{ name: "x", type: { $var: "a" } }], returns: { $var: "a" } }],
      } as never);
      dispatchRegistry.addInstance({ typeName: name, args: ["Number"], methods: { get: { $ref: target } } } as never);
    }
  }, LONG);

  it("a callback applying an IO class method routes durably: under a dotted head (the review's repro), alone, and as a bare value", () => {
    const io = { method: ["ProbeFetch5a", "get", { var: "x" }] };
    for (const body of [head("std.add", 1, io), io, { call: ["std:add", 1, io] }]) {
      const result = run([{ call: ["map", lam(["x"], body), [5]] }]);
      expect({ body, outcome: result.outcome, action: action(result) }).toEqual({ body, outcome: "io", action: mapId() });
    }
    const bare = run([{ call: ["map", { method: ["ProbeFetch5a", "get"] }, [5]] }]);
    expect(action(bare)).toBe(mapId());
  }, LONG);

  it("a class method whose every instance is inline-safe runs inline, to the interpreter's value", () => {
    const pure = { method: ["ProbePure5a", "get", { var: "x" }] };
    const program = { call: ["map", lam(["x"], head("std.add", 1, pure)), [5]] };
    const expected = interpreted(program);
    expect(expected).toEqual([6]);
    expect(run([program])).toMatchObject({ outcome: "done", value: expected });
  }, LONG);

  it("the named-function gate: a body applying the IO class method is not inline-safe, one applying the pure class method is", () => {
    const viaIO = run([{ call: ["map", { var: "p5probeuse.viaClassIO" }, [5]] }]);
    expect(action(viaIO)).toBe(mapId());
    const program = { call: ["map", { var: "p5probeuse.viaClassPure" }, [5]] };
    expect(run([program])).toMatchObject({ outcome: "done", value: interpreted(program) });
  }, LONG);

  it("a literal pipeline input inside a callback is a value: the callback stays inline, as in the interpreter", () => {
    const identity = lam(["s"], { var: "s" });
    for (const literal of ["hello", "p5io.fetch"]) {
      const program = { call: ["map", lam(["x"], { "|>": [literal, identity] }), [1]] };
      expect(interpreted(program)).toEqual([literal]);
      expect(run([program])).toMatchObject({ outcome: "done", value: [literal] });
    }
  }, LONG);
});

// ---------------------------------------------------------------------------
// TS fix re-review (2026-10-03, astra C2 items 1, 2, 4, 5 and the runtime half
// of item 3).
//
// Item 1 — a body that installs a local dispatch frame (`withInstance`) was
// judged under the INCOMING context: a callback overriding the pure
// `ProbeScope5a.get` with an IO leaf ran inline and dropped the request. Both
// gates now decline such a body.
// Item 2 — the class-method verdict cache was keyed by `Class.method` alone: a
// method `{$ref:"go"}` judged where `go` is pure answered where `go` is IO, and
// a verdict judged with no block frame answered under one overriding a class
// the method reaches transitively. The per-method cache is gone, and function
// verdicts are cached only in their own import frame with no block frame.
// Item 4 — a legacy `pipe` partial stage `["p5io.fetch"]` names its callee.
// Item 5 — `x |> takeGo r` fully applies a callable factory: the stage applies
// the callable it returns, which no walk can see.
// Item 3 (runtime) — the lookup handlers publish a repository row's lambda
// methods as the registry binds them, never as raw IR.
// ---------------------------------------------------------------------------

describe("TS fix re-review (astra C2): local dispatch frames, cache keys, pipe partials, callable factories", () => {
  const interpreted = (expr: unknown): unknown => evaluate(expr as never, {}, reg.evaluateContext());
  const lam = (params: string[], body: unknown) => ({ fn: [...params, body] });
  const head = (path: string, ...args: unknown[]) => ({ call: [{ var: path }, ...args] });
  const mapId = () => reg.getFunction("map")?.id;
  const defineOneMethodClass = (name: string): void => {
    dispatchRegistry.defineClass({
      name,
      params: [{ name: "a" }],
      methods: [{ name: "get", params: [{ name: "x", type: { $var: "a" } }], returns: { $var: "a" } }],
    } as never);
  };

  beforeAll(() => {
    // `ProbeScope5a` and `CacheB5a` are pure (`p5io.echo`); `CacheGo5a.get` is
    // the bare reference `go`, resolved in the applying body's import frame;
    // `CacheA5a.get` is `p5cacheab.viaB`, which applies `CacheB5a.get`.
    const rows: Array<[string, unknown]> = [
      ["ProbeScope5a", { $ref: "p5io:echo" }],
      ["CacheGo5a", { $ref: "go" }],
      ["CacheB5a", { $ref: "p5io:echo" }],
      ["CacheA5a", { $ref: "p5cacheab:viaB" }],
    ];
    for (const [name, get] of rows) {
      defineOneMethodClass(name);
      dispatchRegistry.addInstance({ typeName: name, args: ["Number"], methods: { get } } as never);
    }
  }, LONG);

  it("item 1 — a callback that overrides a pure class locally with an IO leaf routes durably (the review's repro)", () => {
    const body = { withInstance: [LOCAL_OVERRIDE, head("std.add", 1, { method: ["ProbeScope5a", "get", { var: "x" }] })] };
    const result = run([{ call: ["map", lam(["x"], body), [5]] }]);
    expect({ outcome: result.outcome, action: action(result) }).toEqual({ outcome: "io", action: mapId() });
    // Without the override the same callback is pure and runs inline.
    const plain = { call: ["map", lam(["x"], head("std.add", 1, { method: ["ProbeScope5a", "get", { var: "x" }] })), [5]] };
    expect(run([plain])).toMatchObject({ outcome: "done", value: interpreted(plain) });
  }, LONG);

  it("item 1 — the named-function gate: a body installing the override is not inline-safe", () => {
    const result = run([{ call: ["map", { var: "p5scope.viaOverride" }, [5]] }]);
    expect({ outcome: result.outcome, action: action(result) }).toEqual({ outcome: "io", action: mapId() });
  }, LONG);

  it("item 2 — a method `{$ref:\"go\"}` judged where `go` is pure never answers where `go` is IO", () => {
    const program = { call: ["map", lam(["x"], head("std.add", 1, { method: ["CacheGo5a", "get", { var: "x" }] })), [5]] };
    expect(runIn("p5cacheusep:anchor", [program])).toMatchObject({ outcome: "done", value: [6] });
    const io = runIn("p5cacheuseio:anchor", [program]);
    expect({ outcome: io.outcome, action: action(io) }).toEqual({ outcome: "io", action: mapId() });
  }, LONG);

  it("item 2 — a verdict judged with no block frame never answers under one overriding a class reached transitively", () => {
    const program = { call: ["map", lam(["x"], head("std.add", 1, { method: ["CacheA5a", "get", { var: "x" }] })), [5]] };
    // Warm: no block frame, `CacheB5a` pure.
    expect(run([program])).toMatchObject({ outcome: "done", value: [6] });
    // The same registry, its contexts now carrying an IO block override for
    // `CacheB5a` (a frame a host may hold around a durable step).
    const frame = { typeName: "CacheB5a", args: ["Number"], methods: { get: { $ref: "p5io:fetch" } } };
    const original = reg.evaluateContext;
    (reg as { evaluateContext: () => EvaluateContext }).evaluateContext = () => ({ ...original.call(reg), _dictStack: [frame] });
    try {
      const framed = run([program]);
      expect({ outcome: framed.outcome, action: action(framed) }).toEqual({ outcome: "io", action: mapId() });
    } finally {
      (reg as { evaluateContext: () => EvaluateContext }).evaluateContext = original;
    }
    // And the frame never leaks into the cache: unframed, it is pure again.
    expect(run([program])).toMatchObject({ outcome: "done", value: [6] });
  }, LONG);

  it("item 4 — a pipe partial stage naming an IO leaf keeps its callback on the durable route", () => {
    const body = head("std.add", 1, { pipe: [{ var: "x" }, ["p5io.fetch"]] });
    const result = run([{ call: ["map", lam(["x"], body), [5]] }]);
    expect({ outcome: result.outcome, action: action(result) }).toEqual({ outcome: "io", action: mapId() });
  }, LONG);

  it("item 5 — `x |> takeGo r` with `r.go` an IO reference routes durably, in a callback and through a named function", () => {
    const io = { go: { $ref: "p5io:fetch" } };
    const body = head("p5use.wrap", { "|>": [{ var: "x" }, { call: ["p5take.takeGo", { var: "r" }] }] });
    const inCallback = run([{ call: ["map", lam(["x"], body), ["a"]] }], { r: io });
    expect({ outcome: inCallback.outcome, action: action(inCallback) }).toEqual({ outcome: "io", action: mapId() });
    const named = run([{ call: ["map", { call: ["p5take.pipeApply", { var: "r" }] }, ["a"]] }], { r: io });
    expect({ outcome: named.outcome, action: action(named) }).toEqual({ outcome: "io", action: mapId() });
  }, LONG);

  it("item 3 — the lookup handlers publish a repository row's lambda method bound in its declaring module", async () => {
    defineOneMethodClass("LookupLam5a");
    // A row registered straight into the pool with its declaring module
    // (`p5use`, whose `wrap s = [s]`), as the repository instance files are.
    dispatchRegistry.addInstance(
      { typeName: "LookupLam5a", args: ["Number"], methods: { get: { fn: ["x", { call: ["wrap", { var: "x" }] }] } }, scope: { kind: "global" } } as never,
      { declaringModule: "p5use" },
    );
    const handlers = new Map<string, (params: Record<string, unknown>, ctx: unknown) => Promise<{ value: unknown }>>();
    registerDispatchHandlers({
      registerIOHandler: (name: string, handler: never) => { handlers.set(name, handler); },
      evaluateContext: () => reg.evaluateContext(),
    } as never);
    const ioCtx = { authority: undefined };
    const params = { specTypeId: "LookupLam5a", target: "Number" };
    const one = (await handlers.get("dispatch.lookup_one")!(params, ioCtx)).value as { _0: Record<string, unknown> };
    const all = (await handlers.get("dispatch.lookup_all")!(params, ioCtx)).value as Array<Record<string, unknown>>;
    const looked = (await handlers.get("dispatch.lookup")!({ specTypeId: "LookupLam5a", key: { $tag: "ByType", target: "Number" } }, ioCtx)).value as { value: Record<string, unknown> };
    for (const [via, method] of [["lookup_one", one._0.get], ["lookup_all", all[0]?.get], ["lookup", looked.value.get]] as const) {
      expect({ via, closure: (method as { __fenelFn?: unknown })?.__fenelFn }).toEqual({ via, closure: true });
      expect({ via, applied: invokeCallable(method, [7], reg.evaluateContext()) }).toEqual({ via, applied: [7] });
    }
  }, LONG);
});
