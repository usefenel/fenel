// universal-dispatch-convergence Phase 4 (A∪B store convergence, M-C) —
// conformance tests for the UNIFIED type store: dispatch-class lookup and
// entity-type lookup resolve from ONE keyed store (`entityMap`), each entry
// carrying both faces — the record `type` and, for a dispatch class, the
// `interface` dispatch projection. `getEntity`/`getEntityType` and
// `getClass`/`getCapability` are two PROJECTIONS of one lookup, not two rival
// stores. (design/universal-dispatch-convergence.md §3 Axis-2 step 1.)
//
// This is the fossil removal that unblocks Phase 5 (`getClass`→`getType`):
// after convergence there is one type named `Labelable`, reachable by every
// verb, with a `.interface` dispatch face — so `getType` can be ONE operation
// over all types.

import { describe, it, expect } from "bun:test";
import { createRegistry } from "./registry";

describe("Phase 4 — A∪B store convergence (one type store, two projections)", () => {
  const reg = createRegistry([]);

  // A representative dispatch class from each family: representational,
  // effect/capability, algebra, format.
  const CLASSES = ["Labelable", "HasStateIO", "Monoid", "Codeable", "Eq"];
  // Plain data types — NOT dispatch classes.
  const DATA = ["Maybe", "Result"];

  it("a dispatch class is REACHABLE via the entity verbs (the old asymmetry is gone)", () => {
    for (const n of CLASSES) {
      const e = reg.getEntity(n);
      expect(e, `getEntity(${n}) should resolve`).toBeDefined();
      expect(e!.type, `getEntity(${n}).type (the record shape) should be present`).toBeDefined();
    }
  });

  it("a dispatch class carries its `interface` dispatch face on the SAME entry", () => {
    for (const n of CLASSES) {
      const e = reg.getEntity(n);
      expect(e!.interface, `getEntity(${n}).interface should be present`).toBeDefined();
      expect(e!.interface!.name).toBe(n);
      // methods is the dispatch surface — a class always has ≥1 method.
      expect(Array.isArray(e!.interface!.methods)).toBe(true);
    }
  });

  it("`getCapability`/`getClass` is a PROJECTION of the unified store (same Interface object)", () => {
    for (const n of CLASSES) {
      const e = reg.getEntity(n);
      // getCapability reads entityMap.interface first — identity, not a copy.
      expect(reg.getCapability(n)).toBe(e!.interface);
    }
  });

  it("a plain DATA type has NO interface (only dispatch classes carry a dispatch face)", () => {
    for (const n of DATA) {
      const e = reg.getEntity(n);
      expect(e, `getEntity(${n}) should resolve (data type)`).toBeDefined();
      expect(e!.interface, `getEntity(${n}).interface should be ABSENT`).toBeUndefined();
      expect(reg.getCapability(n), `getCapability(${n}) should be undefined for a data type`).toBeUndefined();
    }
  });

  it("`listCapabilities` still enumerates every class (the dispatch index stays authoritative for the SET)", () => {
    const caps = new Set(reg.listCapabilities().map((c) => c.name));
    for (const n of CLASSES) expect(caps.has(n)).toBe(true);
  });
});
