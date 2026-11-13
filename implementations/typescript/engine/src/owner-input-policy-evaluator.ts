/** Existing canonical structural evaluator, with NO registry/harness/resolver.
 * The caller must arm its cold/producer scope before importing engine modules.
 * Policy source is a captured reviewed input, never injected Boolean answers.
 */
export async function loadOwnerInputPolicy(source: string): Promise<Readonly<{
  invoke(id: string, args: readonly unknown[]): unknown;
}>> {
  const { loadFenelModule } = await import("./fenel-module");
  const { evaluate } = await import("./json-logic");
  const policy = loadFenelModule(source, "ownerinputpolicy");
  return Object.freeze({ invoke(id: string, args: readonly unknown[]): unknown {
    const fn = policy.functions?.find(candidate => candidate.id === id);
    if (fn === undefined || fn.body === undefined || fn.params.length !== args.length) throw new Error(`owner policy lacks exact body/arity ${id}`);
    const bindings: Record<string, unknown> = Object.create(null);
    fn.params.forEach((param, index) => {
      if (Object.hasOwn(bindings, param.name)) throw new Error("owner policy repeats a parameter");
      Object.defineProperty(bindings, param.name, { value: args[index], enumerable: true });
    });
    return evaluate(fn.body, bindings, {});
  } });
}
