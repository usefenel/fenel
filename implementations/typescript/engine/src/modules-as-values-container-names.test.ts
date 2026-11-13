// ---------------------------------------------------------------------------
// modules-as-values (2026-09-24) — repository containers are identifiers.
//
// design/module-system.md §3: qualified access is dot projection, so the name
// of a bundle has to be an identifier. Five repository containers were not:
// `decidable-membership` held the `set:*` functions (so `set.contains`
// resolved nowhere), and `compile-js`, `compile-llvm`, `compile-wasm` and
// `evaluator-strategies` parse as subtractions. They are now `set`,
// `compileJs`, `compileLlvm`, `compileWasm` and `evaluatorStrategies`; every
// function id is unchanged (`functionNamespace` keeps the hyphenated ones).
//
// The registry loads the five real repository modules (plus `std`). It is
// built without the repository identity lock on purpose: name resolution does
// not depend on it, so a lock row that is still waiting for regeneration (any
// module's) cannot hide a container-name regression here.
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";
import { evaluate } from "./json-logic";
import { parse } from "./fenel-parser";
import { createRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { decidableMembershipModule } from "./modules/decidable-membership";
import { evaluatorStrategiesModule } from "./modules/evaluator-strategies";
import { compileJsModule } from "./modules/compile-js";
import { compileLlvmModule } from "./modules/compile-llvm";
import { compileWasmModule } from "./modules/compile-wasm";

const reg = createRegistry([
  stdModule,
  decidableMembershipModule,
  evaluatorStrategiesModule,
  compileJsModule,
  compileLlvmModule,
  compileWasmModule,
]);
const ctx = reg.evaluateContext();

/** The reference every other route builds for a function: its UUID under the
 * repository lock, else its id. */
const reference = (id: string) => ({ $ref: ctx._uuidBySlug?.get(id) ?? id });

const MEMBERS = [
  ["set", "contains", "set:contains"],
  ["evaluatorStrategies", "eagerEval", "evaluator-strategies:eagerEval"],
  ["compileJs", "compileFenelToJs", "compile-js:compileFenelToJs"],
  ["compileLlvm", "compileFenelToLlvm", "compile-llvm:compileFenelToLlvm"],
  ["compileWasm", "compileFenelToWasm", "compile-wasm:compileFenelToWasm"],
] as const;

describe("renamed containers resolve dotted to the unchanged function ids", () => {
  test("each container lists the member", () => {
    for (const [bundle, member] of MEMBERS) {
      expect(reg.listModuleMembers(bundle), bundle).toContain(member);
    }
  });

  test("a dotted name in call-head position reaches the function id", () => {
    for (const [bundle, member, id] of MEMBERS) {
      expect(reg.getFunction(id)?.id, id).toBe(id);
      expect(reg.getFunction(`${bundle}.${member}`)?.id, `${bundle}.${member}`).toBe(id);
    }
  });

  test("a dotted member used as a value is the function's reference", () => {
    for (const [bundle, member, id] of MEMBERS) {
      expect(evaluate(parse(`${bundle}.${member}`), {}, ctx), `${bundle}.${member}`)
        .toEqual(reference(id));
    }
  });

  test("a dotted call runs the member", () => {
    const data = { s: { $enum: [1, 2, 3] } };
    expect(evaluate(parse("set.contains s 2"), data, ctx)).toEqual({ $tag: "Just", _0: true });
    expect(evaluate(parse("set.contains s 9"), data, ctx)).toEqual({ $tag: "Just", _0: false });
  });
});

describe("the retired container spellings name nothing", () => {
  test("no member index answers them", () => {
    for (const retired of [
      "decidable-membership",
      "compile-js",
      "compile-llvm",
      "compile-wasm",
      "evaluator-strategies",
    ]) {
      expect(reg.listModuleMembers(retired), retired).toEqual([]);
    }
  });

  test("the old qualified spellings no longer resolve", () => {
    expect(reg.getFunction("decidable-membership.contains")).toBeUndefined();
    expect(reg.getFunction("decidable-membership:contains")).toBeUndefined();
    expect(reg.getFunction("evaluator-strategies.eagerEval")).toBeUndefined();
    expect(reg.getFunction("compile-js.compileFenelToJs")).toBeUndefined();
    expect(reg.getFunction("compile-llvm.compileFenelToLlvm")).toBeUndefined();
    expect(reg.getFunction("compile-wasm.compileFenelToWasm")).toBeUndefined();
  });

  test("the reserved namespaces keep every function-id prefix", () => {
    const reserved = new Set(reg.listReservedNamespaces());
    for (const name of [
      "set",
      "compileJs",
      "compileLlvm",
      "compileWasm",
      "evaluatorStrategies",
      "compile-js",
      "compile-llvm",
      "compile-wasm",
      "evaluator-strategies",
    ]) {
      expect(reserved.has(name), name).toBe(true);
    }
    expect(reserved.has("decidable-membership")).toBe(false);
  });
});
