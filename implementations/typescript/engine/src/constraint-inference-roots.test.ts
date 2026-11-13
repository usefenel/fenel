// ---------------------------------------------------------------------------
// Harness slice 1a (2026-11-01) — the transitive `requires` pass walks only the
// roots whose call closure holds a real constraint, and stays byte-identical.
//
// `requires` decides which natives `mediateNativeAct` routes through `perform`
// (cornerstone 4): a divergent array is an unmediated act, not a slowdown. So
// this file keeps the PREVIOUS pass, verbatim, as an equality oracle
// (`previousAttachInferredRequires` below, copied from `constraint-inference.ts`
// at d2cba55a), runs it on shallow copies of the very inputs the new pass gets,
// and compares every function's `requires` by array identity (untouched or
// replaced), length, element order and constraint object identity. It does so
// on hand-built fixtures, on the bootstrap harness, on the repository seed and
// on a Local registry, by wrapping every `attachInferredRequires` call a
// registry build makes. Negative controls show the comparison catches a wrong
// skip and a wrong update order.
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import * as inference from "./constraint-inference";
import {
  attachInferredRequires,
  collectCalledFunctions,
  collectDottedVarRefs,
  constraintKey,
  DYN_CALLEE,
  EFFECT_OPAQUE_SENTINEL,
  type CalleeArity,
  type InferenceLookup,
} from "./constraint-inference";
import type { Constraint, FenelFunction, FenelModule } from "./types";

// ── The previous pass (d2cba55a), verbatim but for the exported name ────────

/** Recognize the effect-opaque sentinel (by its reserved `$dyn` class id). */
function isEffectOpaqueSentinel(c: Constraint): boolean {
  return c.class.entityId === DYN_CALLEE;
}
/** A callee name the lookup cannot resolve is a call the fold cannot see when
 *  it is a BUNDLE PATH: dotted, not a canonical `m:x` id, not a `$` token
 *  (`pings.pinger.go x`, an alias head, a missing member, a class `{method}`).
 *  The inference consumers treat it as effect-opaque (`$dyn`), exactly as an
 *  applied parameter; an unresolved dotless name stays a plain miss. */
function isUnresolvedBundlePathCallee(name: string): boolean {
  return name.includes(".") && !name.includes(":") && !name.startsWith("$");
}

/** TS fix re-review (2026-10-03, astra C2 item 6) — a DOTLESS name spelled in
 *  call position that the lookup cannot resolve is a call the fold cannot see
 *  (a class method the bare-name resolver dispatches, `bareFetch x`; a
 *  late-bound action): effect-opaque, exactly as an unresolved bundle path. */
function isUnresolvedBareCallee(name: string): boolean {
  return name.length > 0 && !name.includes(".") && !name.includes(":") && !name.startsWith("$");
}

/** The callee names of one body for the INFERENCE consumers (`names`), and the
 *  subset spelled in call position (`calls`). */
type InferenceCallees = { readonly names: ReadonlySet<string>; readonly calls: ReadonlySet<string> };

/** Is the unresolved name `name` effect-opaque for the inference consumers? An
 *  unresolved bundle path (only call positions and resolved reads reach
 *  `names` dotted), or an unresolved dotless CALL head; a dotless variable read
 *  that resolves nothing is data. */
function unresolvedCalleeIsOpaque(name: string, callees: InferenceCallees): boolean {
  return isUnresolvedBundlePathCallee(name) || (callees.calls.has(name) && isUnresolvedBareCallee(name));
}

/** The callee names of one body for the INFERENCE consumers (the BFS below and
 *  the Fenel seam `gatherReachable`): call/apply heads, pipe and `|>` stages,
 *  the `$dyn` token and bare-name `{var}` refs (`collectCalledFunctions`, a
 *  `|>` partial judged with the callee arities `lookupFn` gives in the
 *  caller's scope), plus the dotted channel (`collectDottedVarRefs`). A dotted
 *  read or a bare `{method}` member joins only when `lookupFn` resolves it (an
 *  edge; an unresolved read is data, so the bundle-path floor never fires on
 *  `state.next`); an applied `{method}` head always joins, so an unresolved
 *  one meets that floor as a call. `calls` holds the names spelled in call
 *  position (applied `{method}` heads included). */
function inferenceCalleeNames(
  caller: FenelFunction,
  body: unknown,
  lookupFn: InferenceLookup,
): InferenceCallees {
  const called = new Set<string>();
  const calls = new Set<string>();
  const arityOf: CalleeArity = (name) => {
    const params = lookupFn(name, caller)?.params;
    return Array.isArray(params) ? params.length : undefined;
  };
  collectCalledFunctions(body, called, true, { arityOf, calls });
  const reads = new Set<string>();
  const applied = new Set<string>();
  collectDottedVarRefs(body, reads, { read: reads, applied });
  for (const name of reads) if (lookupFn(name, caller) !== undefined) called.add(name);
  for (const name of applied) {
    called.add(name);
    calls.add(name);
  }
  return { names: called, calls };
}
type CalledNamesFor = (fn: FenelFunction) => InferenceCallees;

const NO_CALLEES: InferenceCallees = Object.freeze({ names: new Set<string>(), calls: new Set<string>() });

function inferTransitiveRequiresWithCallCache(
  fn: FenelFunction,
  lookupFn: InferenceLookup,
  calledNamesFor: CalledNamesFor,
): Constraint[] {
  const seenKeys = new Set<string>();
  const out: Constraint[] = [];

  function add(c: Constraint): void {
    const k = constraintKey(c);
    if (seenKeys.has(k)) return;
    seenKeys.add(k);
    out.push(c);
  }

  // Self-declared
  for (const c of fn.requires ?? []) add(c);

  // Transitive — walk body for callees. `includeVarRefs: true` (effect-
  // visibility Phase 1): a fn referenced by BARE NAME (`{var:…}` in argument /
  // let-value position) is a reach edge too — mirrors analyze.fenel § A's
  // `EVar` arm (the source of truth). Unresolvable names (plain data vars,
  // params, locals) fall out at the `lookupFn` miss below — "resolves ⇒ edge".
  if (fn.body !== undefined) {
    let sawDyn = false;
    // TS fix review (2026-10-03) — each name is resolved in the scope of the
    // body that spelled it (`lookupFn(name, caller)`) when it is met, and the
    // walk keys what it has visited by the RESOLVED function: one spelling may
    // name two functions in two callers. The order of first visits, and so of
    // the constraints, is the historical name-ordered BFS's.
    const visited = new Set<string>([fn.id]);
    const queue: FenelFunction[] = [];
    const enqueueCalleesOf = (caller: FenelFunction): void => {
      const callees = calledNamesFor(caller);
      if (callees.names.has(DYN_CALLEE)) sawDyn = true;
      for (const name of callees.names) {
        // `$dyn` is a sentinel token, never a real fn: the arm below handles
        // it. An unresolved bundle-path call or dotless call head is
        // effect-opaque (`unresolvedCalleeIsOpaque`).
        if (name === DYN_CALLEE) continue;
        const callee = lookupFn(name, caller);
        if (!callee) {
          if (unresolvedCalleeIsOpaque(name, callees)) sawDyn = true;
          continue;
        }
        if (visited.has(callee.id)) continue;
        visited.add(callee.id);
        queue.push(callee);
      }
    };
    enqueueCalleesOf(fn);
    let queueIndex = 0;
    while (queueIndex < queue.length) {
      const callee = queue[queueIndex++]!;
      for (const c of callee.requires ?? []) add(c);
      // Recurse into the callee's body too
      if (callee.body !== undefined) enqueueCalleesOf(callee);
    }
    // Phase 4b — the `$dyn` arm (MIRRORS the Fenel `inferRequiresFor` decision,
    // the source of truth): any reached function performs an INDIRECT dispatch ⇒
    // the target carries the effect-opaque sentinel and can't be certified pure.
    if (sawDyn) add(EFFECT_OPAQUE_SENTINEL);
  }

  return out;
}
function previousAttachInferredRequires(
  fns: FenelFunction[],
  lookupFn: InferenceLookup,
): void {
  // Registry construction asks the same reachability question for thousands of
  // roots. Bodies do not change during this pass, so cache only the mechanical
  // body→ordered-call-name scan across roots; the per-root BFS, constraint order,
  // lookup behavior, and mutation result remain byte-identical.
  const callCache = new WeakMap<FenelFunction, InferenceCallees>();
  const calledNamesFor: CalledNamesFor = (candidate) => {
    const cached = callCache.get(candidate);
    if (cached !== undefined) return cached;
    const called = candidate.body === undefined ? NO_CALLEES : inferenceCalleeNames(candidate, candidate.body, lookupFn);
    callCache.set(candidate, called);
    return called;
  };
  for (const fn of fns) {
    // Phase 4b — STRIP the effect-opaque `$dyn` sentinel before writing runtime
    // `fn.requires` (D-4b-3). It is not a declarable / dispatchable constraint —
    // the downstream readers of `fn.requires` (effect dispatch, the self-host
    // classifiers, the partial-evaluator) must see only the function's REAL
    // declarable effects. The sentinel lives in the inference QUERY output (the
    // soundness-complete analysis), not the runtime requires. A combinator whose
    // ONLY inferred constraint is the sentinel therefore keeps `requires` clean
    // (the `length === 0` skip below), preserving its self-host/dispatch path.
    const inferred = inferTransitiveRequiresWithCallCache(fn, lookupFn, calledNamesFor).filter(
      (c) => !isEffectOpaqueSentinel(c),
    );
    if (inferred.length === 0) continue;
    fn.requires = inferred;
  }
}

// ── The differential runner ─────────────────────────────────────────────────

type Attach = (fns: FenelFunction[], lookup: InferenceLookup) => void;

type Outcome = {
  readonly functions: number;
  readonly replaced: number;
  readonly replacedIds: readonly string[];
  readonly mismatches: readonly string[];
};

/** Run `reference` on shallow copies of `fns` (the lookup answers with the
 *  copies, and receives the original callers, so a registry's caller-scoped
 *  lookup reads the scope it always read), then `candidate` on the originals,
 *  both from the same pre-pass state; report every function whose outcome
 *  differs. Functions the lookup reaches outside `fns` are shared: neither
 *  pass writes them. */
function differential(
  fns: FenelFunction[],
  lookup: InferenceLookup,
  candidate: Attach,
  reference: Attach = previousAttachInferredRequires,
): Outcome {
  const before = fns.map((fn) => fn.requires);
  const copyOf = new Map<FenelFunction, FenelFunction>();
  const originalOf = new Map<FenelFunction, FenelFunction>();
  const copies = fns.map((fn) => {
    const known = copyOf.get(fn);
    if (known !== undefined) return known;
    const copy = { ...fn };
    copyOf.set(fn, copy);
    originalOf.set(copy, fn);
    return copy;
  });
  const copiedLookup: InferenceLookup = (name, caller) => {
    const hit = lookup(name, caller === undefined ? undefined : originalOf.get(caller) ?? caller);
    return hit ? copyOf.get(hit) ?? hit : hit;
  };
  reference(copies, copiedLookup);
  candidate(fns, lookup);
  const mismatches: string[] = [];
  const replacedIds: string[] = [];
  for (let i = 0; i < fns.length; i++) {
    const fn = fns[i]!;
    const expected = copies[i]!.requires;
    const actual = fn.requires;
    const where = `#${i} ${fn.id}`;
    if (expected !== before[i]) replacedIds.push(fn.id);
    if (expected === before[i] || actual === before[i]) {
      if (expected !== actual) mismatches.push(`${where}: written by the ${expected === before[i] ? "new" : "previous"} pass only`);
    } else if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) {
      mismatches.push(`${where}: ${keysOf(expected)} expected, ${keysOf(actual)} written`);
    } else {
      for (let k = 0; k < expected.length; k++) {
        if (expected[k] === actual[k]) continue;
        mismatches.push(`${where}[${k}]: ${constraintKey(expected[k]!) === constraintKey(actual[k]!) ? "another object of the same key" : `${keysOf(expected)} expected, ${keysOf(actual)} written`}`);
        break;
      }
    }
    // Nothing but `requires` may move.
    for (const key of new Set([...Object.keys(fn), ...Object.keys(copies[i]!)])) {
      if (key === "requires") continue;
      if ((fn as Record<string, unknown>)[key] !== (copies[i] as Record<string, unknown>)[key]) mismatches.push(`${where}: field ${key} moved`);
    }
  }
  return { functions: fns.length, replaced: replacedIds.length, replacedIds, mismatches };
}

const keysOf = (cs: readonly Constraint[] | undefined): string =>
  cs === undefined ? "undefined" : `[${cs.map(constraintKey).join(", ")}]`;

// ── Wrong passes, for the negative controls ─────────────────────────────────

const isReal = (c: Constraint): boolean => !isEffectOpaqueSentinel(c);

/** A plausible wrong skip: walk a root only when it, or one of its DIRECT
 *  callees, carries a real constraint at its turn. It is right when every
 *  deeper constraint was already copied up by an earlier root's in-place
 *  update, and wrong when the intermediate callee comes later in the roster. */
const oneHopSkip: Attach = (fns, lookup) => {
  const calledNamesFor = calledNamesMemo(lookup);
  for (const fn of fns) {
    const direct = [...calledNamesFor(fn).names].map((name) => lookup(name, fn)).filter((f): f is FenelFunction => f !== undefined);
    if (!(fn.requires ?? []).some(isReal) && !direct.some((f) => (f.requires ?? []).some(isReal))) continue;
    const inferred = inferTransitiveRequiresWithCallCache(fn, lookup, calledNamesFor).filter(isReal);
    if (inferred.length > 0) fn.requires = inferred;
  }
};

/** The right roots, in the wrong order (reverse roster). */
const reverseOrder: Attach = (fns, lookup) => previousAttachInferredRequires([...fns].reverse(), lookup);

/** Every root against the PRE-pass `requires` (no in-place update is seen). */
const snapshotReads: Attach = (fns, lookup) => {
  const calledNamesFor = calledNamesMemo(lookup);
  const results = fns.map((fn) => inferTransitiveRequiresWithCallCache(fn, lookup, calledNamesFor).filter(isReal));
  fns.forEach((fn, i) => { if (results[i]!.length > 0) fn.requires = results[i]; });
};

function calledNamesMemo(lookup: InferenceLookup): CalledNamesFor {
  const cache = new WeakMap<FenelFunction, InferenceCallees>();
  return (candidate) => {
    const cached = cache.get(candidate);
    if (cached !== undefined) return cached;
    const called = candidate.body === undefined ? NO_CALLEES : inferenceCalleeNames(candidate, candidate.body, lookup);
    cache.set(candidate, called);
    return called;
  };
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const req = (entityId: string, ...args: unknown[]): Constraint =>
  ({ class: { $tag: "Id", entityId }, args }) as unknown as Constraint;

const fn = (id: string, body?: unknown, requires?: Constraint[], arity = 0): FenelFunction => ({
  id,
  params: Array.from({ length: arity }, (_, i) => ({ name: `p${i}`, type: { $ref: "Unit" } })) as FenelFunction["params"],
  returns: { $ref: "Unit" },
  ...(body === undefined ? {} : { body: body as FenelFunction["body"] }),
  ...(requires === undefined ? {} : { requires }),
});

const call = (name: string, ...args: unknown[]): unknown => ({ call: [name, ...args] });
const all = (...calls: unknown[]): unknown => ({ and: calls });

/** A fixture world: the roster, and a scope-free lookup by id over the roster
 *  plus `extra` (functions reachable but not in the roster). */
type World = { readonly fns: FenelFunction[]; readonly lookup: InferenceLookup };

function world(roster: FenelFunction[], extra: FenelFunction[] = [], aliases: Record<string, FenelFunction> = {}): World {
  const byName = new Map<string, FenelFunction>();
  for (const f of [...roster, ...extra]) if (!byName.has(f.id)) byName.set(f.id, f);
  for (const [name, f] of Object.entries(aliases)) byName.set(name, f);
  return { fns: roster, lookup: (name) => byName.get(name) };
}

/** Every fixture is built fresh per call: a pass mutates its inputs. */
const fixtures: Record<string, () => World> = {
  // R reaches X's constraint through A, which an EARLIER root updated: the
  // order of R's constraints depends on that update (A's [c1] is read first).
  "in-place update order": () => {
    const c1 = req("HasStateIO", "x");
    const c2 = req("HasHTTP");
    const x = fn("t:x", undefined, [c1]);
    const a = fn("t:a", call("t:x"));
    const b = fn("t:b", undefined, [c2]);
    const r = fn("t:r", all(call("t:a"), call("t:b")));
    return world([a, r, x, b]);
  },
  // R's only path to a constraint runs through C, which comes LATER.
  "deep closure, intermediate later in the roster": () => {
    const e = fn("t:e", undefined, [req("HasRandom")]);
    const c = fn("t:c", call("t:e"));
    const r = fn("t:r", call("t:c"));
    return world([r, c, e]);
  },
  // R's only path to a constraint is C, which an EARLIER root updated in
  // place: R must still be walked (and copies C's updated `requires`).
  "reaches a constraint only through a callee updated earlier": () => {
    const e = fn("t:e", undefined, [req("HasStateIO", "only")]);
    const c = fn("t:c", call("t:e"));
    const r = fn("t:r", call("t:c"));
    return world([c, r, e]);
  },
  // Two objects with the same key: the first one met wins, so the walk order
  // decides which object a root holds.
  "same key, two objects": () => {
    const p = fn("t:p", undefined, [req("HasTime")]);
    const q = fn("t:q", undefined, [req("HasTime")]);
    const mid = fn("t:mid", call("t:q"));
    const r = fn("t:r", all(call("t:mid"), call("t:p")));
    return world([mid, r, p, q]);
  },
  "mutual recursion": () => {
    const e = fn("t:e", undefined, [req("HasEmail")]);
    const m1 = fn("t:m1", all(call("t:m2"), call("t:m1")));
    const m2 = fn("t:m2", all(call("t:m1"), call("t:e")));
    const p1 = fn("t:p1", call("t:p2"));
    const p2 = fn("t:p2", call("t:p1"));
    return world([m1, p1, m2, p2, e]);
  },
  "effect-opaque calls": () => {
    const e = fn("t:e", undefined, [req("HasIO")]);
    const applyF = fn("t:applyF", { call: [{ var: "f" }, 1] }, undefined, 1);
    const opaqueAndReal = fn("t:mixed", all({ call: [{ var: "f" }] }, call("t:e")), undefined, 1);
    const unresolvedPath = fn("t:path", call("pings.pinger.go", { var: "x" }));
    const unresolvedHead = fn("t:head", call("bareFetch", 1));
    const viaOpaque = fn("t:viaOpaque", call("t:applyF", { fn: [[], 1] }));
    // A sentinel-only declaration (never authorable, but a re-run could meet
    // one): neither pass touches it.
    const sentinelOnly = fn("t:sentinelOnly", undefined, [EFFECT_OPAQUE_SENTINEL]);
    const viaSentinel = fn("t:viaSentinel", call("t:sentinelOnly"));
    return world([applyF, opaqueAndReal, unresolvedPath, unresolvedHead, viaOpaque, sentinelOnly, viaSentinel, e]);
  },
  // Bare-name reads, a pipe partial and a `|>` partial are edges too.
  "every edge kind": () => {
    const io = fn("t:io", undefined, [req("HasStateIO", "s")], 2);
    const viaVar = fn("viaVar", { map: [{ var: "xs" }, { var: "t:io" }] });
    const viaPipe = fn("viaPipe", { pipe: [5, ["t:io", 1]] });
    const viaBar = fn("viaBar", { "|>": [5, { call: ["t:io", 1] }] });
    const viaDotted = fn("viaDotted", { var: "mod.io" });
    return world([viaVar, viaPipe, viaBar, viaDotted, io], [], { "mod.io": io });
  },
  // A roster object and an outside object share an id; the walk's id-keyed
  // `visited` prunes the second one it meets.
  "duplicate ids": () => {
    const pure = fn("t:dup", undefined);
    const effectful = fn("t:dup", undefined, [req("HasTelegramBot")]);
    const r = fn("t:r", all(call("a"), call("b")));
    const s = fn("t:s", call("b"));
    return world([r, s, pure], [], { a: pure, b: effectful });
  },
  // Reachable only through the lookup (not in the roster), no body, declared.
  "outside callee, bodiless roots": () => {
    const outside = fn("t:outside", undefined, [req("HasRegistry")]);
    const r = fn("t:r", call("t:outside"));
    const declared = fn("t:declared", undefined, [req("HasStateIO"), req("HasStateIO")]);
    const bare = fn("t:bare");
    return world([r, declared, bare], [outside]);
  },
  // The same object twice in the roster: its second turn reads its own
  // updated `requires`.
  "repeated roster entry": () => {
    const e = fn("t:e", undefined, [req("HasHTTP")]);
    const a = fn("t:a", call("t:e"));
    const r = fn("t:r", all(call("t:a"), call("t:e")));
    return world([r, a, r, e]);
  },
};

describe("the new pass equals the previous pass on fixtures", () => {
  for (const [name, build] of Object.entries(fixtures)) {
    it(name, () => {
      const { fns, lookup } = build();
      const outcome = differential(fns, lookup, attachInferredRequires);
      expect(outcome.mismatches).toEqual([]);
    });
  }

  it("is idempotent like the previous pass (a second run over its own output)", () => {
    for (const build of Object.values(fixtures)) {
      const { fns, lookup } = build();
      previousAttachInferredRequires(fns, lookup);
      expect(differential(fns, lookup, attachInferredRequires).mismatches).toEqual([]);
    }
  });
});

describe("negative controls: the comparison catches a wrong pass", () => {
  const diverges = (wrong: Attach, fixture: string): readonly string[] => {
    const { fns, lookup } = fixtures[fixture]!();
    return differential(fns, lookup, wrong).mismatches;
  };

  it("a one-hop skip misses a root whose closure reaches a constraint through a later callee", () => {
    expect(diverges(oneHopSkip, "deep closure, intermediate later in the roster")).toEqual(["#0 t:r: written by the previous pass only"]);
  });

  it("the right roots in the wrong order change the order of a root's constraints", () => {
    expect(diverges(reverseOrder, "in-place update order")).toEqual(["#1 t:r[0]: [HasStateIO::[\"x\"], HasHTTP::[]] expected, [HasHTTP::[], HasStateIO::[\"x\"]] written"]);
  });

  it("reading the pre-pass requires changes which object of a key a root holds", () => {
    expect(diverges(snapshotReads, "same key, two objects")).toEqual(["#1 t:r[0]: another object of the same key"]);
  });
});

// ── Counters: the skipped roots do no walk; a shared callee resolves once ───

describe("work counters", () => {
  /** `f.requires` behind a read counter. */
  const countRequiresReads = (f: FenelFunction): { reads: number } => {
    const counter = { reads: 0 };
    const value = f.requires;
    Object.defineProperty(f, "requires", {
      configurable: true,
      enumerable: true,
      get: () => { counter.reads += 1; return value; },
      set: () => { throw new Error("a pure helper's requires was written"); },
    });
    return counter;
  };

  it("a root whose closure carries no real constraint is not walked", () => {
    const helper = fn("t:helper", undefined);
    const counter = countRequiresReads(helper);
    const roots = Array.from({ length: 5 }, (_, i) => fn(`t:pure${i}`, call("t:helper")));
    const { fns, lookup } = world([...roots, helper]);
    attachInferredRequires(fns, lookup);
    // Once, to learn that it carries nothing; the previous pass read it on
    // every root's walk (6 times).
    expect(counter.reads).toBe(1);
    for (const root of roots) expect(root.requires).toBeUndefined();
  });

  it("a callee shared by k walked roots resolves its names once", () => {
    const e = fn("t:e", undefined, [req("HasStateIO")]);
    const shared = fn("t:shared", call("t:e"));
    const roots = Array.from({ length: 5 }, (_, i) => fn(`t:root${i}`, call("t:shared")));
    const base = world([...roots, shared, e]);
    let sharedLookups = 0;
    const lookup: InferenceLookup = (name, caller) => {
      if (caller === shared) sharedLookups += 1;
      return base.lookup(name, caller);
    };
    // The previous pass resolved it once per root that walked through it,
    // plus its own turn (6 times).
    attachInferredRequires(base.fns, lookup);
    expect(sharedLookups).toBe(1);
    for (const root of roots) expect(root.requires).toEqual([e.requires![0]!]);
  });
});

// A Local user module over the seed's IO leaves (`io.random_hex` declares HasRandom,
// `time.now` HasTime). Local parameters are positional (`_n`).
const USRQ_LINES = [
  "module usrq where",
  "-- reaches the leaf only through `relay`, which comes later",
  "early : String -> String",
  "early _0 = relay _0",
  "relay : String -> String",
  "relay _0 = io.random_hex 4",
  "-- mutual recursion with an effect on one side",
  "ping : Number -> String",
  "ping _0 = if _0 == 0 then io.random_hex 2 else pong (_0 - 1)",
  "pong : Number -> String",
  "pong _0 = ping _0",
  "-- effect-opaque: applies a parameter",
  "applyTo : (Number -> String) -> Number -> String",
  "applyTo _0 _1 = _0 _1",
  "both : Number -> String",
  "both _0 = applyTo pong _0",
  "-- a nullary leaf read by a dotted name",
  "stamp : Number -> Timestamp",
  "stamp _0 = time.now",
  "-- two classes, met in an order that depends on earlier updates",
  "stampThenRelay : Number -> List Timestamp",
  "stampThenRelay _0 = [stamp _0, stamp (length (relay \"x\"))]",
  "-- pure",
  "same : Number -> Number",
  "same _0 = _0",
  "-- calls into the seed",
  "seedCall : List Number -> Number",
  "seedCall _0 = length _0",
];

// ── The registries: every pass a registry build makes, against the oracle ──

describe("the new pass equals the previous pass on real registries", () => {
  const real = { ...inference };
  const outcomes: Outcome[] = [];
  beforeAll(() => {
    mock.module("./constraint-inference", () => ({
      ...real,
      attachInferredRequires: (fns: FenelFunction[], lookup: InferenceLookup): void => {
        outcomes.push(differential(fns, lookup, real.attachInferredRequires));
      },
    }));
  });
  afterAll(() => {
    mock.module("./constraint-inference", () => real);
  });

  const LONG = 600_000;
  const take = (): Outcome[] => outcomes.splice(0, outcomes.length);
  const expectEqual = (taken: Outcome[], minFunctions: number): void => {
    expect(taken.length).toBeGreaterThan(0);
    expect(Math.max(...taken.map((o) => o.functions))).toBeGreaterThanOrEqual(minFunctions);
    for (const o of taken) expect(o.mismatches).toEqual([]);
    // The pass did write: equality is not vacuous.
    expect(taken.reduce((n, o) => n + o.replaced, 0)).toBeGreaterThan(0);
  };

  it("the bootstrap harness", async () => {
    const { __getHarnessForTests } = await import("./engine-bodies-dispatch");
    __getHarnessForTests();
    expectEqual(take(), 7000);
  }, LONG);

  it("the repository seed", async () => {
    const { getSystemRegistry } = await import("./system-registry");
    getSystemRegistry();
    expectEqual(take(), 1000);
  }, LONG);

  it("a Local registry with user functions over leaves that declare requires", async () => {
    const { SYSTEM_REGISTRY_MODULES } = await import("./system-registry-modules");
    const { createLocalRegistry } = await import("./repository-registry");
    const { loadFenelModule } = await import("./fenel-module");
    const loaded = loadFenelModule(USRQ_LINES.join("\n"), "usrq");
    const usr = {
      ...loaded,
      functions: (loaded.functions ?? []).map((f) => ({
        ...f,
        params: f.params.map((param, index) => ({ ...param, key: { $tag: "PositionalField", index } as const })),
      })),
    };
    createLocalRegistry(SYSTEM_REGISTRY_MODULES, [usr]);
    const taken = take();
    expectEqual(taken, 1000);
    // The fixture's own effectful functions were among the inputs and were
    // written (by both passes); the pure and sentinel-only ones were not.
    const written = new Set(taken.flatMap((o) => o.replacedIds));
    for (const name of ["early", "relay", "ping", "pong", "both", "stamp", "stampThenRelay"]) expect(written.has(`usrq:${name}`)).toBe(true);
    for (const name of ["applyTo", "same", "seedCall"]) expect(written.has(`usrq:${name}`)).toBe(false);
  }, LONG);
});

// ── Randomized differential over generated graphs ───────────────────────────

/** A deterministic PRNG (mulberry32), so a failing seed reproduces. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One generated world: a roster (permuted, with repeats), functions outside
 *  it that the lookup still returns, cycles, two objects per constraint key,
 *  sentinel-only and mixed declarations, duplicate ids, `$dyn` calls,
 *  unresolved bundle paths and call heads, every edge kind, and a name whose
 *  meaning depends on the calling function. */
function randomWorld(seed: number): World {
  const rand = prng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const pool: Constraint[] = [];
  for (const cls of ["HasStateIO", "HasHTTP", "HasTime", "HasRandom"]) {
    for (const arg of ["a", "b"]) pool.push(req(cls, arg), req(cls, arg));
  }
  const declare = (): Constraint[] | undefined => {
    const r = rand();
    if (r < 0.06) return [EFFECT_OPAQUE_SENTINEL];
    if (r < 0.1) return [EFFECT_OPAQUE_SENTINEL, pick(pool)];
    if (r < 0.28) return Array.from({ length: 1 + Math.floor(rand() * 3) }, () => pick(pool));
    if (r < 0.31) return [];
    return undefined;
  };
  const inside = 1 + Math.floor(rand() * 18);
  const outside = Math.floor(rand() * 5);
  const ids = [...Array.from({ length: inside }, (_, i) => `g:${i}`), ...Array.from({ length: outside }, (_, i) => `o:${i}`)];
  const names = [...ids, ...ids.map((_, i) => `alias${i}`), "scoped"];
  const edge = (): unknown => {
    const r = rand();
    if (r < 0.45) return call(pick(names), 1);
    if (r < 0.55) return { var: pick(names) };
    if (r < 0.62) return { pipe: [1, pick(names)] };
    if (r < 0.67) return { pipe: [1, [pick(names), 2]] };
    if (r < 0.72) return { "|>": [1, { call: [pick(names), 1] }] };
    if (r < 0.78) return { call: [{ var: "f" }, 1] };
    if (r < 0.83) return call("pkg.mod.go", 1);
    if (r < 0.87) return call("missingHead", 1);
    if (r < 0.9) return { var: "plainData" };
    return { fn: [["x"], call(pick(names), { var: "x" })] };
  };
  const all: FenelFunction[] = ids.map((id, i) => {
    // Some ids repeat: a later function takes an earlier one's id.
    const own = i > 0 && rand() < 0.06 ? ids[Math.floor(rand() * i)]! : id;
    const bodied = rand() < 0.85;
    const body = bodied ? { and: Array.from({ length: Math.floor(rand() * 4) }, edge) } : undefined;
    return fn(own, body, declare(), Math.floor(rand() * 3));
  });
  const roster = all.slice(0, inside);
  // Permute, then repeat a few entries.
  for (let i = roster.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [roster[i], roster[j]] = [roster[j]!, roster[i]!];
  }
  const repeats = Math.floor(rand() * 3);
  for (let i = 0; i < repeats; i++) roster.splice(Math.floor(rand() * roster.length), 0, pick(roster));
  const byName = new Map<string, FenelFunction>();
  all.forEach((f, i) => {
    if (!byName.has(ids[i]!)) byName.set(ids[i]!, f);
    byName.set(`alias${i}`, f);
  });
  // `scoped` names a function that depends on the caller (a module scope).
  const lookup: InferenceLookup = (name, caller) => {
    if (name === "scoped") return caller === undefined ? undefined : all[(caller.id.length + (caller.body === undefined ? 0 : 1)) % all.length];
    return byName.get(name);
  };
  return { fns: roster, lookup };
}

const RANDOM_SEEDS = 600;

/** The pruning idea with two knobs, rebuilt here over the previous pass's own
 *  walk, for the negative controls: `rosterOnly` marks only roster functions
 *  as carriers (a callee outside the roster never counts), `directCallers`
 *  marks only the carriers and their direct callers. */
function prunedPass(knobs: { readonly rosterOnly?: boolean; readonly directCallers?: boolean }): Attach {
  return (fns, lookup) => {
    const calledNamesFor = calledNamesMemo(lookup);
    const roster = new Set(fns);
    const callersOf = new Map<FenelFunction, FenelFunction[]>();
    const seen = new Set<FenelFunction>();
    const carriers: FenelFunction[] = [];
    const stack = [...fns];
    for (const f of fns) seen.add(f);
    while (stack.length > 0) {
      const node = stack.pop()!;
      if ((node.requires ?? []).some(isReal) && (!knobs.rosterOnly || roster.has(node))) carriers.push(node);
      for (const name of calledNamesFor(node).names) {
        const callee = name === DYN_CALLEE ? undefined : lookup(name, node);
        if (!callee) continue;
        const callers = callersOf.get(callee) ?? [];
        callers.push(node);
        callersOf.set(callee, callers);
        if (!seen.has(callee)) { seen.add(callee); stack.push(callee); }
      }
    }
    const reaching = new Set(carriers);
    const work = [...carriers];
    while (work.length > 0) {
      const node = work.pop()!;
      for (const caller of callersOf.get(node) ?? []) {
        if (reaching.has(caller)) continue;
        reaching.add(caller);
        if (!knobs.directCallers) work.push(caller);
      }
    }
    for (const f of fns) {
      if (!reaching.has(f)) continue;
      const inferred = inferTransitiveRequiresWithCallCache(f, lookup, calledNamesFor).filter(isReal);
      if (inferred.length > 0) f.requires = inferred;
    }
  };
}

describe("randomized differential over generated graphs", () => {
  const divergingSeeds = (candidate: Attach): number[] => {
    const out: number[] = [];
    for (let seed = 1; seed <= RANDOM_SEEDS; seed++) {
      const { fns, lookup } = randomWorld(seed);
      if (differential(fns, lookup, candidate).mismatches.length > 0) out.push(seed);
    }
    return out;
  };

  it(`the new pass equals the previous pass on ${RANDOM_SEEDS} generated graphs`, () => {
    let written = 0;
    for (let seed = 1; seed <= RANDOM_SEEDS; seed++) {
      const { fns, lookup } = randomWorld(seed);
      const outcome = differential(fns, lookup, attachInferredRequires);
      expect({ seed, mismatches: outcome.mismatches }).toEqual({ seed, mismatches: [] });
      written += outcome.replaced;
    }
    // The corpus is not vacuous: the passes write, and skip, a lot.
    expect(written).toBeGreaterThan(RANDOM_SEEDS);
  });

  it("the rebuilt pruning with both knobs off also equals it (the controls below differ by their knob only)", () => {
    expect(divergingSeeds(prunedPass({}))).toEqual([]);
  });

  it("negative control: marking only roster functions diverges", () => {
    expect(divergingSeeds(prunedPass({ rosterOnly: true })).length).toBeGreaterThan(0);
  });

  it("negative control: marking only direct callers diverges", () => {
    expect(divergingSeeds(prunedPass({ directCallers: true })).length).toBeGreaterThan(0);
  });
});

// ── Both ways: each registry kind built with the previous pass and with the new
// one, in separate builds of the same process, rows compared by digest ──────

/** One row per function, as the pass left it: id, parameters, body and
 *  `requires`, where each constraint is named by the place it was first
 *  declared before the pass (roster index and position), so the digest
 *  encodes sharing: two builds agree only if every written array holds the
 *  same declarations, in the same order, chosen from the same declarer. An
 *  untouched `requires` is encoded as such. */
function rowDigests(fns: readonly FenelFunction[], before: readonly (Constraint[] | undefined)[]): string[] {
  const origin = new Map<Constraint, string>();
  before.forEach((requires, i) => (requires ?? []).forEach((c, k) => { if (!origin.has(c)) origin.set(c, `${i}#${k}`); }));
  const json = (v: unknown): string => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? `${x}n` : x)) ?? "undefined";
  return fns.map((f, i) => {
    const requires = f.requires === before[i]
      ? "untouched"
      : `[${(f.requires ?? []).map((c) => origin.get(c) ?? `fresh:${json(c)}`).join(",")}]`;
    return `${f.id}|${Bun.hash(json(f.params))}|${Bun.hash(json(f.body))}|${requires}`;
  });
}

describe("both ways: registry builds with the previous and the new pass", () => {
  const real = { ...inference };
  let mode: "previous" | "new" | null = null;
  const builds: string[][][] = [];
  beforeAll(() => {
    mock.module("./constraint-inference", () => ({
      ...real,
      attachInferredRequires: (fns: FenelFunction[], lookup: InferenceLookup): void => {
        if (mode === null) return real.attachInferredRequires(fns, lookup);
        const before = fns.map((f) => f.requires);
        (mode === "previous" ? previousAttachInferredRequires : real.attachInferredRequires)(fns, lookup);
        builds[builds.length - 1]!.push(rowDigests(fns, before));
      },
    }));
  });
  afterAll(() => {
    mock.module("./constraint-inference", () => real);
  });

  const LONG = 600_000;
  /** Warm the realm (harness, catalogue) with the real pass, then build the
   *  registry once each way and compare every pass's row digests. */
  const bothWays = async (build: () => unknown, minRows: number): Promise<string> => {
    const { __getHarnessForTests } = await import("./engine-bodies-dispatch");
    __getHarnessForTests();
    const runs: string[][][] = [];
    const failures: string[] = [];
    for (const way of ["previous", "new"] as const) {
      mode = way;
      builds.push([]);
      try {
        build();
        failures.push("built");
      } catch (error) {
        failures.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
      } finally {
        mode = null;
      }
      runs.push(builds.pop()!);
    }
    // A build that fails, fails the same way both ways.
    expect(failures[1]).toBe(failures[0]!);
    const [previous, current] = runs as [string[][], string[][]];
    if (failures[0] !== "built") {
      expect(current).toEqual(previous);
      return failures[0]!;
    }
    expect(previous.length).toBeGreaterThan(0);
    expect(current.length).toBe(previous.length);
    expect(Math.max(...previous.map((rows) => rows.length))).toBeGreaterThanOrEqual(minRows);
    let written = 0;
    previous.forEach((rows, call) => {
      const other = current[call]!;
      expect(other.length).toBe(rows.length);
      const differing = rows.flatMap((row, i) => (row === other[i] ? [] : [`${row}  ≠  ${other[i]}`]));
      expect(differing.slice(0, 20)).toEqual([]);
      written += rows.filter((row) => !row.endsWith("|untouched")).length;
    });
    expect(written).toBeGreaterThan(0);
    return "built";
  };

  /** User modules for the Local and account builds, over the `usrq` module
   *  above. `ordinary`: an alias import and a hiding import of `usrq`.
   *  `system`: an alias and a hiding import of `system`, with bodies spelling
   *  `system.List.Cons`; building either module's name frame adds `system` to
   *  the registry's module names in the middle of the pass, so a lookup of a
   *  `system.T.C` name answers differently before and after it.
   *  `system-unspelled`: the same imports, with no such spelling in the user
   *  bodies (the repository's own bodies still spell them). */
  const userModules = async (kind: "ordinary" | "system" | "system-unspelled"): Promise<FenelModule[]> => {
    const { loadFenelModule } = await import("./fenel-module");
    const positional = (m: FenelModule): FenelModule => ({
      ...m,
      functions: (m.functions ?? []).map((f) => ({
        ...f,
        params: f.params.map((param, index) => ({ ...param, key: { $tag: "PositionalField", index } as const })),
      })),
    });
    const load = (lines: string[], name: string): FenelModule => positional(loadFenelModule(lines.join("\n"), name));
    const usrq = load(USRQ_LINES, "usrq");
    if (kind === "ordinary") {
      return [
        usrq,
        { ...load(["module usrali where", "viaAlias : String -> String", "viaAlias _0 = U.relay _0",
          "pureAlias : Number -> Number", "pureAlias _0 = U.same _0"], "usrali"), imports: [{ module: "usrq", as: "U" }] },
        { ...load(["module usrhid where", "viaOpen : String -> String", "viaOpen _0 = early _0",
          "pureOpen : Number -> Number", "pureOpen _0 = seedCall [_0]"], "usrhid"), imports: [{ module: "usrq", hiding: ["same"] }] },
      ];
    }
    const spelled = kind === "system";
    return [
      usrq,
      { ...load(["module usrsys where",
        ...(spelled ? ["consed : Number -> List Number", "consed _0 = system.List.Cons _0 system.List.Nil"] : []),
        "relayed : String -> String", "relayed _0 = usrq.relay _0"], "usrsys"), imports: [{ module: "system", as: "Sys" }] },
      { ...load(["module usrhide where",
        spelled ? "listed : Number -> List Number" : "listed : Number -> String",
        spelled ? "listed _0 = system.List.Cons (length (usrq.early \"h\")) system.List.Nil" : "listed _0 = usrq.early \"h\""], "usrhide"),
        imports: [{ module: "system", hiding: ["Expr"] }] },
    ];
  };

  it("the bootstrap harness", async () => {
    const { harnessCertificateInput } = await import("./engine-bodies-dispatch");
    const { createEngineBootstrapRegistry } = await import("./registry");
    const { repositoryIdentityLock } = await import("./repository-identity-manifest");
    const modules = harnessCertificateInput().definitions as FenelModule[];
    expect(await bothWays(() => createEngineBootstrapRegistry(modules, { functionIdentityLock: repositoryIdentityLock() }), 7000)).toBe("built");
  }, LONG);

  it("the system registry", async () => {
    const { SYSTEM_REGISTRY_MODULES } = await import("./system-registry-modules");
    const { createRepositoryRegistry } = await import("./repository-registry");
    const { dispatchRegistry } = await import("./system-entities");
    expect(await bothWays(() => createRepositoryRegistry(SYSTEM_REGISTRY_MODULES, { dispatchRegistry }), 1000)).toBe("built");
  }, LONG);

  it("the seed registry", async () => {
    const { modulesFor } = await import("./module-manifest");
    const { createRepositoryRegistry } = await import("./repository-registry");
    expect(await bothWays(() => createRepositoryRegistry(modulesFor("seed")), 1000)).toBe("built");
  }, LONG);

  it("a Local registry with user modules (alias and hiding imports)", async () => {
    const { SYSTEM_REGISTRY_MODULES } = await import("./system-registry-modules");
    const { createLocalRegistry } = await import("./repository-registry");
    const users = await userModules("ordinary");
    expect(await bothWays(() => createLocalRegistry(SYSTEM_REGISTRY_MODULES, users), 1000)).toBe("built");
  }, LONG);

  // With a user module importing `system` under an alias or with `hiding`,
  // the registry build used to fail inside the pass (the first `system.T.C`
  // lookup after the frame build read the constructor catalogue before its
  // declaration). Fixed 2026-11-01 (registry-system-import-alias.test.ts):
  // both passes build and agree.
  for (const kind of ["system", "system-unspelled"] as const) {
    it(`a Local registry with user modules importing system (${kind})`, async () => {
      const { SYSTEM_REGISTRY_MODULES } = await import("./system-registry-modules");
      const { createLocalRegistry } = await import("./repository-registry");
      const users = await userModules(kind);
      expect(await bothWays(() => createLocalRegistry(SYSTEM_REGISTRY_MODULES, users), 1000)).toBe("built");
    }, LONG);
  }

  it("an account registry over the execute modules with user modules", async () => {
    const { modulesFor } = await import("./module-manifest");
    const { createAccountRegistry } = await import("./repository-registry");
    const { dispatchRegistry } = await import("./system-entities");
    const users = await userModules("ordinary");
    expect(await bothWays(() => createAccountRegistry(modulesFor("execute"), users, { dispatchRegistry }), 1000)).toBe("built");
  }, LONG);
});
