import { describe, expect, test } from "bun:test";

import {
  __invokeDeciderRegistryReadNativeForTests,
} from "./engine-bodies-dispatch";
import { loadFenelModule } from "./fenel-module";
import { createRegistry } from "./registry";
import { modulesFor } from "./module-manifest";
import {
  finalizeRegistryFunctionSignatures,
  inferJsonLogicType,
  type RegistryFunctionSignatureCandidate,
  type RegistrySignatureFinalizationOptions,
  type SignatureResolutionRow,
} from "./signature-inference";
import { List, Nothing } from "./type-foundation";
import type {
  FenelFunction,
  FenelType,
  FieldDef,
  FunctionSignatureInfo,
} from "./types";

type SccDerivation = {
  readonly engine: string;
  readonly version: string;
  readonly scc: boolean;
  readonly sccId: string;
  readonly sccSize: number;
};

function candidate(
  id: string,
  body: NonNullable<FenelFunction["body"]>,
): RegistryFunctionSignatureCandidate {
  const declarationName = id.slice(id.indexOf(":") + 1);
  const fn: FenelFunction = {
    id,
    params: [],
    returns: { $var: "compat-return" },
    body,
  };
  return {
    fn,
    declaration: {
      functionId: id,
      declarationName,
      codeName: declarationName,
      params: [],
      returns: { $tag: "Absent" },
    },
    implementationOrigin: { $tag: "FenelBody" },
  };
}

function derivation(info: FunctionSignatureInfo): SccDerivation {
  expect(info.outcome.$tag).toBe("Solved");
  if (info.outcome.$tag !== "Solved") throw new Error("expected a solved inference outcome");
  const value = info.outcome.derivation as Partial<SccDerivation> | undefined;
  expect(value).toEqual(expect.objectContaining({
    engine: "fenel-rank1",
    version: "1",
    scc: expect.any(Boolean),
    sccId: expect.any(String),
    sccSize: expect.any(Number),
  }));
  return value as SccDerivation;
}

function evidenceById(
  candidates: readonly RegistryFunctionSignatureCandidate[],
  resolutions: readonly SignatureResolutionRow[] = [],
): Record<string, SccDerivation> {
  const exactRouting = new Map<string, SignatureResolutionRow>();
  for (const candidate of candidates) {
    for (const name of [candidate.fn.id, candidate.declaration.codeName]) {
      exactRouting.set(name, {
        name,
        status: "resolved",
        targetId: candidate.fn.id,
      });
    }
  }
  for (const row of resolutions) exactRouting.set(row.name, row);
  const routingRows = [...exactRouting.values()].sort((left, right) =>
    left.name.localeCompare(right.name)
  );
  return Object.fromEntries(finalizeRegistryFunctionSignatures(candidates, {
    resolutions: routingRows,
  })
    .map(({ fn, info }) => [fn.id, derivation(info)]));
}

function positionalField(name: string, index: number, type: FenelType): FieldDef {
  return {
    name,
    key: { $tag: "PositionalField", index },
    type,
    label: Nothing,
    ui: Nothing,
    meta: {},
  };
}

function inferredFunction(
  moduleName: string,
  codeName: string,
  params: readonly string[],
  body: unknown,
  authoredParamTypes: readonly (FenelType | undefined)[] = [],
): RegistryFunctionSignatureCandidate {
  const id = `${moduleName}:${codeName}`;
  return {
    fn: {
      id,
      params: params.map((name, index) =>
        positionalField(
          name,
          index,
          authoredParamTypes[index] ?? { $var: `compat-${codeName}-${index}` },
        )
      ),
      returns: { $var: `compat-${codeName}-return` },
      body: body as FenelFunction["body"],
    },
    declaration: {
      functionId: id,
      declarationName: codeName,
      codeName,
      params: params.map((_, index) => authoredParamTypes[index] === undefined
        ? { $tag: "Absent" } as const
        : {
            $tag: "Authored" as const,
            source: {
              $tag: "SourceTypeSig" as const,
              module: moduleName,
              declaration: codeName,
            },
          }),
      returns: { $tag: "Absent" },
    },
    implementationOrigin: { $tag: "FenelBody" },
  };
}

function chainMatch(
  scrutinee: string,
  recursiveArgument: "tail" | "whole",
  callee: string,
  carryValue: boolean,
): NonNullable<FenelFunction["body"]> {
  const recursiveArgs = [
    { var: recursiveArgument === "tail" ? "tail" : scrutinee },
    ...(carryValue ? [{ var: "_1" }] : []),
  ];
  return {
    match: [
      { var: scrutinee },
      { $tag: "Next", _0: { $bind: "tail" } },
      { call: [callee, ...recursiveArgs] },
      { $tag: "End" },
      carryValue ? { var: "_1" } : 0,
    ],
  };
}

function nestedRecursiveChainMatch(
  scrutinee: string,
  callee: string,
): NonNullable<FenelFunction["body"]> {
  return {
    match: [
      { var: scrutinee },
      { $tag: "Next", _0: { $bind: "tail" } },
      { wrapped: { call: [callee, { var: "tail" }] } },
      { $tag: "End" },
      { wrapped: 0 },
    ],
  };
}

function constantRecursiveChainMatch(
  scrutinee: string,
  callee: string,
  base: string | number,
): NonNullable<FenelFunction["body"]> {
  return {
    match: [
      { var: scrutinee },
      { $tag: "Next", _0: { $bind: "tail" } },
      { call: [callee, { var: "tail" }] },
      { $tag: "End" },
      base,
    ],
  };
}

function mutualFixture(
  moduleName: string,
  decreasing: boolean,
  reversed: boolean,
  nestedRecursiveReturn = false,
  baseValues?: readonly [string | number, string | number],
): {
  readonly candidates: readonly RegistryFunctionSignatureCandidate[];
  readonly options: RegistrySignatureFinalizationOptions;
} {
  const leftName = decreasing ? "decreasingLeft" : "nondecreasingLeft";
  const rightName = decreasing ? "decreasingRight" : "nondecreasingRight";
  const params = nestedRecursiveReturn || baseValues !== undefined
    ? ["_0"]
    : decreasing ? ["_0", "_1"] : ["_0"];
  const chainType = { $ref: "Chain" } satisfies FenelType;
  const left = inferredFunction(
    moduleName,
    leftName,
    params,
    nestedRecursiveReturn
      ? nestedRecursiveChainMatch("_0", rightName)
      : baseValues !== undefined
        ? constantRecursiveChainMatch("_0", rightName, baseValues[0])
      : chainMatch("_0", decreasing ? "tail" : "whole", rightName, decreasing),
    [chainType],
  );
  const right = inferredFunction(
    moduleName,
    rightName,
    params,
    nestedRecursiveReturn
      ? nestedRecursiveChainMatch("_0", leftName)
      : baseValues !== undefined
        ? constantRecursiveChainMatch("_0", leftName, baseValues[1])
      : chainMatch("_0", decreasing ? "tail" : "whole", leftName, decreasing),
    [chainType],
  );
  const candidates = reversed ? [right, left] : [left, right];
  const targetPrefix = `@ctor/${encodeURIComponent(moduleName)}/Chain/`;
  const routeByName = new Map<string, SignatureResolutionRow>([
    [leftName, {
      name: leftName,
      status: "resolved",
      targetId: left.fn.id,
    }],
    [rightName, {
      name: rightName,
      status: "resolved",
      targetId: right.fn.id,
    }],
    ["$ctor:End", {
      name: "$ctor:End",
      status: "resolved",
      targetId: `${targetPrefix}End`,
    }],
    ["$ctor:Next", {
      name: "$ctor:Next",
      status: "resolved",
      targetId: `${targetPrefix}Next`,
    }],
  ]);
  const resolveRows = (names: readonly string[]): SignatureResolutionRow[] =>
    names.map((name) => routeByName.get(name) ?? {
      name,
      status: "missing",
      targetId: "",
    });
  return {
    candidates,
    options: {
      resolutions: [...routeByName.values()],
      externalCallables: [{
        name: `${targetPrefix}End`,
        targetId: `${targetPrefix}End`,
        scheme: {
          quantified: [],
          body: { $arrow: { params: [], returns: chainType } },
        },
        trust: { $tag: "TrustedPrimitive", evidence: "test-constructor" },
      }, {
        name: `${targetPrefix}Next`,
        targetId: `${targetPrefix}Next`,
        scheme: {
          quantified: [],
          body: {
            $arrow: {
              params: [positionalField("_0", 0, chainType)],
              returns: chainType,
            },
          },
        },
        trust: { $tag: "TrustedPrimitive", evidence: "test-constructor" },
      }],
      resolveCandidateReferences: (_functionId, names) => resolveRows(names),
      constructorSlotsForCandidate: () => ({
        End: [],
        Next: [{
          key: { $tag: "PositionalField", index: 0 },
          wireName: "_0",
          type: { $ref: "Chain" },
        }],
      }),
    },
  };
}

function signatureSnapshot(
  finalized: ReturnType<typeof finalizeRegistryFunctionSignatures>,
  ids: readonly string[],
): Record<string, Pick<FunctionSignatureInfo, "scheme" | "outcome" | "trust">> {
  const byId = new Map(finalized.map((row) => [row.fn.id, row.info] as const));
  return Object.fromEntries(ids.map((id) => {
    const info = byId.get(id);
    if (info === undefined) throw new Error(`missing signature info for ${id}`);
    return [id, { scheme: info.scheme, outcome: info.outcome, trust: info.trust }];
  }));
}

describe("signature inference SCC derivation evidence", () => {
  test("independent SCC evidence is stable under candidate permutation", () => {
    const a = candidate("scc-evidence:a", 1);
    const z = candidate("scc-evidence:z", "done");

    const forward = evidenceById([a, z]);
    const reversed = evidenceById([z, a]);

    expect(reversed).toEqual(forward);
    expect(forward["scc-evidence:a"]).toEqual(expect.objectContaining({
      scc: false,
      sccId: "scc-evidence:a",
      sccSize: 1,
    }));
    expect(forward["scc-evidence:z"]).toEqual(expect.objectContaining({
      scc: false,
      sccId: "scc-evidence:z",
      sccSize: 1,
    }));
  }, 180_000);

  test("a self-recursive singleton is distinct from an acyclic singleton", () => {
    const self = candidate("scc-evidence:self", {
      call: ["scc-evidence:self"],
    });

    expect(evidenceById([self])["scc-evidence:self"]).toEqual(
      expect.objectContaining({
        scc: true,
        sccId: "scc-evidence:self",
        sccSize: 1,
      }),
    );
  }, 180_000);

  test("mutual members share one canonical id and exact size under permutation", () => {
    const a = candidate("scc-evidence:a", { call: ["scc-evidence:z"] });
    const z = candidate("scc-evidence:z", { call: ["scc-evidence:a"] });
    const resolutions: SignatureResolutionRow[] = [];

    const forward = evidenceById([a, z], resolutions);
    const reversed = evidenceById([z, a], [...resolutions].reverse());

    expect(reversed).toEqual(forward);
    expect(forward["scc-evidence:a"]).toEqual(expect.objectContaining({
      scc: true,
      sccSize: 2,
    }));
    expect(forward["scc-evidence:z"]).toEqual(expect.objectContaining({
      scc: true,
      sccSize: 2,
    }));
    expect(forward["scc-evidence:a"]!.sccId).toBe(
      forward["scc-evidence:z"]!.sccId,
    );
  }, 180_000);

  test("a structurally decreasing mutual SCC publishes generalized trusted schemes stably", () => {
    const moduleName = "scc-structural-acceptance";
    const ids = [
      `${moduleName}:decreasingLeft`,
      `${moduleName}:decreasingRight`,
    ];
    const forwardFixture = mutualFixture(moduleName, true, false);
    const reversedFixture = mutualFixture(moduleName, true, true);
    const forwardRows = finalizeRegistryFunctionSignatures(
      forwardFixture.candidates,
      forwardFixture.options,
    );
    const reversedRows = finalizeRegistryFunctionSignatures(
      reversedFixture.candidates,
      reversedFixture.options,
    );
    const forward = signatureSnapshot(forwardRows, ids);
    const reversed = signatureSnapshot(reversedRows, ids);

    expect(reversed).toEqual(forward);
    for (const id of ids) {
      const info = forward[id]!;
      expect(info.outcome.$tag).toBe("Solved");
      expect(info.outcome).toEqual(expect.objectContaining({
        derivation: expect.objectContaining({
          engine: "fenel-rank1",
          scc: true,
          sccSize: 2,
        }),
      }));
      expect(info.trust.$tag).toBe("InferredDerivation");
      expect(info.scheme.quantified).toHaveLength(1);
      if (!("$arrow" in info.scheme.body)) throw new Error(`${id}: expected arrow scheme`);
      const arrow = info.scheme.body.$arrow;
      expect(arrow.params).toHaveLength(2);
      expect(arrow.params[0]!.type).toEqual({ $ref: "Chain" });
      expect(arrow.params[1]!.type).toEqual(arrow.returns);
      expect(arrow.returns).toEqual({ $var: info.scheme.quantified[0]!.sourceName });
    }
  }, 360_000);

  test("a nondecreasing mutual SCC remains Advisory and unavailable as a callable fact", () => {
    const moduleName = "scc-nondecreasing-acceptance";
    const ids = [
      `${moduleName}:nondecreasingLeft`,
      `${moduleName}:nondecreasingRight`,
    ];
    const fixture = mutualFixture(moduleName, false, false);
    const finalized = finalizeRegistryFunctionSignatures(
      fixture.candidates,
      fixture.options,
    );
    const byId = new Map(finalized.map((row) => [row.fn.id, row] as const));
    const liveContext = {
      getFunction: (id: string) => byId.get(id)?.fn,
      getFunctionSignatureInfo: (id: string) => byId.get(id)?.info,
    };

    for (const id of ids) {
      const info = byId.get(id)?.info;
      expect(info?.outcome.$tag).toBe("Solved");
      expect(info?.trust.$tag).toBe("Advisory");
      expect(__invokeDeciderRegistryReadNativeForTests(
        "fnTypeMarker",
        liveContext,
        id,
      )).toEqual(expect.objectContaining({
        $tag: "Just",
        _0: expect.objectContaining({ trusted: false }),
      }));
    }
  }, 180_000);

  test("recursive SCC return closure preserves canonical heterogeneous output unions", () => {
    const moduleName = "scc-heterogeneous-return";
    const ids = [
      `${moduleName}:decreasingLeft`,
      `${moduleName}:decreasingRight`,
    ];
    const forwardFixture = mutualFixture(moduleName, true, false, false, [0, "done"]);
    const reversedFixture = mutualFixture(moduleName, true, true, false, [0, "done"]);
    const forward = signatureSnapshot(finalizeRegistryFunctionSignatures(
      forwardFixture.candidates,
      forwardFixture.options,
    ), ids);
    const reversed = signatureSnapshot(finalizeRegistryFunctionSignatures(
      reversedFixture.candidates,
      reversedFixture.options,
    ), ids);

    expect(reversed).toEqual(forward);
    for (const id of ids) {
      const info = forward[id]!;
      expect(info.trust.$tag).toBe("InferredDerivation");
      expect(info.scheme.quantified).toHaveLength(0);
      if (!("$arrow" in info.scheme.body)) throw new Error(`${id}: expected arrow scheme`);
      const returns = info.scheme.body.$arrow.returns;
      expect("$union" in returns ? returns.$union : undefined).toHaveLength(2);
    }
  }, 360_000);

  test("recursive return elimination does not cross a nested output constructor", () => {
    const fixture = mutualFixture(
      "scc-nested-return-occurs",
      true,
      false,
      true,
    );
    expect(() => finalizeRegistryFunctionSignatures(
      fixture.candidates,
      fixture.options,
    )).toThrow(/inference\.occurs-check/);
  }, 180_000);

  test("ordinary x ~ List x constraints retain the occurs-check fence", () => {
    const a: FenelType = { $var: "a" };
    const b: FenelType = { $var: "b" };
    const listA = List(a);
    const wrapParam = positionalField("_0", 0, a);
    const sameParams = [
      positionalField("_0", 0, b),
      positionalField("_1", 1, b),
    ];
    const wrap = {
      params: [wrapParam],
      returns: listA,
      scheme: {
        quantified: [{ id: "wrap:q0", sourceName: "a", kind: { $tag: "KType" } as const }],
        body: { $arrow: { params: [wrapParam], returns: listA } },
      },
    };
    const same = {
      params: sameParams,
      returns: { $ref: "Boolean" } satisfies FenelType,
      scheme: {
        quantified: [{ id: "same:q0", sourceName: "b", kind: { $tag: "KType" } as const }],
        body: { $arrow: { params: sameParams, returns: { $ref: "Boolean" } } },
      },
    };
    const result = inferJsonLogicType({
      fn: [["x"], {
        call: ["same", { var: "x" }, { call: ["wrap", { var: "x" }] }],
      }],
    }, {
      resolveFunction: (id) => id === "wrap" ? wrap : id === "same" ? same : undefined,
    });

    expect(result.outcome.$tag).toBe("Invalid");
    if (result.outcome.$tag !== "Invalid") return;
    expect(result.outcome.diagnostics.map(({ code }) => code)).toContain(
      "inference.occurs-check",
    );
  }, 180_000);

  test("a let inside an SCC member cannot generalize the member's own monomorphic return", () => {
    // f's recursive-monomorphic row is a callable, not an environment row: before
    // the fix `let g = f` quantified f's return meta, so `num (g x)` and
    // `str (g x)` both checked and lgscc:f published `a0 -> String`.
    const module = loadFenelModule([
      "module lgscc where",
      "",
      "num : (n: Number) -> Number",
      "num n = n",
      "",
      "str : (s: String) -> String",
      "str s = s",
      "",
      "f x =",
      "  let g = f",
      "  let a = num (g x)",
      "  str (g x)",
    ].join("\n"), "lgscc");
    expect(() => createRegistry([module])).toThrow(/inference\.nominal-mismatch/);
  }, 600_000);
});

describe("recursive inference trust over real routing rows (2026-10-03)", () => {
  test("a countdown earns trust only with a bounded guard over the std primitives", () => {
    // The registry's routing rows send `>` / `<=` / `-` / `&&` to std:gt,
    // std:lte, std:sub, std:and; the size-change oracle reads facts only off
    // those ids, and a unit decrement needs n > 0, n <= 2^53 and n a number.
    const countdowns = loadFenelModule([
      "module cdp where",
      "",
      "cd n = if n > 0 && n <= 1000 then cd (n - 1) else 0",
      "",
      "cu n = if n > 0 then cu (n - 1) else 0",
    ].join("\n"), "cdp");
    // A module that defines its own gt and sub: its countdown never descends.
    const userPrimitives = loadFenelModule([
      "module cdu where",
      "",
      "gt a b = True",
      "",
      "sub a b = a",
      "",
      "loop n = if gt n 0 && lte n 1000 then loop (sub n 1) else 0",
    ].join("\n"), "cdu");
    // Separate registries: beside cdu, the bare `gt` of cdp would be ambiguous.
    const withStd = createRegistry([...modulesFor("execute"), countdowns]);
    const trust = (id: string) => withStd.getFunctionSignatureInfo(id)?.trust.$tag;
    expect(trust("cdp:cd")).toBe("InferredDerivation");
    // 1e20 - 1 = 1e20: the unbounded countdown is no descent over JS Numbers.
    expect(trust("cdp:cu")).toBe("Advisory");
    const withUser = createRegistry([...modulesFor("execute"), userPrimitives]);
    expect(withUser.getFunctionSignatureInfo("cdu:loop")?.trust.$tag).toBe("Advisory");
  }, 900_000);
});
