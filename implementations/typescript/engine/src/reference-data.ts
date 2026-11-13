// ---------------------------------------------------------------------------
// Reference data — country / currency / language / platform rows.
//
// storage-as-effect Phase 3a (D5 slice 1): the rows are `.fenel` value-decls
// (`std/entities/{country,currency,language,platform}-data.fenel`), NOT
// hand-maintained TS arrays. The retired `engine/src/{countries,currencies,
// languages,platforms}.ts` data arrays were the live
// [[feedback_no_language_concept_in_ts]] violation — per-value Fenel facts
// encoded in TS. Each row is a nullary value-decl of its row type
// (`currency_USD = Currency {…}`) loaded as a pure dispatch target
// (`dispatchInstanceFile: true` ⇒ no by-name fn / no identity facet); the
// value-registry loader indexes each under its constructed type.
//
// This module is the thin TS VIEW over those rows: it loads them ONCE and
// exposes (a) typed array views + helper lookups for the typeclass-derivation
// consumers (PhoneFormat / HandleFormat / ExchangeRate in `modules/formats.ts`
// + `entity-typeclasses.ts`, locale validation in `locale.ts`, the catalog
// counts), and (b) `referenceInstances` + `referenceTypeByCodeName` for
// `system-entities.ts` to register into `dispatchRegistry` (the unified register)
// and for the frontend's `~/lib/reference-data` adapter to resolve the codeName
// it holds → the register's type-def name. Slice 3c moved identity off
// `defineSystemEntity`; slice 3d retired the `getStaticData` shim — the frontend
// reads the universal by-type query (`dispatchRegistry.listInstances`) directly,
// `referenceTypeByCodeName` is the loader's own codeName→type pairing it uses.
// ---------------------------------------------------------------------------

import countryDataSrc from "../../../../fenel/std/entities/country-data.fenel?raw";
import currencyDataSrc from "../../../../fenel/std/entities/currency-data.fenel?raw";
import languageDataSrc from "../../../../fenel/std/entities/language-data.fenel?raw";
import platformDataSrc from "../../../../fenel/std/entities/platform-data.fenel?raw";
import { loadFenelModule } from "./fenel-module";
import { foundationTemplates, foundationEntityRegs } from "./type-foundation";
import type { Instance } from "./types";

export type Currency = {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
};

export type Country = {
  code: string;
  alpha3: string;
  name: string;
  dialCode: string;
  currency: string;
  language: string;
};

export type Language = {
  code: string;
  name: string;
  nativeName: string;
};

export type Platform = {
  code: string;
  name: string;
  shortName: string;
  description: string;
  logo: string;
  handlePrefix: string;
  handleMaxLength: number;
  handlePattern: string;
  urlTemplate: string;
};

type LoadedRows = {
  /** Row-type constructor name ("Currency") the value-registry indexes under. */
  typeName: string;
  /** The loaded dispatch instances (typeName = typeName, args = []). */
  instances: Instance[];
  /** Row records (instance `methods`) — the value a by-type query returns. */
  rows: Record<string, unknown>[];
};

// Load the four `.fenel` reference files ONCE at module init. This uses ONLY
// `loadFenelModule` (no `foundationTemplates()`) — the eager rows are needed by
// `system-entities.ts buildRegistry` (the ExchangeRate / PhoneFormat /
// HandleFormat derivations), and calling `foundationTemplates()` this early in
// the system-entities import chain shifts its first-call ahead of the engine's
// usual boot order, amplifying a pre-existing cross-file module-init TDZ. The
// codeName↔type-name correlation (which DOES need `foundationTemplates()`) is
// deferred to `referenceTypeByCodeName()` — a lazy, memoised, runtime call.
const _loaded: LoadedRows[] = [];
{
  for (const src of [countryDataSrc, currencyDataSrc, languageDataSrc, platformDataSrc]) {
    const instances = loadFenelModule(src, "std", { dispatchInstanceFile: true }).instances ?? [];
    if (instances.length === 0) continue;
    _loaded.push({
      typeName: instances[0]!.typeName,
      instances,
      rows: instances.map((i) => i.methods as Record<string, unknown>),
    });
  }
}

const _byType = new Map(_loaded.map((l) => [l.typeName, l]));

/** All loaded reference instances, for registration into `dispatchRegistry`. */
export const referenceInstances: Instance[] = _loaded.flatMap((l) => l.instances);

// codeName ("currency") → row-type constructor name ("Currency"). LAZY +
// memoised: the loader keys each value-decl's SpecInstance by its construct head
// (the type_def name, "Currency"); the frontend + catalog identify the entity
// by its lowercase codeName ("currency"). The link is the loader's own
// (codeName, type) pairing — `foundationEntityRegs` carries the codeName,
// `foundationTemplates().entities` is keyed by the type_def name, and the SAME
// processed-type object identity bridges them. No hardcoded table. Resolved on
// first call (runtime, well after boot) so `foundationTemplates()` runs at its
// usual time.
let _typeByCodeName: Map<string, string> | undefined;
export function referenceTypeByCodeName(): Map<string, string> {
  if (_typeByCodeName) return _typeByCodeName;
  const ft = foundationTemplates();
  _typeByCodeName = new Map();
  for (const l of _loaded) {
    const reg = foundationEntityRegs.find((r) => ft.entities[l.typeName] === r.type);
    _typeByCodeName.set(reg?.codeName ?? l.typeName.toLowerCase(), l.typeName);
  }
  return _typeByCodeName;
}

const _rowsOf = (typeName: string): Record<string, unknown>[] =>
  _byType.get(typeName)?.rows ?? [];

// Typed array views (keyed by the row-type constructor name, known eagerly).
// `countries` strips the derived `_flag` (the pre-3a export + the
// typeclass-derivation input never carried it — only the static-data rows did,
// baked in for the frontend; `getStaticData("country")` returns it).
export const countries: Country[] = _rowsOf("Country").map(({ _flag, ...c }) => c) as Country[];
export const currencies: Currency[] = _rowsOf("Currency") as Currency[];
export const languages: Language[] = _rowsOf("Language") as Language[];
export const platforms: Platform[] = _rowsOf("Platform") as Platform[];

const _countryByCode = new Map(countries.map((c) => [c.code, c]));
const _currencyByCode = new Map(currencies.map((c) => [c.code, c]));
const _languageByCode = new Map(languages.map((l) => [l.code, l]));

export function getCountry(code: string): Country | undefined {
  return _countryByCode.get(code.toUpperCase());
}
export function countryName(code: string): string {
  return _countryByCode.get(code.toUpperCase())?.name ?? code;
}
export function getCurrency(code: string): Currency | undefined {
  return _currencyByCode.get(code.toUpperCase());
}
export function currencyName(code: string): string {
  return _currencyByCode.get(code.toUpperCase())?.name ?? code;
}
export function getLanguage(code: string): Language | undefined {
  return _languageByCode.get(code.toLowerCase());
}
export function languageName(code: string): string {
  return _languageByCode.get(code.toLowerCase())?.name ?? code;
}
