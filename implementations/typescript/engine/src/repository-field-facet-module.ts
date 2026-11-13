import { engineRequire } from "./engine-require";
import type { FenelModule } from "./types";

/** Build the directive-only repository module lazily, after registry module
 * initialization. Eagerly importing type-foundation here would re-enter the
 * parser/engine harness while registry's bootstrap capability is in TDZ. */
let cachedRepositoryFieldFacetModule: FenelModule | undefined;

export function repositoryFieldFacetModule(): FenelModule {
  if (cachedRepositoryFieldFacetModule !== undefined) {
    return cachedRepositoryFieldFacetModule;
  }
  const foundation = engineRequire("type-foundation") as typeof import("./type-foundation");
  foundation.foundationTemplates();
  cachedRepositoryFieldFacetModule = {
    name: "repository-field-facets",
    label: "Repository field facet source declarations",
    fieldFacetDirectives: foundation.foundationFieldFacetDirectives,
  };
  return cachedRepositoryFieldFacetModule;
}
