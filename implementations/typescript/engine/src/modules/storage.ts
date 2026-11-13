// ---------------------------------------------------------------------------
// Storage module — declarations and pure storage queries.
//
// Landing 1 A2 gives every Db / Memory / Bundle StorageHandler method a Fenel-
// authored descriptor. `types.fenel` owns the 24 bodyless @native declarations;
// `instances.fenel` owns the three global descriptor dictionaries. The engine
// deliberately imports no storage ffi here: the implementations depend on the
// DB and runtime host and are attached by runtime's storageRuntimeModule.
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { loadFenelModule, loadFenelModuleUnion } from "../fenel-module";
import STORAGE_FENEL from "../../../../../fenel/modules/storage/types.fenel?raw";
import STORAGE_INSTANCES_FENEL from "../../../../../fenel/modules/storage/instances.fenel?raw";
import STORAGE_QUERIES_FENEL from "../../../../../fenel/modules/storage/queries.fenel?raw";

// Union the loader metadata as well as the functions. Strict registries need
// every query's signature declaration and identity origin in the same module.
const declarations = loadFenelModuleUnion([
  { src: STORAGE_FENEL, name: "storage-types" },
  { src: STORAGE_QUERIES_FENEL, name: "storage-queries" },
], { labels: { storage: "Storage" } })[0]!;

// The system profile needs the complete loader metadata and pure queries,
// without registering the backend dispatch instances from instances.fenel.
export const storageDeclarationsModule: FenelModule = declarations;

const dispatchInstances = loadFenelModule(
  STORAGE_INSTANCES_FENEL,
  "storage",
  { dispatchInstanceFile: true },
).instances ?? [];

export const storageModule: FenelModule = {
  ...declarations,
  instances: [...(declarations.instances ?? []), ...dispatchInstances],
};

// browser-engine-compat Phase 1b: make the module's declaration namespace
// available to engineRequire during evaluate-time module loading.
import * as __self_modules_storage from "./storage";
import { registerEngineModule as __reg_modules_storage } from "../engine-require";
__reg_modules_storage("modules/storage", __self_modules_storage);
