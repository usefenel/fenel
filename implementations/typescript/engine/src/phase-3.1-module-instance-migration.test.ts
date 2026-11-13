// Phase 3.1 of typeclass-substrate-completion — conformance tests for the
// MODULE-aggregator Instance → Fenel-authored typed-value migration.
//
// Phase 3 migrated the 38 clean builtin instances (fenel/std/typeclass-
// instances.fenel). Phase 3.1 extends the same projection bridge to the
// module path: the clean fnId-string-method instances in codec / prover /
// evaluator-strategies / compile-{js,wasm,llvm} / decidable-membership are
// now Fenel-authored value-decls in `fenel/modules/<area>/instances.fenel`,
// projected by `loadFenelModule` into the legacy `Instance` cache shape.
//
// Pins: (1) each module file projects exactly its migrated instances; (2) a
// representative per module projects byte-identically on {typeName,args,
// methods}; (3) dispatch via dispatchRegistry.satisfies/.resolve is unchanged;
// (4) the migrated instances in each module's `instances` field now carry NO
// top-level `label` (proving they come from the label-less Fenel projection,
// not the old TS literals), and the deferred sets (Exemplifiable / Migration /
// Aggregable) remain TS-side.

import { describe, it, expect } from "bun:test";
import { loadFenelModule } from "./fenel-module";
import { dispatchRegistry } from "./system-entities";
import type { Instance } from "./types";

import { codecModule } from "./modules/codec";
import { proverModule } from "./modules/prover";
import { evaluatorStrategiesModule } from "./modules/evaluator-strategies";
import { compileJsModule } from "./modules/compile-js";
import { compileWasmModule } from "./modules/compile-wasm";
import { compileLlvmModule } from "./modules/compile-llvm";
import { decidableMembershipModule } from "./modules/decidable-membership";
import { aggregableModule } from "./modules/aggregable";
import { migrationModule } from "./modules/migration";

import CODEC_INSTANCES_FENEL from "../../../../fenel/modules/codec/instances.fenel?raw";
import PROVER_INSTANCES_FENEL from "../../../../fenel/modules/prover/instances.fenel?raw";
import EVALUATOR_INSTANCES_FENEL from "../../../../fenel/modules/evaluator-strategies/instances.fenel?raw";
import COMPILE_JS_INSTANCES_FENEL from "../../../../fenel/modules/compile-js/instances.fenel?raw";
import COMPILE_WASM_INSTANCES_FENEL from "../../../../fenel/modules/compile-wasm/instances.fenel?raw";
import COMPILE_LLVM_INSTANCES_FENEL from "../../../../fenel/modules/compile-llvm/instances.fenel?raw";
import DM_INSTANCES_FENEL from "../../../../fenel/modules/decidable-membership/instances.fenel?raw";
import { GLOBAL_ONLY } from "./dispatch-registry";

const triple = (i: Instance) => ({ typeName: i.typeName, args: i.args, methods: i.methods });
// Phase 3.4b — instance files are loaded with `dispatchInstanceFile: true`
// (the non-suffix dispatch-instance marker that replaced `endsWith("Spec")`),
// matching how the real module loaders pull these files.
const proj = (src: string, area: string) =>
  loadFenelModule(src, area, { dispatchInstanceFile: true }).instances ?? [];

const MODULE_FILES: [string, string, string, Record<string, number>][] = [
  ["codec", CODEC_INSTANCES_FENEL, "codec", { Iso: 3, Lens: 1, Decodable: 4 }],
  ["prover", PROVER_INSTANCES_FENEL, "prover", { Prover: 2 }],
  ["evaluator-strategies", EVALUATOR_INSTANCES_FENEL, "evaluator-strategies", { Evaluator: 4 }],
  // expr-substrate Phase 6c — the compile-target codecs demoted Iso →
  // Encodable (decode natives are documented placeholders; the Iso
  // bijectivity laws were unsatisfiable).
  ["compile-js", COMPILE_JS_INSTANCES_FENEL, "compile-js", { Compilable: 1, Encodable: 1 }],
  ["compile-wasm", COMPILE_WASM_INSTANCES_FENEL, "compile-wasm", { Compilable: 1, Encodable: 1 }],
  ["compile-llvm", COMPILE_LLVM_INSTANCES_FENEL, "compile-llvm", { Compilable: 1, Encodable: 1 }],
  // 15 shapes: the 11 of Phase 3.1, plus SetCtor / SetMu / SetArrow
  // (decide-substrate 8λ.1, `c63ccda3`) and SetRigid (signature-substrate slice
  // 3a, `a6262194`) — the stale 11 re-pinned as phase-3.2's list was.
  ["decidable-membership", DM_INSTANCES_FENEL, "decidable-membership", { DecidableMembership: 15 }],
];

describe("Phase 3.1 — loader projection over module instance files", () => {
  for (const [name, src, area, dist] of MODULE_FILES) {
    it(`${name}: projects exactly the expected per-class headcount`, () => {
      const projected = proj(src, area);
      const got: Record<string, number> = {};
      for (const i of projected) got[i.typeName] = (got[i.typeName] ?? 0) + 1;
      expect(got).toEqual(dist);
      // The file holds ONLY pure instance value-decls — no function decls,
      // so no auto Codeable/Labelable/Categorizable identity instances leak.
      const total = Object.values(dist).reduce((a, b) => a + b, 0);
      expect(projected.length).toBe(total);
    });
  }

  it("all type-application args normalise to bare strings", () => {
    for (const [, src, area] of MODULE_FILES) {
      for (const i of proj(src, area)) {
        for (const a of i.args) expect(typeof a).toBe("string");
      }
    }
  });
});

describe("Phase 3.1 — byte-identity (representative per module)", () => {
  it("codec isoBase64 projects {Iso, [String,Bytes], encode/decode references}", () => {
    const i = proj(CODEC_INSTANCES_FENEL, "codec").find(
      (x) => x.typeName === "Iso" && x.args[0] === "String" && x.args[1] === "Bytes",
    );
    expect(triple(i!)).toEqual({
      typeName: "Iso",
      args: ["String", "Bytes"],
      // modules-as-values Phase 2d: qualified references, not id strings.
      methods: { encode: { $ref: "codec.base64Encode" }, decode: { $ref: "codec.base64Decode" } },
    });
  });

  it("prover structuralProverInstance projects {Prover, [Structural], propose} (8→2 collapse)", () => {
    const i = proj(PROVER_INSTANCES_FENEL, "prover").find((x) => x.args[0] === "Structural");
    expect(triple(i!)).toEqual({
      typeName: "Prover",
      args: ["Structural"],
      // modules-as-values Phase 2c: a qualified reference to the same function.
      methods: { propose: { $ref: "prover.structuralPropose" } },
    });
  });

  it("evaluator eagerEvaluatorInstance projects {Evaluator, [EagerStrategy], eval}", () => {
    const i = proj(EVALUATOR_INSTANCES_FENEL, "evaluator-strategies").find(
      (x) => x.args[0] === "EagerStrategy",
    );
    expect(triple(i!)).toEqual({
      typeName: "Evaluator",
      args: ["EagerStrategy"],
      // modules-as-values Phase 2b: a qualified reference to the same function.
      methods: { eval: { $ref: "evaluatorStrategies.eagerEval" } },
    });
  });

  it("compile-js compileJsInstance projects {Compilable, [JsModule], compile}", () => {
    const i = proj(COMPILE_JS_INSTANCES_FENEL, "compile-js").find((x) => x.typeName === "Compilable");
    expect(triple(i!)).toEqual({
      typeName: "Compilable",
      // modules-as-values Phase 2b: keyed by what the compiler returns (was JsAst).
      args: ["JsModule"],
      // modules-as-values Phase 2b: a qualified reference to the same function.
      methods: { compile: { $ref: "compileJs.compileFenelToJs" } },
    });
  });

  it("decidable-membership dmInstanceInterval projects the four decision functions + the Phase-3 per-shape witness/enumerate faces", () => {
    const i = proj(DM_INSTANCES_FENEL, "decidable-membership").find((x) => x.args[0] === "SetInterval");
    expect(triple(i!)).toEqual({
      typeName: "DecidableMembership",
      args: ["SetInterval"],
      // modules-as-values Phase 2c: qualified references to the same functions.
      methods: {
        contains: { $ref: "set.setIntervalContains" },
        decideSubset: { $ref: "set.setIntervalDecideSubset" },
        decideDisjoint: { $ref: "set.setIntervalDecideDisjoint" },
        decideEmpty: { $ref: "set.setIntervalDecideEmpty" },
        // decide-substrate Phase 3 — the per-shape faces (were the polymorphic
        // set:witness / set:enumerate at Stage B; now the SetInterval theory's
        // own witness face + the shared non-enumerable enumerate face, both
        // engine functions — see instances.fenel's family-location note).
        witness: { $ref: "engine.seWitnessInterval" },
        enumerate: { $ref: "engine.seEnumOpaque" },
      },
    });
  });
});

describe("Phase 3.1 — dispatch parity", () => {
  it("single-arg dispatch keys satisfy via dispatchRegistry", () => {
    const checks: [string, string][] = [
      ["JsModule", "Compilable"],
      ["WasmModule", "Compilable"],
      ["LlvmModule", "Compilable"],
      ["Structural", "Prover"],
      ["Smt", "Prover"],
      ["EagerStrategy", "Evaluator"],
      ["JitStrategy", "Evaluator"],
      ["SetInterval", "DecidableMembership"],
      ["SetEnum", "DecidableMembership"],
    ];
    for (const [target, typeName] of checks) {
      expect(dispatchRegistry.satisfies(target, typeName, GLOBAL_ONLY), `${typeName}(${target})`).toBe(true);
    }
  });

  it("resolve returns the migrated method values", () => {
    expect(dispatchRegistry.resolve("JsModule", "Compilable", GLOBAL_ONLY)).toMatchObject({
      compile: { $ref: "compileJs.compileFenelToJs" },
    });
    expect(dispatchRegistry.resolve("Structural", "Prover", GLOBAL_ONLY)).toMatchObject({
      propose: { $ref: "prover.structuralPropose" },
    });
    expect(dispatchRegistry.resolve("EagerStrategy", "Evaluator", GLOBAL_ONLY)).toMatchObject({
      eval: { $ref: "evaluatorStrategies.eagerEval" },
    });
    expect(dispatchRegistry.resolve("SetInterval", "DecidableMembership", GLOBAL_ONLY)).toMatchObject({
      contains: { $ref: "set.setIntervalContains" },
    });
  });
});

describe("Phase 3.1 — Fenel projection is the source (no residual TS literals)", () => {
  // The old TS consts carried a top-level `label` string. Phase 3.1 dropped
  // it (the loader projected only {typeName, args, methods}); Phase 3.2
  // (2026-05-29) RESTORED it via the loader's `label` method-field lift, so a
  // migrated instance now carries its original label again — full-object
  // byte-identity, proof the data flows through the `label =` decls in the
  // `.fenel` files, not a surviving inline TS literal.
  const findInst = (mod: { instances?: Instance[] }, typeName: string, arg0: string) =>
    (mod.instances ?? []).find((i) => i.typeName === typeName && i.args[0] === arg0);

  it("migrated module instances carry their restored top-level label (Phase 3.2)", () => {
    // `find` returns the first matching instance; codec's Iso<String,*> set is
    // ordered isoBase64 first, Decodable<JsonValue,*> set decodableString first.
    expect(findInst(codecModule, "Iso", "String")?.label).toBe("Base64 (RFC 4648)");
    expect(findInst(codecModule, "Decodable", "JsonValue")?.label).toBe("Decodable JsonValue → String");
    expect(findInst(proverModule, "Prover", "Structural")?.label).toBe("Structural Prover (dispatched by proposition shape)");
    expect(findInst(evaluatorStrategiesModule, "Evaluator", "EagerStrategy")?.label).toBe("EagerEvaluator — call-by-value (default)");
    expect(findInst(compileJsModule, "Compilable", "JsModule")?.label).toBe("CompileJs — Fenel → JavaScript");
    expect(findInst(compileWasmModule, "Compilable", "WasmModule")?.label).toBe("CompileWasm — Fenel → WebAssembly 3.0");
    expect(findInst(compileLlvmModule, "Compilable", "LlvmModule")?.label).toBe("CompileLlvm — Fenel → LLVM IR text");
    expect(findInst(decidableMembershipModule, "DecidableMembership", "SetInterval")?.label).toBe("Interval Decidable Membership");
    // The lifted `label` is removed from `methods` (byte-identity the other
    // way — the const's `methods` never carried `label`).
    expect((findInst(codecModule, "Iso", "String")?.methods as Record<string, unknown>)?.label).toBeUndefined();
  });

  it("Exemplifiable (codec sample arrays) remains the only deferred family; Migration + Aggregable migrated", () => {
    // Codec's Exemplifiable instances carry Uint8Array / wrapped-value sample
    // arrays — still out of scope (→ Phase 3.3 factory/sample-array porting),
    // so they must still be present in the module.
    expect((codecModule.instances ?? []).some((i) => i.typeName === "Exemplifiable")).toBe(true);
    // Migration (Phase 3.2) + Aggregable (Phase 3.2b) are now Fenel-authored —
    // still present in their modules, but sourced from `.fenel` projections.
    expect((migrationModule.instances ?? []).some((i) => i.typeName === "Migration")).toBe(true);
    // Aggregable's migration is witnessed by the type-as-value shape: the
    // `inputType` method field projects to the TYPE reference `{$ref:"List"}`
    // (Phase 3.2b's type-valued-field lowering), not the runtime value
    // `{$tag:"List"}` a blind nullary-construct lowering would produce.
    const aggLength = (aggregableModule.instances ?? []).find(
      (i) => i.typeName === "Aggregable" && i.args[0] === "length",
    );
    expect(aggLength).toBeDefined();
    expect((aggLength!.methods as Record<string, unknown>).inputType).toEqual({ $ref: "List" });
  });
});
