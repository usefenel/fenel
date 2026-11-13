// Phase 3.2 of typeclass-substrate-completion — conformance tests for the
// loader extension that carries NON-string method values + lifts a top-level
// `label`.
//
// Phase 3 / 3.1 projected instances whose method values are strings / numbers
// / arrays-of-string / empty records. Phase 3.2 teaches `loadFenelModule` to
// project:
//   (1) constructor-literal method values (`Just <fnId>` / `Nothing` /
//       `Lossless` / `Lossy {reason}`) → the canonical `{$tag, ...}` runtime
//       shape, via the pure `lowerConstructLiteral` (matching json-logic.ts's
//       `construct` op WITHOUT evaluating);
//   (2) list / record method values (already plain arrays/objects post-parse);
//   (3) a top-level `label` method-field → the `Instance.label` slot
//       (mirroring the existing numeric `priority` lift).
//
// Proof the capability works: the `migration` module's 2 instances are now
// Fenel-authored (fenel/modules/migration/instances.fenel) and project
// byte-identically — including the `backward` Maybe, the `losslessness`
// variant, the `roundtripSamples` array, and the `label`. And the 37 Phase-3.1
// instances regained their labels (the loader now lifts them).
//
// Pins: (1) lowering shapes in isolation + end-to-end; (2) migration projects
// byte-identically (incl label/Maybe/variant/array); (3) Migration dispatch via
// dispatchRegistry.satisfies/.resolve returns the lowered methods; (4) the
// Phase-3.1 instances carry their restored labels, methods label-free.

import { describe, it, expect } from "bun:test";
import { loadFenelModule, lowerConstructLiteral } from "./fenel-module";
import { dispatchRegistry } from "./system-entities";
import type { Instance } from "./types";
import { migration } from "./migration";
import { lowerMaybeFunctionReferences } from "./modules/migration";

import {
  migrationModule,
  migrationDemoV1ToV2,
  migrationDemoV2ToV1Narrow,
} from "./modules/migration";

import MIGRATION_INSTANCES_FENEL from "../../../../fenel/modules/migration/instances.fenel?raw";
import CODEC_INSTANCES_FENEL from "../../../../fenel/modules/codec/instances.fenel?raw";
import PROVER_INSTANCES_FENEL from "../../../../fenel/modules/prover/instances.fenel?raw";
import EVALUATOR_INSTANCES_FENEL from "../../../../fenel/modules/evaluator-strategies/instances.fenel?raw";
import COMPILE_JS_INSTANCES_FENEL from "../../../../fenel/modules/compile-js/instances.fenel?raw";
import COMPILE_WASM_INSTANCES_FENEL from "../../../../fenel/modules/compile-wasm/instances.fenel?raw";
import COMPILE_LLVM_INSTANCES_FENEL from "../../../../fenel/modules/compile-llvm/instances.fenel?raw";
import DM_INSTANCES_FENEL from "../../../../fenel/modules/decidable-membership/instances.fenel?raw";
import { GLOBAL_ONLY } from "./dispatch-registry";

const full = (i: Instance) => ({
  typeName: i.typeName,
  args: i.args,
  methods: i.methods,
  label: i.label,
});

// ---------------------------------------------------------------------------

describe("Phase 3.2 — lowerConstructLiteral (pure structural transform)", () => {
  it("nullary construct → {$tag}", () => {
    expect(lowerConstructLiteral({ construct: ["Lossless"] })).toEqual({ $tag: "Lossless" });
    expect(lowerConstructLiteral({ construct: ["Nothing"] })).toEqual({ $tag: "Nothing" });
  });

  it("positional construct → {$tag, _0, _1}", () => {
    expect(lowerConstructLiteral({ construct: ["Just", "migration:x"] })).toEqual({
      $tag: "Just",
      _0: "migration:x",
    });
    expect(lowerConstructLiteral({ construct: ["Pair", 1, 2] })).toEqual({
      $tag: "Pair",
      _0: 1,
      _1: 2,
    });
  });

  it("named-record construct → {$tag, ...fields}", () => {
    expect(lowerConstructLiteral({ construct: ["Lossy", { reason: "drop" }] })).toEqual({
      $tag: "Lossy",
      reason: "drop",
    });
  });

  it("True / False → JS booleans (Bool opaque repr)", () => {
    expect(lowerConstructLiteral({ construct: ["True"] })).toBe(true);
    expect(lowerConstructLiteral({ construct: ["False"] })).toBe(false);
  });

  it("nested constructors lower recursively (positional, not spread)", () => {
    expect(
      lowerConstructLiteral({ construct: ["Just", { construct: ["Lossy", { reason: "r" }] }] }),
    ).toEqual({ $tag: "Just", _0: { $tag: "Lossy", reason: "r" } });
  });

  it("lists + plain records pass through (recursing into elements)", () => {
    const samples = [
      { firstName: "Ada", lastName: "Lovelace" },
      { firstName: "", lastName: "" },
    ];
    expect(lowerConstructLiteral(samples)).toEqual(samples);
    // A method record carrying a construct value lowers only that field.
    expect(
      lowerConstructLiteral({ forward: "fnId", backward: { construct: ["Just", "b"] } }),
    ).toEqual({ forward: "fnId", backward: { $tag: "Just", _0: "b" } });
  });

  it("strings / numbers pass through untouched", () => {
    expect(lowerConstructLiteral("migration:profileDemoV1ToV2")).toBe("migration:profileDemoV1ToV2");
    expect(lowerConstructLiteral(42)).toBe(42);
  });

  it("end-to-end: loadFenelModule lifts `label` out of methods into the slot", () => {
    const src = `x : Iso String Bytes\nx = Iso { encode = "e", decode = "d", label = "L" }`;
    const insts = loadFenelModule(src, "t", { dispatchInstanceFile: true }).instances ?? [];
    expect(insts).toHaveLength(1);
    expect(insts[0]!.label).toBe("L");
    expect(insts[0]!.methods).toEqual({ encode: "e", decode: "d" });
    expect((insts[0]!.methods as Record<string, unknown>).label).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe("Phase 3.2 — migration byte-identity (Maybe / variant / array / label)", () => {
  const projected = loadFenelModule(MIGRATION_INSTANCES_FENEL, "migration", { dispatchInstanceFile: true }).instances ?? [];
  const pick = (arg0: string) => projected.find((i) => i.typeName === "Migration" && i.args[0] === arg0)!;

  it("projects exactly the 2 Migration instances", () => {
    expect(projected).toHaveLength(2);
    expect(projected.every((i) => i.typeName === "Migration")).toBe(true);
  });

  it("migrationDemoV1ToV2 projects byte-identically (Just + Lossless + array + label)", () => {
    // modules-as-values Phase 2d: `forward` is a qualified reference. The
    // loader cannot tell `Just migration.profileDemoV2ToV1` from the record
    // `Just { var = … }`, so its projection carries `{$tag:"Just", var}`; the
    // migration seam lowers it by the declared field type (next test).
    expect(full(pick("ProfileDemoV1"))).toEqual({
      typeName: "Migration",
      args: ["ProfileDemoV1", "ProfileDemoV2"],
      label: "profile_demo @v1 → @v2 (add email)",
      methods: {
        forward: { $ref: "migration.profileDemoV1ToV2" },
        backward: { $tag: "Just", var: "migration.profileDemoV2ToV1" },
        losslessness: { $tag: "Lossless" },
        roundtripSamples: [
          { firstName: "Ada", lastName: "Lovelace" },
          { firstName: "Grace", lastName: "Hopper" },
          { firstName: "Linus", lastName: "Torvalds" },
          { firstName: "", lastName: "" },
          { firstName: "Edge", lastName: "Case" },
        ],
      },
    });
  });

  it("migrationDemoV2ToV1Narrow projects byte-identically (Nothing + Lossy{reason} + array + label)", () => {
    expect(full(pick("ProfileDemoV2"))).toEqual({
      typeName: "Migration",
      args: ["ProfileDemoV2", "ProfileDemoV1Narrow"],
      label: "profile_demo @v2 → @v1Narrow (drop lastName — Lossy)",
      methods: {
        forward: { $ref: "migration.profileDemoV2ToV1Narrow" },
        backward: { $tag: "Nothing" },
        losslessness: {
          $tag: "Lossy",
          reason: "lastName is dropped on forward — no way to recover it from a V1Narrow value",
        },
        roundtripSamples: [
          { firstName: "Bob", lastName: "Smith", email: "bob@example.com" },
          { firstName: "", lastName: "", email: "" },
          { firstName: "Carol", lastName: "Singh", email: "carol@example.org" },
        ],
      },
    });
  });

  it("the module re-sources its exported consts from the projection", () => {
    // migration.ts's `migrationDemoV1ToV2` is now a projection-lookup, and the
    // module's `instances` field carries the same objects (so registerMigration
    // + findMigrationPath see the projected shape).
    // modules-as-values Phase 2d: the seam lowers `backward = Just migration.x`
    // by the Migration class's declared field type; nothing else differs.
    expect(full(migrationDemoV1ToV2)).toEqual(full(lowerMaybeFunctionReferences(pick("ProfileDemoV1"), migration)));
    expect(migrationDemoV1ToV2.methods.backward).toEqual({ $tag: "Just", _0: { $ref: "migration.profileDemoV2ToV1" } });
    expect(full(migrationDemoV2ToV1Narrow)).toEqual(full(pick("ProfileDemoV2")));
    expect((migrationModule.instances ?? []).some((i) => i === migrationDemoV1ToV2)).toBe(true);
    expect((migrationModule.instances ?? []).some((i) => i === migrationDemoV2ToV1Narrow)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("Phase 3.2 — migration dispatch parity", () => {
  it("dispatchRegistry.satisfies keys Migration off args[0]", () => {
    expect(dispatchRegistry.satisfies("ProfileDemoV1", "Migration", GLOBAL_ONLY)).toBe(true);
    expect(dispatchRegistry.satisfies("ProfileDemoV2", "Migration", GLOBAL_ONLY)).toBe(true);
  });

  it("dispatchRegistry.resolve returns the lowered method values", () => {
    expect(dispatchRegistry.resolve("ProfileDemoV1", "Migration", GLOBAL_ONLY)).toMatchObject({
      forward: { $ref: "migration.profileDemoV1ToV2" },
      backward: { $tag: "Just", _0: { $ref: "migration.profileDemoV2ToV1" } },
      losslessness: { $tag: "Lossless" },
    });
    expect(dispatchRegistry.resolve("ProfileDemoV2", "Migration", GLOBAL_ONLY)).toMatchObject({
      backward: { $tag: "Nothing" },
      losslessness: { $tag: "Lossy" },
    });
  });
});

// ---------------------------------------------------------------------------

describe("Phase 3.2 — Phase-3.1 label restoration (full-object byte-identity)", () => {
  // The loader's `label` lift restores the labels Phase 3.1 dropped, so each
  // migrated instance is once again full-object byte-identical to its original
  // TS const. `methods` stays label-free (label-lift the other way).
  const EXPECTED: Record<string, [string, string[], string][]> = {
    codec: [
      ["Iso", ["String", "Bytes"], "Base64 (RFC 4648)"],
      ["Iso", ["String", "JsonValue"], "JSON"],
      ["Iso", ["CanonicalJsonString", "JsonValue"], "Canonical JSON (RFC 8785-style)"],
      ["Lens", ["Record", "Record", "String"], "Record firstName lens"],
      ["Decodable", ["JsonValue", "String"], "Decodable JsonValue → String"],
      ["Decodable", ["JsonValue", "Boolean"], "Decodable JsonValue → Boolean"],
      ["Decodable", ["JsonValue", "Number"], "Decodable JsonValue → Number"],
      ["Decodable", ["JsonValue", "Int"], "Decodable JsonValue → Int"],
    ],
    // expr-substrate Phase 6b — the 8 per-proposition-shape Prover instances
    // collapsed to 2 strategy instances (ProofStrategy = Structural | Smt).
    prover: [
      ["Prover", ["Structural"], "Structural Prover (dispatched by proposition shape)"],
      ["Prover", ["Smt"], "SMT Prover (external-solver bridge stub)"],
    ],
    "evaluator-strategies": [
      ["Evaluator", ["EagerStrategy"], "EagerEvaluator — call-by-value (default)"],
      ["Evaluator", ["LazyStrategy"], "LazyEvaluator — call-by-name (POC)"],
      ["Evaluator", ["PartialStrategy"], "PartialEvaluator — symbolic / Futamura specialiser"],
      ["Evaluator", ["JitStrategy"], "JitEvaluator — PE ∘ CompileJs ∘ exec"],
    ],
    // expr-substrate Phase 6c — the compile-target codecs demoted Iso →
    // Encodable (decode natives are documented placeholders; the Iso
    // bijectivity laws were unsatisfiable).
    "compile-js": [
      ["Compilable", ["JsModule"], "CompileJs — Fenel → JavaScript"],
      ["Encodable", ["String", "JsModule"], "JsModule → JS source (encode-only)"],
    ],
    "compile-wasm": [
      ["Compilable", ["WasmModule"], "CompileWasm — Fenel → WebAssembly 3.0"],
      ["Encodable", ["Bytes", "WasmModule"], "WasmModule → .wasm bytes (encode-only)"],
    ],
    "compile-llvm": [
      ["Compilable", ["LlvmModule"], "CompileLlvm — Fenel → LLVM IR text"],
      ["Encodable", ["String", "LlvmModule"], "LlvmModule → .ll text (encode-only)"],
    ],
    "decidable-membership": (
      [
        "All", "None", "Enum", "Interval", "Named", "Pattern", "Where", "Union", "Intersect", "Diff", "Complement",
        // The polymorphic shapes that route through `set:contains` and friends.
        "Ctor", "Mu", "Arrow", "Rigid",
      ] as const
    ).map((s) => ["DecidableMembership", [`Set${s}`], `${s} Decidable Membership`] as [string, string[], string]),
  };

  const SRC: Record<string, string> = {
    codec: CODEC_INSTANCES_FENEL,
    prover: PROVER_INSTANCES_FENEL,
    "evaluator-strategies": EVALUATOR_INSTANCES_FENEL,
    "compile-js": COMPILE_JS_INSTANCES_FENEL,
    "compile-wasm": COMPILE_WASM_INSTANCES_FENEL,
    "compile-llvm": COMPILE_LLVM_INSTANCES_FENEL,
    "decidable-membership": DM_INSTANCES_FENEL,
  };

  for (const [area, rows] of Object.entries(EXPECTED)) {
    it(`${area}: every instance carries its restored label, methods label-free`, () => {
      const insts = loadFenelModule(SRC[area]!, area, { dispatchInstanceFile: true }).instances ?? [];
      expect(insts).toHaveLength(rows.length);
      for (const [typeName, args, label] of rows) {
        const inst = insts.find(
          (i) => i.typeName === typeName && JSON.stringify(i.args) === JSON.stringify(args),
        );
        expect(inst, `${area} ${typeName} ${args.join(",")}`).toBeDefined();
        expect(inst!.label).toBe(label);
        expect((inst!.methods as Record<string, unknown>).label).toBeUndefined();
      }
    });
  }
});
