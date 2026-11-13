// ---------------------------------------------------------------------------
// modules-as-values Phase 5a, slice L — named members keep their names at load,
// and the registry answers "what is member m of bundle b?" for every named kind
// (`workstreams/modules-as-values/briefs/phase-5a-named-members-by-dot.md`,
// settled design 1-3 and 4(a), amendments A1, A2, A4, A5).
//
// This file pins the loader and registry half only. The evaluator walk that
// consumes `_moduleMember` (`codec.isoBase64.decode "…"`) is slice E.
//
//   (L) the loader: an instance-file value carries its declaration name and
//       authored record; ordinary typed constants and `_` instances do not; a
//       dotted call head whose first segment is a local binder is a `{var}`
//       head (the shadowing fix).
//   (R) the system registry: instance, function and type members, the
//       two-owner refusal, misses, and where the context hook is installed.
//   (D) dispatch ingress strips the carrier.
//   (S) small registries: a name bound twice in one bundle, law erasure by the
//       class's declared field types, and registry locality of instance values.
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { loadFenelModule } from "./fenel-module";
import { parse } from "./fenel-parser";
import { modulesFor } from "./module-manifest";
import { createEngineBootstrapRegistry, createRegistry, type ModuleRegistry } from "./registry";
import { createAccountRegistry } from "./repository-registry";
import { getSystemRegistry } from "./system-registry";
import { dispatchRegistry } from "./system-entities";
import { createDispatchRegistry } from "./dispatch-registry";
import { resolveEffect, seedFromType } from "./effect-dispatch";
import { dispatchNativesCtx } from "../../../../fenel/modules/dispatch/ffi/dispatch-ffi";
import {
  evaluate,
  invokeCallable,
  moduleSourceCoordinate,
  pureEvaluateContext,
  type EvaluateContext,
  type ModuleMemberResolution,
} from "./json-logic";
import { prepareSourceModule, sourceModuleDispatchRegistry } from "./authoring/source-module";
import { codecModule } from "./modules/codec";
import type { FenelModule, Instance } from "./types";

const src = (...lines: string[]): string => lines.join("\n");

/** Every own property of a value, recursively frozen. */
function deepFrozen(value: unknown): boolean {
  if (value === null || typeof value !== "object") return true;
  if (!Object.isFrozen(value)) return false;
  return Reflect.ownKeys(value).every((key) =>
    deepFrozen((value as Record<PropertyKey, unknown>)[key]),
  );
}

const member = (registry: ModuleRegistry, bundle: string, name: string): ModuleMemberResolution =>
  registry.resolveModuleMember(bundle, name);

// ===========================================================================
// (L) The loader.
// ===========================================================================

describe("(L) an instance-file value keeps its declaration", () => {
  const instanceFile = src(
    "isoX : Iso String Bytes",
    'isoX = Iso { encode = codec.base64Encode, decode = codec.base64Decode, label = "X", priority = 7 }',
  );

  test("the carrier holds the name and the authored record, captured before label/priority are lifted", () => {
    const [inst] = loadFenelModule(instanceFile, "probe", { dispatchInstanceFile: true }).instances ?? [];
    expect(inst!.label).toBe("X");
    expect(inst!.priority).toBe(7);
    expect(Object.keys(inst!.methods).sort()).toEqual(["decode", "encode"]);
    expect(inst!.declaration).toEqual({
      name: "isoX",
      // The signature's type application, kept apart from the value's tag.
      type: { name: "Iso", args: ["String", "Bytes"] },
      value: {
        $tag: "Iso",
        encode: { $ref: "codec.base64Encode" },
        decode: { $ref: "codec.base64Decode" },
        label: "X",
        priority: 7,
      },
    });
    // The authored record shares no object with the dispatch methods it was
    // lowered beside.
    expect(inst!.declaration!.value.encode).not.toBe(inst!.methods.encode);
  });

  test("the carrier is invisible to spreads, JSON and structural equality", () => {
    const [inst] = loadFenelModule(instanceFile, "probe", { dispatchInstanceFile: true }).instances ?? [];
    expect(Object.getOwnPropertyDescriptor(inst!, "declaration")?.enumerable).toBe(false);
    expect(Object.keys(inst!)).not.toContain("declaration");
    expect(JSON.stringify(inst)).not.toContain("isoX");
    expect({ ...inst! }).not.toHaveProperty("declaration");
  });

  test("an ordinary file's typed constant is a function member, never a carried instance", () => {
    const loaded = loadFenelModule(src("module demo where", "k : Box", 'k = Box { contents = "hi" }'), "demo");
    const box = (loaded.instances ?? []).find((i) => i.typeName === "Box");
    expect(box).toBeDefined();
    expect(Object.getOwnPropertyDescriptor(box!, "declaration")).toBeUndefined();
    expect((loaded.functions ?? []).map((f) => f.id)).toContain("demo:k");
  });

  test("an unnamed (_) instance has no name to carry", () => {
    const loaded = loadFenelModule(
      src("_ : Infixable std.add", '_ = Infixable { notation = "+", precedence = 6, associativity = "left" }'),
      "ops",
      { dispatchInstanceFile: true },
    );
    const [inst] = loaded.instances ?? [];
    expect(inst!.typeName).toBe("Infixable");
    expect(Object.getOwnPropertyDescriptor(inst!, "declaration")).toBeUndefined();
  });
});

describe("(L) a local binder shadows a bundle in call position", () => {
  // Signed, so the registry's signature inference has a structural receiver
  // to project (an unsigned `state` is an underdetermined receiver).
  const demo = loadFenelModule(src(
    "module demo where",
    "f : { error: (Number -> List Number) } -> Number -> List Number",
    "f state x = state.error x",
    "g : Number -> String",
    "g x = state.error x",
    "h : { error: { inner: (Number -> List Number) } } -> Number -> List Number",
    "h state = \\y -> state.error.inner y",
    "wrap : Number -> List Number",
    "wrap x = [x]",
  ), "demo");
  const body = (id: string) => (demo.functions ?? []).find((fn) => fn.id === id)!.body;

  test("a dotted head whose first segment is a parameter becomes a {var} head", () => {
    expect(body("demo:f")).toEqual({ call: [{ var: "state.error" }, { var: "x" }] });
  });

  test("a lambda parameter shadows too, through every later segment", () => {
    expect(body("demo:h")).toEqual({ fn: ["y", { call: [{ var: "state.error.inner" }, { var: "y" }] }] });
  });

  test("an unbound first segment stays a bundle-qualified string head", () => {
    expect(body("demo:g")).toEqual({ call: ["state.error", { var: "x" }] });
  });

  test("the call applies the local record's field, not the bundle member", () => {
    const stateBundle = loadFenelModule(
      src("module state where", "error : Number -> String", 'error x = "bundle"'),
      "state",
    );
    const reg = createRegistry([stateBundle, demo]);
    const ctx = reg.evaluateContext();
    const local = { error: { $ref: "demo:wrap" } };
    expect(evaluate({ call: ["demo:f", { var: "s" }, 5] }, { s: local }, ctx)).toEqual([5]);
    // The unshadowed body still reaches the bundle.
    expect(evaluate({ call: ["demo:g", 5] }, {}, ctx)).toBe("bundle");
  });
});

// ===========================================================================
// (R) The system registry.
// ===========================================================================

describe("(R) members of the system registry", () => {
  const reg = getSystemRegistry();

  test("codec.isoBase64 is the authored Iso record, frozen, with references to the codec functions", () => {
    const resolved = member(reg, "codec", "isoBase64");
    expect(resolved.kind).toBe("instance");
    const value = (resolved as { value: Record<string, unknown> }).value;
    const ref = (field: string): string => (value[field] as { $ref: string }).$ref;
    // The authored `codec.base64Encode` is bound in the declaring bundle's Name
    // frame (the source-module method binder), so it names the canonical id;
    // the registry is locked, so the reference is that function's opaque
    // handle, the one `codec.base64Encode` itself evaluates to (G2).
    expect(value).toEqual({
      $tag: "Iso",
      encode: { $ref: reg.getUuid("codec:base64Encode")! },
      decode: { $ref: reg.getUuid("codec:base64Decode")! },
      label: "Base64 (RFC 4648)",
    });
    expect(reg.getFunction(ref("encode"))?.id).toBe("codec:base64Encode");
    expect(reg.getFunction(ref("decode"))?.id).toBe("codec:base64Decode");
    expect(deepFrozen(value)).toBe(true);
    // Every read is the same frozen answer; nothing the caller does reaches
    // the next caller.
    expect(member(reg, "codec", "isoBase64")).toBe(resolved);
  }, 600_000);

  test("algebra.maybeFunctor holds the fmap reference (the instance lives in the algebra bundle)", () => {
    const resolved = member(reg, "algebra", "maybeFunctor");
    expect(resolved).toEqual({
      kind: "instance",
      value: { $tag: "Functor", fmap: { $ref: reg.getUuid("algebra:maybeFmap")! } },
    });
    const fmap = (resolved as { value: { fmap: { $ref: string } } }).value.fmap;
    expect(reg.getFunction(fmap.$ref)?.id).toBe("algebra:maybeFmap");
    // It is a member of the bundle that holds it, not of std.
    expect(member(reg, "std", "maybeFunctor")).toEqual({ kind: "missing" });
  }, 600_000);

  test("a function member is its canonical id", () => {
    expect(member(reg, "codec", "base64Decode")).toEqual({ kind: "function", id: "codec:base64Decode" });
  }, 600_000);

  test("telegram.Update is the UUID handle that resolves back to telegram's Update", () => {
    const resolved = member(reg, "telegram", "Update");
    expect(resolved.kind).toBe("type");
    const handle = (resolved as { value: { $ref: string } }).value;
    expect(Object.keys(handle)).toEqual(["$ref"]);
    expect(handle.$ref).toBe(reg.getUuid("Update")!);
    expect(handle.$ref).not.toBe("Update");
    expect(reg.getEntity(handle.$ref)?.module).toBe("telegram");
    expect(reg.getEntity(handle.$ref)?.id).toBe("Update");
    expect(deepFrozen(handle)).toBe(true);
  }, 600_000);

  test("a type with two owners is refused, naming both owners", () => {
    // Per-owner type identity (Phase 5 S2): two distinct UUIDs, each resolving
    // back to its owner; the member stays refused (amendment A1) and its
    // message names both identities.
    const telegramUuid = reg.getTypeUuid("telegram", "Animation")!;
    const animationUuid = reg.getTypeUuid("animation", "Animation")!;
    expect(telegramUuid).not.toBe(animationUuid);
    expect(reg.getEntity(telegramUuid)?.module).toBe("telegram");
    expect(reg.getEntity(animationUuid)?.module).toBe("animation");
    for (const bundle of ["telegram", "animation"]) {
      const resolved = member(reg, bundle, "Animation");
      expect(resolved.kind).toBe("ambiguous");
      const message = (resolved as { message: string }).message;
      expect(message).toContain("telegram");
      expect(message).toContain("animation");
      expect(message).toContain(`${bundle}.Animation`);
      expect(message).toContain(telegramUuid);
      expect(message).toContain(animationUuid);
    }
  }, 600_000);

  test("misses stay misses", () => {
    expect(member(reg, "codec", "ghost")).toEqual({ kind: "missing" });
    expect(member(reg, "nosuchbundle", "isoBase64")).toEqual({ kind: "missing" });
    // A type is a member of its owner only.
    expect(member(reg, "codec", "Update")).toEqual({ kind: "missing" });
  }, 600_000);

  test("the full evaluation context carries the hook; the pure-only restriction does not", () => {
    const ctx = reg.evaluateContext();
    expect(typeof ctx._moduleMember).toBe("function");
    expect(ctx._moduleMember!("codec", "isoBase64")).toBe(member(reg, "codec", "isoBase64"));
    expect(pureEvaluateContext(ctx)._moduleMember).toBeUndefined();
  }, 600_000);
});

// ===========================================================================
// (D) Dispatch ingress strips the carrier.
// ===========================================================================

describe("(D) the carrier never reaches the dispatch pool", () => {
  test("codec's raw module keeps the carrier; its dispatch rows do not", () => {
    const raw = (codecModule.instances ?? []).find(
      (i) => i.typeName === "Iso" && JSON.stringify(i.args) === '["String","Bytes"]',
    );
    expect(raw?.declaration?.name).toBe("isoBase64");
    const rows = dispatchRegistry.listInstances("Iso");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(Object.getOwnPropertyDescriptor(row, "declaration")).toBeUndefined();
  });

  test("addInstance registers a carrier-free copy and leaves the caller's object alone", () => {
    const [inst] = loadFenelModule(
      src("isoY : Iso String Bytes", "isoY = Iso { encode = codec.base64Encode, decode = codec.base64Decode }"),
      "probe",
      { dispatchInstanceFile: true },
    ).instances ?? [];
    expect(inst!.declaration?.name).toBe("isoY");
    const local = createDispatchRegistry();
    local.addInstance(inst!);
    const [row] = local.listInstances("Iso");
    expect(Object.getOwnPropertyDescriptor(row!, "declaration")).toBeUndefined();
    expect(row!.methods).toBe(inst!.methods);
    expect(row!.args).toEqual(["String", "Bytes"]);
    expect(inst!.declaration?.name).toBe("isoY");
  });
});

// ===========================================================================
// (S) Small registries.
// ===========================================================================

const SHAPE_TYPE = src("module shapes where", "Shape a = Shape name: String size: a");
const shapeInstances = (bundle: string, ...lines: string[]): FenelModule => ({
  name: bundle,
  label: bundle,
  instances: loadFenelModule(src(...lines), bundle, { dispatchInstanceFile: true }).instances ?? [],
});

describe("(S) one name, one target", () => {
  test("a name bound to a function and an instance in one bundle is ambiguous, naming both", () => {
    const reg = createRegistry([
      loadFenelModule(SHAPE_TYPE, "shapes"),
      loadFenelModule(src("module twice where", "dup x = x"), "twice"),
      shapeInstances("twice", "dup : Shape Number", 'dup = Shape { name = "sq", size = 4 }'),
    ]);
    const resolved = member(reg, "twice", "dup");
    expect(resolved.kind).toBe("ambiguous");
    const message = (resolved as { message: string }).message;
    expect(message).toContain("twice.dup");
    expect(message).toContain("twice:dup");
    expect(message).toContain("Shape");
  });

  test("two different instances under one name in one bundle are ambiguous", () => {
    const reg = createRegistry([
      loadFenelModule(SHAPE_TYPE, "shapes"),
      shapeInstances("pair", "dup : Shape Number", 'dup = Shape { name = "sq", size = 4 }'),
      shapeInstances("pair", "dup : Shape Number", 'dup = Shape { name = "sq", size = 5 }'),
    ]);
    expect(member(reg, "pair", "dup").kind).toBe("ambiguous");
  });

  test("two projections of the same declaration are one target", () => {
    const one = shapeInstances("same", "sq : Shape Number", 'sq = Shape { name = "sq", size = 4 }');
    const reg = createRegistry([
      loadFenelModule(SHAPE_TYPE, "shapes"),
      one,
      { name: "same", label: "same", instances: one.instances },
    ]);
    expect(member(reg, "same", "sq")).toEqual({
      kind: "instance",
      value: { $tag: "Shape", name: "sq", size: 4 },
    });
  });

  test("law fields are erased by the class's declared field types, data fields kept", () => {
    const reg = createRegistry([
      shapeInstances(
        "laws",
        "isoL : Iso String Bytes",
        'isoL = Iso { encode = codec.base64Encode, decode = codec.base64Decode, label = "L", isoDecodeEncodeRoundtrip = Verified { predicate = True, evidence = Axiom } }',
      ),
    ]);
    expect(member(reg, "laws", "isoL")).toEqual({
      kind: "instance",
      value: {
        $tag: "Iso",
        encode: { $ref: "codec.base64Encode" },
        decode: { $ref: "codec.base64Decode" },
        label: "L",
      },
    });
  });
});

describe("(S) an instance value is local to the registry that holds it", () => {
  test("another account's registry never sees it, even through a shared dispatch pool", () => {
    const shared = createDispatchRegistry();
    const accountA = shapeInstances(
      "acct",
      "acctIso : Iso String Bytes",
      'acctIso = Iso { encode = codec.base64Encode, decode = codec.base64Decode, label = "A" }',
    );
    for (const inst of accountA.instances ?? []) {
      shared.addInstance({ ...(inst as Instance), scope: { kind: "account", accountId: "account-a" } });
    }
    const registryA = createAccountRegistry([], [accountA], { dispatchRegistry: shared });
    const registryB = createAccountRegistry([], [{ name: "acct", label: "acct", instances: [] }], { dispatchRegistry: shared });
    expect(member(registryA, "acct", "acctIso").kind).toBe("instance");
    expect(member(registryB, "acct", "acctIso")).toEqual({ kind: "missing" });
    expect(registryB.evaluateContext()._moduleMember!("acct", "acctIso")).toEqual({ kind: "missing" });
  }, 600_000);
});

// ===========================================================================
// (F) Review fixes (gpt-6-astra review of slice L). Each case was watched
//     failing on the slice-L code before its fix.
// ===========================================================================

describe("(F1) only projections of the SAME declaration collapse", () => {
  const PHANTOM_TYPE = src("module phantoms where", "Phantom5a a = Phantom5a label: String");

  test("equal records declared at different type arguments are two targets", () => {
    const reg = createRegistry([
      loadFenelModule(PHANTOM_TYPE, "phantoms"),
      shapeInstances("pair", "dup : Phantom5a Number", 'dup = Phantom5a { label = "same" }'),
      shapeInstances("pair", "dup : Phantom5a String", 'dup = Phantom5a { label = "same" }'),
    ]);
    const resolved = member(reg, "pair", "dup");
    expect(resolved.kind).toBe("ambiguous");
    expect((resolved as { message: string }).message).toContain("pair.dup");
  });

  test("two declarations with equal records and equal arguments are still two targets", () => {
    const reg = createRegistry([
      loadFenelModule(PHANTOM_TYPE, "phantoms"),
      shapeInstances("pair", "dup : Phantom5a Number", 'dup = Phantom5a { label = "same" }'),
      shapeInstances("pair", "dup : Phantom5a Number", 'dup = Phantom5a { label = "same" }'),
    ]);
    expect(member(reg, "pair", "dup").kind).toBe("ambiguous");
  });
});

describe("(F2) obligation erasure reads the instance type's ONE owner", () => {
  const OWNER_A = loadFenelModule(src("module ownera where", "Owned5a = Owned5a payload: String"), "ownera");
  const OWNER_B = loadFenelModule(src("module ownerb where", "Owned5a = Owned5a payload: Verified Boolean"), "ownerb");
  const item = () => shapeInstances("ownera", "item : Owned5a", 'item = Owned5a { payload = "x" }');

  test("a type name with two owners is refused, in either module order, naming both owners", () => {
    for (const modules of [[OWNER_A, OWNER_B, item()], [OWNER_B, OWNER_A, item()]]) {
      const resolved = member(createRegistry(modules), "ownera", "item");
      expect(resolved.kind).toBe("ambiguous");
      const message = (resolved as { message: string }).message;
      expect(message).toContain("ownera");
      expect(message).toContain("ownerb");
      expect(message).toContain("Owned5a");
    }
  });

  test("with one owner the declared field types decide (kept here, erased as a law there)", () => {
    expect(member(createRegistry([OWNER_A, item()]), "ownera", "item")).toEqual({
      kind: "instance",
      value: { $tag: "Owned5a", payload: "x" },
    });
    const lawItem = shapeInstances(
      "ownerb",
      "item : Owned5a",
      "item = Owned5a { payload = Verified { predicate = True, evidence = Axiom } }",
    );
    expect(member(createRegistry([OWNER_B, lawItem]), "ownerb", "item")).toEqual({
      kind: "instance",
      value: { $tag: "Owned5a" },
    });
  });
});

describe("(F3) a projected lambda method is bound like a dispatch source method", () => {
  // `Mapper5a` is a dispatch class of this registry's own dispatch pool; the
  // instance file's lambda calls `go`, a member of its DECLARING bundle; a
  // second bundle declares its own `go`.
  const mapper = loadFenelModule(src("module mapper where", "Mapper5a a = Mapper5a f: a -> List a"), "mapper");
  const callerFunctions = loadFenelModule(src("module caller where", "go : Number -> List Number", "go x = [x]"), "caller");
  const callerInstances = loadFenelModule(
    src("r : Mapper5a Number", String.raw`r = Mapper5a { f = \x -> go x }`),
    "caller",
    { dispatchInstanceFile: true },
  ).instances ?? [];
  const caller: FenelModule = { ...callerFunctions, instances: [...(callerFunctions.instances ?? []), ...callerInstances] };
  const other = loadFenelModule(src("module other where", "go : Number -> List String", 'go x = ["other"]'), "other");
  const build = (): ModuleRegistry => {
    const local = createDispatchRegistry();
    const entity = mapper.entities!.find((e) => e.id === "Mapper5a")!;
    local.defineClass(seedFromType("Mapper5a", entity.type, entity.params![0]!, {
      typeScheme: entity.typeScheme,
      classParams: entity.params!,
    }));
    for (const inst of callerInstances) local.addInstance(inst);
    return createRegistry([mapper, caller, other], { dispatchRegistry: local });
  };
  const apply = (f: unknown, x: unknown, context: EvaluateContext) =>
    evaluate({ call: [{ var: "f" }, { var: "x" }] }, { f, x }, context);

  test("caller.r.f is a closure of the declaring bundle, and applying it runs that bundle's go", () => {
    const reg = build();
    const resolved = member(reg, "caller", "r");
    expect(resolved.kind).toBe("instance");
    const f = (resolved as { value: { f: Record<string, unknown> } }).value.f;
    expect(f.__fenelFn).toBe(true);
    expect(f.sourceFunction).toBe(moduleSourceCoordinate("caller"));
    expect(deepFrozen(resolved)).toBe(true);
    const ctx = reg.evaluateContext();
    expect(apply(f, 3, ctx)).toEqual([3]);
    // Applied where `go` names the other bundle's function, the closure still
    // resolves in its own (lexical) scope.
    const otherFrame = reg.getModuleImportFrame("other")!;
    expect(otherFrame.names.go).toBe("other:go");
    expect(apply(f, 4, { ...ctx, _importStack: [otherFrame] })).toEqual([4]);
    expect(member(reg, "caller", "r")).toBe(resolved);
  }, 600_000);
});

describe("(F4) a type member's handle in a locked registry is identity-backed or refused", () => {
  const acct = (fieldType: string) => prepareSourceModule(
    src("module acct where", `T5a = T5a v: ${fieldType}`),
    "acct",
    undefined,
    randomUUID,
  );
  const accountRegistry = (prepared: ReturnType<typeof acct>): ModuleRegistry =>
    createAccountRegistry([], [prepared.module], {
      externalFields: [...prepared.fields],
      identityKinds: new Map(prepared.fields.map((field) => [field.id, "field"] as const)),
    });

  test("an account type has no identity yet: refused, never a bare name another account reads as its own", () => {
    const registryA = accountRegistry(acct("Number"));
    const registryB = accountRegistry(acct("String"));
    for (const reg of [registryA, registryB]) {
      const resolved = member(reg, "acct", "T5a");
      expect(resolved.kind).toBe("ambiguous");
      const message = (resolved as { message: string }).message;
      expect(message).toContain("acct.T5a");
      expect(message).toContain("pending");
    }
  }, 600_000);

  test("an explicitly lockless registry keeps the proven bare-name handle", () => {
    const reg = createRegistry([loadFenelModule(src("module acct where", "T5a = T5a v: Number"), "acct")]);
    expect(member(reg, "acct", "T5a")).toEqual({ kind: "type", value: { $ref: "T5a" } });
  });
});

describe("(F5) member answers never expose registry-owned bytes", () => {
  test("mutating returned Bytes changes neither the next read nor the context hook's", () => {
    const blob = {
      typeName: "ByteBox5a",
      args: ["Number"],
      methods: { data: new Uint8Array([1, 2, 3]) },
    } as unknown as Instance;
    Object.defineProperty(blob, "declaration", {
      value: Object.freeze({ name: "blob", value: { $tag: "ByteBox5a", data: new Uint8Array([1, 2, 3]) } }),
      enumerable: false,
    });
    const reg = createRegistry([
      loadFenelModule(src("module blobs where", "ByteBox5a a = ByteBox5a data: Bytes"), "blobs"),
      { name: "bin", label: "bin", instances: [blob] },
    ]);
    const bytesOf = (resolved: ModuleMemberResolution): Uint8Array =>
      (resolved as { value: { data: Uint8Array } }).value.data;
    const first = member(reg, "bin", "blob");
    expect(first.kind).toBe("instance");
    expect(Array.from(bytesOf(first))).toEqual([1, 2, 3]);
    bytesOf(first)[0] = 99;
    expect(Array.from(bytesOf(member(reg, "bin", "blob")))).toEqual([1, 2, 3]);
    const hooked = reg.evaluateContext()._moduleMember!("bin", "blob");
    bytesOf(hooked)[1] = 98;
    expect(Array.from(bytesOf(member(reg, "bin", "blob")))).toEqual([1, 2, 3]);
    expect(Object.isFrozen(member(reg, "bin", "blob"))).toBe(true);
  });
});

describe("(F6) resolveModuleMemberScheme: each member's declared type", () => {
  const scheme = (bundle: string, name: string) => getSystemRegistry().resolveModuleMemberScheme(bundle, name);

  test("a named instance answers its declared type application, args as loaded", () => {
    expect(scheme("codec", "isoBase64")).toEqual({ kind: "instance", typeName: "Iso", args: ["String", "Bytes"] });
    expect(scheme("algebra", "maybeFunctor")).toEqual({ kind: "instance", typeName: "Functor", args: ["Maybe"] });
  }, 600_000);

  test("a type, a function, an ambiguity and a miss answer as resolveModuleMember does", () => {
    const reg = getSystemRegistry();
    expect(scheme("telegram", "Update")).toEqual({ kind: "type", value: { $ref: reg.getUuid("Update")! } });
    expect(scheme("codec", "base64Decode")).toEqual({ kind: "function", id: "codec:base64Decode" });
    expect(scheme("telegram", "Animation").kind).toBe("ambiguous");
    expect(scheme("codec", "ghost")).toEqual({ kind: "missing" });
    expect(scheme("nosuchbundle", "isoBase64")).toEqual({ kind: "missing" });
  }, 600_000);

  test("answers are frozen and memoised", () => {
    const first = scheme("codec", "isoBase64");
    expect(deepFrozen(first)).toBe(true);
    expect(scheme("codec", "isoBase64")).toBe(first);
  }, 600_000);
});

// ===========================================================================
// (F7, F8) Review fixes (gpt-6-astra review of the A2 registry plumbing).
//     Each case was watched failing before its fix.
// ===========================================================================

describe("(F7) selecting or binding an instance never evaluates its data", () => {
  // A field whose authored value is an ordinary record that happens to have a
  // field named `fn` (or `call`) beside a field that calls a counting native.
  // It is data: binding is not evaluation, so neither the member index (which
  // binds under the REGISTRY's context, not the selecting caller's) nor a
  // source module's dispatch binder may run it.
  let probes = 0;
  const probeModule = (): FenelModule => ({
    ...loadFenelModule(src("module probe5a where", "@native", "probe : Number -> Number"), "probe5a"),
    nativeImpls: { "probe5a:probe": (x: unknown) => { probes += 1; return x; } },
  });
  const HOLDERS = ["Holder5a a = Holder5a item: a", "Runner5a a = Runner5a run: a -> a"];
  const holders = loadFenelModule(src("module holders where", ...HOLDERS), "holders");
  const INSTANCES = [
    "h : Holder5a Number",
    "h = Holder5a { item = { fn = [], payload = probe5a.probe 1 } }",
    "k : Runner5a Number",
    "k = Runner5a { run = { call = [], payload = probe5a.probe 2 } }",
  ];
  const FN_SHAPED = { fn: [], payload: { call: ["probe5a.probe", 1] } };
  const CALL_SHAPED = { call: [], payload: { call: ["probe5a.probe", 2] } };
  const boxInstances = (): Instance[] =>
    loadFenelModule(src(...INSTANCES), "boxes", { dispatchInstanceFile: true }).instances ?? [];
  /** `registered`: both records are dispatch classes of the registry's own
   *  pool, so their methods are bound. */
  const build = (registered: boolean): ModuleRegistry => {
    const instances = boxInstances();
    const modules: FenelModule[] = [probeModule(), holders, { name: "boxes", label: "boxes", instances }];
    if (!registered) return createRegistry(modules);
    const local = createDispatchRegistry();
    for (const id of ["Holder5a", "Runner5a"]) {
      const entity = holders.entities!.find((e) => e.id === id)!;
      local.defineClass(seedFromType(id, entity.type, entity.params![0]!, {
        typeScheme: entity.typeScheme,
        classParams: entity.params!,
      }));
    }
    for (const inst of instances) local.addInstance(inst);
    return createRegistry(modules, { dispatchRegistry: local });
  };
  const H_VALUE: ModuleMemberResolution = { kind: "instance", value: { $tag: "Holder5a", item: FN_SHAPED } };
  const K_VALUE: ModuleMemberResolution = { kind: "instance", value: { $tag: "Runner5a", run: CALL_SHAPED } };

  test("the probe is live: calling it counts (so a zero count below means something)", () => {
    probes = 0;
    expect(evaluate({ call: ["probe5a.probe", 7] }, {}, build(true).evaluateContext())).toBe(7);
    expect(probes).toBe(1);
  }, 600_000);

  for (const registered of [true, false]) {
    const label = registered ? "a registered dispatch class" : "an unregistered record";
    test(`resolveModuleMember (${label}): zero probes, the record unchanged`, () => {
      probes = 0;
      const reg = build(registered);
      expect(member(reg, "boxes", "h")).toEqual(H_VALUE);
      expect(member(reg, "boxes", "k")).toEqual(K_VALUE);
      expect(probes).toBe(0);
    }, 600_000);

    test(`resolveModuleMemberScheme (${label}): zero probes`, () => {
      probes = 0;
      const reg = build(registered);
      expect(reg.resolveModuleMemberScheme("boxes", "h")).toEqual({ kind: "instance", typeName: "Holder5a", args: ["Number"] });
      expect(reg.resolveModuleMemberScheme("boxes", "k")).toEqual({ kind: "instance", typeName: "Runner5a", args: ["Number"] });
      expect(probes).toBe(0);
    }, 600_000);

    test(`the context hook _moduleMember (${label}): zero probes, the record unchanged`, () => {
      probes = 0;
      const hook = build(registered).evaluateContext()._moduleMember!;
      expect(hook("boxes", "h")).toEqual(H_VALUE);
      expect(hook("boxes", "k")).toEqual(K_VALUE);
      expect(probes).toBe(0);
    }, 600_000);
  }

  test("a source module's dispatch binder leaves such a field as data and runs nothing", () => {
    const prepared = prepareSourceModule(src("module acct5a where", ...HOLDERS, ...INSTANCES), "acct5a", undefined, randomUUID);
    const dispatch = sourceModuleDispatchRegistry([prepared], createDispatchRegistry());
    const registry = createAccountRegistry([probeModule()], [prepared.module], {
      externalFields: [...prepared.fields],
      identityKinds: new Map(prepared.fields.map((field) => [field.id, "field"] as const)),
      dispatchRegistry: dispatch,
    });
    // The probe is reachable from the registry's context.
    probes = 0;
    expect(evaluate({ call: ["probe5a.probe", 7] }, {}, registry.evaluateContext())).toBe(7);
    expect(probes).toBe(1);
    probes = 0;
    dispatch.bindSourceMethods(registry);
    expect(probes).toBe(0);
    const row = (typeName: string) => dispatch.listInstances().find((inst) => inst.typeName === typeName)!;
    expect(row("Holder5a").methods.item).toEqual(FN_SHAPED);
    expect(row("Runner5a").methods.run).toEqual(CALL_SHAPED);
  }, 600_000);
});

describe("(F8) a projected lambda field is callable without dispatch registration", () => {
  const apply = (f: unknown, x: unknown, context: EvaluateContext) =>
    evaluate({ call: [{ var: "f" }, { var: "x" }] }, { f, x }, context);
  const lambdaOf = (resolved: ModuleMemberResolution, field: string): Record<string, unknown> => {
    expect(resolved.kind).toBe("instance");
    return (resolved as { value: Record<string, Record<string, unknown>> }).value[field]!;
  };

  test("Plain5a: item.f is a closure, and applying it returns its argument", () => {
    const items = loadFenelModule(
      src("item : Plain5a Number", String.raw`item = Plain5a { f = \x -> x }`),
      "plainitems",
      { dispatchInstanceFile: true },
    ).instances ?? [];
    const reg = createRegistry([
      loadFenelModule(src("module plain where", "Plain5a a = Plain5a f: a -> a"), "plain"),
      { name: "plainitems", label: "plainitems", instances: items },
    ]);
    const f = lambdaOf(member(reg, "plainitems", "item"), "f");
    expect(f.__fenelFn).toBe(true);
    expect(f.sourceFunction).toBe(moduleSourceCoordinate("plainitems"));
    expect(apply(f, 3, reg.evaluateContext())).toBe(3);
  });

  test("the F3 case without defineClass: a closure of the declaring bundle, lexically scoped", () => {
    const mapper = loadFenelModule(src("module mapper where", "Mapper5a a = Mapper5a f: a -> List a"), "mapper");
    const callerFunctions = loadFenelModule(src("module caller where", "go : Number -> List Number", "go x = [x]"), "caller");
    const callerInstances = loadFenelModule(
      src("r : Mapper5a Number", String.raw`r = Mapper5a { f = \x -> go x }`),
      "caller",
      { dispatchInstanceFile: true },
    ).instances ?? [];
    const caller: FenelModule = { ...callerFunctions, instances: [...(callerFunctions.instances ?? []), ...callerInstances] };
    const other = loadFenelModule(src("module other where", "go : Number -> List String", 'go x = ["other"]'), "other");
    const reg = createRegistry([mapper, caller, other]);
    const resolved = member(reg, "caller", "r");
    const f = lambdaOf(resolved, "f");
    expect(f.__fenelFn).toBe(true);
    expect(f.sourceFunction).toBe(moduleSourceCoordinate("caller"));
    expect(deepFrozen(resolved)).toBe(true);
    const ctx = reg.evaluateContext();
    expect(apply(f, 3, ctx)).toEqual([3]);
    expect(apply(f, 4, { ...ctx, _importStack: [reg.getModuleImportFrame("other")!] })).toEqual([4]);
  }, 600_000);

  test("a Maybe (arrow) field's Just payload is lowered and bound without defineClass", () => {
    const optFunctions = loadFenelModule(src("module optitems where", "go : Number -> Number", "go x = x"), "optitems");
    const items = loadFenelModule(
      src("opt : Opt5a Number", "opt = Opt5a { g = Just go }"),
      "optitems",
      { dispatchInstanceFile: true },
    ).instances ?? [];
    const reg = createRegistry([
      loadFenelModule(src("module opts where", "Opt5a a = Opt5a g: Maybe (a -> a)"), "opts"),
      { ...optFunctions, instances: [...(optFunctions.instances ?? []), ...items] },
    ]);
    expect(member(reg, "optitems", "opt")).toEqual({
      kind: "instance",
      value: { $tag: "Opt5a", g: { $tag: "Just", _0: { $ref: "optitems:go" } } },
    });
  });
});

// ===========================================================================
// (G) Final review fixes (2026-10-02). Each case was watched failing on the
//     reviewed code before its fix.
// ===========================================================================

describe("(G1) an instance whose constructor is not named like its declared type", () => {
  // `Box5a = MkBox5a String`: the declared type is Box5a, the constructor
  // MkBox5a. The member index proves the owner and reads the fields by the
  // DECLARED type, and answers the authored value (tagged by its constructor).
  const boxType = loadFenelModule(src("module boxtypes where", "Box5a = MkBox5a String"), "boxtypes");
  const boxItems = (...lines: string[]): FenelModule => ({
    name: "boxitems",
    label: "boxitems",
    instances: loadFenelModule(src(...lines), "boxitems", { dispatchInstanceFile: true }).instances ?? [],
  });

  test("bundle.bx is the authored MkBox5a value, and bundle.bx._0 its payload", () => {
    const items = boxItems("bx : Box5a", 'bx = MkBox5a { _0 = "x" }');
    const reg = createRegistry([boxType, items]);
    expect(member(reg, "boxitems", "bx")).toEqual({ kind: "instance", value: { $tag: "MkBox5a", _0: "x" } });
    expect(reg.resolveModuleMemberScheme("boxitems", "bx")).toEqual({ kind: "instance", typeName: "Box5a", args: [] });
    const ctx = reg.evaluateContext();
    expect(evaluate({ var: "boxitems.bx" }, {}, ctx)).toEqual({ $tag: "MkBox5a", _0: "x" });
    expect(evaluate({ var: "boxitems.bx._0" }, {}, ctx)).toBe("x");
  });

  test("the dispatch instance is unchanged: keyed by the constructor head, carrier-free in the pool", () => {
    const [inst] = boxItems("bx : Box5a", 'bx = MkBox5a { _0 = "x" }').instances as Instance[];
    expect({ ...inst }).toEqual({ typeName: "MkBox5a", args: [], methods: { _0: "x" } });
    const dispatch = createDispatchRegistry();
    dispatch.addInstance(inst!);
    const row = dispatch.listInstances().find((candidate) => candidate.typeName === "MkBox5a")!;
    expect(Object.getOwnPropertyDescriptor(row, "declaration")).toBeUndefined();
  });

  test("a case of a variant with several constructors reads that case's fields", () => {
    const reg = createRegistry([
      loadFenelModule(src("module shtypes where", "Sh5a = Circle5a Number | Square5a Number"), "shtypes"),
      boxItems("sq : Sh5a", "sq = Square5a { _0 = 2 }"),
    ]);
    expect(member(reg, "boxitems", "sq")).toEqual({ kind: "instance", value: { $tag: "Square5a", _0: 2 } });
    expect(evaluate({ var: "boxitems.sq._0" }, {}, reg.evaluateContext())).toBe(2);
  });

  test("a constructor the declared type does not have is refused, naming both", () => {
    const reg = createRegistry([boxType, boxItems("by : Box5a", 'by = Other5a { _0 = "x" }')]);
    const resolved = member(reg, "boxitems", "by");
    expect(resolved.kind).toBe("ambiguous");
    const message = (resolved as { message: string }).message;
    expect(message).toContain("boxitems.by");
    expect(message).toContain("Box5a");
    expect(message).toContain("Other5a");
  });
});

describe("(G2) a projected instance method is the same reference as the function itself", () => {
  test("in a locked registry, codec.isoBase64.decode and codec.base64Decode are one handle", () => {
    const reg = createAccountRegistry([...modulesFor("execute")], [], { dispatchRegistry });
    const ctx = reg.evaluateContext();
    const run = (source: string): unknown => evaluate(parse(source), {}, ctx);
    const direct = run("codec.base64Decode") as { $ref: string };
    const projected = run("codec.isoBase64.decode") as { $ref: string };
    // The locked registry hands out the function's opaque identity.
    expect(direct.$ref).toBe(reg.getUuid("codec:base64Decode")!);
    expect(projected).toEqual(direct);
    expect(run("eq codec.isoBase64.decode codec.base64Decode")).toBe(true);
    // The member value itself holds that handle.
    const value = (member(reg, "codec", "isoBase64") as { value: Record<string, unknown> }).value;
    expect(value.decode).toEqual(direct);
    expect(value.encode).toEqual(run("codec.base64Encode"));
    // Calling the projected reference still works.
    expect(run('codec.isoBase64.decode "aGVsbG8="')).toEqual({
      $tag: "Ok",
      _0: new Uint8Array([104, 101, 108, 108, 111]),
    });
  }, 600_000);
});

// ===========================================================================
// (F9) TS fix (2026-10-02, TODO bug 6; reworked after the astra C review,
//      items 3 and 5, 2026-10-03) — a repository dispatch row's lambda method
//      resolves its free names in its DECLARING module, in the frame of the
//      registry that DISPATCHES it. A row registered straight into a shared
//      pool (system-entities: the instance files and the system modules' rows)
//      belongs to no registry module's `instances`, so neither the source-module
//      binder nor the member index bound it: dispatch handed back the raw
//      `{fn}` IR. The pool records the declaring module at registration and
//      keeps the row as registered; each registry binds the row's raw lambda
//      methods lazily, in its OWN frame of that module, memoised per registry
//      and row (`_dispatchInstanceMethods`, the routing table, the TS
//      resolver). The first attempt replaced the shared row with a closure
//      bound in the first registry's frame, so a later registry whose
//      declaring module imports a different `go` dispatched the first one's.
// ===========================================================================

describe("(F9) a repository dispatch row's lambda method is bound per dispatching registry, in its declaring module", () => {
  const mapper = loadFenelModule(src("module mapper where", "Mapper5a a = Mapper5a f: a -> List a"), "mapper");
  const callerFunctions = loadFenelModule(src("module caller where", "go : Number -> List Number", "go x = [x]"), "caller");
  const callerInstances = loadFenelModule(
    src("r : Mapper5a Number", String.raw`r = Mapper5a { f = \x -> go x }`),
    "caller",
    { dispatchInstanceFile: true },
  ).instances ?? [];
  const other = loadFenelModule(src("module other where", "go : Number -> List String", 'go x = ["other"]'), "other");
  // The declaring module `caller` with `go` IMPORTED, from `depA` or `depB`
  // (the import is set on the module value: the import grammar reads
  // uppercase module names only).
  const deps: Record<string, FenelModule> = {
    depA: loadFenelModule(src("module depA where", "go : Number -> List Number", "go x = [111]"), "depA"),
    depB: loadFenelModule(src("module depB where", "go : Number -> List Number", "go x = [222]"), "depB"),
  };
  const callerImporting = (dep: string): FenelModule => ({
    ...loadFenelModule(src("module caller where", "probe : Number -> List Number", "probe x = go x"), "caller"),
    imports: [{ module: dep, names: ["go"] }],
  });
  const defineMapper = (local: ReturnType<typeof createDispatchRegistry>): void => {
    const entity = mapper.entities!.find((e) => e.id === "Mapper5a")!;
    local.defineClass(seedFromType("Mapper5a", entity.type, entity.params![0]!, {
      typeScheme: entity.typeScheme,
      classParams: entity.params!,
    }));
  };
  const pool = () => {
    const local = createDispatchRegistry();
    defineMapper(local);
    for (const inst of callerInstances) local.addInstance(inst, { declaringModule: "caller" });
    return local;
  };
  const viaMethod = (reg: ModuleRegistry, x: number): unknown => evaluate({ method: ["Mapper5a", "f", x] }, {}, reg.evaluateContext());

  test("Mapper5a.f 3 runs the declaring module's go under any import frame; the pool row stays raw; one registry hands out one closure", () => {
    const local = pool();
    const reg = createRegistry([mapper, callerFunctions, other], { dispatchRegistry: local });
    const ctx = reg.evaluateContext();
    expect(evaluate({ method: ["Mapper5a", "f", 3] }, {}, ctx)).toEqual([3]);
    const otherFrame = reg.getModuleImportFrame("other")!;
    expect(otherFrame.names.go).toBe("other:go");
    expect(evaluate({ method: ["Mapper5a", "f", 4] }, {}, { ...ctx, _importStack: [otherFrame] })).toEqual([4]);
    // The shared row is exactly as registered.
    const row = local.listInstances("Mapper5a")[0]!;
    expect(Object.keys(row.methods.f as object)).toEqual(["fn"]);
    // This registry's binding: a closure of the declaring module, the same
    // one on every read.
    const f = ctx._dispatchInstanceMethods!(row)!.f as Record<string, unknown>;
    expect(f.__fenelFn).toBe(true);
    expect(f.sourceFunction).toBe(moduleSourceCoordinate("caller"));
    expect(reg.evaluateContext()._dispatchInstanceMethods!(row)!.f).toBe(f);
  }, 600_000);

  test("two registries over one pool, whose `caller` imports `go` from different modules, each dispatch their own, in either build order", () => {
    for (const order of [["depA", "depB"], ["depB", "depA"]] as const) {
      const local = pool();
      const built = order.map((dep) => ({
        dep,
        reg: createRegistry([mapper, deps[dep]!, callerImporting(dep)], { dispatchRegistry: local }),
      }));
      for (const { dep, reg } of built) {
        const expected = dep === "depA" ? [111] : [222];
        // The declaring module's own function, called directly, and the row's
        // lambda method: one frame.
        expect({ order, dep, direct: evaluate({ call: ["caller:probe", 1] }, {}, reg.evaluateContext()) })
          .toEqual({ order, dep, direct: expected });
        expect({ order, dep, method: viaMethod(reg, 1) }).toEqual({ order, dep, method: expected });
      }
    }
  }, 600_000);

  test("a partial (bootstrap) profile built and dispatched first never decides what a complete registry dispatches", () => {
    const local = pool();
    const partial = createEngineBootstrapRegistry([mapper, deps.depA!, callerImporting("depA")], { dispatchRegistry: local });
    expect(viaMethod(partial, 1)).toEqual([111]);
    const complete = createRegistry([mapper, deps.depB!, callerImporting("depB")], { dispatchRegistry: local });
    expect(viaMethod(complete, 1)).toEqual([222]);
    // And the partial profile still dispatches its own.
    expect(viaMethod(partial, 1)).toEqual([111]);
  }, 600_000);

  test("a private pool that copies the repository row before any build binds its copy too", () => {
    // A source module's private pool copies the repository rows (the row
    // objects themselves); the declaring module travels with the row.
    const local = sourceModuleDispatchRegistry([], pool());
    const reg = createRegistry([mapper, callerFunctions, other], { dispatchRegistry: local });
    expect(evaluate({ method: ["Mapper5a", "f", 5] }, {}, reg.evaluateContext())).toEqual([5]);
  }, 600_000);

  test("the pure evaluation context (the door type refinements run through) dispatches the same binding", () => {
    // `pureEvaluateContext` rebuilds a context slot by slot: the registry's
    // binding of repository rows must ride through it, or a refinement
    // predicate applying `Mapper5a.f` gets the raw lambda IR back as a value.
    const local = pool();
    const reg = createRegistry([mapper, callerFunctions, other], { dispatchRegistry: local });
    expect(evaluate({ method: ["Mapper5a", "f", 6] }, {}, pureEvaluateContext(reg.evaluateContext()))).toEqual([6]);
  }, 600_000);

  test("a row copied into a pool that knows its class keeps its declaring module through the registration copy (astra C review item 5)", () => {
    // `g = Just go` under a `Maybe (arrow)` field: registration in a pool that
    // knows the class lowers it, storing a COPY of the supplied row.
    const pair = loadFenelModule(src("module pair where", "Pair5a a = Pair5a f: (a -> List a) g: (Maybe (a -> List a))"), "pair");
    const pairInstances = loadFenelModule(
      src("p : Pair5a Number", String.raw`p = Pair5a { f = \x -> go x, g = Just go }`),
      "caller",
      { dispatchInstanceFile: true },
    ).instances ?? [];
    // Registered first where the class is unknown (nothing lowered) ...
    const source = createDispatchRegistry();
    for (const inst of pairInstances) source.addInstance(inst, { declaringModule: "caller" });
    // ... then copied, with no explicit evidence, into a pool that knows it.
    const receiving = createDispatchRegistry();
    const entity = pair.entities!.find((e) => e.id === "Pair5a")!;
    receiving.defineClass(seedFromType("Pair5a", entity.type, entity.params![0]!, {
      typeScheme: entity.typeScheme,
      classParams: entity.params!,
    }));
    const supplied = source.listInstances("Pair5a")[0]!;
    receiving.addInstance(supplied);
    const stored = receiving.listInstances("Pair5a")[0]!;
    expect(stored).not.toBe(supplied);
    expect(stored.methods.g).toEqual({ $tag: "Just", _0: { $ref: "go" } });
    const reg = createRegistry([pair, callerFunctions], { dispatchRegistry: receiving });
    expect(evaluate({ method: ["Pair5a", "f", 3] }, {}, reg.evaluateContext())).toEqual([3]);
  }, 600_000);

  test("Truthy.truthy True in the system registry is true", () => {
    const ctx = getSystemRegistry().evaluateContext();
    expect(evaluate({ method: ["Truthy", "truthy", true] }, {}, ctx)).toBe(true);
  }, 600_000);

  // TS fix re-review (2026-10-03, astra C2 item 3) — every EXECUTABLE dictionary
  // projection serves the registry's binding: the nominal `resolveEffect` (the
  // effect call sites, the native-act override), and the dispatch natives'
  // published dictionaries (`lookup`, `lookupOne`, `lookupAll`). Each handed
  // back the raw `{fn}` IR.
  test("resolveEffect and the dispatch natives return the row's methods bound in its declaring module", () => {
    const local = pool();
    const reg = createRegistry([mapper, callerFunctions, other], { dispatchRegistry: local });
    const ctx = reg.evaluateContext();
    const bound = (via: string, method: unknown): void => {
      expect({ via, closure: (method as { __fenelFn?: unknown } | undefined)?.__fenelFn }).toEqual({ via, closure: true });
      expect({ via, source: (method as { sourceFunction?: unknown }).sourceFunction }).toEqual({ via, source: moduleSourceCoordinate("caller") });
      expect({ via, applied: invokeCallable(method, [7], ctx) }).toEqual({ via, applied: [7] });
    };
    bound("resolveEffect", resolveEffect(ctx, local, "Mapper5a", "Number")?.methods.f);
    const natives = dispatchNativesCtx as unknown as Record<string, (c: EvaluateContext, ...args: unknown[]) => unknown>;
    bound("lookup", (natives.lookup!(ctx, "Mapper5a", "Number") as { value: Record<string, unknown> }).value.f);
    bound("lookupOne", (natives.lookupOne!(ctx, "Mapper5a", "Number") as { _0: Record<string, unknown> })._0.f);
    bound("lookupAll", (natives.lookupAll!(ctx, "Mapper5a", "Number") as Array<Record<string, unknown>>)[0]?.f);
    // The shared row is untouched.
    expect(Object.keys(local.listInstances("Mapper5a")[0]!.methods.f as object)).toEqual(["fn"]);
  }, 600_000);

  // TS fix re-review (2026-10-03, astra C2 item 3) — STRUCTURAL selection. A
  // `ByPattern` rule registered with its declaring module, whose method is a
  // raw lambda (the review's `get = \x -> go x`), came back raw: structural
  // selection built a fresh source row with no declaring module, so the
  // registry's binding could not find it. The selection now keeps the rule's
  // own row (the matcher hands back the rule's INDEX), and `resolveEffect`
  // projects the row's dictionary through the registry's binding.
  //
  // The `.fenel` matcher is STUBBED with its contract (`Just` of the chosen
  // rule's `methods` payload): on this branch the structural predicates and
  // the matcher evaluate to null before any change (kind-bypattern 12/15 and
  // structural-dispatch 12/25 fail at the base, stale compiled artifacts), so
  // the TS seam is what this pins.
  test("a ByPattern rule's lambda method is served bound in its declaring module, by resolveEffect and by dispatch", () => {
    const local = pool();
    local.addInstance(
      {
        typeName: "Mapper5a",
        args: [{ $pattern: "engine:isUnaryConstructor" } as never],
        methods: { f: { fn: ["x", { call: ["go", { var: "x" }] }] } },
      },
      { declaringModule: "caller" },
    );
    const reg = createRegistry([mapper, callerFunctions, other], { dispatchRegistry: local });
    const base = reg.evaluateContext();
    const matcherCalls: unknown[] = [];
    const ctx: EvaluateContext = {
      ...base,
      natives: {
        ...base.natives,
        "engine:matchStructural": (rules: unknown) => {
          matcherCalls.push(rules);
          const first = (rules as Array<{ methods: unknown }>)[0];
          return first === undefined ? { $tag: "Nothing" } : { $tag: "Just", _0: first.methods };
        },
      },
    };
    const resolved = resolveEffect(ctx, local, "Mapper5a", { $tag: "ByType", target: "List" });
    expect(matcherCalls.length).toBe(1);
    const f = resolved?.methods.f as { __fenelFn?: unknown; sourceFunction?: unknown } | undefined;
    expect(f?.__fenelFn).toBe(true);
    expect(f?.sourceFunction).toBe(moduleSourceCoordinate("caller"));
    expect(invokeCallable(f, [7], ctx)).toEqual([7]);
    // The selection's source is the rule's own row, which stays as registered.
    expect((resolved?.source.kind === "instance" ? resolved.source.instance.args[0] : undefined) as unknown)
      .toEqual({ $pattern: "engine:isUnaryConstructor" });
    const row = local.listInstances("Mapper5a").find((candidate) => typeof candidate.args[0] !== "string")!;
    expect(Object.keys(row.methods.f as object)).toEqual(["fn"]);
    // Dispatch (`Mapper5a.f [5]`, the reflected key `List`) applies the bound method.
    expect(evaluate({ method: ["Mapper5a", "f", [5]] }, {}, ctx)).toEqual([[5]]);
  }, 600_000);
});