import { describe, expect, test } from "vitest";
import { containsB, isDisjointB, isSubsetB } from "./set-algebra";
import {
  dispatchEngineBody,
  __registerFieldCurrentWireFixtureForTests,
  __clearFieldCurrentWireFixturesForTests,
} from "./engine-bodies-dispatch";
import { buildSetExpr, peelSetExpr, setExprToTag } from "./set-marker";
import type { FieldKey, SetExpr } from "./types";

import { setDefaultTimeout } from "bun:test";

// type-substrate P1(a) — bun's 5 s per-test default is wrong for this file: the
// rename oracle drives the interpreted deciders and measured ~7 s on a slow
// Windows host, before this phase and after it. Clock, not verdict.
setDefaultTimeout(300_000);

const FIELD_A = "11111111-1111-4111-8111-111111111111";
const FIELD_B = "22222222-2222-4222-8222-222222222222";

const namedKey = (id: string): FieldKey => ({
  $tag: "NamedField",
  ref: { $ref: id },
});

const positionalKey = (index: number): FieldKey => ({
  $tag: "PositionalField",
  index,
});

const intSet: SetExpr = { $tag: "SeRef", handle: "ℤ" };
const stringSet: SetExpr = { $tag: "SeRef", handle: "String" };

const slotError = (slots: unknown[]): string | undefined => {
  const result = dispatchEngineBody("engine:fieldSemanticSlotsError", [slots]) as
    | { $tag: "Nothing" }
    | { $tag: "Just"; _0: string };
  return result.$tag === "Just" ? result._0 : undefined;
};

describe("SetExpr identity-total field slots", () => {
  test("the constructor surface requires key + wire projection and exposes both", () => {
    const field = buildSetExpr.ctorField(namedKey(FIELD_A), "currentName", intSet);
    const set = buildSetExpr.ctor("", [field]);

    expect(peelSetExpr(set)).toEqual({
      kind: "SeCtor",
      ctor: "",
      fields: [{
        $tag: "SetCtorField",
        key: namedKey(FIELD_A),
        wireName: "currentName",
        set: intSet,
      }],
    });
  });

  // RE-PINNED by type-substrate P1(a). This oracle used to assert BOTH subset
  // directions as `true` — while its own membership rows below say `before`
  // contains `{before:3}` and `after` does NOT. Those cannot both hold: a value
  // in `before` and not in `after` refutes `before ⊆ after`. HEAD proved it
  // anyway, so this test was PINNING a false `Just true` — the seventh path of
  // the P1(a) family, found by the repair rather than by the brief.
  //
  // The root cause is that the two snapshots do NOT denote the same set when the
  // key is registry-UNKNOWN, which is exactly this fixture's regime: neither
  // `11111111-…` resolves, so each side falls back to its own persisted wire hint
  // and genuinely reads a different host property. "Each snapshot reads its own
  // property" and "the relations are preserved" are contradictory in that regime;
  // only the first is true. The aligned-pair resolved-wire guard now abstains,
  // and `isSubsetB` — the Boolean projection, where `false` means "not PROVEN"
  // rather than "refuted" — reports false.
  //
  // The relation-preservation half is the D4 claim and it is REAL, but only for a
  // registry-KNOWN key: there `fieldKeyCurrentWire` resolves BOTH sides to the one
  // current wire and the stale persisted spelling cannot matter. That case had no
  // oracle at all; the next test is it. Rename tolerance is therefore preserved
  // where it was actually claimed, and this is NOT the embedded-hint comparison
  // the P1(a) brief bans — the guard compares RESOLVED wires, which is precisely
  // what makes the registry-known case inert.
  test("a wire-only rename with a registry-UNKNOWN key: each snapshot reads its own property, so the relation is NOT provable", () => {
    const before = buildSetExpr.ctor("", [
      buildSetExpr.ctorField(namedKey(FIELD_A), "before", intSet),
    ]);
    const after = buildSetExpr.ctor("", [
      buildSetExpr.ctorField(namedKey(FIELD_A), "after", intSet),
    ]);

    // The counterexample the old expectations contradicted, asserted FIRST so the
    // reason is visible before the verdict.
    expect(containsB(before, { before: 3 }, null)).toBe(true);
    expect(containsB(after, { after: 3 }, null)).toBe(true);
    expect(containsB(after, { before: 3 }, null)).toBe(false);

    expect(isSubsetB(before, after)).toBe(false); // was `true` — a false Just true
    expect(isSubsetB(after, before)).toBe(false); // was `true` — a false Just true
    // The BOOLEAN projection is unchanged, the Tri is NOT: HEAD answered
    // `Just false` here (they DO overlap — `{before:3, after:3}` inhabits both)
    // and the symmetric wire guard now abstains. A priced precision loss, not a
    // repair; `isDisjointB` maps both to `false`, which is what hid the flip.
    expect(isDisjointB(before, after)).toBe(false);
  });

  test("a wire-only rename with a registry-KNOWN key: the CURRENT wire wins on both sides, so the relation IS preserved (the real D4 claim)", () => {
    // The persisted snapshots still disagree ("before" / "after"), but the field
    // entity's CURRENT wire is `after`, and `seCtorFieldReadWire` resolves BOTH
    // sides through it. This is the case the D4 discipline actually promises, and
    // the case the resolved-wire guard is deliberately inert on.
    __registerFieldCurrentWireFixtureForTests(FIELD_A, "after");
    try {
      const stale = buildSetExpr.ctor("", [
        buildSetExpr.ctorField(namedKey(FIELD_A), "before", intSet),
      ]);
      const fresh = buildSetExpr.ctor("", [
        buildSetExpr.ctorField(namedKey(FIELD_A), "after", intSet),
      ]);

      // Both read `after` — the stale persisted spelling cannot flip membership.
      expect(containsB(stale, { after: 3 }, null)).toBe(true);
      expect(containsB(fresh, { after: 3 }, null)).toBe(true);
      expect(containsB(stale, { before: 3 }, null)).toBe(false);

      expect(isSubsetB(stale, fresh)).toBe(true);
      expect(isSubsetB(fresh, stale)).toBe(true);
    } finally {
      __clearFieldCurrentWireFixturesForTests();
    }
  });

  test("same spelling with different UUIDs never creates a semantic field match", () => {
    const left = buildSetExpr.ctor("", [
      buildSetExpr.ctorField(namedKey(FIELD_A), "same", intSet),
    ]);
    const right = buildSetExpr.ctor("", [
      buildSetExpr.ctorField(namedKey(FIELD_B), "same", stringSet),
    ]);

    expect(isSubsetB(left, right)).toBe(false);
    expect(isSubsetB(right, left)).toBe(false);
  });

  test("duplicate semantic keys, duplicate wire projections, and positional mismatches reject", () => {
    const duplicateKey = setExprToTag(buildSetExpr.ctor("", [
      buildSetExpr.ctorField(namedKey(FIELD_A), "one", intSet),
      buildSetExpr.ctorField(namedKey(FIELD_A), "two", intSet),
    ]));
    if (duplicateKey.$tag !== "SeCtor") throw new Error("expected constructor set");
    expect(slotError(duplicateKey.fields)).toMatch(/duplicate semantic field key/i);

    const duplicateWire = setExprToTag(buildSetExpr.ctor("", [
      buildSetExpr.ctorField(namedKey(FIELD_A), "same", intSet),
      buildSetExpr.ctorField(namedKey(FIELD_B), "same", intSet),
    ]));
    if (duplicateWire.$tag !== "SeCtor") throw new Error("expected constructor set");
    expect(slotError(duplicateWire.fields)).toMatch(/duplicate wire field name/i);

    const wrongPosition = setExprToTag(buildSetExpr.arrow([
      buildSetExpr.arrowParam(positionalKey(1), "_1", intSet),
    ], stringSet));
    if (wrongPosition.$tag !== "SeArrow") throw new Error("expected arrow set");
    expect(slotError(wrongPosition.params)).toMatch(/positional field key.*ordinal 0/i);
  });

  test("arrow variance remains list-positional even when named identities differ", () => {
    const left = buildSetExpr.arrow([
      buildSetExpr.arrowParam(namedKey(FIELD_A), "renamedA", intSet),
    ], stringSet);
    const right = buildSetExpr.arrow([
      buildSetExpr.arrowParam(namedKey(FIELD_B), "renamedB", intSet),
    ], stringSet);

    expect(isSubsetB(left, right)).toBe(true);
    expect(isSubsetB(right, left)).toBe(true);
  });
});

describe("SetExpr own-data boundary", () => {
  const defineGetter = (target: object, property: PropertyKey, get: () => unknown): void => {
    Object.defineProperty(target, property, { get, enumerable: true, configurable: true });
  };

  test("rejects canonical identity accessors without invoking alternating or throwing getters", () => {
    const getterFactories: Array<(calls: { value: number }) => () => unknown> = [
      (calls) => () => {
        calls.value += 1;
        return calls.value % 2 === 1 ? namedKey(FIELD_A) : namedKey(FIELD_B);
      },
      (calls) => () => {
        calls.value += 1;
        throw new Error("SetExpr recognizer invoked an accessor");
      },
    ];

    for (const makeGetter of getterFactories) {
      const calls = { value: 0 };
      const field: Record<string, unknown> = {
        $tag: "SetCtorField",
        wireName: "value",
        set: intSet,
      };
      defineGetter(field, "key", makeGetter(calls));
      const candidate = { $tag: "SeCtor", ctor: "Box", fields: [field] };
      expect(() => peelSetExpr(candidate)).not.toThrow();
      expect(peelSetExpr(candidate)).toBeNull();
      expect(calls.value).toBe(0);
    }

    const calls = { value: 0 };
    const ref: Record<string, unknown> = {};
    defineGetter(ref, "$ref", () => {
      calls.value += 1;
      throw new Error("FieldRef accessor was invoked");
    });
    const candidate = {
      $tag: "SeArrow",
      params: [{
        $tag: "SetArrowParam",
        key: { $tag: "NamedField", ref },
        wireName: "value",
        set: intSet,
      }],
      returns: stringSet,
    };
    expect(peelSetExpr(candidate)).toBeNull();
    expect(calls.value).toBe(0);
  });

  test("ignores inherited slots and rejects legacy, Pattern, and array accessors inertly", () => {
    const inheritedField = Object.create({ key: namedKey(FIELD_A) }) as Record<string, unknown>;
    Object.assign(inheritedField, {
      $tag: "SetCtorField",
      wireName: "value",
      set: intSet,
    });
    expect(peelSetExpr({ $tag: "SeCtor", ctor: "Box", fields: [inheritedField] })).toBeNull();

    let calls = 0;
    const legacy: Record<string, unknown> = {};
    defineGetter(legacy, "$all", () => {
      calls += 1;
      throw new Error("legacy accessor was invoked");
    });
    expect(peelSetExpr(legacy)).toBeNull();

    const pattern: Record<string, unknown> = { t: "match" };
    defineGetter(pattern, "pred", () => {
      calls += 1;
      throw new Error("Pattern accessor was invoked");
    });
    expect(peelSetExpr({ $tag: "SePattern", pattern })).toBeNull();

    const branches = [{ $tag: "SeAll" }] as unknown[];
    branches.length = 2;
    const prototype = Object.create(Array.prototype) as unknown[];
    defineGetter(prototype, "1", () => {
      calls += 1;
      throw new Error("inherited array accessor was invoked");
    });
    Object.setPrototypeOf(branches, prototype);
    expect(peelSetExpr({ $tag: "SeUnion", branches })).toBeNull();
    expect(calls).toBe(0);
  });
});
