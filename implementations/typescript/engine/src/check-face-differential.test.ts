// type-substrate P1(a.12) — THE TWO-PATH DIFFERENTIAL for the check face.
//
// The judgment and the runtime are supposed to be talking about the same value.
// This file is the instrument that says so out loud, per row:
//
//   surface JSON-Logic ──evaluate──▶ runtime value ──contains──▶ Tri   (path A)
//           │
//           └──bodyToExpr / authored Expr──▶ Expr ──checkExpr──▶ Tri   (path B)
//
// **A HARD STOP is a DEFINITE CONTRADICTION** — check `Just true` against
// membership `Just false`, or check `Just false` against membership `Just true`.
// A definite opposite a `Nothing` is NOT a contradiction and is recorded as
// such: the checker is allowed to be stronger than the membership face on a
// term whose value the membership face cannot see, and vice versa. Every row
// therefore carries the runtime value it measured, so a future reader can tell
// which face moved.
//
// Two things this file deliberately does NOT do. It does not re-check a
// witness with the SAME rule that admitted it — every constructor row is
// EVALUATED and put through runtime membership. And it does not assert byte
// identity of the whole judgment: a correct repair may legitimately move a cell
// from a definite to `Nothing`, so the assertion is the contradiction table,
// plus named per-row expectations where the phase entitles a specific verdict.

import { test, expect, describe, setDefaultTimeout } from "bun:test";
import { contains } from "./set-algebra";
import { evaluate } from "./json-logic";
import {
  dispatchEngineBodyWithDeciderCtx,
  __registerCtorDeclaredWiresFixtureForTests,
  __clearCtorDeclaredWiresFixturesForTests,
} from "./engine-bodies-dispatch";
import type { FenelType, FieldKey, SetExpr } from "./types";

// The interpreted deciders on a slow host: same budget rationale as check.test.ts.
setDefaultTimeout(600_000);

type Tri = "true" | "false" | "nothing";
const tri = (m: unknown): Tri => {
  const x = m as { $tag?: string; _0?: unknown; value?: unknown };
  if (x?.$tag === "Just") return (x._0 ?? x.value) ? "true" : "false";
  return "nothing";
};

const fixtureKey = (i: number): FieldKey =>
  ({ $tag: "NamedField", ref: { $ref: `20000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}` } }) as unknown as FieldKey;

const enumS = (...vs: unknown[]): SetExpr => ({ $tag: "SeEnum", values: vs } as unknown as SetExpr);
const ctorS = (c: string, fields: [string, SetExpr][]): SetExpr =>
  ({
    $tag: "SeCtor",
    ctor: c,
    fields: fields.map(([wireName, set], i) => ({
      $tag: "SetCtorField",
      key: /^_\d+$/.test(wireName) ? { $tag: "PositionalField", index: i } : fixtureKey(i),
      wireName,
      set,
    })),
  }) as unknown as SetExpr;

type Expr = Record<string, unknown>;
const ELit = (v: unknown): Expr => ({ $tag: "ELit", value: v });
const EVar = (n: string): Expr => ({ $tag: "EVar", name: n });
const ERecord = (fs: [string, Expr][]): Expr => ({ $tag: "ERecord", fields: fs.map(([name, value]) => ({ name, value })) });
const EConstruct = (c: string, args: Expr[], fields: unknown[] = []): Expr =>
  ({ $tag: "EConstruct", ctor: c, args, fields });

/**
 * Repo-root-anchored path for the census pins below. They used to read
 * cwd-relative, so running this file from `implementations/typescript/engine` — a
 * natural cwd — failed ENOENT. They failed CLOSED, so no verdict was ever wrong,
 * but a false red in a battery whose whole job is to be believed is its own
 * defect (escalation review, 2026-08-30).
 */
const repoFile = (rel: string): string =>
  new URL("../../../../" + rel, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const chk = (e: Expr, env: unknown[], goal: SetExpr): Tri =>
  tri(dispatchEngineBodyWithDeciderCtx("engine:checkExpr", [e, env, goal]));

/**
 * Path A: evaluate the surface node, then decide membership of the VALUE.
 *
 * `declared` is the SAME constructor table path B is given. Feeding both faces
 * one table is the whole point of the instrument, and its first run proved why:
 * with the check face reading a fixture and `evaluate` reading `EMPTY_CTX`, the
 * two faces disagreed about whether `Wrap` was registered at all, and the
 * differential reported a CONTRADICTION that was really a divergence between
 * two registries. That is a true finding about a test seam, not about the
 * judgment — and exactly the class the brief's "one registry snapshot" side
 * condition exists to forbid.
 */
function runtimeSide(
  node: unknown,
  data: Record<string, unknown>,
  goal: SetExpr,
  declared?: Readonly<Record<string, readonly string[]>>,
): { value: unknown; member: Tri | "threw" } {
  let value: unknown;
  const ctx = declared === undefined
    ? undefined
    : ({ _constructors: declared } as unknown as Parameters<typeof evaluate>[2]);
  try {
    value = ctx === undefined ? evaluate(node as never, data) : evaluate(node as never, data, ctx);
  } catch {
    return { value: "<<THREW>>", member: "threw" };
  }
  return { value, member: tri(contains(goal, value as never, null)) };
}

/** The contradiction table. Definite-vs-definite disagreement only. */
function contradiction(check: Tri, member: Tri | "threw"): boolean {
  if (member === "threw" || member === "nothing" || check === "nothing") return false;
  return check !== member;
}

type Row = {
  readonly name: string;
  readonly node: unknown;
  readonly expr: Expr;
  readonly data?: Record<string, unknown>;
  readonly env?: unknown[];
  readonly goal: SetExpr;
  /** The verdict this phase ENTITLES; omitted rows are contradiction-checked only. */
  readonly check?: Tri;
  /** Declared ctor wires, when the row needs a registered ctor in this process. */
  readonly declared?: Readonly<Record<string, readonly string[]>>;
  /** The row EXPECTS evaluation to throw (a reserved constructor name). */
  readonly throws?: true;
  /** The membership verdict this row expects of the runtime value. MANDATORY
   *  unless the row declares `throws`: without it a fenced row asserts nothing
   *  about path A at all, because `contradiction()` is vacuous when the checker
   *  says `Nothing`. (Review round 3, finding 6.) */
  readonly member?: Tri;
};

const ROWS: readonly Row[] = [
  // ── the chk.ctor.pair accept lane: registered, positional source, NAMED goal ──
  {
    name: "registered positional Pair 5 9 vs a NAMED-wire goal",
    member: "false",
    declared: { Pair: ["a", "b"] },
    node: { construct: ["Pair", 5, 9] },
    expr: EConstruct("Pair", [ELit(5), ELit(9)]),
    goal: {
      $tag: "SeCtor",
      ctor: "Pair",
      fields: [
        { $tag: "SetCtorField", key: fixtureKey(0), wireName: "a", set: enumS(5) },
        { $tag: "SetCtorField", key: fixtureKey(1), wireName: "b", set: enumS(9) },
      ],
    } as unknown as SetExpr,
    check: "false",
  },
  {
    name: "registered positional Pair 5 9 vs the POSITIONAL goal it really writes",
    member: "true",
    declared: { Pair: ["a", "b"] },
    node: { construct: ["Pair", 5, 9] },
    expr: EConstruct("Pair", [ELit(5), ELit(9)]),
    goal: ctorS("Pair", [["_0", enumS(5)], ["_1", enumS(9)]]),
    check: "true",
  },
  {
    name: "registered positional Pair 9 5 refutes against the same positional goal",
    member: "false",
    declared: { Pair: ["a", "b"] },
    node: { construct: ["Pair", 9, 5] },
    expr: EConstruct("Pair", [ELit(9), ELit(5)]),
    goal: ctorS("Pair", [["_0", enumS(5)], ["_1", enumS(9)]]),
    check: "false",
  },

  // ── the SeCtor "" anonymous-record goal ──
  {
    name: 'nullary P vs SeCtor "" [] (membership is ""-agnostic)',
    member: "true",
    node: { construct: ["P"] },
    expr: EConstruct("P", []),
    goal: ctorS("", []),
    check: "true",
  },
  {
    name: 'two-arg P 5 9 vs SeCtor "" [_0,_1]',
    member: "true",
    node: { construct: ["P", 5, 9] },
    expr: EConstruct("P", [ELit(5), ELit(9)]),
    goal: ctorS("", [["_0", enumS(5)], ["_1", enumS(9)]]),
    check: "true",
  },

  // ── Boolean arity (chk.ctor.bool-arity) ──
  {
    name: "nullary True vs {true} — the B5 coercion really does fire",
    member: "true",
    node: { construct: ["True"] },
    expr: EConstruct("True", []),
    goal: enumS(true),
    check: "true",
  },
  {
    name: "payload-bearing True 5 vs {true} — the coercion does NOT fire",
    member: "false",
    node: { construct: ["True", 5] },
    expr: EConstruct("True", [ELit(5)]),
    goal: enumS(true),
    check: "nothing",
  },

  // ── the unregistered sole-object write model (chk.ctor.sole-object) ──
  {
    name: "unregistered Ghost x — the runtime spreads the RAW IR key",
    member: "false",
    node: { construct: ["Ghost", { var: "x" }] },
    data: { x: 5 },
    expr: EConstruct("Ghost", [EVar("x")]),
    env: [{ name: "x", set: enumS(5) }],
    goal: ctorS("Ghost", [["_0", enumS(5)]]),
    check: "nothing",
  },
  {
    name: "unregistered Ghost 5 — positional at THIS surface, but the Expr is ambiguous",
    member: "true",
    node: { construct: ["Ghost", 5] },
    expr: EConstruct("Ghost", [ELit(5)]),
    goal: ctorS("Ghost", [["_0", enumS(5)]]),
    check: "nothing",
  },
  {
    name: "unregistered Ghost {a=x} — the legacy named branch writes `a`",
    member: "true",
    node: { construct: ["Ghost", { a: { var: "x" } }] },
    data: { x: 5 },
    expr: EConstruct("Ghost", [ERecord([["a", EVar("x")]])]),
    env: [{ name: "x", set: enumS(5) }],
    goal: ctorS("Ghost", [["a", enumS(5)]]),
    check: "nothing",
  },
  {
    name: "unregistered Ghost 5 5 — TWO args can never take the named branch",
    member: "true",
    node: { construct: ["Ghost", 5, 5] },
    expr: EConstruct("Ghost", [ELit(5), ELit(5)]),
    goal: ctorS("Ghost", [["_0", enumS(5)], ["_1", enumS(5)]]),
    check: "true",
  },

  // ── a REGISTERED sole argument: the positive and its adversary ──
  {
    name: "registered Wrap x — `var` is not declared, so the op stays positional",
    member: "true",
    declared: { Wrap: ["_0"] },
    node: { construct: ["Wrap", { var: "x" }] },
    data: { x: 5 },
    expr: EConstruct("Wrap", [EVar("x")]),
    env: [{ name: "x", set: enumS(5) }],
    goal: ctorS("Wrap", [["_0", enumS(5)]]),
    check: "true",
  },
  {
    name: "registered Sneaky x where the ctor DECLARES `var` — the write flips",
    member: "false",
    declared: { Sneaky: ["var"] },
    node: { construct: ["Sneaky", { var: "x" }] },
    data: { x: 5 },
    expr: EConstruct("Sneaky", [EVar("x")]),
    env: [{ name: "x", set: enumS(5) }],
    goal: ctorS("Sneaky", [["_0", enumS(5)]]),
    check: "nothing",
  },

  // ── the reserved-name fence (chk.ctor.reserved-name) ──
  {
    // TWO payload args on purpose: at ONE arg the sole-object abstention masks
    // this fence, so the row would pass with the fence reverted and prove
    // nothing. At two args the plan is determined and the ONLY thing standing
    // between the raw tag comparison and a `Just false` is the name fence.
    name: "@ctor/-namespaced source name — the runtime THROWS, so no verdict is entitled",
    node: { construct: ["@ctor/m/Owner/P", 5, 9] },
    expr: EConstruct("@ctor/m/Owner/P", [ELit(5), ELit(9)]),
    goal: ctorS("P", [["_0", enumS(5)], ["_1", enumS(9)]]),
    check: "nothing",
    throws: true,
  },
  {
    name: "the empty ctor name — the runtime THROWS here too",
    node: { construct: [""] },
    expr: EConstruct("", []),
    goal: ctorS("", []),
    check: "nothing",
    throws: true,
  },

  // ── the tag leg ──
  {
    name: "a distinct NAMED tag refutes",
    member: "false",
    node: { construct: ["Nothing"] },
    expr: EConstruct("Nothing", []),
    goal: ctorS("Just", [["_0", enumS(5)]]),
    check: "false",
  },

  // ── the missing-wire refutation ──
  {
    name: "a goal wire the write plan does not bind refutes",
    member: "false",
    node: { construct: ["Two", 5, 9] },
    expr: EConstruct("Two", [ELit(5), ELit(9)]),
    goal: ctorS("Two", [["a", enumS(5)]]),
    check: "false",
  },
];

describe("P1(a.12) two-path differential — the check face vs the value the runtime writes", () => {
  for (const row of ROWS) {
    test(row.name, () => {
      if (row.declared) {
        for (const [c, ws] of Object.entries(row.declared)) {
          __registerCtorDeclaredWiresFixtureForTests(c, ws);
        }
      }
      try {
        const a = runtimeSide(row.node, row.data ?? {}, row.goal, row.declared);
        const b = chk(row.expr, row.env ?? [], row.goal);
        // Path A must have DONE something. Without this the whole row degrades
        // to a tautology: a throw makes `member` "threw", `contradiction` false,
        // and the expected object below copies the actual values — so an
        // evaluation that crashed would pass silently. (Review finding 3.)
        expect({ row: row.name, threw: a.member === "threw" }).toEqual({ row: row.name, threw: row.throws === true });
        // Path A's verdict is DECLARED, never copied from what it produced.
        expect({ row: row.name, declaresMember: row.throws === true || row.member !== undefined })
          .toEqual({ row: row.name, declaresMember: true });
        if (row.member !== undefined) expect({ row: row.name, member: a.member }).toEqual({ row: row.name, member: row.member });
        // The hard stop.
        expect({ row: row.name, check: b, runtime: a.value, membership: a.member, contradiction: contradiction(b, a.member) })
          .toEqual({ row: row.name, check: b, runtime: a.value, membership: a.member, contradiction: false });
        if (row.check !== undefined) expect(b).toBe(row.check);
      } finally {
        __clearCtorDeclaredWiresFixturesForTests();
      }
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// The three fences with no natural two-path row: they move a cell from a
// definite to `Nothing` on an input the MEMBERSHIP face also abstains on, so
// there is nothing to contradict. They still need their own pin, or the
// DISCRIMINATES run cannot tell whether they are load-bearing or dead.
// ─────────────────────────────────────────────────────────────────────────────
describe("P1(a.12) — the abstention-only fences, each on its own pin", () => {
  test("the ctor face fence is the FULL judgment fence, not the embedded-wire one", async () => {
    // Two distinct semantic keys RESOLVING to one host property. The embedded
    // wires differ, so `fieldSemanticSlotsValid` is satisfied and the older
    // fence let the face decide; `seCtorFieldsFenceOk` reads the RESOLVED wire
    // and refuses, which is exactly what membership does — measured on the same
    // goal below, so the two faces abstain together rather than one deciding.
    const { __registerFieldCurrentWireFixtureForTests, __clearFieldCurrentWireFixturesForTests } =
      await import("./engine-bodies-dispatch");
    __registerFieldCurrentWireFixtureForTests("20000000-0000-4000-8000-000000000001", "same");
    __registerFieldCurrentWireFixtureForTests("20000000-0000-4000-8000-000000000002", "same");
    try {
      const aliased = {
        $tag: "SeCtor",
        ctor: "Al",
        fields: [
          { $tag: "SetCtorField", key: fixtureKey(0), wireName: "a", set: enumS(5) },
          { $tag: "SetCtorField", key: fixtureKey(1), wireName: "b", set: enumS(5) },
        ],
      } as unknown as SetExpr;
      expect(chk(EConstruct("Al", [ELit(5), ELit(5)]), [], aliased)).toBe("nothing");
      expect(tri(contains(aliased, { $tag: "Al", same: 5 } as never, null))).toBe("nothing");
    } finally {
      __clearFieldCurrentWireFixturesForTests();
    }
  });

  test("a NON-EMPTY source fields slot abstains; the EMPTY one is the positional sentinel", async () => {
    // synCtor emits `fields = []` for positional construction and the
    // partial-evaluate egress reads it that way, so [] MUST fall through — the
    // committed corpus's five constructor-producing expectations depend on it.
    // A non-empty slot does not pin the wires (its egress reading is decided by
    // the KEY), so it abstains rather than being trusted.
    const { __registerCtorDeclaredWiresFixtureForTests, __clearCtorDeclaredWiresFixturesForTests } =
      await import("./engine-bodies-dispatch");
    __registerCtorDeclaredWiresFixtureForTests("Wrap", ["_0"]);
    try {
      const goal = ctorS("Wrap", [["_0", enumS(5)]]);
      expect(chk({ $tag: "EConstruct", ctor: "Wrap", args: [ELit(5)], fields: [] }, [], goal)).toBe("true");
      expect(chk(
        { $tag: "EConstruct", ctor: "Wrap", args: [ELit(5)], fields: [{ key: fixtureKey(0), wireName: "a" }] },
        [],
        goal,
      )).toBe("nothing");
    } finally {
      __clearCtorDeclaredWiresFixturesForTests();
    }
  });

  test("the coercing goal ctor abstains, exactly as membership's own B5 arm does", () => {
    const goal = ctorS("True", [["_0", enumS(5)]]);
    expect(chk(EConstruct("True", [ELit(5)]), [], goal)).toBe("nothing");
    // membership refuses the same goal for the same reason — the B5 exclusion.
    expect(tri(contains(goal, { $tag: "True", _0: 5 } as never, null))).toBe("nothing");
  });

  test("duplicate pattern slot wires fence: marshalPatterns keeps only the LAST binder", () => {
    const kP0 = { $tag: "PositionalField", index: 0 } as unknown as FieldKey;
    const kP1 = { $tag: "PositionalField", index: 1 } as unknown as FieldKey;
    const scrut = {
      $tag: "SeUnion",
      branches: [
        { $tag: "SeCtor", ctor: "Nothing", fields: [] },
        { $tag: "SeCtor", ctor: "Just", fields: [
          { $tag: "SetCtorField", key: kP0, wireName: "_0", set: enumS(5) },
          { $tag: "SetCtorField", key: kP1, wireName: "_1", set: enumS(5) },
        ] },
      ],
    } as unknown as SetExpr;
    // Both slots claim the SAME host property; the runtime pattern object can
    // only carry one, so the classifier may not credit both binders.
    const dupPat = {
      $tag: "PatConstruct",
      ctor: "Just",
      args: [{ $tag: "PatVar", name: "y" }, { $tag: "PatVar", name: "z" }],
      // BOTH slots carry the SAME key AND the same wire, so each one passes the
      // per-slot wire consult on its own; only the slot-list fence sees that
      // the runtime pattern object can carry one `_0` property, so `y` is never
      // bound. A `{key: kP1, wireName: "_0"}` second slot would be caught by
      // the wire consult instead and would prove nothing about this fence.
      fields: [{ key: kP0, wireName: "_0" }, { key: kP0, wireName: "_0" }],
    };
    const e: Expr = {
      $tag: "EMatch",
      scrutinee: EVar("m"),
      arms: [
        { pattern: { $tag: "PatConstruct", ctor: "Nothing", args: [], fields: [] }, body: ELit(0) },
        { pattern: dupPat, body: EVar("y") },
      ],
    };
    expect(chk(e, [{ name: "m", set: scrut }], enumS(0, 5))).toBe("nothing");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P1(a.12) two-path differential — the MATCH face (chk.match.path-wire).
//
// Path A evaluates a real `{match: […]}` node against a real value and decides
// membership of the RESULT; path B is `checkExpr` on the corresponding
// `EMatch`. The interesting rows are the ones where the pattern's SPELLING and
// the branch field's effective wire disagree: the runtime matcher reads the
// spelling, so the arm may not fire at all and the match yields host `null`,
// while the pre-phase classifier answered "always" without ever reading it.
// ─────────────────────────────────────────────────────────────────────────────
describe("P1(a.12) two-path differential — the MATCH face", () => {
  const kP0 = { $tag: "PositionalField", index: 0 } as unknown as FieldKey;
  const kA = fixtureKey(0);
  const GOAL = enumS(0, 5);
  const branchOf = (key: FieldKey, wireName: string): SetExpr => ({
    $tag: "SeUnion",
    branches: [
      { $tag: "SeCtor", ctor: "Nothing", fields: [] },
      { $tag: "SeCtor", ctor: "Just", fields: [{ $tag: "SetCtorField", key, wireName, set: enumS(5) }] },
    ],
  } as unknown as SetExpr);
  const slotPat = (key: FieldKey, wireName: string) =>
    ({ $tag: "PatConstruct", ctor: "Just", args: [{ $tag: "PatVar", name: "y" }], fields: [{ key, wireName }] });
  const tagPat = (ctor: string) => ({ $tag: "PatConstruct", ctor, args: [], fields: [] });
  const matchExpr = (justArm: unknown, body: Expr): Expr => ({
    $tag: "EMatch",
    scrutinee: EVar("m"),
    arms: [{ pattern: tagPat("Nothing"), body: ELit(0) }, { pattern: justArm, body }],
  });
  // The surface twin: `{match: [scrutinee, pat, body, pat, body]}` (flat).
  const matchNode = (patWire: string) =>
    ({ match: [{ var: "m" }, { $tag: "Nothing" }, 0, { $tag: "Just", [patWire]: { $bind: "y" } }, { var: "y" }] });

  const rows: Array<{ name: string; patWire: string; valueWire: string; slotKey: FieldKey; branchWire: string; check: Tri; member: Tri }> = [
    {
      name: "POSITIONAL slot, spelling matches the branch wire — decides, and the runtime takes the arm",
      patWire: "_0", valueWire: "_0", slotKey: kP0, branchWire: "_0", check: "true", member: "true",
    },
    {
      name: "POSITIONAL slot, spelling does NOT match — fences (the runtime takes no arm and yields null)",
      patWire: "bogus", valueWire: "_0", slotKey: kP0, branchWire: "_0", check: "nothing", member: "false",
    },
    {
      name: "NAMED slot — staleness is runtime POLICY, so the classifier fences in every spelling",
      patWire: "a", valueWire: "a", slotKey: kA, branchWire: "a", check: "nothing", member: "true",
    },
    {
      name: "NAMED slot with a NONSENSE spelling — the measured chk.match.path-wire witness",
      patWire: "zzzNONSENSE", valueWire: "a", slotKey: kA, branchWire: "a", check: "nothing", member: "false",
    },
  ];

  for (const r of rows) {
    test(r.name, () => {
      const scrut = branchOf(r.slotKey, r.branchWire);
      const value = { $tag: "Just", [r.valueWire]: 5 };
      const a = runtimeSide(matchNode(r.patWire), { m: value }, GOAL);
      const b = chk(matchExpr(slotPat(r.slotKey, r.patWire), EVar("y")), [{ name: "m", set: scrut }], GOAL);
      // Path A must have DONE something here too — the ctor loop got this fix
      // first and the match loop kept the tautology. (Review round 2, finding 6.)
      expect({ row: r.name, threw: a.member === "threw" }).toEqual({ row: r.name, threw: false });
      // The match rows declare path A's verdict too. Without it a matcher that
      // wrongly IGNORED a bogus spelling, took the arm and returned 5 would
      // leave every fenced row green.
      expect({ row: r.name, member: a.member }).toEqual({ row: r.name, member: r.member });
      expect({ row: r.name, check: b, runtime: a.value, membership: a.member, contradiction: contradiction(b, a.member) })
        .toEqual({ row: r.name, check: b, runtime: a.value, membership: a.member, contradiction: false });
      expect(b).toBe(r.check);
    });
  }

  test("a reserved @ctor/ PATTERN tag fences rather than claiming an exact non-match", () => {
    // A WILDCARD follows it, so classifying the reserved tag "never" is not a
    // harmless abstention: the walk skips that arm, the wildcard covers the
    // branch, and the whole match answers Just true — while the runtime
    // PROJECTS the pattern tag through _constructorWireNames and may take the
    // first arm instead. The fence is what keeps that cell honest.
    const scrut = branchOf(kP0, "_0");
    const e: Expr = {
      $tag: "EMatch",
      scrutinee: EVar("m"),
      arms: [
        { pattern: tagPat("@ctor/m/Owner/Nothing"), body: ELit(7) },
        { pattern: { $tag: "PatLit", value: "_" }, body: ELit(0) },
      ],
    };
    expect(chk(e, [{ name: "m", set: scrut }], enumS(0))).toBe("nothing");
  });

  test("a reserved @ctor/ PATTERN tag, with no wildcard, also fences", () => {
    const scrut = branchOf(kP0, "_0");
    const e: Expr = {
      $tag: "EMatch",
      scrutinee: EVar("m"),
      arms: [
        { pattern: tagPat("@ctor/m/Owner/Nothing"), body: ELit(0) },
        { pattern: tagPat("Just"), body: EVar("m._0") },
      ],
    };
    expect(chk(e, [{ name: "m", set: scrut }], GOAL)).toBe("nothing");
  });

  test("the tag-only + dotted-path-var shape synCase emits still decides", () => {
    const scrut = branchOf(kP0, "_0");
    const e: Expr = {
      $tag: "EMatch",
      scrutinee: EVar("m"),
      arms: [
        { pattern: tagPat("Nothing"), body: ELit(0) },
        { pattern: tagPat("Just"), body: EVar("m._0") },
      ],
    };
    expect(chk(e, [{ name: "m", set: scrut }], GOAL)).toBe("true");
  });

  test("an aliased branch fences BEFORE any narrowing — even for a top-level PatVar arm", async () => {
    // The arm-level fence in `checkArmCtor` cannot cover this: a top-level
    // `PatVar` never reaches it. Only `checkMatchBranchOk` sees the branch, and
    // it must refuse before the binder narrows anything — which is exactly the
    // "fence before wildcard / PatVar narrowing" the phase owes.
    const { __registerFieldCurrentWireFixtureForTests, __clearFieldCurrentWireFixturesForTests } =
      await import("./engine-bodies-dispatch");
    __registerFieldCurrentWireFixtureForTests("20000000-0000-4000-8000-000000000001", "same");
    __registerFieldCurrentWireFixtureForTests("20000000-0000-4000-8000-000000000002", "same");
    try {
      const aliased = {
        $tag: "SeUnion",
        branches: [
          { $tag: "SeCtor", ctor: "Nothing", fields: [] },
          { $tag: "SeCtor", ctor: "Just", fields: [
            { $tag: "SetCtorField", key: fixtureKey(0), wireName: "a", set: enumS(0) },
            { $tag: "SetCtorField", key: fixtureKey(1), wireName: "b", set: enumS(0) },
          ] },
        ],
      } as unknown as SetExpr;
      const e: Expr = {
        $tag: "EMatch",
        scrutinee: EVar("m"),
        arms: [{ pattern: { $tag: "PatVar", name: "w" }, body: ELit(0) }],
      };
      expect(chk(e, [{ name: "m", set: aliased }], enumS(0))).toBe("nothing");
    } finally {
      __clearFieldCurrentWireFixturesForTests();
    }
  });

  test("a branch whose two semantic keys alias onto ONE host property fences the decomposition", async () => {
    const { __registerFieldCurrentWireFixtureForTests, __clearFieldCurrentWireFixturesForTests } =
      await import("./engine-bodies-dispatch");
    __registerFieldCurrentWireFixtureForTests("20000000-0000-4000-8000-000000000001", "same");
    __registerFieldCurrentWireFixtureForTests("20000000-0000-4000-8000-000000000002", "same");
    try {
      const aliased = {
        $tag: "SeUnion",
        branches: [
          { $tag: "SeCtor", ctor: "Nothing", fields: [] },
          { $tag: "SeCtor", ctor: "Just", fields: [
            { $tag: "SetCtorField", key: fixtureKey(0), wireName: "a", set: enumS(5) },
            { $tag: "SetCtorField", key: fixtureKey(1), wireName: "b", set: enumS(5) },
          ] },
        ],
      } as unknown as SetExpr;
      const e: Expr = {
        $tag: "EMatch",
        scrutinee: EVar("m"),
        arms: [
          { pattern: tagPat("Nothing"), body: ELit(0) },
          { pattern: tagPat("Just"), body: ELit(0) },
        ],
      };
      expect(chk(e, [{ name: "m", set: aliased }], GOAL)).toBe("nothing");
    } finally {
      __clearFieldCurrentWireFixturesForTests();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The CENSUS PIN for `checkCtorIrKeyReserved`.
//
// The sole-argument rule's completeness argument is that every raw-object
// preimage key of every Expr shape is either in that guarded list, or an
// operator notation, or the callee fnId, or a record field name. The first
// disjunct is a hand-written list against a CLOSED cascade in
// `json-logic-to-syntax.fenel`; if a future adapter arm adds a recognised op
// and nobody adds it here, the hole reopens silently. This pin makes it loud.
// ─────────────────────────────────────────────────────────────────────────────
describe("P1(a.12) census — the guarded IR-key list still covers jlsSingleKey's cascade", () => {
  test("every op jlsSingleKey recognises is guarded", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(repoFile("fenel/modules/engine/json-logic-to-syntax.fenel"), "utf8");
    const body = src.slice(src.indexOf("jlsSingleKey op rawArgs ctorDefs nullValue originalNode ="));
    const end = body.indexOf("\n\n@label");
    const cascade = end < 0 ? body : body.slice(0, end);
    const recognised = [...cascade.matchAll(/eq op "([^"]+)"/g)].map((m) => m[1]!);
    expect(recognised.length).toBeGreaterThan(10);
    const guarded = new Set([
      "var", "if", "?:", "let", "do", "fn", "call", "construct",
      "match", "and", "or", "where", "method", "ann", "$tag", "$bind", "$guard",
    ]);
    const unguarded = recognised.filter((op) => !guarded.has(op));
    expect(unguarded).toEqual([]);
  });

  test("the guarded list is mirrored in check.fenel byte-for-byte", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(repoFile("fenel/modules/engine/check.fenel"), "utf8");
    const i = src.indexOf("checkCtorIrKeyReserved n =");
    expect(i).toBeGreaterThan(0);
    const line = src.slice(i, src.indexOf("\n\n", i));
    for (const op of ["var", "if", "?:", "let", "do", "fn", "call", "construct", "match", "and", "or", "where", "method", "ann", "$tag", "$bind", "$guard"]) {
      expect(line).toContain(`"${op}"`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ROUND-2 REPLACEMENTS. The first cut of the three blocks below was reviewed and
// found to pin less than it claimed; each one now states what would make it go
// red. Kept as separate describes so the DISCRIMINATES script's expected titles
// stay stable.
// ─────────────────────────────────────────────────────────────────────────────

describe("P1(a.12) — the exercise-context rule, REPAIRED (chk.ctor.ctx-authority)", () => {
  const kP0 = { $tag: "PositionalField", index: 0 } as unknown as FieldKey;
  const arrow = {
    $tag: "SeArrow",
    params: [{ $tag: "SetArrowParam", key: kP0, wireName: "_0", set: enumS(5) }],
    returns: { $tag: "SeCtor", ctor: "Just", fields: [{ $tag: "SetCtorField", key: kP0, wireName: "_0", set: enumS(5) }] },
  } as unknown as SetExpr;
  const closure = { __fenelFn: true, params: ["x"], body: { construct: ["Just", { var: "x" }] }, closure: {} };

  test("a public caller that supplies NO exercise context gets NO definite", async () => {
    const { contains } = await import("./set-algebra");
    const { evaluate: ev } = await import("./json-logic");
    // Before the repair this was `Just true`, taken from the decider's own
    // engine-harness table — while the body under the default context writes the
    // RAW IR key and membership refutes. Both halves are asserted, so a
    // regression in either one goes red.
    expect(tri(contains(arrow, closure as never, null))).toBe("nothing");
    expect(ev({ construct: ["Just", { var: "x" }] } as never, { x: 5 })).toEqual({ $tag: "Just", var: "x" } as never);
  });

  test("the verdict follows the SUPPLIED table, not the presence of a context", async () => {
    const { contains } = await import("./set-algebra");
    // type-substrate P1(a.20) — the supplied tables below are now FROZEN, and
    // the freeze is load-bearing rather than cosmetic. A read is a claim about
    // what the runtime will do LATER, so it is entitled only when the table it
    // read cannot move in between. A hand-built mutable literal cannot support
    // that claim — `ctx._constructors.Just = ["var"]` after certification is
    // `chk.ctor.table-mutation`'s round-5 route, and it needs no `type_def`
    // anywhere. The a.12 property this test exists for (AGREEMENT, not mere
    // presence) is unchanged; the immutable rows below still assert all four
    // of its cells. The unfrozen counterparts moved to the `nothing` rows in
    // the P1(a.20) block at the end of this file, where they discriminate.
    const frozenCtx = (t: Record<string, readonly string[]>): never =>
      Object.freeze({
        _constructors: Object.freeze(
          Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Object.freeze(v)])),
        ),
      }) as never;
    // An empty context declares nothing, so `Just` is unregistered there and the
    // sole-argument rule abstains…
    expect(tri(contains(arrow, closure as never, null, undefined, Object.freeze({}) as never))).toBe("nothing");
    // …a context that declares it positionally decides, because the op then
    // writes `_0`…
    expect(tri(contains(arrow, closure as never, null, undefined, frozenCtx({ Just: ["_0"] })))).toBe("true");
    // …and so does one that declares an unrelated field name, because the raw
    // key `var` is still not declared and the op still binds positionally. It is
    // AGREEMENT between the certifying and exercising tables that matters, not
    // the mere presence of a context.
    expect(tri(contains(arrow, closure as never, null, undefined, frozenCtx({ Just: ["value"] })))).toBe("true");
    // The stated consequence of the rule: a context that DECLARES the raw key
    // makes the op take the named branch, and the face must not decide.
    expect(tri(contains(arrow, closure as never, null, undefined, frozenCtx({ Just: ["var"] })))).toBe("nothing");
  });

  test("the INTERNAL harness dispatch keeps its own context as the exercise context", () => {
    // `dispatchEngineBodyWithDeciderCtx` never installs the carrier property at
    // all, which is what distinguishes it from a public decider entry that
    // supplied nothing. Its own harness IS the context those bodies run in, so
    // a registered constructor still decides there. If that distinction were
    // dropped, this row would go `nothing` and the committed decide corpus would
    // lose three of its expectations.
    expect(chk(EConstruct("Just", [EVar("_0")]), [{ name: "_0", set: enumS(5) }],
      ctorS("Just", [["_0", enumS(5)]]))).toBe("true");
  });
});

describe("P1(a.12/a.20) — chk.ctor.table-mutation: the routes FENCED, and the residual that is not", () => {
  const kP0 = { $tag: "PositionalField", index: 0 } as unknown as FieldKey;
  const arrow = {
    $tag: "SeArrow",
    params: [{ $tag: "SetArrowParam", key: kP0, wireName: "_0", set: enumS(5) }],
    returns: { $tag: "SeCtor", ctor: "D", fields: [{ $tag: "SetCtorField", key: kP0, wireName: "_0", set: enumS(5) }] },
  } as unknown as SetExpr;
  const mkClosure = () =>
    ({ __fenelFn: true, params: ["x"], body: { construct: ["D", { var: "x" }] }, closure: {} });

  // ⚠ WHY THIS BLOCK WAS REWRITTEN AT P1(a.20), stated so the next reader does
  // not read the change as a weakening. The old single test certified against a
  // MUTABLE `{_constructors: {D: ["value"]}}` literal and asserted `Just true`.
  // That definite is exactly the one P1(a.20) withdrew: a read is a claim about
  // exercise time, and a mutable table cannot support one. Keeping the old
  // assertion would have pinned the defect as the entitlement. The row's TWO
  // routes are now pinned separately — and the one B1 would have removed is no
  // longer the only evidence, which was the trap: had `type_def` been
  // restructured first, the row's whole pin would have evaporated while its
  // `_constructors` route stayed live and unpinned.

  test("ROUTE 1 (`_constructors` assignment, no `type_def` anywhere) is FENCED at certification", async () => {
    const { contains } = await import("./set-algebra");
    const { evaluate: ev, invokeCallable } = await import("./json-logic");
    const closure = mkClosure();
    // The round-5 route verbatim: a MUTABLE public record the caller still holds.
    const ctx = { _constructors: { D: ["value"] } } as never;
    // The certificate is REFUSED now. Before P1(a.20) this was `Just true`, and
    // the four lines below are what made that a false definite.
    expect(tri(contains(arrow, closure as never, null, undefined, ctx))).toBe("nothing");
    (ctx as unknown as { _constructors: Record<string, string[]> })._constructors.D = ["var"];
    const after = invokeCallable(closure, [5], ctx);
    expect(after).toEqual({ $tag: "D", var: "x" } as never);
    expect(tri(contains((arrow as unknown as { returns: SetExpr }).returns, after as never, null, undefined, ctx))).toBe("false");
    void ev;
  });

  test("ROUTE 2 (`type_def` on the same context) is FENCED at certification", async () => {
    const { contains } = await import("./set-algebra");
    const { evaluate: ev, invokeCallable } = await import("./json-logic");
    const closure = mkClosure();
    const ctx = { _constructors: { D: ["value"] } } as never;
    expect(tri(contains(arrow, closure as never, null, undefined, ctx))).toBe("nothing");
    ev({ type_def: { name: "D", constructors: [{ name: "D", fields: [{ name: "var", type: "String" }] }] } } as never, {}, ctx);
    // EXERCISE **THE CERTIFIED CLOSURE**, not a separately written twin — the
    // a.12 discipline, retained.
    const after = invokeCallable(closure, [5], ctx);
    expect(after).toEqual({ $tag: "D", var: "x" } as never);
    expect(tri(contains((arrow as unknown as { returns: SetExpr }).returns, after as never, null, undefined, ctx))).toBe("false");
  });

  test("THE RESIDUAL, pinned as the defect it remains: a FROZEN table still admits a later `type_def`", async () => {
    const { contains } = await import("./set-algebra");
    const {
      evaluate: ev,
      invokeCallable,
      __clearDynamicConstructorTableForTests: clearDyn,
    } = await import("./json-logic");
    const closure = mkClosure();
    // Everything the fence can check is TRUE here: the context is frozen, the
    // table is frozen, the entry array is frozen, and no dynamic table is in
    // force. So the certificate is issued…
    const ctx = Object.freeze({
      _constructors: Object.freeze({ D: Object.freeze(["value"]) }),
    }) as never;
    expect(tri(contains(arrow, closure as never, null, undefined, ctx))).toBe("true");
    try {
      // …and a `type_def` executed on that same frozen context AFTERWARDS still
      // installs a shadow table, because the WeakMap is EXTERNAL to the freeze.
      ev({ type_def: { name: "D", constructors: [{ name: "D", fields: [{ name: "var", type: "String" }] }] } } as never, {}, ctx);
      const after = invokeCallable(closure, [5], ctx);
      expect(after).toEqual({ $tag: "D", var: "x" } as never);
      expect(tri(contains((arrow as unknown as { returns: SetExpr }).returns, after as never, null, undefined, ctx))).toBe("false");
      // THIS is `chk.ctor.table-mutation`'s stated side condition, and it is a
      // side condition rather than a theorem precisely because no read-time
      // check can see a FUTURE declaration. Closing it structurally means the
      // dynamic table living ON the frozen context (so a declaration extends a
      // scope instead of mutating one), or `type_def` refusing a frozen
      // authority. Both are filed; neither is P1(a.20)'s.
      expect(tri(contains(arrow, closure as never, null, undefined, ctx))).toBe("nothing");
    } finally {
      // Leaving the shadow table installed would make every later read against
      // this context abstain for the wrong reason.
      clearDyn(ctx);
    }
  });
});

describe("P1(a.12) — the positional pattern entitlement, with the exclusion made LOAD-BEARING", () => {
  test("a positional spelling reads raw under raw / identified+strict / identified+legacy / account-only", async () => {
    const { matchPattern } = await import("./json-logic");
    const kA = fixtureKey(0);
    const kB = fixtureKey(1);
    // The identity tables deliberately DO NOT list `_0` as a wire. If the
    // positional exclusion in `isNamedPatternField` were removed, `_0` would
    // enter the plan, be marked STALE, and the strict row below would return
    // null instead of a binding — which is what makes this pin load-bearing
    // rather than a restatement of the table.
    const namedOnly = { _ctorFieldKeys: { Just: [{ wire: "a", key: kA }] } };
    // The account-only shape: the ctor's live wire is an account-current name
    // that appears nowhere in the value, the `fi.wire.snapshot` situation.
    const accountOnly = { _ctorFieldKeys: { Just: [{ wire: "title", key: kB }] }, _strictPatternFields: true };
    const contexts = {
      raw: {} as never,
      strict: { ...namedOnly, _strictPatternFields: true } as never,
      legacy: { ...namedOnly, _strictPatternFields: false } as never,
      accountOnly: accountOnly as never,
    };
    const value = { $tag: "Just", _0: 5, a: 7 };
    for (const [name, ctx] of Object.entries(contexts)) {
      const bound = matchPattern(value, { $tag: "Just", _0: { $bind: "y" } }, ctx);
      expect({ ctx: name, bound: bound === null ? null : { ...bound } }).toEqual({ ctx: name, bound: { y: 5 } });
      // A spelling the VALUE does not carry takes no arm in any policy — which
      // is a statement about the value, not about staleness.
      expect({ ctx: name, absent: matchPattern(value, { $tag: "Just", zzz: { $bind: "y" } }, ctx) })
        .toEqual({ ctx: name, absent: null });
    }
    // And the control that shows the tables above are actually consulted: a
    // NAMED spelling that IS a declared wire binds under the named-only tables,
    // and one that is not is refused under strict while raw-read under legacy.
    expect({ ...(matchPattern(value, { $tag: "Just", a: { $bind: "y" } }, contexts.strict) ?? {}) }).toEqual({ y: 7 });
    expect(matchPattern(value, { $tag: "Just", a: { $bind: "y" } }, contexts.accountOnly)).toBeNull();

    // ⚠ THE STALE CASE, with a value that actually CARRIES the spelling. The
    // first cut of this pin used a value without it, so "a stale spelling takes
    // no arm in ANY policy" passed vacuously and was FALSE (review round 9):
    // only STRICT refuses a stale spelling. Raw and legacy read it raw and BIND.
    // That is exactly why `checkArmSlotWireOk` is positional-only — a named
    // spelling's outcome is runtime POLICY, and the three policies disagree.
    const carries = { $tag: "Just", _0: 5, a: 7, zzz: 9 };
    expect(matchPattern(carries, { $tag: "Just", zzz: { $bind: "y" } }, contexts.strict)).toBeNull();
    expect({ ...(matchPattern(carries, { $tag: "Just", zzz: { $bind: "y" } }, contexts.raw) ?? {}) }).toEqual({ y: 9 });
    expect({ ...(matchPattern(carries, { $tag: "Just", zzz: { $bind: "y" } }, contexts.legacy) ?? {}) }).toEqual({ y: 9 });
  });
});

describe("P1(a.12) — the anonymous-record return synthesizes a SOUND, RUNNABLE witness", () => {
  test("the witness is the record literal, it executes, and its result is a MEMBER of the return set", async () => {
    const { evaluate: ev } = await import("./json-logic");
    const { contains } = await import("./set-algebra");
    const kP0 = { $tag: "PositionalField", index: 0 } as unknown as FieldKey;
    const returns = { $tag: "SeCtor", ctor: "", fields: [{ $tag: "SetCtorField", key: kP0, wireName: "_0", set: { $tag: "SeRef", handle: "Int" } }] } as unknown as SetExpr;
    const goal = {
      $tag: "SeArrow",
      params: [{ $tag: "SetArrowParam", key: kP0, wireName: "_0", set: { $tag: "SeRef", handle: "Int" } }],
      returns,
    } as unknown as SetExpr;
    const out = dispatchEngineBodyWithDeciderCtx("engine:synthesizeArrow", [8, goal]) as
      { $tag?: string; _0?: { body?: unknown } };
    // A `TvUnknown` here would be a silent capability loss, so the outcome is
    // asserted, not merely branched on.
    expect(out?.$tag).toBe("TvFound");
    const body = out._0!.body;
    // The failure the §0.05 H obligation names: a construct of the empty name,
    // kernel-certified and guaranteed to THROW at runtime.
    expect(JSON.stringify(body).includes('"construct":[""')).toBe(false);
    // The witness the realizer actually emits, pinned exactly — a weaker
    // "does not throw" check passed for `{bogus:0}` and for a missing body.
    expect(body).toEqual({ _0: 0 } as never);
    // …and the WITNESS must run and land IN the return set. Evaluating the body
    // directly would pass for a `TvFound` carrying no closure envelope at all,
    // so the invocation goes through the callable path.
    const { invokeCallable } = await import("./json-logic");
    const applied = invokeCallable(out._0, [7], {} as never);
    expect(tri(contains(returns, applied as never, null))).toBe("true");
    void ev;

    // The NULLARY goal is the one that discriminates the dependency this row
    // claims: with the reserved-name fence removed, the realizer's missing
    // `c == ""` guard makes `EConstruct "" []` the selected candidate here,
    // because the sole-argument decoder does not independently abstain.
    const nullary = { $tag: "SeArrow", params: [], returns: { $tag: "SeCtor", ctor: "", fields: [] } } as unknown as SetExpr;
    const outN = dispatchEngineBodyWithDeciderCtx("engine:synthesizeArrow", [8, nullary]) as
      { $tag?: string; _0?: { body?: unknown } };
    expect(outN?.$tag).toBe("TvFound");
    expect(JSON.stringify(outN._0!.body).includes('"construct":[""')).toBe(false);
    expect(outN._0!.body).toEqual({} as never);
    // Assert the APPLIED value and its membership, exactly as the unary half
    // does. "does not throw" is not a soundness check: `invokeCallable` returns
    // `null` for a non-callable rather than throwing, so a `TvFound` carrying
    // no closure envelope passed this assertion while its result was not in the
    // return set at all (review round 5).
    const appliedN = invokeCallable(outN._0, [], {} as never);
    expect(appliedN).toEqual({} as never);
    expect(tri(contains({ $tag: "SeCtor", ctor: "", fields: [] } as unknown as SetExpr, appliedN as never, null))).toBe("true");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ROUND-3 additions. The exercise-context repair covers the PUBLIC `contains`
// lane; review round 3 established that it does not cover the WITNESS lane, and
// that the carrier test itself was forgeable. Both are pinned here — the first
// as the defect it still is, the second as the repair it now has.
// ─────────────────────────────────────────────────────────────────────────────
describe("P1(a.12) — the witness lane, still unrepaired (syn.witness.ctx-authority)", () => {
  test("witnessOf hands back a body certified under a context its caller does not have", async () => {
    const { witnessOf, contains } = await import("./set-algebra");
    const { invokeCallable } = await import("./json-logic");
    const kP0 = { $tag: "PositionalField", index: 0 } as unknown as FieldKey;
    const returns = { $tag: "SeCtor", ctor: "Just", fields: [{ $tag: "SetCtorField", key: kP0, wireName: "_0", set: enumS(5) }] } as unknown as SetExpr;
    const arrow = { $tag: "SeArrow", params: [{ $tag: "SetArrowParam", key: kP0, wireName: "_0", set: enumS(5) }], returns } as unknown as SetExpr;

    const w = witnessOf(arrow) as { $tag?: string; _0?: unknown };
    // `witnessOf` takes no evaluate context at all, so it is certified under the
    // internal harness — where `Just` is declared `["_0"]` and the op binds
    // positionally.
    expect(w?.$tag).toBe("Just");
    // The defect: a caller applying that witness under its own (here default)
    // context gets a value the return set does not contain.
    const applied = invokeCallable(w._0, [5], {} as never);
    expect(applied).toEqual({ $tag: "Just", var: "_0" } as never);
    expect(tri(contains(returns, applied as never, null))).toBe("false");
    // The public re-certification lane IS repaired — it now abstains rather than
    // re-asserting the harness's answer — which is exactly why the residual is a
    // WITNESS-lane row and not a `contains` one.
    expect(tri(contains(arrow, w._0 as never, null))).toBe("nothing");
  });
});

describe("P1(a.12) — the ctor-wires test seam cannot manufacture OR override authority", () => {
  const kP0 = { $tag: "PositionalField", index: 0 } as unknown as FieldKey;
  const returns = { $tag: "SeCtor", ctor: "FixtureCarrierOnly", fields: [{ $tag: "SetCtorField", key: kP0, wireName: "_0", set: enumS(5) }] } as unknown as SetExpr;
  const arrow = { $tag: "SeArrow", params: [{ $tag: "SetArrowParam", key: kP0, wireName: "_0", set: enumS(5) }], returns } as unknown as SetExpr;
  const closure = { __fenelFn: true, params: ["x"], body: { construct: ["FixtureCarrierOnly", { var: "x" }] }, closure: {} };

  test("a registered fixture does not resurrect the fenced NO-CONTEXT lane", async () => {
    const { contains } = await import("./set-algebra");
    const { evaluate: ev } = await import("./json-logic");
    const { __registerCtorDeclaredWiresFixtureForTests: reg, __clearCtorDeclaredWiresFixturesForTests: clr } =
      await import("./engine-bodies-dispatch");
    reg("FixtureCarrierOnly", ["_0"]);
    try {
      expect(tri(contains(arrow, closure as never, null))).toBe("nothing");
      // Path A, which this half was missing while the write-up claimed all
      // three had it (review round 8): under the default context the op takes
      // its unregistered legacy branch, so the fixture's positional claim is
      // contradicted by what actually runs.
      const v = ev({ construct: ["FixtureCarrierOnly", { var: "x" }] } as never, { x: 5 });
      expect(v).toEqual({ $tag: "FixtureCarrierOnly", var: "x" } as never);
      expect(tri(contains(returns, v as never, null))).toBe("false");
    } finally { clr(); }
  });

  test("a registered fixture does not OVERRIDE a table the caller SUPPLIED", async () => {
    const { contains } = await import("./set-algebra");
    const { evaluate: ev } = await import("./json-logic");
    const { __registerCtorDeclaredWiresFixtureForTests: reg, __clearCtorDeclaredWiresFixturesForTests: clr } =
      await import("./engine-bodies-dispatch");
    reg("FixtureCarrierOnly", ["_0"]);
    try {
      // The caller supplied an EMPTY context: nothing is declared there, so the
      // op takes its unregistered legacy branch and writes the raw IR key. With
      // the seam unconditional this answered `Just true` — a fixture
      // contradicting the caller's own table (review round 7).
      expect(tri(contains(arrow, closure as never, null, undefined, {} as never))).toBe("nothing");
      expect(ev({ construct: ["FixtureCarrierOnly", { var: "x" }] } as never, { x: 5 }, {} as never))
        .toEqual({ $tag: "FixtureCarrierOnly", var: "x" } as never);
      // …and a caller who DOES declare it decides, from its own table —
      // FROZEN, since P1(a.20): a mutable table the caller still holds cannot
      // support a claim about what the runtime will do later.
      expect(tri(contains(arrow, closure as never, null, undefined, Object.freeze({
        _constructors: Object.freeze({ FixtureCarrierOnly: Object.freeze(["_0"]) }),
      }) as never))).toBe("true");
    } finally { clr(); }
  });

  test("a registered fixture does not override a CONFLICTING supplied table", async () => {
    const { contains } = await import("./set-algebra");
    const { evaluate: ev } = await import("./json-logic");
    const { __registerCtorDeclaredWiresFixtureForTests: reg, __clearCtorDeclaredWiresFixturesForTests: clr } =
      await import("./engine-bodies-dispatch");
    reg("FixtureCarrierOnly", ["_0"]);
    try {
      // The caller declares the RAW IR KEY, so the op takes its named branch and
      // writes `var`; the fixture claims positional. The empty-table and
      // matching-table halves above cannot tell a conflicting override from a
      // correct abstention — this one can (review round 9).
      const conflicting = { _constructors: { FixtureCarrierOnly: ["var"] } } as never;
      expect(tri(contains(arrow, closure as never, null, undefined, conflicting))).toBe("nothing");
      expect(ev({ construct: ["FixtureCarrierOnly", { var: "x" }] } as never, { x: 5 }, conflicting))
        .toEqual({ $tag: "FixtureCarrierOnly", var: "x" } as never);
    } finally { clr(); }
  });

  test("on the INTERNAL harness lane the seam SUBSTITUTES for a table the harness lacks — chk.ctor.fixture-seam", async () => {
    const { contains } = await import("./set-algebra");
    const { evaluate: ev } = await import("./json-logic");
    const { __registerCtorDeclaredWiresFixtureForTests: reg, __clearCtorDeclaredWiresFixturesForTests: clr } =
      await import("./engine-bodies-dispatch");
    reg("FixtureCarrierOnly", ["_0"]);
    try {
      const goal = ctorS("FixtureCarrierOnly", [["_0", enumS(5)]]);
      expect(chk(EConstruct("FixtureCarrierOnly", [EVar("x")]), [{ name: "x", set: enumS(5) }], goal)).toBe("true");
      // ⚠ STATE WHAT THIS IS. The harness's own table does NOT declare this tag,
      // so the definite above comes from the SEAM and not from the lane's real
      // authority — an executable false `Just` for as long as a fixture is
      // registered (review round 9, filed as `chk.ctor.fixture-seam`). The pin
      // asserts that gap rather than papering over it.
      // THE harness `chk` uses, not a smaller twin of it. The first cut built a
      // two-module bootstrap and called it "the real harness"; `chk` goes
      // through `getHarness()`, whose registry is much larger, so the pin was
      // asserting a contradiction against a table nobody consults (review round
      // 10 — the same fabrication round 9 objected to, one level over).
      const { harnessForTests } = await import("./engine-bodies-dispatch");
      const harnessCtx = harnessForTests().ctx as unknown as
        { _constructors?: Record<string, readonly string[]> };
      expect(harnessCtx._constructors?.FixtureCarrierOnly).toBeUndefined();
      expect(ev({ construct: ["FixtureCarrierOnly", { var: "x" }] } as never, { x: 5 }, harnessCtx as never))
        .toEqual({ $tag: "FixtureCarrierOnly", var: "x" } as never);
      // …and under a context that DOES declare what the fixture claims, the two
      // faces agree — which is the only configuration in which the seam's answer
      // is backed by anything.
      const v = ev({ construct: ["FixtureCarrierOnly", { var: "x" }] } as never, { x: 5 },
        { _constructors: { FixtureCarrierOnly: ["_0"] } } as never);
      expect(v).toEqual({ $tag: "FixtureCarrierOnly", _0: 5 } as never);
      expect(tri(contains(goal, v as never, null))).toBe("true");
    } finally { clr(); }
  });
});

describe("P1(a.12) — the carrier test is an OWN DATA property, not `in`", () => {
  test("a prototype-chain `_setAlgebraEvalCtx` cannot forge caller authority", () => {
    const kP0 = { $tag: "PositionalField", index: 0 } as unknown as FieldKey;
    const goal = { $tag: "SeCtor", ctor: "ProtoCarrierOnly", fields: [{ $tag: "SetCtorField", key: kP0, wireName: "_0", set: enumS(5) }] } as unknown as SetExpr;
    const term = { $tag: "EConstruct", ctor: "ProtoCarrierOnly", args: [EVar("x")], fields: [] };
    const proto = Object.prototype as unknown as Record<string, unknown>;
    Object.defineProperty(proto, "_setAlgebraEvalCtx", {
      value: { _constructors: { ProtoCarrierOnly: ["_0"] } },
      enumerable: false,
      configurable: true,
    });
    try {
      // With an `in` test this answered `Just true`, reading an attacker-placed
      // table as if a caller had supplied it — while the default context writes
      // the raw IR key and membership refutes.
      expect(chk(term, [{ name: "x", set: enumS(5) }], goal)).toBe("nothing");
    } finally {
      delete proto._setAlgebraEvalCtx;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// type-substrate P1(a.20) — AMBIENT AUTHORITY. The judgment stops reading what
// it was not handed.
//
// One rule, four ledger rows. A decider's verdict is a claim about what the
// runtime will do; it is entitled only if the authority the decider READ is the
// authority the exercise will read. Three separate defects were that one
// sentence violated three ways: an authority reached through a side table keyed
// on host IDENTITY (so a context COPY loses it), an authority reached through a
// process GLOBAL (so the caller's own registry is never consulted), and an
// authority that can MOVE between the read and the exercise.
//
// Everything below is MONOTONE — every cell it changes goes from a definite to
// `Nothing` — except the `fi.wire.snapshot` pair, which INVERTS to the correct
// polarity and is Step B.
// ─────────────────────────────────────────────────────────────────────────────

describe("P1(a.20) — chk.ctor.harness-copy: the harness lane reads the ORIGINAL, not the copy", () => {
  test("a dynamic table the COPY cannot see now fences the harness lane", async () => {
    const {
      evaluate: ev,
      constructorDeclaredFieldNames,
      __clearDynamicConstructorTableForTests: clearDyn,
    } = await import("./json-logic");
    const { harnessForTests } = await import("./engine-bodies-dispatch");
    const { contains } = await import("./set-algebra");
    const harnessCtx = harnessForTests().ctx;
    const goal = ctorS("Just", [["_0", enumS(5)]]);
    const term = EConstruct("Just", [EVar("x")]);
    const env = [{ name: "x", set: enumS(5) }];

    // The harness lane decides for `Just` in its ordinary state. Asserted FIRST,
    // because a pin whose "before" is already `nothing` proves nothing about the
    // fence — it would pass with the whole mechanism deleted.
    expect(chk(term, env, goal)).toBe("true");

    // The harness's `_constructors` record is NON-EXTENSIBLE, so this witness
    // cannot inject a declaration and must ride a tag the harness already
    // declares. (The ledger row's recipe omitted that; corrected here.)
    expect((harnessCtx as unknown as { _constructors?: Record<string, readonly string[]> })
      ._constructors?.Just).toEqual(["_0"]);

    try {
      // Re-point `Just` on the REAL harness context.
      // `dispatchEngineBodyWithDeciderCtx` hands the decider bodies `{...ctx}`,
      // and this table is WeakMap-keyed on context IDENTITY — so the copy
      // provably cannot see it.
      ev({ type_def: { name: "Just", constructors: [{ name: "Just", fields: [{ name: "var", type: "String" }] }] } } as never, {}, harnessCtx);
      // The exercise authority now says `["var"]`…
      expect(constructorDeclaredFieldNames(harnessCtx, "Just")).toEqual(["var"] as never);
      // …and the check face ABSTAINS instead of answering from the copy's stale
      // view. Before P1(a.20) this was `Just true` while the exercise took the
      // named branch — the whole of `chk.ctor.harness-copy`.
      expect(chk(term, env, goal)).toBe("nothing");
      // The contradiction it used to license, asserted so the pin cannot go
      // green because the EXERCISE changed rather than the fence.
      const v = ev({ construct: ["Just", { var: "x" }] } as never, { x: 5 }, harnessCtx);
      expect(v).toEqual({ $tag: "Just", var: "x" } as never);
      expect(tri(contains(goal, v as never, null, undefined, harnessCtx))).toBe("false");
    } finally {
      clearDyn(harnessCtx);
    }
    // …and the lane is restored, so nothing later in this process inherits a
    // fence that fires for the wrong reason.
    expect(chk(term, env, goal)).toBe("true");
  });
});

describe("P1(a.20) — the ctor read is entitled only by a table it can PROVE cannot move", () => {
  const kP0 = { $tag: "PositionalField", index: 0 } as unknown as FieldKey;
  const arrow = {
    $tag: "SeArrow",
    params: [{ $tag: "SetArrowParam", key: kP0, wireName: "_0", set: enumS(5) }],
    returns: { $tag: "SeCtor", ctor: "Just", fields: [{ $tag: "SetCtorField", key: kP0, wireName: "_0", set: enumS(5) }] },
  } as unknown as SetExpr;
  const closure = { __fenelFn: true, params: ["x"], body: { construct: ["Just", { var: "x" }] }, closure: {} };

  test("each of the four freeze conditions DISCRIMINATES on its own", async () => {
    const { contains } = await import("./set-algebra");
    const ask = (ctx: unknown): Tri => tri(contains(arrow, closure as never, null, undefined, ctx as never));

    // The fully immutable authority: entitled.
    expect(ask(Object.freeze({ _constructors: Object.freeze({ Just: Object.freeze(["_0"]) }) }))).toBe("true");

    // 1. the CONTEXT is not frozen ⇒ `_constructors` can be replaced wholesale.
    expect(ask({ _constructors: Object.freeze({ Just: Object.freeze(["_0"]) }) })).toBe("nothing");
    // 2. `_constructors` is not frozen ⇒ an entry can be replaced. This is
    //    `chk.ctor.table-mutation`'s round-5 route.
    expect(ask(Object.freeze({ _constructors: { Just: Object.freeze(["_0"]) } }))).toBe("nothing");
    // 3. the ENTRY ARRAY is not frozen ⇒ `table.Just[0] = "var"` moves the answer
    //    AFTER the read, because `constructorDeclaredFieldNames` hands back the
    //    array ITSELF. A three-condition check passes this row and is wrong.
    expect(ask(Object.freeze({ _constructors: Object.freeze({ Just: ["_0"] }) }))).toBe("nothing");
    // …and the element mutation that makes condition 3 load-bearing rather than
    // decorative, executed.
    {
      const shallow = Object.freeze({ _constructors: Object.freeze({ Just: ["_0"] }) });
      (shallow._constructors.Just as string[])[0] = "var";
      expect(shallow._constructors.Just).toEqual(["var"]);
    }
  });

  test("4. a dynamic table already in force fences even a fully frozen authority", async () => {
    const { contains } = await import("./set-algebra");
    const { evaluate: ev, __clearDynamicConstructorTableForTests: clearDyn } = await import("./json-logic");
    const ctx = Object.freeze({ _constructors: Object.freeze({ Just: Object.freeze(["_0"]) }) }) as never;
    expect(tri(contains(arrow, closure as never, null, undefined, ctx))).toBe("true");
    try {
      // A declaration for an UNRELATED tag. The condition is not "did someone
      // re-point MY tag" but "does `type_def` demonstrably run on this
      // authority" — a table in force is proof that it does, and the record it
      // installs is handed out by reference and mutated in place.
      ev({ type_def: { name: "P1a20Unrelated", constructors: [{ name: "P1a20Unrelated", fields: [] }] } } as never, {}, ctx);
      expect(tri(contains(arrow, closure as never, null, undefined, ctx))).toBe("nothing");
    } finally {
      clearDyn(ctx);
    }
    expect(tri(contains(arrow, closure as never, null, undefined, ctx))).toBe("true");
  });
});

describe("P1(a.20) — fi.wire.snapshot: the wire read consults the CALLER's registry", () => {
  const ACCOUNT_FIELD = "3c1f9a52-7d64-4b18-9f0e-2a5c7e13b4d8";
  const persisted = {
    $tag: "SeCtor",
    ctor: "",
    fields: [{
      $tag: "SetCtorField",
      key: { $tag: "NamedField", ref: { $ref: ACCOUNT_FIELD } },
      wireName: "oldTitle",
      set: { $tag: "SeAll" },
    }],
  } as unknown as SetExpr;

  const accountRegistry = async () => {
    const { createAccountFieldRegistry } = await import("./account-field-registry");
    return createAccountFieldRegistry([], "p1a20-account", {
      owners: [{
        ownerKey: "type:p1a20-article",
        kind: "type",
        storageName: "p1a20-article",
        definition: {
          id: "P1a20Article",
          type: {
            $record: {
              fields: [{
                name: "title",
                key: { $tag: "NamedField", ref: { $ref: ACCOUNT_FIELD } },
                type: { $ref: "String" },
                label: { $tag: "Nothing" },
                ui: { $tag: "Nothing" },
                meta: {},
              }],
            },
          },
        },
      }],
      fields: [{
        id: ACCOUNT_FIELD,
        currentCodeName: "title",
        status: "live",
        realm: "account",
        reuseVisibility: "account",
      }],
      facets: [],
    } as never);
  };

  test("the account's own current wire is ACCEPTED and its stale spelling REFUTED", async () => {
    const { contains } = await import("./set-algebra");
    const accountCtx = (await accountRegistry()).evaluateContext();
    // The exact witness from the ledger row, built from PUBLIC API only. Before
    // P1(a.20) these two read `Just false` / `Just true` — the account's own
    // correct value REFUTED and the stale persisted spelling ACCEPTED, both
    // definite, because the read reached the process-global system registry
    // from a native whose context parameter was literally named `_c`.
    expect(tri(contains(persisted, { title: "x" }, null, {}, accountCtx))).toBe("true");
    expect(tri(contains(persisted, { oldTitle: "x" }, null, {}, accountCtx))).toBe("false");
  });

  test("the index is published as a FROZEN PLAIN RECORD, which the browser merge requires", async () => {
    const ctx = (await accountRegistry()).evaluateContext();
    const idx = (ctx as unknown as { _fieldCurrentWire?: Record<string, string> })._fieldCurrentWire;
    expect(idx?.[ACCOUNT_FIELD]).toBe("title");
    expect(Object.isFrozen(idx)).toBe(true);
    // NOT a `Map` and NOT a getter: `cloneFrozenBrowserAuthority` refuses any
    // prototype that is not `Object.prototype`, and `mergeBrowserEvaluateContext`
    // THROWS on an accessor property. A `Map`-shaped or getter-shaped index would
    // kill the authoring session at browser context build — which is why the
    // shape is pinned here and not left to the producer's discretion.
    expect(idx).not.toHaveProperty("set");
    const descriptor = Object.getOwnPropertyDescriptor(ctx, "_fieldCurrentWire");
    expect(descriptor !== undefined && "value" in descriptor).toBe(true);
  });

  test("THE NO-AUTHORITY READING, written rather than assumed", async () => {
    const { contains } = await import("./set-algebra");
    // A caller that publishes no field index of its own does NOT get an
    // abstention — it gets the PROCESS identity authority, which is
    // field-identity's D4 rename-robustness design. `design/deciding.md` §9.1
    // standing rule C requires the reading to be stated rather than left
    // implicit, so it is pinned: this lane is unchanged by P1(a.20) and remains
    // `fi.wire.snapshot`'s stated side condition.
    expect(tri(contains(persisted, { title: "x" }, null))).toBe("false");
    expect(tri(contains(persisted, { oldTitle: "x" }, null))).toBe("true");
  });
});

describe("P1(a.20) — syn.witness.ctx-authority is NOT retired, and this is the pin that says why", () => {
  test("a context-free certification still answers a DEFINITE, so A5's antecedent is false", () => {
    // The brief proposed retiring this row as a COROLLARY: if every
    // authority-dependent read abstains when it cannot prove its authority, then
    // a context-free certification returns `Nothing` everywhere and cannot be a
    // false definite, whoever the caller is.
    //
    // The argument's SHAPE is valid. Its ANTECEDENT is false, and this row is
    // the counterexample: the internal-harness lane keeps its definites by the
    // entitlement P1(a.12) measured and pinned, so a certification with no
    // exercise context still decides. Retiring the row on that corollary would
    // have converted a filed defect into a claimed guarantee.
    //
    // What would make A5 available is recorded on the row as A5': the harness
    // lane stops being an authority for witness-producing dispatch. Its price
    // was measured by a.12 — three of the 48 committed corpus expectations —
    // and it is a CAPABILITY price, not a correctness one.
    expect(chk(EConstruct("Just", [EVar("_0")]), [{ name: "_0", set: enumS(5) }],
      ctorS("Just", [["_0", enumS(5)]]))).toBe("true");
  });

  test("and the witness lane's false definite is still live, unchanged by this phase", async () => {
    const { witnessOf, contains } = await import("./set-algebra");
    const { invokeCallable } = await import("./json-logic");
    const kP0 = { $tag: "PositionalField", index: 0 } as unknown as FieldKey;
    const returns = { $tag: "SeCtor", ctor: "Just", fields: [{ $tag: "SetCtorField", key: kP0, wireName: "_0", set: enumS(5) }] } as unknown as SetExpr;
    const arrow = { $tag: "SeArrow", params: [{ $tag: "SetArrowParam", key: kP0, wireName: "_0", set: enumS(5) }], returns } as unknown as SetExpr;
    const w = witnessOf(arrow) as { $tag?: string; _0?: unknown };
    expect(w?.$tag).toBe("Just");
    const applied = invokeCallable(w._0, [5], {} as never);
    expect(applied).toEqual({ $tag: "Just", var: "_0" } as never);
    expect(tri(contains(returns, applied as never, null))).toBe("false");
  });
});

describe("P1(a.20) r1/F1 — the INTERNAL lane's wire read, which no gate covered", () => {
  // ⚠ WHY THIS EXISTS. Review round 1 found that B2 did not only mint correct
  // definites — it FLIPPED correct ones to false, on the one lane the phase had
  // not pinned. The uncarried (internal-harness) branch takes `callerCtx = c`,
  // the merged copy of the harness context; the harness registry is the engine
  // BOOTSTRAP registry, whose `fieldEntities` is empty, so it publishes a frozen
  // but EMPTY `_fieldCurrentWire`. An empty record is not `undefined`, so the
  // caller-index branch fired and answered `Nothing` for every handle, and the
  // process identity authority was never consulted. Measured: 4903 system fields
  // moved from a correct definite to the stale persisted spelling on every
  // `dispatchEngineBodyWithDeciderCtx` egress in a booted process.
  //
  // NO EXISTING GATE SAW IT, and the reason is worth keeping: nothing in the
  // verification floor builds the SYSTEM registry, so in every test process
  // `identityAuthorityRegistry()` fell back to the same empty harness index —
  // parent and HEAD coincided exactly where they differed in production. This
  // pin therefore builds the system registry on purpose. That is what makes it
  // expensive and what makes it evidence.
  test("a system-registry field resolves identically on the public and internal lanes", async () => {
    const { getSystemRegistry } = await import("./system-registry");
    const { contains } = await import("./set-algebra");
    const { dispatchEngineBodyWithDeciderCtx: dispatch } = await import("./engine-bodies-dispatch");

    const sysCtx = getSystemRegistry().evaluateContext() as unknown as
      { _fieldCurrentWire?: Record<string, string> };
    const idx = sysCtx._fieldCurrentWire ?? {};
    const handles = Object.keys(idx);
    // The premise of the pin, asserted rather than assumed: if the system
    // registry published no index the rest would pass vacuously.
    expect(handles.length).toBeGreaterThan(0);
    const handle = handles[0]!;
    const currentWire = idx[handle]!;
    expect(currentWire).not.toBe("");

    const persisted = {
      $tag: "SeCtor",
      ctor: "",
      fields: [{
        $tag: "SetCtorField",
        key: { $tag: "NamedField", ref: { $ref: handle } },
        wireName: "p1a20StaleWire",
        set: { $tag: "SeAll" },
      }],
    } as unknown as SetExpr;
    const current = { [currentWire]: "x" };
    const stale = { p1a20StaleWire: "x" };

    // The public lane, under the system context and with none at all.
    expect(tri(contains(persisted, current, null, {}, sysCtx as never))).toBe("true");
    expect(tri(contains(persisted, stale, null, {}, sysCtx as never))).toBe("false");
    expect(tri(contains(persisted, current, null))).toBe("true");
    expect(tri(contains(persisted, stale, null))).toBe("false");

    // …and the INTERNAL lane must agree. Before the round-1 repair these two
    // read "false" / "true" — the row's original polarity, restored on a lane
    // the phase had just claimed to fix.
    const internal = (v: unknown): Tri => tri(dispatch("engine:setAlgebraContains", [persisted, v]));
    expect(internal(current)).toBe("true");
    expect(internal(stale)).toBe("false");

    // The mechanism that made the regression invisible, pinned so a future
    // reader does not have to rediscover it: the harness DOES publish an index,
    // and it is EMPTY. "Present" is therefore not "authoritative".
    const { harnessForTests } = await import("./engine-bodies-dispatch");
    const harnessIdx = (harnessForTests().ctx as unknown as
      { _fieldCurrentWire?: Record<string, string> })._fieldCurrentWire;
    expect(harnessIdx).toBeDefined();
    expect(Object.keys(harnessIdx!).length).toBe(0);
  }, 1_800_000);
});

describe("P1(a.20) r2 — the entitlement's three remaining escape shapes", () => {
  // ⚠ ALL THREE WERE FOUND BY REVIEW AFTER THE PHASE FIRST CLAIMED THE
  // ENTITLEMENT, and two of them were introduced BY the fix written to close an
  // earlier finding. That is the standing lesson: a repair written against a
  // review finding is where the next one lives.
  const kP0 = { $tag: "PositionalField", index: 0 } as unknown as FieldKey;
  const arrow = {
    $tag: "SeArrow",
    params: [{ $tag: "SetArrowParam", key: kP0, wireName: "_0", set: enumS(5) }],
    returns: { $tag: "SeCtor", ctor: "Just", fields: [{ $tag: "SetCtorField", key: kP0, wireName: "_0", set: enumS(5) }] },
  } as unknown as SetExpr;
  const closure = { __fenelFn: true, params: ["x"], body: { construct: ["Just", { var: "x" }] }, closure: {} };
  const ask = async (ctx: unknown): Promise<Tri> => {
    const { contains } = await import("./set-algebra");
    return tri(contains(arrow, closure as never, null, undefined, ctx as never));
  };

  test("an INHERITED constructor table does not certify, however it is reached", async () => {
    // Plain inheritance: the gate's own-descriptor read misses it while the
    // table read (`ctx._constructors`) walks the chain and finds it.
    const proto = { _constructors: Object.freeze({ Just: Object.freeze(["_0"]) }) };
    expect(await ask(Object.freeze(Object.create(proto)))).toBe("nothing");

    // …and the sharper form, which defeated the first repair: an inherited
    // GETTER that answers `undefined` on the gate's read and a table on the
    // next one. `return ctx._constructors === undefined` INVOKES it, so the
    // gate saw absence and the read saw a table.
    let n = 0;
    const trickProto = {};
    Object.defineProperty(trickProto, "_constructors", {
      get: () => {
        n++;
        return n === 1 ? undefined
          : n === 2 ? Object.freeze({ Just: Object.freeze(["_0"]) })
          : Object.freeze({ Just: Object.freeze(["var"]) });
      },
      configurable: true,
    });
    expect(await ask(Object.freeze(Object.create(trickProto)))).toBe("nothing");
  });

  test("a frozen entry whose element is an ACCESSOR does not certify", async () => {
    // `Object.freeze` on an array makes its properties non-configurable and
    // non-writable; it does NOT convert an accessor index into a data property,
    // and the getter still runs on every read.
    let flip = false;
    const entry: string[] = [];
    Object.defineProperty(entry, "0", {
      get: () => (flip ? "var" : "_0"), enumerable: true, configurable: false,
    });
    Object.defineProperty(entry, "length", { value: 1, writable: false });
    Object.freeze(entry);
    expect(Object.isFrozen(entry)).toBe(true);
    expect(await ask(Object.freeze({ _constructors: Object.freeze({ Just: entry }) }))).toBe("nothing");
    flip = true;
    expect(entry[0]).toBe("var");
  });

  test("a frozen entry carrying an own `includes` behaves like a plain one", async () => {
    // ⚠ THIS PIN ASSERTED THE WRONG THING FOR TWO ROUNDS, and the correction is
    // the finding. The two faces DID read this list differently — the runtime
    // called `ctorDef.includes(...)` while the check face consumed the indexed
    // contents — so an own `includes` answering `true` certified a term the
    // runtime contradicted. The repair shipped then was a refusal, and this pin
    // asserted it. Round 5 showed the refusal is now an OVER-ABSTENTION: since
    // the list is CANONICALISED at the shared read, both faces consume a plain
    // frozen copy, the runtime writes `{$tag:"Just", _0:5}`, and the certificate
    // that was being withheld is CORRECT. A pin that asserts a wrong refusal
    // keeps the refusal alive.
    //
    // So the property is stated as an EQUIVALENCE, which is what it always
    // should have been: the exotic entry must behave exactly like a plain one
    // holding the same contents, on both faces. That survives whatever the next
    // hostile shape turns out to be.
    const { evaluate: ev } = await import("./json-logic");
    const entry = ["_0"] as string[] & { includes?: unknown };
    (entry as { includes: unknown }).includes = () => true;
    Object.freeze(entry);
    const exotic = Object.freeze({ _constructors: Object.freeze({ Just: entry }) });
    const plain = Object.freeze({ _constructors: Object.freeze({ Just: Object.freeze(["_0"]) }) });
    const write = (c: unknown) => ev({ construct: ["Just", { var: "x" }] } as never, { x: 5 }, c as never);

    expect(write(exotic)).toEqual(write(plain) as never);
    expect(await ask(exotic)).toBe(await ask(plain));
    // …and the shared value is the ENTITLED one, so the equivalence is not two
    // abstentions agreeing with each other.
    expect(await ask(plain)).toBe("true");
    expect(write(plain)).toEqual({ $tag: "Just", _0: 5 } as never);
  });

  test("the published wire index cannot be poisoned through the PUBLIC field DTOs", async () => {
    // `exposedFieldEntities()` memoizes ONE array of copies and hands the SAME
    // objects to every `listFieldEntities()` consumer. Building the index from
    // it made a caller's mutation of its own DTO the registry's answer — the
    // `fi.wire.snapshot` defect shape one layer out, reintroduced by that row's
    // own repair.
    const FIELD = "3c1f9a52-7d64-4b18-9f0e-2a5c7e13b4d8";
    const { createAccountFieldRegistry } = await import("./account-field-registry");
    const reg = createAccountFieldRegistry([], "p1a20-r2-pin", {
      owners: [{
        ownerKey: "type:r2pin", kind: "type", storageName: "r2pin",
        definition: {
          id: "R2PinArticle",
          type: { $record: { fields: [{
            name: "title", key: { $tag: "NamedField", ref: { $ref: FIELD } },
            type: { $ref: "String" }, label: { $tag: "Nothing" }, ui: { $tag: "Nothing" }, meta: {},
          }] } },
        },
      }],
      fields: [{ id: FIELD, currentCodeName: "title", status: "live", realm: "account", reuseVisibility: "account" }],
      facets: [],
    } as never);

    for (const fe of reg.listFieldEntities() as unknown as { id: string; currentCodeName: string }[]) {
      if (fe.id === FIELD) fe.currentCodeName = "impostor";
    }
    const idx = (reg.evaluateContext() as unknown as { _fieldCurrentWire?: Record<string, string> })
      ._fieldCurrentWire;
    expect(idx?.[FIELD]).toBe("title");

    // …and the membership consequence, so the pin is about the JUDGMENT and not
    // only about a record's contents.
    const { contains } = await import("./set-algebra");
    const persisted = {
      $tag: "SeCtor", ctor: "",
      fields: [{
        $tag: "SetCtorField",
        key: { $tag: "NamedField", ref: { $ref: FIELD } },
        wireName: "oldTitle",
        set: { $tag: "SeAll" },
      }],
    } as unknown as SetExpr;
    const ctx = reg.evaluateContext();
    expect(tri(contains(persisted, { title: "x" }, null, {}, ctx))).toBe("true");
    expect(tri(contains(persisted, { impostor: "x" }, null, {}, ctx))).toBe("false");
  });
});

describe("P1(a.20) r3 — the two faces read the same list, and the FALLBACK index is private too", () => {
  const kP0 = { $tag: "PositionalField", index: 0 } as unknown as FieldKey;
  const arrow = {
    $tag: "SeArrow",
    params: [{ $tag: "SetArrowParam", key: kP0, wireName: "_0", set: enumS(5) }],
    returns: { $tag: "SeCtor", ctor: "Just", fields: [{ $tag: "SetCtorField", key: kP0, wireName: "_0", set: enumS(5) }] },
  } as unknown as SetExpr;
  const closure = { __fenelFn: true, params: ["x"], body: { construct: ["Just", { var: "x" }] }, closure: {} };

  test("a PROTOTYPE-supplied `includes` cannot make the two faces disagree", async () => {
    const { contains } = await import("./set-algebra");
    const { evaluate: ev } = await import("./json-logic");

    // The shape: a frozen, ordinary-looking `["_0"]` whose PROTOTYPE answers
    // `includes` with `true`. Every own-property check passes — the entry's own
    // keys are `0` and `length`, both frozen data — and the runtime `construct`
    // op resolves `.includes` through the chain. Before r3 this certified
    // `Just true` and then exercised to `{$tag:"Just", var:"x"}`, a non-member,
    // with nothing mutating and no `type_def` anywhere.
    // ⚠ IT MUST BE A REAL ARRAY with an injected prototype, not an
    // array-LIKE object. The first cut of this pin used `Object.create(proto)`,
    // which `Array.isArray` rejects — so `constructorDeclaredFieldNames`
    // returned `undefined`, the ctor read as UNREGISTERED, and the op took its
    // legacy heuristic branch. The pin was green/red for a reason that had
    // nothing to do with `includes`, which is its own small lesson about
    // building the shape the finding actually names.
    const proto = Object.create(Array.prototype) as { includes?: unknown };
    proto.includes = () => true;
    const entry: string[] = ["_0"];
    Object.setPrototypeOf(entry, proto);
    Object.freeze(entry);
    expect(Array.isArray(entry)).toBe(true);
    expect((entry as string[]).includes("var")).toBe(true);
    const ctx = Object.freeze({ _constructors: Object.freeze({ Just: entry }) }) as never;

    // THE RUNTIME half — the invariant-bound call means the named branch is not
    // taken, so the op writes positionally and the value IS a member. This is
    // the assertion that makes the repair a repair rather than a wider fence.
    expect(ev({ construct: ["Just", { var: "x" }] } as never, { x: 5 }, ctx))
      .toEqual({ $tag: "Just", _0: 5 } as never);

    // THE READER half. ⚠ This asserted `nothing` for two rounds, on the strength
    // of a reader-side prototype clause that review round 5 removed as an
    // OVER-ABSTENTION: with the list canonicalised, the injected prototype
    // cannot reach either face, the canonical read is the true `["_0"]`, the
    // runtime writes positionally, and the certificate is CORRECT. A pin that
    // asserts a wrong refusal keeps the refusal alive.
    expect(tri(contains(arrow, closure as never, null, undefined, ctx))).toBe("true");

    // …and the control: the ordinary frozen entry still both certifies and
    // exercises consistently, so neither half above passes by abstaining
    // everywhere.
    const ok = Object.freeze({ _constructors: Object.freeze({ Just: Object.freeze(["_0"]) }) }) as never;
    expect(tri(contains(arrow, closure as never, null, undefined, ok))).toBe("true");
    expect(ev({ construct: ["Just", { var: "x" }] } as never, { x: 5 }, ok))
      .toEqual({ $tag: "Just", _0: 5 } as never);
  });

  test("the FALLBACK wire index is built from the registry's private store", async () => {
    // Round 2 closed this on the PUBLISHED index. The fallback — which serves
    // every caller whose own index does not carry the handle, i.e. the
    // no-context lane and any account context reading a system field — was
    // still built from `listFieldEntities()`, the memoized mutable copies.
    const { getSystemRegistry } = await import("./system-registry");
    const { contains } = await import("./set-algebra");
    const reg = getSystemRegistry();

    const rows = reg.listFieldEntities() as unknown as { id: string; currentCodeName: string }[];
    const victim = rows.find((r) => typeof r.currentCodeName === "string" && r.currentCodeName !== "");
    expect(victim).toBeDefined();
    const realWire = victim!.currentCodeName;
    // Poison the PUBLIC copy before any fallback read builds its index.
    victim!.currentCodeName = "p1a20R3Impostor";

    const persisted = {
      $tag: "SeCtor", ctor: "",
      fields: [{
        $tag: "SetCtorField",
        key: { $tag: "NamedField", ref: { $ref: victim!.id } },
        wireName: "p1a20R3Stale",
        set: { $tag: "SeAll" },
      }],
    } as unknown as SetExpr;

    // The NO-CONTEXT lane runs on the fallback index. It must still answer from
    // the registry's own private store.
    expect(tri(contains(persisted, { [realWire]: "x" }, null))).toBe("true");
    expect(tri(contains(persisted, { p1a20R3Impostor: "x" }, null))).toBe("false");

    victim!.currentCodeName = realWire;
  }, 1_800_000);
});

describe("P1(a.20) r4 — the canonical wire list, and equivalent key spellings", () => {
  const kP0 = { $tag: "PositionalField", index: 0 } as unknown as FieldKey;
  const returns = { $tag: "SeCtor", ctor: "Just", fields: [{ $tag: "SetCtorField", key: kP0, wireName: "_0", set: enumS(5) }] } as unknown as SetExpr;
  const arrow = { $tag: "SeArrow", params: [{ $tag: "SetArrowParam", key: kP0, wireName: "_0", set: enumS(5) }], returns } as unknown as SetExpr;
  const closure = { __fenelFn: true, params: ["x"], body: { construct: ["Just", { var: "x" }] }, closure: {} };

  test("a Proxy that lies through a METHOD cannot make the two faces disagree", async () => {
    const { contains } = await import("./set-algebra");
    const { evaluate: ev, constructorDeclaredFieldNames } = await import("./json-logic");

    // The shape: a Proxy over a FROZEN DENSE `["_0","var"]` whose `get` trap
    // answers `slice` with `() => []`. Every stability condition passes —
    // `Array.isArray`, `Array.prototype`, frozen, own string descriptors — and
    // before r4 the check face's traversal called that `slice`, saw an EMPTY
    // list, and certified `Just true`, while the runtime's `includes` saw the
    // full one and wrote `{$tag:"Just", var:"x"}`, a non-member. Nothing
    // mutated; no `type_def` ran.
    //
    // Fencing method-by-method is a losing game (`slice` was one of many), so
    // the list is CANONICALISED once in `constructorDeclaredFieldNames`, built
    // from own indexed descriptors, calling nothing the value supplies. Every
    // consumer then holds a plain array with no trap on it.
    const target = Object.freeze(["_0", "var"]);
    const proxied = new Proxy(target, {
      get(t, p, r) { return p === "slice" ? () => [] : Reflect.get(t, p, r); },
    });
    const ctx = Object.freeze({ _constructors: Object.freeze({ Just: proxied }) }) as never;

    // The trap IS live — otherwise this pin proves nothing about traps.
    expect((proxied as unknown as string[]).slice()).toEqual([]);
    // …and the canonical read is nonetheless the true list.
    expect(constructorDeclaredFieldNames(ctx, "Just")).toEqual(["_0", "var"] as never);

    // THE PROPERTY: the proxied table behaves EXACTLY like a plain one holding
    // the same contents, on both faces. That is what "the two faces read the
    // same list" has to mean, and it is stronger than asserting either verdict
    // in isolation.
    const plain = Object.freeze({ _constructors: Object.freeze({ Just: Object.freeze(["_0", "var"]) }) }) as never;
    const write = (c: never) => ev({ construct: ["Just", { var: "x" }] } as never, { x: 5 }, c);
    expect(write(ctx)).toEqual(write(plain) as never);
    expect(tri(contains(arrow, closure as never, null, undefined, ctx)))
      .toBe(tri(contains(arrow, closure as never, null, undefined, plain)));

    // ⚠ AND WHAT THE SHARED ANSWER IS, stated so the equivalence above is not two
    // abstentions agreeing. Here it IS an abstention, and correctly: this
    // table declares `["_0","var"]`, so `var` is a real declared wire, the op
    // takes its NAMED branch, and the written value is not in the goal. The
    // certificate is withheld and the value refuted — which is the sound pair.
    // (The ENTITLED case is pinned separately, on the r2 own-`includes` shape,
    // whose table declares only `_0`.)
    expect(tri(contains(arrow, closure as never, null, undefined, plain))).toBe("nothing");
    expect(write(ctx)).toEqual({ $tag: "Just", var: "x" } as never);
    expect(tri(contains(returns, write(ctx) as never, null, undefined, ctx))).toBe("false");
  });

  test("an EQUIVALENT key spelling resolves through the account's own index", async () => {
    const { contains } = await import("./set-algebra");
    const { createAccountFieldRegistry } = await import("./account-field-registry");
    // Semantic key identity is CASE-INSENSITIVE — `fieldKeyToken` encodes a
    // named key as `n:<lower handle>`. The index was published and looked up
    // case-SENSITIVELY, so an equivalent uppercase UUID in a persisted
    // `SetCtorField` missed it and fell back to the stale embedded spelling,
    // reproducing this row's two original false definites from public API with
    // nothing changed but letter case.
    const LOWER = "3c1f9a52-7d64-4b18-9f0e-2a5c7e13b4d8";
    const UPPER = LOWER.toUpperCase();
    const reg = createAccountFieldRegistry([], "p1a20-r4-pin", {
      owners: [{
        ownerKey: "type:r4pin", kind: "type", storageName: "r4pin",
        definition: {
          id: "R4PinArticle",
          type: { $record: { fields: [{
            name: "title", key: { $tag: "NamedField", ref: { $ref: LOWER } },
            type: { $ref: "String" }, label: { $tag: "Nothing" }, ui: { $tag: "Nothing" }, meta: {},
          }] } },
        },
      }],
      fields: [{ id: LOWER, currentCodeName: "title", status: "live", realm: "account", reuseVisibility: "account" }],
      facets: [],
    } as never);
    const ctx = reg.evaluateContext();
    const persisted = (handle: string) => ({
      $tag: "SeCtor", ctor: "",
      fields: [{
        $tag: "SetCtorField",
        key: { $tag: "NamedField", ref: { $ref: handle } },
        wireName: "oldTitle",
        set: { $tag: "SeAll" },
      }],
    } as unknown as SetExpr);

    for (const handle of [LOWER, UPPER]) {
      expect({ handle, v: tri(contains(persisted(handle), { title: "x" }, null, {}, ctx)) })
        .toEqual({ handle, v: "true" });
      expect({ handle, v: tri(contains(persisted(handle), { oldTitle: "x" }, null, {}, ctx)) })
        .toEqual({ handle, v: "false" });
    }

    // ⚠ AND THE MIRROR CASE, which is what makes the PUBLICATION side of the
    // canonicalisation load-bearing rather than merely symmetrical. With only
    // the lookup canonicalising, a registry whose stored field id is itself
    // UPPERCASE publishes under that spelling and the lowercased lookup misses
    // it — so the row's defect returns for exactly those registries. The
    // DISCRIMINATES run caught this: reverting the publication clause alone left
    // the battery green until this half existed.
    const upperReg = createAccountFieldRegistry([], "p1a20-r4-pin-upper", {
      owners: [{
        ownerKey: "type:r4pinU", kind: "type", storageName: "r4pinU",
        definition: {
          id: "R4PinUpperArticle",
          type: { $record: { fields: [{
            name: "title", key: { $tag: "NamedField", ref: { $ref: UPPER } },
            type: { $ref: "String" }, label: { $tag: "Nothing" }, ui: { $tag: "Nothing" }, meta: {},
          }] } },
        },
      }],
      fields: [{ id: UPPER, currentCodeName: "title", status: "live", realm: "account", reuseVisibility: "account" }],
      facets: [],
    } as never);
    const upperCtx = upperReg.evaluateContext();
    for (const handle of [LOWER, UPPER]) {
      expect({ stored: "UPPER", handle, v: tri(contains(persisted(handle), { title: "x" }, null, {}, upperCtx)) })
        .toEqual({ stored: "UPPER", handle, v: "true" });
      expect({ stored: "UPPER", handle, v: tri(contains(persisted(handle), { oldTitle: "x" }, null, {}, upperCtx)) })
        .toEqual({ stored: "UPPER", handle, v: "false" });
    }
  });
});

describe("P1(a.20) r5 — the write model's SECOND read, and key-spelling collisions", () => {
  const kP0 = { $tag: "PositionalField", index: 0 } as unknown as FieldKey;
  const arrow = {
    $tag: "SeArrow",
    params: [{ $tag: "SetArrowParam", key: kP0, wireName: "_0", set: enumS(5) }],
    returns: { $tag: "SeCtor", ctor: "Just", fields: [{ $tag: "SetCtorField", key: kP0, wireName: "_0", set: enumS(5) }] },
  } as unknown as SetExpr;
  const closure = { __fenelFn: true, params: ["x"], body: { construct: ["Just", { var: "x" }] }, closure: {} };

  test("a table that RENAMES the tag does not certify", async () => {
    const { contains } = await import("./set-algebra");
    const { invokeCallable } = await import("./json-logic");
    // `check.fenel`'s own write-model comment opens with
    // `name = _constructorWireNames[source] ?? source`. The stability predicate
    // proved facts about `_constructors` and never read that SECOND table, so a
    // fully frozen authority satisfying every stated condition certified an
    // arrow whose exercise writes a DIFFERENT TAG than the goal names.
    const renaming = Object.freeze({
      _constructors: Object.freeze({ Just: Object.freeze(["_0"]) }),
      _constructorWireNames: Object.freeze({ Just: "Other" }),
    }) as never;
    expect(tri(contains(arrow, closure as never, null, undefined, renaming))).toBe("nothing");
    // The contradiction it used to license, so the pin cannot go green because
    // the EXERCISE changed rather than the fence.
    expect(invokeCallable(closure, [5], renaming)).toEqual({ $tag: "Other", _0: 5 } as never);

    // Controls. An unrelated rename does NOT fence — the condition is about the
    // tag being read, not about the table existing…
    const unrelated = Object.freeze({
      _constructors: Object.freeze({ Just: Object.freeze(["_0"]) }),
      _constructorWireNames: Object.freeze({ Nothing: "Other" }),
    }) as never;
    expect(tri(contains(arrow, closure as never, null, undefined, unrelated))).toBe("true");
    // …and neither does its absence.
    const plain = Object.freeze({ _constructors: Object.freeze({ Just: Object.freeze(["_0"]) }) }) as never;
    expect(tri(contains(arrow, closure as never, null, undefined, plain))).toBe("true");
  });

  test("two field ids differing only by CASE collapse to no answer, not to last-wins", async () => {
    const { contains } = await import("./set-algebra");
    const { createAccountFieldRegistry } = await import("./account-field-registry");
    // Semantic key identity is case-INSENSITIVE (`fieldKeyToken` lowercases),
    // but every other registry table is case-SENSITIVE, so a snapshot may carry
    // two live rows whose ids differ only by case. Canonicalising the published
    // index by lowercasing made the later row answer for the earlier — and that
    // was WORSE than before the canonicalisation, where the embedded codec hint
    // still answered correctly. Where two distinct raw ids collapse onto one
    // key the index has no answer, so it must not pretend to.
    const LOW = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
    const UPP = LOW.toUpperCase();
    const owner = (id: string, type: string, wire: string) => ({
      ownerKey: `type:${type}`, kind: "type", storageName: type,
      definition: { id: type, type: { $record: { fields: [{
        name: wire, key: { $tag: "NamedField", ref: { $ref: id } },
        type: { $ref: "String" }, label: { $tag: "Nothing" }, ui: { $tag: "Nothing" }, meta: {},
      }] } } },
    });
    const reg = createAccountFieldRegistry([], "p1a20-r5-pin", {
      owners: [owner(LOW, "R5PinLower", "title"), owner(UPP, "R5PinUpper", "headline")],
      fields: [
        { id: LOW, currentCodeName: "title", status: "live", realm: "account", reuseVisibility: "account" },
        { id: UPP, currentCodeName: "headline", status: "live", realm: "account", reuseVisibility: "account" },
      ],
      facets: [],
    } as never);
    const ctx = reg.evaluateContext();

    // The premise, asserted: the snapshot really did carry both rows.
    const idx = (ctx as unknown as { _fieldCurrentWire?: Record<string, string> })._fieldCurrentWire ?? {};
    expect(Object.prototype.hasOwnProperty.call(idx, LOW)).toBe(false);

    // With the collapsed key withheld the read falls through to the embedded
    // codec hint, which is each field's own correct spelling. Before the fix
    // these read `false` / `true` — a field's own current wire REFUTED and a
    // DIFFERENT field's spelling ACCEPTED.
    const persisted = (id: string, wire: string) => ({
      $tag: "SeCtor", ctor: "",
      fields: [{ $tag: "SetCtorField", key: { $tag: "NamedField", ref: { $ref: id } }, wireName: wire, set: { $tag: "SeAll" } }],
    } as unknown as SetExpr);
    expect(tri(contains(persisted(UPP, "headline"), { headline: "x" }, null, {}, ctx))).toBe("true");
    expect(tri(contains(persisted(UPP, "headline"), { title: "x" }, null, {}, ctx))).toBe("false");
    expect(tri(contains(persisted(LOW, "title"), { title: "x" }, null, {}, ctx))).toBe("true");
    expect(tri(contains(persisted(LOW, "title"), { headline: "x" }, null, {}, ctx))).toBe("false");
  }, 1_800_000);

  test("a MALFORMED declared-wire list reads as unregistered — a recorded runtime change", async () => {
    const { evaluate: ev, constructorDeclaredFieldNames, __clearDynamicConstructorTableForTests: clearDyn } =
      await import("./json-logic");
    // ⚠ THIS IS A DELIBERATE BEHAVIOUR CHANGE, PINNED BECAUSE IT IS ONE.
    // `applyTypeDef` writes `undefined` for a nameless field and leaves a HOLE
    // for a sparse one, so a `type_def` can declare a list that is not a list of
    // wire names. The parent handed that list to the `construct` op as-is, which
    // then bound POSITIONALLY because a string key never equals `undefined`.
    // `canonicalWireList` refuses it and answers `undefined` — "this context
    // does not register this ctor" — so the op takes its legacy named branch
    // instead. Review round 5 found the change unpinned; it is kept, because a
    // list containing holes is not a declared-wire list and reading it as
    // unregistered is the honest answer, but it is recorded rather than silent.
    const ctx = Object.freeze({}) as never;
    try {
      ev({ type_def: { name: "P1a20Malformed", constructors: [{ name: "P1a20Malformed", fields: [{}] }] } } as never, {}, ctx);
      expect(constructorDeclaredFieldNames(ctx, "P1a20Malformed")).toBeUndefined();
      expect(ev({ construct: ["P1a20Malformed", { var: "x" }] } as never, { x: 5 }, ctx))
        .toEqual({ $tag: "P1a20Malformed", var: "x" } as never);
    } finally {
      clearDyn(ctx);
    }

    // The control: a WELL-FORMED declaration is unaffected, so the change is
    // confined to the malformed shape rather than to `type_def` at large.
    const ok = Object.freeze({}) as never;
    try {
      ev({ type_def: { name: "P1a20WellFormed", constructors: [{ name: "P1a20WellFormed", fields: [{ name: "value" }] }] } } as never, {}, ok);
      expect(constructorDeclaredFieldNames(ok, "P1a20WellFormed")).toEqual(["value"] as never);
      expect(ev({ construct: ["P1a20WellFormed", { var: "x" }] } as never, { x: 5 }, ok))
        .toEqual({ $tag: "P1a20WellFormed", _0: 5 } as never);
    } finally {
      clearDyn(ok);
    }
  });
});

describe("P1(a.20) r6 — OWN vs the CHAIN, in both directions", () => {
  // ⚠ ONE SHAPE, THREE APPEARANCES, and this block exists so the fourth is
  // caught by a test rather than by a sixth reviewer. A fence that tests an OWN
  // property while the runtime resolves the same name through the PROTOTYPE
  // CHAIN reads inheritance as absence. It happened to `_constructors` (rounds 1
  // and 2) and then to `_constructorWireNames`, the table added to close round
  // 5's finding.
  //
  // The two directions are NOT symmetrical, and getting that backwards would
  // reintroduce one of them:
  //   `_constructorWireNames` — the `construct` op reads it PLAINLY, so it sees
  //     an inherited table; the fence must therefore walk the chain too.
  //   `_fieldCurrentWire`     — only the judgment reads it, so an inherited one
  //     is simply not a published authority; the fence requires OWN DATA and
  //     falls through otherwise.
  const kP0 = { $tag: "PositionalField", index: 0 } as unknown as FieldKey;
  const arrow = {
    $tag: "SeArrow",
    params: [{ $tag: "SetArrowParam", key: kP0, wireName: "_0", set: enumS(5) }],
    returns: { $tag: "SeCtor", ctor: "Just", fields: [{ $tag: "SetCtorField", key: kP0, wireName: "_0", set: enumS(5) }] },
  } as unknown as SetExpr;
  const closure = { __fenelFn: true, params: ["x"], body: { construct: ["Just", { var: "x" }] }, closure: {} };

  test("an INHERITED tag rename fences, exactly as an own one does", async () => {
    const { contains } = await import("./set-algebra");
    const { invokeCallable } = await import("./json-logic");
    // ⚠ THE WITNESS IS AN OWN ACCESSOR, NOT A PROTOTYPE (DISCRIMINATES, this
    // phase's final sweep). An inherited table on a CUSTOM prototype is refused
    // by round 8's plain-prototype clause FIRST, so it cannot redden this
    // clause on its own and was evidence for nothing — exactly the "covered by
    // another mechanism" shape this file's rule at the `construct` arm names.
    // An own ACCESSOR on a frozen, plain-prototype context isolates it: a
    // descriptor read sees a slot with no `value` and reads absence, while a
    // PLAIN read invokes the getter — which is what `construct` does. Same
    // defect, same direction, and reachable past every later clause.
    const RENAME = Object.freeze({ Just: "Other" });
    const inherited = Object.freeze(Object.defineProperties({}, {
      _constructors: { value: Object.freeze({ Just: Object.freeze(["_0"]) }), enumerable: true },
      _constructorWireNames: { get: () => RENAME, enumerable: true, configurable: false },
    })) as never;
    expect(Object.getPrototypeOf(inherited as object)).toBe(Object.prototype);
    expect(tri(contains(arrow, closure as never, null, undefined, inherited))).toBe("nothing");
    // The contradiction it used to license, asserted so this cannot go green
    // because the EXERCISE changed rather than the fence.
    expect(invokeCallable(closure, [5], inherited)).toEqual({ $tag: "Other", _0: 5 } as never);

    // ⚠ THE CONTROL MOVED, and why is the point. It used to be "an inherited
    // table renaming something ELSE does not fence", asserting that the clause
    // was about the TAG rather than about inheritance. Review round 8 added a
    // PLAIN-PROTOTYPE requirement to `constructorTableStable` — the browser
    // merge's own definition of plain transport data — so ANY custom-prototype
    // context now abstains for that reason first, whatever it renames. Two
    // mechanisms cover this shape, and the honest control is therefore on a
    // PLAIN context: an OWN table renaming something else still certifies, so
    // the rename clause remains about the tag being read.
    const unrelated = Object.freeze({
      _constructors: Object.freeze({ Just: Object.freeze(["_0"]) }),
      _constructorWireNames: Object.freeze({ Nothing: "Other" }),
    }) as never;
    expect(tri(contains(arrow, closure as never, null, undefined, unrelated))).toBe("true");
    // …and the inherited shape abstains even with NO rename at all, which is
    // the prototype clause and not the rename one.
    const inheritedNoRename = Object.freeze(Object.create({ harmless: 1 }, {
      _constructors: { value: Object.freeze({ Just: Object.freeze(["_0"]) }), enumerable: true },
    })) as never;
    expect(tri(contains(arrow, closure as never, null, undefined, inheritedNoRename))).toBe("nothing");
  });

  test("an INHERITED wire index is NOT a published authority", async () => {
    const { contains } = await import("./set-algebra");
    // Both polarities of `fi.wire.snapshot` reproduced through a prototype: the
    // field's own persisted spelling was REFUTED and an impostor ACCEPTED. It
    // was also a MINT against the parent, which read no caller index at all.
    const UUID = "7b2e4f10-3a9c-4d51-8e6f-1c2d3e4f5a6b";
    const persisted = {
      $tag: "SeCtor", ctor: "",
      fields: [{ $tag: "SetCtorField", key: { $tag: "NamedField", ref: { $ref: UUID } }, wireName: "title", set: { $tag: "SeAll" } }],
    } as unknown as SetExpr;
    // ⚠ THE INHERITED INDEX IS FROZEN (DISCRIMINATES, this phase's final
    // sweep). An UNFROZEN one is refused by round 7's `Object.isFrozen(rawIndex)`
    // clause first, so this pin passed whether the slot was read as own-data or
    // plainly, and was evidence for neither. Frozen, the two readings separate:
    // own-data falls through to the process authority, a plain read honours the
    // prototype's index.
    const IMPOSTOR = Object.freeze({ [UUID]: "impostor" });
    const inherited = Object.freeze(Object.create({ _fieldCurrentWire: IMPOSTOR })) as never;
    expect(tri(contains(persisted, { title: "x" }, null, {}, inherited))).toBe("true");
    expect(tri(contains(persisted, { impostor: "x" }, null, {}, inherited))).toBe("false");
    // …and it answers exactly as a context with no index at all does, which is
    // the property: inheritance is absence here.
    const none = Object.freeze({}) as never;
    expect(tri(contains(persisted, { title: "x" }, null, {}, none))).toBe("true");
    expect(tri(contains(persisted, { impostor: "x" }, null, {}, none))).toBe("false");

    // An ACCESSOR own slot is refused for the same reason — the judgment must
    // not run caller code to find out what its authority is.
    const accessor = Object.freeze(Object.defineProperty({}, "_fieldCurrentWire", {
      // Frozen for the same reason as the inherited one above: an unfrozen
      // return is refused by the freeze clause before the own-data clause is
      // reached, and the pin would prove nothing about which read ran.
      get: () => IMPOSTOR, enumerable: true, configurable: false,
    })) as never;
    expect(tri(contains(persisted, { title: "x" }, null, {}, accessor))).toBe("true");
    expect(tri(contains(persisted, { impostor: "x" }, null, {}, accessor))).toBe("false");
  });
});

describe("P1(a.20) r7 — the fence reads as the runtime reads, and an authority must be FROZEN", () => {
  const kP0 = { $tag: "PositionalField", index: 0 } as unknown as FieldKey;
  const arrow = {
    $tag: "SeArrow",
    params: [{ $tag: "SetArrowParam", key: kP0, wireName: "_0", set: enumS(5) }],
    returns: { $tag: "SeCtor", ctor: "Just", fields: [{ $tag: "SetCtorField", key: kP0, wireName: "_0", set: enumS(5) }] },
  } as unknown as SetExpr;
  const closure = { __fenelFn: true, params: ["x"], body: { construct: ["Just", { var: "x" }] }, closure: {} };
  const ctors = Object.freeze({ Just: Object.freeze(["_0"]) });

  test("a Proxy `get` trap that supplies a rename is SEEN, because the fence reads plainly", async () => {
    const { contains } = await import("./set-algebra");
    // The round-6 fence walked the prototype chain with descriptors, to avoid
    // invoking a getter. But the `construct` op DOES invoke it, and a descriptor
    // walk cannot see a Proxy `get` trap answering for an ABSENT property at
    // all — so the runtime saw a rename the fence did not, and certified.
    // Round 6's own rule is that the fence must match the RUNTIME's resolution;
    // the descriptor walk was stricter in the wrong dimension.
    const target = Object.freeze(Object.assign(Object.create(null), { _constructors: ctors }));
    const proxied = new Proxy(target, {
      get(t, p, r) {
        return p === "_constructorWireNames" ? Object.freeze({ Just: "Other" }) : Reflect.get(t, p, r);
      },
    }) as never;
    expect(tri(contains(arrow, closure as never, null, undefined, proxied))).toBe("nothing");

    // The control: the same Proxy WITHOUT the rename still certifies, so the
    // refusal is about the rename and not about the context being exotic.
    const plainProxy = new Proxy(target, { get: (t, p, r) => Reflect.get(t, p, r) }) as never;
    expect(tri(contains(arrow, closure as never, null, undefined, plainProxy))).toBe("true");
  });

  test("a MUTABLE caller wire index is not an authority; a frozen one is", async () => {
    const { contains } = await import("./set-algebra");
    // Own-data proves the SLOT is not an accessor. It proves nothing about the
    // object's CONTENTS: a frozen context with a mutable own index certified,
    // the index was reassigned, and the same closure exercised to a value the
    // same context then refuted. The parent read no caller index at all, so
    // this temporal hole arrived WITH the caller-index repair.
    const ID = "5f4e3d2c-1b0a-4998-8776-655443322110";
    const persisted = {
      $tag: "SeCtor", ctor: "",
      fields: [{ $tag: "SetCtorField", key: { $tag: "NamedField", ref: { $ref: ID } }, wireName: "title", set: { $tag: "SeAll" } }],
    } as unknown as SetExpr;

    const mutable: Record<string, string> = { [ID]: "title" };
    const withMutable = Object.freeze({ _fieldCurrentWire: mutable }) as never;
    // Ignored, so the read falls through to the declared no-authority reading —
    // which answers from the embedded codec hint and is correct.
    expect(tri(contains(persisted, { title: "x" }, null, {}, withMutable))).toBe("true");
    mutable[ID] = "impostor";
    expect(tri(contains(persisted, { title: "x" }, null, {}, withMutable))).toBe("true");
    expect(tri(contains(persisted, { impostor: "x" }, null, {}, withMutable))).toBe("false");

    // …and a FROZEN index is still honoured, so the condition is about
    // immutability and not a blanket refusal of hand-built contexts.
    const withFrozen = Object.freeze({ _fieldCurrentWire: Object.freeze({ [ID]: "current" }) }) as never;
    expect(tri(contains(persisted, { current: "x" }, null, {}, withFrozen))).toBe("true");
    expect(tri(contains(persisted, { title: "x" }, null, {}, withFrozen))).toBe("false");
  });

  test("a MUTABLE ANCESTOR is refused outright, which is what closed the round-7 route", async () => {
    const { contains } = await import("./set-algebra");
    // ⚠ THIS PIN ASSERTED THE OPPOSITE FOR ONE ROUND, and the change is the
    // finding. A frozen context whose wire-name table sits behind a MUTABLE
    // PROTOTYPE SLOT certified, the caller then replaced the slot, and the
    // certificate went stale — recorded as an unavoidable temporal residual.
    // Review round 8 pointed out that it IS avoidable, cheaply: a mutable link
    // in the chain means a non-plain prototype, and requiring
    // `Object.prototype` or `null` — the browser merge's own definition of
    // plain transport data — closes every mutable-ANCESTOR route rounds 6 and 7
    // found, at zero cost on any shipped context.
    const proto: { _constructorWireNames: unknown } = { _constructorWireNames: Object.freeze({}) };
    const ctx = Object.freeze(Object.create(proto, { _constructors: { value: ctors, enumerable: true } })) as never;
    expect(tri(contains(arrow, closure as never, null, undefined, ctx))).toBe("nothing");
    // …and it stays refused after the replacement, so the pin is about the
    // shape and not about the timing.
    proto._constructorWireNames = Object.freeze({ Just: "Other" });
    expect(tri(contains(arrow, closure as never, null, undefined, ctx))).toBe("nothing");
    // The surviving ctor-lane temporal residual is the `type_def`-after-
    // certification one, pinned in the `chk.ctor.table-mutation` block. What
    // nothing read-time can close is a STATEFUL Proxy trap, and that is the
    // stated side condition rather than a gap any of this pretends to fill.
  });
});

describe("P1(a.20) r8 — the caller's index must survive the engine's OWN doors", () => {
  // ⚠ A SIDE CONDITION IS ONLY HONEST IF THE ENGINE'S OWN DOORS SATISFY IT.
  // `fi.wire.snapshot`'s condition reads "when the caller publishes no field
  // index of its own, the process authority answers". Review round 8 found two
  // shipped doors where the caller DID publish one and an engine door threw it
  // away — so the row's condition was false and the row was live, on the
  // account lane, from public API. Both survive from the parent; neither was a
  // regression; both are one line.
  const ACCOUNT_FIELD = "8c7d6e5f-4a3b-4291-8071-6f5e4d3c2b1a";
  const accountRegistry = async () => {
    const { createAccountFieldRegistry } = await import("./account-field-registry");
    return createAccountFieldRegistry([], "p1a20-r8", {
      owners: [{
        ownerKey: "type:r8", kind: "type", storageName: "r8",
        definition: {
          id: "R8Article",
          type: { $record: { fields: [{
            name: "title", key: { $tag: "NamedField", ref: { $ref: ACCOUNT_FIELD } },
            type: { $ref: "String" }, label: { $tag: "Nothing" }, ui: { $tag: "Nothing" }, meta: {},
          }] } },
        },
      }],
      fields: [{ id: ACCOUNT_FIELD, currentCodeName: "title", status: "live", realm: "account", reuseVisibility: "account" }],
      facets: [],
    } as never);
  };
  const persisted = {
    $tag: "SeCtor", ctor: "",
    fields: [{
      $tag: "SetCtorField",
      key: { $tag: "NamedField", ref: { $ref: ACCOUNT_FIELD } },
      wireName: "oldTitle",
      set: { $tag: "SeAll" },
    }],
  } as unknown as SetExpr;

  test("`pureEvaluateContext` carries it — the door `validate()` runs through", async () => {
    const { pureEvaluateContext } = await import("./json-logic");
    const { contains } = await import("./set-algebra");
    const ctx = (await accountRegistry()).evaluateContext();
    const pure = pureEvaluateContext(ctx);

    // The premise: the account context publishes the index at all.
    const src = (ctx as unknown as { _fieldCurrentWire?: Record<string, string> })._fieldCurrentWire;
    expect(src?.[ACCOUNT_FIELD]).toBe("title");
    // …and it SURVIVES the rebuild. This is a fixed-slot-list copy, so anything
    // not named is dropped; before the fix the judgment on the far side of this
    // door saw no caller index at all.
    const carried = (pure as unknown as { _fieldCurrentWire?: Record<string, string> })._fieldCurrentWire;
    expect(carried?.[ACCOUNT_FIELD]).toBe("title");

    // The membership consequence, so the pin is about the JUDGMENT and not
    // about a record's contents.
    expect(tri(contains(persisted, { title: "x" }, null, {}, pure))).toBe("true");
    expect(tri(contains(persisted, { oldTitle: "x" }, null, {}, pure))).toBe("false");
  }, 1_800_000);

  test("the NESTED named lane forwards the carrier, so both lanes agree", async () => {
    const { contains } = await import("./set-algebra");
    const ctx = (await accountRegistry()).evaluateContext();
    // `namedMember` forwarded the MERGED decider context as the nested
    // `evalCtx`. That object spreads `...harness.ctx`, so its own
    // `_fieldCurrentWire` is the harness's EMPTY index — and the nested lane
    // answered the OPPOSITE of the outer lane on the same set and the same
    // context, the two contradicting each other within one call.
    // `patternMember`, beside it, had always forwarded the carrier.
    const outerCurrent = tri(contains(persisted, { title: "x" }, null, {}, ctx));
    const outerStale = tri(contains(persisted, { oldTitle: "x" }, null, {}, ctx));
    expect(outerCurrent).toBe("true");
    expect(outerStale).toBe("false");

    // ⚠ THE NESTED SHAPE MATTERS AND THE FIRST CUT GOT IT WRONG. It used an
    // `SeIntersect`, which recurses but never routes through `namedMember` — so
    // the pin could not have reddened under `wire:named-carrier` and was
    // evidence for nothing (review round 9 caught it). `namedMember` is reached
    // only through a `SeRef` whose handle resolves to a registered named set,
    // which is what this now builds.
    const { registerAccountNamedSet, clearAccountNamedSets } = await import("./set-algebra");
    const ACCOUNT = "p1a20-r8";
    const HANDLE = "test:p1a20-r8-nested";
    clearAccountNamedSets(ACCOUNT);
    registerAccountNamedSet(ACCOUNT, HANDLE, persisted as never);
    try {
      const ref = { $tag: "SeRef", handle: HANDLE } as unknown as SetExpr;
      // Same set, same context, reached through the nested lane: the two lanes
      // must agree. Before the fix they contradicted each other on one call.
      expect(tri(contains(ref, { title: "x" }, ACCOUNT, {}, ctx))).toBe(outerCurrent);
      expect(tri(contains(ref, { oldTitle: "x" }, ACCOUNT, {}, ctx))).toBe(outerStale);
    } finally {
      clearAccountNamedSets(ACCOUNT);
    }
  }, 1_800_000);

  test("THE WIRE LANE'S TEMPORAL RESIDUAL, and why it is NOT the ctor lane's clause", async () => {
    const { contains } = await import("./set-algebra");
    // A frozen index in a REPLACEABLE context slot: everything the read checks
    // is true, and the caller then swaps the slot. The ctor lane closes this
    // shape by requiring a frozen CONTEXT; the wire lane deliberately does not,
    // and the asymmetry is load-bearing rather than an oversight.
    //
    // The two lanes differ in what abstention COSTS. The ctor lane's fallback is
    // `Nothing` — refusing a context is free. The wire lane's fallback is a
    // DIFFERENT DEFINITE, the process identity authority, and legitimate
    // unfrozen contexts exist (`overlayUserFunctions`, `performIODescriptor`
    // produce unfrozen spreads carrying a frozen own index). Requiring a frozen
    // context there would push exactly those callers back to the process
    // authority — which for an account-only field is this row's ORIGINAL defect.
    // So the residual is stated, not fenced.
    const ID = "3a2b1c0d-9e8f-4776-8655-443322110099";
    const set = {
      $tag: "SeCtor", ctor: "",
      fields: [{ $tag: "SetCtorField", key: { $tag: "NamedField", ref: { $ref: ID } }, wireName: "title", set: { $tag: "SeAll" } }],
    } as unknown as SetExpr;
    const mutableCtx: { _fieldCurrentWire: Readonly<Record<string, string>> } = {
      _fieldCurrentWire: Object.freeze({ [ID]: "current" }),
    };
    expect(tri(contains(set, { current: "x" }, null, {}, mutableCtx as never))).toBe("true");
    // The caller swaps the whole slot for another frozen index.
    mutableCtx._fieldCurrentWire = Object.freeze({ [ID]: "moved" });
    expect(tri(contains(set, { moved: "x" }, null, {}, mutableCtx as never))).toBe("true");
    expect(tri(contains(set, { current: "x" }, null, {}, mutableCtx as never))).toBe("false");
    // A certificate issued before the swap is therefore stale — the same
    // issue-time / exercise-time split the register accepts elsewhere, and the
    // reason this row stays SIDE-CONDITIONED rather than becoming a theorem.
  });
});

describe("P1(a.20) r9 — validate()'s PRODUCTION calling convention", () => {
  test("`{registry}` resolves the caller's field wire, exactly as `{functions}` does", async () => {
    const { validate } = await import("./validate");
    const { createAccountFieldRegistry } = await import("./account-field-registry");
    // ⚠ ROUND 8 REPAIRED THE WRONG HALF OF THIS DOOR, and the correction is the
    // finding. It threaded the caller's index through `pureEvaluateContext` and
    // pinned the `{functions}` lane — but the PRODUCT does not pass
    // `functions`. `AdminForm.tsx` passes `{ registry: fieldRegistry() }` and
    // `handlers/state.ts` passes `{ coerce: true, registry }`. The door read
    // only `functions` and fell to the SYSTEM context, so `$refined` membership
    // resolved an account field's wire through an authority that does not know
    // it. `$record` validation was already correct — the projection natives
    // close over `opts.registry` directly — which is exactly why this survived
    // eight rounds: the defect was confined to the one read the row is about.
    const ID = "6d5c4b3a-2918-4770-8665-544332211009";
    const reg = createAccountFieldRegistry([], "p1a20-r9-pin", {
      owners: [{
        ownerKey: "type:r9pin", kind: "type", storageName: "r9pin",
        definition: { id: "R9PinArticle", type: { $record: { fields: [{
          name: "title", key: { $tag: "NamedField", ref: { $ref: ID } },
          type: { $ref: "String" }, label: { $tag: "Nothing" }, ui: { $tag: "Nothing" }, meta: {},
        }] } } },
      }],
      fields: [{ id: ID, currentCodeName: "title", status: "live", realm: "account", reuseVisibility: "account" }],
      facets: [],
    } as never);
    const refined = { $refined: { base: { $record: { fields: [] } }, set: {
      $tag: "SeCtor", ctor: "", fields: [{
        $tag: "SetCtorField", key: { $tag: "NamedField", ref: { $ref: ID } },
        wireName: "oldTitle", set: { $tag: "SeAll" },
      }],
    } } } as unknown as FenelType;
    const valid = (v: unknown, opts: unknown): boolean =>
      (validate(refined, v, null, opts as never) as { valid?: boolean }).valid === true;

    // BOTH conventions must agree, and both must answer from the ACCOUNT's own
    // index. Before the fix the `{registry}` pair read false / true — this
    // row's original polarity, on the door its own product argument names.
    for (const opts of [{ registry: reg }, { functions: reg.evaluateContext() }]) {
      const label = "registry" in opts ? "registry" : "functions";
      expect({ label, current: valid({ title: "x" }, opts) }).toEqual({ label, current: true });
      expect({ label, stale: valid({ oldTitle: "x" }, opts) }).toEqual({ label, stale: false });
    }
  }, 1_800_000);

  test("with BOTH supplied, ONE call does not use TWO field authorities", async () => {
    const { validate } = await import("./validate");
    const { createAccountFieldRegistry } = await import("./account-field-registry");
    const { getSystemEvaluateContext } = await import("./system-registry");
    // ⚠ REVIEW ROUND 10. Repairing `{registry}` left the BOTH shape split: the
    // `$record` projections close over `opts.registry` structurally and cannot
    // be redirected, while the `$refined` membership followed `functions` — so
    // one `validate` call read its record fields from the account and its
    // refinement membership from the system, and answered the account's own
    // current spelling INVALID and its stale one VALID. Two spellings of one
    // call are not two configurations; they are one judgment contradicting
    // itself. A first cut carried the registry index only when `functions` had
    // NO index, which is too weak by exactly this case: the system context HAS
    // an index (thousands of fields), it just does not carry the account's key.
    const ID = "5a4b3c2d-1e0f-4998-8877-665544332211";
    const reg = createAccountFieldRegistry([], "p1a20-r10-both", {
      owners: [{
        ownerKey: "type:r10both", kind: "type", storageName: "r10both",
        definition: { id: "R10BothArticle", type: { $record: { fields: [{
          name: "title", key: { $tag: "NamedField", ref: { $ref: ID } },
          type: { $ref: "String" }, label: { $tag: "Nothing" }, ui: { $tag: "Nothing" }, meta: {},
        }] } } },
      }],
      fields: [{ id: ID, currentCodeName: "title", status: "live", realm: "account", reuseVisibility: "account" }],
      facets: [],
    } as never);
    const set = {
      $tag: "SeCtor", ctor: "", fields: [{
        $tag: "SetCtorField", key: { $tag: "NamedField", ref: { $ref: ID } },
        wireName: "oldTitle", set: { $tag: "SeAll" },
      }],
    };
    const refined = { $refined: { base: { $record: { fields: [] } }, set } } as unknown as FenelType;
    const both = { functions: getSystemEvaluateContext(), registry: reg } as never;
    const valid = (v: unknown): boolean =>
      (validate(refined, v, null, both) as { valid?: boolean }).valid === true;
    expect({ current: valid({ title: "x" }) }).toEqual({ current: true });
    expect({ stale: valid({ oldTitle: "x" }) }).toEqual({ stale: false });
  }, 1_800_000);
});

describe("P1(a.20) r10 — the two stability clauses that had no defeater of their own", () => {
  // ⚠ THESE PINS EXIST BECAUSE `DISCRIMINATES 24/24` DID NOT MEAN WHAT IT SAID.
  // The sweep proves each REVERT CASE reddens a pin; it cannot prove that every
  // shipped CLAUSE has a revert case. Review round 10 substituted clauses one at
  // a time at load time and found two that no case reverts, and whose existing
  // pins stay green when the clause alone is removed — because a neighbouring
  // clause refuses the same witness first. Both are load-bearing: the witnesses
  // below defeat each one ALONE, and each is now reverted by its own named case
  // (`stable:constructor-slot-own-data`, `stable:wire-table-frozen`).
  const kP0 = { $tag: "PositionalField", index: 0 } as unknown as FieldKey;
  const arrow = {
    $tag: "SeArrow",
    params: [{ $tag: "SetArrowParam", key: kP0, wireName: "_0", set: enumS(5) }],
    returns: { $tag: "SeCtor", ctor: "Just", fields: [{ $tag: "SetCtorField", key: kP0, wireName: "_0", set: enumS(5) }] },
  } as unknown as SetExpr;
  const closure = { __fenelFn: true, params: ["x"], body: { construct: ["Just", { var: "x" }] }, closure: {} };

  test("a TWO-FACED `_constructors` getter does not certify — own-DATA, not merely own", async () => {
    const { contains } = await import("./set-algebra");
    // The gate reads `_constructors` ONCE and the `construct` op reads it again.
    // A getter can answer differently on the two reads while every freeze
    // condition holds and the prototype is plain, so `Object.isFrozen(ctx)` and
    // the prototype clause both pass and only the own-DATA requirement refuses.
    // The old inherited-table witness cannot isolate this clause: round 8's
    // plain-prototype guard rejects it first, in both builds.
    let reads = 0;
    const FIRST = Object.freeze({ Just: Object.freeze(["_0"]) });
    const SECOND = Object.freeze({ Just: Object.freeze(["var"]) });
    const twoFaced = Object.freeze(Object.defineProperty({}, "_constructors", {
      get: () => (++reads === 1 ? FIRST : SECOND),
      enumerable: true,
      configurable: false,
    })) as never;
    expect(Object.getPrototypeOf(twoFaced as object)).toBe(Object.prototype);
    expect(Object.isFrozen(twoFaced)).toBe(true);
    expect(tri(contains(arrow, closure as never, null, undefined, twoFaced))).toBe("nothing");
    // The control: the SAME table as an own DATA property certifies, so the
    // clause is about the property KIND and not about the table's contents.
    const ownData = Object.freeze({ _constructors: FIRST }) as never;
    expect(tri(contains(arrow, closure as never, null, undefined, ownData))).toBe("true");
  });

  test("a MUTABLE `_constructorWireNames` does not certify, even while it is still EMPTY", async () => {
    const { contains, } = await import("./set-algebra");
    const { invokeCallable } = await import("./json-logic");
    // The rename clause refuses a table that ALREADY renames the tag. It cannot
    // refuse one that renames it LATER — so the freeze requirement is what
    // stands between "no rename at certification time" and "no rename at
    // exercise time". The existing rename pin cannot isolate it: its fixture
    // starts with the rename present, so the name-present clause keeps that pin
    // green whether or not the freeze clause is there.
    const wires: Record<string, string> = {};
    const ctx = Object.freeze({
      _constructors: Object.freeze({ Just: Object.freeze(["_0"]) }),
      _constructorWireNames: wires,
    }) as never;
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(Object.isFrozen(wires)).toBe(false);
    expect(tri(contains(arrow, closure as never, null, undefined, ctx))).toBe("nothing");
    // …and the contradiction it would license, asserted so this pin cannot go
    // green because the EXERCISE changed rather than the fence.
    wires["Just"] = "Other";
    expect(invokeCallable(closure, [5], ctx)).toEqual({ $tag: "Other", _0: 5 } as never);
    // The control: the same table FROZEN and empty certifies, so the clause is
    // about mutability and not about the table's presence.
    const frozenEmpty = Object.freeze({
      _constructors: Object.freeze({ Just: Object.freeze(["_0"]) }),
      _constructorWireNames: Object.freeze({}),
    }) as never;
    expect(tri(contains(arrow, closure as never, null, undefined, frozenEmpty))).toBe("true");
  });
});

describe("P1(a.20) r10 — an AMBIGUOUS field key is not an ABSENT one", () => {
  test("a case-collided key ABSTAINS instead of resolving through another registry", async () => {
    const { contains } = await import("./set-algebra");
    const { createAccountFieldRegistry } = await import("./account-field-registry");
    const { getSystemRegistry } = await import("./system-registry");
    // ⚠ THE ROUND-5 COLLISION REPAIR MINTED THIS ROW'S FALSE DEFINITES A THIRD
    // TIME, and only a booted SYSTEM registry makes it visible. Round 4 keyed
    // the index case-insensitively; round 5 found that two raw ids collapsing
    // onto one key made the later answer for the earlier, and DROPPED the
    // colliding entry. But a dropped entry is indistinguishable from an absent
    // one, and the reader's documented fall-through then resolved the handle
    // through `identityAuthorityRegistry()` — a DIFFERENT registry. Measured
    // from public API: an account field `FFD5BF84-… → account_head` colliding
    // with the system's `ffd5bf84-… → head` REFUTED `{account_head}` and
    // ACCEPTED `{head}`, the exact INVERSE of the parent, which missed
    // case-sensitively and kept the correct embedded wire.
    //
    // "No answer" is not "no opinion". This registry HAS an opinion and it is
    // ambiguous, so it publishes the collided keys and the reader abstains.
    getSystemRegistry();
    const LOWER = "ffd5bf84-d5d7-4755-a3c9-649b4adbf994";
    const UPPER = LOWER.toUpperCase();
    const reg = createAccountFieldRegistry([], "p1a20-r10-collide", {
      owners: [{
        ownerKey: "type:r10collide", kind: "type", storageName: "r10collide",
        definition: { id: "R10CollideRow", type: { $record: { fields: [{
          name: "account_head", key: { $tag: "NamedField", ref: { $ref: UPPER } },
          type: { $ref: "String" }, label: { $tag: "Nothing" }, ui: { $tag: "Nothing" }, meta: {},
        }] } } },
      }],
      fields: [
        { id: UPPER, currentCodeName: "account_head", status: "live", realm: "account", reuseVisibility: "account" },
        { id: LOWER, currentCodeName: "head", status: "live", realm: "account", reuseVisibility: "account" },
      ],
      facets: [],
    } as never);
    const ctx = reg.evaluateContext();
    // The collision is real and the registry says so rather than picking one.
    const amb = (ctx as unknown as { _fieldCurrentWireAmbiguous?: Record<string, true> })
      ._fieldCurrentWireAmbiguous;
    expect(amb?.[LOWER]).toBe(true);
    expect((ctx as unknown as { _fieldCurrentWire?: Record<string, string> })
      ._fieldCurrentWire?.[LOWER]).toBe(undefined);

    const set = {
      $tag: "SeCtor", ctor: "", fields: [{
        $tag: "SetCtorField", key: { $tag: "NamedField", ref: { $ref: UPPER } },
        wireName: "account_head", set: { $tag: "SeAll" },
      }],
    } as unknown as SetExpr;
    // With no index authority the read falls to the declared no-authority
    // reading — the embedded wire — which is the account's own spelling. What
    // must NOT happen is the system registry's `head` answering for it.
    expect(tri(contains(set, { account_head: "x" }, null, {}, ctx as never))).toBe("true");
    expect(tri(contains(set, { head: "x" }, null, {}, ctx as never))).toBe("false");
  }, 1_800_000);
});
