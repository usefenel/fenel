import { TransferError, TRANSFER_LIMITS } from "./types";

/** templates.Markup is the registered application ADT (see templates/types.fenel). */
export type ImportedMarkup =
  | { $tag: "Text"; content: string }
  | { $tag: "Bold" | "Italic"; child: ImportedMarkup }
  | { $tag: "Link"; url: string; child: ImportedMarkup }
  | { $tag: "Image"; src: string; alt: string }
  | { $tag: "Heading"; level: number; child: ImportedMarkup }
  | { $tag: "Paragraph" | "Fragment"; children: ImportedMarkup[] }
  | { $tag: "List"; ordered: boolean; items: ImportedMarkup[] };

const OMIT = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "TEMPLATE", "NOSCRIPT", "HEAD", "META", "LINK", "BASE", "SVG", "MATH"]);
const BLOCK = new Set(["P", "DIV", "SECTION", "ARTICLE", "BLOCKQUOTE", "PRE", "LI", "TD", "TH"]);

function safeUrl(raw: string | null, image = false): string | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  if (/^(?:https?:\/\/)/i.test(value) || (!image && /^(?:mailto:|tel:|#)/i.test(value))) return value;
  if (image && /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i.test(value)) return value;
  return undefined;
}

export function markupFromHtml(html: string): ImportedMarkup {
  if (html.length > TRANSFER_LIMITS.textCharacters) throw new TransferError("This formatted text is too large to paste at once.");
  if (typeof DOMParser === "undefined") throw new TransferError("Formatted text import is unavailable in this browser. Paste plain text instead.");
  // The detached inert document is never inserted into the page. Only the
  // explicit data cases below survive, without event handlers, CSS or code.
  const document = new DOMParser().parseFromString(html, "text/html");
  let count = 0;
  const fragment = (children: ImportedMarkup[]): ImportedMarkup => children.length === 1 ? children[0]! : { $tag: "Fragment", children };
  function children(node: Node, depth: number): ImportedMarkup[] {
    return Array.from(node.childNodes).flatMap((child) => visit(child, depth + 1));
  }
  function visit(node: Node, depth: number): ImportedMarkup[] {
    if (++count > 50_000 || depth > TRANSFER_LIMITS.depth) throw new TransferError("This formatted text is too large or too deeply nested to import.");
    if (node.nodeType === 3) return node.textContent ? [{ $tag: "Text", content: node.textContent }] : [];
    if (node.nodeType !== 1) return [];
    const element = node as Element;
    const tag = element.tagName.toUpperCase();
    if (OMIT.has(tag)) return [];
    if (tag === "IMG") {
      const src = safeUrl(element.getAttribute("src"), true);
      return src ? [{ $tag: "Image", src, alt: element.getAttribute("alt") ?? "" }]
        : element.getAttribute("alt") ? [{ $tag: "Text", content: element.getAttribute("alt")! }] : [];
    }
    if (tag === "BR") return [{ $tag: "Text", content: "\n" }];
    const content = children(element, depth);
    if (tag === "B" || tag === "STRONG") return [{ $tag: "Bold", child: fragment(content) }];
    if (tag === "I" || tag === "EM") return [{ $tag: "Italic", child: fragment(content) }];
    if (tag === "A") {
      const url = safeUrl(element.getAttribute("href"));
      return url ? [{ $tag: "Link", url, child: fragment(content) }] : content;
    }
    if (/^H[1-6]$/.test(tag)) return [{ $tag: "Heading", level: Number(tag[1]), child: fragment(content) }];
    if (tag === "UL" || tag === "OL") return [{ $tag: "List", ordered: tag === "OL", items: content }];
    if (BLOCK.has(tag)) return [{ $tag: "Paragraph", children: content }];
    return content;
  }
  return fragment(children(document.body, 0));
}
