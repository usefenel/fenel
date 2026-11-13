import { afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  __clearFnTypeMarkerFixturesForTests,
  __registerFnTypeMarkerFixtureForTests,
  dispatchEngineBody,
  dispatchEngineBodyWithDeciderCtx,
  marshalTraversalType,
} from "./engine-bodies-dispatch";
import type { FenelType, FieldKey, SetExpr } from "./types";

// These tests invoke the production Fenel bodies. The fixtures exercise loss
// both where SeAll remains visible and where refinement or parameter dropping
// can erase it; merely retaining seHasAll would miss the latter cases.
setDefaultTimeout(600_000);

const ALL: SetExpr = { $tag: "SeAll" };
const NONE: SetExpr = { $tag: "SeNone" };
const NO = { $tag: "Nothing" };
const JT = { $tag: "Just", _0: true };
const NUM: FenelType = { $ref: "Number" };
const ENUM: SetExpr = { $tag: "SeEnum", values: [7] };
const TUPLE: FenelType = { $tuple: [NUM] };
const COMPLEMENT: FenelType = { $complement: TUPLE };
const LOSSY_REFINEMENT: FenelType = { $refined: { base: TUPLE, set: ENUM } };
const EXACT_REFINEMENT: FenelType = { $refined: { base: NUM, set: ENUM } };

const run = (name: string, args: unknown[]): unknown =>
  dispatchEngineBodyWithDeciderCtx(`engine:${name}`, args);
const tt = (type: FenelType): unknown => marshalTraversalType(type);
const projection = (type: unknown): { set: SetExpr; degraded: boolean } =>
  run("typeToSetProjection", [type]) as { set: SetExpr; degraded: boolean };
const literal = (value: unknown) => ({ $tag: "ELit", value });

// Use the production arrow builder so the tests exercise exactness rather
// than accidentally triggering a missing semantic-field-identity fence.
function foldedArrow(param: FenelType, returns: FenelType): unknown {
  const result = dispatchEngineBody("engine:foldTypes", [[tt(param), tt(returns)]]) as {
    $tag: string;
    _0: unknown;
  };
  expect(result.$tag).toBe("Just");
  return result._0;
}

function parameter(index: number, type: FenelType) {
  const key: FieldKey = {
    $tag: "NamedField",
    ref: { $ref: `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}` },
  };
  return { name: `p${index}`, key, type };
}

function goalArrow(domain: SetExpr): SetExpr {
  return {
    $tag: "SeArrow",
    params: [{ $tag: "SetArrowParam", key: parameter(0, NUM).key, wireName: "p0", set: domain }],
    returns: { $tag: "SeRef", handle: "ℝ" },
  };
}

beforeAll(() => {
  dispatchEngineBody("engine:vteBodyDomain", [0]);
});
afterEach(() => __clearFnTypeMarkerFixturesForTests());

describe("direct Fenel consumers preserve projection uncertainty", () => {
  test("lookupReturn widens degraded returns and retains saturation and exact projections", () => {
    for (const ret of [COMPLEMENT, LOSSY_REFINEMENT]) {
      const table = { example: { arity: 1, ret: tt(ret) } };
      expect(run("lookupReturn", ["example", 1, table])).toEqual(ALL);
      expect(run("lookupReturn", ["example", 2, table])).toEqual(ALL);
    }
    const exact = tt(EXACT_REFINEMENT);
    const table = { example: { arity: 1, ret: exact } };
    expect(run("lookupReturn", ["example", 1, table])).toEqual(projection(exact).set);
    expect(run("lookupReturn", ["example", 0, table])).toEqual(ALL);
    expect(run("lookupReturn", ["missing", 1, table])).toEqual(ALL);
  });

  test("synthFromSig widens refinement loss even after the raw SeAll has disappeared", () => {
    const lossy = foldedArrow(NUM, LOSSY_REFINEMENT);
    const raw = projection(lossy);
    expect(raw.degraded).toBe(true);
    expect(run("seHasAll", [raw.set])).toBe(false);
    expect(run("synthFromSig", [lossy, [literal(1)], []])).toEqual(ALL);

    const exact = foldedArrow(NUM, NUM);
    expect(run("synthFromSig", [exact, [literal(1)], []])).toEqual({ $tag: "SeRef", handle: "ℝ" });
    expect(run("synthFromSig", [exact, [], []])).toEqual(ALL);
    expect(run("synthFromSig", [exact, [literal("wrong domain")], []])).toEqual(ALL);
  });

  test("the existing SeAll fences remain stricter than absence of degradation", () => {
    const authoredTop: FenelType = { $refined: { base: NUM, set: ALL } };
    const signature = foldedArrow(NUM, authoredTop);
    const exact = projection(signature);
    expect(exact.degraded).toBe(false);
    expect(run("seHasAll", [exact.set])).toBe(true);
    expect(run("synthFromSig", [signature, [literal(1)], []])).toEqual(ALL);
    expect((run("vteArrowRefusal", ["authoredTop", 1, signature]) as { $tag: string }).$tag).toBe("Just");

    __registerFnTypeMarkerFixtureForTests("projectionConsumersAuthoredTop", {
      params: [parameter(0, NUM)], returns: authoredTop,
    });
    expect(run("arrowIdMembership", ["projectionConsumersAuthoredTop", 0, goalArrow(ENUM)])).toEqual(NO);
    expect(run("arrowIdMembership", ["projectionConsumersAuthoredTop", 0, goalArrow(NONE)])).toEqual(JT);
  });

  test("domTypeProject abstains for complement and refinement loss but retains exact domains", () => {
    for (const type of [COMPLEMENT, LOSSY_REFINEMENT]) {
      expect(run("domTypeProject", [tt(type)])).toEqual(NO);
    }
    const exact = tt({ $complement: NUM });
    expect(projection(exact).degraded).toBe(false);
    expect(run("domTypeProject", [exact])).toEqual({ $tag: "Just", _0: projection(exact).set });
    expect(run("domTypeProject", [tt({ $type: true })])).toEqual(NO);
  });

  test("arrowIdMembership fences loss before dropping a partial's collected parameter", () => {
    const goal = goalArrow({ $tag: "SeRef", handle: "ℝ" });
    __registerFnTypeMarkerFixtureForTests("projectionConsumersLossyPartial", {
      params: [parameter(0, LOSSY_REFINEMENT), parameter(1, NUM)],
      returns: NUM,
    });
    expect(run("arrowIdMembership", ["projectionConsumersLossyPartial", 1, goal])).toEqual(NO);

    __registerFnTypeMarkerFixtureForTests("projectionConsumersExactPartial", {
      params: [parameter(0, NUM), parameter(1, NUM)],
      returns: NUM,
    });
    expect(run("arrowIdMembership", ["projectionConsumersExactPartial", 1, goal])).toEqual(JT);
  });

  test("arrowIdMembership preserves vacuous membership and the purity/trust gates", () => {
    const goal = goalArrow(NONE);
    const signature = { params: [parameter(0, NUM)], returns: LOSSY_REFINEMENT };
    __registerFnTypeMarkerFixtureForTests("projectionConsumersVacuous", signature);
    expect(run("arrowIdMembership", ["projectionConsumersVacuous", 0, goal])).toEqual(JT);
    expect(run("arrowIdMembership", ["projectionConsumersVacuous", 0, goalArrow(ENUM)])).toEqual(NO);

    __registerFnTypeMarkerFixtureForTests("projectionConsumersUntrusted", { ...signature, trusted: false });
    expect(run("arrowIdMembership", ["projectionConsumersUntrusted", 0, goal])).toEqual(NO);
    __registerFnTypeMarkerFixtureForTests("projectionConsumersEffectful", {
      ...signature, requires: [{ class: "HasStateIO", args: [] }],
    });
    expect(run("arrowIdMembership", ["projectionConsumersEffectful", 0, goal])).toEqual(NO);
    expect(run("arrowIdMembership", ["projectionConsumersMissing", 0, goal])).toEqual(NO);
  });

  test("vteInstanceArrow widens loss and lets the existing exactness fence refuse it", () => {
    const lossy = foldedArrow(NUM, LOSSY_REFINEMENT);
    expect(run("vteInstanceArrow", [1, lossy])).toEqual(ALL);
    const refused = run("vteArrowRefusal", ["lossy", 1, lossy]) as { $tag: string; _0: { $tag: string } };
    expect(refused.$tag).toBe("Just");
    expect(refused._0.$tag).toBe("RsnUnsupportedRankOrKind");

    const exact = foldedArrow(NUM, NUM);
    expect(run("vteInstanceArrow", [1, exact])).toEqual(projection(exact).set);
    expect(run("vteArrowRefusal", ["exact", 1, exact])).toEqual(NO);
  });

  test("vteInstanceArrow retains zero-arity wrappers for both exact and degraded returns", () => {
    expect(run("vteInstanceArrow", [0, tt(LOSSY_REFINEMENT)])).toEqual({
      $tag: "SeArrow", params: [], returns: ALL,
    });
    const refused = run("vteArrowRefusal", ["lossyNullary", 0, tt(LOSSY_REFINEMENT)]) as { $tag: string };
    expect(refused.$tag).toBe("Just");

    for (const exact of [tt(NUM), foldedArrow(NUM, NUM)]) {
      expect(run("vteInstanceArrow", [0, exact])).toEqual({
        $tag: "SeArrow", params: [], returns: projection(exact).set,
      });
      expect(run("vteArrowRefusal", ["exactNullary", 0, exact])).toEqual(NO);
    }
  });
});

test("production Fenel has no raw typeToSetExpr consumer outside its compatibility declaration", () => {
  const directory = resolve(import.meta.dir, "../../../../fenel");
  const uses: string[] = [];
  for (const name of readdirSync(directory, { recursive: true })) {
    if (typeof name !== "string" || !name.endsWith(".fenel")) continue;
    const lines = readFileSync(join(directory, name), "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      const code = line.trim();
      if (code.startsWith("--") || code.startsWith("@")) return;
      if (!/\btypeToSetExpr\b/.test(code)) return;
      if (/[\\/]type-to-set\.fenel$/.test(name) && /^typeToSetExpr(?:\s*:|\s+type\s*=)/.test(code)) return;
      uses.push(`${name}:${index + 1}: ${code}`);
    });
  }
  expect(uses).toEqual([]);
});
