// ---------------------------------------------------------------------------
// Self-hosting bootstrap (Wasm target) — Phases 18 + 19
//
// Sibling of `compile-js-self-host.test.ts`. Walks the engine's own
// function registry, filters to functions whose `body` is a real Fenel
// expression, and for each one asserts engine eval ≡ compiled WASM
// execution byte-for-byte.
//
// **Phase 5b30** — module-init + buildFenelRuntime + sharedWasmFenelWrappers
// + runOne + classifyFnId all live in the sibling
// `compile-wasm-self-host-classifier.ts` (tier-(12-tooling) substrate
// sub-phase). This file owns ONLY the bun:test integration: per-fnId `it`
// + bootstrap report + Phase 18/19/21 shape probes.
// ---------------------------------------------------------------------------

import { beforeAll, describe, it, expect } from "vitest";
import { compileFenelToWasmNative, serializeWasmModuleNative } from "./modules/compile-wasm";
import type { CompileSource } from "./compilable";
import { positionalCompileFieldSlots } from "./compile-field-slots";
import type { WasmModule } from "./ir/wasm-ast";
import {
  candidateFns,
  classifyFnId,
  buildFenelRuntime,
  EXPECTED_GAPS,
  FN_SAMPLES,
  prepareClassifier,
  runOne,
  type AdtHandle,
  type Row,
} from "./compile-wasm-self-host-classifier";
const rows: Row[] = [];
const CLASSIFIER_TEST_TIMEOUT_MS = 1_800_000;

// A cold strict product registry can exceed ten minutes on the Windows gate
// machine. This is a correctness bootstrap, not a latency assertion.
beforeAll(() => prepareClassifier(), 1_800_000);

describe("Phase 18 — self-hosting bootstrap (Wasm target, std module)", () => {
  for (const fn of candidateFns) {
    it(fn.id, async () => {
      const obs = await classifyFnId(fn.id);
      const gap = EXPECTED_GAPS[fn.id];
      let row: Row;
      if (gap !== undefined) {
        if (obs.status === "OK") {
          throw new Error(
            `${fn.id}: now self-hosts through Wasm — remove the EXPECTED_GAPS entry "${gap}" and re-run`,
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
    }, CLASSIFIER_TEST_TIMEOUT_MS);
  }

  it("bootstrap report — per-function status (Wasm)", () => {
    const ok = rows.filter((r) => r.status === "ok").length;
    const skipped = rows.filter((r) => r.status === "skip").length;
    const failed = rows.filter((r) => r.status === "fail").length;
    const lines: string[] = [];
    lines.push("");
    lines.push("Self-hosting bootstrap (Wasm target, std module):");
    for (const r of rows) {
      if (r.status === "ok") {
        lines.push(`  ${r.fnId.padEnd(20)} OK    ${r.samples}/${r.samples} samples agree`);
      } else if (r.status === "skip") {
        lines.push(`  ${r.fnId.padEnd(20)} SKIP  ${r.reason}`);
      } else {
        lines.push(`  ${r.fnId.padEnd(20)} FAIL  ${r.reason}`);
      }
    }
    lines.push(
      `Total: ${rows.length} candidates — ${ok} self-hosted, ${skipped} skipped, ${failed} failed`,
    );
    // eslint-disable-next-line no-console
    console.log(lines.join("\n"));
    expect(failed).toBe(0);
  });

  it("found ≥ 10 candidate Fenel-bodied functions in std", () => {
    expect(candidateFns.length).toBeGreaterThanOrEqual(10);
  });

  // FM-retire-9 Step 9b — std:add is now a bodyless `@native` leaf (see the JS
  // canary). Retargeted to std:lerp (still Fenel-bodied; OK on Wasm per matrix).
  it("std:lerp self-hosts through Wasm (canary)", async () => {
    const lerpFn = candidateFns.find((f) => f.id === "std:lerp");
    expect(lerpFn).toBeDefined();
    const row = await runOne(lerpFn!, FN_SAMPLES["std:lerp"]!);
    expect(row.status).toBe("ok");
  });

  // Phase 18 shape probe: std:. compiles end-to-end through Wasm.
  it("Phase 18: std:. lowers through closure conversion + indirect call ABI", () => {
    const dotFn = candidateFns.find((f) => f.id === "std:.");
    expect(dotFn).toBeDefined();
    const compiled = compileFenelToWasmNative({
      name: "dot",
      params: positionalCompileFieldSlots(dotFn!.params.map((p) => p.name)),
      body: dotFn!.body,
    });
    expect(compiled.$tag).toBe("Ok");
    if (compiled.$tag !== "Ok") return;
    const mod = compiled._0 as WasmModule;
    expect(mod.funcs.length).toBe(2);
    const exportNames = mod.exports.map((e) => e.name).sort();
    expect(exportNames).toEqual(["dot", "dot__cl0"]);
    const callImport = mod.imports.find(
      (i) => i.$tag === "WasmFuncImport" && i.name === "callClosure_1",
    );
    expect(callImport).toBeDefined();
    const makeImport = mod.imports.find(
      (i) => i.$tag === "WasmFuncImport" && i.name === "makeClosure",
    );
    expect(makeImport).toBeDefined();
  });

  // Phase 18 execution probe: drive std:. end-to-end with user-supplied closures.
  it("Phase 18: std:. executes end-to-end through Wasm closure ABI", async () => {
    const dotFn = candidateFns.find((f) => f.id === "std:.");
    expect(dotFn).toBeDefined();
    const source: CompileSource = {
      name: "dot",
      params: positionalCompileFieldSlots(dotFn!.params.map((p) => p.name)),
      body: dotFn!.body,
    };
    const compiled = compileFenelToWasmNative(source);
    expect(compiled.$tag).toBe("Ok");
    if (compiled.$tag !== "Ok") return;
    const mod = compiled._0 as WasmModule;
    const ser = serializeWasmModuleNative(mod);
    expect(ser.$tag).toBe("Ok");
    if (ser.$tag !== "Ok") return;
    const { rt, setInstance } = buildFenelRuntime(mod.stringPool ?? []);
    const result = await WebAssembly.instantiate(ser._0, {
      $fenel: rt as unknown as WebAssembly.ModuleImports,
    });
    setInstance(result.instance);
    const dot = (result.instance.exports as Record<string, unknown>).dot as (
      f: unknown,
      g: unknown,
    ) => unknown;
    const callClosure1 = rt["callClosure_1"] as (cl: unknown, x: unknown) => unknown;
    const addOne = { __userFn: (x: number): number => x + 1 };
    const doubler = { __userFn: (x: number): number => x * 2 };
    const combined = dot(addOne, doubler);
    expect(callClosure1(combined, 5)).toBe(11);
    expect(callClosure1(combined, 0)).toBe(1);
    expect(callClosure1(combined, -3)).toBe(-5);
  });

  // Phase 19 ADT probe — exercises construct + match end-to-end.
  it("Phase 19: ADT construct + match probe (synthetic body, no std fn uses ADTs today)", async () => {
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
    const compiled = compileFenelToWasmNative(source);
    expect(compiled.$tag).toBe("Ok");
    if (compiled.$tag !== "Ok") return;
    const mod = compiled._0 as WasmModule;
    const importNames = mod.imports
      .filter((i) => i.$tag === "WasmFuncImport")
      .map((i) => i.name);
    expect(importNames).toContain("tagEq");
    expect(importNames).toContain("getField");
    expect(importNames).toContain("matchFail");

    const ser = serializeWasmModuleNative(mod);
    expect(ser.$tag).toBe("Ok");
    if (ser.$tag !== "Ok") return;
    const { rt, setInstance } = buildFenelRuntime(mod.stringPool ?? []);
    const instance = (await WebAssembly.instantiate(ser._0, {
      $fenel: rt as unknown as WebAssembly.ModuleImports,
    })).instance;
    setInstance(instance);
    const unmaybe = (instance.exports as Record<string, unknown>).unmaybe as (
      v: unknown,
    ) => unknown;
    const construct = rt["construct"] as (tag: string, n: number) => AdtHandle;
    const setField = rt["setField"] as (v: AdtHandle, i: number, val: unknown) => void;
    const just42 = construct("Just", 1);
    setField(just42, 0, 42);
    const nothing = construct("Nothing", 0);
    expect(unmaybe(just42)).toBe(42);
    expect(unmaybe(nothing)).toBe(0);
  });

  // Phase 21.2.1 probe — dotted-ident `CeVar` ("r.x.y") lowers to a chain of getFieldNamed calls.
  it("Phase 21.2.1: dotted-ident CeVar lowers to getFieldNamed chain", async () => {
    const source: CompileSource = {
      name: "fieldAccess",
      params: positionalCompileFieldSlots(["r"]),
      body: { var: "r.x.y" },
    };
    const compiled = compileFenelToWasmNative(source);
    expect(compiled.$tag).toBe("Ok");
    if (compiled.$tag !== "Ok") return;
    const mod = compiled._0 as WasmModule;
    const importNames = mod.imports
      .filter((i) => i.$tag === "WasmFuncImport")
      .map((i) => i.name);
    expect(importNames).toContain("getFieldNamed");
    const ser = serializeWasmModuleNative(mod);
    expect(ser.$tag).toBe("Ok");
    if (ser.$tag !== "Ok") return;
    const { rt, setInstance } = buildFenelRuntime(mod.stringPool ?? []);
    const result = await WebAssembly.instantiate(ser._0, {
      $fenel: rt as unknown as WebAssembly.ModuleImports,
    });
    setInstance(result.instance);
    const fieldAccess = (result.instance.exports as Record<string, unknown>).fieldAccess as
      | ((r: unknown) => unknown)
      | undefined;
    expect(fieldAccess).toBeTypeOf("function");
    if (fieldAccess === undefined) return;
    expect(fieldAccess({ x: { y: 42 } })).toBe(42);
    expect(fieldAccess({ x: { y: "hello" } })).toBe("hello");
    expect(fieldAccess({ x: { y: { nested: true } } })).toEqual({ nested: true });
  });
});
