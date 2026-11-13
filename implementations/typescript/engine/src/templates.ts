// ---------------------------------------------------------------------------
// Built-in TypeViews
//
// Phase 11 moved the authored surface vocabulary and built-in TypeView data to
// `fenel/modules/engine/surface-library.fenel`. This file is the package
// compatibility adapter: it exposes the registry list while TypeScript stays
// out of surface semantics.
//
// The adapter is LAZY. Resolving the built-ins runs a Fenel body through the
// private engine harness, and the first such dispatch also materializes the
// registry's routing-table snapshot. Doing that at module-evaluation time made
// importing the package index (which re-exports `builtinTemplates`) a single
// ~1.8s main-thread task during cold browser startup, measured on the
// production build, even though the Home surface never renders a built-in
// TypeView. `builtinTemplates()` is therefore a function: nothing is dispatched
// until a caller actually needs the surface library.
//
// The 31 historical per-view constants (`textTemplate`, `itemDetailView`, …)
// were retired with this change. They were eager by construction, so they could
// not be part of a lazy adapter, and no code in the repository read them —
// `surfaceBuiltinTypeView(name)` in `./authoring/surface` is the accessor that
// replaced them.
// ---------------------------------------------------------------------------

import type { TypeView } from "./types";
// Import the browser require-target aggregator so `dispatchEngineBody` can
// build its harness when a caller does resolve the built-ins, without
// depending on the package index import order.
import "./engine-modules";
import { surfaceBuiltinTypeViews } from "./authoring/surface";

/** The Fenel-authored built-in TypeViews. Resolved on first call and cached by
 * `surfaceBuiltinTypeViews`; every call returns a fresh array. */
export function builtinTemplates(): TypeView[] {
  return surfaceBuiltinTypeViews();
}
