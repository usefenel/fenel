// ---------------------------------------------------------------------------
// Receipt — module-substrate Phase 3n seam (the aggregation-DISSOLVE).
//
// `receipt` is the second semantic module from dissolving the retired
// `public-surfaces.ts` junk-drawer bundle (see `receipt/receipt.fenel`'s
// header for the full rationale). Source of truth is
// `fenel/modules/receipt/receipt.fenel` (`module receipt where` header + 2
// sigs + @label/@description/@tags facets; bodies unchanged). Both fns are
// pure — no `@ioAction`, no inferred requires. Re-exported by name — the boot
// lists import `receiptModule` directly.
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { loadFenelModule } from "../fenel-module";
import RECEIPT_FENEL from "../../../../../fenel/modules/receipt/receipt.fenel?raw";

export const receiptModule: FenelModule = loadFenelModule(RECEIPT_FENEL, "receipt", {
  label: "Receipt",
});
