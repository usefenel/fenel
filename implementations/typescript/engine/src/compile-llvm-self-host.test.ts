// ---------------------------------------------------------------------------
// Self-hosting bootstrap (LLVM target) — Phases 18 + 19
//
// Sibling of `compile-js-self-host.test.ts` + `compile-wasm-self-host.test.ts`.
// Walks the engine's registry of Fenel-bodied functions; for each:
//   1. Compile-and-serialise to IR text. Failure → SKIP.
//   2. If `clang` available: compile to .so, dlopen, dispatch samples;
//      assert engine eval ≡ FFI execution.
//   3. If `clang` absent: still record OK (ir-shape gate).
//
// **Phase 5b30** — module-init + CLOSURE_RUNTIME_C + sharedLlvmHelpers +
// runOne + classifyFnId + compileSharedObject all live in the sibling
// `compile-llvm-self-host-classifier.ts` (tier-(12-tooling) substrate
// sub-phase). This file owns ONLY the bun:test integration: per-fnId
// `it` + bootstrap report + Phase 18/19/21 shape probes + clang-gated
// execution probes.
// ---------------------------------------------------------------------------

import { beforeAll, describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  compileFenelToLlvmNative,
  serializeLlvmModuleNative,
} from "./modules/compile-llvm";
import type { CompileSource } from "./compilable";
import { positionalCompileFieldSlots } from "./compile-field-slots";
import type { LlvmModule } from "./ir/llvm-ast";
import {
  candidateFns,
  classifyFnId,
  compileSharedObject,
  EXPECTED_GAPS,
  FN_SAMPLES,
  HAS_CLANG,
  prepareClassifier,
  runOne,
  SUBPROCESS_FNIDS,
  type Row,
} from "./compile-llvm-self-host-classifier";
const rows: Row[] = [];
const CLASSIFIER_TEST_TIMEOUT_MS = 1_800_000;

// A cold strict product registry can exceed ten minutes on the Windows gate
// machine. This is a correctness bootstrap, not a latency assertion.
beforeAll(() => prepareClassifier(), 1_800_000);

describe("Phase 18 — self-hosting bootstrap (LLVM target, std module)", () => {
  for (const fn of candidateFns) {
    // Cold semantic metadata and dependency-reachable LLVM helper compilation
    // are deliberately lazy. Any ordinary row can be the first to pay that
    // correctness bootstrap; subprocess rows additionally pay clang + dlopen.
    // Keep every classifier row on the same long non-latency budget as JS/Wasm.
    const runIt = async () => {
      const obs = await classifyFnId(fn.id);
      const gap = EXPECTED_GAPS[fn.id];
      let row: Row;
      if (gap !== undefined) {
        // LLVM clang-missing path returns OK with samples=0 — that's the
        // ir-shape-only success. A genuine gap-closed regression requires
        // samples > 0 (full FFI run passed).
        // Phase 5b39 — SUBPROCESS_FNIDS are dispatched to a child process
        // and exhibit a documented per-sample substrate flake (~7-20%);
        // their full-sequence OK status is non-deterministic so we don't
        // treat an OK observation as "gap closed" — the residual flake is
        // tracked in EXPECTED_GAPS itself.
        if (
          obs.status === "OK" &&
          obs.samplesCompared > 0 &&
          !SUBPROCESS_FNIDS.has(fn.id)
        ) {
          throw new Error(
            `${fn.id}: now self-hosts through LLVM — remove the EXPECTED_GAPS entry "${gap}" and re-run`,
          );
        }
        row = { status: "skip", fnId: fn.id, reason: `expected gap — ${gap}` };
      } else if (obs.status === "OK") {
        row = { status: "ok", fnId: fn.id, samples: obs.samplesCompared };
      } else if (obs.status === "NO_SAMPLES") {
        row = { status: "skip", fnId: fn.id, reason: "no samples declared" };
      } else if (obs.status === "SKIP") {
        row = { status: "skip", fnId: fn.id, reason: obs.reason };
      } else {
        row = { status: "fail", fnId: fn.id, reason: obs.reason };
      }
      rows.push(row);
      if (row.status === "fail") {
        throw new Error(`${fn.id}: ${row.reason}`);
      }
      expect(["ok", "skip"]).toContain(row.status);
    };
    it(fn.id, runIt, CLASSIFIER_TEST_TIMEOUT_MS);
  }

  it("bootstrap report — per-function status (LLVM)", () => {
    const ok = rows.filter((r) => r.status === "ok").length;
    const skipped = rows.filter((r) => r.status === "skip").length;
    const failed = rows.filter((r) => r.status === "fail").length;
    const lines: string[] = [];
    lines.push("");
    lines.push(`Self-hosting bootstrap (LLVM target, std module) — clang=${HAS_CLANG ? "available" : "absent (ir-shape only)"}:`);
    for (const r of rows) {
      if (r.status === "ok") {
        lines.push(
          `  ${r.fnId.padEnd(20)} OK    ${r.samples > 0 ? `${r.samples}/${r.samples} samples agree` : "(ir-shape only, clang absent)"}`,
        );
      } else if (r.status === "skip") {
        lines.push(`  ${r.fnId.padEnd(20)} SKIP  ${r.reason}`);
      } else {
        lines.push(`  ${r.fnId.padEnd(20)} FAIL  ${r.reason}`);
      }
    }
    lines.push(
      `Total: ${rows.length} candidates — ${ok} ${HAS_CLANG ? "self-hosted" : "ir-shaped"}, ${skipped} skipped, ${failed} failed`,
    );
    // eslint-disable-next-line no-console
    console.log(lines.join("\n"));
    expect(failed).toBe(0);
  });

  it("found ≥ 10 candidate Fenel-bodied functions in std", () => {
    expect(candidateFns.length).toBeGreaterThanOrEqual(10);
  });

  // FM-retire-9 Step 9b — std:add is now a bodyless `@native` leaf (see the JS
  // canary). Retargeted to std:lerp (still Fenel-bodied; OK on LLVM per matrix).
  it("std:lerp lowers through LLVM (canary)", async () => {
    const lerpFn = candidateFns.find((f) => f.id === "std:lerp");
    expect(lerpFn).toBeDefined();
    const row = await runOne(lerpFn!, FN_SAMPLES["std:lerp"]!);
    expect(row.status).toBe("ok");
  });

  // Phase 18 IR shape probe (no clang needed).
  it("Phase 18: std:. lowers through closure conversion + indirect call ABI", () => {
    const dotFn = candidateFns.find((f) => f.id === "std:.");
    expect(dotFn).toBeDefined();
    const compiled = compileFenelToLlvmNative({
      name: "dot",
      params: positionalCompileFieldSlots(dotFn!.params.map((p) => p.name)),
      body: dotFn!.body,
    });
    expect(compiled.$tag).toBe("Ok");
    if (compiled.$tag !== "Ok") return;
    const mod = compiled._0 as LlvmModule;
    expect(mod.definitions.length).toBe(2);
    const names = mod.definitions.map((d) => d.name).sort();
    expect(names).toEqual(["dot", "dot__cl0"]);
    const declNames = mod.declarations.map((d) => d.name);
    expect(declNames).toContain("fenel_env_alloc");
    expect(declNames).toContain("fenel_env_set");
    expect(declNames).toContain("fenel_env_get");
    expect(declNames).toContain("fenel_make_closure");
    expect(declNames).toContain("fenel_closure_fn");
    expect(declNames).toContain("fenel_closure_env");
    const ir = serializeLlvmModuleNative(mod);
    expect(ir.$tag).toBe("Ok");
    if (ir.$tag !== "Ok") return;
    expect(ir._0).toMatch(/call ptr %t\d+\(ptr %t\d+, ptr %x\)/);
  });

  // Phase 18 clang-gated execution probe.
  it.skipIf(!HAS_CLANG)("Phase 18: std:. executes end-to-end through LLVM closure ABI", async () => {
    const dotFn = candidateFns.find((f) => f.id === "std:.");
    expect(dotFn).toBeDefined();
    const source: CompileSource = {
      name: "dot",
      params: positionalCompileFieldSlots(dotFn!.params.map((p) => p.name)),
      body: dotFn!.body,
    };
    const compiled = compileFenelToLlvmNative(source);
    expect(compiled.$tag).toBe("Ok");
    if (compiled.$tag !== "Ok") return;
    const ir = serializeLlvmModuleNative(compiled._0);
    expect(ir.$tag).toBe("Ok");
    if (ir.$tag !== "Ok") return;
    const soPath = compileSharedObject("dot_phase18", ir._0);
    const ffi = await import("bun:ffi");
    const { dlopen, FFIType } = ffi as unknown as {
      dlopen: (path: string, spec: Record<string, { args: unknown[]; returns: unknown }>) => {
        symbols: Record<string, (...a: unknown[]) => unknown>;
        close: () => void;
      };
      FFIType: Record<string, unknown>;
    };
    const lib = dlopen(soPath, {
      dot: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
    });
    try {
      const dotFnSym = lib.symbols.dot as (a: unknown, b: unknown) => unknown;
      const result = dotFnSym(1, 2);
      expect(typeof result).toBe("number");
      expect(result).not.toBe(0);
    } finally {
      lib.close();
      try {
        fs.rmSync(path.dirname(soPath), { recursive: true, force: true });
      } catch {
        // Best-effort cleanup.
      }
    }
  });

  // Phase 19 ADT shape probe.
  it("Phase 19: ADT match shape probe (synthetic body, no std fn uses ADTs today)", () => {
    const source: CompileSource = {
      name: "unmaybe",
      params: positionalCompileFieldSlots(["x"]),
      body: {
        match: [
          { var: "x" },
          { $tag: "Just", _0: { var: "y" } },
          { var: "y" },
          { $tag: "Nothing" },
          0,
        ],
      },
    };
    const compiled = compileFenelToLlvmNative(source);
    expect(compiled.$tag).toBe("Ok");
    if (compiled.$tag !== "Ok") return;
    const mod = compiled._0 as LlvmModule;
    const declNames = mod.declarations.map((d) => d.name);
    expect(declNames).toContain("fenel_tag_eq");
    expect(declNames).toContain("fenel_get_field");
    expect(declNames).toContain("fenel_match_fail");
    const def = mod.definitions[0]!;
    const labels = def.blocks.map((bb) => bb.label);
    expect(labels.some((l) => l.includes("arm0.check"))).toBe(true);
    expect(labels.some((l) => l.includes("arm0.body"))).toBe(true);
    expect(labels.some((l) => l.includes("arm1.check"))).toBe(true);
    expect(labels.some((l) => l.includes("merge"))).toBe(true);
  });

  // Phase 19 clang-gated execution probe.
  it.skipIf(!HAS_CLANG)(
    "Phase 19: ADT match executes end-to-end through LLVM ABI",
    async () => {
      const source: CompileSource = {
        name: "unmaybe",
        params: positionalCompileFieldSlots(["x"]),
        body: {
          match: [
            { var: "x" },
            { $tag: "Just", _0: { var: "y" } },
            { var: "y" },
            { $tag: "Nothing" },
            0,
          ],
        },
      };
      const compiled = compileFenelToLlvmNative(source);
      expect(compiled.$tag).toBe("Ok");
      if (compiled.$tag !== "Ok") return;
      const ir = serializeLlvmModuleNative(compiled._0);
      expect(ir.$tag).toBe("Ok");
      if (ir.$tag !== "Ok") return;
      const soPath = compileSharedObject("unmaybe_phase19", ir._0);
      const ffi = await import("bun:ffi");
      const { dlopen, FFIType } = ffi as unknown as {
        dlopen: (path: string, spec: Record<string, { args: unknown[]; returns: unknown }>) => {
          symbols: Record<string, (...a: unknown[]) => unknown>;
          close: () => void;
        };
        FFIType: Record<string, unknown>;
      };
      const lib = dlopen(soPath, {
        unmaybe: { args: [FFIType.ptr], returns: FFIType.ptr },
        fenel_construct: { args: [FFIType.cstring, FFIType.i64, FFIType.i64], returns: FFIType.ptr },
        fenel_set_field: { args: [FFIType.ptr, FFIType.i64, FFIType.ptr], returns: FFIType.void },
        fenel_box_num: { args: [FFIType.f64], returns: FFIType.ptr },
        fenel_unbox_num: { args: [FFIType.ptr], returns: FFIType.f64 },
      });
      try {
        const construct = lib.symbols.fenel_construct as (
          tag: unknown,
          len: bigint,
          n: bigint,
        ) => unknown;
        const setField = lib.symbols.fenel_set_field as (
          v: unknown,
          i: bigint,
          val: unknown,
        ) => unknown;
        const boxNum = lib.symbols.fenel_box_num as (v: number) => unknown;
        const unmaybe = lib.symbols.unmaybe as (v: unknown) => unknown;
        const justTag = Buffer.from("Just\0");
        const nothingTag = Buffer.from("Nothing\0");
        const just42 = construct(justTag, 4n, 1n);
        setField(just42, 0n, boxNum(42));
        const nothing = construct(nothingTag, 7n, 0n);
        const just42Result = unmaybe(just42);
        const nothingResult = unmaybe(nothing);
        expect(typeof just42Result).toBe("number");
        expect(just42Result).not.toBe(0);
        expect(typeof nothingResult).toBe("number");
        expect(nothingResult).not.toBe(0);
      } finally {
        lib.close();
        try {
          fs.rmSync(path.dirname(soPath), { recursive: true, force: true });
        } catch {
          // Best-effort cleanup.
        }
      }
    },
  );

  // Phase 21.2.1 IR shape probe.
  it("Phase 21.2.1: dotted-ident CeVar lowers to fenel_get_field_named chain", () => {
    const source: CompileSource = {
      name: "fieldAccess",
      params: positionalCompileFieldSlots(["r"]),
      body: { var: "r.x.y" },
    };
    const compiled = compileFenelToLlvmNative(source);
    expect(compiled.$tag).toBe("Ok");
    if (compiled.$tag !== "Ok") return;
    const mod = compiled._0 as LlvmModule;
    const declNames = mod.declarations.map((d) => d.name);
    expect(declNames).toContain("fenel_get_field_named");
    const ir = serializeLlvmModuleNative(mod);
    expect(ir.$tag).toBe("Ok");
    if (ir.$tag !== "Ok") return;
    const matches = ir._0.match(/call ptr @fenel_get_field_named/g) ?? [];
    expect(matches.length).toBe(2);
  });

  // Phase 21.2.1 clang-gated execution probe.
  it.skipIf(!HAS_CLANG)(
    "Phase 21.2.1: dotted-ident CeVar executes end-to-end through LLVM ABI",
    async () => {
      const source: CompileSource = {
        name: "fieldAccess",
        params: positionalCompileFieldSlots(["r"]),
        body: { var: "r.x.y" },
      };
      const compiled = compileFenelToLlvmNative(source);
      expect(compiled.$tag).toBe("Ok");
      if (compiled.$tag !== "Ok") return;
      const ir = serializeLlvmModuleNative(compiled._0);
      expect(ir.$tag).toBe("Ok");
      if (ir.$tag !== "Ok") return;
      const soPath = compileSharedObject("fieldAccess_phase212", ir._0);
      const ffi = await import("bun:ffi");
      const { dlopen, FFIType } = ffi as unknown as {
        dlopen: (path: string, spec: Record<string, { args: unknown[]; returns: unknown }>) => {
          symbols: Record<string, (...a: unknown[]) => unknown>;
          close: () => void;
        };
        FFIType: Record<string, unknown>;
      };
      const lib = dlopen(soPath, {
        fieldAccess: { args: [FFIType.ptr], returns: FFIType.f64 },
        fenel_construct: {
          args: [FFIType.cstring, FFIType.i64, FFIType.i64],
          returns: FFIType.ptr,
        },
        fenel_set_field_named: {
          args: [FFIType.ptr, FFIType.i64, FFIType.cstring, FFIType.i64, FFIType.ptr],
          returns: FFIType.void,
        },
        fenel_box_num: { args: [FFIType.f64], returns: FFIType.ptr },
      });
      try {
        const construct = lib.symbols.fenel_construct as (
          tag: unknown,
          len: bigint,
          n: bigint,
        ) => unknown;
        const setFieldNamed = lib.symbols.fenel_set_field_named as (
          v: unknown,
          i: bigint,
          name: unknown,
          name_len: bigint,
          val: unknown,
        ) => unknown;
        const boxNum = lib.symbols.fenel_box_num as (v: number) => unknown;
        const fieldAccess = lib.symbols.fieldAccess as (v: unknown) => number;
        const recordTag = Buffer.from("$record\0");
        const xName = Buffer.from("x\0");
        const yName = Buffer.from("y\0");
        const inner = construct(recordTag, 7n, 1n);
        setFieldNamed(inner, 0n, yName, 1n, boxNum(42));
        const outer = construct(recordTag, 7n, 1n);
        setFieldNamed(outer, 0n, xName, 1n, inner);
        expect(fieldAccess(outer)).toBe(42);
      } finally {
        lib.close();
        try {
          fs.rmSync(path.dirname(soPath), { recursive: true, force: true });
        } catch {
          // Best-effort cleanup.
        }
      }
    },
  );
});
