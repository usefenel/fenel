// ---------------------------------------------------------------------------
// License — typed-function-references FenelModule-retirement Phase FM-retire-1b
// seam.
//
// The 2 `defineFunction` specs + the ~80 LOC of exported TS algebra
// (`composeLicenses` / `computeEffectiveLicense` + the `LicenseValue` /
// `CompositionResult` / `LicenseTag` types + the `PERMISSIVENESS` / `COPYLEFT` /
// `WEAK_COPYLEFT` / `COPYLEFT_INCOMPATIBLE` tables) are RETIRED. The decision
// gate resolved to PORT (the Fenel-first HARD RULE: pure 8-case ADT composition
// MUST be Fenel; it is roadmapped, not dead — `design/per-node-permissions.md` +
// `design/cross-format-references.md` + TODO's FenelCheck license propagation
// build on it; the port makes the formerly-dead bodyless `check_license_compat`
// stub LIVE for the first time).
//
// Source of truth:
//   - `fenel/modules/license/license.fenel` — `module license where` header +
//     the algebra (`composeLicenses` + `check_license_compat` + pure helpers)
//     + `compute_rev_share` (the former standalone `compute-rev-share.fenel`,
//     now consolidated in) + identity facets.
//   - `fenel/modules/license/types.fenel`   — the `License` 8-case ADT + the
//     `Rate` named atom, loaded structurally (entities ride the catalog walk).
//
// `check_license_compat` is redesigned to the canonical `[License] -> Result
// String License` (was a faux-`Result` `{ ok, license, error }` over String
// licenses); `compute_rev_share`'s return is the real 3-field record (was the
// `-> {}` empty-record placeholder in the .fenel; the live TS spec declared the
// real shape). 0 `defineFunction`. The `licenseType` re-export STAYS (the
// catalog + the frontend StepEditor import it by name). The export name
// `licenseModule` is preserved → 0 boot-list / consumer edits.
// ---------------------------------------------------------------------------

import type { FenelModule, FenelType } from "../types";
import { loadFenelModule } from "../fenel-module";
import LICENSE_FENEL from "../../../../../fenel/modules/license/license.fenel?raw";
import TYPES_FENEL from "../../../../../fenel/modules/license/types.fenel?raw";

// The algebra — `module license where` header + the Fenel-bodied functions
// (`composeLicenses` / `check_license_compat` / `compute_rev_share` + pure
// helpers `licenseTag` / `permissiveness` / `incompatMessage` / `composeRevShare`)
// + their identity facets.
const loaded = loadFenelModule(LICENSE_FENEL, "license", { label: "Licensing" });

// The `License` ADT + the `Rate` named atom, loaded structurally. License is a
// function-internal type — values flow through the composition algebra, no JSONB
// row stores a License instance; the parser-derived Codeable/Labelable defaults
// from `loadFenelModule` are sufficient.
const typesModule = loadFenelModule(TYPES_FENEL, "license");

// Re-exported by name: the catalog (`licenseModule.entities` → `entity:License`)
// + the frontend `StepEditor` import `licenseType` directly. Identity check (the
// same reference the `.fenel` loader returned, not a copy).
export const licenseType: FenelType = typesModule.entities!.find(
  (e) => e.id === "License",
)!.type;

export const licenseModule: FenelModule = {
  name: "license",
  label: loaded.label,
  functions: loaded.functions,
  instances: loaded.instances,
  entities: [
    ...(typesModule.entities ?? []),
    ...(loaded.entities ?? []),
  ],
};
