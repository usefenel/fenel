import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import {
  encodeCanonicalJson,
  expectClosedKeys,
  expectWireArray,
  expectWireRecord,
  expectWireString,
} from "./lib/artifact-wire-json";
import {
  decodeMatrixReportResult,
  matrixAcquisitionKeys,
  projectMatrixInstanceFacets,
  validateMatrixAcquisitionRoster,
} from "./generate-self-host-matrix";
import {
  dispatchEngineBody,
  harnessConstructible,
  harnessForTests,
} from "../src/engine-bodies-dispatch";
import {
  bootParseDeficits,
  fenelModuleLoadDepth,
} from "../src/engine-require";
import { loadFenelModule, resolveLocalCallHeads } from "../src/fenel-module";
import { parse } from "../src/fenel-parser";
import { evaluate, invokeCallable, type EvaluateContext } from "../src/json-logic";
import type { FenelFunction } from "../src/types";
import { Nothing } from "../src/maybe-value";
import { stdNatives, stdNativesCtx } from "../../../../fenel/modules/std/ffi/std-ffi";
import {
  parseCacheHas,
  parseProvenanceCounts,
} from "../src/parse-cache";
import { createRegistry } from "../src/registry";

const reportSource = readFileSync(
  resolve(import.meta.dir, "self-host-matrix-report.fenel"),
  "utf8",
);

// C1/C2: retain source-owned duplicate and ordering judgments as independent
// tooling oracles. Only definition lookup is replaced in local test contexts.
const beforeFacetProjectionAndSectionsSource = String.raw`
module matrixreport where

matrixProjectFacets : List MatrixFacetObservation -> MatrixFacetProjection
matrixProjectFacets observations =
  fold matrixAddFacetObservation { ok = true, error = "", entries = [] } observations

matrixOrderedAreas : List MatrixRow -> List String
matrixOrderedAreas rows =
  let areas = fold matrixUniqueAreaStep [] rows
  let fixed = filter (\area -> matrixContainsString area areas) (matrixFixedAreas "v1")
  let stdAreas = matrixSortStrings (filter matrixIsStdArea areas)
  let telegram = if matrixContainsString "telegram" areas then ["telegram"] else []
  let looseAreas = filter matrixIsLooseArea areas
  let other = looseAreas
  concat fixed (concat stdAreas (concat telegram other))

matrixRenderSections : List MatrixRow -> String
matrixRenderSections rows =
  join (filter (\section -> not (eq section "")) (map (matrixRenderSection rows) (matrixOrderedAreas rows))) "\n"
`;

// C1: frozen pre-index Fenel oracle. The baseline keeps the authored first-match
// lookup and row builder, rather than duplicating their meaning in TypeScript.
const beforeFacetAttachmentSource = String.raw`
module matrixreport where

matrixAttachFacet : List MatrixFacetEntry -> MatrixFunction -> MatrixRow
matrixAttachFacet facets fn =
  case matrixFindFacet fn.fnId facets of
    Nothing ->
      { fnId = fn.fnId
      , codeName = matrixCodeName fn.fnId
      , bodyPresent = fn.bodyPresent
      , categoryPresent = false
      , category = ""
      , tagsPresent = false
      , tags = []
      , js = fn.js
      , wasm = fn.wasm
      , llvm = fn.llvm
      }
    Just facet ->
      { fnId = fn.fnId
      , codeName = matrixCodeName fn.fnId
      , bodyPresent = fn.bodyPresent
      , categoryPresent = facet.categoryPresent
      , category = facet.category
      , tagsPresent = facet.tagsPresent
      , tags = facet.tags
      , js = fn.js
      , wasm = fn.wasm
      , llvm = fn.llvm
      }

matrixBuildRows : List MatrixFunction -> List MatrixFacetEntry -> List MatrixRow
matrixBuildRows functions facets =
  matrixSortRows (map (matrixAttachFacet facets) functions)
`;

type FacetFixtureCounts = { equality: number; indexBuilds: number; indexedEntries: number; lookups: number };

function facetAttachmentFixture(before: boolean) {
  const projectionEnd = reportSource.indexOf("-- Stable ordering and row projection");
  const codeNameStart = reportSource.indexOf("matrixCodeName :");
  const attachmentStart = reportSource.indexOf("matrixAttachFacet :");
  const rowEnd = reportSource.indexOf("-- -------------------------------------------------------------------------", attachmentStart);
  if (projectionEnd < 0 || codeNameStart <= projectionEnd || attachmentStart <= codeNameStart || rowEnd <= attachmentStart) {
    throw new Error("facet attachment fixture source boundaries are missing or out of order");
  }
  const sources = [
    reportSource.slice(0, projectionEnd),
    `module matrixreport where\n${reportSource.slice(codeNameStart, attachmentStart)}`,
    before ? beforeFacetAttachmentSource : `module matrixreport where\n${reportSource.slice(attachmentStart, rowEnd)}`,
    readFileSync(resolve(import.meta.dir, "../../../../fenel/modules/std/appendItem.fenel"), "utf8"),
    readFileSync(resolve(import.meta.dir, "../../../../fenel/modules/std/fromMaybe.fenel"), "utf8"),
    ...(before ? [beforeFacetProjectionAndSectionsSource] : []),
  ];
  const functions = new Map<string, FenelFunction>();
  // A bounded diagnostic seam, not parser provenance or production evidence.
  // The real Fenel parser and complete report are exercised below as well.
  for (const source of sources) {
    const program = parse(source) as { program: { def?: { name: string; params: string[]; body: unknown } }[] };
    for (const item of program.program) {
      if (item.def === undefined) continue;
      const definition = item.def;
      functions.set(definition.name, {
        id: definition.name,
        params: definition.params.map(name => ({
          name, type: { $complement: { $void: true } }, label: Nothing, ui: Nothing, meta: {},
        })),
        returns: { $complement: { $void: true } },
        body: resolveLocalCallHeads(definition.body, definition.params) as FenelFunction["body"],
      });
    }
  }
  let counts: FacetFixtureCounts = { equality: 0, indexBuilds: 0, indexedEntries: 0, lookups: 0 };
  let groupBuilds = 0;
  let sequentialCalls = 0;
  const context: EvaluateContext = {
    getFunction(name) {
      if (name === "matrixProjectFacetsSequential") sequentialCalls += 1;
      return functions.get(name);
    },
    natives: {
      ...stdNatives,
      eq: (...args) => { counts.equality += 1; return stdNatives.eq!(...args); },
      fromEntries: pairs => {
        counts.indexBuilds += 1;
        counts.indexedEntries += (pairs as unknown[]).length;
        return stdNatives.fromEntries!(pairs);
      },
      mapGet: (...args) => { counts.lookups += 1; return stdNatives.mapGet!(...args); },
      // Isolate attachment cost; the unchanged source ordering is verified by
      // the complete Fenel report oracle below and the existing sorting tests.
      matrixSortRows: rows => rows,
    },
    nativesCtx: {
      ...stdNativesCtx,
      groupBy: (...args) => { groupBuilds += 1; return stdNativesCtx.groupBy!(...args); },
    },
    _constructors: { Just: ["_0"], Nothing: [] },
    _dictStack: [],
    _activeTags: [],
  };
  return {
    project(observations: readonly object[]) {
      return invokeCallable("matrixProjectFacets", [observations], context);
    },
    projection(observations: readonly object[]) {
      counts = { equality: 0, indexBuilds: 0, indexedEntries: 0, lookups: 0 };
      groupBuilds = 0;
      sequentialCalls = 0;
      const result = invokeCallable("matrixProjectFacets", [observations], context);
      return { result, equality: counts.equality, groupBuilds, sequentialCalls };
    },
    rows(rows: readonly object[], facets: readonly object[]) {
      counts = { equality: 0, indexBuilds: 0, indexedEntries: 0, lookups: 0 };
      const result = invokeCallable("matrixBuildRows", [rows, facets], context);
      return { result, counts: { ...counts } };
    },
  };
}

const MATRIX_ROSTER = Object.freeze([
  "std", "codec", "dashboard", "email-webhooks", "notify", "webhooks",
  "subscriptions", "proxy-links", "pages", "receipt", "inventory", "purchases",
  "payments", "profiles", "imports", "items", "types", "plans", "entitlements",
  "channels", "action-result", "auth", "authority", "telegram", "engine",
  "locale", "events", "time", "animation", "path", "track", "email", "picture",
  "sound", "algebra", "compile-js", "compile-wasm", "compile-llvm", "runtime",
  "notion", "phase20",
]);

type MatrixTargetFixture = Readonly<{
  samples: number;
  gapPresent: boolean;
  gap: string;
  status: "OK" | "SKIP" | "FAIL" | "NO_SAMPLES";
  samplesCompared: number;
  reason: string;
}>;

function matrixTarget(overrides: Partial<MatrixTargetFixture> = {}): MatrixTargetFixture {
  return {
    samples: 0,
    gapPresent: false,
    gap: "",
    status: "NO_SAMPLES",
    samplesCompared: 0,
    reason: "",
    ...overrides,
  };
}

function evaluateMatrixReportFixture(
  reportRegistry: ReturnType<typeof createRegistry>,
  functions: readonly object[],
  instanceFacets: readonly object[],
): ReturnType<typeof decodeMatrixReportResult> {
  const sourceDigest = "0".repeat(64);
  return decodeMatrixReportResult(evaluate(
    {
      call: [
        "matrixreport:matrixReport",
        {
          presentation: { verified: "2026-08-12", verifiedAtSha: "abcdef0" },
          rosterKeys: MATRIX_ROSTER,
          functions,
          instanceFacets,
          reportSourceDigest: sourceDigest,
        },
      ],
    },
    {},
    reportRegistry.evaluateContext(),
  ), sourceDigest);
}

function expectFixtureBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${path} must be a boolean`);
  return value;
}

function decodeFacetProjection(value: unknown): Readonly<{
  ok: boolean;
  error: string;
  entries: readonly Readonly<{
    fnId: string;
    categoryPresent: boolean;
    category: string;
    tagsPresent: boolean;
    tags: readonly string[];
  }>[];
}> {
  const record = expectWireRecord(value, "facetProjection");
  expectClosedKeys(record, ["ok", "error", "entries"], [], "facetProjection");
  const entries = expectWireArray(record.entries, "facetProjection.entries").map((item, index) => {
    const path = `facetProjection.entries[${index}]`;
    const entry = expectWireRecord(item, path);
    expectClosedKeys(
      entry,
      ["fnId", "categoryPresent", "category", "tagsPresent", "tags"],
      [],
      path,
    );
    return Object.freeze({
      fnId: expectWireString(entry.fnId, `${path}.fnId`),
      categoryPresent: expectFixtureBoolean(entry.categoryPresent, `${path}.categoryPresent`),
      category: expectWireString(entry.category, `${path}.category`),
      tagsPresent: expectFixtureBoolean(entry.tagsPresent, `${path}.tagsPresent`),
      tags: Object.freeze(expectWireArray(entry.tags, `${path}.tags`).map((tag, tagIndex) =>
        expectWireString(tag, `${path}.tags[${tagIndex}]`))),
    });
  });
  return Object.freeze({
    ok: expectFixtureBoolean(record.ok, "facetProjection.ok"),
    error: expectWireString(record.error, "facetProjection.error"),
    entries: Object.freeze(entries),
  });
}

function matrixInstance(
  typeName: string,
  fnId: string,
  methods: Record<string, unknown>,
): object {
  return { typeName, args: [fnId], methods };
}

describe("self-host matrix indexed facet attachment", () => {
  test("matches the frozen Fenel first-match oracle for hostile, empty, duplicate and missing keys", () => {
    const before = facetAttachmentFixture(true);
    const indexed = facetAttachmentFixture(false);
    const functions = ["constructor", "missing", "__proto__", "toString", "hasOwnProperty", "odd:\u{1F600}"]
      .map(fnId => ({ fnId, bodyPresent: true, js: matrixTarget(), wasm: matrixTarget(), llvm: matrixTarget() }));
    const facets = [
      { fnId: "__proto__", categoryPresent: true, category: "first", tagsPresent: true, tags: ["b", "a"] },
      { fnId: "constructor", categoryPresent: true, category: "", tagsPresent: true, tags: [] },
      { fnId: "toString", categoryPresent: false, category: "", tagsPresent: true, tags: ["own"] },
      { fnId: "odd:\u{1F600}", categoryPresent: true, category: "unicode|`\\", tagsPresent: false, tags: [] },
      { fnId: "__proto__", categoryPresent: true, category: "later", tagsPresent: true, tags: ["wrong"] },
      { fnId: "unused", categoryPresent: true, category: "unused", tagsPresent: false, tags: [] },
    ];
    const result = indexed.rows(functions, facets);
    expect(encodeCanonicalJson(result.result)).toEqual(encodeCanonicalJson(before.rows(functions, facets).result));
    expect(result.result).toMatchObject([
      { fnId: "constructor", categoryPresent: true, category: "", tagsPresent: true, tags: [] },
      { fnId: "missing", categoryPresent: false, category: "", tagsPresent: false, tags: [] },
      { fnId: "__proto__", categoryPresent: true, category: "first", tagsPresent: true, tags: ["b", "a"] },
      { fnId: "toString", categoryPresent: false, category: "", tagsPresent: true, tags: ["own"] },
      { fnId: "hasOwnProperty", categoryPresent: false, category: "", tagsPresent: false, tags: [] },
      { fnId: "odd:\u{1F600}", categoryPresent: true, category: "unicode|`\\", tagsPresent: false, tags: [] },
    ]);
    expect(result.counts).toEqual({ equality: functions.length, indexBuilds: 1, indexedEntries: facets.length, lookups: functions.length });
    expect(indexed.rows(functions, []).result).toEqual(before.rows(functions, []).result);
    expect(indexed.rows([], facets).result).toEqual([]);
  });

  test("retains the Fenel observation duplicate judgment before indexing", () => {
    const before = facetAttachmentFixture(true);
    const indexed = facetAttachmentFixture(false);
    const category = { typeName: "Categorizable", fnId: "__proto__", valueString: "", valueStrings: [] };
    const tags = { typeName: "Taggable", fnId: "constructor", valueString: "", valueStrings: ["b", "a"] };
    for (const observations of [
      [category, { ...category }, tags, { ...tags, valueStrings: [...tags.valueStrings] }],
      [category, { ...category, valueString: "different" }, tags],
      [tags, { ...tags, valueStrings: ["a", "b"] }, category],
    ]) {
      expect(encodeCanonicalJson(indexed.project(observations))).toEqual(encodeCanonicalJson(before.project(observations)));
    }
    expect(decodeFacetProjection(indexed.project([category, { ...category }])).ok).toBe(true);
    expect(decodeFacetProjection(indexed.project([category, { ...category, valueString: "different" }])).error)
      .toBe("divergent Categorizable duplicate for __proto__");
    expect(decodeFacetProjection(indexed.project([tags, { ...tags, valueStrings: ["a", "b"] }])).error)
      .toBe("divergent Taggable duplicate for constructor");
  });

  test("builds one linear index instead of rescanning facets at 100, 200 and 400 rows", () => {
    const before = facetAttachmentFixture(true);
    const indexed = facetAttachmentFixture(false);
    const measurements: object[] = [];
    for (const count of [100, 200, 400]) {
      const facets = Array.from({ length: count }, (_, index) => ({
        fnId: `bench:${String(index).padStart(4, "0")}`,
        categoryPresent: true, category: "bench", tagsPresent: true, tags: ["bench"],
      }));
      const functions = facets.map(({ fnId }) => ({ fnId, bodyPresent: true, js: matrixTarget(), wasm: matrixTarget(), llvm: matrixTarget() }));
      const beforeStart = performance.now();
      const baseline = before.rows(functions, facets);
      const beforeMs = performance.now() - beforeStart;
      const indexedStart = performance.now();
      const result = indexed.rows(functions, facets);
      const indexedMs = performance.now() - indexedStart;
      expect(encodeCanonicalJson(result.result)).toEqual(encodeCanonicalJson(baseline.result));
      expect(baseline.counts).toEqual({ equality: count * (count + 3) / 2, indexBuilds: 0, indexedEntries: 0, lookups: 0 });
      expect(result.counts).toEqual({ equality: count, indexBuilds: 1, indexedEntries: count, lookups: count });
      measurements.push({ rows: count, beforeMs, indexedMs, beforeCounts: baseline.counts, indexedCounts: result.counts });
    }
    // Times describe this isolated fixture only; deterministic counts enforce
    // the scaling improvement without a timing gate on a shared machine.
    console.info("[matrix-facet-attachment]", JSON.stringify(measurements));
  });

  test("groups observations once and replays the original first-conflict cutoff", () => {
    const before = facetAttachmentFixture(true);
    const current = facetAttachmentFixture(false);
    const category = (fnId: string, valueString = "") => ({
      typeName: "Categorizable", fnId, valueString, valueStrings: [],
    });
    const tags = (fnId: string, valueStrings: string[] = []) => ({
      typeName: "Taggable", fnId, valueString: "", valueStrings,
    });
    const conflicts = [
      category("a", "first"), category("b", "first"),
      category("b", "first-conflict"), category("a", "later-conflict"),
      tags("after", ["past-cutoff"]),
    ];
    const refusal = current.projection(conflicts);
    expect(refusal.result).toEqual(before.projection(conflicts).result);
    expect(decodeFacetProjection(refusal.result).error)
      .toBe("divergent Categorizable duplicate for b");
    expect(refusal.groupBuilds).toBe(1);
    expect(refusal.sequentialCalls).toBe(4);
    const hostile = ["__proto__", "constructor", "toString", "0", "42", "", "odd:\u{1F600}"]
      .flatMap(fnId => [tags(fnId), category(fnId), category(fnId)]);
    expect(current.projection(hostile).result).toEqual(before.projection(hostile).result);
    for (const size of [100, 200, 400]) {
      const observations = [
        ...Array.from({ length: size }, (_, i) => category(`bench:${i}`, "category")),
        ...Array.from({ length: size }, (_, i) => tags(`bench:${i}`, ["tag-a", "tag-b"])),
      ];
      const baseline = before.projection(observations);
      const grouped = current.projection(observations);
      expect(grouped.result).toEqual(baseline.result);
      expect(baseline.equality).toBe(2 * size * size + 3 * size);
      expect(grouped.equality).toBe(9 * size);
      expect(grouped.groupBuilds).toBe(1);
      expect(grouped.sequentialCalls).toBe(size);
    }
  });
});

describe("self-host matrix descriptor-safe facet projection", () => {
  test("projects canonical facets, preserves present-empty values, and accepts exact duplicates", () => {
    const modules = [{
      instances: [
        matrixInstance("Categorizable", "std:.", { category: "" }),
        matrixInstance("Categorizable", "std:.", { category: "" }),
        matrixInstance("Taggable", "std:.", { tags: ["function", "operator"] }),
        matrixInstance("Taggable", "std:.", { tags: ["function", "operator"] }),
        { typeName: "Unrelated", args: null, methods: null },
      ],
    }];
    expect(projectMatrixInstanceFacets(modules)).toEqual([
      { typeName: "Categorizable", fnId: "std:.", valueString: "", valueStrings: [] },
      { typeName: "Categorizable", fnId: "std:.", valueString: "", valueStrings: [] },
      { typeName: "Taggable", fnId: "std:.", valueString: "", valueStrings: ["function", "operator"] },
      { typeName: "Taggable", fnId: "std:.", valueString: "", valueStrings: ["function", "operator"] },
    ]);
  });

  test("never invokes getters and rejects legacy, callable, malformed, and divergent facets", () => {
    let getterCalls = 0;
    const getterModules = Object.defineProperty([], "0", {
      get() { getterCalls += 1; return { instances: [] }; },
    });
    Object.defineProperty(getterModules, "length", { value: 1 });
    expect(() => projectMatrixInstanceFacets(getterModules)).toThrow("must be own dense data");
    expect(getterCalls).toBe(0);

    const accessorInstance = (key: "typeName" | "args" | "methods"): object => {
      const instance = matrixInstance("Categorizable", "x:y", { category: "a" });
      Object.defineProperty(instance, key, {
        get() { getterCalls += 1; return undefined; },
      });
      return instance;
    };
    for (const key of ["typeName", "args", "methods"] as const) {
      expect(() => projectMatrixInstanceFacets([{ instances: [accessorInstance(key)] }])).toThrow(
        "accessor properties are forbidden",
      );
      expect(getterCalls).toBe(0);
    }
    for (const [typeName, method] of [
      ["Categorizable", "category"],
      ["Taggable", "tags"],
    ] as const) {
      const methods = Object.defineProperty({}, method, {
        get() { getterCalls += 1; return undefined; },
      });
      expect(() => projectMatrixInstanceFacets([{
        instances: [matrixInstance(typeName, "x:y", methods)],
      }])).toThrow("accessor properties are forbidden");
      expect(getterCalls).toBe(0);
    }

    const getterModule = Object.defineProperty({}, "instances", {
      get() { getterCalls += 1; return []; },
    });
    expect(() => projectMatrixInstanceFacets([getterModule])).toThrow("accessor properties are forbidden");
    expect(getterCalls).toBe(0);

    expect(() => projectMatrixInstanceFacets([{
      instances: [{ ...matrixInstance("Categorizable", "x:y", { category: "a" }), class: "legacy" }],
    }])).toThrow("forbidden legacy identity field");
    expect(() => projectMatrixInstanceFacets([{
      instances: [matrixInstance("Categorizable", "x:y", { category: () => "a" })],
    }])).toThrow("callable values are forbidden");
    expect(() => projectMatrixInstanceFacets([{
      instances: [matrixInstance("Taggable", "x:y", { tags: ["a", 1] })],
    }])).toThrow("must be a string");
    expect(() => projectMatrixInstanceFacets([{
      instances: [{ typeName: "Categorizable", args: [123], methods: { category: "a" } }],
    }])).toThrow("exactly one non-empty string identity");
    expect(() => projectMatrixInstanceFacets([{
      instances: [
        matrixInstance("Categorizable", "x:y", { category: "a" }),
        matrixInstance("Categorizable", "x:y", { category: "b" }),
      ],
    }])).toThrow("divergent Categorizable duplicate");
    expect(() => projectMatrixInstanceFacets([{
      instances: [
        matrixInstance("Taggable", "x:y", { tags: ["a", "b"] }),
        matrixInstance("Taggable", "x:y", { tags: ["b", "a"] }),
      ],
    }])).toThrow("divergent Taggable duplicate");
  });

  test("rejects a non-empty error on an otherwise successful closed report result", () => {
    const sourceDigest = "0".repeat(64);
    expect(() => decodeMatrixReportResult({
      ok: true,
      error: "ignored-error",
      candidate: "candidate\n",
      rawRows: [],
      audit: {
        categoryCount: 0,
        categoryPreimage: "",
        tagCount: 0,
        tagPreimage: "",
        categorizableRepresentativeIds: [],
        taggableRepresentativeIds: [],
        rosterCount: 0,
        rosterKeys: [],
        rowCount: 0,
        declaredObservedAsymmetryCount: 0,
        declaredObservedAsymmetries: [],
        groupingFacts: [],
        reportSourceDigest: sourceDigest,
      },
    }, sourceDigest)).toThrow("must be empty when matrixReport.ok is true");
  });

  test("rejects every missing, extra, duplicate, or unused acquisition relation", () => {
    expect(() => validateMatrixAcquisitionRoster(["a", "a"], ["a", "b"])).toThrow(
      "roster contains duplicate keys",
    );
    expect(() => validateMatrixAcquisitionRoster(["a", "b"], ["a", "a"])).toThrow(
      "inventory contains duplicate keys",
    );
    expect(() => validateMatrixAcquisitionRoster(["a", "missing"], ["a", "b"])).toThrow(
      "missing matrix acquisition entry missing",
    );
    expect(() => validateMatrixAcquisitionRoster(["a"], ["a", "unused"])).toThrow(
      "unused matrix acquisition entry unused",
    );
    expect(() => validateMatrixAcquisitionRoster(["a", "b"], ["a", "b"])).not.toThrow();
  });

  test("transports only closed source-owned asymmetry entries with exact domains and counts", () => {
    const digest = "0".repeat(64);
    const entry = { fnId: "std:example", target: "js", className: "silent-skip", declared: "samples=1, no gap", observed: "SKIP (compile unavailable)" } as const;
    const report = {
      ok: true, error: "", candidate: "candidate\n", rawRows: [],
      audit: {
        categoryCount: 0, categoryPreimage: "", tagCount: 0, tagPreimage: "",
        categorizableRepresentativeIds: [], taggableRepresentativeIds: [],
        rosterCount: 0, rosterKeys: [], rowCount: 0,
        declaredObservedAsymmetryCount: 1, declaredObservedAsymmetries: [entry],
        groupingFacts: [], reportSourceDigest: digest,
      },
    };
    const decoded = decodeMatrixReportResult(report, digest);
    expect(decoded.audit.declaredObservedAsymmetries).toEqual([entry]);
    expect(Object.isFrozen(decoded.audit.declaredObservedAsymmetries)).toBe(true);
    expect(Object.isFrozen(decoded.audit.declaredObservedAsymmetries[0])).toBe(true);
    for (const bad of [
      { ...entry, extra: true }, { ...entry, target: "other" }, { ...entry, className: "other" },
      { ...entry, fnId: "" }, { ...entry, declared: "" }, { ...entry, observed: false },
      { fnId: entry.fnId, target: entry.target, className: entry.className, declared: entry.declared },
    ]) expect(() => decodeMatrixReportResult({ ...report, audit: { ...report.audit, declaredObservedAsymmetries: [bad] } }, digest)).toThrow();
    expect(() => decodeMatrixReportResult({ ...report, audit: { ...report.audit, declaredObservedAsymmetryCount: 0 } }, digest)).toThrow("count differs from its source entries");
    const { declaredObservedAsymmetries: _omitted, ...missing } = report.audit;
    expect(() => decodeMatrixReportResult({ ...report, audit: missing }, digest)).toThrow();
    expect(decodeMatrixReportResult({ ...report, audit: { ...report.audit, declaredObservedAsymmetryCount: 0, declaredObservedAsymmetries: [] } }, digest).audit.declaredObservedAsymmetries).toEqual([]);
  });
});

describe("self-host matrix Stage-0 report isolation", () => {
  test("direct worker-task selection is rejected before the report source is parsed", async () => {
    const before = parseProvenanceCounts();
    const { runMatrixWorker } = await import("./generate-self-host-matrix");
    await expect(runMatrixWorker([
      `--worker-request=${resolve(".m4-matrix-worker-request.json")}`,
    ])).rejects.toThrow("authorization was not immutably injected by the preload");
    expect(parseProvenanceCounts()).toEqual(before);
  }, 120_000);

  test("a fresh smoke worker loads no matrix classifier or roster cache", () => {
    const root = mkdtempSync(join(tmpdir(), "fenel-matrix-report-smoke-"));
    try {
      const requestPath = join(root, ".m4-matrix-worker-request.json");
      const privateDirectory = join(root, ".m4-private");
      const outputPath = join(privateDirectory, "report-smoke.json");
      mkdirSync(privateDirectory);
      const requestBytes = encodeCanonicalJson({
        schema: "fenel.self-host-matrix-worker-request.v1",
        task: "report-smoke",
        reportSource: "implementations/typescript/engine/scripts/self-host-matrix-report.fenel",
        outputs: { smoke: ".m4-private/report-smoke.json" },
      });
      writeFileSync(requestPath, requestBytes);

      const helperPath = join(root, "smoke-load-witness.mjs");
      const generatorUrl = pathToFileURL(resolve(import.meta.dir, "generate-self-host-matrix.ts")).href;
      writeFileSync(helperPath, `
import Module from "node:module";
const requestPath = process.argv[2];
const authorization = Object.freeze(JSON.parse(process.env.MATRIX_TEST_AUTHORIZATION));
Object.defineProperty(globalThis, "__FENEL_SELF_HOST_MATRIX_WORKER_AUTHORIZATION__", {
  value: authorization,
  enumerable: false,
  writable: false,
  configurable: false,
});
const { runMatrixWorker } = await import(${JSON.stringify(generatorUrl)});
await runMatrixWorker(["--worker-request=" + requestPath]);
const loaded = Object.keys(Module._cache ?? {}).map((path) => path.replaceAll("\\\\", "/")).sort();
process.stdout.write(JSON.stringify({ loaded }) + "\\n");
`);
      const authorization = JSON.stringify({
        schema: "fenel.self-host-matrix-worker-authorization.v1",
        requestPath,
        requestDigest: createHash("sha256").update(requestBytes).digest("hex"),
        task: "report-smoke",
      });
      const result = spawnSync(process.execPath, [
        "--no-env-file",
        "--no-install",
        helperPath,
        requestPath,
      ], {
        cwd: resolve(import.meta.dir, "../../../.."),
        env: { ...process.env, MATRIX_TEST_AUTHORIZATION: authorization },
        encoding: "utf8",
      });

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("generate-self-host-matrix.ts");
      expect(result.stdout).toContain("self-host-matrix-report.fenel");
      for (const forbidden of [
        "compile-js-self-host-classifier",
        "compile-wasm-self-host-classifier",
        "compile-llvm-self-host-classifier",
        "self-host-classification-cache",
      ]) {
        expect(result.stdout).not.toContain(forbidden);
      }
      expect(readFileSync(outputPath, "utf8")).toBe(
        '{"bootDeficitDelta":0,"loadDepthBefore":0,"provenanceDelta":{"fenel":1,"ts":0},"result":"matrix-report-isolated-v1","schema":"fenel.self-host-matrix-report-smoke.v1"}\n',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  test("cache-miss source parses in Fenel and runs only in a lock-less registry", async () => {
    expect(reportSource).toContain("module matrixreport where");
    expect(reportSource).not.toContain("module engine where");
    expect(parseCacheHas(reportSource)).toBe(false);

    // M1's documented tooling seam: pre-build the ordinary parser harness at
    // load depth zero, then parse the uncached tool source. This dependency is
    // parser initialization only; it is not a report-roster member.
    expect(fenelModuleLoadDepth()).toBe(0);
    expect(harnessConstructible()).toBe(true);
    harnessForTests();
    const beforeProvenance = parseProvenanceCounts();
    const beforeDeficits = bootParseDeficits().length;

    const reportModule = loadFenelModule(reportSource, "matrixreport");
    expect(parseProvenanceCounts()).toEqual({
      fenel: beforeProvenance.fenel + 1,
      ts: beforeProvenance.ts,
    });
    expect(bootParseDeficits()).toHaveLength(beforeDeficits);
    const reportFnIds = reportModule.functions?.map((fn) => fn.id) ?? [];
    expect(reportFnIds).toContain("matrixreport:matrixReportSmoke");
    expect(reportFnIds).toContain("matrixreport:matrixReportRoster");
    expect(reportFnIds).toContain("matrixreport:matrixReport");

    const smokeFunction = reportModule.functions?.find(
      (definition) => definition.id === "matrixreport:matrixReportSmoke",
    );
    expect(smokeFunction).toBeDefined();
    const registry = createRegistry([{
      name: reportModule.name,
      label: reportModule.label,
      functions: [smokeFunction!],
    }]);
    // Every current registry includes the existing authority checker bootstrap;
    // report isolation excludes classifiers and product modules beyond it.
    expect(registry.modules.map((module) => module.name)).toEqual(["authority", "matrixreport"]);
    expect(registry.getUuid("matrixreport:matrixReportSmoke")).toBeUndefined();
    expect(evaluate(
      { call: ["matrixreport:matrixReportSmoke", "stage-0"] },
      {},
      registry.evaluateContext(),
    )).toBe("matrix-report-isolated-v1");

    const { stdModule } = await import("@fenel/engine/modules/std");
    const reportRegistry = createRegistry([stdModule, reportModule]);
    const beforeAttachmentModule = loadFenelModule(beforeFacetAttachmentSource, "matrixreport");
    const beforeFunctions = new Map(beforeAttachmentModule.functions?.map(fn => [fn.id, fn]));
    const baselineIds = ["matrixreport:matrixAttachFacet", "matrixreport:matrixBuildRows"];
    expect([...beforeFunctions.keys()].sort()).toEqual(baselineIds);
    const beforeReplacements = new Set<string>();
    const currentReportContext = reportRegistry.evaluateContext();
    // Isolated oracle lookup: neither registry nor the shared parser harness is
    // mutated. All other report functions and std representations are identical.
    const beforeReportContext: EvaluateContext = {
      ...currentReportContext,
      getFunction(name) {
        const current = currentReportContext.getFunction?.(name);
        if (current === undefined) return undefined;
        const previous = beforeFunctions.get(current.id);
        if (previous !== undefined) beforeReplacements.add(current.id);
        return previous ?? current;
      },
    };
    const parityFunctions = ["std:missing", "constructor", "__proto__", "odd:\u{1F600}", "odd:\uE000", "std:."]
      .map(fnId => ({ fnId, bodyPresent: true, js: matrixTarget(), wasm: matrixTarget(), llvm: matrixTarget() }));
    const parityCategory = { typeName: "Categorizable", fnId: "__proto__", valueString: "", valueStrings: [] };
    const parityTags = { typeName: "Taggable", fnId: "constructor", valueString: "", valueStrings: ["b", "a"] };
    for (const instanceFacets of [
      [],
      [parityCategory, parityTags, { ...parityCategory }, { ...parityTags, valueStrings: [...parityTags.valueStrings] },
        { typeName: "Categorizable", fnId: "unused", valueString: "unused", valueStrings: [] }],
      [parityCategory, { ...parityCategory, valueString: "different" }, parityTags],
      [parityTags, { ...parityTags, valueStrings: ["a", "b"] }, parityCategory],
    ]) {
      const rule = {
        call: ["matrixreport:matrixReport", {
          presentation: { verified: "2026-08-12", verifiedAtSha: "abcdef0" },
          rosterKeys: MATRIX_ROSTER,
          functions: parityFunctions,
          instanceFacets,
          reportSourceDigest: "0".repeat(64),
        }],
      };
      const currentValue = evaluate(rule, {}, currentReportContext);
      const beforeValue = evaluate(rule, {}, beforeReportContext);
      // Compare the complete candidate text, raw rows, audit/preimages and
      // refusal wires at a fixed source digest, not just selected row fields.
      expect(encodeCanonicalJson(currentValue)).toEqual(encodeCanonicalJson(beforeValue));
    }
    expect([...beforeReplacements].sort()).toEqual(baselineIds);

    const beforeProjectionModule = loadFenelModule(beforeFacetProjectionAndSectionsSource, "matrixreport");
    const beforeProjectionFunctions = new Map(beforeProjectionModule.functions?.map(fn => [fn.id, fn]));
    // Build an independent production-shaped context. Registry ingress sorts
    // record IR keys and freezes bodies; raw getFunction overrides skip both.
    const beforeProjectionRegistry = createRegistry([stdModule, {
      ...reportModule,
      functions: reportModule.functions?.map(fn => beforeProjectionFunctions.get(fn.id) ?? fn),
    }]);
    const beforeProjectionContext = beforeProjectionRegistry.evaluateContext();
    const looseAreas = ["__proto__", "constructor", "toString", "0", "42", "", "engine: helper", "telegram"];
    const looseFunctions = looseAreas.map((_, index) => ({
      fnId: `loose:${index}`, bodyPresent: true,
      js: matrixTarget(), wasm: matrixTarget(), llvm: matrixTarget(),
    }));
    const looseFacets = looseAreas.map((valueString, index) => ({
      typeName: "Categorizable", fnId: `loose:${index}`, valueString, valueStrings: [],
    }));
    for (const [functions, instanceFacets] of [
      [[], []],
      [parityFunctions, [parityCategory, parityTags]],
      [looseFunctions, looseFacets],
      [[...parityFunctions, ...parityFunctions], [parityCategory, parityTags, { ...parityCategory }]],
      [parityFunctions, [
        { ...parityCategory, fnId: "a", valueString: "first" },
        { ...parityCategory, fnId: "b", valueString: "first" },
        { ...parityCategory, fnId: "b", valueString: "first-conflict" },
        { ...parityCategory, fnId: "a", valueString: "later-conflict" },
        parityTags,
      ]],
      [parityFunctions, [parityTags, { ...parityTags, valueStrings: ["a", "b"] }, parityCategory]],
    ] as const) {
      const rule = { call: ["matrixreport:matrixReport", {
        presentation: { verified: "2026-08-12", verifiedAtSha: "abcdef0" },
        rosterKeys: MATRIX_ROSTER, functions, instanceFacets, reportSourceDigest: "0".repeat(64),
      }] };
      const optimized = evaluate(rule, {}, currentReportContext);
      const original = evaluate(rule, {}, beforeProjectionContext);
      expect(optimized).toEqual(original);
      expect(encodeCanonicalJson(optimized)).toEqual(encodeCanonicalJson(original));
      expect((optimized as { candidate: string }).candidate).toBe((original as { candidate: string }).candidate);
    }
    expect([...beforeProjectionFunctions.keys()].sort()).toEqual([
      "matrixreport:matrixOrderedAreas", "matrixreport:matrixProjectFacets", "matrixreport:matrixRenderSections",
    ]);
    const rosterKeys = evaluate(
      { call: ["matrixreport:matrixReportRoster", null] },
      {},
      reportRegistry.evaluateContext(),
    );
    const sourceDigest = "0".repeat(64);
    const rendered = decodeMatrixReportResult(evaluate(
      {
        call: [
          "matrixreport:matrixReport",
          {
            presentation: { verified: "2026-08-12", verifiedAtSha: "abcdef0" },
            rosterKeys,
            functions: [],
            instanceFacets: [],
            reportSourceDigest: sourceDigest,
          },
        ],
      },
      {},
      reportRegistry.evaluateContext(),
    ), sourceDigest);
    expect(rendered.rawFacets.rows).toEqual([]);
    expect(rendered.candidate.endsWith("\n")).toBe(true);
    expect(rendered.candidate).toContain("## Status legend\n\n");
    expect(rendered.candidate).toContain(
      "_None — declared status matches observed status on every cell._",
    );
    expect(rendered.candidate).toContain(
      "_None — every Fenel-bodied fnId with a sample on one target either has a sample on every target or a documented gap on the others._",
    );
    expect(rendered.candidate).not.toContain("[object Object]");
    expect(rosterKeys).toEqual(MATRIX_ROSTER);
    expect(rosterKeys).toEqual(matrixAcquisitionKeys());
    // R2a retired permissions; its existing authority owner is already in
    // the acquisition inventory. Validate actual Fenel output against that
    // closed inventory, preserving both missing and unused-owner refusals.
    const actualRoster = rosterKeys as readonly string[];
    expect(actualRoster).toContain("authority");
    expect(actualRoster).not.toContain("permissions");
    expect(() => validateMatrixAcquisitionRoster(actualRoster)).not.toThrow();
    expect(() => validateMatrixAcquisitionRoster(actualRoster.map(key =>
      key === "authority" ? "permissions" : key))).toThrow("missing matrix acquisition entry permissions");
    expect(() => validateMatrixAcquisitionRoster(actualRoster.filter(key =>
      key !== "authority"))).toThrow("unused matrix acquisition entry authority");

    // The checked-in matrix currently contains 6,465 fnId rows.  Exercise the
    // two formerly linear-recursive report paths beyond that production scale:
    // facet lookup and the stable UTF-8 row ordering owned by this Fenel source.
    const scale = 6_500;
    const scaleFacets = Array.from({ length: scale }, (_, index) => ({
      fnId: `scale:${String(index).padStart(5, "0")}`,
      categoryPresent: false,
      category: "",
      tagsPresent: false,
      tags: [],
    }));
    expect(evaluate(
      {
        call: [
          "matrixreport:matrixFindFacet",
          `scale:${String(scale - 1).padStart(5, "0")}`,
          scaleFacets,
        ],
      },
      {},
      reportRegistry.evaluateContext(),
    )).toEqual({ $tag: "Just", _0: scaleFacets.at(-1) });

    const scaleRows = [
      ...Array.from({ length: scale / 2 }, (_, index) => ({
        fnId: `scale:${String(index * 2).padStart(5, "0")}`,
        ordinal: index,
      })),
      { fnId: "scale:03250", ordinal: scale },
      ...Array.from({ length: scale / 2 }, (_, index) => ({
        fnId: `scale:${String(index * 2 + 1).padStart(5, "0")}`,
        ordinal: scale / 2 + index,
      })),
      { fnId: "scale:03250", ordinal: scale + 1 },
    ];
    const sortedScaleRows = evaluate(
      { call: ["matrixreport:matrixSortRows", scaleRows] },
      {},
      reportRegistry.evaluateContext(),
    ) as { fnId: string; ordinal: number }[];
    expect(sortedScaleRows.map((row) => row.fnId)).toEqual(
      [...scaleRows].sort((left, right) => Buffer.compare(
        Buffer.from(left.fnId, "utf8"),
        Buffer.from(right.fnId, "utf8"),
      )).map((row) => row.fnId),
    );
    expect(sortedScaleRows.filter((row) => row.fnId === "scale:03250").map((row) => row.ordinal))
      .toEqual([1_625, scale, scale + 1]);

    // Branch-complete legacy migration oracle.  This fixture deliberately
    // avoids M4's canonical projection/order/escaping deltas.  Replacing the
    // one intentional refresh-prose delta must reproduce the frozen complete
    // legacy document byte-for-byte.
    const parity = evaluateMatrixReportFixture(
      reportRegistry,
      [
        {
          fnId: "std:allOk",
          bodyPresent: true,
          js: matrixTarget({ samples: 2, status: "OK", samplesCompared: 2 }),
          wasm: matrixTarget({ samples: 2, status: "OK", samplesCompared: 2 }),
          llvm: matrixTarget({ samples: 2, status: "OK", samplesCompared: 2 }),
        },
        {
          fnId: "std:silentSkip",
          bodyPresent: true,
          js: matrixTarget({ samples: 2, status: "SKIP", reason: "compile unavailable" }),
          wasm: matrixTarget({ gapPresent: true, gap: "wasm defer", status: "NO_SAMPLES" }),
          llvm: matrixTarget({ samples: 1, status: "FAIL", reason: "mismatch" }),
        },
        {
          fnId: "std:staleGap",
          bodyPresent: true,
          js: matrixTarget({
            samples: 1,
            gapPresent: true,
            gap: "legacy gap",
            status: "OK",
            samplesCompared: 1,
          }),
          wasm: matrixTarget(),
          llvm: matrixTarget(),
        },
        {
          fnId: "std:noSamples",
          bodyPresent: true,
          js: matrixTarget(),
          wasm: matrixTarget(),
          llvm: matrixTarget(),
        },
        {
          fnId: "std:leaf",
          bodyPresent: false,
          js: matrixTarget(),
          wasm: matrixTarget(),
          llvm: matrixTarget(),
        },
      ],
      ["std:allOk", "std:silentSkip", "std:staleGap", "std:noSamples", "std:leaf"]
        .map((fnId) => ({
          typeName: "Categorizable",
          fnId,
          valueString: "function",
          valueStrings: [],
        })),
    );
    expect(parity.audit.declaredObservedAsymmetryCount).toBe(3);
    expect(parity.audit.declaredObservedAsymmetries).toEqual([
      { fnId: "std:silentSkip", target: "js", className: "silent-skip", declared: "samples=2, no gap", observed: "SKIP (compile unavailable)" },
      { fnId: "std:silentSkip", target: "llvm", className: "escaped-fail", declared: "samples=1, no gap", observed: "FAIL (mismatch)" },
      { fnId: "std:staleGap", target: "js", className: "stale-gap", declared: 'GAP ("legacy gap")', observed: "OK (1)" },
    ]);
    const irOnly = evaluateMatrixReportFixture(reportRegistry, [{
      fnId: "llvm:irOnly", bodyPresent: true, js: matrixTarget(), wasm: matrixTarget(),
      llvm: matrixTarget({ samples: 1, gapPresent: true, gap: "behavioral runtime unavailable", status: "OK", samplesCompared: 0 }),
    }], []);
    expect(irOnly.audit.declaredObservedAsymmetryCount).toBe(0);
    expect(irOnly.audit.declaredObservedAsymmetries).toEqual([]);
    expect(parity.candidate).toContain(
      "  - JS: 1 OK + 1 SKIP + 0 FAIL + 1 GAP + 1 no-samples out of 4 Fenel-bodied.",
    );
    expect(parity.candidate).toContain(
      "  - Wasm: 1 OK + 0 SKIP + 0 FAIL + 1 GAP + 2 no-samples out of 4 Fenel-bodied.",
    );
    expect(parity.candidate).toContain(
      "  - LLVM: 1 OK + 0 SKIP + 1 FAIL + 0 GAP + 2 no-samples out of 4 Fenel-bodied.",
    );
    expect(parity.candidate).toContain(
      "| `std:leaf` | TS-leaf | — | — | — |",
    );
    expect(parity.candidate).toContain(
      "| `std:silentSkip` | Fenel | SKIP: compile unavailable | GAP | FAIL: mismatch |",
    );
    expect(parity.candidate).toContain(
      "| `std:staleGap` | Fenel | GAP | — | — |",
    );
    expect(parity.candidate).toContain(
      "| `std:silentSkip` | js | silent-skip | samples=2, no gap | SKIP (compile unavailable) |",
    );
    expect(parity.candidate).toContain(
      "| `std:silentSkip` | llvm | escaped-fail | samples=1, no gap | FAIL (mismatch) |",
    );
    expect(parity.candidate).toContain(
      "| `std:staleGap` | js | stale-gap | GAP (\"legacy gap\") | OK (1) |",
    );
    const currentRefresh = [
      "bun --no-env-file implementations/typescript/engine/scripts/self-host-matrix-controller.ts --check\n",
      "```\n\n",
      "The raw generator is an internal guarded worker. The controller owns capture, reproduction, audit, and publication; use its explicit adoption flow when `--check` reports repair is due. Add `--progress` for per-target progress on slow local runs; it changes logging only.\n",
    ].join("");
    const legacyRefresh = [
      "bun implementations/typescript/engine/scripts/generate-self-host-matrix.ts\n",
      "```\n\n",
      "Add `--progress` for per-target progress on slow local runs; it changes logging only. Re-run after any `defineFunction` addition, after editing `self-host-samples.ts`, or after touching any per-target self-host classifier. Run with `--check` to assert the on-disk file matches the exact source roster and live compiler observations (CI-friendly). Both write and check modes exit nonzero when the declared/observed audit contains a stale gap, silent skip, or escaped failure; write mode still emits the diagnostic matrix first.\n",
    ].join("");
    expect(parity.candidate.split(currentRefresh)).toHaveLength(2);
    expect(parity.candidate.replace(currentRefresh, legacyRefresh)).toMatchInlineSnapshot(`
      "---
      verified: 2026-08-12
      verified_at_sha: abcdef0
      covers:
        - implementations/typescript/engine/src/modules/engine.ts
        - implementations/typescript/engine/src/modules/compile-js.ts
        - implementations/typescript/engine/src/modules/compile-wasm.ts
        - implementations/typescript/engine/src/modules/compile-llvm.ts
        - implementations/typescript/engine/src/modules/std.ts
        - implementations/typescript/engine/src/self-host-samples.ts
        - implementations/typescript/engine/src/compile-js-self-host-classifier.ts
        - implementations/typescript/engine/src/compile-wasm-self-host-classifier.ts
        - implementations/typescript/engine/src/compile-llvm-self-host-classifier.ts
        - implementations/typescript/engine/src/self-host-wasm-llvm-bootstrap.ts
      ---

      # Self-Host Matrix

      How much of Fenel is bodied in Fenel itself, per compilation target.

      **Phase 5b30** — cells render OBSERVED runtime status from each per-target
      classifier (\`compile-{js,wasm,llvm}-self-host-classifier.ts\`'s
      \`classifyFnId\`), not inferred from declared samples + EXPECTED_GAPS. The
      new audit section "Matrix-vs-declared asymmetries" surfaces stale GAPs,
      silent-skip cases, and escaped-CI FAILs in one place.

      ## Status legend

      | Symbol | Meaning |
      |---|---|
      | **Fenel** | Function has a registered \`body\` — same source executes through the engine evaluator and through every per-target lowering. |
      | **TS-leaf** | TS-side native impl only. Either an irreducible IO primitive (state / network / fs) or a runtime-helper sentinel; not a self-hosting candidate. |
      | **OK (N)** | The per-target classifier observed N samples compared engine ≡ compiled byte-for-byte. |
      | **SKIP: \\<reason\\>** | The classifier observed a pre-execution skip (no samples, compile failed, serialise failed, eval failed, effect-stub setup failed). |
      | **FAIL: \\<reason\\>** | The classifier observed a per-sample runtime error or engine-vs-compiled mismatch. |
      | **GAP** | A documented per-target gap in \`self-host-samples.ts\`'s \`*_EXPECTED_GAPS\`. The audit section below cross-checks whether the gap is still load-bearing or stale. |
      | **—** | No samples declared for this fnId on this target. |

      ## Summary

      - **5 functions** registered across engine + std + per-target compile + synthetic canaries.
      - **4 have Fenel bodies** (the rest, 1, are TS-native primitives or thin TS shells delegating to engine bodies).
      - **Per-target observed status** (from the per-target classifiers):
        - JS: 1 OK + 1 SKIP + 0 FAIL + 1 GAP + 1 no-samples out of 4 Fenel-bodied.
        - Wasm: 1 OK + 0 SKIP + 0 FAIL + 1 GAP + 2 no-samples out of 4 Fenel-bodied.
        - LLVM: 1 OK + 0 SKIP + 1 FAIL + 0 GAP + 2 no-samples out of 4 Fenel-bodied.
      - **1 fnIds observe OK across all three targets** (the diagonal).

      ## Matrix-vs-declared asymmetries

      Cells where the declared signal (samples + EXPECTED_GAPS entry) disagrees with the OBSERVED classifier status. Three classes:

      - **stale-gap** — gap declared, but the runtime classifier behaviorally compares at least one sample and reports OK. An LLVM \`OK (0)\` is IR-shape-only evidence, not a closed runtime gap.
      - **silent-skip** — declared OK (samples > 0, no gap), but the runtime classifier reports SKIP. The matrix used to lie at this cell; the gap inventory needs an entry OR the harness-runtime needs a follow-up fix.
      - **escaped-fail** — declared OK, but the runtime classifier reports FAIL. A regression escaped CI.

      | fnId | Target | Class | Declared | Observed |
      |---|---|---|---|---|
      | \`std:silentSkip\` | js | silent-skip | samples=2, no gap | SKIP (compile unavailable) |
      | \`std:silentSkip\` | llvm | escaped-fail | samples=1, no gap | FAIL (mismatch) |
      | \`std:staleGap\` | js | stale-gap | GAP ("legacy gap") | OK (1) |

      ## Per-target asymmetries

      Fenel-bodied fnIds with a sample on one target but missing / gapped on another. Diagnostic value: every row here is either a sample-coverage gap worth closing or a documented per-target deferment.

      | fnId | Body | JS | Wasm | LLVM |
      |---|---|---|---|---|
      | \`std:silentSkip\` | Fenel | SKIP: compile unavailable | GAP | FAIL: mismatch |

      ## By area

      ### std:function

      | fnId | Body | JS | Wasm | LLVM |
      |---|---|---|---|---|
      | \`std:allOk\` | Fenel | OK (2) | OK (2) | OK (2) |
      | \`std:leaf\` | TS-leaf | — | — | — |
      | \`std:noSamples\` | Fenel | — | — | — |
      | \`std:silentSkip\` | Fenel | SKIP: compile unavailable | GAP | FAIL: mismatch |
      | \`std:staleGap\` | Fenel | GAP | — | — |


      ## How to refresh

      \`\`\`
      bun implementations/typescript/engine/scripts/generate-self-host-matrix.ts
      \`\`\`

      Add \`--progress\` for per-target progress on slow local runs; it changes logging only. Re-run after any \`defineFunction\` addition, after editing \`self-host-samples.ts\`, or after touching any per-target self-host classifier. Run with \`--check\` to assert the on-disk file matches the exact source roster and live compiler observations (CI-friendly). Both write and check modes exit nonzero when the declared/observed audit contains a stale gap, silent skip, or escaped failure; write mode still emits the diagnostic matrix first.

      ## Caveats

      - The matrix is a **snapshot** of HEAD at the noted \`verified_at_sha\`. Run \`git log <verified_at_sha>..HEAD\` over the covered files to detect drift.
      - TS-leaf rows aren't failures — \`std:add\` / \`state:tryCreateInstance\` / \`state:appendEvent\` are intentionally TS-side. The matrix surfaces them so a reader can confirm a fnId is _expected_ to be TS-only vs accidentally so.
      - The synthetic \`phase20:effectfulCanary\` is hand-written in each self-host harness; it isn't a real registered engine function. Listed here for parity with what the canary report enumerates.
      - \`$effect:<Class>:<method>\` sentinel fnIds are dispatched via the typeclass substrate rather than the function registry — they don't appear in the matrix.
      - LLVM cell observations are environment-dependent — without clang, \`OK (0)\` records an IR-shape-only pass and never marks a runtime gap stale. On clang-available machines, a behavioral \`OK (N > 0)\` can surface genuine gap drift.
      "
    `);

    const areaRow = (
      fnId: string,
      codeName: string,
      tags: readonly string[] = [],
      categoryPresent = false,
      category = "",
    ): object => ({
      fnId,
      codeName,
      bodyPresent: true,
      categoryPresent,
      category,
      tagsPresent: tags.length > 0,
      tags,
      js: matrixTarget(),
      wasm: matrixTarget(),
      llvm: matrixTarget(),
    });
    const areaCases: ReadonlyArray<readonly [object, string]> = [
      [areaRow("compile-js:x", "x"), "compile-js wrapper"],
      [areaRow("compile-wasm:x", "x"), "compile-wasm wrapper"],
      [areaRow("compile-llvm:x", "x"), "compile-llvm wrapper"],
      [areaRow("engine:encodeWasmX", "encodeWasmX", ["wasm"]), "engine: Wasm serialiser"],
      [areaRow("engine:wasmX", "wasmX", ["wasm"]), "engine: Wasm serialiser"],
      [areaRow("engine:lowerToWasmX", "lowerToWasmX", ["wasm"]), "engine: Wasm lowering"],
      [areaRow("engine:lowerWasmX", "lowerWasmX", ["wasm"]), "engine: Wasm lowering"],
      [areaRow("engine:inferDomainsX", "inferDomainsX", ["wasm"]), "engine: Wasm domain inference"],
      [areaRow("engine:wasmHelper", "other", ["wasm"]), "engine: Wasm helper"],
      [areaRow("engine:emitLlvmX", "emitLlvmX", ["llvm"]), "engine: LLVM serialiser"],
      [areaRow("engine:serializeLlvmX", "serializeLlvmX", ["llvm"]), "engine: LLVM serialiser"],
      [areaRow("engine:lowerToLlvmX", "lowerToLlvmX", ["llvm"]), "engine: LLVM lowering"],
      [areaRow("engine:lowerLlvmX", "lowerLlvmX", ["llvm"]), "engine: LLVM lowering"],
      [areaRow("engine:inferLlvmX", "inferLlvmX", ["llvm"]), "engine: LLVM domain inference"],
      [areaRow("engine:llvmHelper", "other", ["llvm"]), "engine: LLVM helper"],
      [areaRow("engine:emitJs", "emitJs"), "engine: JS serialiser"],
      [areaRow("engine:emitOther", "emitOther"), "engine: JS serialiser"],
      [areaRow("engine:serializeJsX", "serializeJsX"), "engine: JS serialiser"],
      [areaRow("engine:foldX", "foldX"), "engine: JS serialiser"],
      [areaRow("engine:buildX", "buildX"), "engine: JS serialiser"],
      [areaRow("engine:normaliseToCore", "normaliseToCore"), "engine: normalise → Core"],
      [areaRow("engine:lowerX", "lowerX"), "engine: normalise → Core"],
      [areaRow("engine:makeEffectsExplicit", "makeEffectsExplicit"), "engine: effects-explicit pass"],
      [areaRow("engine:scanX", "scanX"), "engine: effects-explicit pass"],
      [areaRow("engine:parseEffectFnId", "parseEffectFnId"), "engine: effects-explicit pass"],
      [areaRow("engine:makeClosuresExplicit", "makeClosuresExplicit"), "engine: closures-explicit pass"],
      [areaRow("engine:collectFreeX", "collectFreeX"), "engine: closures-explicit pass"],
      [areaRow("engine:convertX", "convertX"), "engine: closures-explicit pass"],
      [areaRow("engine:findFreeVar", "findFreeVar"), "engine: closures-explicit pass"],
      [areaRow("engine:buildCapture", "CaptureX"), "engine: closures-explicit pass"],
      [areaRow("engine:helper", "helper"), "engine: helper"],
      [areaRow("std:categorized", "categorized", [], true, "function"), "std:function"],
      [areaRow("std:empty", "empty", [], true, ""), "std:uncategorised"],
      [areaRow("std:absent", "absent"), "std:uncategorised"],
      [areaRow("telegram:x", "x"), "telegram"],
      [areaRow("phase20:x", "x"), "synthetic canary"],
      [areaRow("ordinary:categorized", "categorized", [], true, "domain"), "domain"],
      [areaRow("ordinary:empty", "empty", [], true, ""), ""],
      [areaRow("ordinary:absent", "absent"), "other"],
      [areaRow("engineWithoutColon", "engineWithoutColon"), "other"],
    ];
    for (const [row, expectedArea] of areaCases) {
      expect(evaluate(
        { call: ["matrixreport:matrixArea", row] },
        {},
        reportRegistry.evaluateContext(),
      )).toBe(expectedArea);
    }
    expect(evaluate(
      { call: ["matrixreport:matrixCodeName", "withoutColon"] },
      {},
      reportRegistry.evaluateContext(),
    )).toBe("withoutColon");
    expect(evaluate(
      { call: ["matrixreport:matrixCodeName", "std:"] },
      {},
      reportRegistry.evaluateContext(),
    )).toBe("");
    expect(evaluate(
      { call: ["matrixreport:matrixCodeName", "a:b:c"] },
      {},
      reportRegistry.evaluateContext(),
    )).toBe("b:c");
    expect(evaluate(
      { call: ["matrixreport:matrixTargetCell", matrixTarget({ gapPresent: true, gap: "" })] },
      {},
      reportRegistry.evaluateContext(),
    )).toBe("GAP");
    expect(evaluate(
      { call: ["matrixreport:matrixGapTruthy", matrixTarget({ gapPresent: true, gap: "" })] },
      {},
      reportRegistry.evaluateContext(),
    )).toBe(false);
    expect(evaluate(
      { call: ["matrixreport:matrixGapTruthy", matrixTarget({ gapPresent: true, gap: "defer" })] },
      {},
      reportRegistry.evaluateContext(),
    )).toBe(true);

    const identicalProjection = evaluate(
      {
        call: [
          "matrixreport:matrixProjectFacets",
          [
            { typeName: "Categorizable", fnId: "x:y", valueString: "same", valueStrings: [] },
            { typeName: "Categorizable", fnId: "x:y", valueString: "same", valueStrings: [] },
          ],
        ],
      },
      {},
      reportRegistry.evaluateContext(),
    );
    expect(identicalProjection).toEqual({
      ok: true,
      error: "",
      entries: [{
        fnId: "x:y",
        categoryPresent: true,
        category: "same",
        tagsPresent: false,
        tags: [],
      }],
    });
    const legacyLastWrite = new Map<string, string>();
    legacyLastWrite.set("x:y", "first");
    legacyLastWrite.set("x:y", "second");
    expect(legacyLastWrite.get("x:y")).toBe("second");

    const fullTags = {
      engine: ["engine", "internal", "llvm", "phase-21"],
      std: ["function", "combinator", "operator", "higher-order"],
    } as const;
    const synthetic = evaluateMatrixReportFixture(
      reportRegistry,
      [
        {
          fnId: "std:.",
          bodyPresent: true,
          js: matrixTarget({ samples: 1, status: "OK", samplesCompared: 1 }),
          wasm: matrixTarget({ samples: 1, status: "OK", samplesCompared: 1 }),
          llvm: matrixTarget({ samples: 1, status: "OK", samplesCompared: 1 }),
        },
        {
          fnId: "engine:llvmDomainToValType",
          bodyPresent: true,
          js: matrixTarget({ samples: 1, status: "OK", samplesCompared: 1 }),
          wasm: matrixTarget({ gapPresent: true, gap: "", status: "NO_SAMPLES" }),
          llvm: matrixTarget({ samples: 1, status: "OK", samplesCompared: 1 }),
        },
        {
          fnId: "std:escape|`&<>\\",
          bodyPresent: true,
          js: matrixTarget({
            samples: 1,
            status: "FAIL",
            reason: "A&B<C>|`\\\r\nnext\rlone\nend",
          }),
          wasm: matrixTarget(),
          llvm: matrixTarget(),
        },
        {
          fnId: "odd:\uE000",
          bodyPresent: false,
          js: matrixTarget(),
          wasm: matrixTarget(),
          llvm: matrixTarget(),
        },
        {
          fnId: "odd:\u{1F600}",
          bodyPresent: false,
          js: matrixTarget(),
          wasm: matrixTarget(),
          llvm: matrixTarget(),
        },
      ],
      [
        { typeName: "Categorizable", fnId: "std:.", valueString: "function", valueStrings: [] },
        { typeName: "Taggable", fnId: "std:.", valueString: "", valueStrings: fullTags.std },
        {
          typeName: "Categorizable",
          fnId: "engine:llvmDomainToValType",
          valueString: "engine-internal",
          valueStrings: [],
        },
        {
          typeName: "Taggable",
          fnId: "engine:llvmDomainToValType",
          valueString: "",
          valueStrings: fullTags.engine,
        },
        { typeName: "Categorizable", fnId: "std:escape|`&<>\\", valueString: "", valueStrings: [] },
        { typeName: "Taggable", fnId: "std:escape|`&<>\\", valueString: "", valueStrings: [] },
      ],
    );
    expect(synthetic.rawFacets.rows.map((row) => row.fnId)).toEqual([
      "engine:llvmDomainToValType",
      "odd:\uE000",
      "odd:\u{1F600}",
      "std:.",
      "std:escape|`&<>\\",
    ]);
    const frozenLegacyLocaleOrder = [
      "odd:\u{1F600}",
      "odd:\uE000",
    ];
    expect(synthetic.rawFacets.rows.slice(1, 3).map((row) => row.fnId)).not.toEqual(
      frozenLegacyLocaleOrder,
    );
    expect(synthetic.rawFacets.rows[0]).toEqual({
      fnId: "engine:llvmDomainToValType",
      categoryPresent: true,
      category: "engine-internal",
      tagsPresent: true,
      tags: fullTags.engine,
    });
    expect(synthetic.rawFacets.rows.at(-1)).toEqual({
      fnId: "std:escape|`&<>\\",
      categoryPresent: true,
      category: "",
      tagsPresent: true,
      tags: [],
    });
    expect(synthetic.audit.categoryCount).toBe(3);
    expect(synthetic.audit.tagCount).toBe(3);
    expect(synthetic.audit.categorizableRepresentativeIds).toEqual([
      "engine:llvmDomainToValType", "std:.", "std:escape|`&<>\\",
    ]);
    expect(synthetic.audit.taggableRepresentativeIds).toEqual([
      "engine:llvmDomainToValType", "std:.", "std:escape|`&<>\\",
    ]);
    expect(synthetic.audit.groupingFacts).toEqual([
      { fnId: "engine:llvmDomainToValType", area: "engine: LLVM helper" },
      { fnId: "std:.", area: "std:function" },
    ]);
    expect(synthetic.audit.declaredObservedAsymmetryCount).toBe(1);
    expect(synthetic.audit.categoryPreimage).toBe(
      "fenel.self-host-matrix.category.v1\n3\n"
        + "26:engine:llvmDomainToValType15:engine-internal\n"
        + "5:std:.8:function\n"
        + "16:std:escape|`&<>\\0:\n",
    );
    expect(synthetic.audit.tagPreimage).toBe(
      "fenel.self-host-matrix.tags.v1\n3\n"
        + "26:engine:llvmDomainToValType4\n6:engine8:internal4:llvm8:phase-21\n"
        + "5:std:.4\n8:function10:combinator8:operator12:higher-order\n"
        + "16:std:escape|`&<>\\0\n\n",
    );
    expect(synthetic.candidate).toContain("### engine: LLVM helper\n\n");
    expect(synthetic.candidate).toContain("### std:function\n\n");
    expect(synthetic.candidate).toContain("### std:uncategorised\n\n");
    expect(synthetic.candidate).toContain(
      "`std:escape&#124;&#96;&amp;&lt;&gt;&#92;` | Fenel | FAIL: A&amp;B&lt;C&gt;&#124;&#96;&#92;<br>next<br>lone<br>end |",
    );
    expect(synthetic.candidate).toContain(
      "`engine:llvmDomainToValType` | Fenel | OK (1) | GAP | OK (1) |",
    );
    expect(synthetic.candidate.endsWith("\n")).toBe(true);
    expect(synthetic.candidate).not.toContain("\r");

    expect(evaluate(
      { call: ["matrixreport:matrixTruncate", "x".repeat(61)] },
      {},
      reportRegistry.evaluateContext(),
    )).toBe(`${"x".repeat(59)}…`);
    expect(evaluate(
      { call: ["matrixreport:matrixTruncate", `${"x".repeat(58)}\u{1F600}`] },
      {},
      reportRegistry.evaluateContext(),
    )).toBe(`${"x".repeat(58)}\u{1F600}`);

    const divergent = decodeFacetProjection(evaluate(
      {
        call: [
          "matrixreport:matrixProjectFacets",
          [
            { typeName: "Categorizable", fnId: "x:y", valueString: "", valueStrings: [] },
            { typeName: "Categorizable", fnId: "x:y", valueString: "nonempty", valueStrings: [] },
          ],
        ],
      },
      {},
      reportRegistry.evaluateContext(),
    ));
    expect(divergent).toEqual({
      ok: false,
      error: "divergent Categorizable duplicate for x:y",
      entries: [{
        fnId: "x:y",
        categoryPresent: true,
        category: "",
        tagsPresent: false,
        tags: [],
      }],
    });

    // Loading/evaluating the tool module never mutates the shared parser
    // harness or makes the report function product-dispatchable.
    expect(() => dispatchEngineBody("matrixreport:matrixReportSmoke", ["stage-0"]))
      .toThrow("not registered");
  }, 300_000);
});
