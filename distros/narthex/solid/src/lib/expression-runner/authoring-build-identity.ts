import repositoryCatalogueIndex from "../generated/authoring-catalogue.json";

/** L5a-finish — the opaque build identity of this bundle: the `sourceDigest`
 * of the generated authoring catalogue. Its input roster
 * (`public-bootstrap-inputs.mjs`) covers every byte under `fenel/` and
 * `implementations/typescript/engine/src/` (generated parse cache and compiled
 * artifacts included), the Local catalogue worker's import closure, the lock
 * files and `package.json`. The page and its authoring worker each read it
 * from their own module graph; registry preparation crosses between them only
 * when both strings are equal (`checkRegistryPreparationBuild`). It is
 * scheduling data, never Fenel data or authority. */
export const AUTHORING_BUILD_IDENTITY: string = repositoryCatalogueIndex.sourceDigest;
