import { describe, expect, test } from "bun:test";

import { evaluate } from "./json-logic";
import { engineModule } from "./modules/engine";
import { stdModule } from "./modules/std";
import { createEngineBootstrapRegistry } from "./registry";

type GraphCandidate = {
  readonly id: string;
  readonly callees: readonly string[];
};

const bootstrapRegistry = createEngineBootstrapRegistry([stdModule, engineModule]);
const bootstrapContext = bootstrapRegistry.evaluateContext();

function invoke(fnId: string, args: readonly unknown[]): unknown {
  const inputs = Object.fromEntries(args.map((value, index) => [`argument:${index}`, value]));
  return evaluate(
    { call: [fnId, ...args.map((_, index) => ({ var: `argument:${index}` }))] },
    inputs,
    bootstrapContext,
  );
}

function groupIds(raw: unknown): string[][] {
  return (raw as readonly (readonly { readonly id: string }[])[])
    .map((group) => group.map(({ id }) => id));
}

function indexedPartition(candidates: readonly GraphCandidate[]): string[][] {
  return groupIds(indexedGroups(candidates));
}

// The unchanged complete closure and grouping are independent of the public selector.
function indexedGroups(candidates: readonly GraphCandidate[]): unknown {
  const [, directRows] = preparedGraph(candidates);
  const closed = invoke("engine:inferenceSccCloseReachRows", [directRows]);
  return invoke("engine:inferenceSccIndexedGroups", [candidates, closed]);
}

function publicPartition(candidates: readonly GraphCandidate[]): string[][] {
  return groupIds(invoke(
    "engine:inferenceTopLevelSccPartition",
    [candidates, []],
  ));
}

// C1: retain source-owned candidate projection before the typed graph boundary.
function preparedGraph(candidates: readonly GraphCandidate[]): readonly unknown[] {
  const roots = invoke("engine:inferenceCandidateIds", [candidates]);
  const candidateIndex = invoke("engine:inferenceSccNameIndex", [roots]);
  const directRows = invoke("engine:inferenceSccDirectRows", [candidates, candidateIndex]);
  return [roots, directRows, candidates];
}

function walkPartition(candidates: readonly GraphCandidate[]): string[][] {
  return groupIds(invoke(
    "engine:inferenceSccWalkPartitionFromRows",
    preparedGraph(candidates),
  ));
}

function adaptivePartition(candidates: readonly GraphCandidate[]): string[][] {
  return groupIds(invoke(
    "engine:inferenceSccAdaptivePartitionFromRows",
    preparedGraph(candidates),
  ));
}

function flatClosureOracle(candidates: readonly GraphCandidate[]): string[][] {
  const seen = new Set<string>();
  const edges: { readonly from: string; readonly to: string }[] = [];
  const candidateIds = new Set(candidates.map(({ id }) => id));
  for (const candidate of candidates) {
    for (const target of candidate.callees) {
      if (!candidateIds.has(target)) continue;
      const key = `${candidate.id}\0${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: candidate.id, to: target });
    }
  }
  const closure = invoke(
    "engine:anaReachClose",
    [candidates.length + 1, edges],
  );
  return groupIds(invoke(
    "engine:anaGroupByGo",
    [candidates, candidates, closure, []],
  ));
}

describe("indexed Fenel SCC partition", () => {
  test("is byte-ordered-equivalent to the shipped flat-closure oracle", () => {
    let seed = 0x5eed1234;
    const random = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };

    for (let sample = 0; sample < 24; sample += 1) {
      const ids = Array.from({ length: 10 }, (_, index) =>
        sample === 0 && index === 0
          ? "__proto__"
          : sample === 0 && index === 1
          ? "constructor"
          : `sample-${sample}:${index}`
      );
      const candidates = ids.map((id, index) => ({
        id,
        callees: ids.filter((_, targetIndex) =>
          random() < 0.16 || (sample % 5 === 0 && index === targetIndex)
        ),
      }));

      const indexed = indexedPartition(candidates);
      expect(indexed).toEqual(flatClosureOracle(candidates));
      expect(publicPartition(candidates)).toEqual(indexed);
      expect(walkPartition(candidates)).toEqual(indexed);
      expect(adaptivePartition(candidates)).toEqual(indexed);
    }
  }, 180_000);

  test("keeps external sinks out and preserves hostile-id cycle ordering", () => {
    const candidates: GraphCandidate[] = [
      { id: "__proto__", callees: ["constructor", "outside"] },
      { id: "constructor", callees: ["__proto__"] },
      { id: "tail", callees: ["constructor"] },
    ];

    expect(indexedPartition(candidates)).toEqual([
      ["__proto__", "constructor"],
      ["tail"],
    ]);
    expect(walkPartition(candidates)).toEqual(indexedPartition(candidates));
    expect(adaptivePartition(candidates)).toEqual(indexedPartition(candidates));
    expect(publicPartition(candidates)).toEqual(indexedPartition(candidates));
  });

  test("walk agrees on every three-node graph without self edges", () => {
    const ids = ["2", "__proto__", "10"];
    const possibleEdges = ids.flatMap((from, fromIndex) =>
      ids.filter((_, toIndex) => fromIndex !== toIndex).map((to) => ({ from, to }))
    );
    for (let mask = 0; mask < 2 ** possibleEdges.length; mask += 1) {
      const candidates = ids.map((id) => ({
        id,
        callees: possibleEdges
          .filter((edge, index) => edge.from === id && (mask & (1 << index)) !== 0)
          .map(({ to }) => to),
      }));
      expect(walkPartition(candidates)).toEqual(indexedPartition(candidates));
      expect(adaptivePartition(candidates)).toEqual(indexedPartition(candidates));
      expect(publicPartition(candidates)).toEqual(indexedPartition(candidates));
    }
  }, 180_000);

  test("walk preserves first-duplicate adjacency, duplicate payloads and input data", () => {
    const candidates = [
      { id: "duplicate", callees: [], payload: "first" },
      { id: "other", callees: ["duplicate", "outside"], payload: "middle" },
      { id: "duplicate", callees: ["other"], payload: "last" },
    ];
    const before = JSON.stringify(candidates);
    const pilot = invoke("engine:inferenceSccWalkPartitionFromRows", preparedGraph(candidates));
    expect(pilot).toEqual(indexedGroups(candidates));
    expect(pilot).toEqual([[candidates[0], candidates[2]], [candidates[1]]]);
    expect(invoke("engine:inferenceSccAdaptivePartitionFromRows", preparedGraph(candidates))).toEqual(pilot);
    expect(invoke("engine:inferenceTopLevelSccPartition", [candidates, []])).toEqual(pilot);
    expect(JSON.stringify(candidates)).toBe(before);
  });

  test("walk retains empty and hostile ids, repeated edges, self loops and disconnected groups", () => {
    const candidates: GraphCandidate[] = [
      { id: "10", callees: ["2", "2", "outside"] },
      { id: "", callees: ["constructor"] },
      { id: "2", callees: ["10"] },
      { id: "constructor", callees: [""] },
      { id: "__proto__", callees: ["toString"] },
      { id: "toString", callees: ["__proto__"] },
      { id: "$tag", callees: ["$tag", "$tag"] },
      { id: "hasOwnProperty", callees: [] },
    ];
    expect(walkPartition([])).toEqual([]);
    expect(adaptivePartition([])).toEqual([]);
    expect(publicPartition([])).toEqual([]);
    expect(walkPartition(candidates)).toEqual(indexedPartition(candidates));
    expect(adaptivePartition(candidates)).toEqual(indexedPartition(candidates));
    expect(publicPartition(candidates)).toEqual(indexedPartition(candidates));
    expect(walkPartition(candidates)).toEqual([
      ["10", "2"], ["", "constructor"], ["__proto__", "toString"],
      ["$tag"], ["hasOwnProperty"],
    ]);
  });

  test("walk consumes the exact two-node cycle bound and finishes its linked stack", () => {
    const raw = invoke("engine:inferenceSccWalk", [
      { "scc/a": ["b"], "scc/b": ["a"] }, ["a", "b"], Array(6).fill(true), true,
    ]) as { rootOffset: number; stack: unknown; visited: unknown; finished: unknown };
    expect(raw.rootOffset).toBe(2);
    expect(raw.stack).toEqual({ $tag: "Nothing" });
    expect(raw.visited).toEqual({ a: "a", b: "a" });
    expect(raw.finished).toEqual(["a", "b"]);
  });

  test("adaptive probe closes at two layers and keeps one-extra-layer chains and cycles unfinished", () => {
    const chain = (count: number): GraphCandidate[] => Array.from({ length: count }, (_, index) => ({
      id: `node:${index}`,
      callees: index + 1 < count ? [`node:${index + 1}`] : [],
    }));
    const cycle = (count: number): GraphCandidate[] => Array.from({ length: count }, (_, index) => ({
      id: `cycle:${index}`,
      callees: [`cycle:${(index + 1) % count}`],
    }));
    for (const [connected, done] of [[chain(3), true], [chain(4), false], [cycle(2), true], [cycle(3), false]] as const) {
      const candidates = [...connected, ...Array.from({ length: 5 - connected.length }, (_, index) => ({
        id: `isolated:${index}`, callees: [],
      }))];
      const directRows = candidates.map(({ id, callees }) => ({ id, direct: callees }));
      const probe = invoke("engine:inferenceSccShallowReachRows", [directRows]) as {
        done: boolean;
        rows: { frontier: string[] }[];
      };
      expect(probe.done).toBe(done);
      expect(probe.rows.some(({ frontier }) => frontier.length > 0)).toBe(!done);
      expect(adaptivePartition(candidates)).toEqual(indexedPartition(candidates));
      expect(publicPartition(candidates)).toEqual(indexedPartition(candidates));
    }
  });

  test("adaptive DFS fallback retains duplicate full payloads at the one-extra-layer boundary", () => {
    const candidates = [
      { id: "__proto__", callees: ["constructor"], payload: { position: 0 } },
      { id: "constructor", callees: ["2"], payload: { position: 1 } },
      { id: "2", callees: ["10"], payload: { position: 2 } },
      { id: "10", callees: [], payload: { position: 3 } },
      { id: "__proto__", callees: ["10", "outside"], payload: { position: 4 } },
    ];
    const before = JSON.stringify(candidates);
    const baseline = indexedGroups(candidates);
    expect(invoke("engine:inferenceSccAdaptivePartitionFromRows", preparedGraph(candidates))).toEqual(baseline);
    expect(invoke("engine:inferenceTopLevelSccPartition", [candidates, []])).toEqual(baseline);
    expect(baseline).toEqual([[candidates[0], candidates[4]], [candidates[1]], [candidates[2]], [candidates[3]]]);
    expect(JSON.stringify(candidates)).toBe(before);
  });

  test("closes a 129-node longest-path graph without recursive host frames", () => {
    const count = 129;
    const candidates = Array.from({ length: count }, (_, index) => {
      const id = `chain:${String(index).padStart(3, "0")}`;
      return {
        id,
        callees: index + 1 < count
          ? [`chain:${String(index + 1).padStart(3, "0")}`]
          : [],
      };
    });

    expect(indexedPartition(candidates)).toEqual(
      candidates.map(({ id }) => [id]),
    );
    expect(walkPartition(candidates)).toEqual(candidates.map(({ id }) => [id]));
    expect(adaptivePartition(candidates)).toEqual(candidates.map(({ id }) => [id]));
    expect(publicPartition(candidates)).toEqual(candidates.map(({ id }) => [id]));
  }, 180_000);
});
