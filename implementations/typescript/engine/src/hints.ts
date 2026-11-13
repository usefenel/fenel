// ---------------------------------------------------------------------------
// Static analysis hints — parallelism detection for expressions
//
// Analyzes expression trees to find independent IO-yielding bindings
// that could run concurrently. Returns hints, NOT transforms —
// the user/UI decides whether to act on them.
// ---------------------------------------------------------------------------

import type { ModuleRegistry } from "./registry";
import type { EvaluateContext } from "./json-logic";

export type ParallelismHint = {
  kind: "parallel_bindings";
  bindings: string[];
  message: string;
};

export type Hint = ParallelismHint;

function freeVars(expr: unknown): Set<string> {
  const vars = new Set<string>();

  function walk(e: unknown): void {
    if (e == null || typeof e !== "object") return;
    if (Array.isArray(e)) { e.forEach(walk); return; }

    const obj = e as Record<string, unknown>;

    if ("var" in obj && typeof obj.var === "string") {
      vars.add(obj.var.split(".")[0]!);
      return;
    }

    if ("call" in obj && Array.isArray(obj.call)) {
      for (let i = 1; i < obj.call.length; i++) walk(obj.call[i]);
      return;
    }

    if ("do" in obj && Array.isArray(obj.do)) { obj.do.forEach(walk); return; }
    if ("let" in obj && typeof obj.let === "object" && obj.let) {
      Object.values(obj.let as Record<string, unknown>).forEach(walk);
      return;
    }
    if ("if" in obj && Array.isArray(obj.if)) { obj.if.forEach(walk); return; }
    if ("match" in obj && Array.isArray(obj.match)) { obj.match.forEach(walk); return; }
    if ("where" in obj && Array.isArray(obj.where)) { obj.where.forEach(walk); return; }
    if ("ann" in obj && Array.isArray(obj.ann)) { walk(obj.ann[0]); return; }

    for (const v of Object.values(obj)) walk(v);
  }

  walk(expr);
  return vars;
}

function isIOCall(
  expr: unknown,
  reg?: ModuleRegistry,
  ctx?: EvaluateContext,
): boolean {
  if (expr == null || typeof expr !== "object") return false;
  const obj = expr as Record<string, unknown>;
  if (!("call" in obj) || !Array.isArray(obj.call)) return false;

  const fnName = obj.call[0] as string;

  if (reg) {
    if (ctx?.natives?.[fnName]) return false;
    const fn = reg.getFunction(fnName);
    if (fn?.body) return false;
    if (fn) return true;
  }

  return true;
}

function analyzeLetBlock(
  bindings: Record<string, unknown>,
  reg?: ModuleRegistry,
  ctx?: EvaluateContext,
): ParallelismHint | null {
  const entries = Object.entries(bindings);
  if (entries.length < 2) return null;

  const ioBindings: { name: string; deps: Set<string> }[] = [];
  for (const [name, expr] of entries) {
    if (!isIOCall(expr, reg, ctx)) continue;
    ioBindings.push({ name, deps: freeVars(expr) });
  }

  if (ioBindings.length < 2) return null;

  const defined = new Set<string>();
  const independentGroup: string[] = [];

  for (const binding of ioBindings) {
    const dependsOnPrior = [...binding.deps].some((d) => defined.has(d));
    if (!dependsOnPrior) independentGroup.push(binding.name);
    defined.add(binding.name);
  }

  if (independentGroup.length < 2) return null;

  return {
    kind: "parallel_bindings",
    bindings: independentGroup,
    message: `${independentGroup.join(", ")} are independent IO calls — could use parallel() for concurrent execution`,
  };
}

export function collectHints(
  expr: unknown,
  reg?: ModuleRegistry,
  ctx?: EvaluateContext,
): Hint[] {
  const hints: Hint[] = [];

  function walk(e: unknown): void {
    if (e == null || typeof e !== "object") return;
    if (Array.isArray(e)) { e.forEach(walk); return; }

    const obj = e as Record<string, unknown>;

    if ("let" in obj && typeof obj.let === "object" && obj.let) {
      const hint = analyzeLetBlock(obj.let as Record<string, unknown>, reg, ctx);
      if (hint) hints.push(hint);
      Object.values(obj.let as Record<string, unknown>).forEach(walk);
      return;
    }

    if ("do" in obj && Array.isArray(obj.do)) {
      const consecutive: { name: string; expr: unknown }[] = [];
      for (const step of obj.do) {
        if (step && typeof step === "object" && "let" in (step as any)) {
          const letObj = (step as any).let as Record<string, unknown>;
          for (const [name, valExpr] of Object.entries(letObj)) {
            if (isIOCall(valExpr, reg, ctx)) {
              consecutive.push({ name, expr: valExpr });
            } else {
              flushConsecutive(consecutive, hints, reg, ctx);
            }
          }
        } else {
          flushConsecutive(consecutive, hints, reg, ctx);
        }
        walk(step);
      }
      flushConsecutive(consecutive, hints, reg, ctx);
      return;
    }

    if ("if" in obj && Array.isArray(obj.if)) { obj.if.forEach(walk); return; }
    if ("match" in obj && Array.isArray(obj.match)) { obj.match.forEach(walk); return; }
    if ("where" in obj && Array.isArray(obj.where)) { obj.where.forEach(walk); return; }
    if ("ann" in obj && Array.isArray(obj.ann)) { walk(obj.ann[0]); return; }
    if ("call" in obj && Array.isArray(obj.call)) {
      for (let i = 1; i < obj.call.length; i++) walk(obj.call[i]);
      return;
    }
  }

  walk(expr);
  return hints;
}

function flushConsecutive(
  items: { name: string; expr: unknown }[],
  hints: Hint[],
  _reg?: ModuleRegistry,
  _ctx?: EvaluateContext,
): void {
  if (items.length < 2) { items.length = 0; return; }

  const deps = items.map((it) => ({ name: it.name, deps: freeVars(it.expr) }));
  const defined = new Set<string>();
  const independentGroup: string[] = [];

  for (const d of deps) {
    const dependsOnPrior = [...d.deps].some((v) => defined.has(v));
    if (!dependsOnPrior) independentGroup.push(d.name);
    defined.add(d.name);
  }

  if (independentGroup.length >= 2) {
    hints.push({
      kind: "parallel_bindings",
      bindings: independentGroup,
      message: `${independentGroup.join(", ")} are consecutive independent IO calls — could use parallel() for concurrent execution`,
    });
  }

  items.length = 0;
}
