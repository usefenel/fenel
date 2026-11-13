// ---------------------------------------------------------------------------
// Twitter / X — module-substrate Phase 3q seam.
//
// `twitter` is one half of the "signature-only pair" Surprise #30 DEFERRED at
// Phase 3k. The ~98-LOC hand-written `defineFunction` spec wrapper is RETIRED;
// source of truth is `fenel/modules/twitter/twitter.fenel` — a
// `module twitter where` header + the `TweetMetrics` entity + 3 bodyless
// `@native` foreign decls (twitter_get_metrics / twitter_get_recent /
// twitter_post_reply, backed by the runtime IO handlers in providers.ts) + the
// PURE Fenel-bodied `twitter_check_viral`.
//
// Plain module: NO `ffi/` leaf, NO `nativeImpls` map (the 3 natives are
// IO-handler-backed, the `ai:callLLM` precedent), NO capability / creds /
// providers / instances. The export name `twitterModule` is preserved → 0
// boot-list / consumer edits (system-entities / type-catalog / system-registry
// / runtime evaluator / solid services all reference it by name; social.ts
// couples by codeName STRING only). The dead `twitter_check_viral` TS native +
// its IO-handler registration are removed from `runtime/src/providers.ts`
// (the Fenel body is now the sole path — no TS shadow).
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { loadFenelModule } from "../fenel-module";
import TWITTER_FENEL from "../../../../../fenel/modules/twitter/twitter.fenel?raw";

export const twitterModule: FenelModule = loadFenelModule(TWITTER_FENEL, "twitter", {
  label: "Twitter / X",
});
