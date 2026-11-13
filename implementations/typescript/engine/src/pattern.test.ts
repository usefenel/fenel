import { describe, it, expect } from "vitest";
import { peelList } from "./set-algebra";
import { peelListForAuthoring } from "./authoring/type-authoring";
import {
  match,
  seq,
  alt,
  rep,
  star,
  plus,
  optional,
  group,
  eps,
  empty,
  nullable,
  deriv,
  patternMatch,
  patternSubset,
  longestMatch,
  firstSet,
  forcedNextLiteral,
  forcedPrefix,
  decomposeFlatPattern,
  patternToType,
  parse,
} from "./pattern";
import { regexStringToPattern } from "./regex-shim";
import type { SetExpr } from "./types";
import { Just, Nothing } from "./type-foundation";

// ---------------------------------------------------------------------------
// Smart constructors and nullability
// ---------------------------------------------------------------------------

describe("pattern smart constructors", () => {
  it("seq() collapses eps and empty", () => {
    expect(seq()).toEqual(eps);
    expect(seq(eps, eps)).toEqual(eps);
    expect(seq(empty, match({ $tag: "SeAll" }))).toEqual(empty);
    expect(seq(match({ $tag: "SeAll" }), empty)).toEqual(empty);
  });

  it("alt() collapses correctly", () => {
    expect(alt()).toEqual(empty);
    expect(alt(empty, eps)).toEqual(eps);
    expect(alt(eps, eps)).toEqual(eps);
  });

  it("rep with empty child stays empty if min > 0", () => {
    expect(rep(empty, 0)).toEqual(eps);
    expect(rep(empty, 1)).toEqual(empty);
  });
});

describe("nullable", () => {
  const m = match({ $tag: "SeAll" });
  it("eps is nullable", () => expect(nullable(eps)).toBe(true));
  it("empty is not nullable", () => expect(nullable(empty)).toBe(false));
  it("match is not nullable", () => expect(nullable(m)).toBe(false));
  it("seq is nullable iff both parts are", () => {
    expect(nullable(seq(eps, eps))).toBe(true);
    expect(nullable(seq(m, eps))).toBe(false);
  });
  it("alt is nullable iff either part is", () => {
    expect(nullable(alt(eps, m))).toBe(true);
    expect(nullable(alt(m, m))).toBe(false);
  });
  it("star (rep min=0) is nullable", () => {
    expect(nullable(star(m))).toBe(true);
  });
  it("plus (rep min=1) is not nullable for non-nullable child", () => {
    expect(nullable(plus(m))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pattern matching on List<Number>
// ---------------------------------------------------------------------------

describe("patternMatch — List<Number>", () => {
  const num = match({ $tag: "SeAll" });
  const positive: SetExpr = { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: false }), hi: Nothing } };
  const small: SetExpr = { $tag: "SeInterval", interval: {
      lo: Just({ value: 0, inclusive: true }),
      hi: Just({ value: 10, inclusive: true }),
    } };

  it("empty pattern matches empty sequence", () => {
    expect(patternMatch(eps, [])).toBe(true);
  });

  it("single-element match", () => {
    expect(patternMatch(num, [42])).toBe(true);
    expect(patternMatch(num, [])).toBe(false);
    expect(patternMatch(num, [1, 2])).toBe(false);
  });

  it("predicate filters: positive", () => {
    expect(patternMatch(match(positive), [5])).toBe(true);
    expect(patternMatch(match(positive), [-3])).toBe(false);
    expect(patternMatch(match(positive), [0])).toBe(false);
  });

  it("seq: positive then small", () => {
    const p = seq(match(positive), match(small));
    expect(patternMatch(p, [100, 5])).toBe(true);
    expect(patternMatch(p, [5, 100])).toBe(false);
    expect(patternMatch(p, [-1, 5])).toBe(false);
  });

  it("star: any number of positives", () => {
    const p = star(match(positive));
    expect(patternMatch(p, [])).toBe(true);
    expect(patternMatch(p, [1])).toBe(true);
    expect(patternMatch(p, [1, 2, 3])).toBe(true);
    expect(patternMatch(p, [1, -2, 3])).toBe(false);
  });

  it("plus: one or more positives", () => {
    const p = plus(match(positive));
    expect(patternMatch(p, [])).toBe(false);
    expect(patternMatch(p, [1])).toBe(true);
    expect(patternMatch(p, [1, 2, 3])).toBe(true);
  });

  it("rep with explicit bounds", () => {
    const p = rep(match(positive), 2, 4);
    expect(patternMatch(p, [1])).toBe(false);
    expect(patternMatch(p, [1, 2])).toBe(true);
    expect(patternMatch(p, [1, 2, 3, 4])).toBe(true);
    expect(patternMatch(p, [1, 2, 3, 4, 5])).toBe(false);
  });

  it("alt: positive OR small", () => {
    const p = alt(match(positive), match(small));
    expect(patternMatch(p, [-3])).toBe(false); // negative > 10 not in small
    expect(patternMatch(p, [5])).toBe(true);   // both
    expect(patternMatch(p, [100])).toBe(true); // positive
    expect(patternMatch(p, [0])).toBe(true);   // small
  });
});

// ---------------------------------------------------------------------------
// Pattern matching on List<Event> — the funnel use case
// ---------------------------------------------------------------------------

describe("patternMatch — List<Event> (funnel patterns)", () => {
  type Event = { type: string; [k: string]: unknown };

  const ofType = (t: string): SetExpr => ({ $tag: "SeWhere", pred: { "==": [{ var: "type" }, t] } });

  const anyEvent: SetExpr = { $tag: "SeAll" };

  it("simple sequence: page_view then purchase", () => {
    const funnel = seq(match(ofType("page_view")), match(ofType("purchase")));
    expect(patternMatch(funnel, [
      { type: "page_view" },
      { type: "purchase" },
    ])).toBe(true);
    expect(patternMatch(funnel, [
      { type: "purchase" },
      { type: "page_view" },
    ])).toBe(false);
  });

  it("with arbitrary events between: page_view → ... → purchase", () => {
    const funnel = seq(
      match(ofType("page_view")),
      star(match(anyEvent)),
      match(ofType("purchase")),
    );
    expect(patternMatch(funnel, [
      { type: "page_view" },
      { type: "click" },
      { type: "scroll" },
      { type: "purchase" },
    ])).toBe(true);

    expect(patternMatch(funnel, [
      { type: "page_view" },
      { type: "purchase" },
    ])).toBe(true); // zero events between is fine

    expect(patternMatch(funnel, [
      { type: "click" },
      { type: "purchase" },
    ])).toBe(false); // missing initial page_view
  });

  it("alternation: video OR demo before purchase", () => {
    const funnel = seq(
      match(ofType("page_view")),
      alt(match(ofType("video_watched")), match(ofType("demo_clicked"))),
      match(ofType("purchase")),
    );
    expect(patternMatch(funnel, [
      { type: "page_view" },
      { type: "video_watched" },
      { type: "purchase" },
    ])).toBe(true);
    expect(patternMatch(funnel, [
      { type: "page_view" },
      { type: "demo_clicked" },
      { type: "purchase" },
    ])).toBe(true);
    expect(patternMatch(funnel, [
      { type: "page_view" },
      { type: "purchase" },
    ])).toBe(false); // missed both engagement steps
  });

  it("constraint on event payload via $where", () => {
    const expensivePurchase: SetExpr = { $tag: "SeIntersect", branches: [
        { $tag: "SeWhere", pred: { "==": [{ var: "type" }, "purchase"] } },
        { $tag: "SeWhere", pred: { ">=": [{ var: "amount" }, 100] } },
      ] };
    const funnel = seq(match(ofType("page_view")), match(expensivePurchase));
    expect(patternMatch(funnel, [
      { type: "page_view" },
      { type: "purchase", amount: 250 },
    ])).toBe(true);
    expect(patternMatch(funnel, [
      { type: "page_view" },
      { type: "purchase", amount: 50 },
    ])).toBe(false);
  });

  it("at least 3 page_views before purchase", () => {
    const funnel = seq(
      rep(match(ofType("page_view")), 3, Infinity),
      match(ofType("purchase")),
    );
    const events: Event[] = [
      { type: "page_view" },
      { type: "page_view" },
      { type: "page_view" },
      { type: "purchase" },
    ];
    expect(patternMatch(funnel, events)).toBe(true);
    expect(patternMatch(funnel, [
      { type: "page_view" },
      { type: "page_view" },
      { type: "purchase" },
    ])).toBe(false); // only 2 page views
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// patternSubset — language inclusion via atom enumeration
// ---------------------------------------------------------------------------

describe("patternSubset — generic pattern language inclusion", () => {
  const num = match({ $tag: "SeAll" });
  const positive: SetExpr = { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: false }), hi: Nothing } };
  const small: SetExpr = { $tag: "SeInterval", interval: {
      lo: Just({ value: 0, inclusive: true }),
      hi: Just({ value: 10, inclusive: true }),
    } };

  it("identity: any pattern is a subset of itself", () => {
    const p = seq(match(positive), star(match(small)));
    expect(patternSubset(p, p)).toBe(true);
  });

  it("eps ⊆ star(p) — empty matches zero-or-more", () => {
    expect(patternSubset(eps, star(num))).toBe(true);
  });

  it("plus(p) ⊆ star(p) — one-or-more is subset of zero-or-more", () => {
    expect(patternSubset(plus(num), star(num))).toBe(true);
  });

  it("star(p) ⊄ plus(p) — zero-or-more is not subset of one-or-more (eps issue)", () => {
    expect(patternSubset(star(num), plus(num))).toBe(false);
  });

  it("rep(p, 3) ⊆ rep(p, 2, ∞)", () => {
    expect(patternSubset(rep(num, 3, 3), rep(num, 2, Infinity))).toBe(true);
  });

  it("rep(p, 1, ∞) ⊄ rep(p, 2, 4)", () => {
    expect(patternSubset(rep(num, 1, Infinity), rep(num, 2, 4))).toBe(false);
  });

  it("seq with stricter element predicate ⊆ seq with looser", () => {
    // A truly tighter range: [1, 10] ⊂ (0, ∞)
    const tightRange: SetExpr = { $tag: "SeInterval", interval: {
        lo: Just({ value: 1, inclusive: true }),
        hi: Just({ value: 10, inclusive: true }),
      } };
    const a = seq(match(tightRange), match(tightRange));
    const b = seq(match(positive), match(positive));
    expect(patternSubset(a, b)).toBe(true);
    expect(patternSubset(b, a)).toBe(false);
  });

  it("alt(a, b) ⊆ alt(a, b, c) — adding more alternatives broadens", () => {
    const a = match({ $tag: "SeEnum", values: ["x"] });
    const b = match({ $tag: "SeEnum", values: ["y"] });
    const c = match({ $tag: "SeEnum", values: ["z"] });
    expect(patternSubset(alt(a, b), alt(a, b, c))).toBe(true);
    expect(patternSubset(alt(a, b, c), alt(a, b))).toBe(false);
  });

  it("more specific event pattern ⊆ less specific", () => {
    const ofType = (t: string): SetExpr => ({ $tag: "SeWhere", pred: { "==": [{ var: "type" }, t] } });
    const specific = seq(match(ofType("page_view")), match(ofType("purchase")));
    const general = seq(match({ $tag: "SeAll" }), match({ $tag: "SeAll" }));
    expect(patternSubset(specific, general)).toBe(true);
    expect(patternSubset(general, specific)).toBe(false);
  });

  it("funnel: page_view → purchase ⊆ page_view → any* → purchase", () => {
    const ofType = (t: string): SetExpr => ({ $tag: "SeWhere", pred: { "==": [{ var: "type" }, t] } });
    const tight = seq(match(ofType("page_view")), match(ofType("purchase")));
    const loose = seq(
      match(ofType("page_view")),
      star(match({ $tag: "SeAll" })),
      match(ofType("purchase")),
    );
    expect(patternSubset(tight, loose)).toBe(true);
  });

  it("disjoint single elements are not subtypes", () => {
    const a = match({ $tag: "SeEnum", values: ["x"] });
    const b = match({ $tag: "SeEnum", values: ["y"] });
    expect(patternSubset(a, b)).toBe(false);
    expect(patternSubset(b, a)).toBe(false);
  });

  it("optional element ⊆ star (0..1 ⊆ 0..∞)", () => {
    expect(patternSubset(optional(num), star(num))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// regex → Pattern conversion (regex as a front-end to the generic engine)
// ---------------------------------------------------------------------------

describe("regexStringToPattern", () => {
  it("anchored exact match", () => {
    const p = regexStringToPattern("^abc$");
    expect(p).not.toBeNull();
    expect(patternMatch(p!, [..."abc"])).toBe(true);
    expect(patternMatch(p!, [..."ab"])).toBe(false);
    expect(patternMatch(p!, [..."abcd"])).toBe(false);
  });

  it("character class", () => {
    const p = regexStringToPattern("^[a-z]+$");
    expect(p).not.toBeNull();
    expect(patternMatch(p!, [..."hello"])).toBe(true);
    expect(patternMatch(p!, [..."Hello"])).toBe(false);
    expect(patternMatch(p!, [..."abc123"])).toBe(false);
    expect(patternMatch(p!, [...""])).toBe(false); // + requires ≥1
  });

  it("alternation", () => {
    const p = regexStringToPattern("^(foo|bar)$");
    expect(p).not.toBeNull();
    expect(patternMatch(p!, [..."foo"])).toBe(true);
    expect(patternMatch(p!, [..."bar"])).toBe(true);
    expect(patternMatch(p!, [..."baz"])).toBe(false);
  });

  it("quantifiers: a{2,4}", () => {
    const p = regexStringToPattern("^a{2,4}$");
    expect(p).not.toBeNull();
    expect(patternMatch(p!, [..."a"])).toBe(false);
    expect(patternMatch(p!, [..."aa"])).toBe(true);
    expect(patternMatch(p!, [..."aaaa"])).toBe(true);
    expect(patternMatch(p!, [..."aaaaa"])).toBe(false);
  });

  it("digit class \\d+", () => {
    const p = regexStringToPattern("^\\d+$");
    expect(p).not.toBeNull();
    expect(patternMatch(p!, [..."123"])).toBe(true);
    expect(patternMatch(p!, [..."abc"])).toBe(false);
  });

  it("negated class [^a-c]", () => {
    const p = regexStringToPattern("^[^a-c]$");
    expect(p).not.toBeNull();
    expect(patternMatch(p!, [..."d"])).toBe(true);
    expect(patternMatch(p!, [..."a"])).toBe(false);
    expect(patternMatch(p!, [..."b"])).toBe(false);
  });

  it("dot matches anything except newline", () => {
    const p = regexStringToPattern("^.$");
    expect(p).not.toBeNull();
    expect(patternMatch(p!, [..."x"])).toBe(true);
    expect(patternMatch(p!, [..."\n"])).toBe(false);
  });

  it("unanchored: contains-substring semantics", () => {
    const p = regexStringToPattern("foo");
    expect(p).not.toBeNull();
    expect(patternMatch(p!, [..."xfooy"])).toBe(true);
    expect(patternMatch(p!, [..."nope"])).toBe(false);
  });

  it("non-capturing group (?:abc)", () => {
    const p = regexStringToPattern("^(?:ab|cd)e$");
    expect(p).not.toBeNull();
    expect(patternMatch(p!, [..."abe"])).toBe(true);
    expect(patternMatch(p!, [..."cde"])).toBe(true);
    expect(patternMatch(p!, [..."ade"])).toBe(false);
  });
});

describe("optional, longestMatch", () => {
  const num = match({ $tag: "SeAll" });

  it("optional accepts both empty and one", () => {
    const p = optional(num);
    expect(patternMatch(p, [])).toBe(true);
    expect(patternMatch(p, [1])).toBe(true);
    expect(patternMatch(p, [1, 2])).toBe(false);
  });

  it("longestMatch returns longest accepted prefix", () => {
    const p = star(match({ $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: false }), hi: Nothing } }));
    expect(longestMatch(p, [1, 2, 3, -1, 5])).toBe(3);
    expect(longestMatch(p, [-1, 5])).toBe(0);
    expect(longestMatch(p, [1, 2, 3])).toBe(3);
    expect(longestMatch(p, [])).toBe(0);
  });

  it("nullable patterns return 0 on empty input via longestMatch", () => {
    expect(longestMatch(eps, [])).toBe(0);
    expect(longestMatch(star(match({ $tag: "SeAll" })), [])).toBe(0);
  });
});

describe("firstSet, forcedNextLiteral, forcedPrefix — input-mask primitives", () => {
  const lit = (c: string) => match({ $tag: "SeEnum", values: [c] });
  const digit = match({ $tag: "SeInterval", interval: {
      lo: Just({ value: "0", inclusive: true }),
      hi: Just({ value: "9", inclusive: true }),
    } });

  it("firstSet of a single match returns its predicate", () => {
    const fs = firstSet(lit("a"));
    expect(fs).toHaveLength(1);
    expect(fs[0]).toEqual({ $tag: "SeEnum", values: ["a"] });
  });

  it("firstSet of seq(a, b) is just a's first set when a is non-nullable", () => {
    const fs = firstSet(seq(lit("a"), lit("b")));
    expect(fs).toHaveLength(1);
    expect(fs[0]).toEqual({ $tag: "SeEnum", values: ["a"] });
  });

  it("firstSet of seq(a?, b) merges when a is nullable", () => {
    const fs = firstSet(seq(optional(lit("a")), lit("b")));
    expect(fs).toHaveLength(2);
  });

  it("firstSet sees through groups", () => {
    const fs = firstSet(group("scheme", lit("h")));
    expect(fs).toHaveLength(1);
    expect(fs[0]).toEqual({ $tag: "SeEnum", values: ["h"] });
  });

  it("forcedNextLiteral returns the unique forced char", () => {
    expect(forcedNextLiteral(lit("/"))).toBe("/");
    expect(forcedNextLiteral(seq(lit("/"), digit))).toBe("/");
    for (const value of ["🧭", "𐐀"]) {
      expect(forcedNextLiteral(lit(value))).toBe(value);
      expect(forcedNextLiteral(match({ $enum: [value] } as unknown as Parameters<typeof match>[0]))).toBe(value);
    }
  });

  it("forced literal selection refuses non-String and non-singleton enum values", () => {
    for (const values of [[], [1], [["/"]], [""], ["a", "b"], ["e\u0301"], ["🧭🧭"]]) {
      expect(forcedNextLiteral(match({ $tag: "SeEnum", values }))).toBeNull();
      expect(forcedNextLiteral(match({ $enum: values } as unknown as Parameters<typeof match>[0]))).toBeNull();
    }
    for (const pred of [
      { $tag: "SeEnum", values: "/" }, { $enum: "/" },
      { $tag: "Unknown", $enum: ["/"] }, { $tag: "SeEnum", values: Array(1) },
    ]) expect(forcedNextLiteral(match(pred as unknown as SetExpr))).toBeNull();
  });

  it("nullable continuations force no character and repetitions stop at their minimum", () => {
    for (const pattern of [eps, optional(lit("/")), star(lit("/")), alt(eps, lit("/")), rep(lit("/"), 0, 4)]) {
      expect(nullable(pattern)).toBe(true);
      expect(forcedNextLiteral(pattern)).toBeNull();
      expect(forcedPrefix(pattern)).toBe("");
    }
    expect(forcedPrefix(plus(lit("/")))).toBe("/");
    expect(forcedPrefix(rep(lit("/"), 2, 4))).toBe("//");
    expect(forcedPrefix(rep(lit("🧭"), 2, 4))).toBe("🧭🧭");
  });

  it("refuses multiple and nullable choices before observing predicate descriptors", () => {
    let hiddenReads = 0;
    const hidden = { $enum: ["/"] };
    Object.defineProperty(hidden, "$tag", { enumerable: false, get() { hiddenReads++; throw new Error("hidden tag getter"); } });
    expect(forcedNextLiteral(alt(match(hidden as unknown as SetExpr), lit("X")))).toBeNull();
    expect(forcedNextLiteral(optional(match(hidden as unknown as SetExpr)))).toBeNull();
    expect(hiddenReads).toBe(0);
    let descriptorReads = 0;
    const sentinel = new Error("canonical descriptor observation");
    const proxy = new Proxy({ $enum: ["/"] }, { getOwnPropertyDescriptor(target, key) {
      if (key === "$tag") { descriptorReads++; throw sentinel; }
      return Reflect.getOwnPropertyDescriptor(target, key);
    } });
    expect(forcedNextLiteral(alt(match(proxy as unknown as SetExpr), lit("X")))).toBeNull();
    expect(forcedNextLiteral(optional(match(proxy as unknown as SetExpr)))).toBeNull();
    expect(descriptorReads).toBe(0);
    let thrown: unknown;
    try { forcedNextLiteral(match(proxy as unknown as SetExpr)); } catch (error) { thrown = error; }
    expect(thrown).toBe(sentinel);
    expect(descriptorReads).toBe(1);
  });

  it("forcedNextLiteral returns null when multiple chars are legal", () => {
    expect(forcedNextLiteral(digit)).toBeNull();
    expect(forcedNextLiteral(alt(lit("a"), lit("b")))).toBeNull();
  });

  it("forcedPrefix consumes a chain of forced literals", () => {
    // After a scheme like "https", the residual forces "://"
    const p = seq(lit(":"), lit("/"), lit("/"), digit);
    expect(forcedPrefix(p)).toBe("://");
  });

  it("forcedPrefix on a date residual injects the separator", () => {
    // Simulate state after consuming "12" of dd/MM/yyyy
    const slash = lit("/");
    const monthThenSlash = seq(slash, repN2(digit, 2));
    expect(forcedPrefix(monthThenSlash)).toBe("/");
  });

  it("forcedPrefix returns empty when next char is open", () => {
    expect(forcedPrefix(digit)).toBe("");
    expect(forcedPrefix(eps)).toBe("");
  });

  it("end-to-end: derivative-driven masking on a tiny dd/MM pattern", () => {
    const dd = repN2(digit, 2);
    const MM = repN2(digit, 2);
    const date = seq(dd, lit("/"), MM);

    // Walk the user typing "1212"
    let cur = date;
    let out = "";
    for (const c of "1212") {
      cur = deriv(cur, c);
      expect(cur.t).not.toBe("empty");
      out += c;
      const forced = forcedPrefix(cur);
      out += forced;
      // advance pattern past the auto-inserted chars
      for (const f of forced) cur = deriv(cur, f);
    }
    expect(out).toBe("12/12");
  });

  it("the existing derivative mask consumes whole supplementary forced separators", () => {
    let cur = seq(repN2(digit, 2), lit("🧭"), repN2(digit, 2));
    let out = "";
    for (const character of "1212") {
      cur = deriv(cur, character);
      expect(cur.t).not.toBe("empty");
      out += character;
      const forced = forcedPrefix(cur);
      out += forced;
      for (const token of forced) cur = deriv(cur, token);
    }
    expect(out).toBe("12🧭12");
    expect(nullable(cur)).toBe(true);
  });
});

function repN2(p: ReturnType<typeof match>, n: number) {
  return rep(p, n, n);
}

describe("decomposeFlatPattern — segmented-input primitive", () => {
  const lit = (c: string) => match({ $tag: "SeEnum", values: [c] });
  const digit = match({ $tag: "SeInterval", interval: {
      lo: Just({ value: "0", inclusive: true }),
      hi: Just({ value: "9", inclusive: true }),
    } });

  it("decomposes a date pattern into 5 alternating segments", () => {
    const dd = group("day", repN2(digit, 2));
    const MM = group("month", repN2(digit, 2));
    const yyyy = group("year", repN2(digit, 4));
    const date = seq(dd, lit("/"), MM, lit("/"), yyyy);

    const segs = decomposeFlatPattern(date);
    expect(segs).not.toBeNull();
    expect(segs!).toHaveLength(5);
    expect(segs![0]).toMatchObject({ kind: "group", name: "day",   optional: false });
    expect(segs![1]).toEqual({ kind: "literal", text: "/", optional: false });
    expect(segs![2]).toMatchObject({ kind: "group", name: "month", optional: false });
    expect(segs![3]).toEqual({ kind: "literal", text: "/", optional: false });
    expect(segs![4]).toMatchObject({ kind: "group", name: "year",  optional: false });
  });

  it("flags optional groups via the optional() wrapper", () => {
    const zip5 = group("zip5", repN2(digit, 5));
    const zip4 = group("zip4", repN2(digit, 4));
    const us = seq(zip5, optional(seq(lit("-"), zip4)));

    const segs = decomposeFlatPattern(us);
    expect(segs).not.toBeNull();
    expect(segs!).toHaveLength(3);
    expect(segs![0]).toMatchObject({ kind: "group", name: "zip5", optional: false });
    // The "-" literal inside the optional(...) inherits optional too, so a
    // segmented widget can hide the separator when the trailing group is empty.
    expect(segs![1]).toEqual({ kind: "literal", text: "-", optional: true });
    expect(segs![2]).toMatchObject({ kind: "group", name: "zip4", optional: true });
  });

  it("returns null when the top-level structure has alt", () => {
    const p = alt(lit("a"), lit("b"));
    expect(decomposeFlatPattern(p)).toBeNull();
  });

  it("returns null on rep(child) with bounds beyond optional", () => {
    const p = rep(group("kv", lit("a")), 0, Infinity);
    expect(decomposeFlatPattern(p)).toBeNull();
  });

  it("merges adjacent literals into a single literal segment", () => {
    const p = seq(lit(":"), lit("/"), lit("/"), group("host", plus(match({ $tag: "SeAll" }))));
    const segs = decomposeFlatPattern(p);
    expect(segs).not.toBeNull();
    expect(segs!).toHaveLength(2);
    expect(segs![0]).toEqual({ kind: "literal", text: "://", optional: false });
    expect(segs![1]).toMatchObject({ kind: "group", name: "host" });
  });
});

describe("patternToType — Pattern → FenelType lowering", () => {
  const lit = (c: string) => match({ $tag: "SeEnum", values: [c] });
  const digit = match({ $tag: "SeInterval", interval: {
      lo: Just({ value: "0", inclusive: true }),
      hi: Just({ value: "9", inclusive: true }),
    } });

  it("a pattern with no groups lowers to a refined String", () => {
    const p = repN2(digit, 3);
    const t = patternToType(p);
    // 3b-2 — the `$refined.set` SetExpr producer flipped to the `$tag` form.
    expect(t).toEqual({
      $refined: { base: { $ref: "String" }, set: { $tag: "SePattern", pattern: p } },
    });
  });

  it("a flat seq of named groups lowers to a $record with those fields", () => {
    const p = seq(
      group("day",   repN2(digit, 2)), lit("/"),
      group("month", repN2(digit, 2)), lit("/"),
      group("year",  repN2(digit, 4)),
    );
    const t = patternToType(p);
    expect(t).toMatchObject({
      $record: {
        fields: [
          { name: "day" }, { name: "month" }, { name: "year" },
        ],
      },
    });
    // Each field is a refined String of its sub-pattern
    expect((t as any).$record.fields[0].type).toMatchObject({
      $refined: { base: { $ref: "String" } },
    });
  });

  it("groups inside a real rep wrap their type in a List", () => {
    const p = group("query", rep(group("kv", seq(
      group("key",   plus(digit)),
      lit("="),
      group("value", plus(digit)),
    )), 0, Infinity));
    const t = patternToType(p);
    // Top: record with field "query"
    expect(t).toMatchObject({ $record: { fields: [{ name: "query" }] } });
    // query field is a record with field "kv"
    const queryType = (t as any).$record.fields[0].type;
    expect(queryType).toMatchObject({ $record: { fields: [{ name: "kv" }] } });
    // The repeated group is a declared List, with unkeyed nested records.
    const kvType = (queryType as any).$record.fields[0].type;
    expect(() => peelList(kvType)).toThrow(/field-identity semantic boundary/);
    expect(peelListForAuthoring(kvType)).not.toBeNull();
  });

  it("optional() does NOT list-wrap (rep 0..1 is scalar)", () => {
    const p = optional(group("x", repN2(digit, 2)));
    const t = patternToType(p);
    // Top: record with field "x"
    expect(t).toMatchObject({ $record: { fields: [{ name: "x" }] } });
    const xType = (t as any).$record.fields[0].type;
    // x is a refined String, NOT a list
    expect(xType).toMatchObject({ $refined: { base: { $ref: "String" } } });
    expect(peelList(xType)).toBeNull();
  });

  it("group with explicit type refines the field type", () => {
    const p = group("port", plus(digit), { $tag: "SeRef", handle: "format:port" });
    const t = patternToType(p);
    expect(t).toMatchObject({
      $record: {
        fields: [{
          name: "port",
          label: Nothing,
          type: {
            $refined: {
              base: { $refined: { base: { $ref: "String" } } },
              set: { $tag: "SeRef", handle: "format:port" },
            },
          },
          ui: Nothing,
        }],
      },
    });
  });
});

describe("parse — typed structural parse", () => {
  const lit = (c: string) => match({ $tag: "SeEnum", values: [c] });
  const digit = match({ $tag: "SeInterval", interval: {
      lo: Just({ value: "0", inclusive: true }),
      hi: Just({ value: "9", inclusive: true }),
    } });

  it("parses a date pattern into {day, month, year}", () => {
    const p = seq(
      group("day",   repN2(digit, 2)), lit("/"),
      group("month", repN2(digit, 2)), lit("/"),
      group("year",  repN2(digit, 4)),
    );
    expect(parse(p, "25/12/2025")).toEqual({
      day: "25", month: "12", year: "2025",
    });
  });

  it("returns null when the string doesn't match", () => {
    const p = seq(group("a", repN2(digit, 2)), lit("/"), group("b", repN2(digit, 2)));
    expect(parse(p, "1/12")).toBeNull();
    expect(parse(p, "1234")).toBeNull();
  });

  it("returns the raw string when there are no groups", () => {
    const p = repN2(digit, 3);
    expect(parse(p, "123")).toBe("123");
  });

  it("nests records when groups contain groups", () => {
    const inner = seq(group("k", plus(digit)), lit("="), group("v", plus(digit)));
    const p = group("kv", inner);
    expect(parse(p, "1=2")).toEqual({
      kv: { k: "1", v: "2" },
    });
  });

  it("handles optional groups: scalar present = string, absent = empty string", () => {
    const p = seq(
      group("zip5", repN2(digit, 5)),
      optional(seq(lit("-"), group("zip4", repN2(digit, 4)))),
    );
    expect(parse(p, "90210")).toEqual({ zip5: "90210", zip4: "" });
    expect(parse(p, "90210-1234")).toEqual({ zip5: "90210", zip4: "1234" });
  });

  it("repeating groups (the URL kv case) emit a list of records", () => {
    const kvGroup = group("kv", seq(
      group("k", plus(match({ $tag: "SeInterval", interval: { lo: Just({ value: "a", inclusive: true }), hi: Just({ value: "z", inclusive: true }) } }))),
      lit("="),
      group("v", plus(digit)),
    ));
    const p = group("query", optional(seq(lit("?"), optional(seq(
      kvGroup, star(seq(lit("&"), kvGroup)),
    )))));
    expect(parse(p, "?a=1&b=2&c=3")).toEqual({
      query: {
        kv: [
          { k: "a", v: "1" },
          { k: "b", v: "2" },
          { k: "c", v: "3" },
        ],
      },
    });
    // Empty query: kv is an empty list, not absent. Matches `patternToType`'s
    // $list shape so consumers don't need to special-case absence.
    expect(parse(p, "")).toEqual({ query: { kv: [] } });
    // Single kv pair: still a list, just one element.
    expect(parse(p, "?x=42")).toEqual({ query: { kv: [{ k: "x", v: "42" }] } });
  });
});
