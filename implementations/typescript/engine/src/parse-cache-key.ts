// Browser-safe, engine-free cache-key primitive shared by runtime readers and
// build-time preflights. Keep this leaf free of generated artifacts and engine
// imports: parser-bootstrap must be able to compare source bytes before it
// loads the module graph whose cold-boot seed it is repairing.

// cyrb53 (public-domain) — a fast, well-distributed, synchronous string hash.
// Used instead of node:crypto because runtime lookups also run in browser
// bundles. Two seeds produce a ~106-bit hex key; collision probability over the
// repository corpus is negligible.
function cyrb53(str: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
    ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
    ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** The cache key for a (src, locale) pair: `cyrb53` over
 * `locale`+`"|"`+LF-canonical source bytes. Locale defaults to `en`, the only
 * boot locale. Canonicalizing CRLF/CR prevents checkout EOL policy from making
 * the same committed source miss on another machine; both parser paths
 * canonicalize identically. */
export function parseCacheKey(src: string, locale?: string): string {
  const payload = (locale ?? "en") + "|" + src.replace(/\r\n?/g, "\n");
  const a = cyrb53(payload, 0).toString(16).padStart(14, "0");
  const b = cyrb53(payload, 0x9e3779b9).toString(16).padStart(14, "0");
  return a + b;
}
