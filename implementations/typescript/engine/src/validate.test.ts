// ---------------------------------------------------------------------------
// validate(type, value, opts) — the universal validation entry point.
//
// Covers the bare-FenelType API: scalars, refinements, dependent types via
// the unified `$el` substrate, record / non-record top-level, and
// strict-mode flags. `validateForm` is now a thin wrapper around this —
// see validateForm-specific tests in `where-functions.test.ts` for that path.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { FenelType, FenelFunction, FieldKey } from "./types";
import { validate } from "./validate";
import { List, Maybe, Just, Nothing } from "./type-foundation";
import { Vec, LengthBoundedString } from "./dependent-types";
import { dispatchedNamedContains, marshalTraversalType } from "./engine-bodies-dispatch";

const namedKey = (ref: string): FieldKey => ({
  $tag: "NamedField",
  ref: { $ref: ref },
});

describe("validate() — scalar (non-record) types", () => {
  it("validates a Number against an interval refinement", () => {
    const PositiveNumber: FenelType = {
      $refined: {
        base: { $ref: "Number" },
        set: { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: false }), hi: Nothing } },
      },
    };
    const ok = validate(PositiveNumber, 7, null);
    expect(ok.valid).toBe(true);
    expect(ok.errors).toEqual([]);

    const bad = validate(PositiveNumber, -3, null);
    expect(bad.valid).toBe(false);
    expect(bad.errors.length).toBeGreaterThan(0);
  }, 600_000);

  it("validates a String against an enum refinement", () => {
    const Currency: FenelType = {
      $refined: {
        base: { $ref: "String" },
        set: { $tag: "SeEnum", values: ["USD", "EUR", "GBP"] },
      },
    };
    expect(validate(Currency, "EUR", null).valid).toBe(true);
    expect(validate(Currency, "JPY", null).valid).toBe(false);
  });

  it("lets Fenel conservatively reject an undecidable refinement membership", () => {
    const UnknownNamedSet: FenelType = {
      $refined: {
        base: { $ref: "String" },
        set: { $tag: "SeRef", handle: "validation:test:unknown-membership" },
      },
    };

    let result: ReturnType<typeof validate> | undefined;
    expect(() => {
      result = validate(UnknownNamedSet, "value", null);
    }).not.toThrow();
    expect(result?.valid).toBe(false);
    expect(result?.errors).toHaveLength(1);
  });

  it("rejects a non-number value passed against $ref: Number", () => {
    const result = validate({ $ref: "Number" }, "not-a-number", null);
    expect(result.valid).toBe(false);
  });
});

describe("validate() — dependent types via the unified $el substrate", () => {
  // array-substrate Phase 1a.5 — `Vec` / `LengthBoundedString` are the canonical
  // `Vec n a = $map (Fin n) a` (retired from `$refined List (length==n)`). Phase
  // 1b deliverable 0 — the `$map` value-membership floor — RECOVERS the runtime
  // length/element validation 1a.5 deferred: a finite-Fin-keyed `$map` now has a
  // real `typeToSetExpr` membership predicate (length==n ∧ every element ∈
  // ⟦values⟧), and `validate()`'s `$map` arm routes it through `containsType`. So
  // `validate(Vec n a, array)` is a TOTAL-array conformance check again.
  it("Vec(Number, 3) is the `$map (Fin 3) Number` shape (redirect)", () => {
    const Vec3 = Vec({ $ref: "Number" }, 3);
    expect("$map" in Vec3).toBe(true);
    if ("$map" in Vec3) expect(Vec3.$map.values).toEqual({ $ref: "Number" });
  });

  it("LengthBoundedString(6) is the `$map (Fin 6) Char` shape (String = List Char)", () => {
    const Code6 = LengthBoundedString(6);
    expect("$map" in Code6).toBe(true);
    if ("$map" in Code6) expect(Code6.$map.values).toEqual({ $ref: "Char" });
  });

  it("validate() over a `Vec` array value ENFORCES length + element membership (the 1a.5 deferral CLOSED)", () => {
    // Phase 1b deliverable 0 — the `$map` value-membership floor. `validate()`'s
    // `$map` arm now routes a finite-Fin-keyed map through the Fenel-decided
    // membership (`containsType` = contains ∘ typeToSetExpr): an array of length
    // n with conforming elements is ACCEPTED; wrong length / wrong element kind
    // is REJECTED. The runtime length/element validation 1a.5 deferred is back.
    const Vec3 = Vec({ $ref: "Number" }, 3);
    expect(validate(Vec3, [1, 2, 3], null).valid).toBe(true); // length 3, all numbers
    expect(validate(Vec3, [1, 2], null).valid).toBe(false); // wrong length — REJECTED
    expect(validate(Vec3, ["a", "b", "c"], null).valid).toBe(false); // wrong element kind
    const Vec3s = Vec({ $ref: "String" }, 3);
    expect(validate(Vec3s, ["a", "b", "c"], null).valid).toBe(true); // length 3, all strings
  });

  it("late-bound Vec({var: 'n'}) inside a record stays `$el`-wrapped (preserved)", () => {
    // type Frame = { n: Number, items: Vec(Number, n) } — the late-bound `$el`
    // path is preserved (the runtime resolves `n`, then `vecOfLength` emits the
    // `$map` form). The per-field conformance check is the Phase-1b/4 tail above.
    const itemsType = Vec({ $ref: "Number" }, { var: "n" });
    expect("$el" in itemsType).toBe(true);
    const Frame: FenelType = {
      $record: {
        fields: [
          { key: namedKey("11111111-1111-4111-8111-111111111111"), name: "n", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing },
          { key: namedKey("22222222-2222-4222-8222-222222222222"), name: "items", label: Nothing, type: itemsType, meta: {}, ui: Nothing },
        ],
      },
    };
    expect("$record" in Frame).toBe(true);
  });
});

describe("validate() — $record top-level", () => {
  const PersonType: FenelType = {
    $record: {
      fields: [
        { key: namedKey("33333333-3333-4333-8333-333333333333"), name: "name", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
        { key: namedKey("44444444-4444-4444-8444-444444444444"), name: "age", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing },
      ],
    },
  };

  it("walks fields and reports per-field errors", () => {
    const result = validate(PersonType, { name: "Ada", age: 36 }, null);
    expect(result.valid).toBe(true);
    expect(result.data).toEqual({ name: "Ada", age: 36 });
  });

  it("rejectAdded flags unknown keys", () => {
    const result = validate(PersonType, { name: "Ada", age: 36, secret: "x" }, null, {
      strict: { rejectAdded: true },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "secret")).toBe(true);
  });

  it("rejectOmitted flags missing fields", () => {
    const result = validate(PersonType, { name: "Ada" }, null, {
      strict: { rejectOmitted: true },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "age")).toBe(true);
  });
});

describe("validate() — opts.functions threads to $where in scalar refinement", () => {
  // A scalar (non-record) $refined Number whose predicate calls a registry
  // function. Exercises validate()'s direct dispatch path (not via record
  // walking) with the function registry option.
  const isPositive: FenelFunction = {
    id: "test:isPositive",
    params: [{ key: namedKey("55555555-5555-4555-8555-555555555555"), name: "n", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing }],
    returns: { $ref: "Boolean" },
    body: { ">": [{ var: "n" }, 0] },
  };
  const ctx = { getFunction: (n: string) => (n === "isPositive" ? isPositive : undefined) };
  const PositiveNumber: FenelType = {
    $refined: {
      base: { $ref: "Number" },
      set: { $tag: "SeWhere", pred: { call: ["isPositive", { var: "value" }] } },
    },
  };

  it("accepts when the function approves", () => {
    expect(validate(PositiveNumber, 7, null, { functions: ctx }).valid).toBe(true);
  });
  it("rejects when the function disapproves", () => {
    expect(validate(PositiveNumber, -3, null, { functions: ctx }).valid).toBe(false);
  });
});

describe("validate() — hostile named $defs", () => {
  it("treats inherited Object prototype names as missing definitions", () => {
    for (const name of ["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty"]) {
      const result = validate({ $ref: name }, null, null, { $defs: {} });
      expect(result.valid).toBe(false);
      expect(result.errors.some((error) => String(error.message).includes("Unknown"))).toBe(true);
      expect(dispatchedNamedContains(name, null, null)).toEqual(Nothing);
    }
  }, 600_000);

  it("resolves own hostile definition names", () => {
    const defs = Object.fromEntries([
      ["constructor", { $ref: "String" } as FenelType],
      ["__proto__", { $ref: "Number" } as FenelType],
    ]);
    expect(Object.prototype.hasOwnProperty.call(defs, "__proto__")).toBe(true);
    expect(validate({ $ref: "constructor" }, "value", null, { $defs: defs }).valid).toBe(true);
    expect(validate({ $ref: "__proto__" }, 7, null, { $defs: defs }).valid).toBe(true);
  });

  it("lets Fenel choose definitions before function/catalog candidates", () => {
    const candidate: FenelFunction = {
      id: "Clash",
      params: [],
      returns: { $ref: "String" },
      body: "function candidate",
    };
    const result = validate({ $ref: "Clash" }, "not-a-number", null, {
      $defs: { Clash: { $ref: "Number" } },
      functions: { getFunction: (name) => name === "Clash" ? candidate : undefined },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.message === "Must be a number")).toBe(true);
  });

  it("cuts mutually recursive named definitions without host recursion", () => {
    const defs: Record<string, FenelType> = {
      A: { $ref: "B" },
      B: { $ref: "A" },
    };
    expect(() => validate({ $ref: "A" }, "cycle", null, { $defs: defs })).not.toThrow();
    expect(validate({ $ref: "A" }, "cycle", null, { $defs: defs }).valid).toBe(true);
  });
});

describe("validate() — shared TraversalType barrier remains policy-neutral", () => {
  it("exposes canonical Maybe/List structure without validation-specific tags", () => {
    const maybe = marshalTraversalType(Maybe({ $ref: "Number" })) as { $tag: string };
    const list = marshalTraversalType(List({ $ref: "Number" })) as { $tag: string };
    expect(maybe.$tag).toBe("TtVariant");
    expect(list.$tag).toBe("TtOpaque");
    expect(maybe.$tag).not.toBe("VtMaybe");
    expect(list.$tag).not.toBe("VtList");
    expect(validate(Maybe({ $ref: "Number" }), null, null).valid).toBe(true);
    expect(validate(List({ $ref: "Number" }), [1, 2, 3], null).valid).toBe(true);
    expect(validate(List({ $ref: "Number" }), [1, "x", 3], null).valid).toBe(false);
  });
});

// Regression: `$ref` references to registered entities (module or
// system) used to fall through the atomic-type switch and produce
// "Unknown field type". Now they resolve through the type catalog
// and recurse on the entity's underlying type, so any field typed by
// a registered entity ref validates against the real shape.
describe("validate() — `$ref` resolves registered entity refs", () => {
  it("resolves a module-registered entity (CollectorEntry) referenced inside a list", () => {
    // Mirrors the runTelegramCollector failure mode: a Bot's
    // `collectorConfig` is typed `Maybe(List({$ref: "CollectorEntry"}))`
    // and CollectorEntry is a telegramModule entity, not a systemEntity.
    // Before the catalog-lookup fallback, this list-elem validation hit
    // "Unknown field type" — even though the entity is fully registered.
    const CollectorEntries: FenelType = List({ $ref: "CollectorEntry" });
    // A minimally well-formed entry: every required scalar present, every
    // Maybe-typed function field set to Nothing.
    const entry = {
      typeId: "Profile",
      label: "Pick a profile",
      startFn: { $tag: "Nothing" },
      completionFn: { $tag: "Nothing" },
      onFieldFn: { $tag: "Nothing" },
    };
    const result = validate(CollectorEntries, [entry], null);
    // No "Unknown field type" anywhere — proves the catalog resolution
    // path engaged. Substantive validation of individual sub-fields is
    // outside this regression's scope.
    expect(
      result.errors.find((e) => e.message === "Unknown field type"),
    ).toBeUndefined();
  });
});

describe("validate() — Phase 4a review pins (F7 nested $where scope, F8 empty-record rejectAdded)", () => {
  // F7 — a nested `$where` refinement reads its OWN record's sibling scope,
  // not the dispatch-time root object. Pre-fix, `expected` resolved against
  // the ROOT ({inner:{…}} has no top-level `expected`), rejecting valid data.
  const innerRec: FenelType = {
    $record: {
      fields: [
        { key: namedKey("77777777-7777-4777-8777-777777777701"), name: "expected", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
        {
          key: namedKey("77777777-7777-4777-8777-777777777702"),
          name: "actual",
          label: Nothing,
          type: {
            $refined: {
              base: { $ref: "String" },
              set: { $tag: "SeWhere", pred: { call: ["eq", { var: "value" }, { var: "expected" }] } },
            },
          } as unknown as FenelType,
          meta: {},
          ui: Nothing,
        },
      ],
    },
  } as unknown as FenelType;
  const outerRec: FenelType = {
    $record: {
      fields: [
        { key: namedKey("77777777-7777-4777-8777-777777777703"), name: "inner", label: Nothing, type: innerRec, meta: {}, ui: Nothing },
      ],
    },
  } as unknown as FenelType;

  it("F7: a nested sibling-reading $where accepts valid data (reads the CURRENT record scope)", () => {
    const result = validate(outerRec, { inner: { expected: "a", actual: "a" } }, null);
    expect(result.valid).toBe(true);
  });

  it("F7: the same refinement still rejects a genuine sibling mismatch", () => {
    const result = validate(outerRec, { inner: { expected: "a", actual: "b" } }, null);
    expect(result.valid).toBe(false);
  });

  // F8 — a TOP-LEVEL zero-field record honors strict.rejectAdded (every value
  // entry is an added field); pre-fix the zero-field early return bypassed the
  // added-field check entirely and preserved the payload as valid.
  it("F8: a top-level empty record with rejectAdded flags every entry", () => {
    const result = validate({ $record: { fields: [] } } as unknown as FenelType, { admin: true }, null, {
      strict: { rejectAdded: true },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "admin")).toBe(true);
  });

  it("F8: a top-level empty record WITHOUT strict mode still passes its payload through", () => {
    const result = validate({ $record: { fields: [] } } as unknown as FenelType, { admin: true }, null);
    expect(result.valid).toBe(true);
    expect(result.data).toEqual({ admin: true });
  });
});

// ---------------------------------------------------------------------------
// modules-as-values — an arrow-typed value may be a function REFERENCE
// (`{$ref: handle}`), which used to be refused outright ("Expected a callable
// value"). It now gets exactly the treatment the same function's name gets:
// the same registry fact, the same paramCount check, the same signature
// column, and an unresolvable handle is admitted exactly as an unknown name is
// (`design/tcb-ledger.md` row `t.sub.signature-collapse`).
// ---------------------------------------------------------------------------

describe("validate() — a function reference in an arrow-typed slot", () => {
  const Num = { $ref: "Number" };
  const pf = (index: number, type: unknown) => ({
    name: `_${index}`,
    key: { $tag: "PositionalField" as const, index },
    type,
  });
  const arrow = (ps: unknown[], r: unknown): FenelType =>
    ({ $arrow: { params: ps.map((t, i) => pf(i, t)), returns: r } }) as unknown as FenelType;
  const unary = arrow([Num], Num);
  const binary = arrow([Num, Num], Num);

  it("a reference of matching arity is valid, like the name", () => {
    expect(validate(unary, "std:negate", null).valid).toBe(true);
    expect(validate(unary, { $ref: "std:negate" }, null).valid).toBe(true);
  });

  it("a reference of the wrong arity is refused with the name's own arity error", () => {
    const byName = validate(binary, "std:negate", null);
    const byRef = validate(binary, { $ref: "std:negate" }, null);
    expect(byName.valid).toBe(false);
    expect(byRef.valid).toBe(false);
    expect(byRef.errors).toEqual(byName.errors);
    expect(byRef.errors.some((e) => /param\(s\) but expected/i.test(JSON.stringify(e.message)))).toBe(true);
  });

  it("a dotted `bundle.member` handle gets the verdict its string gets", () => {
    for (const t of [unary, binary]) {
      const byName = validate(t, "std.negate", null);
      const byRef = validate(t, { $ref: "std.negate" }, null);
      expect(byRef.valid).toBe(byName.valid);
      expect(byRef.errors).toEqual(byName.errors);
    }
  });

  it("an unresolvable handle is admitted exactly as an unknown name is", () => {
    expect(validate(unary, "std:notARegisteredFunction", null).valid).toBe(true);
    expect(validate(unary, { $ref: "std:notARegisteredFunction" }, null).valid).toBe(true);
  });

  it("a value that is not a reference keeps its refusal", () => {
    // An empty handle, a non-string handle, an inherited `$ref` and a plain
    // record are not references (and not lambdas or partials).
    for (const value of [{ $ref: "" }, { $ref: 7 }, Object.create({ $ref: "std:negate" }), { name: "std:negate" }]) {
      expect(validate(unary, value, null).valid).toBe(false);
    }
  });

  // Only an OWN DATA `$ref` is a reference. The handle is read at the host
  // boundary through its property descriptor, so no code the value carries
  // runs for `$ref`, and a value whose `$ref` is not own data is refused
  // exactly as a plain record is ("Expected a callable value").
  const notCallable = () => validate(unary, { name: "std:negate" }, null).errors;

  it("an accessor `$ref` is refused, and its getter never runs", () => {
    let reads = 0;
    const value = {
      get $ref() {
        reads++;
        return "std:negate";
      },
    };
    const result = validate(unary, value, null);
    expect(reads).toBe(0);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(notCallable());
    expect(JSON.stringify(result.errors)).toContain("Expected a callable value");
  });

  it("an inherited `$ref` is refused, a data one and an accessor one alike", () => {
    let reads = 0;
    const accessorProto = {
      get $ref() {
        reads++;
        return "std:negate";
      },
    };
    for (const value of [Object.create({ $ref: "std:negate" }), Object.create(accessorProto)]) {
      const result = validate(unary, value, null);
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(notCallable());
    }
    expect(reads).toBe(0);
  });

  it("a Proxy is read at its own-property descriptor, never at its `get` trap", () => {
    // Fail-closed reading: the descriptor alone decides. A `get` trap that
    // answers a handle the descriptor does not state is never consulted for
    // `$ref`: no own `$ref` or an accessor one refuses as not callable, and an
    // own data `$ref` names exactly the function the descriptor names.
    let getReads = 0;
    let getterRuns = 0;
    const hostile = (descriptor: PropertyDescriptor | undefined) =>
      new Proxy({} as Record<string, unknown>, {
        get(target, key, receiver) {
          if (key === "$ref") {
            getReads++;
            return "std:negate";
          }
          return Reflect.get(target, key, receiver);
        },
        has(target, key) {
          return key === "$ref" || Reflect.has(target, key);
        },
        getOwnPropertyDescriptor(target, key) {
          return key === "$ref" ? descriptor : Reflect.getOwnPropertyDescriptor(target, key);
        },
      });

    // No own `$ref` (only the `get` trap claims one).
    const absent = validate(unary, hostile(undefined), null);
    expect(absent.valid).toBe(false);
    expect(absent.errors).toEqual(notCallable());

    // An accessor `$ref`: its getter is not run either.
    const accessor = hostile({
      configurable: true,
      enumerable: true,
      get: () => {
        getterRuns++;
        return "std:negate";
      },
    });
    const byAccessor = validate(unary, accessor, null);
    expect(byAccessor.valid).toBe(false);
    expect(byAccessor.errors).toEqual(notCallable());

    // An own data `$ref` naming a binary function while `get` names a unary
    // one: the value is exactly the reference its descriptor states.
    const dataDescriptor = { configurable: true, enumerable: true, writable: true, value: "std:add" };
    for (const t of [unary, binary]) {
      const byName = validate(t, "std:add", null);
      const byProxy = validate(t, hostile(dataDescriptor), null);
      expect(byProxy.valid).toBe(byName.valid);
      expect(byProxy.errors).toEqual(byName.errors);
    }
    // The pair discriminates: the descriptor's handle and the `get` trap's
    // handle get opposite verdicts on both arrows.
    expect(validate(unary, "std:add", null).valid).toBe(false);
    expect(validate(unary, "std:negate", null).valid).toBe(true);
    expect(validate(binary, "std:add", null).valid).toBe(true);
    expect(validate(binary, "std:negate", null).valid).toBe(false);

    expect(getReads).toBe(0);
    expect(getterRuns).toBe(0);
  });
});
