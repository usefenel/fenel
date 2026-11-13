// ---------------------------------------------------------------------------
// Markup — universal XML/HTML substrate as a FenelType
//
// Markup is a tree of Element + Text nodes. Pure XML/JSX/Hiccup substrate; no
// notion of "HTML" or "email" or "Telegram." Each rendering target (HTML
// email, Telegram message, Discord embed, ...) is a constrained subset of
// Markup, expressed as a named SetExpr predicate over the value tree.
//
//   Markup = μM. Element { tag: String, attrs: List(Attr), children: List(M) }
//          | Text   { value: String }
//   Attr   = { key: String, value: String }
//
// Subset families register under "markup:<dialect>" — the same $named registry
// that hosts format presets like "format:date:us". Subset-checking decides
// "can this Markup tree render as HTML email / Telegram / ..." via the same
// engine that decides string format compatibility.
// ---------------------------------------------------------------------------

import type { FenelType } from "./types";
import { registerNamedSet } from "./set-algebra";
import { List, Nothing } from "./type-foundation";

// ---------------------------------------------------------------------------
// FenelType
// ---------------------------------------------------------------------------

export const Attr: FenelType = {
  $record: {
    fields: [
      { name: "key",   label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
      { name: "value", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
    ],
  },
};

export const Markup: FenelType = {
  $mu: {
    var: "M",
    body: {
      $variant: {
        cases: [
          {
            name: "Element",
            label: Nothing,
            fields: [
              { name: "tag",      label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
              { name: "attrs",    label: Nothing, type: List(Attr), meta: {}, ui: Nothing },
              { name: "children", label: Nothing, type: List({ $var: "M" }), meta: {}, ui: Nothing },
            ],
          },
          {
            name: "Text",
            label: Nothing,
            fields: [
              { name: "value", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
            ],
          },
        ],
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Runtime value helpers
// ---------------------------------------------------------------------------

export type AttrValue = { key: string; value: string };

export type MarkupValue =
  | { $tag: "Element"; tag: string; attrs: AttrValue[]; children: MarkupValue[] }
  | { $tag: "Text"; value: string };

export function elem(
  tag: string,
  attrs: Record<string, string> | AttrValue[] = {},
  children: MarkupValue[] = [],
): MarkupValue {
  const attrList: AttrValue[] = Array.isArray(attrs)
    ? attrs
    : Object.entries(attrs).map(([key, value]) => ({ key, value }));
  return { $tag: "Element", tag, attrs: attrList, children };
}

export function text(value: string): MarkupValue {
  return { $tag: "Text", value };
}

export function isMarkupValue(v: unknown): v is MarkupValue {
  if (typeof v !== "object" || v === null) return false;
  const c = (v as { $tag?: unknown }).$tag;
  return c === "Element" || c === "Text";
}

/** Get a single attribute value by key. Returns undefined if absent. */
export function getAttr(node: MarkupValue, key: string): string | undefined {
  if (node.$tag !== "Element") return undefined;
  for (const a of node.attrs) if (a.key === key) return a.value;
  return undefined;
}

/** Set or replace an attribute by key, returning a new node. */
export function setAttr(node: MarkupValue, key: string, value: string): MarkupValue {
  if (node.$tag !== "Element") return node;
  const next: AttrValue[] = [];
  let found = false;
  for (const a of node.attrs) {
    if (a.key === key) { next.push({ key, value }); found = true; }
    else next.push(a);
  }
  if (!found) next.push({ key, value });
  return { ...node, attrs: next };
}

// ---------------------------------------------------------------------------
// Subset families — allowed tag sets per render target
// ---------------------------------------------------------------------------

/**
 * Conservative tag set that works in ~all email clients including legacy
 * Outlook (2003-2019). Tables for layout, inline styles only. The "safe"
 * baseline; richer subsets live alongside.
 */
export const HTML_EMAIL_UNIVERSAL_TAGS: ReadonlySet<string> = new Set([
  // Document scaffolding (root + head)
  "html", "head", "body", "title", "meta", "style",
  // Tables — required for layout in legacy clients
  "table", "thead", "tbody", "tr", "td", "th",
  // Block
  "div", "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "blockquote", "pre", "hr",
  // Inline
  "a", "span", "b", "strong", "i", "em", "u", "s",
  "br", "img", "small", "sub", "sup",
  "font", "center",
]);

/**
 * Modern email clients (Gmail web, Apple Mail, iOS Mail, recent Outlook).
 * Drops the must-be-tables constraint — divs and modern semantics work.
 */
export const HTML_EMAIL_MODERN_TAGS: ReadonlySet<string> = new Set([
  ...HTML_EMAIL_UNIVERSAL_TAGS,
  "section", "article", "header", "footer", "nav", "main", "aside",
  "figure", "figcaption", "details", "summary",
  "code", "kbd", "var", "mark",
]);

/**
 * Telegram message HTML — very small subset.
 * https://core.telegram.org/bots/api#html-style
 */
export const TELEGRAM_HTML_TAGS: ReadonlySet<string> = new Set([
  "b", "strong", "i", "em", "u", "ins", "s", "strike", "del",
  "a", "code", "pre", "blockquote", "tg-spoiler",
]);

/** Registry of named markup subsets, keyed by dialect name. */
export const MARKUP_SUBSETS: Record<string, ReadonlySet<string>> = {
  "markup:html-email:universal": HTML_EMAIL_UNIVERSAL_TAGS,
  "markup:html-email:modern":    HTML_EMAIL_MODERN_TAGS,
  "markup:telegram-html":        TELEGRAM_HTML_TAGS,
};

/**
 * Predicate: every Element in the tree uses a tag in `allowed`. Text nodes
 * always pass. Non-Markup shapes fail.
 */
function allowedTagsPredicate(allowed: ReadonlySet<string>) {
  return function check(v: unknown): boolean {
    if (!isMarkupValue(v)) return false;
    if (v.$tag === "Text") return true;
    if (!allowed.has(v.tag)) return false;
    for (const c of v.children) if (!check(c)) return false;
    return true;
  };
}

// Register subsets in the engine's $named set registry. Any SetExpr can be
// `{ $named: "markup:..." }` and `contains` will dispatch to these.
for (const [name, tags] of Object.entries(MARKUP_SUBSETS)) {
  registerNamedSet(name, allowedTagsPredicate(tags));
}

// ---------------------------------------------------------------------------
// Subset analysis — which named subsets does a given value belong to?
// ---------------------------------------------------------------------------

/** Collect every distinct tag used in `node` (Text contributes nothing). */
export function collectTags(node: MarkupValue, into: Set<string> = new Set()): Set<string> {
  if (node.$tag === "Element") {
    into.add(node.tag);
    for (const c of node.children) collectTags(c, into);
  }
  return into;
}

/**
 * For a given Markup value, return the set of registered subset names that
 * accept it. Useful for the editor's "deliverable to: …" indicator.
 */
export function compatibleSubsets(node: MarkupValue): string[] {
  const used = collectTags(node);
  const out: string[] = [];
  for (const [name, tags] of Object.entries(MARKUP_SUBSETS)) {
    let ok = true;
    for (const t of used) if (!tags.has(t)) { ok = false; break; }
    if (ok) out.push(name);
  }
  return out;
}

/**
 * For a given Markup value and a target subset, return the tags it uses that
 * the subset disallows. Empty list = compatible.
 */
export function offendingTags(node: MarkupValue, subset: string): string[] {
  const tags = MARKUP_SUBSETS[subset];
  if (!tags) return [];
  const used = collectTags(node);
  const out: string[] = [];
  for (const t of used) if (!tags.has(t)) out.push(t);
  return out;
}

// ---------------------------------------------------------------------------
// Serialization — Markup → HTML string
//
// Pure: takes an evaluated MarkupValue (no expressions, no holes) and emits a
// well-formed HTML string. Substitution of typed-ref params happens upstream
// at expression-evaluation time; this serializer only sees pure values.
//
// Void elements (br, hr, img, …) are emitted self-closing.
// Text content is escaped against `< > & " '`. Attribute values get the same.
// Tags and attribute keys are passed through (validation is the editor's job
// — by the time we serialize, the subset checker has accepted the tree or
// the caller is choosing to serialize anyway).
// ---------------------------------------------------------------------------

const VOID_HTML_TAGS: ReadonlySet<string> = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Serialize a Markup value to an HTML string. */
export function serializeMarkup(node: MarkupValue): string {
  if (node.$tag === "Text") return escapeText(node.value);

  const tag = node.tag.toLowerCase();
  let attrs = "";
  for (const a of node.attrs) {
    if (typeof a.key !== "string" || a.key === "") continue;
    attrs += ` ${a.key}="${escapeAttr(typeof a.value === "string" ? a.value : String(a.value))}"`;
  }

  if (VOID_HTML_TAGS.has(tag)) return `<${tag}${attrs}>`;

  let inner = "";
  for (const c of node.children) inner += serializeMarkup(c);
  return `<${tag}${attrs}>${inner}</${tag}>`;
}
