// ---------------------------------------------------------------------------
// CompileLlvm — end-to-end tests for Phase 14
//
// Exercises:
//   1. The lowering — ClosuresExplicit → LlvmAst — for the operator /
//      conditional / let-binding / runtime-call shapes the bootstrap needs.
//   2. The text emitter — LlvmAst → string — produces standard LLVM IR
//      text per the LLVM Language Reference Manual.
//   3. The bootstrap demo — compile a suite of pure-Fenel functions, emit
//      the IR text, and when `llvm-as` is available, verify it parses
//      cleanly (`llvm-as -disable-output`). When LLVM tools are absent,
//      the syntactic / structural tests still gate module validity; the
//      tool-dependent arcs skip with a `console.warn` (per the brief).
//
// Tool dependencies:
//   - `llvm-as`  — REQUIRED for the syntactic validation gate (optional
//                  in the sense that the suite skips it when missing).
//                  Detect via `Bun.which("llvm-as")`.
//   - `lli`      — OPTIONAL; would gate the execution byte-equality test.
//                  Phase 14 doesn't ship the execution arc because the
//                  test harness for `lli`-style invocation requires
//                  generating a per-case driver `main` with printf and
//                  parsing stdout — significant complexity for a bonus
//                  test. The brief explicitly allows shipping syntactic
//                  validation only ("acceptable minimum is syntactic-
//                  validation-only when no LLVM tools are present"); the
//                  execution arc lands when a use case forces it.
//   - `clang`    — Same posture as `lli` — for the C runtime shim that
//                  would back the `@fenel_concat` extern.
//
// Same posture as `compile-wasm.test.ts` (the Phase 13 Wasm bootstrap):
// tests bypass the dispatch path and call the native impls directly. The
// runtime-dispatch path is exercised by the audit script's law-validator
// runs (`audit-effects.ts`).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  lowerToLlvmAstNative,
  serializeLlvmModuleNative,
  compileFenelToLlvmNative,
} from "./modules/compile-llvm";
import type { CompileSource } from "./compilable";
import { positionalCompileFieldSlots } from "./compile-field-slots";
import type { LlvmModule } from "./ir/llvm-ast";
// ---------------------------------------------------------------------------
// Tool detection
//
// `Bun.which(<name>)` returns the absolute path or `null`. The audit script
// uses the same idiom for its optional checks. When the LLVM toolchain is
// absent, the tool-dependent test arcs skip with a `console.warn`; the
// syntactic / structural tests always run because they don't depend on
// external tools.
// ---------------------------------------------------------------------------

function whichSafe(name: string): string | null {
  try {
    // Bun exposes `Bun.which`; outside Bun fall back to a no-op so the
    // tests at least compile in non-Bun runners.
    const bun = (globalThis as { Bun?: { which: (n: string) => string | null } }).Bun;
    return bun?.which(name) ?? null;
  } catch {
    return null;
  }
}

const LLVM_AS_PATH = whichSafe("llvm-as");
const HAS_LLVM_AS = LLVM_AS_PATH !== null;

/** Synchronously invoke `llvm-as -disable-output` on the given IR text.
 *  Returns `{ ok: true }` on exit-code 0, `{ ok: false, stderr }` otherwise.
 *  Uses Bun's `Bun.spawnSync` when available (the test runner is Bun). */
function runLlvmAs(irText: string): { ok: boolean; stderr?: string } {
  if (!HAS_LLVM_AS) return { ok: false, stderr: "llvm-as not available" };
  const bun = (globalThis as {
    Bun?: {
      spawnSync: (cmd: string[], opts?: { stdin?: BufferSource; stderr?: "pipe" | "inherit" | "ignore"; stdout?: "pipe" | "inherit" | "ignore" }) =>
        { exitCode: number; stdout: Uint8Array; stderr: Uint8Array };
    };
  }).Bun;
  if (bun?.spawnSync === undefined) {
    return { ok: false, stderr: "Bun.spawnSync not available" };
  }
  const encoded = new TextEncoder().encode(irText);
  const result = bun.spawnSync(
    [LLVM_AS_PATH!, "-disable-output"],
    { stdin: encoded, stderr: "pipe", stdout: "ignore" },
  );
  if (result.exitCode === 0) return { ok: true };
  const stderr = new TextDecoder().decode(result.stderr);
  return { ok: false, stderr };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Build a CompileSource for `f(a, b, …) = body`. */
function src(name: string, paramNames: string[], body: unknown, requires?: string[]): CompileSource {
  return {
    name,
    params: positionalCompileFieldSlots(paramNames),
    body,
    ...(requires !== undefined ? { requires } : {}),
  };
}

/** Compile a Fenel source to LLVM IR text. Returns the emitted text on
 *  success; throws with the structured error on compile / serialize
 *  failure. */
function compileToIrText(source: CompileSource): string {
  const compiled = compileFenelToLlvmNative(source);
  if (compiled.$tag === "Err") {
    throw new Error(`compileFenelToLlvm failed: ${JSON.stringify(compiled._0)}`);
  }
  const serialized = serializeLlvmModuleNative(compiled._0);
  if (serialized.$tag === "Err") {
    throw new Error(`serializeLlvmModule failed: ${serialized._0}`);
  }
  return serialized._0;
}

// ---------------------------------------------------------------------------
// 1. lowerToLlvmAst — ClosuresExplicit → LlvmModule shape tests
//
// Spot-check the lowering's structural decisions: function signatures,
// declarations, the basic-block structure for the standard ops.
// ---------------------------------------------------------------------------

describe("lowerToLlvmAst — structural shape", () => {
  it("`add(a, b) = a + b` lowers to one fadd in the entry block with no externs", () => {
    const compiled = compileFenelToLlvmNative(
      src("add", ["a", "b"], { "+": [{ var: "a" }, { var: "b" }] }),
    );
    expect(compiled.$tag).toBe("Ok");
    const mod = (compiled as { _0: LlvmModule })._0;
    expect(mod.declarations.length).toBe(0);
    expect(mod.definitions.length).toBe(1);
    const def = mod.definitions[0]!;
    expect(def.params.map((p) => p.paramType.$tag)).toEqual(["Double", "Double"]);
    expect(def.returnType.$tag).toBe("Double");
    // entry block + ret. Body: fadd → ret.
    expect(def.blocks.length).toBe(1);
    const entry = def.blocks[0]!;
    expect(entry.label).toBe("entry");
    expect(entry.instructions.length).toBe(1);
    expect(entry.instructions[0]!.$tag).toBe("FAdd");
    expect(entry.terminator.$tag).toBe("Ret");
  });

  it("`lt(a, b) = a < b` returns i1 directly (no boxing at the LLVM boundary)", () => {
    const compiled = compileFenelToLlvmNative(
      src("lt", ["a", "b"], { "<": [{ var: "a" }, { var: "b" }] }),
    );
    expect(compiled.$tag).toBe("Ok");
    const mod = (compiled as { _0: LlvmModule })._0;
    const def = mod.definitions[0]!;
    expect(def.returnType.$tag).toBe("I1");
    expect(def.blocks[0]!.instructions[0]!.$tag).toBe("FCmp");
  });

  it("`concat(a, b)` declares an extern `@fenel_concat(ptr, ptr) -> ptr` and emits a call", () => {
    const compiled = compileFenelToLlvmNative(
      src("concat", ["a", "b"], { call: ["concat", { var: "a" }, { var: "b" }] }),
    );
    expect(compiled.$tag).toBe("Ok");
    const mod = (compiled as { _0: LlvmModule })._0;
    expect(mod.declarations.length).toBe(1);
    expect(mod.declarations[0]!.name).toBe("fenel_concat");
    expect(mod.declarations[0]!.returnType.$tag).toBe("Ptr");
    expect(mod.declarations[0]!.params.map((p) => p.paramType.$tag)).toEqual(["Ptr", "Ptr"]);
    const def = mod.definitions[0]!;
    expect(def.params.map((p) => p.paramType.$tag)).toEqual(["Ptr", "Ptr"]);
    expect(def.returnType.$tag).toBe("Ptr");
    // Phase 21.10 — LLVM target's wire shape is the Fenel-native variant
    // shape (LlvmCall for value-producing calls, LlvmCallVoid for void
    // calls, LlvmBr for unconditional branches). The Phase 21.8 lowering
    // body emits LlvmCall here for the Ptr-returning concat call.
    expect(def.blocks[0]!.instructions[0]!.$tag).toBe("LlvmCall");
  });

  it("`max(a, b) = if a > b then a else b` lowers to BrCond + then/else/merge + phi", () => {
    const compiled = compileFenelToLlvmNative(
      src("max", ["a", "b"], {
        if: [{ ">": [{ var: "a" }, { var: "b" }] }, { var: "a" }, { var: "b" }],
      }),
    );
    expect(compiled.$tag).toBe("Ok");
    const mod = (compiled as { _0: LlvmModule })._0;
    const def = mod.definitions[0]!;
    // Expected blocks: entry → then.0 / else.0 → merge.0.
    expect(def.blocks.length).toBe(4);
    expect(def.blocks[0]!.label).toBe("entry");
    expect(def.blocks[0]!.terminator.$tag).toBe("BrCond");
    expect(def.blocks[1]!.label).toBe("then.0");
    // Phase 21.10 — unconditional branches use the Fenel-native LlvmBr
    // variant tag (distinguished from WasmInstr.Br at the constructor
    // registry level).
    expect(def.blocks[1]!.terminator.$tag).toBe("LlvmBr");
    expect(def.blocks[2]!.label).toBe("else.0");
    expect(def.blocks[2]!.terminator.$tag).toBe("LlvmBr");
    expect(def.blocks[3]!.label).toBe("merge.0");
    expect(def.blocks[3]!.instructions[0]!.$tag).toBe("Phi");
    expect(def.blocks[3]!.terminator.$tag).toBe("Ret");
  });

  it("`squareSum(a, b) = let x = a + b in x * x` reuses the let-bound register name", () => {
    const compiled = compileFenelToLlvmNative(
      src("squareSum", ["a", "b"], {
        do: [
          { let: { x: { "+": [{ var: "a" }, { var: "b" }] } } },
          { "*": [{ var: "x" }, { var: "x" }] },
        ],
      }),
    );
    expect(compiled.$tag).toBe("Ok");
    const mod = (compiled as { _0: LlvmModule })._0;
    const def = mod.definitions[0]!;
    expect(def.blocks.length).toBe(1);
    // The body is: fadd → fmul → ret. The let-bound result becomes the
    // multiplication's two operands.
    const instrs = def.blocks[0]!.instructions;
    expect(instrs.length).toBe(2);
    expect(instrs[0]!.$tag).toBe("FAdd");
    expect(instrs[1]!.$tag).toBe("FMul");
  });

  it("Phase 15: `requires` alone (no effect-dispatch sentinel in body) compiles fine", () => {
    const compiled = compileFenelToLlvmNative(
      src("eff", ["x"], { var: "x" }, ["HasStateIO@account"]),
    );
    expect(compiled.$tag).toBe("Ok");
  });

  it("Phase 16: lowers effect-dispatch sentinels to `fenel_<Class>_<method>` calls", () => {
    // Phase 16 (sibling to Phase 15's Wasm work) emits one
    // `declare ptr @fenel_<Class>_<method>(ptr, …)` extern + a `call`
    // instruction at each `$effect:` site. The C runtime shim provides
    // the implementations; the host runtime registers JS handlers
    // through `fenel_register_handler` at instantiation time. See
    // `design/effectful-compilation.md` for the per-target ABI.
    const compiled = compileFenelToLlvmNative(
      src("eff", ["x"], {
        call: ["$effect:HasStateIO:set", "k", { var: "x" }],
      }, ["HasStateIO@account"]),
    );
    expect(compiled.$tag).toBe("Ok");
    if (compiled.$tag === "Ok") {
      const mod = compiled._0;
      // Extern declaration for the effect target.
      const setDecl = mod.declarations.find((d) => d.name === "fenel_HasStateIO_set");
      expect(setDecl).toBeDefined();
      expect(setDecl!.returnType.$tag).toBe("Ptr");
      expect(setDecl!.params.map((p) => p.paramType.$tag)).toEqual(["Ptr", "Ptr"]);
      // Structured effect-import metadata exposes the dispatch surface.
      expect(mod.effectImports?.length).toBe(1);
      expect(mod.effectImports?.[0]).toMatchObject({
        typeName: "HasStateIO",
        methodName: "set",
        arity: 2,
        symbol: "fenel_HasStateIO_set",
      });
      // String literal arg interned into the per-module pool.
      expect(mod.stringPool).toEqual(["k"]);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. serializeLlvmModule — IR text format shape
//
// Spot-check that the emitted text contains the expected idioms (define /
// declare / ret / fadd / fcmp / phi / call). The strict gate is
// `llvm-as -disable-output` later; these tests cover the cases where
// `llvm-as` isn't installed.
// ---------------------------------------------------------------------------

describe("serializeLlvmModule — LLVM IR text shape", () => {
  it("emits a `; ModuleID` header and a `define double @<name>(...)`", () => {
    const ir = compileToIrText(src("add", ["a", "b"], { "+": [{ var: "a" }, { var: "b" }] }));
    expect(ir).toContain("; ModuleID = 'add'");
    expect(ir).toContain("define double @add(double %a, double %b) {");
    expect(ir).toContain("fadd double");
    expect(ir).toContain("ret double");
  });

  it("emits `declare ptr @fenel_concat(ptr, ptr)` when concat is called", () => {
    const ir = compileToIrText(
      src("concat", ["a", "b"], { call: ["concat", { var: "a" }, { var: "b" }] }),
    );
    expect(ir).toContain("declare ptr @fenel_concat(ptr, ptr)");
    expect(ir).toContain("define ptr @concat(ptr %a, ptr %b)");
    expect(ir).toContain("call ptr @fenel_concat(ptr %a, ptr %b)");
  });

  it("emits `fcmp ogt` for `>` and returns i1", () => {
    const ir = compileToIrText(src("gt", ["a", "b"], { ">": [{ var: "a" }, { var: "b" }] }));
    expect(ir).toContain("fcmp ogt double");
    expect(ir).toContain("define i1 @gt");
  });

  it("emits a phi node at the merge label of an if/else", () => {
    const ir = compileToIrText(
      src("max", ["a", "b"], {
        if: [{ ">": [{ var: "a" }, { var: "b" }] }, { var: "a" }, { var: "b" }],
      }),
    );
    expect(ir).toContain("br i1");
    expect(ir).toContain("then.0:");
    expect(ir).toContain("else.0:");
    expect(ir).toContain("merge.0:");
    expect(ir).toMatch(/= phi double \[ %a, %then\.0 \], \[ %b, %else\.0 \]/);
  });

  it("emits a `entry:` label as the first block", () => {
    const ir = compileToIrText(src("add", ["a", "b"], { "+": [{ var: "a" }, { var: "b" }] }));
    expect(ir).toContain("entry:");
  });

  // Phase 21.5.2 — string-typed eq routes through fenel_str_eq instead
  // of the fcmp double-compare fast path. Before the substrate fix the
  // emitter inferred `s` as DOM_DOUBLE (because eq routed through
  // DIRECT_FP_COMPARISONS to fcmp), and the ptr-typed string param got
  // coerced through double at the call boundary. The fix detects the
  // CeLit-string sibling (or dotted-CeVar / DOM_PTR-returning CeCall)
  // and routes through fenel_str_eq with DOM_PTR args. Stays in the
  // suite as a positive regression guard so future emitter changes
  // that break string-typed eq fire here at compile time, even on
  // machines without clang where the self-host harness can only
  // assert ir-shape.
  it("Phase 21.5.2: string-typed eq emits `fenel_str_eq` (polymorphic)", () => {
    const ir = compileToIrText(
      src("stringEqProbe", ["s"], {
        if: [{ "==": [{ var: "s" }, "hello"] }, "matched", "default"],
      }),
    );
    expect(ir).toContain("declare i1 @fenel_str_eq(ptr, ptr)");
    expect(ir).toContain("call i1 @fenel_str_eq");
    // The param `s` should be ptr-typed (string carrying), not double.
    expect(ir).toContain("@stringEqProbe(ptr %s)");
    // Numeric eq path stays on fcmp — `eq (length xs) 1`-shaped calls
    // should not regress to fenel_str_eq just because the substrate fix
    // landed. Guard by asserting fcmp ueq stays for the pure-numeric path.
    const numericIr = compileToIrText(
      src("numericEq", ["a", "b"], { "==": [{ var: "a" }, { var: "b" }] }),
    );
    expect(numericIr).toContain("fcmp oeq double");
    expect(numericIr).not.toContain("fenel_str_eq");
  });
});

// ---------------------------------------------------------------------------
// 3. Bootstrap — same suite as Phase 5 / Phase 13. Compile each case to
//    LLVM IR text and verify shape. When `llvm-as` is available, also run
//    syntactic validation on the emitted IR.
//
// The brief mandates: "every emitted module passes `llvm-as` syntactic
// validation". This is the LOAD-BEARING gate: if `llvm-as` accepts the
// text, the module is parseable + type-checks at the LLVM level (LLVM's
// `verifyModule` is invoked by `llvm-as` internally).
//
// When LLVM tools aren't present: this test arc skips with a console.warn
// so CI on lean images still passes. The syntactic / structural tests in
// blocks 1 and 2 above still run and gate validity.
// ---------------------------------------------------------------------------

describe("bootstrap — every emitted module parses via `llvm-as`", () => {
  const cases: Array<{ name: string; params: string[]; body: unknown }> = [
    { name: "add", params: ["a", "b"], body: { "+": [{ var: "a" }, { var: "b" }] } },
    { name: "sub", params: ["a", "b"], body: { "-": [{ var: "a" }, { var: "b" }] } },
    { name: "mul", params: ["a", "b"], body: { "*": [{ var: "a" }, { var: "b" }] } },
    { name: "lt", params: ["a", "b"], body: { "<": [{ var: "a" }, { var: "b" }] } },
    { name: "gt", params: ["a", "b"], body: { ">": [{ var: "a" }, { var: "b" }] } },
    {
      name: "max",
      params: ["a", "b"],
      body: { if: [{ ">": [{ var: "a" }, { var: "b" }] }, { var: "a" }, { var: "b" }] },
    },
    {
      name: "concat",
      params: ["a", "b"],
      body: { call: ["concat", { var: "a" }, { var: "b" }] },
    },
    {
      name: "axbpc",
      params: ["a", "b", "c"],
      body: { "+": [{ var: "a" }, { "*": [{ var: "b" }, { var: "c" }] }] },
    },
    {
      name: "squareSum",
      params: ["a", "b"],
      body: {
        do: [
          { let: { x: { "+": [{ var: "a" }, { var: "b" }] } } },
          { "*": [{ var: "x" }, { var: "x" }] },
        ],
      },
    },
  ];

  for (const c of cases) {
    it(`compiles \`${c.name}\` to syntactically valid LLVM IR`, () => {
      const ir = compileToIrText(src(c.name, c.params, c.body));
      // Always check the IR shape — `define <type> @<name>(...)` must
      // appear. This is the minimum content gate that holds without any
      // external tool.
      expect(ir).toContain(`@${c.name}`);
      expect(ir).toContain("define ");

      if (!HAS_LLVM_AS) {
        // Skip syntactic validation. The structural tests above gate the
        // module's validity in the absence of LLVM tools.
        console.warn(
          `[compile-llvm.test] llvm-as not on PATH — skipping syntactic validation for '${c.name}'. The brief explicitly allows ship-without-LLVM-tools; ` +
            `the emitted IR is structurally checked but not validated by an LLVM frontend. Install LLVM (https://releases.llvm.org/) to enable full gating.`,
        );
        return;
      }

      const result = runLlvmAs(ir);
      if (!result.ok) {
        // Surface the IR + stderr for diagnosis.
        const sep = "─".repeat(60);
        throw new Error(
          `llvm-as rejected module '${c.name}':\n${sep}\n${ir}\n${sep}\nstderr:\n${result.stderr ?? "(none)"}`,
        );
      }
      expect(result.ok).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// 4. Codec — Iso<String, LlvmModule> encode side
//
// The decode side is the Phase 14 placeholder; the encode round-trip is
// what the bootstrap above exercises. This block exercises the encoder
// in isolation, asserting the text contains the expected idioms.
// ---------------------------------------------------------------------------

describe("Codec<String, LlvmModule> — encode side", () => {
  it("serialize(compile(…)) produces standard LLVM IR text", () => {
    const compiled = compileFenelToLlvmNative(
      src("add", ["a", "b"], { "+": [{ var: "a" }, { var: "b" }] }),
    );
    expect(compiled.$tag).toBe("Ok");
    const serialized = serializeLlvmModuleNative((compiled as { _0: LlvmModule })._0);
    expect(serialized.$tag).toBe("Ok");
    if (serialized.$tag === "Ok") {
      const ir = serialized._0;
      // LLVM IR is line-based; standard idioms appear verbatim.
      expect(ir.split("\n").some((l) => l.startsWith("define double @add"))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Phase 19 — ADT representation + pattern matching
//
// Hand-written fixtures covering the four canonical ADT shapes from the
// brief:
//
//   - `Maybe` — zero-arg constructor (`Nothing`) + single-field
//     constructor (`Just 5`).
//   - `Result` — `Err "oops"` / `Ok 42`.
//   - `List` — `Nil` / `Cons 1 (Cons 2 Nil)` (recursive ADT).
//   - Custom user ADT — `Shape = Circle Number | Rect Number Number`.
//
// Each fixture asserts (a) the compiled module declares the Phase 19
// runtime-helper externs and (b) `llvm-as` accepts the emitted IR text
// when the tool is on the PATH.
// ---------------------------------------------------------------------------

describe("Phase 19 — LLVM ADT representation lowering", () => {
  it("Nothing (zero-arg constructor) emits `fenel_construct` with n_fields=0", () => {
    const compiled = compileFenelToLlvmNative(
      src("mkNothing", [], { construct: ["Nothing"] }),
    );
    expect(compiled.$tag).toBe("Ok");
    if (compiled.$tag !== "Ok") return;
    const mod = compiled._0;
    const declNames = mod.declarations.map((d) => d.name);
    expect(declNames).toContain("fenel_construct");
    // Tag string interned in the per-module string pool.
    expect(mod.stringPool).toContain("Nothing");
    const ir = serializeLlvmModuleNative(mod);
    expect(ir.$tag).toBe("Ok");
    if (ir.$tag !== "Ok") return;
    expect(ir._0).toContain("call ptr @fenel_construct(ptr @.str.");
    // n_fields = 0 — the last i64 arg to fenel_construct.
    expect(ir._0).toMatch(/call ptr @fenel_construct\(ptr @\.str\.\d+, i64 7, i64 0\)/);
  });

  it("Just 5 (single-field constructor) emits fenel_construct + fenel_set_field", () => {
    const compiled = compileFenelToLlvmNative(
      src("mkJust", [], { construct: ["Just", 5] }),
    );
    expect(compiled.$tag).toBe("Ok");
    if (compiled.$tag !== "Ok") return;
    const mod = compiled._0;
    const declNames = mod.declarations.map((d) => d.name);
    expect(declNames).toContain("fenel_construct");
    expect(declNames).toContain("fenel_set_field");
    expect(mod.stringPool).toContain("Just");
    const ir = serializeLlvmModuleNative(mod);
    expect(ir.$tag).toBe("Ok");
    if (ir.$tag !== "Ok") return;
    // Constructed with 1 field.
    expect(ir._0).toMatch(/call ptr @fenel_construct\(ptr @\.str\.\d+, i64 4, i64 1\)/);
    expect(ir._0).toContain("call void @fenel_set_field(ptr ");
  });

  it("Result: `Err \"oops\"` and `Ok 42` both lower through fenel_construct", () => {
    const errCompiled = compileFenelToLlvmNative(
      src("mkErr", [], { construct: ["Err", "oops"] }),
    );
    expect(errCompiled.$tag).toBe("Ok");
    if (errCompiled.$tag !== "Ok") return;
    expect(errCompiled._0.stringPool).toContain("Err");
    expect(errCompiled._0.stringPool).toContain("oops");

    const okCompiled = compileFenelToLlvmNative(
      src("mkOk", [], { construct: ["Ok", 42] }),
    );
    expect(okCompiled.$tag).toBe("Ok");
    if (okCompiled.$tag !== "Ok") return;
    expect(okCompiled._0.stringPool).toContain("Ok");
  });

  it("List (recursive): `Cons 1 (Cons 2 Nil)` chains three fenel_construct calls", () => {
    const compiled = compileFenelToLlvmNative(
      src("twoList", [], {
        construct: [
          "Cons",
          1,
          { construct: ["Cons", 2, { construct: ["Nil"] }] },
        ],
      }),
    );
    expect(compiled.$tag).toBe("Ok");
    if (compiled.$tag !== "Ok") return;
    const mod = compiled._0;
    // Both ctor names interned.
    expect(mod.stringPool).toContain("Cons");
    expect(mod.stringPool).toContain("Nil");
    const ir = serializeLlvmModuleNative(mod);
    expect(ir.$tag).toBe("Ok");
    if (ir.$tag !== "Ok") return;
    // Three construct calls: outer Cons + inner Cons + Nil.
    const calls = ir._0.match(/call ptr @fenel_construct/g) ?? [];
    expect(calls.length).toBe(3);
  });

  it("Custom ADT: `Shape = Circle r | Rect w h` constructs via fenel_construct", () => {
    const circle = compileFenelToLlvmNative(
      src("mkCircle", ["r"], { construct: ["Circle", { var: "r" }] }),
    );
    expect(circle.$tag).toBe("Ok");
    if (circle.$tag !== "Ok") return;
    expect(circle._0.stringPool).toContain("Circle");

    const rect = compileFenelToLlvmNative(
      src("mkRect", ["w", "h"], {
        construct: ["Rect", { var: "w" }, { var: "h" }],
      }),
    );
    expect(rect.$tag).toBe("Ok");
    if (rect.$tag !== "Ok") return;
    expect(rect._0.stringPool).toContain("Rect");
    const rectIr = serializeLlvmModuleNative(rect._0);
    expect(rectIr.$tag).toBe("Ok");
    if (rectIr.$tag !== "Ok") return;
    // Two set_field calls (one per dimension).
    const setFields = rectIr._0.match(/call void @fenel_set_field/g) ?? [];
    expect(setFields.length).toBe(2);
  });

  it("Anonymous record `{x = 1, y = 2}` uses the sentinel tag `$record`", () => {
    const compiled = compileFenelToLlvmNative(
      src("mkPoint", [], { x: 1, y: 2 }),
    );
    expect(compiled.$tag).toBe("Ok");
    if (compiled.$tag !== "Ok") return;
    expect(compiled._0.stringPool).toContain("$record");
  });

  it("Pattern match on Maybe emits per-arm basic blocks joined by phi", () => {
    // case x of Just y -> y | Nothing -> 0
    const compiled = compileFenelToLlvmNative(
      src("unmaybe", ["x"], {
        match: [
          { var: "x" },
          { $tag: "Just", _0: { var: "y" } },
          { var: "y" },
          { $tag: "Nothing" },
          0,
        ],
      }),
    );
    expect(compiled.$tag).toBe("Ok");
    if (compiled.$tag !== "Ok") return;
    const mod = compiled._0;
    const declNames = mod.declarations.map((d) => d.name);
    expect(declNames).toContain("fenel_tag_eq");
    expect(declNames).toContain("fenel_get_field");
    expect(declNames).toContain("fenel_match_fail");
    // Per-arm blocks. The brief calls for one check + one body per arm.
    const def = mod.definitions[0]!;
    const labels = def.blocks.map((bb) => bb.label);
    expect(labels.some((l) => l.includes("arm0.check"))).toBe(true);
    expect(labels.some((l) => l.includes("arm0.body"))).toBe(true);
    expect(labels.some((l) => l.includes("arm1.check"))).toBe(true);
    expect(labels.some((l) => l.includes("arm1.body"))).toBe(true);
    expect(labels.some((l) => l.includes("default"))).toBe(true);
    expect(labels.some((l) => l.includes("merge"))).toBe(true);
    // The merge block opens with a phi.
    const mergeBlock = def.blocks.find((bb) => bb.label.includes("merge"))!;
    expect(mergeBlock.instructions[0]!.$tag).toBe("Phi");
  });

  it("Pattern match on a literal (PatLit) emits fenel_lit_eq", () => {
    // case x of 0 -> "zero" | _ -> "nonzero"
    const compiled = compileFenelToLlvmNative(
      src("zeroOrNot", ["x"], {
        match: [
          { var: "x" },
          0,
          "zero",
          { var: "_" },
          "nonzero",
        ],
      }),
    );
    expect(compiled.$tag).toBe("Ok");
    if (compiled.$tag !== "Ok") return;
    const declNames = compiled._0.declarations.map((d) => d.name);
    expect(declNames).toContain("fenel_lit_eq");
  });

  it("Nested pattern: `Cons (Just x) tail` AND-folds two tag-eq checks", () => {
    // case xs of Cons (Just x) tail -> x | _ -> 0
    const compiled = compileFenelToLlvmNative(
      src("firstJust", ["xs"], {
        match: [
          { var: "xs" },
          { $tag: "Cons", head: { $tag: "Just", _0: { var: "x" } }, tail: { var: "tail" } },
          { var: "x" },
          { var: "_" },
          0,
        ],
      }),
    );
    expect(compiled.$tag).toBe("Ok");
    if (compiled.$tag !== "Ok") return;
    const mod = compiled._0;
    // Three tag-related strings: Cons, Just (plus _ wildcard which doesn't
    // intern anything in the pool).
    expect(mod.stringPool).toContain("Cons");
    expect(mod.stringPool).toContain("Just");
    // The guard for arm 0 should AND-fold the tag check + sub-pattern.
    const ir = serializeLlvmModuleNative(mod);
    expect(ir.$tag).toBe("Ok");
    if (ir.$tag !== "Ok") return;
    expect(ir._0).toContain("and i1");
  });

  // Bootstrap — when llvm-as is on PATH, every Phase 19 fixture parses.
  if (HAS_LLVM_AS) {
    const adtCases: Array<{ name: string; params: string[]; body: unknown }> = [
      { name: "mkNothing", params: [], body: { construct: ["Nothing"] } },
      { name: "mkJust", params: ["v"], body: { construct: ["Just", { var: "v" }] } },
      { name: "mkErr", params: [], body: { construct: ["Err", "oops"] } },
      { name: "mkOk", params: ["v"], body: { construct: ["Ok", { var: "v" }] } },
      { name: "mkNil", params: [], body: { construct: ["Nil"] } },
      {
        name: "mkCons",
        params: ["h", "t"],
        body: { construct: ["Cons", { var: "h" }, { var: "t" }] },
      },
      {
        name: "unmaybe",
        params: ["x"],
        body: {
          match: [
            { var: "x" },
            { $tag: "Just", _0: { var: "y" } },
            { var: "y" },
            { $tag: "Nothing" },
            0,
          ],
        },
      },
      {
        name: "shapeArea",
        params: ["s"],
        body: {
          match: [
            { var: "s" },
            { $tag: "Circle", radius: { var: "r" } },
            { var: "r" },
            { $tag: "Rect", w: { var: "w" }, h: { var: "h" } },
            { var: "w" },
          ],
        },
      },
    ];

    for (const c of adtCases) {
      it(`llvm-as validates Phase 19 IR for '${c.name}'`, () => {
        const ir = compileToIrText(src(c.name, c.params, c.body));
        const result = runLlvmAs(ir);
        if (!result.ok) {
          const sep = "─".repeat(60);
          throw new Error(
            `llvm-as rejected '${c.name}':\n${sep}\n${ir}\n${sep}\nstderr:\n${result.stderr ?? "(none)"}`,
          );
        }
        expect(result.ok).toBe(true);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 6. Negative — body / signature shapes the LLVM target doesn't (yet)
//    handle surface as a structured CompileError.
// ---------------------------------------------------------------------------

describe("compileFenelToLlvm — negative cases", () => {
  it("Phase 15: declared `requires` alone compiles fine; Phase 16: sentinels also compile", () => {
    // Body without an effect-dispatch sentinel compiles regardless of
    // the `requires` declaration.
    const plain = compileFenelToLlvmNative(
      src("eff", ["v"], { var: "v" }, ["HasStateIO@account"]),
    );
    expect(plain.$tag).toBe("Ok");
    // Body WITH a `$effect:` sentinel now compiles too (Phase 16 lights
    // up LLVM-side effect lowering — emits the matching extern + call).
    const effectful = compileFenelToLlvmNative(
      src(
        "eff2",
        ["v"],
        { call: ["$effect:HasStateIO:set", "k", { var: "v" }] },
        ["HasStateIO@account"],
      ),
    );
    expect(effectful.$tag).toBe("Ok");
  });

  it("Phase 18: indirect `$dyn:` calls lower through the closure-helper ABI", () => {
    // Pre-Phase-18 this was an Err Unsupported; Phase 18 closes the gap.
    // The indirect call extracts fn+env from the closure via runtime
    // helpers and invokes through the loaded function pointer.
    const compiled = compileFenelToLlvmNative(
      src("indirect", ["f"], { call: [{ var: "f" }, 1] }),
    );
    expect(compiled.$tag).toBe("Ok");
    if (compiled.$tag !== "Ok") return;
    const ir = serializeLlvmModuleNative(compiled._0);
    expect(ir.$tag).toBe("Ok");
    if (ir.$tag !== "Ok") return;
    expect(ir._0).toContain("declare ptr @fenel_closure_fn(ptr)");
    expect(ir._0).toContain("declare ptr @fenel_closure_env(ptr)");
    // The closure ptr extraction + indirect call against the loaded fn ptr.
    expect(ir._0).toMatch(/call ptr @fenel_closure_fn\(ptr %f\)/);
    expect(ir._0).toMatch(/call ptr %t\d+\(ptr %t\d+,/);
  });

  it("`lowerToLlvmAst` rejects non-ClosuresExplicit input", () => {
    const r = lowerToLlvmAstNative({ foo: "bar" });
    expect(r.$tag).toBe("Err");
  });

  it("`serializeLlvmModule` rejects non-LlvmModule input", () => {
    const r = serializeLlvmModuleNative({ foo: "bar" });
    expect(r.$tag).toBe("Err");
  });
});

// ---------------------------------------------------------------------------
// 7. Phase 5b15 — closure-value boundary fix (LLVM target)
//
// Compiles the std:. and std:$ body shapes and asserts the IR-level
// closure ABI is emitted. The full FFI-level run would need clang (the
// per-fnId 5s clang-missing baseline timeout pre-empts the self-host
// harness today); the conformance assertions here cover the IR-shape
// invariants — std:$ extracts via fenel_closure_fn + dispatches via
// fenel_make_closure / fenel_env_alloc, and std:. allocates a captures
// env + emits a closure-body function alongside the entry.
// ---------------------------------------------------------------------------

describe("Phase 5b15 — closure-value boundary fix (LLVM target)", () => {
  it("std:$ shape `\\f x -> f x` lowers to indirect dispatch via fenel_closure_fn + a loaded fn-ptr call", () => {
    const body = { call: [{ var: "f" }, { var: "x" }] };
    const ir = compileToIrText(src("dollar", ["f", "x"], body));
    expect(ir).toContain("declare ptr @fenel_closure_fn(ptr)");
    expect(ir).toContain("declare ptr @fenel_closure_env(ptr)");
    expect(ir).toMatch(/call ptr @fenel_closure_fn\(ptr %f\)/);
    expect(ir).toMatch(/call ptr %t\d+\(ptr %t\d+,\s*ptr %x\)/);
  });

  it("std:. shape `\\f g -> \\x -> f (g x)` lowers to an entry returning a fenel_make_closure result + a sibling closure-body function dispatching through fenel_env_get", () => {
    const body = {
      fn: [["x"], { call: [{ var: "f" }, { call: [{ var: "g" }, { var: "x" }] }] }],
    };
    const ir = compileToIrText(src("dot", ["f", "g"], body));
    // The entry function allocates an env, stores f + g into it, makes a
    // closure pointing to the closure-body export. Closure-body extracts
    // f + g from env via fenel_env_get and dispatches both indirect calls.
    expect(ir).toContain("declare ptr @fenel_make_closure(ptr, ptr)");
    expect(ir).toContain("declare ptr @fenel_env_alloc(i64)");
    expect(ir).toContain("@fenel_env_get");
    expect(ir).toMatch(/call ptr @fenel_make_closure\(ptr @dot__cl\d+,/);
    expect(ir).toMatch(/define ptr @dot__cl\d+\(ptr %[^,]+,\s*ptr %[^)]+\)/);
  });
});

// ---------------------------------------------------------------------------
// 8. Phase 5b16 — image-pipeline runtime binding (LLVM target)
//
// Asserts the IR-level shape of the std:imageRetro body lowering. The
// JS + WASM self-host harnesses bind `$fenel.imageGrayscale` +
// `$fenel.imagePixelate` directly to `imgOps.imgGrayscale` /
// `imgPixelate`; the LLVM target lowers the equivalent calls to
// `fenel_imageGrayscale` / `fenel_imagePixelate` runtime-helper
// declarations + matching call instructions. The per-fnId 5s clang-
// missing baseline timeout pre-empts the FFI-level run today (the C
// stubs are documented as forward-looking placeholders in compile-
// llvm-self-host.test.ts's CLOSURE_RUNTIME_C trailing comment); these
// IR-shape assertions cover the substrate invariants — first tier (8)
// harness-runtime-extension sub-phase's LLVM-side documentation.
// ---------------------------------------------------------------------------

describe("Phase 5b16 — image-pipeline runtime binding (LLVM target)", () => {
  it("std:imageRetro body lowers to declarations + call sites for fenel_imageGrayscale + fenel_imagePixelate runtime helpers", () => {
    const body = {
      call: [
        "imagePixelate",
        { call: ["imageGrayscale", { var: "img" }] },
        { var: "factor" },
      ],
    };
    const ir = compileToIrText(src("imageRetro", ["img", "factor"], body));
    // Both helpers declared as ptr-arg / ptr-return externs at the
    // module top — matches the runtime-helper ABI other LLVM externs
    // (fenel_concat / fenel_head / fenel_split / …) use.
    expect(ir).toContain("declare ptr @fenel_imageGrayscale(ptr)");
    expect(ir).toContain("declare ptr @fenel_imagePixelate(ptr, ptr)");
    // Nested call shape: imageGrayscale wraps the raw img pointer; its
    // result feeds imagePixelate alongside the factor pointer. The
    // temporaries (%t0 / %t1 / …) are numbered by the lowering's local
    // counter.
    expect(ir).toMatch(/call ptr @fenel_imageGrayscale\(ptr %img\)/);
    expect(ir).toMatch(/call ptr @fenel_imagePixelate\(ptr %t\d+,\s*ptr %factor\)/);
  });

  it("std:imageRetro entry function emits a single ptr-returning define dispatching the nested helper chain in order", () => {
    const body = {
      call: [
        "imagePixelate",
        { call: ["imageGrayscale", { var: "img" }] },
        { var: "factor" },
      ],
    };
    const ir = compileToIrText(src("imageRetro", ["img", "factor"], body));
    expect(ir).toMatch(/define ptr @imageRetro\(ptr %img,\s*ptr %factor\)/);
    // The grayscale call must appear textually BEFORE the pixelate
    // call — the lowering's order-preservation guarantee for nested
    // CeCall composition.
    const grayIdx = ir.indexOf("@fenel_imageGrayscale");
    const pixelIdx = ir.indexOf("@fenel_imagePixelate(ptr %t");
    expect(grayIdx).toBeGreaterThan(-1);
    expect(pixelIdx).toBeGreaterThan(-1);
    expect(grayIdx).toBeLessThan(pixelIdx);
  });
});
