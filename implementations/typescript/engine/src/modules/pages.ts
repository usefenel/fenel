// ---------------------------------------------------------------------------
// Pages — module-substrate Phase 3n seam (the aggregation-DISSOLVE).
//
// `pages` is one of the two semantic modules that fall out of dissolving the
// retired `public-surfaces.ts` junk-drawer bundle (see `pages/pages.fenel`'s
// header for the full rationale). The ~177-LOC hand-merge — which loaded two
// `.fenel` files under throwaway internal names, hand-extracted every body by
// id, and re-wrapped each in a `defineFunction` spec — is GONE. Source of
// truth is `fenel/modules/pages/pages.fenel` (`module pages where` header + 4
// sigs + @label/@description/@tags facets; bodies unchanged). The `name` arg
// is a header-overridden fallback; the `HasStateIO` on the 2 orchestrators is
// inferred at registry build (the 3a precedent). Re-exported by name —
// the boot lists import `pagesModule` directly.
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { loadFenelModule } from "../fenel-module";
import PAGES_FENEL from "../../../../../fenel/modules/pages/pages.fenel?raw";

export const pagesModule: FenelModule = loadFenelModule(PAGES_FENEL, "pages", {
  label: "Pages",
});
