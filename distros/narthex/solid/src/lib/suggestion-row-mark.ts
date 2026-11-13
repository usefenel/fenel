// A Suggestions row's leading mark (owner review, Nov 11): "just show the type
// of the output, not the 'f', because everything there is a function". The
// mark is the icon of the type the function returns for this data, the same
// icon a value of that type shows; its name is a quiet chip beside the title,
// on desktop as on a phone. Pure; `related-data-panels.tsx` renders it.

import type { FenelType } from "@fenel/engine/types";
import typeIconFallbacks from "./type-icon-fallbacks.json";

const NEUTRAL_TYPE_ICON = (typeIconFallbacks as Record<string, string>).Type;

export type SuggestionRowMark = {
  /** The result type's icon; none when the result type is unknown. */
  icon: string | undefined;
  /** The result type's name for the chip; none until the reader answers it. */
  typeLabel: string | undefined;
};

/** `presented` is the reader's presentation of `resultType` (label and icon),
 * undefined while it is pending. The function's own `@icon` is deliberately
 * not an input: it never replaces the type's icon. */
export function suggestionRowMark(resultType: FenelType | undefined,
  presented: { label?: string; icon?: string } | undefined,
  knownIcons: Readonly<Record<string, unknown>>): SuggestionRowMark {
  if (!resultType) return { icon: undefined, typeLabel: undefined };
  const icon = presented?.icon && knownIcons[presented.icon] ? presented.icon : NEUTRAL_TYPE_ICON;
  return { icon, typeLabel: presented?.label || undefined };
}
