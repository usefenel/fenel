import type { FenelType } from "@fenel/engine/types";
import typeIconFallbacks from "./type-icon-fallbacks.json";

const TYPE_ICON_FALLBACKS: Record<string, string> = typeIconFallbacks;

/** Direct type identities are transport facts. Computed/anonymous types keep
 * their original witness; this boundary never guesses an application owner. */
export function presentedTypeTarget(type: FenelType | undefined): string | undefined {
  return type ? "$ref" in type ? type.$ref : "$opaque" in type ? type.$opaque.name : undefined : undefined;
}

/** Shared icon boundary for early, prepared and graph data. The owning reader
 * supplies scoped Iconable facts, reflection and already-projected kind/name
 * facts. Nominal projected misses never fall back to a different dispatch.
 * The existing asset remains the only generic icon fallback catalogue. */
export function typeIconForPresentation(type: FenelType | undefined, presentation: {
  icon?: (target: string | FenelType) => unknown;
  canonicalName?: (identity: string) => string | undefined;
  reflectedIdentity?: string;
  kindLabel?: string;
  knownIcons?: Readonly<Record<string, unknown>>;
} = {}): string {
  const declared = presentedTypeTarget(type);
  const identity = declared ?? presentation.reflectedIdentity;
  const target = declared ?? type ?? identity;
  const scoped = target ? presentation.icon?.(target) : undefined;
  const reflected = scoped === undefined && !declared && identity && target !== identity ? presentation.icon?.(identity) : undefined;
  const selected = scoped ?? reflected;
  if (typeof selected === "string" && selected && (!presentation.knownIcons || presentation.knownIcons[selected])) return selected;
  const name = identity ? presentation.canonicalName?.(identity) ?? identity : undefined;
  const kind = presentation.kindLabel ?? (type && "$record" in type ? "Record"
    : type && "$arrow" in type ? "Function" : undefined);
  return (name ? TYPE_ICON_FALLBACKS[name] : undefined)
    ?? (identity ? TYPE_ICON_FALLBACKS[identity] : undefined)
    ?? (kind ? TYPE_ICON_FALLBACKS[kind] : undefined) ?? TYPE_ICON_FALLBACKS.Type!;
}
