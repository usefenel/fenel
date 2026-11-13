// ---------------------------------------------------------------------------
// A closure's captured import frames are CALLER DATA.
//
// A closure is a value (`{__fenelFn, params, body, closure, lexicalImports}`),
// so whoever hands one to the evaluator also chose its `lexicalImports` array —
// including an own `every`, a lying iterator, an accessor element, a hole, or
// an element that is not an import frame. `json-logic.ts` used to pass that
// array straight to `lexicalEvaluateContext`, whose equality fast paths called
// the array's own `every` and whose rebuild SPREAD it. `closureLexicalImports`
// now copies it BY INDEX (own data descriptors only) into a fresh private array
// before anything compares it, and refuses — with a `TypeError`, through the
// door the caller entered by — anything that is not a dense list of import
// frames. It never reads a malformed list as "no imports", which would resolve
// the body's names in the CALLER's scope instead.
//
// The FRAMES are caller data too. `canonicalImportFrame` hands the context a
// frozen snapshot of what it validated (or the frame itself when that is
// already frozen), so the resolvers never read the caller's frame object.
//
// Every case below that is marked "was" failed against the evaluator before the
// copy (or, for a frame, the snapshot) existed; the value it produced then is
// recorded beside it.
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";
import {
  beginWhereProofFrame,
  endWhereProofFrame,
  evaluate,
  withImports,
  type EvaluateContext,
  type ImportFrame,
} from "./json-logic";
import { contains } from "./set-algebra";
import { loadFenelModule } from "./fenel-module";
import { createRegistry } from "./registry";
import type { AuthorityRef } from "./authority";
import type { FenelFunction, SetExpr } from "./types";

const frame = (helper: string): ImportFrame =>
  Object.freeze({ names: Object.freeze({ helper }), aliases: Object.freeze({}) });

/** The closure's own frame, and the caller's. */
const A = frame("helperA");
const B = frame("helperB");

const natives = {
  helperA: () => "from A",
  helperB: () => "from B",
};

/** A closure VALUE with a caller-chosen import list; its body calls `helper`. */
const closureWith = (lexicalImports: unknown): Record<string, unknown> => ({
  __fenelFn: true,
  params: [],
  body: { call: ["helper"] },
  closure: {},
  lexicalImports,
});

const callCb = (cb: unknown, ctx: EvaluateContext): unknown =>
  evaluate({ call: [{ var: "cb" }] }, { cb }, ctx);

/** A copy of `elements` whose element `index` is an accessor running `get`. */
const withAccessor = (
  elements: unknown[],
  index: number,
  get: () => unknown,
): unknown[] => {
  const a = [...elements];
  Object.defineProperty(a, String(index), { get, enumerable: true, configurable: true });
  return a;
};

const NOTHING = { $tag: "Nothing" } as const;
const JUST = (b: boolean) => ({ $tag: "Just", _0: b }) as const;

/** The where-proof door exactly as `whereMember` runs it: a proof frame around
 * the evaluation; a throw, or a frame tripped by a converted failure, is
 * `Nothing`; a host Boolean is `Just`. Used where the case needs a caller
 * import stack, which the real door's decider context does not carry. */
const prove = (pred: unknown, ctx: EvaluateContext): unknown => {
  const proof = beginWhereProofFrame();
  let result: unknown;
  try {
    result = evaluate(pred, {}, ctx);
  } catch {
    return NOTHING;
  } finally {
    endWhereProofFrame(proof);
  }
  if (proof.tripped) return NOTHING;
  return typeof result === "boolean" ? JUST(result) : NOTHING;
};

describe("an honest closure", () => {
  test("resolves through its own frames, whatever the caller's are", () => {
    expect(callCb(closureWith([A]), { natives })).toBe("from A");
    expect(callCb(closureWith([A]), { natives, _importStack: [B] })).toBe("from A");
    expect(callCb(closureWith([B, A]), { natives, _importStack: [B] })).toBe("from A");
  });

  const bare = { __fenelFn: true, params: [], body: { call: ["helper"] }, closure: {} };

  test("with no own lexical imports, resolves in the caller's scope, as before", () => {
    expect(callCb(bare, { natives, _importStack: [B] })).toBe("from B");
    expect(callCb(closureWith(undefined), { natives, _importStack: [B] })).toBe("from B");
  });

  test("an INHERITED slot is not the closure's own data (was: honoured, `from A`)", () => {
    // The file's own-data reading, which the durable twin's gate shares: the
    // slot is absent, not read. It grants nothing — a closure could omit it.
    const inherited = Object.assign(Object.create({ lexicalImports: [A] }) as object, bare);
    expect(callCb(inherited, { natives, _importStack: [B] })).toBe("from B");
  });
});

describe("a lying list cannot choose which frames the body resolves in", () => {
  test("an own `every` that answers true (was: `from B`, the caller's frame)", () => {
    const lying = [A];
    Object.defineProperty(lying, "every", { value: () => true });
    expect(callCb(closureWith(lying), { natives, _importStack: [B] })).toBe("from A");
  });

  test("an own iterator that yields other frames (was: `from B`)", () => {
    const spoofed = [A];
    Object.defineProperty(spoofed, Symbol.iterator, {
      value: function* () { yield B; },
    });
    expect(callCb(closureWith(spoofed), { natives })).toBe("from A");
  });

  test("a Proxy whose `get` answers other than its descriptors (was: `from B`)", () => {
    const twoFaced = new Proxy([A], {
      get: (target, key, receiver) => (key === "0" ? B : Reflect.get(target, key, receiver)),
    });
    // Under the caller's frame the fast path's `every` ran the trap; without
    // one the rebuild's spread did. The descriptor is what the copy reads.
    expect(callCb(closureWith(twoFaced), { natives, _importStack: [B] })).toBe("from A");
    expect(callCb(closureWith(twoFaced), { natives })).toBe("from A");
  });
});

describe("a frame resolves as it was validated", () => {
  // Validation reads a frame through its DESCRIPTORS; the resolvers read
  // `frame.names` / `frame.aliases` with ordinary property reads, later. They
  // used to read the caller's own frame object, so the two could disagree.

  /** A frame whose descriptors show `shown` in `slot` while `get` answers `served`. */
  const twoFacedFrame = (slot: "names" | "aliases", shown: Record<string, string>, served: Record<string, string>) =>
    new Proxy({ names: {}, aliases: {}, [slot]: shown }, {
      get: (target, key, receiver) => (key === slot ? served : Reflect.get(target, key, receiver)),
    });

  test("a Proxy frame whose `get` answers other `names` (was: `from B`)", () => {
    const redirect = twoFacedFrame("names", { helper: "helperA" }, { helper: "helperB" });
    expect(callCb(closureWith([redirect]), { natives })).toBe("from A");
    expect(callCb(closureWith([redirect]), { natives, _importStack: [B] })).toBe("from A");
    // Even when called in the very frame it captured, the body must read the
    // descriptor-validated snapshot rather than the Proxy's ordinary `get`.
    expect(callCb(closureWith([redirect]), { natives, _importStack: [redirect] })).toBe("from A");
  });

  test("a Proxy frame whose `get` answers other `aliases` (was: `ModB:helper`, and `from B`)", () => {
    const member = (id: string): FenelFunction => ({ id, params: [], returns: { $ref: "Value" } });
    const ctx: EvaluateContext = {
      natives: { "ModA:helper": () => "from A", "ModB:helper": () => "from B" },
      _moduleNames: new Set(["ModA", "ModB"]),
      getFunction: (id) => (id === "ModA:helper" || id === "ModB:helper" ? member(id) : undefined),
    };
    const redirect = twoFacedFrame("aliases", { M: "ModA" }, { M: "ModB" });
    const closureOver = (body: unknown) => ({ __fenelFn: true, params: [], body, closure: {}, lexicalImports: [redirect] });
    // `M.helper` as a value, then applied.
    expect(callCb(closureOver({ method: ["M", "helper"] }), ctx)).toEqual({ $ref: "ModA:helper" });
    expect(callCb(closureOver({ method: ["M", "helper", 0] }), ctx)).toBe("from A");
    expect(callCb(closureOver({ method: ["M", "helper"] }), { ...ctx, _importStack: [redirect] }))
      .toEqual({ $ref: "ModA:helper" });
  });

  test("the snapshot is taken once per frame and reused, so the context cache holds", () => {
    const seen: EvaluateContext[] = [];
    const ctx: EvaluateContext = { nativesCtx: { observe: (current) => { seen.push(current); return "seen"; } } };
    // Not frozen, like a `buildImportFrame` result.
    const frameU: ImportFrame = { names: { look: "observe" }, aliases: {} };
    const closureOver = (body: unknown) => ({ __fenelFn: true, params: [], body, closure: {}, lexicalImports: [frameU] });
    const cb = closureOver({ call: ["look"] });
    expect(callCb(cb, ctx)).toBe("seen");
    expect(callCb(cb, ctx)).toBe("seen");
    expect(callCb(closureOver({ call: ["look"] }), ctx)).toBe("seen");

    const snapshot = seen[0]!._importStack![0]!;
    expect(snapshot).not.toBe(frameU); // was: the caller's frame itself
    expect(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.names) && Object.isFrozen(snapshot.aliases)).toBe(true);
    expect(Object.getPrototypeOf(snapshot.names)).toBeNull();
    expect({ ...snapshot.names }).toEqual({ look: "observe" });
    // Every call, from either closure, gets the same snapshot, and so the same
    // cached context.
    expect(seen[1]!._importStack![0]).toBe(snapshot);
    expect(seen[2]!._importStack![0]).toBe(snapshot);
    expect(seen[1]).toBe(seen[0]);
    expect(seen[2]).toBe(seen[0]);

    // A closure created in the body carries the snapshot, which is its own
    // snapshot: calling it lands in the same context again.
    const inner = callCb(closureOver({ fn: [[], { call: ["look"] }] }), ctx);
    expect((Object.getOwnPropertyDescriptor(inner, "lexicalImports")?.value as unknown[])[0]).toBe(snapshot);
    expect(callCb(inner, ctx)).toBe("seen");
    expect(seen[3]).toBe(seen[0]);

    // What was validated is what resolves: changing the frame afterwards
    // changes nothing (was: the change was read).
    frameU.names.look = "elsewhere";
    expect(callCb(cb, ctx)).toBe("seen");
    expect(seen[4]!._importStack![0]).toBe(snapshot);
  });

  test("a frozen frame is its own snapshot, as every registry frame is", () => {
    const seen: EvaluateContext[] = [];
    const nativesCtx = { observe: (current: EvaluateContext) => { seen.push(current); return "seen"; } };
    const frozen: ImportFrame = Object.freeze({ names: Object.freeze({ look: "observe" }), aliases: Object.freeze({}) });
    const cb = { __fenelFn: true, params: [], body: { call: ["look"] }, closure: {}, lexicalImports: [frozen] };
    expect(callCb(cb, { nativesCtx })).toBe("seen");
    expect(seen[0]!._importStack![0]).toBe(frozen);
  });

  test("called in its own frozen scope, a closure reuses the caller's context", () => {
    // The same-frames fast path is safe when the frame IS its own snapshot.
    const seen: EvaluateContext[] = [];
    const nativesCtx = { observe: (current: EvaluateContext) => { seen.push(current); return "seen"; } };
    const frozen: ImportFrame = Object.freeze({ names: Object.freeze({ look: "observe" }), aliases: Object.freeze({}) });
    const scope: EvaluateContext = { nativesCtx, _importStack: [frozen] };
    const cb = { __fenelFn: true, params: [], body: { call: ["look"] }, closure: {}, lexicalImports: [frozen] };
    expect(callCb(cb, scope)).toBe("seen");
    expect(callCb(cb, scope)).toBe("seen");
    expect(seen[0]).toBe(scope);
    expect(seen[1]).toBe(scope);
  });

  test("called in its own mutable scope, a closure keeps its first frozen import snapshot", () => {
    const seen: EvaluateContext[] = [];
    const nativesCtx = { observe: (current: EvaluateContext) => { seen.push(current); return "seen"; } };
    const unfrozen: ImportFrame = { names: { look: "observe" }, aliases: {} };
    const scope: EvaluateContext = { nativesCtx, _importStack: [unfrozen] };
    const cb = { __fenelFn: true, params: [], body: { call: ["look"] }, closure: {}, lexicalImports: [unfrozen] };
    expect(callCb(cb, scope)).toBe("seen");
    const snapshot = seen[0]!._importStack![0]!;
    expect(seen[0]).not.toBe(scope);
    expect(snapshot).not.toBe(unfrozen);
    expect(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.names)).toBe(true);
    unfrozen.names.look = "elsewhere";
    expect(callCb(cb, scope)).toBe("seen");
    expect(seen[1]).toBe(seen[0]);
    expect(seen[1]!._importStack![0]).toBe(snapshot);
  });

  test("an honest unfrozen frame resolves exactly as before", () => {
    // Innermost first; a non-string or accessor entry binds nothing, so the
    // name falls through to the next frame; `__proto__` is an ordinary name.
    let getterCalls = 0;
    const innerNames = JSON.parse('{"helper": 5, "__proto__": "helperB"}') as Record<string, unknown>;
    Object.defineProperty(innerNames, "other", {
      get() { getterCalls++; return "helperB"; },
      enumerable: true,
    });
    const inner = { names: innerNames, aliases: {} };
    const outer: ImportFrame = { names: { helper: "helperA", other: "helperA" }, aliases: {} };
    const closureCalling = (name: string) => ({ __fenelFn: true, params: [], body: { call: [name] }, closure: {}, lexicalImports: [outer, inner] });
    expect(callCb(closureCalling("helper"), { natives })).toBe("from A");
    expect(callCb(closureCalling("other"), { natives })).toBe("from A");
    expect(callCb(closureCalling("__proto__"), { natives })).toBe("from B");
    expect(getterCalls).toBe(0);
  });
});

describe("an accessor is never run, and fails closed", () => {
  test("an accessor element (was: its getter ran 3-4 times per call, and the call resolved)", () => {
    let calls = 0;
    const accessor = withAccessor([], 0, () => { calls++; return A; });
    expect(() => callCb(closureWith(accessor), { natives })).toThrow(TypeError);
    expect(() => callCb(closureWith(accessor), { natives, _importStack: [B] })).toThrow(TypeError);
    expect(calls).toBe(0);
  });

  test("an accessor `lexicalImports` slot on the closure itself (was: ran, and resolved)", () => {
    let calls = 0;
    const cl = { __fenelFn: true, params: [], body: { call: ["helper"] }, closure: {} };
    Object.defineProperty(cl, "lexicalImports", {
      get() { calls++; return [A]; },
      enumerable: true,
    });
    expect(() => callCb(cl, { natives })).toThrow(TypeError);
    expect(calls).toBe(0);
  });

  test("an accessor `names` slot on a frame (was: ran, and resolved)", () => {
    let calls = 0;
    const f = { aliases: {} };
    Object.defineProperty(f, "names", {
      get() { calls++; return { helper: "helperA" }; },
      enumerable: true,
    });
    expect(() => callCb(closureWith([f]), { natives })).toThrow(TypeError);
    expect(calls).toBe(0);
  });

  test("a throwing element under an `every` that CATCHES (was: `from B`, and `Just true` in a proof, where the plain array threw)", () => {
    let calls = 0;
    const throwing = (catches: boolean): unknown[] => {
      const a = withAccessor([], 0, () => { calls++; throw new Error("boom-getter"); });
      if (catches) {
        Object.defineProperty(a, "every", {
          value(this: unknown[], ...args: Parameters<typeof Array.prototype.every>) {
            try { return Array.prototype.every.apply(this, args); } catch { return true; }
          },
        });
      }
      return a;
    };
    // The caller's stack has the closure's length, so the equality fast path —
    // the site that called `every` — is what runs.
    const ctx: EvaluateContext = { natives, _importStack: [B] };
    for (const catches of [false, true]) {
      expect(() => callCb(closureWith(throwing(catches)), ctx)).toThrow(/lexicalImports\[0\]/);
    }
    // Inside a proof both abstain; the catching one used to DECIDE (`Just true`).
    const pred = (catches: boolean) => ({ "==": [{ call: [closureWith(throwing(catches))] }, "from B"] });
    expect(prove(pred(false), ctx)).toEqual(NOTHING);
    expect(prove(pred(true), ctx)).toEqual(NOTHING);
    expect(calls).toBe(0);
  });

  test("a throwing element under an iterator that CATCHES, at the real `$where` door (was: `Just true`)", () => {
    let calls = 0;
    const mk = (catches: boolean): unknown[] => {
      const a = withAccessor([A], 1, () => { calls++; throw new Error("boom-getter"); });
      if (catches) {
        Object.defineProperty(a, Symbol.iterator, {
          value: function* (this: unknown[]) {
            for (let i = 0; i < 2; i++) {
              try { yield this[i]; } catch { yield B; }
            }
          },
        });
      }
      return a;
    };
    // The decider context the real door builds carries no caller import stack,
    // so the closure's list goes through the rebuild's SPREAD — which is where
    // the catching iterator substituted `B` for the throw. (The pre-copy value
    // was measured through `prove`: the same door, the same empty stack.)
    const where = (pred: unknown): SetExpr => ({ $tag: "SeWhere", pred }) as unknown as SetExpr;
    const ctxFor = (catches: boolean): EvaluateContext => ({
      natives: { ...natives, mkCb: () => closureWith(mk(catches)) },
    });
    const pred = { "==": [{ call: [{ call: ["mkCb"] }] }, "from B"] };
    expect(contains(where(pred), 5, null, undefined, ctxFor(false))).toEqual(NOTHING);
    expect(contains(where(pred), 5, null, undefined, ctxFor(true))).toEqual(NOTHING);
    expect(calls).toBe(0);
  }, 120_000);
});

describe("anything that is not a dense list of import frames fails closed", () => {
  // Measured before the copy: the first five resolved SILENTLY — a hole under a
  // caller stack of its own length took the fast path (native `every` skips a
  // hole) and answered `from B`; a hole before a binding frame, a frame with no
  // `aliases` and one with inherited `names` answered `from A`; a non-record
  // `names` bound nothing and the call produced no value. The rest already
  // threw a `TypeError`, eagerly or at the first name lookup.
  const hole: unknown[] = [];
  hole.length = 1;
  const holeThenFrame: unknown[] = [];
  holeThenFrame.length = 2;
  holeThenFrame[1] = A;
  const shapes: Array<[string, unknown]> = [
    ["a hole", hole],
    ["a hole before a frame the name resolves in", holeThenFrame],
    ["a frame without aliases", [{ names: { helper: "helperA" } }]],
    ["a frame whose names is not a record", [{ names: "helperA", aliases: {} }]],
    ["a frame whose names are inherited", [Object.create({ names: { helper: "helperA" }, aliases: {} })]],
    ["an element that is not a record", [5]],
    ["an array element", [[A]]],
    ["a list that is not an array", { 0: A, length: 1 }],
    ["null", null],
    ["a string", "AB"],
  ];
  for (const [label, imports] of shapes) {
    test(label, () => {
      expect(() => callCb(closureWith(imports), { natives })).toThrow(TypeError);
      expect(() => callCb(closureWith(imports), { natives, _importStack: [B] })).toThrow(TypeError);
      // ... and inside a proof it abstains rather than deciding.
      expect(prove({ "==": [{ call: [closureWith(imports)] }, "from A"] }, { natives })).toEqual(NOTHING);
    });
  }
});

describe("the context cache never crosses authority frames", () => {
  // Inert identity handles: nothing in this context authenticates them, and the
  // cache compares ambient slots by identity.
  const authorityA = Object.freeze({}) as unknown as AuthorityRef;
  const authorityB = Object.freeze({}) as unknown as AuthorityRef;
  const F: ImportFrame = { names: { look: "observe" }, aliases: {} };

  test("the same closure under two frames sees each frame's own authority", () => {
    const seen: EvaluateContext[] = [];
    const base: EvaluateContext = {
      nativesCtx: { observe: (current) => { seen.push(current); return current._authority; } },
    };
    // A real closure, built the way `fn` builds one inside a frame.
    const cb = evaluate({ fn: [[], { call: ["look"] }] }, {}, { ...base, _importStack: [F] });
    expect(Object.getOwnPropertyDescriptor(cb, "lexicalImports")?.value).toEqual([F]);

    const ctxA: EvaluateContext = { ...base, _authority: authorityA };
    const ctxB: EvaluateContext = { ...base, _authority: authorityB };
    expect(callCb(cb, ctxA)).toBe(authorityA);
    expect(callCb(cb, ctxB)).toBe(authorityB);
    expect(callCb(cb, ctxA)).toBe(authorityA);
    // The cache is live, not bypassed: A's two calls share one context, B's is
    // another.
    expect(seen[2]).toBe(seen[0]);
    expect(seen[1]).not.toBe(seen[0]);

    // A frame DERIVED from the context A's call ran in, carrying B.
    expect(callCb(cb, { ...seen[0]!, _authority: authorityB })).toBe(authorityB);

    // The SAME context object, its authority replaced in place: the ambient
    // comparison sees the new slot value and forms a new family.
    ctxA._authority = authorityB;
    expect(callCb(cb, ctxA)).toBe(authorityB);
    expect(seen[4]).not.toBe(seen[0]);
  });
});

describe("real registry frames still resolve", () => {
  // `helper` is declared by BOTH modules, so the flat-global spelling is an
  // ambiguity: only a lexical frame can resolve it. (`mk` returns its lambda in
  // a record because the registry's signature pass refuses `mk u = \y -> …`:
  // the inferred arrow is wider than the declared parameters.)
  const fooSrc = `module Foo where
helper x = "foo"
mk u = { run = \\y -> helper y }
`;
  const barSrc = `module Bar where
helper x = "bar"
`;
  const reg = createRegistry([loadFenelModule(fooSrc, "x"), loadFenelModule(barSrc, "x")]);
  const ctx = reg.evaluateContext();
  const barFrame = reg.buildImportFrame([{ module: "Bar", names: ["helper"] }]);

  test("a lambda returned by a module body keeps that module's frame", () => {
    const lam = (evaluate({ call: ["Foo:mk", 0] }, {}, ctx) as { run: Record<string, unknown> }).run;
    expect(Object.getOwnPropertyDescriptor(lam, "lexicalImports")?.value).toHaveLength(1);
    expect(evaluate({ call: [{ var: "f" }, 1] }, { f: lam }, ctx)).toBe("foo");
    expect(withImports(ctx, barFrame, (c) => evaluate({ call: [{ var: "f" }, 1] }, { f: lam }, c))).toBe("foo");
    // The frame is what resolves it: the same lambda without one meets the
    // flat-global ambiguity.
    const unscoped = { ...lam, lexicalImports: undefined };
    expect(() => evaluate({ call: [{ var: "f" }, 1] }, { f: unscoped }, ctx)).toThrow(/ambiguous/);
  });

  test("a lambda built under an import frame keeps it", () => {
    const lam = withImports(ctx, barFrame, (c) => evaluate({ fn: [["y"], { call: ["helper", { var: "y" }] }] }, {}, c));
    expect(evaluate({ call: [{ var: "f" }, 1] }, { f: lam }, ctx)).toBe("bar");
    const fooFrame = reg.buildImportFrame([{ module: "Foo", names: ["helper"] }]);
    expect(withImports(ctx, fooFrame, (c) => evaluate({ call: [{ var: "f" }, 1] }, { f: lam }, c))).toBe("bar");
  });
});
