// ---------------------------------------------------------------------------
// resolution-substrate Phase 1b — the grandfathered-collision migration parity
// test (the KEPT deliverable).
//
// Phase 1 collapsed last-wins into dispatch but GRANDFATHERED the 4 pre-existing
// collisions (`contains`/`log`/`repeat`/`now`) to `direct` last-wins via an
// explicit `GRANDFATHERED_COLLISIONS` allowlist. Phase 1b RETIRED all four +
// DELETED the allowlist:
//   • `contains` → dispatches by container via the `Containable` class
//     (String→std:contains substring, List→std:includes element).
//   • `log`/`repeat`/`now` → the non-conventional binding's codeName renamed apart
//     (control:log→logSpan, control:repeat→repeatCall, std:now→nowDate), so the
//     conventional std/time binding wins bare (single-binding `direct`).
//   • the allowlist is GONE → ANY unclassed multi-binding codeName is now a HARD
//     ERROR (`ambiguousModule`), with no grandfather escape.
//
// design/resolution-substrate.md §5 (Verification) + the D1 verdicts.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { createRegistry } from "./registry";
import { createDispatchRegistry } from "./dispatch-registry";
import { getSystemRegistry } from "./system-registry";
import { evaluate, formatBareAmbiguity } from "./json-logic";
import type { BareNameResolution } from "./json-logic";
import type { FenelModule } from "./types";

describe("Phase 1b — the system registry: all 4 collisions retired", () => {
  const reg = getSystemRegistry();
  const sys = reg.evaluateContext();
  const classify = (n: string): BareNameResolution => sys._resolveBareName!(n);
  const ev = (rule: unknown): unknown => evaluate(rule, {}, sys);

  test("`contains` dispatches by the container's reflected type (Containable)", () => {
    expect(classify("contains")).toEqual({ kind: "dispatch", typeName: "Containable" });
    expect(ev({ call: ["contains", "abcdef", "cd"] })).toBe(true);   // String → std:contains
    expect(ev({ call: ["contains", "abcdef", "zz"] })).toBe(false);
    expect(ev({ call: ["contains", [1, 2, 3], 2] })).toBe(true);     // List → std:includes
    expect(ev({ call: ["contains", [1, 2, 3], 9] })).toBe(false);
  });

  test("`log`/`repeat`/`now` resolve single-binding `direct` to the conventional binding", () => {
    const conventional: Record<string, string> = {
      log: "std:log", repeat: "std:repeat", now: "time:now",
    };
    for (const [name, id] of Object.entries(conventional)) {
      expect(classify(name).kind).toBe("direct");
      expect(reg.getFunctionByCodeName(name)?.id).toBe(id);
    }
  });

  test("bare `log`/`repeat` evaluate to the conventional std op", () => {
    expect(ev({ call: ["log", 2.718281828459045] }) as number).toBeCloseTo(1, 9); // logarithm
    expect(ev({ call: ["repeat", "ha", 3] })).toBe("hahaha");                      // string×n
  });

  test("the renamed non-conventional bindings stay reachable under their new codeNames", () => {
    const renamed: Record<string, string> = {
      logSpan: "control:log", repeatCall: "control:repeat", nowDate: "std:now",
    };
    for (const [codeName, id] of Object.entries(renamed)) {
      expect(reg.getFunctionByCodeName(codeName)?.id).toBe(id);
    }
  });
});

// A fresh, unclassed multi-binding codeName must HARD-ERROR (`ambiguousModule`),
// never silently last-wins. With `GRANDFATHERED_COLLISIONS` deleted there is no
// transitional allowlist to absorb it — the thesis: never a silent last-wins.
// Returns the REGISTRY (not the ctx) so Phase-4 tests can read the eager
// `ambiguousBareNames()` surface AND derive a ctx for the call-time throw.
function collidingRegistry() {
  const spec = createDispatchRegistry();
  const mod: FenelModule = {
    name: "z",
    label: { $tag: "Nothing" } as never,
    functions: [
      { id: "z:zonkA", params: [{ name: "n", type: { $ref: "Number" } } as never], returns: { $ref: "Number" } },
      { id: "z:zonkB", params: [{ name: "n", type: { $ref: "Number" } } as never], returns: { $ref: "Number" } },
    ],
    instances: [
      { typeName: "Codeable", args: ["z:zonkA"], methods: { codeName: "zonk" } },
      { typeName: "Codeable", args: ["z:zonkB"], methods: { codeName: "zonk" } },
    ],
    nativeImpls: { "z:zonkA": (n) => n, "z:zonkB": (n) => n },
  };
  return createRegistry([mod], { dispatchRegistry: spec });
}

describe("Phase 1b — the grandfather escape is GONE (a NEW collision hard-errors)", () => {
  test("a new unclassed colliding codeName classifies `ambiguousModule` (no grandfather)", () => {
    const ctx = collidingRegistry().evaluateContext();
    const r = ctx._resolveBareName!("zonk");
    expect(r.kind).toBe("ambiguousModule");
    if (r.kind === "ambiguousModule") expect([...r.bindings].sort()).toEqual(["z:zonkA", "z:zonkB"]);
  });

  test("calling it throws `qualify with Module.` (hard error, never silent last-wins)", () => {
    const ctx = collidingRegistry().evaluateContext();
    expect(() => evaluate({ call: ["zonk", 5] }, {}, ctx)).toThrow(/qualify with `Module\.zonk`/);
  });
});

describe("Phase 4 — eager build-time ambiguity detection (resolution-substrate)", () => {
  // The compile/load half of the D1 parity invariant: a COLLISION is surfaced
  // from the registry's routing table at BUILD (the audit gate reads
  // `ambiguousBareNames()`), not deferred to the runtime throw fired when the
  // name is first CALLED. The two emit a byte-identical `formatBareAmbiguity`.

  test("the system registry has ZERO ambiguous collisions at HEAD (post-Phase-1b)", () => {
    // verify-green: Phase 1b retired all 4 grandfathered collisions, so the eager
    // gate is empty. A NEW unclassed multi-binding codeName would appear here (and
    // fail the audit) before any call site triggers the runtime throw.
    expect(getSystemRegistry().ambiguousBareNames()).toEqual([]);
  });

  test("a new collision is detected EAGERLY — without calling it — with the runtime-parity message", () => {
    const reg = collidingRegistry();
    // surfaced from the routing map alone; `zonk` is never evaluated to find it.
    const ambiguous = reg.ambiguousBareNames();
    expect(ambiguous.map((x) => x.name)).toEqual(["zonk"]); // exactly one, no false positives
    const v = ambiguous[0]!;
    expect(v.kind).toBe("ambiguousModule");
    const msg = formatBareAmbiguity(v);
    expect(msg).toContain('ambiguous bare name "zonk"');
    expect(msg).toMatch(/qualify with `Module\.zonk`/);
    // PARITY: calling the name throws the SAME string the eager gate reports.
    expect(() => evaluate({ call: ["zonk", 5] }, {}, reg.evaluateContext())).toThrow(msg);
  });

  test("a legit multi-binding DISPATCH name is NOT reported (coherent, not a collision)", () => {
    const names = getSystemRegistry().ambiguousBareNames().map((v) => v.name);
    expect(names).not.toContain("take");      // dispatches via Sequential (List/Vec)
    expect(names).not.toContain("contains");  // dispatches via Containable (String/List)
  });

  test("formatBareAmbiguity covers the `ambiguousClass` arm (qualify with `Class.`)", () => {
    const msg = formatBareAmbiguity({ kind: "ambiguousClass", name: "m", classes: ["A", "B"] });
    expect(msg).toBe('ambiguous bare name "m" — declared by 2 classes (A, B); qualify with `Class.m`');
  });
});
