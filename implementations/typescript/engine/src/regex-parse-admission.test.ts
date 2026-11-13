import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadFenelModule } from "./fenel-module";
import { evaluate, type EvaluateContext } from "./json-logic";
import { registerEngineModule } from "./engine-require";
import * as dispatchNamespace from "./engine-bodies-dispatch";
import { stdNatives, stdNativesCtx } from "../../../../fenel/modules/std/ffi/std-ffi";
import { alt, eps, match, patternMatch, rep, seq } from "./pattern";
import { regexHint, regexStringToPattern, patternToRegex } from "./regex-shim";
import { setExprToTag } from "./set-marker";
import type { FenelFunction } from "./types";

// Ledgered C1 harness: parse and execute the real Fenel sources without a
// registry or compiled owner. B3 facade checks borrow this source dispatcher
// synchronously and restore the actual namespace after each check. The scalar
// regressions extend this existing harness with actual source set membership.
const root = resolve(import.meta.dir, "../../../..");
const functions = new Map<string, FenelFunction>();
for (const path of [
  "fenel/modules/engine/regex-parse.fenel",
  "fenel/modules/engine/regex-hint.fenel",
  "fenel/modules/engine/set-algebra-deciders.fenel",
  "fenel/modules/engine/rel-solve.fenel",
  "fenel/modules/std/appendItem.fenel",
]) {
  const source = loadFenelModule(readFileSync(resolve(root, path), "utf8"),
    path.includes("/engine/") ? "engine" : "std", { bootstrapParser: "typescript" });
  for (const fn of source.functions ?? []) {
    functions.set(fn.id, fn);
    functions.set(fn.id.slice(fn.id.indexOf(":") + 1), fn);
  }
}
const context: EvaluateContext = {
  getFunction: name => functions.get(name),
  natives: Object.assign(Object.create(null), stdNatives),
  nativesCtx: Object.assign(Object.create(null), stdNativesCtx),
  _constructors: {
    Ok: ["_0"], Err: ["_0"], Just: ["_0"], Nothing: [],
    BoundNumber: ["value", "inclusive"], BoundString: ["value", "inclusive"],
    BoundExpr: ["exprKey", "inclusive", "origExpr"], Interval: ["lo", "hi"],
    IvNumber: ["value"], IvString: ["value"], IvOther: [],
  },
};
const tokens = (source: string) => Array.from(source, ch => ({ ch, code: ch.codePointAt(0)! }));
const call = (name: string, args: unknown[]): any => {
  const fn = functions.get(name);
  if (!fn) throw new Error(`Missing source fixture function: ${name}`);
  const data = Object.fromEntries(fn.params.map((param, i) => [param.name, args[i]]));
  return evaluate(fn.body, data, context);
};
const withSourceDispatcher = <T>(run: () => T): T => {
  registerEngineModule("engine-bodies-dispatch", {
    ...dispatchNamespace,
    dispatchEngineBody: (id: string, args: unknown[]) => call(id, args),
    dispatchedContains: (set: unknown, value: unknown) =>
      call("engine:setAlgebraContains", [setExprToTag(set, { admitValidationRigid: true }), value]),
  });
  try { return run(); }
  finally { registerEngineModule("engine-bodies-dispatch", dispatchNamespace); }
};
const whole = (source: string) => call("rxParseWhole", [tokens(source)]);
const marker = (source: string) => call("regexToPatternMarker", [tokens(source)]);
const hint = (source: string, consumed = "abc") =>
  call("regexHint", [tokens(source), tokens(consumed), consumed]);
const char = (value: string) => match({ $tag: "SeEnum", values: [value] });
const literal = (value: string) => seq(...Array.from(value, char));

describe("regex group and whole-source admission", () => {
  const refusals: Array<[string, string]> = [
    ["(abc", "Missing closing parenthesis"],
    ["^(abc$", "Missing closing parenthesis"],
    ["^((abc)$", "Missing closing parenthesis"],
    ["^(?:abc$", "Missing closing parenthesis"],
    ["^(?<word>abc$", "Missing closing parenthesis"],
    ["^a|(bc$", "Missing closing parenthesis"],
    ["^(a|b$", "Missing closing parenthesis"],
    ["^(abc", "Missing closing parenthesis"],
    ["(", "Missing closing parenthesis"],
    ["abc)", "Unexpected unconsumed token: )"],
    ["^abc)$", "Unexpected unconsumed token: )"],
    ["^(abc))$", "Unexpected unconsumed token: )"],
    ["^a|b)$", "Unexpected unconsumed token: )"],
    [")abc", "Unexpected unconsumed token: )"],
  ];
  for (const [source, reason] of refusals) {
    test(`refuses ${source} before lowering or matching`, () => {
      expect(whole(source)).toEqual({ $tag: "Err", _0: reason });
      expect(marker(source)).toEqual({ $tag: "Err", _0: reason });
      expect(hint(source)).toEqual({
        canMatch: false, canEnd: false, validNext: [],
        validNextLabel: `Invalid regex: ${reason}`, hasFailed: true,
        failPosition: 0, failGot: "", failExpected: `Invalid regex: ${reason}`,
        matchedCount: 0, segments: [], hasActiveGroup: false, activeGroup: "",
      });
      withSourceDispatcher(() => {
        expect(regexStringToPattern(source)).toBeNull();
        const refused = regexHint(source, "abc");
        expect(refused.canMatch).toBe(false);
        expect(refused.canEnd).toBe(false);
        expect(refused.matchedCount).toBe(0);
        expect(refused.failedAt).toEqual({ position: 0, got: "", expected: `Invalid regex: ${reason}` });
      });
    });
  }

  test("inner failures survive quantifier, sequence and alternation composition", () => {
    const parsed = call("rxParseAlt", [tokens("a|b(c")]);
    expect(parsed.error).toEqual({ $tag: "Just", _0: "Missing closing parenthesis" });
    expect(parsed.rest).toEqual([]);
    // An empty tail is insufficient: the missing close is explicit state.
    expect(whole("a|b(c")).toEqual({ $tag: "Err", _0: "Missing closing parenthesis" });
  });

  test("facade unavailability produces the existing failed hint shape", () => {
    registerEngineModule("engine-bodies-dispatch", {
      ...dispatchNamespace,
      dispatchEngineBody: () => { throw new Error("fixture unavailable"); },
    });
    try {
      expect(regexHint("^abc$", "abc")).toEqual({
        canMatch: false, canEnd: false, validNext: [],
        validNextLabel: "Regex hint unavailable",
        failedAt: { position: 0, got: "", expected: "Regex hint unavailable" },
        matchedCount: 0, segments: [],
      });
    } finally { registerEngineModule("engine-bodies-dispatch", dispatchNamespace); }
  });

  test("Pattern facade refuses malformed, inherited and accessor Result envelopes", () => {
    let accessed = 0;
    const accessorTag = Object.defineProperty({ _0: { tag: "RPEps" } }, "$tag", {
      get: () => { accessed += 1; return "Ok"; },
    });
    const accessorPayload = Object.defineProperty({ $tag: "Ok" }, "_0", {
      get: () => { accessed += 1; return { tag: "RPEps" }; },
    });
    const malformed = [
      null, undefined, "Ok", {},
      { $tag: "Unexpected", _0: { tag: "RPEps" } },
      { $tag: "Err", _0: "Refused by source" },
      { $tag: "Ok" },
      { $tag: "Ok", _0: { tag: "UnknownMarker" } },
      { $tag: "Ok", _0: null },
      { $tag: "Ok", _0: undefined },
      Object.create({ $tag: "Ok", _0: { tag: "RPEps" } }),
      Object.assign(Object.create({ $tag: "Ok" }), { _0: { tag: "RPEps" } }),
      Object.assign(Object.create({ _0: { tag: "RPEps" } }), { $tag: "Ok" }),
      accessorTag, accessorPayload,
    ];
    try {
      for (const result of malformed) {
        registerEngineModule("engine-bodies-dispatch", {
          ...dispatchNamespace, dispatchEngineBody: () => result,
        });
        expect(regexStringToPattern("^$"), String(result)).toBeNull();
      }
      registerEngineModule("engine-bodies-dispatch", {
        ...dispatchNamespace,
        dispatchEngineBody: () => ({ $tag: "Ok", _0: { tag: "RPEps" } }),
      });
      expect(regexStringToPattern("^$")).toEqual(eps);
      expect(accessed).toBe(0);
    } finally { registerEngineModule("engine-bodies-dispatch", dispatchNamespace); }
  });
});

describe("regex scalar ranges and end-anchor escape parity", () => {
  test("zero through four trailing backslashes preserve anchor parity and actual matching", () => {
    withSourceDispatcher(() => {
      for (let count = 0; count <= 4; count++) {
        const source = "^" + "\\".repeat(count) + "$";
        const anchored = count % 2 === 0;
        const value = "\\".repeat(Math.floor(count / 2)) + (anchored ? "" : "$");
        expect(call("rxEndAnchor", [tokens(source), tokens(source).length])).toBe(anchored);
        const pattern = regexStringToPattern(source)!;
        expect(pattern).not.toBeNull();
        expect(patternMatch(pattern, Array.from(value))).toBe(true);
        expect(patternMatch(pattern, Array.from(value + "!"))).toBe(!anchored);
        expect(hint(source, value).canEnd).toBe(true);
        expect(hint(source, value).matchedCount).toBe(Array.from(value).length);
      }
    });
  });

  test("scalar complements merge exclusions and preserve both ends of the surrogate gap", () => {
    expect(call("rxComplementRanges", [[]])).toEqual([
      { lo: 0, hi: 0xd7ff }, { lo: 0xe000, hi: 0x10ffff },
    ]);
    expect(call("rxComplementRanges", [[{ lo: 48, hi: 57 }]])).toEqual([
      { lo: 0, hi: 47 }, { lo: 58, hi: 0xd7ff }, { lo: 0xe000, hi: 0x10ffff },
    ]);
    // An exclusion crossing the gap overlaps the injected surrogate interval.
    expect(call("rxComplementRanges", [[{ lo: 0xd7ff, hi: 0xe000 }]])).toEqual([
      { lo: 0, hi: 0xd7fe }, { lo: 0xe001, hi: 0x10ffff },
    ]);
    expect(call("rxComplementRanges", [[{ lo: -10, hi: -1 }, { lo: 0x110000, hi: 0x120000 }]])).toEqual([
      { lo: 0, hi: 0xd7ff }, { lo: 0xe000, hi: 0x10ffff },
    ]);
    expect(call("rxComplementRanges", [[{ lo: -10, hi: 0x120000 }]])).toEqual([]);
    expect(call("rxRangesToMarker", [[{ lo: -10, hi: 0x120000 }]])).toEqual({
      tag: "RSUnion", parts: [
        { tag: "RSInterval", lo: 0, hi: 0xd7ff },
        { tag: "RSInterval", lo: 0xe000, hi: 0xffff },
        { tag: "RSInterval", lo: 0x10000, hi: 0x10ffff },
      ],
    });
    expect(call("rxRangesToMarker", [[{ lo: -10, hi: -1 }, { lo: 0x110000, hi: 0x120000 }]])).toEqual({ tag: "RSNone" });
  });

  test("non-digit atoms/classes and dot agree on admitted supplementary characters", () => {
    const scalars = [0xd7ff, 0xe000, 0xffff, 0x10000, 0x1f98a, 0x10ffff].map(code => String.fromCodePoint(code));
    withSourceDispatcher(() => {
      for (const source of ["^\\D$", "^[\\D]$", "^[^0-9]$", "^.$"]) {
        const pattern = regexStringToPattern(source)!;
        for (const value of scalars) {
          expect(patternMatch(pattern, Array.from(value)), `${source} ${value.codePointAt(0)!.toString(16)}`).toBe(true);
          const result = hint(source, value);
          expect(result.canMatch).toBe(true);
          expect(result.canEnd).toBe(true);
          expect(result.matchedCount).toBe(1);
        }
        expect(patternMatch(pattern, ["7"])).toBe(source === "^.$");
        expect(patternMatch(pattern, ["\n"])).toBe(source !== "^.$");
      }
    });
  });

  test("hints advertise complete scalar ranges and refuse consumed surrogate code units", () => {
    const nonDigits = [{ lo: 0, hi: 47 }, { lo: 58, hi: 0xd7ff }, { lo: 0xe000, hi: 0x10ffff }];
    for (const source of ["^\\D$", "^[\\D]$", "^[^0-9]$"]) expect(hint(source, "").validNext).toEqual(nonDigits);
    expect(hint("^.$", "").validNext).toEqual([
      { lo: 0, hi: 9 }, { lo: 11, hi: 0xd7ff }, { lo: 0xe000, hi: 0x10ffff },
    ]);
    for (const source of ["^\\D$", "^[\\D]$", "^.$"]) {
      for (const value of ["\ud800", "\udfff"]) {
        const result = hint(source, value);
        expect(result.canMatch).toBe(false);
        expect(result.canEnd).toBe(false);
        expect(result.matchedCount).toBe(0);
      }
    }
  });

  test("lowered mixed-BMP ranges retain actual numeric character ordering", () => {
    const source = `^[${String.fromCodePoint(0xd7ff)}-${String.fromCodePoint(0x10ffff)}]$`;
    const initial = hint(source, "");
    expect(initial.validNext).toEqual([{ lo: 0xd7ff, hi: 0xd7ff }, { lo: 0xe000, hi: 0x10ffff }]);
    withSourceDispatcher(() => {
      const pattern = regexStringToPattern(source)!;
      for (const code of [0xd7ff, 0xe000, 0xffff, 0x10000, 0x1f98a, 0x10ffff]) {
        expect(patternMatch(pattern, [String.fromCodePoint(code)])).toBe(true);
      }
      for (const code of [0xd7fe, 0xd800, 0xdfff]) {
        expect(patternMatch(pattern, [String.fromCodePoint(code)])).toBe(false);
      }
      const emojiRange = regexStringToPattern("^[😀-🙏]+$")!;
      expect(patternMatch(emojiRange, ["😀", "🙏"])).toBe(true);
      expect(patternMatch(emojiRange, ["🦊"])).toBe(false);
    });
  });
});

describe("retained regex fragment and facade behavior", () => {
  const cases: Array<[string, ReturnType<typeof seq>]> = [
    ["^abc$", literal("abc")],
    ["^(abc)$", literal("abc")],
    ["^((abc))$", literal("abc")],
    ["^(?<word>abc)$", literal("abc")],
    ["^(?:ab|cd)e$", seq(alt(literal("ab"), literal("cd")), char("e"))],
    ["^\\(abc\\)$", literal("(abc)")],
    ["^a+?$", rep(char("a"), 1)],
    ["^a{2,4}$", rep(char("a"), 2, 4)],
    ["^a{2,}$", rep(char("a"), 2)],
    ["^a?$", rep(char("a"), 0, 1)],
    ["^a||b$", alt(alt(char("a"), eps), char("b"))],
    ["^$", eps],
    ["^()$", eps],
    // Preserve inherited meanings outside the repaired admission boundary.
    ["^(?=abc)$", literal("?=abc")],
    ["^\\babc$", literal("babc")],
    ["^a{2$", rep(char("a"), 2, 2)],
    ["^a**$", seq(rep(char("a")), char("*"))],
  ];
  for (const [source, expected] of cases) {
    test(`retains ${source}`, () => {
      expect(whole(source).$tag).toBe("Ok");
      expect(marker(source).$tag).toBe("Ok");
      withSourceDispatcher(() => expect(regexStringToPattern(source)).toEqual(expected));
    });
  }

  test("parentheses in classes are data and existing class-close tolerance is retained", () => {
    for (const source of ["^[()]$", "^[abc$", "^[^()]$", "^[a-z]+$", "^\\d\\w\\s$", "^\\D\\W\\S$"]) {
      expect(whole(source).$tag).toBe("Ok");
      withSourceDispatcher(() => expect(regexStringToPattern(source)).not.toBeNull());
    }
    withSourceDispatcher(() => expect(patternToRegex(regexStringToPattern("^[()]$")!)).toBe("^[(-)]$"));
  });

  test("unanchored normalization and round-trip serialization remain available", () => {
    const dot = match({ $tag: "SeDiff", left: { $tag: "SeAll" }, right: { $tag: "SeEnum", values: ["\n"] } });
    withSourceDispatcher(() => {
      expect(regexStringToPattern("abc")).toEqual(seq(rep(dot), char("a"), char("b"), char("c"), rep(dot)));
      for (const source of ["^[a-z]+$", "^[0-9]{3}$", "^[a-z]{2,4}$", "^abc$", "^a|b$"]) {
        expect(patternToRegex(regexStringToPattern(source)!)).toBe(source);
      }
    });
  });

  test("valid cursor matching and named group segments retain their meanings", () => {
    withSourceDispatcher(() => {
      const matched = regexHint("^[a-z]+$", "ab");
      expect(matched.canMatch).toBe(true);
      expect(matched.canEnd).toBe(true);
      expect(matched.matchedCount).toBe(2);
      expect(matched.validNext).toEqual([{ lo: 97, hi: 122 }]);
      expect(matched.validNextLabel).toBe("lowercase letter (a-z)");
      expect(matched.failedAt).toBeUndefined();
      const failed = regexHint("^[a-z]+$", "a1");
      expect(failed.canMatch).toBe(false);
      expect(failed.failedAt).toEqual({ position: 1, got: "1", expected: "lowercase letter (a-z)" });
      const named = regexHint("^(?<word>abc)$", "abc");
      expect(named.matchedCount).toBe(3);
      expect(named.segments).toEqual([{ name: "word", start: 0, end: 3, depth: 0 }]);
      expect(named.activeGroup).toBe("word");
    });
  });
});
