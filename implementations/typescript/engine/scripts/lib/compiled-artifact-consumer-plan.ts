/** C2/B3 structural witness matching. The semantic eligibility predicate and
 * finite boundary declaration are Fenel-owned; this never returns EntityOnly.
 */
import { matchReviewedEntityProjectionAnchor, type ReviewedEntityProjectionAnchor,
  type CurrentProjectionSurface } from "./compiled-artifact-projection-anchor";
import type { CompiledArtifactId } from "./artifact-bytes";
import type { OriginEdgeAssociation } from "./compiled-artifact-origin-association";
import type { OwnerModuleRoleRoster } from "../../src/owner-input-provenance";

export type FiniteConsumerPlan = Readonly<{
  version: "canonical-standalone-entity-envelope.v1";
  catalogueContract: "deny-full-before-cache-sticky";
  canonicalLoader: string; entityFacade: "exactRepositoryCompilerModuleEntityProjection";
  copyContract: "exact-own-data-only"; opaqueContract: "reviewed-byte-bound-producers";
  harnessSourceSite: string; constructorSourcePrefix: string; globalSourceSite: string;
  profile0: string; profile1: string; profile2: string; profile3: string; profile4: string;
}>;
export type EntityConsumerFacts = Readonly<{
  closedStandaloneLoader: boolean; completeSourceProvenance: boolean; completeConsumerRoster: boolean;
  reviewedConsumerAnchor: boolean; canonicalLoaderAdmitted: boolean; hasEntityConsumer: boolean;
  hasPrimaryConsumer: boolean; hasBootstrapConsumer: boolean; hasHarnessConsumer: boolean;
  hasGlobalInstallerConsumer: boolean; hasDirectRawConsumer: boolean; hasUnknownConsumer: boolean;
}>;

/** Inputs must first pass their closed wire decoders. `surface` is recomputed
 * from complete current acquisition, never minted from an ordinary MATCH.
 * Opaque producers are covered ONLY by the separately reviewed finite plan;
 * an anchor/code/plan change leaves the source byte-bound until re-reviewed.
 */
export function observeEntityConsumerFacts(input: Readonly<{
  owner: CompiledArtifactId; ordinal: number; association: OriginEdgeAssociation;
  plan: FiniteConsumerPlan; reviewedAnchor: ReviewedEntityProjectionAnchor | undefined;
  currentSurface: CurrentProjectionSurface; rosters: readonly OwnerModuleRoleRoster[];
  producerContract: "all" | "entity-envelope"; catalogueAttempts: number;
  sourceRecordingStartedBeforeImports: boolean; unconsumedRegistryInputCount: number;
  globalSourceRefusalCount: number; originSourceRefusalCount: number;
}>): EntityConsumerFacts {
  const { plan, rosters } = input;
  const bound = input.association.associations.filter(row => row.ordinal === input.ordinal);
  const requiredSites = [
    ["primary", `${input.owner}/primary`, "effective"], ["bootstrap", `${input.owner}/bootstrap`, "effective"],
    ["harness", plan.harnessSourceSite, "source"], ["global-installer", plan.globalSourceSite, "source"],
    ...[plan.profile0, plan.profile1, plan.profile2, plan.profile3, plan.profile4].flatMap((id, index) => [
      ["constructor", `${plan.constructorSourcePrefix}[${index}]/${id}`, "source"],
      ["constructor", `${plan.constructorSourcePrefix}[${index}]/${id}`, "effective"],
    ]),
  ];
  const completeConsumerRoster = input.sourceRecordingStartedBeforeImports
    && input.unconsumedRegistryInputCount === 0 && input.globalSourceRefusalCount === 0
    && input.producerContract === "entity-envelope" && input.catalogueAttempts === 0
    && requiredSites.every(([role, site, stage]) => rosters.some(row => row.role === role && row.site === site && row.stage === stage));
  let completeSourceProvenance = bound.length === 1 && input.originSourceRefusalCount === 0;
  let hasEntityConsumer = false;
  let hasPrimaryConsumer = false;
  let hasBootstrapConsumer = false;
  let hasHarnessConsumer = false;
  let hasGlobalInstallerConsumer = false;
  let hasUnknownConsumer = false;
  for (const roster of rosters) for (const member of roster.members) {
    if (member.originOrdinal !== input.ordinal) continue;
    if (!member.unchangedCanonicalData) completeSourceProvenance = false;
    if (roster.role === "global-installer") hasGlobalInstallerConsumer = true;
    if (member.projection === "entity") { hasEntityConsumer = true; continue; }
    if (roster.role === "constructor" && roster.stage === "source") {
      const projected = rosters.filter(row => row.role === "constructor" && row.site === roster.site && row.stage === "effective")
        .flatMap(row => row.members).filter(row => row.originOrdinal === input.ordinal && row.projection === "entity" && row.unchangedCanonicalData);
      const sources = roster.members.filter(row => row.originOrdinal === input.ordinal);
      if (projected.length !== sources.length) completeSourceProvenance = false;
      hasEntityConsumer = true;
      continue;
    }
    if (roster.role === "primary") hasPrimaryConsumer = true;
    else if (roster.role === "bootstrap") hasBootstrapConsumer = true;
    else if (roster.role === "harness") hasHarnessConsumer = true;
    else if (roster.role !== "global-installer") hasUnknownConsumer = true;
  }
  return Object.freeze({ closedStandaloneLoader: bound.length === 1, completeSourceProvenance, completeConsumerRoster,
    reviewedConsumerAnchor: matchReviewedEntityProjectionAnchor(input.reviewedAnchor, input.currentSurface) === "REVIEWED",
    canonicalLoaderAdmitted: bound.length === 1, hasEntityConsumer, hasPrimaryConsumer, hasBootstrapConsumer,
    hasHarnessConsumer, hasGlobalInstallerConsumer, hasDirectRawConsumer: bound.length !== 1, hasUnknownConsumer });
}
