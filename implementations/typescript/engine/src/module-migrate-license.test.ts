// ---------------------------------------------------------------------------
// module-migrate-license.test.ts — typed-function-references FenelModule-
// retirement Phase FM-retire-1b parity proof (the port-or-drop phase).
//
// `license` moved off its 2 `defineFunction` specs + ~80 LOC of exported TS
// algebra onto `fenel/modules/license/license.fenel` (`module license where` +
// the Fenel-bodied algebra + identity facets) + a thin seam that keeps the
// existing `types.fenel` (License / Rate) sidecar loaded as before.
//
// The decision gate resolved to PORT: `composeLicenses` /
// `computeEffectiveLicense` + the permissiveness/copyleft tables are now Fenel
// (pure 8-case ADT composition — the Fenel-first HARD RULE). This file LOCKS:
//   - the migrated roster (the 3 public fns + the 4 pure helpers);
//   - the DROPPED Categorizable (3j read-time, derives from `license:`);
//   - the two no-corner-cut redesigns: `check_license_compat`'s canonical
//     `Result String License` return (was a faux-`Result` record) + the kept
//     `compute_rev_share` REAL 3-field record return (was `-> {}` placeholder);
//   - the facet byte-identity for the 3 identity-bearing fns;
//   - the kept License / Rate entities.
// The composition-algebra runtime regression lives in license-load.test.ts §5
// (retargeted to the Fenel body); compute_rev_share's round-trip in
// compute-rev-share.test.ts (body unchanged).
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { licenseModule } from "./modules/license";
import { stdModule } from "./modules/std";
import { createRegistry } from "./registry";
import type { Instance } from "./types";

// The 2 identity-bearing public functions (the original `defineFunction` specs;
// carry @label/@description/@tags byte-identical to the retired TS).
const PUBLIC_FN_IDS = [
  "license:check_license_compat",
  "license:compute_rev_share",
];
// The 5 helpers (auto-Codeable only — no rich facets). `composeLicenses` was a
// plain unlabeled TS export, not a defineFunction, so it stays facet-less.
const HELPER_FN_IDS = [
  "license:composeLicenses",
  "license:licenseTag",
  "license:permissiveness",
  "license:incompatMessage",
  "license:composeRevShare",
];
const ALL_FN_IDS = [...PUBLIC_FN_IDS, ...HELPER_FN_IDS];

const RICH: Record<string, { label: string; description: string; tags: string[] }> = {
  "license:check_license_compat": {
    label: "Check License Compatibility",
    description:
      "Check if a list of licenses can be composed. Returns the effective license (Ok) or an incompatibility message (Err).",
    tags: ["license", "pure", "validation"],
  },
  "license:compute_rev_share": {
    label: "Compute Revenue Share",
    description: "Given an amount and RevShare license, compute per-recipient payouts.",
    tags: ["license", "pure", "revenue"],
  },
};

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}
const hasNoDefault = (d: unknown): boolean =>
  d == null || (d as { $tag?: string }).$tag === "Nothing";
const refName = (t: unknown): string | undefined => {
  const o = t as { $ref?: string };
  return o?.$ref;
};

const byId = new Map((licenseModule.functions ?? []).map((f) => [f.id, f]));
const insts = licenseModule.instances ?? [];

describe("license migration — roster + identity", () => {
  test("the `module license where` header is authoritative", () => {
    expect(licenseModule.name).toBe("license");
  });

  test("all 7 functions registered under the legacy `license:` id-prefix", () => {
    expect((licenseModule.functions ?? []).map((f) => f.id).sort()).toEqual([...ALL_FN_IDS].sort());
  });

  test("0 defineFunction-era TS algebra survives — composeLicenses is Fenel-bodied", () => {
    expect(byId.get("license:composeLicenses")?.body).toBeDefined();
    expect(byId.get("license:check_license_compat")?.body).toBeDefined();
    expect(byId.get("license:compute_rev_share")?.body).toBeDefined();
  });

  test("codeName === id-suffix for every fn (no @codeName)", () => {
    for (const id of ALL_FN_IDS) {
      expect(methodOf(insts, "Codeable", id)).toEqual({ codeName: id.split(":")[1] });
    }
  });

  test("every fn resolves by id + codeName through createRegistry", () => {
    const reg = createRegistry([stdModule, licenseModule]);
    for (const id of ALL_FN_IDS) {
      const suffix = id.split(":")[1]!;
      expect(reg.getFunction(id)?.id).toBe(id);
      expect(reg.getFunctionByCodeName(suffix)?.id).toBe(id);
    }
  });
});

describe("license migration — defaults drop, facet parity, no Categorizable", () => {
  test("NO param default survives on ANY function", () => {
    for (const f of licenseModule.functions ?? []) {
      for (const p of f.params ?? []) expect(hasNoDefault((p as Record<string, unknown>).default)).toBe(true);
    }
  });

  test("Labelable + Describable + Taggable byte-identical for the 3 public fns", () => {
    for (const id of PUBLIC_FN_IDS) {
      expect(methodOf(insts, "Labelable", id)).toEqual({ label: RICH[id]!.label });
      expect(methodOf(insts, "Describable", id)).toEqual({ description: RICH[id]!.description });
      expect(methodOf(insts, "Taggable", id)).toEqual({ tags: RICH[id]!.tags });
    }
  });

  test("the 4 pure helpers carry NO rich facets (auto-Codeable only)", () => {
    for (const id of HELPER_FN_IDS) {
      expect(methodOf(insts, "Labelable", id)).toBeUndefined();
      expect(methodOf(insts, "Describable", id)).toBeUndefined();
      expect(methodOf(insts, "Taggable", id)).toBeUndefined();
    }
  });

  test("NO stored Categorizable on any fn (3j read-time, derives from `license:`)", () => {
    for (const id of ALL_FN_IDS) expect(methodOf(insts, "Categorizable", id)).toBeUndefined();
  });

  test("ZERO IOInvokable across the module (license is pure)", () => {
    expect(insts.filter((i) => i.typeName === "IOInvokable").length).toBe(0);
  });
});

describe("license migration — the no-corner-cut return-type redesigns", () => {
  test("check_license_compat returns the canonical `Result String License` (was a faux-Result record)", () => {
    const cc = byId.get("license:check_license_compat")!;
    // param is [License]
    expect(cc.params.length).toBe(1);
    // return is Result String License — a 2-case $variant (Err _0:String, Ok _0:License)
    const ret = cc.returns as { $variant?: { cases: Array<{ name: string; fields?: Array<{ type: unknown }> }> } };
    const cases = ret.$variant?.cases ?? [];
    expect(cases.map((c) => c.name).sort()).toEqual(["Err", "Ok"]);
    const err = cases.find((c) => c.name === "Err");
    const ok = cases.find((c) => c.name === "Ok");
    expect(refName(err!.fields![0]!.type)).toBe("String");
    expect(refName(ok!.fields![0]!.type)).toBe("License");
  });

  test("compute_rev_share returns the REAL 3-field record (NOT the `{}` placeholder)", () => {
    const crs = byId.get("license:compute_rev_share")!;
    const ret = crs.returns as { $record?: { fields: Array<{ name: string; type: unknown }> } };
    const fields = ret.$record?.fields ?? [];
    expect(fields.map((f) => f.name)).toEqual([
      "per_recipient_cents",
      "total_shared_cents",
      "remainder_cents",
    ]);
    for (const f of fields) expect(refName(f.type)).toBe("Number");
  });
});

describe("license migration — License / Rate entities preserved", () => {
  test("entities carry License (8-case ADT) + Rate (named atom) from types.fenel", () => {
    const ids = (licenseModule.entities ?? []).map((e) => e.id);
    expect(ids).toContain("License");
    expect(ids).toContain("Rate");
  });

  test("licenseType export is the same reference the .fenel loader returned", () => {
    // (cross-check with license-load.test.ts §4; here just confirm the entity
    // shape is the 8-case License variant.)
    const lic = (licenseModule.entities ?? []).find((e) => e.id === "License");
    const cases = (lic!.type as { $variant?: { cases: Array<{ name: string }> } }).$variant?.cases ?? [];
    expect(cases.map((c) => c.name)).toEqual([
      "MIT", "Apache", "GPL", "LGPL", "BSD", "Proprietary", "RevShare", "Custom",
    ]);
  });
});
