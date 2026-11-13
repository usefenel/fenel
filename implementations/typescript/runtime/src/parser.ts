import { parse as parseYaml } from "yaml";
import type { Expression } from "@fenel/engine/types";
import type { FunctionDocument, RawFunctionDef, FunctionDef } from "./types";

/**
 * Parse a YAML string into a FunctionDocument.
 */
export function parseDocument(yamlStr: string): FunctionDocument {
  return parseYaml(yamlStr) as FunctionDocument;
}

/**
 * Extract and normalize all function definitions from a parsed document.
 */
export function extractFunctions(doc: FunctionDocument): FunctionDef[] {
  if (!doc.functions) return [];
  return Object.entries(doc.functions).map(([slug, raw]) =>
    normalizeFunction(slug, raw),
  );
}

/**
 * Normalize a raw function definition into evaluator-ready form.
 * If the raw def has a `program` field, use it directly.
 * Otherwise, convert legacy steps/branches into an Expression program.
 */
export function normalizeFunction(slug: string, raw: RawFunctionDef): FunctionDef {
  if (raw.program) {
    return {
      slug,
      trigger: raw.trigger,
      args: raw.args,
      cancelWhen: raw.cancel_when,
      program: raw.program,
    };
  }

  const exprs: unknown[] = [];

  if (raw.on_start) {
    for (const rawStep of raw.on_start) {
      const e = rawStepToExpr(rawStep);
      if (e != null) exprs.push(e);
    }
  }

  if (raw.branches) {
    const branchExpr = branchesToExpr(raw.branches);
    if (branchExpr != null) exprs.push(branchExpr);
  }

  if (raw.steps) {
    for (const rawStep of raw.steps) {
      const e = rawStepToExpr(rawStep);
      if (e != null) exprs.push(e);
    }
  }

  return {
    slug,
    trigger: raw.trigger,
    args: raw.args,
    cancelWhen: raw.cancel_when,
    program: { do: exprs } as Expression,
  };
}

// ---------------------------------------------------------------------------
// Raw YAML step → Expression conversion
// ---------------------------------------------------------------------------

function rawStepToExpr(raw: Record<string, unknown>): unknown {
  if ("action" in raw) {
    const name = raw["action"] as string;
    const params: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (k !== "action") params[k] = v;
    }
    if (name === "end_function") return { call: ["end_function"] };
    return { call: [name, params] };
  }

  if ("wait" in raw && typeof raw["wait"] === "string") {
    return { call: ["sleep", { duration: raw["wait"] }] };
  }

  if ("wait_for" in raw) {
    const wf = raw["wait_for"] as Record<string, unknown>;
    const event = wf["event"] as string;
    return { call: ["read", { type: { $record: { fields: [] } }, source: `event:${event}` }] };
  }

  if ("wait_until" in raw) {
    return { call: ["sleep", { duration: raw["wait_until"] }] };
  }

  if ("branch" in raw) {
    const arms = raw["branch"] as Record<string, unknown>[];
    return armsToExpr(arms);
  }

  if ("choose" in raw) {
    const ch = raw["choose"] as Record<string, unknown>;
    const options = (ch["options"] as Record<string, unknown>[]) ?? [];
    const readExpr = {
      let: { _choice: { call: ["read", { options: options.map((o) => ({ id: o["id"], label: o["label"] })) }] } },
    };
    let branch: unknown = null;
    for (let i = options.length - 1; i >= 0; i--) {
      const opt = options[i]!;
      const body = { do: ((opt["steps"] as Record<string, unknown>[]) ?? []).map(rawStepToExpr).filter(Boolean) };
      if (branch === null) {
        branch = body;
      } else {
        branch = { if: [{ "==": [{ var: "_choice" }, opt["id"]] }, body, branch] };
      }
    }
    return { do: [readExpr, branch].filter(Boolean) };
  }

  if ("call_function" in raw) {
    const functionName = raw["call_function"] as string;
    const args = (raw["args"] as Record<string, unknown>) ?? {};
    return Object.keys(args).length > 0 ? { call: [functionName, args] } : { call: [functionName] };
  }

  if ("set" in raw) {
    return { let: raw["set"] };
  }

  if ("scope" in raw) {
    const s = raw["scope"] as Record<string, unknown>;
    const vars = (s["vars"] as Record<string, unknown>) ?? {};
    const inner = ((s["steps"] as Record<string, unknown>[]) ?? []).map(rawStepToExpr).filter(Boolean);
    const bindings = Object.entries(vars).map(([k, v]) => ({ let: { [k]: v } }));
    return { do: [...bindings, ...inner] };
  }

  if (Object.keys(raw).length === 0) return null;

  throw new Error(`Unknown step type: ${JSON.stringify(Object.keys(raw))}`);
}

function armsToExpr(arms: Record<string, unknown>[]): unknown {
  if (arms.length === 0) return null;
  let result: unknown = null;
  for (let i = arms.length - 1; i >= 0; i--) {
    const arm = arms[i]!;
    const body = { do: ((arm["steps"] as Record<string, unknown>[]) ?? []).map(rawStepToExpr).filter(Boolean) };
    if (i === arms.length - 1) {
      result = { if: [arm["when"], body] };
    } else {
      result = { if: [arm["when"], body, result] };
    }
  }
  return result;
}

function branchesToExpr(branches: { id: string; when: string | Expression; steps: Record<string, unknown>[] }[]): unknown {
  if (branches.length === 0) return null;
  let result: unknown = null;
  for (let i = branches.length - 1; i >= 0; i--) {
    const arm = branches[i]!;
    const body = { do: arm.steps.map(rawStepToExpr).filter(Boolean) };
    if (i === branches.length - 1) {
      result = { if: [arm.when, body] };
    } else {
      result = { if: [arm.when, body, result] };
    }
  }
  return result;
}
