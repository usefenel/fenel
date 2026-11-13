// ---------------------------------------------------------------------------
// Payments IO handlers — Stripe Checkout session creation as an
// irreducible IO leaf (one HTTPS POST to api.stripe.com).
//
// Single bodyless IO leaf:
//
//   payments.create_stripe_checkout_session(opts) → {url, providerRef}
//       Composes Stripe's price_data line_item shape from the body's
//       (amount, currency, description, customerEmail, successUrl,
//       cancelUrl, metadata) call. Direct fetch() to
//       https://api.stripe.com/v1/checkout/sessions with form-encoded
//       body (PHP-style bracket nesting) + Bearer auth via
//       STRIPE_SECRET_KEY. No SDK dependency.
// ---------------------------------------------------------------------------

import type { ModuleRegistry } from "@fenel/engine/registry";

if (!process.env["STRIPE_SECRET_KEY"]) {
  console.warn("[stripe] STRIPE_SECRET_KEY not set — Stripe disabled");
}

function appendFormEncoded(
  params: URLSearchParams,
  key: string,
  value: unknown,
): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((item, i) =>
      appendFormEncoded(params, `${key}[${i}]`, item),
    );
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      appendFormEncoded(params, `${key}[${k}]`, v);
    }
    return;
  }
  params.append(key, String(value));
}

export function stripeFormEncode(
  obj: Record<string, unknown>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    appendFormEncoded(params, k, v);
  }
  return params;
}

export function registerPaymentsHandlers(reg: ModuleRegistry): void {
  reg.registerIOHandler(
    "payments.create_stripe_checkout_session",
    async (params) => {
      const amount = params["amount"] as number | undefined;
      const currency = params["currency"] as string | undefined;
      const description = params["description"] as string | undefined;
      const customerEmail = params["customerEmail"] as string | undefined;
      const successUrl = params["successUrl"] as string | undefined;
      const cancelUrl = params["cancelUrl"] as string | undefined;
      const metadata =
        (params["metadata"] as Record<string, string> | undefined) ?? {};
      if (amount == null || !currency || !successUrl || !cancelUrl) {
        throw new Error(
          "payments.create_stripe_checkout_session: amount, currency, successUrl, cancelUrl required",
        );
      }
      const key = process.env["STRIPE_SECRET_KEY"];
      if (!key) {
        throw new Error(
          "payments.create_stripe_checkout_session: STRIPE_SECRET_KEY not set",
        );
      }
      const body = stripeFormEncode({
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: currency.toLowerCase(),
              unit_amount: amount,
              product_data: {
                name: description ?? "Payment",
              },
            },
            quantity: 1,
          },
        ],
        ...(customerEmail ? { customer_email: customerEmail } : {}),
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata,
      });
      const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
        },
        body,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(
          `payments.create_stripe_checkout_session: Stripe API ${res.status}: ${text}`,
        );
      }
      const session = (await res.json()) as {
        url: string | null;
        id: string;
      };
      return {
        action: "continue",
        value: {
          url: session.url ?? "",
          providerRef: session.id,
        },
      };
    },
  );
}
