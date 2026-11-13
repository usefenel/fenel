/**
 * Server-only repository field-catalog freshness signal.
 *
 * Keep this leaf off the engine barrel and the browser-safe catalog module:
 * importing it deliberately pulls both generated artifacts into the process.
 */
import { REPOSITORY_FIELD_CATALOG } from "./repository-field-catalog";
import { REPOSITORY_IDENTITY_MANIFEST } from "./repository-identity-manifest";

export const REPOSITORY_FIELD_CATALOG_REGEN_COMMAND =
  "bun implementations/typescript/engine/scripts/generate-identity-artifacts.ts";

export type RepositoryFieldCatalogIdentityStampMismatch = {
  readonly catalogIdentityManifestDigest: string;
  readonly identityManifestDigest: string;
};

/**
 * Identity-only tripwire. Matching stamps do not prove complete catalog
 * freshness: this comparison is blind to (a) kind-only tombstone flips and
 * (b) every non-identity catalog input — `@fieldReusable` facet changes,
 * owner/occurrence-type changes, label/facet method edits, and
 * representation-family membership. The complete detector is
 * `generate-repository-field-catalog.ts --check`.
 */
export function repositoryFieldCatalogIdentityStampMismatch(
  catalogIdentityManifestDigest = REPOSITORY_FIELD_CATALOG.identityManifestDigest,
  identityManifestDigest = REPOSITORY_IDENTITY_MANIFEST.digest,
): RepositoryFieldCatalogIdentityStampMismatch | undefined {
  if (catalogIdentityManifestDigest === identityManifestDigest) return undefined;
  return { catalogIdentityManifestDigest, identityManifestDigest };
}

export function formatRepositoryFieldCatalogIdentityDeficit(
  mismatch: RepositoryFieldCatalogIdentityStampMismatch,
): string {
  return "[field-catalog-stale] repository field catalog identityManifestDigest "
    + `${mismatch.catalogIdentityManifestDigest} does not match repository identity manifest digest `
    + `${mismatch.identityManifestDigest}; regenerate: ${REPOSITORY_FIELD_CATALOG_REGEN_COMMAND}`;
}

/** Testable construction seam for the process-wide, compare-once reporter. */
export function createRepositoryFieldCatalogIdentityDeficitReporter(input: {
  readonly catalogIdentityManifestDigest: string;
  readonly identityManifestDigest: string;
  readonly error: (message: string) => void;
}): () => void {
  let checked = false;
  return () => {
    if (checked) return;
    checked = true;
    const mismatch = repositoryFieldCatalogIdentityStampMismatch(
      input.catalogIdentityManifestDigest,
      input.identityManifestDigest,
    );
    if (mismatch !== undefined) input.error(formatRepositoryFieldCatalogIdentityDeficit(mismatch));
  };
}

const reportIdentityDeficitOnce = createRepositoryFieldCatalogIdentityDeficitReporter({
  catalogIdentityManifestDigest: REPOSITORY_FIELD_CATALOG.identityManifestDigest,
  identityManifestDigest: REPOSITORY_IDENTITY_MANIFEST.digest,
  error: (message) => console.error(message),
});

/** Report an identity-stale catalog once per process. Never throws on mismatch. */
export function reportRepositoryFieldCatalogIdentityDeficit(): void {
  reportIdentityDeficitOnce();
}
