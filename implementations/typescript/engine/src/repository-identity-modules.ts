// C2/tooling-only identity profiles. Requirements are collected from each real
// registry profile independently and then unioned: merging their module arrays
// can change nominal ownership/dedup order and would rewrite Phase-1 identities.
import { modulesFor } from "./module-manifest";
import { loadFenelModule } from "./fenel-module";
import { SYSTEM_REGISTRY_MODULES } from "./system-registry-modules";
import type { FenelModule } from "./types";
import { engineModule } from "./modules/engine";
import { localeModule } from "./modules/locale";
import { pathModule } from "./modules/path";
import { dispatchModule } from "./modules/dispatch";
import { runtimeModule } from "./modules/runtime";
import { stdModule } from "./modules/std";
import { formatsModule } from "./modules/formats";
import FIELD_KEY_FENEL from "../../../../fenel/modules/engine/field-key.fenel?raw";
import FIELD_IDENTITY_FENEL from "../../../../fenel/modules/engine/field-identity.fenel?raw";
import FIELD_REPRESENTATIONS_FENEL from "../../../../fenel/modules/engine/field-representations.fenel?raw";
import FIELD_AUTHORING_FENEL from "../../../../fenel/modules/engine/field-authoring.fenel?raw";
import { repositoryFieldFacetModule } from "./repository-field-facet-module";

export type RepositoryIdentityProfile = {
  readonly id:
    | "system"
    | "seed-product"
    | "engine-identity-types"
    | "self-host-functions"
    | "self-host-engine-types";
  readonly modules: readonly FenelModule[];
  readonly signatureJudgment: "authoritative" | "identity-only";
  /** Complete semantic graph used only when compiler tooling needs effective
   * function schemes from a synthetic identity-only projection. */
  readonly compilerSemanticModules?: readonly FenelModule[];
};

const fieldIdentityEntities = [
  ...(loadFenelModule(FIELD_KEY_FENEL, "engine").entities ?? []),
  ...(loadFenelModule(FIELD_IDENTITY_FENEL, "engine").entities ?? []),
  ...(loadFenelModule(FIELD_REPRESENTATIONS_FENEL, "engine").entities ?? []),
  ...(loadFenelModule(FIELD_AUTHORING_FENEL, "engine").entities ?? []),
];

const ENGINE_IDENTITY_TYPES_MODULE: FenelModule = {
  name: "engine",
  label: "Engine identity type declarations",
  entities: [...fieldIdentityEntities],
  functions: [],
};

function functionIdentityProjection(sourceModule: FenelModule): FenelModule {
  return {
    name: sourceModule.name,
    label: `${sourceModule.label} function-identity projection`,
    ...(sourceModule.functionNamespace === undefined
      ? {}
      : { functionNamespace: sourceModule.functionNamespace }),
    ...(sourceModule.functionNamespaceOverrides === undefined
      ? {}
      : { functionNamespaceOverrides: sourceModule.functionNamespaceOverrides }),
    functions: sourceModule.functions ?? [],
  };
}

function entityIdentityProjection(sourceModule: FenelModule): FenelModule {
  return {
    name: sourceModule.name,
    label: `${sourceModule.label} entity-identity projection`,
    entities: sourceModule.entities ?? [],
  };
}

/** Repository-authored functions exercised by compiler/self-host tooling but
 * absent from the product system registry. Functions and entities are kept in
 * independent profiles so each source graph is normalized without changing
 * module ownership or product-registry dedup order. */
const SELF_HOST_FUNCTION_SOURCE_MODULES: readonly FenelModule[] = [
  engineModule,
  localeModule,
  pathModule,
  dispatchModule,
  runtimeModule,
  formatsModule,
];

const SELF_HOST_FUNCTION_SEMANTIC_MODULES: readonly FenelModule[] = [
  stdModule,
  engineModule,
  localeModule,
  pathModule,
  dispatchModule,
  runtimeModule,
  formatsModule,
  repositoryFieldFacetModule(),
];

/** Compiler reflection needs every defining ADT used by the self-host registry
 * as well as identified function params. These entities are not all present in
 * system/seed profiles (for example JsonLogic, SurfaceType, FieldEditType,
 * CeExpr, and runtime TmFilter), so omitting this projection either turns named
 * constructors into positional compiler fallbacks or makes strict matrix boot
 * fail. Repeated entities already present elsewhere retain the same qualified
 * lock requirements and deduplicate in the compiler view. */
const SELF_HOST_ENGINE_TYPE_SOURCE_MODULES: readonly FenelModule[] = [
  engineModule,
  localeModule,
  pathModule,
  dispatchModule,
  runtimeModule,
];

function selfHostFunctionIdentityModules(): readonly FenelModule[] {
  return SELF_HOST_FUNCTION_SOURCE_MODULES.map(functionIdentityProjection);
}

function selfHostEngineTypeIdentityModules(): readonly FenelModule[] {
  return SELF_HOST_ENGINE_TYPE_SOURCE_MODULES.map(entityIdentityProjection);
}

export function repositoryIdentityProfiles(): RepositoryIdentityProfile[] {
  return [
    { id: "system", modules: [...SYSTEM_REGISTRY_MODULES, repositoryFieldFacetModule()], signatureJudgment: "authoritative" },
    { id: "seed-product", modules: [...modulesFor("seed"), repositoryFieldFacetModule()], signatureJudgment: "authoritative" },
    { id: "engine-identity-types", modules: [ENGINE_IDENTITY_TYPES_MODULE], signatureJudgment: "identity-only" },
    {
      id: "self-host-functions",
      modules: selfHostFunctionIdentityModules(),
      signatureJudgment: "identity-only",
      compilerSemanticModules: [...SELF_HOST_FUNCTION_SEMANTIC_MODULES],
    },
    { id: "self-host-engine-types", modules: selfHostEngineTypeIdentityModules(), signatureJudgment: "identity-only" },
  ];
}

/** Entity-only profile topology for constructor/compiler reflection. Importing
 * this module and calling this function never projects `.functions`,
 * `.functionNamespace`, or semantic-module slots. The function-only profile is
 * retained as an empty ordered profile because it contributes no entity
 * authority; the final profile exposes raw source modules so the caller's
 * descriptor-safe exact entity projection remains the sole property boundary. */
export function repositoryIdentityEntityProfiles(): RepositoryIdentityProfile[] {
  return [
    { id: "system", modules: [...SYSTEM_REGISTRY_MODULES, repositoryFieldFacetModule()], signatureJudgment: "authoritative" },
    { id: "seed-product", modules: [...modulesFor("seed"), repositoryFieldFacetModule()], signatureJudgment: "authoritative" },
    { id: "engine-identity-types", modules: [ENGINE_IDENTITY_TYPES_MODULE], signatureJudgment: "identity-only" },
    { id: "self-host-functions", modules: [], signatureJudgment: "identity-only" },
    { id: "self-host-engine-types", modules: [...SELF_HOST_ENGINE_TYPE_SOURCE_MODULES], signatureJudgment: "identity-only" },
  ];
}
