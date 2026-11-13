// ---------------------------------------------------------------------------
// modules-as-values Phase 2d — the runtime List carrier is OUTSIDE the
// membership judgment (tcb-ledger row `mem.ctor`).
//
// A List value runs as a host array (`opaque "array" List a`), but runtime
// pattern matching never reads an array as `Nil` or `Cons`: with
// `f = \x -> case x of Nil -> 1; _ -> "bad"`, `f Nil` is 1 and `f []` is "bad".
// The checker treats a matching constructor pattern as certain, so the arrow
// face may certify `f ∈ Nil -> {1}` over tagged values; a membership face that
// ALSO said `[] ∈ Nil` would certify `f [] ∈ {1}` against execution. Until
// pattern matching and every compiler read the List host carrier, the
// constructor face ABSTAINS on a host array against a constructor set an array
// could represent (the names Nil and Cons, and the anonymous record former
// ""), and still refutes it against every other constructor name. Pins:
//   (1) `List Int` folded (`μv. Nil | Cons {head: Int, tail: v}`) and unfolded
//       once give Nothing on every array, members and non-members alike: the
//       two readings agree;
//   (2) complement and difference therefore abstain on arrays, never a
//       definite; a scalar is still decided under ¬ and ∖;
//   (3) the canonical tagged cons form is decided exactly as at HEAD; a tagged
//       cons whose tail is an array abstains unless a field refutes it;
//   (4) an array against any other constructor name is Just false (a record
//       constructor such as Point, a same-shaped μ spelled Leaf | Node, a Box
//       whose field refutes the array), folded and unfolded;
//   (5) the anonymous record former abstains on arrays, record types included;
//       scalars other than arrays stay Just false against Nil, Cons and "";
//   (6) the constructor face's order is unchanged: the judgment fence and the
//       coercing constructors abstain before the array rule;
//   (7) the counterexample: `f ∈ Nil -> {1}` is still certified over tagged
//       values and `f []` is "bad" at run time, but nothing certifies `[]` as
//       a value of Nil (contains, the checker's singleton face, a match over a
//       literal `[]`), so nothing certifies `f [] ∈ {1}`.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "bun:test";
import { contains } from "./set-algebra";
import { typeToSetExpr } from "./fenel-check";
import { parseFenel } from "./index";
import { parse } from "./fenel-parser";
import { evaluate, invokeCallable } from "./json-logic";
import { dispatchEngineBodyWithDeciderCtx } from "./engine-bodies-dispatch";
import { getSystemRegistry } from "./system-registry";
import type { EvaluateContext } from "./json-logic";
import type { FenelType, SetExpr } from "./types";

const JUST_TRUE = { $tag: "Just", _0: true } as const;
const JUST_FALSE = { $tag: "Just", _0: false } as const;
const NOTHING = { $tag: "Nothing" } as const;

/** The parameter type the parser gives `T` in `f : T -> Int`. */
function parsedType(source: string): FenelType {
  const parsed = parseFenel(`f : ${source} -> Int\nf x = 1`) as unknown as { program: Array<Record<string, unknown>> };
  const signature = parsed.program.find((item) => "type_sig" in item) as
    | { type_sig: { type: { $arrow: { params: Array<{ type: FenelType }> } } } }
    | undefined;
  if (!signature) throw new Error(`no signature parsed for ${source}`);
  return signature.type_sig.type.$arrow.params[0]!.type;
}

type Node = Record<string, unknown>;
type Mu = { $tag: "SeMu"; var: string; body: { $tag: "SeUnion"; branches: Node[] } };

/** Capture-aware `body[v := whole]` over plain SetExpr data: an inner μ that
 * rebinds `v` is left alone. */
function substitute(node: unknown, v: string, whole: unknown): unknown {
  if (Array.isArray(node)) return node.map((item) => substitute(item, v, whole));
  if (node === null || typeof node !== "object") return node;
  const record = node as Node;
  if (record.$tag === "SeRef" && record.handle === v) return whole;
  if (record.$tag === "SeMu" && record.var === v) return record;
  return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, substitute(child, v, whole)]));
}
/** The same set, unrolled once: `F[v := μv.F]`. */
const unfold = (mu: Mu): SetExpr => substitute(mu.body, mu.var, mu) as SetExpr;
const complement = (inner: SetExpr): SetExpr => ({ $tag: "SeComplement", inner } as unknown as SetExpr);
const difference = (left: SetExpr, right: SetExpr): SetExpr =>
  ({ $tag: "SeDiff", left, right } as unknown as SetExpr);
const ctor = (name: string, fields: unknown[] = []): SetExpr =>
  ({ $tag: "SeCtor", ctor: name, fields } as unknown as SetExpr);
const namedKey = (ordinal: number) => ({
  $tag: "NamedField",
  ref: { $ref: `7a1c2d3e-0000-4000-8000-${String(ordinal).padStart(12, "0")}` },
});
const field = (ordinal: number, wireName: string, set: unknown) =>
  ({ $tag: "SetCtorField", key: namedKey(ordinal), wireName, set });

describe("mem.ctor — the List host carrier is outside the constructor face", () => {
  const registry = getSystemRegistry();
  const ctx = registry.evaluateContext() as EvaluateContext;
  const member = (set: SetExpr, value: unknown) => contains(set, value, null, undefined, ctx);

  const listOfInt = typeToSetExpr(parsedType("List Int")) as unknown as Mu;
  const listOfListOfInt = typeToSetExpr(parsedType("List (List Int)")) as unknown as Mu;
  const intSet = typeToSetExpr(parsedType("Int")) as unknown;
  const cons = listOfInt.body.branches.find((branch) => branch.ctor === "Cons")!;
  const nil = listOfInt.body.branches.find((branch) => branch.ctor === "Nil")!;
  const consFields = cons.fields as Node[];
  const withBranches = (branches: Node[]): SetExpr =>
    ({ ...listOfInt, body: { ...listOfInt.body, branches } } as unknown as SetExpr);
  const arrays: unknown[] = [[], [1], [1, 2, 3], [1, "a"], [1, 2.5], ["a"], [[1]]];

  it("(1) folded and unfolded List sets both abstain on every array", () => {
    expect(listOfInt.$tag).toBe("SeMu");
    const folded = listOfInt as unknown as SetExpr;
    const unfolded = unfold(listOfInt);
    for (const value of arrays) {
      expect(member(folded, value), JSON.stringify(value)).toEqual(NOTHING);
      expect(member(unfolded, value), `unfolded ${JSON.stringify(value)}`).toEqual(NOTHING);
    }
    const nestedFolded = listOfListOfInt as unknown as SetExpr;
    const nestedUnfolded = unfold(listOfListOfInt);
    for (const value of [[[1], [], [2, 3]], [[]], [[1], ["x"]], [1]]) {
      expect(member(nestedFolded, value), JSON.stringify(value)).toEqual(NOTHING);
      expect(member(nestedUnfolded, value), `unfolded ${JSON.stringify(value)}`).toEqual(NOTHING);
    }
  }, 300_000);

  it("(2) complement and difference abstain on arrays, never a definite", () => {
    for (const set of [listOfInt as unknown as SetExpr, unfold(listOfInt)]) {
      const nonEmpty = difference(set, nil as unknown as SetExpr);
      const outside = difference({ $tag: "SeAll" } as unknown as SetExpr, set);
      for (const value of [[1, 2], [], [1, "a"]]) {
        expect(member(complement(set), value), `¬ ${JSON.stringify(value)}`).toEqual(NOTHING);
        expect(member(nonEmpty, value), `∖Nil ${JSON.stringify(value)}`).toEqual(NOTHING);
        expect(member(outside, value), `⊤∖ ${JSON.stringify(value)}`).toEqual(NOTHING);
      }
      // A scalar is no List, decided under every Boolean context.
      expect(member(set, "x")).toEqual(JUST_FALSE);
      expect(member(complement(set), "x")).toEqual(JUST_TRUE);
      expect(member(outside, "x")).toEqual(JUST_TRUE);
      expect(member(nonEmpty, 5)).toEqual(JUST_FALSE);
    }
    // The Nil and Cons constructor sets alone abstain on arrays too.
    const consOfInt = substitute(cons, listOfInt.var, listOfInt) as SetExpr;
    for (const value of [[1, 2], []]) {
      expect(member(consOfInt, value)).toEqual(NOTHING);
      expect(member(complement(consOfInt), value)).toEqual(NOTHING);
      expect(member(nil as unknown as SetExpr, value)).toEqual(NOTHING);
      expect(member(complement(nil as unknown as SetExpr), value)).toEqual(NOTHING);
    }
  }, 300_000);

  it("(3) the canonical tagged cons form is decided exactly as at HEAD", () => {
    const tagNil = { $tag: "Nil" };
    const one = { $tag: "Cons", head: 1, tail: tagNil };
    const two = { $tag: "Cons", head: 1, tail: { $tag: "Cons", head: 2, tail: tagNil } };
    for (const set of [listOfInt as unknown as SetExpr, unfold(listOfInt)]) {
      expect(member(set, tagNil)).toEqual(JUST_TRUE);
      expect(member(set, one)).toEqual(JUST_TRUE);
      expect(member(set, two)).toEqual(JUST_TRUE);
      expect(member(set, { $tag: "Cons", head: "a", tail: tagNil })).toEqual(JUST_FALSE);
      expect(member(set, { $tag: "Cons", head: 1, tail: { $tag: "Cons", head: 2.5, tail: tagNil } })).toEqual(JUST_FALSE);
      expect(member(set, { $tag: "Cons", head: 1 })).toEqual(JUST_FALSE);
      expect(member(set, { $tag: "Leaf" })).toEqual(JUST_FALSE);
      expect(member(set, 5)).toEqual(JUST_FALSE);
      expect(member(set, "12")).toEqual(JUST_FALSE);
      expect(member(complement(set), one)).toEqual(JUST_FALSE);
      expect(member(complement(set), { $tag: "Cons", head: "a", tail: tagNil })).toEqual(JUST_TRUE);
      // A tagged cons whose tail is an array: the tail abstains, so the whole
      // abstains, unless another field refutes the value (the Tri fold).
      expect(member(set, { $tag: "Cons", head: 1, tail: [2, 3] })).toEqual(NOTHING);
      expect(member(set, { $tag: "Cons", head: "a", tail: [2, 3] })).toEqual(JUST_FALSE);
    }
  }, 300_000);

  it("(4) an array against any other constructor name is Just false", () => {
    // A record constructor, nullary or with fields.
    expect(member(ctor("Point"), [])).toEqual(JUST_FALSE);
    expect(member(ctor("Point", [field(1, "x", intSet)]), [1])).toEqual(JUST_FALSE);
    expect(member(ctor("Just", [{ $tag: "SetCtorField", key: { $tag: "PositionalField", index: 0 }, wireName: "_0", set: intSet }]), [1]))
      .toEqual(JUST_FALSE);
    expect(member(complement(ctor("Point")), [1, 2])).toEqual(JUST_TRUE);
    // The List shape under other constructor names: `μv. Leaf | Node {head: Int, tail: v}`.
    const renamed = withBranches([{ ...nil, ctor: "Leaf" }, { ...cons, ctor: "Node" }]);
    for (const set of [renamed, unfold(renamed as unknown as Mu)]) {
      expect(member(set, [1, 2])).toEqual(JUST_FALSE);
      expect(member(set, [])).toEqual(JUST_FALSE);
    }
    // A field that holds an array: refuted by a named constructor, abstained
    // on by the List set.
    const boxOf = (inner: unknown) => ctor("Box", [field(2, "content", inner)]);
    expect(member(boxOf(ctor("Point")), { $tag: "Box", content: [1] })).toEqual(JUST_FALSE);
    expect(member(boxOf(listOfInt), { $tag: "Box", content: [1] })).toEqual(NOTHING);
    expect(member(boxOf(listOfInt), { $tag: "Box", content: { $tag: "Nil" } })).toEqual(JUST_TRUE);
  }, 300_000);

  it("(5) the anonymous record former abstains on arrays; other scalars stay refuted", () => {
    const anyRecord = ctor("");
    const withName = ctor("", [field(3, "name", { $tag: "SeAll" })]);
    for (const value of [[], [1]]) {
      expect(member(anyRecord, value)).toEqual(NOTHING);
      expect(member(withName, value)).toEqual(NOTHING);
    }
    expect(member(anyRecord, { name: "x" })).toEqual(JUST_TRUE);
    expect(member(withName, {})).toEqual(JUST_FALSE);
    // A record type projects to the anonymous former.
    const recordType = typeToSetExpr({
      $record: {
        fields: [{ name: "name", key: namedKey(5), label: NOTHING, type: { $ref: "String" }, meta: {} }],
      },
    } as unknown as FenelType) as unknown as SetExpr;
    expect((recordType as unknown as Node).ctor).toBe("");
    expect(member(recordType, ["x"])).toEqual(NOTHING);
    expect(member(recordType, "x")).toEqual(JUST_FALSE);
    expect(member(recordType, { name: "x" })).toEqual(JUST_TRUE);
    // Scalars other than arrays are refuted by Nil, Cons and "" alike.
    for (const set of [nil as unknown as SetExpr, substitute(cons, listOfInt.var, listOfInt) as SetExpr, anyRecord]) {
      for (const scalar of [5, "x", true]) {
        expect(member(set, scalar), `${JSON.stringify(set).slice(0, 40)} ∋ ${JSON.stringify(scalar)}`).toEqual(JUST_FALSE);
      }
    }
  }, 300_000);

  it("(6) the fence and the coercing constructors still come first", () => {
    const fenced = {
      ...cons,
      fields: consFields.map((f) =>
        f.wireName === "tail" ? { ...f, key: { $tag: "NamedField", ref: { $ref: "" } } } : f),
    };
    expect(member(fenced as unknown as SetExpr, [1])).toEqual(NOTHING);
    expect(member(withBranches([nil, fenced]), [1])).toEqual(NOTHING);
    expect(member(withBranches([nil, fenced]), [])).toEqual(NOTHING);
    // A fenced named constructor abstains on an array as on anything else.
    const fencedPoint = ctor("Point", [{ ...field(4, "x", intSet), key: { $tag: "NamedField", ref: { $ref: "" } } }]);
    expect(member(fencedPoint, [1])).toEqual(NOTHING);
    // True / False are coercing: Nothing whatever the value.
    expect(member(ctor("True"), [])).toEqual(NOTHING);
  }, 300_000);

  it("(7) nothing certifies f [] ∈ {1} for f = \\x -> case x of Nil -> 1; _ -> \"bad\"", () => {
    const source = String.raw`\x -> case x of
  Nil -> 1
  _ -> "bad"`;
    const f = evaluate(parse(source) as never, {}, ctx);
    // Execution: the Nil pattern matches the tagged Nil, never the array.
    expect(invokeCallable(f, [{ $tag: "Nil" }], ctx)).toBe(1);
    expect(invokeCallable(f, [[]], ctx)).toBe("bad");
    // The arrow face certifies f over the canonical (tagged) domain of Nil.
    const one = { $tag: "SeEnum", values: [1] };
    const nilToOne = {
      $tag: "SeArrow",
      params: [{ $tag: "SetArrowParam", key: namedKey(40), wireName: "p0", set: nil }],
      returns: one,
    } as unknown as SetExpr;
    expect(member(nilToOne, f)).toEqual(JUST_TRUE);
    // …so `[]` must not be a certified value of Nil, by any face.
    expect(member(nil as unknown as SetExpr, [])).toEqual(NOTHING);
    expect(member(listOfInt as unknown as SetExpr, [])).toEqual(NOTHING);
    const check = (expr: unknown, env: unknown[], goal: unknown) =>
      dispatchEngineBodyWithDeciderCtx("engine:checkExpr", [expr, env, goal]);
    expect(check({ $tag: "ELit", value: [] }, [], nil)).toEqual(NOTHING);
    const arms = [
      { pattern: { $tag: "PatConstruct", ctor: "Nil", args: [], fields: [] }, body: { $tag: "ELit", value: 1 } },
      { pattern: { $tag: "PatLit", value: "_" }, body: { $tag: "ELit", value: "bad" } },
    ];
    expect(check({ $tag: "EMatch", scrutinee: { $tag: "ELit", value: [] }, arms }, [], one)).toEqual(NOTHING);
    // The same match over a variable KNOWN to be a Nil is certain: the
    // canonical domain is decided, only the host carrier abstains.
    expect(check({ $tag: "EMatch", scrutinee: { $tag: "EVar", name: "x" }, arms }, [{ name: "x", set: nil }], one))
      .toEqual(JUST_TRUE);
  }, 300_000);
});
