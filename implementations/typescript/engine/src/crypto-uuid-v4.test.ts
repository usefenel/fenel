// ---------------------------------------------------------------------------
// crypto-uuid-v4.test.ts — storage-as-effect Phase 1 oracle.
//
// `crypto:uuidV4` is the Fenel-bodied v4-UUID mint (fenel/modules/crypto/
// types.fenel) that replaces Postgres `gen_random_uuid()` for entity identity.
// It composes the EXISTING `crypto:randomTokenHex` sync native (32 hex chars)
// with the v4 version (char 14 == '4') + variant (char 19 in {8,9,a,b}) bit-
// fields. This runs the body IN-PROCESS via invokeCallable against a registry
// built from [std, crypto] and asserts the structural RFC-4122 v4 invariants +
// freshness (two calls differ).
//
// The registry is built in `beforeAll` via DYNAMIC imports: statically importing
// `cryptoModule` at module-eval time alongside `createRegistry` trips a
// type-catalog circular-init TDZ (`_extraEntities` before initialization — crypto
// is the first createRegistry consumer to pull that cycle); deferring the
// cryptoModule import past this file's static init resolves the order.
// ---------------------------------------------------------------------------

import { test, expect, describe, beforeAll } from "bun:test";
import { createRegistry } from "./registry";
import { invokeCallable } from "./json-logic";

let reg: ReturnType<typeof createRegistry>;
let uuid: () => string;

beforeAll(async () => {
  const { stdModule } = await import("./modules/std");
  const { cryptoModule } = await import("./modules/crypto");
  reg = createRegistry([stdModule, cryptoModule]);
  const ctx = reg.evaluateContext();
  uuid = () => invokeCallable("crypto:uuidV4", [{}], ctx) as string;
});

describe("storage-as-effect Phase 1 — crypto:uuidV4 is .fenel-bodied and registered", () => {
  test("registered with a Fenel body (no native shadow)", () => {
    const fn = reg.getFunction("crypto:uuidV4");
    expect(fn?.id).toBe("crypto:uuidV4");
    expect(fn?.body).toBeDefined();
    expect(reg.getFunctionByCodeName("uuidV4")?.id).toBe("crypto:uuidV4");
  });
});

describe("storage-as-effect Phase 1 — crypto:uuidV4 mints a valid v4", () => {
  test("36 chars with dashes at 8/13/18/23", () => {
    const u = uuid();
    expect(u.length).toBe(36);
    expect(u[8]).toBe("-");
    expect(u[13]).toBe("-");
    expect(u[18]).toBe("-");
    expect(u[23]).toBe("-");
  });

  test("version nibble is '4' (index 14)", () => {
    expect(uuid()[14]).toBe("4");
  });

  test("variant nibble is one of 8/9/a/b (index 19)", () => {
    for (let i = 0; i < 64; i++) {
      expect(["8", "9", "a", "b"]).toContain(uuid().charAt(19));
    }
  });

  test("matches the canonical v4 regex", () => {
    const v4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    for (let i = 0; i < 64; i++) {
      expect(uuid()).toMatch(v4);
    }
  });

  test("two calls differ (fresh randomness)", () => {
    expect(uuid()).not.toBe(uuid());
  });
});
