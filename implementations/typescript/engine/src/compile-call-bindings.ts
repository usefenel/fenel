// BOUNDARY-ADAPTER
import type { FenelModule } from "./types";
import type { ModuleRegistry } from "./registry";

/** Explicit lexical call bindings supplied to the compiler front-end.
 *
 * TypeScript only projects the defining module's declaration roster. The
 * Fenel normalisation pass owns lookup and rewriting of a bare call head to
 * its canonical full function id.
 */
export type CompileCallBindings = Readonly<Record<string, string>>;

export type CompileCallBindingOptions = {
  /** Bare names whose target is selected dynamically by a projected routing
   * verdict. The caller supplies the verdict; this mechanical builder never
   * derives dispatchability from declaration collisions. */
  readonly preserveBare?: ReadonlySet<string>;
};

const compilerOwnedCallBindings = new WeakSet<object>();

// Compiler-generated list literals lower through the irreducible short
// `appendItem` runtime helper. Binding that spelling to the bodied
// `std:appendItem` would make its own `concat arr [item]` body call itself
// forever after `[item]` is lowered. Keep the exception at the shared binding
// boundary so production artifacts and every self-host target agree.
const COMPILER_SHORT_RUNTIME_FN_IDS = new Set(["std:appendItem"]);

/** Build the immutable bare-name -> full-fnId index for one defining module. */
export function compileModuleCallBindings(
  definingModule: Pick<FenelModule, "name" | "functions">,
  options: CompileCallBindingOptions = {},
): CompileCallBindings {
  if (definingModule.name.length === 0) {
    throw new Error("compiler call bindings: module name must be non-empty");
  }
  const prefix = `${definingModule.name}:`;
  const bindings: Record<string, string> = Object.create(null) as Record<string, string>;
  const declarations = new Set<string>();
  for (const fn of definingModule.functions ?? []) {
    if (!fn.id.startsWith(prefix)) {
      throw new Error(
        `compiler call bindings: function ${JSON.stringify(fn.id)} is not owned by module ${JSON.stringify(definingModule.name)}`,
      );
    }
    const name = fn.id.slice(prefix.length);
    if (name.length === 0) {
      throw new Error(`compiler call bindings: function id ${JSON.stringify(fn.id)} has an empty local name`);
    }
    if (declarations.has(name)) {
      throw new Error(
        `compiler call bindings: duplicate local declaration ${JSON.stringify(name)} in module ${JSON.stringify(definingModule.name)}`,
      );
    }
    declarations.add(name);
    // Native/IO declarations are target-runtime imports, not Fenel lexical
    // definitions. Keeping them bare preserves each target's explicit native
    // ABI mapping; body-owned definitions receive canonical full ids here.
    if (
      fn.body === undefined
      || COMPILER_SHORT_RUNTIME_FN_IDS.has(fn.id)
      || options.preserveBare?.has(name) === true
    ) continue;
    bindings[name] = fn.id;
  }
  Object.freeze(bindings);
  compilerOwnedCallBindings.add(bindings);
  return bindings;
}

/** Project aggregate/union module rosters by the owner encoded in each fnId.
 * Some generated module values intentionally union declarations from several
 * semantic owners; grouping is mechanical and each resulting namespace still
 * passes through the fail-closed single-module builder above. */
export function compileCallBindingsByFnId(
  modules: ReadonlyArray<Pick<FenelModule, "functions">>,
  options: CompileCallBindingOptions = {},
): ReadonlyMap<string, CompileCallBindings> {
  const functionsByOwner = new Map<string, NonNullable<FenelModule["functions"]>>();
  for (const candidateModule of modules) {
    for (const fn of candidateModule.functions ?? []) {
      const separator = fn.id.indexOf(":");
      if (separator <= 0 || separator === fn.id.length - 1) {
        throw new Error(
          `compiler call bindings: function ${JSON.stringify(fn.id)} has no full owner:name id`,
        );
      }
      const owner = fn.id.slice(0, separator);
      const functions = functionsByOwner.get(owner) ?? [];
      functions.push(fn);
      functionsByOwner.set(owner, functions);
    }
  }
  const byFnId = new Map<string, CompileCallBindings>();
  for (const [owner, functions] of functionsByOwner) {
    const bindings = compileModuleCallBindings({ name: owner, functions }, options);
    for (const fn of functions) byFnId.set(fn.id, bindings);
  }
  return byFnId;
}

/** Registry views also contain constructor Functions and callable Type-owner
 * projections. Their existing owner metadata carries their exact identities;
 * they are not source declarations in the emitter's lexical function roster. */
export function compileRegistryDeclarationCallBindings(
  registry: Pick<ModuleRegistry, "listFunctions" | "listConstructorSignatures">
    & Partial<Pick<ModuleRegistry, "getEntityNominalIdentity">>,
  options: CompileCallBindingOptions = {},
): ReadonlyMap<string, CompileCallBindings> {
  const constructors = new Set(registry.listConstructorSignatures().flatMap(row =>
    row.functionId === undefined ? [] : [row.functionId]));
  return compileCallBindingsByFnId([{ functions: registry.listFunctions()
    .filter(fn => !constructors.has(fn.id) && registry.getEntityNominalIdentity?.(fn.id) === undefined) }], options);
}

/** Fast-path marker for compiler-created, immutable binding indexes. */
export function isCompilerOwnedCallBindings(value: unknown): value is CompileCallBindings {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && compilerOwnedCallBindings.has(value);
}
