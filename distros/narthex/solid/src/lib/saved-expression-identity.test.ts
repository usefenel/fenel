import { describe, expect, test } from "bun:test";
import { exprNodeToLogic, type ExprNode } from "@fenel/engine/authoring/expression";
import { evaluate } from "@fenel/engine/expressions";
import { expressionKey, expressionMediaScheduling, expressionRendersPicture, expressionRendersSampledMedia, preferReadyJob } from "./saved-expression-identity";
import type { AuthoringSession } from "./expression-runner/account-authoring-session";
// C1: this UUID fixture uses internal registry options excluded from the public facade.
import { createRegistry } from "../../../../../implementations/typescript/engine/src/registry";
import { createDispatchRegistry } from "@fenel/engine";
import { Anything } from "@fenel/engine/type-foundation";
import { shareSavedExpressionMap } from "./saved-expression-map";

const call = (fnId: string, ...args: ExprNode[]): Extract<ExprNode, { kind: "call" }> => ({ kind: "call", fnId, args });
const literal = (value: unknown): ExprNode => ({ kind: "literal", value });
const mediaDeclarations = new Map(["picture:render", "sound:renderSound", "movie:renderMovie"].map(id => [id, { id }]));
const mediaSession = {
  registry: { getFunction: (id: string) => mediaDeclarations.get(id) },
  evaluateContext: { getFunction: (id: string) => mediaDeclarations.get(id) },
  environment: { functionCodeName: (id: string) => id, constructorCodeName: () => undefined },
} as unknown as AuthoringSession;

let checkedFixture: { session: AuthoringSession; ids: string[]; aliases: string[]; uuids: string[] } | undefined;
function checkedMediaSession() {
  if (checkedFixture) return checkedFixture;
  const ids = ["picture:render", "sound:renderSound", "movie:renderMovie", "custom:render"];
  const aliases = ["pictureRender", "renderSound", "renderMovie", "shadowed"];
  const uuids = ids.map((_id, index) => `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`);
  const registry = createRegistry(ids.map((id, index) => ({ name: id.split(":")[0]!, label: "Media scheduling fixture",
    entities: [], functions: [{ id, params: [], returns: Anything, body: 0 }],
    instances: [{ typeName: "Codeable", args: [id], methods: { codeName: aliases[index]! } }],
  })), { dispatchRegistry: createDispatchRegistry(), functionIdentityLock: new Map(ids.map((id, index) => [id, uuids[index]!])),
    publishCatalogEntities: false });
  const session = { ...mediaSession, registry, evaluateContext: registry.evaluateContext() } as AuthoringSession;
  return checkedFixture = { session, ids, aliases, uuids };
}

describe("saved expression identity", () => {
  test("a direct saved root and its reference both invalidate when only the declaration changes", () => {
    const source = literal({ __lambda: { params: ["value"], body: literal([]) } });
    const create = (params: number) => shareSavedExpressionMap(undefined, [{ id: "saved", query: {
      expr: source, valueType: { $arrow: {
        params: Array.from({ length: params }, (_, index) => ({ name: `p${index}`, type: { $ref: "Number" } })),
        returns: { $ref: "Number" },
      } },
    } }]);
    const unary = create(1), binary = create(2);
    const reference: ExprNode = { kind: "ref", savedExprId: "saved" };
    expect(expressionKey(unary.get("saved")!, unary)).not.toBe(expressionKey(binary.get("saved")!, binary));
    expect(expressionKey(reference, unary)).toBe(expressionKey(unary.get("saved")!, unary));
    expect(expressionKey(reference, binary)).toBe(expressionKey(binary.get("saved")!, binary));
  });

  test("editing a source reevaluates an unchanged saved-reference chain", () => {
    // C1 harness: exercise the existing codec/evaluator/cache identity only.
    const sourceId = "source-value", doubledId = "doubled-value", resultId = "result-value";
    const doubled = call("std:mul", { kind: "ref", savedExprId: sourceId }, literal(2));
    const result = call("std:add", { kind: "ref", savedExprId: doubledId }, literal(1));
    const resultRef: ExprNode = { kind: "ref", savedExprId: resultId };
    const saved = new Map<string, ExprNode>([
      [sourceId, literal(10)], [doubledId, doubled], [resultId, result],
    ]);
    const bodies = structuredClone([doubled, result, resultRef]);
    const names = new Map([["std:mul", "mul"], ["std:add", "add"]]);
    const computation = () => exprNodeToLogic(resultRef, {
      resolver: id => saved.get(id), fnCodeName: id => names.get(id) ?? id,
    });
    const initialKey = expressionKey(resultRef, saved);
    expect(computation()).toEqual({ call: ["add", { call: ["mul", 10, 2] }, 1] });
    expect(evaluate(computation())).toBe(21);

    // Replace A's body under the same identity; B and C retain their references.
    saved.set(sourceId, literal(20));
    expect(computation()).toEqual({ call: ["add", { call: ["mul", 20, 2] }, 1] });
    expect(evaluate(computation())).toBe(41);
    expect(expressionKey(resultRef, saved)).not.toBe(initialKey);
    expect(saved.get(doubledId)).toBe(doubled);
    expect(saved.get(resultId)).toBe(result);
    expect([doubled, result, resultRef]).toEqual(bodies);

    const editedKey = expressionKey(resultRef, saved);
    saved.set("unrelated-value", literal(99));
    expect(expressionKey(resultRef, saved)).toBe(editedKey);
    expect(evaluate(computation())).toBe(41);
  });

  test("missing and cyclic saved-reference chains retain their existing refusal markers", () => {
    const reference: ExprNode = { kind: "ref", savedExprId: "source-value" };
    const saved = new Map<string, ExprNode>();
    const missing: string[] = [];
    const computation = () => exprNodeToLogic(reference, {
      resolver: id => saved.get(id), onMissingRef: id => missing.push(id),
    });
    expect(expressionKey(reference, saved)).toBe("missing:source-value");
    expect(computation()).toBeNull();
    expect(missing).toEqual(["source-value"]);

    saved.set("source-value", { kind: "ref", savedExprId: "derived-value" });
    saved.set("derived-value", reference);
    expect(expressionKey(reference, saved)).toBe("cycle:source-value");
    expect(computation()).toBeNull();
    expect(missing).toEqual(["source-value", "source-value"]);
    expect(saved.get("derived-value")).toBe(reference);

    saved.set("source-value", literal(7));
    expect(expressionKey(reference, saved)).toBe("L:7");
    expect(computation()).toBe(7);
    expect(missing).toEqual(["source-value", "source-value"]);
  });

  test("a saved source inside structural list and record slots changes the cache identity", () => {
    const source: ExprNode = { kind: "ref", savedExprId: "source" };
    const collection = literal({ __list: [source, literal(1)] });
    const result = literal({ __record: { fields: [{ name: "numbers", value: collection }] } });
    const saved = new Map<string, ExprNode>([["source", literal(10)], ["collection", result]]);
    const reference: ExprNode = { kind: "ref", savedExprId: "collection" };
    const original = structuredClone(result);
    const computation = () => exprNodeToLogic(reference, { resolver: id => saved.get(id) });
    const initialKey = expressionKey(reference, saved);
    expect(evaluate(computation())).toEqual({ numbers: [10, 1] });

    saved.set("source", literal(20));
    expect(evaluate(computation())).toEqual({ numbers: [20, 1] });
    expect(expressionKey(reference, saved)).not.toBe(initialKey);
    expect(result).toEqual(original);
    expect(saved.get("collection")).toBe(result);
    const editedKey = expressionKey(reference, saved);
    saved.set("unrelated", literal(99));
    expect(expressionKey(reference, saved)).toBe(editedKey);
  });

  test("structural references retain missing and cycle markers and recover when the source arrives", () => {
    const reference: ExprNode = { kind: "ref", savedExprId: "source" };
    const collection = literal({ __list: [reference] });
    const saved = new Map<string, ExprNode>();
    const missingKey = expressionKey(collection, saved);
    expect(missingKey).toContain("missing:source");
    expect(exprNodeToLogic(collection, { resolver: id => saved.get(id) })).toEqual([null]);

    saved.set("source", collection);
    const cycleKey = expressionKey(collection, saved);
    expect(cycleKey).toContain("cycle:source");
    expect(cycleKey).not.toBe(missingKey);
    expect(exprNodeToLogic(reference, { resolver: id => saved.get(id) })).toEqual([null]);

    saved.set("source", literal(7));
    expect(expressionKey(collection, saved)).not.toBe(cycleKey);
    expect(exprNodeToLogic(collection, { resolver: id => saved.get(id) })).toEqual([7]);
  });

  test("runtime data and raw defaults or annotations stay outside structural dependency coverage", () => {
    const reference: ExprNode = { kind: "ref", savedExprId: "source" };
    const rawValues = [
      reference,
      [reference],
      { payload: { __list: [reference] } },
      { $tag: "Just", _0: { __list: [reference] } },
      { __fenelFn: true, body: { __list: [reference] } },
      { __fenelPartial: true, args: [reference] },
      { __var: { path: "x", arrayForm: true, fallback: { __list: [reference] } } },
      { __ann: { expr: literal(1), type: { __list: [reference] } } },
      { __let: { bindings: [{ name: "x", expr: literal(1), type: { __list: [reference] } }] } },
    ];
    const saved = new Map<string, ExprNode>([["source", literal(10)]]);
    const originalKeys = rawValues.map(value => expressionKey(literal(value), saved));
    saved.set("source", literal(20));
    expect(rawValues.map(value => expressionKey(literal(value), saved))).toEqual(originalKeys);
  });

  test("closure bodies and match guards follow the canonical executable slots", () => {
    const reference: ExprNode = { kind: "ref", savedExprId: "source" };
    const expressions = [
      literal({ __lambda: { params: ["x"], body: call("std:add", { kind: "param", name: "x" }, reference) } }),
      literal({ __match: { scrutinee: literal(1), arms: [
        { pattern: { $guard: ["_", reference] }, body: literal("yes") },
      ] } }),
    ];
    const saved = new Map<string, ExprNode>([["source", literal(10)]]);
    const originalKeys = expressions.map(expr => expressionKey(expr, saved));
    saved.set("source", literal(20));
    for (const [index, expr] of expressions.entries()) {
      expect(expressionKey(expr, saved)).not.toBe(originalKeys[index]);
    }
  });

  test("lenses and copies of one picture are one key, and a different plot is not", () => {
    const plot = call("picture:render", literal({ construct: ["Field", { fn: [["p"], 1] }] }), literal(96), literal(96));
    const copy = call("picture:render", literal({ construct: ["Field", { fn: [["p"], 1] }] }), literal(96), literal(96));
    const ref = { kind: "ref", savedExprId: "plot" } as const;
    const saved = new Map([["plot", plot]]);
    expect(expressionKey(plot, new Map())).toBe(expressionKey(copy, new Map()));
    expect(expressionKey(ref, saved)).toBe(expressionKey(plot, saved));
    const other = call("picture:render", literal({ construct: ["Field", { fn: [["p"], 2] }] }), literal(96), literal(96));
    expect(expressionKey(other, saved)).not.toBe(expressionKey(plot, saved));
  });

  test("a picture render waits and an image pipeline does not", () => {
    const saved = new Map<string, ExprNode>([["plot", call("picture:render", literal(1))]]);
    expect(expressionRendersPicture(call("std:imageInvert", call("std:imageSample", literal(3))), saved, mediaSession)).toBe(false);
    expect(expressionRendersPicture({ kind: "ref", savedExprId: "plot" }, saved, mediaSession)).toBe(true);
    expect(expressionRendersPicture({ kind: "ref", savedExprId: "missing" }, saved, mediaSession)).toBe(false);
  });

  test("a sound render holds the reader and an image pipeline does not", () => {
    const saved = new Map<string, ExprNode>([["chord", call("sound:renderSound", literal(1), literal(1), literal(1))]]);
    expect(expressionRendersSampledMedia({ kind: "ref", savedExprId: "chord" }, saved, mediaSession)).toBe(true);
    expect(expressionRendersPicture({ kind: "ref", savedExprId: "chord" }, saved, mediaSession)).toBe(false);
    expect(expressionRendersSampledMedia(call("std:imageInvert", literal(1)), saved, mediaSession)).toBe(false);
  });

  test("a queued photo runs before a picture render that has not started", () => {
    const jobs = ["plot", "photo", "catalog"];
    const taken: string[] = [];
    while (jobs.length) taken.push(preferReadyJob(jobs, job => job === "plot")!);
    expect(taken).toEqual(["photo", "catalog", "plot"]);
  });

  test("checked names, UUIDs and saved references share media priority and ordinary-call slice admission", () => {
    const { session, ids, aliases, uuids } = checkedMediaSession();
    for (let index = 0; index < 3; index++) {
      const expected = { picture: index === 0, sampled: true, weight: index === 0 ? 1 : 2,
        slice: index === 0 ? "picture" : index === 1 ? "sound" : undefined };
      for (const id of [ids[index]!, aliases[index]!, uuids[index]!]) {
        const expression = call(id, literal("field"), literal(2), literal(2));
        expect(session.evaluateContext.getFunction?.(id)?.id).toBe(ids[index]!);
        expect(expressionMediaScheduling(expression, new Map(), session)).toMatchObject(expected);
        const saved = new Map<string, ExprNode>([["body", expression], ["alias", { kind: "ref", savedExprId: "body" }]]);
        expect(expressionMediaScheduling({ kind: "ref", savedExprId: "alias" }, saved, session)).toMatchObject(expected);
      }
    }
    const nested = call("custom:render", call(uuids[0]!, literal(1)), call(uuids[1]!, literal(1)));
    expect(expressionMediaScheduling(nested, new Map(), session)).toMatchObject({ picture: true, sampled: true, weight: 1, slice: undefined });
    expect(expressionMediaScheduling(call("picture.render", literal(1), literal(2), literal(2)), new Map(), session))
      .toMatchObject({ picture: true, sampled: true, weight: 1, slice: "picture" });
  });

  test("the emitted scoped head, unreadable targets and same-id edited drafts never select a repository slice", () => {
    const { session, uuids } = checkedMediaSession();
    const expression = call(uuids[0]!, literal("field"), literal(2), literal(2));
    const shadowed = { ...expression, sourceHead: "shadowed", sourceTargetId: uuids[0]! };
    expect(expressionMediaScheduling(shadowed, new Map(), session)).toMatchObject({ picture: false, sampled: false, weight: 0, slice: undefined });
    expect(expressionMediaScheduling(call("missing", ...expression.args), new Map(), session)).toMatchObject({ sampled: false, slice: undefined });
    const original = session.evaluateContext.getFunction!;
    const edited = { ...original(uuids[0]!)!, body: 99 };
    const draftSession = { ...session, evaluateContext: { ...session.evaluateContext,
      getFunction: (id: string) => id === uuids[0] ? edited : original(id) } };
    expect(expressionMediaScheduling(expression, new Map(), draftSession)).toMatchObject({ sampled: false, slice: undefined });
    const refused = { ...session, evaluateContext: { ...session.evaluateContext, getFunction: () => { throw new Error("Current reader refused"); } } };
    expect(expressionMediaScheduling(expression, new Map(), refused)).toMatchObject({ sampled: false, slice: undefined });
  });

  test("the canonical import frame shadows a global media name and preserves explicit identity calls", () => {
    const { session, uuids } = checkedMediaSession();
    const imported = { ...session, evaluateContext: { ...session.evaluateContext,
      _importStack: [{ names: { pictureRender: "custom:render" }, aliases: {} }] } };
    expect(expressionMediaScheduling(call("pictureRender", literal(1), literal(2), literal(2)), new Map(), imported))
      .toMatchObject({ sampled: false, weight: 0, slice: undefined });
    expect(expressionMediaScheduling(call(uuids[0]!, literal(1), literal(2), literal(2)), new Map(), imported))
      .toMatchObject({ sampled: true, weight: 1, slice: "picture" });
    const alias = { ...session, evaluateContext: { ...session.evaluateContext,
      _importStack: [{ names: {}, aliases: { Drawing: "picture" } }] } };
    // The codec retains the uppercase qualified spelling as method syntax.
    // Its priority is shared; the existing method-slice fence still applies.
    expect(expressionMediaScheduling(call("Drawing.render", literal(1), literal(2), literal(2)), new Map(), alias))
      .toMatchObject({ sampled: true, weight: 1, slice: undefined });
  });

  test("a metadata lookup refusal in an unexecuted lazy branch does not reject ordinary evaluation", () => {
    const { session } = checkedMediaSession();
    const original = session.evaluateContext.getFunction!;
    const scoped = { ...session, evaluateContext: { ...session.evaluateContext, getFunction: (id: string) => {
      if (id === "refused") throw new Error("Unexecuted lookup");
      return original(id);
    } } };
    const expression = call("if", literal(true), literal("ready"), call("refused"));
    expect(expressionMediaScheduling(expression, new Map(), scoped)).toMatchObject({ sampled: false, weight: 0, slice: undefined });
    expect(evaluate(exprNodeToLogic(expression), {}, scoped.evaluateContext)).toBe("ready");
  });

  test("bare dispatch, ambiguity and unknown routing metadata conservatively decline sampled slices", () => {
    const expression = call("picture:render", literal(1), literal(2), literal(2));
    for (const resolution of [
      { kind: "dispatch", typeName: "OtherRenderer" },
      { kind: "ambiguousModule", name: "picture:render", bindings: ["picture:render", "custom:render"] },
    ] as const) {
      const routed = { ...mediaSession, evaluateContext: { ...mediaSession.evaluateContext,
        _resolveBareName: () => resolution } };
      expect(expressionMediaScheduling(expression, new Map(), routed)).toMatchObject({ sampled: false, weight: 0, slice: undefined });
    }
    const unclassified = { ...mediaSession, evaluateContext: { ...mediaSession.evaluateContext, _routingTable: () => ({}) } };
    expect(expressionMediaScheduling(expression, new Map(), unclassified)).toMatchObject({ sampled: false, slice: undefined });
  });

  test("capture, arity, constructor and method syntax stay outside sampled slices", () => {
    const { session, uuids } = checkedMediaSession();
    const expression = call(uuids[0]!, literal("field"), literal(2), literal(2));
    expect(expressionMediaScheduling(expression, new Map(), session, { capture: true }).slice).toBeUndefined();
    for (const args of [[], expression.args.slice(0, 2), [...expression.args, literal("extra")]]) {
      expect(expressionMediaScheduling({ ...expression, args }, new Map(), session).slice).toBeUndefined();
    }
    for (const dimension of [call("custom:render"), literal(Infinity), literal(NaN), literal("2")]) {
      expect(expressionMediaScheduling({ ...expression, args: [expression.args[0]!, dimension, literal(2)] }, new Map(), session))
        .toMatchObject({ sampled: true, weight: 1, slice: undefined });
    }
    for (const callSyntax of ["construct", "method"] as const) {
      expect(expressionMediaScheduling({ ...expression, callSyntax }, new Map(), session).slice).toBeUndefined();
    }
    expect(expressionMediaScheduling({ ...expression, callSyntax: "call" }, new Map(), session).slice).toBe("picture");
  });

  test("saved cycles refuse and literal payloads remain opaque to scheduling", () => {
    const cycle: ExprNode = { kind: "ref", savedExprId: "cycle" };
    expect(expressionMediaScheduling(cycle, new Map([["cycle", cycle]]), mediaSession)).toMatchObject({ sampled: false, weight: 0 });
    const opaque = Object.defineProperty({ kind: "literal" }, "value", { get() { throw new Error("Image bytes were inspected"); } }) as ExprNode;
    expect(expressionMediaScheduling(opaque, new Map(), mediaSession)).toMatchObject({ sampled: false, weight: 0 });
    expect(expressionMediaScheduling(literal({ __list: [call("picture:render")] }), new Map(), mediaSession)).toMatchObject({ sampled: false });
  });
});

// Demo 1 (2026-11-07, review S8): a grouping prepared over a card reference
// (the real __do/__let/__apply shape) is recomputed when the card's data changes.
describe("a derived grouping's cache key follows its source card", () => {
  test("expressionKey of the prepared grouping changes with the referenced card's literal", () => {
    const projector = literal({ __lambda: { params: ["row"], arrayParams: true, body: { kind: "param", name: "row.date" } } });
    const grouping = literal({ __do: [
      literal({ __let: { bindings: [{ name: "row", expr: literal({ $ref: "std-group-by-key" }) }] } }),
      literal({ __apply: { target: { kind: "param", name: "row" }, syntax: "call",
        args: [projector, { kind: "ref", savedExprId: "tab:transactions" }] } }),
    ] });
    const rows = (day: number) => literal({ __list: [literal({ __record: { fields: [{ name: "date", value: literal(day) }] } })] });
    const before = expressionKey(grouping, new Map([["tab:transactions", rows(3)]]));
    const after = expressionKey(grouping, new Map([["tab:transactions", rows(24)]]));
    expect(after).not.toBe(before);
    expect(expressionKey(grouping, new Map([["tab:transactions", rows(3)]]))).toBe(before);
  });
});
