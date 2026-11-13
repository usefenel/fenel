// ---------------------------------------------------------------------------
// runtime — pure runtime helpers expressed as Fenel bodies.
//
// typed-function-references Phase FM-retire-5 Step 5b (2026-06-06) — the
// `FenelModule`-retirement port. The ~616-LOC hand-assembled module (23
// `defineFunction` specs that loaded the 4 body files under throwaway prefixes
// and re-IDed them to `runtime:`) is RETIRED. Source of truth is now the 4
// `.fenel` body files themselves — each carries a `module runtime where` header
// + per-fn signatures + identity facets (@label/@description/@tags; @category
// "runtime-internal" on the internal helpers, derived "runtime" on the surfaced
// fns). They UNION into the one `runtime` module via loadFenelModuleUnion (the
// auth/forms multi-file-header precedent). 0 `defineFunction`; the fn ids stay
// `runtime:<fn>` (the engine-bodies-dispatch.ts pure pass + the runtime-side
// dispatched wrappers + the self-host matrix all dispatch by that id).
//
// The 4 body files + their concerns:
//   - pure-algos.fenel — triggerMatches + pureAlgoCheckFilter (+ TmInput /
//     TmFilter ADTs)
//   - codecs.fenel     — camelCase↔snake_case wire codec (+ CodecValue /
//     CodecPair ADTs)
//   - mime.fenel       — RFC 2045 / RFC 5322 MIME helpers (+ QpStep ADT)
//   - triggers.fenel   — the durable event-router's pure decision logic +
//     loop folds (+ EmField / EmInput ADTs)
//
// The module lives in `engine/src/modules/` (not `runtime/src/`) because the
// dispatch harness in `engine-bodies-dispatch.ts` builds its registry from
// engine-side modules, and "runtime" here means the durable-function runtime
// semantics layer — still conceptually inside the language substrate.
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { loadFenelModuleUnion } from "../fenel-module";
import PURE_ALGOS_FENEL from "../../../../../fenel/modules/runtime/pure-algos.fenel?raw";
import CODECS_FENEL from "../../../../../fenel/modules/runtime/codecs.fenel?raw";
import MIME_FENEL from "../../../../../fenel/modules/runtime/mime.fenel?raw";
import TRIGGERS_FENEL from "../../../../../fenel/modules/runtime/triggers.fenel?raw";

// All 4 files share the `module runtime where` header → loadFenelModuleUnion
// merges them into one `runtime` group (functions ∪ entities ∪ instances), in
// first-seen order. The lone group is the runtime module.
export const runtimeModule: FenelModule = loadFenelModuleUnion(
  [
    { src: PURE_ALGOS_FENEL, name: "runtime-pure-algos" },
    { src: CODECS_FENEL, name: "runtime-codecs" },
    { src: MIME_FENEL, name: "runtime-mime" },
    { src: TRIGGERS_FENEL, name: "runtime-triggers" },
  ],
  { labels: { runtime: "Runtime (Fenel-bodied runtime helpers)" } },
)[0]!;

// browser-engine-compat Phase 1b: self-register this module's live namespace so
// engineRequire("modules/runtime") resolves even at EVAL-TIME (a caller that statically imports
// this module runs its own eval-time builder calls AFTER this module is fully loaded,
// i.e. before the index.ts aggregator runs). See engine-require.ts.
import * as __self_modules_runtime from "./runtime";
import { registerEngineModule as __reg_modules_runtime } from "../engine-require";
__reg_modules_runtime("modules/runtime", __self_modules_runtime);
