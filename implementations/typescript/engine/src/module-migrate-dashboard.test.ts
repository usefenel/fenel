// ---------------------------------------------------------------------------
// module-migrate-dashboard.test.ts — module-substrate Phase 3t parity proof.
//
// `dashboard` is the single biggest module (144 `defineFunction` specs — more
// than telegram's 53). Phase 3t migrated ALL of it to the `module dashboard
// where` cross-file header UNION (`loadFenelModuleUnion`) across 8 files:
//   - 3t.1: the 7 clean orchestration files (helpers / routes / profiles /
//     registry / typeclass-triggers-timeline / saved-queries-and-views /
//     stats-and-activity — 124 fns).
//   - 3t.2: io.fenel (the InvokeDecision-ADT decision bodies, 19 fns) + the
//     PORT of the lone native `maskCredentials` to a Fenel body (std:entries +
//     std:fold + std:mapSet) → `nativeImpls` collapses to `{}`.
// Each `.fenel` carries its `name : Type` sig + `@facet` directives co-located
// with its (UNCHANGED) body; the ~340-LOC TS spec-wrapper RETIRED.
//
// GENERATE-THEN-LOCK (3o.3 / 3s): the sigs + facets were generated from the
// pre-migration `dashboardModule` oracle (scripts/migrate-dashboard.ts) and
// dumped to `module-migrate-dashboard.oracle.json`; this file LOCKS the migrated
// module against that fixture — byte-faithful params / returns / facets.
//
// DASHBOARD IS NOT A 3k/3l CAPABILITY MODULE (Surprise #48): ZERO capability /
// provider structure, ZERO `ioAction` / `credentialRequirements` facets (those
// words live only in description prose). It is the telegram-3o ORCHESTRATION +
// light-IO shape; the runtime `invokeIOAction` dynamic-dispatch (which executes
// the InvokeDecision arms) is a MARSHALLING BOUNDARY outside this module (#47).
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { dashboardModule } from "./modules/dashboard";
import { stdModule } from "./modules/std";
import { createRegistry } from "./registry";
import { loadFenelModuleUnion } from "./fenel-module";
import { evaluate } from "./json-logic";
import { List, Maybe } from "./type-foundation";
import oracle from "./module-migrate-dashboard.oracle.json";

import HELPERS_FENEL from "../../../../fenel/modules/dashboard/helpers.fenel?raw";
import ROUTES_FENEL from "../../../../fenel/modules/dashboard/routes.fenel?raw";
import PROFILES_FENEL from "../../../../fenel/modules/dashboard/profiles.fenel?raw";
import REGISTRY_FENEL from "../../../../fenel/modules/dashboard/registry.fenel?raw";
import IO_FENEL from "../../../../fenel/modules/dashboard/io.fenel?raw";
import TCT_FENEL from "../../../../fenel/modules/dashboard/dispatch-triggers-timeline.fenel?raw";
import SQV_FENEL from "../../../../fenel/modules/dashboard/saved-queries-and-views.fenel?raw";
import STATS_FENEL from "../../../../fenel/modules/dashboard/stats-and-activity.fenel?raw";

const fns = dashboardModule.functions ?? [];
const insts = dashboardModule.instances ?? [];
const byId = new Map(fns.map((f) => [f.id, f]));
function methodOf(typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

const FIXTURE = oracle as {
  fns: Record<string, {
    codeName: string; label?: string; description?: string; tags?: string[];
    category?: string; params: unknown[]; returns: unknown; hasBody: boolean;
  }>;
  entities: string[];
};
const ALL_IDS = Object.keys(FIXTURE.fns);

// 7g-parser: the parser emits a user-written type-name ref as `{$ref:H}` (the
// retired TS-spec oracle used `{$named:H}`). This raw migration oracle is
// byte-identical modulo that representation rename and the retired redundant
// `List.$opaque.repr = "array"` hint. The field-identity substrate also makes
// positional payload identity explicit; inject that deterministic key into the
// legacy oracle shape. Producer tripwires live in focused suites, not here.
function normRefs(t: unknown): unknown {
  if (Array.isArray(t)) return t.map(normRefs);
  if (t && typeof t === "object") {
    const o = t as Record<string, unknown>;
    if ("$ref" in o && typeof o.$ref === "string") return { $named: o.$ref };
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) {
      if (k === "repr" && o.name === "List" && o.repr === "array") continue;
      out[k] = normRefs(o[k]);
    }
    if (!("key" in o) && "type" in o && typeof o.name === "string") {
      const positional = /^_(\d+)$/.exec(o.name);
      if (positional !== null) {
        out.key = { $tag: "PositionalField", index: Number(positional[1]) };
      }
    }
    return out;
  }
  return t;
}

function expectRawSlotType(
  actual: unknown,
  expectedOracle: unknown,
  absentId: string,
): boolean {
  if (
    actual !== null &&
    typeof actual === "object" &&
    (actual as Record<string, unknown>).$var === absentId
  ) {
    // The retired loader reused one fake `a` for every missing slot. Raw source
    // views now carry a path-scoped obligation sentinel; the effective registry
    // replaces it with the inferred scheme before publication.
    expect(expectedOracle).toEqual({ $var: "a" });
    expect(actual).toEqual({ $var: absentId });
    return true;
  }
  expect(normRefs(actual)).toEqual(normRefs(expectedOracle) as never);
  return false;
}

describe("dashboard 3t — the full 152-id roster + identity", () => {
  test("the module registers exactly the 152 oracle ids (unique)", () => {
    expect(ALL_IDS.length).toBe(152);
    expect(new Set(fns.map((f) => f.id)).size).toBe(152);
    expect([...byId.keys()].sort()).toEqual([...ALL_IDS].sort());
  });

  test("codeName === id-suffix for every fn (no @codeName divergence)", () => {
    // The clean invariant. The ONE oracle divergence — sqv's `sqvDefaultToLocal`
    // carried codeName `defaultToLocal` (a pre-existing collision with tct's
    // `defaultToLocal`) — is deliberately COLLAPSED to codeName === id-suffix
    // (nothing external references the local helper's codeName; identical bodies).
    for (const id of ALL_IDS) {
      expect(methodOf("Codeable", id)).toEqual({ codeName: id.slice("dashboard:".length) });
    }
  });

  test("every id + codeName resolves through createRegistry", () => {
    const reg = createRegistry([stdModule, dashboardModule]);
    for (const id of ALL_IDS) {
      const suffix = id.slice("dashboard:".length);
      expect(reg.getFunction(id)?.id).toBe(id);
      expect(reg.getFunctionByCodeName(suffix)?.id).toBe(id);
    }
  }, 60_000);
});

describe("dashboard 3t — raw authored slots / absent obligations preserve the oracle", () => {
  test("params retain oracle metadata and exact path-scoped absent obligations", () => {
    const seenAbsent = new Set<string>();
    for (const id of ALL_IDS) {
      const actual = byId.get(id)?.params ?? [];
      const expected = FIXTURE.fns[id]!.params as Array<Record<string, unknown>>;
      expect(actual).toHaveLength(expected.length);
      actual.forEach((param, index) => {
        const { type: actualType, ...actualMeta } = param as unknown as Record<string, unknown>;
        const { type: expectedType, ...expectedMeta } = expected[index]!;
        expect(normRefs(actualMeta)).toEqual(expectedMeta);
        const absentId = `__absent__${id}__param-${index}`;
        if (expectRawSlotType(actualType, expectedType, absentId)) {
          expect(seenAbsent.has(absentId)).toBe(false);
          seenAbsent.add(absentId);
        }
      });
    }
    expect(seenAbsent.size).toBeGreaterThan(0);
  });
  test("returns retain authored types or the exact path-scoped absent obligation", () => {
    const seenAbsent = new Set<string>();
    for (const id of ALL_IDS) {
      const absentId = `__absent__${id}__return`;
      if (expectRawSlotType(byId.get(id)?.returns, FIXTURE.fns[id]!.returns, absentId)) {
        expect(seenAbsent.has(absentId)).toBe(false);
        seenAbsent.add(absentId);
      }
    }
    expect(seenAbsent.size).toBeGreaterThan(0);
  });
  // The recordOpen `{}` + `List ({})` / `Maybe ({})` paren-gotcha (#17) sigs
  // round-trip from `.fenel` source — the empty-record-placeholder count holds.
  test("recordOpen `{}` + List ({}) / Maybe ({}) sigs round-trip (paren-gotcha #17)", () => {
    expect(byId.get("dashboard:flattenProfile")?.returns).toEqual({ $record: { fields: [] } });
    expect(byId.get("dashboard:listPurchases")?.returns).toEqual(List({ $record: { fields: [] } }));
    expect(byId.get("dashboard:getProfileDetail")?.returns).toEqual(Maybe({ $record: { fields: [] } }));
    // resolveAwaiting explicitly authors its arbitrary resume value as a
    // declaration-scoped scheme variable; no loader placeholder supplies it.
    expect(normRefs(byId.get("dashboard:resolveAwaiting")?.params)).toEqual(normRefs([
      { name: "instanceId", label: { $tag: "Nothing" }, type: { $ref: "String" }, meta: {}, ui: { $tag: "Nothing" } },
      { name: "value", label: { $tag: "Nothing" }, type: { $var: "a" }, meta: {}, ui: { $tag: "Nothing" } },
      { name: "expectedSuspensionId", label: { $tag: "Nothing" }, type: Maybe({ $ref: "String" }), meta: {}, ui: { $tag: "Nothing" } },
    ]));
  });
});

describe("dashboard 3t — facet parity (Labelable / Describable / Taggable)", () => {
  test("Labelable + Describable + Taggable byte-identical for every fn", () => {
    for (const id of ALL_IDS) {
      const f = FIXTURE.fns[id]!;
      if (f.label !== undefined)
        expect(methodOf("Labelable", id)).toEqual({ label: f.label });
      if (f.description !== undefined)
        expect(methodOf("Describable", id)).toEqual({ description: f.description });
      if (f.tags !== undefined)
        expect(methodOf("Taggable", id)).toEqual({ tags: f.tags });
    }
  });

  test("ALL 152 fns drop stored Categorizable (3j read-time)", () => {
    for (const id of ALL_IDS) {
      expect(methodOf("Categorizable", id)).toBeUndefined();
    }
    expect(insts.filter((i) => i.typeName === "Categorizable").length).toBe(0);
  });

  test("ZERO IOInvokable facets across the whole module (no ioAction in dashboard)", () => {
    expect(insts.filter((i) => i.typeName === "IOInvokable").length).toBe(0);
  });
});

describe("dashboard 3t — fully Fenel-bodied (no TS natives survive)", () => {
  test("every fn carries a Fenel body — NONE bodyless", () => {
    expect(fns.filter((f) => !f.body).map((f) => f.id)).toEqual([]);
    for (const id of ALL_IDS) expect(byId.get(id)?.body).toBeDefined();
  });

  test("nativeImpls collapsed to {} (maskCredentials PORTED to a Fenel body)", () => {
    expect(Object.keys(dashboardModule.nativeImpls ?? {})).toEqual([]);
  });

  test("the ported maskCredentials body evaluates byte-faithfully to the retired native", () => {
    const reg = createRegistry([stdModule, dashboardModule]);
    const ctx = reg.evaluateContext();
    const mask = (creds: unknown) => evaluate({ call: ["maskCredentials", creds] }, {}, ctx);
    // non-null, non-empty-string entries → "configured"; null + "" dropped; any
    // non-string value (number / Boolean) is KEPT (the TS guard only drops the
    // empty STRING).
    expect(mask({ apiKey: "secret", token: "", refresh: null, on: "x" })).toEqual({
      apiKey: "configured",
      on: "configured",
    });
    expect(mask({})).toEqual({});
    expect(mask({ a: "1", b: 5, c: true })).toEqual({ a: "configured", b: "configured", c: "configured" });
  }, 60_000);
});

describe("dashboard 3t — InvokeDecision ADT preserved (rides the union entities)", () => {
  test("the InvokeDecision entity is the module's sole entity", () => {
    expect((dashboardModule.entities ?? []).map((e) => e.id)).toEqual(["InvokeDecision"]);
    expect(FIXTURE.entities).toEqual(["InvokeDecision"]);
  });
});

describe("dashboard 3t — the cross-file header UNION (8 files → ONE module)", () => {
  const groups = loadFenelModuleUnion([
    { src: HELPERS_FENEL, name: "dashboard-fallback-a" },
    { src: ROUTES_FENEL, name: "dashboard-fallback-b" },
    { src: PROFILES_FENEL, name: "dashboard-fallback-c" },
    { src: REGISTRY_FENEL, name: "dashboard-fallback-d" },
    { src: IO_FENEL, name: "dashboard-fallback-e" },
    { src: TCT_FENEL, name: "dashboard-fallback-f" },
    { src: SQV_FENEL, name: "dashboard-fallback-g" },
    { src: STATS_FENEL, name: "dashboard-fallback-h" },
  ]);

  test("the 8 files group into ONE `dashboard` module by header (NOT the name arg)", () => {
    expect(groups.map((m) => m.name)).toEqual(["dashboard"]);
  });

  test("the union carries all 152 fns under `dashboard:` ids + the InvokeDecision entity", () => {
    const dash = groups[0]!;
    const ids = (dash.functions ?? []).map((f) => f.id);
    expect(ids.length).toBe(152);
    expect(ids.every((id) => id.startsWith("dashboard:"))).toBe(true);
    expect(ids).toContain("dashboard:flattenProfile"); // helpers.fenel
    expect(ids).toContain("dashboard:maskCredentials"); // helpers.fenel (ported)
    expect(ids).toContain("dashboard:decideInvoke"); // io.fenel
    expect(ids).toContain("dashboard:defaultToIo"); // io.fenel (renamed)
    expect(ids).toContain("dashboard:sqvDefaultToLocal"); // sqv.fenel (renamed)
    expect((dash.entities ?? []).map((e) => e.id)).toEqual(["InvokeDecision"]);
  });

  test("dup-name across two same-header files throws a precise load-time error (OQ3)", () => {
    const a = "module dashboard where\nflattenProfile row = row\n";
    const b = "module dashboard where\nflattenProfile row = row\n";
    expect(() =>
      loadFenelModuleUnion([{ src: a, name: "a.fenel" }, { src: b, name: "b.fenel" }]),
    ).toThrow('module dashboard: duplicate definition "flattenProfile" in a.fenel and b.fenel');
  });
});

describe("dashboard 3t — a union-sourced pure body dispatches end-to-end", () => {
  test("flattenProfile flattens a drizzle row through the registry (by codeName)", () => {
    const reg = createRegistry([stdModule, dashboardModule]);
    const ctx = reg.evaluateContext();
    const row = { id: "p1", accountId: "acc", data: { email: "e@x.io" }, createdAt: "2026-01-01" };
    const out = evaluate({ call: ["flattenProfile", row] }, {}, ctx) as Record<string, unknown>;
    expect(out.id).toBe("p1");
    expect(out.accountId).toBe("acc");
    expect(out.type).toBe("person"); // data.type defaults to "person"
    expect(out.email).toBe("e@x.io");
    expect(out.createdAt).toBe("2026-01-01");
  }, 60_000);
});
