// URL/reader transport boundary. Member matching and canonical segment choice
// are Fenel-owned (view.addressMemberIndex / view.addressMemberSegment).
// This adapter reads the existing ExprNode and $-key carriers; it never
// evaluates an expression, resolves a private identity, or builds a catalogue.
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { FenelType } from "@fenel/engine/types";
import type { LocalOrdinaryOperation, LocalOrdinaryResult } from "./local-ordinary-operations";
import type { LocusRootData } from "./locus-root-data";
import type { LayoutItem } from "./locus-view-model";
import { ROOT_SCOPE, scopeAncestors, scopeKey, type LocusScope } from "./locus-scope";
import { readPublicInitialValue } from "./public-bootstrap";
import { hasDataPreview } from "./data-transfer/data-preview-shape";
import { isLocusCatalogReference } from "./locus-catalog-reference";

type AddressMember = { id: string; name: string; aliases: string[]; position: number; focus: LocusScope };
type AddressMembers = { members: AddressMember[]; positional: boolean; needsValue?: ExprNode; readerIndependent?: true };
export type LocusAddressValues = {
  read: (node: ExprNode) => { value: unknown } | undefined;
  expression?: (id: string) => ExprNode | undefined;
  childType?: (value: unknown, type: FenelType | undefined, step: string | number) => FenelType | undefined;
};
type AddressOperation = Extract<LocalOrdinaryOperation, { kind: "addressMemberIndex" | "addressMemberSegment" }>;
export type LocusAddressOperationOptions = { signal?: AbortSignal; assertCurrent?: () => void };
export type LocusAddressOperate = <O extends AddressOperation>(operation: O,
  options?: LocusAddressOperationOptions) => Promise<LocalOrdinaryResult<O>>;
export type LocusAddressResolution = { focus: LocusScope; segments: string[]; missing?: string; detail?: string; needsValue?: ExprNode; readerIndependent?: true };

// Existing host delivery coordinates, not Fenel member names. Proxy roots
// follow Vite's actual prefix matching; file routes/assets use exact segments.
export const LOCUS_HOST_ROUTES: readonly { name: string; prefix?: boolean }[] = [
  { name: "app" }, { name: "login" }, { name: "p" },
  { name: "api", prefix: true }, { name: "webhooks", prefix: true }, { name: "r", prefix: true },
  { name: "fonts" }, { name: "assets" }, { name: "src" }, { name: "node_modules" },
  { name: "favicon.png" }, { name: "__dev-ts.txt" },
];
export function locusSegmentUsesHostRoute(segment: string): boolean {
  return LOCUS_HOST_ROUTES.some(route => route.prefix ? segment.startsWith(route.name) : segment === route.name);
}

export function decodeLocusAddress(pathname: string): string[] {
  const parts = pathname.split("/");
  if (parts[0] !== "") throw new Error("A data address starts with a slash.");
  parts.shift();
  if (parts.at(-1) === "") parts.pop();
  if (parts.some(part => !part)) throw new Error("A data address has an empty step.");
  return parts.map(part => decodeURIComponent(part));
}

export function encodeLocusAddress(segments: readonly string[]): string {
  const address = `/${segments.map(segment => encodeURIComponent(segment)).join("/")}`;
  if (new URL(address, "https://fenel.invalid").pathname !== address) {
    throw new Error("This name needs an identity address because the browser treats it as a path instruction.");
  }
  return address;
}

function itemExpression(root: LocusRootData, item: LayoutItem, values?: LocusAddressValues): ExprNode | undefined {
  return item.source?.kind === "expr" ? item.source.expr
    : item.source?.kind === "ref" ? (Object.hasOwn(root.expressions, item.source.ref.id)
      ? root.expressions[item.source.ref.id] : values?.expression?.(item.source.ref.id)) : item.expr;
}

function occurrence(root: LocusRootData, item: LayoutItem, position: number, focus: LocusScope): AddressMember {
  const code = item.representations?.Codeable?.codeName;
  const name = code === "_" ? "" : typeof code === "string" && code ? code : item.caption ?? "";
  return { id: item.id, name, aliases: item.caption && item.caption !== name ? [item.caption] : [], position, focus };
}

function selectedSource(root: LocusRootData, focus: Extract<LocusScope, { kind: "value" }>, values?: LocusAddressValues): {
  node?: ExprNode; value?: unknown; type?: FenelType; hasValue: boolean; authoredRoot: boolean;
} | undefined {
  const items = focus.rootItem ? root.items : root.lists.find(row => row.id === focus.viewId)?.view.items;
  const item = items?.find(item => item.id === focus.itemId);
  if (!item) return undefined;
  let node = itemExpression(root, item, values);
  const authoredRoot = focus.path.length === 0 && item.source?.kind === "expr" && node === item.source.expr;
  let type = item.valueType;
  const initialValue = node && values?.read(node) || readPublicInitialValue(root, node);
  let hasValue = !!initialValue || node?.kind === "literal";
  let value = initialValue ? initialValue.value : node?.kind === "literal" ? node.value : undefined;
  for (const step of focus.path) {
    const parentValue = value;
    const parentType = type;
    if (node?.kind === "literal" && node.value && typeof node.value === "object") {
      const held = node.value as { __record?: { fields?: Array<{ name: string; value: ExprNode }> }; __list?: ExprNode[] };
      node = typeof step === "number" ? held.__list?.[step] : held.__record?.fields?.find(field => field.name === step)?.value;
    } else node = undefined;
    hasValue = !!value && typeof value === "object" && Object.hasOwn(value, step);
    value = hasValue ? (value as Record<string, unknown>)[String(step)] : undefined;
    const initial = node && values?.read(node) || readPublicInitialValue(root, node);
    if (initial) { value = initial.value; hasValue = true; }
    else if (node?.kind === "literal") { value = node.value; hasValue = true; }
    type = values?.childType?.(parentValue, parentType, step) ?? (typeof step === "string" && type && "$record" in type
      ? type.$record.fields.find(field => field.name === step)?.type : undefined);
  }
  return { node, value, type, hasValue, authoredRoot };
}

/** Marshal only the chosen reader's already-read children and occurrence IDs. */
export function locusAddressMembers(root: LocusRootData, focus: LocusScope, values?: LocusAddressValues): AddressMembers {
  if (focus.kind === "root") return { positional: true, readerIndependent: true, members: root.items.map((item, position) => {
    const listed = root.lists.some(row => row.id === item.id);
    return occurrence(root, item, position, listed ? { kind: "view", viewId: item.id }
      : { kind: "value", viewId: root.id, itemId: item.id, path: [], rootItem: true });
  }) };
  if (focus.kind === "view") {
    const list = root.lists.find(row => row.id === focus.viewId);
    return { positional: true, readerIndependent: true, members: (list?.view.items ?? []).map((item, position) => occurrence(root, item, position,
      { kind: "value", viewId: focus.viewId, itemId: item.id, path: [] })) };
  }
  const selected = selectedSource(root, focus, values);
  const held = selected?.node?.kind === "literal" && selected.node.value && typeof selected.node.value === "object"
    ? selected.node.value as { __record?: { fields?: Array<{ name: string; value: ExprNode }> }; __list?: ExprNode[] } : undefined;
  const fields = held?.__record?.fields;
  if (Array.isArray(fields)) {
    // This namespace comes directly from this root's authored expression and
    // explicit record fields. No path step has invoked childType, and a read
    // of another held value cannot replace these source names or field keys.
    // Nested, referenced, computed and alias-typed parents retain their reader.
    let readerIndependent = selected?.authoredRoot === true && !!selected.type && "$record" in selected.type;
    const members = fields.map((field, position) => {
      const declared = selected?.type && "$record" in selected.type ? selected.type.$record.fields.find(value => value.name === field.name) : undefined;
      if (!declared) readerIndependent = false;
      return { id: declared?.key?.$tag === "NamedField" ? declared.key.ref.$ref : "", name: field.name, aliases: [], position,
        focus: { ...focus, path: [...focus.path, field.name] } };
    });
    return { positional: false, members, ...(readerIndependent ? { readerIndependent: true as const } : {}) };
  }
  const list = held?.__list ?? (Array.isArray(selected?.value) ? selected.value : undefined);
  if (list) return { positional: true, members: list.map((_value, position) => ({ id: "", name: "", aliases: [], position,
    focus: { ...focus, path: [...focus.path, position] } })) };
  const value = selected?.value;
  if (value && typeof value === "object" && !Array.isArray(value) && !hasDataPreview(value) && !isLocusCatalogReference(value)) {
    return { positional: false, members: Object.keys(value).filter(name => !name.startsWith("$")).map((name, position) => {
      const declared = selected?.type && "$record" in selected.type ? selected.type.$record.fields.find(field => field.name === name) : undefined;
      return { id: declared?.key?.$tag === "NamedField" ? declared.key.ref.$ref : "", name, aliases: [], position,
        focus: { ...focus, path: [...focus.path, name] } };
    }) };
  }
  return { positional: false, members: [], ...(!selected?.hasValue && selected?.node && selected.node.kind !== "literal"
    ? { needsValue: selected.node } : {}) };
}

/** Decode the closed Result wire; matching itself stays in Fenel. */
export async function resolveLocusAddress(root: LocusRootData, segments: readonly string[], operate: LocusAddressOperate,
  values?: LocusAddressValues, options?: LocusAddressOperationOptions,
): Promise<LocusAddressResolution> {
  const assertCurrent = () => { options?.signal?.throwIfAborted(); options?.assertCurrent?.(); };
  assertCurrent();
  let focus = ROOT_SCOPE;
  const canonical: string[] = [];
  let readerIndependent = true;
  for (const segment of segments) {
    assertCurrent();
    const facts = locusAddressMembers(root, focus, values);
    const { members, positional, needsValue } = facts;
    readerIndependent &&= facts.readerIndependent === true;
    if (needsValue) return { focus, segments: canonical, missing: segment, needsValue,
      detail: "The selected data must finish loading before this position can be read." };
    const selected = await operate({ kind: "addressMemberIndex", args: [members, segment, positional] }, options);
    assertCurrent();
    if (selected.$tag !== "Ok") return { focus, segments: canonical, missing: segment, detail: selected._0 };
    const member = members[selected._0];
    if (!member) throw new Error("This data address returned an unreadable position.");
    const spelling = await operate({ kind: "addressMemberSegment", args: [members, selected._0, positional] }, options);
    assertCurrent();
    if (spelling.$tag !== "Ok") return { focus, segments: canonical, missing: segment, detail: spelling._0 };
    canonical.push(spelling._0); focus = member.focus;
  }
  return { focus, segments: canonical, ...(readerIndependent ? { readerIndependent: true as const } : {}) };
}

/** Serialize the existing breadcrumb path instead of keeping a second tree. */
export async function locusAddressForScope(root: LocusRootData, focus: LocusScope, operate: LocusAddressOperate,
  values?: LocusAddressValues, onNeedsValue?: (node: ExprNode) => void, avoidFrameworkPath = false,
  options?: LocusAddressOperationOptions,
): Promise<string | undefined> {
  const assertCurrent = () => { options?.signal?.throwIfAborted(); options?.assertCurrent?.(); };
  assertCurrent();
  const segments: string[] = [];
  const chain: LocusScope[] = focus.kind === "value" ? [ROOT_SCOPE,
    ...(focus.rootItem ? [] : [{ kind: "view" as const, viewId: focus.viewId }]),
    ...Array.from({ length: focus.path.length + 1 }, (_, depth) => ({ ...focus, path: focus.path.slice(0, depth) })),
  ] : [...scopeAncestors(focus), focus];
  for (let index = 1; index < chain.length; index++) {
    assertCurrent();
    const { members, positional, needsValue } = locusAddressMembers(root, chain[index - 1]!, values);
    if (needsValue) { onNeedsValue?.(needsValue); return undefined; }
    const selected = members.findIndex(member => scopeKey(member.focus) === scopeKey(chain[index]!));
    if (selected < 0) return undefined;
    const spelling = await operate({ kind: "addressMemberSegment", args: [members, selected, positional] }, options);
    assertCurrent();
    if (spelling.$tag !== "Ok") return undefined;
    let segment = spelling._0;
    if (avoidFrameworkPath && index === 1 && locusSegmentUsesHostRoute(segment)) {
      const identity = `_${members[selected]!.id}`;
      const admitted = await operate({ kind: "addressMemberIndex", args: [members, identity, positional] }, options);
      assertCurrent();
      if (!members[selected]!.id || admitted.$tag !== "Ok" || admitted._0 !== selected) return undefined;
      segment = identity;
    }
    segments.push(segment);
  }
  return encodeLocusAddress(segments);
}
