// signature-substrate Phase A — the fold-arrow combinators (arrow-algebra.fenel).
// Brief: workstreams/signature-substrate/briefs/phase-a-arrow-value-algebra.md.
//
// Four groups (the brief's verification matrix):
//   1. The fold-arrow acceptance (design/signatures-and-contracts.md §11.8):
//      `witnessOf (typeToSetExpr (foldTypes [Int, Int]))` is a kernel-certified
//      identity lambda, routed exactly as the editor typed-hole routes it
//      (FunctionSpecEditor.suggestBody: `$arrow` goal → typeToSetExpr →
//      witnessOf → reassemble `{fn: […]}` → print) — plus the parity pin that
//      the Fenel-computed Tt-face arrow projects to the SAME SetExpr as the
//      editor's marshalled `$arrow` envelope for the equivalent signature.
//   2. The curry/uncurry normal-form round-trips (curryType∘uncurryType ≡
//      curryType, uncurryType∘curryType ≡ uncurryType), incl. a mixed-arity
//      `(A,B) -> ((C) -> D)` fixture and a marshalled NamedField-param fixture,
//      plus the entry-check-#1 pin: every computed presentation passes the
//      field-identity P3 container validator (identity-total).
//   3. `typeToSetExpr (foldTypes […])` = the expected nested SeArrow chain.
//   4. The combinator floor: `foldTypes []` ⇒ Nothing; singleton ⇒ identity;
//      ordinal positional identity on computed params; peelArrow/arity/
//      paramTypes/finalReturn; and the requires pin — the combinators never
//      emit a requires-carrying arrow (TtArrow has nowhere to put one).
//
// All combinator calls go through `dispatchEngineBody("engine:<fn>", …)` — the
// same lazy-require boundary every engine-body consumer rides. Inputs are
// TraversalType values from `marshalTraversalType` (the one `$`-key gateway);
// computed values come back as plain `$tag` records.

import { describe, it, expect } from "bun:test";
import {
  dispatchEngineBody,
  marshalTraversalType,
  print,
} from "./engine-bodies-dispatch";
import { witnessOf } from "./set-algebra";
import { typeToSetExpr } from "./fenel-check";
import type { FenelType, SetExpr } from "./types";

const INT = { $ref: "Int" };
const STR = { $ref: "String" };

const tt = (t: unknown): unknown => marshalTraversalType(t);
const call = (fn: string, args: unknown[]): unknown =>
  dispatchEngineBody(`engine:${fn}`, args);

type TtArrowValue = {
  $tag: string;
  params: Array<Record<string, unknown>>;
  returns: unknown;
  raw: unknown;
};

function just(m: unknown): unknown {
  expect((m as { $tag?: string }).$tag).toBe("Just");
  return (m as { _0: unknown })._0;
}

describe("fold-arrow acceptance (signatures-and-contracts §11.8)", () => {
  it("witnessOf (typeToSetExpr (foldTypes [Int, Int])) is a kernel-certified identity lambda, printed via the editor's parse-and-emit leg", () => {
    const folded = just(call("foldTypes", [[tt(INT), tt(INT)]]));
    const set = call("typeToSetExpr", [folded]);
    const witness = witnessOf(set as SetExpr) as {
      $tag?: string;
      _0?: { __fenelFn?: boolean; params?: string[]; body?: unknown };
    };
    expect(witness.$tag).toBe("Just");
    const closure = witness._0!;
    expect(closure.__fenelFn).toBe(true);
    expect(closure.params?.length).toBe(1);
    // the identity witness: body = the sole param, whatever the synthesizer named it
    expect(closure.body).toEqual({ var: closure.params![0] });
    // the editor's last leg — reassemble the flat lambda and print (the SAME
    // text FunctionSpecEditor.suggestBody seeds through onBodyChange)
    const p = closure.params![0];
    const printed = print({ fn: [...closure.params!, closure.body] } as never);
    expect(printed).toBe(`\\${p} -> ${p}`);
  });

  it("the computed Tt-face arrow projects to the SAME SetExpr as the editor's marshalled $arrow goal", () => {
    const folded = just(call("foldTypes", [[tt(INT), tt(INT)]]));
    const set = call("typeToSetExpr", [folded]);
    // the editor route verbatim: a `$arrow` goal envelope through the public
    // TS wrapper (marshal → engine:typeToSetExpr → SetExpr canonicalization)
    const goal = {
      $arrow: {
        params: [
          { name: "_0", key: { $tag: "PositionalField", index: 0 }, type: INT },
        ],
        returns: INT,
      },
    };
    const editorSet = typeToSetExpr(goal as unknown as FenelType);
    expect(set).toEqual(editorSet as unknown);
  });
});

describe("curry/uncurry normal-form round-trips", () => {
  it("mixed-arity (A,B) -> ((C) -> D): curry∘uncurry ≡ curry, uncurry∘curry ≡ uncurry, both idempotent", () => {
    const inner = call("mkArrow", [[tt(INT)], tt(STR)]); // (C) -> D
    const mixed = call("mkArrow", [[tt(INT), tt(STR)], inner]); // (A,B) -> ((C) -> D)
    const flat = call("uncurryType", [mixed]) as TtArrowValue;
    const curried = call("curryType", [mixed]);
    expect(call("curryType", [flat])).toEqual(curried);
    expect(call("uncurryType", [curried])).toEqual(flat);
    // the flat spine: three params, ordinal container-relative identity
    expect(flat.params.length).toBe(3);
    expect(flat.params.map((p) => p.wireName)).toEqual(["_0", "_1", "_2"]);
    expect(flat.params.map((p) => p.semanticKey)).toEqual([
      { $tag: "PositionalField", index: 0 },
      { $tag: "PositionalField", index: 1 },
      { $tag: "PositionalField", index: 2 },
    ]);
    // normal forms are fixed points
    expect(call("uncurryType", [flat])).toEqual(flat);
    expect(call("curryType", [curried])).toEqual(curried);
  });

  it("every computed presentation is identity-total under the P3 container validator", () => {
    const inner = call("mkArrow", [[tt(INT)], tt(STR)]);
    const mixed = call("mkArrow", [[tt(INT), tt(STR)], inner]);
    for (const v of [
      mixed,
      call("uncurryType", [mixed]),
      call("curryType", [mixed]),
      just(call("foldTypes", [[tt(INT), tt(STR), tt(INT)]])),
    ]) {
      expect(call("traversalSemanticSlotsError", [v])).toEqual({
        $tag: "Nothing",
      });
    }
  });

  it("0-ary arrows: () -> ((A) -> B) flattens through; () -> X is its own curried form", () => {
    // the shipped ttArrowFlatten semantics: a 0-ary outer layer contributes no
    // params, so flatten merges through it when (and only when) the return is
    // itself an arrow — mirrored here so the round-trips stay lawful on the
    // real registry shape (no-arg actions).
    const inner = call("mkArrow", [[tt(INT)], tt(STR)]); // (A) -> B
    const thunked = call("mkArrow", [[], inner]); // () -> ((A) -> B)
    const flat = call("uncurryType", [thunked]) as TtArrowValue;
    expect(flat.params.length).toBe(1);
    expect(call("curryType", [flat])).toEqual(call("curryType", [thunked]));
    expect(call("uncurryType", [call("curryType", [thunked])])).toEqual(flat);
    expect(call("arity", [thunked])).toBe(1);
    // a 0-ary arrow over a NON-arrow return is a fixed point of both presentations
    const bare = call("mkArrow", [[], tt(INT)]) as TtArrowValue; // () -> Int
    expect(call("uncurryType", [bare])).toEqual(bare);
    expect(call("curryType", [bare])).toEqual(bare);
    expect(call("arity", [bare])).toBe(0);
    expect(call("finalReturn", [bare])).toEqual(tt(INT));
  });

  it("higher-order params are domains, not spine: (f: (A)->B, x: A) -> B never respines f", () => {
    const fnParam = call("mkArrow", [[tt(INT)], tt(STR)]); // (A) -> B
    const hof = call("mkArrow", [[fnParam, tt(INT)], tt(STR)]); // ((A)->B, A) -> B
    const flat = call("uncurryType", [hof]) as TtArrowValue;
    const curried = call("curryType", [hof]) as TtArrowValue;
    // the spine reads 2 either way — the param's own arrow is not pulled up
    expect(call("arity", [hof])).toBe(2);
    expect(flat.params.length).toBe(2);
    // the param's inner arrow rides both presentations byte-identical
    expect(flat.params[0]!.type).toEqual(fnParam);
    expect(curried.params[0]!.type).toEqual(fnParam);
    expect(call("paramTypes", [hof])).toEqual([fnParam, tt(INT)]);
    // round-trips still lawful with an arrow-typed domain
    expect(call("curryType", [flat])).toEqual(curried);
    expect(call("uncurryType", [curried])).toEqual(flat);
    expect(call("traversalSemanticSlotsError", [curried])).toEqual({
      $tag: "Nothing",
    });
  });

  it("NamedField params ride re-presentation unchanged (marshalled curried fixture)", () => {
    const ux = "3f2c8a1e-5b4d-4c6e-9a7b-2d1e0f9c8b7a";
    const uy = "8b1d4e2f-9c3a-4f5b-8a6d-0e7c1b2a3d4e";
    const cur = tt({
      $arrow: {
        params: [
          { name: "x", key: { $tag: "NamedField", ref: { $ref: ux } }, type: INT },
        ],
        returns: {
          $arrow: {
            params: [
              { name: "y", key: { $tag: "NamedField", ref: { $ref: uy } }, type: STR },
            ],
            returns: INT,
          },
        },
      },
    });
    const flat = call("uncurryType", [cur]) as TtArrowValue;
    expect(flat.params.length).toBe(2);
    expect(flat.params.map((p) => p.wireName)).toEqual(["x", "y"]);
    expect(flat.params.map((p) => p.semanticKey)).toEqual([
      { $tag: "NamedField", ref: { $ref: ux } },
      { $tag: "NamedField", ref: { $ref: uy } },
    ]);
    expect(call("traversalSemanticSlotsError", [flat])).toEqual({
      $tag: "Nothing",
    });
    // the round-trip laws hold on the authored/named fixture too
    expect(call("curryType", [flat])).toEqual(call("curryType", [cur]));
    expect(call("uncurryType", [call("curryType", [cur])])).toEqual(flat);
  });
});

describe("typeToSetExpr over folded chains", () => {
  it("foldTypes [Int, String, Int] projects to the nested SeArrow chain", () => {
    const folded = just(call("foldTypes", [[tt(INT), tt(STR), tt(INT)]]));
    const set = call("typeToSetExpr", [folded]) as {
      $tag: string;
      params: Array<{ $tag: string; key: unknown; wireName: string; set: unknown }>;
      returns: {
        $tag: string;
        params: Array<{ set: unknown }>;
        returns: unknown;
      };
    };
    const intSet = call("typeToSetExpr", [tt(INT)]);
    const strSet = call("typeToSetExpr", [tt(STR)]);
    expect(set.$tag).toBe("SeArrow");
    expect(set.params.length).toBe(1);
    const outerParam = set.params[0]!;
    expect(outerParam.key).toEqual({ $tag: "PositionalField", index: 0 });
    expect(outerParam.wireName).toBe("_0");
    expect(outerParam.set).toEqual(intSet);
    expect(set.returns.$tag).toBe("SeArrow");
    expect(set.returns.params.length).toBe(1);
    expect(set.returns.params[0]!.set).toEqual(strSet);
    expect(set.returns.returns).toEqual(intSet);
  });
});

describe("the combinator floor", () => {
  it("foldTypes [] is Nothing; the singleton fold is the type itself", () => {
    expect(call("foldTypes", [[]])).toEqual({ $tag: "Nothing" });
    expect(call("foldTypes", [[tt(INT)]])).toEqual({
      $tag: "Just",
      _0: tt(INT),
    });
  });

  it("mkArrow wraps params with the ordinal positional convention (entry-check #1)", () => {
    const arrow = call("mkArrow", [[tt(INT), tt(STR)], tt(INT)]) as TtArrowValue;
    expect(arrow.$tag).toBe("TtArrow");
    expect(arrow.raw).toBe("arrow-algebra:synthetic");
    expect(arrow.params.length).toBe(2);
    const p1 = arrow.params[1]!;
    expect(p1.$tag).toBe("TtArrowParam");
    expect(p1.name).toBe("_1");
    expect(p1.wireName).toBe("_1");
    expect(p1.key).toEqual({ $tag: "PositionalFieldInput", index: 1 });
    expect(p1.semanticKey).toEqual({ $tag: "PositionalField", index: 1 });
    expect(p1.type).toEqual(tt(STR));
  });

  it("the combinators never emit a requires-carrying arrow (there is nowhere to put one)", () => {
    const arrow = call("mkArrow", [[tt(INT)], tt(INT)]) as object;
    expect("requires" in arrow).toBe(false);
    const folded = just(call("foldTypes", [[tt(INT), tt(INT)]])) as object;
    expect("requires" in folded).toBe(false);
    const set = call("typeToSetExpr", [arrow]) as object;
    expect("requires" in set).toBe(false);
    const curried = call("curryType", [
      call("mkArrow", [[tt(INT), tt(STR)], tt(INT)]),
    ]) as object;
    expect("requires" in curried).toBe(false);
  });

  it("peelArrow peels ONE layer, projecting param TYPES; Nothing on non-arrows", () => {
    const inner = call("mkArrow", [[tt(STR)], tt(INT)]);
    const outer = call("mkArrow", [[tt(INT)], inner]);
    const peeled = just(call("peelArrow", [outer])) as {
      params: unknown[];
      returns: unknown;
    };
    expect(peeled.params).toEqual([tt(INT)]);
    expect(peeled.returns).toEqual(inner);
    expect(call("peelArrow", [tt(INT)])).toEqual({ $tag: "Nothing" });
  });

  it("arity / paramTypes / finalReturn read the FLATTENED spine", () => {
    const inner = call("mkArrow", [[tt(INT)], tt(STR)]);
    const mixed = call("mkArrow", [[tt(INT), tt(STR)], inner]);
    expect(call("arity", [mixed])).toBe(3);
    expect(call("paramTypes", [mixed])).toEqual([tt(INT), tt(STR), tt(INT)]);
    expect(call("finalReturn", [mixed])).toEqual(tt(STR));
    expect(call("arity", [tt(INT)])).toBe(0);
    expect(call("paramTypes", [tt(INT)])).toEqual([]);
    expect(call("finalReturn", [tt(INT)])).toEqual(tt(INT));
  });
});
