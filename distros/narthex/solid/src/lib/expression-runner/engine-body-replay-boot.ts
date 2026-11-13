// S1b — worker boot of the engine-body replay artifact (design/tcb-ledger.md
// row engine.memo.engine-body-replay; host glue under the S1 approval).
// The authoring catalogue worker entry awaits this BEFORE it hands any request
// to the real worker, so the artifact is installed before the first
// synchronous registry build. The pin comes from the production build plugin
// (engine-body-replay-plugin.mjs): its epoch and digests were computed from
// the bundled tree; in dev it is admitted only while the startup binding stays
// current. Every failure leaves the artifact OFF: builds compute as before
// and the user sees nothing.
//
// This module stays LIGHT (no static engine import), so the entry can load it
// and start the download while the real worker's graph is still loading. The
// engine is reached by dynamic import (the same module instances) only once
// the real worker has loaded, so the harness certificate is computed over the
// fully registered engine.
//
// Browser pin by bytes digest (1c, 2026-11-01): the gzip bytes are read once,
// decompressed, and handed to the engine with the text under the explicit
// `bytes-digest` pin. The engine checks the SHA-256 of THOSE bytes (the realm's
// WebCrypto, else its pure SHA-256) against the pinned `artifactSha256`, which
// replaces the runtime text digest: the build plugin verified that exactly
// those bytes decode strictly to text with the recorder's `textDigest`. A pin
// whose `artifactSha256` is not 64 lowercase hex digits gets the text-digest
// pin, checked as before. Trust rests on no fetch integrity feature (the fetch
// still sends `integrity`, which only refuses earlier).
import replayPin from "virtual:fenel-engine-body-replay";
import { chunkIntegrity } from "./authoring-catalogue-transport";

type Installer = typeof import("../../../../../../implementations/typescript/engine/src/engine-bodies-dispatch").installEngineBodyReplayArtifactTextAsync;

/** Where a probe reads the boot verdict (`globalThis[symbol]`). */
export const ENGINE_BODY_REPLAY_BOOT_STATUS = Symbol.for("fenel.engine-body-replay.boot");
/** A probe-only function on `globalThis`: the live harness certificate input. */
export const ENGINE_BODY_REPLAY_CERTIFICATE_INPUT = Symbol.for("fenel.engine-body-replay.certificate-input");

export type EngineBodyReplayPin = {
  readonly artifactUrl: string;
  /** SHA-256 (hex) of the emitted gzip bytes, checked by the fetch (SRI). */
  readonly artifactSha256: string;
  /** The plugin's digest of the decompressed text (engine `sha256OfEncoding`). */
  readonly textDigest: string;
  /** The source epoch the plugin computed from the bundled tree. */
  readonly sourceEpoch: string;
  /** Dev server only: asked after the whole real worker loaded; it answers
   *  `{ on: true, sourceEpoch }` only while no universe file changed since
   *  the server bound the epoch. */
  readonly statusUrl?: string;
};

export type EngineBodyReplayBootStatus = {
  readonly accepted: boolean;
  readonly refused?: string;
  /** Download + decompression, and the engine's admission checks. */
  readonly fetchMs?: number;
  readonly installMs?: number;
  /** Whether this realm's exact Proxy detector is active (install first,
   *  engine canary tracked); without it the memo refuses every call. */
  readonly proxyTracking?: boolean;
  /** How the install was pinned: `bytes-digest` (the gzip bytes' SHA-256
   *  against `artifactSha256`; no text digest) or `text-digest`. */
  readonly pinKind?: "bytes-digest" | "text-digest";
};

export type EngineBodyReplayBootHost = {
  readonly fetch: (input: URL, init: RequestInit) => Promise<Response>;
  readonly installer: () => Promise<Installer>;
  readonly proxyTracking: () => Promise<boolean>;
  readonly base: string;
  readonly now: () => number;
  /** The realm's WebCrypto SHA-256, which the engine uses for the pinned text
   *  and harness-certificate digests (the same function as its pure path). */
  readonly platformSha256?: SubtleCrypto;
  /** Hands the realm clock to the engine-body memo's diagnostic timings
   *  (the engine reads no global clock; without it they read 0). */
  readonly memoClock?: () => Promise<(clock: () => number) => void>;
};

const defaultHost = (): EngineBodyReplayBootHost => ({
  fetch: (input, init) => globalThis.fetch(input, init),
  installer: async () => (await import("../../../../../../implementations/typescript/engine/src/engine-bodies-dispatch")).installEngineBodyReplayArtifactTextAsync,
  proxyTracking: async () => (await import("../../../../../../implementations/typescript/engine/src/proxy-tracking")).trackedProxyDetector() !== null,
  base: globalThis.location?.href ?? "",
  now: () => performance.now(),
  platformSha256: globalThis.crypto?.subtle,
  memoClock: async () => (await import("../../../../../../implementations/typescript/engine/src/engine-body-memo")).setEngineBodyMemoDiagnosticClock,
});

/** Longest wait for the artifact before the worker proceeds without it. */
export const ARTIFACT_DOWNLOAD_LIMIT_MS = 20_000;
/** Dev admission hashes the complete source tree after the worker loads. A
 * cold check may outlast the gzip download; keep this separate and bounded.
 * The worker client's existing dispatch/initialization watchdogs still apply. */
export const DEV_STATUS_CHECK_LIMIT_MS = 60_000;

const failure = (error: unknown) => `artifact unavailable (${error instanceof Error ? error.message : String(error)})`;

/** Download the pinned artifact's gzip bytes once and decompress THOSE bytes;
 *  the engine digests the same array (`bytes-digest` pin). Never rejects. */
async function artifactText(pin: EngineBodyReplayPin, host: EngineBodyReplayBootHost): Promise<{ text: string; bytes: Uint8Array<ArrayBuffer> } | { refused: string }> {
  try {
    // Bounded: a slow download must not hold the first request longer than a
    // build would take without the artifact (the abort also ends the body).
    const response = await host.fetch(new URL(pin.artifactUrl, host.base),
      { integrity: chunkIntegrity(pin.artifactSha256), signal: AbortSignal.timeout(ARTIFACT_DOWNLOAD_LIMIT_MS) });
    if (!response.ok || response.body === null) return { refused: `artifact unavailable (${response.status})` };
    const bytes = new Uint8Array(await response.arrayBuffer());
    const text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    return { text, bytes };
  } catch (error) {
    return { refused: failure(error) };
  }
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Dev server: the bytes this worker loaded are the hashed ones only if no
 * universe file changed since the server bound the epoch. Asked after the
 * real worker's module graph loaded; any doubt refuses. */
async function devServerRefusal(pin: EngineBodyReplayPin, host: EngineBodyReplayBootHost): Promise<string | undefined> {
  try {
    const response = await host.fetch(new URL(pin.statusUrl!, host.base), { cache: "no-store", signal: AbortSignal.timeout(DEV_STATUS_CHECK_LIMIT_MS) });
    const answer = response.ok ? await response.json() as { on?: unknown; sourceEpoch?: unknown; reason?: unknown } : undefined;
    if (answer?.on === true && answer.sourceEpoch === pin.sourceEpoch) return undefined;
    return `dev server: ${typeof answer?.reason === "string" ? answer.reason : "the replay binding is off"}`;
  } catch (error) {
    return `dev server: ${failure(error)}`;
  }
}

/**
 * Start the download now; once `realWorker` has loaded, install the text with
 * the build pin (the engine checks the gzip bytes' digest, or the text digest
 * for a malformed `artifactSha256`, then the epoch, the key format, the hook
 * generation and the harness certificate), then publish the verdict and the
 * pin kind on `globalThis[ENGINE_BODY_REPLAY_BOOT_STATUS]`. Never rejects.
 */
export async function bootEngineBodyReplay(
  realWorker: Promise<unknown>,
  pin: EngineBodyReplayPin | undefined = replayPin,
  host: EngineBodyReplayBootHost = defaultHost(),
): Promise<EngineBodyReplayBootStatus> {
  const started = host.now();
  const download = pin === undefined ? undefined : artifactText(pin, host);
  let status: EngineBodyReplayBootStatus;
  try {
    await realWorker;
  } catch {
    // The entry reports the real worker's failure itself.
  }
  try {
    const setClock = await host.memoClock?.();
    setClock?.(host.now);
  } catch { /* diagnostics only */ }
  if (pin === undefined || download === undefined) {
    status = { accepted: false, refused: "no pin (no admissible artifact, or the dev binding is off)" };
  } else {
    const fetched = await download;
    const fetchMs = Math.round(host.now() - started);
    if ("refused" in fetched) status = { accepted: false, refused: fetched.refused, fetchMs };
    else {
      const devRefusal = pin.statusUrl === undefined ? undefined : await devServerRefusal(pin, host);
      if (devRefusal !== undefined) {
        status = { accepted: false, refused: devRefusal, fetchMs };
      } else {
        const pinKind = typeof pin.artifactSha256 === "string" && SHA256_HEX.test(pin.artifactSha256)
          ? "bytes-digest" as const : "text-digest" as const;
        const installing = host.now();
        try {
          const install = await host.installer();
          const enginePin = pinKind === "bytes-digest"
            ? { kind: pinKind, artifactSha256: pin.artifactSha256, bytes: fetched.bytes, textDigest: pin.textDigest, sourceEpoch: pin.sourceEpoch }
            : { textDigest: pin.textDigest, sourceEpoch: pin.sourceEpoch };
          const verdict = await install(fetched.text, enginePin, host.platformSha256);
          status = { accepted: verdict.accepted, ...(verdict.refused === undefined ? {} : { refused: verdict.refused }),
            pinKind, fetchMs, installMs: Math.round(host.now() - installing) };
        } catch (error) {
          status = { accepted: false, refused: failure(error), fetchMs };
        }
      }
    }
  }
  let proxyTracking: boolean | undefined;
  try { proxyTracking = await host.proxyTracking(); } catch { proxyTracking = undefined; }
  // Diagnostics for probes: why a certificate differs from the recorder's
  // (the components the engine digests; read only when called).
  try {
    Object.defineProperty(globalThis, ENGINE_BODY_REPLAY_CERTIFICATE_INPUT, { configurable: true,
      value: async () => (await import("../../../../../../implementations/typescript/engine/src/engine-bodies-dispatch")).harnessCertificateInput() });
  } catch { /* diagnostics only */ }
  const published = Object.freeze({ ...status, proxyTracking });
  try { Object.defineProperty(globalThis, ENGINE_BODY_REPLAY_BOOT_STATUS, { value: published, configurable: true }); } catch { /* diagnostics only */ }
  return published;
}
