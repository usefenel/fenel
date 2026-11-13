// Phase 7g-parser-prep — the type-position `{$ref}` CONSUMER folds.
//
// 7b–7f taught the runtime / validation / set-algebra-with-resolver consumers
// to fold a type-position `{$ref}` ≡ `{$ref}`. They did NOT reach three other
// consumer classes that read a type-name in type position:
//
//   1. the FOUNDATION substituter  — `substituteTypeVars` (drives Maybe/Result/
//      List/Verified/Either over the parsed templates),
//   2. the LOADER name-extractors  — `normalizeSpecArg` / `matchTypeApplication`
//      (derive dispatch-instance keys from a `.fenel` instance sig),
//   3. the DISPATCH-DERIVATION readers — `isParamRef` / `normalizeClassParam`
//      (find the class type-parameter so `dispatchPositionForSeed` works), and
//   4. the NO-RESOLVER set-algebra recognizers — `peel*` / `isSubtype` (which
//      fell back to `{$void}` instead of the `{$ref}` name-equality leaf).
//
// The 7g-parser producer flip emits a user-written type-name as `{$ref}`, so
// EVERY one of these must fold it. This file pins each fold by INJECTING a
// type-position `{$ref}` synthetically (the producer is still `{$ref}` at this
// phase — these tests are the witnesses the folds are real BEFORE the flip can
// exercise them, exactly the 7b–7f additive-test discipline). Each assertion
// shows `{$ref:H}` behaves byte-identically to `{$ref:H}`.

import { describe, it, expect } from "bun:test";
import {
  Ref,
  substituteTypeVars,
  List,
  Maybe,
  Char,
  Nat,
  Bool,
} from "./type-foundation";
import { peelList, peelMaybe, peelToVariant, isSubtype } from "./set-algebra";
import {
  seedFromType,
  dispatchPositionForSeed,
  normalizeClassParam,
  supersOf,
  RETURN_POSITION,
} from "./effect-dispatch";
import { deriveTypedValueDecl, loadFenelModule, matchTypeApplication, normalizeSpecArg } from "./fenel-module";
import { carryInstanceProvenance, createDispatchRegistry, declaringModuleOfInstance, GLOBAL_ONLY, withoutInstanceDeclaration } from "./dispatch-registry";
import type { FenelType } from "./types";

// `{$ref}` is not (yet) a `FenelType`-union member (that broad change is
// 7g-retire), so a type-position ref is cast at the boundary — exactly the
// production-code pattern (`isRef(t)` + cast in set-algebra / validate). `refT`
// makes a code-name ref usable wherever a `FenelType` is expected.
const refT = (handle: string): FenelType => Ref(handle) as unknown as FenelType;

const arrow = (param: FenelType, returns: FenelType): FenelType =>
  ({ $arrow: { params: [{ name: "_0", type: param }], returns } } as FenelType);

describe("source-backed instance projection", () => {
  it("uses the same matcher/defaults and live owned pool through both identity carriers", () => {
    const source = createDispatchRegistry();
    source.defineClass({ name: "ProjectionProbe", params: [{ name: "a" }], methods: [
      { name: "label", params: [], returns: refT("String"), body: "default" },
    ] });
    const owner = "projection-reader";
    const visibility = { kind: "frame" as const, account: owner, tags: [] };
    const canonical = "88e5d5f4-6c81-452f-96e3-b66d5acb7140";
    const projected = createDispatchRegistry({ source,
      projectTarget: target => target === "probe:fn" ? canonical : target,
      projectInstance: row => row.args[0] === "probe:fn" ? { ...row, args: [canonical] } : row,
    });
    projected.addInstance({ typeName: "ProjectionProbe", args: ["probe:fn"], methods: {}, scope: { kind: "account", accountId: owner } });
    expect(projected.resolve("probe:fn", "ProjectionProbe", visibility)?.label).toBe("default");
    expect(projected.resolve(canonical, "ProjectionProbe", visibility)?.label).toBe("default");
    expect(projected.resolve(canonical, "ProjectionProbe", GLOBAL_ONLY)).toBeUndefined();
    expect(source.listInstances()[0]!.args).toEqual(["probe:fn"]);
    const version = projected.version();
    projected.removeInstance("ProjectionProbe", canonical, owner);
    expect(projected.version()).toBeGreaterThan(version);
    expect(source.listInstances()).toHaveLength(0);
  });

  it("rejects malformed private evidence at registration without reading getters", () => {
    const source = createDispatchRegistry();
    let reads = 0;
    const evidence = ["probe.fn"];
    Object.defineProperty(evidence, "0", { get() { reads++; return "probe.fn"; } });
    const row = { typeName: "ProjectionProbe", args: ["probe.fn"], methods: {} };
    Object.defineProperty(row, "sourceArgumentReferences", { value: evidence });
    expect(() => source.addInstance(row)).toThrow("own string references");
    expect(reads).toBe(0);
    expect(source.listInstances()).toHaveLength(0);
  });
});

describe("source binding — substituteTypeVars respects the $var/$ref boundary", () => {
  it("substitutes `{$var:a}` and leaves nominal `{$ref:a}` untouched", () => {
    const tmplVar: FenelType = {
      $record: { fields: [{ name: "x", type: { $var: "a" } }] },
    } as FenelType;
    const tmplRef: FenelType = {
      $record: { fields: [{ name: "x", type: { $ref: "a" } }] },
    } as FenelType;
    const sub = { a: Char };
    const out = substituteTypeVars(tmplVar, sub) as {
      $record: { fields: { type: FenelType }[] };
    };
    expect(out.$record.fields[0]!.type).toEqual(Char);
    expect(substituteTypeVars(tmplRef, sub)).toEqual(tmplRef);
  });

  it("a non-bound `{$ref:String}` passes through unchanged (only the $var is replaced)", () => {
    const tmpl: FenelType = {
      $record: {
        fields: [
          { name: "x", type: { $var: "a" } },
          { name: "y", type: refT("String") },
        ],
      },
    } as FenelType;
    const out = substituteTypeVars(tmpl, { a: Nat }) as {
      $record: { fields: { type: FenelType }[] };
    };
    expect(out.$record.fields[0]!.type).toEqual(Nat);
    expect(out.$record.fields[1]!.type).toEqual(refT("String")); // untouched
  });

  it("the public Maybe()/List() helpers stay correct (templates carry the bound param)", () => {
    // These run substituteTypeVars over the parsed foundation templates; the
    // fold substitutes the authoritative `{$var:a}` emitted by source binding.
    expect(Maybe(Char)).toEqual(Maybe(Char));
    const lc = List(Char) as { $opaque: { pure: FenelType } };
    expect(lc.$opaque).toBeDefined();
  });
});

describe("7g-parser-prep — loader name-extractors fold a type-position {$ref}", () => {
  it("normalizeSpecArg collapses `{$ref:X}` to the bare string, like `{$ref:X}`", () => {
    expect(normalizeSpecArg(Ref("String"))).toBe("String");
    expect(normalizeSpecArg(Ref("String"))).toBe(
      normalizeSpecArg({ $ref: "String" }) as string,
    );
    // a `{$var}` / `{$el}` arg still passes through untouched
    expect(normalizeSpecArg({ $var: "a" })).toEqual({ $var: "a" });
  });

  it("matchTypeApplication reads a `{$ref}` nullary head + folds `{$ref}` args", () => {
    // nullary: `Foo` → `{$ref:"Foo"}` (was `{$ref:"Foo"}`)
    expect(matchTypeApplication(Ref("Foo"))).toEqual({
      typeName: "Foo",
      args: [],
    });
    // applied: `Iso String Bytes` → `{$el:{call:["Iso", {$ref}, {$ref}]}}`; the
    // dispatch-instance key the codec/aggregable lookups compare must be the
    // bare-string args `["String","Bytes"]`.
    expect(
      matchTypeApplication({ $el: { call: ["Iso", Ref("String"), Ref("Bytes")] } }),
    ).toEqual({ typeName: "Iso", args: ["String", "Bytes"] });
  });
});

describe("source argument reference provenance", () => {
  it("marks emitted function facets with their definition ids while type facets retain nominal targets", () => {
    const module = loadFenelModule(`module probe where
@label "Body function"
bodyFunction : String -> String
bodyFunction value = value
@native
@label "Native function"
nativeFunction : String -> String
@entity
@label "Nominal type"
NominalType = NominalType content: String
`, "probe");
    for (const fn of module.functions!) {
      const facets = module.instances!.filter(instance => instance.args[0] === fn.id);
      expect(facets.length).toBeGreaterThan(0);
      for (const facet of facets) {
        expect(facet.sourceArgumentFunctionIds).toEqual([fn.id]);
        expect(facet.sourceArgumentReferences).toBeUndefined();
        expect(Object.isFrozen(facet.sourceArgumentFunctionIds)).toBe(true);
        expect(Object.keys(facet)).not.toContain("sourceArgumentFunctionIds");
        const copy = { ...facet };
        carryInstanceProvenance(facet, copy);
        expect(copy.sourceArgumentFunctionIds).toBe(facet.sourceArgumentFunctionIds);
      }
    }
    const typeFacets = module.instances!.filter(instance => instance.args[0] === "NominalType");
    expect(typeFacets.length).toBeGreaterThan(0);
    expect(typeFacets.every(instance => instance.sourceArgumentFunctionIds === undefined)).toBe(true);
  });

  it("retains the difference between a written function reference and the same literal string", () => {
    const module = loadFenelModule(`module probe where
_ : Iconable std.join
_ = Iconable { icon = "link" }
_ : Iconable "std.join"
_ = Iconable { icon = "link" }
`, "probe");
    const [reference, literal] = module.instances!;
    expect(reference!.args).toEqual(["std.join"]);
    expect(literal!.args).toEqual(reference!.args);
    expect(reference!.sourceArgumentReferences).toEqual(["std.join"]);
    expect(literal!.sourceArgumentReferences).toEqual([undefined]);
    expect(Object.isFrozen(reference!.sourceArgumentReferences)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(reference!, "sourceArgumentReferences")?.enumerable).toBe(false);
    expect(JSON.stringify(reference)).toBe(JSON.stringify(literal));
    expect(module.functions).toEqual([]);
  });

  it("does not give reference roles to literal generic or structural argument data", () => {
    const args = [Ref("std.join"), "std.join", { $var: "a" }, { $el: { call: ["List", Ref("String")] } }, { $pattern: "stored" }];
    const value = deriveTypedValueDecl({ $el: { call: ["Probe", ...args] } },
      { construct: ["Probe", { content: "held data" }] }, undefined, false)!;
    expect(value.inst.args as unknown).toEqual(["std.join", ...args.slice(1)]);
    expect(value.inst.sourceArgumentReferences).toEqual(["std.join", undefined, undefined, undefined, undefined]);
    expect(Object.keys(value.inst)).not.toContain("sourceArgumentReferences");
  });

  it("keeps source ownership and hidden argument evidence through declaration stripping and row copies", () => {
    const module = loadFenelModule(`module probe where
held : Iconable std.join
held = Iconable { icon = "link" }
`, "probe", { dispatchInstanceFile: true });
    const source = module.instances![0]!;
    const stripped = withoutInstanceDeclaration(source);
    expect(stripped.declaration).toBeUndefined();
    expect(stripped.sourceArgumentReferences).toBe(source.sourceArgumentReferences);
    const pool = createDispatchRegistry();
    pool.addInstance(stripped, { declaringModule: "probe" });
    const stored = pool.listInstances()[0]!;
    const copy = { ...stored, args: ["resolved-function-identity"] };
    carryInstanceProvenance(stored, copy);
    expect(copy.sourceArgumentReferences).toBe(source.sourceArgumentReferences);
    expect(declaringModuleOfInstance(copy)).toBe("probe");
    expect(Object.keys(copy)).not.toContain("sourceArgumentReferences");
  });
});

describe("7g-parser-prep — dispatch-derivation folds a type-position {$ref}", () => {
  it("normalizeClassParam rewrites a bare `{$ref:param}` leaf to `{$var:param}`", () => {
    expect(normalizeClassParam(refT("a"), "a")).toEqual({ $var: "a" });
    // a non-param ref is left untouched (it is NOT the dispatch var)
    expect(normalizeClassParam(refT("String"), "a")).toEqual(refT("String"));
  });

  it("dispatchPositionForSeed finds the arg position when the param is `{$ref}`", () => {
    // class `C a` with method `m : a -> a -> Bool` — param at arg position 0.
    const classTypeRef: FenelType = {
      $record: {
        fields: [{ name: "m", type: arrow(refT("a"), arrow(refT("a"), Bool)) }],
      },
    } as FenelType;
    const classTypeNamed: FenelType = {
      $record: {
        fields: [
          { name: "m", type: arrow({ $ref: "a" }, arrow({ $ref: "a" }, Bool)) },
        ],
      },
    } as FenelType;
    const posRef = dispatchPositionForSeed(
      seedFromType("C", classTypeRef, "a"),
      "m",
    );
    const posNamed = dispatchPositionForSeed(
      seedFromType("C", classTypeNamed, "a"),
      "m",
    );
    expect(posRef).toBe(0);
    expect(posRef).toBe(posNamed);
  });

  it("a return-positioned param still derives RETURN_POSITION with `{$ref}`", () => {
    // class `C a` with method `mk : Bool -> a` — param only in the RETURN.
    const classType: FenelType = {
      $record: { fields: [{ name: "mk", type: arrow(Bool, refT("a")) }] },
    } as FenelType;
    expect(
      dispatchPositionForSeed(seedFromType("C", classType, "a"), "mk"),
    ).toBe(RETURN_POSITION);
  });

  it("supersOf reads a super-constraint whose param arg is `{$ref}` (isParamRef fold)", () => {
    // `HasHTTP a` carries a super field `net : HasNetwork a` — the parser emits
    // the `a` arg as `{$ref:"a"}`. supersOf must still detect the super.
    const isRegisteredClass = (n: string) => n === "HasNetwork";
    const classType: FenelType = {
      $record: {
        fields: [
          { name: "net", type: { $el: { call: ["HasNetwork", Ref("a")] } } },
          { name: "request", type: arrow(refT("a"), Bool) },
        ],
      },
    } as FenelType;
    const supers = supersOf(classType, "a", isRegisteredClass);
    expect(supers.length).toBe(1);
    expect((supers[0] as { class: { entityId: string } }).class.entityId).toBe(
      "HasNetwork",
    );
    // arg normalized to `{$var:"a"}` (byte-identical to the `{$ref}` source)
    expect((supers[0] as { args: unknown[] }).args).toEqual([{ $var: "a" }]);
  });
});

describe("7g-parser-prep — no-resolver set-algebra recognizers fold a type-position {$ref}", () => {
  it("isSubtype equates `Ref(\"Char\")` with Char by name (no resolver)", () => {
    // The parser emits `Str.pure`'s `Cons.head` as `{$ref:"Char"}`; without a
    // resolver it must still match opaque `Char` — `{$ref:H}` ≡ `{$ref:H}`.
    expect(isSubtype(refT("Char"), Char)).toBe(true);
    expect(isSubtype(Char, refT("Char"))).toBe(true);
    expect(isSubtype(refT("Char"), Char)).toBe(
      isSubtype({ $ref: "Char" } as FenelType, Char),
    );
  });

  it("ref↔ref handle-equality holds without a resolver", () => {
    expect(isSubtype(refT("Char"), refT("Char"))).toBe(true);
  });

  it("a nested List `Ref(\"Char\")` abstains without validation-source context", () => {
    // type-substrate P1(a.6): a nested named Char can be rebound through
    // validation sources, so the exact List classifier must not equate it with
    // inline opaque Char. Direct top-level name equality above stays distinct.
    const listOfRefChar: FenelType = {
      $opaque: {
        name: "List",
        pure: {
          $variant: {
            cases: [
              { name: "Nil" },
              {
                name: "Cons",
                fields: [
                  { name: "head", type: refT("Char") },
                  { name: "tail", type: { $ref: "List" } },
                ],
              },
            ],
          },
        },
      },
    } as FenelType;
    expect(isSubtype(listOfRefChar, List(Char))).toBe(false);
  });

  it("an unresolvable `{$ref}` stays conservative (graceful, like an unknown name)", () => {
    // peelMaybe on a ref to a non-Maybe / unknown name → null (today's unknown),
    // never a throw; identical to `{$ref}` of an unknown name.
    expect(peelMaybe(refT("NopeNotAType"))).toBeNull();
    expect(peelList(refT("NopeNotAType"))).toBeNull();
    expect(peelToVariant(refT("NopeNotAType"))).toBeNull();
    // and an unresolvable ref is NOT accepted as a subtype of an arbitrary type
    expect(isSubtype(refT("NopeNotAType"), Bool)).toBe(false);
  });
});
