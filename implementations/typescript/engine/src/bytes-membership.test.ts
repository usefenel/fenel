import { beforeAll, describe, expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { isBytesNative } from "../../../../fenel/modules/std/ffi/bytes-ffi";
import type { ModuleRegistry } from "./registry";
import type { contains as Contains } from "./set-algebra";

describe("host byte storage", () => {
  test("recognizes actual unsigned byte storage, including empty, subclass and foreign views", () => {
    class ByteView extends Uint8Array {}
    for (const value of [new Uint8Array(0), Uint8Array.of(0, 255), new ByteView([1]),
      Buffer.from([2]), runInNewContext("new Uint8Array([3])")]) {
      expect(isBytesNative(value)).toBe(true);
    }
  });

  test("rejects other carriers and prototype or tag imitations", () => {
    const signed = new Int8Array([1]);
    Object.setPrototypeOf(signed, Uint8Array.prototype);
    for (const value of [null, undefined, 1, "bytes", [0, 255], {}, new ArrayBuffer(2),
      new DataView(new ArrayBuffer(2)), new Int8Array(2), new Uint8ClampedArray(2),
      new Uint16Array(2), signed, Object.create(Uint8Array.prototype),
      { [Symbol.toStringTag]: "Uint8Array" }]) {
      expect(isBytesNative(value)).toBe(false);
    }
  });

  test("does not invoke candidate accessors or proxy traps", () => {
    const value = Uint8Array.of(0, 255);
    let reads = 0;
    const fail = () => { reads += 1; throw new Error("candidate property read"); };
    for (const key of ["length", "buffer", Symbol.iterator, Symbol.toStringTag]) {
      Object.defineProperty(value, key, { get: fail });
    }
    expect(isBytesNative(value)).toBe(true);
    expect(isBytesNative(new Proxy(value, { get: fail, getPrototypeOf: fail }))).toBe(false);
    const revoked = Proxy.revocable(value, {});
    revoked.revoke();
    expect(isBytesNative(revoked.proxy)).toBe(false);
    expect(reads).toBe(0);
  });

  test("rejects detached byte storage", () => {
    const value = new Uint8Array([1]);
    structuredClone(value.buffer, { transfer: [value.buffer] });
    expect(isBytesNative(value)).toBe(false);
  });
});

describe("registered Bytes membership", () => {
  let registry: ModuleRegistry;
  let contains: typeof Contains;
  beforeAll(async () => {
    const system = await import("./system-registry");
    registry = system.getSystemRegistry();
    contains = (await import("./set-algebra")).contains;
  }, 900_000);

  test("registers a pure Byte refinement and a distinct opaque Bytes owner", () => {
    expect(registry.getEntity("Byte")?.type).toMatchObject({ $refined: { base: { $ref: "Nat" } } });
    expect(registry.getEntity("Bytes")?.type).toMatchObject({ $opaque: { name: "Bytes" } });
    const byte = registry.callSiteTyping.resolveType({ $ref: "Byte" }, "codec:base64Decode");
    expect(byte.ok).toBe(true);
    if (!byte.ok) throw new Error(byte.message);
    for (const [value, answer] of [[0, "yes"], [255, "yes"], [-1, "no"], [256, "no"],
      [1.5, "no"], ["1", "no"]] as const) {
      expect(registry.callSiteTyping.member(byte.type, value, null)).toBe(answer);
    }
  }, 180_000);

  test("the named membership judgment and the resolved call-site type agree on host carriers", () => {
    const bytes = registry.callSiteTyping.resolveType({ $ref: "Bytes" }, "codec:base64Decode");
    expect(bytes.ok).toBe(true);
    if (!bytes.ok) throw new Error(bytes.message);
    const rows: [unknown, boolean][] = [
      [new Uint8Array(0), true], [Uint8Array.of(0, 255), true],
      [[0, 255], false], [new Int8Array(2), false], [new Uint8ClampedArray(2), false],
      [Object.create(Uint8Array.prototype), false], ["bytes", false],
    ];
    for (const [value, member] of rows) {
      // This test has no request authority: explicit global-only membership.
      expect(contains({ $tag: "SeRef", handle: "Bytes" }, value, null))
        .toEqual({ $tag: "Just", _0: member });
      expect(registry.callSiteTyping.member(bytes.type, value, null)).toBe(member ? "yes" : "no");
    }
  }, 180_000);
});
