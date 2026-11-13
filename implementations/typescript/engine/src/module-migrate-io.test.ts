// ---------------------------------------------------------------------------
// module-migrate-io.test.ts — typed-function-references FenelModule-retirement
// Phase FM-retire-1 parity proof (the warm-up port).
//
// `io` moved off its ~164-LOC TS `defineFunction` spec wrapper onto
// `fenel/modules/io/io.fenel` (`module io where` + 8 bodyless `@native` foreign
// decls) + a thin `loadFenelModule` seam — the `control` precedent (plain
// bodyless-native module: NO ffi/ leaf, NO nativeImpls, NO entities).
//
// This file LOCKS the migrated roster byte-identically to the retired spec:
// ids, codeNames (incl. the `randomHex` / `envGet` divergences), bodyless-ness,
// the `io.random_hex` / `io.env_get` IOInvokable links, label/description/tags,
// the DROPPED stored Categorizable (3j read-time), and the dynamic-shape `{}`
// placeholders HELD honestly (NOT faked — `read` / `http_request` / `emit` /
// `call_function` stay empty-record, flagged in TODO.md for a type-modeling
// pass). The control-style inline pin (vs an oracle JSON) matches io's scale.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { ioModule } from "./modules/io";
import { stdModule } from "./modules/std";
import { createRegistry } from "./registry";
import { Maybe } from "./type-foundation";
import type { Instance } from "./types";

const FN_IDS = [
  "io:read",
  "io:sleep",
  "io:end_function",
  "io:emit",
  "io:call_function",
  "io:http_request",
  "io:random_hex",
  "io:env_get",
];

// The retired defineFunction identity, preserved byte-identically.
const RICH: Record<string, { codeName: string; label: string; description: string; tags: string[]; ioAction?: string }> = {
  "io:read": {
    codeName: "read",
    label: "Read",
    description: "Universal input. Suspends until typed data arrives from source. Widget derived from schema, channel from source.",
    tags: ["primitive", "input", "suspend"],
  },
  "io:sleep": {
    codeName: "sleep",
    label: "Sleep",
    description: "Pure timer delay. Suspends for duration, produces no value.",
    tags: ["primitive", "time", "suspend"],
  },
  "io:end_function": {
    codeName: "end_function",
    label: "End Function",
    description: "Terminate the current function instance immediately.",
    tags: ["primitive", "control"],
  },
  "io:emit": {
    codeName: "emit",
    label: "Emit Event",
    description: "Fire a typed event into the event log. Triggers other functions.",
    tags: ["primitive", "event"],
  },
  "io:call_function": {
    codeName: "call_function",
    label: "Call Sub-function",
    description: "Start a child function instance and wait for it to complete. Prefer calling functions directly by name.",
    tags: ["primitive", "composition", "deprecated"],
  },
  "io:http_request": {
    codeName: "http_request",
    label: "HTTP Request",
    description: "Make an HTTP request. The irreducible IO primitive for external APIs.",
    tags: ["primitive", "http"],
  },
  "io:random_hex": {
    codeName: "randomHex",
    label: "Random hex bytes",
    description: "Generate a hex-encoded random string of `length` bytes (output is `2*length` hex chars). Used for webhook secrets and similar one-shot tokens.",
    tags: ["primitive", "crypto", "random"],
    ioAction: "io.random_hex",
  },
  "io:env_get": {
    codeName: "envGet",
    label: "Read env var",
    description: "Read an environment variable. Returns Just<value> when set, Nothing when unset. Used by orchestration to pick up runtime config like WEBHOOK_BASE_URL.",
    tags: ["primitive", "env"],
    ioAction: "io.env_get",
  },
};

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

const hasNoDefault = (d: unknown): boolean =>
  d == null || (d as { $tag?: string }).$tag === "Nothing";

// `{$ref:X}` ≡ `{$ref:X}` (7g coexistence) — the retired TS spec used `$ref`.
const norm = (t: unknown): unknown => {
  if (Array.isArray(t)) return t.map(norm);
  if (t && typeof t === "object") {
    const o = t as Record<string, unknown>;
    if ("$ref" in o && typeof o.$ref === "string") return { $ref: o.$ref };
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) out[k] = norm(o[k]);
    return out;
  }
  return t;
};

const byId = new Map((ioModule.functions ?? []).map((f) => [f.id, f]));
const insts = ioModule.instances ?? [];

describe("io migration — header-driven identity + roster", () => {
  test("the `module io where` header is authoritative (lowercase prefix preserved)", () => {
    expect(ioModule.name).toBe("io");
  });

  test("all 8 functions registered under the legacy `io:` id-prefix", () => {
    expect((ioModule.functions ?? []).map((f) => f.id).sort()).toEqual([...FN_IDS].sort());
  });

  test("codeName byte-identical (incl. randomHex / envGet divergences)", () => {
    for (const id of FN_IDS) {
      expect(methodOf(insts, "Codeable", id)).toEqual({ codeName: RICH[id]!.codeName });
    }
  });

  test("every fn resolves by id + codeName through createRegistry", () => {
    const reg = createRegistry([stdModule, ioModule]);
    for (const id of FN_IDS) {
      expect(reg.getFunction(id)?.id).toBe(id);
      expect(reg.getFunctionByCodeName(RICH[id]!.codeName)?.id).toBe(id);
    }
  });
});

describe("io migration — all 8 bodyless @native, no ffi leaf", () => {
  test("no function carries a body (evaluator-backed runtime primitives)", () => {
    for (const f of ioModule.functions ?? []) expect(f.body).toBeUndefined();
  });

  test("NO nativeImpls / nativeImplsCtx / ioHandlers / entities (handler-backed)", () => {
    expect(ioModule.nativeImpls).toBeUndefined();
    expect(ioModule.nativeImplsCtx).toBeUndefined();
    expect(ioModule.ioHandlers).toBeUndefined();
    expect((ioModule.entities ?? []).length).toBe(0);
  });
});

describe("io migration — facet parity + the IOInvokable links", () => {
  test("Labelable + Describable + Taggable byte-identical for every fn", () => {
    for (const id of FN_IDS) {
      expect(methodOf(insts, "Labelable", id)).toEqual({ label: RICH[id]!.label });
      expect(methodOf(insts, "Describable", id)).toEqual({ description: RICH[id]!.description });
      expect(methodOf(insts, "Taggable", id)).toEqual({ tags: RICH[id]!.tags });
    }
  });

  // Phase 3j: io declares no @category → the `io` category derives at read time.
  test("NO stored Categorizable on any fn", () => {
    for (const id of FN_IDS) expect(methodOf(insts, "Categorizable", id)).toBeUndefined();
  });

  test("IOInvokable ONLY on random_hex (io.random_hex) + env_get (io.env_get)", () => {
    for (const id of FN_IDS) {
      const expected = RICH[id]!.ioAction;
      if (expected !== undefined) {
        expect(methodOf(insts, "IOInvokable", id)).toEqual({ ioAction: expected });
      } else {
        expect(methodOf(insts, "IOInvokable", id)).toBeUndefined();
      }
    }
  });
});

describe("io migration — defaults drop + signatures (held placeholders honest)", () => {
  test("NO param default survives on ANY function", () => {
    for (const f of ioModule.functions ?? []) {
      for (const p of f.params ?? []) expect(hasNoDefault((p as Record<string, unknown>).default)).toBe(true);
    }
  });

  test("the dynamic-shape `{}` placeholders are HELD (read / call_function / http_request), NOT faked", () => {
    const empty = { $record: { fields: [] } };
    // read: schema TYPE param + return are dependent/dynamic → held.
    const read = byId.get("io:read")!;
    expect(read.params.find((p) => p.name === "schema")!.type).toEqual(empty);
    expect(read.returns).toEqual(empty);
    // call_function + http_request returns are dynamic → held.
    expect(byId.get("io:call_function")!.returns).toEqual(empty);
    expect(byId.get("io:http_request")!.returns).toEqual(empty);
    // emit / call_function `Maybe ({})` payloads stay empty-record inside Just.
    expect(byId.get("io:emit")!.params.find((p) => p.name === "payload")!.type).toEqual(Maybe(empty));
  });

  test("the typed leaves round-trip (env_get -> Maybe String, random_hex Int -> String)", () => {
    expect(norm(byId.get("io:env_get")!.returns)).toEqual(norm(Maybe({ $ref: "String" })) as never);
    expect(norm(byId.get("io:random_hex")!.params[0]!.type)).toEqual({ $ref: "Int" });
    expect(norm(byId.get("io:random_hex")!.returns)).toEqual({ $ref: "String" });
    expect(norm(byId.get("io:sleep")!.returns)).toEqual({ $ref: "Boolean" });
  });
});
