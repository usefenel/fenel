// Pure reading of a classification (fenel/modules/encyclopedia/life.fenel and
// foods.fenel: LifeClassification, FoodClassification) for the nested-sets
// view: the same Boxes, Tree and Graph as the plant species sets
// (nested-sets-format.ts, nested-sets-graph.ts), for any depth. Each set is a
// node named by its item, a bare constructor (`{ $tag: "Solanaceae" }`) whose
// picture, emoji and label are its own registered instances. Every verdict is
// computed in Fenel by the set judgment; this file only reads the fields the
// contract lists (never `constraint` or `source`) and turns them into names,
// counts, nodes and arrows. A set sits inside another, and an arrow joins
// them, only where the data holds `within = Just true`; any other verdict is
// written out. `parts = Nothing` means "not asked" and draws nothing. Any
// shape it does not recognise answers `undefined`, and the view keeps the
// shared structural reader.
// Solid/browser renderer allowance — the same kind as the other card surfaces.

import { readVerdict, type Verdict } from "./nested-sets-format";
import type { SetGraph, SetGraphEdge, SetGraphNode } from "./nested-sets-graph";

function own(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function tagOf(value: unknown): string | undefined {
  const tag = own(value, "$tag");
  return typeof tag === "string" ? tag : undefined;
}

function isRecord(value: unknown): value is object {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** A Fenel `Maybe a` as present / absent; undefined when it is not a Maybe. */
function readMaybe(value: unknown): { present: true; value: unknown } | { present: false } | undefined {
  const tag = tagOf(value);
  if (tag === "Nothing") return { present: false };
  if (tag === "Just") return { present: true, value: own(value, "_0") };
  return undefined;
}

/** A list of tagged values (constructors), or undefined. */
function taggedList(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.every((item) => tagOf(item) !== undefined) ? value : undefined;
}

export type ClassificationParent = { whole: string; verdict: Verdict };

/** A stated link to an item of the other classification: a living thing
 * gives foods, a food comes from a living thing. Drawn as marks on the node. */
export type ClassificationLink = { relation: "gives" | "comes-from"; items: readonly unknown[] };

export type ClassificationNode = {
  /** The item's constructor tag: the node's identity in this value. */
  key: string;
  /** The item itself (a bare constructor value): its glyph is the node's mark. */
  item: unknown;
  name: string;
  scientificName: string | undefined;
  /** The rank constructor (`RankFamily`, `FoodRankKind`), as data. */
  rank: string;
  /** Its set is its own singleton: a species, a food. */
  leaf: boolean;
  parents: readonly ClassificationParent[];
  /** The members' constructor tags (the described leaves below it). */
  members: readonly string[];
  count: number;
  countText: string;
  /** The partition verdicts; undefined when the data did not ask (`Nothing`). */
  parts: { apart: Verdict; cover: Verdict } | undefined;
  link: ClassificationLink | undefined;
};

export type ClassificationCrossAnswer = { whole: string; verdict: Verdict; shared: readonly unknown[] | "undecided" };

/** A set that cuts across the classification (the fennels). */
export type ClassificationCrossSet = {
  name: string;
  members: readonly unknown[];
  count: number;
  countText: string;
  answers: readonly ClassificationCrossAnswer[];
};

export type ClassificationModel = {
  kind: "classification";
  coverage: string;
  sets: readonly ClassificationNode[];
  crossSets: readonly ClassificationCrossSet[];
};

/** "6 species", "16 foods": a food classification states `comesFrom`. */
function countWords(foods: boolean) {
  return (count: number) => foods ? `${count} ${count === 1 ? "food" : "foods"}` : `${count} species`;
}

function readParents(value: unknown): ClassificationParent[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows: ClassificationParent[] = [];
  for (const row of value) {
    const whole = tagOf(own(row, "whole"));
    const verdict = readVerdict(own(row, "within"));
    if (whole === undefined || verdict === undefined) return undefined;
    rows.push({ whole, verdict });
  }
  return rows;
}

function readParts(value: unknown): ClassificationNode["parts"] | null {
  const maybe = readMaybe(value);
  if (!maybe) return null;
  if (!maybe.present) return undefined;
  const apart = readVerdict(own(maybe.value, "apart"));
  const cover = readVerdict(own(maybe.value, "cover"));
  return apart && cover ? { apart, cover } : null;
}

function readSet(value: unknown, count: (n: number) => string): ClassificationNode | undefined {
  if (!isRecord(value)) return undefined;
  const item = own(value, "item");
  const key = tagOf(item);
  const name = own(value, "name");
  const rank = tagOf(own(value, "rank"));
  const scientific = readMaybe(own(value, "scientificName"));
  const parents = readParents(own(value, "parents"));
  const members = taggedList(own(value, "members"));
  const parts = readParts(own(value, "parts"));
  if (key === undefined || typeof name !== "string" || rank === undefined || !scientific || !parents || !members || parts === null) return undefined;
  if (scientific.present && typeof scientific.value !== "string") return undefined;
  // A living thing gives foods; a food comes from a living thing (or Nothing).
  let link: ClassificationLink | undefined;
  const gives = own(value, "gives");
  const comesFrom = own(value, "comesFrom");
  if (gives !== undefined) {
    const items = taggedList(gives);
    if (!items) return undefined;
    if (items.length > 0) link = { relation: "gives", items };
  } else if (comesFrom !== undefined) {
    const source = readMaybe(comesFrom);
    if (!source || (source.present && tagOf(source.value) === undefined)) return undefined;
    if (source.present) link = { relation: "comes-from", items: [source.value] };
  } else return undefined;
  const memberKeys = members.map((member) => tagOf(member)!);
  const leaf = memberKeys.length === 1 && memberKeys[0] === key;
  return { key, item, name, scientificName: scientific.present ? scientific.value as string : undefined, rank, leaf, parents,
    members: memberKeys, count: memberKeys.length, countText: count(memberKeys.length), parts, link };
}

function readCrossSet(value: unknown, count: (n: number) => string): ClassificationCrossSet | undefined {
  if (!isRecord(value)) return undefined;
  const name = own(value, "name");
  const members = taggedList(own(value, "members"));
  const answersValue = own(value, "answers");
  if (typeof name !== "string" || !members || !Array.isArray(answersValue)) return undefined;
  const answers: ClassificationCrossAnswer[] = [];
  for (const row of answersValue) {
    const whole = tagOf(own(row, "whole"));
    const verdict = readVerdict(own(row, "within"));
    const sharedMaybe = readMaybe(own(row, "shared"));
    if (whole === undefined || verdict === undefined || !sharedMaybe) return undefined;
    let shared: ClassificationCrossAnswer["shared"] = "undecided";
    if (sharedMaybe.present) {
      const rows = taggedList(sharedMaybe.value);
      if (!rows) return undefined;
      shared = rows;
    }
    answers.push({ whole, verdict, shared });
  }
  return { name, members, count: members.length, countText: count(members.length), answers };
}

/** The view model of a LifeClassification or a FoodClassification (`coverage`,
 * `sets`, and `crossSets` when the value has them); undefined for any other
 * shape, including the plant species sets that `readNestedSets` reads. */
export function readClassification(value: unknown): ClassificationModel | undefined {
  if (!isRecord(value)) return undefined;
  const coverage = own(value, "coverage");
  const setsValue = own(value, "sets");
  if (typeof coverage !== "string" || !Array.isArray(setsValue) || setsValue.length === 0) return undefined;
  const foods = setsValue.some((set) => own(set, "comesFrom") !== undefined);
  const count = countWords(foods);
  const sets: ClassificationNode[] = [];
  const keys = new Set<string>();
  for (const row of setsValue) {
    const set = readSet(row, count);
    if (!set || keys.has(set.key)) return undefined;
    keys.add(set.key);
    sets.push(set);
  }
  const crossValue = own(value, "crossSets");
  let crossSets: ClassificationCrossSet[] = [];
  if (crossValue !== undefined) {
    if (!Array.isArray(crossValue)) return undefined;
    const rows = crossValue.map((row) => readCrossSet(row, count));
    if (!rows.every((row): row is ClassificationCrossSet => row !== undefined)) return undefined;
    crossSets = rows;
  }
  return { kind: "classification", coverage, sets, crossSets };
}

/** The sets each set holds, by `within = Just true` only, in the model's order. */
export function classificationChildren(model: ClassificationModel): Map<string, ClassificationNode[]> {
  const known = new Set(model.sets.map((set) => set.key));
  const children = new Map<string, ClassificationNode[]>();
  for (const set of model.sets) for (const parent of set.parents) {
    if (parent.verdict !== "true" || !known.has(parent.whole) || parent.whole === set.key) continue;
    const list = children.get(parent.whole) ?? [];
    if (!list.includes(set)) list.push(set);
    children.set(parent.whole, list);
  }
  return children;
}

/** The sets drawn at the top: no parent decided `Just true` in this value. */
export function classificationRoots(model: ClassificationModel): ClassificationNode[] {
  const known = new Set(model.sets.map((set) => set.key));
  return model.sets.filter((set) => !set.parents.some((parent) => parent.verdict === "true" && known.has(parent.whole) && parent.whole !== set.key));
}

function nameOf(model: ClassificationModel, key: string): string {
  return model.sets.find((set) => set.key === key)?.name ?? key;
}

/** A parent the picture does not show (decided false, or not decided), in words. */
export function parentNote(model: ClassificationModel, parent: ClassificationParent): string | undefined {
  const whole = nameOf(model, parent.whole);
  return parent.verdict === "false" ? `Not within ${whole}` : parent.verdict === "undecided" ? `Within ${whole}: not decided` : undefined;
}

/** The parents of a set that are not drawn as nesting, in words. */
export function parentNotes(model: ClassificationModel, set: ClassificationNode): string[] {
  return set.parents.flatMap((parent) => { const note = parentNote(model, parent); return note ? [note] : []; });
}

/** The partition, in words, only where the drawing alone would mislead:
 * boxes side by side inside a box read "apart, and together they fill it".
 * `Just true` for both writes nothing; no partition asked writes nothing. */
export function partsNotes(set: ClassificationNode): string[] {
  if (!set.parts) return [];
  const notes: string[] = [];
  if (set.parts.apart === "false") notes.push("Some of these sets share members");
  else if (set.parts.apart === "undecided") notes.push("Whether these sets are apart: not decided");
  if (set.parts.cover === "false") notes.push(`Together they do not fill ${set.name}`);
  else if (set.parts.cover === "undecided") notes.push(`Whether together they fill ${set.name}: not decided`);
  return notes;
}

/** One answer of a set that cuts across, in words (the picture never nests it). */
export function crossAnswerText(model: ClassificationModel, answer: ClassificationCrossAnswer): string {
  const whole = nameOf(model, answer.whole);
  switch (answer.verdict) {
    case "true": return `Within ${whole}`;
    case "false": return answer.shared === "undecided" ? `Not within ${whole}` : `Not within ${whole}; ${answer.shared.length} shared`;
    case "undecided": return `Within ${whole}: not decided`;
  }
}

/** What a set that cuts across writes under its members: every answer not
 * decided true, and of the sets decided to hold it whole only the smallest
 * (the nesting already shows that the larger ones hold that one). */
export function crossAnswersToWrite(model: ClassificationModel, cross: ClassificationCrossSet): ClassificationCrossAnswer[] {
  const height = heights(model, classificationChildren(model));
  const smallest = cross.answers.filter((answer) => answer.verdict === "true" && height.has(answer.whole))
    .sort((left, right) => height.get(left.whole)! - height.get(right.whole)!)[0];
  return cross.answers.filter((answer) => answer.verdict !== "true" || answer === smallest);
}

/** The one-line form inside a record row: `All life ⊇ Plants, Fungi, Animals`. */
export function classificationInlineText(model: ClassificationModel): string {
  const children = classificationChildren(model);
  return classificationRoots(model).map((root) => {
    const inner = (children.get(root.key) ?? []).map((child) => child.name);
    return inner.length > 0 ? `${root.name} ⊇ ${inner.join(", ")}` : `${root.name}, ${root.countText}`;
  }).join("; ");
}

/** A node of the classification drawn by the graph and the tree: the shared
 * node, its item (for the glyph) and its stated link to the other classification. */
export type ClassificationGraphNode = SetGraphNode & { item?: unknown; link?: ClassificationLink };

const setId = (key: string) => `set:${key}`;
const crossId = (name: string) => `cross:${name}`;

/** Each set's height above the leaves (a leaf 0, a set 1 + its tallest child
 * set), from the nesting decided `Just true`: the graph's column. */
function heights(model: ClassificationModel, children: Map<string, ClassificationNode[]>): Map<string, number> {
  const result = new Map<string, number>();
  const height = (set: ClassificationNode, seen: Set<string>): number => {
    const known = result.get(set.key);
    if (known !== undefined) return known;
    if (seen.has(set.key)) return 0;
    seen.add(set.key);
    const kids = children.get(set.key) ?? [];
    const value = set.leaf ? 0 : kids.length ? 1 + Math.max(...kids.map((kid) => height(kid, seen))) : 1;
    result.set(set.key, value);
    return value;
  };
  for (const set of model.sets) height(set, new Set());
  return result;
}

/** The graph of a classification, for the same Tree and Graph drawings as the
 * species sets. A node per set (column = its height above the leaves), an
 * arrow per parent decided `Just true` (tree), a node per set that cuts across
 * with an arrow from each member, and one from the set to the smallest set
 * that holds it whole. A parent decided false or not decided draws no arrow:
 * its words join the node's second line. */
export function classificationGraph(model: ClassificationModel): SetGraph & { nodes: ClassificationGraphNode[] } {
  const children = classificationChildren(model);
  const height = heights(model, children);
  const nodes: ClassificationGraphNode[] = [];
  for (const set of model.sets) {
    const notes = parentNotes(model, set);
    const named = set.scientificName !== undefined && set.scientificName !== set.name ? set.scientificName : undefined;
    const base = set.leaf ? named : named ? `${named} · ${set.countText}` : set.countText;
    const detail = [base, ...notes].filter((part): part is string => !!part).join(" · ") || undefined;
    nodes.push({
      id: setId(set.key), kind: set.leaf ? "species" : "taxon", column: (height.get(set.key) ?? 0) as SetGraphNode["column"],
      title: set.name, detail, titleItalic: false, detailItalic: set.leaf && !!named && notes.length === 0,
      label: named ? `${set.name} (${named})${set.leaf ? "" : `, ${set.countText}`}` : `${set.name}${set.leaf ? "" : `, ${set.countText}`}`,
      holders: set.parents.filter((parent) => parent.verdict === "true" && parent.whole !== set.key && model.sets.some((row) => row.key === parent.whole))
        .map((parent) => setId(parent.whole)),
      across: false, item: set.item, ...(set.link ? { link: set.link } : {}),
    });
  }
  const leafIds = new Map(model.sets.filter((set) => set.leaf).map((set) => [set.key, setId(set.key)] as const));
  for (const cross of model.crossSets) nodes.push({
    id: crossId(cross.name), kind: "named-set", column: 1, holders: [], across: true, title: cross.name, detail: cross.countText,
    titleItalic: false, detailItalic: false, label: `${cross.name}, ${cross.countText}`,
  });
  const known = new Set(nodes.map((node) => node.id));
  const edges: SetGraphEdge[] = [];
  const arrow = (from: string, to: string, tree: boolean) => {
    if (!known.has(from) || !known.has(to) || from === to || edges.some((row) => row.from === from && row.to === to)) return;
    edges.push({ from, to, relation: "subset", decided: "true", tree });
  };
  // The classification first (drawn first, so beneath), children before parents' parents.
  for (const set of model.sets) for (const parent of set.parents) if (parent.verdict === "true") arrow(setId(set.key), setId(parent.whole), true);
  // ...then the sets that cut across: each member's arrow, then the smallest whole decided true.
  for (const cross of model.crossSets) {
    for (const member of cross.members) { const id = leafIds.get(tagOf(member)!); if (id) arrow(id, crossId(cross.name), false); }
    const holding = crossAnswersToWrite(model, cross).find((answer) => answer.verdict === "true");
    if (holding) arrow(crossId(cross.name), setId(holding.whole), false);
  }
  return { nodes, edges };
}

/** One box of the Boxes drawing: a set, the sets inside it (decided `Just
 * true`), its leaves as chips, and the words the drawing cannot say. */
export type ClassificationBox = {
  set: ClassificationNode;
  boxes: ClassificationBox[];
  leaves: ClassificationNode[];
  notes: string[];
};

/** The nested boxes, from the roots down. A set held by two parents is drawn
 * inside each (the data's nesting, never re-decided here). */
export function classificationBoxes(model: ClassificationModel): ClassificationBox[] {
  const children = classificationChildren(model);
  const box = (set: ClassificationNode, path: Set<string>): ClassificationBox => {
    const inside = (children.get(set.key) ?? []).filter((child) => !path.has(child.key));
    const next = new Set(path).add(set.key);
    return { set, boxes: inside.filter((child) => !child.leaf).map((child) => box(child, next)), leaves: inside.filter((child) => child.leaf),
      notes: [...parentNotes(model, set), ...partsNotes(set)] };
  };
  return classificationRoots(model).map((root) => box(root, new Set()));
}

