// ---------------------------------------------------------------------------
// ProxyLinks — module-substrate Phase 3p seam (single-file).
//
// One of the three semantic modules that fall out of dissolving the retired
// `mixed-ingress.ts` junk-drawer BUNDLE (Phase 3p — the close of the aggregation
// frontier). The `proxyLinks:` prefix's home: `proxy-links/redirect.fenel` carries
// the lone `redirectClick` body. The `.fenel` header is camelCase
// `module proxyLinks where` to bake the existing `proxyLinks:` id-prefix — the
// `proxy-links/` directory name is incidental.
//
// `redirectClick` infers `HasStateIO` from its appendEvent call (the 3a precedent).
// WRINKLE (the lone surviving @category in the dissolve): the read-time category
// fallback would derive "proxyLinks" from the id prefix, but the stored category
// was the hyphenated "proxy-links" — so `redirectClick` KEEPS its
// `@category "proxy-links"` directive in the `.fenel` file to hold display-identical
// parity with the retired bundle spec.
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { loadFenelModule } from "../fenel-module";
import REDIRECT_FENEL from "../../../../../fenel/modules/proxy-links/redirect.fenel?raw";

export const proxyLinksModule: FenelModule = loadFenelModule(
  REDIRECT_FENEL,
  "proxyLinks",
  { label: "Proxy links" },
);
