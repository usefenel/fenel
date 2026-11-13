// A read value that is an address the reader may open (Nov 12, Rom: "A URL type
// should automatically give us in the UX a link. Hyperlinks are the basis of
// the web."). Decided by the value's TYPE: a String refined by a `format:url`
// set (`UrlStr`, through any named alias) opens over http(s); one refined by
// `format:email` (`EmailStr`) opens with `mailto:`. Only where no type is known
// does the chips' address test decide (an http(s) address written in full).
// Whatever the type says, only `http:`, `https:` and `mailto:` become anchors:
// any other scheme (`javascript:`, `data:`, `file:`) stays text.
// Solid/browser renderer allowance — presentation adapter, same kind as collection-chips.ts.
import type { FenelType } from "@fenel/engine/types";
import { peelSetExpr } from "@fenel/engine/set-marker";
import { chipHref } from "./collection-chips";

export type WebLink = { href: string; kind: "web" | "mail" };

const WEB = /^https?:\/\/[^\s/?#]+[^\s]*$/i;
// One address, no header or query part (`?cc=`), no second recipient.
const MAIL = /^[^\s@:/?#,;<>"]+@[^\s@:/?#,;<>"]+\.[^\s@:/?#,;<>".]+$/;

/** The format sets a String type promises (`format:url`, `format:email`, ...):
 * a refinement's own set, each branch of an intersection, through named
 * aliases and nested refinements. A union promises none of its branches. */
export function stringFormats(type: FenelType | undefined, resolve?: (name: string) => FenelType | undefined, depth = 0): string[] {
  if (!type || typeof type !== "object" || depth > 8) return [];
  const record = type as unknown as Record<string, unknown>;
  if (typeof record.$ref === "string") {
    let resolved: FenelType | undefined;
    try { resolved = resolve?.(record.$ref); } catch { resolved = undefined; }
    return resolved && resolved !== type ? stringFormats(resolved, resolve, depth + 1) : [];
  }
  const refined = record.$refined as { base?: FenelType; set?: unknown } | undefined;
  if (!refined || typeof refined !== "object") return [];
  const handles: string[] = [];
  const collect = (set: unknown, level: number) => {
    const view = level > 8 ? null : peelSetExpr(set);
    if (view?.kind === "SeRef") handles.push(view.handle);
    else if (view?.kind === "SeIntersect") for (const branch of view.branches) collect(branch, level + 1);
  };
  collect(refined.set, 0);
  return [...handles, ...stringFormats(refined.base, resolve, depth + 1)];
}

/** The anchor a read value opens, or undefined for text. `typed` says whether
 * the reader knows the value's type: then only the type decides. */
export function webLink(value: unknown, type: FenelType | undefined, resolve?: (name: string) => FenelType | undefined): WebLink | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text || /[\u0000-\u001f\u007f]/.test(text)) return undefined;
  if (type === undefined) {
    const href = chipHref(text);
    return href && WEB.test(href) ? { href, kind: "web" } : undefined;
  }
  const formats = stringFormats(type, resolve);
  if (formats.some(format => format === "format:url" || format.startsWith("format:url:"))) {
    return WEB.test(text) ? { href: text, kind: "web" } : undefined;
  }
  if (formats.includes("format:email")) {
    return MAIL.test(text) ? { href: `mailto:${text}`, kind: "mail" } : undefined;
  }
  return undefined;
}
