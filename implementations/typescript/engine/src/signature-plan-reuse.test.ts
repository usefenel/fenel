// S3a — differential parity corpus for exact signature-plan reuse.
//
// The reuse path (`finalizeRegistryFunctionSignatures`, dispatched planner) is
// compared with the full path (the test seam with a caller-supplied planner,
// which never reuses) over the same candidates and options: equal finalized
// rows, or the same thrown refusal. Reuse counters prove which rows were
// served from retained plans.
import { describe, expect, test } from "bun:test";

import { dispatchEngineBody } from "./engine-bodies-dispatch";
import {
  __clearSignaturePlanReuseForTests,
  __finalizeRegistryFunctionSignaturesWithAuthoredPlannerForTests,
  answerBorrowedAuthoredSignaturePlans,
  answerBorrowedSignatureInference,
  finalizeRegistryFunctionSignatures,
  finalizeRegistryOwnedFunctionSignatures,
  finalizeRegistryOwnedFunctionSignaturesAsync,
  type SignatureBorrow,
  type SignatureBorrowRequest,
  signaturePlanReuseStats,
  __exactTransportKeyForTests,
  type RegistryFunctionSignatureCandidate,
  type RegistrySignatureFinalizationOptions,
  SignatureAnnotationRequiredError,
  type SignatureResolutionRow,
} from "./signature-inference";
import { Nothing } from "./type-foundation";
import type { FieldDef, FenelFunction, FenelType, TypeScheme } from "./types";

const authored = { $tag: "Authored" as const, source: { $tag: "HostSpec" as const, module: "plan-reuse-test" } };
const positional = (name: string, index: number, type: FenelType): FieldDef =>
  ({ name, key: { $tag: "PositionalField", index }, type, label: Nothing, ui: Nothing, meta: {} });

function complete(id: string, codeName: string, params: readonly FieldDef[], returns: FenelType,
  scheme: TypeScheme = { quantified: [], body: { $arrow: { params: [...params], returns } } }): RegistryFunctionSignatureCandidate {
  const fn: FenelFunction = { id, params: [...params], returns, body: params.length === 0 ? null : { var: params[0]!.name } };
  return {
    fn,
    declaration: { functionId: id, declarationName: codeName, codeName, scheme, params: params.map(() => authored), returns: authored },
    implementationOrigin: { $tag: "HostNative", map: "nativeImpls" },
  };
}
function inferred(id: string, body: NonNullable<FenelFunction["body"]>): RegistryFunctionSignatureCandidate {
  const codeName = id.slice(id.indexOf(":") + 1);
  return {
    fn: { id, params: [], returns: { $var: "compat-return" }, body },
    declaration: { functionId: id, declarationName: codeName, codeName, params: [], returns: { $tag: "Absent" } },
    implementationOrigin: { $tag: "FenelBody" },
  };
}
const stringFn = (prefix: string, n: number, returns: FenelType = { $ref: "String" }) => {
  const suffix = String(n).padStart(3, "0");
  return complete(`${prefix}:fn${suffix}`, `fn${suffix}`, [positional("value", 0, { $ref: "String" })], returns);
};
const roster = (prefix: string, count: number) => Array.from({ length: count }, (_, n) => stringFn(prefix, n));

function routing(candidates: readonly RegistryFunctionSignatureCandidate[]): SignatureResolutionRow[] {
  const bindings = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    for (const name of [candidate.fn.id, candidate.declaration.codeName]) {
      const ids = bindings.get(name) ?? new Set<string>();
      ids.add(candidate.fn.id);
      bindings.set(name, ids);
    }
  }
  return [...bindings].sort(([l], [r]) => (l < r ? -1 : l > r ? 1 : 0)).map(([name, ids]) => ids.size === 1
    ? { name, status: "resolved" as const, targetId: [...ids][0]! }
    : { name, status: "ambiguous" as const, targetId: "" });
}
const optionsFor = (candidates: readonly RegistryFunctionSignatureCandidate[]): RegistrySignatureFinalizationOptions =>
  ({ resolutions: routing(candidates) });

function full(candidates: readonly RegistryFunctionSignatureCandidate[], options = optionsFor(candidates)) {
  return __finalizeRegistryFunctionSignaturesWithAuthoredPlannerForTests(candidates, options,
    (batch, path) => dispatchEngineBody("engine:planAuthoredTopLevelSignatures", [batch, path]));
}
function reuse(candidates: readonly RegistryFunctionSignatureCandidate[], options = optionsFor(candidates)) {
  const before = signaturePlanReuseStats();
  const value = finalizeRegistryFunctionSignatures(candidates, options);
  const after = signaturePlanReuseStats();
  return {
    value,
    hits: after.authoredHits - before.authoredHits,
    planned: after.authoredPlanned - before.authoredPlanned,
    fallbacks: after.authoredFallbacks - before.authoredFallbacks,
    inferenceHits: after.inferenceHits - before.inferenceHits,
    inferenceCalls: after.inferenceCalls - before.inferenceCalls,
  };
}
function thrown(run: () => unknown): unknown {
  try { run(); } catch (error) { return error; }
  return undefined;
}

describe("S3a exact plan reuse equals the full finalization", () => {
  test("1 a second identical batch is served entirely from retained plans", () => {
    const candidates = roster("reuse-one", 257);
    const reference = full(candidates);
    const first = reuse(candidates);
    expect(first.value).toEqual(reference);
    expect(first.planned).toBe(257);
    const second = reuse(candidates);
    expect(second.value).toEqual(reference);
    expect(second.hits).toBe(257);
    expect(second.planned).toBe(0);
  }, 300_000);

  test("2 one changed row is planned again, the others are reused", () => {
    const base = roster("reuse-two", 130);
    reuse(base);
    const changed = [...base];
    changed[64] = stringFn("reuse-two", 64, { $ref: "Number" });
    const run = reuse(changed);
    expect(run.value).toEqual(full(changed));
    expect(run.hits).toBe(129);
    expect(run.planned).toBe(1);
  }, 300_000);

  test("3 a new Local authored candidate next to a reused base", () => {
    const base = roster("reuse-three", 40);
    reuse(base);
    const withLocal = [...base, complete("9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d", "localThing",
      [positional("count", 0, { $ref: "Number" })], { $ref: "Number" })];
    const run = reuse(withLocal);
    expect(run.value).toEqual(full(withLocal));
    expect(run.hits).toBe(40);
    expect(run.planned).toBe(1);
  }, 300_000);

  test("4 a fenced (Advisory) authored row is reused and stays fenced", () => {
    const dependent = { $el: { call: ["Vec", { var: "length" }] } } as FenelType;
    const params = [positional("length", 0, { $ref: "Number" })];
    const fenced = complete("reuse-four:tabulateVec", "tabulateVec", params, dependent,
      { quantified: [], body: { $arrow: { params, returns: dependent } }, applications: [] });
    const candidates = [...roster("reuse-four", 3), fenced];
    reuse(candidates);
    const run = reuse(candidates);
    expect(run.hits).toBe(4);
    expect(run.value).toEqual(full(candidates));
    const row = run.value.find((entry) => entry.fn.id === fenced.fn.id)!;
    expect(row.info.outcome.$tag).toBe("AnnotationRequired");
    expect(row.info.trust.$tag).toBe("Advisory");
  }, 300_000);

  test("5 a changed nominal resolution changes the row and is planned again", () => {
    const params = [positional("item", 0, { $ref: "Widget" })];
    const candidate = complete("reuse-five:useWidget", "useWidget", params, { $ref: "String" });
    const nominal = (id: string): RegistrySignatureFinalizationOptions => ({
      resolutions: routing([candidate]),
      resolveCandidateNominalReferences: (_candidateId: string, names: readonly string[]) =>
        names.map((name) => ({ name, status: "resolved" as const, targetId: name === "Widget" ? id : name })),
    } as RegistrySignatureFinalizationOptions);
    const first = reuse([candidate], nominal("widget-a"));
    expect(first.value).toEqual(full([candidate], nominal("widget-a")));
    const same = reuse([candidate], nominal("widget-a"));
    expect(same.hits).toBe(1);
    const moved = reuse([candidate], nominal("widget-b"));
    expect(moved.value).toEqual(full([candidate], nominal("widget-b")));
  }, 300_000);

  test("6 a failing authored row among reusable ones gives the full path's refusal", () => {
    const base = roster("reuse-six", 140);
    reuse(base);
    const broken = [...base];
    const target = broken[130]!;
    broken[130] = {
      ...target,
      declaration: {
        ...target.declaration,
        scheme: { ...target.declaration.scheme!, diagnostics: [{ code: "UnboundSourceTypeVariable",
          declaration: target.declaration.declarationName, path: ["params", "0"], spelling: "zz", message: "unbound source type variable zz" }] },
      } as RegistryFunctionSignatureCandidate["declaration"],
    };
    const before = signaturePlanReuseStats().authoredFallbacks;
    const reference = thrown(() => full(broken));
    const actual = thrown(() => finalizeRegistryFunctionSignatures(broken, optionsFor(broken)));
    expect(reference).toBeInstanceOf(SignatureAnnotationRequiredError);
    expect(actual).toBeInstanceOf(SignatureAnnotationRequiredError);
    const left = reference as SignatureAnnotationRequiredError;
    const right = actual as SignatureAnnotationRequiredError;
    expect(right.outcomeTag).toBe(left.outcomeTag);
    expect(right.diagnostics).toEqual(left.diagnostics);
    expect(right.message).toBe(left.message);
    expect(signaturePlanReuseStats().authoredFallbacks).toBe(before + 1);
  }, 300_000);

  test("7 missing-slot inference: an identical call is reused, a new inferred function is recomputed", () => {
    const callee = inferred("reuse-seven:grandparentExpr", 7);
    const authoredRoster = roster("reuse-seven", 5);
    const base = [...authoredRoster, callee, inferred("reuse-seven:usesFn", { call: ["fn001", "x"] })];
    const reference = full(base);
    const first = reuse(base);
    expect(first.value).toEqual(reference);
    const second = reuse(base);
    expect(second.value).toEqual(reference);
    expect(second.inferenceHits).toBe(1);
    expect(second.inferenceCalls).toBe(0);
    // pre-flight case 30: a Local inferred function calling a repository
    // inferred zero-arity function is inferred together with it.
    const withLocal = [...base, inferred("5d6e7f8a-9b0c-4d1e-8f2a-3b4c5d6e7f8a", { call: ["grandparentExpr"] })];
    const third = reuse(withLocal);
    expect(third.inferenceCalls).toBe(1);
    expect(third.value).toEqual(full(withLocal));
    const local = third.value.find((row) => row.fn.id === "5d6e7f8a-9b0c-4d1e-8f2a-3b4c5d6e7f8a")!;
    expect(local.info.outcome.$tag).toBe("Solved");
    expect(local.info.trust.$tag).toBe("InferredDerivation");
  }, 300_000);

  test("7b identical inferred candidates over a changed authored callee recompute the inference", () => {
    const callee = inferred("reuse-sevenb:grandparentExpr", 7);
    const usesFn = inferred("reuse-sevenb:usesFn", { call: ["fn001", "x"] });
    const base = [...roster("reuse-sevenb", 5), callee, usesFn];
    reuse(base);
    const changed = [...base];
    changed[1] = stringFn("reuse-sevenb", 1, { $ref: "Number" });
    const run = reuse(changed);
    expect(run.inferenceHits).toBe(0);
    expect(run.inferenceCalls).toBe(1);
    expect(run.value).toEqual(full(changed));
    const uses = run.value.find((row) => row.fn.id === usesFn.fn.id)!;
    expect(uses.info.scheme.body).toEqual(full(changed).find((row) => row.fn.id === usesFn.fn.id)!.info.scheme.body);
  }, 300_000);

  const exactly = (rows: (readonly [string, string])[]) => (_id: string, names: readonly string[]) =>
    names.map((name) => {
      const hit = rows.find(([spelling]) => spelling === name);
      return hit === undefined
        ? { name, status: "missing" as const, targetId: "" }
        : { name, status: "resolved" as const, targetId: hit[1] };
    });
  const sameOutcome = (candidates: readonly RegistryFunctionSignatureCandidate[], options: RegistrySignatureFinalizationOptions) => {
    let referenceValue: unknown;
    const reference = thrown(() => { referenceValue = full(candidates, options); });
    const before = signaturePlanReuseStats();
    let value: unknown;
    const error = thrown(() => { value = finalizeRegistryFunctionSignatures(candidates, options); });
    const after = signaturePlanReuseStats();
    if (reference === undefined) {
      expect(error).toBeUndefined();
      expect(value).toEqual(referenceValue);
    } else {
      expect(String(error)).toBe(String(reference));
    }
    return { hits: after.inferenceHits - before.inferenceHits, calls: after.inferenceCalls - before.inferenceCalls };
  };

  test("7c a change of the routing rows alone recomputes the inference", () => {
    const callee = stringFn("reuse-sevenc", 1);
    const usesFn = inferred("reuse-sevenc:usesFn", { call: ["fn001", "x"] });
    const candidates = [callee, usesFn];
    const resolveCandidateReferences = exactly([["fn001", callee.fn.id]]);
    const plain: RegistrySignatureFinalizationOptions = { resolutions: routing(candidates), resolveCandidateReferences };
    sameOutcome(candidates, plain);
    expect(sameOutcome(candidates, plain)).toEqual({ hits: 1, calls: 0 });
    const fenced: RegistrySignatureFinalizationOptions = {
      resolutions: routing(candidates).map((row) => row.name === "fn001"
        ? { name: row.name, status: "fenced" as const, targetId: row.targetId, verdict: "AnnotationRequired" as const,
            diagnostics: [{ code: "inference.unknown-name", message: "fenced routing row", functionId: callee.fn.id }] }
        : row),
      resolveCandidateReferences,
    };
    expect(sameOutcome(candidates, fenced)).toEqual({ hits: 0, calls: 1 });
  }, 300_000);

  test("7d a change of a constructor entity alone recomputes the inference", () => {
    const boxEntity = (payload: FenelType) => ({
      ownerName: "Box", ownerIdentity: "type/module/reuse-sevend/Box", ownerModule: "reuse-sevend",
      targetPrefix: "@ctor/reuse-sevend/Box/",
      typeScheme: { quantified: [], body: { $variant: { cases: [
        { name: "MkBox", label: Nothing, fields: [positional("_0", 0, payload)] },
      ] } } } as TypeScheme,
    });
    const makes = inferred("reuse-sevend:makesBox", { construct: ["MkBox", "x"] });
    const optionsWith = (payload: FenelType): RegistrySignatureFinalizationOptions => ({
      resolutions: routing([makes]),
      resolveCandidateReferences: exactly([["$ctor:MkBox", "@ctor/reuse-sevend/Box/MkBox"]]),
      // Payload nominals resolve to the system identities the literal rule uses.
      resolveConstructorEntityNominalReferences: (_id: string, names: readonly string[]) =>
        names.map((name) => ({ name, status: "resolved" as const, targetId: JSON.stringify(["system", name]) })),
      constructorEntities: [boxEntity(payload)],
    } as RegistrySignatureFinalizationOptions);
    sameOutcome([makes], optionsWith({ $ref: "String" }));
    expect(sameOutcome([makes], optionsWith({ $ref: "String" }))).toEqual({ hits: 1, calls: 0 });
    expect(sameOutcome([makes], optionsWith({ $ref: "Number" }))).toEqual({ hits: 0, calls: 1 });
  }, 300_000);

  test("9 rows that differ only by NaN versus null never share a plan", () => {
    expect(__exactTransportKeyForTests({ value: Number.NaN })).not.toBe(__exactTransportKeyForTests({ value: null }));
    expect(__exactTransportKeyForTests([-0])).not.toBe(__exactTransportKeyForTests([0]));
    expect(__exactTransportKeyForTests({ a: undefined })).not.toBe(__exactTransportKeyForTests({}));
    const params = [positional("length", 0, { $ref: "Number" })];
    const dependentOn = (literal: unknown) => {
      const dependent = { $el: { call: ["Vec", literal] } } as FenelType;
      return complete("reuse-nine:tabulate", "tabulate", params, dependent,
        { quantified: [], body: { $arrow: { params, returns: dependent } }, applications: [] });
    };
    const withNaN = [dependentOn(Number.NaN)];
    const withNull = [dependentOn(null)];
    reuse(withNaN);
    const run = reuse(withNull);
    expect(run.hits).toBe(0);
    expect(run.planned).toBe(1);
    expect(run.value).toEqual(full(withNull));
  }, 300_000);

  test("8 reused plans are fresh objects for every caller", () => {
    const candidates = roster("reuse-eight", 2);
    const first = reuse(candidates).value;
    const second = reuse(candidates).value;
    expect(second).toEqual(first);
    expect(second[0]!.info.scheme).not.toBe(first[0]!.info.scheme);
    expect(second[0]!.info.trust).not.toBe(first[0]!.info.trust);
    const evidence = (row: (typeof first)[number]) => (row.info.trust as { evidence?: unknown }).evidence;
    expect(evidence(second[0]!)).toBeDefined();
    expect(evidence(second[0]!)).not.toBe(evidence(first[0]!));
  }, 300_000);
});

// L5a — the async driver may borrow the plans its store misses from a realm
// with an equal harness. The borrowing side must accept only a whole, ordered,
// decodable answer and otherwise run the unchanged local path.
describe("L5a borrowed signature plans", () => {
  const PATH = "registry/signatures/authored";
  /** The requester's S3a key of an authored row (path included). */
  const keyOf = (row: unknown) => `${PATH}\u0002${__exactTransportKeyForTests(row)!}`;
  type AuthoredRequest = Extract<SignatureBorrowRequest, { kind: "signatureAuthoredPlans" }>;
  /** Plan items exactly as a worker's planner would produce them, without
   * touching this realm's store or counters. */
  const plannedItems = (rows: readonly unknown[]) => {
    const raw = dispatchEngineBody("engine:planAuthoredTopLevelSignatures", [rows, PATH]) as
      { $tag: string; plan: { functions: unknown[] } };
    expect(raw.$tag).toBe("Solved");
    return raw.plan.functions;
  };
  const counters = () => signaturePlanReuseStats();
  const delta = (before: ReturnType<typeof counters>, after: ReturnType<typeof counters>) => ({
    planned: after.authoredPlanned - before.authoredPlanned,
    borrowed: (after.authoredBorrowed ?? 0) - (before.authoredBorrowed ?? 0),
    hits: after.authoredHits - before.authoredHits,
    inferenceCalls: after.inferenceCalls - before.inferenceCalls,
    inferenceBorrowed: (after.inferenceBorrowed ?? 0) - (before.inferenceBorrowed ?? 0),
  });
  async function borrowing(candidates: readonly RegistryFunctionSignatureCandidate[], borrow: SignatureBorrow,
    options = optionsFor(candidates), signal?: AbortSignal) {
    const requests: SignatureBorrowRequest[] = [];
    const before = counters();
    let value: unknown;
    let error: unknown;
    try {
      value = await finalizeRegistryOwnedFunctionSignaturesAsync(candidates, options, signal, (request) => {
        requests.push(request);
        return borrow(request);
      });
    } catch (caught) { error = caught; }
    return { value, error, requests, ...delta(before, counters()) };
  }
  /** The registry-owned synchronous driver (no borrow): the page and the
   * worker both finalize registry-owned candidates, whose S3a keys differ
   * from the public ingress's snapshotted ones. */
  function owned(candidates: readonly RegistryFunctionSignatureCandidate[], options = optionsFor(candidates)) {
    const before = counters();
    const value = finalizeRegistryOwnedFunctionSignatures(candidates, options);
    return { value, ...delta(before, counters()) };
  }
  const supplier: SignatureBorrow = async (request) => request.kind === "signatureAuthoredPlans"
    ? { status: "Solved", items: plannedItems(request.rows) }
    : { status: "Abandon" };
  /** The authored boundary rows the step yields for `candidates`, recorded
   * from an Abandoning borrow over a same-shaped roster (the test never
   * re-implements the boundary). */
  async function boundaryRows(prefix: string, count: number): Promise<Array<{ id: string }>> {
    const recorder = await borrowing(roster(prefix, count), async () => ({ status: "Abandon" }));
    expect(recorder.requests).toHaveLength(1);
    return (recorder.requests[0] as AuthoredRequest).rows as Array<{ id: string }>;
  }

  test("L5a-1 a borrow that supplies every row plans nothing locally and equals the full finalization", async () => {
    const candidates = roster("borrow-one", 130);
    const reference = full(candidates);
    const run = await borrowing(candidates, supplier);
    expect(run.error).toBeUndefined();
    expect(run.requests.map((request) => request.kind)).toEqual(["signatureAuthoredPlans"]);
    expect(run.planned).toBe(0);
    expect(run.borrowed).toBe(130);
    expect(run.value).toEqual(reference);
    // Retained: a later page build of the same rows is served from its store.
    const again = owned(candidates);
    expect(again.hits).toBe(130);
    expect(again.planned).toBe(0);
    expect(again.value).toEqual(reference);
  }, 300_000);

  test("L5a-2 only the rows this realm's store misses are requested, in candidate order", async () => {
    const base = roster("borrow-two", 6);
    owned(base.slice(0, 4));
    const run = await borrowing(base, supplier);
    expect(run.requests).toHaveLength(1);
    const rows = (run.requests[0] as AuthoredRequest).rows as Array<{ id: string }>;
    expect(rows.map((row) => row.id)).toEqual([base[4]!.fn.id, base[5]!.fn.id]);
    expect(run.hits).toBe(4);
    expect(run.borrowed).toBe(2);
    expect(run.planned).toBe(0);
    expect(run.value).toEqual(full(base));
  }, 300_000);

  // Each unacceptable answer, over a valid roster (the full path's value,
  // planned locally) and over a roster with a refused row (the full path's
  // exact refusal).
  const unacceptable: Array<[string, (items: unknown[]) => SignatureBorrow]> = [
    ["Abandon", () => async () => ({ status: "Abandon" })],
    ["a rejection", () => async () => { throw new Error("worker closed"); }],
    ["a thrown borrow", () => () => { throw new Error("lease sealed"); }],
    ["no answer", () => async () => undefined],
    ["a wrong length", (items) => async () => ({ status: "Solved", items: items.slice(1) })],
    ["a wrong order", (items) => async () => ({ status: "Solved", items: [items[1], items[0], ...items.slice(2)] })],
    ["a malformed item", (items) => async () => ({ status: "Solved",
      items: [{ ...(items[0] as object), status: "bogus" }, ...items.slice(1)] })],
    ["a non-Solved status", (items) => async () => ({ status: "Refused", items } as never)],
  ];
  for (const [label, makeBorrow] of unacceptable) {
    test(`L5a-3 ${label} falls back to the local path with the full path's value or refusal`, async () => {
      const prefix = `borrow-bad-${label.replace(/[^a-z]+/g, "-")}`;
      const candidates = roster(prefix, 3);
      const rows = await boundaryRows(`${prefix}-rows`, 3);
      const items = plannedItems(rows.map((row, index) => ({ ...row, id: candidates[index]!.fn.id })));
      const valid = await borrowing(candidates, makeBorrow(items));
      expect(valid.error).toBeUndefined();
      expect(valid.borrowed).toBe(0);
      expect(valid.planned).toBe(3);
      expect(valid.value).toEqual(full(candidates));

      const broken = roster(`${prefix}-broken`, 3);
      const target = broken[1]!;
      broken[1] = { ...target, declaration: { ...target.declaration, scheme: { ...target.declaration.scheme!, diagnostics: [{
        code: "UnboundSourceTypeVariable", declaration: target.declaration.declarationName, path: ["params", "0"],
        spelling: "zz", message: "unbound source type variable zz" }] } } as RegistryFunctionSignatureCandidate["declaration"] };
      const brokenItems = items.map((item, index) => ({ ...(item as object), id: broken[index]!.fn.id }));
      const reference = thrown(() => full(broken));
      expect(reference).toBeInstanceOf(SignatureAnnotationRequiredError);
      const refused = await borrowing(broken, makeBorrow(brokenItems));
      expect(refused.borrowed).toBe(0);
      expect(refused.error).toBeInstanceOf(SignatureAnnotationRequiredError);
      const left = reference as SignatureAnnotationRequiredError;
      const right = refused.error as SignatureAnnotationRequiredError;
      expect(right.outcomeTag).toBe(left.outcomeTag);
      expect(right.diagnostics).toEqual(left.diagnostics);
      expect(right.message).toBe(left.message);
    }, 300_000);
  }

  test("L5a-4 an unkeyable row means no borrow request at all", async () => {
    const candidates = roster("borrow-four", 3);
    const target = candidates[2]!;
    // A symbol-keyed property has no exact key in the registry-transport
    // grammar; the authored row carries the scheme's diagnostics as given.
    const diagnostic = { code: "UnboundSourceTypeVariable", declaration: target.declaration.declarationName,
      path: ["params", "0"], spelling: "zz", message: "unbound source type variable zz" };
    Object.defineProperty(diagnostic, Symbol("unkeyable"), { value: 1, enumerable: true });
    candidates[2] = { ...target, declaration: { ...target.declaration, scheme: { ...target.declaration.scheme!,
      diagnostics: [diagnostic] } } as RegistryFunctionSignatureCandidate["declaration"] };
    // The registry-owned path (no ingress snapshot, which would refuse the
    // symbol outright) without a borrow is the reference.
    const reference = thrown(() => finalizeRegistryOwnedFunctionSignatures(candidates, optionsFor(candidates)));
    const run = await borrowing(candidates, supplier);
    expect(run.requests.filter((request) => request.kind === "signatureAuthoredPlans")).toEqual([]);
    expect(run.borrowed).toBe(0);
    expect(reference).toBeInstanceOf(SignatureAnnotationRequiredError);
    expect(String(run.error)).toBe(String(reference));
  }, 300_000);

  test("L5a-5 an abort while the borrow is awaited rejects with the abort reason", async () => {
    const controller = new AbortController();
    const reason = new Error("build cancelled");
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => { entered = resolve; });
    const candidates = roster("borrow-five", 2);
    const pending = borrowing(candidates, () => { entered(); return new Promise(() => undefined); },
      optionsFor(candidates), controller.signal);
    await waiting;
    controller.abort(reason);
    const run = await pending;
    expect(run.error).toBe(reason);
  }, 300_000);

  test("L5a-6 inference: a borrowed Solved outcome replaces the local call; anything else computes it", async () => {
    const base = [...roster("borrow-six", 2), inferred("borrow-six:grandparentExpr", 7),
      inferred("borrow-six:usesFn", { call: ["fn001", "x"] })];
    const reference = full(base);
    let inferenceRequests = 0;
    const run = await borrowing(base, async (request) => {
      if (request.kind === "signatureAuthoredPlans") return { status: "Solved", items: plannedItems(request.rows) };
      inferenceRequests += 1;
      return { status: "Solved", items: [dispatchEngineBody("engine:inferTopLevelSignatures", [...request.arguments])] };
    });
    expect(run.error).toBeUndefined();
    expect(inferenceRequests).toBe(1);
    expect(run.inferenceCalls).toBe(0);
    expect(run.inferenceBorrowed).toBe(1);
    expect(run.value).toEqual(reference);
    // Retained: the same inference is now a local hit.
    expect(owned(base)).toMatchObject({ inferenceCalls: 0 });
    const answers: unknown[] = [{ status: "Abandon" }, { status: "Solved", items: [] },
      { status: "Solved", items: [{ $tag: "Invalid", diagnostics: [] }] }, { status: "Solved", items: [{ $tag: "Solved" }] }];
    for (const [index, answer] of answers.entries()) {
      const changed = [...roster(`borrow-six-${index}`, 2), inferred(`borrow-six-${index}:grandparentExpr`, 7),
        inferred(`borrow-six-${index}:usesFn`, { call: ["fn001", "x"] })];
      const fallback = await borrowing(changed, async (request) => request.kind === "signatureAuthoredPlans"
        ? { status: "Abandon" } : answer as never);
      expect(fallback.error).toBeUndefined();
      expect(fallback.inferenceBorrowed).toBe(0);
      expect(fallback.inferenceCalls).toBe(1);
      expect(fallback.value).toEqual(full(changed));
    }
  }, 300_000);

  type MutableInferencePlan = { id: string; scheme: { body: unknown }; paramSlots: unknown[]; returnSlot: unknown };
  type MutableInferenceOutcome = { plan: { functions: MutableInferencePlan[] } };
  // A borrowed outcome can pass decodeInference and still fail the final
  // candidate projection. Publication must wait for that projection.
  for (const [label, mutate, message] of [
    ["wrong id", (plan: MutableInferencePlan) => { plan.id = "borrow-retention:other"; }, ": missing inferred plan"],
    ["wrong slot width", (plan: MutableInferencePlan) => { plan.paramSlots = [{ $tag: "Authored" }]; }, ": inferred slot plan width changed"],
    ["wrong slot provenance", (plan: MutableInferencePlan) => { plan.returnSlot = { $tag: "Authored" }; }, ".returns: Fenel planned Authored for a non-authored declaration slot"],
    ["non-arrow result", (plan: MutableInferencePlan) => { plan.scheme.body = { tag: "ItUnit" }; }, ": effective top-level scheme is not an arrow"],
  ] as const) {
    test(`L5a inference retention: ${label} preserves the cold refusal and leaves the next call recoverable`, async () => {
      const candidates = [inferred(`borrow-retention-${label.replaceAll(" ", "-")}:value`, 7)];
      const reference = full(candidates);
      __clearSignaturePlanReuseForTests();
      const failed = await borrowing(candidates, async (request) => {
        expect(request.kind).toBe("signatureInference");
        if (request.kind !== "signatureInference") return { status: "Abandon" };
        const raw = structuredClone(dispatchEngineBody("engine:inferTopLevelSignatures", [...request.arguments])) as MutableInferenceOutcome;
        mutate(raw.plan.functions[0]!);
        return { status: "Solved", items: [raw] };
      });
      expect(failed.error).toBeInstanceOf(TypeError);
      expect((failed.error as Error).message).toBe(candidates[0]!.fn.id + message);
      expect(failed.inferenceBorrowed).toBe(1);
      expect(failed.inferenceCalls).toBe(0);
      expect(counters().inferenceEntries).toBe(0);
      const recovered = await borrowing(candidates, async () => ({ status: "Abandon" }));
      expect(recovered.error).toBeUndefined();
      expect(recovered.inferenceCalls).toBe(1);
      expect(recovered.requests.map((request) => request.kind)).toEqual(["signatureInference"]);
      expect(recovered.value).toEqual(reference);
    }, 300_000);
  }

  // For this single missing-slot row, the first timer after the borrow runs
  // acceptance; the second resumes the final yield before projection.
  async function atFinalInferenceYield<T>(action: () => void, run: () => Promise<T>): Promise<T> {
    const original = globalThis.setTimeout;
    let afterBorrow = false;
    let timers = 0;
    let hookFired = 0;
    let hookFailed = false;
    let hookError: unknown;
    globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number, ...rest: unknown[]) =>
      original((...args: unknown[]) => {
        try {
          if (afterBorrow && !delay && ++timers === 2) {
            hookFired += 1;
            try { action(); } catch (error) { hookFailed = true; hookError = error; }
          }
        } finally {
          callback(...args);
        }
      }, delay, ...rest)) as typeof setTimeout;
    try {
      // Set the marker only once the supplied run reaches its borrow callback.
      markInferenceBorrow = () => { afterBorrow = true; };
      const result = await run();
      if (hookFailed) throw hookError;
      expect(hookFired).toBe(1);
      return result;
    } finally {
      markInferenceBorrow = () => undefined;
      globalThis.setTimeout = original;
    }
  }
  let markInferenceBorrow: () => void = () => undefined;
  const inferenceAnswer = (request: SignatureBorrowRequest) => {
    expect(request.kind).toBe("signatureInference");
    if (request.kind !== "signatureInference") throw new Error("expected inference borrow");
    const raw = structuredClone(dispatchEngineBody("engine:inferTopLevelSignatures", [...request.arguments])) as MutableInferenceOutcome;
    markInferenceBorrow();
    return raw;
  };

  test("L5a inference retention: abort at the final yield publishes nothing and preserves the exact reason", async () => {
    const candidates = [inferred("borrow-retention-abort:value", 7)];
    const controller = new AbortController();
    const reason = new Error("abort after borrowed inference decode");
    __clearSignaturePlanReuseForTests();
    const result = await atFinalInferenceYield(() => controller.abort(reason), () => borrowing(candidates,
      async (request) => ({ status: "Solved", items: [inferenceAnswer(request)] }), optionsFor(candidates), controller.signal));
    expect(result.error).toBe(reason);
    expect(result.inferenceBorrowed).toBe(1);
    expect(counters().inferenceEntries).toBe(0);
  }, 300_000);

  test("L5a inference retention: a failing invocation cannot remove an interleaved same-key success", async () => {
    const candidates = [inferred("borrow-retention-interleaved:value", 7)];
    __clearSignaturePlanReuseForTests();
    let successful: unknown;
    let interleavedError: unknown;
    const result = await atFinalInferenceYield(() => {
      try { successful = owned(candidates).value; } catch (error) { interleavedError = error; }
    }, () => borrowing(candidates,
      async (request) => {
        const raw = inferenceAnswer(request);
        raw.plan.functions[0]!.returnSlot = { $tag: "Authored" };
        return { status: "Solved", items: [raw] };
      }));
    expect(result.error).toBeInstanceOf(TypeError);
    expect(interleavedError).toBeUndefined();
    expect(counters().inferenceEntries).toBe(1);
    const warm = await borrowing(candidates, async () => { throw new Error("must use the successful retained answer"); });
    expect(warm.error).toBeUndefined();
    expect(warm.requests).toEqual([]);
    expect(warm.inferenceCalls).toBe(0);
    expect(warm.value).toEqual(successful);
  }, 300_000);

  test("L5a inference retention: mutation after acceptance cannot change the detached retained answer", async () => {
    const candidates = [inferred("borrow-retention-detached:value", 7)];
    __clearSignaturePlanReuseForTests();
    let originalAnswer: MutableInferenceOutcome;
    const result = await atFinalInferenceYield(() => { originalAnswer.plan.functions[0]!.id = "mutated:other"; }, () => borrowing(candidates,
      async (request) => {
        originalAnswer = inferenceAnswer(request);
        return { status: "Solved", items: [originalAnswer] };
      }));
    expect(result.error).toBeUndefined();
    expect(result.inferenceBorrowed).toBe(1);
    const warm = await borrowing(candidates, async () => ({ status: "Abandon" }));
    expect(warm.error).toBeUndefined();
    expect(warm.requests).toEqual([]);
    expect(warm.value).toEqual(result.value);
  }, 300_000);

  test("L5a-7 the answering side: the same S3a logic, Solved items in row order, Abandon otherwise", async () => {
    const candidates = roster("borrow-seven", 3);
    const rows = await boundaryRows("borrow-seven", 3);
    const before = counters();
    const first = answerBorrowedAuthoredSignaturePlans(structuredClone(rows), PATH, rows.map(keyOf));
    expect(first.status).toBe("Solved");
    expect((first as unknown as { items: Array<{ id: string }> }).items.map((item) => item.id)).toEqual(candidates.map((c) => c.fn.id));
    // The rows were retained by the local fallback above: all hits, no plan.
    expect(delta(before, counters())).toMatchObject({ planned: 0, hits: 3 });
    const fresh = await boundaryRows("borrow-seven-fresh", 2);
    __clearSignaturePlanReuseForTests();
    const planned = counters();
    // Authored rows keep their exact key through a structured clone, so a
    // miss is planned over the copy: equal to the plan of the requester's
    // own objects.
    const freshCopy = structuredClone(fresh);
    expect(freshCopy.map(keyOf)).toEqual(fresh.map(keyOf));
    expect(answerBorrowedAuthoredSignaturePlans(freshCopy, PATH, fresh.map(keyOf)))
      .toEqual({ status: "Solved", items: plannedItems(fresh) });
    expect(delta(planned, counters())).toMatchObject({ planned: 2, hits: 0 });
    expect(answerBorrowedAuthoredSignaturePlans(fresh, PATH, fresh.map(keyOf)).status).toBe("Solved");
    expect(delta(planned, counters())).toMatchObject({ planned: 2, hits: 2 });
    expect(answerBorrowedAuthoredSignaturePlans(rows, 7, rows.map(keyOf))).toEqual({ status: "Abandon" });
    expect(answerBorrowedAuthoredSignaturePlans("rows", PATH, [])).toEqual({ status: "Abandon" });
    expect(answerBorrowedAuthoredSignaturePlans([], PATH, [])).toEqual({ status: "Abandon" });
    expect(answerBorrowedSignatureInference(["not", "five"])).toEqual({ status: "Abandon" });
  }, 300_000);

  // L5a-finish (Decision 3, measured on the seed): a structured clone gives a
  // null-prototype function body an ordinary prototype, and the exact key
  // tells the two apart, so the answering realm cannot key the received copy
  // to its own retained call. The requester sends its own key.
  test("L5a-8 inference: the answering realm finds its retained outcome by the requester's key", async () => {
    const nullBody = (body: object) => Object.assign(Object.create(null) as object, body);
    const base = [...roster("borrow-eight", 2), inferred("borrow-eight:usesFn", nullBody({ call: ["fn001", "x"] }) as never)];
    const reference = full(base);
    // The step's own request: it computes locally (Abandon) and retains the
    // outcome under its key, as the worker's inline build does.
    const local = await borrowing(base, async () => ({ status: "Abandon" }));
    expect(local.error).toBeUndefined();
    expect(local.inferenceCalls).toBe(1);
    expect(local.value).toEqual(reference);
    const request = local.requests.find((entry) => entry.kind === "signatureInference") as
      Extract<SignatureBorrowRequest, { kind: "signatureInference" }>;
    expect(request.key).toBe(__exactTransportKeyForTests(request.arguments)!);
    const received = structuredClone(request.arguments);
    expect(__exactTransportKeyForTests(received)).not.toBe(request.key);
    const before = counters();
    const answer = answerBorrowedSignatureInference(received, request.key);
    expect(answer.status).toBe("Solved");
    expect(delta(before, counters()).inferenceCalls).toBe(0);
    // The borrowed answer, accepted by a fresh page store, equals the full path.
    __clearSignaturePlanReuseForTests();
    const page = await borrowing(base, async (borrowed) => borrowed.kind === "signatureInference"
      ? answer : { status: "Solved", items: plannedItems(borrowed.rows) });
    expect(page.error).toBeUndefined();
    expect(page.inferenceCalls).toBe(0);
    expect(page.inferenceBorrowed).toBe(1);
    expect(page.value).toEqual(reference);
    // fix-engine 2026-10-31: a copy that keys otherwise is never computed.
    // With the requester's key absent from this realm's store (and with no
    // key at all), the answer is Abandon and nothing runs over the copy.
    __clearSignaturePlanReuseForTests();
    const unkeyed = counters();
    expect(answerBorrowedSignatureInference(structuredClone(request.arguments), request.key)).toEqual({ status: "Abandon" });
    expect(answerBorrowedSignatureInference(structuredClone(request.arguments))).toEqual({ status: "Abandon" });
    expect(delta(unkeyed, counters()).inferenceCalls).toBe(0);
    // The page then computes from its own objects: the full path's value.
    const pageLocal = await borrowing(base, async (borrowed) => borrowed.kind === "signatureInference"
      ? answerBorrowedSignatureInference(structuredClone(borrowed.arguments), borrowed.key)
      : { status: "Abandon" });
    expect(pageLocal.error).toBeUndefined();
    expect(pageLocal.inferenceBorrowed).toBe(0);
    expect(pageLocal.inferenceCalls).toBe(1);
    expect(pageLocal.value).toEqual(reference);
    // Even an ordinary-prototype authored body reaches the inference
    // arguments as null-prototype syntax nodes (the registry's conversion),
    // so no such argument list keys equal after a clone: the answering realm
    // answers inference only from the requester's key in practice.
    const plainBase = [...roster("borrow-eight-plain", 2),
      inferred("borrow-eight-plain:usesFn", { call: ["fn001", "x"] })];
    const plainLocal = await borrowing(plainBase, async () => ({ status: "Abandon" }));
    const plainRequest = plainLocal.requests.find((entry) => entry.kind === "signatureInference") as
      Extract<SignatureBorrowRequest, { kind: "signatureInference" }>;
    expect(__exactTransportKeyForTests(structuredClone(plainRequest.arguments))).not.toBe(plainRequest.key);
    // The computation over the copy and over the requester's objects,
    // side by side: equal here, but the answering realm must not rely on it.
    expect(dispatchEngineBody("engine:inferTopLevelSignatures", [...received]))
      .toEqual(dispatchEngineBody("engine:inferTopLevelSignatures", [...request.arguments]));
  }, 300_000);

  // fix-engine 2026-10-31: authored rows are looked up by the requester's
  // keys, and a miss is planned from the received copy only when the copy
  // keys exactly as the requester's row.
  test("L5a-9 authored: a missed row whose received copy keys otherwise abandons; exact-key hits stay", async () => {
    const rows = await boundaryRows("borrow-nine", 3);
    // The requester's row 1 holds a null-prototype node (the row itself);
    // its structured clone is an ordinary object with another exact key.
    const pageRows: unknown[] = [...rows];
    pageRows[1] = Object.assign(Object.create(null) as object, rows[1]);
    const pageKeys = pageRows.map(keyOf);
    const received = structuredClone(pageRows);
    expect(keyOf(received[1])).not.toBe(pageKeys[1]!);
    expect(keyOf(received[0])).toBe(pageKeys[0]!);

    __clearSignaturePlanReuseForTests();
    const before = counters();
    expect(answerBorrowedAuthoredSignaturePlans(received, PATH, pageKeys)).toEqual({ status: "Abandon" });
    // Nothing planned from the copy, nothing retained under the copy's key.
    expect(delta(before, counters())).toMatchObject({ planned: 0, hits: 0 });
    expect(signaturePlanReuseStats().authoredEntries).toBe(0);
    // No keys, too few keys, or a key of another path: Abandon.
    expect(answerBorrowedAuthoredSignaturePlans(structuredClone(rows), PATH)).toEqual({ status: "Abandon" });
    expect(answerBorrowedAuthoredSignaturePlans(structuredClone(rows), PATH, rows.map(keyOf).slice(1)))
      .toEqual({ status: "Abandon" });
    expect(answerBorrowedAuthoredSignaturePlans(structuredClone(rows), PATH,
      rows.map((row) => `other\u0002${__exactTransportKeyForTests(row)!}`))).toEqual({ status: "Abandon" });

    // A plan retained under the copy's own key is not the requester's: it is
    // not answered under the requester's key either.
    expect(answerBorrowedAuthoredSignaturePlans(received, PATH, received.map(keyOf)).status).toBe("Solved");
    const retained = counters();
    expect(answerBorrowedAuthoredSignaturePlans(structuredClone(pageRows), PATH, pageKeys)).toEqual({ status: "Abandon" });
    expect(delta(retained, counters())).toMatchObject({ planned: 0, hits: 0 });

    // Exact-key hits stay: a plan retained under the requester's own key
    // (planned from requester-equal objects, as the answering realm's own
    // build would) answers even though the copy keys otherwise.
    __clearSignaturePlanReuseForTests();
    const own = plannedItems(pageRows);
    expect(answerBorrowedAuthoredSignaturePlans(pageRows, PATH, pageKeys)).toEqual({ status: "Solved", items: own });
    const hitsBefore = counters();
    expect(answerBorrowedAuthoredSignaturePlans(structuredClone(pageRows), PATH, pageKeys)).toEqual({ status: "Solved", items: own });
    expect(delta(hitsBefore, counters())).toMatchObject({ planned: 0, hits: 3 });
  }, 300_000);

  // borrow-deadline (2026-10-31): the async driver's local path keeps an input
  // opportunity inside the decode of retained or borrowed plans, the
  // missing-slot boundary and the reference walk (each was one task over every
  // row: 13 s on a Local seed build in Bun). Counted as the driver's
  // zero-delay timers; the values stay the full path's.
  async function zeroDelayYields<T>(run: () => Promise<T>): Promise<{ yields: number; value: T }> {
    const original = globalThis.setTimeout;
    let yields = 0;
    globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number, ...rest: unknown[]) => {
      if (!delay) yields += 1;
      return original(callback, delay, ...rest);
    }) as typeof setTimeout;
    try { return { value: await run(), yields }; } finally { globalThis.setTimeout = original; }
  }

  test("borrow-deadline decoding 384 retained plans yields after every planner batch", async () => {
    const candidates = roster("deadline-decode", 384);
    const reference = full(candidates);
    expect(owned(candidates).planned).toBe(384);
    const { yields, value: run } = await zeroDelayYields(() => borrowing(candidates, async () => ({ status: "Abandon" })));
    expect(run.error).toBeUndefined();
    expect(run.requests).toEqual([]);
    expect(run.hits).toBe(384);
    expect(run.value).toEqual(reference);
    // 12 authored-boundary yields (one per 32 rows) and 2 inside the decode.
    expect(yields).toBeGreaterThanOrEqual(14);
  }, 300_000);

  test("borrow-deadline accepting 384 borrowed plans yields inside the copy and the decode", async () => {
    const candidates = roster("deadline-accept", 384);
    const reference = full(candidates);
    __clearSignaturePlanReuseForTests();
    const { yields, value: run } = await zeroDelayYields(() => borrowing(candidates, supplier));
    expect(run.error).toBeUndefined();
    expect(run.borrowed).toBe(384);
    expect(run.planned).toBe(0);
    expect(run.value).toEqual(reference);
    // 12 boundary yields, 1 after the borrow, 2 in the copy, 1 before the
    // decode and 2 inside it.
    expect(yields).toBeGreaterThanOrEqual(18);
  }, 300_000);

  test("borrow-deadline the missing-slot boundary and the reference walk yield every 32 rows", async () => {
    const candidates = Array.from({ length: 96 }, (_, n) => inferred(`deadline-missing:value${String(n).padStart(3, "0")}`, n));
    const reference = full(candidates);
    const { yields, value: run } = await zeroDelayYields(() => borrowing(candidates, async () => ({ status: "Abandon" })));
    expect(run.error).toBeUndefined();
    expect(run.requests.map((request) => request.kind)).toEqual(["signatureInference"]);
    expect(run.inferenceCalls).toBe(1);
    expect(run.value).toEqual(reference);
    // 3 boundary yields, 2 in the walk, the yield before the inference, 1
    // after its borrow and the yield after the call.
    expect(yields).toBeGreaterThanOrEqual(8);
  }, 300_000);

  test("L5a-10 the page sends its own per-row keys with the authored rows", async () => {
    const run = await borrowing(roster("borrow-ten", 2), async () => ({ status: "Abandon" }));
    const request = run.requests.find((entry) => entry.kind === "signatureAuthoredPlans") as AuthoredRequest;
    expect(request.keys).toEqual(request.rows.map((row) => `${PATH}\u0002${__exactTransportKeyForTests(row)!}`));
  }, 300_000);
});
