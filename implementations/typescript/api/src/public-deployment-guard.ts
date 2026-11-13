// ---------------------------------------------------------------------------
// The public-deployment boot guard (GP-25).
//
// A public deployment (usefenel.com, api.usefenel.com) opts in with
// `FENEL_PUBLIC_DEPLOYMENT=1`. With the flag the API refuses to start unless:
//
//   - `NODE_ENV` is "production". Anything else makes the error handler in
//     `index.ts` answer 500s with messages and stack traces;
//   - none of the variables below is set. Each enables a surface that is not
//     safe to expose yet:
//       CALENDLY_WEBHOOK_SECRET, STRIPE_WEBHOOK_SECRET — webhook ingress that
//         writes account data; it stays off until rights R4a C1b/C2
//         (workstreams/rights/roadmap.md);
//       INBOUND_EVENT_TOKEN — the token-authenticated event intake (same);
//       ADMIN_TOKEN — dev-login, which mints a session for any email;
//       GOOGLE_PLACES_API_KEY — address autocomplete on our key;
//   - `API_HOST`, when set, is a loopback address. Unset, a public deployment
//     binds the API to 127.0.0.1 (`apiListenHostname`): the origin has no open
//     port, and cloudflared and the web front reach it locally. The rate
//     limiter believes `CF-Connecting-IP` only from loopback peers.
//
// Without the flag nothing changes, so the dev server and the staging tunnel
// boot as before. Host configuration, approved TypeScript category GP-7 (b).
// ---------------------------------------------------------------------------

import { canonicalIp, isLoopback } from "./middleware/client-ip";

export const PUBLIC_DEPLOYMENT_FLAG = "FENEL_PUBLIC_DEPLOYMENT";

export const FORBIDDEN_ON_PUBLIC_DEPLOYMENT = [
  "CALENDLY_WEBHOOK_SECRET",
  "STRIPE_WEBHOOK_SECRET",
  "INBOUND_EVENT_TOKEN",
  "ADMIN_TOKEN",
  "GOOGLE_PLACES_API_KEY",
] as const;

function isOn(value: string | undefined): boolean {
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  return v !== "" && v !== "0" && v !== "false" && v !== "no" && v !== "off";
}

/** The reasons this environment may not boot as a public deployment; empty
 *  when it may, or when it is not one. */
export function publicDeploymentRefusals(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string[] {
  if (!isOn(env[PUBLIC_DEPLOYMENT_FLAG])) return [];
  const reasons: string[] = [];
  if (env["NODE_ENV"] !== "production") {
    reasons.push(`NODE_ENV is ${env["NODE_ENV"] === undefined ? "unset" : `"${env["NODE_ENV"]}"`}, not "production"`);
  }
  for (const name of FORBIDDEN_ON_PUBLIC_DEPLOYMENT) {
    const value = env[name];
    if (value !== undefined && value !== "") reasons.push(`${name} is set`);
  }
  const host = env["API_HOST"]?.trim();
  if (host && !isLoopbackHost(host)) {
    reasons.push(`API_HOST is "${host}", not a loopback address`);
  }
  return reasons;
}

function isLoopbackHost(host: string): boolean {
  if (host.toLowerCase() === "localhost") return true;
  const ip = canonicalIp(host);
  return ip !== undefined && isLoopback(ip);
}

/** The address `Bun.serve` binds: `API_HOST` when set; otherwise 127.0.0.1 on
 *  a public deployment, and every interface (Bun's default) elsewhere. */
export function apiListenHostname(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const host = env["API_HOST"]?.trim();
  if (host) return host;
  return isOn(env[PUBLIC_DEPLOYMENT_FLAG]) ? "127.0.0.1" : undefined;
}

/** Log and exit when the environment may not boot as a public deployment. */
export function enforcePublicDeploymentGuard(
  env: Readonly<Record<string, string | undefined>> = process.env,
  exit: (code: number) => never = (code) => process.exit(code),
): void {
  const reasons = publicDeploymentRefusals(env);
  if (reasons.length === 0) {
    if (isOn(env[PUBLIC_DEPLOYMENT_FLAG])) console.log("[api] Public deployment: boot guard passed");
    return;
  }
  console.error(
    `[api] Refusing to start: ${PUBLIC_DEPLOYMENT_FLAG} is on and ${reasons.join("; ")}. ` +
    `A public deployment runs with NODE_ENV=production, without ${FORBIDDEN_ON_PUBLIC_DEPLOYMENT.join(", ")}, ` +
    `and with the API bound to loopback.`,
  );
  exit(1);
}
