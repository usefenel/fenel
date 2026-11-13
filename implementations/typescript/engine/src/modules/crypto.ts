// ---------------------------------------------------------------------------
// Crypto — module-substrate seam (typed-function-references Phase FM-retire-8
// Step 2, 2026-06-07).
//
// 7 host-crypto fns spun out of state.ts (where `crypto:*` rode alongside the
// state substrate IO leaves). Source of truth:
//   - `fenel/modules/crypto/types.fenel` — `module crypto where` + the 7 `@native`
//     foreign declarations (4 with `@ioAction "crypto.*"` + `@requires
//     "HasStateIO"`; 3 sync natives with no ioAction/requires, 2 carrying a
//     divergent `@codeName` scryptHash/scryptVerify);
//   - `fenel/modules/crypto/ffi/crypto-ffi.ts` — the 3 irreducible host-crypto
//     ctx native impls (crypto-random / scrypt / timing-safe compare).
//
// CTX-ONLY (like dispatch/animation/track): the 3 sync natives → `nativeImplsCtx`
// (rekeyed short-suffix → `crypto:<suffix>`); NO plain `nativeImpls`. The 4
// IO-backed fns resolve through the runtime `registerCryptoHandlers` (UNCHANGED).
// The `crypto:` id-prefix is byte-identical to the retired specs, so the api-route
// + core/auth consumers need 0 edits. Wired into the SAME registries stateModule
// rides (SYSTEM_MODULES, type-catalog ALL_MODULES, runtime loadRegistry, the
// self-host-matrix list, the engine package.json `./modules/crypto` export) — but
// NOT getSystemRegistry (crypto rode stateModule, which is absent there).
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { rekeyNativesById } from "../function-builder";
import { loadFenelModule } from "../fenel-module";
import { cryptoNativesCtx } from "../../../../../fenel/modules/crypto/ffi/crypto-ffi";
import CRYPTO_TYPES_FENEL from "../../../../../fenel/modules/crypto/types.fenel?raw";

const loaded = loadFenelModule(CRYPTO_TYPES_FENEL, "crypto", { label: "Crypto" });

export const cryptoModule: FenelModule = {
  ...loaded,
  nativeImplsCtx: rekeyNativesById(cryptoNativesCtx, "crypto") as Record<
    string,
    (ctx: unknown, ...args: unknown[]) => unknown
  >,
};
