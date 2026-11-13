// ---------------------------------------------------------------------------
// value-domain — collapse a FenelType to the coarse domain a SetExpr-style
// editor (or any constraint UI) needs: "string" | "number" | "date" | "any".
//
// Peels refinements, optionality, opacity, and phantom tags down to whatever
// atom decides the value's shape. `$el` (the unified dependent-type
// substrate) is opaque without a context — callers needing late-bound type
// resolution should `peelEl(type, ctx)` first and then call `valueDomain`.
// ---------------------------------------------------------------------------

import type { FenelType } from "./types";
import { peelMaybe } from "./set-algebra";
import { refHandle } from "./type-foundation";

export type ValueDomain = "string" | "number" | "date" | "any";

export function valueDomain(type: FenelType): ValueDomain {
  const t = peel(type);
  // 7g-retire-2 fold: the atom handle may be `{$named:X}` or its `{$ref:X}` twin.
  const name = refHandle(t);
  if (name !== undefined) {
    switch (name) {
      case "String":
      case "Markup":
        return "string";
      case "Number":
      case "Integer":
      case "Natural":
      case "Rational":
        return "number";
      case "Date":
      case "DateTime":
      case "Time":
        return "date";
    }
  }
  return "any";
}

function peel(type: FenelType): FenelType {
  let t = type;
  if ("$refined" in t) return peel(t.$refined.base);
  const maybe = peelMaybe(t);
  if (maybe) return peel(maybe.value);
  if ("$tagged" in t) return peel(t.$tagged.value);
  if ("$opaque" in t && t.$opaque.pure) return peel(t.$opaque.pure);
  return t;
}
