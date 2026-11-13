// ---------------------------------------------------------------------------
// Templates — typed-function-references FenelModule-retirement Phase
// FM-retire-1 seam (the warm-up port).
//
// The 4 `defineFunction` specs in the ~156-LOC hand-written wrapper are RETIRED;
// source of truth is `fenel/modules/templates/templates.fenel` — a `module
// templates where` header + the 4 fn decls (`render_template` + 3 bodyless
// `@native` `markup_to_*` dispatch stubs) + the `RenderFormat` named atom (the
// `format` param's refinement, extracted path-(b) — the parser rejects inline
// `|`-refinement at param position; same workaround as `HeadingLevel`).
//
// The two existing sidecars are KEPT and loaded exactly as before:
//   - `types.fenel`     — `Markup` (10-case recursive ADT) + `HeadingLevel`
//     (refined-Number atom), via `loadFenelModule` (Phase 4c).
//   - `instances.fenel` — the 4 `Renderable` provider instances as `.fenel`
//     value-decls (point-free `render = markup_to_*` → `{$ref}` handle), via
//     `{dispatchInstanceFile: true}` (Phase 10c).
// The `Renderable` class SEED is NOT built here — it derives from the `.fenel`
// class record in `system-entities.ts` `pureClasses` (Phase 7f); this seam only
// contributes the 4 instances + the 4 function specs + the entities.
//
// NO-CORNER-CUT FIX (FM-retire-1): the 3 `markup` params were
// `{$record:{fields:[]}}` empty-record placeholders; they are now the declared
// `Markup` type (chips 3 off the 97-placeholder baseline). `render_template`'s
// `context` stays `{}` (genuinely dynamic). The per-param `default: Nothing`
// boilerplate VANISHES; the `templates` category derives from the `templates:`
// id prefix (Phase 3j). The export name `templateModule` is preserved → 0
// consumer edits.
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { loadFenelModule } from "../fenel-module";
import { Just } from "../type-foundation";
import TEMPLATES_FENEL from "../../../../../fenel/modules/templates/templates.fenel?raw";
import TYPES_FENEL from "../../../../../fenel/modules/templates/types.fenel?raw";
import TEMPLATES_INSTANCES_SRC from "../../../../../fenel/modules/templates/instances.fenel?raw";

// Functions + identity facets + the RenderFormat entity (from templates.fenel).
const loaded = loadFenelModule(TEMPLATES_FENEL, "templates", { label: "Templates" });

// Markup / HeadingLevel entities, loaded structurally (Phase 4c).
const typesModule = loadFenelModule(TYPES_FENEL, "templates");

// The 4 Renderable dispatch instances (Phase 10c).
const renderableInstances =
  loadFenelModule(TEMPLATES_INSTANCES_SRC, "templates", { dispatchInstanceFile: true }).instances ?? [];

export const templateModule: FenelModule = {
  name: "templates",
  label: Just("Templates"),
  functions: loaded.functions,
  instances: [
    ...renderableInstances,
    ...(loaded.instances ?? []),
  ],
  entities: [
    ...(typesModule.entities ?? []),
    ...(loaded.entities ?? []),
  ],
};
