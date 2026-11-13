import type { Expression, SuspendMeta } from "@fenel/engine/types";

// ---------------------------------------------------------------------------
// Function definition types
//
// A "function" in Fenel is the universal callable — including the long-lived,
// IO-suspending, durable functions that used to be called "flows". Every
// function is durable; durability is a property of the runtime, not a kind
// of function.
// ---------------------------------------------------------------------------

/** Top-level YAML document (items, plans, functions, etc.) */
export type FunctionDocument = {
  fenel_version: number;
  account: string;
  items?: Record<string, Record<string, unknown>>;
  inventories?: Record<string, Record<string, unknown>>;
  plans?: Record<string, Record<string, unknown>>;
  entitlements?: Record<string, Record<string, unknown>>;
  forms?: Record<string, Record<string, unknown>>;
  channels?: Record<string, Record<string, unknown>>;
  email_templates?: Record<string, Record<string, unknown>>;
  functions?: Record<string, RawFunctionDef>;
};

/** Raw function definition as parsed from YAML or stored in DB */
export type RawFunctionDef = {
  trigger?: FunctionTrigger;
  args?: Record<string, { type: string; required?: boolean }>;
  cancel_when?: Record<string, unknown>;
  /** Legacy step-based format — converted to program on load */
  on_start?: Record<string, unknown>[];
  steps?: Record<string, unknown>[];
  branches?: RawBranchArm[];
  /** New expression-based format — takes precedence over steps */
  program?: Expression;
};

export type RawBranchArm = {
  id: string;
  when: string | Expression;
  steps: Record<string, unknown>[];
};

export type FunctionTrigger = {
  type: string;
  once_per_lead?: boolean;
  [key: string]: unknown;
};

// ---------------------------------------------------------------------------
// Normalized function definition — ready for the evaluator
// ---------------------------------------------------------------------------

export type FunctionDef = {
  slug: string;
  trigger?: FunctionTrigger;
  args?: Record<string, { type: string; required?: boolean }>;
  cancelWhen?: Record<string, unknown>;
  program: Expression;
};

// ---------------------------------------------------------------------------
// Step path — position in visual editor step tree
// ---------------------------------------------------------------------------

export type StepPath = (number | string)[];

// ---------------------------------------------------------------------------
// Execution state — stored in function_instances.variables
// ---------------------------------------------------------------------------

export type InstanceState = {
  [key: string]: unknown;
  /** Phase 12 of canonical-maybe — typed `SuspendMeta` variant nested as a
   *  single key on `function_instances.variables`. Pre-Phase-12, the
   *  payload was scattered across underscored siblings (`_waitFilter` /
   *  `_wakeAt` / `_readSchema` / `_telegramRetryReason` /
   *  `_notionRetryReason`) — readers dispatched on key presence. Post-
   *  Phase-12, readers dispatch on `_suspendMeta.$tag`. */
  _suspendMeta?: SuspendMeta;
};
