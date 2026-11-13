// ---------------------------------------------------------------------------
// module-port-natives-3v4d.test.ts — module-substrate Phase 3v.4d behavioral
// oracle.
//
// 3v.4d is the FIRST non-body-neutral 3v rung: two pure-native engine
// implementations (`locale:canonical` + `engine:humanizeCodeName`) port to
// Fenel bodies. The byte-identical fail-SET gate that has protected every
// prior rung does NOT cover behavior — these new bodies need their own
// adversarial parity assertion against the TS reference impls across:
//
//   - canonical: a curated fixture of LocaleString shapes (plain String,
//     single-locale map, multi-locale map, empty map, null/undefined-like
//     codec-boundary noise) that mirrors locale.ts:canonical (line 201);
//   - humanizeCodeName: a corpus of targeted edge-case fixtures (camelCase,
//     UPPER-mixed, snake/kebab, mixed-case-with-all-caps-middle, digits,
//     single-char inputs) AND the LIVE codeName roster of every registered
//     std + engine + locale function — asserts the Fenel char-fold matches
//     fenel-module.ts:humanizeCodeName byte-for-byte on every codeName a
//     user might ever see in the catalog UI.
//
// On byte-divergence the failing input is named in the assertion message
// (`id=${f.id}` / the edge-case input). Brief discipline: any LIVE-roster
// divergence STOPS and flags Rom (could be a Fenel-port bug, a TS-impl bug,
// or a genuine policy call — document in completion notes).
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { stdModule } from "./modules/std";
import { engineModule } from "./modules/engine";
import { localeModule } from "./modules/locale";
import { createRegistry } from "./registry";
import { evaluate } from "./json-logic";
import { humanizeCodeName as humanizeTS } from "./fenel-module";

const reg = createRegistry([stdModule, engineModule, localeModule]);
const ctx = reg.evaluateContext();

describe("3v.4d Phase A — locale:canonical Fenel body matches the TS oracle", () => {
  test("locale module publishes exactly one fn — locale:canonical, with a body", () => {
    const fns = localeModule.functions ?? [];
    expect(fns.length).toBe(1);
    expect(fns[0]!.id).toBe("locale:canonical");
    expect(fns[0]!.body).toBeDefined();
  });

  test("plain String passes through verbatim", () => {
    expect(evaluate({ call: ["canonical", "hello"] }, {}, ctx)).toBe("hello");
    expect(evaluate({ call: ["canonical", ""] }, {}, ctx)).toBe("");
    expect(evaluate({ call: ["canonical", "with spaces and  more"] }, {}, ctx)).toBe(
      "with spaces and  more",
    );
  });

  test("single-locale map returns the only value", () => {
    expect(evaluate({ call: ["canonical", { en: "x" }] }, {}, ctx)).toBe("x");
    expect(evaluate({ call: ["canonical", { fr: "salut" }] }, {}, ctx)).toBe("salut");
  });

  test("multi-locale map returns the first key's value", () => {
    expect(evaluate({ call: ["canonical", { en: "x", fr: "y" }] }, {}, ctx)).toBe("x");
    expect(evaluate({ call: ["canonical", { fr: "y", en: "x" }] }, {}, ctx)).toBe("y");
  });

  test("empty map yields the empty String", () => {
    expect(evaluate({ call: ["canonical", {} ] }, {}, ctx)).toBe("");
  });

  test("dispatch via fnId also resolves (catalog surface intact)", () => {
    expect(evaluate({ call: ["locale:canonical", "via-fnId"] }, {}, ctx)).toBe("via-fnId");
  });
});

// ---------------------------------------------------------------------------
// 3v.4d Phase B — engine:humanizeCodeName behavioral oracle.
//
// Asserts byte-equality between the new Fenel body (dispatched via the
// registry) and the TS reference at fenel-module.ts:humanizeCodeName across:
//   1. a curated set of targeted edge cases (the camel-boundary corner cases
//      brief Risk #1 calls out: caps-then-camel, mixed-case-with-all-caps
//      middle, digit-then-upper, single-char and empty inputs).
//   2. the LIVE codeName roster — every fn in stdModule + engineModule +
//      localeModule.functions, the codeName extracted from the fnId. If
//      ANY live codeName diverges, a user-visible label is wrong.
// ---------------------------------------------------------------------------

const EDGE_CASES: Array<readonly [string, string]> = [
  ["", ""],
  ["a", "A"],
  ["A", "A"],
  ["URL", "URL"],
  ["URLPath", "URL Path"],
  ["HTTPHeader", "HTTP Header"],
  ["iOSApp", "I OS App"],
  ["camelCase", "Camel Case"],
  ["snake_case", "Snake Case"],
  ["kebab-case", "Kebab Case"],
  ["PascalCase", "Pascal Case"],
  ["ALLCAPS", "ALLCAPS"],
  ["all_lower", "All Lower"],
  ["mixedURLPath", "Mixed URL Path"],
  ["html5", "Html5"],
  ["v2Endpoint", "V2 Endpoint"],
  ["alpha_BETA-gamma", "Alpha BETA Gamma"],
  ["runTelegramCollector", "Run Telegram Collector"],
  ["parseEffectFnId", "Parse Effect Fn Id"],
  ["depTypesAnyMember", "Dep Types Any Member"],
];

describe("3v.4d Phase B — engine:humanizeCodeName Fenel port matches TS impl byte-for-byte", () => {
  test.each(EDGE_CASES)("edge case: %s → %s", (input, expected) => {
    const fenelOut = evaluate({ call: ["humanizeCodeName", input] }, {}, ctx) as string;
    const tsOut = humanizeTS(input);
    expect(fenelOut).toBe(expected);
    expect(fenelOut).toBe(tsOut);
  });

  test("live codeName roster — every registered fn id round-trips equally (canary for user-visible label divergences)", () => {
    const allFns = [
      ...(stdModule.functions ?? []),
      ...(engineModule.functions ?? []),
      ...(localeModule.functions ?? []),
    ];
    expect(allFns.length).toBeGreaterThan(900); // baseline sanity — std + engine + locale together
    for (const f of allFns) {
      const codeName = f.id.includes(":") ? f.id.slice(f.id.indexOf(":") + 1) : f.id;
      const fenelOut = evaluate({ call: ["humanizeCodeName", codeName] }, {}, ctx) as string;
      const tsOut = humanizeTS(codeName);
      expect(fenelOut, `id=${f.id} codeName=${codeName}`).toBe(tsOut);
    }
  });

  test("humanizeCodeName + humanizeCodeNameWalk both surface in engineModule.functions with bodies", () => {
    const fns = engineModule.functions ?? [];
    const main = fns.find((f) => f.id === "engine:humanizeCodeName");
    const walker = fns.find((f) => f.id === "engine:humanizeCodeNameWalk");
    expect(main?.body).toBeDefined();
    expect(walker?.body).toBeDefined();
  });
});
