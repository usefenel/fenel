// ---------------------------------------------------------------------------
// module-migrate-pages.test.ts — module-substrate Phase 3n parity proof.
//
// Phase 3n DISSOLVES the `public-surfaces` junk-drawer bundle. The retired
// ~177-LOC `engine/src/modules/public-surfaces.ts` loaded two `.fenel` files
// under throwaway internal names (`pages-ingress` / `receipt-ingress`), hand-
// extracted each body by id, re-wrapped all 6 functions in `defineFunction`
// specs (stamping the public `pages:` / `receipt:` prefixes), and exported ONE
// `publicSurfacesModule`. Nothing consumed the bundle as a semantic unit — so
// per the standing steer ("no wrapper modules around already-clean separate
// modules") it is dissolved into TWO semantic modules, `pages` + `receipt`,
// each loaded directly from its `module … where` `.fenel` source.
//
// This proves: same ids + codeNames; identity facets byte-identical (NO
// stored Categorizable — Phase 3j); the two modules are SEPARATE with disjoint
// members; the 3 page orchestrators carry INFERRED HasStateIO while the 4 pure
// fns carry none; and `public-surfaces.ts` is GONE.
//
// storage-as-effect Phase 4a (2026-06-19) — the page-submit lane collapse.
// submitPage now captures via state:tryCreateInstanceByName (instance + event,
// no dedicated page_submissions row, mirroring types:submit); the
// create→emit branch factors into the NEW `pages:submitPageEmit` helper (parseApp
// doesn't continue the conditional inline). So pages now has 5 members (was 4),
// submitPage's tags re-pin to storage-as-effect, and submitPageEmit joins the
// HasStateIO-inferred orchestrators.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { existsSync } from "fs";
import { pagesModule } from "./modules/pages";
import { receiptModule } from "./modules/receipt";
import { stdModule } from "./modules/std";
import { stateModule } from "./modules/state";
import { createRegistry } from "./registry";
import type { Instance, Constraint } from "./types";

// storage-as-effect Phase 4f (2026-06-19) — the page-lane TS collapse. The
// resolveFormFields helper + the GET {page, form} assembly + the recordType
// rebuild + the @fenel/core validate() + the configForBody/ip Maybe-marshalling
// are DELETED from pages.ts (the route is now a thin HTTP leaf). Their logic is
// PORTED into Fenel: the new `pages:pageView` (+ `pageViewOf`) serves the GET
// (mirror of types:formView), and submitPage folds in the typeRef resolution
// (types:resolveType — the system-entity arm covers the live `profile` page) +
// account-aware state:validateEntityInstance, factored as `submitPageCapture`
// → `submitPageCreate` → `submitPageEmit`, with a pure structured-error
// projector. So pages now has 10 members; the resolve/validate/
// create/emit chain all carry INFERRED HasStateIO; pageViewOf stays pure.
const PAGES_IDS = [
  "pages:pageView",
  "pages:pageViewOf",
  "pages:submitPage",
  "pages:submitPageCapture",
  "pages:pageValidationMessage",
  "pages:submitPageCreate",
  "pages:submitPageEmit",
  "pages:dispatchPageSubmittedIfFlow",
  "pages:pageResponse",
  "pages:pageThankYouMessage",
];
const RECEIPT_IDS = ["receipt:findReceiptLink", "receipt:normalizeReceiptLink"];

// Identity facets lifted from the retired `defineFunction` specs (codeName ===
// id-suffix for all — no @codeName needed). Labels + tags asserted byte-
// identical; descriptions asserted present (they ride the @description facet).
const FACETS: Record<string, { codeName: string; label: string; tags: string[] }> = {
  "pages:pageView": { codeName: "pageView", label: "Page view", tags: ["page", "view", "route", "storage-as-effect"] },
  "pages:pageViewOf": { codeName: "pageViewOf", label: "Page view (assemble)", tags: ["page", "view", "pure", "storage-as-effect"] },
  "pages:submitPage": { codeName: "submitPage", label: "Submit page", tags: ["page", "ingress", "route", "storage-as-effect", "field-identity"] },
  "pages:submitPageCapture": { codeName: "submitPageCapture", label: "Submit page (validate)", tags: ["page", "ingress", "validate", "storage-as-effect", "field-identity"] },
  "pages:pageValidationMessage": { codeName: "pageValidationMessage", label: "Page validation message", tags: ["page", "ingress", "validate", "field-identity"] },
  "pages:submitPageCreate": { codeName: "submitPageCreate", label: "Submit page (create)", tags: ["page", "ingress", "create", "storage-as-effect"] },
  "pages:submitPageEmit": { codeName: "submitPageEmit", label: "Submit page (emit)", tags: ["page", "ingress", "emit", "storage-as-effect"] },
  "pages:dispatchPageSubmittedIfFlow": { codeName: "dispatchPageSubmittedIfFlow", label: "Dispatch page-submitted if flow", tags: ["page", "pure", "phase-12c"] },
  "pages:pageResponse": { codeName: "pageResponse", label: "Page response", tags: ["page", "pure", "phase-12c"] },
  "pages:pageThankYouMessage": { codeName: "pageThankYouMessage", label: "Page thank-you message", tags: ["page", "pure", "phase-12c"] },
  "receipt:findReceiptLink": { codeName: "findReceiptLink", label: "Find receipt link", tags: ["receipt", "ingress", "route", "phase-12c"] },
  "receipt:normalizeReceiptLink": { codeName: "normalizeReceiptLink", label: "Normalize receipt link", tags: ["receipt", "pure", "phase-12c"] },
};

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

describe("pages/receipt dissolve — two SEPARATE semantic modules (no bundle)", () => {
  test("pagesModule is `pages` with exactly the 10 pages:* members", () => {
    expect(pagesModule.name).toBe("pages");
    expect((pagesModule.functions ?? []).map((f) => f.id).sort()).toEqual([...PAGES_IDS].sort());
  });

  test("receiptModule is `receipt` with exactly the 2 receipt:* members", () => {
    expect(receiptModule.name).toBe("receipt");
    expect((receiptModule.functions ?? []).map((f) => f.id).sort()).toEqual([...RECEIPT_IDS].sort());
  });

  test("the two modules are disjoint — no pages:* in receipt, no receipt:* in pages", () => {
    expect((pagesModule.functions ?? []).every((f) => f.id.startsWith("pages:"))).toBe(true);
    expect((receiptModule.functions ?? []).every((f) => f.id.startsWith("receipt:"))).toBe(true);
  });

  test("neither module carries entities (pure functions only)", () => {
    expect(pagesModule.entities ?? []).toHaveLength(0);
    expect(receiptModule.entities ?? []).toHaveLength(0);
  });
});

describe("pages/receipt dissolve — registry resolution by id + codeName", () => {
  const reg = createRegistry([stdModule, stateModule, pagesModule, receiptModule]);

  test("all 6 resolve by id", () => {
    for (const id of [...PAGES_IDS, ...RECEIPT_IDS]) {
      expect(reg.getFunction(id)).toBeDefined();
    }
  });

  test("all 6 resolve by codeName", () => {
    for (const [id, f] of Object.entries(FACETS)) {
      expect(reg.getFunctionByCodeName(f.codeName)?.id).toBe(id);
    }
  });
});

describe("pages/receipt dissolve — identity-facet parity (directives → ClassInstances)", () => {
  const insts = [...(pagesModule.instances ?? []), ...(receiptModule.instances ?? [])];

  test("Codeable: codeName is the unprefixed name for all 6", () => {
    for (const [id, f] of Object.entries(FACETS)) {
      expect(methodOf(insts, "Codeable", id)).toEqual({ codeName: f.codeName });
    }
  });

  test("Labelable + Taggable: byte-identical to the retired specs", () => {
    for (const [id, f] of Object.entries(FACETS)) {
      expect(methodOf(insts, "Labelable", id)).toEqual({ label: f.label });
      expect(methodOf(insts, "Taggable", id)).toEqual({ tags: f.tags });
    }
  });

  test("Describable: present for all 6 (rides the @description facet)", () => {
    for (const id of Object.keys(FACETS)) {
      const m = methodOf(insts, "Describable", id);
      expect(typeof m?.description).toBe("string");
      expect((m!.description as string).length).toBeGreaterThan(0);
    }
  });

  // Phase 3j (identity-as-fallback): no @category authored, so NONE carry a
  // stored Categorizable — the `pages` / `receipt` category derives at read
  // time from the id prefix. Law-neutral vs the retired category="pages"/"receipt".
  test("Categorizable: NONE stored — the dissolve drops the @category", () => {
    for (const id of Object.keys(FACETS)) {
      expect(methodOf(insts, "Categorizable", id)).toBeUndefined();
    }
  });
});

describe("pages/receipt dissolve — inferred HasStateIO on the orchestrators", () => {
  const reg = createRegistry([stdModule, stateModule, pagesModule, receiptModule]);
  const HAS_STATE_IO: Constraint[] = [{ class: { $tag: "Id", entityId: "HasStateIO" }, args: [{ $var: "scope" }] }];

  // storage-as-effect Phase 4f — the resolve→validate→create→emit submit chain
  // carries INFERRED HasStateIO, transitively reachable WITHIN this minimal
  // registry: submitPageCreate calls state:tryCreateInstanceByName directly, and
  // submitPageCapture → submitPageCreate, submitPage → submitPageCapture thread it
  // up; submitPageEmit calls state:appendEvent; dispatchPageSubmittedIfFlow calls
  // state:dispatchEventTriggers. (submitPage ALSO calls the cross-module
  // types:resolveType, but it reaches HasStateIO via the in-registry chain too.)
  test("the submitPage chain + dispatchPageSubmittedIfFlow carry HasStateIO (INFERRED)", () => {
    for (const id of [
      "pages:submitPage",
      "pages:submitPageCapture",
      "pages:submitPageCreate",
      "pages:submitPageEmit",
      "pages:dispatchPageSubmittedIfFlow",
    ]) {
      expect(reg.getFunction(id)?.requires).toEqual(HAS_STATE_IO);
    }
  });

  // pageView is OMITTED from both groups: its only effectful call is the
  // cross-module types:resolveType (NOT in this minimal [std,state,pages,receipt]
  // registry — including typesModule trips a Windows bun module-init TDZ on
  // type-catalog's `_extraEntities`). In the full production registry pageView
  // carries HasStateIO via resolveType; here it resolves to undefined (resolveType
  // is unresolved), so asserting it either way would be a registry artifact.
  test("the pure fns carry NO requires", () => {
    for (const id of ["pages:pageViewOf", "pages:pageValidationMessage", "pages:pageResponse", "pages:pageThankYouMessage", ...RECEIPT_IDS]) {
      expect(reg.getFunction(id)?.requires).toBeUndefined();
    }
  });
});

describe("Phase 2b — public page validation convergence", () => {
  test("pageViewOf carries the canonical type name for identified browser projection", () => {
    const body = JSON.stringify(pagesModule.functions?.find((f) => f.id === "pages:pageViewOf")?.body);
    expect(body).toContain('"typeName":{"var":"row.name"}');
    expect(body).toContain('"rootBinding":{"call":["publicTypeRootBinding",{"var":"row"}]}');
    expect(body).toContain('"type":{"var":"row.type"}');
  });

  test("submitPageCapture validates through the account registry and persists only the coerced value", () => {
    const body = JSON.stringify(pagesModule.functions?.find((f) => f.id === "pages:submitPageCapture")?.body);
    expect(body).toContain('"validateEntityInstance"');
    expect(body).toContain('"validation.value"');
    expect(body).toContain('"submitPageCreate"');
    expect(body).not.toContain('"validateValue"');
    expect(body).not.toContain('"schema"');
  });
});

describe("pages/receipt dissolve — the bundle is GONE", () => {
  test("engine/src/modules/public-surfaces.ts no longer exists", () => {
    expect(existsSync(new URL("./modules/public-surfaces.ts", import.meta.url))).toBe(false);
  });
});
