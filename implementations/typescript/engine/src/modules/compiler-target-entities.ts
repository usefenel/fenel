// Entity-only compiler-target projections for strict self-host artifact
// registries. The engine module owns the Fenel lowering bodies, while the
// constructors those bodies emit are canonically declared by the three
// compile-target modules. Keeping only target-owned entities here makes those
// constructors available to exact signature inference without importing the
// compile modules' executable functions or changing artifact call routing.

import type { FenelModule } from "../types";
import { compileJsModule } from "./compile-js";
import { compileWasmModule } from "./compile-wasm";
import { compileLlvmModule } from "./compile-llvm";
import { rememberStockModuleSource } from "../stock-source-module";

function targetEntityProjection(sourceModule: FenelModule): FenelModule {
  const projection: FenelModule = {
    name: sourceModule.name,
    label: `${sourceModule.label} target-entity projection`,
    entities: (sourceModule.entities ?? []).filter((entity) => entity.module === sourceModule.name),
    functions: [],
    instances: [],
  };
  rememberStockModuleSource(projection);
  return projection;
}

export const COMPILER_TARGET_ENTITY_MODULES: readonly FenelModule[] = [
  compileJsModule,
  compileWasmModule,
  compileLlvmModule,
].map(targetEntityProjection);
