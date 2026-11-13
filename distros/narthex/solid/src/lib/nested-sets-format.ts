// Pure reading of the Encyclopedia's species sets (fenel/modules/encyclopedia/
// plants.fenel: PlantSpeciesSetsInCollection, PlantFamilySpeciesSets,
// PlantLifeFormSet, PlantFamilyLifeFormCrossing, PlantNamedSetPlacement) for the nested-sets view in
// nested-sets-view.tsx. Every verdict is computed in Fenel by the set judgment
// (set.decideSubset / set.decideDisjoint / set.contains); this file only reads
// the fields and turns them into names, counts and summary lines. A verdict is
// shown positive only when the data holds `Just true`; `Nothing` stays "not
// decided". Any shape it does not recognise answers `undefined`, and the view
// then keeps the shared structural reader, so nothing renders blank.
// Solid/browser renderer allowance — the same kind as the other card surfaces.

import { fieldPicture } from "./data-transfer/thumbnail-text";
import type { InlineImageValue } from "./expression-runner/image-canvas-data";

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

/** A constructor's positional payload (`TaxonGenus genus` is `{ $tag, _0 }`). */
function payload(value: unknown): unknown {
  return own(value, "_0");
}

/** The decided Maybe of a Fenel judgment: `Just true`, `Just false` or
 * `Nothing`. Anything else is not a judgment this file knows how to read. */
export type Verdict = "true" | "false" | "undecided";

function readBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  const tag = tagOf(value);
  if (tag === "True") return true;
  if (tag === "False") return false;
  return undefined;
}

export function readVerdict(value: unknown): Verdict | undefined {
  const tag = tagOf(value);
  if (tag === "Nothing") return "undecided";
  if (tag !== "Just") return undefined;
  const decided = readBool(own(value, "_0"));
  return decided === undefined ? undefined : decided ? "true" : "false";
}

/** A Fenel `Maybe a` as present / absent; undefined when it is not a Maybe. */
function readMaybe(value: unknown): { present: true; value: unknown } | { present: false } | undefined {
  const tag = tagOf(value);
  if (tag === "Nothing") return { present: false };
  if (tag === "Just") return { present: true, value: own(value, "_0") };
  return undefined;
}

function strings(value: unknown): string[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  return value.every((item) => typeof item === "string") ? value as string[] : undefined;
}

function capitalised(text: string): string {
  return text ? text.charAt(0).toLocaleUpperCase("en") + text.slice(1) : text;
}

/** Structural equality of plain data (records, lists, strings, numbers). */
function sameData(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => sameData(item, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && sameData(own(left, key), own(right, key)));
}

export type SpeciesChip = { common: string | undefined; scientific: string;
  /** The species record's own picture (a field holding an Image), when it has one. */
  picture?: InlineImageValue };

export type GenusSet = {
  name: string;
  count: number;
  countText: string;
  /** The genus-versus-family subset verdict; undefined when no comparison
   * of this genus with its family is in the data (no chip is drawn). */
  verdict: Verdict | undefined;
  species: readonly SpeciesChip[];
};

export type SetRelation =
  | { kind: "pairwise-disjoint"; terms: readonly string[] }
  | { kind: "shared"; terms: readonly string[]; shared: readonly SpeciesChip[] }
  | { kind: "overlap-undecided"; terms: readonly string[] }
  | { kind: "union-equal"; terms: readonly string[]; whole: string }
  | { kind: "union-within"; terms: readonly string[]; whole: string };

export type FamilySet = {
  name: string;
  commonName: string | undefined;
  count: number;
  countText: string;
  genera: readonly GenusSet[];
  relations: readonly SetRelation[];
};

/** A set by life form (PlantLifeFormSet); it cuts across the families. */
export type LifeFormSet = {
  /** The PlantLifeForm constructor, e.g. `PlantAnnual`. */
  key: string;
  title: string;
  count: number;
  countText: string;
  species: readonly SpeciesChip[];
};

/** One family ∩ life form cell. `empty` only when the data holds
 * `disjoint = Just true` and no shared species; `undecided` when the
 * disjointness verdict is `Nothing`; `not-empty` when the judgment decided
 * the sets meet but the data lists no shared species. */
export type CrossingCell =
  | { kind: "shared"; species: readonly SpeciesChip[] }
  | { kind: "empty" }
  | { kind: "not-empty" }
  | { kind: "undecided" };

export type CrossingTable = {
  columns: readonly { key: string; title: string }[];
  /** One row per family; a cell is undefined when the data has no crossing
   * for that family and life form. */
  rows: readonly { name: string; cells: readonly (CrossingCell | undefined)[] }[];
};

/** One answer of a set by name against a family or genus set it meets. */
export type NamedSetAnswer = {
  taxon: string;
  /** The family of a genus set; undefined for a family set. */
  family: string | undefined;
  verdict: Verdict;
  /** The botanical set's other species (only meaningful when it holds the set whole). */
  others: readonly SpeciesChip[];
};

/** A set made by people (PlantNamedSpeciesSet): it cuts across genera or
 * families, so it is drawn beside the life-form sets, never inside a family. */
export type NamedSet = {
  name: string;
  count: number;
  countText: string;
  species: readonly SpeciesChip[];
  answers: readonly NamedSetAnswer[];
};

export type NestedSetsModel =
  | {
    kind: "collection";
    coverage: string;
    families: readonly FamilySet[] | undefined;
    /** Absent when the value has no life-form field; "undecided" for `Nothing`. */
    lifeForms?: readonly LifeFormSet[] | "undecided";
    crossings?: CrossingTable | "undecided";
    /** Absent when the value has no sets by name; "undecided" for `Nothing`. */
    namedSets?: readonly NamedSet[] | "undecided";
  }
  | { kind: "family"; family: FamilySet };

const LIFE_FORM_TITLES: Readonly<Record<string, string>> = {
  PlantAnnual: "Annuals",
  PlantBiennial: "Biennials",
  PlantPerennial: "Perennials",
};

/** The plural title of a PlantLifeForm constructor; undefined for any other. */
export function lifeFormTitle(tag: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(LIFE_FORM_TITLES, tag) ? LIFE_FORM_TITLES[tag] : undefined;
}

export function speciesCountText(count: number): string {
  return `${count} species`;
}

function readSpecies(value: unknown): SpeciesChip | undefined {
  if (!isRecord(value)) return undefined;
  const scientific = own(value, "scientificName");
  const commonNames = strings(own(value, "commonNames"));
  if (typeof scientific !== "string" || !commonNames) return undefined;
  const first = commonNames.find((name) => name.trim() !== "");
  const picture = fieldPicture(value);
  return { common: first === undefined ? undefined : capitalised(first), scientific, ...(picture ? { picture } : {}) };
}

function readSpeciesList(value: unknown): SpeciesChip[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows = value.map(readSpecies);
  return rows.every((row): row is SpeciesChip => row !== undefined) ? rows : undefined;
}

type ReadSet = { name: string; commonName: string | undefined; taxon: unknown; members: SpeciesChip[]; raw: unknown };

/** A PlantSpeciesSet: its taxon's name (family, genus or species) and members. */
function readSpeciesSet(value: unknown): ReadSet | undefined {
  if (!isRecord(value)) return undefined;
  const taxon = own(value, "taxon");
  const taxonTag = tagOf(taxon);
  if (taxonTag !== "TaxonFamily" && taxonTag !== "TaxonGenus" && taxonTag !== "TaxonSpecies") return undefined;
  const record = payload(taxon);
  const name = own(record, "scientificName");
  if (typeof name !== "string") return undefined;
  const commonNames = strings(own(record, "commonNames"));
  if (!commonNames) return undefined;
  const members = readSpeciesList(own(value, "members"));
  if (!members) return undefined;
  const first = commonNames.find((common) => common.trim() !== "");
  return { name, commonName: first, taxon, members, raw: value };
}

type ReadComparison = {
  firstTaxon: unknown; secondTaxon: unknown; firstName: string; secondName: string;
  firstWithinSecond: Verdict; disjoint: Verdict; shared: SpeciesChip[];
};

function readComparison(value: unknown): ReadComparison | undefined {
  if (!isRecord(value)) return undefined;
  const first = readSpeciesSet(own(value, "first"));
  const second = readSpeciesSet(own(value, "second"));
  const firstWithinSecond = readVerdict(own(value, "firstWithinSecond"));
  const disjoint = readVerdict(own(value, "disjoint"));
  const shared = readSpeciesList(own(value, "shared"));
  if (!first || !second || !firstWithinSecond || !disjoint || !shared) return undefined;
  return { firstTaxon: first.taxon, secondTaxon: second.taxon, firstName: first.name, secondName: second.name,
    firstWithinSecond, disjoint, shared };
}

function readComparisons(value: unknown): ReadComparison[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows = value.map(readComparison);
  return rows.every((row): row is ReadComparison => row !== undefined) ? rows : undefined;
}

function readFamily(value: unknown): FamilySet | undefined {
  if (!isRecord(value)) return undefined;
  const family = readSpeciesSet(own(value, "family"));
  const generaValue = own(value, "genera");
  if (!family || !Array.isArray(generaValue)) return undefined;
  const genera = generaValue.map(readSpeciesSet);
  if (!genera.every((genus): genus is ReadSet => genus !== undefined)) return undefined;
  const within = readComparisons(own(value, "genusWithinFamily"));
  const pairs = readComparisons(own(value, "genusComparisons"));
  const union = own(value, "union");
  if (!within || !pairs || !isRecord(union)) return undefined;
  const unionWithinFamily = readVerdict(own(union, "unionWithinFamily"));
  const familyWithinUnion = readVerdict(own(union, "familyWithinUnion"));
  if (!unionWithinFamily || !familyWithinUnion) return undefined;

  const genusSets: GenusSet[] = genera.map((genus, index) => {
    // The comparison of THIS genus with THIS family: same position when the
    // data keeps the order, otherwise the one whose taxa match.
    const matches = (row: ReadComparison | undefined) => !!row
      && sameData(row.firstTaxon, genus.taxon) && sameData(row.secondTaxon, family.taxon);
    const comparison = matches(within[index]) ? within[index] : within.find(matches);
    return { name: genus.name, count: genus.members.length, countText: speciesCountText(genus.members.length),
      verdict: comparison?.firstWithinSecond, species: genus.members };
  });

  // One summary line only when the data holds `disjoint = Just true` for EVERY
  // pair of genus sets (matched by their taxa, in either order). Otherwise each
  // pair that is not decided disjoint is listed on its own; a missing pair is
  // never summarised as disjoint.
  const relations: SetRelation[] = [];
  const genusNames = genera.map((genus) => genus.name);
  const decidedDisjoint = (left: ReadSet, right: ReadSet) => pairs.some((row) => row.disjoint === "true"
    && ((sameData(row.firstTaxon, left.taxon) && sameData(row.secondTaxon, right.taxon))
      || (sameData(row.firstTaxon, right.taxon) && sameData(row.secondTaxon, left.taxon))));
  const everyPairDisjoint = genera.length >= 2
    && genera.every((left, index) => genera.slice(index + 1).every((right) => decidedDisjoint(left, right)));
  if (everyPairDisjoint) relations.push({ kind: "pairwise-disjoint", terms: genusNames });
  else {
    for (const pair of pairs) {
      const terms = [pair.firstName, pair.secondName];
      if (pair.disjoint === "false") relations.push({ kind: "shared", terms, shared: pair.shared });
      else if (pair.disjoint === "undecided") relations.push({ kind: "overlap-undecided", terms });
    }
  }
  if (genera.length >= 2 && unionWithinFamily === "true") {
    relations.push(familyWithinUnion === "true"
      ? { kind: "union-equal", terms: genusNames, whole: family.name }
      : { kind: "union-within", terms: genusNames, whole: family.name });
  }

  return { name: family.name, commonName: family.commonName, count: family.members.length,
    countText: speciesCountText(family.members.length), genera: genusSets, relations };
}

/** A PlantLifeFormSet; undefined for an unknown life form or any other shape. */
function readLifeFormSet(value: unknown): LifeFormSet | undefined {
  if (!isRecord(value)) return undefined;
  const key = tagOf(own(value, "lifeForm"));
  const title = key === undefined ? undefined : lifeFormTitle(key);
  const members = readSpeciesList(own(value, "members"));
  if (key === undefined || title === undefined || !members) return undefined;
  return { key, title, count: members.length, countText: speciesCountText(members.length), species: members };
}

/** A PlantNamedSetPlacement: the set by name and each botanical set it meets
 * (the data already leaves out the sets decided disjoint from it). */
function readNamedSet(value: unknown): NamedSet | undefined {
  if (!isRecord(value)) return undefined;
  const named = own(value, "named");
  const name = own(named, "name");
  const members = readSpeciesList(own(named, "members"));
  const meets = own(value, "meets");
  if (typeof name !== "string" || !members || !Array.isArray(meets)) return undefined;
  const answers: NamedSetAnswer[] = [];
  for (const row of meets) {
    const taxon = readSpeciesSet(own(row, "taxon"));
    const verdict = readVerdict(own(row, "namedWithinTaxon"));
    const others = readSpeciesList(own(row, "onlyTaxon"));
    if (!taxon || !verdict || !others) return undefined;
    const familyName = tagOf(taxon.taxon) === "TaxonGenus" ? own(own(payload(taxon.taxon), "family"), "scientificName") : undefined;
    answers.push({ taxon: taxon.name, family: typeof familyName === "string" ? familyName : undefined, verdict, others });
  }
  return { name, count: members.length, countText: speciesCountText(members.length), species: members, answers };
}

type ReadCrossing = { family: string; lifeForm: LifeFormSet; cell: CrossingCell };

function readCrossing(value: unknown): ReadCrossing | undefined {
  if (!isRecord(value)) return undefined;
  const family = readSpeciesSet(own(value, "family"));
  const lifeForm = readLifeFormSet(own(value, "lifeForm"));
  const shared = readSpeciesList(own(value, "shared"));
  const disjoint = readVerdict(own(value, "disjoint"));
  const familyWithinLifeForm = readVerdict(own(value, "familyWithinLifeForm"));
  if (!family || !lifeForm || !shared || !disjoint || !familyWithinLifeForm) return undefined;
  const cell: CrossingCell = disjoint === "undecided" ? { kind: "undecided" }
    : shared.length > 0 ? { kind: "shared", species: shared }
    : disjoint === "true" ? { kind: "empty" }
    : { kind: "not-empty" };
  return { family: family.name, lifeForm, cell };
}

/** Families as rows (first appearance), life forms as columns (the order of
 * the life-form sets, then any other life form in first appearance). */
function crossingTable(crossings: readonly ReadCrossing[], lifeForms: readonly LifeFormSet[] | undefined): CrossingTable {
  const columns: { key: string; title: string }[] = (lifeForms ?? []).map((set) => ({ key: set.key, title: set.title }));
  const rowNames: string[] = [];
  for (const crossing of crossings) {
    if (!columns.some((column) => column.key === crossing.lifeForm.key)) {
      columns.push({ key: crossing.lifeForm.key, title: crossing.lifeForm.title });
    }
    if (!rowNames.includes(crossing.family)) rowNames.push(crossing.family);
  }
  const rows = rowNames.map((name) => ({
    name,
    cells: columns.map((column) => crossings.find((crossing) => crossing.family === name && crossing.lifeForm.key === column.key)?.cell),
  }));
  return { columns, rows };
}

/** A `Maybe (List a)` field read item by item. `absent` when the record has
 * no such field; undefined when the field or any item is unrecognised. */
function readOptionalList<T>(value: unknown, item: (row: unknown) => T | undefined):
  { kind: "absent" } | { kind: "undecided" } | { kind: "rows"; rows: T[] } | undefined {
  if (value === undefined) return { kind: "absent" };
  const maybe = readMaybe(value);
  if (!maybe) return undefined;
  if (!maybe.present) return { kind: "undecided" };
  if (!Array.isArray(maybe.value)) return undefined;
  const rows = maybe.value.map(item);
  return rows.every((row): row is T => row !== undefined) ? { kind: "rows", rows } : undefined;
}

/** The view model of a PlantSpeciesSetsInCollection or a single
 * PlantFamilySpeciesSets; undefined for any other shape. */
export function readNestedSets(value: unknown): NestedSetsModel | undefined {
  if (!isRecord(value)) return undefined;
  const coverage = own(value, "coverage");
  if (typeof coverage === "string") {
    const families = readMaybe(own(value, "families"));
    if (!families) return undefined;
    let familyRows: FamilySet[] | undefined;
    if (families.present) {
      if (!Array.isArray(families.value)) return undefined;
      const rows = families.value.map(readFamily);
      if (!rows.every((row): row is FamilySet => row !== undefined)) return undefined;
      familyRows = rows;
    }
    const lifeForms = readOptionalList(own(value, "lifeForms"), readLifeFormSet);
    const crossings = readOptionalList(own(value, "crossings"), readCrossing);
    const namedSets = readOptionalList(own(value, "namedSets"), readNamedSet);
    if (!lifeForms || !crossings || !namedSets) return undefined;
    const model: Extract<NestedSetsModel, { kind: "collection" }> = { kind: "collection", coverage, families: familyRows };
    if (lifeForms.kind !== "absent") model.lifeForms = lifeForms.kind === "undecided" ? "undecided" : lifeForms.rows;
    if (crossings.kind !== "absent") {
      model.crossings = crossings.kind === "undecided" ? "undecided"
        : crossingTable(crossings.rows, lifeForms.kind === "rows" ? lifeForms.rows : undefined);
    }
    if (namedSets.kind !== "absent") model.namedSets = namedSets.kind === "undecided" ? "undecided" : namedSets.rows;
    return model;
  }
  const family = readFamily(value);
  return family ? { kind: "family", family } : undefined;
}

/** A classification of any depth (the tree of life, the foods): read in
 * nested-sets-classification.ts, drawn by the same view. */
export { readClassification, type ClassificationModel } from "./nested-sets-classification";

/** The one-line form used inside a record row: `Apiaceae ⊇ Foeniculum, Ferula`.
 * Only genera whose subset verdict is `Just true` are written inside ⊇. */
export function nestedSetsInlineText(model: NestedSetsModel): string {
  const familyText = (family: FamilySet) => {
    const within = family.genera.filter((genus) => genus.verdict === "true").map((genus) => genus.name);
    return within.length > 0 ? `${family.name} ⊇ ${within.join(", ")}` : `${family.name}, ${family.countText}`;
  };
  if (model.kind === "family") return familyText(model.family);
  if (!model.families) return "Not decided";
  return model.families.map(familyText).join("; ");
}

export function familyTitle(family: FamilySet): string {
  return family.commonName ? `${family.name} · ${family.commonName}` : family.name;
}

/** The wording of a subset verdict on hover, shared by the boxes and the graph. */
export const VERDICT_TOOLTIP = {
  true: "Decided by Fenel's subset judgment on the species records",
  false: "Fenel's subset judgment decided that this set is not a subset",
  undecided: "Fenel's subset judgment did not decide this",
} as const;

export function verdictText(verdict: Verdict, whole: string): string {
  return verdict === "true" ? `⊆ ${whole}` : verdict === "false" ? "not a subset" : "not decided";
}

function speciesNames(species: readonly SpeciesChip[]): string {
  return species.map((row) => row.common ?? row.scientific).join(", ");
}

/** The drawing itself says "these boxes are apart and together they fill the
 * outer box", and a box inside another says "within". Only an answer the
 * picture alone would get wrong is written out: a shared member, an undecided
 * overlap, a union that falls short, a genus decided not within (or not
 * decided). The expected answers stay in the model and its tooltips. */
export function relationNeedsWords(relation: SetRelation): boolean {
  return relation.kind !== "pairwise-disjoint" && relation.kind !== "union-equal";
}
export function verdictNeedsWords(verdict: "true" | "false" | "undecided" | undefined): boolean {
  return verdict === "false" || verdict === "undecided";
}

/** A set by name is drawn on its own, not inside any family, so its answers
 * are written out. The one answer the picture already gives is "within the
 * family" when the set is within one of that family's genera: the genus box
 * is drawn inside its family. */
export function namedAnswerNeedsWords(answer: NamedSetAnswer, answers: readonly NamedSetAnswer[]): boolean {
  if (answer.verdict !== "true" || answer.family !== undefined) return true;
  return !answers.some((other) => other.verdict === "true" && other.family === answer.taxon);
}

export function namedAnswerText(answer: NamedSetAnswer): string {
  switch (answer.verdict) {
    case "true": return answer.others.length > 0
      ? `Within ${answer.taxon}, which also holds ${speciesNames(answer.others)}`
      : `The same species as ${answer.taxon}`;
    case "false": return `Not within ${answer.taxon}`;
    case "undecided": return `Within ${answer.taxon}: not decided`;
  }
}

export function relationText(relation: SetRelation): string {
  switch (relation.kind) {
    case "pairwise-disjoint": return `The ${relation.terms.length} genus sets are pairwise disjoint`;
    case "shared": return relation.shared.length > 0
      ? `${relation.terms.join(" ∩ ")} = {${speciesNames(relation.shared)}}`
      : `${relation.terms.join(" ∩ ")} ≠ ∅`;
    case "overlap-undecided": return `${relation.terms.join(" ∩ ")}: not decided`;
    case "union-equal": return `Their union is ${relation.whole}`;
    case "union-within": return `Their union is a subset of ${relation.whole}`;
  }
}

/** The formula behind a summary line, for its tooltip. */
export function relationTooltip(relation: SetRelation): string | undefined {
  switch (relation.kind) {
    case "pairwise-disjoint": return `Every pair of ${relation.terms.join(", ")} has an empty intersection, decided by Fenel's set judgment`;
    case "union-equal": return `${relation.terms.join(" ∪ ")} = ${relation.whole}, decided by Fenel's set judgment`;
    case "union-within": return `${relation.terms.join(" ∪ ")} ⊆ ${relation.whole}, decided by Fenel's set judgment`;
    default: return undefined;
  }
}

export function crossingCellText(cell: CrossingCell): string {
  switch (cell.kind) {
    case "shared": return speciesNames(cell.species);
    case "empty": return "∅";
    case "not-empty": return "≠ ∅";
    case "undecided": return "not decided";
  }
}
