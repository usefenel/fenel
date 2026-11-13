// ---------------------------------------------------------------------------
// signature-observation-fence.test.ts — the Phase 4+4b quantified-OBSERVATION
// fence (slice 3b; P4-D2's second deliverable).
//
// THE THEOREM UNDER TEST IS WHOLE-EXECUTION SUBSTITUTION EQUIVARIANCE, and
// non-observation is a CONSERVATIVE SUFFICIENT CONDITION for it — not a
// definition of it, and not a characterization of polymorphism. So every
// assertion here is one of exactly two kinds:
//   * a FENCE is required (a body that could observe κ must not be admitted);
//   * an ADMISSION is required (returning or merely plumbing κ is not an
//     observation — otherwise `id` would be impossible).
//
// METHOD NOTE (earned in 2b, re-earned in 3a): every expected verdict below was
// read off the live analysis BEFORE it was written down, and every runtime
// premise was verified against `json-logic.ts` before a test froze it. A test
// written from a wrong model makes the wrong model permanent.
//
// The `finding N` labels refer to the 2026-07-26 `gpt-5.6-sol` ultra design
// review recorded at `notes/phase-4-slice-3b-codex-design-review.md`; each is a
// regression pin for a defect that review found in the plan BEFORE it was built.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "bun:test";
import ts from "typescript";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { dispatchEngineBody, marshalStoredBodyForValidation } from "./engine-bodies-dispatch";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..", "..");
const read = (relative: string): string => readFileSync(join(REPO, relative), "utf8");
// The trusted-computing-base ledger is a private design document. A public
// checkout skips the cases that read it (reported as skipped, never passed).
const TCB_LEDGER = "design/tcb-ledger.md";
const HAS_TCB_LEDGER = existsSync(join(REPO, TCB_LEDGER));

const OBSERVE_SRC = "fenel/modules/engine/validation-observe.fenel";
const JSON_LOGIC_SRC = "implementations/typescript/engine/src/json-logic.ts";

const call = (fn: string, args: unknown[]): any =>
  dispatchEngineBody(`engine:${fn}`, args) as any;

// ---------------------------------------------------------------------------
// raw JsonLogic fixtures — the marshalled carrier the analysis walks
// ---------------------------------------------------------------------------

const Jbool = (value: boolean) => ({ $tag: "JlBool", value });
const Jnum = (value: number) => ({ $tag: "JlNumber", value });
const Jstr = (value: string) => ({ $tag: "JlString", value });
const Jarr = (...items: unknown[]) => ({ $tag: "JlArray", items });
const Jfield = (name: string, value: unknown) => ({ $tag: "JlField", name, value });
const Jobj = (...kv: [string, unknown][]) => ({
  $tag: "JlObject",
  fields: kv.map(([k, v]) => Jfield(k, v)),
});
const Jtagged = (tag: string, ...kv: [string, unknown][]) => ({
  $tag: "JlTagged",
  tag,
  fields: kv.map(([k, v]) => Jfield(k, v)),
});
const Jop = (op: string, ...args: unknown[]) => Jobj([op, Jarr(...args)]);
const Jvar = (name: string) => Jobj(["var", Jstr(name)]);

// ---------------------------------------------------------------------------
// provenance fixtures
// ---------------------------------------------------------------------------

const CLEAN = { $tag: "PvClean" };
const opaque = (...rigids: number[]) => ({ $tag: "PvOpaque", rigids });
const slot = (key: string, prov: unknown) => ({ $tag: "ObsProvSlot", key, prov });
const shell = (shape: string, slots: unknown[] = []) => ({ $tag: "PvShell", shape, slots });
const bind = (name: string, prov: unknown) => ({ $tag: "ObsBind", name, prov });

/** A frozen call-target record. Defaults describe the SAFEST shape (a resolved,
 *  exact-arity, direct-route Fenel body) so each test perturbs exactly one axis. */
const target = (over: Record<string, unknown> = {}): any => ({
  $tag: "ObsCallTarget",
  rawKey: "t",
  sourceTargetId: "mod:t",
  flatTargetId: "mod:t",
  origin: "FenelBody",
  tier: "",
  key: "",
  dispatchRoute: "RDirect",
  dispatchPos: 0,
  arity: 1,
  resultRigids: [],
  profile: "interpreted",
  dependencyId: "dep",
  summary: { $tag: "Nothing" },
  ...over,
});

const summary = (over: Record<string, unknown> = {}): any => ({
  $tag: "Just",
  _0: {
    $tag: "ObsProvSummary",
    targetId: "mod:t",
    schemeHash: "h",
    origin: "FenelBody",
    profile: "interpreted",
    version: "v1",
    paramCount: 1,
    formals: ["y"],
    observesFrom: [],
    outputDerivesFrom: [],
    outputIntrinsicRigids: false,
    invalidationKey: "dep",
    ...over,
  },
});

const ONE_PROFILE = ["interpreted"];

/** Run the fence over one body from PRE-ORIGINATED provenance.
 *
 *  SLICE 3d: this is `vobAnalyzeFromProvenance`, the ANALYSIS-INTERNAL entry,
 *  not the public one. The public `vobAnalyze` no longer accepts a provenance
 *  at all — it takes declared types and originates the scope itself, which is
 *  the point of 3d-D1 — and a shell is not constructible through it by design.
 *  The algebra rules below still have to be driven over shell and opaque
 *  scrutinees, so they use the internal entry; `analyzeRequest` below exercises
 *  the public one. */
const analyze = (
  body: unknown,
  params: unknown[] = [],
  ordinals: number[] = [0],
  targets: unknown[] = [],
  analysed: string[] = ONE_PROFILE,
  required: string[] = ONE_PROFILE,
): any => call("vobAnalyzeFromProvenance", [
  "caller", body, params, ordinals, targets, analysed, required,
]);

// --- slice 3d — the PUBLIC entry, over a frozen request -------------------

const quantifier = (id: string, sourceName: string) => ({
  $tag: "ObsQuantifier", id, sourceName,
});
/** A declared type, marshalled the way the boundary marshals a body. Declared
 *  types are `$`-keyed, so they cannot be authored in `.fenel` and must arrive
 *  through the existing marshal. */
const declared = (type: unknown): unknown =>
  marshalStoredBodyForValidation(type, "declared type");
const param = (name: string, type: unknown) => ({
  $tag: "ObsParam", name, declared: declared(type),
});

const ONE_QUANTIFIER = [quantifier("q0", "a")];

/** A frozen analysis request. Defaults describe the SIMPLEST admissible shape
 *  — one quantifier, the interpreted lowering, the direct evaluator entry — so
 *  each test perturbs exactly one axis. */
const request = (over: Record<string, unknown> = {}): any => ({
  $tag: "ObsRequest",
  callerId: "caller",
  body: Jnum(1),
  params: [],
  quantified: ONE_QUANTIFIER,
  targets: [],
  bodyHash: "bh",
  schemeHash: "sh",
  validatorVersion: "v-test",
  registryProfile: "SYSTEM",
  lowering: "interpreted",
  evaluator: "Direct",
  analysedProfiles: ONE_PROFILE,
  requiredProfiles: ONE_PROFILE,
  ...over,
});

const analyzeRequest = (over: Record<string, unknown> = {}): any =>
  call("vobAnalyze", [request(over)]);

const details = (outcome: any): string[] =>
  (outcome?.reasons ?? []).filter((r: any) => r.detail !== undefined).map((r: any) => r.detail);

// --- slice 3d — the closed representation descriptor ----------------------

const rprGround = { $tag: "RprGround" };
const rprOpaque = (...ordinals: number[]) => ({ $tag: "RprOpaque", ordinals });
const rprTransparent = (inner: unknown) => ({ $tag: "RprTransparent", inner });
const rprSlot = (key: string, repr: unknown) => ({ $tag: "ObsReprSlot", key, repr });
const rprShell = (shape: string, slots: unknown[]) => ({ $tag: "RprShell", shape, slots });

const isFenced = (outcome: any): boolean => outcome?.$tag === "ObsFenced";
const reasonTags = (outcome: any): string[] =>
  (outcome?.reasons ?? []).map((r: any) => r.$tag);
const channels = (outcome: any): string[] =>
  (outcome?.reasons ?? []).filter((r: any) => r.channel !== undefined).map((r: any) => r.channel);

// ---------------------------------------------------------------------------

describe("slice 3b — the abstract domain (3b-D1)", () => {
  it("an opaque atom over an EMPTY ordinal set is unconstructible", () => {
    // The join caveat the design review raised: `vobIsGround` reads emptiness as
    // ground, so such an atom would fence shape observers while ADMITTING deep
    // observers. Normalizing at the constructor removes the case entirely.
    expect(call("vobOpaqueOf", [[]])).toEqual(CLEAN);
    expect(call("vobOpaqueOf", [[0]])).toEqual(opaque(0));
    // and the join cannot manufacture one either
    expect(call("vobJoin", [opaque(), CLEAN])).toEqual(CLEAN);
    expect(call("vobTaint", [shell("M", [slot("_0", CLEAN)])])).toEqual(CLEAN);
  });

  it("ground-ness is DEEP while shape-fixedness is OUTER, and the two differ", () => {
    const maybeK = shell("Maybe", [slot("_0", opaque(0))]);
    // a shell over a rigid payload: its FORMER is fixed, its content is not
    expect(call("vobShapeFixed", [maybeK])).toBe(true);
    expect(call("vobIsGround", [maybeK])).toBe(false);
    // an opaque atom is neither
    expect(call("vobShapeFixed", [opaque(0)])).toBe(false);
    expect(call("vobIsGround", [opaque(0)])).toBe(false);
    // a ground shell is both — and that is what keeps `length [1,2,3]` admissible
    const litArray = shell("«array»", [slot("«element»", CLEAN)]);
    expect(call("vobShapeFixed", [litArray])).toBe(true);
    expect(call("vobIsGround", [litArray])).toBe(true);
  });

  it("the join is conservative where it cannot verify shape agreement", () => {
    const maybeK = shell("Maybe", [slot("_0", opaque(0))]);
    // same shape ⇒ slotwise
    const joined = call("vobJoin", [maybeK, shell("Maybe", [slot("_0", CLEAN)])]);
    expect(joined.$tag).toBe("PvShell");
    expect(joined.shape).toBe("Maybe");
    // different shapes ⇒ the opaque union (the shape claim can no longer hold)
    expect(call("vobJoin", [maybeK, shell("List", [slot("«element»", opaque(1))])]))
      .toEqual(opaque(0, 1));
    // clean ⊔ shell ⇒ the shell's TAINT, because PvClean carries no shape
    expect(call("vobJoin", [CLEAN, maybeK])).toEqual(opaque(0));
    // ... and a GROUND shell joined with clean stays clean (no taint to add)
    expect(call("vobJoin", [CLEAN, shell("Maybe", [slot("_0", CLEAN)])])).toEqual(CLEAN);
    // ordinals accumulate as a SET
    expect(call("vobJoin", [opaque(0), opaque(1)]).rigids.slice().sort()).toEqual([0, 1]);
    expect(call("vobJoin", [opaque(0), opaque(0)]).rigids).toEqual([0]);
  });

  it("a slot present on only ONE side of a join keeps its provenance, never Clean", () => {
    const joined = call("vobJoin", [
      shell("R", [slot("a", opaque(0))]),
      shell("R", [slot("b", opaque(1))]),
    ]);
    expect(joined.$tag).toBe("PvShell");
    const byKey = Object.fromEntries(joined.slots.map((s: any) => [s.key, s.prov.$tag]));
    expect(byKey).toEqual({ a: "PvOpaque", b: "PvOpaque" });
  });
});

describe("slice 3b — the raw-form transfer table (3b-D2)", () => {
  it("EXHAUSTIVENESS: every KNOWN_OP in json-logic.ts has an explicit row", () => {
    // Re-derived from source, not copied: a forty-first op cannot be added to
    // the evaluator without failing here.
    const src = read(JSON_LOGIC_SRC);
    const block = src.slice(src.indexOf("const KNOWN_OPS"));
    const body = block.slice(block.indexOf("["), block.indexOf("]);") + 1);
    const sourceOps = [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!);
    expect(sourceOps.length).toBe(40);

    const tableOps: string[] = call("vobOpNames", [0]);
    expect([...tableOps].sort()).toEqual([...sourceOps].sort());

    // and no row inherits the DEFAULT. An explicit `VfcFence` is a real transfer
    // (a raw-rule intrinsic genuinely fences); the default is identified by its
    // detail string, so this distinguishes "deliberately fenced" from "unlisted".
    const DEFAULT_DETAIL = call("vobClassifyForm", ["definitely-not-an-op"]).detail;
    expect(DEFAULT_DETAIL).toBe("raw form absent from the transfer table");
    for (const op of sourceOps) {
      const klass = call("vobClassifyForm", [op]);
      expect(klass.detail, `${op} inherits the default transfer`).not.toBe(DEFAULT_DETAIL);
    }
  });

  it("EXHAUSTIVENESS: an unrecognized raw form FENCES rather than defaulting", () => {
    for (const bogus of ["zzz", "", "cat", "eq", "$notAnOp"]) {
      expect(call("vobClassifyForm", [bogus]).$tag).toBe("VfcFence");
    }
  });

  it("the table is projected from the enumeration, so the two cannot drift", () => {
    const names: string[] = call("vobFormNames", [0]);
    const rows: any[] = call("vobFormTable", [0]);
    expect(rows.length).toBe(names.length);
    expect(rows.map((r) => r.form)).toEqual(names);
    for (const r of rows) {
      expect(r.class).toEqual(call("vobClassifyForm", [r.form]));
    }
    // the tiers and the ops partition the form set
    const tiers: string[] = call("vobTierNames", [0]);
    const ops: string[] = call("vobOpNames", [0]);
    expect(tiers.length + ops.length).toBe(names.length);
    expect(tiers.every((t) => t.startsWith("«"))).toBe(true);
    expect(ops.some((o) => o.startsWith("«"))).toBe(false);
  });

  it("finding 10: BUILTIN_OP_NATIVES has 31 keys, and the KNOWN_OPS overlap takes precedence", () => {
    const src = read(JSON_LOGIC_SRC);
    const block = src.slice(src.indexOf("const BUILTIN_OP_NATIVES"));
    const body = block.slice(0, block.indexOf("\n};"));
    // A depth-aware scan: a regex over the body also matches parameter type
    // annotations inside the implementations (`(a: unknown)`).
    // Line comments must be stripped first: a comment occupies the position
    // where the next key would be, so `add` and `"+"` (each the first key after
    // a comment line) were silently dropped. `[^\n]*` rather than `.*$` because
    // this file is CRLF and `.` does not match `\r`.
    const objBody = body.slice(body.indexOf("{") + 1).replace(/\/\/[^\n]*/g, "");
    const keys = new Set<string>();
    let depth = 0;
    let atKeyPosition = true;
    for (let i = 0; i < objBody.length; i++) {
      const c = objBody[i]!;
      if (c === "(" || c === "[" || c === "{") { depth++; continue; }
      if (c === ")" || c === "]" || c === "}") { depth--; continue; }
      if (depth !== 0) continue;
      if (c === ",") { atKeyPosition = true; continue; }
      if (!atKeyPosition || /\s/.test(c)) continue;
      const m = /^(?:"([^"]+)"|([A-Za-z_$][\w$]*)|([^\s:]+))\s*:/.exec(objBody.slice(i));
      if (m) keys.add((m[1] ?? m[2] ?? m[3])!);
      atKeyPosition = false;
    }
    expect(keys.size).toBe(31);

    // `and` / `or` are in BOTH sets; the raw single-key path takes KNOWN_OPS
    // first (json-logic.ts:1233 precedes 1248), so the meta-test must NOT demand
    // a key-as-fnId classification for them — that would contradict the runtime.
    const ops: string[] = call("vobOpNames", [0]);
    const overlap = [...keys].filter((k) => ops.includes(k));
    expect(overlap.sort()).toEqual(["and", "or"]);
    expect(call("vobClassifyForm", ["and"]).$tag).toBe("VfcStructural");
    // every NON-overlapping builtin is a key-as-fnId call head, not a known op
    for (const k of keys) {
      if (overlap.includes(k)) continue;
      expect(call("vobIsKnownOp", [k]), `${k} misclassified as a KNOWN_OP`).toBe(false);
    }
    expect(call("vobClassifyForm", ["«key-as-fnId»"]).$tag).toBe("VfcCall");
  });
});

describe("slice 3b — what must be ADMITTED (the fence is not a wall)", () => {
  it("the identity body admits: returning κ is not observing it", () => {
    const out = analyze(Jvar("x"), [bind("x", opaque(0))]);
    expect(out.$tag).toBe("ObsAdmitted");
    expect(out.prov).toEqual(opaque(0));
  });

  it("`const`-shaped plumbing admits, and the result provenance is exact", () => {
    const out = analyze(Jvar("a"), [bind("a", opaque(0)), bind("b", opaque(1))]);
    expect(out.$tag).toBe("ObsAdmitted");
    expect(out.prov).toEqual(opaque(0));
  });

  it("a rigid-free body with no calls admits, and stays clean", () => {
    const out = analyze(Jop("if", Jbool(true), Jnum(1), Jnum(2)), [], []);
    expect(out.$tag).toBe("ObsAdmitted");
    expect(out.prov).toEqual(CLEAN);
  });

  it("with NO quantified ordinals in scope, nothing can be κ-typed", () => {
    // A monomorphic body is not the fence's business: an unknown value in a
    // scope that quantifies nothing is exactly clean, not conservatively opaque.
    expect(call("vobUnknownProv", [[]])).toEqual(CLEAN);
    const out = analyze(Jop("length", Jvar("x")), [bind("x", CLEAN)], []);
    expect(out.$tag).toBe("ObsAdmitted");
  });

  it("`length` of an ARRAY LITERAL admits — extent is fixed even over κ elements", () => {
    // The shape/deep observer split earns this: a literal's extent does not vary
    // with the instantiation, so reading it is not an observation of κ.
    const out = analyze(Jop("length", Jarr(Jvar("x"), Jvar("x"))), [bind("x", opaque(0))]);
    expect(out.$tag).toBe("ObsAdmitted");
    expect(call("vobClassifyForm", ["length"]).$tag).toBe("VfcShapeObserver");
  });
});

describe("slice 3b — the pattern rules M1-M6 (finding 1's grammar, not the ADT)", () => {
  it("finding 1 regression: a RAW STRUCTURAL OBJECT pattern is analysed, not skipped", () => {
    // The four-case surface `Pattern` ADT does not bound runtime matching:
    // `matchPattern` takes an arbitrary object and REQUIRES the scrutinee to
    // carry each pattern key. A classifier blind to that would admit a body
    // that discriminates κ.
    const rawObjectPattern = Jobj(["someKey", Jstr("_")]);
    const out = analyze(
      Jop("match", Jvar("x"), rawObjectPattern, Jnum(1)),
      [bind("x", opaque(0))],
    );
    expect(isFenced(out)).toBe(true);
    expect(channels(out)).toContain("pattern-structural");
  });

  it("a `$bind` pattern observes NOTHING and propagates the scrutinee's provenance", () => {
    // M2 is checked before every structural arm, so it binds the whole value
    // without touching its representation.
    const out = analyze(
      Jop("match", Jvar("x"), Jobj(["$bind", Jstr("y")]), Jvar("y")),
      [bind("x", opaque(0))],
    );
    expect(out.$tag).toBe("ObsAdmitted");
    expect(out.prov).toEqual(opaque(0));
  });

  it("the wildcard observes nothing", () => {
    const out = analyze(Jop("match", Jvar("x"), Jstr("_"), Jnum(1)), [bind("x", opaque(0))]);
    expect(out.$tag).toBe("ObsAdmitted");
  });

  it("a LITERAL pattern is a deep host-identity comparison and fences on κ", () => {
    const out = analyze(Jop("match", Jvar("x"), Jnum(5), Jnum(1)), [bind("x", opaque(0))]);
    expect(isFenced(out)).toBe(true);
    expect(channels(out)).toContain("pattern-literal");
  });

  it("SHELL vs OPAQUE: matching a `Maybe` SHELL is not observing an arbitrary `a`", () => {
    const justPattern = Jtagged("Just", ["_0", Jobj(["$bind", Jstr("v")])]);
    const maybeK = shell("Maybe", [slot("_0", opaque(0))]);

    // over the SHELL: the outer former is fixed at every instantiation ⇒ admitted,
    // and the bound payload carries the rigid forward
    const shellOut = analyze(
      Jop("match", Jvar("m"), justPattern, Jvar("v")),
      [bind("m", maybeK)],
    );
    expect(shellOut.$tag).toBe("ObsAdmitted");
    expect(shellOut.prov).toEqual(opaque(0));

    // over the BARE rigid: the same pattern now discriminates κ's own
    // representation ⇒ fenced. This is the discrimination a binary taint
    // lattice cannot make.
    const opaqueOut = analyze(
      Jop("match", Jvar("m"), justPattern, Jvar("v")),
      [bind("m", opaque(0))],
    );
    expect(isFenced(opaqueOut)).toBe(true);
    expect(channels(opaqueOut)).toContain("pattern-tag");
  });

  it("an arm GUARD is a deep test in the arm-extended scope", () => {
    const guarded = Jobj(["$guard", Jarr(Jobj(["$bind", Jstr("y")]), Jvar("y"))]);
    const out = analyze(
      Jop("match", Jvar("x"), guarded, Jnum(1)),
      [bind("x", opaque(0))],
    );
    expect(isFenced(out)).toBe(true);
    expect(channels(out)).toContain("arm-guard");
  });
});

describe("slice 3b — finding 1 (CRITICAL): path-name operators observe the ENVIRONMENT", () => {
  it("`missing` fences on a κ binder even though its ARGUMENT is a clean literal", () => {
    // The defect the design review found in the plan: `missing`'s arguments are
    // raw PATH NAMES resolved in the data context (json-logic.ts:1628-1633), so
    // an argument-provenance transfer sees only clean strings.
    const out = analyze(Jop("missing", Jarr(Jstr("x"))), [bind("x", opaque(0))]);
    expect(isFenced(out)).toBe(true);
    expect(channels(out)).toContain("missing");
  });

  it("`missing` over a CLEAN binder admits", () => {
    const out = analyze(Jop("missing", Jarr(Jstr("x"))), [bind("x", CLEAN)]);
    expect(out.$tag).toBe("ObsAdmitted");
  });

  it("`missing_some` takes the same environment-path transfer", () => {
    const out = analyze(Jop("missing_some", Jnum(1), Jarr(Jstr("x"))), [bind("x", opaque(0))]);
    expect(isFenced(out)).toBe(true);
    expect(channels(out)).toContain("missing_some");
  });

  it("the table records the environment-path class explicitly, not as an observer", () => {
    expect(call("vobClassifyForm", ["missing"])).toEqual({ $tag: "VfcEnvPath", channel: "missing" });
    expect(call("vobClassifyForm", ["missing_some"]))
      .toEqual({ $tag: "VfcEnvPath", channel: "missing_some" });
  });
});

describe("slice 3b — the active-origin call gate (3b-D3)", () => {
  it("a Fenel-bodied callee fences for want of a summary (the inert posture)", () => {
    const out = analyze(Jop("call", Jstr("t"), Jnum(1)), [], [0], [target()]);
    expect(isFenced(out)).toBe(true);
    expect(reasonTags(out)).toContain("RsnMissingEvidence");
  });

  it("finding 2 of the runtime audit: a ctx-native WINS over a Fenel body", () => {
    // `ImplementationOrigin` is the ACTIVE branch, never "has a body": the
    // order is nativesCtx → natives → body (json-logic.ts:2370-2412). So a
    // registration with a Fenel body whose id is also in a native map is a
    // HostNative for this analysis.
    const src = read(JSON_LOGIC_SRC);
    const ctxAt = src.indexOf("if (ctx.nativesCtx) {");
    const nativesAt = src.indexOf("if (ctx.natives) {");
    const bodyAt = src.indexOf('ownDataRead(spec, "body")');
    expect(ctxAt).toBeGreaterThan(0);
    expect(ctxAt).toBeLessThan(nativesAt);
    expect(nativesAt).toBeLessThan(bodyAt);

    const hostTarget = target({ origin: "HostNative", tier: "nativeImpls", key: "t" });
    // a ground argument is fine — nothing about it varies with the instantiation
    expect(analyze(Jop("call", Jstr("t"), Jnum(1)), [], [0], [hostTarget]).$tag)
      .toBe("ObsAdmitted");
    // a κ-tainted argument is not
    const tainted = analyze(Jop("call", Jstr("t"), Jvar("x")), [bind("x", opaque(0))], [0], [hostTarget]);
    expect(isFenced(tainted)).toBe(true);
    expect(channels(tainted)).toContain("host-implementation:HostNative");
  });

  it("the BuiltinOpNative branch gates like any other host implementation", () => {
    // The fifth active branch `ImplementationOrigin` does not model
    // (json-logic.ts:2348-2351).
    expect(call("vobBranchIsHostActive", ["BuiltinOpNative"])).toBe(true);
    expect(call("vobBranchIsHostActive", ["FenelBody"])).toBe(false);
    for (const o of ["HostNative", "NativeWithFallback", "ExternalHandler"]) {
      expect(call("vobBranchIsHostActive", [o])).toBe(true);
    }
    expect(call("vobBranchIsHostActive", ["Nonsense"])).toBe(false);
  });

  it("an unrecognized implementation origin is an UNRESOLVED use, never a default", () => {
    const out = analyze(Jop("call", Jstr("t"), Jnum(1)), [], [0], [target({ origin: "Whatever" })]);
    expect(isFenced(out)).toBe(true);
    expect(reasonTags(out)).toContain("RsnUnresolvedSignatureUse");
  });

  it("a raw key with NO frozen target record is an unresolved use", () => {
    const out = analyze(Jop("call", Jstr("nope"), Jnum(1)), [], [0], []);
    expect(isFenced(out)).toBe(true);
    expect(reasonTags(out)).toContain("RsnUnresolvedSignatureUse");
  });

  it("gate rule 1: a source-frame vs flat-runtime target DISAGREEMENT fences", () => {
    // The seam the slice-2b ledger recorded: both answers are POSITIVE and they
    // differ, on a code-name collision reached through the key-as-fnId form.
    const out = analyze(
      Jop("call", Jstr("t"), Jnum(1)),
      [], [0],
      [target({ sourceTargetId: "A:f", flatTargetId: "B:g", origin: "HostNative", tier: "nativeImpls" })],
    );
    expect(isFenced(out)).toBe(true);
    expect(reasonTags(out)).toContain("RsnUnresolvedSignatureUse");
    const ledger = read("fenel/modules/engine/validation-ledger.fenel");
    expect(ledger).toContain("an explicit SLICE-3 obligation");
  });

  it("gate rule 2: a κ DISPATCH ARGUMENT fences — target selection would vary", () => {
    // The deepest channel: `rsvTypeKey` reflects the dispatch argument to pick
    // the instance, so WHICH CODE RUNS would depend on the instantiation.
    const dispatchTarget = target({
      origin: "HostNative", tier: "nativeImpls",
      dispatchRoute: "RDispatch", dispatchPos: 0, arity: 1,
    });
    const out = analyze(Jop("call", Jstr("t"), Jvar("x")), [bind("x", opaque(0))], [0], [dispatchTarget]);
    expect(isFenced(out)).toBe(true);
    expect(channels(out)).toContain("dispatch-argument");
  });

  it("gate rule 2 keys on POSITION ARRIVED, not on declared arity (finding 4a)", () => {
    // `rsvDispatchAt` reflects whenever 0 ≤ pos < |args| and never consults the
    // declared arity (dispatch.fenel), and bare dispatch runs BEFORE partial
    // creation. So "saturated" is the wrong conjunct.
    const dispatch = read("fenel/modules/engine/dispatch.fenel");
    expect(dispatch).toContain("if gte pos (length args)");
    // pos beyond the supplied args ⇒ the eta-deferred re-dispatching closure
    const deferred = target({
      dispatchRoute: "RDispatch", dispatchPos: 3, arity: 1,
      origin: "HostNative", tier: "nativeImpls",
    });
    const out = analyze(Jop("call", Jstr("t"), Jnum(1)), [], [0], [deferred]);
    expect(isFenced(out)).toBe(true);
    expect(reasonTags(out)).toContain("RsnCheckerAbstained");
  });

  it("a return-position dispatch route abstains (no instance is selected)", () => {
    const out = analyze(
      Jop("call", Jstr("t"), Jnum(1)),
      [], [0],
      [target({ dispatchRoute: "RReturnPosition", origin: "HostNative", tier: "nativeImpls" })],
    );
    expect(isFenced(out)).toBe(true);
    expect(reasonTags(out)).toContain("RsnCheckerAbstained");
  });

  it("finding 4b: OVER-application eta-applies leftovers to the RESULT — an ungated second call", () => {
    const src = read(JSON_LOGIC_SRC);
    expect(src).toContain("if (isCallableValue(result)) {");
    const out = analyze(
      Jop("call", Jstr("t"), Jnum(1), Jnum(2)),
      [], [0],
      [target({ arity: 1, origin: "HostNative", tier: "nativeImpls" })],
    );
    expect(isFenced(out)).toBe(true);
    expect(reasonTags(out)).toContain("RsnUnsupportedPartialApplication");
  });

  it("finding 5: UNDER-application produces a partial applied somewhere unseen", () => {
    const out = analyze(
      Jop("call", Jstr("t"), Jnum(1)),
      [], [0],
      [target({ arity: 3, origin: "HostNative", tier: "nativeImpls" })],
    );
    expect(isFenced(out)).toBe(true);
    expect(reasonTags(out)).toContain("RsnUnsupportedPartialApplication");
  });

  it("the argument count comes from the call SITE, never from the frozen record", () => {
    // One frozen record describes a callee; two sites may apply it differently.
    // A record cannot carry an optimistic count that weakens the arity rule.
    const src = read(OBSERVE_SRC);
    expect(src).toContain("there is deliberately NO `supplied` slot");
    const two = target({ arity: 2, origin: "HostNative", tier: "nativeImpls" });
    // one argument against arity 2 ⇒ under-applied
    expect(reasonTags(analyze(Jop("call", Jstr("t"), Jnum(1)), [], [0], [two])))
      .toContain("RsnUnsupportedPartialApplication");
    // two arguments against arity 2 ⇒ exact, admitted (a host branch, ground args)
    expect(analyze(Jop("call", Jstr("t"), Jnum(1), Jnum(2)), [], [0], [two]).$tag)
      .toBe("ObsAdmitted");
    // three ⇒ over-applied
    expect(reasonTags(analyze(Jop("call", Jstr("t"), Jnum(1), Jnum(2), Jnum(3)), [], [0], [two])))
      .toContain("RsnUnsupportedPartialApplication");
  });

  it("finding 9: a CTX-native fences whenever a rigid is live, whatever was passed", () => {
    // It receives the whole EvaluateContext, in which evaluator strategies park
    // caller data — so ground explicit arguments prove nothing.
    const ctxTarget = target({ origin: "HostNative", tier: "nativeImplsCtx", key: "t" });
    const out = analyze(Jop("call", Jstr("t"), Jnum(1)), [], [0], [ctxTarget]);
    expect(isFenced(out)).toBe(true);
    expect(channels(out)).toContain("ctx-native-ambient-context");
    // with nothing quantified there is no rigid to leak
    expect(analyze(Jop("call", Jstr("t"), Jnum(1)), [], [], [ctxTarget]).$tag).toBe("ObsAdmitted");
    expect(call("vobIsCtxTier", ["both"])).toBe(true);
    expect(call("vobIsCtxTier", ["nativeImpls"])).toBe(false);
  });

  it("finding 6: the named-argument hazard is SUBSUMED by the exact-arity rule", () => {
    // The review's diagnosis is right; its remedy is not. Namedishness is a
    // property of the EVALUATED argument, so an AST-shaped detector reports true
    // for a raw `{var: "x"}` — fencing ordinary calls while still missing the
    // real cases. The detector is kept; the gate is the arity rule.
    expect(call("vobNamedish", [[Jobj(["b", Jnum(1)])]])).toBe(true);
    expect(call("vobNamedish", [[Jvar("x")]])).toBe(true); // the false positive
    expect(call("vobNamedish", [[Jnum(1)]])).toBe(false);
    // a `$`-keyed record is a WIRE value, never named args (json-logic.ts:2090)
    expect(call("vobNamedish", [[Jobj(["$tag", Jstr("Nil")])]])).toBe(false);

    // the SUBSUMPTION, in three parts.
    // (a) the reorder fires only at exactly one argument (json-logic.ts:2069)
    expect(read(JSON_LOGIC_SRC)).toContain("if (args.length !== 1) return args;");
    // (b) one argument against a non-unit arity ⇒ the arity gate already fences
    const mismatched = analyze(
      Jobj(["call", Jarr(Jstr("t"), Jobj(["b", Jnum(1)], ["c", Jnum(2)]))]),
      [], [0],
      [target({ arity: 2, origin: "HostNative", tier: "nativeImpls" })],
    );
    expect(isFenced(mismatched)).toBe(true);
    expect(reasonTags(mismatched)).toContain("RsnUnsupportedPartialApplication");
    // (c) at arity 1 the record shell DOMINATES the field the callee receives,
    //     so the abstract argument over-approximates and no fence is needed
    const shellProv = analyze(Jobj(["b", Jvar("x")], ["c", Jnum(2)]), [bind("x", opaque(0))]).prov;
    expect(call("vobIsGround", [shellProv])).toBe(false);
    const fieldProv = shellProv.slots.find((sl: any) => sl.key === "b").prov;
    expect(call("vobIsGround", [fieldProv])).toBe(false);
    expect(call("vobJoin", [shellProv, fieldProv]).$tag).not.toBe("PvClean");
  });

  it("finding 4c: the `$` head puts the callee at index 1 and fences the form", () => {
    const src = read(JSON_LOGIC_SRC);
    expect(src).toContain('if (args[0] === "$") {');
    // P1(a.13): internal recursion targets `evaluateInner`; the exported
    // `evaluate` is the guarded DOOR (see the arm-inventory sentinel below).
    expect(src).toContain("const callee = evaluateInner(args[1], data, ctx);");
    const out = analyze(Jop("call", Jstr("$"), Jvar("f"), Jnum(1)), [bind("f", CLEAN)]);
    expect(isFenced(out)).toBe(true);
    expect(reasonTags(out)).toContain("RsnDynamicOrReflectiveUse");
  });

  it("finding 4d: the `method` form keys on the QUALIFIED name the resolver indexes", () => {
    expect(call("vobMethodKey", [[Jstr("Eq"), Jstr("eq")], "eq"])).toBe("Eq.eq");
    const dispatch = read("fenel/modules/engine/dispatch.fenel");
    expect(dispatch).toContain('mapGet table.posIdx (concat (concat cls ".") name)');
    // and it reaches the gate under that key
    const out = analyze(
      Jop("method", Jstr("Eq"), Jstr("eq"), Jvar("x")),
      [bind("x", opaque(0))], [0],
      [target({ rawKey: "Eq.eq", origin: "HostNative", tier: "nativeImpls", dispatchRoute: "RDispatch" })],
    );
    expect(isFenced(out)).toBe(true);
    expect(channels(out)).toContain("dispatch-argument");
  });

  it("a dynamic callee (`{var}` head) fences: the target is a VALUE", () => {
    const out = analyze(Jop("call", Jvar("f"), Jnum(1)), [bind("f", CLEAN)]);
    expect(isFenced(out)).toBe(true);
    expect(reasonTags(out)).toContain("RsnDynamicOrReflectiveUse");
  });

  it("`apply` / `pipe` / `|>` fence as dynamic applications", () => {
    for (const form of ["apply", "pipe", "|>"]) {
      expect(call("vobClassifyForm", [form]).$tag).toBe("VfcFence");
      const out = analyze(Jop(form, Jvar("f"), Jnum(1)), [bind("f", CLEAN)]);
      expect(isFenced(out), `${form} did not fence`).toBe(true);
    }
  });

  it("the raw-rule intrinsics fence: their rule runs in a data context we cannot see", () => {
    for (const form of ["map", "filter", "reduce", "all", "some", "none"]) {
      expect(call("vobClassifyForm", [form]).$tag).toBe("VfcFence");
      const out = analyze(Jop(form, Jarr(Jnum(1)), Jnum(2)), [], []);
      expect(isFenced(out), `${form} did not fence`).toBe(true);
    }
  });

  it("`withInstance` fences: it rebinds dispatch inside its extent", () => {
    expect(call("vobClassifyForm", ["withInstance"]).$tag).toBe("VfcFence");
    expect(isFenced(analyze(Jop("withInstance", Jnum(1)), [], []))).toBe(true);
  });
});

describe("slice 3b — the proof-summary schema (3b-D4)", () => {
  it("a matching summary admits the call", () => {
    const out = analyze(
      Jop("call", Jstr("t"), Jnum(1)),
      [], [0],
      [target({ summary: summary() })],
    );
    expect(out.$tag).toBe("ObsAdmitted");
  });

  it("finding 3 (CRITICAL): `observesFrom` blocks laundering through an `Any` formal", () => {
    // `inspect : Any -> Boolean; inspect y = isArray y` analysed in isolation
    // starts `y` clean, so an output-only summary would let a κ actual through.
    // The summary must declare which inputs it OBSERVES, checked against the
    // ACTUAL provenance.
    const observing = target({ summary: summary({ observesFrom: [0] }) });
    const tainted = analyze(Jop("call", Jstr("t"), Jvar("x")), [bind("x", opaque(0))], [0], [observing]);
    expect(isFenced(tainted)).toBe(true);
    expect(channels(tainted)).toContain("callee-observed-input");
    // a clean actual at the observed position is fine
    expect(analyze(Jop("call", Jstr("t"), Jnum(1)), [], [0], [observing]).$tag).toBe("ObsAdmitted");
  });

  it("a summary must be a summary OF THIS CALL — scheme, branch, profile, arity", () => {
    const cases: Record<string, unknown>[] = [
      { targetId: "other:f" },
      { origin: "HostNative" },
      { profile: "compiled-js" },
      { paramCount: 7 },
      { formals: [] },                 // formal vector vs frozen arity
      { invalidationKey: "stale" },     // vs the frozen dependency identity
      { schemeHash: "" },               // a summary with no scheme hash
      { version: "" },                  // a summary with no producer version
    ];
    for (const over of cases) {
      const out = analyze(
        Jop("call", Jstr("t"), Jnum(1)),
        [], [0],
        [target({ summary: summary(over) })],
      );
      expect(isFenced(out), `${JSON.stringify(over)} was not rejected`).toBe(true);
      expect(reasonTags(out)).toContain("RsnStaleEvidence");
    }
  });

  it("finding 3: output taint fires with NO tainted actual (return-position `default : a`)", () => {
    const out = analyze(
      Jop("call", Jstr("t"), Jnum(1)),
      [], [0],
      [target({ resultRigids: [0], summary: summary() })],
    );
    expect(out.$tag).toBe("ObsAdmitted");
    expect(out.prov).toEqual(opaque(0));
  });

  it("output taint also follows the summary's declared input derivation", () => {
    const out = analyze(
      Jop("call", Jstr("t"), Jvar("x")),
      [bind("x", opaque(1))], [1],
      [target({ summary: summary({ outputDerivesFrom: [0] }) })],
    );
    expect(out.$tag).toBe("ObsAdmitted");
    expect(out.prov).toEqual(opaque(1));
  });
});

describe("slice 3b — round-2 review regressions (the fixes' own defects)", () => {
  it("an OWN `length` field wins over the extent rule", () => {
    // A record can carry an own `length` key, and both `matchPattern` and
    // `resolveVar` read it verbatim — so answering "clean extent" before
    // consulting the slots handed back a clean provenance for a κ-typed payload.
    const rec = shell("«record»", [slot("length", opaque(0)), slot("keep", CLEAN)]);
    const projected = call("vobProject", [rec, "length", [], []]);
    expect(projected.prov).toEqual(opaque(0));
    // the extent rule still applies when there is NO own slot of that name
    const arr = shell("«array»", [slot("«element»", CLEAN)]);
    expect(call("vobProject", [arr, "length", [], []]).prov).toEqual(CLEAN);
    // ... and end to end through a pattern
    const out = analyze(
      Jop("match", Jvar("r"),
        Jobj(["length", Jobj(["$bind", Jstr("y")])]),
        Jop("length", Jvar("y"))),
      [bind("r", rec)],
    );
    expect(isFenced(out)).toBe(true);
  });

  it("an opaque atom is NEVER ground, including a malformed empty-ordinal one", () => {
    // `vobOpaqueOf` normalizes an empty set away, but the ADT is public and
    // `vobAnalyze` accepts caller-supplied provenance, so the malformed value is
    // constructible from OUTSIDE. It must not read as ground.
    expect(call("vobIsGround", [opaque()])).toBe(false);
    expect(call("vobIsGround", [opaque(0)])).toBe(false);
    expect(call("vobShapeFixed", [opaque()])).toBe(false);
    // and it cannot admit an observation when handed straight in as a parameter
    const out = analyze(Jop("length", Jvar("x")), [bind("x", opaque())], [0]);
    expect(isFenced(out)).toBe(true);
  });

  it("an out-of-range `outputDerivesFrom` index taints conservatively, never nothing", () => {
    // The PROPAGATION rule, pinned at its own function. Index 7 does not exist
    // in the analysed argument list, and the conservative answer is the whole
    // argument taint rather than nothing.
    expect(call("vobTaintFromIndices", [[7], [opaque(1)], []])).toEqual([1]);
    expect(call("vobTaintFromIndices", [[0], [opaque(1)], []])).toEqual([1]);
    //
    // SLICE 3d note: end to end this shape no longer reaches the propagation
    // rule at all, because 3d-D3 validates a summary's indices against its own
    // declared arity first and ABSTAINS — a strictly more conservative answer,
    // pinned in the 3d target-validation suite. The propagation rule stays
    // because the two guard different things: the gate rejects a summary that
    // is malformed, this rule handles an index that is in range for the
    // summary but past the argument list the call site actually supplied.
    const out = analyze(
      Jop("call", Jstr("t"), Jvar("x")),
      [bind("x", opaque(1))], [1],
      [target({ summary: summary({ outputDerivesFrom: [7] }) })],
    );
    expect(out.$tag).toBe("ObsFenced");
    expect(details(out).join(" ")).toContain("output-derivation index outside its own declared arity");
  });

  it("the constructor dual reading JOINS colliding slots instead of first-hit", () => {
    // A named payload carrying `_0` collides with the positional reading's own
    // `_0`. First-hit lookup answered with the whole-record shell while the
    // runtime's named branch stores the payload directly — masking it.
    const built = analyze(
      Jop("construct", Jstr("R"), Jobj(["_0", Jvar("x")], ["k", Jnum(0)])),
      [bind("x", opaque(0))],
    );
    expect(built.$tag).toBe("ObsAdmitted");
    const slots = built.prov.slots.filter((sl: any) => sl.key === "_0");
    expect(slots.length).toBe(1);
    expect(call("vobIsGround", [slots[0].prov])).toBe(false);
  });

  it("the constructor's NAMED pass keeps its reasons (the positional pass is not equivalent)", () => {
    // For an op-shaped ONE-FIELD payload the runtime's named branch evaluates
    // the whole field value while the positional reading sees an `ann` form and
    // evaluates argument 0 only — so the observation lives on the named side.
    const out = analyze(
      Jop("construct", Jstr("R"), Jobj(["ann", Jarr(Jnum(0), Jop("length", Jvar("x")))])),
      [bind("x", opaque(0))],
    );
    expect(isFenced(out)).toBe(true);
    expect(channels(out)).toContain("length");
  });

  it("`construct True` is primitive only at ARITY ONE", () => {
    // P1(a.13) review round 10 (Codex): the arity test counts SUPPLIED
    // arguments now, because `args.length` counted a HOLE as one — a sparse
    // `{construct:["True", <hole>]}` fell out of this fast path and built
    // `{$tag:"True"}`, the opposite definite from the dense form under `==`.
    // The READING this sentinel tracks — primitive at arity one, tagged record
    // otherwise — is unchanged.
    expect(read(JSON_LOGIC_SRC)).toContain('if (name === "True" && args.length === 1) return true;');
    expect(analyze(Jop("construct", Jstr("True")), [], []).prov).toEqual(CLEAN);
    // with a payload the runtime builds an ordinary tagged record, not a boolean
    const withPayload = analyze(Jop("construct", Jstr("True"), Jvar("x")), [bind("x", opaque(0))]);
    expect(withPayload.prov.$tag).toBe("PvShell");
    expect(call("vobIsGround", [withPayload.prov])).toBe(false);
  });

  it("a non-literal `method` class node abstains rather than keying on the bare name", () => {
    expect(call("vobMethodKey", [[Jnum(1)], "eq"])).toBe("«unresolvable-method-key»");
    expect(call("vobMethodKey", [[], "eq"])).toBe("«unresolvable-method-key»");
    expect(call("vobMethodKey", [[Jstr("Eq")], "eq"])).toBe("Eq.eq");
  });

  it("a non-literal `$bind` still introduces a binder (the runtime binds `String(v)`)", () => {
    // SLICE 3e: the binder SPELLING is now decided by the shared coercion, so
    // the arm consumes an `FdcParamName` rather than a raw node. A payload with
    // no reproducible coercion still binds — under a synthetic spelling — AND
    // abstains, which is what keeps the arm from admitting.
    const out = call("vobBindArm", [call("fdcCoerceName", [Jnum(0)]), opaque(0), []]);
    expect(out.binds.length).toBe(1);
    expect(call("vobIsGround", [out.binds[0].prov])).toBe(false);
    expect(out.reasons.map((r: any) => r.$tag)).toContain("RsnCheckerAbstained");
    // ... while an ARRAY payload IS reproducible (`String(["a","b"])` is "a,b"),
    // so it binds the real spelling and no longer abstains.
    const exact = call("vobBindArm", [call("fdcCoerceName", [Jarr(Jstr("a"), Jstr("b"))]), opaque(0), []]);
    expect(exact.binds[0].name).toBe("a,b");
    expect(exact.reasons.length).toBe(0);
  });

  it("path-name arguments match the runtime's ONE-LEVEL flatten and its String() coercion", () => {
    // `missing` flattens ONE level and then `String()`s whatever survives, so a
    // deeper nesting leaves an array that coerces to a joined key, and a number
    // coerces to its decimal spelling — a real binding the old arm ignored.
    // P1(a.13): the flatten SEMANTICS are unchanged — one level, holes
    // skipped — but review round 9 (Grok) showed `args.flat()` was itself an
    // absorber: an AST-carried Array subclass whose `flat` catches swallowed a
    // throwing element getter before either door saw it, and the predicate
    // decided where the plain array abstained. It is now a two-level index
    // walk that calls no method the AST supplies.
    const jlSrc = read(JSON_LOGIC_SRC);
    expect(jlSrc).not.toContain("args.flat()");
    expect(jlSrc).toContain("const flattened: string[] = [];");
    expect(jlSrc).toContain("for (let j = 0; j < inner; j++) if (j in v) flattened.push(v[j] as string);");
    // one level: resolved
    expect(isFenced(analyze(Jop("missing", Jarr(Jstr("x"))), [bind("x", opaque(0))]))).toBe(true);
    // two levels: the surviving array coerces to a key we cannot model ⇒ abstain
    const deeper = analyze(Jop("missing", Jarr(Jarr(Jstr("x")))), [bind("x", CLEAN)]);
    expect(isFenced(deeper)).toBe(true);
    expect(reasonTags(deeper)).toContain("RsnCheckerAbstained");
    // a NUMBER is a real key at runtime, not something to skip
    const numeric = analyze(Jop("missing", Jarr(Jnum(0))), [bind("x", CLEAN)]);
    expect(isFenced(numeric)).toBe(true);
    expect(reasonTags(numeric)).toContain("RsnCheckerAbstained");
  });

  it("an inline `let` is recognized by PRESENCE, and on a tagged carrier too", () => {
    // Absent and present-but-empty are different: the runtime detects the key by
    // presence and leaves the previous statement's result in place for zero
    // entries, so conflating them replaced a live provenance with clean.
    expect(read(JSON_LOGIC_SRC)).toContain('"let" in expr');
    const absent = call("fdcInlineLet", [Jnum(1)]);
    expect(absent.present).toBe(false);
    const empty = call("fdcInlineLet", [Jobj(["let", Jobj()])]);
    expect(empty.present).toBe(true);
    expect(empty.entries.length).toBe(0);
    // an EMPTY inline let must not wipe the running provenance
    const out = analyze(
      Jop("do", Jvar("x"), Jobj(["let", Jobj()])),
      [bind("x", opaque(0))],
    );
    expect(out.$tag).toBe("ObsAdmitted");
    expect(out.prov).toEqual(opaque(0));
    // a `$tag`-bearing carrier is still an object to the runtime's `in` test
    expect(call("fdcInlineLet", [Jtagged("X", ["let", Jobj(["a", Jnum(1)])])]).present).toBe(true);
    // ... and the item's OWN `$tag` is NOT a binding: the runtime reads only
    // `expr.let`'s entries, so a tagged do-item is fully recoverable. It is the
    // BINDINGS RECORD being tagged that loses the discriminator's position.
    expect(call("fdcInlineLet", [Jtagged("X", ["let", Jobj(["a", Jnum(1)])])]).entries.map((e: any) => e.name)).toEqual(["a"]);
    expect(call("fdcInlineLet", [Jobj(["let", Jtagged("X", ["a", Jnum(1)])])]).total).toBe(false);
  });

  it("a `$guard` on a TAGGED pattern is still split and walked", () => {
    // `matchOp` reads `$guard` off any object before dispatching the pattern.
    const guarded = Jtagged("Just", ["$guard", Jarr(Jobj(["$bind", Jstr("y")]), Jvar("y"))]);
    const parts = call("fdcGuardSplit", [guarded]);
    expect(parts.guarded).toBe(true);
    const out = analyze(
      Jop("match", Jvar("x"), guarded, Jnum(1)),
      [bind("x", opaque(0))],
    );
    expect(isFenced(out)).toBe(true);
    expect(channels(out)).toContain("arm-guard");
  });

  it("an originated shell must COVER the scope's ordinals or degrade to opaque", () => {
    // A witnessed shape whose slots declare FEWER rigids than the scope has is
    // a forgery (or a bug) — a ground shell around a κ-bearing value. It must
    // not be taken at its word.
    //
    // SLICE 3d rewrote this onto the CLOSED descriptor ADT: 3b spelled the
    // descriptor as an open record, so `vobOriginateParam` took whatever a
    // caller passed. The rule is unchanged; the input is now typed.
    expect(call("vobReprToProv", [rprShell("Maybe", []), [0]])).toEqual(opaque(0));
    // an honest descriptor still originates its shell
    const shellProv = call("vobReprToProv", [
      rprShell("Maybe", [rprSlot("_0", rprOpaque(0))]),
      [0],
    ]);
    expect(shellProv.$tag).toBe("PvShell");
    expect(call("vobIsGround", [shellProv])).toBe(false);
    // and the retired open-record entry is gone rather than shadowed
    expect(read(OBSERVE_SRC)).not.toContain("vobOriginateParam ");
  });

  it("the CANONICAL lambda body is argument 1, not the last item", () => {
    // `fnOp` takes args[1] when args[0] is a parameter LIST and ignores trailing
    // items; taking the last item skipped an observing body.
    //
    // type-substrate P1(a.13) review round 3 added an ARITY guard to that same
    // condition, because the canonical form always carries TWO elements while
    // the parser lowers a NULLARY lambda through the FLAT form — so a
    // single-element `{fn:[X]}` is flat and `X` is the BODY. Without the guard
    // `\ -> []` applied to `undefined` and `\ -> [1,2]` applied to a PARTIAL
    // whose params were `[1, 2]`. This sentinel tracks the condition, so it
    // tracks the guard too.
    //
    // Round 8 (Codex): the guard now counts PRESENT operands rather than
    // `length`, because `length` counts holes — a sparse `{fn:<two holes>}`
    // satisfied `args.length >= 2` while carrying neither operand.
    expect(read(JSON_LOGIC_SRC)).toContain("} else if (hasOperands(args, 2) && Array.isArray(args[0])) {");
    const canonical = Jop("fn", Jarr(Jstr("y")), Jop("length", Jvar("y")), Jnum(0));
    expect(isFenced(analyze(canonical, [], [0]))).toBe(true);
    // the flat form still puts the body last
    const flat = Jop("fn", Jstr("y"), Jop("length", Jvar("y")));
    expect(isFenced(analyze(flat, [], [0]))).toBe(true);
  });
});

describe("slice 3b — finding 2 (CRITICAL): a type head is not a representation proof", () => {
  it("origination consumes a CLOSED descriptor ADT, not a type constructor", () => {
    // `$tagged` is an erased phantom wrapper and `$refined` is transparent, so
    // `Tagged κ P` has κ's RUNTIME representation — not a `Tagged` shell. A
    // shell originated from the type head would admit a `$tag` discrimination
    // that distinguishes `a = Maybe Number` from `a = Number`.
    //
    // SLICE 3d rewrote this: the descriptor was an OPEN record
    // (`{transparent, witnessedShape, slots}`), so "the descriptor" was
    // whatever a caller passed. It is now the closed `ObsRepr` ADT.
    expect(call("vobReprToProv", [rprGround, [0]])).toEqual(CLEAN);
    expect(call("vobReprToProv", [rprOpaque(0), [0]])).toEqual(opaque(0));

    const witnessed = rprShell("Maybe", [rprSlot("_0", rprOpaque(0))]);
    const originated = call("vobReprToProv", [witnessed, [0]]);
    expect(originated.$tag).toBe("PvShell");
    expect(originated.shape).toBe("Maybe");
    // the completeness invariant holds: the shell's taint is visible deeply
    expect(call("vobIsGround", [originated])).toBe(false);
  });

  it("the module records WHY a name is not a proof, so 3c cannot re-derive the unsound rule", () => {
    const src = read(OBSERVE_SRC);
    expect(src).toContain("A TYPE CONSTRUCTOR'S NAME IS NOT A REPRESENTATION");
    expect(src).toContain("ERASED phantom wrapper");
    expect(src).toContain("THE COMPLETENESS INVARIANT");
  });
});

describe("slice 3b — closures, capture and lambda parameters (finding 5)", () => {
  it("a lambda PARAMETER binds opaquely, so observing it fences at the abstraction", () => {
    // `fn x -> typeOf x` must not be analysable with `x` clean just because the
    // abstraction site does not know what will be supplied.
    const lam = Jop("fn", Jstr("y"), Jop("length", Jvar("y")));
    const out = analyze(lam, [], [0]);
    expect(isFenced(out)).toBe(true);
    expect(channels(out)).toContain("length");
  });

  it("with nothing quantified a lambda parameter is clean, not conservatively opaque", () => {
    const lam = Jop("fn", Jstr("y"), Jop("length", Jvar("y")));
    expect(analyze(lam, [], []).$tag).toBe("ObsAdmitted");
  });

  it("a closure CAPTURES the whole scope, so a taint-capturing closure is not ground", () => {
    const src = read(JSON_LOGIC_SRC);
    expect(src).toContain("closure: copyOwnDataContext(data)");
    const lam = Jop("fn", Jstr("y"), Jnum(1));
    const out = analyze(lam, [bind("x", opaque(0))], [0]);
    expect(out.$tag).toBe("ObsAdmitted");
    expect(out.prov.$tag).toBe("PvShell");
    expect(out.prov.shape).toBe("«closure»");
    // ... and handing it to a host implementation therefore fences
    expect(call("vobIsGround", [out.prov])).toBe(false);
  });

  it("a clean closure IS ground, so it may cross a host boundary", () => {
    const lam = Jop("fn", Jstr("y"), Jnum(1));
    const out = analyze(lam, [bind("x", CLEAN)], [0]);
    expect(call("vobIsGround", [out.prov])).toBe(true);
  });
});

describe("slice 3b — the structural forms", () => {
  it("a conditional's CONDITION is a deep test (truthy inspects primitive values)", () => {
    const src = read(JSON_LOGIC_SRC);
    // the mechanism, verified before the test freezes it
    expect(src).toContain('val === "" || val === "0"');
    expect(src).toContain("if (Array.isArray(val) && val.length === 0) return false;");
    const out = analyze(Jop("if", Jvar("x"), Jnum(1), Jnum(2)), [bind("x", opaque(0))]);
    expect(isFenced(out)).toBe(true);
    expect(channels(out)).toContain("branch-condition");
  });

  it("`and` / `or` test EVERY operand and return the operand VALUE", () => {
    const out = analyze(Jop("and", Jbool(true), Jvar("x")), [bind("x", opaque(0))]);
    expect(isFenced(out)).toBe(true);
    expect(channels(out)).toContain("and-operand");
  });

  it("`let` binds sequentially and its value is the LAST binding", () => {
    const body = Jobj(["let", Jobj(["a", Jvar("x")], ["b", Jvar("a")])]);
    const out = analyze(body, [bind("x", opaque(0))]);
    expect(out.$tag).toBe("ObsAdmitted");
    expect(out.prov).toEqual(opaque(0));
  });

  it("a `do` sequence's inline `let` item binds into the ENCLOSING scope", () => {
    const src = read(JSON_LOGIC_SRC);
    expect(src).toContain('"let" in expr');
    const body = Jop("do", Jobj(["let", Jobj(["a", Jvar("x")])]), Jvar("a"));
    const out = analyze(body, [bind("x", opaque(0))]);
    expect(out.$tag).toBe("ObsAdmitted");
    expect(out.prov).toEqual(opaque(0));
  });

  it("`where` binds first, then the body sees every binder", () => {
    const body = Jop("where", Jvar("a"), Jobj(["a", Jvar("x")]));
    const out = analyze(body, [bind("x", opaque(0))]);
    expect(out.$tag).toBe("ObsAdmitted");
    expect(out.prov).toEqual(opaque(0));
  });

  it("`ann` evaluates only argument 0 — the annotation is never evaluated", () => {
    const out = analyze(Jop("ann", Jvar("x"), Jop("length", Jvar("x"))), [bind("x", opaque(0))]);
    expect(out.$tag).toBe("ObsAdmitted");
  });

  it("a record literal is a shell keyed by field name; a `$tag` value is literal", () => {
    const rec = Jobj(["a", Jvar("x")], ["b", Jnum(1)]);
    const out = analyze(rec, [bind("x", opaque(0))]);
    expect(out.prov.$tag).toBe("PvShell");
    expect(out.prov.shape).toBe("«record»");
    const byKey = Object.fromEntries(out.prov.slots.map((s: any) => [s.key, s.prov.$tag]));
    expect(byKey).toEqual({ a: "PvOpaque", b: "PvClean" });

    // a `$tag`-bearing node is SELF-EVALUATING (returned untouched), so it is
    // wholly literal — its `{var}`-shaped fields are never evaluated
    const tagged = analyze(Jtagged("Just", ["_0", Jvar("x")]), [bind("x", opaque(0))]);
    expect(tagged.prov).toEqual(CLEAN);
  });

  it("finding 10: `construct True` is a primitive boolean, not a nullary shell", () => {
    const src = read(JSON_LOGIC_SRC);
    // P1(a.13) review round 10 (Codex): the arity test counts SUPPLIED
    // arguments now, because `args.length` counted a HOLE as one — a sparse
    // `{construct:["True", <hole>]}` fell out of this fast path and built
    // `{$tag:"True"}`, the opposite definite from the dense form under `==`.
    // The READING this sentinel tracks — primitive at arity one, tagged record
    // otherwise — is unchanged.
    expect(src).toContain('if (name === "True" && args.length === 1) return true;');
    expect(analyze(Jop("construct", Jstr("True")), [], []).prov).toEqual(CLEAN);
    expect(analyze(Jop("construct", Jstr("False")), [], []).prov).toEqual(CLEAN);
    // an ordinary nullary constructor IS a shell (it has a `$tag`)
    expect(analyze(Jop("construct", Jstr("Nothing")), [], []).prov.$tag).toBe("PvShell");
  });

  it("`construct` carries BOTH payload readings, because the table is unavailable", () => {
    // NOTE: a SINGLE-key object payload is genuinely ambiguous between a record
    // literal and a key-as-fnId call — the runtime decides by RESOLUTION
    // (json-logic.ts:1248) — so it correctly fences. A two-key record is
    // unambiguous, which is what this test is about.
    const built = analyze(
      Jop("construct", Jstr("R"), Jobj(["f", Jvar("x")], ["g", Jnum(1)])),
      [bind("x", opaque(0))],
    );
    expect(built.$tag).toBe("ObsAdmitted");
    expect(built.prov.$tag).toBe("PvShell");
    expect(built.prov.slots.map((sl: any) => sl.key).sort()).toEqual(["_0", "f", "g"]);
    const byKey = Object.fromEntries(built.prov.slots.map((sl: any) => [sl.key, sl.prov.$tag]));
    expect(byKey._0).toBe("PvShell");   // the whole record, under the positional reading
    expect(byKey.f).toBe("PvOpaque");
    expect(byKey.g).toBe("PvClean");
    // a single-key payload fences instead — the ambiguity is real, not a gap
    expect(isFenced(analyze(
      Jop("construct", Jstr("R"), Jobj(["f", Jvar("x")])),
      [bind("x", opaque(0))],
    ))).toBe(true);
  });

  it("finding 8: `type_def` mutates the constructor environment and abstains", () => {
    const src = read(JSON_LOGIC_SRC);
    // Round 8 (Codex): the effect moved into `applyTypeDef` — split out of the
    // operator arm so `do` can run a declaration in statement position without
    // firing the arm's own no-value trip — and the field walk became an INDEX
    // walk, because `.map` ran the `f.name` read inside a method the AST
    // supplies and a catching subclass absorbed the resulting `TypeError`.
    expect(src).toContain("function applyTypeDef(rawDef: unknown, ctx: EvaluateContext): void {");
    expect(src).toContain("if (j in fields) names[j] = (fields[j] as { name: string }).name;");
    expect(call("vobClassifyForm", ["type_def"]).$tag).toBe("VfcFence");
    const out = analyze(Jop("type_def", Jnum(1)), [], []);
    expect(isFenced(out)).toBe(true);
  });

  it("a DOTTED variable read off a κ binder fences; off a clean binder it does not", () => {
    const src = read(JSON_LOGIC_SRC);
    expect(src).toContain('const parts = path.split(".");');
    const tainted = analyze(Jvar("b.f"), [bind("b", opaque(0))]);
    expect(isFenced(tainted)).toBe(true);
    expect(channels(tainted)).toContain("var-projection");
    expect(analyze(Jvar("b.f"), [bind("b", CLEAN)]).$tag).toBe("ObsAdmitted");
  });

  it("the dot scan terminates on an exhausted slice, not a code-point length", () => {
    // `length` counts code POINTS while `slice` indexes UTF-16 code UNITS, so a
    // length bound misses a dot past an astral character — which would silently
    // turn a data-dependent projection back into a plain binder read.
    expect(call("vobIsDotted", ["\u{1D400}\u{1D401}.f"])).toBe(true);
    expect(call("vobIsDotted", ["plain"])).toBe(false);
  });
});

describe("slice 3b — the frozen execution-profile scope (3b-D5)", () => {
  it("finding 9 of the runtime audit: `eq` / `lt` lower differently in compiled JS", () => {
    const emit = read("fenel/modules/engine/emit-js.fenel");
    expect(emit).toContain('if eq fnId "eq" then CMBinOp { op = "===" }');
    expect(emit).toContain('if eq fnId "lt" then CMBinOp { op = "<" }');
  });

  it("a verdict must COVER every profile the registration can run under", () => {
    const out = analyze(Jnum(1), [], [], [], ["interpreted"], ["interpreted", "compiled-js"]);
    expect(isFenced(out)).toBe(true);
    expect(reasonTags(out)).toContain("RsnCheckerAbstained");
    // covering both admits
    expect(analyze(Jnum(1), [], [], [], ["interpreted", "compiled-js"], ["interpreted", "compiled-js"]).$tag)
      .toBe("ObsAdmitted");
  });

  it("a frozen target from an UNCOVERED profile abstains", () => {
    const out = analyze(
      Jop("call", Jstr("t"), Jnum(1)),
      [], [0],
      [target({ profile: "compiled-js", summary: summary({ profile: "compiled-js" }) })],
      ["interpreted"], ["interpreted"],
    );
    expect(isFenced(out)).toBe(true);
    expect(reasonTags(out)).toContain("RsnCheckerAbstained");
  });

  it("an admitted verdict names the profiles it is ABOUT", () => {
    const out = analyze(Jnum(1), [], [], [], ["interpreted"], ["interpreted"]);
    expect(out.profiles).toEqual(["interpreted"]);
  });
});

describe("slice 3b — every reason, not just the first", () => {
  it("a body with several independent observations reports ALL of them", () => {
    // Rule ablation is impossible from a first-reason-only report.
    const body = Jop(
      "do",
      Jop("length", Jvar("x")),
      Jop("missing", Jarr(Jstr("x"))),
      Jop("if", Jvar("x"), Jnum(1), Jnum(2)),
    );
    const out = analyze(body, [bind("x", opaque(0))]);
    expect(isFenced(out)).toBe(true);
    const cs = channels(out);
    expect(cs).toContain("length");
    expect(cs).toContain("missing");
    expect(cs).toContain("branch-condition");
    expect(out.reasons.length).toBeGreaterThanOrEqual(3);
  });

  it("every reason is an EXISTING ValidationReason constructor — the slice adds none", () => {
    const parent = read("fenel/modules/engine/validation.fenel");
    const declared = new Set(
      [...parent.matchAll(/^\s*\|?\s*(Rsn[A-Za-z]+)/gm)].map((m) => m[1]!),
    );
    expect(declared.size).toBeGreaterThan(15);
    const src = read(OBSERVE_SRC);
    // the module must not DECLARE a reason ADT of its own
    expect(/^ValidationReason\s*=/m.test(src)).toBe(false);
    for (const m of src.matchAll(/\b(Rsn[A-Za-z]+)\s*\{/g)) {
      expect(declared.has(m[1]!), `${m[1]} is not a parent ValidationReason case`).toBe(true);
    }
  });

  it("every path segment is an EXISTING UsePathSeg constructor", () => {
    const parent = read("fenel/modules/engine/validation.fenel");
    const block = parent.slice(parent.indexOf("UsePathSeg ="), parent.indexOf("-- The syntactic ROLE"));
    const declared = new Set([...block.matchAll(/\b(Vps[A-Za-z]+)/g)].map((m) => m[1]!));
    const src = read(OBSERVE_SRC);
    for (const m of src.matchAll(/\b(Vps[A-Za-z]+)/g)) {
      expect(declared.has(m[1]!), `${m[1]} is not a parent UsePathSeg case`).toBe(true);
    }
  });
});

describe("slice 3b — INERTNESS (nothing is judgment-reachable)", () => {
  const fenelFiles = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith(".fenel")) out.push(full);
      }
    };
    walk(join(REPO, "fenel"));
    return out;
  };

  it("NO Fenel source outside the module references a `vob*` function", () => {
    const offenders: string[] = [];
    for (const file of fenelFiles()) {
      if (file.endsWith("validation-observe.fenel")) continue;
      const src = readFileSync(file, "utf8");
      for (const line of src.split("\n")) {
        const withoutComment = line.trimStart().startsWith("--") ? "" : line.split(" -- ")[0]!;
        // Strip STRING LITERALS as well as comments. The statement is "nothing
        // outside the module CALLS a `vob*` function"; a name inside quoted data
        // is not a call. Slice 3f's carrier contract records the 3g obligation to
        // convert `ObsCallTarget` off its spelling key, and naming the function
        // it must convert is the whole point of that clause.
        const code = withoutComment.replace(/"[^"]*"/g, '""');
        if (/\bvob[A-Z]/.test(code)) offenders.push(`${file}: ${line.trim().slice(0, 90)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("NO production TypeScript consumes the module's vocabulary", () => {
    // The test file itself and the census script are the only readers.
    const dir = join(REPO, "implementations", "typescript", "engine", "src");
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const entry of readdirSync(d)) {
        const full = join(d, entry);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        // `src/generated/` holds machine-emitted artifacts (the parse cache
        // embeds every module's parsed body verbatim); embedding is not
        // consumption, and no artifact reads these names.
        if (full.includes("generated")) continue;
        if (!entry.endsWith(".ts") || entry.endsWith(".test.ts")) continue;
        const src = readFileSync(full, "utf8");
        if (/engine:vob[A-Z]|\bObsProv\b|\bObsCallTarget\b|\bPvOpaque\b/.test(src)) {
          offenders.push(full);
        }
      }
    };
    walk(dir);
    expect(offenders).toEqual([]);
  });

  it("every declaration in the module carries the scannable `vob` prefix", () => {
    const src = read(OBSERVE_SRC);
    const names = [...src.matchAll(/^([a-z][A-Za-z0-9]*) :/gm)].map((m) => m[1]!);
    expect(names.length).toBeGreaterThan(50);
    for (const n of names) {
      expect(/^vob[A-Z]/.test(n), `${n} lacks the vob prefix`).toBe(true);
    }
  });

  it("the module declares NOTHING over the raw Tt face (the 3a prohibition holds)", () => {
    const src = read(OBSERVE_SRC);
    for (const forbidden of ["TraversalType", "TtVar", "TtRefined", "isBottomMu", "subsetW"]) {
      const codeOnly = src
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("--") && !l.trimStart().startsWith("@"))
        .join("\n");
      expect(codeOnly.includes(forbidden), `reaches ${forbidden}`).toBe(false);
    }
  });

  it("the module mints no rigid and consults no decider", () => {
    const src = read(OBSERVE_SRC);
    const codeOnly = src
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--") && !l.trimStart().startsWith("@"))
      .join("\n");
    for (const forbidden of ["SeRigid", "vrgMint", "decideSubset", "isSubset", "inhabit", "witnessOf"]) {
      expect(codeOnly.includes(forbidden), `reaches ${forbidden}`).toBe(false);
    }
  });

  it("`SignatureTrust` is untouched by this slice", () => {
    const src = read(OBSERVE_SRC);
    for (const forbidden of ["SignatureTrust", "InferredDerivation", "TrustedPrimitive", "VdValidated"]) {
      expect(src.includes(forbidden), `reaches ${forbidden}`).toBe(false);
    }
  });
});

describe("slice 3b — the E4/E5 unreachability claim has an AUTHORITY", () => {
  it("a host function marshals to JlNull, so no closure case can reach the walker", () => {
    // The design review is right that "unreachable" needs authoritative
    // provenance rather than assertion. The authority is the marshaller: a
    // non-plain JS value becomes a JlNull sentinel, and the carrier ADT has no
    // closure or byte-view case at all.
    const marshal = read("implementations/typescript/engine/src/engine-bodies-dispatch.ts");
    expect(marshal).toContain("// Unknown JS shape (function, symbol, etc.) — wrap as a JlNull");
    const adt = read("fenel/modules/engine/json-logic-to-syntax.fenel");
    const block = adt.slice(adt.indexOf("JsonLogic a ="), adt.indexOf("-- JlField"));
    expect(block).not.toContain("JlClosure");
    expect(block).not.toContain("JlBytes");
    expect(call("vobClassifyForm", ["«closure»"]).$tag).toBe("VfcUnreachable");
    expect(call("vobClassifyForm", ["«bytes»"]).$tag).toBe("VfcUnreachable");
  });

  it("the found-bit side condition is recorded, and records the DISCHARGED story", () => {
    // REWRITTEN by signature-substrate slice 3c-D1. This test used to require
    // the string "NO-HOST-UNDEFINED SIDE CONDITION" — i.e. it pinned the
    // rationale that 3b's ROUND 2 disproved: that no inhabitant of any Fenel
    // type is host-`undefined`, so `{var:x}` cannot be a found-bit observation.
    // A registered counterexample (`std:minimum : List a -> a` returning
    // host-`undefined`) refuted exactly that, which is why the row went MISSING.
    // Leaving the assertion in place would have made the refuted model
    // permanent — the failure mode this suite's own method note warns about.
    //
    // 3c does not re-establish that condition. It repairs the CONFLATION:
    // `resolveVar` threads an explicit found bit, so only ABSENCE reaches the
    // registry projection / fallback and a present binding is returned verbatim.
    // What is pinned now is that story, and the discharge.
    const src = read(OBSERVE_SRC);
    expect(src).toContain("THE FOUND-BIT SIDE CONDITION");
    expect(src).not.toContain("NO-HOST-UNDEFINED SIDE CONDITION");
    const evaluator = read("implementations/typescript/engine/src/json-logic.ts");
    expect(evaluator).toContain("let found = true;");
    expect(evaluator).toContain("if (!found) {");
  });

  it.skipIf(!HAS_TCB_LEDGER)("the found-bit side condition's ledger row records the DISCHARGED story", () => {
    const ledger = read(TCB_LEDGER);
    expect(ledger).toContain("obs.var.undefined");
    // REPINNED (slice 3g). This used to assert the ledger's GLOBAL summary line
    // `| MISSING | 0 |`, which stopped matching when decide-substrate 4T W2
    // reopened the class with `mem.pattern.tri` and rewrote the line. That was
    // a false failure: the row this test is about was discharged and stayed
    // discharged; the count it happened to be pinned through belongs to another
    // workstream's accounting. So pin the CLAIM — `obs.var.undefined` is
    // SIDE-CONDITIONED, not MISSING — which is what the test has always meant
    // and is now robust to unrelated rows entering or leaving the class.
    const row = ledger.split("\n").find((line) => line.startsWith("| obs.var.undefined |"));
    expect(row).toBeDefined();
    expect(row).toContain("| SIDE-CONDITIONED |");
    expect(ledger).toContain("MISSING -> SIDE-CONDITIONED, discharged by signature-substrate slice 3c-D1");
  });
});

// ===========================================================================
// SLICE 3d — the typed observation provenance boundary.
//
// Every expected verdict below was READ OFF THE LIVE ANALYSIS before it was
// written down, and every runtime premise verified against source first. The
// slice exists because 3b took its parameter provenance as an argument, so
// `obs.shell.complete` was a contract on the caller rather than an invariant.
// ===========================================================================

describe("slice 3d-D1 — origination happens INSIDE the judgment", () => {
  it("the public entry takes DECLARED TYPES and derives the provenance itself", () => {
    // A bare quantified variable originates opaque at that variable's ordinal,
    // so observing it fences — with nothing but a declared type supplied.
    const out = analyzeRequest({
      params: [param("x", { $var: "a" })],
      body: Jop("length", Jvar("x")),
    });
    expect(isFenced(out)).toBe(true);
    expect(channels(out)).toContain("length");
  });

  it("a declared type mentioning no quantifier originates CLEAN", () => {
    const out = analyzeRequest({
      params: [param("x", { $ref: "Int" })],
      body: Jop("length", Jvar("x")),
    });
    expect(out.$tag).toBe("ObsAdmitted");
  });

  it("a quantifier NESTED below the head is found, not only a bare one", () => {
    // `List a` is registered fully expanded, so the `$var` sits several levels
    // down inside the `$opaque`/`$variant` body. 3b's census treated exactly
    // this shape as CLEAN, which is the under-count this slice closes.
    const listOfA = {
      $opaque: {
        name: "List",
        pure: {
          $variant: {
            cases: [{ name: "Cons", fields: [{ name: "head", type: { $var: "a" } }] }],
          },
        },
      },
    };
    expect(call("vobDeriveRepr", [declared(listOfA), ONE_QUANTIFIER, [0]]))
      .toEqual(rprOpaque(0));
    expect(call("vobDeriveRepr", [declared({ $ref: "Int" }), ONE_QUANTIFIER, [0]]))
      .toEqual(rprGround);
  });

  it("CRITICAL: a $el node degrades to the WHOLE scope — `f Number` is not ground", () => {
    // The compatibility encoding spells a higher-kinded application `f a` as
    // `{$el: {call: ["f", {$var: "a"}]}}`: the head `f` is a bare STRING and
    // its quantified identity lives in the authoritative
    // `TypeScheme.applications` sidecar as `headVarId`. Verified against source
    // before this test froze it — and there are LIVE registrations of the
    // shape (`algebra:liftZip2`'s `x : f a`, `algebra:vecIndex`'s `v : Vec n a`).
    const types = read("implementations/typescript/engine/src/types.ts");
    expect(types).toContain("readonly path: readonly string[]");
    expect(types).toContain("head identity and kind");

    const two = [quantifier("q0", "a"), quantifier("q1", "f")];
    // `f a` — a $var scan would find `a` but MISS `f`'s ordinal entirely.
    expect(call("vobDeriveRepr", [declared({ $el: { call: ["f", { $var: "a" }] } }), two, [0, 1]]))
      .toEqual(rprOpaque(0, 1));
    // `f Number` — a $var scan finds NOTHING and would answer GROUND, which is
    // a false admission: instantiating `f` as `List` versus `Maybe` changes the
    // runtime shape.
    expect(call("vobDeriveRepr", [declared({ $el: { call: ["f", { $ref: "Number" }] } }), two, [0, 1]]))
      .toEqual(rprOpaque(0, 1));
  });

  it("a $var naming NO quantifier degrades rather than reading as ground", () => {
    expect(call("vobDeriveRepr", [declared({ $var: "zz" }), ONE_QUANTIFIER, [0]]))
      .toEqual(rprOpaque(0));
  });

  it("the id and sourceName namespaces are SEPARATE — `q0` as a source name", () => {
    // `collide : a -> q0 -> a` is legal source. The census helper this replaces
    // matched a $var against a quantifier's id OR its sourceName, so
    // `{$var: "q0"}` resolved to the FIRST quantifier by generated id when it
    // denotes the SECOND by source name.
    const qs = [quantifier("q0", "a"), quantifier("q1", "q0")];
    expect(call("vobDeriveRepr", [declared({ $var: "q0" }), qs, [0, 1]])).toEqual(rprOpaque(1));
    expect(call("vobDeriveRepr", [declared({ $var: "a" }), qs, [0, 1]])).toEqual(rprOpaque(0));
  });

  it("the ordinal set is DERIVED from the quantifier vector, not supplied", () => {
    expect(call("vobScopeOrdinals", [[], 0, []])).toEqual([]);
    expect(call("vobScopeOrdinals", [[quantifier("q0", "a"), quantifier("q1", "b")], 0, []]))
      .toEqual([0, 1]);
    // and with NO quantifiers nothing can be κ-typed, so the same body admits
    expect(analyzeRequest({
      quantified: [],
      params: [param("x", { $var: "a" })],
      body: Jop("length", Jvar("x")),
    }).$tag).toBe("ObsAdmitted");
  });

  it("a caller-supplied SHELL cannot reach the public entry at all", () => {
    // The 3b hole: `vobAnalyze` took `[ObsBind]`, so a shell whose slots omit
    // the tainted payload read as GROUND (`vobIsGround` recurses only through
    // MODELLED slots) and admitted every deep observation of it.
    const forged = shell("Maybe", [slot("_0", CLEAN)]);
    expect(call("vobIsGround", [forged])).toBe(true);
    // Through the INTERNAL entry it still does — which is exactly why that
    // entry carries no authority.
    expect(analyze(Jop("deepEq", Jvar("m"), Jnum(1)), [bind("m", forged)]).$tag)
      .toBe("ObsAdmitted");
    // The public entry has no parameter through which to say it: the request's
    // parameters carry DECLARED TYPES, and no declared type originates a shell.
    const req = request({ params: [param("m", { $var: "a" })] });
    expect(Object.keys(req)).not.toContain("prov");
    expect(req.params.every((p: any) => p.$tag === "ObsParam" && "declared" in p)).toBe(true);
    expect(analyzeRequest({
      params: [param("m", { $var: "a" })],
      body: Jop("deepEq", Jvar("m"), Jnum(1)),
    }).$tag).toBe("ObsFenced");
  });

  it("derivation NEVER witnesses a shell, for any declared type", () => {
    // The honest statement of what changed: the fence gave up the precision a
    // shell buys in exchange for not having to trust a type head.
    const shapes = [
      { $var: "a" },
      { $ref: "Int" },
      { $tagged: { value: { $ref: "Id" }, phantom: { $var: "a" } } },
      { $refined: { base: { $var: "a" }, set: { $tag: "SeAll" } } },
      { $record: { fields: [{ name: "k", type: { $var: "a" } }] } },
      { $el: { call: ["f", { $var: "a" }] } },
    ];
    for (const s of shapes) {
      const repr = call("vobDeriveRepr", [declared(s), ONE_QUANTIFIER, [0]]);
      expect(["RprGround", "RprOpaque"]).toContain(repr.$tag);
    }
  });

  it("the raw-key harvest is the registered one, and the census's copy is gone", () => {
    const body = Jobj(
      ["call", Jarr(Jstr("std:add"), Jnum(1))],
      ["length", Jarr(Jvar("x"))],
    );
    const keys: string[] = call("vobHarvestRawKeys", [body, []]);
    expect(keys).toContain("call");
    expect(keys).toContain("length");
    expect(keys).toContain("var");
    // the `{call: [head, …]}` head is a literal string INSIDE the argument list
    expect(keys).toContain("std:add");

    const census = read("implementations/typescript/engine/scripts/signature-phase-4-census.ts");
    expect(census).not.toContain("function harvestRawKeys");
    expect(census).not.toContain("function bareQuantifiedOrdinalOf");
    expect(census).not.toContain("function mentionsQuantified");
    expect(census).not.toContain("function activeOrigin");
  });
});

describe("slice 3d-D1 — the frozen request's own well-formedness", () => {
  it("a duplicate parameter spelling abstains — one provenance would be hidden", () => {
    const out = analyzeRequest({
      params: [param("x", { $ref: "Int" }), param("x", { $var: "a" })],
    });
    expect(isFenced(out)).toBe(true);
    expect(details(out).join(" ")).toContain("not pairwise distinct");
  });

  it("a duplicate quantifier SOURCE spelling abstains", () => {
    const out = analyzeRequest({ quantified: [quantifier("q0", "a"), quantifier("q1", "a")] });
    expect(details(out).join(" ")).toContain("quantifier source spellings");
  });

  it("a duplicate generated quantifier ID abstains", () => {
    const out = analyzeRequest({ quantified: [quantifier("q0", "a"), quantifier("q0", "b")] });
    expect(details(out).join(" ")).toContain("generated identities");
  });

  it("every invalidation-identity field must be present", () => {
    for (const field of ["callerId", "bodyHash", "schemeHash", "validatorVersion", "registryProfile"]) {
      const out = analyzeRequest({ [field]: "" });
      expect(isFenced(out)).toBe(true);
    }
    // and an empty analysed-profile set covers nothing
    expect(isFenced(analyzeRequest({ analysedProfiles: [], requiredProfiles: [] }))).toBe(true);
  });

  it("the identity fields BIND the verdict; they are not recomputed here", () => {
    // Stated so the ledger row cannot be read as an authentication claim: a
    // request whose hashes describe a different body is still analysed.
    const out = analyzeRequest({ bodyHash: "not-the-body-at-all", body: Jnum(1) });
    expect(out.$tag).toBe("ObsAdmitted");
    const src = read(OBSERVE_SRC);
    expect(src).toContain("they BIND the verdict");
  });
});

describe("slice 3d-D2 — `transparent` implements its stated contract", () => {
  it("a transparent descriptor INHERITS its inner provenance, recursively", () => {
    // 3b's row said "inherit the inner provenance" and the code returned the
    // opaque atom, because no inner was supplied. Now there is one.
    expect(call("vobReprToProv", [rprTransparent(rprOpaque(0)), [0, 1]])).toEqual(opaque(0));
    // over a GROUND inner it is clean — `Refined Int (>0)` is not κ-typed
    expect(call("vobReprToProv", [rprTransparent(rprGround), [0]])).toEqual(CLEAN);
    // and it recurses at depth
    expect(call("vobReprToProv", [rprTransparent(rprTransparent(rprOpaque(1))), [0, 1]]))
      .toEqual(opaque(1));
    // a transparent wrapper over a SHELL inherits the shell, not an atom
    const inner = rprShell("Maybe", [rprSlot("_0", rprOpaque(0))]);
    const got = call("vobReprToProv", [rprTransparent(inner), [0]]);
    expect(got.$tag).toBe("PvShell");
    expect(got.shape).toBe("Maybe");
  });

  it("a shell with DUPLICATE slot keys degrades — lookup and rigids disagree", () => {
    // `vobSlotLookup` takes the FIRST match while `vobRigidsOf` unions ALL of
    // them, so a duplicate pair can pass the coverage floor on a tainted slot
    // while every projection reads a clean one in front of it.
    const dup = rprShell("Maybe", [rprSlot("_0", rprGround), rprSlot("_0", rprOpaque(0))]);
    expect(call("vobReprToProv", [dup, [0]])).toEqual(opaque(0));
    expect(call("vobSlotKeysDistinct", [[rprSlot("a", rprGround), rprSlot("b", rprGround)], []]))
      .toBe(true);
  });

  it("the coverage check is a FLOOR and the module says so, not a completeness proof", () => {
    // A shell with a clean REAL payload and a bogus extra slot still passes.
    // Recorded rather than fixed: only a trusted layout producer could prove
    // slot completeness, and none exists.
    const bogus = rprShell("Maybe", [rprSlot("_0", rprGround), rprSlot("junk", rprOpaque(0))]);
    const got = call("vobReprToProv", [bogus, [0]]);
    expect(got.$tag).toBe("PvShell");
    const src = read(OBSERVE_SRC);
    expect(src).toContain("NEITHER IS A COMPLETENESS PROOF");
  });
});

describe("slice 3d-D3 — the execution mode, on its two independent axes", () => {
  it("a compiled lowering is enumerated but NOT admissible", () => {
    const out = analyzeRequest({ lowering: "compiled-js" });
    expect(details(out).join(" ")).toContain("interpreted lowering only");
  });

  it("an UNRECOGNIZED lowering abstains rather than defaulting", () => {
    expect(details(analyzeRequest({ lowering: "zzz" })).join(" "))
      .toContain("unrecognized lowering");
  });

  it("CRITICAL: a scoped evaluator STRATEGY is not the direct entry", () => {
    // The 3b review's open item: `obs.gate.ambient` is a claim about
    // `invokeFunction`, but a strategy wrapper calls the ctx-natives map
    // directly after parking caller data in `_localData`. Verified against
    // source before this test froze it.
    const ev = read("implementations/typescript/engine/src/evaluator-class.ts");
    expect(ev).toContain("ctxNatives[methodValue]!(innerCtx, rule)");
    const scoped = ["ScopedLazy", "ScopedPartial", "ScopedJit", "ScopedCustom", "ExplicitEvaluateWith"];
    for (const evaluator of scoped) {
      expect(details(analyzeRequest({ evaluator })).join(" "))
        .toContain("DIRECT evaluator entry only");
    }
    // a scoped EAGER frame is not the direct entry either — its context still
    // carries the frame, so it is not context-identical to a direct call
    expect(isFenced(analyzeRequest({ evaluator: "ScopedEager" }))).toBe(true);
    expect(details(analyzeRequest({ evaluator: "Bogus" })).join(" "))
      .toContain("unrecognized evaluator entry");
  });

  it("the mode axes are SEPARATE from the registry profile", () => {
    // 3b carried one `profile` string for all three questions.
    const out = analyzeRequest({ registryProfile: "seed" });
    expect(out.$tag).toBe("ObsAdmitted");
  });
});

describe("slice 3d-D3 — the frozen call target is validated, not trusted", () => {
  const hostTarget = (over: Record<string, unknown> = {}) =>
    target({ origin: "HostNative", tier: "nativeImpls", key: "k", ...over });

  it("an UNRECOGNIZED tier abstains — 3b's predicate read it as 'not ctx'", () => {
    // `vobIsCtxTier` answers false for anything it does not know, so a
    // misspelled tier silently skipped the ambient fence.
    const out = analyze(Jop("t", Jnum(1)), [], [0], [hostTarget({ tier: "nativeImplsX" })]);
    expect(details(out).join(" ")).toContain("unrecognized native-map coordinate");
    // the ctx tier itself still fences ambiently
    expect(call("vobIsCtxTier", ["nativeImplsCtx"])).toBe(true);
    expect(call("vobIsCtxTier", ["both"])).toBe(true);
    expect(call("vobKnownTiers", [0])).toEqual(["", "nativeImplsCtx", "nativeImpls", "both"]);
  });

  it("origin and tier must be CONSISTENT in both directions", () => {
    const noTier = analyze(Jop("t", Jnum(1)), [], [0], [hostTarget({ tier: "", key: "" })]);
    expect(details(noTier).join(" ")).toContain("names no native-map coordinate");
    const bodyWithTier = analyze(Jop("t", Jnum(1)), [], [0], [
      target({ origin: "FenelBody", tier: "nativeImpls", key: "k" }),
    ]);
    expect(details(bodyWithTier).join(" "))
      .toContain("branch that is not reached through a native map");
  });

  it("an out-of-range result ordinal abstains rather than tainting silently", () => {
    const out = analyze(Jop("t", Jnum(1)), [], [0], [hostTarget({ resultRigids: [7] })]);
    expect(details(out).join(" ")).toContain("outside this check scope");
    // in range is fine
    const ok = analyze(Jop("t", Jnum(1)), [], [0], [hostTarget({ resultRigids: [0] })]);
    expect(details(ok).join(" ")).not.toContain("outside this check scope");
  });

  it("a summary index outside its OWN declared arity abstains", () => {
    const t = target({ arity: 1, summary: summary({ observesFrom: [5] }) });
    expect(details(analyze(Jop("t", Jnum(1)), [], [0], [t])).join(" "))
      .toContain("observed parameter index outside its own declared arity");
    const t2 = target({ arity: 1, summary: summary({ outputDerivesFrom: [9] }) });
    expect(details(analyze(Jop("t", Jnum(1)), [], [0], [t2])).join(" "))
      .toContain("output-derivation index outside its own declared arity");
  });

  it("validation rejects MALFORMATION, not misstatement — and says which", () => {
    const src = read(OBSERVE_SRC);
    expect(src).toContain("a whitelist rejects a");
    expect(src).toContain("typo, not a LIE");
    // the residual is named rather than implied: a record that calls a genuine
    // ctx-native `nativeImpls` is well-formed and wrong
    expect(src).toContain("well-formed and wrong");
  });
});

describe("slice 3d-D3 — `_localData` distinguishes an EMPTY scope from an absent one", () => {
  it("an explicitly empty `{}` no longer inherits stale ambient bindings", () => {
    const src = read("implementations/typescript/engine/src/evaluator-class.ts");
    expect(src).toContain("_localData: data !== undefined ? data : ctx?._localData,");
    expect(src).not.toContain("data && Object.keys(data).length > 0 ? data");
    // the repair is narrow ON PURPOSE: omission still inherits, which is the
    // wrapper's documented re-entry contract, and no defect motivates changing
    // it. Recorded so a later reader does not "finish" it.
    expect(src).toContain("Omission still inherits");
  });

  it("the four cases are distinguishable at the predicate", () => {
    const pick = (data: unknown, ambient: unknown) => (data !== undefined ? data : ambient);
    expect(pick({}, { stale: 1 })).toEqual({});                   // explicit empty WINS
    expect(pick(undefined, { stale: 1 })).toEqual({ stale: 1 });  // omitted inherits
    expect(pick({ x: 2 }, { stale: 1 })).toEqual({ x: 2 });
    expect(pick(Object.create(null), { stale: 1 })).toEqual({});
  });
});

describe("slice 3d-D4 — duplicate binders resolve to the RUNTIME's winner", () => {
  it("the runtime's winner is the LAST same-spelling binder in key order", () => {
    // `matchPattern` walks `Object.keys(pattern)` in order and writes each
    // binder with `defineDataContextBinding`, whose descriptor is configurable
    // and writable — so a later key OVERWRITES an earlier one. Verified
    // against source before this test froze it.
    const src = read(JSON_LOGIC_SRC);
    expect(src).toContain("configurable: true,");
    expect(src).toContain("defineDataContextBinding(bindings, name, read.value)");
  });

  it("CRITICAL: two same-spelling binders bind the LATER field, not the earlier", () => {
    // 3b double-reversed: the structural fold accumulated correctly and the
    // arm installation reversed it back, so the analysis resolved to the
    // runtime's LOSER. Field `p` is clean and field `q` is opaque; both bind
    // `v`, so the runtime's `v` is the OPAQUE one and observing it must fence.
    const pattern = Jobj(["p", Jobj(["$bind", Jstr("v")])], ["q", Jobj(["$bind", Jstr("v")])]);
    const scrut = shell("Rec", [slot("p", CLEAN), slot("q", opaque(0))]);
    const body = Jop("match", Jvar("s"), pattern, Jop("length", Jvar("v")));
    const out = analyze(body, [bind("s", scrut)]);
    expect(isFenced(out)).toBe(true);
    expect(channels(out)).toContain("length");
  });

  it("the reverse order admits, so the test above is not passing by accident", () => {
    const pattern = Jobj(["p", Jobj(["$bind", Jstr("v")])], ["q", Jobj(["$bind", Jstr("v")])]);
    const scrut = shell("Rec", [slot("p", opaque(0)), slot("q", CLEAN)]);
    const body = Jop("match", Jvar("s"), pattern, Jop("length", Jvar("v")));
    expect(analyze(body, [bind("s", scrut)]).$tag).toBe("ObsAdmitted");
  });

  it("the winner is correct at NESTED depth too — a single-site fix was not enough", () => {
    // The structural and array folds call the same installer, so with the
    // reversing fold the winner ALTERNATED with nesting depth.
    const inner = Jobj(["r", Jobj(["$bind", Jstr("v")])], ["s", Jobj(["$bind", Jstr("v")])]);
    const pattern = Jobj(["outer", inner]);
    const scrut = shell("Rec", [
      slot("outer", shell("Inner", [slot("r", CLEAN), slot("s", opaque(0))])),
    ]);
    const body = Jop("match", Jvar("s0"), pattern, Jop("length", Jvar("v")));
    expect(isFenced(analyze(body, [bind("s0", scrut)]))).toBe(true);
  });

  it("`vobBindAll` is winner-FIRST by concatenation, and the module says why", () => {
    const src = read(OBSERVE_SRC);
    expect(src).toContain("vobBindAll bs add = concat add bs");
    expect(src).toContain("WINNER-FIRST, and the direction is the whole rule");
  });
});

describe("slice 3d-D4 — the pattern arms the runtime actually takes", () => {
  it("`$bind` is read off a TAGGED pattern too, before any structural arm", () => {
    // `matchPattern` reads `$bind` with `ownDataRead` off ANY object and
    // returns immediately. Recognizing it only on a plain object let a
    // `{$tag: …, $bind: …}` pattern take the structural path here while the
    // runtime took the bind path — modelling a different arm than the one that
    // runs. Verified against source first.
    const src = read(JSON_LOGIC_SRC);
    expect(src).toContain("const bindRead = ownDataRead(pattern, \"$bind\");");
    const tagged = Jtagged("Just", ["$bind", Jstr("w")]);
    const out = analyze(
      Jop("match", Jvar("m"), tagged, Jop("length", Jvar("w"))),
      [bind("m", opaque(0))],
    );
    expect(isFenced(out)).toBe(true);
    expect(channels(out)).toContain("length");
  });

  it("a NON-literal `$bind` binds AND abstains — the runtime names it String(v)", () => {
    const pattern = Jobj(["$bind", Jnum(0)]);
    const out = analyze(Jop("match", Jvar("m"), pattern, Jnum(1)), [bind("m", CLEAN)]);
    expect(isFenced(out)).toBe(true);
    expect(details(out).join(" ")).toContain("String() coercion");
    const src = read(JSON_LOGIC_SRC);
    expect(src).toContain("bindPatternValue(String(bindRead.value), scrutinee)");
  });

  it("a `$guard` the runtime does NOT strip is an ordinary field, not a skip", () => {
    // `matchOp` strips only a TOP-LEVEL array-valued `$guard`; anything else
    // stays a field the runtime matches, and a match requires the key present.
    // 3b skipped it unconditionally, dropping the sub-pattern's observations.
    const pattern = Jobj(["$guard", Jstr("not-an-array")]);
    const out = analyze(Jop("match", Jvar("m"), pattern, Jnum(1)), [bind("m", opaque(0))]);
    expect(isFenced(out)).toBe(true);
  });

  it("a NON-string `$tag` is an ordinary field, so it is not skipped", () => {
    // `constructorPatternWireName` returns a non-string value UNCHANGED and
    // `matchPattern` then recurses on it like any other field.
    // SLICE 3e: the wire-tag test became a FIELD ROLE on the shared pattern
    // plan — it was too low-level to be a public contract of its own.
    const roleOf = (fields: any[], key: string) =>
      fields.find((f: any) => f.key === key)?.role?.$tag;
    // a literal-string `$tag` is the WIRE discriminator ...
    expect(roleOf(call("fdcPatternFields", [[Jfield("$tag", Jstr("Just"))], "", false]), "$tag")).toBe("FdcPatRoleWireTag");
    // ... a non-string one is an ordinary payload read ...
    expect(roleOf(call("fdcPatternFields", [[Jfield("$tag", Jnum(1))], "", false]), "$tag")).toBe("FdcPatRolePayload");
    // ... and any other key always is.
    expect(roleOf(call("fdcPatternFields", [[Jfield("other", Jstr("Just"))], "", false]), "other")).toBe("FdcPatRolePayload");
    // a TAGGED carrier has its stripped `$tag` RECONSTRUCTED, because the
    // runtime's own `Object.keys` sees it and matches it.
    const reconstructed = call("fdcPatternFields", [[Jfield("_0", Jnum(1))], "Just", true]);
    expect(reconstructed.map((f: any) => f.key)).toEqual(["$tag", "_0"]);
    expect(reconstructed[0].role.$tag).toBe("FdcPatRoleWireTag");
    const src = read(JSON_LOGIC_SRC);
    expect(src).toContain("if (typeof value !== \"string\") return value;");
  });
});

describe("slice 3d-D5 — `evaluate`'s dispatch ARMS, re-derived from source", () => {
  /** `evaluate`'s body, brace-matched past the parameter list's own `{}`
   *  defaults, with comments skipped and string literals preserved. */
  const evaluateBodySource = (src: string): string => {
    // P1(a.13) split the exported `evaluate` into a guarded DOOR plus the
    // dispatch implementation `evaluateInner`. The arm inventory this
    // sentinel pins is the IMPLEMENTATION's; the door is pinned separately
    // just below, so the split itself cannot hide an arm change.
    const start = src.indexOf("function evaluateInner(rule: any");
    expect(start).toBeGreaterThan(0);
    const p = src.indexOf("(", start);
    let pd = 0, pe = p;
    for (; pe < src.length; pe++) {
      if (src[pe] === "(") pd++;
      else if (src[pe] === ")") { pd--; if (pd === 0) break; }
    }
    const open = src.indexOf("{", pe);
    let depth = 0, i = open;
    for (; i < src.length; i++) {
      const c = src[i]!;
      const d = src[i + 1];
      if (c === "/" && d === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
      if (c === "/" && d === "*") {
        i += 2;
        while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
        i++;
        continue;
      }
      if (c === "\"" || c === "'" || c === "`") {
        const q = c;
        i++;
        while (i < src.length && src[i] !== q) { if (src[i] === "\\") i++; i++; }
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) break; }
    }
    return src.slice(open + 1, i);
  };

  const stripComments = (s: string): string => {
    let out = "";
    let i = 0;
    while (i < s.length) {
      const c = s[i]!;
      const d = s[i + 1];
      if (c === "/" && d === "/") { while (i < s.length && s[i] !== "\n") i++; continue; }
      if (c === "/" && d === "*") {
        i += 2;
        while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) i++;
        i += 2;
        continue;
      }
      if (c === "\"" || c === "'" || c === "`") {
        const q = c;
        out += c;
        i++;
        while (i < s.length && s[i] !== q) { if (s[i] === "\\") { out += s[i]; i++; } out += s[i]; i++; }
        out += q;
        i++;
        continue;
      }
      out += c;
      i++;
    }
    return out;
  };

  const norm = (s: string) => s.replace(/\s+/g, " ").trim();

  /** Every `if` / `for` guard and every `return` statement in `evaluate`'s
   *  body, IN SOURCE ORDER. */
  const controls = (body: string): [string, string][] => {
    const out: [string, string][] = [];
    const re = /\b(if|for)\s*\(|\breturn\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      if (m[1]) {
        let depth = 0;
        let j = m.index + m[0].length - 1;
        for (; j < body.length; j++) {
          if (body[j] === "(") depth++;
          else if (body[j] === ")") { depth--; if (depth === 0) break; }
        }
        out.push([m[1], norm(body.slice(m.index, j + 1))]);
        re.lastIndex = j + 1;
      } else {
        let depth = 0;
        let j = m.index + 6;
        for (; j < body.length; j++) {
          const c = body[j]!;
          if (c === "(" || c === "{" || c === "[") depth++;
          else if (c === ")" || c === "}" || c === "]") depth--;
          else if (c === ";" && depth === 0) break;
        }
        out.push(["return", norm(body.slice(m.index, j + 1))]);
        re.lastIndex = j + 1;
      }
    }
    return out;
  };

  /** The pinned inventory. Each `return` is mapped to the tier pseudo-form it
   *  belongs to, or to the one arm that expands into the forty ops. READ OFF
   *  THE LIVE SOURCE, then frozen. */
  const OPS_ARM = "KNOWN_OPS-arm";
  // SLICE 3e — a FOURTH column: the STRUCTURAL exit id, which now lives in the
  // shared decomposition (`fdcExitInventory`). The split the slice brief asked
  // for is exactly this: the exit INVENTORY is a property of the evaluator and
  // is shared; the MAPPING onto this analysis's nine semantic tiers is not, and
  // stays here. The cross-check below is what makes the shared half
  // load-bearing rather than a second hand-maintained list.
  const EXPECTED: [string, string, string?, string?][] = [
    ["if", "if (rule === null || rule === undefined)"],
    ["return", "return rule;", "«null»", "nullish-passthrough"],
    ["if", "if (typeof rule === \"string\" || typeof rule === \"number\" || typeof rule === \"boolean\")"],
    ["return", "return rule;", "«scalar»", "scalar-passthrough"],
    ["if", "if (Array.isArray(rule))"],
    ["return", "return evaluateEach(rule, data, ctx);", "«array»", "array-elementwise"],
    ["if", "if (isClosure(rule) || isPartial(rule))"],
    ["return", "return rule;", "«closure»", "callable-passthrough"],
    ["if", "if (ArrayBuffer.isView(rule) || rule instanceof ArrayBuffer)"],
    ["return", "return rule;", "«bytes»", "buffer-passthrough"],
    ["if", "if (\"$tag\" in rule)"],
    ["return", "return rule;", "«tagged»", "tagged-passthrough"],
    ["if", "if (keys.length === 1)"],
    ["if", "if (KNOWN_OPS.has(op))"],
    ["return", "return applyOp(op, argList, data, ctx);", OPS_ARM, "known-op"],
    ["if", "if (ctx.getFunction?.(op) || op in BUILTIN_OP_NATIVES)"],
    ["return", "return invokeFunction(op, evaluatedArgs, ctx);", "«key-as-fnId»", "key-as-fnid"],
    ["if", "if (op.startsWith(\"$\"))"],
    ["return", "return rule;", "«dollar-marker»", "dollar-marker"],
    ["return", "return { [op]: evaluateInner(rule[op], data, ctx) };", "«record»", "single-field-record"],
    ["for", "for (const k of keys)"],
    ["if", "if (k.startsWith(\"$\"))"],
    ["return", "return rule;", "«dollar-marker»", "dollar-multikey-marker"],
    ["for", "for (const k of keys)"],
    ["return", "return out;", "«record»", "record-literal"],
  ];

  const liveArms = () => controls(stripComments(evaluateBodySource(read(JSON_LOGIC_SRC))));

  it("the arm inventory is pinned to source: no arm added, removed or reordered", () => {
    expect(liveArms()).toEqual(EXPECTED.map(([kind, text]) => [kind, text] as [string, string]));
  });

  it("P1(a.13): the exported `evaluate` is a GUARD around the pinned implementation", () => {
    // The inventory above reads `evaluateInner`. That is only sound while the
    // exported entry does nothing but guard-and-delegate — otherwise an arm
    // could be added at the door and the inventory would not see it.
    //
    // ⚠ AST, not substrings. The first version of this check asserted a few
    // `toContain`s, and review round 5 showed that inserting
    // `if (rule === "__doorArm") return true;` before the guard satisfied every
    // one of them while adding exactly the hidden arm the check exists to
    // exclude. The door's body is now matched STATEMENT BY STATEMENT.
    const src = read(JSON_LOGIC_SRC);
    const sf = ts.createSourceFile("json-logic.ts", src, ts.ScriptTarget.Latest, true);
    let door: ts.FunctionDeclaration | undefined;
    sf.forEachChild((n) => {
      if (ts.isFunctionDeclaration(n) && n.name?.text === "evaluate") door = n;
    });
    expect(door).toBeDefined();
    // Round 6 (Codex): pinning only the BODY leaves the SIGNATURE free. Changing
    // the `data` default to `{ x: 1 }` passes every body assertion while
    // `evaluate({var:"x"})` goes from `null` to `1`, and a throwing default
    // initializer would run before the guarded body ever executes.
    expect(door!.parameters.map((p) => p.getText(sf))).toEqual([
      "rule: any",
      "data: DataContext = {}",
      "ctx: EvaluateContext = EMPTY_CTX",
    ]);
    expect((door!.modifiers ?? []).map((m) => m.getText(sf))).toEqual(["export"]);
    expect(door!.asteriskToken).toBeUndefined();
    const stmts = door!.body!.statements;
    // exactly two statements: the fast-path guard, then the try/catch.
    expect(stmts.length).toBe(2);

    const guard = stmts[0]!;
    expect(ts.isIfStatement(guard)).toBe(true);
    const g = guard as ts.IfStatement;
    expect(g.elseStatement).toBeUndefined();
    expect(g.expression.getText(sf)).toBe("whereProofFrames.length === 0 && engineBodyMemoRecording.frame === null");
    expect(g.thenStatement.getText(sf)).toBe("return evaluateInner(rule, data, ctx);");

    const tryStmt = stmts[1]!;
    expect(ts.isTryStatement(tryStmt)).toBe(true);
    const t = tryStmt as ts.TryStatement;
    expect(t.finallyBlock).toBeUndefined();
    expect(t.tryBlock.statements.length).toBe(1);
    expect(t.tryBlock.statements[0]!.getText(sf)).toBe("return evaluateInner(rule, data, ctx);");
    // the handler MARKS and RETHROWS — nothing else, and nothing conditional.
    // S1 (2026-10-23): the second mark taints an active engine-body memo
    // recording; it is a mark of the same kind and the rethrow stays last.
    const handler = t.catchClause!;
    const hs = handler.block.statements;
    expect(hs.length).toBe(5);
    expect(hs[0]!.getText(sf)).toBe("const f = whereProofFrames[whereProofFrames.length - 1];");
    expect(hs[1]!.getText(sf)).toBe("if (f !== undefined) f.tripped = true;");
    expect(hs[2]!.getText(sf)).toBe("const r = engineBodyMemoRecording.frame;");
    expect(hs[3]!.getText(sf)).toBe('if (r !== null && r.taint === undefined) r.taint = "exception crossed an evaluator door";');
    expect(hs[4]!.getText(sf)).toBe("throw e;");
  });

  it("P1(a.13): the exported `invokeCallable` is the SAME guard-and-delegate shape", () => {
    // Round 7 (Grok): only `evaluate` was statement-pinned, so an arm inserted
    // at the SECOND door — `if (callable === "__doorArm") return true;` — passed
    // both AST checks. The door argument rests on BOTH doors being nothing but
    // guard-and-delegate, so both are pinned the same way.
    const src = read(JSON_LOGIC_SRC);
    const sf = ts.createSourceFile("json-logic.ts", src, ts.ScriptTarget.Latest, true);
    let door: ts.FunctionDeclaration | undefined;
    sf.forEachChild((n) => {
      if (ts.isFunctionDeclaration(n) && n.name?.text === "invokeCallable") door = n;
    });
    expect(door).toBeDefined();
    expect(door!.parameters.map((p) => p.getText(sf))).toEqual([
      "callable: unknown",
      "evaluatedArgs: unknown[]",
      "ctx: EvaluateContext",
    ]);
    expect((door!.modifiers ?? []).map((m) => m.getText(sf))).toEqual(["export"]);
    // Round 8 (Codex + Grok, independently): the FIRST door pins this and the
    // second did not. `export function* invokeCallable` satisfies every other
    // assertion here and returns a Generator without running the body at all,
    // so the guard would never execute.
    expect(door!.asteriskToken).toBeUndefined();
    const stmts = door!.body!.statements;
    expect(stmts.length).toBe(2);
    const guard = stmts[0]! as ts.IfStatement;
    expect(ts.isIfStatement(guard)).toBe(true);
    expect(guard.elseStatement).toBeUndefined();
    expect(guard.expression.getText(sf)).toBe("whereProofFrames.length === 0 && engineBodyMemoRecording.frame === null");
    expect(guard.thenStatement.getText(sf))
      .toBe("return invokeCallableInner(callable, evaluatedArgs, ctx);");
    const t = stmts[1]! as ts.TryStatement;
    expect(ts.isTryStatement(t)).toBe(true);
    expect(t.finallyBlock).toBeUndefined();
    expect(t.tryBlock.statements.length).toBe(1);
    expect(t.tryBlock.statements[0]!.getText(sf))
      .toBe("return invokeCallableInner(callable, evaluatedArgs, ctx);");
    const hs2 = t.catchClause!.block.statements;
    expect(hs2.length).toBe(5);
    expect(hs2[0]!.getText(sf)).toBe("const f = whereProofFrames[whereProofFrames.length - 1];");
    expect(hs2[1]!.getText(sf)).toBe("if (f !== undefined) f.tripped = true;");
    expect(hs2[2]!.getText(sf)).toBe("const r = engineBodyMemoRecording.frame;");
    expect(hs2[3]!.getText(sf)).toBe('if (r !== null && r.taint === undefined) r.taint = "exception crossed an evaluator door";');
    expect(hs2[4]!.getText(sf)).toBe("throw e;");
  });

  it("THE COUNT: twelve return arms, one of which expands into the forty ops", () => {
    const returns = liveArms().filter(([kind]) => kind === "return");
    expect(returns.length).toBe(12);
    expect(EXPECTED.filter((e) => e[2] === OPS_ARM).length).toBe(1);
    // 3b's prose said "twelve dispatch tiers" beside a NINE-entry list; the
    // module now states the arithmetic and this pins it.
    const src = read(OBSERVE_SRC);
    expect(src).toContain("`evaluate` has TWELVE");
    expect(src).not.toContain("Twelve `evaluate` dispatch tiers");
  });

  it("EXHAUSTIVENESS, both ways: the eleven non-op arms group onto exactly the nine tiers", () => {
    // ROUND-2 REPAIR: the mapping side was not ENFORCED. `derived` filtered out
    // undefined mappings, so deleting the tier from one of the two duplicate
    // `«record»` / `«dollar-marker»` arms left this test green — the claim "an
    // arm with no tier fails" was false. Every `return` must now carry one.
    for (const [kind, text, mapped] of EXPECTED) {
      if (kind !== "return") continue;
      expect(mapped, `return arm has no tier mapping: ${text}`).toBeDefined();
    }
    // ... and no NON-return entry may carry one, which is the other direction.
    for (const [kind, , mapped] of EXPECTED) {
      if (kind === "return") continue;
      expect(mapped).toBeUndefined();
    }
    const derived = new Set(
      EXPECTED.filter((e) => e[2] !== undefined && e[2] !== OPS_ARM).map((e) => e[2]!),
    );
    const declaredTiers: string[] = call("vobTierNames", [0]);
    // no arm without a tier, and no tier without an arm
    expect([...derived].sort()).toEqual([...declaredTiers].sort());
    expect(declaredTiers.length).toBe(9);
    const nonOpReturns = EXPECTED.filter((e) => e[0] === "return" && e[2] !== OPS_ARM);
    expect(nonOpReturns.length).toBe(11);
  });

  it("D5 SPLIT: the STRUCTURAL exit inventory is the shared one, arm for arm", () => {
    // The structural half moved to `fdcExitInventory` in slice 3e. It is only a
    // real move if the two agree, so the source-derived return arms are matched
    // against the shared inventory in ORDER — an arm the inventory does not name
    // fails, and an inventory entry with no arm fails.
    const derivedIds = EXPECTED.filter((e) => e[0] === "return").map((e) => e[3]);
    for (const id of derivedIds) expect(id, "a return arm carries no shared exit id").toBeDefined();
    const shared: any[] = call("fdcExitInventory", [0]);
    expect(shared.map((a) => a.id)).toEqual(derivedIds);
    expect(shared.length).toBe(12);
    // ... and REACHABILITY is a claim about the MARSHALLED carrier, not the
    // evaluator: exactly the two arms whose values have no `JsonLogic` case.
    const unreachable = shared.filter((a) => !a.reachable).map((a) => a.id);
    expect(unreachable).toEqual(["callable-passthrough", "buffer-passthrough"]);
    const tiers = new Map(
      EXPECTED.filter((e) => e[0] === "return").map((e) => [e[3]!, e[2]!] as const),
    );
    expect(tiers.get("callable-passthrough")).toBe("«closure»");
    expect(tiers.get("buffer-passthrough")).toBe("«bytes»");
    // The SEMANTIC half stays here: two exits share `«record»` and two share
    // `«dollar-marker»`, which is the grouping this analysis owns.
    expect(derivedIds.length).toBe(new Set(derivedIds).size);
    expect(new Set([...tiers.values()]).size).toBeLessThan(derivedIds.length);
  });

  it.skipIf(!HAS_TCB_LEDGER)("HONESTY: this is a source-DRIFT gate; the arm-to-class map is human-audited", () => {
    // Recorded because the row is an AXIOM and not a theorem. The inventory is
    // mechanical; which transfer class an arm belongs to is not, and a
    // semantic change inside `applyOp` or `invokeFunction` moves no line here.
    const ledger = read(TCB_LEDGER);
    expect(ledger).toContain("obs.form.arms");
    expect(ledger).toContain("source-drift gate");
  });
});

// ===========================================================================
// SLICE 3d ROUND 2 — defects the result review found INSIDE round 1's fixes,
// plus two the design round missed. Every premise below was verified against
// source before it was pinned.
// ===========================================================================

describe("slice 3d round 2 — a lambda parameter the analysis cannot NAME", () => {
  it("CRITICAL: a non-literal lambda parameter fences instead of being dropped", () => {
    // `fnOp` takes the canonical form's `args[0]` VERBATIM as the parameter
    // vector, and `defineDataContextBinding` installs each entry through
    // `Object.defineProperty`, whose key goes through ToPropertyKey. So
    // `{fn: [[["x"]], body]}` binds the NAME `x` at runtime. Round 1's
    // `vobLambdaParams` DROPPED the nested array, so the body's `{var:"x"}`
    // resolved to the CLEAN OUTER binder while the runtime had shadowed it with
    // the lambda's actual — a false admission, not lost coverage.
    const src = read(JSON_LOGIC_SRC);
    // P1(a.13) review round 12 (Codex): the canonical arm no longer takes
    // `args[0]` VERBATIM — a hole INSIDE the parameter vector became the
    // property key `"undefined"`, a formal nobody wrote, so the vector is now
    // truncated at its first hole like any other operand list. For a DENSE
    // vector `argsUpToFirstHole` returns its argument unchanged, so the reading
    // this sentinel tracks — the vector reaches `defineDataContextBinding`
    // entry by entry, through ToPropertyKey — is exactly as before.
    expect(src).toContain("const cutParams = argsUpToFirstHole(rawParams);");
    expect(src).toContain("params = cutParams as string[];");
    expect(src).toContain("defineDataContextBinding(fnData, closure.params[i]!, evaluatedArgs[i]);");

    // SLICE 3e SUPERSEDES ROUND 1'S REMEDY, in the direction of PRECISION.
    // `String(["x"])` is exactly `"x"` — `Array.prototype.toString` is
    // `join(",")` — so the spelling is not merely nameable, it is EXACT. The
    // shared decomposition reproduces it, so the analysis now performs the same
    // shadow the runtime does instead of fencing on an unknown name. The false
    // admission stays closed: the body still reads the LAMBDA's binder, which
    // is opaque over the quantified ordinal, so `length` on it fences.
    const nested = Jop("fn", Jarr(Jarr(Jstr("x"))), Jop("length", Jvar("x")));
    expect(call("fdcLambdaLayout", [[Jarr(Jarr(Jstr("x"))), Jnum(1)]]).namesTotal).toBe(true);
    expect(call("fdcParamSpellings", [call("fdcLambdaLayout", [[Jarr(Jarr(Jstr("x"))), Jnum(1)]]).params, []]))
      .toEqual(["x"]);
    const out = analyze(nested, [bind("x", CLEAN)], [0]);
    expect(isFenced(out)).toBe(true);
    expect(details(out).join(" ")).not.toContain("not reproducible");
    expect(channels(out)).toContain("length");
    // and a genuinely unreproducible entry — a NUMBER, whose marshalled form
    // cannot be rendered back to its decimal spelling here — still fences.
    const opaqueParam = Jop("fn", Jarr(Jnum(7)), Jop("length", Jvar("x")));
    expect(call("fdcLambdaLayout", [[Jarr(Jnum(7)), Jnum(1)]]).namesTotal).toBe(false);
    expect(details(analyze(opaqueParam, [bind("x", CLEAN)], [0])).join(" ")).toContain("not reproducible");
  });

  it("an ORDINARY lambda parameter is unaffected — the repair is not a blanket fence", () => {
    const ok = Jop("fn", Jarr(Jstr("x")), Jop("length", Jvar("x")));
    const out = analyze(ok, [bind("x", CLEAN)], [0]);
    // it still fences, but for the RIGHT reason: the parameter binds opaquely
    expect(channels(out)).toContain("length");
    expect(details(out).join(" ")).not.toContain("not a literal name");
    // and with nothing quantified it admits, exactly as before
    expect(analyze(ok, [bind("x", CLEAN)], []).$tag).toBe("ObsAdmitted");
  });

  it("the flat lambda grammar is covered too — and slice 3e corrects it", () => {
    const total = (args: unknown[]) => call("fdcLambdaLayout", [args]).namesTotal;
    const names = (args: unknown[]) =>
      call("fdcParamSpellings", [call("fdcLambdaLayout", [args]).params, []]);

    expect(total([Jstr("x"), Jnum(1)])).toBe(true);
    expect(names([Jstr("x"), Jnum(1)])).toEqual(["x"]);
    expect(total([Jnum(7), Jnum(1)])).toBe(false);

    // THE DEFECT BOTH WALKERS SHARED. `fnOp`'s flat arm String()-coerces each
    // leading argument, so an ARRAY parameter is ONE binder named "y,z" — not
    // two named `y` and `z`. Both analyses expanded it, AGREED with each other,
    // and were both wrong; the runtime probe in
    // signature-form-decomposition.test.ts is the oracle that settles it.
    expect(names([Jstr("x"), Jarr(Jstr("y"), Jstr("z")), Jnum(1)])).toEqual(["x", "y,z"]);
    expect(total([Jstr("x"), Jarr(Jstr("y"), Jstr("z")), Jnum(1)])).toBe(true);
    // nested arrays join at EVERY level, so an empty one still contributes its
    // separator — flatten-then-join would answer "y,z,w" for both of these.
    // (A LEADING string keeps these in the FLAT grammar: an array in slot 0
    // would make the form canonical, where that array IS the parameter vector.)
    expect(names([Jstr("x"), Jarr(Jarr(Jstr("y"), Jstr("z")), Jstr("w")), Jnum(1)])).toEqual(["x", "y,z,w"]);
    expect(names([Jstr("x"), Jarr(Jstr("a"), Jarr(), Jstr("b")), Jnum(1)])).toEqual(["x", "a,,b"]);
    // ... and the CANONICAL reading of the same array is two separate binders,
    // because there args[0] is the parameter VECTOR rather than one entry.
    expect(names([Jarr(Jarr(Jstr("y"), Jstr("z")), Jstr("w")), Jnum(1)])).toEqual(["y,z", "w"]);
    // the canonical grammar takes args[0] VERBATIM and ignores every trailing
    // item, so the same coercion applies one level down.
    expect(names([Jarr(Jarr(Jstr("x"))), Jnum(1)])).toEqual(["x"]);
    expect(call("fdcLambdaLayout", [[Jarr(Jstr("x")), Jnum(1), Jstr("TRAILING")]]).ignored.length).toBe(1);
  });
});

describe("slice 3d round 2 — the published profile is bound to the declared mode", () => {
  it("CRITICAL: an admission cannot be LABELLED with a lowering nothing analysed", () => {
    // `ObsAdmitted` republishes `analysedProfiles` verbatim, and round 1 tied
    // that list to nothing: a request could pass the mode gate on
    // interpreted/Direct and still label its admission `compiled-js`.
    const out = analyzeRequest({
      analysedProfiles: ["compiled-js"],
      requiredProfiles: ["compiled-js"],
    });
    expect(isFenced(out)).toBe(true);
    expect(details(out).join(" ")).toContain("not the declared lowering");
  });

  it("an arbitrary profile string is refused, not merely an unmatched one", () => {
    expect(isFenced(analyzeRequest({
      analysedProfiles: ["bogus"], requiredProfiles: ["bogus"],
    }))).toBe(true);
  });

  it("a matching label still admits, and is what the verdict publishes", () => {
    const out = analyzeRequest({});
    expect(out.$tag).toBe("ObsAdmitted");
    expect(out.profiles).toEqual(["interpreted"]);
  });
});

describe("slice 3d round 2 — origin/tier consistency uses the NATIVE-MAP partition", () => {
  const t = (over: Record<string, unknown> = {}) => target({
    origin: "ExternalHandler", tier: "", key: "", ...over,
  });

  it("an external handler and a builtin-op native carry NO coordinate, and that is correct", () => {
    // Round 1 keyed the rule on `vobBranchIsHostActive`, which ADMITS
    // `ExternalHandler` and `BuiltinOpNative` — but neither is reached through a
    // native map (an external handler has no installed implementation; a
    // BuiltinOpNative is reached only for a key with no registration at all).
    // Demanding a coordinate of them false-fenced correct records.
    for (const origin of ["ExternalHandler", "BuiltinOpNative"]) {
      const out = analyze(Jop("t", Jnum(1)), [], [0], [t({ origin })]);
      expect(details(out).join(" "), origin).not.toContain("native-map coordinate");
    }
    expect(call("vobBranchIsNativeMapped", ["HostNative"])).toBe(true);
    expect(call("vobBranchIsNativeMapped", ["NativeWithFallback"])).toBe(true);
    expect(call("vobBranchIsNativeMapped", ["ExternalHandler"])).toBe(false);
    expect(call("vobBranchIsNativeMapped", ["BuiltinOpNative"])).toBe(false);
    // ... and it is strictly NARROWER than the host-active predicate
    expect(call("vobBranchIsHostActive", ["ExternalHandler"])).toBe(true);
  });

  it("a native-mapped branch with no coordinate still abstains", () => {
    const out = analyze(Jop("t", Jnum(1)), [], [0], [t({ origin: "HostNative" })]);
    expect(details(out).join(" ")).toContain("names no native-map coordinate");
  });
});

describe("slice 3d round 2 — the declared-type scan is bounded in WIDTH as well as depth", () => {
  it("a very wide former degrades instead of driving the host stack over", () => {
    // Depth fuel alone leaves the sibling folds unbounded: one interpreter
    // frame per sibling. A ten-thousand-element tuple reproduces the overflow.
    const wide = { $tuple: Array.from({ length: 4000 }, () => ({ $ref: "Int" })) };
    const repr = call("vobDeriveRepr", [declared(wide), ONE_QUANTIFIER, [0]]);
    // degraded, not crashed — and degrading means OPAQUE, the safe direction
    expect(repr.$tag).toBe("RprOpaque");
    expect(repr.ordinals).toEqual([0]);
    expect(call("vobScanSiblingBudget", [0])).toBe(1024);
  });

  it("a former just inside the budget is still scanned exactly", () => {
    const narrow = { $tuple: Array.from({ length: 8 }, () => ({ $ref: "Int" })) };
    expect(call("vobDeriveRepr", [declared(narrow), ONE_QUANTIFIER, [0]])).toEqual(rprGround);
  });
});

describe("slice 3d round 2 — the prose that over-claimed", () => {
  it("the request is NOT described as a correspondence check", () => {
    const src = read(OBSERVE_SRC);
    expect(src).toContain("IT IS NOT A CORRESPONDENCE CHECK");
    // and the thing it actually does is stated
    expect(src).toContain("removes the PARALLEL-LIST");
  });

  it("`targets` is named as a REMAINING provenance channel", () => {
    const src = read(OBSERVE_SRC);
    expect(src).toContain("IS STILL A PROVENANCE CHANNEL");
    // the concrete mechanism, not a hand-wave
    expect(src).toContain("under-stated `resultRigids`");
  });

  it("a caller-supplied summary DOES still authorize a call, and that is recorded", () => {
    // The demonstration behind the claim above: the parameter seed is closed,
    // the target/summary channel is not.
    const t = target({ summary: summary({ observesFrom: [], outputDerivesFrom: [] }) });
    const out = analyze(Jop("call", Jstr("t"), Jvar("x")), [bind("x", opaque(0))], [0], [t]);
    expect(out.$tag).toBe("ObsAdmitted");
    // ... and declaring the truthful relation fences it
    const honest = target({ summary: summary({ observesFrom: [0] }) });
    expect(isFenced(analyze(Jop("call", Jstr("t"), Jvar("x")), [bind("x", opaque(0))], [0], [honest])))
      .toBe(true);
  });

  it("the 'every reason' claim is downgraded to 'accumulates'", () => {
    const src = read(OBSERVE_SRC);
    expect(src).toContain("\"EVERY reason\" IS TOO STRONG");
    expect(src).not.toContain("ObsFenced` carries EVERY reason");
  });
});
