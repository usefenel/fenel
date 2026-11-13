// Ordered validation/system registry profile. Kept separate so C2 identity
// generation can union the real profile without constructing the cached strict
// system registry against a possibly stale embedded manifest.
import type { FenelModule } from "./types";
import { stdModule } from "./modules/std";
import { controlModule } from "./modules/control";
import { ioModule } from "./modules/io";
import { timeModule } from "./modules/time";
import { actionResultModule } from "./modules/action-result";
import { emailModule } from "./modules/email";
import { ecomModule } from "./modules/ecom";
import { twitterModule } from "./modules/twitter";
import { socialModule } from "./modules/social";
import { licenseModule } from "./modules/license";
import { templateModule } from "./modules/templates";
import { aiModule } from "./modules/ai";
import { telegramModule } from "./modules/telegram";
import { notionModule } from "./modules/notion";
import { pictureModule } from "./modules/picture";
import { soundModule } from "./modules/sound";
import { animationModule } from "./modules/animation";
import { movieModule } from "./modules/movie";
import { viewModule } from "./modules/view";
import { eventsModule } from "./modules/events";
import { gamesModule } from "./modules/games";
import { trackModule } from "./modules/track";
import { codecModule } from "./modules/codec";
import { storageDeclarationsModule } from "./modules/storage";
import { decidableMembershipModule } from "./modules/decidable-membership";
import { proverModule } from "./modules/prover";
import { compileJsModule } from "./modules/compile-js";
import { compileWasmModule } from "./modules/compile-wasm";
import { compileLlvmModule } from "./modules/compile-llvm";
import { evaluatorStrategiesModule } from "./modules/evaluator-strategies";
import { aggregableModule } from "./modules/aggregable";
import { migrationModule } from "./modules/migration";
import { algebraModule } from "./modules/algebra";
import { authModule } from "./modules/auth";
import { setExprEntityModule } from "./modules/set-expr-entities";

export const SYSTEM_REGISTRY_MODULES: FenelModule[] = [
  stdModule,
  controlModule,
  ioModule,
  timeModule,
  // `email` has inferred Fenel bodies which construct ActionOk. Keep the
  // constructor's defining entity in this partial profile just as the complete
  // seed/execute manifest does; exact constructor routing still selects the
  // sole core-action-result/ActionResult owner from registry metadata.
  actionResultModule,
  emailModule,
  ecomModule,
  twitterModule,
  socialModule,
  licenseModule,
  templateModule,
  aiModule,
  telegramModule,
  notionModule,
  pictureModule,
  soundModule,
  animationModule,
  movieModule,
  viewModule,
  eventsModule,
  gamesModule,
  trackModule,
  codecModule,
  storageDeclarationsModule,
  decidableMembershipModule,
  proverModule,
  compileJsModule,
  compileWasmModule,
  compileLlvmModule,
  evaluatorStrategiesModule,
  aggregableModule,
  migrationModule,
  algebraModule,
  authModule,
  // The `authority` module (prepended to every registry by `createRegistry`)
  // types its envelope rows over `SetExpr` and CONSTRUCTS `SeEnum`. Publish
  // the canonical source data graph and ReflectionValue's sole Type helper
  // under their exact `engine` owner; the
  // full engine function module remains outside this profile. (It arrived here
  // for the retired permissions helpers; rights R2a deleted those.)
  setExprEntityModule,
];
