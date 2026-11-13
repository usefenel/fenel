import { describe, expect, test } from "bun:test";

import type { TypeScheme } from "../src/types";
import {
  assertFlagFreeMode,
  compareCodeUnits,
  containsSolverMeta,
  fenelEnvironmentOverrides,
  unboundSchemeApplicationHeads,
} from "./signature-phase-2-census";

const KTYPE = { $tag: "KType" } as const;

describe("signature Phase 2 census helpers", () => {
  test("rejects every ambient FENEL_* override before imports", () => {
    expect(() => assertFlagFreeMode({})).not.toThrow();
    expect(() => assertFlagFreeMode({ NODE_ENV: "test" })).not.toThrow();
    expect(() => assertFlagFreeMode({ FENEL_SIMULATE_BROWSER: "1" })).toThrow(
      "unset FENEL_SIMULATE_BROWSER",
    );
    expect(() => assertFlagFreeMode({ FENEL_FUTURE_RECOVERY_MODE: "0" })).toThrow(
      "unset FENEL_FUTURE_RECOVERY_MODE",
    );
    expect(fenelEnvironmentOverrides({
      FENEL_Z: "1",
      FENEL_A: "1",
      FENEL_UNSET: undefined,
      OTHER: "1",
    })).toEqual(["FENEL_A", "FENEL_Z"]);
  });

  test("orders report keys by UTF-16 code units rather than the host locale", () => {
    const input = ["z", "ä", "a", "A", "aa", "á"];
    expect([...input].sort(compareCodeUnits)).toEqual(["A", "a", "aa", "z", "á", "ä"]);
  });

  test("finds fresh metas in every own data-string, including application heads", () => {
    expect(containsSolverMeta({ applications: [{ headVarId: "?m:application/0" }] })).toBe(true);
    expect(containsSolverMeta({ nested: [{ arbitraryPayload: "?m:payload/0" }] })).toBe(true);
    expect(containsSolverMeta({ $tag: "ItMeta", id: "ordinary" })).toBe(true);
    // The REAL solver shape (inference.fenel): plain-record `tag` spelling and
    // `<path>#m<N>` ids — the shapes the original detector missed.
    expect(containsSolverMeta({ tag: "ItMeta", id: "engine:foo#m0", kind: { tag: "KType" } })).toBe(true);
    expect(containsSolverMeta({ nested: [{ id: "engine:inferTopLevelSignatures#m12" }] })).toBe(true);
    expect(containsSolverMeta({ headVarId: "q0", $var: "a" })).toBe(false);
    // A `#m` substring that is not a meta id suffix must not false-positive.
    expect(containsSolverMeta({ note: "see #main section" })).toBe(false);
  });

  test("walks cycles without invoking accessors", () => {
    let accessorReads = 0;
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    Object.defineProperty(cyclic, "hostile", {
      enumerable: true,
      get() {
        accessorReads += 1;
        return "?m:getter";
      },
    });

    expect(containsSolverMeta(cyclic)).toBe(false);
    expect(accessorReads).toBe(0);
    cyclic.data = { value: "?m:data" };
    expect(containsSolverMeta(cyclic)).toBe(true);
    expect(accessorReads).toBe(0);
  });

  test("requires every authoritative application headVarId to bind a quantified id", () => {
    const scheme: TypeScheme = {
      quantified: [{ id: "q0", sourceName: "f", kind: KTYPE }],
      body: { $el: { call: ["f", { $ref: "String" }] } },
      applications: [
        {
          path: ["$el"],
          headVarId: "q0",
          args: [{ $ref: "String" }],
          kind: KTYPE,
        },
        {
          path: ["$el", "nested"],
          headVarId: "q404",
          args: [],
          kind: KTYPE,
        },
      ],
    };

    expect(unboundSchemeApplicationHeads(scheme)).toEqual([
      {
        spelling: "q404",
        path: ["applications", "1", "$el", "nested"],
      },
    ]);
  });
});
