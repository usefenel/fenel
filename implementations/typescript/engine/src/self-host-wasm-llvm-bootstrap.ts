// SUBSTRATE
// ---------------------------------------------------------------------------
// Shared Wasm/LLVM self-host bootstrap.
//
// These two compiler harnesses deliberately evaluate against the same exact
// module topology. Keep the incomplete bootstrap registry private: consumers
// receive only its frozen evaluation context, its frozen source-module roster,
// and the one entity lookup LLVM needs for result marshalling. The JS harness
// is intentionally separate because its algebra/dispatch modules change bare
// name routing and resolver authority.
// ---------------------------------------------------------------------------

import { animationModule } from "./modules/animation";
import { emailModule } from "./modules/email";
import { engineModule } from "./modules/engine";
import { eventsModule } from "./modules/events";
import { localeModule } from "./modules/locale";
import { pathModule } from "./modules/path";
import { pictureModule } from "./modules/picture";
import { soundModule } from "./modules/sound";
import { stdModule } from "./modules/std";
import { telegramModule } from "./modules/telegram";
import { timeModule } from "./modules/time";
import { trackModule } from "./modules/track";
import type { EvaluateContext } from "./json-logic";
import { createEngineBootstrapRegistry } from "./registry";

export const wasmLlvmSelfHostModules = Object.freeze([
  stdModule,
  telegramModule,
  engineModule,
  localeModule,
  eventsModule,
  timeModule,
  animationModule,
  pathModule,
  trackModule,
  emailModule,
  pictureModule,
  soundModule,
] as const);

const wasmLlvmSelfHostRegistry = createEngineBootstrapRegistry([
  ...wasmLlvmSelfHostModules,
]);

export const wasmLlvmBaseEngineContext: Readonly<EvaluateContext> =
  wasmLlvmSelfHostRegistry.evaluateContext();

export function getWasmLlvmSelfHostEntity(name: string) {
  return wasmLlvmSelfHostRegistry.getEntity(name);
}
