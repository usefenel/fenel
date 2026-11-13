// Function editor types
// Condition types (WaitCondition, BranchCondition) live in @fenel/engine.
// Function-specific types (FunctionStep, etc.) remain here.
// Expression conversion (stepToExpr, programToSteps) bridges visual model ↔ runtime.

// ---------------------------------------------------------------------------
// Re-export condition types from the universal engine
// ---------------------------------------------------------------------------

export type { WaitCondition, BranchCondition } from "@fenel/engine/compile";
export { branchToExpr, exprToBranch, waitToExpr, exprToWait } from "@fenel/engine/compile";

import type { BranchCondition, WaitCondition as _WaitCondition } from "@fenel/engine/compile";
import { branchToExpr, exprToBranch } from "@fenel/engine/compile";
import type { Expression } from "@fenel/engine/types";
import { For } from "solid-js";
type WaitCondition = _WaitCondition;

/** Convert a legacy string `when` to a BranchCondition */
export function migrateBranchWhen(when: string | BranchCondition): BranchCondition {
  if (typeof when !== "string") return when;
  if (when === "true" || when === "") return { op: "compare", field: "", cmp: "==", value: "" };
  return { op: "expr", expression: when };
}

/** Short display label for a BranchCondition */
export function branchConditionLabel(c: BranchCondition): string {
  switch (c.op) {
    case "compare": {
      if (!c.field && !c.value) return "...";
      const f = c.field || "?";
      const v = c.value || "?";
      return `${f} ${c.cmp} ${v}`;
    }
    case "expr":
      return c.expression || "...";
    case "and":
      return c.children.map(branchConditionLabel).join(" AND ");
    case "or":
      return c.children.map(branchConditionLabel).join(" OR ");
  }
}

// ---------------------------------------------------------------------------
// Step types
// ---------------------------------------------------------------------------

export type FunctionStep =
  | ActionStep
  | WaitStep
  | SetStep
  | ScopeStep
  | BranchStep
  | ChooseStep
  | CallFunctionStep;

export type ActionStep = {
  type: "action";
  name: string;
  params: Record<string, unknown>;
};

export type WaitStep = {
  type: "wait";
  condition: WaitCondition;
};

/** Mutates variables in the nearest scope */
export type SetStep = {
  type: "set";
  assignments: Record<string, string>;
};

/** Creates a local variable scope — child steps see parent vars but set writes locally.
 *  Use `$flow.varName` in expressions to write to the root flow scope. */
export type ScopeStep = {
  type: "scope";
  vars: Record<string, string>;
  steps: FunctionStep[];
};

export type BranchStep = {
  type: "branch";
  arms: { id: string; label?: string; when: BranchCondition; steps: FunctionStep[] }[];
};

export type ChooseStep = {
  type: "choose";
  notify: { channel: string; message: string };
  options: { id: string; label: string; steps: FunctionStep[] }[];
};

export type CallFunctionStep = {
  type: "call_function";
  /** "self" for recursion, or a function name for external calls */
  flow: string;
  args: Record<string, unknown>;
  /** Safety limit for recursive calls (default: 100) */
  max_depth?: number;
};

export type StepPath = (number | string)[];

export type StepType = FunctionStep["type"];

/** Layout direction for the function canvas */
export type FunctionDirection = "LR" | "RL" | "TB" | "BT";

export const FUNCTION_DIRECTIONS: { value: FunctionDirection; label: string }[] = [
  { value: "LR", label: "Left → Right" },
  { value: "TB", label: "Top → Bottom" },
  { value: "BT", label: "Bottom → Top" },
  { value: "RL", label: "Right → Left" },
];

/** Whether a direction flows horizontally */
export function isHorizontal(dir: FunctionDirection): boolean {
  return dir === "LR" || dir === "RL";
}

/** Whether a direction is reversed (content renders in opposite order) */
export function isReversed(dir: FunctionDirection): boolean {
  return dir === "RL" || dir === "BT";
}

/** The cross-axis direction for branch arms (perpendicular to main flow) */
export function crossDirection(dir: FunctionDirection): "row" | "column" {
  return isHorizontal(dir) ? "column" : "row";
}

/** Preset keys used in the add-step menu (map to initial WaitCondition) */
export type WaitPreset = "wait_duration" | "wait_event" | "wait_date";

export const STEP_TYPES: { value: string; label: string }[] = [
  { value: "action", label: "Action" },
  { value: "wait_duration", label: "Wait (duration)" },
  { value: "wait_event", label: "Wait for event" },
  { value: "wait_date", label: "Wait until date" },
  { value: "branch", label: "Branch (conditions)" },
  { value: "choose", label: "Choose (user picks)" },
  { value: "call_function", label: "Call sub-function" },
];

export const STEP_TYPE_GROUPS: { title: string | null; items: { value: string; label: string }[] }[] = [
  { title: null, items: [
    { value: "action", label: "Action" },
    { value: "set", label: "Set variable" },
    { value: "scope", label: "Scope (local vars)" },
  ]},
  { title: "Wait", items: [
    { value: "wait_duration", label: "Duration" },
    { value: "wait_event", label: "For event" },
    { value: "wait_date", label: "Until date" },
  ]},
  { title: "Routing", items: [
    { value: "branch", label: "Branch (conditions)" },
    { value: "choose", label: "Choose (user picks)" },
  ]},
  { title: null, items: [
    { value: "call_function", label: "Call sub-function" },
    { value: "call_self", label: "Recurse (call self)" },
  ]},
];

/** Create a blank step of the given type (or wait preset) */
export function createBlankStep(type: string): FunctionStep {
  switch (type) {
    case "action":
      return { type: "action", name: "", params: {} };
    case "wait":
    case "wait_duration":
      return { type: "wait", condition: { op: "duration", value: "1h" } };
    case "wait_event":
      return { type: "wait", condition: { op: "event", event: "", filters: {} } };
    case "wait_date":
      return { type: "wait", condition: { op: "date", expression: "" } };
    case "branch":
      return {
        type: "branch",
        arms: [{ id: crypto.randomUUID(), label: "Arm 1", when: { op: "compare", field: "", cmp: "==", value: "" }, steps: [] }],
      };
    case "choose":
      return {
        type: "choose",
        notify: { channel: "", message: "" },
        options: [{ id: crypto.randomUUID(), label: "Option 1", steps: [] }],
      };
    case "set":
      return { type: "set", assignments: {} };
    case "scope":
      return { type: "scope", vars: {}, steps: [] };
    case "call_function":
      return { type: "call_function", flow: "", args: {} };
    case "call_self":
      return { type: "call_function", flow: "self", args: {}, max_depth: 100 };
    default:
      return { type: "action", name: "", params: {} };
  }
}

/** Human-readable summary of a WaitCondition (for step labels) */
export function conditionLabel(c: WaitCondition): string {
  const rep = (c as any).repeat ? " ↻" : ""; // ↻ repeat symbol
  switch (c.op) {
    case "duration":
      return (c.repeat ? "every " : "") + (c.value || "...");
    case "event":
      return (c.event ? humanizeStr(c.event) : "event") + rep;
    case "date":
      return (c.expression || "date") + rep;
    case "and":
      return c.children.map(conditionLabel).join(" AND ");
    case "or":
      return c.children.map(conditionLabel).join(" OR ");
  }
}

function humanizeStr(s: string): string {
  if (!s) return "";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// FunctionStep[] ↔ Expression conversion
// ---------------------------------------------------------------------------

export function stepToExpr(step: FunctionStep): Expression {
  switch (step.type) {
    case "action": {
      if (step.name === "end_function") return { call: ["end_function"] };
      const hasParams = Object.keys(step.params).length > 0;
      return hasParams ? { call: [step.name, step.params] } : { call: [step.name] };
    }
    case "wait": {
      const cond = step.condition;
      if (cond.op === "event") {
        return { call: ["read", { type: { $record: { fields: [] } }, source: `event:${cond.event}` }] };
      }
      if (cond.op === "duration") {
        return { call: ["sleep", { duration: cond.value }] };
      }
      if (cond.op === "date") {
        return { call: ["sleep", { duration: cond.expression }] };
      }
      return { call: ["sleep", waitToParams(cond)] };
    }
    case "set":
      return { let: step.assignments };
    case "scope": {
      const bindings = Object.entries(step.vars).map(([k, v]) => ({ let: { [k]: v } }));
      return { do: [...bindings, ...step.steps.map(stepToExpr)] };
    }
    case "branch": {
      let result: unknown = null;
      for (let i = step.arms.length - 1; i >= 0; i--) {
        const arm = step.arms[i]!;
        const body = { do: arm.steps.map(stepToExpr) };
        const cond = branchToExpr(arm.when);
        result = i === step.arms.length - 1
          ? { if: [cond, body] }
          : { if: [cond, body, result] };
      }
      return (result ?? { do: [] }) as Expression;
    }
    case "choose": {
      const options = step.options.map(o => ({ id: o.id, label: o.label }));
      const readExpr = { let: { _choice: { call: ["read", { options }] } } };
      let branch: unknown = null;
      for (let i = step.options.length - 1; i >= 0; i--) {
        const opt = step.options[i]!;
        const body = { do: opt.steps.map(stepToExpr) };
        branch = branch === null
          ? body
          : { if: [{ "==": [{ var: "_choice" }, opt.id] }, body, branch] };
      }
      return { do: [readExpr, branch].filter(Boolean) } as Expression;
    }
    case "call_function": {
      const params: Record<string, unknown> = { flow: step.flow };
      if (Object.keys(step.args).length > 0) params.args = step.args;
      if (step.max_depth != null) params.max_depth = step.max_depth;
      return { call: ["call_function", params] };
    }
  }
}

export function stepsToProgram(steps: FunctionStep[]): Expression {
  return { do: steps.map(stepToExpr) };
}

export function programToSteps(program: Expression): FunctionStep[] {
  if (!program || typeof program !== "object") return [];
  if ("do" in program && Array.isArray(program.do)) {
    return (program.do as unknown[]).map(exprToStep);
  }
  return [exprToStep(program)];
}

function exprToStep(expr: unknown): FunctionStep {
  if (!expr || typeof expr !== "object") return { type: "action", name: "", params: {} };
  const e = expr as Record<string, unknown>;

  if ("call" in e && Array.isArray(e.call)) {
    const args = e.call as unknown[];
    const name = args[0] as string;
    const params = (args[1] as Record<string, unknown>) ?? {};
    if (name === "wait") return { type: "wait", condition: paramsToWait(params) };
    if (name === "sleep") {
      if ("or" in params || "and" in params) return { type: "wait", condition: paramsToWait(params) };
      return { type: "wait", condition: { op: "duration", value: (params.duration as string) ?? "1h" } };
    }
    if (name === "read" && typeof params.source === "string" && (params.source as string).startsWith("event:")) {
      return { type: "wait", condition: { op: "event", event: (params.source as string).slice(6), filters: {} } };
    }
    if (name === "call_function") {
      const result: CallFunctionStep = { type: "call_function", flow: (params.flow as string) ?? "", args: (params.args as Record<string, unknown>) ?? {} };
      if (params.max_depth != null) result.max_depth = params.max_depth as number;
      return result;
    }
    return { type: "action", name, params };
  }

  if ("let" in e) {
    const bindings = e.let as Record<string, unknown>;
    const assignments: Record<string, string> = {};
    for (const [k, v] of Object.entries(bindings)) {
      assignments[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
    return { type: "set", assignments };
  }

  if ("if" in e && Array.isArray(e.if)) {
    return {
      type: "branch",
      arms: collectIfArms(e).map(arm => ({
        id: crypto.randomUUID(),
        label: "",
        when: exprToBranch((arm.cond === true ? { "==": [true, true] } : arm.cond) as Expression),
        steps: exprToBodySteps(arm.body),
      })),
    };
  }

  if ("do" in e && Array.isArray(e.do)) {
    const items = e.do as unknown[];
    const choose = tryParseChoose(items);
    if (choose) return choose;
    const scope = tryParseScope(items);
    if (scope) return scope;
    if (items.length === 1) return exprToStep(items[0]);
    return { type: "scope", vars: {}, steps: items.map(exprToStep) };
  }

  return { type: "action", name: "", params: {} };
}

function collectIfArms(e: Record<string, unknown>): { cond: unknown; body: unknown }[] {
  if (!("if" in e) || !Array.isArray(e.if)) return [];
  const [cond, body, elseExpr] = e.if as unknown[];
  const arm = { cond, body };
  if (elseExpr && typeof elseExpr === "object" && "if" in (elseExpr as Record<string, unknown>)) {
    return [arm, ...collectIfArms(elseExpr as Record<string, unknown>)];
  }
  if (elseExpr != null) return [arm, { cond: true, body: elseExpr }];
  return [arm];
}

function exprToBodySteps(body: unknown): FunctionStep[] {
  if (!body || typeof body !== "object") return [];
  const b = body as Record<string, unknown>;
  if ("do" in b && Array.isArray(b.do)) return (b.do as unknown[]).map(exprToStep);
  return [exprToStep(body)];
}

function tryParseChoose(items: unknown[]): ChooseStep | null {
  if (items.length !== 2) return null;
  const first = items[0] as Record<string, unknown>;
  if (!first || !("let" in first)) return null;
  const bindings = first.let as Record<string, unknown>;
  if (!bindings || !("_choice" in bindings)) return null;
  const choiceExpr = bindings._choice as Record<string, unknown>;
  if (!choiceExpr || !("call" in choiceExpr)) return null;
  const callArgs = choiceExpr.call as unknown[];
  if (callArgs[0] !== "read") return null;
  const readParams = (callArgs[1] as Record<string, unknown>) ?? {};
  const rawOptions = (readParams.options as { id: string; label: string }[]) ?? [];

  const options: { id: string; label: string; steps: FunctionStep[] }[] = [];
  let current = items[1] as Record<string, unknown>;
  for (let i = 0; i < rawOptions.length; i++) {
    const opt = rawOptions[i]!;
    if (i === rawOptions.length - 1) {
      options.push({ id: opt.id, label: opt.label, steps: exprToBodySteps(current) });
    } else if (current && "if" in current && Array.isArray(current.if)) {
      const ifArr = current.if as unknown[];
      options.push({ id: opt.id, label: opt.label, steps: exprToBodySteps(ifArr[1]) });
      current = (ifArr[2] ?? {}) as Record<string, unknown>;
    } else {
      options.push({ id: opt.id, label: opt.label, steps: exprToBodySteps(current) });
    }
  }
  return { type: "choose", notify: { channel: "", message: "" }, options };
}

function tryParseScope(items: unknown[]): ScopeStep | null {
  const vars: Record<string, string> = {};
  let firstNonLet = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as Record<string, unknown>;
    if (!item || !("let" in item)) { firstNonLet = i; break; }
    const entries = Object.entries(item.let as Record<string, unknown>);
    if (!entries.every(([, v]) => typeof v === "string")) { firstNonLet = i; break; }
    for (const [k, v] of entries) vars[k] = v as string;
    firstNonLet = i + 1;
  }
  if (Object.keys(vars).length === 0 || firstNonLet >= items.length) return null;
  return { type: "scope", vars, steps: items.slice(firstNonLet).map(exprToStep) };
}

function waitToParams(cond: WaitCondition): Record<string, unknown> {
  switch (cond.op) {
    case "duration": return { duration: cond.value };
    case "event": return { event: cond.event, ...(cond.filters ? { filters: cond.filters } : {}) };
    case "date": return { date: cond.expression };
    case "and": return { and: cond.children.map(waitToParams) };
    case "or": return { or: cond.children.map(waitToParams) };
  }
}

function paramsToWait(params: Record<string, unknown>): WaitCondition {
  if ("duration" in params) return { op: "duration", value: params.duration as string };
  if ("event" in params) return { op: "event", event: params.event as string, filters: (params.filters as Record<string, unknown>) ?? {} };
  if ("date" in params) return { op: "date", expression: params.date as string };
  if ("and" in params && Array.isArray(params.and)) return { op: "and", children: (params.and as Record<string, unknown>[]).map(paramsToWait) };
  if ("or" in params && Array.isArray(params.or)) return { op: "or", children: (params.or as Record<string, unknown>[]).map(paramsToWait) };
  return { op: "duration", value: "1h" };
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/** Migrate old step formats to the unified wait type */
export function migrateStep(raw: any): FunctionStep {
  if (!raw || typeof raw !== "object") return raw;

  // Legacy typeless: { wait_for: { event, ... }, timeout?, on_timeout? }
  if (!raw.type && "wait_for" in raw) {
    const wf = raw.wait_for;
    const eventCond: WaitCondition = { op: "event", event: wf.event ?? "", filters: wf.group ? { group: wf.group } : {} };
    if (raw.timeout) {
      return { type: "wait", condition: { op: "or", children: [eventCond, { op: "duration", value: raw.timeout }] } };
    }
    return { type: "wait", condition: eventCond };
  }

  // Legacy typeless: { action: "name", channel?, message?, ... }
  if (!raw.type && "action" in raw) {
    const { action, ...params } = raw;
    return { type: "action", name: action, params };
  }

  // Legacy typeless: { set: { key: value } }
  if (!raw.type && "set" in raw && typeof raw.set === "object") {
    return { type: "action", name: "set_vars", params: raw.set };
  }

  // Legacy typeless: { wait: "24h" }
  if (!raw.type && "wait" in raw && typeof raw.wait === "string") {
    return { type: "wait", condition: { op: "duration", value: raw.wait } };
  }

  // Legacy typeless: { call_function: "name", args? }
  if (!raw.type && "call_function" in raw) {
    return { type: "call_function", flow: raw.call_function, args: raw.args ?? {} };
  }

  // Legacy typeless: { choose: { notify?, options } }
  if (!raw.type && "choose" in raw) {
    const ch = raw.choose;
    return {
      type: "choose",
      notify: {
        channel: ch.notify?.channel ?? "",
        message: ch.notify?.message ?? "",
      },
      options: (ch.options ?? []).map((o: any) => ({
        id: o.id ?? "",
        label: o.label ?? "",
        steps: (o.steps ?? []).map(migrateStep),
      })),
    };
  }

  // Old wait: { type: "wait", duration: "1h" }
  if (raw.type === "wait" && !raw.condition && "duration" in raw) {
    return { type: "wait", condition: { op: "duration", value: raw.duration ?? "1h" } };
  }

  // Old wait_for: { type: "wait_for", event, filters, timeout?, onTimeout? }
  if (raw.type === "wait_for") {
    const eventCond: WaitCondition = { op: "event", event: raw.event ?? "", filters: raw.filters };
    if (raw.timeout) {
      // timeout becomes OR branch: event OR duration
      return {
        type: "wait",
        condition: { op: "or", children: [eventCond, { op: "duration", value: raw.timeout }] },
      };
    }
    return { type: "wait", condition: eventCond };
  }

  // Old wait_until: { type: "wait_until", expression }
  if (raw.type === "wait_until") {
    return { type: "wait", condition: { op: "date", expression: raw.expression ?? "" } };
  }

  // Recurse into branch arms, choose options, and scope steps
  if (raw.type === "branch" && Array.isArray(raw.arms)) {
    return {
      ...raw,
      arms: raw.arms.map((a: any) => ({
        ...a,
        when: typeof a.when === "string" ? migrateBranchWhen(a.when) : (a.when ?? { op: "compare", field: "", cmp: "==", value: "" }),
        steps: (a.steps ?? []).map(migrateStep),
      })),
    };
  }
  if (raw.type === "choose" && Array.isArray(raw.options)) {
    return { ...raw, options: raw.options.map((o: any) => ({ ...o, steps: (o.steps ?? []).map(migrateStep) })) };
  }
  if (raw.type === "scope" && Array.isArray(raw.steps)) {
    return { ...raw, steps: raw.steps.map(migrateStep) };
  }

  return raw;
}

/** Migrate an entire steps array */
export function migrateSteps(steps: any[]): FunctionStep[] {
  return (steps ?? []).map(migrateStep);
}
