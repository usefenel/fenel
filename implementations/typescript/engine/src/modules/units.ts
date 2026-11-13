// A2/B3: load the one source catalogue and its ordinary Fenel definitions.
// This file supplies only the existing FenelType dollar-key marshalling seam.
import { loadFenelModuleUnion } from "../fenel-module";
import type { FenelType, SetExpr } from "../types";
import { setExprAsType } from "../type-foundation";
import TYPES from "../../../../../fenel/modules/units/types.fenel?raw";
import CATALOGUE from "../../../../../fenel/modules/units/catalogue.fenel?raw";
import FUNCTIONS from "../../../../../fenel/modules/units/units.fenel?raw";

const source = loadFenelModuleUnion([
  { src: TYPES, name: "types.fenel" },
  { src: CATALOGUE, name: "catalogue.fenel", opts: { dispatchInstanceFile: true } },
  { src: FUNCTIONS, name: "units.fenel" },
])[0]!;

export const unitsModule = {
  ...source,
  nativeImpls: {
    "units:unitTypeFromSet": (base: unknown, set: unknown) => setExprAsType(base as FenelType, set as SetExpr),
  },
};
