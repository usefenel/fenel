import type { LocusMenuItem } from "./locus-context-menu";
import type { DataInspectionMode } from "./DataInspectionDialog";
import { hasTextSelection, isNativeEditingTarget } from "./data-transfer/events";
import { QUICK_TYPE_CATEGORIES, QUICK_TYPE_SUBTYPES } from "./new-value-types";
import TYPE_ICON_FALLBACKS from "./type-icon-fallbacks.json";
import { typeIconForPresentation } from "./type-icon-presentation";

/** A quick type's icon is its type's icon, through the one shared resolver. */
const quickTypeIcon = (typeName: string) => typeIconForPresentation(undefined, { reflectedIdentity: typeName });

/** Opening a data outside this page: its address in a new tab or window, or
 * the reason it has none to open (shown as the disabled entries' tooltip). */
export type LocusOpenElsewhere = { open: (place: "tab" | "window") => void; unavailable?: string };

/** The same navigation actions on cards and path locations. */
export function locusOpenMenuItems(onOpen: () => void, onLens?: (mode: "stack" | "split") => void,
  onInspect?: (mode: DataInspectionMode) => void, elsewhere?: LocusOpenElsewhere): LocusMenuItem[] {
  return [
    { id: "open", label: "Open", icon: "arrow-right", onSelect: onOpen,
      children: onInspect ? [
        { id: "open-data", label: "Open data", icon: TYPE_ICON_FALLBACKS.Data, onSelect: () => onInspect("data") },
        { id: "open-expression", label: "Open expression", icon: "route", onSelect: () => onInspect("expression") },
        { id: "open-code", label: "Open code", icon: "code", onSelect: () => onInspect("code") },
        { id: "open-both", label: "Open data and expression", icon: "panels-top-left", onSelect: () => onInspect("both") },
      ] : undefined },
    ...(onLens ? [{ id: "open-lens", label: "Open in a new lens", icon: "panels-top-left",
      onSelect: () => onLens("stack"), children: [
        { id: "open-lens-stack", label: "Expand over this lens", icon: "layers", onSelect: () => onLens("stack") },
        { id: "open-lens-split", label: "Open beside this lens", icon: "layout-grid", onSelect: () => onLens("split") },
      ] }] : []),
    ...(elsewhere ? [
      { id: "open-tab", label: "Open in a new tab", icon: "external-link", disabled: !!elsewhere.unavailable,
        tooltip: elsewhere.unavailable, onSelect: () => elsewhere.open("tab") },
      { id: "open-window", label: "Open in a new window", icon: "app-window", disabled: !!elsewhere.unavailable,
        tooltip: elsewhere.unavailable, onSelect: () => elsewhere.open("window") },
    ] : []),
  ];
}

/** Shared by the lightweight canvas and the prepared workspace. On a data,
 * `beside` names what New does there: a sibling in the same container. */
export function locusNewMenu(onNew: () => void, onType: (typeName: string) => void,
  options: { beside?: boolean; onBranch?: (branch: "new:type" | "new:function") => void } = {}): LocusMenuItem {
  const quickTypes = QUICK_TYPE_CATEGORIES.slice(0, 2).flatMap((category) => category.types);
  return {
    id: "new", label: options.beside ? "New beside" : "New", icon: "plus", onSelect: onNew,
    children: [
      ...quickTypes.map((type): LocusMenuItem => ({
        id: `new:${type.name}`, label: type.label ?? (type.name === "String" ? "Text" : type.name),
        icon: quickTypeIcon(type.name),
        onSelect: () => onType(type.name),
        children: (QUICK_TYPE_SUBTYPES[type.name]?.length ?? 0) > 1
          ? QUICK_TYPE_SUBTYPES[type.name]!.map((subtype) => ({
            id: `new:${subtype.name}`, label: subtype.label ?? subtype.name, icon: quickTypeIcon(subtype.name),
            onSelect: () => onType(subtype.name),
          })) : undefined,
      })),
      // The full type picker, in the same section as the quick types.
      { id: "new:more", label: "More…", emphasis: true, onSelect: onNew },
      ...(options.onBranch ? [
        { id: "new:type", label: "Type", icon: quickTypeIcon("Type"), separatorBefore: true, onSelect: () => options.onBranch!("new:type") },
        { id: "new:function", label: "Function", icon: quickTypeIcon("Function"), onSelect: () => options.onBranch!("new:function") },
      ] : []),
    ],
  };
}

export function ownsLocusContextMenu(event: MouseEvent, allowModal = false): boolean {
  if (event.defaultPrevented || isNativeEditingTarget(event.target) || hasTextSelection()) return false;
  return !(event.target instanceof Element
    && event.target.closest(allowModal ? 'a[href], video, audio, [role="menu"]'
      : 'a[href], video, audio, .modal-overlay, [role="menu"]'));
}

export function locusContextPosition(event: MouseEvent): { x: number; y: number } {
  if (event.clientX || event.clientY) return { x: event.clientX, y: event.clientY };
  const rect = event.target instanceof Element ? event.target.getBoundingClientRect() : undefined;
  return { x: (rect?.left ?? 0) + 20, y: (rect?.top ?? 0) + 20 };
}
