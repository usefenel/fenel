import { describe, expect, test } from "bun:test";
import { contains } from "../src/set-algebra.ts";
import { validateValue } from "../src/validate.ts";
import { presentationSourceCallNativesCtx } from "../src/engine-bodies-dispatch.ts";
import { evaluate, pureEvaluateContext, readerSourceMetadataEvaluateContext } from "../src/json-logic.ts";
import { viewModule } from "../src/modules/view.ts";
import { readerSourceMetadataNative } from "../../../../fenel/modules/view/ffi/source-metadata.ts";

// The actual declared pure native and map, not a replacement getter. A small
// caller frame avoids constructing a product registry; contains still executes
// its canonical Fenel decider and ordinary private engine harness.
const declaration = viewModule.functions.find(fn => fn.id === "view:readerSourceMetadata");
if (!declaration) throw new Error("The source metadata declaration is unavailable.");
const native = viewModule.nativeImplsCtx[declaration.id];
const getFunction = name => name === declaration.id || name === "readerSourceMetadata" ? declaration : undefined;
const nativesCtx = Object.freeze({ [declaration.id]: native });
const base = Object.freeze({ getFunction, nativesCtx });
const packet = generation => Object.freeze({ $tag: "ReaderSourceMetadata",
  source: Object.freeze({ $tag: "ThisTabSource" }), rootId: "current-root", generation,
  expressions: Object.freeze([]), occurrences: Object.freeze([]), callableLabels: Object.freeze([]) });
const predicate = { match: [{ call: [declaration.id] }, { $tag: "Just", _0: { $bind: "packet" } },
  { "==": [{ var: "packet.generation" }, "A"] }, "_", false] };
const set = { $tag: "SeWhere", pred: predicate };
const just = value => ({ $tag: "Just", _0: value });

describe("captured source metadata through canonical SeWhere membership", () => {
  test("fresh packets change the same predicate verdict without reusing an earlier frame", () => {
    expect(declaration.body).toBeUndefined();
    expect(declaration.params).toHaveLength(0);
    expect(declaration.requires ?? []).toHaveLength(0);
    expect(native).toBe(readerSourceMetadataNative);
    const first = readerSourceMetadataEvaluateContext(base, packet("A"));
    const second = readerSourceMetadataEvaluateContext(base, packet("B"));
    expect(first.getFunction).toBe(second.getFunction);
    expect(first.nativesCtx).toBe(second.nativesCtx);
    const rows = [[first, true], [second, false], [first, true], [second, false],
      [readerSourceMetadataEvaluateContext(second, undefined), false], [first, true]];
    for (const [frame, expected] of rows) {
      const context = pureEvaluateContext(frame);
      expect(evaluate(predicate, {}, context)).toBe(expected);
      expect(contains(set, 42, null, undefined, context)).toEqual(just(expected));
      // Recursive membership uses the same packet in the canonical owner.
      expect(contains({ $tag: "SeIntersect", branches: [{ $tag: "SeAll" }, set] }, 42,
        null, undefined, context)).toEqual(just(expected));
    }
    expect(Object.hasOwn(base, "_readerSourceMetadata")).toBe(false);
  }, 120_000);

  test("accessor and inherited packet slots remain absent without executing getters", () => {
    let reads = 0;
    const accessor = Object.create(Object.prototype, { ...Object.getOwnPropertyDescriptors(base),
      _readerSourceMetadata: { get() { reads++; throw new Error("Packet accessor must remain unread"); }, enumerable: true } });
    const inherited = Object.create({ _readerSourceMetadata: packet("A") }, Object.getOwnPropertyDescriptors(base));
    for (const frame of [base, accessor, inherited]) {
      expect(readerSourceMetadataNative(frame)).toEqual({ $tag: "Nothing" });
      expect(contains(set, 42, null, undefined, frame)).toEqual(just(false));
    }
    expect(reads).toBe(0);
  });

  test("ordinary refined validation keeps the same current packet through its separate frame builder", () => {
    const type = { $refined: { base: { $complement: { $void: true } }, set } };
    const first = readerSourceMetadataEvaluateContext(base, packet("A"));
    const second = readerSourceMetadataEvaluateContext(base, packet("B"));
    for (const [frame, expected] of [[first, true], [second, false], [first, true],
      [readerSourceMetadataEvaluateContext(second, undefined), false]]) {
      const result = validateValue(type, 42, null, { functions: frame });
      expect(result.valid).toBe(expected);
      expect(result.errors.length === 0).toBe(expected);
      expect(result.value).toBe(42);
    }
  });

  test("the existing source callback boundary invokes the original reader rather than its helper frame", () => {
    const firstPacket = packet("A");
    const secondPacket = packet("B");
    const first = readerSourceMetadataEvaluateContext(base, firstPacket);
    const second = readerSourceMetadataEvaluateContext(base, secondPacket);
    const helper = { _readerSourceMetadata: packet("helper") };
    for (const [frame, expected] of [[first, firstPacket], [second, secondPacket], [first, firstPacket],
      [readerSourceMetadataEvaluateContext(second, undefined), undefined]]) {
      const callback = presentationSourceCallNativesCtx(frame).presentationSourceCall;
      const result = callback(helper, { $ref: declaration.id }, []);
      expect(result.$tag).toBe("Just");
      if (expected === undefined) expect(result._0).toEqual({ $tag: "Nothing" });
      else expect(result._0._0).toBe(expected);
    }
    expect(Object.hasOwn(base, "_readerSourceMetadata")).toBe(false);
  });
});
