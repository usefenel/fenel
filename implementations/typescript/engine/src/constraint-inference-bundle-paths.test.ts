// ---------------------------------------------------------------------------
// modules-as-values follow-up (2026-10-02) — the registry build's static effect
// fold sees calls through bundle paths.
//
// `attachInferredRequires` runs inside `createRegistry` with the registry's own
// lookup. It resolved only an exact id or a code name, so `p5io.fetch s` looked
// pure to the build while the effect audit (whose `getFunction` also resolves a
// two-segment bundle path) saw the effect; a three-segment path, an alias head,
// a dotted read handed to `map` and an uppercase `{method}` head were invisible
// to both. Now the build resolves the two-segment path through the same member
// index `getFunction` uses, an unresolved bundle-path head is effect-opaque
// (`$dyn`, query-side only), resolved dotted reads and `{method}` heads are
// edges, and `s |> f` reads like `f s`.
// ---------------------------------------------------------------------------

import { beforeAll, describe, expect, it } from "bun:test";
import { createRegistry, type ModuleRegistry } from "./registry";
import { loadFenelModule } from "./fenel-module";
import { stdModule } from "./modules/std";
import { DYN_CALLEE, findUndeclaredRequires, inferTransitiveRequires, inferTransitiveRequiresViaFenel } from "./constraint-inference";
import { createDispatchRegistry } from "./dispatch-registry";
import type { Constraint, FenelModule } from "./types";

const LONG = 600_000;
const src = (...lines: string[]): string => lines.join("\n");
const instanceBundle = (bundle: string, ...lines: string[]): FenelModule => ({
  name: bundle,
  label: bundle,
  instances: loadFenelModule(src(...lines), bundle, { dispatchInstanceFile: true }).instances ?? [],
});

let reg: ModuleRegistry;
beforeAll(() => {
  reg = createRegistry([
    stdModule,
    loadFenelModule(src("module p5types where", "Fetcher = Fetcher go: (String -> String)"), "p5types"),
    loadFenelModule(src(
      "module p5io where",
      '@ioAction "p5io.fetch_action"',
      '@requires "HasStateIO"',
      "@native",
      "fetch : String -> String",
    ), "p5io"),
    // Uppercase bundle heads parse to `{method:[Bundle, member, …args]}`.
    loadFenelModule(src(
      "module P5Fn where",
      '@ioAction "p5fn.fetch_action"',
      '@requires "HasStateIO"',
      "@native",
      "fetch : String -> String",
    ), "P5Fn"),
    instanceBundle("p5dio", "fetcher : Fetcher", "fetcher = Fetcher { go = p5io.fetch }"),
    loadFenelModule(src(
      "module p5use where",
      "viaPath : String -> String",
      "viaPath s = p5dio.fetcher.go s",
      "viaQualified : String -> String",
      "viaQualified s = p5io.fetch s",
      "viaBare : String -> String",
      "viaBare s = fetch s",
      "mapQualified : List String -> List String",
      "mapQualified xs = map p5io.fetch xs",
      "viaUpper : String -> String",
      "viaUpper s = P5Fn.fetch s",
      "pipeParam : (String -> String) -> String -> String",
      "pipeParam f s = s |> f",
      "applyParam : (String -> String) -> String -> String",
      "applyParam f s = f s",
    ), "p5use"),
  ]);
}, LONG);

const classes = (cs: readonly Constraint[] | undefined): string[] => (cs ?? []).map((c) => c.class.entityId);
const attached = (id: string): string[] => classes(reg.getFunction(id)?.requires);
const query = (id: string): string[] =>
  classes(inferTransitiveRequires(reg.getFunction(id)!, (name) => reg.getFunction(name)));

describe("the registry build's effect fold sees calls through bundle paths", () => {
  it("a two-segment call head gets the leaf's requires, and the build agrees with the audit; a bare call is unchanged", () => {
    expect(attached("p5use:viaQualified")).toEqual(["HasStateIO"]);
    expect(findUndeclaredRequires(reg.getFunction("p5use:viaQualified")!, (name) => reg.getFunction(name))).toEqual([]);
    expect(attached("p5use:viaBare")).toEqual(["HasStateIO"]);
  }, LONG);

  it("a three-segment path is effect-opaque in the query and never a declarable requires", () => {
    expect(query("p5use:viaPath")).toContain(DYN_CALLEE);
    expect(attached("p5use:viaPath")).toEqual([]);
  }, LONG);

  it("a dotted read handed to map and an uppercase {method} head get the leaf's requires", () => {
    expect(attached("p5use:mapQualified")).toContain("HasStateIO");
    expect(attached("p5use:viaUpper")).toEqual(["HasStateIO"]);
  }, LONG);

  it("`s |> f` with a parameter `f` is effect-opaque, as `f s` is", () => {
    expect(query("p5use:applyParam")).toEqual([DYN_CALLEE]);
    expect(query("p5use:pipeParam")).toEqual([DYN_CALLEE]);
  }, LONG);
});

// ---------------------------------------------------------------------------
// TS fix review (2026-10-03, astra C review item 4) — the build resolves each
// body's callee names in the CALLER's module scope (its Name frame: own
// members, then imports, then the flat global names), as the evaluator runs
// the body. `client.inner` imports `probeRead` from the effectful `effectlib`
// while a pure `purelib.probeRead` also exists: the global short-name index
// named whichever module came first, so the attached requires depended on the
// module order.
// ---------------------------------------------------------------------------

describe("the registry build resolves callee names in the caller's module scope", () => {
  const effectlib = (): FenelModule => loadFenelModule(src(
    "module effectlib where",
    '@ioAction "effectlib.probe_action"',
    '@requires "HasStateIO"',
    "@native",
    "probeRead : String -> String",
  ), "effectlib");
  const purelib = (): FenelModule => loadFenelModule(src(
    "module purelib where",
    "probeRead : String -> String",
    "probeRead s = s",
  ), "purelib");
  // The import is set on the module value (the import grammar reads uppercase
  // module names only).
  const client = (): FenelModule => ({
    ...loadFenelModule(src(
      "module client where",
      "inner : String -> String",
      "inner s = probeRead s",
      "outer : String -> String",
      "outer s = client.inner s",
    ), "client"),
    imports: [{ module: "effectlib", names: ["probeRead"] }],
  });
  const other = (): FenelModule => loadFenelModule(src(
    "module other where",
    "viaGlobal : String -> String",
    "viaGlobal s = purelib.probeRead s",
  ), "other");

  for (const order of ["effectlib first", "purelib first"] as const) {
    it(`an imported effectful name is the edge in both module orders (${order})`, () => {
      const libs = order === "effectlib first" ? [effectlib(), purelib()] : [purelib(), effectlib()];
      const local = createRegistry([...libs, client(), other()]);
      const requiresOf = (id: string): string[] => classes(local.getFunction(id)?.requires);
      expect(requiresOf("client:inner")).toEqual(["HasStateIO"]);
      expect(requiresOf("client:outer")).toEqual(["HasStateIO"]);
      expect(requiresOf("other:viaGlobal")).toEqual([]);
    }, LONG);
  }
});

// ---------------------------------------------------------------------------
// TS fix re-review (2026-10-03, astra C2 item 6) — an unqualified CLASS-METHOD
// call. `bareFetch` names no function: the bare-name resolver dispatches it
// through the class `BareFetch` (`_resolveBareName` answers "dispatch"), whose
// instance here is an IO leaf. The fold dropped the unresolved dotless head,
// so `inner x = bareFetch x` and its caller looked pure. A call-position name
// the lookup cannot resolve is now effect-opaque (`$dyn`, query-side, never a
// declarable requires), in the TS fold and through the Fenel seam alike.
// ---------------------------------------------------------------------------

describe("an unqualified class-method call is effect-opaque, never pure", () => {
  it("BareFetch: inner and outer reach `$dyn`, TS = Fenel; the attached requires stay declarable-only", () => {
    const pool = createDispatchRegistry();
    pool.defineClass({
      name: "BareFetch",
      params: [{ name: "a" }],
      methods: [{ name: "bareFetch", params: [{ name: "x", type: { $var: "a" } }], returns: { $var: "a" } }],
    } as never);
    pool.addInstance({ typeName: "BareFetch", args: ["String"], methods: { bareFetch: { $ref: "bareio:read" } } } as never);
    const local = createRegistry([
      loadFenelModule(src(
        "module bareio where",
        '@ioAction "bareio.read_action"',
        '@requires "HasStateIO"',
        "@native",
        "read : String -> String",
      ), "bareio"),
      loadFenelModule(src(
        "module callerBare where",
        "inner : String -> String",
        "inner x = bareFetch x",
        "outer : String -> String",
        "outer x = callerBare.inner x",
      ), "callerBare"),
    ], { dispatchRegistry: pool });
    // The premise: the name is class dispatch, not a function.
    expect(local.getFunction("bareFetch")).toBeUndefined();
    expect(local.evaluateContext()._resolveBareName?.("bareFetch")).toMatchObject({ kind: "dispatch", typeName: "BareFetch" });
    const lookup = (name: string) => local.getFunction(name);
    for (const id of ["callerBare:inner", "callerBare:outer"]) {
      const target = local.getFunction(id)!;
      const ts = classes(inferTransitiveRequires(target, lookup));
      const fenel = classes(inferTransitiveRequiresViaFenel(target, lookup));
      expect({ id, ts, fenel }).toEqual({ id, ts: [DYN_CALLEE], fenel: [DYN_CALLEE] });
      expect(classes(local.getFunction(id)?.requires)).toEqual([]);
    }
  }, LONG);
});
