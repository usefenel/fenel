// ---------------------------------------------------------------------------
// module-migrate-crypto.test.ts — typed-function-references FenelModule-
// retirement Phase FM-retire-8 Step 2 parity proof.
//
// The 7 `crypto:*` fns spun out of state.ts to their own `crypto` module
// (engine/src/modules/crypto.ts over `module crypto where` types.fenel + a
// per-module ffi/ leaf for the 3 sync host-crypto natives). Importing
// `cryptoModule` runs the loader at module-eval time, so a parse error in the
// `.fenel` fails this file.
//
// Pins the substrate outcome: the 7 fns register under the `crypto:` id-prefix
// (byte-identical to the retired spec ids → the api-route + core/auth consumers
// need 0 edits); all 7 are bodyless `@native`; the 4 IO-backed carry `@ioAction
// "crypto.*"` + `@requires "HasStateIO"`; the 3 sync natives carry neither and
// resolve through the module's `nativeImplsCtx`; codeName parity incl. the
// divergent scryptHash / scryptVerify; `@category` OMITTED (category "crypto" ===
// the id prefix → Phase-3j read-time, so NO stored Categorizable).
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { cryptoModule } from "./modules/crypto";
import type { Instance } from "./types";

const IO_BACKED = [
  "crypto:sha256Hex",
  "crypto:verifyCalendlySignature",
  "crypto:verifyTelegramSecret",
  "crypto:verifyStripeSignature",
];
const SYNC_NATIVES = ["crypto:randomTokenHex", "crypto:hashPassword", "crypto:verifyPassword"];
const ALL = [...IO_BACKED, ...SYNC_NATIVES];
// storage-as-effect Phase 1 (2026-06-19) — the v4-UUID mint + its variant-nibble
// helper are PURE `.fenel` BODIES (compose crypto:randomTokenHex; no @ioAction,
// no @requires). The Fenel-bodied entity-identity mint that replaces Postgres
// gen_random_uuid() for state:create*.
const PURE_BODIES = ["crypto:uuidV4", "crypto:uuidVariantNibble"];
const WITH_FACETS = [...ALL, ...PURE_BODIES];
const STATE_IO = [
  { class: { $tag: "Id", entityId: "HasStateIO" }, args: [{ $var: "scope" }] },
];
const CODENAMES: Record<string, string> = {
  "crypto:sha256Hex": "sha256Hex",
  "crypto:verifyCalendlySignature": "verifyCalendlySignature",
  "crypto:verifyTelegramSecret": "verifyTelegramSecret",
  "crypto:verifyStripeSignature": "verifyStripeSignature",
  "crypto:randomTokenHex": "randomTokenHex",
  "crypto:hashPassword": "scryptHash",
  "crypto:verifyPassword": "scryptVerify",
  "crypto:uuidV4": "uuidV4",
  "crypto:uuidVariantNibble": "uuidVariantNibble",
};

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

const fns = cryptoModule.functions ?? [];
const insts = cryptoModule.instances ?? [];

describe("crypto migration — header-driven identity + roster", () => {
  test("the `module crypto where` header is authoritative (module name = `crypto`)", () => {
    expect(cryptoModule.name).toBe("crypto");
  });

  test("the 7 leaves + 2 storage-as-effect uuid bodies register under the `crypto:` id-prefix", () => {
    expect(fns.map((f) => f.id).sort()).toEqual([...WITH_FACETS].sort());
  });

  test("the module declares no entities (types.fenel is decls-only)", () => {
    expect((cryptoModule.entities ?? []).length).toBe(0);
  });

  test("the ONLY body-bearing fns are the 2 storage-as-effect uuid bodies (the 7 leaves stay `@native` bodyless)", () => {
    expect(fns.filter((f) => (f as { body?: unknown }).body !== undefined).map((f) => f.id).sort())
      .toEqual([...PURE_BODIES].sort());
  });
});

describe("crypto migration — IO-backed vs sync-native split", () => {
  test("the 4 IO-backed fns carry `@ioAction \"crypto.*\"` + `@requires \"HasStateIO\"`", () => {
    for (const id of IO_BACKED) {
      const io = methodOf(insts, "IOInvokable", id) as { ioAction?: string } | undefined;
      expect(typeof io?.ioAction).toBe("string");
      expect(io?.ioAction?.startsWith("crypto.")).toBe(true);
      expect((fns.find((f) => f.id === id) as { requires?: unknown }).requires).toEqual(STATE_IO as never);
    }
  });

  test("the 3 sync natives carry NO ioAction + NO requires", () => {
    for (const id of SYNC_NATIVES) {
      expect(methodOf(insts, "IOInvokable", id)).toBeUndefined();
      const req = (fns.find((f) => f.id === id) as { requires?: unknown[] }).requires;
      expect(req === undefined || req.length === 0).toBe(true);
    }
  });

  test("the 3 sync natives are registered in nativeImplsCtx (crypto:* keys)", () => {
    const ctx = cryptoModule.nativeImplsCtx ?? {};
    for (const id of SYNC_NATIVES) {
      expect(typeof ctx[id]).toBe("function");
    }
    // the 4 IO-backed fns must NOT have a ctx native (they resolve via the
    // runtime registerCryptoHandlers)
    for (const id of IO_BACKED) {
      expect(ctx[id]).toBeUndefined();
    }
  });
});

describe("crypto migration — facet parity", () => {
  test("Codeable codeName parity (incl. the divergent scryptHash / scryptVerify + the uuid bodies)", () => {
    for (const id of WITH_FACETS) {
      expect(methodOf(insts, "Codeable", id)).toEqual({ codeName: CODENAMES[id] });
    }
  });

  test("every fn carries Labelable + Describable + Taggable identity", () => {
    for (const id of WITH_FACETS) {
      expect(methodOf(insts, "Labelable", id)).toBeDefined();
      expect(methodOf(insts, "Describable", id)).toBeDefined();
      expect(methodOf(insts, "Taggable", id)).toBeDefined();
    }
  });

  test("NO stored Categorizable on any crypto fn (3j read-time: category === the `crypto:` id prefix)", () => {
    for (const id of WITH_FACETS) {
      expect(methodOf(insts, "Categorizable", id)).toBeUndefined();
    }
  });
});
