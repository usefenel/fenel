// Pure decisions behind the lens toolbar's data path (`locus-breadcrumb.tsx`):
// which entries the full path lists, in which order, how a narrow toolbar's
// one path button names it, and how much of the current name that button
// keeps before its ellipsis. No DOM and no Solid here, so each rule is tested
// on its own (`locus-path.test.ts`).

/** One entry of the full data path, read root first and current data last.
 * `all-data` is the lens's "All data" overview, which sits above the data
 * root when the lens offers it; every other entry is an exact scope. */
export type LocusPathEntry<S> =
  | { kind: "all-data" }
  | { kind: "scope"; scope: S; current: boolean };

/** The complete path: the "All data" overview (when the lens offers it and is
 * not already showing it), every ancestor in order, then the current scope,
 * the only entry marked current. */
export function locusPathEntries<S>(input: {
  ancestors: readonly S[];
  current: S;
  allDataEntry: boolean;
}): LocusPathEntry<S>[] {
  return [
    ...(input.allDataEntry ? [{ kind: "all-data" } as const] : []),
    ...input.ancestors.map((scope) => ({ kind: "scope" as const, scope, current: false })),
    { kind: "scope" as const, scope: input.current, current: true },
  ];
}

/** The separator the path's accessible name and tooltip read between steps. */
export const LOCUS_PATH_SEPARATOR = " > ";

/** The one path button's accessible name and tooltip: the whole path, with
 * separators, so a reader who sees only the current name can hear the rest. */
export function locusPathAccessibleName(labels: readonly string[]): string {
  return "Path: " + labels.map((label) => label.trim() || "Data").join(LOCUS_PATH_SEPARATOR);
}

/** Characters of the current name the one path button keeps visible before
 * its ellipsis, so a narrow toolbar never shows only an icon or a cut letter. */
export const LOCUS_PATH_MIN_NAME_CHARS = 6;

/** The name's minimum width in `ch`: a short name stays whole; a longer one
 * keeps `LOCUS_PATH_MIN_NAME_CHARS` characters plus one for the ellipsis.
 * Counts code points, so an emoji or accented letter counts once. */
export function locusPathNameMinChars(name: string): number {
  const length = Array.from(name.trim()).length;
  return Math.min(length, LOCUS_PATH_MIN_NAME_CHARS + 1);
}
