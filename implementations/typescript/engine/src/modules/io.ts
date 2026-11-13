// ---------------------------------------------------------------------------
// IO Primitives — typed-function-references FenelModule-retirement Phase
// FM-retire-1 seam (the warm-up port).
//
// The ~164-LOC hand-written `defineFunction` spec wrapper is RETIRED; source of
// truth is `fenel/modules/io/io.fenel` — a `module io where` header + 8 bodyless
// `@native` foreign decls (6 evaluator-backed primitives + `random_hex` /
// `env_get`, the two carrying `@ioAction` so the registry routes them to the
// `io.random_hex` / `io.env_get` IO handlers in `runtime/src/evaluator.ts`).
// The `randomHex` / `envGet` codeName divergences ride `@codeName`.
//
// Plain module (the `control` precedent): NO `ffi/` leaf, NO `nativeImpls` map,
// NO capability / creds / providers / instances / entities. The per-param
// `default: Nothing` boilerplate VANISHES (no `.fenel` syntax emits it). The
// `io` category derives at read time from the `io:` id prefix (Phase 3j). The
// export name `ioModule` is preserved → 0 boot-list / consumer edits.
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { loadFenelModule } from "../fenel-module";
import IO_FENEL from "../../../../../fenel/modules/io/io.fenel?raw";

export const ioModule: FenelModule = loadFenelModule(IO_FENEL, "io", {
  label: "IO Primitives",
});
