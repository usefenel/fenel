// ---------------------------------------------------------------------------
// Self-host canary sample inventory — single source of truth.
//
// The three `compile-<target>-self-host.test.ts` harnesses each enumerate
// the engine's registered functions, compile every Fenel-bodied entry, and
// assert engine eval ≡ compiled execution on a per-fnId sample matrix. The
// sample data + per-target gap classifications used to live inline in each
// test file; this module is the shared source they all now consume.
//
// The matrix generator (`scripts/generate-self-host-matrix.ts`) imports the
// same module to publish `docs/SELF_HOST_MATRIX.md`. Adding a sample / gap
// / shared canary here is automatically reflected in every consumer.
// ---------------------------------------------------------------------------

import type { Constraint, FenelFunction } from "./types";
import type { CompileFieldSlot } from "./compilable";
import { compileConstructorWireName } from "./compile-field-slots";
import { Just, Nothing } from "./type-foundation";

export type Sample = ReadonlyArray<unknown>;

export type SampleSet = Record<string, ReadonlyArray<Sample>>;

export type ExpectedGaps = Record<string, string>;

const sampleCompileSlot = (wireName: string, index: number): CompileFieldSlot => ({
  key: { $tag: "PositionalField", index },
  wireName,
});

const sampleCompileSlots = (...wireNames: string[]): CompileFieldSlot[] =>
  wireNames.map(sampleCompileSlot);

/** Scope token used by the bootstrap's stub typeclass registry — shared
 *  across all three harnesses so the effect-handler instance lookup matches
 *  across targets. */
export const SCRATCH_SCOPE = "scratch";

/** Pick a scope token for a Constraint. Concrete-string args pass through;
 *  variable-typed args resolve to the bootstrap's default scope, which the
 *  stub registry indexes its instances under. Shared helper used by every
 *  harness's `buildEffectStubsForFn` call. */
export function scopeForConstraint(c: Constraint): string {
  const arg = c.args[0];
  if (typeof arg === "string") return arg;
  return SCRATCH_SCOPE;
}

// ---------------------------------------------------------------------------
// Phase 20.0 — synthetic effectful canary.
//
// Hand-written FenelFunction that exercises the effect-dispatch wiring
// end-to-end through the self-host harness: declared `requires` →
// `$effect:` sentinel call in body → compiled `$fenel.$effect.HasStateIO.set`
// member access → engine `ctx.natives["$effect:HasStateIO:set"]` lookup.
// The body's last expression is `var v` (a primitive Number), keeping the
// engine + compiled return values structurally identical (both JS numbers)
// so byte-equality holds without engine-side ADT-shape comparisons.
// ---------------------------------------------------------------------------

export const effectfulCanary: FenelFunction = {
  id: "phase20:effectfulCanary",
  params: [{
    name: "v",
    key: { $tag: "PositionalField", index: 0 },
    label: Nothing,
    type: { $ref: "Number" },
    meta: {},
    ui: Nothing,
  }],
  returns: { $ref: "Number" },
  body: {
    do: [
      { call: ["$effect:HasStateIO:set", "key", { var: "v" }] },
      { var: "v" },
    ],
  },
  requires: [{ class: { $tag: "Id", entityId: "HasStateIO" }, args: [SCRATCH_SCOPE] }],
};

// ---------------------------------------------------------------------------
// Phase 21.5 — JsonLogic ADT marshaller for normaliseToCore samples.
//
// `engine:normaliseToCore` walks a typed JsonLogic ADT (JlNull / JlBool /
// JlNumber / JlString / JlArray / JlObject / JlTagged with named JlField
// children). The dispatch wrapper marshals raw JSON Logic at the boundary;
// the self-host harness inputs ARE the marshaller's output, so engine eval
// and compiled execution receive identical typed values.
// ---------------------------------------------------------------------------

export function marshalToJsonLogic(n: unknown): unknown {
  if (n === null || n === undefined) return { $tag: "JlNull" };
  if (typeof n === "boolean") return { $tag: "JlBool", value: n };
  if (typeof n === "number") return { $tag: "JlNumber", value: n };
  if (typeof n === "string") return { $tag: "JlString", value: n };
  if (Array.isArray(n)) return { $tag: "JlArray", items: n.map(marshalToJsonLogic) };
  if (typeof n !== "object") return { $tag: "JlNull" };
  const o = n as Record<string, unknown>;
  const keys = Object.keys(o);
  if ("$tag" in o && typeof o["$tag"] === "string") {
    const tag = o["$tag"] as string;
    const fields: unknown[] = [];
    for (const k of keys) {
      if (k === "$tag") continue;
      fields.push({ $tag: "JlField", name: k, value: marshalToJsonLogic(o[k]) });
    }
    return { $tag: "JlTagged", tag, fields };
  }
  const fields: unknown[] = [];
  for (const k of keys) {
    fields.push({ $tag: "JlField", name: k, value: marshalToJsonLogic(o[k]) });
  }
  return { $tag: "JlObject", fields };
}

/** Build the `engine:normaliseToCore` sample matrix, threading the harness's
 *  `_constructors` map so the body's CoreConstruct.fields output preserves
 *  named-record shape under per-target self-host. */
export function buildNormaliseToCoreSamples(
  harnessCtorDefs: Record<string, CompileFieldSlot[]>,
): ReadonlyArray<Sample> {
  const ctorDefsList: unknown[] = [];
  for (const [name, flds] of Object.entries(harnessCtorDefs)) {
    ctorDefsList.push({
      $tag: "CtorDefEntry",
      name,
      wireName: compileConstructorWireName(harnessCtorDefs, name),
      fields: flds,
      ambiguous: false,
    });
  }
  const mk = (name: string, params: string[], body: unknown) => ({
    name,
    params: params.map(sampleCompileSlot),
    body: marshalToJsonLogic(body),
    requires: [],
    ctorDefs: ctorDefsList,
  });
  return [
    [mk("n", [], 42), [], null],
    [mk("s", [], "hi"), [], null],
    [mk("b", [], true), [], null],
    [mk("plus", ["a", "b"], { "+": [{ var: "a" }, { var: "b" }] }), [], null],
    [mk("eq", ["a", "b"], { "==": [{ var: "a" }, { var: "b" }] }), [], null],
    [mk("call", [], { call: ["add", 1, 2] }), [], null],
    [mk("indir", ["f", "x"], { call: [{ var: "f" }, { var: "x" }] }), [], null],
    [mk("just", [], { construct: ["Just", 5] }), [], null],
    [mk("justN", [], { construct: ["Just", 5] }), [], null],
    [mk("letOne", [], { let: { x: 1 } }), [], null],
    [mk("doLet", [], { do: [{ let: { x: 1 } }, { "+": [{ var: "x" }, 2] }] }), [], null],
    [mk("if3", ["c"], { if: [{ var: "c" }, 1, 2] }), [], null],
    [mk("if2", ["c"], { if: [{ var: "c" }, 1] }), [], null],
    [mk("ifMulti", ["c1", "c2"], { if: [{ var: "c1" }, 1, { var: "c2" }, 2, 3] }), [], null],
    [mk("fnParen", [], { fn: [["x"], { var: "x" }] }), [], null],
    [mk("fnFlat", [], { fn: ["x", { var: "x" }] }), [], null],
    [mk("matchW", ["x"], { match: [{ var: "x" }, "_", 0] }), [], null],
    [mk("rec", [], { x: 1, y: 2 }), [], null],
    [mk("tagged", [], { $tag: "Just", _0: 5 }), [], null],
  ];
}

// ---------------------------------------------------------------------------
// `engine:makeEffectsExplicit` samples — target-agnostic. expr-substrate
// Phase 4c — re-pinned from CoreExpr to `Expr` (7 cases): the pass now walks
// `Expr` only. Each input is a program-envelope covering one Expr case (ELit /
// EVar / ECall with effect / ELambda / EConstruct / ERecord / EMatch) plus the
// reconstitution encodings (`if` ⇒ `ECall "if"`; `let` / `do` ⇒ applied-
// `ELambda`-via-`"$"` — named param for let, `"_"` for do) and the effect-dedup
// logic + malformed-sentinel rejection. Samples are INPUTS only (the harness
// compares engine-eval ≡ compiled-exec of the same pass).
// ---------------------------------------------------------------------------

export const makeEffectsExplicitSamples: ReadonlyArray<Sample> = [
  [{ $tag: "CoreProgram", name: "trivial", params: [], body: { $tag: "ELit", value: 42 }, requires: [] }, []],
  [{ $tag: "CoreProgram", name: "single", params: [], body: { $tag: "ECall", fnId: "$effect:HasStateIO:set", args: [{ $tag: "ELit", value: 1 }] }, requires: [] }, []],
  [{ $tag: "CoreProgram", name: "var", params: sampleCompileSlots("x"), body: { $tag: "EVar", name: "x" }, requires: [] }, []],
  [{ $tag: "CoreProgram", name: "ifelse", params: [], body: { $tag: "ECall", fnId: "if", args: [{ $tag: "ECall", fnId: "$effect:HasFsIO:read", args: [] }, { $tag: "ECall", fnId: "$effect:HasStateIO:set", args: [] }, { $tag: "ELit", value: null }] }, requires: [] }, []],
  [{ $tag: "CoreProgram", name: "letbind", params: [], body: { $tag: "ECall", fnId: "$", args: [{ $tag: "ELambda", params: ["v"], body: { $tag: "EVar", name: "v" } }, { $tag: "ECall", fnId: "$effect:HasStateIO:get", args: [] }] }, requires: [] }, []],
  [{ $tag: "CoreProgram", name: "doSeq", params: [], body: { $tag: "ECall", fnId: "$", args: [{ $tag: "ELambda", params: ["_"], body: { $tag: "ECall", fnId: "$effect:HasFsIO:write", args: [] } }, { $tag: "ECall", fnId: "$effect:HasStateIO:set", args: [] }] }, requires: [] }, []],
  [{ $tag: "CoreProgram", name: "lambdaEff", params: [], body: { $tag: "ELambda", params: ["x"], body: { $tag: "ECall", fnId: "$effect:HasNetIO:fetch", args: [] } }, requires: [] }, []],
  [{ $tag: "CoreProgram", name: "ctorEff", params: [], body: { $tag: "EConstruct", ctor: "Just", args: [{ $tag: "ECall", fnId: "$effect:HasStateIO:get", args: [] }] }, requires: [] }, []],
  [{ $tag: "CoreProgram", name: "recEff", params: [], body: { $tag: "ERecord", fields: [{ name: "x", value: { $tag: "ELit", value: 1 } }, { name: "y", value: { $tag: "ECall", fnId: "$effect:HasStateIO:set", args: [] } }] }, requires: [] }, []],
  [{ $tag: "CoreProgram", name: "matchEff", params: [], body: { $tag: "EMatch", scrutinee: { $tag: "ECall", fnId: "$effect:HasStateIO:get", args: [] }, arms: [{ pattern: { $tag: "PatWildcard" }, body: { $tag: "ECall", fnId: "$effect:HasFsIO:write", args: [] } }] }, requires: [] }, []],
  [{ $tag: "CoreProgram", name: "dedup", params: [], body: { $tag: "ECall", fnId: "$", args: [{ $tag: "ELambda", params: ["_"], body: { $tag: "ECall", fnId: "$effect:HasStateIO:get", args: [] } }, { $tag: "ECall", fnId: "$effect:HasStateIO:set", args: [] }] }, requires: [] }, []],
  [{ $tag: "CoreProgram", name: "malformed", params: [], body: { $tag: "ECall", fnId: "$effect:", args: [] }, requires: [] }, []],
  [{ $tag: "CoreProgram", name: "regular", params: [], body: { $tag: "ECall", fnId: "add", args: [{ $tag: "ELit", value: 1 }, { $tag: "ELit", value: 2 }] }, requires: [] }, []],
];

// ---------------------------------------------------------------------------
// `engine:makeClosuresExplicit` samples — target-agnostic. expr-substrate
// Phase 4c — re-pinned from CoreExpr to `Expr` (7 cases): the pass walks `Expr`
// and RECONSTITUTES CeIf / CeLet / CeDo from the canonical encodings. 16 inputs
// covering every Expr case + the load-bearing parts of free-variable analysis:
// empty captures, single capture, multi-capture sort order, nested lambdas,
// let-shadow (`ECall "$"` named), match with PatVar / PatConstruct sub-bindings,
// the `$dyn:` indirect-call sentinel, the do-encoding (`ECall "$"` "_"), the
// if-encoding (`ECall "if"`), and the with-fields / no-fields EConstruct arms.
// Samples are INPUTS only (the harness compares engine-eval ≡ compiled-exec);
// the reconstitution path (run-split into CeLet / CeDo) is now under per-target
// compiled execution for the first time.
// ---------------------------------------------------------------------------

export const makeClosuresExplicitSamples: ReadonlyArray<Sample> = [
  [{ $tag: "EffectsExplicitProgram", name: "lit", params: [], body: { $tag: "ELit", value: 42 }, effects: [], handlerSites: [] }, []],
  [{ $tag: "EffectsExplicitProgram", name: "var", params: sampleCompileSlots("x"), body: { $tag: "EVar", name: "x" }, effects: [], handlerSites: [] }, []],
  [{ $tag: "EffectsExplicitProgram", name: "topLambda", params: [], body: { $tag: "ELambda", params: ["x"], body: { $tag: "EVar", name: "x" } }, effects: [], handlerSites: [] }, []],
  [{ $tag: "EffectsExplicitProgram", name: "capOne", params: sampleCompileSlots("a"), body: { $tag: "ELambda", params: ["x"], body: { $tag: "ECall", fnId: "add", args: [{ $tag: "EVar", name: "x" }, { $tag: "EVar", name: "a" }] } }, effects: [], handlerSites: [] }, []],
  [{ $tag: "EffectsExplicitProgram", name: "capMulti", params: sampleCompileSlots("a", "b", "c", "d"), body: { $tag: "ELambda", params: ["x"], body: { $tag: "ECall", fnId: "add", args: [{ $tag: "EVar", name: "d" }, { $tag: "ECall", fnId: "add", args: [{ $tag: "EVar", name: "b" }, { $tag: "EVar", name: "a" }] }] } }, effects: [], handlerSites: [] }, []],
  [{ $tag: "EffectsExplicitProgram", name: "nest", params: sampleCompileSlots("a"), body: { $tag: "ELambda", params: ["x"], body: { $tag: "ELambda", params: ["y"], body: { $tag: "ECall", fnId: "add", args: [{ $tag: "EVar", name: "a" }, { $tag: "ECall", fnId: "add", args: [{ $tag: "EVar", name: "x" }, { $tag: "EVar", name: "y" }] }] } } }, effects: [], handlerSites: [] }, []],
  [{ $tag: "EffectsExplicitProgram", name: "shadow", params: sampleCompileSlots("a"), body: { $tag: "ECall", fnId: "$", args: [{ $tag: "ELambda", params: ["a"], body: { $tag: "EVar", name: "a" } }, { $tag: "ELit", value: 1 }] }, effects: [], handlerSites: [] }, []],
  [{ $tag: "EffectsExplicitProgram", name: "mpv", params: sampleCompileSlots("a"), body: { $tag: "EMatch", scrutinee: { $tag: "EVar", name: "a" }, arms: [{ pattern: { $tag: "PatVar", name: "x" }, body: { $tag: "EVar", name: "x" } }] }, effects: [], handlerSites: [] }, []],
  [{ $tag: "EffectsExplicitProgram", name: "mpc", params: sampleCompileSlots("a"), body: { $tag: "EMatch", scrutinee: { $tag: "EVar", name: "a" }, arms: [{ pattern: { $tag: "PatConstruct", ctor: "Just", args: [{ $tag: "PatVar", name: "y" }] }, body: { $tag: "EVar", name: "y" } }, { pattern: { $tag: "PatWildcard" }, body: { $tag: "ELit", value: 0 } }] }, effects: [], handlerSites: [] }, []],
  [{ $tag: "EffectsExplicitProgram", name: "dyn", params: sampleCompileSlots("f"), body: { $tag: "ELambda", params: ["x"], body: { $tag: "ECall", fnId: "$dyn:f", args: [{ $tag: "EVar", name: "x" }] } }, effects: [], handlerSites: [] }, []],
  [{ $tag: "EffectsExplicitProgram", name: "combo", params: sampleCompileSlots("g"), body: { $tag: "ECall", fnId: "$", args: [{ $tag: "ELambda", params: ["h"], body: { $tag: "EMatch", scrutinee: { $tag: "EVar", name: "h" }, arms: [{ pattern: { $tag: "PatVar", name: "z" }, body: { $tag: "ELambda", params: ["w"], body: { $tag: "ECall", fnId: "add", args: [{ $tag: "EVar", name: "z" }, { $tag: "ECall", fnId: "$dyn:h", args: [{ $tag: "EVar", name: "w" }] }] } } }] } }, { $tag: "EVar", name: "g" }] }, effects: [], handlerSites: [] }, []],
  [{ $tag: "EffectsExplicitProgram", name: "doex", params: sampleCompileSlots("a"), body: { $tag: "ECall", fnId: "$", args: [{ $tag: "ELambda", params: ["_"], body: { $tag: "EVar", name: "a" } }, { $tag: "ELit", value: 1 }] }, effects: [], handlerSites: [] }, []],
  [{ $tag: "EffectsExplicitProgram", name: "rec", params: sampleCompileSlots("x"), body: { $tag: "ERecord", fields: [{ name: "a", value: { $tag: "EVar", name: "x" } }, { name: "b", value: { $tag: "ELit", value: 2 } }] }, effects: [], handlerSites: [] }, []],
  [{ $tag: "EffectsExplicitProgram", name: "cons", params: sampleCompileSlots("x"), body: { $tag: "EConstruct", ctor: "Just", args: [{ $tag: "EVar", name: "x" }] }, effects: [], handlerSites: [] }, []],
  [{ $tag: "EffectsExplicitProgram", name: "consN", params: sampleCompileSlots("x"), body: { $tag: "EConstruct", ctor: "Just", args: [{ $tag: "EVar", name: "x" }], fields: [sampleCompileSlot("value", 0)] }, effects: [], handlerSites: [] }, []],
  [{ $tag: "EffectsExplicitProgram", name: "ifexp", params: sampleCompileSlots("a", "b"), body: { $tag: "ECall", fnId: "if", args: [{ $tag: "EVar", name: "a" }, { $tag: "EVar", name: "b" }, { $tag: "ELit", value: 0 }] }, effects: [], handlerSites: [] }, []],
];

// ---------------------------------------------------------------------------
// `engine:parseEffectFnId` samples — target-agnostic. Inputs cover well-
// formed sentinels, the documented edge cases (empty class / empty method /
// missing prefix / extra colons), and a non-`$effect:` fnId for the
// "unrelated string" branch.
// ---------------------------------------------------------------------------

export const parseEffectFnIdSamples: ReadonlyArray<Sample> = [
  ["$effect:HasStateIO:set"],
  ["$effect:HasStateIO:get"],
  ["$effect:Foo:bar"],
  ["$effect:Foo:bar:baz"],
  ["$effect:Foo"],
  ["$effect::bar"],
  ["$effect:Foo:"],
  ["$effect:"],
  ["$effect"],
  ["std:add"],
  [""],
  ["$effect:A:B"],
];

const surfaceStringType = { $tag: "SfNamed", name: "String", raw: { $ref: "String" } };
const surfaceNumberType = { $tag: "SfNamed", name: "Number", raw: { $ref: "Number" } };
const surfaceBooleanType = { $tag: "SfNamed", name: "Boolean", raw: { $ref: "Boolean" } };
const surfaceProfileRaw = { $ref: "Profile" };
const surfaceProfileTypeKey = JSON.stringify(surfaceProfileRaw);
const surfaceProfileType = {
  $tag: "SfRecord",
  raw: surfaceProfileRaw,
  fields: [
    {
      $tag: "SurfaceField",
      name: "firstName",
      label: "First name",
      type: surfaceStringType,
      raw: { name: "firstName", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
    },
    {
      $tag: "SurfaceField",
      name: "email",
      label: "Email",
      type: surfaceStringType,
      raw: { name: "email", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
    },
    {
      $tag: "SurfaceField",
      name: "active",
      label: "Active",
      type: surfaceBooleanType,
      raw: { name: "active", label: Nothing, type: { $ref: "Boolean" }, meta: {}, ui: Nothing },
    },
    {
      $tag: "SurfaceField",
      name: "stats",
      label: "Stats",
      type: {
        $tag: "SfRecord",
        raw: { $record: { fields: [] } },
        fields: [
          {
            $tag: "SurfaceField",
            name: "score",
            label: "Score",
            type: surfaceNumberType,
            raw: { name: "score", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing },
          },
        ],
      },
      raw: {
        name: "stats",
        label: Nothing,
        type: { $record: { fields: [] } },
        meta: {},
        ui: Nothing,
      },
    },
  ],
};
const surfaceViews = [
  {
    name: "profile-detail",
    hasDescription: true,
    description: "Profile detail",
    hasExtends: false,
    extendsName: "",
    hasTarget: true,
    targetName: "Profile",
    targetKey: surfaceProfileTypeKey,
    targetType: surfaceProfileRaw,
    display: Nothing,
    hasLayout: true,
    hasListDisplay: false,
    hasReadDisplay: false,
    hasEditDisplay: false,
    component: "",
    readComponent: "",
    editComponent: "",
    layout: { sections: [{ rows: [{ slots: [{ field: "firstName", span: 6 }] }] }] },
    raw: {
      name: "profile-detail",
      targetType: surfaceProfileRaw,
      display: Nothing,
      layout: { sections: [{ rows: [{ slots: [{ field: "firstName", span: 6 }] }] }] },
    },
  },
  {
    name: "profile-cards",
    hasDescription: true,
    description: "Profile cards",
    hasExtends: false,
    extendsName: "",
    hasTarget: true,
    targetName: "Profile",
    targetKey: surfaceProfileTypeKey,
    targetType: surfaceProfileRaw,
    display: Nothing,
    hasLayout: false,
    hasListDisplay: true,
    hasReadDisplay: false,
    hasEditDisplay: false,
    component: "",
    readComponent: "profile-card",
    editComponent: "",
    listDisplay: { style: "cards", columns: [{ field: "firstName", label: "First name" }] },
    raw: {
      name: "profile-cards",
      targetType: surfaceProfileRaw,
      display: Nothing,
      readComponent: "profile-card",
      listDisplay: { style: "cards", columns: [{ field: "firstName", label: "First name" }] },
    },
  },
];

const surfaceReadBase = {
  format: Just("badge"),
  transform: Nothing,
  colorMap: Nothing,
  labelMap: Nothing,
  icon: Nothing,
  emptyText: Just("-"),
  prefix: Nothing,
  suffix: Nothing,
  refTemplate: Nothing,
};
const surfaceReadChild = {
  format: Nothing,
  transform: Nothing,
  colorMap: Nothing,
  labelMap: Just({ active: "Active" }),
  icon: Just("check"),
  emptyText: Nothing,
  prefix: Nothing,
  suffix: Nothing,
  refTemplate: Nothing,
};
const surfaceEditBase = {
  widget: Just("select"),
  placeholder: Nothing,
  helpText: Nothing,
  options: Nothing,
  columns: Nothing,
  refFilter: Nothing,
  prefix: Nothing,
  suffix: Nothing,
  format: Nothing,
};
const surfaceEditChild = {
  widget: Nothing,
  placeholder: Just("Choose status"),
  helpText: Nothing,
  options: Nothing,
  columns: Nothing,
  refFilter: Nothing,
  prefix: Nothing,
  suffix: Nothing,
  format: Nothing,
};
const surfaceRegistryViews = [
  {
    name: "status-base",
    hasDescription: true,
    description: "Base status display",
    hasExtends: false,
    extendsName: "",
    hasTarget: false,
    targetName: "",
    targetKey: "",
    targetType: null,
    display: Just({ read: Just(surfaceReadBase), edit: Just(surfaceEditBase) }),
    hasLayout: true,
    hasListDisplay: false,
    hasReadDisplay: true,
    hasEditDisplay: true,
    component: "",
    readComponent: "",
    editComponent: "",
    layout: { sections: [{ rows: [{ slots: [{ field: "active", span: 6 }] }] }] },
    listDisplay: null,
    readDisplay: surfaceReadBase,
    editDisplay: surfaceEditBase,
    raw: {
      name: "status-base",
      description: "Base status display",
      display: Just({ read: Just(surfaceReadBase), edit: Just(surfaceEditBase) }),
      layout: { sections: [{ rows: [{ slots: [{ field: "active", span: 6 }] }] }] },
    },
  },
  {
    name: "status-child",
    hasDescription: false,
    description: null,
    hasExtends: true,
    extendsName: "status-base",
    hasTarget: false,
    targetName: "",
    targetKey: "",
    targetType: null,
    display: Just({ read: Just(surfaceReadChild), edit: Just(surfaceEditChild) }),
    hasLayout: false,
    hasListDisplay: false,
    hasReadDisplay: true,
    hasEditDisplay: true,
    component: "",
    readComponent: "missing-status-read",
    editComponent: "",
    layout: null,
    listDisplay: null,
    readDisplay: surfaceReadChild,
    editDisplay: surfaceEditChild,
    raw: {
      name: "status-child",
      extends: "status-base",
      display: Just({ read: Just(surfaceReadChild), edit: Just(surfaceEditChild) }),
      readComponent: "missing-status-read",
    },
  },
];
const surfaceValueActive = {
  tag: "string",
  text: "active",
  key: "active",
  raw: "active",
  missing: false,
  children: {},
};
const surfaceValueMissing = {
  tag: "missing",
  text: "",
  key: "",
  raw: null,
  missing: true,
  children: {},
};
const surfaceRenderFields = [
  { name: "active", label: "Active", raw: surfaceProfileType.fields[2]!.raw },
  { name: "email", label: "Email", raw: surfaceProfileType.fields[1]!.raw },
];
const surfaceRenderValues = {
  active: surfaceValueActive,
  email: { tag: "string", text: "ada@example.com", key: "ada@example.com", raw: "ada@example.com", missing: false, children: {} },
};
const surfaceRenderLayout = {
  sections: [
    {
      visible: true,
      title: "Identity",
      description: null,
      collapsible: false,
      defaultCollapsed: false,
      rows: [
        {
          visible: true,
          gap: "1rem",
          slots: [
            { visible: true, field: "active", span: 4, templateName: "status-child", template: Just(surfaceRegistryViews[1]) },
            { visible: true, field: "missing", span: 2, templateName: "", template: Nothing },
          ],
        },
      ],
    },
  ],
};
const surfaceRenderListDisplay = {
  style: "table",
  addLabel: null,
  emptyText: null,
  itemTemplate: null,
  columns: [
    { field: "active", label: "Status", span: 3, editable: false, templateName: "status-child", template: Just(surfaceRegistryViews[1]) },
    { field: "email", label: "Email", span: null, editable: false, templateName: "", template: Nothing },
  ],
};
const fieldPlanStringType = { $tag: "FtNamed", name: "String", raw: { $ref: "String" } };
const fieldPlanNumberType = { $tag: "FtNamed", name: "Number", raw: { $ref: "Number" } };
const fieldPlanBooleanType = { $tag: "FtNamed", name: "Boolean", raw: { $ref: "Boolean" } };
const fieldPlanEmailType = {
  $tag: "FtRefined",
  base: fieldPlanStringType,
  set: { $tag: "SeRef", handle: "format:email" },
  raw: { $refined: { base: { $ref: "String" }, set: { $tag: "SeRef", handle: "format:email" } } },
};
const fieldPlanRecordType = {
  $tag: "FtRecord",
  fields: [
    { name: "email", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
    { name: "active", label: Nothing, type: { $ref: "Boolean" }, meta: {}, ui: Nothing },
  ],
  raw: { $record: { fields: [] } },
};
const fieldPlanUiEmpty = {
  widget: Nothing,
  placeholder: Nothing,
  helpText: Nothing,
  prefix: Nothing,
  suffix: Nothing,
  options: Nothing,
  format: Nothing,
  columns: Nothing,
  refFilter: Nothing,
};
const fieldPlanBaseInput = {
  name: "email",
  label: "Email",
  required: true,
  type: fieldPlanEmailType,
  rawField: {},
  ui: { ...fieldPlanUiEmpty, helpText: Just("Use a work email") },
  selectOptions: Nothing,
  widgetHint: { widget: Nothing, reason: "sample", config: {}, alternatives: [] },
  channel: Just({ kind: "text", id: "address", name: "Address", icon: "map", strategy: "autocomplete-address" }),
  listItemDefault: Nothing,
  defaultRefFilter: Nothing,
  legacyRefFilter: Nothing,
};
const fieldPlanSelectInput = {
  ...fieldPlanBaseInput,
  name: "status",
  label: "Status",
  type: fieldPlanStringType,
  selectOptions: Just([{ value: "draft", label: "Draft" }, { value: "live", label: "Live" }]),
  widgetHint: { widget: Just("radio"), reason: "sample", config: {}, alternatives: [] },
};
const fieldPlanRefInput = {
  ...fieldPlanBaseInput,
  name: "profileId",
  label: "Profile",
  type: { $tag: "FtTagged", entityType: "profile", raw: { $tagged: { value: { $ref: "Id" }, phantom: { $ref: "profile" } } } },
  ui: { ...fieldPlanUiEmpty, refFilter: Just({ "==": [{ var: "candidate.status" }, "active"] }) },
};
const fieldRenderPlanSamples: SampleSet = {
  "engine:fieldTypeLabelPlan": [
    [fieldPlanStringType],
    [fieldPlanRecordType],
    [{ $tag: "FtList", elem: fieldPlanNumberType, raw: {} }],
  ],
  "engine:fieldEditPlan": [
    [fieldPlanBaseInput],
    [fieldPlanSelectInput],
    [fieldPlanRefInput],
    [{ ...fieldPlanBaseInput, name: "active", label: "Active", type: fieldPlanBooleanType }],
  ],
};

const formRuntimeEmailField = {
  name: "email",
  label: Nothing,
  type: { $ref: "String" },
  meta: {},
  ui: Nothing,
};
const formRuntimeActiveField = {
  name: "active",
  label: Nothing,
  type: { $ref: "Boolean" },
  meta: {},
  ui: Nothing,
};
const formRuntimeStreetField = {
  name: "street",
  label: Nothing,
  type: { $ref: "String" },
  meta: {},
  ui: Nothing,
};
const formRuntimeCityField = {
  name: "city",
  label: Nothing,
  type: { $ref: "String" },
  meta: {},
  ui: Nothing,
};
const formRuntimeFieldFacts = [
  {
    name: "email",
    label: "Email",
    field: formRuntimeEmailField,
    columns: Just(6),
    children: [],
    hasDefault: true,
    defaultValue: "",
  },
  {
    name: "active",
    label: "Active",
    field: formRuntimeActiveField,
    columns: Nothing,
    children: [],
    hasDefault: true,
    defaultValue: false,
  },
];
const formRuntimeRecordFact = {
  name: "address",
  label: "Address",
  field: {
    name: "address",
    label: Nothing,
    type: {
      $record: {
        fields: [formRuntimeStreetField, formRuntimeCityField],
      },
    },
    meta: {},
    ui: Nothing,
  },
  columns: Nothing,
  children: [
    {
      name: "street",
      label: "Street",
      field: formRuntimeStreetField,
      columns: Nothing,
      children: [],
      hasDefault: true,
      defaultValue: "",
    },
    {
      name: "city",
      label: "City",
      field: formRuntimeCityField,
      columns: Nothing,
      children: [],
      hasDefault: true,
      defaultValue: "",
    },
  ],
  hasDefault: true,
  defaultValue: { street: "", city: "" },
};
const formRuntimeErrors = [{ path: "email", message: "Required" }];
const formRuntimeLayout = {
  sections: [
    {
      title: "Identity",
      rows: [
        {
          slots: [
            { field: "email" },
            { field: "active" },
          ],
        },
      ],
    },
  ],
};
const formRuntimeSamples: SampleSet = {
  "engine:formFieldsPlan": [[{ fields: formRuntimeFieldFacts }]],
  "engine:formDefaultsPlan": [[{ fields: formRuntimeFieldFacts }]],
  "engine:formValidationPlan": [[{ errors: formRuntimeErrors }]],
  "engine:formSessionPlan": [[{
    fields: formRuntimeFieldFacts,
    initialValues: { active: true },
    currentValues: { email: "ada@example.com" },
    errors: formRuntimeErrors,
    hasLayout: true,
    layout: formRuntimeLayout,
    requestedMode: "auto",
    submitLabelPriority: "override-first",
    submitLabelOverride: "Go",
    configSubmitLabel: "Save",
    legacySubmitLabel: "Submit old",
    defaultSubmitLabel: "Submit",
    savingLabelOverride: "",
    defaultSavingLabel: "Saving...",
  }]],
  "engine:formSuccessPlan": [
    [{
      submitted: true,
      hasValue: true,
      value: { $tag: "Link", url: "https://example.com", label: Just("Continue") },
      thankYouText: "Thanks",
    }],
    [{
      submitted: true,
      hasValue: true,
      value: { $tag: "Profile", id: "p1" },
      thankYouText: "Thanks",
    }],
  ],
  "engine:formSlidePlan": [
    [{
      layout: formRuntimeLayout,
      fields: formRuntimeFieldFacts,
      values: { email: "ada@example.com", active: true },
      errors: [],
      slides: [],
    }],
    [{
      layout: { sections: [] },
      fields: formRuntimeFieldFacts,
      values: {},
      errors: [],
      slides: [{ title: "Only email", fields: ["email"] }],
    }],
  ],
  "engine:formRecordDrillPlan": [[{
    parentName: "address",
    parentLabel: "Address",
    children: formRuntimeRecordFact.children,
    values: { address: { street: "Rue Morgue" } },
    errors: [],
  }]],
};

const surfacePlannerSamples: SampleSet = {
  "engine:surfaceTargetTypeOptions": [[[
    { value: "String", label: "String", category: "atom", description: "text", type: null, entityId: null },
    { value: "Profile", label: "Profile", category: "entity", description: "profile rows", type: null, entityId: null },
    { value: "Email", label: "Email", category: "format", description: "email text", type: null, entityId: null },
  ]]],
  "engine:surfaceFieldCandidates": [[surfaceProfileType, 1]],
  "engine:surfaceDefaultLayoutForType": [[surfaceProfileType]],
  "engine:surfaceDefaultListDisplayForType": [[surfaceProfileType]],
  "engine:surfaceConditionScopeForType": [[surfaceProfileType, "edit", "web"]],
  "engine:surfaceConditionContext": [[{ firstName: "Ada" }, "read", "web"]],
  "engine:surfaceTypeViewsForSurface": [[surfaceViews, "Profile", surfaceProfileTypeKey, "list"]],
  "engine:surfacePlanForType": [[
    surfaceProfileType,
    surfaceProfileRaw,
    surfaceViews,
    "Profile",
    surfaceProfileTypeKey,
    "list",
    {
      explicitViewName: "profile-cards",
      accountOverrideViewName: "",
      userOverrideViewName: "",
      entityDefaultViewName: "",
      catalogDefaultViewName: "profile-detail",
    },
    "web",
  ]],
  "engine:surfaceMergeRead": [[Just(surfaceReadBase), Just(surfaceReadChild)]],
  "engine:surfaceMergeEdit": [[Just(surfaceEditBase), Just(surfaceEditChild)]],
  "engine:surfaceMergeDisplay": [[Just({ read: Just(surfaceReadBase), edit: Just(surfaceEditBase) }), Just({ read: Just(surfaceReadChild), edit: Just(surfaceEditChild) })]],
  "engine:surfaceResolveTypeView": [[surfaceRegistryViews, "status-child"]],
  "engine:surfaceDefaultTemplateName": [[
    [{ schemaType: "$refined", templateName: "status-base" }],
    [{ schemaType: "$refined", rules: [{ template: "status-child", matched: true }] }],
    "$refined",
  ]],
  "engine:surfaceResolveDefaultTemplate": [[
    surfaceRegistryViews,
    [{ schemaType: "$refined", templateName: "status-base" }],
    [{ schemaType: "$refined", rules: [{ template: "status-child", matched: true }] }],
    "$refined",
  ]],
  "engine:surfaceReadValuePlan": [[surfaceValueActive, Just(surfaceReadChild), "read-display"], [surfaceValueMissing, Nothing, "scalar"]],
  "engine:surfaceLayoutRenderPlan": [[surfaceRenderLayout, surfaceRenderFields, surfaceRenderValues, { active: "Invalid status" }, "read"]],
  "engine:surfaceListDisplayRenderPlan": [[surfaceRenderListDisplay, surfaceRenderFields]],
  "engine:surfaceMaybeString": [[""], ["profile"]],
  "engine:surfaceTypeRef": [["profile"]],
  "engine:surfaceEmptyReadDisplay": [[]],
  "engine:surfaceReadDisplay": [[Just("date-short"), Just("trim"), Nothing, Nothing, Nothing, Just("-"), Nothing, Nothing, Nothing]],
  "engine:surfaceReadFormat": [["date-short"]],
  "engine:surfaceReadFormatTransform": [["badge", "upper"]],
  "engine:surfaceReadFormatIcon": [["badge", "check"]],
  "engine:surfaceReadEmptyText": [["-"]],
  "engine:surfaceBadgeMaps": [[{ active: "badge-green", archived: "badge-gray" }, Just({ active: "Active" })]],
  "engine:surfaceEmptyEditDisplay": [[]],
  "engine:surfaceEditDisplay": [[Just("text"), Just("Email"), Nothing, Nothing, Just(2), Nothing, Nothing, Nothing, Just("email")]],
  "engine:surfaceEditWidget": [["country-select"]],
  "engine:surfaceDisplay": [[Nothing, Nothing]],
  "engine:surfaceSlot": [["email", 6]],
  "engine:surfaceSlotTemplate": [["email", 6, "email"]],
  "engine:surfaceRow": [[[{ field: "email", span: 12, template: Nothing }]]],
  "engine:surfaceSection": [["Identity", [{ slots: [{ field: "email", span: 12, template: Nothing }] }]]],
  "engine:surfaceUntitledSection": [[[{ slots: [{ field: "email", span: 12, template: Nothing }] }]]],
  "engine:surfaceLayoutDef": [[[{ title: "Identity", rows: [{ slots: [{ field: "email", span: 12, template: Nothing }] }] }]]],
  "engine:surfaceColumn": [["email", "Email"]],
  "engine:surfaceColumnTemplate": [["email", "Email", "email"]],
  "engine:surfaceEditableColumn": [["active", "Active"]],
  "engine:surfaceTableDisplay": [[[{ field: "email", label: "Email", template: Nothing, editable: false }]]],
  "engine:surfaceCardsDisplay": [[]],
  "engine:surfaceStackDisplay": [["Add email"]],
  "engine:surfaceStyleDisplay": [["inline"]],
  "engine:surfaceDisplayView": [["email", "Email text", Nothing, Nothing]],
  "engine:surfaceComponentDisplayView": [["country-display", "Country", Nothing, Just({ widget: Just("country-select"), placeholder: Nothing, helpText: Nothing, options: Nothing, columns: Nothing, refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing }), "country-display", "country-select"]],
  "engine:surfaceListTemplateView": [["list-table", "Table list", { style: "table", columns: [] }]],
  "engine:surfaceDetailTypeView": [["profile-detail", "Profile detail", "profile", { sections: [] }]],
  "engine:surfaceTableTypeView": [["profile-table", "Profile table", "profile", [{ field: "email", label: "Email", template: Nothing, editable: false }]]],
  "engine:surfaceCardTypeView": [["profile-cards", "Profile cards", "profile", "profile-card"]],
  "engine:surfaceReadComponentView": [["profile-card", "Profile card", "profile-card"]],
  "engine:surfaceProfileLayout": [[]],
  "engine:surfaceProfileDetailView": [[]],
  "engine:surfaceProfileCardView": [[]],
  "engine:surfaceProfileTableView": [[]],
  "engine:surfaceItemLayout": [[]],
  "engine:surfaceItemDetailView": [[]],
  "engine:surfaceItemTableView": [[]],
  "engine:surfaceInventoryLayout": [[]],
  "engine:surfaceInventoryDetailView": [[]],
  "engine:surfaceInventoryCardView": [[]],
  "engine:surfacePlanTableView": [[]],
  "engine:surfacePurchaseStatusBadge": [[]],
  "engine:surfacePurchaseTableView": [[]],
  "engine:surfaceProxyLinkTableView": [[]],
  "engine:surfacePageTableView": [[]],
  "engine:surfaceEmailTemplateTableView": [[]],
  "engine:surfaceBuiltinTypeViews": [[]],
};

// ---------------------------------------------------------------------------
// Per-target sample factory. The common samples are shared; eq/neq differ
// because the JS target's `===` is polymorphic (string samples exercise the
// edge cases) while the Wasm/LLVM targets specialise eq/neq to `f64.eq` /
// `fcmp` (numeric samples drive the fast path).
// ---------------------------------------------------------------------------

type TargetName = "js" | "wasm" | "llvm";

export function buildSamples(
  target: TargetName,
  harnessCtorDefs: Record<string, CompileFieldSlot[]>,
): SampleSet {
  const eqSamples: ReadonlyArray<Sample> =
    target === "js"
      ? [["a", "a"], ["a", "b"], ["", ""], ["hello", "world"]]
      : [[1, 1], [1, 2], [0, 0], [-1, -1]];

  return {
    "std:add": [[2, 3], [-7, 7], [0, 0], [3.14, 2.86], [100, -100]],
    "std:sub": [[5, 3], [-1, -2], [0, 0], [3.14, 1.14], [100, -100]],
    "std:mul": [[2, 3], [-4, 5], [0, 1000], [0.5, 2], [-1, -1]],
    "std:div": [[10, 2], [-9, 3], [7.5, 2.5], [-10, 4]],
    "std:mod": [[10, 3], [7, 2], [100, 7], [15, 5]],
    "std:lerp": [[0, 10, 0.5], [0, 100, 0], [0, 100, 1], [10, 20, 1.5], [-5, 5, 0.25]],
    "std:eq": eqSamples,
    "std:neq": eqSamples,
    "std:gt": [[1, 2], [2, 1], [3, 3], [-1, -5], [0, 0]],
    "std:gte": [[1, 2], [2, 1], [3, 3], [-1, -5], [0, 0]],
    "std:lt": [[1, 2], [2, 1], [3, 3], [-1, -5], [0, 0]],
    "std:lte": [[1, 2], [2, 1], [3, 3], [-1, -5], [0, 0]],
    "std:and": [[true, true], [true, false], [false, true], [false, false]],
    "std:or": [[true, true], [true, false], [false, true], [false, false]],
    "std:not": [[true], [false]],
    "std:ifElse": [[true, 1, 2], [false, 1, 2], [true, 100, 200], [false, -5, 5]],
    "std:tryParseBoolean": [["yes"], ["NO"], ["maybe"], ["true"], ["0"], [""]],
    "std:min": [[1, 2], [-3, -5]],
    "std:max": [[1, 2], [-3, -5]],
    // Phase 5b15 — closure-value boundary fix. Inline `{fn:...}` syntax in
    // the sample replaces the pre-5b15 string-fnId form (`["abs", -5]` /
    // `["add", "mul"]`). The harness pre-evaluates each `{fn:...}` arg into
    // a FenelClosure (engine side) and a target-shaped callable handle
    // (compiled side — JS arrow / WASM `{__userFn}` wrapper / LLVM ptr).
    // Both paths then receive semantically-equivalent callables, and
    // `sameValue`'s Phase 5b15 closure branch handles the closure-return
    // case (std:.) via behavioral-equality probing. std:$ produces a
    // concrete integer (`abs(-5) = 5`) so structural equality holds end-
    // to-end. Cross-target now (5b13 deferred WASM / LLVM as out-of-scope;
    // 5b15 brings them in).
    "std:$": [[{ fn: [["x"], { call: ["abs", { var: "x" }] }] }, -5]],
    "std:.": [
      [
        { fn: [["y"], { call: ["add", { var: "y" }, 1] }] },
        { fn: [["z"], { call: ["mul", { var: "z" }, 2] }] },
      ],
    ],
    "std:imageRetro": [[{ pixels: new Uint8ClampedArray(4), width: 1, height: 1 }, 2]],
    // Source-owned lexical-call control. `seqTakeTwo xs = take 2 xs` runs in
    // algebra's source frame, whose local `take` names the axis-take function.
    // Both source and compiled execution therefore return a keyed two-cell
    // Vec for this List input. The source's explicit index lambda avoids the
    // existing compiler gap for a named partial used as a HOF callback.
    // Global multi-binding Sequential dispatch is checked separately through
    // the compiled dispatcher; this lexical call does not prove that route.
    "algebra:seqTakeTwo": [
      [[10, 20, 30, 40]],
    ],
    "phase20:effectfulCanary": [[1], [42], [-7], [0], [3.14]],
    "engine:parseEffectFnId": parseEffectFnIdSamples,
    "engine:makeClosuresExplicit": makeClosuresExplicitSamples,
    "engine:normaliseToCore": buildNormaliseToCoreSamples(harnessCtorDefs),
    "engine:makeEffectsExplicit": makeEffectsExplicitSamples,
    ...(target === "js" ? { ...surfacePlannerSamples, ...fieldRenderPlanSamples, ...formRuntimeSamples } : {}),
    // -----------------------------------------------------------------
    // Phase 5b19 — audit-target candidateFns promotion. Samples for the
    // 6 newly-promoted audit-target modules' pure-bodied functions.
    // Cross-module refs (`time` / `over`) into sound + picture stay
    // deferred per brief watch-out #6 + #7 — animation:overAnim /
    // delayAnim / speedAnim are NOT sampled (their closure-body refs
    // would need sound + picture promotion too).
    //
    // time:parseIsoTimestamp is sampled deliberately so the parser-
    // ambiguity gap (anonymous record literal `{ epochMs = ms }`
    // lowering to `epochMs ms` function-call form) surfaces under the
    // harness and gets recorded via JS / WASM EXPECTED_GAPS. Distinct
    // from substrate-gap class per 5b18 framing implication #4 — see
    // NON_SUBSTRATE_GAPS partition below.
    // -----------------------------------------------------------------
    "events:event": [[[]], [[{ $tag: "EventEntry", timestamp: 1, payload: 42 }]]],
    "events:eventEntry": [[1, "payload"], [0, 42], [3.14, "x"]],
    "events:sampleEvent": [
      [{ $tag: "Event", entries: [{ $tag: "EventEntry", timestamp: 1, payload: 42 }] }, { seconds: 1 }],
      [{ $tag: "Event", entries: [{ $tag: "EventEntry", timestamp: 1, payload: 42 }] }, { seconds: 99 }],
      [{ $tag: "Event", entries: [] }, { seconds: 0 }],
    ],
    "time:timestamp": [[1000], [0], [1700000000000]],
    "time:duration": [[5000], [0], [60000]],
    "time:parseIsoTimestamp": [["2024-01-01T00:00:00Z"]],
    "time:addDuration": [
      [{ $tag: "Timestamp", epochMs: 1000 }, { $tag: "Duration", ms: 500 }],
      [{ $tag: "Timestamp", epochMs: 0 }, { $tag: "Duration", ms: 0 }],
    ],
    "time:diffTimestamps": [
      [{ $tag: "Timestamp", epochMs: 1500 }, { $tag: "Timestamp", epochMs: 1000 }],
      [{ $tag: "Timestamp", epochMs: 0 }, { $tag: "Timestamp", epochMs: 100 }],
    ],
    "time:before": [
      [{ $tag: "Timestamp", epochMs: 1000 }, { $tag: "Timestamp", epochMs: 2000 }],
      [{ $tag: "Timestamp", epochMs: 2000 }, { $tag: "Timestamp", epochMs: 1000 }],
      [{ $tag: "Timestamp", epochMs: 1000 }, { $tag: "Timestamp", epochMs: 1000 }],
    ],
    "time:after": [
      [{ $tag: "Timestamp", epochMs: 1000 }, { $tag: "Timestamp", epochMs: 2000 }],
      [{ $tag: "Timestamp", epochMs: 2000 }, { $tag: "Timestamp", epochMs: 1000 }],
    ],
    "time:seconds": [[5], [60], [0], [0.5]],
    "time:minutes": [[2], [60], [0]],
    "time:hours": [[1], [24], [0]],
    "time:days": [[1], [365], [0]],
    "animation:frameSequence": [[24, []], [30, []]],
    "path:path": [[[], []]],
    "path:line": [
      [0.5, { $tag: "Point", x: 0, y: 0 }, { $tag: "Point", x: 10, y: 10 }],
      [0, { $tag: "Point", x: 0, y: 0 }, { $tag: "Point", x: 5, y: 5 }],
      [1, { $tag: "Point", x: 0, y: 0 }, { $tag: "Point", x: 5, y: 5 }],
    ],
    "track:track": [[[]], [[{ $tag: "TrackEntry", start: 0, sound: null }]]],
    "track:trackEntry": [[1.0, "snd"], [0, "x"]],
    "email:address": [
      ["alice", "example.com", { $tag: "Nothing" }],
      ["bob", "test.org", { $tag: "Just", _0: "Bob" }],
    ],
    "email:formatAddress": [
      [{ $tag: "Address", local: "alice", domain: "example.com", displayName: { $tag: "Nothing" } }],
      [{ $tag: "Address", local: "bob", domain: "test.org", displayName: { $tag: "Just", _0: "Bob" } }],
      [{ $tag: "Address", local: "", domain: "example.com", displayName: { $tag: "Nothing" } }],
      [{ $tag: "Address", local: "alice", domain: "", displayName: { $tag: "Nothing" } }],
    ],
    // email:bodyText / bodyHtml's "non-matching" arms (`Html { _0 = _ }`
    // / `Text { _0 = _ }`) trip a compiler-side wildcard-vs-literal-`_`
    // ambiguity — the JS-target lowers the wildcard sub-pattern to a
    // literal `"_"` string comparison, where the engine treats `_`
    // as the canonical wildcard binder. NOT a 5b19-introduced gap;
    // a pre-existing parser/emitter substrate gap that 5b19 surfaces
    // by promoting email to candidateFns. Samples here exercise ONLY
    // the binding arms (Text -> Just, Multipart -> Just for bodyText;
    // Html -> Just, Multipart -> Just for bodyHtml) so the per-fn
    // candidate exercise stays clean; the wildcard sub-pattern gap is
    // tracked as a follow-up substrate sub-phase (orthogonal to
    // 5b19's candidateFns-scope expansion).
    "email:bodyText": [
      [{ $tag: "Text", _0: "hello" }],
      [{ $tag: "Multipart", text: "hi", html: "<p>hi</p>" }],
    ],
    "email:bodyHtml": [
      [{ $tag: "Html", _0: "<p>hi</p>" }],
      [{ $tag: "Multipart", text: "hi", html: "<p>hi</p>" }],
    ],
    // -----------------------------------------------------------------
    // Phase 5b20 — picture candidateFns promotion. Samples for picture's
    // 12 pure-bodied functions split into two classes:
    //   (a) concrete numeric / boolean / record outputs (dist / inBox /
    //       clamp01 / lerpColor) — byte-equality is direct.
    //   (b) Field-closure-returning constructors (solid / circle /
    //       rectangle / ellipse / linearGradient / radialGradient /
    //       checkerboard / over) — sameValue's closure-equality probe
    //       (5b15) invokes both engine + compiled closures with [2] and
    //       recurses on the Color result. Picture's inner closures
    //       safely tolerate non-Point probe arg (`p.x` / `p.y` → undefined
    //       → NaN propagates → comparison falses → transparent-pixel
    //       fallback) so both paths land on the same Color value.
    //
    // animation:overAnim joins post-5b20 because picture:over now auto-
    // resolves through sharedFenel — sample is a Frames+Frames pair so
    // sampleAnim returns Raster pictures, the inner Animate closure
    // invokes `over` which builds a Field closure, and the closure
    // probe recursion lands on a consistent Color (the Raster-case
    // returns transparent for non-Point probe inputs uniformly).
    // -----------------------------------------------------------------
    "picture:dist": [
      [{ $tag: "Point", x: 0, y: 0 }, { $tag: "Point", x: 3, y: 4 }],
      [{ $tag: "Point", x: 1, y: 1 }, { $tag: "Point", x: 1, y: 1 }],
      [{ $tag: "Point", x: -1, y: -1 }, { $tag: "Point", x: 2, y: 3 }],
    ],
    "picture:inBox": [
      [
        { $tag: "Point", x: 5, y: 5 },
        { $tag: "Point", x: 0, y: 0 },
        { $tag: "Point", x: 10, y: 10 },
      ],
      [
        { $tag: "Point", x: 15, y: 5 },
        { $tag: "Point", x: 0, y: 0 },
        { $tag: "Point", x: 10, y: 10 },
      ],
      [
        { $tag: "Point", x: 0, y: 0 },
        { $tag: "Point", x: 0, y: 0 },
        { $tag: "Point", x: 10, y: 10 },
      ],
    ],
    "picture:clamp01": [[0.5], [-0.5], [1.5], [0], [1]],
    "picture:lerpColor": [
      [
        { r: 0, g: 0, b: 0, a: 255 },
        { r: 255, g: 255, b: 255, a: 255 },
        0.5,
      ],
      [
        { r: 100, g: 50, b: 200, a: 128 },
        { r: 0, g: 0, b: 0, a: 0 },
        0,
      ],
      [
        { r: 100, g: 50, b: 200, a: 128 },
        { r: 0, g: 0, b: 0, a: 0 },
        1,
      ],
    ],
    // Closure-returning constructors — sameValue probes the inner
    // Field closure with [2]. Picture bodies tolerate the probe-arg
    // shape uniformly across engine + compiled paths (NaN propagation
    // through arithmetic on `2.x` = undefined yields transparent /
    // captured-color uniformly).
    "picture:solid": [[{ r: 200, g: 100, b: 50, a: 255 }]],
    "picture:circle": [
      [
        { $tag: "Point", x: 0, y: 0 },
        5,
        { r: 255, g: 0, b: 0, a: 255 },
      ],
    ],
    "picture:rectangle": [
      [
        { $tag: "Point", x: 0, y: 0 },
        { $tag: "Point", x: 10, y: 10 },
        { r: 0, g: 255, b: 0, a: 255 },
      ],
    ],
    "picture:ellipse": [
      [
        { $tag: "Point", x: 0, y: 0 },
        5,
        3,
        { r: 0, g: 0, b: 255, a: 255 },
      ],
    ],
    "picture:linearGradient": [
      [
        { r: 0, g: 0, b: 0, a: 255 },
        { r: 255, g: 255, b: 255, a: 255 },
        0,
        100,
      ],
    ],
    "picture:radialGradient": [
      [
        { r: 0, g: 0, b: 0, a: 255 },
        { r: 255, g: 255, b: 255, a: 255 },
        { $tag: "Point", x: 0, y: 0 },
        50,
      ],
    ],
    "picture:checkerboard": [
      [10, { r: 0, g: 0, b: 0, a: 255 }, { r: 255, g: 255, b: 255, a: 255 }],
    ],
    "picture:over": [
      [
        { $tag: "Raster", _0: { width: 1, height: 1, pixels: [{ r: 255, g: 0, b: 0, a: 255 }] } },
        { $tag: "Raster", _0: { width: 1, height: 1, pixels: [{ r: 0, g: 255, b: 0, a: 255 }] } },
      ],
    ],
    "animation:overAnim": [
      [
        { $tag: "Frames", _0: { fps: 1, frames: [{ width: 1, height: 1, pixels: [{ r: 255, g: 0, b: 0, a: 255 }] }] } },
        { $tag: "Frames", _0: { fps: 1, frames: [{ width: 1, height: 1, pixels: [{ r: 0, g: 255, b: 0, a: 255 }] }] } },
      ],
    ],
    // -----------------------------------------------------------------
    // Phase 5b21 — sound candidateFns promotion. Samples for sound's
    // pure-bodied functions split into two classes (same posture as
    // 5b20 picture):
    //   (a) concrete numeric / record outputs (sineAt / sawAt /
    //       squareAt / scaleAmp / addAmp / midiToFreq) — byte-equality
    //       is direct.
    //   (b) Wave-closure-returning constructors (sine / note) —
    //       sameValue's closure-equality probe (5b15) invokes both
    //       engine + compiled closures with [2] and recurses on the
    //       Amplitude result. Sound's inner closures uniformly
    //       propagate NaN through arithmetic on `2.seconds` =
    //       undefined; mono's clampUnit folds NaN to 0, so both paths
    //       land on `{l: 0, r: 0}`. Closure-returning bodies with
    //       branching that touches the t.seconds path
    //       (sawtooth / square / gain / mix / delay / pitch / bound /
    //       plucked) stay unsampled pending 5b15 probe-args threading
    //       — same posture as picture's circle / rectangle / ellipse
    //       / linearGradient / radialGradient / checkerboard (which
    //       sample but partition via NON_SUBSTRATE_GAPS).
    //
    // animation:delayAnim + animation:speedAnim sample post-5b21
    // because sound:time now auto-resolves through sharedFenel. Inner
    // Animate closure invokes sampleAnim with a time-shifted argument
    // that builds Time({seconds: 0}) symmetrically across engine +
    // compiled when probed with [2] (NaN propagates through `t.seconds
    // - d` / `f * t.seconds`, time native's `Number(NaN) || 0` lands
    // on 0). With a 1-frame Frames sample anim, sampleAnim at
    // {seconds: 0} returns Raster pic uniformly. Closure-equality
    // probe lands on identical Raster.
    // -----------------------------------------------------------------
    "sound:sineAt": [
      [440, { $tag: "Time", seconds: 0 }],
      [440, { $tag: "Time", seconds: 0.5 }],
      [0, { $tag: "Time", seconds: 1 }],
    ],
    "sound:sawAt": [
      [2, { $tag: "Time", seconds: 0 }],
      [2, { $tag: "Time", seconds: 0.25 }],
      [1, { $tag: "Time", seconds: 0.5 }],
    ],
    "sound:squareAt": [
      [1, { $tag: "Time", seconds: 0 }],
      [1, { $tag: "Time", seconds: 0.25 }],
      [1, { $tag: "Time", seconds: 0.75 }],
    ],
    "sound:scaleAmp": [
      [0.5, { l: 1, r: -1 }],
      [2, { l: 0.3, r: 0.4 }],
      [0, { l: 1, r: 1 }],
    ],
    "sound:addAmp": [
      [{ l: 0.3, r: 0.4 }, { l: 0.5, r: 0.5 }],
      [{ l: -1, r: 1 }, { l: 1, r: -1 }],
    ],
    "sound:midiToFreq": [[69], [60], [81], [0]],
    "sound:sine": [[440]],
    "sound:note": [[69]],
    "animation:delayAnim": [
      [
        1,
        { $tag: "Frames", _0: { fps: 1, frames: [{ width: 1, height: 1, pixels: [{ r: 255, g: 0, b: 0, a: 255 }] }] } },
      ],
    ],
    "animation:speedAnim": [
      [
        2,
        { $tag: "Frames", _0: { fps: 1, frames: [{ width: 1, height: 1, pixels: [{ r: 255, g: 0, b: 0, a: 255 }] }] } },
      ],
    ],
  };
}

// ---------------------------------------------------------------------------
// Phase 5b22 — per-fnId closure-probe args.
//
// Extends Phase 5b15's closure-value boundary fix (tier 6b). 5b15's
// `sameValue` closure-equality branch probes both the engine FenelClosure
// and the compiled callable (JS arrow / WASM `{__cl}` handle / LLVM ptr)
// with a hardcoded `[2]` arg list and recurses on the result. This works
// for std:. / std:$ (both inner closures evaluate to base values for `[2]`)
// + Phase 20's effectful canary; it falls apart for closure-returning
// specs whose inner closures expect record-typed arguments — picture's
// Field closures take a `{$tag: "Point", x, y}`; animation's Animate
// closure takes a `{$tag: "Time", seconds}`. With `[2]`, the engine path's
// var-path resolution on `p.x` returns null (pathwalk-fallback), while
// the compiled path's `(2).x` returns undefined. The two paths diverge
// under arithmetic coercion (null → 0, undefined → NaN) and the closure
// outputs land on different branches.
//
// 5b15's commit notes anticipated this exact extension ("multi-arity
// closure-returning specs in the future would need probe-args threading
// from the sample-shape side"). 5b22 ships it: PROBE_ARGS maps per-fnId
// to the inner-closure probe-arg list. sameValue threads probeArgs
// through recursion (every recursive call inside a single equality
// comparison shares the same probe shape — the outermost fnId selects
// the shape). Unspecified fnIds default to `[2]` (existing behaviour —
// std:. / std:$ + Phase 20 effectfulCanary + every other Phase 5b13-5b21
// closure-returning sample stay correct).
//
// Probe-arg sizing rule: choose a value that, under both paths, traverses
// the body's success branch without divergence — for picture, a Point
// inside the closure's bounded region; for animation, a Time within the
// Animate body's frame index. The probe is a single-level fingerprint of
// closure behavioral equality, not exhaustive — coverage stays the
// per-fn FN_SAMPLES inputs (which feed the outer call directly).
// ---------------------------------------------------------------------------

export const PROBE_ARGS: Record<string, ReadonlyArray<unknown>> = {
  // Picture Field closures take a Point. Closure body uses `p.x` / `p.y`
  // for arithmetic; engine + compiled both resolve to the field value
  // uniformly when probed with a tagged Point record.
  "picture:circle": [{ $tag: "Point", x: 0, y: 0 }],
  "picture:rectangle": [{ $tag: "Point", x: 5, y: 5 }],
  "picture:ellipse": [{ $tag: "Point", x: 0, y: 0 }],
  "picture:checkerboard": [{ $tag: "Point", x: 0, y: 0 }],
  // Phase 5b26 — linearGradient + radialGradient now compile cleanly
  // post lerpColor source-rewrite (single-line collapse closed the
  // parser multi-line-layout bug for the cross-Fenel-call target). Add
  // Point probes mirroring rectangle's pattern so sameValue's closure-
  // equality recursion lands on the same Color value across engine +
  // compiled paths.
  "picture:linearGradient": [{ $tag: "Point", x: 50, y: 0 }],
  "picture:radialGradient": [{ $tag: "Point", x: 25, y: 0 }],
  "picture:over": [{ $tag: "Point", x: 0, y: 0 }],
  // Animation Animate closure takes a Time. Closure body uses
  // `t.seconds` for arithmetic; engine + compiled both resolve uniformly
  // when probed with a tagged Time record.
  "animation:delayAnim": [{ $tag: "Time", seconds: 2 }],
  // `overAnim` returns Animate<Picture>: the first closure consumes Time and
  // returns a Field whose nested closure consumes Point. `sameValue` reuses one
  // probe recursively, so this own-data record intentionally carries both
  // typed projections.
  "animation:overAnim": [{ $tag: "Time", seconds: 0, x: 0, y: 0 }],
};

// ---------------------------------------------------------------------------
// EXPECTED_GAPS per target.
//
// Each entry: a fnId mapped to a short label naming the gap. When the
// function FAILS, the harness records it as `skip` with the documented
// label instead of `fail`. When the function PASSES, the harness flips it
// to a regression: the gap closed; remove the entry.
//
// Phase 17/18/19/20/21 closed every gap on `engine:parseEffectFnId` /
// `engine:makeEffectsExplicit` / `engine:makeClosuresExplicit` for the JS
// target; the Wasm/LLVM targets still carry `engine:normaliseToCore`
// because of per-target string-field convergence in deeply-nested ADT
// walks (Phase 21.6+ substrate work).
// ---------------------------------------------------------------------------

export const JS_EXPECTED_GAPS: ExpectedGaps = {
  // ─────────────────────────────────────────────────────────────────────
  // State of the art (post-5b26): EMPTY of substrate gaps AND EMPTY of
  // non-substrate gaps on JS. The 6-entry parser-blocker partition
  // (time:parseIsoTimestamp + picture:rectangle / linearGradient /
  // radialGradient / inBox / lerpColor) closed via Phase 5b26's batched
  // tier-(11) source-rewrite sub-phase:
  //   - lerpColor: multi-line layout → single-line collapse
  //     (`fenel/modules/picture/types.fenel`). Cascading transitive
  //     closures: linearGradient + radialGradient both call lerpColor
  //     across the cross-Fenel-call boundary; once lerpColor compiles,
  //     both transitive refs resolve.
  //   - inBox: chained `&&` over dotted-CeVar comparisons →
  //     parenthesised-conjunction form (`fenel/modules/picture/
  //     types.fenel`). Cascading transitive closure: rectangle calls
  //     inBox across cross-Fenel-call; once inBox compiles, rectangle's
  //     transitive ref resolves.
  //   - parseIsoTimestamp: anonymous record literal `{ epochMs = ms }`
  //     → named-constructor `Timestamp { epochMs = ms }`
  //     (`fenel/modules/time/parse-iso-timestamp.fenel`). The named
  //     constructor parses as `{construct: ["Timestamp", {epochMs: …}]}`
  //     instead of misparsing as `{call: ["epochMs", …]}`.
  //
  // The underlying parser bug classes (multi-line layout, `&&`-precedence-
  // vs-dotted-CeVar, anonymous-record-literal-in-nested-context) PERSIST
  // at the substrate level. 5b26 is targeted workaround at the user-
  // domain source layer (tier 11), not a substrate fix. Future Fenel
  // bodies that hit the same shapes will still fail to compile until a
  // parser-extension sub-phase addresses the bug roots.
  //
  // All JS-target substrate gap classes already closed across Phase
  // 5b5/13-16 (min/max op-form, Bool-construct boundary, bare-array
  // normalise, closure-value boundary, image-pipeline runtime). 5b22
  // closed the closure-probe arg-shape class via PROBE_ARGS threading.
  // 5b26 closes the parser-blocker class via source-rewrite. 5b17 lock
  // semantics in compilable.test.ts now sees an empty JS partition.
  //
  // Sole remaining Phase 5b JS backlog: 13-entry inline-JSON-Logic body
  // backlog (11 op-form + 2 HOF) — parser-blocked, architecturally
  // orthogonal to the substrate work that landed across 5b13-5b16.
  // ─────────────────────────────────────────────────────────────────────
};

export const WASM_EXPECTED_GAPS: ExpectedGaps = {
  // ─────────────────────────────────────────────────────────────────────
  // State of the art (post-5b27): EMPTY. Substrate gaps + non-substrate
  // gaps both cleared. Phase 5b27 closed the last 2 non-substrate
  // entries (animation:overAnim + sound:note) via a tier-(8) harness-
  // runtime extension that rewires `{__cl, env}` cross-module closure
  // handles to `{__userFn}` shims bound to the origin helper's instance
  // — see `rewireClosureHandles` in `compile-wasm-self-host.test.ts`
  // alongside `buildFenelRuntime` + the post-process wrap in
  // `preCompileSharedWasmHelpers`. NON_SUBSTRATE_GAPS partition is
  // EMPTY post-5b27 (first Phase 5b NSG-zero sub-phase). 5b17 lock
  // semantics: substrate emptiness preserved; partition trivially
  // satisfies `Object.keys(WASM_EXPECTED_GAPS) \ NON_SUBSTRATE_GAPS ==
  // []` because both sides are empty.
  //
  // Closes mirror JS_EXPECTED_GAPS — same substrate work landed on the
  // WASM target uniformly across Phase 5b5/13-16:
  //   - min/max: 5b5 op-form retirement.
  //   - Bool-construct (and/or/not): 5b13 via lower-to-wasm-ast.fenel
  //     lowerWasmConstruct short-circuit + I32Const 1/0 + DomBool +
  //     function-boundary boxBool coercion. Two coordinated inference
  //     fixes (domainOf + inferDomains + inferCeIf cross-arm refinement
  //     via refineCeIfBranches / isConcreteDomain).
  //   - Bare-array normalise (tryParseBoolean): 5b14 via target-agnostic
  //     engine:normaliseToCore extension + lower-to-wasm-ast.fenel
  //     lowerWasmLit isArray arm emitting RefNull externref for the
  //     empty-list base case.
  //   - Closure-value (./$): 5b15 via WASM-side sameValue branch using
  //     callClosure_<arity> dispatch + {__userFn} wrappers for lifted
  //     engine FenelClosures.
  //   - Image-pipeline (imageRetro): 5b16 via buildFenelRuntime binding
  //     imageGrayscale + imagePixelate; Image flows as externref through
  //     the WASM/JS boundary (opaque JS object handle).
  //
  // Phase 5b23 — Field-closure Point ABI domain-inference fallback class
  // CLOSED via the `engine:inferDomains` substrate extension
  // (ctorClosureParamDomains + seedCtorClosureParams seed each
  // Field-wrapped CeClosure's params AND captures with DomRef in the
  // env before the body walk recurses). picture:solid + circle +
  // checkerboard left the WASM partition.
  //
  // Phase 5b25 — `picture:ellipse` closed via source-level let-hoist
  // workaround at `fenel/modules/picture/types.fenel` (tier (11)
  // source-rewrite sub-phase): `ellipse c rx ry col` body wrapped with
  // `let cx = c.x` + `let cy = c.y` hoisting the dotted reads to outer
  // scope BEFORE the Field closure; the inner closure captures undotted
  // `cx` / `cy` instead of dotted `c.x` / `c.y`. The closure-conversion
  // dotted-CeVar capture bug class in `engine:maybeAddFreeVar` PERSISTS
  // — 5b25 is targeted workaround; the proper substrate fix remains
  // queued at `phase-5b24-rescope-closure-conversion-dotted-head-
  // strip.md`. 5b22 framing implication #5 class consolidation REALISED
  // 4-of-4 (5b23 closed 3 via substrate; 5b25 closes the 4th via
  // source-rewrite).
  //
  // Phase 5b26 — batched parser-blocker source-rewrites close the
  // remaining 5 picture/time entries on WASM (mirror of JS closures):
  //   - picture:lerpColor: multi-line layout → single-line collapse.
  //   - picture:inBox: chained `&&` over dotted-CeVar → parenthesised.
  //   - time:parseIsoTimestamp: anonymous record literal →
  //     `Timestamp { epochMs = ms }` named-constructor.
  //   - picture:linearGradient + radialGradient: transitive closure via
  //     lerpColor (cross-Fenel-call resolves).
  //   - picture:rectangle: transitive closure via inBox.
  // Six entries leave the WASM partition together.
  //
  // Phase 5b27 — final 2 non-substrate entries (animation:overAnim +
  // sound:note) closed via a tier-(8) harness-runtime extension at
  // `installSharedWasmWrappers` / `preCompileSharedWasmHelpers`. The
  // wrapper layer wraps each helper export with `rewireClosureHandles`:
  // any `{__cl, env}` shape in the helper's return value tree is
  // post-process-converted to `{__userFn: (...args) => exportFn(env,
  // ...args)}` where `exportFn` is captured from the ORIGIN helper's
  // instance. The consumer's `callClosure_<arity>` early-returns
  // through the existing `__userFn` branch — no harness-runtime
  // `callClosure_<arity>` change. Substrate (engine / emit / lower /
  // normalise) stays exactly as-is; only the WASM-target harness
  // wrapper layer changes. Walk discipline: `{__cl, env}` nodes are
  // TERMINAL — env stays raw so nested closures resolve via the
  // export-host's own WASM-internal dispatch path.
  //
  // **WASM_EXPECTED_GAPS partition + NON_SUBSTRATE_GAPS partition both
  // EMPTY post-5b27 — first Phase 5b NSG-zero sub-phase. Substrate-
  // completion claim STRENGTHENED for the cross-module closure-
  // returning helper dispatch class across JS + WASM.**
  // ─────────────────────────────────────────────────────────────────────
};

// ---------------------------------------------------------------------------
// Phase 5b19 — substrate-vs-non-substrate gap partition.
//
// 5b18 framing implication #4 introduced the distinction: substrate
// gaps are gaps in the engine's normalise / emit / lower / harness-
// runtime pipeline; non-substrate gaps live in adjacent surfaces
// (parser, type-system, cross-target ABI placeholders) where the
// substrate path itself is COMPLETE but the call site doesn't
// resolve. 5b17's lock assertion conflated the two — any new
// EXPECTED_GAPS entry fired the lock regardless of whether it
// represented a substrate regression or a documented adjacent-surface
// gap.
//
// 5b19 partitions: NON_SUBSTRATE_GAPS lists the entries that the
// lock semantics in `compilable.test.ts` EXEMPT from the substrate-
// completion lock. An entry's presence here means "this gap is real,
// documented, and does NOT regress substrate work". The lock asserts
// `Object.keys(JS/WASM_EXPECTED_GAPS) \ NON_SUBSTRATE_GAPS == []`.
//
// Post-5b27 contents: **EMPTY**. First Phase 5b NSG-zero sub-phase —
// closes the cross-module closure-handle dispatch class (animation:
// overAnim + sound:note) via a tier-(8) harness-runtime extension at
// `installSharedWasmWrappers` (rewires `{__cl, env}` to `{__userFn}`
// shims bound to the origin helper's instance). The original parser-
// blocker partition (7 entries — 5b20 picture + 5b19 time:
// parseIsoTimestamp) closed in waves:
//   - 5b22: closure-probe arg-shape class (substrate, comparator).
//   - 5b23: Field-closure Point ABI domain-inference (substrate, WASM).
//   - 5b25: picture:ellipse let-hoist (source-rewrite, tier 11).
//   - 5b26: lerpColor / inBox / parseIsoTimestamp source-rewrites +
//     transitive linearGradient / radialGradient / rectangle (tier
//     11 batched).
// Six entries left the partition across 5b22-5b26. The remaining 2
// cross-module closure-handle dispatch entries close in 5b27 via
// tier (8) harness-runtime extension — partition shrinks 2 → 0.
//
// **5b17 lock semantics**: with both WASM_EXPECTED_GAPS and
// NON_SUBSTRATE_GAPS empty, the partition assertion
// `Object.keys(JS/WASM_EXPECTED_GAPS) \ NON_SUBSTRATE_GAPS == []` is
// trivially satisfied (`[] \ [] == []`). The lock STAYS active as a
// regression guard — any NEW EXPECTED_GAPS entry added without an
// NSG entry will trip the lock.
// ---------------------------------------------------------------------------

export const NON_SUBSTRATE_GAPS: ReadonlySet<string> = new Set<string>([
  // **EMPTY post-5b27** — first Phase 5b NSG-zero sub-phase. The
  // cross-module closure-handle dispatch class (animation:overAnim +
  // sound:note) closed via a tier-(8) harness-runtime extension at
  // `installSharedWasmWrappers` / `preCompileSharedWasmHelpers`
  // (`rewireClosureHandles` post-process wrap of helper exports).
  // Substrate (engine / emit / lower / normalise / cross-Fenel-call
  // sharedFenel + sharedWasmFenelWrappers) stays exactly as-is; only
  // the WASM-target harness wrapper layer changes. The empty set still
  // functions as a regression guard via the 5b17 lock-assertion
  // semantics in `compilable.test.ts`.
]);

export const LLVM_EXPECTED_GAPS: ExpectedGaps = {
  // ─────────────────────────────────────────────────────────────────────
  // State of the art (post-5b17): 7 entries — all in the clang-missing
  // baseline-timeout class, NOT in any substrate-gap class.
  //
  // Substrate alignment with JS + WASM is COMPLETE across Phase 5b13-16:
  //   - Bool-construct (and/or/not): 5b13 — emitter alignment shipped
  //     uniformly across all 3 targets via the same engine:normaliseToCore
  //     / inference fixes; the LLVM IR would compile + behaviorally match
  //     the JS + WASM output.
  //   - Bare-array (tryParseBoolean): 5b14 — lower-to-llvm-ast.fenel
  //     lowerLlvmLit isArray arm emits ConstNullPtr for [] base case;
  //     ABI symmetric with WASM.
  //   - Closure-value (./$): 5b15 — Phase 18 FenelClosure* ABI + JS
  //     Callback wrapper documented in compile-llvm-self-host.test.ts;
  //     sameValue branch wired symmetrically.
  //   - Image-pipeline (imageRetro): 5b16 — CLOSURE_RUNTIME_C trailing
  //     comment documents the forward-looking fenel_imageGrayscale +
  //     fenel_imagePixelate C stubs Phase 6+ clang availability needs;
  //     the IR lowers to declarations + call sites for these helpers.
  //
  // Why all 7 STAY: per-fnId bun:test 5s timeout in runOne fires before
  // the gap-skip / behavioral-equality / emitter-output comparison
  // can run, hitting clang's missing baseline. Phase 6+ clang
  // availability unlocks ALL 7 at zero further substrate cost — the
  // 5b13-5b16 work landed at the substrate level uniformly; only the
  // operational gate stays blocked on clang.
  //
  // Entry shape: each label documents (a) the substrate boundary class
  // that closed for JS + WASM in the corresponding sub-phase, (b) the
  // post-5b16/5b17 status (substrate-aligned), (c) the clang-missing
  // gate that pre-empts. Removing an entry requires either clang
  // availability OR per-spec bun:test timeout override.
  // ─────────────────────────────────────────────────────────────────────
  "std:imageRetro":
    "LLVM target compiles the canonical call-form successfully (post-5b5) AND post-5b16 the harness-runtime-extension recipe is symmetrically wired at the placeholder level (compile-llvm-self-host.test.ts CLOSURE_RUNTIME_C trailing comment documents the forward-looking `fenel_image_grayscale` / `fenel_image_pixelate` stub set). The spec STILL stays SKIPped behind the per-fnId 5s clang-missing baseline timeout in runOne — same as std:and / std:or / std:not / std:tryParseBoolean / std:. / std:$ / std:ifElse. Phase 6+ clang availability unlocks std:imageRetro at zero further substrate cost; only the C stubs (or libffi-style JS callback) remain",
  "std:and":
    "LLVM target compiles the if-form and would close post-Phase-5b13 Bool-construct emitter alignment, but the per-fnId bun:test 5s clang-missing baseline timeout pre-empts both the emitter-output comparison and the gap-skip path; Phase 6+ clang availability unlocks at zero further substrate cost",
  "std:or":
    "LLVM target compiles the if-form and would close post-Phase-5b13 Bool-construct emitter alignment, but the same clang-missing baseline timeout pre-empts as std:and",
  "std:not":
    "LLVM target compiles the if-form and would close post-Phase-5b13 Bool-construct emitter alignment, but the same clang-missing baseline timeout pre-empts as std:and / std:or",
  "std:tryParseBoolean":
    "LLVM target's Bool-construct boundary is closed post-5b13 AND the bare-array boundary is closed post-5b14 (the target-agnostic `engine:normaliseToCore` substrate extension + the matching `lower-to-llvm-ast.fenel` lowerLlvmLit isArray arm); the spec STILL stays blocked behind the 5s clang-missing baseline timeout in runOne. Phase 6+ clang availability unlocks std:tryParseBoolean at zero further substrate cost — no residual normalise / lowering work remains",
  "std:.":
    "LLVM target's closure-value boundary is closed post-5b15 (sameValue Phase 5b15 branch + the cross-target inline-`{fn:...}` sample reshape + Phase 18 FenelClosure* ABI); the spec STILL stays blocked behind the 5s clang-missing baseline timeout in runOne. Phase 6+ clang availability unlocks std:. at zero further substrate cost — no residual normalise / lowering work remains",
  "std:$":
    "LLVM target's closure-value boundary is closed post-5b15 same as std:. (sample reshape from string fnId to inline `{fn:...}` closure + sameValue Phase 5b15 branch); the same 5s clang-missing baseline timeout pre-empts. Phase 6+ clang availability unlocks std:$ at zero further substrate cost",
  // ─────────────────────────────────────────────────────────────────────
  // Phase 5b19 — audit-target candidateFns promotion. Each newly-
  // promoted body sampled below joins the clang-missing baseline-
  // timeout class on LLVM. The IR lowers correctly (substrate-aligned
  // with JS + WASM); only the per-fnId 5s bun:test timeout in runOne
  // pre-empts the FFI run. Same posture as the 5b13-5b16 substrate
  // leaves — the C-runtime stubs documented in compile-llvm-self-host
  // .test.ts CLOSURE_RUNTIME_C trailing comment (`fenel_find` /
  // `fenel_hostDateParse` / `fenel_point` / `fenel_sampleAnim`)
  // unlock at Phase 6+ clang availability at zero further substrate
  // cost.
  // ─────────────────────────────────────────────────────────────────────
  "events:sampleEvent":
    "LLVM target lowers the find HOF + case match + Maybe ABI uniformly (find binding is harness-runtime-additive on JS + WASM via Phase 5b19; LLVM substitutes the fenel_find C stub per the CLOSURE_RUNTIME_C trailing comment); per-fnId 5s clang-missing baseline timeout pre-empts.",
  "time:parseIsoTimestamp":
    "Parser-ambiguity gap (anonymous record literal `{ epochMs = ms }` lowers as `epochMs ms` call-form) — same root cause as JS / WASM_EXPECTED_GAPS entries. LLVM target additionally has the 5s clang-missing baseline timeout. Fix needs parser disambiguation OR .fenel source migration to `Timestamp { epochMs = ms }` constructor. Distinct from substrate-gap class per 5b18 framing implication #4.",
  "path:line":
    "LLVM target lowers the cross-Fenel-call `point(...)` + `lerp(...)` uniformly (point binding ships on JS + WASM via Phase 5b19; LLVM substitutes the fenel_point C stub per the CLOSURE_RUNTIME_C trailing comment); per-fnId 5s clang-missing baseline timeout pre-empts.",
  "track:trackEntry":
    "LLVM target lowers the TrackEntry { start, sound } record constructor uniformly; per-fnId 5s clang-missing baseline timeout pre-empts.",
  // ─────────────────────────────────────────────────────────────────────
  // Phase 5b20 — picture candidateFns promotion. Each newly-promoted
  // body sampled below joins the clang-missing baseline-timeout class
  // on LLVM (mirror of 5b19's audit-target entries above). IR lowers
  // correctly (substrate-aligned with JS + WASM); only the per-fnId
  // 5s bun:test timeout pre-empts. The 5 new C-runtime stubs documented
  // at CLOSURE_RUNTIME_C trailing edge (`fenel_floor` / `fenel_sqrt`
  // / `fenel_alphaBlend` / `fenel_sample` / `fenel_color`) unlock at
  // Phase 6+ clang availability at zero further substrate cost.
  // animation:overAnim joins because its body's `$fenel.over(...)`
  // cross-call ref resolves through sharedFenel post-5b20 promotion.
  // ─────────────────────────────────────────────────────────────────────
  "picture:dist":
    "LLVM target lowers the Euclidean magnitude (sqrt over squared differences across Point fields) uniformly with JS + WASM; per-fnId 5s clang-missing baseline timeout pre-empts. fenel_sqrt C stub documented in CLOSURE_RUNTIME_C trailing comment.",
  "picture:lerpColor":
    "LLVM target lowers the cross-Fenel-call to std:lerp (4 channels: r/g/b/a) + picture:color constructor uniformly; per-fnId 5s clang-missing baseline timeout pre-empts. fenel_color C stub documented in CLOSURE_RUNTIME_C trailing comment.",
  "picture:solid":
    "LLVM target lowers the Field-tagged constant-closure construction uniformly; per-fnId 5s clang-missing baseline timeout pre-empts. Closure body captures the Color via the Phase 18 FenelClosure ABI; sameValue's closure-equality probe (5b15) gates the per-fn comparison on JS + WASM.",
  "picture:circle":
    "LLVM target lowers the Field-closure conditional (`dist p c <= r`) + cross-Fenel-call to picture:dist + transparent-pixel fallback via fenel_color uniformly; per-fnId 5s clang-missing baseline timeout pre-empts.",
  "picture:rectangle":
    "LLVM target lowers the Field-closure conditional (`inBox p p1 p2`) + cross-Fenel-call to picture:inBox + transparent-pixel fallback via fenel_color uniformly; per-fnId 5s clang-missing baseline timeout pre-empts.",
  "picture:ellipse":
    "LLVM target lowers the Field-closure conditional (axis-aligned ellipse equation) + transparent-pixel fallback via fenel_color uniformly; per-fnId 5s clang-missing baseline timeout pre-empts.",
  "picture:linearGradient":
    "LLVM target lowers the Field-closure linear interpolation (cross-Fenel-call to picture:lerpColor + picture:clamp01) uniformly; per-fnId 5s clang-missing baseline timeout pre-empts.",
  "picture:radialGradient":
    "LLVM target lowers the Field-closure radial interpolation (cross-Fenel-call to picture:lerpColor + picture:clamp01 + picture:dist) uniformly; per-fnId 5s clang-missing baseline timeout pre-empts.",
  "picture:checkerboard":
    "LLVM target lowers the Field-closure parity check (`mod (floor (p.x / tile) + floor (p.y / tile)) 2 < 1`) uniformly; per-fnId 5s clang-missing baseline timeout pre-empts. fenel_floor C stub documented in CLOSURE_RUNTIME_C trailing comment.",
  "picture:over":
    "LLVM target lowers the Field-closure composing alphaBlend + sample over two captured Pictures uniformly; per-fnId 5s clang-missing baseline timeout pre-empts. fenel_alphaBlend + fenel_sample C stubs documented in CLOSURE_RUNTIME_C trailing comment. The closure body invokes sample twice (once per Picture arg) before alphaBlend composes the result — Phase 18 FenelClosure ABI handles the recursion symmetric with JS + WASM.",
  "animation:overAnim":
    "LLVM target lowers the Animate-closure cross-call to picture:over + sampleAnim uniformly with JS + WASM (picture:over is now a sharedFenel-resolved Fenel helper post-5b20 promotion; sampleAnim per the 5b19 fenel_sampleAnim C stub); per-fnId 5s clang-missing baseline timeout pre-empts. The nested closure recursion (Animate closure constructs a Field closure via over, the Field closure invokes sample + alphaBlend) tests the full closure-conversion-through-cross-call-substrate substrate end-to-end at the IR level.",
  // ─────────────────────────────────────────────────────────────────────
  // Phase 5b21 — sound candidateFns promotion. Each newly-promoted
  // body sampled below joins the clang-missing baseline-timeout class
  // on LLVM (mirror of 5b19/5b20 audit-target + picture entries above).
  // IR lowers correctly (substrate-aligned with JS + WASM); only the
  // per-fnId 5s bun:test timeout pre-empts. The 9 new C-runtime stubs
  // documented at CLOSURE_RUNTIME_C trailing edge (`fenel_sin` /
  // `fenel_pow` / `fenel_sample_sound` / `fenel_time` /
  // `fenel_amplitude` / `fenel_mono` / `fenel_amp_l` / `fenel_amp_r`
  // / `fenel_audio_buffer`) unlock at Phase 6+ clang availability at
  // zero further substrate cost. animation:delayAnim + speedAnim
  // join the same class because their bodies' `$fenel.time(...)`
  // cross-call refs resolve through sharedFenel post-5b21 promotion.
  // ─────────────────────────────────────────────────────────────────────
  "sound:sineAt":
    "LLVM target lowers the std:sin call + Number arithmetic (`6.28... * f * t.seconds`) uniformly with JS + WASM; per-fnId 5s clang-missing baseline timeout pre-empts. fenel_sin C stub documented in CLOSURE_RUNTIME_C trailing comment.",
  "sound:sawAt":
    "LLVM target lowers the std:floor cross-Fenel-call + Number arithmetic uniformly; per-fnId 5s clang-missing baseline timeout pre-empts.",
  "sound:squareAt":
    "LLVM target lowers the sound:sineAt cross-Fenel-call + Bool comparison + if-form uniformly; per-fnId 5s clang-missing baseline timeout pre-empts.",
  "sound:scaleAmp":
    "LLVM target lowers the sound:amplitude / ampL / ampR cross-Fenel-call chain + Number arithmetic uniformly; per-fnId 5s clang-missing baseline timeout pre-empts. fenel_amplitude / fenel_amp_l / fenel_amp_r C stubs documented in CLOSURE_RUNTIME_C trailing comment.",
  "sound:addAmp":
    "LLVM target lowers the sound:amplitude / ampL / ampR cross-Fenel-call chain + Number arithmetic uniformly; per-fnId 5s clang-missing baseline timeout pre-empts.",
  "sound:midiToFreq":
    "LLVM target lowers the std:pow cross-Fenel-call + Number arithmetic uniformly; per-fnId 5s clang-missing baseline timeout pre-empts. fenel_pow C stub documented in CLOSURE_RUNTIME_C trailing comment.",
  "sound:sine":
    "LLVM target lowers the Wave-tagged closure construction + sound:mono / sineAt cross-Fenel-call uniformly; per-fnId 5s clang-missing baseline timeout pre-empts. fenel_mono C stub documented in CLOSURE_RUNTIME_C trailing comment.",
  "sound:note":
    "LLVM target lowers the sound:sine / midiToFreq cross-Fenel-call uniformly; per-fnId 5s clang-missing baseline timeout pre-empts.",
  "animation:delayAnim":
    "LLVM target lowers the Animate-tagged closure construction + sound:time / sampleAnim cross-Fenel-call uniformly (sound:time is now a sharedFenel-resolved Fenel helper post-5b21 promotion; sampleAnim per the 5b19 fenel_sampleAnim C stub); per-fnId 5s clang-missing baseline timeout pre-empts. fenel_time C stub documented in CLOSURE_RUNTIME_C trailing comment.",
  "animation:speedAnim":
    "LLVM target lowers the Animate-tagged closure construction + sound:time / sampleAnim cross-Fenel-call uniformly; per-fnId 5s clang-missing baseline timeout pre-empts. fenel_time C stub documented in CLOSURE_RUNTIME_C trailing comment.",
  // ─────────────────────────────────────────────────────────────────────
  // Phase 5b30 — observation-truthful matrix surface flagged 19 LLVM
  // silent-skip cases. Phase 5b31 landed 3 substrate fixes —
  // `C_RUNTIME_NATIVES` skip in `preCompileSharedLlvmHelpers`,
  // `generateEffectShimC` typedef strip, AND self-declare strip in helper
  // IRs — closing layers (i) `fenel_mod` collision + (ii) self-`declare`-
  // then-`define` IR redefinition. Layer (iii) — missing extern symbols
  // at link time — STAYED open.
  //
  // Phase 5b32 — `computeTransitiveHelperClosure(bodyIr, helpers)` link-
  // lazy bundling at the harness layer. Only helpers transitively
  // referenced from the per-fnId body IR get linked; unreferenced
  // helpers' dangling extern declares (for TS-leaves / effectful /
  // silently-failing source fns) no longer enter the link. 13 of 19
  // class-(c) entries CLOSED via this substrate extension —
  // std:add / sub / mul / div / lerp / eq / neq / lt / gt / lte / gte /
  // min / max (all arithmetic primitives with empty transitive closures).
  //
  // The remaining 6 entries stay GAP-tagged on DIFFERENT root causes —
  // post-5b32 link-lazy probe surfaced sub-classes that are NOT
  // link-cascade and require separate follow-up sub-phases:
  //
  //  (c-1) Bun FFI segfault — std:mod's link succeeds + .so loads, but
  //        Bun crashes inside the FFI call path (`panic(main thread):
  //        Segmentation fault at address 0x3`). Independent of the link
  //        cascade — std:mod's IR has empty Fenel-helper closure (the
  //        only callees are CLOSURE_RUNTIME_C natives `fenel_box_num` /
  //        `fenel_unbox_num` / `fenel_mod`). Suspected Bun 1.3.11
  //        FFI-layer issue specific to std:mod's shape; needs Bun-side
  //        investigation or alternate FFI-bind path.
  //  (c-2) FFI return-marshalling mismatch — phase20:effectfulCanary's
  //        link succeeds + .so loads + handler-registration round-trips,
  //        but the FFI run returns `18446744073709552000` (~2^64 - 2000)
  //        when engine returns `-7`. The compiled body's `double` return
  //        is being read as `u64` by Bun's FFI binding for some shape of
  //        effect-shim integration. The marshalling-layer fix lives in
  //        runOne's `argFfi` / `retFfi` derivation OR in
  //        `lower-to-llvm-ast.fenel`'s effect-aware return-type emission.
  //  (c-3) post-5b33 CORRECTED — the 4 engine:* bodies
  //        (parseEffectFnId / normaliseToCore / makeEffectsExplicit /
  //        makeClosuresExplicit) had their link-cascade root cause
  //        MIS-DIAGNOSED by 5b32's brief as "LLVM emitter synthetic
  //        `@fenel_value(...)` / etc. calls from `$bind` lowering". That
  //        diagnosis came from a closure-verifier probe that ran
  //        normaliseToCore with empty `ctorDefs` — causing the named-
  //        record `{value: X}` to lower as an op-form CoreCall fnId="value"
  //        (no synthetic emitter bug). With the real harness ctorDefs
  //        (containing `Just: ["value"]`), normaliseToCore produces the
  //        correct CoreConstruct + the LLVM emitter produces correct
  //        `fenel_set_field_named` calls. The ACTUAL (c-3) link-cascade
  //        root cause was undefined-symbol references to std TS-leaves:
  //        `_fenel_startsWith` (camelCase from codeName) didn't match
  //        CLOSURE_RUNTIME_C's `fenel_starts_with` (snake_case), AND
  //        `_fenel_concat` / `_fenel_contains` / `_fenel_elem` /
  //        `_fenel_sortLex` / `_fenel_toString` were missing entirely.
  //        5b33 closes the link-cascade via camelCase wrapper + new C
  //        natives + promoting std:appendItem to C_RUNTIME_NATIVES (its
  //        Fenel body lowers to self-recursive LLVM IR without a base
  //        case; the C native bypasses the broken helper).
  //  (c-4) CLOSED post-5b34 — `lowerLlvmDefaultPath` in `lower-to-llvm-
  //        ast.fenel` now consults `llvmCallDomainOf` instead of
  //        hardcoding `ptr (ptr...) → ptr`. The new arms for `length`
  //        (returns `DomDouble`) and `slice` (takes `(DomPtr, DomDouble,
  //        DomDouble)`) flow through to declare/call/return type
  //        emission, matching CLOSURE_RUNTIME_C's C signatures. Two new
  //        helper fns added: `buildLlvmDomainTypedParamList` builds a
  //        `List<LlvmParam>` from `argDomains` (per-arg `valType` via
  //        `llvmDomainToValType`), and `lowerLlvmDomainTypedArgs` walks
  //        args + argDomains in parallel, lowering each arg at its
  //        target domain. The legacy `buildLlvmPtrParamList` /
  //        `lowerLlvmPtrArgs` stay for the `$effect:` path (all-ptr by
  //        ABI contract). The `length x == 0` numeric comparison now
  //        routes through `fcmp oeq` naturally because `llvmCallDomainOf
  //        length` returns `DomDouble`, so `llvmIsStringTypedEq` sees
  //        non-string-typed operand + dispatch falls through to
  //        `lowerLlvmDirectCmpPath`. Closed parseEffectFnId observed OK
  //        (12 samples); the other 3 engine:* entries surface (c-5).
  //  (c-5) CLOSED post-5b35 — `liftSampleForCompiledLlvm` extended with
  //        recursive typed-record / anonymous-record / list materialisation
  //        via `fenel_construct` + `fenel_set_field_named` + `fenel_appendItem`
  //        + `fenel_box_num` + `fenel_box_bool` (all opened unconditionally
  //        in the FFI symbolSpec). The arg-lift now walks any JS object
  //        sample arg, emits a per-field FenelAdt struct on the C side, and
  //        returns the resulting `void *` to Bun FFI. The 3 target fnIds'
  //        FFI `Unable to convert [object Object] to a pointer` rejections
  //        no longer occur — the body runs to completion.
  //  (c-6) CLOSED post-5b36 — `marshalAdtPtr` extended with: (a) `$named`
  //        resolution via `harnessRegistry.getEntity(name)?.type` recursing
  //        into the resolved ADT type, (b) `$opaque List` arm walking
  //        FenelList items via new `fenel_list_length` / `fenel_list_get`
  //        C natives (`fenel_is_list` de-staticed; `fenel_empty_list`
  //        added so arg-lift's empty-array case produces a real length-0
  //        FenelList with magic rather than null), (c) `$record` tag
  //        preservation reading `fenel_get_tag` on the C-side FenelAdt
  //        and attaching as `$tag` (skipping the synthetic `"$record"`
  //        tag from anonymous-record construction). New `structuralRead`
  //        helper walks the C-side shape independently of expectedType
  //        for `$var` / unresolved `$named "a"` (type-variable leak)
  //        cases — recognises FenelList magic, FenelAdt via new magic
  //        marker on FenelAdt + magic-check inside `fenel_get_tag`,
  //        boxed Number via new FENEL_BOX_NUM_MAGIC prefix in
  //        `fenel_box_num` / `fenel_unbox_num` (FenelBoxNum struct), and
  //        falls back to NUL-term string via CString. The 5b35 arg-lift
  //        had a related ABI gap: raw scalar args got passed as-is to
  //        Bun FFI, but the LLVM emitter domain-analyses some
  //        Number-typed params as `Ptr` (e.g., events:eventEntry's
  //        timestamp), so raw `1` arrived as ptr `0x1` → C segfault.
  //        `liftSampleForCompiledLlvm` extended to box raw Number /
  //        Bool args via `fenel_box_num` / `fenel_box_bool` when the
  //        per-arg IR `paramType.$tag === "Ptr"`. `sameValue` aligned
  //        with the engine evaluator's `construct`-op behavior of
  //        dropping undefined-valued keys via null-as-absent filter.
  //  (c-7) post-5b36 — engine:normaliseToCore body-semantic
  //        divergence on JsonLogic operator-form input. The 5b36
  //        commit message hypothesised this was an Infixable
  //        dispatch / fixity-table gap; pre-port verification in
  //        5b37 traced the actual root cause to the C-runtime
  //        `fenel_length` C native being strlen-only and reading
  //        the FENEL_LIST_MAGIC bytes as ASCII garbage when the
  //        body's `lowerObjectExpr` / `lowerJlArrayItems` /
  //        `lowerSingleKey` / etc. called `length` on a FenelList
  //        arg (List<JlField> / List<JsonLogic> / List<String>).
  //        Garbage length mis-routed the `eq n 0` / `eq n 1` /
  //        `lt n 2` dispatch branches into the multi-key
  //        fallthrough `lowerRecordFields` path → CoreRecord with
  //        a literal `+` field instead of CoreCall(add, ...).
  //        CLOSED post-5b37 via two coordinated C-runtime
  //        substrate extensions: (1) `fenel_length` polymorphic
  //        dispatch via `fenel_is_list` magic-marker check —
  //        mirror of 5b33's `fenel_concat` / `fenel_elem`
  //        polymorphic recipe — returning `((FenelList *)v)->length`
  //        for list ptrs and falling through to `strlen` for
  //        NUL-term char* otherwise; AND (2) FENEL_BOX_BOOL_MAGIC
  //        sentinel added to `FenelBoxBool` struct so
  //        `structuralRead`'s return-marshal fallback can recover
  //        unboxed JS booleans (without magic-bool, a raw 1-byte
  //        alloc round-tripped back as the 1-char string
  //        "\\u0001" — this was the FIRST failing sample
  //        encountered in the 5b37 pre-port probe, distinct from
  //        the originally-targeted operator-form CoreRecord
  //        divergence). Both fixes were needed before sample 4
  //        (operator-form `+`) could even be reached past sample
  //        3 (bool literal). (c-7) FULLY CLOSED for samples 1-7
  //        but engine:normaliseToCore STAYS gap-tagged on NEW
  //        sub-class (c-8) surfaced by sample 8 — see below.
  //
  //  (c-8) CLOSED post-5b38 — engine:normaliseToCore body-
  //        semantic divergence on `{ construct: ["Just", 5] }`
  //        sample 8 traced to an LLVM emitter call-site ABI
  //        mismatch at `lowerConstructOp` → `positionalFieldsForCtor`:
  //        the callee's body inference makes its 2nd param
  //        `argLen` DomDouble (used in `eq (length ctorDef)
  //        argLen` where `length` returns DomDouble), so its
  //        IR signature is `(ptr ctorDefM, double argLen) →
  //        ptr`. The caller used the default all-DomPtr emit
  //        path, declaring `(ptr, ptr) → ptr` and passing
  //        `fenel_box_num(length args)` as a boxed ptr. The
  //        X86-64 SystemV register split (integer args via RDI
  //        / RSI vs SSE args via XMM0..XMM7) meant the boxed-
  //        ptr-as-2nd-arg landed in RSI while the callee read
  //        XMM0 — stale XMM0 contents drove the wrong `Nothing`
  //        return → CoreConstruct lowered without
  //        `fields=["value"]` and the cascading top-level
  //        normaliseToCore returned NULL. Fix: explicit
  //        `positionalFieldsForCtor` entry in `llvmCallDomainOf`
  //        (`argDomains = [DomPtr, DomDouble]`, `resultDomain =
  //        DomPtr`) — mirrors 5b34's `length` / `slice` recipe
  //        and aligns caller declare + call site with callee
  //        ABI. Single-sample probe of sample 8 passes
  //        deterministically post-fix (5/5 attempts). Per brief
  //        possible-deviation #3: matrix-gen full-sample
  //        sequence still segfaults Bun 1.3.11 (independent of
  //        (c-8); unrelated Bun FFI heap issue stays in
  //        FFI_SEGFAULT_FNIDS with updated comment). engine:*
  //        substrate cluster FULLY CLOSED at substrate level
  //        (4 of 4) — parseEffectFnId / makeEffectsExplicit /
  //        makeClosuresExplicit OK in matrix; normaliseToCore
  //        substrate-closed but visible matrix cell stays
  //        SKIP→GAP behind the unrelated Bun-side crash.
  //
  // 5b36 SURPRISE closes: 5b30 lock assertion fired in
  // compile-llvm-self-host.test.ts post-fix on 14 baseline-class
  // entries — events:event / events:eventEntry / time:timestamp /
  // time:duration / time:addDuration / time:diffTimestamps /
  // time:seconds / time:minutes / time:hours / time:days /
  // animation:frameSequence / path:path / track:track /
  // email:address — that all take or return tagged records / lists
  // with Number fields. Their previous "clang-missing baseline
  // timeout" tag was MIS-DIAGNOSED — the actual blockers were a
  // mix of (c-5) arg-marshalling for the typed-record args + (c-6)
  // return-side `$named` / FenelList / tag-preservation gaps + the
  // newly-fixed raw-scalar-arg boxing gap. With the 5b36 extension,
  // their FFI roundtrips complete. Removed from LLVM_EXPECTED_GAPS
  // in this commit. Plus phase20:effectfulCanary's (c-2) FFI
  // return-marshalling unexpectedly closes too — the new
  // FenelBoxNum magic-prefix layout + the related fenel_unbox_num
  // / fenel_lit_eq / fenel_mod / fenel_toString updates apparently
  // realign Bun's FFI binding for `double` returns through the
  // boxed-num path. Mirror of 5b32's 2 + 5b35's 6 surprise closes
  // — substrate extensions cascading wins through the lock
  // assertion is the signal that prior diagnoses were incomplete.
  //
  // 5b32 closes 13 entries; the 6 below stay GAP-tagged with updated
  // reasons documenting their distinct root-cause sub-class. 5b33 closes
  // the (c-3) link-cascade layer at the C-runtime ABI surface. 5b34
  // closes (c-4) for engine:parseEffectFnId via the lowerLlvmDefaultPath
  // domain-typed call-emit (1 entry → OK). 5b35 closes (c-5)
  // arg-marshalling at the FFI lift layer; the 3 engine:* entries
  // surface NEW (c-6) return-side marshalling — separate follow-up.
  //
  // 5b35 SURPRISE closes: 5b30 lock assertion fired in
  // compile-llvm-self-host.test.ts post-fix on 6 baseline-class entries
  // — time:before / time:after / email:formatAddress / email:bodyText /
  // email:bodyHtml / picture:inBox — that all take tagged-record args
  // (Timestamp / Address / Body / Point). Their previous "clang-missing
  // baseline timeout" tag was MIS-DIAGNOSED — the actual blocker was
  // (c-5) FFI arg-marshalling, just hidden behind the same per-fnId 5s
  // bun:test timeout because Bun's `Unable to convert [object Object]`
  // error path is slow. With 5b35's arg-lift extension, the body runs +
  // their return shapes are simple enough (Bool / String) that
  // marshalAdtPtr's existing branches handle the return without (c-6).
  // Removed from LLVM_EXPECTED_GAPS in this commit. Mirror of 5b32's
  // 2 surprise closes (std:ifElse + picture:clamp01) — substrate
  // extensions cascading wins through the lock assertion is the
  // signal that the diagnosis was previously incomplete.
  // ─────────────────────────────────────────────────────────────────────
  "std:mod":
    "LLVM link succeeds post-5b32 link-lazy bundling (transitive helper closure is empty; std:mod's body IR calls only CLOSURE_RUNTIME_C natives `fenel_box_num` / `fenel_unbox_num` / `fenel_mod`). Bun 1.3.11 FFI segfaults at runtime when invoking the dlopen'd `mod` symbol (`panic(main thread): Segmentation fault at address 0x3`). Reproducible on both isolated `bun -e` probes and the bun:test harness. Independent of the link cascade — needs Bun-side FFI investigation or alternate bind path (sub-class (c-1) post-5b32).",
  "engine:normaliseToCore":
    "(c-4) post-link ABI mismatch CLOSED post-5b34. (c-5) arg-marshalling CLOSED post-5b35. (c-6) return-marshal CLOSED post-5b36. (c-7) CLOSED post-5b37. (c-8) substrate-level CLOSED post-5b38 (explicit `positionalFieldsForCtor` entry in `llvmCallDomainOf` aligns lowerConstructOp's call-emit ABI with the body-inferred `(ptr ctorDefM, double argLen) → ptr`). Phase 5b39 closes the Bun-side dlopen-accumulation crash via per-fnId subprocess dispatch (SUBPROCESS_FNIDS entry; child Bun process loads the .so in a clean dlopen table → matrix-gen + bun:test harness no longer segfault at address 0x0). engine:normaliseToCore was REMOVED from FFI_SEGFAULT_FNIDS post-5b39 because the subprocess workaround eliminates the crash. The post-5b39 ~7-20% per-sample `compiled=null` flake (samples 2/5/6/7/10/11) was diagnosed in 5b40 as (c-9b) — `materialiseTypedRecord` / `constructAdtFromFields` / `materialiseValue` passed JS Buffer pointers to `fenel_construct` (tag) / `fenel_set_field_named` (name + string value); the C-side stored those raw pointers in adt->tag / adt->field_names[i] / adt->fields[i] without copying (the available `tag_len` / `name_len` ABI params were explicitly ignored), and the originating JS Buffer became GC-eligible the moment its local variable went out of scope — well before the body's later `fenel_get_tag` / `fenel_get_field_named` / strcmp on those slots. Heisenbug-shaped fresh-process flake matches the GC-vs-FFI-lifetime race exactly. (c-9b) JS-side fix in 5b40 — `liftSampleForCompiledLlvm` threads a per-runOne `stringCache` + per-iteration `keepalive` array through `materialiseTypedRecord` / `materialiseAnonRecord` / `materialiseValue` / `materialiseList`; `internString` interns each unique string into a long-lived Buffer pinned by the keepalive ref and shared across samples (bounds total Buffer count to avoid Bun GC pressure — bare keepalive without dedup tripped a Bun 1.3.11 mid-FFI panic at ~28k transient Buffers); `runOne`'s per-sample loop reads `lifted.keepalive.length` after marshalAdtPtr so the JS engine cannot elide the reference. Two alternate plans tried + reverted: (i) C-side `fenel_strdup_copy` symbol called from JS materialiseValue via FFI — same panic signature, more FFI calls only made it worse; (ii) C-side strdup of tag + name inside `fenel_construct` / `fenel_set_field_named` (using the previously-ignored len params) — works standalone but doesn't address value-string dangling AND combined with keepalive made some samples worse. Single-sample subprocess probes of sample 7 post-5b40 pass 20/20 deterministically (was 8-10/10 pre-fix). Samples 0-12 + 14-18 all pass per-sample subprocess probes 3/3 each. HOWEVER (c-10) surfaces — per-sample subprocess probe (3 attempts each) post-5b40: 17 of 19 samples deterministic OK (samples 0-12 + 14 + 16-18 — all `n` / `s` / `b` / `plus` / `eq` / `call` / `indir` / `just` / `justN` / `letOne` / `doLet` / `if3` / `if2` / `fnParen` / `matchW` / `rec` / `tagged` shapes), while samples 13 (`ifMulti`, a 3-branch if expression) + 15 (`fnFlat`, a multi-arg function-literal shape) trigger a Bun 1.3.11 mid-FFI panic at address 0x0 inside the `compiledFn` invocation. Both samples crash deterministically 3/3 attempts each in fresh subprocesses. Pre-fix the body short-circuited on dangling-pointer reads + did less work + did not trip Bun. Stack-trace from Bun.report URL points to JSC's FFI handler; cannot localise from JS side. Categorised as (c-10) — Bun 1.3.x mid-FFI-call accumulator panic, distinct from (c-9) dlopen accumulator (closed by 5b39 SUBPROCESS_FNIDS) AND from (c-1) std:mod-style outright segfault. Per brief possible-deviation #2 — common pattern across 5b32..5b38 of substrate fix surfacing a new sub-class — (c-9b) CLOSED at substrate but (c-10) blocks the matrix-cell-visibility milestone; matrix cell STAYS GAP. Investigation paths for future sub-phase (5bN+1): (a) AddressSanitizer / UndefinedBehaviorSanitizer trap on sample 13's body; (b) audit sample 13's `lowerLlvmIf` emit path for IR shape divergence from samples 11/12 (if3/if2); (c) reduce body's recursive `fenel_construct` allocation rate; (d) per-sample grand-grandchild subprocess if sample 13 still crashes in deeper isolation; (e) Bun version bump if 1.3.x fixes the FFI panic. engine:* substrate gap cluster is FULLY CLOSED at substrate level (4 of 4) for parseEffectFnId / makeEffectsExplicit / makeClosuresExplicit; normaliseToCore substrate is (c-1..c-8 + c-9b) closed but (c-10) blocks visible matrix cell.",
};

export function expectedGapsFor(target: TargetName): ExpectedGaps {
  if (target === "js") return JS_EXPECTED_GAPS;
  if (target === "wasm") return WASM_EXPECTED_GAPS;
  return LLVM_EXPECTED_GAPS;
}
