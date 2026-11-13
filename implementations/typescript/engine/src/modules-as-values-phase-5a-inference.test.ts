// ---------------------------------------------------------------------------
// modules-as-values Phase 5a, slice I — inference of `bundle.member…`
// (`workstreams/modules-as-values/briefs/phase-5a-named-members-by-dot.md`,
// settled design 5 and amendment A6).
//
// The rule is Fenel (`fenel/modules/engine/inference.fenel`):
//   * `inferenceResolveValue` keeps the lexical exact/root lookup first, then
//     reads exactly `bundle.member` against a host member value row; later
//     segments are projections, and a member row (ambiguous included) is
//     terminal;
//   * `inferenceProjectOne` unfolds a nominal application of a
//     single-constructor record declaration (`inferenceProjectNominal`).
// `signature-inference.ts` only marshals the registry's facts into those rows
// (`JsonLogicInferenceOptions.moduleMembers`, ledger B3).
//
//   (P) a probe registry of hand-written facts: every rule, no system registry;
//   (S) the system registry: the brief's rows (`codec.isoBase64.decode`, …).
// ---------------------------------------------------------------------------

import { beforeAll, describe, expect, test } from "bun:test";
import {
  inferJsonLogicType,
  type JsonLogicInferenceOptions,
  type ModuleMemberInferenceFacts,
  type PatternConstructorResolution,
} from "./signature-inference";
import { getSystemRegistry } from "./system-registry";
import { createRegistry, type ModuleRegistry } from "./registry";
import { loadFenelModule } from "./fenel-module";
import { createDispatchRegistry } from "./dispatch-registry";
import { seedFromType } from "./effect-dispatch";
import { codecModule } from "./modules/codec";
import {
  buildAuthoringCatalogSnapshot,
  createAuthoringEnvironment,
} from "./authoring/environment";
import { inferAuthoringExpression } from "./authoring/expression-authoring";
import { sourceModuleSessionFor } from "./authoring/source-module";
import type { FenelModule, FenelType, FieldDef, Kind, TypeScheme } from "./types";

const NOTHING = { $tag: "Nothing" } as const;
const K_TYPE: Kind = { $tag: "KType" };
const K_UNARY: Kind = { $tag: "KArrow", input: K_TYPE, output: K_TYPE };

const ref = (name: string): FenelType => ({ $ref: name });
const tvar = (name: string): FenelType => ({ $var: name });
const positional = (index: number, type: FenelType): FieldDef => ({
  name: `_${index}`,
  key: { $tag: "PositionalField", index },
  type,
  label: NOTHING,
  ui: NOTHING,
  meta: {},
});
const field = (name: string, type: FenelType): FieldDef => ({
  name,
  key: { $tag: "PositionalField", index: 0 },
  type,
  label: NOTHING,
  ui: NOTHING,
  meta: {},
});
const arrow = (params: FenelType[], returns: FenelType): FenelType => ({
  $arrow: { params: params.map((type, index) => positional(index, type)), returns },
});

type Outcome = ReturnType<typeof inferJsonLogicType>;

function solved(result: Outcome): FenelType {
  if (result.outcome.$tag !== "Solved" || result.type === undefined) {
    throw new Error(`expected Solved, received ${JSON.stringify(result.outcome)}`);
  }
  return result.type;
}

function fenced(result: Outcome): { code: string; message: string }[] {
  if (result.outcome.$tag !== "AnnotationRequired") {
    throw new Error(`expected AnnotationRequired, received ${JSON.stringify(result.outcome)}`);
  }
  return result.outcome.diagnostics.map(({ code, message }) => ({ code, message }));
}

function arrowShape(type: FenelType): { params: FenelType[]; returns: FenelType } {
  if (!("$arrow" in type)) throw new Error(`expected an arrow, received ${JSON.stringify(type)}`);
  return { params: type.$arrow.params.map((param) => param.type), returns: type.$arrow.returns };
}

// ===========================================================================
// (P) A probe registry of hand-written facts.
//
//   Codec5a s a = Codec5a decode5a: s -> a  encode5a: a -> s  tag5a: s
//                         peer5a: Evidence5a  proof5a: Verified Boolean (a law)
//   Mapper5a f  = Mapper5a lift5a: f -> f            (f : Type -> Type)
//   Clash5a     = Clash5a shout5a: String -> String  (ONE declaration, registered
//                 as a class too: a data type and its dispatch face)
//   Twinned5a s = Twinned5a run5a: s -> s  twin5a: Twin5a s   (whether twin5a is a
//                 superclass obligation is undecided: Twin5a has two owners)
//   probe5a.textCodec : Codec5a String Number   value fields decode5a, encode5a, tag5a, peer5a, label
//   probe5a.sparse    : Codec5a String Number   value fields decode5a, tag5a, peer5a (no encode5a)
//   probe5a.twinned   : Twinned5a String        value field run5a only
//   probe5a.wrongKind : Codec5a Maybe Number;  probe5a.overApplied : Codec5a String Number String
//   probe5a.hk        : Mapper5a Maybe
//   probe5a.clash     : Clash5a
//   probe5a.bare      : Codec5a (no arguments)    probe5a.half : Codec5a String
//   probe5a.twice     : ambiguous;  probe5a.Shape : a type;  probe5a.helper : a function
//   probe5a.dual      : the registry's two-owner refusal of an instance's type
//
//   Final review (2026-10-02) fixtures:
//   Mixed5a s   = Mixed5a run5a: s -> s  viaCap5a: Codec5a s s  viaOne5a: Box5a s
//                         viaNone5a: Ghost5a s  viaTwin5a: Twin5a s
//                 (superclass-shaped fields whose head is a registered class,
//                 has exactly one non-class owner, has no owner, has two owners)
//   Stray5a     = Stray5a ok5a: Number  stray5a: zz   (zz bound by no binder)
//   probe5a.mixed       : Mixed5a String   carries every field
//   probe5a.mixedLean   : Mixed5a String   lacks viaCap5a only
//   probe5a.mixedSparse : Mixed5a String   lacks viaCap5a and viaTwin5a
//   probe5a.openTag     : Codec5a String Number   tag5a holds a constant's reference
//   probe5a.stray       : Stray5a
// ===========================================================================

// Clash5a is one declaration with two registration faces: a uniquely owned
// data type (legacyKey) AND a registered class (getCapability).
const CLASSES = new Set(["Codec5a", "Mapper5a", "Clash5a"]);
const IDENTITY: Record<string, string> = {
  Codec5a: '["probe5a","Codec5a"]',
  Mapper5a: '["probe5a","Mapper5a"]',
  String: '["system","String"]',
  Number: '["system","Number"]',
  Maybe: '["system","Maybe"]',
  Twin5a: '["probe5a","Twin5a"]',
  Clash5a: '["probe5a","Clash5a"]',
  Twinned5a: '["probe5a","Twinned5a"]',
  Mixed5a: '["probe5a","Mixed5a"]',
  Box5a: '["probe5a","Box5a"]',
  Stray5a: '["probe5a","Stray5a"]',
};

/** A law field's type: the erasure rule's `Verified P` (`isLawField`). */
const verifiedBoolean: FenelType = {
  $variant: { cases: [{ name: "Verified", label: NOTHING, fields: [field("predicate", ref("Boolean"))] }] },
} as FenelType;
const codecType: FenelType = {
  $record: {
    fields: [
      field("decode5a", arrow([tvar("s")], tvar("a"))),
      field("encode5a", arrow([tvar("a")], tvar("s"))),
      field("tag5a", tvar("s")),
      field("peer5a", ref("Evidence5a")),
      field("proof5a", verifiedBoolean),
    ],
  },
};
const clashType: FenelType = {
  $record: { fields: [field("shout5a", arrow([ref("String")], ref("String")))] },
};
const mapperType: FenelType = {
  $record: { fields: [field("lift5a", arrow([tvar("f")], tvar("f")))] },
};
const twinnedType: FenelType = {
  $record: {
    fields: [
      field("run5a", arrow([tvar("s")], tvar("s"))),
      field("twin5a", { $el: { call: ["Twin5a", tvar("s")] } } as FenelType),
    ],
  },
};
const appOf = (head: string, ...args: FenelType[]): FenelType =>
  ({ $el: { call: [head, ...args] } }) as FenelType;
const mixedType: FenelType = {
  $record: {
    fields: [
      field("run5a", arrow([tvar("s")], tvar("s"))),
      field("viaCap5a", appOf("Codec5a", tvar("s"), tvar("s"))),
      field("viaOne5a", appOf("Box5a", tvar("s"))),
      field("viaNone5a", appOf("Ghost5a", tvar("s"))),
      field("viaTwin5a", appOf("Twin5a", tvar("s"))),
    ],
  },
};
const strayType: FenelType = {
  $record: { fields: [field("ok5a", ref("Number")), field("stray5a", tvar("zz"))] },
};

const ENTITIES: Record<string, unknown> = {
  Mixed5a: {
    id: "Mixed5a",
    module: "probe5a",
    params: [{ name: "s" }],
    type: mixedType,
    typeScheme: {
      quantified: [{ id: "q0", sourceName: "s", kind: K_TYPE }],
      body: mixedType,
      applications: [
        { path: ["$record", "fields", "2", "type"], headRef: "Box5a", args: [tvar("s")], kind: K_UNARY },
        { path: ["$record", "fields", "3", "type"], headRef: "Ghost5a", args: [tvar("s")], kind: K_UNARY },
      ],
      nominals: [{ path: ["$record", "fields", "2", "type"], identity: '["probe5a","Box5a"]', publicName: "Box5a" }],
      diagnostics: [],
    },
  },
  Box5a: {
    id: "Box5a",
    module: "probe5a",
    params: [{ name: "b" }],
    type: { $record: { fields: [field("boxed5a", tvar("b"))] } },
    typeScheme: {
      quantified: [{ id: "q0", sourceName: "b", kind: K_TYPE }],
      body: { $record: { fields: [field("boxed5a", tvar("b"))] } },
      applications: [],
      diagnostics: [],
    },
  },
  Stray5a: {
    id: "Stray5a",
    module: "probe5a",
    type: strayType,
    typeScheme: { quantified: [], body: strayType, applications: [], diagnostics: [] },
  },
  Codec5a: {
    id: "Codec5a",
    module: "probe5a",
    params: [{ name: "s" }, { name: "a" }],
    type: codecType,
    typeScheme: {
      quantified: [
        { id: "q0", sourceName: "s", kind: K_TYPE },
        { id: "q1", sourceName: "a", kind: K_TYPE },
      ],
      body: codecType,
      applications: [],
      diagnostics: [],
    },
  },
  Mapper5a: {
    id: "Mapper5a",
    module: "probe5a",
    params: [{ name: "f" }],
    type: mapperType,
    typeScheme: {
      quantified: [{ id: "q0", sourceName: "f", kind: K_UNARY }],
      body: mapperType,
      applications: [],
      diagnostics: [],
    },
  },
  Twinned5a: {
    id: "Twinned5a",
    module: "probe5a",
    params: [{ name: "s" }],
    type: twinnedType,
    typeScheme: {
      quantified: [{ id: "q0", sourceName: "s", kind: K_TYPE }],
      body: twinnedType,
      applications: [],
      diagnostics: [],
    },
  },
  Clash5a: {
    id: "Clash5a",
    module: "probe5a",
    type: clashType,
    interface: { name: "Clash5a", params: [], methods: [] },
    typeScheme: { quantified: [], body: clashType, applications: [], diagnostics: [] },
  },
  String: { id: "String", module: "system", type: ref("String"), typeScheme: { quantified: [], body: ref("String") } },
  Number: { id: "Number", module: "system", type: ref("Number"), typeScheme: { quantified: [], body: ref("Number") } },
  Maybe: {
    id: "Maybe",
    module: "system",
    params: [{ name: "a" }],
    type: ref("Maybe"),
    typeScheme: { quantified: [{ id: "q0", sourceName: "a", kind: K_TYPE }], body: ref("Maybe") },
  },
};

type SchemeAnswer = ReturnType<ModuleMemberInferenceFacts["resolveModuleMemberScheme"]>;
const SCHEMES: Record<string, unknown> = {
  "probe5a.textCodec": { kind: "instance", typeName: "Codec5a", args: ["String", "Number"] },
  "probe5a.hk": { kind: "instance", typeName: "Mapper5a", args: ["Maybe"] },
  "probe5a.twice": { kind: "ambiguous", message: "probe5a.twice is ambiguous: the bundle probe5a binds twice to 2 targets" },
  "probe5a.Shape": { kind: "type", value: { $ref: "Shape" } },
  "probe5a.helper": { kind: "function", id: "probe5a:helper" },
  "probe5a.twin": { kind: "instance", typeName: "Codec5a", args: ["String", "Twin5a"] },
  "probe5a.clash": { kind: "instance", typeName: "Clash5a", args: [] },
  "probe5a.bare": { kind: "instance", typeName: "Codec5a", args: [] },
  "probe5a.half": { kind: "instance", typeName: "Codec5a", args: ["String"] },
  "probe5a.sparse": { kind: "instance", typeName: "Codec5a", args: ["String", "Number"] },
  "probe5a.twinned": { kind: "instance", typeName: "Twinned5a", args: ["String"] },
  "probe5a.wrongKind": { kind: "instance", typeName: "Codec5a", args: ["Maybe", "Number"] },
  "probe5a.overApplied": { kind: "instance", typeName: "Codec5a", args: ["String", "Number", "String"] },
  // What the registry answers for an instance whose type name has two owners.
  "probe5a.dual": {
    kind: "ambiguous",
    message: "probe5a.dual: the instance dual has type Dual5a, which is declared by 2 owners (ownera, ownerb); its fields cannot be read until the instance's type reference is bound to one owner's identity",
  },
  "probe5a.mixed": { kind: "instance", typeName: "Mixed5a", args: ["String"] },
  "probe5a.mixedLean": { kind: "instance", typeName: "Mixed5a", args: ["String"] },
  "probe5a.mixedSparse": { kind: "instance", typeName: "Mixed5a", args: ["String"] },
  "probe5a.openTag": { kind: "instance", typeName: "Codec5a", args: ["String", "Number"] },
  "probe5a.stray": { kind: "instance", typeName: "Stray5a", args: [] },
};
const VALUES: Record<string, unknown> = {
  "probe5a.mixed": {
    kind: "instance",
    value: {
      $tag: "Mixed5a",
      run5a: { $ref: "probe5a.run" },
      viaCap5a: "cap",
      viaOne5a: "one",
      viaNone5a: "none",
      viaTwin5a: "twin",
    },
  },
  "probe5a.mixedLean": {
    kind: "instance",
    value: { $tag: "Mixed5a", run5a: { $ref: "probe5a.run" }, viaOne5a: "one", viaNone5a: "none", viaTwin5a: "twin" },
  },
  "probe5a.mixedSparse": {
    kind: "instance",
    value: { $tag: "Mixed5a", run5a: { $ref: "probe5a.run" }, viaOne5a: "one", viaNone5a: "none" },
  },
  // The loader keeps a field authored as a bare constant name as that
  // constant's reference: unevaluated, not a String.
  "probe5a.openTag": {
    kind: "instance",
    value: {
      $tag: "Codec5a",
      decode5a: { $ref: "probe5a.dec" },
      encode5a: { $ref: "probe5a.enc" },
      tag5a: { $ref: "probe5a:defaultTag" },
      peer5a: "peer",
    },
  },
  "probe5a.stray": { kind: "instance", value: { $tag: "Stray5a", ok5a: 1, stray5a: "x" } },
  "probe5a.textCodec": {
    kind: "instance",
    value: {
      $tag: "Codec5a",
      decode5a: { $ref: "probe5a.dec" },
      encode5a: { $ref: "probe5a.enc" },
      tag5a: "text",
      peer5a: "peer",
      label: "Text",
    },
  },
  "probe5a.sparse": {
    kind: "instance",
    value: { $tag: "Codec5a", decode5a: { $ref: "probe5a.dec" }, tag5a: "sparse", peer5a: "peer" },
  },
  "probe5a.twinned": { kind: "instance", value: { $tag: "Twinned5a", run5a: { $ref: "probe5a.run" } } },
  "probe5a.wrongKind": { kind: "instance", value: { $tag: "Codec5a", decode5a: { $ref: "probe5a.dec" } } },
  "probe5a.overApplied": { kind: "instance", value: { $tag: "Codec5a", decode5a: { $ref: "probe5a.dec" } } },
  "probe5a.hk": { kind: "instance", value: { $tag: "Mapper5a", lift5a: { $ref: "probe5a.lift" } } },
  "probe5a.twice": { kind: "ambiguous", message: "probe5a.twice is ambiguous" },
  "probe5a.Shape": { kind: "type", value: { $ref: "Shape" } },
  "probe5a.helper": { kind: "function", id: "probe5a:helper" },
  "probe5a.twin": { kind: "instance", value: { $tag: "Codec5a", decode5a: { $ref: "probe5a.dec" } } },
  "probe5a.clash": { kind: "instance", value: { $tag: "Clash5a", shout5a: { $ref: "probe5a.shout" } } },
  "probe5a.bare": { kind: "instance", value: { $tag: "Codec5a", decode5a: { $ref: "probe5a.dec" } } },
  "probe5a.half": { kind: "instance", value: { $tag: "Codec5a", decode5a: { $ref: "probe5a.dec" } } },
  "probe5a.dual": { kind: "ambiguous", message: "probe5a.dual is ambiguous" },
};

/** The probe facts, recording every registry question the marshal asks. */
function probeFacts(): ModuleMemberInferenceFacts & { readonly asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    resolveModuleMemberScheme: (bundle, member) => {
      asked.push(`${bundle}.${member}`);
      return (SCHEMES[`${bundle}.${member}`] ?? { kind: "missing" }) as SchemeAnswer;
    },
    resolveModuleMember: (bundle, member) =>
      (VALUES[`${bundle}.${member}`] ?? { kind: "missing" }) as ReturnType<ModuleMemberInferenceFacts["resolveModuleMember"]>,
    getIdentifiedEntity: (name) => ENTITIES[name] as ReturnType<ModuleMemberInferenceFacts["getIdentifiedEntity"]>,
    getEntityNominalIdentity: (name) => IDENTITY[name],
    // Codec5a and Mapper5a are registered classes: the call-site frame (like
    // the system registry's) has no data-type owner for them.
    getCapability: (name) => (CLASSES.has(name) ? { name } : undefined),
    callSiteTyping: {
      legacyKey: ({ identity, publicName }) =>
        publicName === "Twin5a"
          ? { ok: false, message: 'the instance key "Twin5a" is ambiguous: several registered types are named Twin5a' }
          : (!CLASSES.has(publicName) || publicName === "Clash5a") && IDENTITY[publicName] === identity
          ? { ok: true, key: publicName }
          : { ok: false, message: `${publicName} has no registered owner in this registry` },
    },
  };
}

const numberToNumber: TypeScheme = { quantified: [], body: arrow([ref("Number")], ref("Number")) };
function probeFunctions(id: string): ReturnType<NonNullable<JsonLogicInferenceOptions["resolveFunction"]>> {
  if (id === "probe5a.helper" || id === "probe5a.twice" || id === "probe5a.twice.decode5a") {
    return { params: [positional(0, ref("Number"))], returns: ref("Number"), scheme: numberToNumber, targetId: "probe5a:helper" };
  }
  if (id === "useCodec") {
    // useCodec : ((c: Codec5a String Number) -> String) -> String
    const codecApp: FenelType = { $el: { call: ["Codec5a", ref("String"), ref("Number")] } } as FenelType;
    const callback = arrow([codecApp], ref("String"));
    const appPath = ["$arrow", "params", "0", "type", "$arrow", "params", "0", "type"];
    const scheme: TypeScheme = {
      quantified: [],
      body: arrow([callback], ref("String")),
      applications: [{
        path: appPath,
        headRef: "Codec5a",
        args: [ref("String"), ref("Number")],
        kind: { $tag: "KArrow", input: K_TYPE, output: K_UNARY },
      }],
      nominals: [{ path: appPath, identity: IDENTITY.Codec5a!, publicName: "Codec5a" }],
    };
    return { params: [positional(0, callback)], returns: ref("String"), scheme, targetId: "probe5a:useCodec" };
  }
  if (id === "consumeCodec") {
    // consumeCodec : (c: Codec5a String Number) -> String
    const codecApp: FenelType = { $el: { call: ["Codec5a", ref("String"), ref("Number")] } } as FenelType;
    const appPath = ["$arrow", "params", "0", "type"];
    const scheme: TypeScheme = {
      quantified: [],
      body: arrow([codecApp], ref("String")),
      applications: [{
        path: appPath,
        headRef: "Codec5a",
        args: [ref("String"), ref("Number")],
        kind: { $tag: "KArrow", input: K_TYPE, output: K_UNARY },
      }],
      nominals: [{ path: appPath, identity: IDENTITY.Codec5a!, publicName: "Codec5a" }],
    };
    return { params: [positional(0, codecApp)], returns: ref("String"), scheme, targetId: "probe5a:consumeCodec" };
  }
  if (id === "useCodecAny" || id === "useOpaque") {
    // useCodecAny : ((c: Codec5a String Number) -> r) -> r
    // useOpaque   : ((o: Carrier5a) -> r) -> r, Carrier5a an opaque type whose
    //               pure view is Codec5a String Number (its host carrier is not)
    const codecApp: FenelType = { $el: { call: ["Codec5a", ref("String"), ref("Number")] } } as FenelType;
    const opaque = id === "useOpaque";
    const paramType: FenelType = opaque
      ? { $opaque: { name: "Carrier5a", pure: codecApp } } as FenelType
      : codecApp;
    const callback = arrow([paramType], tvar("r"));
    const appPath = [
      "$arrow", "params", "0", "type", "$arrow", "params", "0", "type",
      ...(opaque ? ["$opaque", "pure"] : []),
    ];
    const scheme: TypeScheme = {
      quantified: [{ id: "q0", sourceName: "r", kind: K_TYPE }],
      body: arrow([callback], tvar("r")),
      applications: [{
        path: appPath,
        headRef: "Codec5a",
        args: [ref("String"), ref("Number")],
        kind: { $tag: "KArrow", input: K_TYPE, output: K_UNARY },
      }],
      nominals: [{ path: appPath, identity: IDENTITY.Codec5a!, publicName: "Codec5a" }],
    };
    return { params: [positional(0, callback)], returns: tvar("r"), scheme, targetId: `probe5a:${id}` };
  }
  if (id === "useOpaqueInner") {
    // useOpaqueInner : ((o: Carrier5aInner) -> r) -> r, Carrier5aInner an opaque
    //                  type whose pure view is { inner: Codec5a String Number, n: Number }
    const binding = opaqueInnerBinding();
    const callback = arrow([binding.body], tvar("r"));
    const prefix = ["$arrow", "params", "0", "type", "$arrow", "params", "0", "type"];
    const scheme: TypeScheme = {
      quantified: [{ id: "q0", sourceName: "r", kind: K_TYPE }],
      body: arrow([callback], tvar("r")),
      applications: binding.applications!.map((application) => ({ ...application, path: [...prefix, ...application.path] })),
      nominals: binding.nominals!.map((nominal) => ({ ...nominal, path: [...prefix, ...nominal.path] })),
    };
    return { params: [positional(0, callback)], returns: tvar("r"), scheme, targetId: "probe5a:useOpaqueInner" };
  }
  if (id === "apply2") {
    // apply2 : (f: a -> b) -> (x: a) -> b
    const fnType = arrow([tvar("a")], tvar("b"));
    const scheme: TypeScheme = {
      quantified: [
        { id: "q0", sourceName: "a", kind: K_TYPE },
        { id: "q1", sourceName: "b", kind: K_TYPE },
      ],
      body: arrow([fnType, tvar("a")], tvar("b")),
    };
    return { params: [positional(0, fnType), positional(1, tvar("a"))], returns: tvar("b"), scheme, targetId: "probe5a:apply2" };
  }
  if (id === "applyTo5a") {
    // applyTo5a : (x: a) -> (f: a -> b) -> b   (apply2 with the argument first)
    const fnType = arrow([tvar("a")], tvar("b"));
    const scheme: TypeScheme = {
      quantified: [
        { id: "q0", sourceName: "a", kind: K_TYPE },
        { id: "q1", sourceName: "b", kind: K_TYPE },
      ],
      body: arrow([tvar("a"), fnType], tvar("b")),
    };
    return { params: [positional(0, tvar("a")), positional(1, fnType)], returns: tvar("b"), scheme, targetId: "probe5a:applyTo5a" };
  }
  if (id === "touch5a") {
    // touch5a : forall a. (o: Carrier5aInner) -> Boolean, the opaque's pure view
    //           written { inner: a }: a host binding polymorphic in the field
    //           type its argument's pure view holds
    const param: FenelType = {
      $opaque: { name: "Carrier5aInner", pure: { $record: { fields: [keyedField(0, "inner", tvar("a"))] } } },
    } as FenelType;
    const scheme: TypeScheme = {
      quantified: [{ id: "q0", sourceName: "a", kind: K_TYPE }],
      body: arrow([param], ref("Boolean")),
    };
    return { params: [positional(0, param)], returns: ref("Boolean"), scheme, targetId: "probe5a:touch5a" };
  }
  return undefined;
}

/** A record field with its own positional key (distinct keys per record). */
const keyedField = (index: number, name: string, type: FenelType): FieldDef => ({
  ...field(name, type),
  key: { $tag: "PositionalField", index },
});

/** An opaque type whose pure view is a STRUCTURAL record holding a nominal:
 * Carrier5aInner ~ { inner: Codec5a String Number, n: Number }. Its host
 * carrier need not hold `inner` at all. */
function opaqueInnerBinding(): TypeScheme {
  const codecApp: FenelType = { $el: { call: ["Codec5a", ref("String"), ref("Number")] } } as FenelType;
  const path = ["$opaque", "pure", "$record", "fields", "0", "type"];
  return {
    quantified: [],
    body: {
      $opaque: {
        name: "Carrier5aInner",
        pure: { $record: { fields: [keyedField(0, "inner", codecApp), keyedField(1, "n", ref("Number"))] } },
      },
    } as FenelType,
    applications: [{
      path,
      headRef: "Codec5a",
      args: [ref("String"), ref("Number")],
      kind: { $tag: "KArrow", input: K_TYPE, output: K_UNARY },
    }],
    nominals: [{ path, identity: IDENTITY.Codec5a!, publicName: "Codec5a" }],
  };
}

/** The probe's `Codec5a` constructor (the `$ctor:` callable a constructor
 * pattern is typed by): every declared field, laws included, is a parameter. */
const ctorKey = (index: number): string => `5a5a5a5a-0000-4000-8000-00000000000${index}`;
const ctorField = (index: number, name: string, type: FenelType): FieldDef => ({
  ...field(name, type),
  key: { $tag: "NamedField", ref: { $ref: ctorKey(index) } },
});
function probeConstructors(name: string): PatternConstructorResolution {
  if (name !== "Codec5a") return { status: "missing" };
  const params = [
    ctorField(1, "decode5a", arrow([tvar("s")], tvar("a"))),
    ctorField(2, "encode5a", arrow([tvar("a")], tvar("s"))),
    ctorField(3, "tag5a", tvar("s")),
    ctorField(4, "peer5a", ref("Number")),
    ctorField(5, "proof5a", verifiedBoolean),
  ];
  const returns = appOf("Codec5a", tvar("s"), tvar("a"));
  const scheme: TypeScheme = {
    quantified: [
      { id: "q0", sourceName: "s", kind: K_TYPE },
      { id: "q1", sourceName: "a", kind: K_TYPE },
    ],
    body: { $arrow: { params, returns } },
    applications: [{
      path: ["$arrow", "returns"],
      headRef: "Codec5a",
      args: [tvar("s"), tvar("a")],
      kind: { $tag: "KArrow", input: K_TYPE, output: K_UNARY },
    }],
    nominals: [{ path: ["$arrow", "returns"], identity: IDENTITY.Codec5a!, publicName: "Codec5a" }],
  };
  return { status: "resolved", targetId: "probe5a:Codec5a", params, returns, scheme };
}

/** A lexical binding whose type is an opaque wrapper (`depth` deep) around the
 * nominal application Codec5a String Number. */
function opaqueCodecBinding(depth: number): TypeScheme {
  let body: FenelType = { $el: { call: ["Codec5a", ref("String"), ref("Number")] } } as FenelType;
  const path: string[] = [];
  for (let level = 0; level < depth; level += 1) {
    body = { $opaque: { name: `Carrier5a${level}`, pure: body } } as FenelType;
    path.push("$opaque", "pure");
  }
  return {
    quantified: [],
    body,
    applications: [{
      path,
      headRef: "Codec5a",
      args: [ref("String"), ref("Number")],
      kind: { $tag: "KArrow", input: K_TYPE, output: K_UNARY },
    }],
    nominals: [{ path, identity: IDENTITY.Codec5a!, publicName: "Codec5a" }],
  };
}

const inferProbe = (logic: unknown, extra: Partial<JsonLogicInferenceOptions> = {}): Outcome =>
  inferJsonLogicType(logic, { resolveFunction: probeFunctions, moduleMembers: probeFacts(), ...extra });

describe("(P) inference of bundle.member over a probe registry", () => {
  test("an instance member's field infers its declared type at the instance's arguments", () => {
    const decode = arrowShape(solved(inferProbe({ var: "probe5a.textCodec.decode5a" })));
    expect(decode.params).toEqual([ref("String")]);
    expect(decode.returns).toEqual(ref("Number"));
    const encode = arrowShape(solved(inferProbe({ var: "probe5a.textCodec.encode5a" })));
    expect(encode.params).toEqual([ref("Number")]);
    expect(encode.returns).toEqual(ref("String"));
  }, 600_000);

  test("in call position the projected method is applied", () => {
    expect(solved(inferProbe({ call: ["probe5a.textCodec.decode5a", "x"] }))).toEqual(ref("Number"));
  }, 600_000);

  test("the member itself infers its declared type application, with owner identities", () => {
    const result = inferProbe({ var: "probe5a.textCodec" });
    expect(solved(result)).toEqual({ $el: { call: ["Codec5a", ref("String"), ref("Number")] } });
    expect(result.scheme?.nominals?.map(({ identity }) => identity).sort()).toEqual([
      IDENTITY.Codec5a!, IDENTITY.Number!, IDENTITY.String!,
    ]);
  }, 600_000);

  test("retained data the declared type does not declare is an explicit fence", () => {
    const [diagnostic] = fenced(inferProbe({ var: "probe5a.textCodec.label" }));
    expect(diagnostic!.code).toBe("inference.record-projection");
    expect(diagnostic!.message).toContain("declares no field label");
  }, 600_000);

  test("a declared field the value does not carry (an erased obligation) is an explicit fence", () => {
    const [diagnostic] = fenced(inferProbe({ var: "probe5a.textCodec.proof5a" }));
    expect(diagnostic!.code).toBe("inference.record-projection");
    expect(diagnostic!.message).toContain("carries no field proof5a");
  }, 600_000);

  test("a declared field naming a type without an owner identity fences", () => {
    const [diagnostic] = fenced(inferProbe({ var: "probe5a.textCodec.peer5a" }));
    expect(diagnostic!.code).toBe("inference.record-projection");
    expect(diagnostic!.message).toContain("Evidence5a without an owner identity");
  }, 600_000);

  test("a lexical binding of the bundle name shadows the bundle; the registry is not asked", () => {
    const facts = probeFacts();
    const local: FenelType = {
      $record: { fields: [field("textCodec", { $record: { fields: [field("label", ref("Number"))] } })] },
    };
    const result = inferJsonLogicType(
      { var: "probe5a.textCodec.label" },
      { resolveFunction: probeFunctions, moduleMembers: facts, bindings: { probe5a: local } },
    );
    expect(solved(result)).toEqual(ref("Number"));
    expect(facts.asked).toEqual([]);
    const lambda = inferJsonLogicType(
      { fn: [["probe5a"], { var: "probe5a.textCodec" }] },
      { resolveFunction: probeFunctions, moduleMembers: facts },
    );
    expect(lambda.outcome.$tag).toBe("AnnotationRequired");
    expect(facts.asked).toEqual([]);
  }, 600_000);

  test("an ambiguous member is terminal: no callable fallback, no shorter prefix", () => {
    for (const logic of [
      { var: "probe5a.twice" },
      { var: "probe5a.twice.decode5a" },
      { call: ["probe5a.twice.decode5a", 1] },
    ]) {
      const [diagnostic, ...rest] = fenced(inferProbe(logic));
      expect(rest).toEqual([]);
      expect(diagnostic!.code).toBe("inference.ambiguous-call");
      expect(diagnostic!.message).toContain("probe5a.twice is ambiguous");
    }
  }, 600_000);

  test("a missing member keeps the existing unknown-name diagnostic", () => {
    for (const name of ["probe5a.ghostly", "probe5a.ghostly.field", "nosuchbundle.member"]) {
      const [diagnostic] = fenced(inferProbe({ var: name }));
      expect(diagnostic).toEqual({ code: "inference.unknown-name", message: `no exact scheme is available for ${name}` });
    }
  }, 600_000);

  test("a function member keeps the callable route", () => {
    const helper = arrowShape(solved(inferProbe({ var: "probe5a.helper" })));
    expect(helper.params).toEqual([ref("Number")]);
    expect(helper.returns).toEqual(ref("Number"));
    expect(solved(inferProbe({ call: ["probe5a.helper", 1] }))).toEqual(ref("Number"));
  }, 600_000);

  test("a type member is a value of type Type; projecting from it fences", () => {
    expect(solved(inferProbe({ var: "probe5a.Shape" }))).toEqual({ $type: true });
    expect(fenced(inferProbe({ var: "probe5a.Shape.width" }))[0]!.code).toBe("inference.record-projection");
  }, 600_000);

  test("a higher-kinded type argument fences (no application-head normalization)", () => {
    for (const name of ["probe5a.hk", "probe5a.hk.lift5a"]) {
      const [diagnostic] = fenced(inferProbe({ var: name }));
      expect(diagnostic!.code).toBe("inference.record-projection");
      expect(diagnostic!.message).toContain("higher-kinded");
    }
  }, 600_000);

  test("a deferred projection discharged onto a nominal receiver unfolds its declaration", () => {
    const useCodec = { call: ["useCodec", { fn: [["c"], { var: "c.tag5a" }] }] };
    // The member reference supplies Codec5a's declaration row.
    expect(solved(inferProbe({ do: [{ var: "probe5a.textCodec" }, useCodec] }))).toEqual(ref("String"));
    // Without declaration evidence the same projection is an explicit fence.
    const [diagnostic] = fenced(inferProbe(useCodec));
    expect(diagnostic!.code).toBe("inference.record-projection");
    expect(diagnostic!.message).toContain("no declaration evidence");
  }, 600_000);

  test("a type spelling with two owners in the declared type is an explicit fence, never first-wins", () => {
    for (const name of ["probe5a.twin", "probe5a.twin.decode5a"]) {
      const [diagnostic] = fenced(inferProbe({ var: name }));
      expect(diagnostic!.code).toBe("inference.host-scheme-sidecar");
      expect(diagnostic!.message).toContain('"Twin5a" is ambiguous');
    }
    // The instance's own type with two owners: the registry refuses the member
    // (its owner verdict), and that refusal is terminal here.
    for (const name of ["probe5a.dual", "probe5a.dual.f"]) {
      const [diagnostic, ...rest] = fenced(inferProbe({ var: name }));
      expect(rest).toEqual([]);
      expect(diagnostic!.code).toBe("inference.ambiguous-call");
    }
  }, 600_000);

  // -------------------------------------------------------------------------
  // Review fixes (gpt-6-astra review of slice I). Each was watched failing on
  // the slice-I code before its fix.
  // -------------------------------------------------------------------------

  test("(R1) one declaration registered as a class is ONE type: its instance infers", () => {
    const member = inferProbe({ var: "probe5a.clash" });
    expect(solved(member)).toEqual(ref("Clash5a"));
    expect(member.scheme?.nominals?.map(({ identity }) => identity)).toEqual([IDENTITY.Clash5a!]);
    const shout = arrowShape(solved(inferProbe({ var: "probe5a.clash.shout5a" })));
    expect(shout.params).toEqual([ref("String")]);
    expect(shout.returns).toEqual(ref("String"));
  }, 600_000);

  test("(R2) an under-applied instance type is no value type: zero and partial saturation fence", () => {
    for (const name of ["probe5a.bare", "probe5a.bare.decode5a", "probe5a.half", "probe5a.half.decode5a"]) {
      const [diagnostic, ...rest] = fenced(inferProbe({ var: name }));
      expect(rest).toEqual([]);
      expect(diagnostic!.code).toBe("inference.host-scheme-sidecar");
      expect(diagnostic!.message).toContain("kind is not Type");
    }
  }, 600_000);

  test("(R3) an erased obligation fences through an alias and a deferred projection", () => {
    const alias = (field: string) =>
      inferProbe({ do: [{ let: { i: { var: "probe5a.textCodec" } } }, { var: `i.${field}` }] });
    // A method field still projects through the alias.
    expect(arrowShape(solved(alias("decode5a"))).returns).toEqual(ref("Number"));
    // A law field (`Verified …`) is erased from the value whatever its spelling.
    const [law] = fenced(alias("proof5a"));
    expect(law!.code).toBe("inference.record-projection");
    expect(law!.message).toContain("erased obligation");
    // Retained data the declaration does not declare is unknown, never absent.
    const [extra] = fenced(alias("label"));
    expect(extra!.code).toBe("inference.record-projection");
    expect(extra!.message).toContain("declares no field label");
    // The same through a deferred projection discharged onto the nominal type.
    const deferred = (field: string) => inferProbe({
      do: [
        { var: "probe5a.textCodec" },
        { call: ["useCodecAny", { fn: [["c"], { var: `c.${field}` }] }] },
      ],
    });
    expect(solved(deferred("tag5a"))).toEqual(ref("String"));
    expect(fenced(deferred("proof5a"))[0]!.message).toContain("erased obligation");
    expect(fenced(deferred("label"))[0]!.message).toContain("declares no field label");
  }, 600_000);

  test("(R4) a nominal reached through an opaque pure view is never unfolded", () => {
    // Deferred: the callback's parameter is the opaque Carrier5a.
    const [deferred] = fenced(inferProbe({
      do: [
        { var: "probe5a.textCodec" },
        { call: ["useOpaque", { fn: [["o"], { var: "o.tag5a" }] }] },
      ],
    }));
    expect(deferred!.code).toBe("inference.record-projection");
    expect(deferred!.message).toContain("opaque");
    // Lexical, one and two opaque layers deep.
    for (const depth of [1, 2]) {
      const [diagnostic] = fenced(inferProbe(
        { do: [{ var: "probe5a.textCodec" }, { var: "o.tag5a" }] },
        { bindings: { o: opaqueCodecBinding(depth) } },
      ));
      expect(diagnostic!.code).toBe("inference.record-projection");
      expect(diagnostic!.message).toContain("opaque");
    }
    // An opaque whose pure view is a structural record keeps projecting.
    const structural = { $opaque: { name: "Box5a", pure: { $record: { fields: [field("a", ref("Number"))] } } } } as FenelType;
    expect(solved(inferProbe({ var: "o.a" }, { bindings: { o: structural } }))).toEqual(ref("Number"));
  }, 600_000);

  // -------------------------------------------------------------------------
  // Opus review of slice I (2026-10-02). Each was watched failing on the
  // worktree code before its fix.
  // -------------------------------------------------------------------------

  test("(O1) a member whose value lacks a declared field fences wherever it flows", () => {
    // A field the value carries still projects directly (the value is read).
    expect(arrowShape(solved(inferProbe({ var: "probe5a.sparse.decode5a" }))).returns).toEqual(ref("Number"));
    // The member itself is not known to inhabit Codec5a String Number.
    for (const logic of [
      { var: "probe5a.sparse" },
      { do: [{ let: { i: { var: "probe5a.sparse" } } }, { var: "i.encode5a" }] },
      { call: ["consumeCodec", { var: "probe5a.sparse" }] },
    ]) {
      const [diagnostic, ...rest] = fenced(inferProbe(logic));
      expect(rest).toEqual([]);
      expect(diagnostic!.code).toBe("inference.record-projection");
      expect(diagnostic!.message).toContain("does not carry its declared field encode5a");
    }
    // A missing field whose erasure is undecided (Twin5a has two owners) is
    // not excused as an obligation.
    const [twinned] = fenced(inferProbe({ var: "probe5a.twinned" }));
    expect(twinned!.code).toBe("inference.record-projection");
    expect(twinned!.message).toContain("does not carry its declared field twin5a");
    // A complete value still flows (erased laws need not be carried).
    expect(solved(inferProbe({ call: ["consumeCodec", { var: "probe5a.textCodec" }] }))).toEqual(ref("String"));
  }, 600_000);

  test("(O2) an instance argument whose kind differs from the class binder fences, never Invalid", () => {
    for (const name of ["probe5a.wrongKind", "probe5a.wrongKind.decode5a", "probe5a.overApplied"]) {
      const [diagnostic, ...rest] = fenced(inferProbe({ var: name }));
      expect(rest).toEqual([]);
      expect(diagnostic!.code).toBe("inference.host-scheme-sidecar");
      expect(diagnostic!.message).toContain("probe5a.");
    }
    // An unrelated expression mentioning it fences on the member only.
    const [unrelated] = fenced(inferProbe({ do: [{ var: "probe5a.wrongKind" }, { call: ["probe5a.helper", 1] }] }));
    expect(unrelated!.code).toBe("inference.host-scheme-sidecar");
  }, 600_000);

  test("(O4) a nominal receiver whose shape disagrees with its declaration fences, never Invalid", () => {
    const bare: TypeScheme = {
      quantified: [],
      body: ref("Codec5a"),
      nominals: [{ path: [], identity: IDENTITY.Codec5a!, publicName: "Codec5a" }],
    };
    const half: TypeScheme = {
      quantified: [],
      body: { $el: { call: ["Codec5a", ref("String")] } } as FenelType,
      applications: [{
        path: [],
        headRef: "Codec5a",
        args: [ref("String")],
        kind: { $tag: "KArrow", input: K_TYPE, output: K_UNARY },
      }],
      nominals: [{ path: [], identity: IDENTITY.Codec5a!, publicName: "Codec5a" }],
    };
    for (const x of [bare, half]) {
      // Without the member reference the projection already fenced.
      expect(fenced(inferProbe({ var: "x.decode5a" }, { bindings: { x } }))[0]!.code)
        .toBe("inference.record-projection");
      // An unrelated member reference brings Codec5a's declaration in: still a fence.
      const [diagnostic, ...rest] = fenced(inferProbe(
        { do: [{ var: "probe5a.textCodec" }, { var: "x.decode5a" }] },
        { bindings: { x } },
      ));
      expect(rest).toEqual([]);
      expect(diagnostic!.code).toBe("inference.record-projection");
      expect(diagnostic!.message).toContain("Codec5a");
    }
  }, 600_000);

  // -------------------------------------------------------------------------
  // Final review (2026-10-02). F1, F3, F4 and F5 were each watched failing on
  // the worktree code before their fix; F2 is a move of the erasure decision
  // into Fenel and pins the unchanged behaviour instead (green before and after).
  // -------------------------------------------------------------------------

  test("(F1, extends R4) opaque provenance survives a structural field: the nominal after it never unfolds", () => {
    const bindings = { o: opaqueInnerBinding() };
    const expectOpaqueFence = (result: Outcome) => {
      const [diagnostic, ...rest] = fenced(result);
      expect(rest).toEqual([]);
      expect(diagnostic!.code).toBe("inference.record-projection");
      expect(diagnostic!.message).toContain("opaque");
    };
    // Direct path (the member reference brings Codec5a's declaration in).
    expectOpaqueFence(inferProbe({ do: [{ var: "probe5a.textCodec" }, { var: "o.inner.decode5a" }] }, { bindings }));
    // Through a let alias.
    expectOpaqueFence(inferProbe({
      do: [{ var: "probe5a.textCodec" }, { let: { x: { var: "o.inner" } } }, { var: "x.decode5a" }],
    }, { bindings }));
    // Through deferred projections, discharged once the lambda parameter is unified.
    expectOpaqueFence(inferProbe({
      do: [{ var: "probe5a.textCodec" }, { call: ["useOpaqueInner", { fn: [["o"], { var: "o.inner.decode5a" }] }] }],
    }));
    // Whatever the inference order: here the projection is unfolded before the
    // argument it reads (o.inner) is inferred.
    expectOpaqueFence(inferProbe({
      do: [
        { var: "probe5a.textCodec" },
        {
          call: [
            "apply2",
            { fn: [["x"], { do: [{ call: ["consumeCodec", { var: "x" }] }, { var: "x.tag5a" }] }] },
            { var: "o.inner" },
          ],
        },
      ],
    }, { bindings }));
    // Today's structural reads through the view are unchanged.
    expect(solved(inferProbe({ var: "o.n" }, { bindings }))).toEqual(ref("Number"));
    expect(solved(inferProbe({ do: [{ var: "probe5a.textCodec" }, { var: "o.inner" }] }, { bindings })))
      .toEqual(appOf("Codec5a", ref("String"), ref("Number")));
  }, 600_000);

  test("(F2) the erasure verdict of superclass-shaped fields (pinned across the move into Fenel)", () => {
    // Head is a registered class: a definite erased obligation.
    expect(fenced(inferProbe({ var: "probe5a.mixed.viaCap5a" }))[0]!.message).toContain("erased obligation");
    // Head has two owners: undecided, so it is fenced like an obligation ...
    expect(fenced(inferProbe({ var: "probe5a.mixed.viaTwin5a" }))[0]!.message).toContain("erased obligation");
    // Head has exactly one owner that is not a class: an ordinary field.
    expect(solved(inferProbe({ var: "probe5a.mixed.viaOne5a" }))).toEqual(appOf("Box5a", ref("String")));
    // Head has no owner: an ordinary field (whose unowned head then fences).
    const [none] = fenced(inferProbe({ var: "probe5a.mixed.viaNone5a" }));
    expect(none!.code).toBe("inference.record-projection");
    expect(none!.message).toContain("Ghost5a without an owner identity");
    // ... but never excused: a value may lack a definite obligation only.
    expect(solved(inferProbe({ var: "probe5a.mixedLean" }))).toEqual(appOf("Mixed5a", ref("String")));
    const [sparse] = fenced(inferProbe({ var: "probe5a.mixedSparse" }));
    expect(sparse!.code).toBe("inference.record-projection");
    expect(sparse!.message).toContain("does not carry its declared field viaTwin5a");
  }, 600_000);

  test("(F3) a constructor pattern never binds a field the declaration lists as an obligation", () => {
    const match = (pattern: unknown) => inferProbe(
      { match: [{ var: "probe5a.textCodec" }, pattern, { var: "p" }] },
      { resolvePatternConstructor: probeConstructors },
    );
    // A carried method field still binds at the instance's arguments.
    const decode = arrowShape(solved(match({ $tag: "Codec5a", decode5a: { $bind: "p" } })));
    expect(decode.params).toEqual([ref("String")]);
    expect(decode.returns).toEqual(ref("Number"));
    // The law field proof5a, named or positional.
    for (const pattern of [
      { $tag: "Codec5a", proof5a: { $bind: "p" } },
      { $tag: "Codec5a", _0: "_", _1: "_", _2: "_", _3: "_", _4: { $bind: "p" } },
    ]) {
      const [diagnostic, ...rest] = fenced(match(pattern));
      expect(rest).toEqual([]);
      expect(diagnostic!.code).toBe("inference.record-projection");
      expect(diagnostic!.message).toContain("proof5a");
    }
  }, 600_000);

  test("(F4) a carried field holding a constant's reference is not typed at its declared non-arrow type", () => {
    const [direct, ...rest] = fenced(inferProbe({ var: "probe5a.openTag.tag5a" }));
    expect(rest).toEqual([]);
    expect(direct!.code).toBe("inference.record-projection");
    expect(direct!.message).toContain("tag5a");
    // Its arrow fields still project.
    expect(arrowShape(solved(inferProbe({ var: "probe5a.openTag.decode5a" }))).returns).toEqual(ref("Number"));
    // Flowing on as a whole value, it is not known to inhabit its declared type.
    for (const logic of [
      { var: "probe5a.openTag" },
      { do: [{ let: { i: { var: "probe5a.openTag" } } }, { var: "i.tag5a" }] },
    ]) {
      const [diagnostic] = fenced(inferProbe(logic));
      expect(diagnostic!.code).toBe("inference.record-projection");
      expect(diagnostic!.message).toContain("tag5a");
    }
  }, 600_000);

  test("(F5) a declaration field the converter rejects fences, quoting the converter's diagnostic", () => {
    const [diagnostic, ...rest] = fenced(inferProbe({ var: "probe5a.stray.stray5a" }));
    expect(rest).toEqual([]);
    expect(diagnostic!.code).toBe("inference.record-projection");
    expect(diagnostic!.message).toContain("inference.unbound-scheme-variable");
    expect(diagnostic!.message).toContain("unbound scheme variable zz");
    // Its well-formed sibling still projects.
    expect(solved(inferProbe({ var: "probe5a.stray.ok5a" }))).toEqual(ref("Number"));
  }, 600_000);

  // -------------------------------------------------------------------------
  // Re-review of the final fix round (2026-10-02). G1 was watched failing on
  // the worktree code before its fix (each opaque case below Solved at
  // String); G2 pins the unchanged let-polymorphism (green before and after).
  // -------------------------------------------------------------------------

  // get = \o -> do [touch5a o, o.inner]: its result is a field read through
  // Carrier5aInner's pure view, at touch5a's polymorphic field type, so get
  // generalizes to forall a0. Carrier5aInner -> a0.
  const getter = {
    let: { get: { fn: [["o"], { do: [{ call: ["touch5a", { var: "o" }] }, { var: "o.inner" }] }] } },
  };
  const getC = { call: [{ var: "get" }, { var: "c" }] };
  const unfoldsCodec = { fn: [["x"], { do: [{ call: ["consumeCodec", { var: "x" }] }, { var: "x.tag5a" }] }] };

  test("(G1, extends F1) opaque provenance survives let-generalization: every use of a generalized getter is a read", () => {
    const bindings = { c: opaqueInnerBinding() };
    const expectOpaqueFence = (result: Outcome) => {
      const [diagnostic, ...rest] = fenced(result);
      expect(rest).toEqual([]);
      expect(diagnostic!.code).toBe("inference.record-projection");
      expect(diagnostic!.message).toContain("opaque");
    };
    // The callback unfolds Codec5a before the getter's use is inferred.
    expectOpaqueFence(inferProbe({
      do: [{ var: "probe5a.textCodec" }, getter, { call: ["apply2", unfoldsCodec, getC] }],
    }, { bindings }));
    // The getter's use is inferred first.
    expectOpaqueFence(inferProbe({
      do: [{ var: "probe5a.textCodec" }, getter, { call: ["applyTo5a", getC, unfoldsCodec] }],
    }, { bindings }));
    // Through a second local function.
    expectOpaqueFence(inferProbe({
      do: [
        { var: "probe5a.textCodec" },
        getter,
        { let: { use: unfoldsCodec } },
        { call: [{ var: "use" }, getC] },
      ],
    }, { bindings }));
    // Through a let-bound use, itself generalized (v : forall a0. a0).
    expectOpaqueFence(inferProbe({
      do: [
        { var: "probe5a.textCodec" },
        getter,
        { let: { v: getC } },
        { call: ["apply2", unfoldsCodec, { var: "v" }] },
      ],
    }, { bindings }));
    // Through a getter re-bound by another let (get2 = get).
    expectOpaqueFence(inferProbe({
      do: [
        { var: "probe5a.textCodec" },
        getter,
        { let: { get2: { var: "get" } } },
        { call: ["apply2", unfoldsCodec, { call: [{ var: "get2" }, { var: "c" }] }] },
      ],
    }, { bindings }));
  }, 600_000);

  test("(G2) let-polymorphism is unchanged by opaque provenance", () => {
    const bindings = { c: opaqueInnerBinding() };
    const identity = { let: { id: { fn: [["x"], { var: "x" }] } } };
    // An ordinary let-polymorphic function keeps its generalization.
    const idType = arrowShape(solved(inferProbe({ do: [{ var: "probe5a.textCodec" }, identity, { var: "id" }] })));
    expect(idType.params).toEqual([tvar("a0")]);
    expect(idType.returns).toEqual(tvar("a0"));
    expect(solved(inferProbe({
      do: [identity, { call: [{ var: "id" }, 1] }, { call: [{ var: "id" }, "done"] }],
    }))).toEqual(ref("String"));
    // The opaque getter itself stays polymorphic: two uses at two field types
    // both solve (a monomorphic getter would report a mismatch).
    const getType = arrowShape(solved(inferProbe({ do: [getter, { var: "get" }] })));
    expect(getType.returns).toEqual(tvar("a0"));
    expect(solved(inferProbe({
      do: [
        getter,
        { call: ["apply2", { fn: [["x"], { call: ["consumeCodec", { var: "x" }] }] }, getC] },
        { call: ["apply2", { fn: [["y"], { call: ["probe5a.helper", { var: "y" }] }] }, getC] },
      ],
    }, { bindings }))).toEqual(ref("Number"));
  }, 600_000);

  test("hostile facts fail at the boundary", () => {
    const options = { resolveFunction: probeFunctions } as Record<string, unknown>;
    Object.defineProperty(options, "moduleMembers", { get: () => probeFacts(), enumerable: true });
    const accessor = inferJsonLogicType({ var: "probe5a.textCodec" }, options as JsonLogicInferenceOptions);
    expect(accessor.outcome.$tag).toBe("Invalid");
    const throwing = inferProbe({ var: "probe5a.textCodec" }, {
      moduleMembers: { ...probeFacts(), resolveModuleMemberScheme: () => { throw new Error("registry down"); } },
    });
    expect(throwing.outcome).toEqual({
      $tag: "Invalid",
      diagnostics: [{ code: "INFERENCE_MODULE_MEMBER_BOUNDARY", functionId: "<authoring>", message: "registry down" }],
    });
  }, 600_000);

  test("plain record projection is unchanged", () => {
    const record: FenelType = { $record: { fields: [field("a", ref("Number"))] } };
    expect(solved(inferProbe({ var: "r.a" }, { bindings: { r: record } }))).toEqual(ref("Number"));
    expect(solved(inferJsonLogicType({ var: "r.a" }, { bindings: { r: record } }))).toEqual(ref("Number"));
  }, 600_000);
});

// ===========================================================================
// (S) The system registry: the brief's rows.
// ===========================================================================

describe("(S) inference of bundle.member over the system registry", () => {
  let reg: ModuleRegistry;
  let options: JsonLogicInferenceOptions;
  beforeAll(() => {
    reg = getSystemRegistry();
    options = {
      moduleMembers: reg,
      resolveFunction: (id) => {
        const fn = reg.getFunction(id);
        if (!fn) return undefined;
        return {
          params: fn.params,
          returns: fn.returns,
          scheme: reg.getFunctionScheme(fn.id),
          targetId: fn.id,
          signatureOutcome: reg.getFunctionSignatureInfo(fn.id)?.outcome,
        };
      },
    };
  }, 900_000);
  const infer = (logic: unknown): Outcome => inferJsonLogicType(logic, options);
  const resultOf = (err: FenelType, ok: FenelType): FenelType => ({
    $variant: {
      cases: [
        { name: "Err", fields: [{ ...positional(0, err) }], label: NOTHING },
        { name: "Ok", fields: [{ ...positional(0, ok) }], label: NOTHING },
      ],
    },
  } as FenelType);

  test("codec.isoBase64.decode infers String -> Result String Bytes", () => {
    const result = infer({ var: "codec.isoBase64.decode" });
    const decode = arrowShape(solved(result));
    expect(decode.params).toEqual([ref("String")]);
    expect(decode.returns).toEqual(resultOf(ref("String"), ref("Bytes")));
    expect(result.scheme?.nominals?.map(({ identity }) => identity)).toContain('["system","Bytes"]');
    expect(solved(infer({ call: ["codec.isoBase64.decode", "aGVsbG8="] })))
      .toEqual(resultOf(ref("String"), ref("Bytes")));
  }, 600_000);

  test("codec.isoBase64 infers Iso String Bytes", () => {
    expect(solved(infer({ var: "codec.isoBase64" })))
      .toEqual({ $el: { call: ["Iso", ref("String"), ref("Bytes")] } });
  }, 600_000);

  test("codec.isoBase64.label is an explicit fence: Iso declares no label", () => {
    const [diagnostic] = fenced(infer({ var: "codec.isoBase64.label" }));
    expect(diagnostic!.code).toBe("inference.record-projection");
    expect(diagnostic!.message).toContain("declares no field label");
  }, 600_000);

  test("(R3) through an alias: decode infers, label and the erased laws fence", () => {
    const alias = (field: string) =>
      infer({ do: [{ let: { i: { var: "codec.isoBase64" } } }, { var: `i.${field}` }] });
    expect(arrowShape(solved(alias("decode"))).returns).toEqual(resultOf(ref("String"), ref("Bytes")));
    const [label] = fenced(alias("label"));
    expect(label!.code).toBe("inference.record-projection");
    expect(label!.message).toContain("declares no field label");
    for (const law of ["isoDecodeEncodeRoundtrip", "isoEncodeDecodeRoundtrip"]) {
      const [diagnostic] = fenced(alias(law));
      expect(diagnostic!.code).toBe("inference.record-projection");
      expect(diagnostic!.message).toContain("erased obligation");
    }
  }, 600_000);

  test("(R5) the authoring inference path consults the registry's members", () => {
    const decodeNode = { kind: "param" as const, name: "codec.isoBase64.decode" };
    const catalog = buildAuthoringCatalogSnapshot([], { registry: reg });
    const wired = inferAuthoringExpression(decodeNode, createAuthoringEnvironment(catalog, { moduleMembers: reg }));
    expect(arrowShape(solved(wired)).returns).toEqual(resultOf(ref("String"), ref("Bytes")));
    // Without the registry's member facts the spelling stays unknown.
    expect(inferAuthoringExpression(decodeNode, createAuthoringEnvironment(catalog)).outcome.$tag)
      .toBe("AnnotationRequired");
    // The engine's own module-mode session wires its registry.
    const session = sourceModuleSessionFor(reg, [], "codec");
    expect(arrowShape(solved(inferAuthoringExpression(decodeNode, session.environment))).returns)
      .toEqual(resultOf(ref("String"), ref("Bytes")));
  }, 600_000);

  test("algebra.maybeFunctor.fmap fences: Functor's a/b are unbound and Maybe is higher-kinded", () => {
    for (const name of ["algebra.maybeFunctor", "algebra.maybeFunctor.fmap"]) {
      const [diagnostic] = fenced(infer({ var: name }));
      expect(diagnostic!.code).toBe("inference.record-projection");
      expect(diagnostic!.message).toContain("higher-kinded");
    }
  }, 600_000);

  test("a type member, an ambiguous type and a missing member", () => {
    expect(solved(infer({ var: "telegram.Update" }))).toEqual({ $type: true });
    const [ambiguous] = fenced(infer({ var: "telegram.Animation" }));
    expect(ambiguous!.code).toBe("inference.ambiguous-call");
    expect(ambiguous!.message).toContain("telegram.Animation");
    expect(fenced(infer({ var: "codec.ghost" }))).toEqual([
      { code: "inference.unknown-name", message: "no exact scheme is available for codec.ghost" },
    ]);
  }, 600_000);

  test("a bundle alias inference cannot see (`import codec as cx`) fences as unknown-name", () => {
    // Inference reads bundles by their registered names only; an alias is an
    // import-frame name, so `cx.isoBase64.decode` is an unknown spelling here,
    // never some other member.
    for (const name of ["cx.isoBase64", "cx.isoBase64.decode"]) {
      expect(fenced(infer({ var: name }))).toEqual([
        { code: "inference.unknown-name", message: `no exact scheme is available for ${name}` },
      ]);
    }
  }, 600_000);

  test("(O1) picture.renderablePicture lacks mime_type: it fences through a let and as a value", () => {
    // Renderable declares render, mime_type and max_length; the value carries
    // render only. Before the fix the let form inferred Solved String.
    for (const logic of [
      { do: [{ let: { r: { var: "picture.renderablePicture" } } }, { var: "r.mime_type" }] },
      { var: "picture.renderablePicture" },
    ]) {
      const [diagnostic] = fenced(infer(logic));
      expect(diagnostic!.code).toBe("inference.record-projection");
      expect(diagnostic!.message).toContain("picture.renderablePicture does not carry its declared field");
    }
  }, 600_000);

  test("(O2) a bare-constructor instance argument (Monoid List, Functor Result) fences, never Invalid", () => {
    for (const logic of [
      { var: "algebra.listMonoid" },
      { call: ["algebra.listMonoid.mappend", [1], [2]] },
      { var: "algebra.resultFunctor" },
      { var: "algebra.listContainable" },
    ]) {
      const [diagnostic] = fenced(infer(logic));
      expect(diagnostic!.code).toBe("inference.host-scheme-sidecar");
    }
  }, 600_000);

  test("(O4) a bare Iso receiver stays a fence when an Iso member is mentioned", () => {
    const x: TypeScheme = {
      quantified: [],
      body: ref("Iso"),
      nominals: [{ path: [], identity: reg.getEntityNominalIdentity("Iso")!, publicName: "Iso" }],
    };
    const [diagnostic] = fenced(inferJsonLogicType(
      { do: [{ var: "codec.isoBase64" }, { var: "x.decode" }] },
      { ...options, bindings: { x } },
    ));
    expect(diagnostic!.code).toBe("inference.record-projection");
  }, 600_000);

  test("a function member keeps today's callable route", () => {
    const decode = arrowShape(solved(infer({ var: "codec.base64Decode" })));
    expect(decode.returns).toEqual(resultOf(ref("String"), ref("Bytes")));
  }, 600_000);
});

// ===========================================================================
// (R) Small registries: the review fixes on real registry facts.
// ===========================================================================

const src = (...lines: string[]): string => lines.join("\n");

/** Infer over a registry's own facts, as the (S) block does. */
function registryOptions(reg: ModuleRegistry): JsonLogicInferenceOptions {
  return {
    moduleMembers: reg,
    resolveFunction: (id) => {
      const fn = reg.getFunction(id);
      if (!fn) return undefined;
      return {
        params: fn.params,
        returns: fn.returns,
        scheme: reg.getFunctionScheme(fn.id),
        targetId: fn.id,
        signatureOutcome: reg.getFunctionSignatureInfo(fn.id)?.outcome,
      };
    },
  };
}

describe("(R) review fixes over small registries", () => {
  // Base5a and Sub5a are module record types that are ALSO dispatch classes of
  // this registry's own pool: one declaration each, two faces. Sub5a's base5a
  // field is a superclass obligation (a registered class applied to Sub5a's
  // own parameter), which the registry erases from the instance's value.
  const classes = loadFenelModule(src(
    "module klass5a where",
    "Base5a a = Base5a hello5a: a -> String",
    "Sub5a a = Sub5a base5a: Base5a a greet5a: a -> String",
  ), "klass5a");
  const subInstances = loadFenelModule(
    src("sub : Sub5a Number", String.raw`sub = Sub5a { greet5a = \x -> "g" }`),
    "klass5a",
    { dispatchInstanceFile: true },
  ).instances ?? [];
  const build = (): ModuleRegistry => {
    const local = createDispatchRegistry();
    for (const id of ["Base5a", "Sub5a"]) {
      const entity = classes.entities!.find((e) => e.id === id)!;
      local.defineClass(seedFromType(id, entity.type, entity.params![0]!, {
        typeScheme: entity.typeScheme,
        classParams: entity.params!,
      }));
    }
    for (const inst of subInstances) local.addInstance(inst);
    const bundle: FenelModule = { ...classes, instances: [...(classes.instances ?? []), ...subInstances] };
    return createRegistry([bundle], { dispatchRegistry: local });
  };

  test("(R1) a uniquely owned record registered as a class: its named instance infers", () => {
    const reg = build();
    expect(reg.getCapability("Sub5a")).toBeDefined();
    const greet = arrowShape(solved(inferJsonLogicType({ var: "klass5a.sub.greet5a" }, registryOptions(reg))));
    expect(greet.params).toEqual([ref("Number")]);
    expect(greet.returns).toEqual(ref("String"));
  }, 600_000);

  test("(R3) a superclass obligation fences by its value, through an alias, and deferred", () => {
    const reg = build();
    const options = registryOptions(reg);
    expect(fenced(inferJsonLogicType({ var: "klass5a.sub.base5a" }, options))[0]!.message)
      .toContain("carries no field base5a");
    const [alias] = fenced(inferJsonLogicType(
      { do: [{ let: { i: { var: "klass5a.sub" } } }, { var: "i.base5a" }] },
      options,
    ));
    expect(alias!.code).toBe("inference.record-projection");
    expect(alias!.message).toContain("erased obligation");
    expect(arrowShape(solved(inferJsonLogicType(
      { do: [{ let: { i: { var: "klass5a.sub" } } }, { var: "i.greet5a" }] },
      options,
    ))).returns).toEqual(ref("String"));
  }, 600_000);

  test("(R1) an instance type with two owners stays an explicit fence", () => {
    const ownerA = loadFenelModule(src("module ownera where", "Owned5a = Owned5a payload: String"), "ownera");
    const ownerB = loadFenelModule(src("module ownerb where", "Owned5a = Owned5a payload: String"), "ownerb");
    const item: FenelModule = {
      name: "ownera",
      label: "ownera",
      instances: loadFenelModule(src("item : Owned5a", 'item = Owned5a { payload = "x" }'), "ownera", {
        dispatchInstanceFile: true,
      }).instances ?? [],
    };
    const reg = createRegistry([ownerA, ownerB, item]);
    for (const name of ["ownera.item", "ownera.item.payload"]) {
      const [diagnostic, ...rest] = fenced(inferJsonLogicType({ var: name }, registryOptions(reg)));
      expect(rest).toEqual([]);
      expect(diagnostic!.code).toBe("inference.ambiguous-call");
      expect(diagnostic!.message).toContain("Owned5a");
    }
  }, 600_000);

  test("(O3) a zero-argument {method} naming an uppercase bundle's instance is its value, not a call", () => {
    const chart = loadFenelModule(src(
      "module Chart5b where",
      "Thing5b = Thing5b n: Number",
      "Show5b a = Show5b view5b: String",
    ), "Chart5b");
    const shows = loadFenelModule(
      src("thingShow : Show5b Thing5b", 'thingShow = Show5b { view5b = "thing" }'),
      "Chart5b",
      { dispatchInstanceFile: true },
    ).instances ?? [];
    const reg = createRegistry([{ ...chart, instances: [...(chart.instances ?? []), ...shows] }]);
    const options = registryOptions(reg);
    const expected = { $el: { call: ["Show5b", ref("Thing5b")] } };
    expect(solved(inferJsonLogicType({ var: "Chart5b.thingShow" }, options))).toEqual(expected);
    expect(solved(inferJsonLogicType({ method: ["Chart5b", "thingShow"] }, options))).toEqual(expected);
    // With arguments it stays an application (and a record is not callable).
    expect(inferJsonLogicType({ method: ["Chart5b", "thingShow", 1] }, options).outcome.$tag).toBe("Invalid");
  }, 600_000);

  test("(F4) a String field authored as a bare constant name fences: its value is that constant's reference", () => {
    const grp = loadFenelModule(src(
      "module grp5a where",
      "Groupable5a a = Groupable5a groupName5a: String render5a: a -> String",
      "defaultName5a : String",
      'defaultName5a = "dflt"',
    ), "grp5a");
    const instances = loadFenelModule(
      src("g : Groupable5a Number", String.raw`g = Groupable5a { groupName5a = defaultName5a, render5a = \x -> "r" }`),
      "grp5a",
      { dispatchInstanceFile: true },
    ).instances ?? [];
    const reg = createRegistry([{ ...grp, instances: [...(grp.instances ?? []), ...instances] }]);
    // The member value is lowered declaration data: the field holds the
    // constant's reference, not a String.
    const member = reg.resolveModuleMember("grp5a", "g") as { kind: string; value?: Record<string, unknown> };
    expect(member.kind).toBe("instance");
    expect(member.value?.groupName5a).toMatchObject({ $ref: expect.any(String) });
    const options = registryOptions(reg);
    for (const logic of [
      { var: "grp5a.g.groupName5a" },
      { do: [{ let: { i: { var: "grp5a.g" } } }, { var: "i.groupName5a" }] },
    ]) {
      const [diagnostic] = fenced(inferJsonLogicType(logic, options));
      expect(diagnostic!.code).toBe("inference.record-projection");
      expect(diagnostic!.message).toContain("groupName5a");
    }
    // The arrow field still infers.
    const render = arrowShape(solved(inferJsonLogicType({ var: "grp5a.g.render5a" }, options)));
    expect(render.params).toEqual([ref("Number")]);
    expect(render.returns).toEqual(ref("String"));
  }, 600_000);

  test("(R5) registry signature inference does not read bundle members: an un-annotated body fences", () => {
    // Not wired (see the slice I report): the member index answers only once
    // the registry facade exists, after signature finalization, and memoises
    // what it answers. The registry refuses the body explicitly, never guesses.
    const use = loadFenelModule(src("module memberuse5a where", "f s = codec.isoBase64.decode s"), "memberuse5a");
    expect(() => createRegistry([codecModule, use])).toThrow("codec.isoBase64.decode");
  }, 600_000);
});
