// ---------------------------------------------------------------------------
// Resolution lattices — built-in granularity definitions
//
// One concept, three domains:
//   decimalLattice  — numbers: step = 1/10^n (lazy, infinite)
//   timeLattice     — dates: year → month → day → hour → minute → second
//
// Tree-based lattices (geography, taxonomy) are user-defined at runtime
// from the tree's depth labels.
// ---------------------------------------------------------------------------

import type {
  ResolutionLattice,
  ResolutionLevel,
  DateResolution,
} from "./types";

import { DATE_RESOLUTION_LEVELS as DATE_LEVELS } from "./types";
import { Just, Nothing } from "./type-foundation";

// ---------------------------------------------------------------------------
// Decimal lattice — numbers with fixed-point precision
// ---------------------------------------------------------------------------

/** Generate decimal resolution levels lazily: units, tenths, hundredths, ... */
function* decimalLevels(): Iterable<ResolutionLevel> {
  let den = 1;
  const names = [
    "units", "tenths", "hundredths", "thousandths",
    "ten-thousandths", "hundred-thousandths", "millionths",
    "ten-millionths", "hundred-millionths",
  ];
  for (let i = 0; i < names.length; i++) {
    const n = names[i]!;
    yield { name: n, step: Just([1, den] as [number, number]), label: Just(n) };
    den *= 10;
  }
}

/** Map level name → denominator for decimal lattice */
const DECIMAL_LEVEL_INDEX: Record<string, number> = {
  units: 0, tenths: 1, hundredths: 2, thousandths: 3,
  "ten-thousandths": 4, "hundred-thousandths": 5, millionths: 6,
  "ten-millionths": 7, "hundred-millionths": 8,
};

/**
 * Check if a number value is a multiple of the step [num, den].
 * For step [1, 100]: value * 100 must be an integer.
 */
export function isMultipleOf(value: number, step: [number, number]): boolean {
  const [num, den] = step;
  // value must be a multiple of num/den
  // i.e. (value * den / num) must be an integer
  const scaled = (value * den) / num;
  return Math.abs(scaled - Math.round(scaled)) < 1e-9;
}

/**
 * Truncate a number to the given step size.
 * For step [1, 100]: round to nearest 0.01.
 */
export function truncateToStep(value: number, step: [number, number]): number {
  const [num, den] = step;
  const factor = den / num;
  return Math.round(value * factor) / factor;
}

/** Convert resolution fraction [num, den] to a decimal level name */
export function stepToLevelName(step: [number, number]): string | undefined {
  const [num, den] = step;
  if (num !== 1) return undefined;
  const exp = Math.round(Math.log10(den));
  if (10 ** exp !== den) return undefined;
  const names = Object.keys(DECIMAL_LEVEL_INDEX);
  return names[exp];
}

/** Convert a decimal level name to step fraction */
export function levelNameToStep(name: string): [number, number] | undefined {
  const idx = DECIMAL_LEVEL_INDEX[name];
  if (idx === undefined) return undefined;
  return [1, 10 ** idx];
}

export const decimalLattice: ResolutionLattice = {
  name: "decimal",
  levels: decimalLevels,
  compare(a: string, b: string): -1 | 0 | 1 {
    const ia = DECIMAL_LEVEL_INDEX[a];
    const ib = DECIMAL_LEVEL_INDEX[b];
    if (ia === undefined || ib === undefined) return 0;
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  },
  validate(value: unknown, level: string): boolean {
    if (typeof value !== "number") return false;
    const step = levelNameToStep(level);
    if (!step) return false;
    return isMultipleOf(value, step);
  },
  truncate(value: unknown, level: string): unknown {
    if (typeof value !== "number") return value;
    const step = levelNameToStep(level);
    if (!step) return value;
    return truncateToStep(value, step);
  },
};

// ---------------------------------------------------------------------------
// Time lattice — date precision levels
// ---------------------------------------------------------------------------

/** Map level → index for ordering */
const TIME_LEVEL_INDEX: Record<string, number> = {};
DATE_LEVELS.forEach((l, i) => { TIME_LEVEL_INDEX[l] = i; });

/** Expected ISO string length for each precision level */
const DATE_FORMAT_LENGTH: Record<DateResolution, number> = {
  year: 4,        // "2026"
  month: 7,       // "2026-04"
  day: 10,        // "2026-04-12"
  hour: 13,       // "2026-04-12T15"
  minute: 16,     // "2026-04-12T15:30"
  second: 19,     // "2026-04-12T15:30:45"
};

/** Truncate an ISO date string to the given precision */
export function truncateDate(dateStr: string, level: DateResolution): string {
  const len = DATE_FORMAT_LENGTH[level];
  if (!len) return dateStr;
  return dateStr.slice(0, len);
}

/** Validate that a date string doesn't exceed the given precision */
export function validateDateResolution(dateStr: string, level: DateResolution): boolean {
  const maxLen = DATE_FORMAT_LENGTH[level];
  if (!maxLen) return true;
  // Strip trailing Z or timezone offset for length check
  const clean = dateStr.replace(/[Z+-]\d{2}:?\d{2}$/, "").replace(/Z$/, "");
  return clean.length <= maxLen;
}

export const timeLattice: ResolutionLattice = {
  name: "time",
  levels: () => DATE_LEVELS.map((name) => ({
    name,
    step: Nothing,
    label: name.charAt(0).toUpperCase() + name.slice(1),
  })),
  compare(a: string, b: string): -1 | 0 | 1 {
    const ia = TIME_LEVEL_INDEX[a];
    const ib = TIME_LEVEL_INDEX[b];
    if (ia === undefined || ib === undefined) return 0;
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  },
  validate(value: unknown, level: string): boolean {
    if (typeof value !== "string") return false;
    return validateDateResolution(value, level as DateResolution);
  },
  truncate(value: unknown, level: string): unknown {
    if (typeof value !== "string") return value;
    return truncateDate(value, level as DateResolution);
  },
};

// ---------------------------------------------------------------------------
// Lattice registry — look up by name
// ---------------------------------------------------------------------------

/** Pre-built geography lattice — the standard levels for address resolution */
export const geographyLattice: ResolutionLattice = treeLattice("geography", [
  "country", "region", "city", "postal_code", "street", "address",
]);

const builtinLattices: Record<string, ResolutionLattice> = {
  decimal: decimalLattice,
  time: timeLattice,
  geography: geographyLattice,
};

/** Get a built-in lattice by name */
export function getLattice(name: string): ResolutionLattice | undefined {
  return builtinLattices[name];
}

/** Register a custom lattice (for tree-based types like geography) */
export function registerLattice(lattice: ResolutionLattice): void {
  builtinLattices[lattice.name] = lattice;
}

/**
 * Create a tree-based lattice from an ordered list of depth labels.
 * Use this for geography, taxonomy, org charts, etc.
 *
 * Phase 4 of field-meta-collapse — superseded by the `Resolvable`
 * typeclass instances at builtin-classes.ts:1595+ for `Place : GeoLevel
 * -> Type`. Retained as transitional fallback while the editor's
 * soft-fallback path still loads unmigrated `meta.refGeoResolution`
 * rows; full removal scheduled for the Phase 4 follow-up commit once
 * all consumers route through Resolvable.
 */
export function treeLattice(name: string, levels: string[]): ResolutionLattice {
  const index: Record<string, number> = {};
  levels.forEach((l, i) => { index[l] = i; });

  return {
    name,
    levels: () => levels.map((l) => ({ name: l, step: Nothing, label: Just(l) })),
    compare(a: string, b: string): -1 | 0 | 1 {
      const ia = index[a];
      const ib = index[b];
      if (ia === undefined || ib === undefined) return 0;
      return ia < ib ? -1 : ia > ib ? 1 : 0;
    },
    validate(value: unknown, level: string): boolean {
      // For tree paths (arrays), check depth
      if (Array.isArray(value)) {
        const maxDepth = (index[level] ?? levels.length - 1) + 1;
        return value.length <= maxDepth;
      }
      return true;
    },
    truncate(value: unknown, level: string): unknown {
      if (Array.isArray(value)) {
        const maxDepth = (index[level] ?? levels.length - 1) + 1;
        return value.slice(0, maxDepth);
      }
      return value;
    },
  };
}
