// Callable names as shown to the reader. Engine-free, so the held lens names
// the functions it lists before any registry exists with the same rules as
// the prepared editor (call-display.ts re-exports these).
import { codeName, humanName, type DisplayName } from "../display-name";

/** The naming fields of a catalogue function entry (the prepared catalogue's
 * entries and the build-owned repository listing both carry them). */
export type CallableNameEntry = {
  readonly id: string;
  readonly label?: string;
  readonly codeName?: string;
  readonly targetId?: string;
  readonly kind?: string;
  readonly notation?: string;
  readonly parentModule?: string;
  readonly parentEntity?: string;
};

function decodePart(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

/** Presentation only. Exact callable handles must still be used for lookup,
 * inference and serialization; a displayed path is not a resolution rule. */
export function displayCallableHandle(handle: string): string {
  if (handle.startsWith("@ctor/")) {
    return handle.slice("@ctor/".length).split("/").filter(Boolean).map(decodePart).join(".");
  }
  const parts = handle.split(":");
  return parts.length === 2 ? parts[1]! : handle;
}

/** Reader fallback labels are presentation data. A legacy wire used as its
 * own fallback gets the existing short spelling. Callers keep an authored
 * Labelable value ahead of this synthesized-name path. */
export function displayCallableName(handle: string, label?: string, codeName?: string, fallback?: string): string {
  if (label && label !== handle && label !== codeName && label !== fallback) return label;
  return displayCallableHandle(codeName || fallback || label || handle);
}

export function constructorShortName(entry: CallableNameEntry): string {
  const name = entry.codeName ?? entry.id;
  return name.startsWith("@ctor/") ? decodePart(name.split("/").at(-1)!) : name;
}

export function constructorNameCounts(entries: readonly CallableNameEntry[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.kind !== "constructor") continue;
    const name = constructorShortName(entry);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

/** A catalogue function as the picker searches it (both sources carry these). */
export type SearchableFunctionEntry = CallableNameEntry & { readonly description?: string };

/** The one search order of the function picker, shared by its prepared and
 * held sources: exact, then prefix, then substring of the shown name (and its
 * qualified spellings), then of the label and the id; a description match
 * last. Lower ranks first; a function that does not match is Infinity. */
export function functionSearchRank(
  fn: SearchableFunctionEntry,
  query: string,
  counts?: ReadonlyMap<string, number>,
  qualifiedSpellings: readonly string[] = [],
): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const shown = displayFunctionName(fn, counts).toLowerCase();
  const label = (fn.label ?? "").toLowerCase();
  const id = fn.id.toLowerCase();
  const description = (fn.description ?? "").toLowerCase();
  const notation = fn.notation?.toLowerCase();
  const spellings = qualifiedSpellings.map(name => name.toLowerCase());

  if (fn.kind === "constructor" && constructorShortName(fn).toLowerCase() === q) return 0;
  if (shown === q || spellings.includes(q)) return 0;
  if (label === q) return 1;
  if (id === q) return 2;
  if (notation === q) return 3;

  if (shown.startsWith(q) || spellings.some(name => name.startsWith(q))) return 10;
  if (label.startsWith(q)) return 11;
  if (id.startsWith(q)) return 12;

  const shownIndex = shown.indexOf(q);
  if (shownIndex >= 0) return 20 + Math.min(shownIndex, 9);
  const qualifiedIndex = Math.min(...spellings.map(name => name.indexOf(q)).filter(index => index >= 0));
  if (Number.isFinite(qualifiedIndex)) return 20 + Math.min(qualifiedIndex, 9);
  const labelIndex = label.indexOf(q);
  if (labelIndex >= 0) return 35 + Math.min(labelIndex, 9);
  const idIndex = id.indexOf(q);
  if (idIndex >= 0) return 45 + Math.min(idIndex, 9);

  if (description.includes(q)) return 80;
  return Number.POSITIVE_INFINITY;
}

/** How well a search rank matches: exact (0), prefix (1), substring (2) or
 * description only (3). With a query typed, a closer name match lists first;
 * type fit orders the rows within a tier. */
export function functionSearchTier(rank: number): number {
  return rank < 10 ? 0 : rank < 20 ? 1 : rank < 80 ? 2 : 3;
}

/** Search rank, then the shown name. */
export function compareFunctionSearch(
  a: SearchableFunctionEntry,
  b: SearchableFunctionEntry,
  query: string,
  counts?: ReadonlyMap<string, number>,
  qualifiedSpellings?: (fn: SearchableFunctionEntry) => readonly string[],
): number {
  const rankA = functionSearchRank(a, query, counts, qualifiedSpellings?.(a));
  const rankB = functionSearchRank(b, query, counts, qualifiedSpellings?.(b));
  if (rankA !== rankB) return rankA - rankB;
  return displayFunctionName(a, counts).localeCompare(displayFunctionName(b, counts));
}

/** `displayFunctionName`, marked as code when no human label was used (the
 * shown name is the function's code name, or a constructor's tag/path). */
export function functionDisplayName(
  entry: CallableNameEntry,
  counts?: ReadonlyMap<string, number>,
): DisplayName {
  const text = displayFunctionName(entry, counts);
  const label = entry.label;
  const labelled = !!label && label !== entry.id && label !== entry.codeName && label !== (entry.targetId ?? entry.id)
    && (entry.kind !== "constructor" || label !== constructorShortName(entry));
  return labelled ? humanName(text) : codeName(text);
}

export function displayFunctionName(
  entry: CallableNameEntry,
  counts?: ReadonlyMap<string, number>,
): string {
  if (entry.kind === "constructor") {
    const name = constructorShortName(entry);
    const rawName = entry.codeName ?? entry.id;
    if (entry.label && entry.label !== name && entry.label !== rawName && entry.label !== entry.id) {
      return (counts?.get(name) ?? 0) > 1
        ? [entry.parentModule, entry.parentEntity, entry.label].filter(Boolean).join(".") : entry.label;
    }
    if (rawName.startsWith("@ctor/") || (counts?.get(name) ?? 0) > 1) {
      const target = entry.targetId ?? entry.id;
      if (target.startsWith("@ctor/")) return displayCallableHandle(target);
      return [entry.parentModule, entry.parentEntity, name].filter(Boolean).join(".");
    }
    return name;
  }
  const name = displayCallableName(entry.targetId ?? entry.id, entry.label, entry.codeName);
  return entry.notation === undefined || name === entry.notation ? name : `${name} (${entry.notation})`;
}
