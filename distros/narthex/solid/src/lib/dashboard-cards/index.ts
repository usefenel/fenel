// ---------------------------------------------------------------------------
// Dashboard card components — registered into webRegistry by name so that
// TypeViews with `readComponent: "<name>"` can resolve them at render time.
//
// Side-effect import: importing this module registers all dashboard cards.
// `distros/narthex/solid/src/lib/admin-form/AdminForm.tsx` imports it so the registry
// is populated before any /dashboard route mounts.
// ---------------------------------------------------------------------------

import { registerComponent } from "~/lib/admin-form";
import { ProfileCard } from "./ProfileCard";
import { InventoryCard } from "./InventoryCard";
import { PageUrlCell } from "./PageUrlCell";
import { EmailSubjectCell } from "./EmailSubjectCell";

registerComponent("profile-card", ProfileCard);
registerComponent("inventory-card", InventoryCard);
registerComponent("page-url", PageUrlCell);
registerComponent("email-subject-preview", EmailSubjectCell);

export { ProfileCard, InventoryCard, PageUrlCell, EmailSubjectCell };
