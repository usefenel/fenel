// ---------------------------------------------------------------------------
// Email — FFI leaf (the irreducible host bridge: the `parseAddress` regex
// native + the AddressValue/BodyValue value types + the addressToFenelView
// null→Maybe marshaller).
//
// module-substrate Phase 3k — email is the capability+creds REPRESENTATIVE.
// The ffi/ split mechanic is `time` (3b) / `codec` (3d) verbatim: the lone
// irreducible host leaf moves out of the retired `engine/src/modules/email.ts`
// into this per-module `ffi/` leaf. Unlike picture's leaf (3f), this one is
// HOST-ONLY (a regex parse) — no engine internals imported, like time/codec.
//
// F-PERMANENT-REVISIT FLAG: not every export below is irreducible host IO.
//   - `parseAddressNative` is a GENUINE leaf for now — it parses an RFC 5322
//     address via REGEX, which Fenel can't yet express (awaits Fenel regex
//     support, the same blocker `formatAddress`'s embedded-quote strip waited
//     on before std:replaceAll landed). Flagged: a Fenel re-port lands when
//     regex / a pattern-matching address parser ships.
//   - `addressToFenelView` is PURE null→Maybe marshalling (a single record
//     reshape, no host IO) — it composes from a `case … of` over a nullable
//     field, so it is a Fenel-port candidate parked here for PARITY (the
//     migration brief forbids re-ports). Same posture as codec's 5 pure
//     helpers + picture's constructor helpers.
//
// The content-gate (`ts-elimination-completion`) permits `.ts` under
// `fenel/modules/` ONLY inside an `ffi/` folder — this is the leaf for email.
// ---------------------------------------------------------------------------

export type AddressValue = { local: string; domain: string; displayName: string | null };
export type BodyValue =
  | { $tag: "Text"; _0: string }
  | { $tag: "Html"; _0: string }
  | { $tag: "Multipart"; text: string; html: string };

/** Parse an RFC 5322 address. Accepts both forms:
 *    "rom@usefenel.com"
 *    "Romain <rom@usefenel.com>"
 *  Returns null if no `@` is found. (Irreducible REGEX leaf — awaits Fenel
 *  regex support; see the F-permanent FLAG above.) */
export function parseAddressNative(s: unknown): AddressValue | null {
  const raw = String(s ?? "").trim();
  if (!raw) return null;
  // Look for a bracketed address. If present, anything before is display name.
  const m = /^(.*?)<([^<>]+)>\s*$/.exec(raw);
  let displayName: string | null = null;
  let inner = raw;
  if (m) {
    displayName = m[1]!.trim().replace(/^"|"$/g, "").trim() || null;
    inner = m[2]!.trim();
  }
  const at = inner.indexOf("@");
  if (at < 0) return null;
  const local = inner.slice(0, at).trim();
  const domain = inner.slice(at + 1).trim();
  if (!local || !domain) return null;
  return { local, domain, displayName };
}

/** Marshal an `AddressValue` (TS shape, raw `displayName: string | null`) into
 *  the Fenel-side view with `displayName` wrapped as canonical Maybe. The
 *  Fenel body's `case addr.displayName of Nothing -> … Just name -> …` pattern
 *  requires the canonical shape on the `Just` branch (the null → Nothing
 *  fallback works only for the Nothing case). Used at the `parseAddress` native
 *  boundary; TS-internal consumers (providers, webhooks) keep the raw
 *  `string | null` shape via `parseAddressNative` directly. */
export function addressToFenelView(addr: AddressValue): Record<string, unknown> {
  return {
    local: addr.local,
    domain: addr.domain,
    displayName:
      addr.displayName === null
        ? { $tag: "Nothing" }
        : { $tag: "Just", _0: addr.displayName },
  };
}

/** The codeName-keyed native map (the SAME shape the retired spec file
 *  declared before the ffi/ split). `parseAddress` is declared `returns: Maybe
 *  Address`, so the Fenel-callable view returns `{$tag: "Just"|"Nothing"}`;
 *  host-language null only lives in the TS-internal `parseAddressNative` the
 *  runtime webhook parsers consume with `?? fallback`. The seam rekeys this to
 *  the `email:` id-namespace via `rekeyNativesById`. */
export const emailNatives = {
  parseAddress: (s: unknown) => {
    const raw = parseAddressNative(s);
    return raw === null ? { $tag: "Nothing" } : { $tag: "Just", _0: addressToFenelView(raw) };
  },
};
