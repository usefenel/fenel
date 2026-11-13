// ---------------------------------------------------------------------------
// Search matcher for /app/data.
//
// Three modes, all dispatched off the parser's ParsedQuery:
//
//   text       — fuzzy substring match against label / codeName / id /
//                description. Works on every kind of item.
//   type       — bare type query. Matches:
//                  · the type itself (`String` → the String type)
//                  · refinements (subtypes) and generalizations (supertypes)
//                    via `isSubtype`
//                  · structural mentions inside other types' fields
//                  · function signatures that use the type as a param/return
//   signature  — `(P1,…,Pn) -> R` or `Pi -> R`. Variance-aware:
//                params are contravariant (candidate's param must accept
//                a value of the query's param type), returns are covariant
//                (candidate's return must be acceptable as the query's
//                return). Pattern variables (`a`, `b`, `xs`, …) unify
//                across occurrences.
//
// Subtype awareness is the killer feature: searching `String -> String`
// also surfaces `Email -> Email`, because Email refines String on both
// sides. Pattern vars elevate that to identity-like queries (`a -> a`).
//
// The decider judges REFERENCES, never display copies. An item's `type` and
// `signature` are copies of definitions (the catalogue's entity shapes carry
// named fields without the semantic slot the field-identity boundary
// requires), so deciding on them throws or answers about the wrong thing. A
// type item is judged by its registry reference (`item.ref`); its structure
// and a signature are walked syntactically only to COLLECT the reference
// forms they mention (`isReferenceForm`), and each of those is decided
// against the query. An inline anonymous shape is never decided: it simply
// does not match on type.
// ---------------------------------------------------------------------------

import type { FenelType } from "@fenel/engine";
import { isSubtype, peelMaybe, peelList, peelResult } from "@fenel/engine";
import { isWellKnownTypeName, type ParsedQuery } from "./parser";
import { For, snapshot } from "solid-js";

export type DataKind =
  // All Fenel functions and types are equal in shape regardless of
  // whether they were authored by a user or seeded from an engine
  // module — the "user-function" / "user-type" categories were a
  // UI-only fiction. The `source` field on DataItem distinguishes
  // when needed.
  | "type"        // any registered type (atom/foundation/format/unit/composite/user)
  | "entity"      // catalog entity (system)
  | "typeclass"   // catalog typeclass
  | "constructor" // generic type constructor
  | "function";   // any registered function (system or user)

export type DataItem = {
  kind: DataKind;
  routeId: string;
  routeBase: "/app/types/" | "/app/functions/";
  label: string;
  codeName?: string;
  description: string;
  icon?: string;
  /** For "things that are types" — the type's structural form. A display
   *  copy: walked for the references it mentions, never decided itself. */
  type?: FenelType;
  /** For "things that are types" — the registry reference the subset decider
   *  judges this item by (`{ $ref: <entity id> }`). Absent when `type` is
   *  itself a reference form (an atom's `{ $ref: "String" }`). */
  ref?: FenelType;
  /** For functions — params + return. */
  signature?: { params: { name: string; type: FenelType }[]; returns: FenelType };
  source: "system" | "user";
};

export type MatchReason =
  | "name"
  | "description"
  | "type-self"
  | "type-refinement"
  | "type-generalization"
  | "field-mention"
  | "signature-uses"
  | "signature-match"
  | "signature-pattern";

export type Match = {
  item: DataItem;
  score: number;
  reason: MatchReason;
  reasonText: string;
};

/** Matches one `search` call returns (its best, by score). */
export const MAX_RESULTS = 200;

/** Match `items` against `query`. `universe` is the complete search universe
 *  `items` was sliced from (a caller searching in slices passes the whole
 *  list): it decides whether a bare name denotes a type at all. */
export function search(items: DataItem[], query: ParsedQuery, universe: readonly DataItem[] = items): Match[] {
  if (query.kind === "empty") return [];
  const matches: Match[] = [];
  const unresolved = unresolvedTypeName(query, universe);

  const previous = activeMemo;
  activeMemo = decisionMemoFor(query, universe);
  try {
    for (const item of items) {
      const m = unresolved !== undefined && query.kind === "type"
        ? unresolvedTypeMatch(item, query, unresolved)
        : matchOne(item, query);
      if (m) matches.push(m);
    }
  } finally {
    activeMemo = previous;
  }

  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, MAX_RESULTS);
}

function matchOne(item: DataItem, query: ParsedQuery): Match | null {
  if (query.kind === "text") {
    return textMatch(item, query.text);
  }
  if (query.kind === "type") {
    return typeMatch(item, query);
  }
  if (query.kind === "signature") {
    // Try the strict signature match first; if that misses, fall through to
    // type-touch matching using the return type as a hint, so a query like
    // `String -> Boolean` still surfaces relevant types and entities even
    // when there's no exact-arity function match.
    const sigm = signatureMatch(item, query);
    if (sigm) return sigm;
    return null;
  }
  if (query.kind === "record") {
    // Record queries dispatch to the records API (handled by the page),
    // not against the in-memory catalog. But the matching entity itself
    // is worth surfacing as a definition reference at the top of the
    // results — quick link back to the type detail page.
    if (item.kind === "entity" || item.kind === "type") {
      const expected = query.entity.toLowerCase();
      const idStripped = item.routeId.replace(/^entity:/, "").toLowerCase();
      if (idStripped === expected || item.label.toLowerCase() === expected) {
        return mk(item, 90, "type-self", `Definition of ${query.entity}`);
      }
    }
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Text mode
// ---------------------------------------------------------------------------

function textMatch(item: DataItem, raw: string): Match | null {
  const needle = raw.toLowerCase();
  if (!needle) return null;

  const label = item.label.toLowerCase();
  const code = (item.codeName ?? "").toLowerCase();
  const id = item.routeId.toLowerCase();

  // Exact label match wins big.
  if (label === needle || code === needle) {
    return mk(item, 100, "name", `Exact name: ${item.label}`);
  }
  if (label.startsWith(needle) || code.startsWith(needle)) {
    return mk(item, 85, "name", `Name starts with "${raw}"`);
  }
  if (label.includes(needle) || code.includes(needle) || id.includes(needle)) {
    return mk(item, 65, "name", `Name contains "${raw}"`);
  }

  const desc = item.description.toLowerCase();
  if (desc.includes(needle)) {
    return mk(item, 40, "description", `Description matches "${raw}"`);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Type mode — bare type query
// ---------------------------------------------------------------------------

function typeMatch(item: DataItem, q: { type: FenelType; vars: string[]; rawText: string }): Match | null {
  // A query that is not a reference form (an inline record, a pattern
  // variable) has nothing the decider can judge it by: name match only.
  const decidable = isReferenceForm(q.type);

  // 1. Items that ARE types — identity, refinement, generalization, judged by
  //    the item's reference forms. Equal forms are the same type; otherwise
  //    the decider answers both directions, and both = the same set.
  const forms = decidable ? selfForms(item) : [];
  if (forms.some((form) => typeEquals(form, q.type))) {
    return mk(item, 95, "type-self", `Is ${q.rawText}`);
  }
  let refines = false, generalizes = false;
  for (const form of forms) {
    const sub = safeIsSubtype(form, q.type);
    const sup = safeIsSubtype(q.type, form);
    if (sub && sup) return mk(item, 95, "type-self", `Is ${q.rawText}`);
    refines ||= sub;
    generalizes ||= sup;
  }
  if (refines) return mk(item, 75, "type-refinement", `Refinement of ${q.rawText}`);
  if (generalizes) return mk(item, 70, "type-generalization", `Generalization of ${q.rawText}`);
  // Structural mention — a reference the candidate's structure mentions is
  // the query type or refines it.
  if (item.type && decidable && typeContainsMatch(item.type, q.type)) {
    return mk(item, 50, "field-mention", `${q.rawText} appears in structure`);
  }

  // 2. Functions — does the query type appear in the signature?
  if (item.signature && decidable) {
    const inParam = item.signature.params.some((p) => typeContainsMatch(p.type, q.type));
    const inReturn = typeContainsMatch(item.signature.returns, q.type);
    if (inParam && inReturn) {
      return mk(item, 80, "signature-uses", `Takes and returns ${q.rawText}`);
    }
    if (inReturn) {
      return mk(item, 65, "signature-uses", `Returns ${q.rawText}`);
    }
    if (inParam) {
      return mk(item, 60, "signature-uses", `Takes ${q.rawText}`);
    }
  }

  // 3. Fallback: name match against the raw text.
  return textMatch(item, q.rawText);
}

// ---------------------------------------------------------------------------
// Type mode for a bare name that names no type
// ---------------------------------------------------------------------------
//
// The parser reads any single identifier as a type (`probe42` -> `Probe42`).
// When no type, entity, typeclass or constructor in the universe carries that
// name, the subset decider cannot resolve it either, so the refinement,
// generalization and structural checks of `typeMatch` cost one interpreted
// subset decision per node of every item (measured: 143 s over the 4,360
// seed catalogue items for a query with no match) and can only succeed
// through an exact reference to the name. This path keeps those exact
// references and the name match, without the decider.

/** Lowercased type-like names of a search universe, computed once per array. */
const typeNamesByUniverse = new WeakMap<readonly DataItem[], ReadonlySet<string>>();
function typeNamesOf(universe: readonly DataItem[]): ReadonlySet<string> {
  let names = typeNamesByUniverse.get(universe);
  if (names === undefined) {
    const collected = new Set<string>();
    for (const item of universe) {
      if (item.kind === "function") continue;
      collected.add(item.label.toLowerCase());
      if (item.codeName) collected.add(item.codeName.toLowerCase());
      collected.add(item.routeId.replace(/^entity:/, "").toLowerCase());
    }
    names = collected;
    typeNamesByUniverse.set(universe, names);
  }
  return names;
}

/** The name of a bare `{ $ref }` type query that no type-like item carries
 *  (and that is not a well-known atom), else undefined. */
function unresolvedTypeName(query: ParsedQuery, universe: readonly DataItem[]): string | undefined {
  if (query.kind !== "type" || query.vars.length > 0) return undefined;
  const type = query.type as Record<string, unknown>;
  const name = type["$ref"];
  if (typeof name !== "string" || Object.keys(type).length !== 1 || isWellKnownTypeName(name)) return undefined;
  return typeNamesOf(universe).has(name.toLowerCase()) ? undefined : name;
}

/** Whether `type` contains an exact `{ $ref: name }` reference anywhere. */
function mentionsRef(type: FenelType, needle: string): boolean {
  try {
    return JSON.stringify(type).includes(needle);
  } catch {
    return false;
  }
}

function unresolvedTypeMatch(
  item: DataItem,
  q: { type: FenelType; vars: string[]; rawText: string },
  name: string,
): Match | null {
  const needle = `"$ref":${JSON.stringify(name)}`;
  if (selfForms(item).some((form) => typeEquals(form, q.type))) return mk(item, 95, "type-self", `Is ${q.rawText}`);
  if (item.type && mentionsRef(item.type, needle)) {
    return mk(item, 50, "field-mention", `${q.rawText} appears in structure`);
  }
  if (item.signature) {
    const inParam = item.signature.params.some((p) => mentionsRef(p.type, needle));
    const inReturn = mentionsRef(item.signature.returns, needle);
    if (inParam && inReturn) return mk(item, 80, "signature-uses", `Takes and returns ${q.rawText}`);
    if (inReturn) return mk(item, 65, "signature-uses", `Returns ${q.rawText}`);
    if (inParam) return mk(item, 60, "signature-uses", `Takes ${q.rawText}`);
  }
  return textMatch(item, q.rawText);
}

// ---------------------------------------------------------------------------
// Signature mode — arrow query
// ---------------------------------------------------------------------------

function signatureMatch(
  item: DataItem,
  q: { params: FenelType[]; returns: FenelType; vars: string[]; rawText: string },
): Match | null {
  if (!item.signature) return null;
  const sig = item.signature;
  if (sig.params.length !== q.params.length) return null;

  if (q.vars.length > 0) {
    // Pattern variables: unify, tracking substitutions across all positions.
    const subst = new Map<string, FenelType>();
    // Params are contravariant w.r.t. the search; for unification we just
    // pattern-match q.params[i] against sig.params[i].type.
    for (let i = 0; i < q.params.length; i++) {
      if (!unify(q.params[i]!, sig.params[i]!.type, subst)) return null;
    }
    if (!unify(q.returns, sig.returns, subst)) return null;
    const note = subst.size > 0
      ? `Pattern: ${formatSubst(subst)}`
      : "Signature pattern match";
    return mk(item, 85, "signature-pattern", note);
  }

  // No pattern vars: variance-aware structural subtype, decided only between
  // reference forms. A signature position holding an inline shape (a display
  // copy) is not decided, so the signature does not match.
  const positions = [...q.params, q.returns, ...sig.params.map((p) => p.type), sig.returns];
  if (!positions.every(isReferenceForm)) return null;
  // Param i: query.params[i] must be acceptable as sig.params[i] (a value
  // of the query's param-type can be passed where the candidate expects).
  // i.e. query.params[i] ⊆ sig.params[i].
  for (let i = 0; i < q.params.length; i++) {
    if (!safeIsSubtype(q.params[i]!, sig.params[i]!.type)) return null;
  }
  // Return: candidate's return must be acceptable as the query's return.
  // i.e. sig.returns ⊆ query.returns.
  if (!safeIsSubtype(sig.returns, q.returns)) return null;

  // Score boost when arity-and-types align exactly vs subtype-loose.
  const exact =
    q.params.every((qp, i) => typeEquals(qp, sig.params[i]!.type)) &&
    typeEquals(sig.returns, q.returns);
  return mk(
    item,
    exact ? 95 : 80,
    "signature-match",
    exact ? "Exact signature match" : "Signature match (subtype-aware)",
  );
}

// ---------------------------------------------------------------------------
// Structural mention — does `needle` appear anywhere inside `haystack`?
// Subtype-aware: a needle of String matches an Email field.
// ---------------------------------------------------------------------------
//
// The walk below decides nothing: it collects the reference forms the
// haystack mentions, and only those reach the decider (each distinct pair
// once per query, through the memo).

function typeContainsMatch(haystack: FenelType, needle: FenelType): boolean {
  return mentionedReferenceForms(haystack).some((form) => safeIsSubtype(form, needle));
}

/** Whether `t` is a REFERENCE FORM: a registry reference, a refinement of
 *  one, a phantom-tagged one or an opaque type over one (`BotToken`, opaque
 *  over `String{format:bot-token}`). Such a type carries no fields of its
 *  own, so it is a reference the decider resolves through the registry, never
 *  a display copy of a definition. A syntactic recogniser: it decides nothing
 *  about the type's meaning, and it calls no engine recogniser (the shape
 *  recognisers marshal the whole subtree and refuse display copies by
 *  throwing: measured at 70% of a query's time when the walk used them). */
function isReferenceForm(t: FenelType): boolean {
  if (t === null || typeof t !== "object") return false;
  const o = t as Record<string, unknown>;
  if ("$ref" in o) return typeof o.$ref === "string";
  if ("$refined" in o) {
    const base = (o.$refined as { base?: FenelType } | undefined)?.base;
    return base !== undefined && isReferenceForm(base);
  }
  if ("$tagged" in o) {
    const tagged = o.$tagged as { value?: FenelType; phantom?: FenelType } | undefined;
    return tagged?.value !== undefined && isReferenceForm(tagged.value)
      && (tagged.phantom === undefined || isReferenceForm(tagged.phantom));
  }
  if ("$opaque" in o) {
    const pure = (o.$opaque as { pure?: FenelType } | undefined)?.pure;
    return pure !== undefined && isReferenceForm(pure);
  }
  return false;
}

/** The reference forms a type item is judged by: its registry reference, and
 *  its `type` when that is itself a reference form (an atom's `{ $ref }`, a
 *  format's or an alias entity's refinement of `String`). Both: the decider
 *  judges a reference to a registered alias by name (measured on the seed
 *  catalogue, `{ $ref: "PhoneNumber" } ⊆ String` answers false), while its
 *  field-free definition `String{format:phone}` answers true, and a field-free
 *  form is no display copy (it carries no field slot to lack). */
function selfForms(item: DataItem): readonly FenelType[] {
  const forms: FenelType[] = [];
  if (item.ref !== undefined) forms.push(item.ref);
  if (item.type !== undefined && isReferenceForm(item.type)) forms.push(item.type);
  return forms;
}

/** Every reference form `haystack` mentions, outermost first: the haystack
 *  itself when it is one, then those inside its record and variant fields
 *  (Maybe and Result are variants), an opaque type's pure form (List's cons
 *  cell), tagged legs and refined bases. A syntactic walk in which references
 *  are leaves, so it is collected once per type object, whatever the query. */
function mentionedReferenceForms(haystack: FenelType): readonly FenelType[] {
  if (haystack === null || typeof haystack !== "object") return [];
  let known = mentionedForms.get(haystack);
  if (known === undefined) {
    const out: FenelType[] = [];
    collectReferenceForms(haystack, out);
    known = out;
    mentionedForms.set(haystack, known);
  }
  return known;
}
const mentionedForms = new WeakMap<object, readonly FenelType[]>();

function collectReferenceForms(t: FenelType, out: FenelType[]): void {
  if (t === null || typeof t !== "object") return;
  if (isReferenceForm(t)) out.push(t);
  const h = t as Record<string, unknown>;
  // A reference is a leaf: what it names is the decider's business.
  if ("$ref" in h) return;
  if ("$refined" in h) {
    collectReferenceForms((h.$refined as { base: FenelType }).base, out);
    return;
  }
  if ("$tagged" in h) {
    const tagged = h.$tagged as { value: FenelType; phantom?: FenelType };
    collectReferenceForms(tagged.value, out);
    if (tagged.phantom) collectReferenceForms(tagged.phantom, out);
    return;
  }
  if ("$opaque" in h) {
    const pure = (h.$opaque as { pure?: FenelType } | undefined)?.pure;
    if (pure !== undefined) collectReferenceForms(pure, out);
    return;
  }
  if ("$record" in h) {
    for (const f of (h.$record as { fields?: { type: FenelType }[] }).fields ?? []) collectReferenceForms(f.type, out);
    return;
  }
  if ("$variant" in h) {
    for (const c of (h.$variant as { cases?: { fields?: { type: FenelType }[] }[] }).cases ?? []) {
      for (const f of c.fields ?? []) collectReferenceForms(f.type, out);
    }
  }
}

// ---------------------------------------------------------------------------
// Pattern unification — strict equality unification with var bindings
// ---------------------------------------------------------------------------

function unify(query: FenelType, candidate: FenelType, subst: Map<string, FenelType>): boolean {
  const q = query as Record<string, unknown>;
  if ("$var" in q) {
    const name = q.$var as string;
    const bound = subst.get(name);
    if (bound) return typeEquals(bound, candidate);
    subst.set(name, candidate);
    return true;
  }
  // Concrete query — snapshot structurally on both sides.
  return typeEquals(query, candidate)
    || structuralUnify(query, candidate, subst);
}

function structuralUnify(query: FenelType, candidate: FenelType, subst: Map<string, FenelType>): boolean {
  const q = query as Record<string, unknown>;
  const c = candidate as Record<string, unknown>;
  {
    const qList = safePeelList(query);
    const cList = safePeelList(candidate);
    if (qList && cList) return unify(qList.elem, cList.elem, subst);
  }
  {
    const qMaybe = safePeelMaybe(query);
    const cMaybe = safePeelMaybe(candidate);
    if (qMaybe && cMaybe) return unify(qMaybe.value, cMaybe.value, subst);
  }
  {
    const qResult = safePeelResult(query);
    const cResult = safePeelResult(candidate);
    if (qResult && cResult) {
      return unify(qResult.ok, cResult.ok, subst) && unify(qResult.err, cResult.err, subst);
    }
  }
  if ("$record" in q && "$record" in c) {
    const qf = (q.$record as { fields: { name: string; type: FenelType }[] }).fields;
    const cf = (c.$record as { fields: { name: string; type: FenelType }[] }).fields;
    if (qf.length !== cf.length) return false;
    // Match fields by name (order-independent).
    const cMap = new Map(cf.map((f) => [f.name, f.type]));
    for (const f of qf) {
      const ct = cMap.get(f.name);
      if (!ct) return false;
      if (!unify(f.type, ct, subst)) return false;
    }
    return true;
  }
  if ("$tagged" in q && "$tagged" in c) {
    return unify(
      (q.$tagged as { value: FenelType }).value,
      (c.$tagged as { value: FenelType }).value,
      subst,
    );
  }
  if ("$refined" in q && "$refined" in c) {
    // Conservative: refinement-vs-refinement requires the bases to unify;
    // we don't model SetExpr unification.
    return unify(
      (q.$refined as { base: FenelType }).base,
      (c.$refined as { base: FenelType }).base,
      subst,
    );
  }
  return false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function typeEquals(a: FenelType, b: FenelType): boolean {
  // Cheap structural equality via JSON; FenelTypes are plain JSON.
  return JSON.stringify(a) === JSON.stringify(b);
}

function safeIsSubtype(a: FenelType, b: FenelType): boolean {
  const memo = activeMemo;
  const key = memo === undefined ? undefined : pairKey(a, b);
  if (key !== undefined) {
    const known = memo!.subset.get(key);
    if (known !== undefined) return known;
  }
  let answer: boolean;
  try {
    answer = isSubtype(a, b);
  } catch {
    // Last resort only: every caller hands the decider reference forms, so a
    // throw here is a defect the counter below makes visible.
    deciderThrows += 1;
    answer = false;
  }
  if (key !== undefined) memo!.subset.set(key, answer);
  return answer;
}

let deciderThrows = 0;
/** Measurement and test seam: the number of decider calls that threw since
 *  the previous read, which resets it. */
export function takeDeciderThrowCount(): number {
  const count = deciderThrows;
  deciderThrows = 0;
  return count;
}

// ---------------------------------------------------------------------------
// Decision memo for one query run
// ---------------------------------------------------------------------------
//
// Catalogue items share most of their field and signature types, so the
// subset decider (interpreted Fenel, one decision per node) answers the same
// pair thousands of times per query: 133 s for `recipe` over the 4,360 seed
// items. Its answer is a function of the two types while the catalogue it
// resolves names in is unchanged, which holds for one query over one
// universe: a new query object (a new query text or run) or a new universe
// array (a rebuilt catalogue) starts a new memo. Keys are the types' JSON,
// so equal JSON shares an answer; a type that cannot be serialized is
// decided without the memo.

type DecisionMemo = { readonly subset: Map<string, boolean> };
const decisionMemos = new WeakMap<object, WeakMap<object, DecisionMemo>>();
let activeMemo: DecisionMemo | undefined;

function decisionMemoFor(query: ParsedQuery, universe: readonly DataItem[]): DecisionMemo {
  let byQuery = decisionMemos.get(universe);
  if (byQuery === undefined) {
    byQuery = new WeakMap();
    decisionMemos.set(universe, byQuery);
  }
  let memo = byQuery.get(query);
  if (memo === undefined) {
    memo = { subset: new Map() };
    byQuery.set(query, memo);
  }
  return memo;
}

function pairKey(a: FenelType, b: FenelType): string | undefined {
  const left = typeKey(a), right = typeKey(b);
  return left === undefined || right === undefined ? undefined : `${left}\u0000${right}`;
}

function typeKey(t: FenelType): string | undefined {
  try {
    return JSON.stringify(t);
  } catch {
    return undefined;
  }
}

// The peelers are STRUCTURAL RECOGNIZERS, and they can THROW here rather than
// answer: a `DataItem` built from a user type carries the raw wire type, and
// the engine's field-identity guard refuses to plan against one
// ("field-identity semantic boundary (peelList): invalid own-data type
// boundary"). Unguarded, one such item took down the whole page the moment
// anything was typed into the Browse drawer.
//
// Answering "not that shape" is the safe direction, and the same one
// `safeIsSubtype` above already takes: the item simply does not match on TYPE,
// while still matching on name and description. It is never a false match.
//
// The real repair is upstream — product consumers must plan against the
// registry's projection, not the wire type (see `resolveLocalIdentifiedType`
// in `account-field-registry.ts`). This keeps search usable until they do.
function safePeelList(t: FenelType): ReturnType<typeof peelList> {
  try { return peelList(t); } catch { return null; }
}
function safePeelMaybe(t: FenelType): ReturnType<typeof peelMaybe> {
  try { return peelMaybe(t); } catch { return null; }
}
function safePeelResult(t: FenelType): ReturnType<typeof peelResult> {
  try { return peelResult(t); } catch { return null; }
}

function mk(item: DataItem, score: number, reason: MatchReason, reasonText: string): Match {
  return { item, score, reason, reasonText };
}

function formatSubst(subst: Map<string, FenelType>): string {
  const parts: string[] = [];
  for (const [k, v] of subst) {
    parts.push(`${k} = ${formatType(v)}`);
  }
  return parts.join(", ");
}

function formatType(t: FenelType): string {
  const o = t as Record<string, unknown>;
  if ("$ref" in o) return String(o.$ref);
  if ("$var" in o) return String(o.$var);
  // Maybe / List recognised by case shape (canonical form only).
  {
    const list = safePeelList(t);
    if (list) return `List(${formatType(list.elem)})`;
    const maybe = safePeelMaybe(t);
    if (maybe) return `Maybe(${formatType(maybe.value)})`;
  }
  if ("$tagged" in o) return `Ref(${(o.$tagged as { name: string }).name})`;
  if ("$refined" in o) return formatType((o.$refined as { base: FenelType }).base);
  if ("$record" in o) return "{…}";
  if ("$variant" in o) return "|…|";
  return Object.keys(o)[0] ?? "?";
}
