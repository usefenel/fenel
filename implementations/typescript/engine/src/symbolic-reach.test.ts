// partial-evaluator-substrate Phase 2 — conformance tests for SYMBOLIC REACH
// (brief: `workstreams/partial-evaluator-substrate/briefs/phase-2-symbolic-reach.md`;
// design: `design/partial-evaluation.md` §4-5 + `design/symbolic-execution.md`).
//
// The 14a mint is PER-SITE (distinct paths ⇒ distinct EVar names ⇒ solve's
// single-unknown fence bites for a two-read predicate). Phase 2 lands:
//   • the READ MEMORY MODEL v1 (whole-tree no-write gate) + the VALUE-NUMBERED
//     mint (same class+method+eufValEq-equal args ⇒ ONE var) so same-KEY reads
//     collapse to one unknown — `(read k)==42 ∧ (read k)>40` witnesses Just 42;
//   • the EUF REFUTATION face (`satSymbolic`) — reads handed to `eufSat` AS
//     application terms under the lawful gate — so `read(a)==1 ∧ read(b)==2 ∧
//     a==b` refutes with zero IO; the ambient `decideEmpty` STILL fences the
//     same SeWhere (no memory model);
//   • the scoped `Symbolic` resolution (block `_dictStack` + global registry).
//
// The 14a per-site path is UNCHANGED (symbolize.test stays green); these rows
// exercise the NEW shared-mint / refutation / scoped surfaces.

import { describe, it, expect } from "vitest";
import {
  dispatchEngineBody,
  dispatchEngineBodyWithDeciderCtx,
  dispatchedSymbolize,
  dispatchedSymbolizeShared,
  dispatchedSolveSymbolicShared,
  dispatchedSymbolizeSharedDetailed,
  dispatchedSatSymbolic,
  dispatchedSolveSymbolicScoped,
  dispatchedSatSymbolicScoped,
} from "./engine-bodies-dispatch";
import { dispatchRegistry } from "./system-entities";
import { accountDispatchFrame } from "./authority-test-support";

// rights R3a — the ownership coordinate. A test can no longer plant a GLOBAL row
// in the shared registry and take it back out: `removeInstance` is owner-scoped,
// and the `Symbolic*` rosters are fenced to the repository for a ctx that
// derives no account. So the fixture rows are OWNED by a fixture account and the
// scoped calls run under that account's frame.
const R3A_ACCOUNT = "r3a-symbolic-fixture-account";
const R3A_OTHER_ACCOUNT = "r3a-symbolic-other-account";


// --- tiny Expr builders (plain $tag-tagged objects) ----------------------
const EVar = (name: string) => ({ $tag: "EVar", name });
const ELit = (value: unknown) => ({ $tag: "ELit", value });
const ECall = (fnId: string, args: unknown[]) => ({ $tag: "ECall", fnId, args });
const SeWhere = (pred: unknown) => ({ $tag: "SeWhere", pred });

type MaybeV = { $tag: string; _0?: unknown };

const GET = "$effect:HasStateIO:getInstance";
const SET = "$effect:HasStateIO:setInstance"; // a WRITE method (not in `reads`)
const read = (k: string) => ECall(GET, [ELit(k)]);
const write = (k: string) => ECall(SET, [ELit(k)]);
const specHS = [{ effectClass: "HasStateIO", reads: ["getInstance"] }];

// The `Symbolic`-spec resolver reads instances keyed by typeName "Symbolic";
// each carries { reads } and is keyed on the effect-class name (args[0]).
const symbolizeShared = (spec: unknown, e: unknown) =>
  dispatchedSymbolizeShared(spec, e) as { $tag: string; args?: any[] };

// ---------------------------------------------------------------------------
// §2 — the value-numbered mint (the memory model v1)
// ---------------------------------------------------------------------------

describe("§2 mint — same-key reads share ONE value-numbered unknown", () => {
  it("two same-key reads (same class+method+args) collapse to ONE `?sym:` var", () => {
    // (read k) == 42 ∧ (read k) > 40 — two reads of the SAME key.
    const prog = ECall("and", [ECall("eq", [read("k"), ELit(42)]), ECall("gt", [read("k"), ELit(40)])]);
    const out = symbolizeShared(specHS, prog);
    const n0 = out.args![0].args[0].name as string;
    const n1 = out.args![1].args[0].name as string;
    expect(out.args![0].args[0].$tag).toBe("EVar");
    expect(out.args![1].args[0].$tag).toBe("EVar");
    expect(n0).toBe("?sym:HasStateIO:getInstance:0");
    expect(n1).toBe(n0); // SHARED — the memory model's core claim
    expect(n0.includes(".")).toBe(false); // dot-free (collectFreeVars constraint)
  });

  it("distinct keys get DISTINCT groups (read(a) ≠ read(b) — different args)", () => {
    // (read a) == 1 ∧ (read b) == 2 — different keys ⇒ different reads.
    const prog = ECall("and", [ECall("eq", [read("a"), ELit(1)]), ECall("eq", [read("b"), ELit(2)])]);
    const out = symbolizeShared(specHS, prog);
    const n0 = out.args![0].args[0].name as string;
    const n1 = out.args![1].args[0].name as string;
    expect(n0).toBe("?sym:HasStateIO:getInstance:0");
    expect(n1).toBe("?sym:HasStateIO:getInstance:1");
    expect(n0).not.toBe(n1);
  });

  it("a WRITE anywhere POISONS the class ⇒ every read falls back to the per-site 14a name", () => {
    // (read k) == 42 ∧ (setInstance k) == 1 — a write ⇒ no value-numbering.
    const prog = ECall("and", [ECall("eq", [read("k"), ELit(42)]), ECall("eq", [write("k"), ELit(1)])]);
    const out = symbolizeShared(specHS, prog);
    const readName = out.args![0].args[0].name as string;
    // per-site fallback = the 14a `?<fnId>@<path>` shape (NOT `?sym:`).
    expect(readName.startsWith("?sym:")).toBe(false);
    expect(readName.startsWith(`?${GET}@`)).toBe(true);
  });

  it("a non-`reads` method (no Symbolic scope for its class) POISONS ⇒ per-site fallback", () => {
    // spec declares NO reads for HasStateIO ⇒ getInstance is not a declared read.
    const noReads = [{ effectClass: "HasStateIO", reads: [] as string[] }];
    const prog = ECall("and", [ECall("eq", [read("k"), ELit(42)]), ECall("gt", [read("k"), ELit(40)])]);
    const out = symbolizeShared(noReads, prog);
    expect((out.args![0].args[0].name as string).startsWith("?sym:")).toBe(false);
  });

  it("cross-class ISOLATION — reads of two Symbolic classes get distinct groups (never merged)", () => {
    const specAB = [
      { effectClass: "CA", reads: ["get"] },
      { effectClass: "CB", reads: ["get"] },
    ];
    const prog = ECall("and", [
      ECall("eq", [ECall("$effect:CA:get", [ELit("k")]), ELit(5)]),
      ECall("eq", [ECall("$effect:CB:get", [ELit("k")]), ELit(5)]),
    ]);
    const out = symbolizeShared(specAB, prog);
    const n0 = out.args![0].args[0].name as string;
    const n1 = out.args![1].args[0].name as string;
    expect(n0).toBe("?sym:CA:get:0");
    expect(n1).toBe("?sym:CB:get:1");
    expect(n0).not.toBe(n1); // isolated — merging them would be UNSOUND
  });

  it("β-duplicated site (two eufValEq-identical reads) trivially shares — one dynamic read", () => {
    // The identical read appears twice; value-numbering collapses them (sound —
    // one dynamic read duplicated by reduction).
    const prog = ECall("eq", [read("dup"), read("dup")]);
    const out = symbolizeShared(specHS, prog);
    expect(out.args![0].name).toBe(out.args![1].name);
    expect(out.args![0].name).toBe("?sym:HasStateIO:getInstance:0");
  });

  it("EMPTY spec ≡ the per-site 14a mint (symbolizeShared [] === symbolizeEffects)", () => {
    const prog = ECall("eq", [read("k"), ELit(42)]);
    const shared = dispatchedSymbolizeShared([], prog);
    const perSite = dispatchedSymbolize([], prog); // 14a path
    expect(shared).toEqual(perSite);
  });
});

// ---------------------------------------------------------------------------
// §4 — the composed WITNESS entry (solve over the value-numbered residual)
// ---------------------------------------------------------------------------

describe("§4 solve — the same-key witness (the fence the memory model LIFTS)", () => {
  it("HEADLINE: (read k)==42 ∧ (read k)>40 ⇒ Just 42 (enum∩interval over the SHARED var)", () => {
    const prog = ECall("and", [ECall("eq", [read("k"), ELit(42)]), ECall("gt", [read("k"), ELit(40)])]);
    expect(dispatchedSolveSymbolicShared(specHS, prog)).toEqual({ $tag: "Just", _0: 42 });
  });

  it("the SAME predicate under the per-site 14a mint is Nothing (two vars) — the lifted fence", () => {
    // symbolizeEffects mints two distinct site-named vars ⇒ 2 free vars ⇒ solve's
    // single-unknown fence ⇒ Nothing. This IS what the memory model fixes.
    const prog = ECall("and", [ECall("eq", [read("k"), ELit(42)]), ECall("gt", [read("k"), ELit(40)])]);
    const perSite = dispatchedSymbolize([], prog);
    expect((dispatchEngineBody("engine:solve", [perSite]) as MaybeV).$tag).toBe("Nothing");
  });

  it("a single-read predicate still witnesses (the 14a headline, value-numbered)", () => {
    const prog = ECall("eq", [read("counter"), ELit(42)]);
    expect(dispatchedSolveSymbolicShared(specHS, prog)).toEqual({ $tag: "Just", _0: 42 });
  });

  it("truthfulness (§2.4): the witnessed read value satisfies BOTH original conjuncts", () => {
    // The shared var stands for the one dynamic read of `k`; the solve witness (42)
    // must satisfy `== 42` AND `> 40` — the residual is faithful to the original.
    const prog = ECall("and", [ECall("eq", [read("k"), ELit(42)]), ECall("gt", [read("k"), ELit(40)])]);
    const r = dispatchedSolveSymbolicShared(specHS, prog) as MaybeV;
    expect(r.$tag).toBe("Just");
    const v = r._0 as number;
    expect(v === 42).toBe(true); // eq conjunct
    expect(v > 40).toBe(true); // gt conjunct
  });
});

// ---------------------------------------------------------------------------
// §3 — the EUF refutation face (reads AS application terms; the lawful gate)
// ---------------------------------------------------------------------------

describe("§3 satSymbolic — read-to-read refutation via EUF congruence", () => {
  it("HEADLINE: read(a)==1 ∧ read(b)==2 ∧ a==b ⇒ Just false (congruence unsat, zero IO)", () => {
    const prog = ECall("and", [
      ECall("eq", [ECall(GET, [EVar("a")]), ELit(1)]),
      ECall("and", [ECall("eq", [ECall(GET, [EVar("b")]), ELit(2)]), ECall("eq", [EVar("a"), EVar("b")])]),
    ]);
    expect(dispatchedSatSymbolic(specHS, prog)).toEqual({ $tag: "Just", _0: false });
  });

  it("read(k)==1 ∧ read(k)==2 ⇒ Just false (one read, two constants — lit conflict)", () => {
    const prog = ECall("and", [ECall("eq", [read("k"), ELit(1)]), ECall("eq", [read("k"), ELit(2)])]);
    expect(dispatchedSatSymbolic(specHS, prog)).toEqual({ $tag: "Just", _0: false });
  });

  it("a WRITE site anywhere ⇒ Nothing (the gate refuses to model past a write)", () => {
    const base = ECall("and", [ECall("eq", [read("k"), ELit(1)]), ECall("eq", [read("k"), ELit(2)])]);
    const withWrite = ECall("and", [base, ECall("eq", [write("k"), ELit(0)])]);
    expect((dispatchedSatSymbolic(specHS, withWrite) as MaybeV).$tag).toBe("Nothing");
  });

  it("a class NOT declared Symbolic ⇒ Nothing (unmodeled effect — honest)", () => {
    const prog = ECall("and", [ECall("eq", [read("k"), ELit(1)]), ECall("eq", [read("k"), ELit(2)])]);
    expect((dispatchedSatSymbolic([], prog) as MaybeV).$tag).toBe("Nothing"); // empty spec
    // a spec for a DIFFERENT class also fails the gate.
    expect(
      (dispatchedSatSymbolic([{ effectClass: "HasCryptoRandom", reads: ["nextNumber"] }], prog) as MaybeV).$tag,
    ).toBe("Nothing");
  });

  it("a genuinely-satisfiable read predicate ⇒ Nothing (never Just true — finite-domain honesty)", () => {
    // read(a)==1 ∧ read(b)==2 with a,b unconstrained ⇒ EUF-consistent ⇒ Nothing.
    const prog = ECall("and", [
      ECall("eq", [ECall(GET, [EVar("a")]), ELit(1)]),
      ECall("eq", [ECall(GET, [EVar("b")]), ELit(2)]),
    ]);
    expect((dispatchedSatSymbolic(specHS, prog) as MaybeV).$tag).toBe("Nothing");
  });

  it("the ambient decideEmpty STILL fences the same SeWhere to Nothing (no memory model)", () => {
    // `eufDecideWhere` defensively fences ALL `$effect:` heads — satSymbolic is the
    // LAWFUL caller that lifts that fence; the decider itself is UNCHANGED.
    const prog = ECall("and", [ECall("eq", [read("k"), ELit(1)]), ECall("eq", [read("k"), ELit(2)])]);
    expect(
      (dispatchEngineBodyWithDeciderCtx("engine:setAlgebraDecideEmpty", [SeWhere(prog)]) as MaybeV).$tag,
    ).toBe("Nothing");
    // but satSymbolic (the lawful gate) refutes it.
    expect(dispatchedSatSymbolic(specHS, prog)).toEqual({ $tag: "Just", _0: false });
  });
});

// ---------------------------------------------------------------------------
// §4 detailed face — { residual, mintTable } (the fork-driver / Nelson-Oppen currency)
// ---------------------------------------------------------------------------

describe("symbolizeSharedDetailed — the { residual, mintTable } face", () => {
  it("produces the value-numbered residual + a mintTable mapping each shared var to its read", () => {
    const prog = ECall("and", [ECall("eq", [read("k"), ELit(42)]), ECall("gt", [read("k"), ELit(40)])]);
    const out = dispatchedSymbolizeSharedDetailed(specHS, prog) as {
      residual: unknown;
      mintTable: Array<{ varName: string; typeName: string; methodName: string; argTerms: unknown[] }>;
    };
    expect(out.mintTable.length).toBe(1); // one shared read
    const row = out.mintTable[0]!;
    expect(row.varName).toBe("?sym:HasStateIO:getInstance:0");
    expect(row.typeName).toBe("HasStateIO");
    expect(row.methodName).toBe("getInstance");
    expect(row.argTerms).toEqual([ELit("k")]);
  });
});

// ---------------------------------------------------------------------------
// Scope resolution — the `Symbolic` scoped-dispatch fact (block + global)
// ---------------------------------------------------------------------------

describe("scoped faces — resolve `Symbolic` instances (block `_dictStack` + global registry)", () => {
  const prog = ECall("and", [ECall("eq", [read("k"), ELit(42)]), ECall("gt", [read("k"), ELit(40)])]);
  const refuteProg = ECall("and", [ECall("eq", [read("k"), ELit(1)]), ECall("eq", [read("k"), ELit(2)])]);

  it("NOT in scope ⇒ explicit-arg behavior unchanged (per-site ⇒ Nothing)", () => {
    // no Symbolic instance anywhere ⇒ empty spec ⇒ per-site mint ⇒ two vars ⇒ Nothing.
    expect((dispatchedSolveSymbolicScoped(prog) as MaybeV).$tag).toBe("Nothing");
    expect((dispatchedSatSymbolicScoped(refuteProg) as MaybeV).$tag).toBe("Nothing");
  });

  it("an OWNED Symbolic instance is resolved under its own account's frame ⇒ witness / refute engage", () => {
    // ⚠ rights R3a — THE ROW IS ACCOUNT-OWNED AND THE CALL CARRIES THE FRAME.
    // `removeInstance` is owner-scoped now, so a test cannot plant a GLOBAL row
    // in the shared registry and take it back out again; and the roster read
    // (`resolveSymbolicSpec`) is fenced to the repository for a ctx with no
    // account. Both halves move together: the row is owned by a fixture
    // account, the scoped call is made under that account's frame, and cleanup
    // names the same owner. That is also a stronger test than the old one — it
    // shows the roster is SELECTED by ownership, not merely enumerated.
    const frame = accountDispatchFrame(R3A_ACCOUNT) as never;
    dispatchRegistry.addInstance({
      typeName: "Symbolic",
      args: ["HasStateIO"],
      methods: { reads: ["getInstance"] },
      scope: { kind: "account", accountId: R3A_ACCOUNT },
    });
    try {
      expect(dispatchedSolveSymbolicScoped(prog, frame)).toEqual({ $tag: "Just", _0: 42 });
      expect(dispatchedSatSymbolicScoped(refuteProg, frame)).toEqual({ $tag: "Just", _0: false });
      // ⚠ AND ANOTHER ACCOUNT DOES NOT SEE IT. Raw, this roster dumped every
      // persisted `Symbolic` row for every caller — executed during the design
      // review as a B-owned effect class read under A's authority.
      const other = accountDispatchFrame(R3A_OTHER_ACCOUNT) as never;
      expect((dispatchedSolveSymbolicScoped(prog, other) as MaybeV).$tag).toBe("Nothing");
    } finally {
      dispatchRegistry.removeInstance("Symbolic", "HasStateIO", R3A_ACCOUNT);
    }
    // removed again ⇒ back to not-in-scope.
    expect((dispatchedSolveSymbolicScoped(prog, frame) as MaybeV).$tag).toBe("Nothing");
  });

  it("a BLOCK-scope `Symbolic` frame on `ctx._dictStack` is resolved (innermost wins)", () => {
    const ctx = {
      _dictStack: [{ typeName: "Symbolic", args: ["HasStateIO"], methods: { reads: ["getInstance"] } }],
    } as never;
    expect(dispatchedSatSymbolicScoped(refuteProg, ctx)).toEqual({ $tag: "Just", _0: false });
    // WITHOUT the ctx frame ⇒ not in scope ⇒ Nothing.
    expect((dispatchedSatSymbolicScoped(refuteProg) as MaybeV).$tag).toBe("Nothing");
  });
});
