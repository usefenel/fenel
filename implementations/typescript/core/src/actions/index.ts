export {
  registerAction,
  getAction,
  listActions,
  type ActionContext,
  type ActionResult,
  type ActionDefinition,
} from "./registry";

import { registerProfileActions } from "./profiles";
import { registerItemActions } from "./items";
import { registerPlanActions } from "./plans";
import { registerEntitlementActions } from "./entitlements";
import { registerInventoryActions } from "./inventory";
import { registerPurchaseActions } from "./purchases";
import { registerChannelActions } from "./channels";
import { registerNotificationActions } from "./notifications";
import { registerPaymentActions } from "./payments";
import { registerImportActions } from "./imports";
import { registerTypeActions } from "./types";
import { registerEmailActions } from "./email";

registerProfileActions();
registerItemActions();
registerPlanActions();
registerEntitlementActions();
registerInventoryActions();
registerPurchaseActions();
registerChannelActions();
registerNotificationActions();
registerPaymentActions();
registerImportActions();
registerTypeActions();
registerEmailActions();
