import { describe, expect, test } from "bun:test";
import { exactImmutableDataEqual, exactImmutableDataSnapshot } from "../../../../../implementations/typescript/engine/src/self-host-immutable-data";

// Execute the production host cache and identity adapter without a registry
// build. Policy replies are controlled; these tests establish cache isolation
// and resolver routing, not the semantic validity of a suggestion.
const source = await Bun.file(new URL("./data-suggestions.ts", import.meta.url)).text();
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(source.indexOf("export type DataSuggestionInput")))
  .replace(/^export /gm, "");
// This canonical carrier constructor has no runtime dependencies. Extract its
// actual source so the boundary controls do not initialize an engine registry.
const signatureSource = await Bun.file(new URL("../../../../../implementations/typescript/engine/src/signature-inference.ts", import.meta.url)).text();
const groundStart = signatureSource.indexOf("export function callSiteNominalGroundType(");
const groundEnd = signatureSource.indexOf("\n/**", groundStart);
if (groundStart < 0 || groundEnd < 0) throw new Error("The canonical ground nominal carrier moved.");
const groundCode = new Bun.Transpiler({ loader: "ts" }).transformSync(signatureSource.slice(groundStart, groundEnd)).replace(/^export /gm, "");
const callSiteNominalGroundType = new Function(`${groundCode}; return callSiteNominalGroundType;`)();
const schemeSource = await Bun.file(new URL("../../../../../implementations/typescript/engine/src/authoring/call-scheme.ts", import.meta.url)).text();
const schemeStart = schemeSource.indexOf("export function asAuthoringScheme(");
const schemeEnd = schemeSource.indexOf("\n}\n", schemeStart) + 3;
if (schemeStart < 0 || schemeEnd < 3) throw new Error("The canonical scheme carrier moved.");
const asAuthoringScheme = new Function(`${new Bun.Transpiler({ loader: "ts" }).transformSync(schemeSource.slice(schemeStart, schemeEnd)).replace(/^export /gm, "")}; return asAuthoringScheme;`)();

function harness() {
  let revision = 1;
  let hooks = 1;
  const calls: string[] = [];
  const context = Object.freeze({ _routingTableVersion: () => revision, _activeTags: ["reader"] });
  const session = { registry: {}, environment: Object.freeze({}), catalog: {}, evaluateContext: context };
  const policy = (_session: unknown, name: string, ...args: any[]) => {
    calls.push(name);
    if (name === "suggestionCatalogueSnapshot") {
      const operations = args[1].filter((row: any) => row.callable).slice(0, args[0]).map((row: any) => row.operation);
      return { operations, totalSubmitted: args[1].length, eligibleCount: args[1].length,
        excludedCount: 0, omittedCount: args[1].length - operations.length };
    }
    if (name === "suggestionPlanBatch") return { plans: args[1].map((operation: unknown) => ({
      $tag: "SuggestionPlan", operation, inputIndex: 0, bindingNames: ["selectedData"], missingNames: [],
    })), skippedOperations: [] };
    if (name === "suggestionHygienicPlan") return { ...args[1], bindingNames: [...args[0], "fresh"] };
    throw new Error(`Unexpected controlled policy ${name}`);
  };
  const api = new Function("exactImmutableDataEqual", "exactImmutableDataSnapshot", "lensPolicyData", "evaluatorHookGenerationForMemo", "callSiteNominalGroundType", "asAuthoringScheme", `${code};
    return { planningMemo, plannedCatalogue, reusedHygienicPlan, resolveReaderType, typeHead, scopedExpectedType };`)(
    exactImmutableDataEqual, exactImmutableDataSnapshot, policy, () => hooks, callSiteNominalGroundType, asAuthoringScheme,
  );
  const operations = () => [{ callable: true, moduleName: "std", operation: {
    $tag: "SuggestionOperation", key: "callable", label: "Example", paramNames: ["value"],
    payload: { functionId: "callable", family: "std", kind: "function", callable: { $tag: "Nothing" }, scheme: { $tag: "Nothing" } },
  } }];
  const plan = (reader = session, rows: any[] = operations(), reuse = true, max = 128) => {
    const memo = api.planningMemo(reader, rows, reuse);
    return { memo, ...api.plannedCatalogue(reader, rows, memo, max, 5) };
  };
  return { api, session, calls, operations, plan, advance: () => { revision++; }, replaceHooks: () => { hooks++; } };
}

describe("Suggestions planning reuse", () => {
  test("equal observations reuse exact plans; the disabled control runs the same policy", () => {
    const h = harness();
    const first = h.plan(), warm = h.plan();
    expect(warm.memo).toBe(first.memo);
    expect(warm.planned).toBe(first.planned);
    expect(h.calls).toEqual(["suggestionCatalogueSnapshot", "suggestionPlanBatch"]);
    const fresh = h.plan(h.session, h.operations(), false);
    expect(structuredClone(warm.snapshot)).toEqual(fresh.snapshot);
    expect(structuredClone(warm.planned)).toEqual(fresh.planned);
    expect(h.calls).toHaveLength(4);
  });

  test("registry, environment, catalogue, frame, routing and scope changes retire the cache", () => {
    for (const change of [
      (h: ReturnType<typeof harness>) => ({ ...h.session, registry: {} }),
      (h: ReturnType<typeof harness>) => ({ ...h.session, environment: Object.freeze({}) }),
      (h: ReturnType<typeof harness>) => ({ ...h.session, catalog: {} }),
      (h: ReturnType<typeof harness>) => ({ ...h.session, evaluateContext: Object.freeze({ ...h.session.evaluateContext }) }),
      (h: ReturnType<typeof harness>) => { h.advance(); return h.session; },
      (h: ReturnType<typeof harness>) => { h.replaceHooks(); return h.session; },
      (h: ReturnType<typeof harness>) => { h.session.evaluateContext._activeTags.push("changed"); return h.session; },
    ]) {
      const h = harness();
      const before = h.plan();
      const after = h.plan(change(h));
      expect(after.memo).not.toBe(before.memo);
      expect(h.calls).toHaveLength(4);
    }
  });

  test("an in-place row edit is observed, including values JSON would collapse", () => {
    const h = harness();
    const rows: any[] = h.operations();
    rows[0].operation.payload.literal = -0;
    const first = h.plan(h.session, rows);
    rows[0].operation.payload.literal = 0;
    const zero = h.plan(h.session, rows);
    expect(zero.memo).not.toBe(first.memo);
    rows[0].operation.label = "Renamed";
    const renamed = h.plan(h.session, rows);
    expect(renamed.snapshot.operations[0].label).toBe("Renamed");
    expect(first.snapshot.operations[0].label).toBe("Example");
    let previous = renamed;
    for (const value of [NaN, Infinity, null, undefined, { $undefined: true }]) {
      rows[0].operation.payload.literal = value;
      const next = h.plan(h.session, rows);
      expect(next.memo).not.toBe(previous.memo);
      previous = next;
    }
    rows[0].operation.payload.literal = { first: 1, second: 2 };
    const ordered = h.plan(h.session, rows);
    rows[0].operation.payload.literal = { second: 2, first: 1 };
    expect(h.plan(h.session, rows).memo).not.toBe(ordered.memo);
  });

  test("cached plans are isolated from producer and consumer mutation", () => {
    const h = harness();
    const rows = h.operations();
    const first = h.plan(h.session, rows);
    rows[0]!.operation.paramNames[0] = "changed";
    expect(first.planned.plans[0].operation.paramNames).toEqual(["value"]);
    expect(Object.isFrozen(first.planned.plans[0].operation)).toBe(true);
    expect(() => { first.planned.plans[0].operation.label = "poisoned"; }).toThrow();
  });

  test("mutable frames/environments and missing or throwing revision readers bypass reuse", () => {
    const h = harness();
    const readers = [
      { ...h.session, evaluateContext: { ...h.session.evaluateContext } },
      { ...h.session, environment: {} },
      { ...h.session, evaluateContext: Object.freeze({}) },
      { ...h.session, evaluateContext: Object.freeze({ _routingTableVersion: () => { throw new Error("Unavailable"); } }) },
    ];
    for (const reader of readers) expect(h.api.planningMemo(reader, h.operations(), true)).toBeUndefined();
  });

  test("hygienic plans retain reserved names, bounded storage, and checks after worker yields", () => {
    const h = harness();
    const { memo, planned } = h.plan();
    const plan = planned.plans[0];
    const hygiene = (reserved: string[]) => h.api.reusedHygienicPlan(h.session, memo, reserved, plan);
    expect(hygiene(["reserved"])).toBe(hygiene(["reserved"]));
    expect(hygiene(["other"]).bindingNames).toEqual(["other", "fresh"]);
    for (let i = 0; i < 40; i++) hygiene([`reserved${i}`]);
    expect(memo.hygienic.get(plan).size).toBeLessThanOrEqual(32);
    h.advance();
    const calls = h.calls.length;
    hygiene(["reserved39"]);
    expect(h.calls.length).toBe(calls + 1);
    h.session.evaluateContext._activeTags.push("changed");
    hygiene(["reserved39"]);
    expect(h.calls.length).toBe(calls + 2);
    const current = h.plan();
    h.api.reusedHygienicPlan(h.session, current.memo, [], current.planned.plans[0]);
    h.replaceHooks();
    const beforeHooks = h.calls.length;
    h.api.reusedHygienicPlan(h.session, current.memo, [], current.planned.plans[0]);
    expect(h.calls.length).toBe(beforeHooks + 1);
    for (let max = 1; max < 20; max++) h.plan(h.session, h.operations(), true, max);
    expect(h.plan().memo.catalogues.size).toBeLessThanOrEqual(8);
  });
});

describe("Suggestions transported Type identities", () => {
  const handle = "12345678-1234-1234-1234-123456789012";
  const refused = { ok: false, reason: "missing", spelling: handle, message: "not visible here" };
  const owner = "type-owner";
  const solved = { ok: true, type: { quantified: [], body: { $ref: "source.Data" },
    nominals: [{ path: [], identity: owner }] } };
  const canonical = { ...solved, type: { quantified: [], body: { $ref: "Data" },
    nominals: [{ path: [], identity: owner, publicName: "Data" }] } };
  function reader(result: unknown = solved) {
    const calls: unknown[] = [];
    return { calls, session: { evaluateContext: { _sourceFunction: "caller" }, registry: {
      getIdentifiedEntity: () => ({ module: "source", id: "Data" }),
      getEntityNominalIdentity: () => owner,
      getTypeUuid: () => handle,
      callSiteTyping: { resolveType: (type: any, source: unknown) => {
        calls.push([type, source]);
        return type.$ref === "source.Data" ? result : refused;
      } },
    } } };
  }
  test("an exact handle uses the canonical resolver and preserves the source frame", () => {
    const h = harness(), r = reader();
    expect(h.api.resolveReaderType(r.session, { $ref: handle })).toEqual(canonical);
    expect(r.calls).toEqual([[{ $ref: handle }, "caller"], [{ $ref: "source.Data" }, "caller"]]);
  });
  // Checkpoint 3 (Nov 8): since the registry admits an exact type handle in
  // every frame, a pasted 21 carries {$ref: <Number UUID>} and resolves "ok"
  // with that UUID spelling. The subject must still take its declaration's
  // own name, or no Number parameter shares its index head (ref:<uuid>).
  test("an exact handle the resolver admits directly still takes its declaration's scoped name", () => {
    const h = harness();
    const calls: unknown[] = [];
    const numberOwner = "number-owner";
    const direct = { ok: true, type: { quantified: [], body: { $ref: handle }, nominals: [{ path: [], identity: numberOwner }] } };
    const scoped = { ok: true, type: { quantified: [], body: { $ref: "system.Number" }, nominals: [{ path: [], identity: numberOwner }] } };
    const session = { evaluateContext: { _sourceFunction: "caller" }, registry: {
      getIdentifiedEntity: () => ({ module: "system", id: "Number" }),
      getEntityNominalIdentity: () => numberOwner,
      getTypeUuid: () => handle,
      callSiteTyping: { resolveType: (type: any, source: unknown) => {
        calls.push([type, source]);
        return type.$ref === handle ? direct : type.$ref === "system.Number" ? scoped : refused;
      } },
    } };
    const result = h.api.resolveReaderType(session, { $ref: handle });
    expect(result).toEqual({ ok: true, type: { quantified: [], body: { $ref: "Number" },
      nominals: [{ path: [], identity: numberOwner, publicName: "Number" }] } });
    expect(h.api.typeHead(result.type.body)).toBe("ref:Number");
    expect(calls).toEqual([[{ $ref: handle }, "caller"], [{ $ref: "system.Number" }, "caller"]]);
    // A name the caller cannot see (a Local type) keeps the admitted handle.
    session.registry.callSiteTyping.resolveType = (type: any) => type.$ref === handle ? direct : refused;
    expect(h.api.resolveReaderType(session, { $ref: handle })).toBe(direct);
    // A different owner under that name keeps the admitted handle too.
    session.registry.callSiteTyping.resolveType = (type: any) => type.$ref === handle ? direct
      : { ok: true, type: { quantified: [], body: { $ref: "Number" }, nominals: [{ path: [], identity: "other" }] } };
    expect(h.api.resolveReaderType(session, { $ref: handle })).toBe(direct);
  });
  // Function picker (3a): a slot typed by a picked scalar keeps the raw
  // identity handle; the worker judges it under the same scoped name.
  test("a picker requirement renames only a ground bare exact handle of the same owner", () => {
    const h = harness(), r = reader();
    const renamed = { quantified: [], body: { $ref: "Data" }, nominals: [{ path: [], identity: owner, publicName: "Data" }] };
    expect(h.api.scopedExpectedType(r.session, { $ref: handle })).toEqual(renamed);
    expect(h.api.scopedExpectedType(r.session, { quantified: [], body: { $ref: handle } })).toEqual(renamed);
    expect(h.api.scopedExpectedType(r.session, { quantified: [], body: { $ref: handle },
      nominals: [{ path: [], identity: owner }] })).toEqual(renamed);
    expect(h.api.scopedExpectedType(r.session, undefined)).toBeUndefined();
    for (const kept of [
      { $ref: "Data" },
      { $ref: handle, args: [] },
      { $list: { $ref: handle } },
      { quantified: [{}], body: { $ref: handle } },
      { quantified: [], body: { $ref: handle }, applications: [{}] },
      { quantified: [], body: { $ref: handle }, nominals: [{ path: [], identity: "other" }] },
      { quantified: [], body: { $ref: handle }, nominals: [{ path: ["args", "0"], identity: owner }] },
    ]) expect(h.api.scopedExpectedType(r.session, kept)).toBe(kept);
    // A name the caller cannot resolve (a Local type) keeps the raw handle.
    const local = reader(refused);
    const raw = { $ref: handle };
    expect(h.api.scopedExpectedType(local.session, raw)).toBe(raw);
  });
  test("unresolved written names do not acquire a qualified-name escape", () => {
    const h = harness(), r = reader();
    expect(h.api.resolveReaderType(r.session, { $ref: "Data" })).toBe(refused);
    expect(r.calls).toHaveLength(1);
  });
  test("a synthetic storage owner uses only a bare name admitted by the same caller", () => {
    const h = harness(), r = reader();
    const calls: unknown[] = [];
    r.session.registry.callSiteTyping.resolveType = (type: any, source: unknown) => {
      calls.push([type, source]);
      return type.$ref === "Data" ? solved : refused;
    };
    expect(h.api.resolveReaderType(r.session, { $ref: handle })).toEqual(canonical);
    expect(calls).toEqual([[{ $ref: handle }, "caller"], [{ $ref: "source.Data" }, "caller"], [{ $ref: "Data" }, "caller"]]);
    r.session.registry.callSiteTyping.resolveType = () => ({ ...refused, reason: "ambiguous" });
    expect(h.api.resolveReaderType(r.session, { $ref: handle })).toEqual({ ...refused, reason: "ambiguous" });
  });
  test("successful qualification keeps its exact owner when the bare spelling names another type", () => {
    const h = harness(), r = reader();
    const calls: unknown[] = [];
    r.session.registry.callSiteTyping.resolveType = (type: any, source: unknown) => {
      calls.push([type, source]);
      if (type.$ref === "source.Data") return solved;
      if (type.$ref === "Data") return { ok: true, type: { quantified: [], body: type,
        nominals: [{ path: [], identity: "different-owner", publicName: "Data" }] } };
      return refused;
    };
    expect(h.api.resolveReaderType(r.session, { $ref: handle })).toEqual(canonical);
    expect(calls).toEqual([[{ $ref: handle }, "caller"], [{ $ref: "source.Data" }, "caller"]]);
  });
  test("missing, ambiguous, different-owner and quantified results retain refusal", () => {
    const h = harness();
    for (const result of [refused,
      { ok: true, type: { ...solved.type, nominals: [{ path: [], identity: "other" }] } },
      { ok: true, type: { ...solved.type, nominals: [] } },
      { ok: true, type: { ...solved.type, nominals: [...solved.type.nominals, ...solved.type.nominals] } },
      { ok: true, type: { ...solved.type, quantified: [{}] } },
    ]) expect(h.api.resolveReaderType(reader(result).session, { $ref: handle })).toBe(refused);
  });
  test("malformed/accessor carriers and original ambiguity keep the canonical refusal without getter reads", () => {
    const h = harness();
    let reads = 0;
    const hostile = Object.defineProperty({}, "$ref", { get: () => { reads++; return handle; } });
    for (const reason of ["malformed", "ambiguous"]) {
      const failure = { ...refused, reason };
      const r = reader();
      r.session.registry.callSiteTyping.resolveType = () => failure;
      expect(h.api.resolveReaderType(r.session, hostile)).toBe(failure);
      expect(h.api.resolveReaderType(r.session, null)).toBe(failure);
    }
    // Even a host seam that reports "missing" for an accessor cannot induce
    // a second read of that accessor while projecting the transport handle.
    const r = reader();
    r.session.registry.callSiteTyping.resolveType = () => refused;
    expect(h.api.resolveReaderType(r.session, hostile)).toBe(refused);
    expect(reads).toBe(0);
  });
});

describe("Suggestions name planning over large literal data", () => {
  // Controlled Fenel boundary: record the JSON Logic the surface lowering
  // receives. The real codec resolves saved references; no registry is built.
  async function names() {
    const { exprNodeToLogic } = await import("../../../../../implementations/typescript/engine/src/authoring/expression-authoring");
    const lowered: unknown[] = [];
    const api = new Function("exprNodeToLogic", "dispatchedJsonLogicToSyntax", "dispatchEngineBody", "lensPolicyData",
      "transferInferenceContext", `${code}; return { planningNames };`)(
      exprNodeToLogic, (logic: unknown) => { lowered.push(logic); return { $tag: "Ok", _0: logic }; },
      () => ["selectedName"], (_session: unknown, name: string, references: string[]) => {
        if (name !== "suggestionReservedNames") throw new Error(`Unexpected controlled policy ${name}`);
        return references;
      }, (environment: unknown) => environment);
    const plan = (input: Record<string, unknown>) => api.planningNames({ environment: {} }, { revision: "r", ...input });
    return { plan, lowered };
  }
  const depth = (value: unknown): number => Array.isArray(value)
    ? 1 + Math.max(0, ...value.map(depth))
    : value !== null && typeof value === "object" ? 1 + Math.max(0, ...Object.values(value).map(depth)) : 0;
  const pixels = Array.from({ length: 96 * 64 }, (_, index) => ({ r: index % 256, g: 0, b: 255, a: 255 }));
  const image = { width: 96, height: 64, pixels };

  test("plain data lowers one representative element, inline, saved and inside calls", async () => {
    const h = await names();
    expect(h.plan({ expression: { kind: "literal", value: image } })).toEqual(["selectedName"]);
    expect(h.plan({ expression: { kind: "ref", savedExprId: "pasted" }, savedExpressions: [["pasted", { kind: "literal", value: image }]] }))
      .toEqual(["selectedName"]);
    h.plan({ expression: { kind: "call", fnId: "std.imageInvert", args: [{ kind: "ref", savedExprId: "pasted" }] },
      savedExpressions: [["pasted", { kind: "literal", value: image }]] });
    const representative = { width: 96, height: 64, pixels: [pixels[0]] };
    expect(h.lowered).toEqual([representative, representative, { call: ["std.imageInvert", representative] }]);
    expect(image.pixels).toHaveLength(96 * 64);
    expect(depth(h.lowered[0])).toBe(3);
  });

  test("calls, envelopes and non-data literals keep every element", async () => {
    const h = await names();
    const kept = [
      [{ var: "x" }, { var: "y" }],
      [{ r: 1, g: 2 }, { add: [1, 2] }],
      [1, null, 2],
      [{ $tag: "Just", _0: 1 }, { $tag: "Nothing" }],
      { width: 1, $height: 2 },
    ];
    for (const value of kept) h.plan({ expression: { kind: "literal", value } });
    expect(h.lowered).toEqual(kept);
    h.plan({ expression: { kind: "literal", value: { __list: [{ kind: "literal", value: [1, 2, 3] }, { kind: "param", name: "p" }] } } });
    // Editor envelopes are lowered unchanged by their own codec.
    expect(h.lowered.at(-1)).toEqual([[1, 2, 3], { var: "p" }]);
  });
});

// Actions panel (2026-11-06): the catalogue fit pass orders the bounded prefix.
// Its judgment is the canonical selected-slot check; the syntactic head index
// only decides which inputs to judge, and equal slot schemes share one verdict.
describe("Suggestions catalogue fit", () => {
  test("bare variables are generic, other heads stay unresolved unjudged, equal heads are judged once per slot scheme", () => {
    const judged: unknown[] = [];
    const judge = (_actual: unknown, slot: { body: Record<string, unknown> }) => {
      judged.push(slot.body);
      return Object.keys(slot.body).length === 1 ? "compatible" : "incompatible";
    };
    const project = (scheme: { body: { $arrow: { params: { type: unknown }[] } } }, path: string[]) =>
      ({ quantified: [], body: scheme.body.$arrow.params[Number(path[2])]!.type });
    const fit = new Function("exactImmutableDataEqual", "exactImmutableDataSnapshot", "lensPolicyData", "evaluatorHookGenerationForMemo",
      "callSiteNominalGroundType", "judgeAuthoringSchemeCompatibility", "projectAuthoringScheme", `${code};
      return { catalogueFit, typeHead };`)(exactImmutableDataEqual, exactImmutableDataSnapshot, () => { throw new Error("no policy"); },
      () => 1, callSiteNominalGroundType, judge, project);
    const fn = (...types: unknown[]) => ({ signatureOutcome: { $tag: "Solved" },
      scheme: { quantified: [], body: { $arrow: { params: types.map(type => ({ name: "x", type })), returns: { $ref: "Number" } } } } });
    const session = { registry: {} };
    const subject = { quantified: [], body: { $ref: "Number" } };
    const memo = new Map();
    const head = fit.typeHead(subject.body);
    expect(head).toBe("ref:Number");
    expect(fit.catalogueFit(session, subject, fn({ $ref: "Number" }), memo, head)).toBe(0);
    expect(fit.catalogueFit(session, subject, fn({ $ref: "String" }, { $ref: "Number" }), memo, head)).toBe(0);
    expect(judged).toHaveLength(1);
    expect(fit.catalogueFit(session, subject, fn({ $var: "a" }), memo, head)).toBe(1);
    expect(fit.catalogueFit(session, subject, fn({ $ref: "String" }), memo, head)).toBe(2);
    expect(fit.catalogueFit(session, subject, fn({ $ref: "Number", args: [] }), memo, head)).toBe(3);
    expect(judged).toHaveLength(2);
    expect(fit.catalogueFit(session, subject, fn(), memo, head)).toBe(3);
    expect(fit.catalogueFit(session, undefined, fn({ $ref: "Number" }), memo, undefined)).toBe(2);
    expect(fit.catalogueFit(session, subject, { ...fn({ $ref: "Number" }), signatureOutcome: { $tag: "Invalid" } }, memo, head)).toBe(2);
    expect(fit.typeHead({ $opaque: { name: "List", pure: {} } })).toBe("opaque:List");
    expect(fit.typeHead({ $record: { fields: [] } })).toBe("$record");
  });
});

// Lane D (2026-11-08, Rom's decision (b)): transport of a function's own
// internal marker. The canonical selection (resolveEffect) and the Fenel rule
// (`suggestionInternal`) are held at their ports; this checks what is sent.
describe("functions marked internal (transport)", () => {
  function marker(instances: Record<string, Record<string, Record<string, unknown>>>) {
    const asked: unknown[][] = [];
    const resolved: string[] = [];
    const resolveEffect = (_frame: unknown, _pool: unknown, typeName: string, id: string) => {
      resolved.push(`${typeName}:${id}`);
      const methods = instances[id]?.[typeName];
      return methods ? { methods } : undefined;
    };
    const policy = (_session: unknown, name: string, ...args: unknown[]) => {
      if (name !== "suggestionInternal") throw new Error(`Unexpected controlled policy ${name}`);
      asked.push(args);
      const [category, tags] = args as [string, string[]];
      return category.endsWith("-internal") || tags.includes("internal");
    };
    const api = new Function("exactImmutableDataEqual", "exactImmutableDataSnapshot", "lensPolicyData", "evaluatorHookGenerationForMemo",
      "callSiteNominalGroundType", "asAuthoringScheme", "resolveEffect", `${code};
      return { functionMarkedInternal };`)(exactImmutableDataEqual, exactImmutableDataSnapshot, policy, () => 1,
      callSiteNominalGroundType, asAuthoringScheme, resolveEffect);
    const session = { evaluateContext: Object.freeze({ _specRegistry: {} }) };
    return { mark: (ids: (string | undefined)[]) => api.functionMarkedInternal(session, ids), asked, resolved };
  }

  test("the function's own category and tags reach the Fenel rule, once per distinct facts", () => {
    const m = marker({
      "std:documentExportText": { Categorizable: { category: "document-internal" } },
      "std:escapeHtml": { Taggable: { tags: ["text", "html"] } },
      "uuid-helper": { Taggable: { tags: ["engine", "internal"] } },
      "std:otherDocumentHelper": { Categorizable: { category: "document-internal" } },
    });
    expect(m.mark(["std:documentExportText"])).toBe(true);
    expect(m.mark(["std:escapeHtml"])).toBe(false);
    // The catalogue target, its id and its handle are each looked up.
    expect(m.mark([undefined, "engine:helper", "uuid-helper"])).toBe(true);
    expect(m.mark(["std:otherDocumentHelper"])).toBe(true);
    expect(m.asked).toEqual([["document-internal", []], ["", ["text", "html"]], ["", ["engine", "internal"]]]);
    // A repeated function is answered from the frame's cache.
    const lookups = m.resolved.length;
    expect(m.mark(["std:documentExportText"])).toBe(true);
    expect(m.resolved.length).toBe(lookups);
  });

  test("a reader without a representation registry marks nothing", () => {
    const api = new Function("exactImmutableDataEqual", "exactImmutableDataSnapshot", "lensPolicyData", "evaluatorHookGenerationForMemo",
      "callSiteNominalGroundType", "asAuthoringScheme", "resolveEffect", `${code};
      return { functionMarkedInternal };`)(exactImmutableDataEqual, exactImmutableDataSnapshot,
      () => { throw new Error("no policy"); }, () => 1, callSiteNominalGroundType, asAuthoringScheme,
      () => { throw new Error("no selection"); });
    expect(api.functionMarkedInternal({ evaluateContext: Object.freeze({}) }, ["std:documentExportText"])).toBe(false);
  });
});

// Lane D (2026-11-08): the bounded first check judges another module's
// user-facing function when its input concretely admits the data, so a type's
// own operations from another module (games.imageGame on an Image) meet it.
describe("which catalogue inputs the first check judges", () => {
  const fit = new Function("exactImmutableDataEqual", "exactImmutableDataSnapshot", "lensPolicyData", "evaluatorHookGenerationForMemo",
    "callSiteNominalGroundType", "asAuthoringScheme", `${code};
    return catalogueEntryFit;`)(exactImmutableDataEqual, exactImmutableDataSnapshot, () => { throw new Error("no policy"); },
    () => 1, callSiteNominalGroundType, asAuthoringScheme) as (moduleName: string, internal: boolean, judge: () => number) => number;
  test("std and reader-local callables keep every verdict", () => {
    for (const verdict of [0, 1, 2, 3]) {
      expect(fit("std", false, () => verdict)).toBe(verdict);
      expect(fit("", false, () => verdict)).toBe(verdict);
    }
  });
  test("another module's typed match and definite refusal count; its generic input stays unresolved", () => {
    expect(fit("games", false, () => 0)).toBe(0);
    expect(fit("games", false, () => 3)).toBe(3);
    expect(fit("games", false, () => 1)).toBe(2);
    expect(fit("games", false, () => 2)).toBe(2);
  });
  test("an internal helper of another module is not judged", () => {
    expect(fit("engine", true, () => { throw new Error("judged"); })).toBe(2);
  });
});

// Lane D (2026-11-09, Rom's pins): the function's own tags reach the Fenel
// `suggestionPinnedAction` rule (held at its port here).
describe("pinned actions (transport)", () => {
  test("the function's own tags reach the pin rule, once per distinct facts", () => {
    const asked: unknown[][] = [];
    const tags: Record<string, string[]> = { "std:upper": ["text", "case", "pin"], "std:capitalize": ["text", "case"] };
    const api = new Function("exactImmutableDataEqual", "exactImmutableDataSnapshot", "lensPolicyData", "evaluatorHookGenerationForMemo",
      "callSiteNominalGroundType", "asAuthoringScheme", "resolveEffect", `${code};
      return { functionPinnedAction };`)(exactImmutableDataEqual, exactImmutableDataSnapshot,
      (_session: unknown, name: string, ...args: unknown[]) => {
        if (name !== "suggestionPinnedAction") throw new Error(`Unexpected controlled policy ${name}`);
        asked.push(args); return (args[0] as string[]).includes("pin");
      }, () => 1, callSiteNominalGroundType, asAuthoringScheme,
      (_frame: unknown, _pool: unknown, typeName: string, id: string) => typeName === "Taggable" && tags[id] ? { methods: { tags: tags[id] } } : undefined);
    const session = { evaluateContext: Object.freeze({ _specRegistry: {} }) };
    expect(api.functionPinnedAction(session, ["std:upper"])).toBe(true);
    expect(api.functionPinnedAction(session, ["std:capitalize"])).toBe(false);
    expect(api.functionPinnedAction(session, ["std:upper"])).toBe(true);
    expect(asked).toEqual([[["text", "case", "pin"]], [["text", "case"]]]);
  });
});

// Nov 11 (Rom: "Aren't array and list the same in Fenel?!"): the function's own
// tags reach the Fenel `suggestionRepresentationBridge` rule (held at its port
// here). An unreadable rule hides nothing. That discovery drops a marked
// function is checked on the real catalogue in data-suggestions-ranking.test.ts.
describe("representation bridges (transport)", () => {
  const tags: Record<string, string[]> = {
    "std:listToArray": ["list", "array", "repr", "bridge"],
    "std:arrayToList": ["list", "array", "repr", "bridge"],
    "std:reverse": ["list", "text", "pin"],
  };
  const select = (_frame: unknown, _pool: unknown, typeName: string, id: string) =>
    typeName === "Taggable" && tags[id] ? { methods: { tags: tags[id] } } : undefined;
  const transport = (policy: (session: unknown, name: string, ...args: unknown[]) => unknown) =>
    new Function("exactImmutableDataEqual", "exactImmutableDataSnapshot", "lensPolicyData", "evaluatorHookGenerationForMemo",
      "callSiteNominalGroundType", "asAuthoringScheme", "resolveEffect", `${code};
      return { functionRepresentationBridge };`)(exactImmutableDataEqual, exactImmutableDataSnapshot, policy, () => 1,
      callSiteNominalGroundType, asAuthoringScheme, select);

  test("the function's own tags reach the bridge rule, once per distinct facts", () => {
    const asked: unknown[][] = [];
    const api = transport((_session, name, ...args) => {
      if (name !== "suggestionRepresentationBridge") throw new Error(`Unexpected controlled policy ${name}`);
      asked.push(args);
      const facts = args[0] as string[];
      return (facts.includes("bridge") || facts.includes("iso")) && (facts.includes("repr") || facts.includes("numeric"));
    });
    const session = { evaluateContext: Object.freeze({ _specRegistry: {} }) };
    expect(api.functionRepresentationBridge(session, ["std:listToArray"])).toBe(true);
    expect(api.functionRepresentationBridge(session, ["std:reverse"])).toBe(false);
    // Same facts: judged once. The catalogue target, its id and handle are each looked up.
    expect(api.functionRepresentationBridge(session, [undefined, "std:arrayToList"])).toBe(true);
    expect(asked).toEqual([[["list", "array", "repr", "bridge"]], [["list", "text", "pin"]]]);
  });

  test("an unreadable rule or a reader without representations hides nothing", () => {
    const failing = transport(() => { throw new Error("unreadable rule"); });
    const session = { evaluateContext: Object.freeze({ _specRegistry: {} }) };
    expect(failing.functionRepresentationBridge(session, ["std:listToArray"])).toBe(false);
    expect(failing.functionRepresentationBridge({ evaluateContext: Object.freeze({}) }, ["std:listToArray"])).toBe(false);
  });
});
