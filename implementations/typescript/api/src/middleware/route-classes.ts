// ---------------------------------------------------------------------------
// Route classes — which rate and payload limits a request falls under (GP-25).
//
// Host routing, not policy: a class names the kind of caller a route serves
// (an anonymous reader, a password guess, a signed-in account, a third-party
// webhook), so the limiter can give each its own bucket. Nothing here decides
// whether a request may happen; that stays with the authority gate.
//
// The table is EXPLICIT on purpose. There is no catch-all rule: a route whose
// path matches no rule is "unclassified", and `route-classes.test.ts` walks
// the Hono app and fails on it, so a new route cannot ship without someone
// deciding its class. At run time an unclassified request (a 404, or a route
// the census has not seen yet) is limited as `anon-read`, the tightest general
// read bucket.
// ---------------------------------------------------------------------------

export type RouteClass =
  | "anon-read"
  | "anon-submit"
  | "login"
  | "signup"
  | "api"
  | "webhook"
  | "account";

export const ROUTE_CLASSES: readonly RouteClass[] = [
  "anon-read",
  "anon-submit",
  "login",
  "signup",
  "api",
  "webhook",
  "account",
];

type Rule = {
  readonly cls: RouteClass;
  /** Path prefix, segment by segment. A segment `:` matches any one segment. */
  readonly prefix: readonly string[];
  /** Restrict the rule to these methods (upper case); absent means any. */
  readonly methods?: readonly string[];
  /** Match the whole path, not just a prefix. */
  readonly exact?: boolean;
};

function rule(cls: RouteClass, path: string, extra: Omit<Rule, "cls" | "prefix"> = {}): Rule {
  return { cls, prefix: segments(path), ...extra };
}

function segments(path: string): string[] {
  return path.split("/").filter((s) => s.length > 0);
}

/** Checked in order; the first match wins, so narrower rules come first. */
const RULES: readonly Rule[] = [
  // --- Sign-in and sign-up -------------------------------------------------
  rule("login", "/api/auth/login", { exact: true }),
  rule("login", "/api/auth/dev-login", { exact: true }),
  rule("signup", "/api/auth/signup"),

  // --- Anonymous writes: public page and form submissions ------------------
  rule("anon-submit", "/p/:/:/submit", { exact: true }),
  rule("anon-submit", "/api/p/:/:/submit", { exact: true }),
  rule("anon-submit", "/api/embed/forms/:/submit", { exact: true }),

  // --- Anonymous reads -----------------------------------------------------
  rule("anon-read", "/p"),
  rule("anon-read", "/api/p"),
  rule("anon-read", "/r"),
  rule("anon-read", "/api/embed/forms"),
  rule("anon-read", "/api/health", { exact: true }),
  rule("anon-read", "/api/version", { exact: true }),

  // --- Third-party callers (each verifies its own signature or token) -------
  rule("webhook", "/webhooks"),
  rule("webhook", "/api/webhooks"),
  rule("webhook", "/api/intake/events"),

  // --- Evaluation: routes that run functions, actions or queries -----------
  rule("api", "/api/actions"),
  rule("api", "/api/query"),
  rule("api", "/api/io"),
  rule("api", "/api/functions/:/run", { exact: true }),

  // --- Signed-in account surfaces ------------------------------------------
  rule("account", "/api/auth"),
  rule("account", "/api/account"),
  rule("account", "/api/profiles"),
  rule("account", "/api/events"),
  rule("account", "/api/purchases"),
  rule("account", "/api/inventory"),
  rule("account", "/api/function-instances"),
  rule("account", "/api/items"),
  rule("account", "/api/plans"),
  rule("account", "/api/channels"),
  rule("account", "/api/proxy-links"),
  rule("account", "/api/email-templates"),
  rule("account", "/api/stats"),
  rule("account", "/api/analytics"),
  rule("account", "/api/types"),
  rule("account", "/api/views"),
  rule("account", "/api/functions"),
  rule("account", "/api/triggers"),
  rule("account", "/api/dispatch-instances"),
  rule("account", "/api/reader-metadata"),
  rule("account", "/api/spec-instances"),
  rule("account", "/api/entity-instances"),
  rule("account", "/api/integrations"),
  rule("account", "/api/pages"),
  rule("account", "/api/saved-queries"),
  rule("account", "/api/locus-root"),
  rule("account", "/api/workspace-bootstrap"),
  rule("account", "/api/locus-views"),
  rule("account", "/api/query-categories"),
  rule("account", "/api/imports"),
  rule("account", "/api/definition-bundles"),
  rule("account", "/api/modules"),
  // Google Places on our key: a signed-in surface (address fields in the
  // editor), and GOOGLE_PLACES_API_KEY stays unset on a public deployment.
  rule("account", "/api/input"),
];

/** A receipt lives at `/api/@<handle>/<tag>`: its second segment starts `@`. */
function isReceiptPath(parts: readonly string[]): boolean {
  return parts.length === 3 && parts[0] === "api" && parts[1]!.startsWith("@");
}

function matches(r: Rule, method: string, parts: readonly string[]): boolean {
  if (r.methods && !r.methods.includes(method)) return false;
  if (parts.length < r.prefix.length) return false;
  if (r.exact && parts.length !== r.prefix.length) return false;
  for (let i = 0; i < r.prefix.length; i++) {
    const want = r.prefix[i]!;
    if (want !== ":" && want !== parts[i]) return false;
  }
  return true;
}

/** The class of a request path (or of a Hono route pattern such as
 *  `/api/p/:accountSlug/:pageSlug`), or `undefined` when no rule covers it. */
export function classifyRoute(method: string, path: string): RouteClass | undefined {
  const parts = segments(path);
  const upper = method.toUpperCase();
  if (isReceiptPath(parts)) return "anon-read";
  for (const r of RULES) {
    if (matches(r, upper, parts)) return r.cls;
  }
  return undefined;
}
