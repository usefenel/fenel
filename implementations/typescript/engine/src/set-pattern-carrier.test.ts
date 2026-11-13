import { describe, expect, test } from "bun:test";
import { dispatchedPatternMemberTri } from "./engine-bodies-dispatch";
import { contains, setPatternContains } from "./set-algebra";
import { getNamedPattern, registerFormatPattern } from "./format-presets";
import { normalizeSetPattern, patternPredsAreCharTotal, peelSetExpr, setExprToTag } from "./set-marker";
import type { Pattern, SetExpr } from "./types";

// Existing B3 carrier codec / C1 harness: the registered SetPattern grammar
// feeds the unchanged matcher and character-total fence, rather than a second
// membership algorithm. No registered producer or generated artifact changes.
const chars: SetExpr = { $tag: "SeEnum", values: ["Α", "Β"] };
const registeredMatch = { $tag: "SpMatch", pred: chars };
const legacyMatch: Pattern = { t: "match", pred: chars };
const just = (value: boolean) => ({ $tag: "Just" as const, _0: value });
const nothing = { $tag: "Nothing" } as const;

describe("registered SetPattern carrier reaches the existing matcher", () => {
  const pairs: Array<[unknown, Pattern]> = [
    [{ $tag: "SpEmpty" }, { t: "empty" }],
    [{ $tag: "SpEps" }, { t: "eps" }],
    [registeredMatch, legacyMatch],
    [{ $tag: "SpSeq", a: registeredMatch, b: { $tag: "SpEps" } }, { t: "seq", a: legacyMatch, b: { t: "eps" } }],
    [{ $tag: "SpAlt", a: { $tag: "SpEmpty" }, b: registeredMatch }, { t: "alt", a: { t: "empty" }, b: legacyMatch }],
    [{ $tag: "SpRep", child: registeredMatch, min: 1, max: 2 }, { t: "rep", child: legacyMatch, min: 1, max: 2 }],
    [{ $tag: "SpRep", child: registeredMatch, min: 0, max: Infinity }, { t: "rep", child: legacyMatch, min: 0, max: Infinity }],
    [{ $tag: "SpGroup", name: "letters", child: registeredMatch, type: nothing }, { t: "group", name: "letters", child: legacyMatch }],
  ];

  test("all seven registered cases normalize to the same recursive carrier", () => {
    for (const [registered, legacy] of pairs) {
      expect(normalizeSetPattern(registered)).toEqual(legacy);
      expect(normalizeSetPattern(legacy)).toEqual(legacy);
      expect(patternPredsAreCharTotal(registered)).toBe(true);
      expect(peelSetExpr({ $tag: "SePattern", pattern: registered })).toEqual({ kind: "SePattern", pattern: legacy });
      expect(setExprToTag({ $tag: "SePattern", pattern: registered })).toEqual({ $tag: "SePattern", pattern: legacy });
    }
    expect(normalizeSetPattern({ $tag: "SpSeq", a: registeredMatch, b: registeredMatch }))
      .toEqual({ t: "seq", a: legacyMatch, b: legacyMatch });
    expect(normalizeSetPattern({ t: "rep", child: legacyMatch, min: 0, max: "unbounded" }))
      .toEqual({ t: "rep", child: legacyMatch, min: 0, max: Infinity });
    const invalidRegisteredBound = { $tag: "SpRep", child: registeredMatch, min: 0, max: "unbounded" };
    expect(normalizeSetPattern(invalidRegisteredBound)).toBeNull();
    expect(dispatchedPatternMemberTri(invalidRegisteredBound, "Α")).toEqual(nothing);
  });

  test("registered and legacy empty, nullable and repeated patterns have identical Tri verdicts", () => {
    for (const [registered, legacy] of pairs) {
      for (const input of ["", "Α", "Β", "ΑΒ", "ΑΒΑ", "A", "ΑA"]) {
        expect(dispatchedPatternMemberTri(registered, input)).toEqual(dispatchedPatternMemberTri(legacy, input));
      }
    }
    const pattern = { $tag: "SpRep", child: registeredMatch, min: 1, max: 2 };
    expect(dispatchedPatternMemberTri(pattern, "ΑΒ")).toEqual(just(true));
    expect(dispatchedPatternMemberTri(pattern, "ΑA")).toEqual(just(false));
    expect(dispatchedPatternMemberTri(pattern, "")).toEqual(just(false));
    expect(dispatchedPatternMemberTri(pattern, "ΑΒΑ")).toEqual(just(false));
    expect(dispatchedPatternMemberTri({ $tag: "SpEps" }, "")).toEqual(just(true));
    expect(dispatchedPatternMemberTri({ $tag: "SpEmpty" }, "")).toEqual(just(false));
  }, 60_000);

  test("both public SetExpr membership entries retain registered repeated-pattern verdicts", () => {
    const set = { $tag: "SePattern", pattern: { $tag: "SpRep", child: registeredMatch, min: 1, max: 2 } };
    for (const [input, verdict] of [["ΑΒ", true], ["ΑA", false], ["", false]] as const) {
      expect(contains(set as unknown as SetExpr, input, null)).toEqual(just(verdict));
      expect(setPatternContains(set as never, input, null)).toEqual(just(verdict));
    }
  }, 60_000);

  test("named-format registration retains the same admitted carrier and Boolean verdicts", () => {
    const pattern = { $tag: "SpRep", child: registeredMatch, min: 1, max: 2 };
    const name = "test:registered-set-pattern-carrier";
    registerFormatPattern(name, pattern as unknown as Pattern);
    const stored = getNamedPattern(name);
    expect(stored).toEqual({ t: "rep", child: legacyMatch, min: 1, max: 2 });
    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(stored?.t === "rep" ? stored.child : null)).toBe(true);
    expect(contains({ $tag: "SeRef", handle: name }, "ΑΒ", null)).toEqual(just(true));
    expect(contains({ $tag: "SeRef", handle: name }, "ΑA", null)).toEqual(just(false));
    expect(() => registerFormatPattern("test:registered-set-pattern-unknown", {
      $tag: "SpMatch", pred: { $tag: "SeRef", handle: "missing:pattern-predicate" },
    } as unknown as Pattern)).toThrow(/outside the character-total fragment/);
  }, 60_000);
});

describe("registered carriers preserve the existing membership abstentions", () => {
  test("unknown predicates and typed Maybe groups cannot bypass the character-total fence", () => {
    const unknown = { $tag: "SpMatch", pred: { $tag: "SeRef", handle: "missing:pattern-predicate" } };
    const typed = { $tag: "SpGroup", name: "letter", child: registeredMatch, type: { $tag: "Just", _0: chars } };
    expect(normalizeSetPattern(typed)).toEqual({ t: "group", name: "letter", child: legacyMatch, type: chars });
    for (const pattern of [unknown, { $tag: "SpRep", child: unknown, min: 0, max: 2 }, typed]) {
      expect(patternPredsAreCharTotal(pattern)).toBe(false);
      for (const input of ["", "Α", "A"]) expect(dispatchedPatternMemberTri(pattern, input)).toEqual(nothing);
    }
  });

  test("malformed, cyclic, inherited and accessor slots refuse without running getters", () => {
    let getters = 0;
    const accessor = (value: object, key: string) => Object.defineProperty(value, key, { get() { getters += 1; throw new Error("getter ran"); } });
    const cycle: Record<string, unknown> = { $tag: "SpRep", min: 0, max: 1 };
    cycle.child = cycle;
    const inheritedTag = Object.assign(Object.create({ $tag: "SpMatch" }), { pred: chars });
    const inheritedPred = Object.assign(Object.create({ pred: chars }), { $tag: "SpMatch" });
    const unreadable: unknown[] = [
      {}, null, { $tag: "SpUnknown" }, { $tag: "SpMatch" }, { $tag: "SpSeq", a: registeredMatch },
      { t: "SpMatch", pred: chars }, { $tag: "match", pred: chars },
      { $tag: "SpMatch", t: "match", pred: chars }, { $tag: "SpEps", t: "eps" },
      accessor({ $tag: "SpMatch", pred: chars }, "t"),
      { $tag: "SpRep", child: registeredMatch, min: "1", max: 2 },
      { $tag: "SpGroup", name: "letters", child: registeredMatch },
      { $tag: "SpGroup", name: "letters", child: registeredMatch, type: { $tag: "Just" } },
      { $tag: "SpGroup", name: "letters", child: registeredMatch, type: { $tag: "Just", _0: null } },
      cycle, inheritedTag, inheritedPred,
      accessor({ pred: chars }, "$tag"), accessor({ $tag: "SpMatch" }, "pred"),
      accessor({ pred: chars }, "t"), Object.assign(Object.create({ t: "match" }), { pred: chars }),
      accessor({ $tag: "SpRep", min: 0, max: 1 }, "child"),
      { $tag: "SpGroup", name: "letters", child: registeredMatch, type: accessor({ $tag: "Just" }, "_0") },
      { $tag: "SpGroup", name: "letters", child: registeredMatch, type: accessor({}, "$tag") },
      new Proxy({}, { getOwnPropertyDescriptor() { throw new Error("unreadable descriptor"); } }),
    ];
    for (const pattern of unreadable) {
      expect(normalizeSetPattern(pattern)).toBeNull();
      expect(patternPredsAreCharTotal(pattern)).toBe(false);
      expect(dispatchedPatternMemberTri(pattern, "Α")).toEqual(nothing);
    }
    expect(getters).toBe(0);
  });

  test("carrier decoding bounds shared-DAG expansion and depth before the matcher runs", () => {
    let shared: unknown = registeredMatch;
    for (let index = 0; index < 8; index += 1) shared = { $tag: "SpSeq", a: shared, b: shared };
    expect(normalizeSetPattern(shared)).not.toBeNull();
    for (let index = 0; index < 8; index += 1) shared = { $tag: "SpSeq", a: shared, b: shared };
    expect(normalizeSetPattern(shared)).toBeNull();
    expect(patternPredsAreCharTotal(shared)).toBe(false);
    expect(dispatchedPatternMemberTri(shared, "Α")).toEqual(nothing);

    let deep: unknown = registeredMatch;
    for (let index = 0; index < 64; index += 1) deep = { $tag: "SpRep", child: deep, min: 1, max: 1 };
    expect(normalizeSetPattern(deep)).not.toBeNull();
    for (let index = 0; index < 256; index += 1) deep = { $tag: "SpRep", child: deep, min: 1, max: 1 };
    expect(normalizeSetPattern(deep)).toBeNull();
    expect(dispatchedPatternMemberTri(deep, "Α")).toEqual(nothing);
  });
});
