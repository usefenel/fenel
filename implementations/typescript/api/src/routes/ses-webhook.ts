// ---------------------------------------------------------------------------
// /webhooks/ses/:integrationId/events — SES → SNS HTTP-subscription intake.
//
// Phase 12c-routes sub-step 1 — Fenel-bodied ingress. The TS wrapper
// verifies the signed SNS envelope + (for Notification) parses the inner SES event
// + maps to typed EmailEvent + extracts recipient. The Fenel body returns
// SesIngressDecision (Decision H2 — async-from-Fenel-body recipe); the
// wrapper pattern-matches $tag and dispatches:
//   - ConfirmSubscription → fetch(url) HTTP-GET → response
//   - EmitEvent → emailWebhooks:emitEmailEvent → response
//   - IgnoreEvent / RejectEnvelope → response with status code
//
// Two flows in the original SES contract:
//   1. SubscriptionConfirmation: AWS asks us to GET the SubscribeURL
//      to confirm the subscription.
//   2. Notification: the actual SES event JSON is stringified inside
//      the `Message` field of the SNS envelope.
//
// SES inbound is NOT handled here. That goes through S3 and requires
// MIME parsing — out of scope for v1.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { invokeIOActionEphemeral, mintAcquisitionAuthorityFor, mintLaneAuthorityFor } from "@fenel/runtime";
import { bodyLimit } from "hono/body-limit";
import type {
  SesEventInner,
  EmailEventValue,
  MailgunAddressValue as AddressValue,
} from "@fenel/runtime";
import {
  confirmSnsSubscription,
  createSnsVerifier,
  InvalidSnsMessageError,
  SnsCertificateUnavailableError,
  snsSubscriptionUrl,
  verifySnsEnvelope,
  type SnsFetch,
  type VerifiedSnsEnvelope,
} from "../sns-signature";

type SesWebhookDependencies = {
  invoke?: typeof import("@fenel/runtime").invokeIOActionAs;
  /** rights R4a — the ACQUISITION seam, separate from `invoke` on purpose.
   *  Everything this route performs BEFORE it mints a product grant goes through
   *  here, so a boundary test can observe the two classes apart rather than
   *  counting one undifferentiated list of actions. */
  acquire?: typeof import("@fenel/runtime").invokeIOActionEphemeral;
  verify?: typeof verifySnsEnvelope;
  confirm?: typeof confirmSnsSubscription;
};

type IntegrationRow = {
  id: string;
  accountId: string;
  credentials: Record<string, unknown>;
  enabled: boolean;
};

/** Host dependencies are injectable for DB/network-free boundary tests. */
export function createSesWebhookRoutes(dependencies: SesWebhookDependencies = {}) {
  const sesWebhookRoutes = new Hono();
  const invoke = dependencies.invoke ?? (async (...args: Parameters<NonNullable<SesWebhookDependencies["invoke"]>>) =>
    (await import("@fenel/runtime")).invokeIOActionAs(...args));

  // rights R4a C1a — THE TWO SNS OUTBOUND SITES, BOTH THROUGH `perform`.
  //
  // There are two, and the first is easy to miss because it is inside the
  // VERIFIER: a cold certificate cache makes `verifySnsEnvelope` itself reach
  // the network, before anything has been verified at all. Both ran as bare
  // `fetch` calls, so no envelope judged them and no gate saw them.
  //
  // What moves is only the TRANSPORT. The URL constraint to the configured
  // topic's exact regional SNS endpoint, the X509 parse, the signature check and
  // the `VerifiedSnsEnvelope` brand all stay in `api/src/sns-signature.ts` —
  // that brand is a host-private symbol no value can forge, which is the same
  // argument `design/authority.md` makes for the authority table itself and
  // exactly the thing a Fenel value cannot be.
  const acquire = dependencies.acquire ?? invokeIOActionEphemeral;
  const performingFetch: SnsFetch = async (url) => {
    const text = (await acquire(
      mintAcquisitionAuthorityFor(""), "", null, "emailWebhooks:snsFetchSigningCertificate", { url: String(url) },
    )) as { $tag: "Just"; _0: string } | { $tag: "Nothing" };
    // ⚠ TYPED, because the STATUS depends on it. `SnsCertificateUnavailableError`
    // is what the route maps to 503, and SNS retries a 5xx; an ordinary Error
    // would be indistinguishable from a verification failure at the catch site
    // and would permanently discard an authentic event. An authority refusal
    // lands here too and is reported the same way — fail-safe, and the reason is
    // in the refusal the gate threw.
    if (text.$tag !== "Just") {
      throw new SnsCertificateUnavailableError("SNS signing certificate is unavailable");
    }
    // The verifier reads only `ok`, `redirected` and the body, so the leaf's
    // already-bounded text is handed back in exactly that shape.
    return new Response(text._0, { status: 200 });
  };
  const verifyEnvelope = dependencies.verify ?? createSnsVerifier({ fetch: performingFetch });
  const confirmSubscription = dependencies.confirm ?? (async (env: VerifiedSnsEnvelope) => {
    const ok = (await acquire(
      mintAcquisitionAuthorityFor(""), "", null, "emailWebhooks:snsConfirmSubscription", { url: snsSubscriptionUrl(env) },
    )) as boolean;
    if (ok !== true) throw new Error("SNS subscription confirmation failed");
  });
  sesWebhookRoutes.use("/:integrationId/events", bodyLimit({ maxSize: 2 * 1024 * 1024 }));

  async function loadIntegration(integrationId: string): Promise<IntegrationRow | null> {
    const result = (await acquire(mintAcquisitionAuthorityFor(""), "", null, "state.find_integration_by_id_and_type", {
      id: integrationId,
      type: "ses",
    })) as { $tag?: string; _0?: IntegrationRow };
    if (!result || result.$tag !== "Just" || !result._0) return null;
    return result._0;
  }

  sesWebhookRoutes.post("/:integrationId/events", async (c) => {
    const integrationId = c.req.param("integrationId");
    if (!integrationId) return c.json({ error: "integrationId required" }, 400);

    const integration = await loadIntegration(integrationId);
    if (!integration) return c.json({ error: "Unknown integration" }, 404);

    if (!integration.enabled) return c.json({ error: "Integration is disabled" }, 403);

    let rawEnvelope: unknown;
    try {
      rawEnvelope = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    const expectedArn = String(integration.credentials.SES_SNS_TOPIC_ARN ?? "");
    let env: VerifiedSnsEnvelope;
    try {
      env = await verifyEnvelope(rawEnvelope, expectedArn);
    } catch (error) {
      if (error instanceof SnsCertificateUnavailableError) {
        // SNS retries 5xx responses; a transient certificate fetch failure must
        // not permanently discard an authentic event.
        return c.json({ error: "SNS signing certificate temporarily unavailable" }, 503);
      }
      if (error instanceof InvalidSnsMessageError) return c.json({ error: "Invalid SNS envelope or signature" }, 403);
      throw error;
    }
    const envType = env.Type;
    const actualArn = env.TopicArn;
    const subscribeUrl = env.SubscribeURL ? { $tag: "Just", _0: env.SubscribeURL } : { $tag: "Nothing" };

    // For Notification: parse inner SES event + map + extract recipient
    // before invoking the Fenel body. Wrapper does the provider-specific
    // mapping; body receives the typed values.
    let maybeEvent: EmailEventValue | null = null;
    let recipient: AddressValue | null = null;
    const messageId = env.MessageId;

    if (envType === "Notification") {
      let inner: SesEventInner;
      try {
        inner = JSON.parse(String(env.Message ?? "{}")) as SesEventInner;
      } catch {
        return c.json({ error: "Invalid SNS Message body" }, 400);
      }
      if (!inner || typeof inner !== "object" || Array.isArray(inner)) {
        return c.json({ error: "Invalid SES event object" }, 400);
      }
      const { sesEventToEmailEvent, sesEventRecipient } = await import("@fenel/runtime");
      maybeEvent = sesEventToEmailEvent(inner);
      recipient = sesEventRecipient(inner);
    }

    const decision = (await invoke(await mintLaneAuthorityFor(integration.accountId, "webhook:ses"), null, "emailWebhooks:sesEvents", {
      envType,
      expectedArn,
      actualArn,
      subscribeUrl,
      maybeEvent: maybeEvent ? { $tag: "Just", _0: maybeEvent } : { $tag: "Nothing" },
      recipient: recipient ? { $tag: "Just", _0: recipient } : { $tag: "Nothing" },
      messageId,
    })) as { $tag: string; url?: string; event?: EmailEventValue; recipient?: { $tag?: string; _0?: AddressValue }; messageId?: string; eventType?: string; reason?: string; code?: number; error?: string };

    // Dispatch on the SesIngressDecision ADT (Decision H2). The TS
    // wrapper performs the async IO arm and returns the corresponding HTTP
    // response.
    switch (decision.$tag) {
      case "ConfirmSubscription": {
        const url = String(decision.url ?? "");
        if (url !== env.SubscribeURL || env.Type !== "SubscriptionConfirmation") {
          return c.json({ error: "Invalid SubscribeURL" }, 400);
        }
        try {
          await confirmSubscription(env);
        } catch {
          return c.json({ error: "SNS subscription confirmation temporarily unavailable" }, 502);
        }
        return c.json({ ok: true, confirmed: true });
      }
      case "EmitEvent": {
        // The Fenel body's EmitEvent arm carries the typed event +
        // recipient + messageId + eventType — invoke the cross-cut
        // composing primitive to do the post-mapping tail.
        if (!decision.event || !decision.messageId || !decision.eventType) {
          return c.json({ error: "Internal: missing EmitEvent payload" }, 500);
        }
        // The recipient field in the ADT is itself a Maybe<Address>; pass
        // through unchanged so the cross-cut handler can read $tag.
        await invoke(await mintLaneAuthorityFor(integration.accountId, "webhook:ses"), null, "emailWebhooks:emitEmailEvent", {
          provider: "ses",
          eventType: decision.eventType,
          emailEvent: decision.event,
          messageId: decision.messageId,
          recipient: decision.recipient ?? { $tag: "Nothing" },
        });
        // The existing delivery protocol records the message after emitting.
        // This is not an atomic claim: duplicate deliveries can emit again.
        // Signature verification alone does not provide replay deduplication.
        await invoke(await mintLaneAuthorityFor(integration.accountId, "webhook:ses"), null, "state.mark_webhook_processed", {
          provider: "ses",
          key: `event:${decision.messageId}`,
        });
        return c.json({ ok: true });
      }
      case "IgnoreEvent":
        return c.json({ ok: true, ignored: decision.reason ?? "unknown" });
      case "RejectEnvelope": {
        const code = (decision.code ?? 400) as 400 | 403 | 502 | 500;
        return c.json({ error: decision.error ?? "Rejected" }, code);
      }
      default:
        return c.json({ error: "Unknown SesIngressDecision tag" }, 500);
    }
  });

  return sesWebhookRoutes;
}

export const sesWebhookRoutes = createSesWebhookRoutes();
