/** Keep text editing and layout drags in their native interaction paths. */
export function isNativeEditingTarget(target: EventTarget | null): boolean {
  return target instanceof Element && (!!target.closest('input, textarea, select, [role="textbox"]')
    || target instanceof HTMLElement && target.isContentEditable);
}

export function isDataTransfer(dt: DataTransfer | null, acceptSavedValue = false): boolean {
  if (!dt) return false;
  const types = Array.from(dt.types);
  if (acceptSavedValue && types.includes("application/x-fenel-savedexpr-id")) return true;
  // These payloads describe layout actions, not the value being transferred.
  if (types.some((type) => type === "application/x-fenel-pin"
    || type === "application/x-fenel-savedexpr-id"
    || type === "application/x-fenel-layout-item")) return false;
  return types.some((type) => type === "Files" || type === "text/plain"
    || type === "text/html" || type === "text/uri-list"
    || type.startsWith("application/x-fenel-value"));
}

export function ownsTransferEvent(event: Event, target: Element): boolean {
  if (event.defaultPrevented || isNativeEditingTarget(event.target)) return false;
  const origin = event.target instanceof Element ? event.target : target;
  return origin.closest("[data-fenel-transfer-target]") === target;
}

export function hasTextSelection(): boolean {
  return typeof window !== "undefined" && !!window.getSelection()?.toString();
}

/** A data card opens only from its own read surface, keeping nested browser
 * controls and text selection with their existing activation owners. */
export function ownsDataOpenEvent(event: MouseEvent, surface: Element): boolean {
  if (event.defaultPrevented || isNativeEditingTarget(event.target) || hasTextSelection()) return false;
  const control = event.target instanceof Element
    ? event.target.closest('button, a[href], label, summary, video, audio, [role="button"], [role="link"], [role="menu"], [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"], [role="tab"], [role="option"]') : null;
  return !control || control === surface || !surface.contains(control);
}
