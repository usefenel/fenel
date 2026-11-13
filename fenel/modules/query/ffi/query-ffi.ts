// ---------------------------------------------------------------------------
// query — FFI leaf (the 2 engine-dispatch-bridge natives).
//
// solver-extension Phase 4 — the live `queryRel` exposure. These two sync
// natives are the irreducible host re-entry from a production Fenel
// orchestration body (`state:queryRel`) into the engine's SHIPPED query
// machinery, run in the engine's CURATED dispatch harness rather than the
// production registry.
//
// WHY TS (the engine-dispatch boundary — the prover/ffi category):
//   The engine query bodies (rel-solve / solve / reify / materialize /
//   enumerate) call bare `contains` meaning `std:contains`. The production
//   registry resolves bare `contains` → `set:contains` (the set-membership
//   decider — decidableMembershipModule is in prod, codeName resolution is
//   last-write-wins), so running them in the production registry mis-dispatches
//   and crashes on a `$`-keyed-SetExpr marshal. The engine's `dispatchEngineBody`
//   harness (getHarness) is curated to avoid exactly this shadow. A Fenel body
//   cannot call `dispatchEngineBody` (host re-entry), so this `ffi/` native is
//   the hop. It is the SAME category as `prover/ffi/prover-ffi.ts`'s
//   `decidableSetProposerNative` (a prod module bridging to engine bodies via
//   `dispatchEngineBody`, "GENUINE BRIDGE: host re-entry; un-portable by
//   definition") — NOT a new TS kind. It adds NO logic: it forwards the
//   caller's `$`-free markers to the SHIPPED `dispatchedQueryRel` /
//   `dispatchedQueryRelOne` wrappers (engine-bodies-dispatch.ts, expr-substrate
//   Phase 16) and returns the Maybe result verbatim.
//
// The content-gate (`ts-elimination-completion`) permits `.ts` under
// `fenel/modules/` ONLY inside an `ffi/` folder. LEDGERED in
// design/ts-exceptions-ledger.md.
// ---------------------------------------------------------------------------

import {
  dispatchedQueryRel,
  dispatchedQueryRelOne,
} from "../../../../implementations/typescript/engine/src/engine-bodies-dispatch";

/** query:rel — findall over the materialized relations (bridge to
 *  engine:queryRel). ctx is ignored (the markers carry everything). */
function relNative(
  _ctx: unknown,
  expr: unknown,
  relDefs: unknown,
  rules: unknown,
): unknown {
  return dispatchedQueryRel(expr, relDefs, rules);
}

/** query:relOne — first-witness sibling (bridge to engine:queryRelOne). */
function relOneNative(
  _ctx: unknown,
  expr: unknown,
  relDefs: unknown,
  rules: unknown,
): unknown {
  return dispatchedQueryRelOne(expr, relDefs, rules);
}

// Short-suffix keys; the seam rekeys them → `query:<suffix>` via
// `rekeyNativesById` (the crypto / dispatch ctx-native convention).
export const queryNativesCtx = {
  rel: relNative,
  relOne: relOneNative,
};
