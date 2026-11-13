// decide-substrate Phase 8μ.1b — `SeMu`, the fixpoint SET former: `substSet`
// (capture-avoiding) + `sePositive` (the Park soundness side-condition) +
// `seMuGuarded` (the productivity/termination condition) + the three NON-kernel
// μ faces (emptiness / inhabitation / value-membership) + the knot-tying
// `typeToSetExpr` projection (the canonical NAMED-self-reference — the List
// idiom — projects to a real SeMu at marshal time; no decide-time registry
// seam). Design: `design/mu-induction.md` §0–§4. Brief:
// `workstreams/decide-substrate/briefs/phase-8mu-1b-semu.md`.
//
// Also pins the 8μ.1a landmine FIXED (§0.2 of the brief): pre-1b the projected
// `⟦List Int⟧` carried a bare `SeRef "List"` tail whose membership rode the
// closed-world `namedMember` (conservative-false-on-unknown) ⇒ a DEFINITE
// wrong `Just false` for real list values. Under the SeMu knot the tail is
// substituted before any membership question can reach `namedMember`.

import { describe, it, expect } from "vitest";
import { contains, isSubset, decideEmpty } from "./set-algebra";
import { dispatchEngineBody, dispatchedInhabit } from "./engine-bodies-dispatch";
import { typeToSetExpr } from "./fenel-check";
import { List } from "./type-foundation";
import { repositoryIdentityLock } from "./repository-identity-manifest";
import type { SetExpr } from "./types";

function mb(m: unknown): "true" | "false" | "nothing" {
  const x = m as { $tag?: string; _0?: unknown; value?: unknown };
  if (x?.$tag === "Just") return (x._0 ?? x.value) ? "true" : "false";
  return "nothing";
}
function mj(m: unknown): unknown {
  const x = m as { $tag?: string; _0?: unknown; value?: unknown };
  return x?.$tag === "Just" ? (x._0 ?? x.value) : undefined;
}

const ctor = (c: string, fields: unknown[]): SetExpr =>
  ({ $tag: "SeCtor", ctor: c, fields } as unknown as SetExpr);
const MU_FIELD_IDS: Record<string, string> = {
  head: "61000000-0000-4000-8000-000000000001",
  tail: "61000000-0000-4000-8000-000000000002",
};
const fld = (wireName: string, set: SetExpr) => ({
  $tag: "SetCtorField",
  key: wireName === "_0"
    ? { $tag: "PositionalField", index: 0 }
    : { $tag: "NamedField", ref: { $ref: MU_FIELD_IDS[wireName] } },
  wireName,
  set,
});
const enumS = (...vs: unknown[]): SetExpr => ({ $tag: "SeEnum", values: vs } as unknown as SetExpr);
const ref = (h: string): SetExpr => ({ $tag: "SeRef", handle: h } as unknown as SetExpr);
const union = (...bs: SetExpr[]): SetExpr => ({ $tag: "SeUnion", branches: bs } as unknown as SetExpr);
const mu = (v: string, body: SetExpr): SetExpr => ({ $tag: "SeMu", var: v, body } as unknown as SetExpr);
const compl = (inner: SetExpr): SetExpr => ({ $tag: "SeComplement", inner } as unknown as SetExpr);
const NONE: SetExpr = { $tag: "SeNone" } as unknown as SetExpr;

// μX. Nil | Cons{head: {1,2}, tail: X} — the canonical guarded positive body.
const listBody = union(ctor("Nil", []), ctor("Cons", [fld("head", enumS(1, 2)), fld("tail", ref("X"))]));
const muList = mu("X", listBody);

describe("substSet — the capture-avoiding leaf-replace", () => {
  it("replaces free SeRef occurrences of the var", () => {
    const out = dispatchEngineBody("engine:substSet", ["X", NONE, listBody]);
    const s = JSON.stringify(out);
    expect(s).toContain("SeNone");
    expect(s).not.toContain("SeRef");
  });
  it("an inner same-var SeMu SHADOWS (descent stops)", () => {
    const shadowed = mu("X", ref("X"));
    const out = dispatchEngineBody("engine:substSet", ["X", NONE, shadowed]);
    expect(out).toEqual(shadowed);
  });
  it("a colliding inner binder is FRESHENED (no capture)", () => {
    // subst v := (SeRef Y) into μY.(v ∪ Y): naive substitution would capture
    // the substituted Y under the inner binder. The binder freshens to Y'.
    const body = mu("Y", union(ref("v"), ref("Y")));
    const out = dispatchEngineBody("engine:substSet", ["v", ref("Y"), body]) as {
      var: string;
      body: { branches: { handle: string }[] };
    };
    expect(out.var).toBe("Y'");
    // the substituted occurrence stays the FREE Y; the bound one is renamed.
    expect(out.body.branches.map((b) => b.handle)).toEqual(["Y", "Y'"]);
  });
});

describe("sePositive / seMuGuarded / seMuSupported — the face gates", () => {
  it("an ADT body (union of ctors) is positive and guarded", () => {
    expect(dispatchEngineBody("engine:sePositive", ["X", listBody])).toBe(true);
    expect(dispatchEngineBody("engine:seMuGuarded", ["X", listBody])).toBe(true);
  });
  it("a var under SeComplement is NOT positive (Park would be unsound)", () => {
    expect(dispatchEngineBody("engine:sePositive", ["X", compl(ref("X"))])).toBe(false);
  });
  it("a NAKED occurrence is unguarded (membership would not terminate)", () => {
    expect(dispatchEngineBody("engine:seMuGuarded", ["X", union(ref("X"), enumS(1))])).toBe(false);
  });
});

describe("SeMu — emptiness (empty(μv.F) ⟺ empty(F[v:=∅]))", () => {
  it("μX.X is empty (no base case at all)", () => {
    expect(mb(decideEmpty(mu("X", ref("X"))))).toBe("true");
  });
  it("a List-shaped μ is nonempty (the nullary Nil — the SeCtor arm composes)", () => {
    expect(mb(decideEmpty(muList))).toBe("false");
  });
  it("μX.Cons{tail:X} with NO base case is empty (the empty factor collapses every iterate)", () => {
    expect(mb(decideEmpty(mu("X", ctor("Cons", [fld("tail", ref("X"))]))))).toBe("true");
  });
  it("a non-positive body degrades to Nothing", () => {
    expect(mb(decideEmpty(mu("X", compl(ref("X")))))).toBe("nothing");
  });
});

describe("SeMu — inhabitation (fuel-bounded Kleene iteration)", () => {
  it("a List-shaped μ witnesses Nil at the first iterate", () => {
    expect(mj(dispatchedInhabit(muList))).toEqual({ $tag: "Nil" });
  });
  it("μX.X has no witness", () => {
    expect(mb(dispatchedInhabit(mu("X", ref("X"))))).toBe("nothing");
  });
  it("a nested SeCtor witness assembles the field values", () => {
    const j = ctor("Just", [fld("_0", enumS(7))]);
    expect(mj(dispatchedInhabit(j))).toEqual({ $tag: "Just", _0: 7 });
  });
});

describe("SeMu — value-membership (unroll-once + guarded structural descent)", () => {
  const nil = { $tag: "Nil" };
  it("Nil and a well-formed list are members", () => {
    expect(mb(contains(muList, nil, null))).toBe("true");
    expect(mb(contains(muList, { $tag: "Cons", head: 1, tail: { $tag: "Cons", head: 2, tail: nil } }, null))).toBe("true");
  });
  it("an out-of-set field refutes", () => {
    expect(mb(contains(muList, { $tag: "Cons", head: 3, tail: nil }, null))).toBe("false");
  });
  it("an UNGUARDED body degrades to Nothing (terminates — the μX.(X ∪ {1}) guard)", () => {
    expect(mb(contains(mu("X", union(ref("X"), enumS(1))), 2, null))).toBe("nothing");
  });
});

describe("SeMu — the knot-tying projection e2e (the canonical named-self-reference)", () => {
  const listInt = () => typeToSetExpr(List({ $ref: "Int" }));

  it("⟦List Int⟧ projects to a SeMu (the $opaque wrapper's own name ties the knot)", () => {
    const proj = listInt() as {
      $tag?: string;
      var?: string;
      body?: { branches?: Array<{ ctor?: string; fields?: Array<{ wireName?: string; key?: { ref?: { $ref?: string } } }> }> };
    };
    expect(proj.$tag).toBe("SeMu");
    expect(proj.var).toBe("List");
    const cons = proj.body?.branches?.find((branch) => branch.ctor === "Cons");
    const lock = repositoryIdentityLock();
    expect(cons?.fields?.map((field) => [field.wireName, field.key?.ref?.$ref])).toEqual([
      ["head", lock.get("field:type%3Asystem%3AList/case%3ACons/named%3Ahead")],
      ["tail", lock.get("field:type%3Asystem%3AList/case%3ACons/named%3Atail")],
    ]);
  });
  it("⟦List Int⟧ is decidably nonempty and witnesses Nil", () => {
    expect(mb(decideEmpty(listInt()))).toBe("false");
    expect(mj(dispatchedInhabit(listInt()))).toEqual({ $tag: "Nil" });
  });
  it("the 8μ.1a landmine is FIXED: a real list value IS a member (was a wrong Just false via namedMember)", () => {
    expect(mb(contains(listInt(), { $tag: "Cons", head: 5, tail: { $tag: "Nil" } }, null))).toBe("true");
  });
  it("a wrong-element list refutes", () => {
    expect(mb(contains(listInt(), { $tag: "Cons", head: "x", tail: { $tag: "Nil" } }, null))).toBe("false");
  });
  it("reflexivity: ⟦List Int⟧ ⊆ ⟦List Int⟧ (the deepEq tail rule; the covariant case is 8μ.2 Park)", () => {
    expect(mb(isSubset(listInt(), listInt()))).toBe("true");
  });
});
