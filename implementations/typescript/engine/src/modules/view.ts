// ---------------------------------------------------------------------------
// View — the view-substrate's first coded slice (design/view-substrate.md,
// 2026-08-08). PURE module: entities (Viewport / Edge / Shape / Cell /
// ViewLayout / RenderPlan / Placement / Placed) + Fenel-bodied geometry, the `plan` lowering
// (layout value → render plan, CSS-vs-canvas decided IN FenEL), and the
// responsive demo, live `placeAll` canvas-data derivation, and generic
// identified-list edit commands. Query policy remains Fenel-bodied; the one
// context-reflection leaf reads an admitted inert reader metadata packet.
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { rekeyNativesById } from "../function-builder";
import { sourceMetadataNativesCtx } from "../../../../../fenel/modules/view/ffi/source-metadata";
import { loadFenelModule, loadFenelModuleUnion } from "../fenel-module";
import VIEW_SRC from "../../../../../fenel/modules/view/types.fenel?raw";
import LOCAL_DATA_SRC from "../../../../../fenel/modules/view/local-data.fenel?raw";
import SHORTCUTS_SRC from "../../../../../fenel/modules/view/shortcuts.fenel?raw";
import SUGGESTIONS_SRC from "../../../../../fenel/modules/view/suggestions.fenel?raw";
import ADDRESS_SRC from "../../../../../fenel/modules/view/address.fenel?raw";
import DEPENDENCIES_SRC from "../../../../../fenel/modules/view/dependencies.fenel?raw";
import CALENDAR_SRC from "../../../../../fenel/modules/view/calendar.fenel?raw";
import INSTANCES_SRC from "../../../../../fenel/modules/view/instances.fenel?raw";

const loaded = loadFenelModuleUnion([
  { src: VIEW_SRC, name: "view/types.fenel" },
  { src: LOCAL_DATA_SRC, name: "view/local-data.fenel" },
  { src: SHORTCUTS_SRC, name: "view/shortcuts.fenel" },
  { src: SUGGESTIONS_SRC, name: "view/suggestions.fenel" },
  { src: ADDRESS_SRC, name: "view/address.fenel" },
  { src: DEPENDENCIES_SRC, name: "view/dependencies.fenel" },
  { src: CALENDAR_SRC, name: "view/calendar.fenel" },
], { labels: { view: "View" } })[0]!;

export const viewModule: FenelModule = {
  ...loaded,
  nativeImplsCtx: rekeyNativesById(sourceMetadataNativesCtx, "view") as NonNullable<FenelModule["nativeImplsCtx"]>,
  instances: [...(loaded.instances ?? []),
    ...(loadFenelModule(INSTANCES_SRC, "view", { dispatchInstanceFile: true }).instances ?? [])],
};
