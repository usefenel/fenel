import { describe, expect, mock, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

// The build plugin answers this module in production; serve mode gives undefined.
mock.module("virtual:fenel-engine-body-replay", () => ({ default: undefined }));
const { bootEngineBodyReplay, ENGINE_BODY_REPLAY_BOOT_STATUS } = await import("./engine-body-replay-boot");
const { __replayPinDigestsForTests, openPinnedReplayArtifactTextAsync, replayArtifactText } = await import("../../../../../../implementations/typescript/engine/src/engine-body-replay");
const { sha256OfEncoding } = await import("../../../../../../implementations/typescript/engine/src/engine-body-memo");
type ReplayArtifactPin = import("../../../../../../implementations/typescript/engine/src/engine-body-replay").ReplayArtifactPin;
type PlatformSha256 = import("../../../../../../implementations/typescript/engine/src/engine-body-memo").PlatformSha256;

const pin = Object.freeze({ artifactUrl: "/assets/engine-body-replay-0123456789abcdef.bin", artifactSha256: "ab".repeat(32),
  textDigest: "cd".repeat(32), sourceEpoch: "ef".repeat(32) });
const sri = (hex: string) => `sha256-${Buffer.from(hex, "hex").toString("base64")}`;

function host(response: () => Response | Promise<Response>, verdict: { accepted: boolean; refused?: string } = { accepted: true }) {
  const fetched: { url: string; integrity?: string; bounded: boolean }[] = [];
  const installed: { text: string; pin: unknown }[] = [];
  let clock = 0;
  return {
    fetched, installed,
    fetch: async (input: URL, init: RequestInit) => { fetched.push({ url: input.href, integrity: init.integrity, bounded: init.signal instanceof AbortSignal }); return response(); },
    installer: async () => async (text: string, given: unknown) => { installed.push({ text, pin: given }); return verdict; },
    proxyTracking: async () => true,
    base: "https://fenel.test/assets/authoring-catalog.worker-x.js",
    now: () => (clock += 5),
  };
}

const gzipResponse = (text: string) => new Response(gzipSync(Buffer.from(text, "utf8")));

describe("engine-body replay worker boot", () => {
  test("serve mode (no pin) fetches nothing and is off", async () => {
    const h = host(() => gzipResponse("x"));
    const status = await bootEngineBodyReplay(Promise.resolve(), undefined, h);
    expect(status.accepted).toBe(false);
    expect(status.refused).toMatch(/no pin/);
    expect(h.fetched).toEqual([]);
    expect(h.installed).toEqual([]);
    expect((globalThis as Record<symbol, unknown>)[ENGINE_BODY_REPLAY_BOOT_STATUS]).toEqual({ ...status });
  });

  test("downloads with SRI at once, decompresses, and installs only after the real worker loaded", async () => {
    const h = host(() => gzipResponse("header\nindex\nvalues é"));
    let loaded!: () => void;
    const realWorker = new Promise<void>(resolve => { loaded = resolve; });
    const booting = bootEngineBodyReplay(realWorker, pin, h);
    await Bun.sleep(5);
    const artifact = { url: "https://fenel.test/assets/engine-body-replay-0123456789abcdef.bin", integrity: sri("ab".repeat(32)), bounded: true };
    expect(h.fetched[0]).toEqual(artifact);
    expect(h.installed).toEqual([]);
    loaded();
    const status = await booting;
    // One fetch; the install receives the decompressed text AND the exact
    // gzip bytes it came from, under the explicit bytes-digest pin.
    expect(h.fetched).toEqual([artifact]);
    expect(h.installed).toEqual([{ text: "header\nindex\nvalues é", pin: { kind: "bytes-digest", artifactSha256: pin.artifactSha256,
      bytes: new Uint8Array(gzipSync(Buffer.from("header\nindex\nvalues é", "utf8"))), textDigest: pin.textDigest, sourceEpoch: pin.sourceEpoch } }]);
    expect(status).toMatchObject({ accepted: true, proxyTracking: true, pinKind: "bytes-digest" });
    expect(typeof status.fetchMs).toBe("number");
  });

  test("a dev-server pin installs only when the status, asked after the real worker loaded, is still on for its epoch", async () => {
    const devPin = { ...pin, statusUrl: "/__fenel/engine-body-replay-status" };
    const answers: [unknown, boolean, RegExp?][] = [
      [{ on: true, sourceEpoch: pin.sourceEpoch }, true],
      [{ on: false, reason: "a source file changed since the dev server started" }, false, /source file changed/],
      [{ on: true, sourceEpoch: "00".repeat(32) }, false, /binding is off/],
    ];
    for (const [answer, accepted, reason] of answers) {
      let loaded!: () => void;
      const realWorker = new Promise<void>(resolve => { loaded = resolve; });
      const order: string[] = [];
      const h = host(() => gzipResponse("t"));
      const dev = { ...h, fetch: async (input: URL, init: RequestInit) => {
        if (input.pathname.endsWith("-status")) { order.push("status"); return Response.json(answer); }
        order.push("artifact");
        return h.fetch(input, init);
      } };
      const booting = bootEngineBodyReplay(realWorker, devPin, dev);
      await Bun.sleep(5);
      expect(order[0]).toBe("artifact");
      expect(order).not.toContain("status");
      loaded();
      const status = await booting;
      expect(order).toEqual(["artifact", "status"]);
      expect(status.accepted).toBe(accepted);
      expect(h.installed.length).toBe(accepted ? 1 : 0);
      if (reason) expect(status.refused).toMatch(reason);
    }
  });

  test("every failure is off, never a rejection", async () => {
    const cases: [() => Response | Promise<Response>, RegExp][] = [
      [async () => new Response("missing", { status: 404 }), /unavailable \(404\)/],
      [async () => { throw new TypeError("integrity mismatch"); }, /integrity mismatch/],
      [async () => new Response("not gzip"), /unavailable/],
    ];
    for (const [response, reason] of cases) {
      const h = host(response);
      const status = await bootEngineBodyReplay(Promise.resolve(), pin, h);
      expect(status.accepted).toBe(false);
      expect(status.refused).toMatch(reason);
      expect(h.installed).toEqual([]);
    }
    const refused = host(() => gzipResponse("t"), { accepted: false, refused: "source epoch differs" });
    expect(await bootEngineBodyReplay(Promise.reject(new Error("main failed")), pin, refused))
      .toMatchObject({ accepted: false, refused: "source epoch differs" });
    const throwing = { ...host(() => gzipResponse("t")), installer: async () => { throw new Error("no engine"); } };
    expect((await bootEngineBodyReplay(Promise.resolve(), pin, throwing)).refused).toMatch(/no engine/);
  });

  test("a refused download falls back immediately without waiting on dev admission", async () => {
    const h = host(() => new Response("missing", { status: 404 }));
    const status = await bootEngineBodyReplay(Promise.resolve(), { ...pin, statusUrl: "/__fenel/engine-body-replay-status" }, h);
    expect(status).toMatchObject({ accepted: false, refused: "artifact unavailable (404)" });
    expect(h.fetched).toHaveLength(1);
    expect(h.installed).toEqual([]);
  });
});


/** Control native fetch deadlines without waiting for wall-clock minutes. */
function fakeDeadlines() {
  let now = 0;
  const timers: { at: number; controller: AbortController; delay: number }[] = [];
  const timeout = spyOn(AbortSignal, "timeout").mockImplementation(delay => {
    const controller = new AbortController();
    timers.push({ at: now + delay, controller, delay });
    return controller.signal;
  });
  return {
    timers, now: () => now,
    advance(ms: number) {
      now += ms;
      for (const timer of timers) if (timer.at <= now && !timer.controller.signal.aborted)
        timer.controller.abort(new DOMException("The operation timed out", "TimeoutError"));
    },
    restore: () => timeout.mockRestore(),
  };
}

function abortedFetch(signal: AbortSignal): Promise<Response> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

describe("separate artifact and dev-status deadlines", () => {
  const devPin = { ...pin, statusUrl: "/__fenel/engine-body-replay-status" };
  test("a post-load source check may exceed the gzip budget but cannot install before its verdict", async () => {
    const clock = fakeDeadlines();
    try {
      let loaded!: () => void, answer!: (response: Response) => void, requested!: () => void;
      const realWorker = new Promise<void>(resolve => { loaded = resolve; });
      const statusStarted = new Promise<void>(resolve => { requested = resolve; });
      const statusResponse = new Promise<Response>(resolve => { answer = resolve; });
      const order: string[] = [];
      const h = host(() => gzipResponse("checked artifact"));
      const dev = { ...h, now: clock.now, fetch: async (input: URL, init: RequestInit) => {
        if (!input.pathname.endsWith("-status")) { order.push("artifact"); return h.fetch(input, init); }
        order.push("status"); requested();
        return Promise.race([statusResponse, abortedFetch(init.signal!)]);
      } };
      const booting = bootEngineBodyReplay(realWorker, devPin, dev);
      expect(order).toEqual(["artifact"]);
      expect(clock.timers.map(timer => timer.delay)).toEqual([20_000]);
      expect(h.installed).toEqual([]);
      loaded();
      await statusStarted;
      expect(order).toEqual(["artifact", "status"]);
      expect(clock.timers.map(timer => timer.delay)).toEqual([20_000, 60_000]);
      clock.advance(30_000);
      expect(clock.timers[1]!.controller.signal.aborted).toBe(false);
      expect(h.installed).toEqual([]);
      answer(Response.json({ on: true, sourceEpoch: pin.sourceEpoch }));
      expect((await booting).accepted).toBe(true);
      expect(h.installed).toHaveLength(1);
      expect(order).toEqual(["artifact", "status"]);
    } finally { clock.restore(); }
  });

  test("an unanswered post-load status refuses at 60 seconds without installing or retrying", async () => {
    const clock = fakeDeadlines();
    try {
      let requested!: () => void;
      const statusStarted = new Promise<void>(resolve => { requested = resolve; });
      const order: string[] = [];
      const h = host(() => gzipResponse("t"));
      const dev = { ...h, now: clock.now, fetch: async (input: URL, init: RequestInit) => {
        if (!input.pathname.endsWith("-status")) { order.push("artifact"); return h.fetch(input, init); }
        order.push("status"); requested(); return abortedFetch(init.signal!);
      } };
      const booting = bootEngineBodyReplay(Promise.resolve(), devPin, dev);
      await statusStarted;
      const statusTimer = clock.timers.find(timer => timer.delay === 60_000)!;
      clock.advance(59_999);
      expect(statusTimer.controller.signal.aborted).toBe(false);
      expect(h.installed).toEqual([]);
      clock.advance(1);
      const status = await booting;
      expect(status.accepted).toBe(false);
      expect(status.refused).toMatch(/dev server: artifact unavailable .*timed out/);
      expect(h.installed).toEqual([]);
      expect(order).toEqual(["artifact", "status"]);
    } finally { clock.restore(); }
  });

  test("an unanswered gzip download still refuses at 20 seconds and never asks for status", async () => {
    const clock = fakeDeadlines();
    try {
      const h = host(() => gzipResponse("unused"));
      let requests = 0;
      const dev = { ...h, now: clock.now, fetch: async (_input: URL, init: RequestInit) => {
        requests++; return abortedFetch(init.signal!);
      } };
      const booting = bootEngineBodyReplay(Promise.resolve(), devPin, dev);
      clock.advance(19_999);
      expect(clock.timers[0]!.controller.signal.aborted).toBe(false);
      clock.advance(1);
      const status = await booting;
      expect(status.accepted).toBe(false);
      expect(status.refused).toMatch(/artifact unavailable .*timed out/);
      expect(requests).toBe(1);
      expect(h.installed).toEqual([]);
    } finally { clock.restore(); }
  });

  test("HTTP, malformed response and transport failures still refuse without installation", async () => {
    for (const statusResponse of [
      () => new Response("unavailable", { status: 503 }),
      () => new Response("not JSON"),
      () => { throw new TypeError("status transport failed"); },
    ]) {
      const h = host(() => gzipResponse("t"));
      let requests = 0;
      const dev = { ...h, fetch: async (input: URL, init: RequestInit) => {
        requests++;
        return input.pathname.endsWith("-status") ? statusResponse() : h.fetch(input, init);
      } };
      expect((await bootEngineBodyReplay(Promise.resolve(), devPin, dev)).accepted).toBe(false);
      expect(h.installed).toEqual([]);
      expect(requests).toBe(2);
    }
  });
});

// 1c (2026-11-01, fix round): the gzip bytes' digest replaces the runtime text
// digest. The boot reads the bytes once, decompresses THOSE bytes and hands
// both to the engine under the explicit bytes-digest pin; here the installer
// is the engine's real pinned admission (no registry), hashing with this
// realm's WebCrypto, and every case makes exactly one fetch.
describe("browser pin by bytes digest", () => {
  const live = { harnessCertificate: () => "C", hookGeneration: () => 4 };
  const artifact = replayArtifactText({ sourceEpoch: pin.sourceEpoch, harnessCertificate: "C", hookGeneration: 4 },
    [{ keyDigest: "k".repeat(64), fnId: "engine:fixture", value: { answer: 42 } }]);
  const body = new Uint8Array(gzipSync(Buffer.from(artifact, "utf8")));
  const digest = createHash("sha256").update(body).digest("hex");
  const realPin = Object.freeze({ ...pin, artifactSha256: digest, textDigest: sha256OfEncoding(artifact) });
  function engineHost(served: Uint8Array<ArrayBuffer>) {
    const base = host(() => new Response(served));
    return { ...base, platformSha256: crypto.subtle,
      installer: async () => async (text: string, given: ReplayArtifactPin, platform?: PlatformSha256) => {
        base.installed.push({ text, pin: given });
        const opened = await openPinnedReplayArtifactTextAsync(text, given, live, platform);
        return "refused" in opened ? { accepted: false, refused: opened.refused } : { accepted: true };
      } };
  }

  test("a correct artifact installs on its bytes digest, without computing the text digest, with one fetch", async () => {
    const before = __replayPinDigestsForTests();
    const h = engineHost(body);
    // A wrong textDigest: only a skipped text digest can accept it.
    const status = await bootEngineBodyReplay(Promise.resolve(), { ...realPin, textDigest: "0".repeat(64) }, h);
    expect(status).toMatchObject({ accepted: true, pinKind: "bytes-digest" });
    const after = __replayPinDigestsForTests();
    expect({ text: after.text - before.text, bytes: after.bytes - before.bytes }).toEqual({ text: 0, bytes: 1 });
    expect((h.installed[0]!.pin as { bytes: Uint8Array }).bytes).toEqual(body);
    expect(h.installed[0]!.text).toBe(artifact);
    expect(h.fetched).toHaveLength(1);
  });

  test("a tampered byte fails the bytes digest even when the text decompresses unchanged", async () => {
    const tampered = new Uint8Array(body);
    tampered[4] = tampered[4]! ^ 1; // gzip MTIME: outside the member CRC, so the text is the same
    const h = engineHost(tampered);
    const status = await bootEngineBodyReplay(Promise.resolve(), realPin, h);
    expect(h.installed[0]!.text).toBe(artifact);
    expect(status).toMatchObject({ accepted: false, refused: "artifact bytes differ from their pin", pinKind: "bytes-digest" });
    expect(h.fetched).toHaveLength(1);
  });

  test("a malformed artifact digest gets the text-digest pin, checked as before", async () => {
    for (const artifactSha256 of ["", "abc", "zz".repeat(32), digest.toUpperCase(), digest.slice(2)]) {
      for (const [textDigest, accepted] of [[realPin.textDigest, true], ["0".repeat(64), false]] as const) {
        const h = engineHost(body);
        const status = await bootEngineBodyReplay(Promise.resolve(), { ...realPin, artifactSha256, textDigest }, h);
        expect({ artifactSha256, textDigest, accepted: status.accepted, pinKind: status.pinKind })
          .toEqual({ artifactSha256, textDigest, accepted, pinKind: "text-digest" });
        expect(h.installed[0]!.pin).toEqual({ textDigest, sourceEpoch: realPin.sourceEpoch });
        expect(h.fetched).toHaveLength(1);
      }
    }
  });
});
