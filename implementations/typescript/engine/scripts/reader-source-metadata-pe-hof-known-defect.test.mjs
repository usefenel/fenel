import { describe, expect, test } from "bun:test";
import { dispatchedPartialEvalInCtx, harnessForTests } from "../src/engine-bodies-dispatch.ts";
import { jitEvalNative } from "../src/modules/evaluator-strategies.ts";
import { evaluate, readerSourceMetadataEvaluateContext } from "../src/json-logic.ts";
import { viewModule } from "../src/modules/view.ts";
import { readerSourceMetadataNative } from "../../../../fenel/modules/view/ffi/source-metadata.ts";

// C1 regression for design/tcb-ledger.md `pe.hof.unknown-callback`.
// Counterexample (kept, HEAD b4ba05f8): under a reader frame the PE folded
// `map (\item -> readerSourceMetadata) [1]` with the harness natives and
// answered `Concrete [null]` (and `Concrete [false]` for the predicate) where
// ordinary evaluation reads the caller's packet. Since the conservative repair
// (2026-10-16) a caller frame other than the exact harness folds nothing and no
// higher-order call is ever folded, so the original expression stays residual
// and re-evaluates equal to ordinary under A, B and absence. The row is closed
// as REPAIRED narrowly; this does not establish general PE soundness.
const declaration = viewModule.functions.find(fn => fn.id === "view:readerSourceMetadata");
if (!declaration) throw new Error("The actual metadata declaration is unavailable.");
const packet = generation => Object.freeze({ $tag: "ReaderSourceMetadata",
  source: Object.freeze({ $tag: "ThisTabSource" }), rootId: "current-root", generation,
  expressions: Object.freeze([]), occurrences: Object.freeze([]), callableLabels: Object.freeze([]) });
const read = { call: [declaration.id] };
const predicate = { match: [read, { $tag: "Just", _0: { $bind: "packet" } },
  { "==": [{ var: "packet.generation" }, "A"] }, "_", false] };
// The current source declaration is map(fn, arr). A nonempty result below is
// essential: the former reversed argument order returned [] without a callback.
const mappedRead = { call: ["map", { fn: ["item", read] }, [1]] };
const mappedPredicate = { call: ["map", { fn: ["item", predicate] }, [1]] };

describe("pe.hof.unknown-callback — REPAIRED: higher-order calls stay residual and equal ordinary", () => {
  test("a real map callback keeps the actual metadata native: residual equal to ordinary", () => {
    expect(declaration.body).toBeUndefined();
    expect(declaration.params).toHaveLength(0);
    expect(declaration.requires ?? []).toHaveLength(0);
    expect(viewModule.nativeImplsCtx[declaration.id]).toBe(readerSourceMetadataNative);

    // Only the ordinary private engine harness is constructed. The ordinary
    // reader adds the actual declaration/native; production PE chooses its own
    // unchanged private native map and positive fold roster.
    const harness = harnessForTests().ctx;
    const base = Object.freeze({ ...harness,
      getFunction: name => name === declaration.id || name === "readerSourceMetadata"
        ? declaration : harness.getFunction?.(name),
      nativesCtx: Object.assign(Object.create(null), harness.nativesCtx,
        { [declaration.id]: readerSourceMetadataNative }),
    });
    expect(harness.nativesCtx?.[declaration.id]).toBeUndefined();

    for (const generation of ["A", "B", undefined]) {
      const captured = generation === undefined ? undefined : packet(generation);
      const frame = readerSourceMetadataEvaluateContext(base, captured);
      const expectedRead = captured === undefined ? { $tag: "Nothing" } : { $tag: "Just", _0: captured };

      // Direct native calls correctly remain residual and re-evaluate in the
      // ordinary reader. The failure is specifically the admitted outer HOF.
      expect(evaluate(read, {}, frame)).toEqual(expectedRead);
      const direct = dispatchedPartialEvalInCtx(read, {}, 8, frame);
      expect(direct).toEqual({ $tag: "Residual", expr: read });
      expect(evaluate(direct.expr, {}, frame)).toEqual(expectedRead);

      const ordinaryRead = evaluate(mappedRead, {}, frame);
      expect(ordinaryRead).toHaveLength(1);
      expect(ordinaryRead).toEqual([expectedRead]);
      if (captured !== undefined) expect(ordinaryRead[0]._0).toBe(captured);
      const optimizedRead = dispatchedPartialEvalInCtx(mappedRead, {}, 8, frame);
      expect(optimizedRead).toEqual({ $tag: "Residual", expr: mappedRead });
      expect(evaluate(optimizedRead.expr, {}, frame)).toEqual(ordinaryRead);

      const ordinaryPredicate = evaluate(mappedPredicate, {}, frame);
      expect(ordinaryPredicate).toHaveLength(1);
      expect(ordinaryPredicate).toEqual([generation === "A"]);
      const optimizedPredicate = dispatchedPartialEvalInCtx(mappedPredicate, {}, 8, frame);
      expect(optimizedPredicate.$tag).toBe("Residual");
      expect(evaluate(optimizedPredicate.expr, {}, frame)).toEqual(ordinaryPredicate);

      // The JIT consumer answers an honest Err, never `Ok [null]`.
      const jit = jitEvalNative(mappedRead, frame);
      expect(jit.$tag).toBe("Err");
    }
    expect(Object.hasOwn(base, "_readerSourceMetadata")).toBe(false);
  }, 55_000);
});
