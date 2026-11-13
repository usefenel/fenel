// ---------------------------------------------------------------------------
// Phase 20 — shared helpers for the per-target effect-dispatch self-host
// harnesses. Three concerns:
//
//   1. `buildEffectStubsForFn` — for a given FenelFunction with declared
//      `requires`, walk each constraint, resolve the typeclass instance
//      via `resolveEffect`, and produce two convenience views:
//        - `effectNamespace`: per-class `{ method: fn }` map. Drops
//          straight into `$fenel.$effect.<Class>` for the JS target.
//        - `effectNatives`: flat `{ "$effect:<Class>:<method>": fn }` map
//          suitable for `ctx.natives` so the engine evaluator resolves
//          `$effect:` sentinel calls through the SAME handler functions
//          that the compiled targets will see. This is what makes the
//          engine-vs-compiled byte-equality assertion meaningful.
//
//   2. `buildWasmEffectImports` — walk a compiled WasmModule's imports,
//      resolve each `$effect.<Class>` import via `resolveEffect`, and
//      return the populated `{ "$effect.<Class>": { <method>: fn } }`
//      namespace fed alongside `$fenel` to `WebAssembly.instantiate`.
//      Ported verbatim from `compile-wasm-effects.test.ts`'s inline
//      `buildEffectImports` so future bootstrap code shares one source.
//
//   3. `generateEffectShimC` — auto-generate per-(Class, method) C
//      trampolines from a compiled LlvmModule's `effectImports`. Each
//      trampoline looks up its handler in the global registry populated
//      via `fenel_register_handler` and invokes it. Ported verbatim from
//      `compile-llvm-effects.test.ts`.
//
// Plus two helpers for the candidate-walk side:
//
//   - `requiresOf(fn)` — extract a function's declared Constraint[].
//   - `constraintsToRequiresStrings(requires)` — convert Constraint[] to
//     CompileSource's `requires?: string[]` shape (`"<Class>@<scope>"`).
//
// Brief: `prompts/phase-20-effectful-self-hosting.md`. The wiring is the
// `compile-{wasm,llvm}-effects.test.ts`'s synthetic-body bootstrap pattern
// lifted into each per-target self-host harness so effectful Fenel-bodied
// functions in the registered modules become first-class candidates.
// ---------------------------------------------------------------------------

import { resolveEffect } from "./effect-dispatch";
import type { DispatchRegistry } from "./dispatch-registry";
import type { EvaluateContext } from "./json-logic";
import type { Constraint, FenelFunction } from "./types";
import type { WasmModule, WasmFuncImport } from "./ir/wasm-ast";
import type { LlvmEffectImport } from "./ir/llvm-ast";

// ---------------------------------------------------------------------------
// Constraint introspection — helpers the harness uses to thread declared
// effects from FenelFunction to CompileSource and into the stub-resolution
// path.
// ---------------------------------------------------------------------------

export function requiresOf(fn: FenelFunction): Constraint[] {
  return fn.requires ?? [];
}

/**
 * Produce the `"<Class>@<scope>"` strings that `CompileSource.requires`
 * expects. The scope is taken from `args[0]` — concrete-string args pass
 * through (`["scratch"]` → `"scratch"`); `{$var: "scope"}` passes the
 * variable name through so the compiler's downstream effect-inference
 * + lowering see the same shape they would for hand-written sources.
 *
 * Constraints with no args fall back to the bare class name (no `@scope`),
 * matching the historical free-form requires shape.
 */
export function constraintsToRequiresStrings(
  requires: readonly Constraint[],
): string[] {
  const out: string[] = [];
  for (const c of requires) {
    // Constraint.class is a typed Id<Type>; the class name used in the
    // requires-strings shape IS the entityId (Phase 3.4c — suffix-free).
    const typeName = c.class.entityId;
    const arg = c.args[0];
    if (arg === undefined) {
      out.push(typeName);
    } else if (typeof arg === "string") {
      out.push(`${typeName}@${arg}`);
    } else if (typeof arg === "object" && arg !== null && "$var" in arg) {
      out.push(`${typeName}@${(arg as { $var: string }).$var}`);
    } else {
      out.push(typeName);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stub-resolution — given a function's `requires`, look up each declared
// class's instance and produce both the `$effect`-namespace shape (for the
// JS target / the bootstrap's $fenel runtime) and the `ctx.natives` shape
// (for the engine evaluator's `$effect:` sentinel resolution).
// ---------------------------------------------------------------------------

export type EffectStubs = {
  /** `{ ClassName: { methodName: fn, ... }, ... }` — the per-class method
   *  bag. JS-target compiled bodies invoke `$fenel.$effect.<Class>.<method>(args)`,
   *  which reads through this. */
  effectNamespace: Record<string, Record<string, (...a: unknown[]) => unknown>>;
  /** `{ "$effect:<Class>:<method>": fn, ... }` — flat lookup keyed by the
   *  sentinel fnId. Wired into `ctx.natives` so the engine evaluator's
   *  `invokeFunction` finds the handler when it reaches the `$effect:`
   *  sentinel string in a `{call: [...]}` form. */
  effectNatives: Record<string, (...a: unknown[]) => unknown>;
  /** Class names the function declared. The harness can use this list to
   *  sanity-check / report which capabilities a body needed. */
  typeNames: string[];
};

/**
 * Given a function and its target scope, walk the declared `requires`,
 * resolve each capability through the typeclass registry, and produce
 * the two views the harnesses need.
 *
 * `scopeFor` maps a Constraint to its runtime scope token. Most callers
 * use a fixed token because the bootstrap registers a single instance per
 * class — `() => "scratch"` is the canary's shape; telegram uses `() =>
 * "scope"` to match the `{$var: "scope"}` arg in declared requires.
 */
export function buildEffectStubsForFn(
  fn: FenelFunction,
  ctx: EvaluateContext,
  registry: DispatchRegistry,
  scopeFor: (c: Constraint) => string,
): EffectStubs {
  const effectNamespace: Record<string, Record<string, (...a: unknown[]) => unknown>> = {};
  const effectNatives: Record<string, (...a: unknown[]) => unknown> = {};
  const typeNames: string[] = [];
  for (const c of requiresOf(fn)) {
    // Constraint.class is a typed Id<Type>; the class name for resolveEffect +
    // the namespace/sentinel keys IS the entityId (Phase 3.4c — suffix-free).
    const typeName = c.class.entityId;
    typeNames.push(typeName);
    const scope = scopeFor(c);
    const resolved = resolveEffect(ctx, registry, c.class, scope);
    if (!resolved) {
      throw new Error(
        `buildEffectStubsForFn: no instance for ${typeName} :: ${scope} (required by ${fn.id})`,
      );
    }
    if (effectNamespace[typeName] === undefined) effectNamespace[typeName] = {};
    for (const [methodName, method] of Object.entries(resolved.methods)) {
      if (typeof method !== "function") continue;
      const m = method as (...a: unknown[]) => unknown;
      effectNamespace[typeName]![methodName] = m;
      effectNatives[`$effect:${typeName}:${methodName}`] = m;
    }
  }
  return { effectNamespace, effectNatives, typeNames };
}

// ---------------------------------------------------------------------------
// Wasm — walk the compiled module's imports, resolve each `$effect.<Class>`
// namespace through the registry, populate the bag fed to `WebAssembly.instantiate`.
//
// Verbatim port of `compile-wasm-effects.test.ts`'s `buildEffectImports`.
// ---------------------------------------------------------------------------

export function buildWasmEffectImports(
  mod: WasmModule,
  ctx: EvaluateContext,
  registry: DispatchRegistry,
  scopeToken: string,
): Record<string, Record<string, (...args: unknown[]) => unknown>> {
  const out: Record<string, Record<string, (...args: unknown[]) => unknown>> = {};
  for (const imp of mod.imports) {
    if (imp.$tag !== "WasmFuncImport") continue;
    const fi = imp as WasmFuncImport;
    if (!fi.module.startsWith("$effect.")) continue;
    const typeName = fi.module.slice("$effect.".length);
    const methodName = fi.name;
    const resolved = resolveEffect(ctx, registry, typeName, scopeToken);
    if (!resolved) {
      throw new Error(
        `buildWasmEffectImports: no instance found for ${typeName} :: ${scopeToken}. ` +
          `Compiled module imports it; instantiation can't proceed.`,
      );
    }
    const method = resolved.methods[methodName];
    if (typeof method !== "function") {
      throw new Error(
        `buildWasmEffectImports: ${typeName}.${methodName} is not callable. ` +
          `Available: [${Object.keys(resolved.methods).join(", ")}]`,
      );
    }
    if (out[fi.module] === undefined) out[fi.module] = {};
    out[fi.module]![methodName] = method as (...a: unknown[]) => unknown;
  }
  return out;
}

// ---------------------------------------------------------------------------
// LLVM — auto-generate per-(Class, method) C trampolines that look up
// handlers in the `fenel_register_handler`-populated global registry.
//
// Verbatim port of `compile-llvm-effects.test.ts`'s `generateEffectShimC`.
// The runtime/llvm-rt.c file ships the registry + the lookup primitive.
// ---------------------------------------------------------------------------

export function generateEffectShimC(imports: readonly LlvmEffectImport[]): string {
  const lines: string[] = [
    "/* Auto-generated effect-dispatch C shim — Phase 20 self-host. */",
    "/* One trampoline per (Class, method) declared in the compiled */",
    "/* module's effectImports; each looks up its handler in the global */",
    "/* registry populated via fenel_register_handler and invokes it. */",
    "/* Phase 5b31 — typedefs (FenelHandlerFn / FenelHandlerEntry) come */",
    "/* from CLOSURE_RUNTIME_C, assumed prepended in the surrounding C */",
    "/* context (compileSharedObject writes CLOSURE_RUNTIME_C + this shim */",
    "/* into a single .c file). Redeclaring them here triggers clang's */",
    "/* `typedef redefinition with different types` error. */",
    "#include <stdint.h>",
    "#include <stdlib.h>",
    "",
    "extern FenelHandlerEntry *fenel_lookup_handler(const char *key);",
    "",
  ];
  for (const imp of imports) {
    const key = `${imp.typeName}:${imp.methodName}`;
    const params: string[] = [];
    for (let i = 0; i < imp.arity; i++) params.push(`void *a${i}`);
    const sig = params.length > 0 ? params.join(", ") : "void";
    lines.push(`void *${imp.symbol}(${sig}) {`);
    lines.push(`  FenelHandlerEntry *m = fenel_lookup_handler("${key}");`);
    lines.push(`  if (m == NULL) return NULL;`);
    if (imp.arity === 0) {
      lines.push(`  return m->invoke(m->env, NULL, 0);`);
    } else {
      const initList: string[] = [];
      for (let i = 0; i < imp.arity; i++) initList.push(`a${i}`);
      lines.push(`  void *args[${imp.arity}] = { ${initList.join(", ")} };`);
      lines.push(`  return m->invoke(m->env, args, ${imp.arity});`);
    }
    lines.push(`}`);
    lines.push("");
  }
  return lines.join("\n");
}
