// ---------------------------------------------------------------------------
// The client address a rate-limit bucket is keyed on (GP-25). Host HTTP
// framing: it reads the socket peer and one header, and decides nothing about
// what a request may do.
//
// Two rules make the key hard to rotate:
//
//   - `CF-Connecting-IP` is believed only from a TRUSTED PEER: a loopback
//     socket (cloudflared, or the local web front that proxies `/api`, both on
//     the same host) or an address listed in `FENEL_TRUSTED_PROXY_IPS`. From
//     any other peer the header is ignored and the socket address is used, so
//     a client that reaches the API port directly cannot pick its own key. A
//     public deployment also binds the API to loopback (`server.ts`, checked by
//     the boot guard). The local web front forwards the header as the client
//     sent it, so it too must listen on loopback only (Vite's default).
//   - An IPv6 address is keyed on its /64: one subscriber holds at least a
//     /64 and can rotate within it freely. An IPv4-mapped IPv6 address
//     (`::ffff:192.0.2.1`) is keyed as the IPv4 address.
// ---------------------------------------------------------------------------

function parseIpv4(s: string): number[] | undefined {
  const parts = s.split(".");
  if (parts.length !== 4) return undefined;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return undefined;
    const n = Number(p);
    if (n > 255) return undefined;
    out.push(n);
  }
  return out;
}

function parseIpv6(input: string): number[] | undefined {
  let s = input;
  // A dotted IPv4 tail (`::ffff:192.0.2.1`) becomes two hextets.
  const lastColon = s.lastIndexOf(":");
  const last = s.slice(lastColon + 1);
  if (last.includes(".")) {
    const v4 = parseIpv4(last);
    if (!v4) return undefined;
    s = `${s.slice(0, lastColon + 1)}${((v4[0]! << 8) | v4[1]!).toString(16)}:${((v4[2]! << 8) | v4[3]!).toString(16)}`;
  }
  const gap = s.indexOf("::");
  if (gap !== s.lastIndexOf("::")) return undefined;
  let groups: string[];
  if (gap >= 0) {
    const head = s.slice(0, gap) === "" ? [] : s.slice(0, gap).split(":");
    const tail = s.slice(gap + 2) === "" ? [] : s.slice(gap + 2).split(":");
    if (head.length + tail.length > 7) return undefined;
    groups = [...head, ...Array<string>(8 - head.length - tail.length).fill("0"), ...tail];
  } else {
    groups = s.split(":");
    if (groups.length !== 8) return undefined;
  }
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return undefined;
    out.push(parseInt(g, 16));
  }
  return out;
}

/** An address in one canonical spelling: dotted IPv4 (IPv4-mapped IPv6
 *  included), or eight lower-case hextets without compression. `undefined`
 *  when the text is not an address. */
export function canonicalIp(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let s = raw.trim().toLowerCase();
  if (s.length === 0 || s.length > 64) return undefined;
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  if (!s.includes(":")) return parseIpv4(s)?.join(".");
  const h = parseIpv6(s);
  if (!h) return undefined;
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) {
    return [h[6]! >> 8, h[6]! & 255, h[7]! >> 8, h[7]! & 255].join(".");
  }
  return h.map((x) => x.toString(16)).join(":");
}

export function isLoopback(canonical: string): boolean {
  return canonical.startsWith("127.") || canonical === "0:0:0:0:0:0:0:1";
}

/** The bucket key of a canonical address: IPv4 as is, IPv6 as its /64. */
export function addressKey(canonical: string): string {
  if (!canonical.includes(":")) return canonical;
  return `${canonical.split(":").slice(0, 4).join(":")}::/64`;
}

/** `FENEL_TRUSTED_PROXY_IPS`: comma-separated proxy addresses, besides
 *  loopback, whose `CF-Connecting-IP` is believed. */
export function readTrustedProxies(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const part of (env["FENEL_TRUSTED_PROXY_IPS"] ?? "").split(",")) {
    const ip = canonicalIp(part);
    if (ip) out.add(ip);
    else if (part.trim()) console.warn(`[api] FENEL_TRUSTED_PROXY_IPS: "${part.trim()}" is not an address; ignored`);
  }
  return out;
}

/** The client key used for rate limits.
 *
 *  `CF-Connecting-IP` wins only when the socket peer is loopback or a trusted
 *  proxy and the header is an address. Otherwise the socket address is used,
 *  and a request with neither (only `app.request()` in tests) shares the
 *  `unknown` bucket. */
export function clientIp(
  headerValue: string | undefined,
  socketAddress: string | undefined,
  trustedProxies: ReadonlySet<string> = new Set(),
): string {
  const peer = canonicalIp(socketAddress);
  if (peer !== undefined && (isLoopback(peer) || trustedProxies.has(peer))) {
    const forwarded = canonicalIp(headerValue);
    if (forwarded !== undefined) return addressKey(forwarded);
  }
  if (peer !== undefined) return addressKey(peer);
  if (socketAddress) return `socket:${socketAddress.trim().toLowerCase().slice(0, 64)}`;
  return "unknown";
}
