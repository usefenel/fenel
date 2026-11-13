import { Hono, type Context } from "hono";
import type { AccountChoices, AccountSwitch, PersonalAccountOutcome } from "@fenel/core";

export type AccountSessionDependencies = {
  /** The raw token of the request's authenticated USER session, if any. */
  sessionToken: (context: Context) => string | undefined;
  listAccounts: (rawToken: string) => Promise<AccountChoices | null>;
  personalAccount: (rawToken: string) => Promise<PersonalAccountOutcome>;
  switchAccount: (rawToken: string, accountId: string, nowMs: number) => Promise<AccountSwitch>;
  cookie: (token: string, maxAgeSeconds?: number) => string;
  /** The host clock; the only value here Fenel cannot compute. */
  now?: () => number;
};

/** HTTP framing over `auth:listAccounts` and `auth:switchAccount`
 * (`fenel/modules/auth/accounts.fenel`). Every rule is Fenel: session
 * liveness, the account id's shape, the membership recheck, keeping the
 * source expiry, revoking the replaced session and the cookie's max-age. This
 * file reads the credential, the clock and the body, and writes the response.
 * Selecting an account never takes a caller-supplied principal or creates a
 * membership. Personal setup separately creates only the token user's linked
 * private partition and narrow personal grant. Neither is a partial data grant. */
export function createAccountSessionRoutes(dependencies: AccountSessionDependencies): Hono {
  const now = dependencies.now ?? Date.now;
  const routes = new Hono();
  routes.get("/accounts", async (context) => {
    const token = dependencies.sessionToken(context);
    const choices = token ? await dependencies.listAccounts(token) : null;
    if (!choices) return context.json({ error: "Authentication required" }, 401);
    context.header("Cache-Control", "no-store");
    return context.json(choices);
  });

  routes.post("/personal-account", async (context) => {
    const token = dependencies.sessionToken(context);
    context.header("Cache-Control", "no-store");
    if (!token) return context.json({ error: "Authentication required" }, 401);
    // Body/query user ids and account ids are intentionally not inputs.
    const outcome = await dependencies.personalAccount(token);
    if (outcome.kind === "refused") return context.json({ error: outcome.message }, outcome.status);
    return context.json({ accountId: outcome.accountId });
  });

  routes.post("/switch-account", async (context) => {
    const token = dependencies.sessionToken(context);
    if (!token) return context.json({ error: "Authentication required" }, 401);
    const body: unknown = await context.req.json().catch(() => undefined);
    const requested = body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).accountId : undefined;
    const outcome = await dependencies.switchAccount(token, typeof requested === "string" ? requested : "", now());
    context.header("Cache-Control", "no-store");
    if (outcome.kind === "refused") return context.json({ error: outcome.message }, outcome.status);
    context.header("Set-Cookie", dependencies.cookie(outcome.token, outcome.maxAgeSeconds));
    return context.json({ subject: { $tag: "User", userId: outcome.userId, accountId: outcome.accountId } });
  });
  return routes;
}
