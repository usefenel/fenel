// ---------------------------------------------------------------------------
// signature-projection.test.ts — signature-substrate Phase 1 gates
// (design/signatures-and-contracts.md §11.1–3).
//
//  §11.1 — `functionArrowType` is THE canonical arrow projection: it agrees
//          across source-parsed, hand-built-TS, and registry-loaded function
//          specs (skeleton agreement — `raw`/`token`/field-identity keys are
//          provenance, not arrow semantics), flatten-normalizes currying
//          spellings to ONE identity, and never carries `requires` (the
//          `@requires → FenelFunction.requires` path stays lossless BESIDE
//          the projection, not inside it).
//  §11.2 — `$arrow.requires` is retired from the constructor; foreign data
//          still carrying it produces the distinct normalize-boundary
//          diagnostic + strip, never silent drop; idempotent after the strip.
//  §11.3 — projection totality: declared `$union` / `$intersect` /
//          `$complement` project to real SeUnion / SeIntersect / SeComplement
//          (not the `_ → SeAll` ⊤-degrade), pinned by membership verdicts
//          that flip from vacuous-⊤ to real; the binder-usage companion keeps
//          a μ/opaque name referenced only under a former SeMu-bound (no
//          dangling SeRef).
//
// Run with FENEL_PARSER_LEGACY=1 while the parse cache misses on the edited
// `.fenel` sources (the standard dev-loop rule).
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { loadFenelModule } from "./fenel-module";
import { createRegistry as createRegistryRaw } from "./registry";
import { dispatchedFunctionArrowType } from "./engine-bodies-dispatch";
import { normalizeFenelTypeShorthand } from "./type-normalize";
import { typeToSetExpr } from "./fenel-check";
import { contains } from "./set-algebra";
import { Nothing } from "./type-foundation";
import type { FenelType, FieldDef, FieldKey } from "./types";

const INT = { $ref: "Int" } as unknown as FenelType;
const STR = { $ref: "String" } as unknown as FenelType;

// The module-migrate-engine memo discipline: a bare `createRegistry` re-runs
// the interpreted field-identity kernel per call (minutes on a slow host);
// the safe module-identity memo keeps this focused gate on the gate.
function createRegistry(modules: Parameters<typeof createRegistryRaw>[0]) {
  return createRegistryRaw(modules, {
    fieldIdentity: {
      mode: "source-handles",
      defaultRealm: "repository-source",
      cacheKey: "signature-projection:immutable-fixture",
    },
  });
}

// MaybeBool → "true" | "false" | "nothing" (the arrow.test.ts idiom).
function mb(m: unknown): "true" | "false" | "nothing" {
  const x = m as { $tag?: string; _0?: unknown; value?: unknown };
  if (x?.$tag === "Just") return (x._0 ?? x.value) ? "true" : "false";
  return "nothing";
}

// Arrow-semantics skeleton: drop `raw` (host round-trip payload), `token`
// (marshal-local locator), and the field-identity key slots (`key` /
// `semanticKey` — attachment provenance differs between a raw loader spec
// and a registry-identified view; identity attachment is pinned by the
// field-identity suites, not this gate).
function skeleton(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(skeleton);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "raw" || k === "token" || k === "key" || k === "semanticKey") continue;
      out[k] = skeleton(v);
    }
    return out;
  }
  return node;
}

const fieldDef = (name: string, type: FenelType): FieldDef =>
  ({ name, label: Nothing, type, meta: {}, ui: Nothing }) as unknown as FieldDef;

const DEMO_SRC = `
incA : (x: Int) -> (y: Int) -> Int
incA x y = x

incB : (x: Int) -> (y: Int) -> Int
incB x = \\y -> x

@requires "HasStateIO"
effFn : (x: Int) -> Int
effFn x = x
`;

describe("§11.1 — functionArrowType, the canonical projection", () => {
  const mod = loadFenelModule(DEMO_SRC, "demo");
  const byId = new Map((mod.functions ?? []).map((f) => [f.id, f]));

  test("currying spellings project to ONE flattened arrow (identity = flattened form)", () => {
    const a = byId.get("demo:incA")!;
    const b = byId.get("demo:incB")!;
    // Different loader shapes by construction (arity-2 vs curried tail)…
    expect(a.params.length).toBe(2);
    expect(b.params.length).toBe(1);
    // …same canonical projection.
    const projA = dispatchedFunctionArrowType(a) as {
      $tag: string;
      params: Array<{ wireName: string }>;
      returns: { $tag: string; name?: string };
    };
    const projB = dispatchedFunctionArrowType(b) as typeof projA;
    expect(projA.$tag).toBe("TtArrow");
    expect(projA.params.length).toBe(2);
    expect(projA.params.map((p) => p.wireName)).toEqual(["x", "y"]);
    expect(projA.returns.$tag).toBe("TtNamed");
    expect(projA.returns.name).toBe("Int");
    expect(skeleton(projA)).toEqual(skeleton(projB));
  });

  test("source-parsed, hand-built-TS, and registry-loaded specs agree", () => {
    const source = byId.get("demo:incA")!;
    const handBuilt = {
      params: [fieldDef("x", INT), fieldDef("y", INT)],
      returns: INT,
    };
    const reg = createRegistry([mod]);
    const loaded = reg.getFunction("demo:incA")!;
    const sSource = skeleton(dispatchedFunctionArrowType(source));
    const sHand = skeleton(dispatchedFunctionArrowType(handBuilt));
    const sLoaded = skeleton(dispatchedFunctionArrowType(loaded));
    expect(sSource).toEqual(sHand);
    expect(sSource).toEqual(sLoaded);
  }, 15_000); // Cold registry/parser artifact initialization exceeds Bun's 5 s default on CI-class hosts.

  test("`requires` is never in the projection; the @requires → FenelFunction.requires path is lossless beside it", () => {
    const eff = byId.get("demo:effFn")!;
    // The declared capability survives on the SPEC…
    expect(JSON.stringify(eff.requires ?? [])).toContain("HasStateIO");
    // …and after registry load (post-inference the DECLARED entry must survive).
    const reg = createRegistry([mod]);
    const loaded = reg.getFunction("demo:effFn")!;
    expect(JSON.stringify(loaded.requires ?? [])).toContain("HasStateIO");
    // …but the arrow VALUE type never carries it (judgment 2 ≠ value type).
    const proj = dispatchedFunctionArrowType(eff);
    expect(JSON.stringify(proj)).not.toContain('"requires"');
    // The effectful spec's arrow face equals its pure twin's — effects live
    // outside the arrow (SC-eff), so the projection cannot differ.
    const pure = byId.get("demo:incA")!;
    const projPure = dispatchedFunctionArrowType({
      params: [pure.params[0]!],
      returns: pure.returns,
    });
    expect(skeleton(dispatchedFunctionArrowType({ params: eff.params, returns: eff.returns })))
      .toEqual(skeleton({ ...(projPure as object) }));
  });
});

describe("§11.2 — $arrow.requires retirement: diagnostic + strip, never silent", () => {
  const foreignArrow = {
    $arrow: {
      params: [{ name: "x", type: { $ref: "Int" } }],
      returns: { $ref: "Int" },
      requires: [{ class: { $tag: "Id", entityId: "HasStateIO" }, args: [] }],
    },
  };

  test("a foreign envelope carrying the retired slot is stripped WITH the distinct diagnostic", () => {
    const report = normalizeFenelTypeShorthand(foreignArrow);
    expect(report.diagnostics.length).toBe(1);
    expect(report.diagnostics[0]).toMatch(/\$arrow\.requires/);
    expect(report.rewrites).toBeGreaterThanOrEqual(1);
    const out = report.value as { $arrow: Record<string, unknown> };
    expect("requires" in out.$arrow).toBe(false);
    expect(out.$arrow["returns"]).toEqual({ $ref: "Int" });
    expect(JSON.stringify(out)).not.toContain('"requires"');
  });

  test("the strip is idempotent (second pass: clean, no diagnostic)", () => {
    const first = normalizeFenelTypeShorthand(foreignArrow);
    const second = normalizeFenelTypeShorthand(first.value);
    expect(second.diagnostics).toEqual([]);
    expect(second.rewrites).toBe(0);
    expect(second.value).toEqual(first.value);
  });

  test("nested foreign arrows (a field's type) strip too — the walk is deep", () => {
    const nested = {
      $record: { fields: [{ name: "cb", type: foreignArrow }] },
    };
    const report = normalizeFenelTypeShorthand(nested);
    expect(report.diagnostics.length).toBe(1);
    expect(JSON.stringify(report.value)).not.toContain('"requires"');
  });

  test("a clean arrow passes through unchanged — no diagnostic, no rewrite", () => {
    const clean = {
      $arrow: {
        params: [{ name: "x", type: { $ref: "Int" } }],
        returns: { $ref: "Int" },
      },
    };
    const report = normalizeFenelTypeShorthand(clean);
    expect(report.diagnostics).toEqual([]);
    expect(report.rewrites).toBe(0);
    expect(report.value).toEqual(clean);
  });
});

describe("§11.3 — projection totality: ∪ / ∩ / ¬ project real sets (not ⊤)", () => {
  test("$union projects to SeUnion; membership flips from vacuous-⊤ to real", () => {
    const proj = typeToSetExpr({ $union: [INT, STR] } as unknown as FenelType) as unknown as {
      $tag?: string;
      branches?: unknown[];
    };
    expect(proj.$tag).toBe("SeUnion");
    expect(proj.branches?.length).toBe(2);
    expect(mb(contains(proj as never, 5, null))).toBe("true");
    expect(mb(contains(proj as never, "hello", null))).toBe("true");
    // THE verdict change: pre-P1 this projected SeAll ⇒ vacuous "true".
    expect(mb(contains(proj as never, true, null))).toBe("false");
  });

  test("$intersect projects to SeIntersect; Int ∩ String refutes what ⊤ accepted", () => {
    const proj = typeToSetExpr({ $intersect: [INT, STR] } as unknown as FenelType) as unknown as {
      $tag?: string;
    };
    expect(proj.$tag).toBe("SeIntersect");
    expect(mb(contains(proj as never, 5, null))).toBe("false");
  });

  test("$complement projects to SeComplement; ¬Int accepts a string, refutes an int", () => {
    const proj = typeToSetExpr({ $complement: INT } as unknown as FenelType) as unknown as {
      $tag?: string;
    };
    expect(proj.$tag).toBe("SeComplement");
    expect(mb(contains(proj as never, "hello", null))).toBe("true");
    expect(mb(contains(proj as never, 5, null))).toBe("false");
  });

  test("binder companion: an opaque name referenced only under ∪ still gets its SeMu wrapper (no dangling SeRef)", () => {
    const fieldKey: FieldKey = {
      $tag: "NamedField",
      ref: { $ref: "10000000-0000-4000-8000-000000000001" },
    } as unknown as FieldKey;
    const recursiveUnion = {
      $opaque: {
        name: "UT",
        pure: {
          $union: [
            INT,
            {
              $record: {
                fields: [
                  { key: fieldKey, name: "next", type: { $ref: "UT" } },
                ],
              },
            },
          ],
        },
      },
    } as unknown as FenelType;
    const proj = typeToSetExpr(recursiveUnion) as unknown as {
      $tag?: string;
      var?: string;
      body?: { $tag?: string };
    };
    // Pre-P1 the usesName walker missed the ∪-buried reference ⇒ no SeMu ⇒ a
    // dangling `SeRef "UT"` the membership face could only abstain on.
    expect(proj.$tag).toBe("SeMu");
    expect(proj.var).toBe("UT");
    expect(proj.body?.$tag).toBe("SeUnion");
    expect(mb(contains(proj as never, 5, null))).toBe("true");
  });
});
