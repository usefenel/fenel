// ---------------------------------------------------------------------------
// Auto-suppression on hard bounces and spam complaints
//
// When a recipient hard-bounces or marks a message as spam, sending to
// them again is a deliverability mistake (and on many providers a TOS
// violation). The standard practice is to add them to the provider's
// suppression list immediately so subsequent sends from that account
// skip them automatically.
//
// Wired into every provider's webhook handler. Idempotent at the
// provider level — most suppression APIs accept duplicates silently.
// ---------------------------------------------------------------------------

import { eq, and } from "drizzle-orm";
import { getDb } from "@fenel/db";
import { integrations } from "@fenel/db/schema";
import type { IntegrationType } from "@fenel/engine/integrations";
import { mailgunSuppress } from "../providers/mailgun";
import { postmarkSuppress } from "../providers/postmark";
import { sesSuppress } from "../providers/ses";
import { resendSuppress } from "../providers/resend";
import type { AddressValue, EmailEventValue } from "./mailgun-webhook";

type Credentials = Record<string, string>;

/** Event types that warrant automatic suppression. HardBounce → the
 *  address doesn't exist (sending more is futile); Complained → the
 *  recipient marked us as spam (sending more damages our IP reputation).
 *  SoftBounce / BlockBounce are transient and not auto-suppressed. */
function shouldSuppress(event: EmailEventValue): boolean {
  if (event.$tag === "Bounced" && event.kind.$tag === "HardBounce") return true;
  if (event.$tag === "Complained") return true;
  return false;
}

const SUPPRESSORS: Record<string, (params: Record<string, unknown>, creds: Credentials) => Promise<unknown>> = {
  mailgun: mailgunSuppress,
  postmark: postmarkSuppress,
  ses: sesSuppress,
  resend: resendSuppress,
};

async function getCredentials(accountId: string, type: IntegrationType): Promise<Credentials | null> {
  const db = getDb();
  const [row] = await db
    .select({ credentials: integrations.credentials })
    .from(integrations)
    .where(
      and(
        eq(integrations.accountId, accountId),
        eq(integrations.type, type),
        eq(integrations.enabled, true),
      ),
    )
    .limit(1);
  return (row?.credentials as Credentials | undefined) ?? null;
}

/** Inspect a typed EmailEvent. If it's a hard bounce or complaint, add
 *  the recipient to the provider's suppression list. No-op otherwise.
 *
 *  Best-effort: failures are logged, never thrown. The webhook caller
 *  has already 200-ack'd by the time we get here. */
export async function autoSuppressIfBadEvent(
  provider: string,
  accountId: string,
  recipient: AddressValue | null,
  event: EmailEventValue,
): Promise<void> {
  if (!shouldSuppress(event)) return;
  if (!recipient || !recipient.local || !recipient.domain) return;
  const suppressor = SUPPRESSORS[provider];
  if (!suppressor) return;
  try {
    const creds = await getCredentials(accountId, provider as IntegrationType);
    if (!creds) return;
    const reason = event.$tag === "Complained" ? "complaint" : "hard_bounce";
    await suppressor({ address: recipient, reason }, creds);
  } catch (err) {
    console.warn(`[auto-suppress] ${provider} suppression failed for ${recipient.local}@${recipient.domain}:`, err);
  }
}
