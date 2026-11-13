// One dependency roster shared by snapshot generation and dev invalidation.
export const publicBootstrapExactInputs = [
  "distros/narthex/solid/src/lib/home-search/core-value-suggestions-operation.ts",
  "distros/narthex/solid/src/lib/home-search/value-suggestions.ts",
  ".fenel.lock", "package.json", "bun.lock", "tsconfig.base.json",
  "patches/@solidjs%2Fsignals@2.0.0-rc.7.patch",
  "implementations/typescript/engine/package.json",
  "distros/narthex/solid/public-bootstrap-inputs.mjs",
  "distros/narthex/solid/scripts/generate-public-bootstrap.mjs",
  "distros/narthex/solid/src/lib/public-locus-data.ts",
  "distros/narthex/solid/src/lib/public-bootstrap.ts",
  // The public address record (a display-only early page): its admission, and the build's
  // projection through the existing resolver. The surfaces that only show it stay out.
  "distros/narthex/solid/src/lib/public-initial-addresses.ts",
  "distros/narthex/solid/src/lib/public-initial-address-projection.ts",
  "distros/narthex/solid/src/lib/locus-address.ts",
  "distros/narthex/solid/src/lib/locus-scope.ts",
  "distros/narthex/solid/src/lib/locus-catalog-reference.ts",
  "distros/narthex/solid/src/lib/data-transfer/data-preview-shape.ts",
  "distros/narthex/solid/src/lib/data-transfer/expressions.ts",
  "distros/narthex/solid/src/lib/workspace-wire.ts",
  "distros/narthex/solid/src/lib/workspace-source-wire.ts",
  "distros/narthex/solid/src/lib/all-data-root.ts",
  "distros/narthex/solid/src/lib/workspace-projection-model.ts",
  "distros/narthex/solid/src/lib/reader-presentation.ts",
  "distros/narthex/solid/src/lib/display-name.ts",
  "distros/narthex/solid/src/lib/type-icon-presentation.ts",
  "distros/narthex/solid/src/lib/type-icon-fallbacks.json",
  "distros/narthex/solid/src/lib/saved-expression-identity.ts",
  "distros/narthex/solid/src/lib/saved-expression-map.ts",
  "distros/narthex/solid/src/lib/reader-source-metadata.ts",
  "distros/narthex/solid/src/lib/numeric-text-codec.ts",
  // The Local catalogue worker's import closure (authoring catalogue artifact);
  // authoring-catalogue-artifact.test.ts keeps this list complete.
  "distros/narthex/solid/src/lib/account-field-registry.ts",
  "distros/narthex/solid/src/lib/api-read-recovery.ts",
  "distros/narthex/solid/src/lib/api-readiness.ts",
  "distros/narthex/solid/src/lib/api.ts",
  "distros/narthex/solid/src/lib/authoring-json.ts",
  "distros/narthex/solid/src/lib/browser-data-storage.ts",
  "distros/narthex/solid/src/lib/browser-session.ts",
  "distros/narthex/solid/src/lib/data-suggestions.ts",
  "distros/narthex/solid/src/lib/data-transfer/clipboard.ts",
  "distros/narthex/solid/src/lib/data-transfer/data.ts",
  "distros/narthex/solid/src/lib/data-transfer/index.ts",
  "distros/narthex/solid/src/lib/data-transfer/markup.ts",
  "distros/narthex/solid/src/lib/data-transfer/type-candidate.ts",
  "distros/narthex/solid/src/lib/data-transfer/types.ts",
  "distros/narthex/solid/src/lib/lens-shortcuts.ts",
  "distros/narthex/solid/src/lib/local-locus-data.ts",
  "distros/narthex/solid/src/lib/local-ordinary-operations.ts",
  "distros/narthex/solid/src/lib/locus-synchronization.tsx",
  "distros/narthex/solid/src/lib/reader-registry.ts",
  "distros/narthex/solid/src/lib/repository-namespaces.ts",
  "distros/narthex/solid/src/lib/user-function-roster.ts",
  "distros/narthex/solid/src/lib/user-registries.ts",
  "distros/narthex/solid/src/lib/workspace-catalog.ts",
  "distros/narthex/solid/src/lib/workspace-model-loader.ts",
  "distros/narthex/solid/src/lib/workspace-model-modules.ts",
  "distros/narthex/solid/src/lib/workspace-model.ts",
  "distros/narthex/solid/src/lib/workspace-module-preload.ts",
  "implementations/typescript/runtime/src/authority-mint.ts",
  // Runtime scripts leaves imported by the engine source input root.
  "implementations/typescript/engine/scripts/lib/artifact-wire-json.ts",
  "implementations/typescript/engine/scripts/lib/compiled-artifact-cold-policy-wire.ts",
  "implementations/typescript/engine/scripts/lib/compiled-artifact-identity-domain.ts",
  "implementations/typescript/engine/scripts/lib/repository-identity-physical.ts",
  // engine-require.ts's server-only replay epoch binding (a lazy require the
  // browser never reaches).
  "implementations/typescript/engine/scripts/lib/engine-body-replay-epoch.ts",
  "implementations/typescript/engine/scripts/lib/artifact-bytes.ts",
];
export const publicBootstrapInputRoots = [
  "fenel", "implementations/typescript/engine/src", "distros/narthex/solid/src/lib/expression-runner",
];

/** Repository-relative production inputs. Engine/Fenel owner bytes remain
 * conservative; distro harnesses and presentation assets do not shape data. */
export function isPublicBootstrapInput(path) {
  const normalized = path.replaceAll("\\", "/");
  if (publicBootstrapExactInputs.includes(normalized)) return true;
  if (normalized.startsWith("fenel/") || normalized.startsWith("implementations/typescript/engine/src/")) return true;
  const prefix = "distros/narthex/solid/src/lib/expression-runner/";
  if (!normalized.startsWith(prefix)) return false;
  const relative = normalized.slice(prefix.length);
  return /\.(?:ts|tsx)$/.test(relative)
    && !/(?:^|[./_-])(?:tests?|fixtures?|harness)(?:[./_-]|$)/.test(relative);
}
