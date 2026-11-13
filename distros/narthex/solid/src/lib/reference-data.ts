// ---------------------------------------------------------------------------
// Reference-data adapter — the frontend's thin view over the universal by-type
// register query for the bundled reference entities (country / currency /
// language / platform).
//
// storage-as-effect Phase 3d (D5 slice 4): the engine-side `getStaticData` /
// `hasStaticData` / `listStaticDataEntities` shim was RETIRED. Reference rows
// are just instances in the unified register, queried the SAME way the frontend
// queries any entity — `dispatchRegistry.listInstances(typeName)`. This adapter is
// the one shared client-side wrapper: it resolves the call site's codeName
// ("country") to the register's type-def name ("Country") via the loader's own
// pairing (`referenceTypeByCodeName` — a catalog projection, NOT a hardcoded
// table) and returns the by-type instances' `methods`.
//
// `country._flag` is NOT a baked row field (Phase 3c dropped it). It is the
// pure `std:countryFlag` projection over the 2-letter code (the source of
// truth). This adapter materializes it AT THE EDGE (M-edge) by CALLING the
// projection — it does NOT reimplement flag-from-code in TS. The materialization
// patches the shared register instances ONCE on first country read (the 3c
// `ensureCountryFlagsMaterialized` shape, relocated here) so all three readers
// (the ref dropdowns, the reference-data table, the record counts) see `_flag`
// consistently — one materialization, three readers. Uses
// `createRepositoryRegistry([stdModule])` — the same browser-proven Fenel-eval path the
// FunctionPicker / ExpressionEditor use.
// ---------------------------------------------------------------------------

import {
  dispatchRegistry,
  referenceTypeByCodeName,
  stdModule,
  invokeCallable,
  type EvaluateContext,
} from "@fenel/engine";
import { createRepositoryRegistry } from "@fenel/engine/repository-registry";
import { For } from "solid-js";
import { accountFieldRegistry } from "./account-field-registry";
import { GLOBAL_ONLY, instanceVisible } from "@fenel/engine";

let _countryFlagCtx: EvaluateContext | undefined;
let _countryFlagsMaterialized = false;

/** Materialize `country._flag` from the pure `std:countryFlag` projection,
 *  patched once into the shared register instances (parity with the by-type
 *  query). Built lazily on first country read. */
function ensureCountryFlagsMaterialized(): void {
  if (_countryFlagsMaterialized) return;
  _countryFlagsMaterialized = true;
  if (!_countryFlagCtx) _countryFlagCtx = (accountFieldRegistry() ?? createRepositoryRegistry([stdModule])).evaluateContext();
// ⚠ rights R3a — GLOBAL_ONLY, DECLARED (brief §8.1b). The browser registry has no
// frame to derive an account from, so every selection here is fenced to the
// repository. That CLOSES the leak — an account-authored row used to be read by
// every account's browser — and DECLARES the loss: an account's own overlays
// stop being read here until R3a-tail's registry-identity filter or R4's decider
// authority restores them.
  // For reference data this is also the same honest fence as `bundleRowsOf`:
  // `Country` / `Currency` rows are BUNDLED repository data.
  for (const inst of dispatchRegistry.listInstances("Country")) {
    if (!instanceVisible(inst, GLOBAL_ONLY)) continue;
    const m = inst.methods as Record<string, unknown>;
    if (typeof m._flag === "string") continue;
    m._flag = invokeCallable("std:countryFlag", [m.code], _countryFlagCtx) as string;
  }
}

/** Reference rows for an entity, by its codeName ("currency" / "country" / …) —
 *  the universal by-type register query. Returns `undefined` for any entity
 *  without registered reference rows. For "country", materializes the derived
 *  `_flag` projection at the edge. */
export function referenceRows(
  codeName: string,
): Record<string, unknown>[] | undefined {
  const typeName = referenceTypeByCodeName().get(codeName);
  if (!typeName) return undefined;
  if (typeName === "Country") ensureCountryFlagsMaterialized();
  // rights R3a — bundled reference rows only; see the note above.
  return dispatchRegistry
    .listInstances(typeName)
    .filter((i) => instanceVisible(i, GLOBAL_ONLY))
    .map((i) => i.methods) as Record<string, unknown>[];
}

/** Whether an entity ships bundled reference rows — register-membership
 *  predicate (replaces the retired `hasStaticData` accessor). */
export function isReferenceEntity(codeName: string): boolean {
  return referenceTypeByCodeName().has(codeName);
}
