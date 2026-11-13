// ---------------------------------------------------------------------------
// modules-as-values Phase 2d, Stage 1 — COMPLETE selection
// (`workstreams/modules-as-values/briefs/phase-2d-types-at-the-call-site.md`,
// "Implementation plan", decisions 2 and 3).
//
// `C t1 … tk` is selected by its whole type-argument tuple through its own
// resolver entry, `dispatch:rsvResolveComplete`: `Iso String JsonValue` never
// shadows `Iso String Bytes`. This suite pins:
//   (A) the system routing table's routes, dispatch positions, general classes
//       and the instance keys of the six multi-argument classes are identical
//       to the snapshot taken at HEAD 3a7b4166 before any change
//       (`modules-as-values-phase-2d.routing-snapshot.json`), and the new
//       complete tuples / general-scope index are projected;
//   (B) the Fenel entry (interpreted): selection by a differing SECOND argument,
//       exact frame shadowing, a same-class frame without a complete tuple,
//       priorities and ties, owned / foreign / accountless visibility, visible
//       and invisible general rows, arity mismatch;
//   (C) the evaluation helper `resolveCompleteMethodForEvaluation` over a live
//       registry context (table, frames, tags), with no fallback;
//   (D) the deletion guard: a string-target unregister refuses an owned
//       multi-argument row and deletes nothing;
//   (E) `constraintKey` keys on the full tuple;
//   (F) compiled vs interpreted parity: FAILS while the compiled shard is
//       missing, stale or broken (explicit development bypass:
//       FENEL_MAV2D_ALLOW_INTERPRETED_PARITY=1).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getSystemRegistry } from "./system-registry";
import { createDispatchRegistry, type DispatchRegistry } from "./dispatch-registry";
import {
  dispatchCompiledResolveComplete,
  dispatchCompiledResolveDispatch,
  dispatchCompiledResolver,
  getResolverNamespace,
  setResolverInterpreted,
} from "./engine-bodies-dispatch";
import {
  installServedDispatcher,
  resolveCompleteMethodForEvaluation,
  routingArgsValue,
  type EvaluateContext,
  type ServedBareNameResolver,
  type ServedCompleteResolver,
  type ServedDispatchResolver,
} from "./json-logic";
import type { ModuleRegistry, RoutingTableValue } from "./registry";
import { constraintKey } from "./constraint-inference";
import { COMPILER_TARGET_ENTITY_MODULES } from "./modules/compiler-target-entities";
import { engineModule } from "./modules/engine";
import { localeModule } from "./modules/locale";
import { stdModule } from "./modules/std";
import { createRepositoryRegistry } from "./repository-registry";
import type { Constraint, FenelModule, FieldDef } from "./types";

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = JSON.parse(
  readFileSync(join(HERE, "modules-as-values-phase-2d.routing-snapshot.json"), "utf8"),
) as {
  routes: unknown;
  posIdx: Record<string, number>;
  generalIdx: Record<string, true>;
  instanceKeys: Record<string, Record<string, unknown[]>>;
};

const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const NOTHING = { $tag: "Nothing" } as const;
const just = <T,>(v: T) => ({ $tag: "Just" as const, _0: v });
const fld = (name: string, type: unknown): FieldDef => ({ name, type } as unknown as FieldDef);

type Scope =
  | { $tag: "RsvGlobalScope" }
  | { $tag: "RsvTagScope"; _0: string }
  | { $tag: "RsvAccountScope"; _0: string };
const GLOBAL: Scope = { $tag: "RsvGlobalScope" };
const TAG = (t: string): Scope => ({ $tag: "RsvTagScope", _0: t });
const OWNED = (a: string): Scope => ({ $tag: "RsvAccountScope", _0: a });

type Row = {
  typeName: string;
  key: string;
  args: unknown;
  scope: Scope;
  priority: number;
  methods: Record<string, unknown>;
};

const row = (
  typeName: string,
  args: string[] | null,
  fnId: string,
  scope: Scope = GLOBAL,
  priority = 0,
  key?: string,
): Row => ({
  typeName,
  key: key ?? (args !== null ? args[0]! : "String"),
  args: args === null ? NOTHING : just(args),
  scope,
  priority,
  methods: { decode: fnId },
});

/** A hand-built table: only the fields the complete entry reads are real. */
function table(rows: Row[], general: Record<string, Scope[]> = {}): Record<string, unknown> {
  const instanceIdx: Record<string, Record<string, Row[]>> = Object.create(null);
  for (const r of rows) {
    const byKey = (instanceIdx[r.typeName] ??= Object.create(null) as Record<string, Row[]>);
    (byKey[r.key] ??= []).push(r);
  }
  const generalScopeIdx: Record<string, Scope[]> = Object.create(null);
  const generalIdx: Record<string, true> = Object.create(null);
  for (const [cls, scopes] of Object.entries(general)) {
    generalScopeIdx[cls] = scopes;
    generalIdx[cls] = true;
  }
  return {
    $tag: "RoutingTable",
    routes: [],
    routeIdx: Object.create(null),
    posIdx: Object.create(null),
    ownerIdx: Object.create(null),
    instanceIdx,
    generalIdx,
    generalScopeIdx,
  };
}

type Frame = { typeName: string; key: string; args: unknown; methods: Record<string, unknown> };
const frame = (typeName: string, args: unknown[], fnId: string): Frame => ({
  typeName,
  key: String(args[0]),
  args: routingArgsValue(args),
  methods: { decode: fnId },
});

/** The interpreted Fenel entry (forced), projected. */
function resolve(
  t: unknown,
  cls: string,
  typeArgs: string[],
  frames: Frame[] = [],
  tags: string[] = [],
  account: unknown = NOTHING,
  name = "decode",
): unknown {
  setResolverInterpreted(true);
  try {
    return plain(dispatchCompiledResolveComplete(t, cls, name, typeArgs, frames, tags, account));
  } finally {
    setResolverInterpreted(null);
  }
}

const resolved = (fnId: string) => ({ $tag: "Resolved", _0: fnId });
const isUnsupported = (o: unknown): boolean =>
  (o as { $tag?: unknown }).$tag === "CompleteUnsupported"
  && typeof (o as { _0?: unknown })._0 === "string";

// ===========================================================================
// (A) the system routing table
// ===========================================================================

describe("Phase 2d (A) — the system routing table is unchanged where it was, and carries complete tuples", () => {
  let t: RoutingTableValue & { generalScopeIdx: Record<string, Scope[]> };
  // The system registry build is slow while the compiled artifacts are stale
  // (every compiler/resolver body runs interpreted): give the hook its own budget.
  beforeAll(() => {
    t = getSystemRegistry().routingTable() as typeof t;
  }, 3_600_000);

  it("bare-name routes equal the pre-change snapshot", () => {
    expect(plain(t.routes)).toEqual(SNAPSHOT.routes);
  });

  it("per-(class, method) dispatch positions equal the pre-change snapshot", () => {
    expect(plain(t.posIdx)).toEqual(SNAPSHOT.posIdx);
  });

  it("general classes equal the pre-change snapshot", () => {
    expect(plain(t.generalIdx)).toEqual(SNAPSHOT.generalIdx);
  });

  it("the six multi-argument classes keep their instance keys, scopes, priorities and method names", () => {
    for (const cls of Object.keys(SNAPSHOT.instanceKeys)) {
      const byKey = t.instanceIdx[cls] ?? {};
      const projected: Record<string, unknown[]> = {};
      for (const key of Object.keys(byKey).sort()) {
        projected[key] = byKey[key]!.map((e) => ({
          scope: plain(e.scope),
          priority: e.priority,
          methods: Object.keys(e.methods).sort(),
        }));
      }
      expect(projected, cls).toEqual(SNAPSHOT.instanceKeys[cls]!);
    }
  });

  it("every exact row carries its complete tuple, whose head is its bucket key", () => {
    let multi = 0;
    for (const [cls, byKey] of Object.entries(t.instanceIdx)) {
      for (const [key, rows] of Object.entries(byKey)) {
        for (const r of rows as unknown as Row[]) {
          const a = r.args as { $tag: string; _0?: unknown[] };
          expect(["Just", "Nothing"], `${cls} ${key}`).toContain(a.$tag);
          if (a.$tag === "Just") {
            expect(a._0![0], `${cls} ${key}`).toBe(key);
            if (a._0!.length > 1) multi += 1;
          }
        }
      }
    }
    // The codec and migration corpus registers multi-argument rows.
    expect(multi).toBeGreaterThan(0);
  });

  it("no codec or migration class has a general row (complete selection is decidable for them)", () => {
    for (const cls of ["Iso", "Decodable", "Encodable", "Migration"]) {
      expect(t.generalScopeIdx[cls], cls).toBeUndefined();
    }
  });

  it("the general-scope index is null-prototype and covers every generalIdx class", () => {
    expect(Object.getPrototypeOf(t.generalScopeIdx)).toBeNull();
    for (const cls of Object.keys(t.generalIdx)) {
      expect(Array.isArray(t.generalScopeIdx[cls]), cls).toBe(true);
    }
  });
});

// ===========================================================================
// (B) the Fenel entry over hand-built tables (interpreted)
// ===========================================================================

describe("Phase 2d (B) — rsvResolveComplete selects by the complete tuple", () => {
  const ISO = "IsoT";
  const pair = table([
    row(ISO, ["String", "JsonValue"], "m:isoJson"),
    row(ISO, ["String", "Bytes"], "m:isoBase64"),
  ]);

  it("a differing SECOND argument selects the instance", () => {
    expect(resolve(pair, ISO, ["String", "Bytes"])).toEqual(resolved("m:isoBase64"));
    expect(resolve(pair, ISO, ["String", "JsonValue"])).toEqual(resolved("m:isoJson"));
  });

  it("a tuple nobody registered is NoInstance; so is a method the instance lacks", () => {
    expect(resolve(pair, ISO, ["String", "Number"])).toEqual({ $tag: "NoInstance" });
    expect(resolve(pair, "Other", ["String", "Bytes"])).toEqual({ $tag: "NoInstance" });
    expect(resolve(pair, ISO, ["String", "Bytes"], [], [], NOTHING, "encode")).toEqual({ $tag: "NoInstance" });
  });

  it("an arity mismatch never matches", () => {
    const mixed = table([
      row(ISO, ["String"], "m:unary"),
      row(ISO, ["String", "Bytes", "Extra"], "m:ternary"),
    ]);
    expect(resolve(mixed, ISO, ["String", "Bytes"])).toEqual({ $tag: "NoInstance" });
    expect(resolve(mixed, ISO, ["String"])).toEqual(resolved("m:unary"));
    expect(resolve(mixed, ISO, [])).toEqual({ $tag: "NoInstance" });
  });

  it("a row whose tuple is not all strings never matches", () => {
    const t = table([row(ISO, null, "m:pattern", GLOBAL, 5, "String"), row(ISO, ["String", "Bytes"], "m:isoBase64")]);
    expect(resolve(t, ISO, ["String", "Bytes"])).toEqual(resolved("m:isoBase64"));
  });

  it("exact frame shadowing: [String, JsonValue] never shadows [String, Bytes]; [String, Bytes] does", () => {
    const jsonFrame = frame(ISO, ["String", "JsonValue"], "m:frameJson");
    const bytesFrame = frame(ISO, ["String", "Bytes"], "m:frameBytes");
    expect(resolve(pair, ISO, ["String", "Bytes"], [jsonFrame])).toEqual(resolved("m:isoBase64"));
    expect(resolve(pair, ISO, ["String", "Bytes"], [bytesFrame])).toEqual(resolved("m:frameBytes"));
    // innermost first: the nearer frame with the same tuple wins
    const outer = frame(ISO, ["String", "Bytes"], "m:outerBytes");
    expect(resolve(pair, ISO, ["String", "Bytes"], [jsonFrame, bytesFrame, outer])).toEqual(resolved("m:frameBytes"));
    // a frame of another class is ignored
    expect(resolve(pair, ISO, ["String", "Bytes"], [frame("Else", ["String", "Bytes"], "m:else")]))
      .toEqual(resolved("m:isoBase64"));
  });

  it("a same-class frame with no complete tuple is CompleteUnsupported, unless a nearer frame decides", () => {
    const wildFrame = frame(ISO, ["String", { $var: "a" }], "m:wild");
    expect((wildFrame.args as { $tag: string }).$tag).toBe("Nothing");
    expect(isUnsupported(resolve(pair, ISO, ["String", "Bytes"], [wildFrame]))).toBe(true);
    const bytesFrame = frame(ISO, ["String", "Bytes"], "m:frameBytes");
    expect(resolve(pair, ISO, ["String", "Bytes"], [bytesFrame, wildFrame])).toEqual(resolved("m:frameBytes"));
  });

  it("pooled priorities: the highest visible priority wins; a top tie is Conflicted with its count", () => {
    const ranked = table([
      row(ISO, ["String", "Bytes"], "m:low", GLOBAL, 1),
      row(ISO, ["String", "Bytes"], "m:high", GLOBAL, 7),
      row(ISO, ["String", "JsonValue"], "m:otherTuple", GLOBAL, 99),
    ]);
    expect(resolve(ranked, ISO, ["String", "Bytes"])).toEqual(resolved("m:high"));
    const tied = table([
      row(ISO, ["String", "Bytes"], "m:a", GLOBAL, 3),
      row(ISO, ["String", "Bytes"], "m:b", GLOBAL, 3),
      row(ISO, ["String", "Bytes"], "m:c", GLOBAL, 3),
      row(ISO, ["String", "Bytes"], "m:under", GLOBAL, 1),
      // a higher row of ANOTHER tuple must not break the tie
      row(ISO, ["String", "JsonValue"], "m:json", GLOBAL, 50),
    ]);
    expect(resolve(tied, ISO, ["String", "Bytes"])).toEqual({ $tag: "Conflicted", _0: "String Bytes", _1: 3 });
    // negative priorities stay ordinary priorities
    const negative = table([
      row(ISO, ["String", "Bytes"], "m:neg2", GLOBAL, -2),
      row(ISO, ["String", "Bytes"], "m:neg1", GLOBAL, -1),
    ]);
    expect(resolve(negative, ISO, ["String", "Bytes"])).toEqual(resolved("m:neg1"));
  });

  it("tags: a tagged row is a candidate only under its active tag", () => {
    const t = table([
      row(ISO, ["String", "Bytes"], "m:global", GLOBAL, 0),
      row(ISO, ["String", "Bytes"], "m:tagged", TAG("exp"), 10),
    ]);
    expect(resolve(t, ISO, ["String", "Bytes"])).toEqual(resolved("m:global"));
    expect(resolve(t, ISO, ["String", "Bytes"], [], ["exp"])).toEqual(resolved("m:tagged"));
  });

  it("ownership: an owned row is visible only to its own account; a foreign or accountless frame never sees it", () => {
    const t = table([
      row(ISO, ["String", "Bytes"], "m:global", GLOBAL, 0),
      row(ISO, ["String", "Bytes"], "m:ownedA", OWNED("acct-A"), 10),
    ]);
    expect(resolve(t, ISO, ["String", "Bytes"], [], [], just("acct-A"))).toEqual(resolved("m:ownedA"));
    expect(resolve(t, ISO, ["String", "Bytes"], [], [], just("acct-B"))).toEqual(resolved("m:global"));
    expect(resolve(t, ISO, ["String", "Bytes"], [], [], NOTHING)).toEqual(resolved("m:global"));
    // an invisible tie does not conflict
    const tie = table([
      row(ISO, ["String", "Bytes"], "m:global", GLOBAL, 10),
      row(ISO, ["String", "Bytes"], "m:ownedB", OWNED("acct-B"), 10),
    ]);
    expect(resolve(tie, ISO, ["String", "Bytes"], [], [], just("acct-A"))).toEqual(resolved("m:global"));
    expect(resolve(tie, ISO, ["String", "Bytes"], [], [], just("acct-B"))).toEqual({ $tag: "Conflicted", _0: "String Bytes", _1: 2 });
    // an owned row alone, seen by nobody else
    const alone = table([row(ISO, ["String", "Bytes"], "m:ownedA", OWNED("acct-A"), 0)]);
    expect(resolve(alone, ISO, ["String", "Bytes"], [], [], NOTHING)).toEqual({ $tag: "NoInstance" });
  });

  it("general rows: a visible one is CompleteUnsupported; a foreign, untagged or accountless-invisible one changes nothing", () => {
    const exact = [row(ISO, ["String", "Bytes"], "m:isoBase64")];
    expect(isUnsupported(resolve(table(exact, { [ISO]: [GLOBAL] }), ISO, ["String", "Bytes"]))).toBe(true);
    const owned = table(exact, { [ISO]: [OWNED("acct-B")] });
    expect(resolve(owned, ISO, ["String", "Bytes"], [], [], just("acct-A"))).toEqual(resolved("m:isoBase64"));
    expect(resolve(owned, ISO, ["String", "Bytes"], [], [], NOTHING)).toEqual(resolved("m:isoBase64"));
    expect(isUnsupported(resolve(owned, ISO, ["String", "Bytes"], [], [], just("acct-B")))).toBe(true);
    const tagged = table(exact, { [ISO]: [TAG("exp")] });
    expect(resolve(tagged, ISO, ["String", "Bytes"])).toEqual(resolved("m:isoBase64"));
    expect(isUnsupported(resolve(tagged, ISO, ["String", "Bytes"], [], ["exp"]))).toBe(true);
    // another class's general row changes nothing
    expect(resolve(table(exact, { Other: [GLOBAL] }), ISO, ["String", "Bytes"])).toEqual(resolved("m:isoBase64"));
    // a matching frame still decides before the general check
    const bytesFrame = frame(ISO, ["String", "Bytes"], "m:frameBytes");
    expect(resolve(table(exact, { [ISO]: [GLOBAL] }), ISO, ["String", "Bytes"], [bytesFrame]))
      .toEqual(resolved("m:frameBytes"));
  });

  it("a general class's exact bucket is read directly (not through rsvInstancesFor)", () => {
    // generalIdx marks the class; with no VISIBLE general row, the exact rows still decide.
    const t = table([row(ISO, ["String", "Bytes"], "m:isoBase64")], { [ISO]: [OWNED("acct-Z")] });
    expect((t.generalIdx as Record<string, true>)[ISO]).toBe(true);
    expect(resolve(t, ISO, ["String", "Bytes"])).toEqual(resolved("m:isoBase64"));
  });
});

// ===========================================================================
// (B') the TS projection of a controlled registry feeds the entry
// ===========================================================================

function controlled(): { reg: ModuleRegistry; spec: DispatchRegistry } {
  const spec = createDispatchRegistry();
  spec.defineClass({
    name: "IsoC",
    params: [{ name: "s" }, { name: "a" }],
    methods: [{ name: "decode", params: [fld("_0", { $var: "s" })], returns: { $var: "a" } }],
  });
  spec.addInstance({ typeName: "IsoC", args: ["String", "JsonValue"], methods: { decode: "m:isoJson" } });
  spec.addInstance({ typeName: "IsoC", args: ["String", "Bytes"], methods: { decode: "m:isoBase64" } });
  spec.addInstance({
    typeName: "IsoC",
    args: ["String", "Bytes"],
    methods: { decode: "m:ownedBytes" },
    scope: { kind: "account", accountId: "acct-A" },
    priority: 5,
  });
  spec.defineClass({
    name: "IsoG",
    params: [{ name: "s" }, { name: "a" }],
    methods: [{ name: "decode", params: [fld("_0", { $var: "s" })], returns: { $var: "a" } }],
  });
  spec.addInstance({ typeName: "IsoG", args: ["String", "Bytes"], methods: { decode: "m:gExact" } });
  spec.addInstance({
    typeName: "IsoG",
    args: ["String", { $var: "a" }],
    methods: { decode: "m:gWild" },
    scope: { kind: "account", accountId: "acct-B" },
  });
  // Lazy import: the registry module is heavy and this keeps (A)/(B) independent.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { createRegistry } = require("./registry") as typeof import("./registry");
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { stdModule } = require("./modules/std") as { stdModule: FenelModule };
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchModule } = require("./modules/dispatch") as { dispatchModule: FenelModule };
  const reg = createRegistry([stdModule, dispatchModule], { dispatchRegistry: spec });
  return { reg, spec };
}

describe("Phase 2d (B') — the projected table of a controlled registry", () => {
  let reg: ModuleRegistry;
  let t: Record<string, unknown>;
  beforeAll(() => {
    ({ reg } = controlled());
    t = reg.routingTable() as unknown as Record<string, unknown>;
  });

  it("projects the complete tuples and the general rows' scopes (a wildcard row is general, not a new generalIdx class)", () => {
    const idx = t.instanceIdx as Record<string, Record<string, Row[]>>;
    expect(plain(idx.IsoC!.String!.map((r) => r.args))).toEqual([
      just(["String", "JsonValue"]),
      just(["String", "Bytes"]),
      just(["String", "Bytes"]),
    ]);
    expect(plain(idx.IsoG!.String!.map((r) => r.args))).toEqual([just(["String", "Bytes"]), NOTHING]);
    expect(plain(t.generalScopeIdx)).toEqual({ IsoG: [OWNED("acct-B")] });
    // generalIdx keeps its HEAD definition (first argument not a string)
    expect(plain(t.generalIdx)).toEqual({});
  });

  it("selects by the second argument, and by ownership, over the projection", () => {
    expect(resolve(t, "IsoC", ["String", "JsonValue"])).toEqual(resolved("m:isoJson"));
    expect(resolve(t, "IsoC", ["String", "Bytes"])).toEqual(resolved("m:isoBase64"));
    expect(resolve(t, "IsoC", ["String", "Bytes"], [], [], just("acct-A"))).toEqual(resolved("m:ownedBytes"));
    expect(resolve(t, "IsoG", ["String", "Bytes"], [], [], just("acct-A"))).toEqual(resolved("m:gExact"));
    expect(isUnsupported(resolve(t, "IsoG", ["String", "Bytes"], [], [], just("acct-B")))).toBe(true);
  });

  it("(C) resolveCompleteMethodForEvaluation reads the ctx's table, frames and tags, with no fallback", () => {
    const base = reg.evaluateContext() as EvaluateContext;
    expect(resolveCompleteMethodForEvaluation(base, "IsoC", "decode", ["String", "Bytes"])).toEqual(
      resolved("m:isoBase64") as never,
    );
    expect(resolveCompleteMethodForEvaluation(base, "IsoC", "decode", ["String", "JsonValue"])).toEqual(
      resolved("m:isoJson") as never,
    );
    // a frame with the complete tuple shadows; one with another tuple does not
    const withFrames: EvaluateContext = {
      ...base,
      _dictStack: [
        { typeName: "IsoC", args: ["String", "Bytes"], methods: { decode: "m:frameBytes" } },
        { typeName: "IsoC", args: ["String", "JsonValue"], methods: { decode: "m:frameJson" } },
      ] as never,
    };
    expect(resolveCompleteMethodForEvaluation(withFrames, "IsoC", "decode", ["String", "Bytes"])).toEqual(
      resolved("m:frameBytes") as never,
    );
    expect(resolveCompleteMethodForEvaluation(withFrames, "IsoC", "decode", ["String", "JsonValue"])).toEqual(
      resolved("m:frameJson") as never,
    );
    // a boot/harness frame authenticates to no account: the owned row is invisible
    expect(resolveCompleteMethodForEvaluation(base, "IsoC", "decode", ["String", "Number"])).toEqual(
      { $tag: "NoInstance" } as never,
    );
    // no projected table ⇒ undefined (the caller decides; nothing falls back)
    const bare: EvaluateContext = { ...base, _routingTable: undefined };
    expect(resolveCompleteMethodForEvaluation(bare, "IsoC", "decode", ["String", "Bytes"])).toBeUndefined();
  });

  it("(C) a two-hook install keeps the complete entry; an explicit undefined removes it (no fallback)", () => {
    const base = reg.evaluateContext() as EvaluateContext;
    const live = {
      resolveBareName: dispatchCompiledResolver as ServedBareNameResolver,
      resolveDispatch: dispatchCompiledResolveDispatch as ServedDispatchResolver,
    };
    try {
      installServedDispatcher(live);
      expect(resolveCompleteMethodForEvaluation(base, "IsoC", "decode", ["String", "Bytes"])).toEqual(
        resolved("m:isoBase64") as never,
      );
      installServedDispatcher({ ...live, resolveComplete: undefined });
      expect(resolveCompleteMethodForEvaluation(base, "IsoC", "decode", ["String", "Bytes"])).toBeUndefined();
    } finally {
      installServedDispatcher({
        ...live,
        resolveComplete: dispatchCompiledResolveComplete as ServedCompleteResolver,
      });
    }
    expect(resolveCompleteMethodForEvaluation(base, "IsoC", "decode", ["String", "Bytes"])).toEqual(
      resolved("m:isoBase64") as never,
    );
  });
});

// ===========================================================================
// (D) the deletion guard
// ===========================================================================

describe("Phase 2d (D) — a string-target unregister refuses owned multi-argument rows", () => {
  const rowsOf = (spec: DispatchRegistry, cls: string) =>
    spec.listInstances().filter((i) => i.typeName === cls).map((i) => i.methods["decode"]);

  function fixture(): DispatchRegistry {
    const spec = createDispatchRegistry();
    spec.defineClass({ name: "Pair", params: [{ name: "s" }, { name: "a" }], methods: [{ name: "decode", params: [], returns: { $var: "a" } }] });
    spec.defineClass({ name: "Unary", params: [{ name: "s" }], methods: [{ name: "decode", params: [], returns: { $var: "s" } }] });
    const own = (accountId: string) => ({ kind: "account" as const, accountId });
    spec.addInstance({ typeName: "Pair", args: ["String", "Bytes"], methods: { decode: "m:pairBytes" }, scope: own("acct-A") });
    spec.addInstance({ typeName: "Pair", args: ["String", "JsonValue"], methods: { decode: "m:pairJson" }, scope: own("acct-A") });
    spec.addInstance({ typeName: "Pair", args: ["Number", "Bytes"], methods: { decode: "m:foreignPair" }, scope: own("acct-B") });
    spec.addInstance({ typeName: "Pair", args: ["Number", "Bytes"], methods: { decode: "m:globalPair" } });
    spec.addInstance({ typeName: "Unary", args: ["String"], methods: { decode: "m:ownedUnary" }, scope: own("acct-A") });
    spec.addInstance({ typeName: "Unary", args: ["String"], methods: { decode: "m:foreignUnary" }, scope: own("acct-B") });
    spec.addInstance({ typeName: "Unary", args: ["String"], methods: { decode: "m:globalUnary" } });
    return spec;
  }

  it("refuses an owned multi-argument pair and leaves both rows (and the registry version)", () => {
    const spec = fixture();
    const before = spec.version();
    expect(() => spec.removeInstance("Pair", "String", "acct-A")).toThrow(/Pair "String" names only the first type argument/);
    expect(rowsOf(spec, "Pair")).toEqual(["m:pairBytes", "m:pairJson", "m:foreignPair", "m:globalPair"]);
    expect(spec.version()).toBe(before);
  });

  it("a multi-argument row it would not delete (foreign or global) does not refuse, and stays", () => {
    const spec = fixture();
    expect(() => spec.removeInstance("Pair", "Number", "acct-A")).not.toThrow();
    expect(rowsOf(spec, "Pair")).toEqual(["m:pairBytes", "m:pairJson", "m:foreignPair", "m:globalPair"]);
  });

  it("unary deletion still works, owner-scoped: foreign and global rows stay protected", () => {
    const spec = fixture();
    spec.removeInstance("Unary", "String", "acct-A");
    expect(rowsOf(spec, "Unary")).toEqual(["m:foreignUnary", "m:globalUnary"]);
    spec.removeInstance("Unary", "String", "acct-A");
    expect(rowsOf(spec, "Unary")).toEqual(["m:foreignUnary", "m:globalUnary"]);
  });
});

// ===========================================================================
// (E) constraintKey
// ===========================================================================

describe("Phase 2d (E) — constraintKey keys on the complete tuple", () => {
  const c = (args: string[]): Constraint => ({
    class: { $tag: "Id", entityId: "Iso" },
    args: args.map((a) => ({ $ref: a })) as never,
  });

  it("distinguishes Iso String Bytes from Iso String JsonValue", () => {
    expect(constraintKey(c(["String", "Bytes"]))).not.toBe(constraintKey(c(["String", "JsonValue"])));
    expect(constraintKey(c(["String", "Bytes"]))).toBe(constraintKey(c(["String", "Bytes"])));
    expect(constraintKey(c(["String"]))).not.toBe(constraintKey(c(["String", "Bytes"])));
  });
});

// ===========================================================================
// (F) compiled vs interpreted parity (runs after the regeneration)
// ===========================================================================

describe("Phase 2d (F) — compiled vs interpreted rsvResolveComplete parity", () => {
  // The compiled shard MUST execute here: a missing, stale or broken
  // `dispatch:rsvResolveComplete` shard FAILS this gate. The only bypass is
  // explicit, for development before the identity regeneration:
  // FENEL_MAV2D_ALLOW_INTERPRETED_PARITY=1 (the final verification never sets
  // it), and even then each case says so loudly.
  const bypass = process.env["FENEL_MAV2D_ALLOW_INTERPRETED_PARITY"] === "1";
  let compiled: ((...a: unknown[]) => unknown) | undefined;
  let reason = "";
  beforeAll(async () => {
    try {
      // The compiled resolver is certified against the registry it is rendered
      // from (std, engine, dispatch, locale and the compiler targets, as in
      // `compiled-artifact-identity.test.ts`); the whole system registry is not
      // that registry and reads every resolver shard as stale. The compiled
      // function is the generated export whichever registry certifies it.
      const { dispatchModule } = await import("./modules/dispatch");
      const certified = createRepositoryRegistry([
        stdModule,
        engineModule,
        dispatchModule,
        localeModule,
        ...COMPILER_TARGET_ENTITY_MODULES,
      ], { dispatchRegistry: createDispatchRegistry() });
      const ns = getResolverNamespace(certified, "dispatch:rsvResolveComplete");
      const fn = ns?.["rsvResolveComplete"];
      if (typeof fn === "function") compiled = fn as (...a: unknown[]) => unknown;
      else reason = ns === null ? "the compiled resolver shard is stale or missing" : "the shard carries no rsvResolveComplete";
    } catch (e) {
      reason = `the compiled resolver namespace is unavailable (${(e as Error).message})`;
    }
  }, 600_000);
  afterAll(() => setResolverInterpreted(null));

  it("the compiled rsvResolveComplete shard is available (no silent skip)", () => {
    if (compiled === undefined && bypass) {
      console.warn(`[phase-2d parity] BYPASSED by FENEL_MAV2D_ALLOW_INTERPRETED_PARITY=1: ${reason}`);
      return;
    }
    if (compiled === undefined) {
      throw new Error(
        `compiled rsvResolveComplete parity cannot run: ${reason}. Regenerate the compiled `
          + "artifacts; set FENEL_MAV2D_ALLOW_INTERPRETED_PARITY=1 only for development before the regeneration",
      );
    }
    expect(typeof compiled).toBe("function");
  });

  const cases: Array<[string, unknown, string, string[], Frame[], string[], unknown]> = [];
  {
    const ISO = "IsoT";
    const pair = table([
      row(ISO, ["String", "JsonValue"], "m:isoJson"),
      row(ISO, ["String", "Bytes"], "m:isoBase64"),
      row(ISO, ["String", "Bytes"], "m:owned", OWNED("acct-A"), 4),
      row(ISO, ["String", "Bytes"], "m:tieA", TAG("t"), 9),
      row(ISO, ["String", "Bytes"], "m:tieB", TAG("t"), 9),
    ], { Gen: [OWNED("acct-B")] });
    cases.push(["second argument", pair, ISO, ["String", "JsonValue"], [], [], NOTHING]);
    cases.push(["owned", pair, ISO, ["String", "Bytes"], [], [], just("acct-A")]);
    cases.push(["accountless", pair, ISO, ["String", "Bytes"], [], [], NOTHING]);
    cases.push(["tie", pair, ISO, ["String", "Bytes"], [], ["t"], NOTHING]);
    cases.push(["frame", pair, ISO, ["String", "Bytes"], [frame(ISO, ["String", "Bytes"], "m:f")], [], NOTHING]);
    cases.push(["frame without tuple", pair, ISO, ["String", "Bytes"], [frame(ISO, [{ $var: "a" }], "m:w")], [], NOTHING]);
    cases.push(["general visible", pair, "Gen", ["String"], [], [], just("acct-B")]);
    cases.push(["general invisible", pair, "Gen", ["String"], [], [], just("acct-A")]);
    cases.push(["arity", pair, ISO, ["String"], [], [], NOTHING]);
  }

  for (const [label, t, cls, typeArgs, frames, tags, account] of cases) {
    it(`parity: ${label}`, () => {
      if (compiled === undefined) {
        if (!bypass) throw new Error(`compiled rsvResolveComplete parity cannot run (${label}): ${reason}`);
        console.warn(`[phase-2d parity] BYPASSED (${label}) by FENEL_MAV2D_ALLOW_INTERPRETED_PARITY=1: ${reason}`);
        return;
      }
      const interpreted = resolve(t, cls, typeArgs, frames, tags, account);
      expect(plain(compiled(t, cls, "decode", typeArgs, frames, tags, account))).toEqual(interpreted);
    });
  }
});
