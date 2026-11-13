import { registerAction } from "./registry";

// ===========================================================================
// Imports actions — action-subsumption Phase 3 (the body-residual bulk wave,
// 2026-06-08).
//
// The public action IS a typed Fenel function now (D1 COLLAPSE):
//   import_profiles → imports:importProfiles  (fenel/modules/imports/imports.fenel)
//
// The former TS handler (+ its `mapping ?? {}` / `tags ?? []` defaulting +
// `validateActionParams` call) is DELETED. Dispatch resolves it by name → fnRef,
// validates the incoming params against the function's own param-record
// (`paramRecordOf(fnRef)`, D2 — no `import_profiles_params` mirror entity),
// injects `adapter` (D4) + `accountId`, invokes the body, and maps the returned
// `ActionResult` ADT at the boundary. The `mapping ?? {}` / `tags ?? []`
// defaulting moved INTO the body (Fenel-first), over the public-named optional
// params; the DEFAULT_MAPPING merge residual stays body-side (withDefaultMapping).
// The vestigial `merge` field is dropped (validate is lenient on extra keys).
//
// This file is now just the explicit `name → fnRef` exposure list (D3).
// ===========================================================================

export function registerImportActions() {
  registerAction({
    name: "import_profiles",
    description: "Bulk import profiles from CSV or JSON",
    fnRef: "imports:importProfiles",
  });
}
