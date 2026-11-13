import { describe, expect, test } from "bun:test";
import type { FieldDef, FenelType, InferenceOutcome, TypeScheme } from "../types";
import { Anything, Just, List, Nothing } from "../type-foundation";
import {
  expectedSchemeForType,
  inferAuthoringCallGuidance,
  judgeAuthoringSchemeCompatibility,
  judgeAuthoringTypeCompatibility,
  projectAuthoringScheme,
  rankAuthoringFunctionSuggestions,
} from "./call-guidance";
import { inferAuthoringExpression, type AuthoringFunctionEntry, type ExprNode } from "./expression-authoring";
import { createAuthoringEnvironment, projectAuthoringChildExpectation } from "./environment";
import { expectedTypeConsumer } from "./call-scheme";
import { inferAuthoringExpressionWithLiteralWitnesses } from "./literal-witness";
import { inferJsonLogicType } from "../signature-inference";
import { dispatchEngineBody, dispatchedTraversalSemanticSlotsError, marshalStoredBodyForValidation } from "../engine-bodies-dispatch";

const num: FenelType = { $ref: "Number" };
const str: FenelType = { $ref: "String" };
const bool: FenelType = { $ref: "Boolean" };
const maybe: FenelType = { $ref: "Maybe" };
const a: FenelType = { $var: "a" };
const b: FenelType = { $var: "b" };
const empty: ExprNode = { kind: "param", name: "?" };

function field(name: string, type: FenelType, index = 0): FieldDef {
  return { name, type, key: { $tag: "PositionalField", index }, label: Nothing, ui: Nothing, meta: {} };
}

function fn(id: string, types: FenelType[], returns: FenelType, vars: string[] = []): AuthoringFunctionEntry {
  const params = types.map((type, index) => field(`value${index}`, type, index));
  return {
    id, params, returns, signatureOutcome: { $tag: "Solved" },
    scheme: {
      quantified: vars.map((sourceName, index) => ({ id: `q${index}`, sourceName, kind: { $tag: "KType" } })),
      body: { $arrow: { params, returns } },
    },
  };
}

const identity = fn("identity", [a], a, ["a"]);
const direct = fn("nothing", [], maybe);
const number = fn("number", [], num);
const callback: FenelType = { $arrow: { params: [field("value", a)], returns: b } };
const apply = fn("apply", [callback, a], b, ["a", "b"]);

describe("typed function suggestions", () => {
  test("puts direct results before polymorphic and higher-order routes, then incompatible returns", () => {
    const suggestions = rankAuthoringFunctionSuggestions([number, identity, apply, direct], maybe);
    expect(suggestions.map(({ entry, match }) => [entry.id, match])).toEqual([
      ["nothing", "direct"], ["identity", "adaptable"], ["apply", "adaptable"], ["number", "mismatch"],
    ]);
  }, 180_000);

  test("does not promote fenced or scheme-less compatibility projections", () => {
    const fenced = { ...direct, id: "fenced", signatureOutcome: {
      $tag: "AnnotationRequired" as const, diagnostics: [],
    } };
    const unsolved = { ...direct, id: "unsolved", scheme: undefined };
    expect(rankAuthoringFunctionSuggestions([fenced, unsolved, number, direct], maybe)
      .map(({ entry, match }) => [entry.id, match])).toEqual([
        ["nothing", "direct"], ["number", "mismatch"], ["fenced", "unavailable"], ["unsolved", "unavailable"],
      ]);
  });

  test("reference mode compares the complete callable against the callback slot", () => {
    const expected: FenelType = { $arrow: { params: [field("input", num)], returns: maybe } };
    const good = fn("lookup", [num], maybe);
    const wrongInput = fn("textLookup", [str], maybe);
    const result = rankAuthoringFunctionSuggestions([wrongInput, good], expected, { mode: "reference" });
    expect(result.map(({ entry, match }) => [entry.id, match])).toEqual([
      ["lookup", "direct"], ["textLookup", "mismatch"],
    ]);
  });

  test("an unbound display variable remains unavailable instead of gaining a guessed binder", () => {
    expect(rankAuthoringFunctionSuggestions([identity], { $var: "notDeclared" })[0]?.match)
      .toBe("unavailable");
  });

  test("composition suggestions must accept the current result as well as produce the expected type", () => {
    const stringLookup = fn("stringLookup", [str], maybe);
    const numberLookup = fn("numberLookup", [num], maybe);
    const result = rankAuthoringFunctionSuggestions([stringLookup, numberLookup, identity], maybe, {
      inputScheme: { quantified: [], body: num },
    });
    expect(result.map(({ entry, match }) => [entry.id, match])).toEqual([
      ["numberLookup", "direct"], ["stringLookup", "mismatch"], ["identity", "mismatch"],
    ]);
  });

  test("composition in an untyped binding still filters against its current result", () => {
    const stringOnly = fn("stringOnly", [str], str);
    const numberOnly = fn("numberOnly", [num], num);
    const result = rankAuthoringFunctionSuggestions([stringOnly, numberOnly, identity], undefined, {
      inputScheme: { quantified: [], body: num },
    });
    expect(result.map(({ entry, match }) => [entry.id, match])).toEqual([
      ["numberOnly", "direct"], ["identity", "direct"], ["stringOnly", "mismatch"],
    ]);
  });

  test("same display names with distinct nominal owners never gain direct compatibility", () => {
    const local = (identity: string): TypeScheme => ({
      quantified: [], body: { $ref: "Item" },
      nominals: [{ path: [], identity, publicName: "Item" }],
    });
    const entry = fn("localItem", [], { $ref: "Item" });
    entry.scheme = {
      ...entry.scheme!,
      nominals: [{ ...local("owner-A").nominals![0]!, path: ["$arrow", "returns"] }],
    };
    expect(rankAuthoringFunctionSuggestions([entry], local("owner-B"))[0]?.match).toBe("mismatch");
    expect(rankAuthoringFunctionSuggestions([entry], local("owner-A"))[0]?.match).toBe("direct");
  });

  test("one-sided nominal owners require the complete scheme equation in both directions", () => {
    const shapes: Array<{ body: FenelType; path: string[] }> = [
      { body: { $ref: "Item" }, path: [] },
      { body: { $record: { fields: [field("item", { $ref: "Item" })] } }, path: ["$record", "fields", "0", "type"] },
    ];
    for (const { body, path } of shapes) {
      const raw: TypeScheme = { quantified: [], body };
      const owned: TypeScheme = {
        ...raw, nominals: [{ path, identity: "owner-A", publicName: "Item" }],
      };
      const directions: Array<[TypeScheme, TypeScheme]> = [[raw, owned], [owned, raw]];
      for (const [actual, wanted] of directions) {
        const sink = expectedTypeConsumer(wanted);
        const canonical = inferJsonLogicType({ call: [sink.id, { var: "candidate" }] }, {
          bindings: { candidate: actual }, resolveFunction: id => id === sink.id ? sink : undefined,
        });
        expect(canonical.outcome.$tag).toBe("Invalid");
        if (canonical.outcome.$tag === "Invalid") {
          expect(canonical.outcome.diagnostics.some(({ code }) => code === "inference.nominal-mismatch")).toBe(true);
        }
        expect(judgeAuthoringSchemeCompatibility(actual, wanted)).toBe("incompatible");

        const entry = fn("one-sided", [], raw.body);
        entry.scheme = {
          ...entry.scheme!,
          ...(actual.nominals === undefined ? {} : {
            nominals: actual.nominals.map(item => ({ ...item, path: ["$arrow", "returns", ...item.path] })),
          }),
        };
        expect(rankAuthoringFunctionSuggestions([entry], wanted)[0]?.match).toBe("mismatch");
      }
      expect(judgeAuthoringSchemeCompatibility(raw, raw)).toBe("compatible");
      expect(judgeAuthoringSchemeCompatibility(owned, owned)).toBe("compatible");
    }
  });

  test("source-owned match projection keeps unavailable outcomes distinct from mismatches", () => {
    const diagnostic = (code: string) => ({ code, message: code, functionId: "<authoring>", path: [] });
    const checked = (outcome: InferenceOutcome) => dispatchEngineBody("engine:authoringSchemeCheckedMatch", ["adaptable", outcome]);
    expect(checked({ $tag: "Solved", derivation: "fenel-rank1-syntax-v1" })).toBe("adaptable");
    expect(checked({ $tag: "AnnotationRequired", diagnostics: [diagnostic("inference.nominal-mismatch")] })).toBe("unavailable");
    for (const code of ["inference.kind-mismatch", "inference.host-scheme-sidecar", "inference.unknown-name"]) {
      expect(checked({ $tag: "Invalid", diagnostics: [diagnostic(code)] })).toBe("unavailable");
    }
    for (const code of ["inference.nominal-mismatch", "inference.occurs-check", "inference.arity-mismatch", "inference.refinement-rejected"]) {
      expect(checked({ $tag: "Invalid", diagnostics: [diagnostic(code)] })).toBe("mismatch");
    }
    expect(checked({ $tag: "Invalid", diagnostics: [diagnostic("inference.kind-mismatch"), diagnostic("inference.nominal-mismatch")] })).toBe("mismatch");
  });

  test("unsupported descriptor snapshots retain canonical refusals without caching missing owners", () => {
    const hidden = (identity: string): TypeScheme => Object.defineProperty({
      quantified: [], body: { $ref: "HiddenItem" },
    }, "nominals", { value: [{ path: [], identity, publicName: "HiddenItem" }], enumerable: false });
    const left = hidden("hidden-owner-A");
    const right = hidden("hidden-owner-B");
    expect(judgeAuthoringSchemeCompatibility(left, left)).toBe("unknown");
    expect(judgeAuthoringSchemeCompatibility(left, right)).toBe("incompatible");
    expect(judgeAuthoringSchemeCompatibility(left, left)).toBe("unknown");
    const unresolved: TypeScheme = Object.defineProperty({ quantified: [], body: { $ref: "UnknownAccountType" } },
      "nominals", { value: [], enumerable: false });
    expect(judgeAuthoringSchemeCompatibility({ quantified: [], body: num }, unresolved)).toBe("unknown");
    for (const property of ["identity", "path"]) {
      const nested = (identity: string): TypeScheme => {
        const nominal = { path: [], identity, publicName: "HiddenItem" };
        Object.defineProperty(nominal, property, { enumerable: false });
        return { quantified: [], body: { $ref: "HiddenItem" }, nominals: [nominal] };
      };
      expect(judgeAuthoringSchemeCompatibility(nested("nested-owner-A"), nested("nested-owner-B"))).not.toBe("compatible");
    }
  });

  test("scheme match ingress never invokes accessors before snapshot or canonical checking", () => {
    let getterCalls = 0;
    const plain = (): TypeScheme => ({ quantified: [], body: { $ref: "AccessorItem" } });
    for (const property of ["body", "nominals"]) {
      const unreadable = Object.defineProperty(plain(), property, { get: () => { getterCalls++; return []; } });
      expect(judgeAuthoringSchemeCompatibility(unreadable, plain())).toBe("unknown");
      expect(judgeAuthoringSchemeCompatibility(plain(), unreadable)).toBe("unknown");
    }
    const unreadableBody = Object.defineProperty({}, "$ref", { get: () => { getterCalls++; return "AccessorItem"; } });
    expect(judgeAuthoringSchemeCompatibility({ quantified: [], body: unreadableBody as FenelType }, plain())).toBe("unknown");
    expect(getterCalls).toBe(0);
  });

  test("an undefined application reference supplies no nominal head", () => {
    const head = (headRef: string | undefined) => dispatchEngineBody("engine:authoringSchemeNominalHead", [
      marshalStoredBodyForValidation({ applications: [{ path: [], headVarId: "f", headRef }] }),
    ]);
    expect(head(undefined)).toEqual(Nothing);
    expect(head("Maybe")).toEqual({ $tag: "Just", _0: "ref:Maybe" });
  });

  test("concrete Maybe applications precede a higher-kinded return the current kernel cannot specialize", () => {
    const kind = { $tag: "KArrow" as const, input: { $tag: "KType" as const }, output: { $tag: "KType" as const } };
    const expected: TypeScheme = {
      quantified: [], body: { $el: { call: ["Maybe", num] } },
      applications: [{ path: [], headRef: "Maybe", kind, args: [num] }],
      nominals: [{ path: [], identity: "maybe-owner", publicName: "Maybe" }],
    };
    const concrete = fn("maybeNumber", [], expected.body);
    concrete.scheme = {
      ...concrete.scheme!,
      applications: [{ ...expected.applications![0]!, path: ["$arrow", "returns"] }],
      nominals: [{ ...expected.nominals![0]!, path: ["$arrow", "returns"] }],
    };
    const app: FenelType = { $el: { call: ["f", a] } };
    const generic = fn("genericContainer", [app], app, ["a"]);
    generic.scheme = {
      ...generic.scheme!,
      quantified: [...generic.scheme!.quantified, { id: "container", sourceName: "f", kind }],
      applications: [
        { path: ["$arrow", "params", "0", "type"], headVarId: "container", kind, args: [a] },
        { path: ["$arrow", "returns"], headVarId: "container", kind, args: [a] },
      ],
    };
    expect(rankAuthoringFunctionSuggestions([generic, concrete], expected)
      .map(({ entry, match }) => [entry.id, match])).toEqual([
        ["maybeNumber", "direct"], ["genericContainer", "unavailable"],
      ]);
  });

  test("return projection caches amortize a large catalog without changing input ordering", () => {
    const entries = Array.from({ length: 2830 }, (_, index) => ({
      ...[number, identity, direct][index % 3]!, id: `entry${index}`,
    }));
    const before = entries.map(({ id }) => id);
    const first = rankAuthoringFunctionSuggestions(entries, maybe);
    const second = rankAuthoringFunctionSuggestions(entries, maybe);
    expect(first).toEqual(second);
    expect(entries.map(({ id }) => id)).toEqual(before);
    expect(first[0]?.match).toBe("direct");
    expect(first[first.length - 1]?.match).toBe("mismatch");
  });
});

describe("contextual call argument guidance", () => {
  test("propagates the required result through identity even when its current argument is wrong", () => {
    const result = inferAuthoringCallGuidance(identity, [{ kind: "literal", value: 23 }], maybe);
    expect(result.outcome.$tag).toBe("Solved");
    expect(result.params[0]?.type).toEqual(maybe);
    expect(result.paramSchemes[0]?.quantified).toEqual([]);
    expect(identity.params[0]?.type).toEqual(a);
  });

  test("specializes a higher-order callback from the outer result and already supplied sibling", () => {
    const result = inferAuthoringCallGuidance(apply,
      [empty, { kind: "literal", value: 5 }], maybe);
    expect(result.params[0]?.type).toEqual({
      $arrow: { params: [field("_0", num)], returns: maybe },
    });
    const callbackScheme = result.paramSchemes[0]!;
    const candidate = fn("lookup", [num], maybe);
    expect(rankAuthoringFunctionSuggestions([number, candidate], callbackScheme, { mode: "reference" })[0]?.entry.id)
      .toBe("lookup");
  });

  test("threads generalized parameter schemes through nested calls", () => {
    const outer = inferAuthoringCallGuidance(identity, [empty], {
      quantified: [{ id: "element", sourceName: "element", kind: { $tag: "KType" } }],
      body: { $arrow: { params: [field("x", { $var: "element" })], returns: maybe } },
    });
    expect(outer.outcome.$tag).toBe("Solved");
    const inner = inferAuthoringCallGuidance(identity, [empty], outer.paramSchemes[0]);
    expect(inner.outcome.$tag).toBe("Solved");
    expect(inner.paramSchemes[0]?.quantified).toHaveLength(1);
    expect(inner.params[0]?.type).toHaveProperty("$arrow.returns", maybe);
  });

  test("uses proven native literal types while guiding sibling arguments", () => {
    const image: FenelType = { $ref: "Image" };
    const same = fn("sameImage", [image, image], maybe);
    const raw = { width: 0, height: 0, pixels: [] };
    const membershipChecks: TypeScheme[] = [];
    const result = inferAuthoringCallGuidance(same,
      [{ kind: "literal", value: raw }, empty], maybe, {
        literalMembership(value, expected) {
          membershipChecks.push(expected);
          return { $tag: "Just", _0: value === raw && "$ref" in expected.body && expected.body.$ref === "Image" };
        },
      });
    expect(result.outcome.$tag).toBe("Solved");
    expect(result.params[1]?.type).toEqual(image);
    expect(membershipChecks.length).toBeGreaterThan(0);
    expect(raw).toEqual({ width: 0, height: 0, pixels: [] });
  });

  test("preserves application kinds and nominal owner identity while projecting a parameter", () => {
    const app: FenelType = { $el: { call: ["f", a] } };
    const scheme: TypeScheme = {
      quantified: [
        { id: "f", sourceName: "f", kind: { $tag: "KArrow", input: { $tag: "KType" }, output: { $tag: "KType" } } },
        { id: "a", sourceName: "a", kind: { $tag: "KType" } },
      ],
      body: { $arrow: { params: [field("items", app)], returns: num } },
      applications: [{
        path: ["$arrow", "params", "0", "type"], headVarId: "f", args: [a],
        kind: { $tag: "KArrow", input: { $tag: "KType" }, output: { $tag: "KType" } },
      }],
      nominals: [{ path: ["$arrow", "returns"], identity: "number", publicName: "Number" }],
    };
    const projected = projectAuthoringScheme(scheme, ["$arrow", "params", "0", "type"]);
    expect(projected?.applications?.[0]?.path).toEqual([]);
    expect(projected?.applications?.[0]?.headVarId).toBe("f");
    expect(projected?.nominals).toEqual([]);
    expect(projected?.quantified).toEqual(scheme.quantified);
  });

  test("does not use fallback params as signature authority", () => {
    const result = inferAuthoringCallGuidance({ ...identity, scheme: undefined }, [empty], maybe);
    expect(result.paramSchemes).toEqual([undefined]);
  });

  test("preserves a partial call's residual function while guiding a supplied argument", () => {
    const choose = fn("choose", [a, b], a, ["a", "b"]);
    const expected: FenelType = { $arrow: { params: [field("later", num)], returns: maybe } };
    const result = inferAuthoringCallGuidance(choose, [empty], expected);
    expect(result.outcome.$tag).toBe("Solved");
    expect(result.params[0]?.type).toEqual(maybe);
  });
});

describe("expected type owner and compatibility", () => {
  test("proves an inferred identity result cannot satisfy Maybe when broad containment is undecided", () => {
    const expression: ExprNode = { kind: "call", fnId: "identity", args: [
      { kind: "call", fnId: "identity", args: [{ kind: "literal", value: 3 }] },
    ] };
    const actual = inferAuthoringExpression(expression, { getFunctionEntry: () => identity });
    expect(actual.outcome.$tag).toBe("Solved");
    expect(actual.type).toEqual(num);
    const expected: TypeScheme = {
      quantified: [], body: { $el: { call: ["Maybe", num] } },
      applications: [{ path: [], headRef: "Maybe", args: [num], kind: {
        $tag: "KArrow", input: { $tag: "KType" }, output: { $tag: "KType" },
      } }],
      nominals: [{ path: [], identity: '["system","Maybe"]', publicName: "Maybe" }],
    };
    expect(judgeAuthoringSchemeCompatibility(actual.scheme!, expected)).toBe("incompatible");
    expect(judgeAuthoringSchemeCompatibility(actual.scheme!, num)).toBe("compatible");
    expect(judgeAuthoringSchemeCompatibility(actual.scheme!, { $var: "unbound" })).toBe("unknown");
    expect(judgeAuthoringSchemeCompatibility(actual.scheme!, { $ref: "UnknownAccountType" })).toBe("unknown");
  });

  test("derives a generic selected type's scheme from its unique authoritative constructor owner", () => {
    const generic: FenelType = { $variant: { cases: [{ name: "Empty", label: Nothing }] } };
    const ctor = {
      ...fn("Empty", [], generic, ["a"]), kind: "constructor" as const,
      parentEntity: "Container", ownerIdentity: "container-owner", label: "Empty", description: "",
    };
    const environment = createAuthoringEnvironment({
      types: [{ id: "container-id", entityId: "Container", name: "Container", description: "", category: "type", type: generic }],
      functions: [ctor], capabilities: [], catalogTypes: [generic], operatorCodeNameByNotation: new Map(),
    });
    expect(expectedSchemeForType(environment.catalog.types[0]!.type, environment)?.quantified).toEqual(ctor.scheme!.quantified);
    expect(expectedSchemeForType({ $ref: "Container" }, environment)?.body).toEqual(generic);
    expect(expectedSchemeForType({ $var: "a" }, environment)).toBeUndefined();
  });

  test("distinguishes proven incompatible atoms from unknown generic compatibility", () => {
    expect(judgeAuthoringTypeCompatibility(num, num)).toBe("compatible");
    expect(judgeAuthoringTypeCompatibility(num, str)).toBe("incompatible");
    expect(judgeAuthoringTypeCompatibility(a, str)).toBe("unknown");
  });
});

describe("contextual child expectations", () => {
  test("keeps an unavailable parent requirement distinct from an absent one", () => {
    expect(projectAuthoringChildExpectation(undefined, { kind: "list-element" }).state).toBe("absent");
    for (const body of [{ $ref: "Container" }, { $el: { call: ["List", num] } }] as FenelType[]) {
      const result = projectAuthoringChildExpectation({ quantified: [], body }, { kind: "list-element" });
      expect(result.state).toBe("unresolved");
      expect(result.outcome?.$tag).toBe("AnnotationRequired");
      expect(result.scheme).toBeUndefined();
    }
  });

  test("projects a wrapped record field while preserving binder kinds and child evidence", () => {
    const app: FenelType = { $el: { call: ["f", a] } };
    const path = ["$opaque", "pure", "$record", "fields", "1", "type"];
    const parent: TypeScheme = {
      quantified: [
        { id: "function-owner", sourceName: "f", kind: { $tag: "KArrow", input: { $tag: "KType" }, output: { $tag: "KType" } } },
        { id: "argument-owner", sourceName: "a", kind: { $tag: "KType" } },
      ],
      body: { $opaque: { name: "Wrapped", pure: { $record: { fields: [
        field("other", num, 0), field("items", app, 1),
      ] } } } },
      applications: [{ path, headVarId: "function-owner", args: [a], kind: { $tag: "KArrow", input: { $tag: "KType" }, output: { $tag: "KType" } } }],
      nominals: [{ path: ["$opaque", "pure", "$record", "fields", "0", "type"], identity: "number-owner", publicName: "Number" }],
    };
    const result = projectAuthoringChildExpectation(parent, { kind: "record-field", name: "renamed", key: { $tag: "PositionalField", index: 1 } });
    expect(result).toMatchObject({ state: "known" });
    expect(result.scheme?.quantified).toBe(parent.quantified);
    expect(result.scheme?.body).toBe(app);
    expect(result.scheme?.applications).toEqual([{ ...parent.applications![0]!, path: [] }]);
    expect(result.scheme?.nominals).toEqual([]);
  });

  test("projects a canonical List element without losing nominal evidence", () => {
    const path = ["$opaque", "pure", "$variant", "cases", "1", "fields", "0", "type"];
    const parent: TypeScheme = {
      quantified: [], body: List(str),
      nominals: [{ path, identity: '["system","String"]', publicName: "String" }],
    };
    const result = projectAuthoringChildExpectation(parent, { kind: "list-element" });
    expect(result).toMatchObject({ state: "known" });
    expect(result.scheme?.body).toBe(str);
    expect(result.scheme?.nominals).toEqual([{ path: [], identity: '["system","String"]', publicName: "String" }]);
  });

  test("does not select an ambiguous record name or recover authority from a raw shape resolver", () => {
    const parent: TypeScheme = { quantified: [], body: { $record: { fields: [field("same", str, 0), field("same", num, 1)] } } };
    expect(projectAuthoringChildExpectation(parent, { kind: "record-field", name: "same" }).state).toBe("unresolved");
    expect(projectAuthoringChildExpectation({ quantified: [], body: { $ref: "Container" } },
      { kind: "record-field", name: "same" }, { resolveNamedType: () => parent.body }).state).toBe("unresolved");
  });

  test("does not export a recursive binder as a child scheme variable", () => {
    const list = List({ $var: "X" });
    const pure = "$opaque" in list ? list.$opaque.pure : list;
    const parent: TypeScheme = { quantified: [], body: { $mu: { var: "X", body: pure! } } };
    const result = projectAuthoringChildExpectation(parent, { kind: "list-element" });
    expect(result.state).toBe("unresolved");
    expect(result.scheme).toBeUndefined();
  });

  test("fences whole-container refinements while retaining a child's own refinement", () => {
    const refined: FenelType = { $refined: { base: num, set: { $tag: "SeAll" } } };
    const record: FenelType = { $record: { fields: [field("amount", refined)] } };
    const child = projectAuthoringChildExpectation({ quantified: [], body: record }, { kind: "record-field", name: "amount" });
    expect(child).toMatchObject({ state: "known" });
    expect(child.type).toBe(refined);
    for (const base of [record, List(num)]) {
      const result = projectAuthoringChildExpectation({ quantified: [], body: { $refined: { base, set: { $tag: "SeAll" } } } },
        base === record ? { kind: "record-field", name: "amount" } : { kind: "list-element" });
      expect(result.state).toBe("unresolved");
    }
  });
});

// Types are sets: unification decides containment only for the constructor
// formers. Beneath a Boolean-lattice former (Void, union, intersection,
// complement) a failed equation is an abstention, never a false "mismatch".
describe("Boolean-lattice expectations", () => {
  const systemString: TypeScheme = {
    quantified: [], body: str, nominals: [{ path: [], identity: '["system","String"]', publicName: "String" }],
  };
  const canonical = (actual: TypeScheme, wanted: TypeScheme) => {
    const sink = expectedTypeConsumer(wanted);
    return inferJsonLogicType({ call: [sink.id, { var: "candidate" }] }, {
      bindings: { candidate: actual }, resolveFunction: id => id === sink.id ? sink : undefined,
    }).outcome;
  };
  const codes = (outcome: InferenceOutcome) => outcome.$tag === "Solved" ? [] : outcome.diagnostics.map(({ code }) => code);

  test("an exact Anything target retains positive intrinsic-scalar containment after canonical preparation", () => {
    const outcome = canonical(systemString, { quantified: [], body: Anything });
    expect(outcome.$tag).toBe("AnnotationRequired");
    expect(codes(outcome)).toEqual(["inference.set-former-indeterminate"]);
    expect(judgeAuthoringSchemeCompatibility(systemString, Anything)).toBe("compatible");
    expect(judgeAuthoringTypeCompatibility(str, Anything)).toBe("compatible");
    const environment = createAuthoringEnvironment({ types: [], functions: [], capabilities: [], catalogTypes: [], operatorCodeNameByNotation: new Map() });
    const literal = inferAuthoringExpressionWithLiteralWitnesses({ kind: "literal", value: "x" }, environment);
    expect(literal.outcome.$tag).toBe("Solved");
    expect(judgeAuthoringSchemeCompatibility(literal.scheme!, expectedSchemeForType(Anything, environment) ?? Anything)).toBe("compatible");
  });

  test("retains independent Number and Boolean schemes under an exact Anything requirement", () => {
    const wanted: TypeScheme = { quantified: [], body: Anything };
    for (const value of [21, true]) {
      const inferred = inferAuthoringExpressionWithLiteralWitnesses({ kind: "literal", value });
      expect(inferred.outcome.$tag).toBe("Solved");
      if (!inferred.scheme) throw new Error("Expected an independent literal scheme");
      const before = structuredClone(inferred);
      expect(codes(canonical(inferred.scheme, wanted))).toEqual(["inference.set-former-indeterminate"]);
      expect(judgeAuthoringSchemeCompatibility(inferred.scheme, wanted)).toBe("compatible");
      expect(inferred).toEqual(before);
    }
  });

  test("admits only existing intrinsic scalar identities and keeps foreign owners distinct", () => {
    const wanted: TypeScheme = { quantified: [], body: Anything };
    const named = (publicName: string, identity: string): TypeScheme => ({
      quantified: [], body: { $ref: publicName }, nominals: [{ path: [], identity, publicName }],
    });
    // These are the two representations already admitted by the canonical
    // intrinsic identity helper, not two arbitrary declarations with one name.
    for (const publicName of ["String", "Number", "Boolean"]) {
      for (const identity of [publicName, JSON.stringify(["system", publicName])]) {
        const actual = named(publicName, identity);
        expect(codes(canonical(actual, wanted))).toEqual(["inference.set-former-indeterminate"]);
        expect(judgeAuthoringSchemeCompatibility(actual, wanted)).toBe("compatible");
      }
    }
    // Fragment incompleteness, not refutation: well-formed foreign String,
    // Int and Bool value types are contained in top. Their value-type evidence
    // is outside this intrinsic-scalar certificate, so the policy abstains.
    const foreignA = named("String", '["review-A","String"]');
    const foreignB = named("String", '["review-B","String"]');
    for (const actual of [foreignA, foreignB,
      named("Int", '["system","Int"]'), named("Bool", '["system","Bool"]')]) {
      expect(judgeAuthoringTypeCompatibility(actual.body, Anything)).toBe("compatible");
      expect(codes(canonical(actual, wanted))).toEqual(["inference.set-former-indeterminate"]);
      expect(judgeAuthoringSchemeCompatibility(actual, wanted)).toBe("unknown");
    }
    expect(judgeAuthoringSchemeCompatibility(foreignA, foreignB)).toBe("incompatible");
    expect(judgeAuthoringSchemeCompatibility(foreignA, systemString)).toBe("incompatible");
  });

  test("fences under-applied and fully applied constructors at the root and in a value field", () => {
    const kType = { $tag: "KType" } as const;
    const unary = { $tag: "KArrow", input: kType, output: kType } as const;
    const binary = { $tag: "KArrow", input: kType, output: unary } as const;
    const wanted: TypeScheme = { quantified: [], body: Anything };
    for (const args of [[str], [str, num]]) {
      const application: FenelType = { $el: { call: ["F", ...args] } };
      for (const nested of [false, true]) {
        const path = nested ? ["$record", "fields", "0", "type"] : [];
        const actual: TypeScheme = {
          quantified: [],
          body: nested ? { $record: { fields: [field("_0", application)] } } : application,
          applications: [{ path, headRef: "F", args, kind: binary }],
          nominals: [{ path, identity: '["review","F"]', publicName: "F" }],
        };
        // Even the under-applied form currently reaches this fence after
        // preparation. Under-application cannot establish a value type.
        // The fully applied F String Number counterpart has a different limit:
        // unknown records fragment incompleteness, not refutation of containment
        // in top for a well-formed value type. No application is certified here.
        expect(dispatchedTraversalSemanticSlotsError(actual.body)).toEqual(Nothing);
        expect(judgeAuthoringTypeCompatibility(actual.body, Anything)).toBe("compatible");
        expect(codes(canonical(actual, wanted))).toEqual(["inference.set-former-indeterminate"]);
        expect(judgeAuthoringSchemeCompatibility(actual, wanted)).toBe("unknown");
      }
    }
  });

  test("bare system Maybe and List remain unknown without value-type kind evidence", () => {
    const wanted: TypeScheme = { quantified: [], body: Anything };
    for (const publicName of ["Maybe", "List"]) {
      const actual: TypeScheme = { quantified: [], body: { $ref: publicName },
        nominals: [{ path: [], identity: JSON.stringify(["system", publicName]), publicName }] };
      // Generic preparation currently treats a bare named head as kind Type.
      // Neither that assumption nor the top-containment verdict proves that a
      // higher-kinded declaration has become a value type.
      expect(judgeAuthoringTypeCompatibility(actual.body, Anything)).toBe("compatible");
      const outcome = canonical(actual, wanted);
      expect(outcome.$tag).toBe("AnnotationRequired");
      expect(codes(outcome)).toEqual(["inference.set-former-indeterminate"]);
      expect(judgeAuthoringSchemeCompatibility(actual, wanted)).toBe("unknown");
    }
  });

  test("retains a real containment abstention under the exact universal target", () => {
    const actual: TypeScheme = { quantified: [], body: { $mu: { var: "X", body: { $var: "X" } } } };
    expect(judgeAuthoringTypeCompatibility(actual.body, Anything)).toBe("unknown");
    expect(judgeAuthoringSchemeCompatibility(actual, Anything)).toBe("unknown");
  });

  test("retains the canonical fence for an unsupported dependent value position", () => {
    const actual: TypeScheme = {
      quantified: [],
      body: { $record: { fields: [field("_0", str), field("_1", { $el: { var: "unresolved" } }, 1)] } },
      nominals: [{ path: ["$record", "fields", "0", "type"], identity: '["system","String"]', publicName: "String" }],
    };
    const wanted: TypeScheme = { quantified: [], body: Anything };
    expect(dispatchedTraversalSemanticSlotsError(actual.body)).toEqual(Nothing);
    expect(judgeAuthoringTypeCompatibility(actual.body, Anything)).toBe("compatible");
    expect(codes(canonical(actual, wanted))).toEqual(["inference.value-dependent-type"]);
    expect(judgeAuthoringSchemeCompatibility(actual, wanted)).toBe("unknown");
  });

  test("retains the canonical boundary refusal for malformed application metadata", () => {
    const actual: TypeScheme = {
      quantified: [], body: { $el: { call: ["F", str] } },
      applications: [{ path: [], headRef: "F", args: [num], kind: {
        $tag: "KArrow", input: { $tag: "KType" }, output: { $tag: "KType" },
      } }],
      nominals: [{ path: [], identity: '["review","F"]', publicName: "F" }],
    };
    const wanted: TypeScheme = { quantified: [], body: Anything };
    expect(judgeAuthoringTypeCompatibility(actual.body, Anything)).toBe("compatible");
    const outcome = canonical(actual, wanted);
    expect(outcome.$tag).toBe("Invalid");
    expect(codes(outcome)).toEqual(["INFERENCE_BINDING_BOUNDARY"]);
    expect(judgeAuthoringSchemeCompatibility(actual, wanted)).toBe("unknown");
  });

  test("cached scalar containment preserves unused-header refusals in either call order", () => {
    const invalidHeader = [
      { id: "duplicate", sourceName: "first", kind: { $tag: "KType" as const } },
      { id: "duplicate", sourceName: "second", kind: { $tag: "KType" as const } },
    ];
    // This valid empty-metadata representation gives these controls a cache
    // key separate from the positive tests. Each row has a distinct source.
    const wanted: TypeScheme = { quantified: [], body: Anything, applications: [], nominals: [], diagnostics: [] };
    const cases = [
      ["Number", '["system","Number"]', "actual", false],
      ["Boolean", '["system","Boolean"]', "actual", true],
      ["Number", "Number", "wanted", false],
      ["Boolean", "Boolean", "wanted", true],
    ] as const;
    for (const [publicName, identity, invalidSide, invalidFirst] of cases) {
      const actual: TypeScheme = { quantified: [], body: { $ref: publicName },
        nominals: [{ path: [], identity, publicName }] };
      const invalidActual = invalidSide === "actual" ? { ...actual, quantified: invalidHeader } : actual;
      const invalidWanted = invalidSide === "wanted" ? { ...wanted, quantified: invalidHeader } : wanted;
      const refusal = canonical(invalidActual, invalidWanted);
      expect(refusal.$tag).toBe("Invalid");
      expect(codes(refusal)).toEqual([invalidSide === "actual"
        ? "INFERENCE_BINDING_BOUNDARY" : "INFERENCE_RESOLVER_SIGNATURE_BOUNDARY"]);
      for (const invalid of invalidFirst ? [true, false] : [false, true]) {
        expect(judgeAuthoringSchemeCompatibility(invalid ? invalidActual : actual,
          invalid ? invalidWanted : wanted)).toBe(invalid ? "unknown" : "compatible");
      }
    }
  });

  test("ordinary Number-to-Number cache reuse preserves duplicate-header refusal on both operands and in both orders", () => {
    const invalidHeader = [
      { id: "duplicate", sourceName: "first", kind: { $tag: "KType" as const } },
      { id: "duplicate", sourceName: "second", kind: { $tag: "KType" as const } },
    ];
    // This defect predates the scalar-to-top rule: the valid equation Solves.
    // Existing intrinsic identity forms and optional empty application metadata
    // give these four rows distinct wanted keys even under the old key function.
    // Within each row only the unused binder header differs; the old key erased it.
    const cases = [
      ["actual", false, '["system","Number"]', false],
      ["actual", true, "Number", false],
      ["wanted", false, '["system","Number"]', true],
      ["wanted", true, "Number", true],
    ] as const;
    for (const [invalidSide, invalidFirst, identity, emptyApplications] of cases) {
      const actual: TypeScheme = { quantified: [], body: num, diagnostics: [],
        nominals: [{ path: [], identity, publicName: "Number" }] };
      const wanted: TypeScheme = { ...actual, ...(emptyApplications ? { applications: [] } : {}) };
      const invalidActual = invalidSide === "actual" ? { ...actual, quantified: invalidHeader } : actual;
      const invalidWanted = invalidSide === "wanted" ? { ...wanted, quantified: invalidHeader } : wanted;
      const solved = canonical(actual, wanted);
      const refused = canonical(invalidActual, invalidWanted);
      expect(solved.$tag).toBe("Solved");
      expect(refused.$tag).toBe("Invalid");
      expect(codes(refused)).toEqual([invalidSide === "actual"
        ? "INFERENCE_BINDING_BOUNDARY" : "INFERENCE_RESOLVER_SIGNATURE_BOUNDARY"]);
      for (const [left, right, outcome, match] of [
        [actual, wanted, solved, "direct"], [invalidActual, invalidWanted, refused, "unavailable"],
      ] as const) {
        const plan = dispatchEngineBody("engine:authoringSchemeMatchPlan", [
          marshalStoredBodyForValidation(left), marshalStoredBodyForValidation(right),
          judgeAuthoringTypeCompatibility(left.body, right.body), Just(outcome),
        ]) as { match: string };
        expect(plan.match).toBe(match);
      }
      const order = invalidFirst ? [true, false] : [false, true];
      // First exercise the requested warm order, then query both cached answers.
      for (const invalid of [...order, ...order.slice().reverse()]) {
        expect(judgeAuthoringSchemeCompatibility(invalid ? invalidActual : actual,
          invalid ? invalidWanted : wanted)).toBe(invalid ? "unknown" : "compatible");
      }
    }
  });

  test("unused quantified binders preserve the scalar result in either cache call order", () => {
    const unused = [{ id: "unused", sourceName: "unused", kind: {
      $tag: "KArrow" as const, input: { $tag: "KType" as const }, output: { $tag: "KType" as const },
    } }];
    // Explicit empty sidecars give these wanted schemes their own cache key.
    // The two source names then exercise opposite first-call orders without
    // depending on the positive cases above having left the cache cold.
    const wanted: TypeScheme = { quantified: [], body: Anything, applications: [], nominals: [] };
    for (const [publicName, unusedFirst] of [["Number", false], ["Boolean", true]] as const) {
      const actual: TypeScheme = { quantified: [], body: { $ref: publicName },
        nominals: [{ path: [], identity: JSON.stringify(["system", publicName]), publicName }] };
      for (const withUnused of unusedFirst ? [true, false] : [false, true]) {
        const source = withUnused ? { ...actual, quantified: unused } : actual;
        const target = withUnused ? { ...wanted, quantified: unused } : wanted;
        expect(codes(canonical(source, target))).toEqual(["inference.set-former-indeterminate"]);
        expect(judgeAuthoringSchemeCompatibility(source, target)).toBe("compatible");
      }
    }
  });

  test("requires the canonical set-former fence and a positive containment verdict for the universal target", () => {
    const actual = marshalStoredBodyForValidation(systemString);
    const wanted = marshalStoredBodyForValidation({ quantified: [], body: Anything });
    const diagnostic = (code: string) => ({ code, functionId: "<authoring>", message: code });
    const fence: InferenceOutcome = { $tag: "AnnotationRequired",
      diagnostics: [diagnostic("inference.set-former-indeterminate")] };
    const plan = (compatibility: string, outcome?: InferenceOutcome) => dispatchEngineBody(
      "engine:authoringSchemeMatchPlan", [actual, wanted, compatibility, outcome === undefined ? Nothing : Just(outcome)]);
    expect(plan("compatible")).toEqual({ needsInference: true, match: "unavailable" });
    expect(plan("compatible", fence)).toEqual({ needsInference: false, match: "direct" });
    expect(plan("unknown", fence)).toEqual({ needsInference: false, match: "unavailable" });
    expect(plan("incompatible", fence)).toEqual({ needsInference: false, match: "mismatch" });
    expect(plan("compatible", { $tag: "AnnotationRequired",
      diagnostics: [diagnostic("inference.value-dependent-type")] }))
      .toEqual({ needsInference: false, match: "unavailable" });
    expect(plan("compatible", { $tag: "AnnotationRequired", diagnostics: [
      diagnostic("inference.set-former-indeterminate"), diagnostic("inference.unknown-name"),
    ] })).toEqual({ needsInference: false, match: "unavailable" });
    expect(plan("compatible", { $tag: "Invalid",
      diagnostics: [diagnostic("inference.nominal-mismatch")] }))
      .toEqual({ needsInference: false, match: "mismatch" });
    expect(dispatchEngineBody("engine:authoringSchemeMatchPlan", [
      marshalStoredBodyForValidation({ ...systemString, body: { $ref: "String", extra: true } }),
      wanted, "compatible", Just(fence),
    ])).toEqual({ needsInference: false, match: "unavailable" });
  });

  test("limits the universal-target exception to the exact complement-Void representation", () => {
    const fence: InferenceOutcome = { $tag: "AnnotationRequired", diagnostics: [{
      code: "inference.set-former-indeterminate", functionId: "<authoring>", message: "set-former fence",
    }] };
    const otherBodies: FenelType[] = [
      { $ref: "Anything" },
      { $complement: str },
      { $union: [Anything, str] },
      { $intersect: [Anything, Anything] },
      { $record: { fields: [field("value", Anything)] } },
      { $complement: { $void: false } } as unknown as FenelType,
      { $complement: { $void: "true" } } as unknown as FenelType,
      { $complement: { $void: 1 } } as unknown as FenelType,
      { $complement: { $void: {} } } as unknown as FenelType,
      { $complement: { $void: true, extra: true } } as unknown as FenelType,
      { $complement: { $void: true }, extra: true } as unknown as FenelType,
    ];
    for (const body of otherBodies) {
      const plan = dispatchEngineBody("engine:authoringSchemeMatchPlan", [
        marshalStoredBodyForValidation(systemString),
        marshalStoredBodyForValidation({ quantified: [], body }), "compatible", Just(fence),
      ]);
      expect(plan, JSON.stringify(body)).toEqual({ needsInference: false, match: "unavailable" });
    }
  });

  test("universal requirements do not bypass malformed nominal or unreadable scheme carriers", () => {
    const wanted: TypeScheme = { quantified: [], body: Anything };
    const wrongOwnerSpelling: TypeScheme = { ...systemString,
      nominals: [{ path: [], identity: '["system","String"]', publicName: "Number" }] };
    const ownerOnUniversal: TypeScheme = { ...wanted,
      nominals: [{ path: [], identity: '["system","Anything"]', publicName: "Anything" }] };
    for (const [actual, expected] of [[wrongOwnerSpelling, wanted], [systemString, ownerOnUniversal]] as const) {
      expect(canonical(actual, expected).$tag).toBe("Invalid");
      expect(judgeAuthoringSchemeCompatibility(actual, expected)).not.toBe("compatible");
    }
    const hidden = Object.defineProperty({ ...systemString }, "nominals",
      { value: systemString.nominals, enumerable: false });
    expect(judgeAuthoringSchemeCompatibility(hidden, wanted)).not.toBe("compatible");
  });

  test("a failed equation beneath a set former abstains, also inside a record and for Void", () => {
    const record = (type: FenelType): FenelType => ({ $record: { fields: [field("item", type)] } });
    const ownedRecord: TypeScheme = { quantified: [], body: record(str),
      nominals: [{ path: ["$record", "fields", "0", "type"], identity: '["system","String"]', publicName: "String" }] };
    expect(codes(canonical(ownedRecord, { quantified: [], body: record(Anything) }))).toEqual(["inference.set-former-indeterminate"]);
    expect(judgeAuthoringSchemeCompatibility(ownedRecord, record(Anything))).toBe("unknown");
    // Void is contained in every type; String's owner forces the equation.
    const never: TypeScheme = { quantified: [], body: { $void: true } };
    expect(codes(canonical(never, systemString))).toEqual(["inference.set-former-indeterminate"]);
    expect(judgeAuthoringSchemeCompatibility(never, systemString)).toBe("unknown");
    // Same former, different operand order: equal sets that do not unify.
    const left: TypeScheme = { quantified: [], body: { $intersect: [str, Anything] }, nominals: systemString.nominals!.map(item => ({ ...item, path: ["$intersect", "0"] })) };
    const right: TypeScheme = { quantified: [], body: { $intersect: [Anything, str] }, nominals: systemString.nominals!.map(item => ({ ...item, path: ["$intersect", "1"] })) };
    expect(canonical(left, right).$tag).not.toBe("Invalid");
    expect(judgeAuthoringSchemeCompatibility(left, right)).not.toBe("incompatible");
  });

  test("true nominal mismatches beside a set former still refute", () => {
    const item = (identity: string): TypeScheme => ({
      quantified: [], body: { $ref: "Item" }, nominals: [{ path: [], identity, publicName: "Item" }],
    });
    expect(codes(canonical(item("owner-A"), item("owner-B")))).toContain("inference.nominal-mismatch");
    expect(judgeAuthoringSchemeCompatibility(item("owner-A"), item("owner-B"))).toBe("incompatible");
    const systemNumber: TypeScheme = { quantified: [], body: num, nominals: [{ path: [], identity: '["system","Number"]', publicName: "Number" }] };
    expect(judgeAuthoringSchemeCompatibility(systemString, systemNumber)).toBe("incompatible");
    // Constructor formers keep their refutation: a Number is not a Maybe even
    // where broad containment is undecided.
    const maybeNumber: TypeScheme = {
      quantified: [], body: { $el: { call: ["Maybe", num] } },
      applications: [{ path: [], headRef: "Maybe", args: [num], kind: {
        $tag: "KArrow", input: { $tag: "KType" }, output: { $tag: "KType" },
      } }],
      nominals: [{ path: [], identity: '["system","Maybe"]', publicName: "Maybe" }],
    };
    expect(codes(canonical(systemNumber, maybeNumber))).toContain("inference.constructor-mismatch");
    expect(judgeAuthoringSchemeCompatibility(systemNumber, maybeNumber)).toBe("incompatible");
  });

  test("a sibling refutation wins over a set-former abstention, in either field order", () => {
    // One field truly conflicts (two declarations of Item); the other is a
    // set former the equation cannot decide. The record is refuted whichever
    // field the walk meets first.
    const record = (itemFirst: boolean, other: FenelType, identity: string): TypeScheme => {
      const item = field("item", { $ref: "Item" }, itemFirst ? 0 : 1);
      const value = field("value", other, itemFirst ? 1 : 0);
      return { quantified: [], body: { $record: { fields: itemFirst ? [item, value] : [value, item] } },
        nominals: [{ path: ["$record", "fields", itemFirst ? "0" : "1", "type"], identity, publicName: "Item" }] };
    };
    for (const itemFirst of [true, false]) {
      const actual = record(itemFirst, str, "owner-A");
      const wanted = record(itemFirst, Anything, "owner-B");
      expect(codes(canonical(actual, wanted))).toEqual(["inference.nominal-mismatch"]);
      expect(judgeAuthoringSchemeCompatibility(actual, wanted)).toBe("incompatible");
      // Without the conflict, the set former alone abstains.
      expect(codes(canonical(actual, record(itemFirst, Anything, "owner-A")))).toEqual(["inference.set-former-indeterminate"]);
    }
  });

  test("every set former abstains, at and beneath the former", () => {
    const owned = (body: FenelType, paths: string[][], name: string): TypeScheme => ({
      quantified: [], body, nominals: paths.map(path => ({ path, identity: `["system","${name}"]`, publicName: name })),
    });
    // Same former, inner nominal disagreement: not Number and not String.
    expect(codes(canonical(owned({ $complement: num }, [["$complement"]], "Number"), owned({ $complement: str }, [["$complement"]], "String"))))
      .toEqual(["inference.set-former-indeterminate"]);
    // Same former, operands reordered: String and Number equals Number and String.
    const names = new Map<FenelType, string>([[str, "String"], [num, "Number"], [bool, "Boolean"]]);
    const both = (first: FenelType, second: FenelType, under: string[] = []): TypeScheme => ({
      quantified: [], body: { $intersect: under.length === 0 ? [first, second] : [{ $complement: first }, { $complement: second }] },
      nominals: [first, second].map((operand, index) => ({ path: ["$intersect", String(index), ...under],
        identity: `["system","${names.get(operand)}"]`, publicName: names.get(operand)! })),
    });
    expect(codes(canonical(both(str, num), both(num, str)))).toEqual(["inference.set-former-indeterminate"]);
    // The same reorder over inhabited operands: not Number and not Boolean.
    const negated = [["$complement"]].flat();
    expect(codes(canonical(both(num, bool, negated), both(bool, num, negated)))).toEqual(["inference.set-former-indeterminate"]);
    expect(judgeAuthoringSchemeCompatibility(both(num, bool, negated), both(bool, num, negated))).not.toBe("incompatible");
    // An intersection against a nominal: String and Anything is String.
    const meet: TypeScheme = { quantified: [], body: { $intersect: [str, Anything] } };
    expect(codes(canonical(meet, systemString))).toEqual(["inference.set-former-indeterminate"]);
    expect(judgeAuthoringSchemeCompatibility(meet, systemString)).not.toBe("incompatible");
  });

  test("malformed type data keeps its own diagnostic beside a set former", () => {
    const state = dispatchEngineBody("engine:inferenceInitialState", ["malformed"]);
    const malformed = { tag: "ItBogus" };
    const top = { tag: "ItComplement", inner: { tag: "ItVoid" } };
    for (const [left, right] of [[malformed, top], [top, malformed]]) {
      const result = dispatchEngineBody("engine:inferenceUnify", [left, right, state, "malformed"]) as { $tag: string; _0?: { code?: string } };
      expect(result.$tag).toBe("Err");
      expect(result._0?.code).toBe("inference.malformed-type");
    }
  });
});
