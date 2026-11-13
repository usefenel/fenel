import { describe, it, expect } from "vitest";
import { contains as containsTri, containsB } from "./set-algebra";
import { match, seq, group, plus, alt } from "./pattern";
import "./char-classes";
import "./format-presets";
import { Just } from "./type-foundation";
const charClass = (cs: string) => match({ $tag: "SeEnum", values: [...cs] });

// ---------------------------------------------------------------------------
// Typed group basics — group captures the substring it consumes; if a
// `type` SetExpr is attached, the captured value must also satisfy it.
//
// decide-substrate Phase 4T Step W2 / Fable audit 2026-07-31 — TYPED groups
// are FENCED on the membership face: `dispatchedPatternMemberTri` abstains
// (BOTH polarities) whenever any group carries a type, because
// `activeGroups` attributes captures greedily rather than along the
// accepting path, so a typed group can be checked against the WRONG
// substring — answering would risk a false `Just` the kernel re-checks.
// The Tri face answers `Nothing`; `containsB` collapses that to `false`.
//
// This file therefore pins the FENCE, not the feature. The pre-W2
// expectations are preserved in comments as the specification for the
// `mem.pattern.tri` arc (Tri derivatives + accepting-path capture
// attribution + ctx/evalCtx threading in pattern.ts — see
// design/tcb-ledger.md), which is what un-fences these.
// ---------------------------------------------------------------------------

const nothing = (set: Parameters<typeof containsTri>[0], v: string) => {
  const r = containsTri(set, v, null);
  expect(r.$tag).toBe("Nothing");
  expect(containsB(set, v, null)).toBe(false); // the boolean collapse of the fence
};

describe("typed groups — basic capture without type", () => {
  it("a pattern with a name-only group still matches the same language", () => {
    // (?<word>[a-z]+) — NO type on the group, char-total preds: inside the
    // decidable fragment, so the membership face still answers definitely.
    const pat = group("word", plus(charClass("abcdefghijklmnopqrstuvwxyz")));
    expect(containsB({ $tag: "SePattern", pattern: pat }, "hello", null)).toBe(true);
    expect(containsB({ $tag: "SePattern", pattern: pat }, "Hello", null)).toBe(false);
    expect(containsB({ $tag: "SePattern", pattern: pat }, "", null)).toBe(false); // plus requires ≥1
  });
});

describe("typed groups — group with type constraint (FENCED: Tri answers Nothing)", () => {
  it("a digit group with $interval [0,5] type abstains on every input", () => {
    // (?<d>[0-9]) where d : [0,5]
    // Pre-fence spec (mem.pattern.tri restores): "3" ⇒ true, "5" ⇒ true,
    // "7" ⇒ false (matches the plain pattern but fails the type).
    const pat = group(
      "d",
      charClass("0123456789"),
      { $tag: "SeInterval", interval: { lo: Just({ value: "0", inclusive: true }), hi: Just({ value: "5", inclusive: true }) } },
    );
    nothing({ $tag: "SePattern", pattern: pat }, "3");
    nothing({ $tag: "SePattern", pattern: pat }, "5");
    nothing({ $tag: "SePattern", pattern: pat }, "7");
  });

  it("group whose type is a named set abstains on every input", () => {
    // (?<seg>[a-zA-Z0-9_]+) where seg : str:ascii-alnum
    // Pre-fence spec: "hello123" ⇒ true; "hello_world" ⇒ false (the _ matches
    // the pattern but breaks the str:ascii-alnum check).
    const pat = group(
      "seg",
      plus(charClass("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_")),
      { $tag: "SeRef", handle: "str:ascii-alnum" },
    );
    nothing({ $tag: "SePattern", pattern: pat }, "hello123");
    nothing({ $tag: "SePattern", pattern: pat }, "hello_world");
  });
});

describe("typed groups — composite (URL contains a typed Path) (FENCED)", () => {
  it("a URL-shaped pattern with a path segment typed as format:path abstains", () => {
    // (?<scheme>https?)://(?<host>[^/]+)(?<path>/.+) where path : format:path
    // Pre-fence spec: both example URLs ⇒ true.
    const httpScheme = alt(
      seq(
        match({ $tag: "SeEnum", values: ["h"] }),
        match({ $tag: "SeEnum", values: ["t"] }),
        match({ $tag: "SeEnum", values: ["t"] }),
        match({ $tag: "SeEnum", values: ["p"] }),
      ),
      seq(
        match({ $tag: "SeEnum", values: ["h"] }),
        match({ $tag: "SeEnum", values: ["t"] }),
        match({ $tag: "SeEnum", values: ["t"] }),
        match({ $tag: "SeEnum", values: ["p"] }),
        match({ $tag: "SeEnum", values: ["s"] }),
      ),
    );
    const sep = seq(match({ $tag: "SeEnum", values: [":"] }), match({ $tag: "SeEnum", values: ["/"] }), match({ $tag: "SeEnum", values: ["/"] }));
    const hostChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-";
    const pathChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789./-_";

    const url = seq(
      group("scheme", httpScheme),
      sep,
      group("host", plus(charClass(hostChars))),
      group("path", plus(charClass(pathChars)), { $tag: "SeRef", handle: "format:path:posix" }),
    );

    nothing({ $tag: "SePattern", pattern: url }, "https://example.com/api/v1/users");
    nothing({ $tag: "SePattern", pattern: url }, "http://x.y/abc");
  });
});

describe("typed groups — extractCaptures sanity (FENCED)", () => {
  it("multiple typed groups abstain on every input", () => {
    // (?<lo>[0-9]) : [0,4]   (?<hi>[0-9]) : [5,9]
    // Pre-fence spec: "27" ⇒ true, "57" ⇒ false (lo fails), "23" ⇒ false
    // (hi fails).
    const pat = seq(
      group("lo", charClass("0123456789"), { $tag: "SeInterval", interval: { lo: Just({ value: "0", inclusive: true }), hi: Just({ value: "4", inclusive: true }) } }),
      group("hi", charClass("0123456789"), { $tag: "SeInterval", interval: { lo: Just({ value: "5", inclusive: true }), hi: Just({ value: "9", inclusive: true }) } }),
    );
    nothing({ $tag: "SePattern", pattern: pat }, "27");
    nothing({ $tag: "SePattern", pattern: pat }, "57");
    nothing({ $tag: "SePattern", pattern: pat }, "23");
  });
});
