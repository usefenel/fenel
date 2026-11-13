// ---------------------------------------------------------------------------
// Crypto — FFI leaf (the 3 irreducible host-crypto sync natives).
//
// typed-function-references Phase FM-retire-8 Step 2 (2026-06-07). These three
// bodies are irreducible host crypto and stay TS `@native` ffi leaves (the
// Fenel-first HARD rule's legitimate exception — crypto-random, scrypt KDF, and
// timing-safe compare cannot be Fenel-bodied):
//   - randomTokenHex — node:crypto randomBytes(n).toString("hex");
//   - hashPassword (codeName scryptHash) — scrypt KDF with a fresh 16-byte salt,
//     canonical "<saltHex>:<hashHex>" storage form;
//   - verifyPassword (codeName scryptVerify) — constant-time scrypt verify.
//
// They are CTX-ONLY sync natives (the `(ctx, ...args)` shape): registered via the
// module's `nativeImplsCtx` so `nativesCtx` wins over `ioAction` in
// invokeFunction's resolution order, letting the auth-orchestrator bodies
// (fenel/modules/auth/session.fenel) call them in-process without async IO yield.
// Lifted VERBATIM from the retired state.ts inline impls (the module-substrate
// Phase-3b ffi/ convention; the 3b rootDir→repo-root build-wiring makes the
// node:crypto import compile under `--noEmit`).
//
// BROWSER-SAFETY (2026-07-05): the `node:crypto` access is LAZY (`require`d
// inside each native), NOT a static top-level `import … from "node:crypto"`.
// This ffi leaf is bundled into `@fenel/engine`, which the SolidStart editor
// imports in the BROWSER — and vite externalizes `node:crypto` to a stub that
// THROWS on property access at module-EVAL time. A static import therefore made
// merely importing the engine fatal in the browser, blanking every /app page
// (the editor's `registerCatalogEntities`/`typeToSetExpr`/… all pull the engine
// graph). These natives only ever run server-side, so the lazy require never
// executes in the browser. Same pattern as `engine-bodies-dispatch.ts` (createHash).
// ---------------------------------------------------------------------------

type NodeCryptoNatives = Pick<
  typeof import("node:crypto"),
  "randomBytes" | "scryptSync" | "timingSafeEqual"
>;

/** Lazy, capability-narrow host-crypto accessor. `require`d only when a native
 *  actually runs (server-side) — never touched during a browser module-eval. */
function nodeCrypto(): NodeCryptoNatives {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { randomBytes, scryptSync, timingSafeEqual } = require("node:crypto") as typeof import("node:crypto");
  return { randomBytes, scryptSync, timingSafeEqual };
}

const SCRYPT_KEY_LEN = 64;

function randomTokenHexNative(_ctx: unknown, byteLength: unknown): string {
  const { randomBytes } = nodeCrypto();
  const n = typeof byteLength === "number" && byteLength > 0 ? byteLength : 32;
  return randomBytes(n).toString("hex");
}

function hashPasswordNative(_ctx: unknown, password: unknown): string {
  if (typeof password !== "string") {
    throw new Error("crypto:hashPassword: password must be a string");
  }
  const { randomBytes, scryptSync } = nodeCrypto();
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEY_LEN);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

function verifyPasswordNative(
  _ctx: unknown,
  password: unknown,
  stored: unknown,
): boolean {
  if (typeof password !== "string") return false;
  if (typeof stored !== "string" || stored.length === 0) return false;
  const sep = stored.indexOf(":");
  if (sep <= 0) return false;
  const saltHex = stored.slice(0, sep);
  const hashHex = stored.slice(sep + 1);
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  if (expected.length !== SCRYPT_KEY_LEN) return false;
  const { scryptSync, timingSafeEqual } = nodeCrypto();
  const candidate = scryptSync(password, salt, SCRYPT_KEY_LEN);
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

// Keyed by the short fnId-suffix; the seam rekeys to `crypto:<suffix>` via
// rekeyNativesById. Only the 3 sync natives live here — the 4 IO-backed fns
// (sha256Hex / verify*) resolve through the runtime registerCryptoHandlers.
export const cryptoNativesCtx = {
  randomTokenHex: randomTokenHexNative,
  hashPassword: hashPasswordNative,
  verifyPassword: verifyPasswordNative,
};
