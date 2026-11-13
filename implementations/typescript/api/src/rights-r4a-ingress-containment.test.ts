// ---------------------------------------------------------------------------
// rights R4a §0 — INGRESS CONTAINMENT. Pin P0a.
//
// Brief: `workstreams/rights/briefs/r4a-issuance-and-durable-reauthorization.md`
// §0.2 and §0.4.
//
// WHAT WAS LIVE. `/webhooks/calendly` verified the signature only when
// `CALENDLY_WEBHOOK_SECRET` was set, and 503'd for a missing secret only when
// `NODE_ENV === "production"`. The dev tunnel leaves both unset, so an UNSIGNED
// request passed the authentication stage entirely — measured by posting
// malformed JSON with no signature and receiving `400 {"error":"Invalid JSON"}`,
// which proves the request reached the parser. `invitee.created` then took the
// account from `tracking.utm_source` — a field on the booking form, chosen by
// whoever books the call — minted THAT account's authority and emitted
// `calendly_call_scheduled` into it.
//
// THE SHAPE RULE (R1 note §2, carried by every rights pin since): a pin at the
// layer where the answer is an INPUT observes nothing. Every case here drives
// the REAL exported `webhookRoutes` Hono app with a real Request. Only the two
// `@fenel/runtime` seams are replaced, and they are replaced by OBSERVERS: the
// mint records the account and lane it was asked for, so "no mint occurred" and
// "the mint used the deployment account, not the caller's field" are both
// directly measurable rather than inferred.
//
// ⚠ EVERY CASE HERE WAS OBSERVED RED UNDER ITS NEUTER BEFORE IT WAS TRUSTED.
// The red text is recorded in the phase completion note.
// ---------------------------------------------------------------------------

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

const ACCOUNT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACCOUNT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** Every mint the route asked for, in order. A mint is the observable: a 503
 *  that still minted would be a 503 that still handed a lane an authority. */
let mints: { accountId: string; lane: string }[] = [];
/** Every `invokeIOActionAs` the route made, in order. */
let acts: { action: string; params: Record<string, unknown> }[] = [];
/** What `crypto:verifyCalendlySignature` answers. */
let verifyAnswer = true;

// ⚠ THE SEAMS ARE OBSERVERS, NOT THE DOOR. `mintLaneAuthorityFor` loads an
// account execution registry from the database, and `invokeIOActionAs` runs the
// evaluator; neither is what this pin is about, and a pin that needed a database
// would not run in CI. What is NOT replaced is the route itself — the secret
// read, the environment branch, the header read, the verify call, the JSON
// parse, the event dispatch and the account selection are all the production
// ones.
const answer = (action: string) => {
  if (action === "crypto:verifyCalendlySignature") return verifyAnswer;
  return { ok: true };
};

mock.module("@fenel/runtime", () => ({
  mintLaneAuthorityFor: async (accountId: string, lane: string) => {
    mints.push({ accountId, lane });
    return { __probeAuthority: `${lane}:${accountId}` } as unknown;
  },
  invokeIOActionAs: async (
    _authority: unknown,
    _profileId: unknown,
    action: string,
    params: Record<string, unknown>,
  ) => {
    acts.push({ action, params });
    return answer(action);
  },
  // rights R4a C1a — the ACQUISITION seam. The signature VERIFY moved onto this
  // door, so an observer that watched only `invokeIOActionAs` would see the
  // route verify nothing and would pass with the verification deleted. The
  // acquisition handle carries NO account by construction, which is why the
  // "zero PRODUCT-GRANT mints" assertions below filter on `accountId !== ""`.
  mintAcquisitionAuthorityFor: (partition: string) => {
    mints.push({ accountId: partition, lane: "acquisition" });
    return { __probeAuthority: `acquisition:${partition}` } as unknown;
  },
  invokeIOActionEphemeral: async (
    _authority: unknown,
    _partition: unknown,
    _profileId: unknown,
    action: string,
    params: Record<string, unknown>,
  ) => {
    acts.push({ action, params });
    return answer(action);
  },
}));

const { webhookRoutes } = await import("./routes/webhooks");

const SAVED: Record<string, string | undefined> = {
  CALENDLY_WEBHOOK_SECRET: process.env["CALENDLY_WEBHOOK_SECRET"],
  DEFAULT_ACCOUNT_ID: process.env["DEFAULT_ACCOUNT_ID"],
  NODE_ENV: process.env["NODE_ENV"],
};
afterAll(() => {
  for (const [name, value] of Object.entries(SAVED)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

beforeEach(() => {
  mints = [];
  acts = [];
  verifyAnswer = true;
  delete process.env["CALENDLY_WEBHOOK_SECRET"];
  process.env["DEFAULT_ACCOUNT_ID"] = ACCOUNT_A;
  delete process.env["NODE_ENV"];
});

async function post(body: string, headers: Record<string, string> = {}): Promise<Response> {
  return webhookRoutes.request("http://local/calendly", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
}

/** The exact request that measured the hole: no signature, malformed JSON. A
 *  400 means it reached the JSON parser, which means it passed authentication. */
const THE_PROBE = "{";

/** A well-formed `invitee.created` whose tracking field names ACCOUNT B. */
function inviteeCreated(utmSource: string | null): string {
  const tracking = utmSource === null ? {} : { utm_source: utmSource };
  return JSON.stringify({
    event: "invitee.created",
    payload: {
      email: "someone@example.com",
      uri: "https://api.calendly.com/scheduled_events/x/invitees/y",
      tracking,
      scheduled_event: {
        start_time: "2026-10-01T10:00:00.000Z",
        event_type: "https://api.calendly.com/event_types/z",
        name: "Discovery call",
      },
    },
  });
}

describe("rights R4a P0a — Calendly verification is unconditional, in every environment", () => {
  // Neuter: restore `} else if (process.env["NODE_ENV"] === "production") {`
  // around the 503, i.e. put the secret check back inside `if (secret)`.
  // RED reads, for the unset and "development" cases:
  //   expect(received).toBe(expected) — Expected: 503, Received: 400
  // — which is the measured hole, reproduced by the pin.
  test("no secret configured: the unsigned malformed probe is REFUSED, in every environment", async () => {
    for (const environment of [undefined, "development", "test", "staging", "production"]) {
      mints = [];
      acts = [];
      if (environment === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = environment;

      const response = await post(THE_PROBE);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "Webhook secret not configured" });
      // The request never reached the parser — a 400 here is the hole.
      expect(response.status).not.toBe(400);
      // And nothing was minted for any lane, product or verify.
      expect(mints).toEqual([]);
      expect(acts).toEqual([]);
    }
  });

  test("THE POSITIVE CONTROL: with a secret configured the route verifies and proceeds", async () => {
    process.env["CALENDLY_WEBHOOK_SECRET"] = "shhh";
    const response = await post(inviteeCreated(null), {
      "calendly-webhook-signature": "t=1,v1=deadbeef",
    });
    expect(response.status).toBe(200);
    // The verify leaf ran, with the route's own raw body and the configured
    // secret — so "503 in every environment" is not being bought by a route
    // that refuses everything.
    expect(acts[0]?.action).toBe("crypto:verifyCalendlySignature");
    expect(acts[0]?.params["secret"]).toBe("shhh");
    expect(acts[1]?.action).toBe("webhooks:calendlyWebhook");
  });

  test("a secret configured but NO signature header is refused before the parser", async () => {
    process.env["CALENDLY_WEBHOOK_SECRET"] = "shhh";
    const response = await post(THE_PROBE);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Missing calendly-webhook-signature" });
    expect(mints).toEqual([]);
    expect(acts).toEqual([]);
  });

  test("a WRONG signature is refused 403 and mints no product authority", async () => {
    process.env["CALENDLY_WEBHOOK_SECRET"] = "shhh";
    verifyAnswer = false;
    const response = await post(inviteeCreated(null), {
      "calendly-webhook-signature": "t=1,v1=wrong",
    });
    expect(response.status).toBe(403);
    // ⚠ "zero mints" means zero PRODUCT-GRANT mints. The verify call carries an
    // ACQUISITION handle by design — the secret is read from the environment and
    // the account is not known yet, which is precisely the realm's reason to
    // exist. C1a moved it off the interim `webhook:calendly` lane.
    expect(mints).toEqual([{ accountId: "", lane: "acquisition" }]);
    expect(mints.filter((m) => m.accountId !== "")).toEqual([]);
    expect(acts.map((a) => a.action)).toEqual(["crypto:verifyCalendlySignature"]);
  });
});

describe("rights R4a P0a — `utm_source` selects nothing", () => {
  // Neuter: restore
  //   const accountId = ((tracking?.["utm_source"] as string | undefined) ??
  //     process.env["DEFAULT_ACCOUNT_ID"]) ?? "";
  // RED reads:
  //   expect(received).toBe(expected) — Expected: "aaaaaaaa-…", Received: "bbbbbbbb-…"
  test("a caller-chosen tracking field does NOT select the account", async () => {
    process.env["CALENDLY_WEBHOOK_SECRET"] = "shhh";
    const response = await post(inviteeCreated(ACCOUNT_B), {
      "calendly-webhook-signature": "t=1,v1=ok",
    });
    expect(response.status).toBe(200);

    const product = mints.filter((m) => m.accountId !== "");
    expect(product).toHaveLength(1);
    expect(product[0]!.accountId).toBe(ACCOUNT_A);
    expect(product[0]!.accountId).not.toBe(ACCOUNT_B);

    // And B appears nowhere in what the body was handed.
    const emit = acts.find((a) => a.action === "webhooks:calendlyWebhook");
    expect(emit).toBeDefined();
    expect(JSON.stringify(emit!.params)).not.toContain(ACCOUNT_B);
  });

  test("THE CONTROL: with no deployment account configured, nothing is emitted", async () => {
    process.env["CALENDLY_WEBHOOK_SECRET"] = "shhh";
    delete process.env["DEFAULT_ACCOUNT_ID"];
    const response = await post(inviteeCreated(ACCOUNT_B), {
      "calendly-webhook-signature": "t=1,v1=ok",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(acts.map((a) => a.action)).toEqual(["crypto:verifyCalendlySignature"]);
    expect(mints.filter((m) => m.accountId !== "")).toEqual([]);
  });
});
