// ---------------------------------------------------------------------------
// Control Flow — module-substrate Phase 3q seam.
//
// `control` is the other half of the "signature-only pair" Surprise #30
// DEFERRED at Phase 3k. The ~255-LOC hand-written `defineFunction` spec
// wrapper is RETIRED; source of truth is `fenel/modules/control/control.fenel`
// — a `module control where` header + 12 bodyless `@native` foreign decls
// (8 wrappers + 4 iteration helpers), backed by the evaluator's IO handlers in
// `runtime/src/evaluator.ts`.
//
// THE FIRST defaultable-subsumption default-drop: the retired spec's per-param
// `default` values (maxAttempts=3, backoffMs=1000, concurrency=Infinity,
// maxIterations=1000, level="info", fallback=undefined, args={}) were all
// confirmed RUNTIME-DEAD (each native owns its own `?? default` fallback) and
// are simply DROPPED — no `@default` directive (the guardrail).
//
// Plain module: NO `ffi/` leaf, NO `nativeImpls` map, NO capability / creds /
// providers / instances / entities. The export name `controlModule` is
// preserved → 0 boot-list / consumer edits.
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { loadFenelModule } from "../fenel-module";
import CONTROL_FENEL from "../../../../../fenel/modules/control/control.fenel?raw";

export const controlModule: FenelModule = loadFenelModule(CONTROL_FENEL, "control", {
  label: "Control Flow",
});
