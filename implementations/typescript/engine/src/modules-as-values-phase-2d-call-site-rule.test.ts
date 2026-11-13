// modules-as-values Phase 2d, slice S2 — the call-site type rule.
//
// `engine:inferCallSiteInstance` (inference.fenel) decides which class
// application a class-qualified, fully applied method call needs from its
// argument evidence and its written result type; the registry's call-site
// hooks resolve written types lexically, reflect runtime values, project
// solved nominals to legacy instance keys and check membership strictly.
import { beforeAll, describe, expect, test } from "bun:test";

import { createRegistry, type ModuleRegistry } from "./registry";
import {
  attachCallSitePreludeNominals,
  callSiteNominalGroundType,
  createCallSiteTypingHooks,
  inferCallSiteInstance,
  resolveCallSiteGroundType,
  type CallSiteGroundType,
  type CallSiteInferenceOutcome,
  type CallSiteNominalEntity,
  type CallSiteNominalFrame,
  type CallSiteNominalResolution,
} from "./signature-inference";
import { getSystemRegistry } from "./system-registry";
import type { FenelModule, FenelType, FieldDef, Kind, TypeScheme } from "./types";

const NOTHING = { $tag: "Nothing" } as const;
const K_TYPE: Kind = { $tag: "KType" };
const K_BINARY: Kind = {
  $tag: "KArrow",
  input: K_TYPE,
  output: { $tag: "KArrow", input: K_TYPE, output: K_TYPE },
};
const STRING = '["system","String"]';
const INT = '["system","Int"]';
const RESULT = '["system","Result"]';
const JSON_VALUE = '["codec","JsonValue"]';
// A test-only owner identity: the rule never consults the registry, so an
// unregistered owner is as good as any for the pure-rule cases.
const BYTES = '["test","Bytes"]';

const ref = (name: string): FenelType => ({ $ref: name });
const positional = (index: number, type: FenelType): FieldDef => ({
  name: `_${index}`,
  key: { $tag: "PositionalField", index },
  label: NOTHING,
  type,
  meta: {},
  ui: NOTHING,
});
const named = (name: string, ordinal: number, type: FenelType): FieldDef => ({
  name,
  key: {
    $tag: "NamedField",
    ref: { $ref: `2d2d2d2d-0000-4000-8000-${String(ordinal).padStart(12, "0")}` },
  },
  label: NOTHING,
  type,
  meta: {},
  ui: NOTHING,
});
/** The parser-canonical structural `Result e a` (`Err p:0 | Ok p:0`). */
const resultOf = (err: FenelType, ok: FenelType): FenelType => ({
  $variant: {
    cases: [
      { name: "Err", label: NOTHING, fields: [positional(0, err)] },
      { name: "Ok", label: NOTHING, fields: [positional(0, ok)] },
    ],
  },
} as FenelType);
const maybeOf = (value: FenelType): FenelType => ({
  $variant: {
    cases: [
      { name: "Nothing", label: NOTHING, fields: [] },
      { name: "Just", label: NOTHING, fields: [positional(0, value)] },
    ],
  },
} as FenelType);
const arrow = (params: readonly FenelType[], returns: FenelType): FenelType => ({
  $arrow: { params: params.map((type, index) => positional(index, type)), returns },
});
const errPath = ["$variant", "cases", "0", "fields", "0", "type"];
const okPath = ["$variant", "cases", "1", "fields", "0", "type"];
const nominal = (path: readonly string[], identity: string, publicName: string) => ({
  path: [...path],
  identity,
  publicName,
});
const ground = (
  body: FenelType,
  nominals: ReturnType<typeof nominal>[] = [],
  applications: NonNullable<TypeScheme["applications"]> = [],
): CallSiteGroundType => ({
  quantified: [],
  body,
  ...(nominals.length === 0 ? {} : { nominals }),
  ...(applications.length === 0 ? {} : { applications }),
});
const groundResult = (
  errName: string,
  errIdentity: string,
  okName: string,
  okIdentity: string,
): CallSiteGroundType => ground(resultOf(ref(errName), ref(okName)), [
  nominal(errPath, errIdentity, errName),
  nominal(okPath, okIdentity, okName),
]);
const stringType = callSiteNominalGroundType(STRING, "String");
const intType = callSiteNominalGroundType(INT, "Int");
const bytesType = callSiteNominalGroundType(BYTES, "Bytes");

const variable = (id: string, sourceName: string) => ({ id, sourceName, kind: K_TYPE });
const returnsPath = ["$arrow", "returns"];

/** The honest `Iso s a` decode method: `s -> Result String a`, with the class
 * parameters quantified in header order (the parser's structural Result). */
const isoDecodeScheme: TypeScheme = {
  quantified: [variable("Iso:s", "s"), variable("Iso:a", "a")],
  body: arrow([{ $var: "s" }], resultOf(ref("String"), { $var: "a" })),
  nominals: [nominal([...returnsPath, ...errPath], STRING, "String")],
};
/** The same method with `Result` kept as a nominal application. */
const isoDecodeAppScheme: TypeScheme = {
  quantified: [variable("IsoApp:s", "s"), variable("IsoApp:a", "a")],
  body: arrow([{ $var: "s" }], { $el: { call: ["Result", ref("String"), { $var: "a" }] } }),
  applications: [{
    path: [...returnsPath],
    headRef: "Result",
    args: [ref("String"), { $var: "a" }],
    kind: K_BINARY,
  }],
  nominals: [
    nominal(returnsPath, RESULT, "Result"),
    nominal([...returnsPath, "$el", "call", "1"], STRING, "String"),
  ],
};
/** A one-parameter class whose argument slot is fixed by the result type. */
const roundtripScheme: TypeScheme = {
  quantified: [variable("Roundtrip:a", "a")],
  body: arrow([{ $var: "a" }], resultOf(ref("String"), { $var: "a" })),
  nominals: [nominal([...returnsPath, ...errPath], STRING, "String")],
};
/** A method with a concrete (non-class) parameter type. */
const concreteScheme: TypeScheme = {
  quantified: [variable("Concrete:a", "a")],
  body: arrow([ref("String")], { $var: "a" }),
  nominals: [nominal(["$arrow", "params", "0", "type"], STRING, "String")],
};

function solved(outcome: CallSiteInferenceOutcome) {
  if (outcome.$tag !== "Solved") throw new Error(`expected Solved: ${JSON.stringify(outcome)}`);
  return outcome;
}
function rejectedCodes(outcome: CallSiteInferenceOutcome): string[] {
  if (outcome.$tag !== "Rejected") throw new Error(`expected Rejected: ${JSON.stringify(outcome)}`);
  return outcome.diagnostics.map((diagnostic) => diagnostic.code);
}
const classParameters = (outcome: CallSiteInferenceOutcome) =>
  solved(outcome).classParameters.map(({ name, identity, publicName }) => ({ name, identity, publicName }));

let system: ModuleRegistry;

// Warm the engine bootstrap harness and the system registry once: the first
// dispatch of a freshly edited inference.fenel re-parses it.
beforeAll(() => {
  inferCallSiteInstance({ scheme: roundtripScheme, arguments: [undefined], path: "warm" });
  system = getSystemRegistry();
}, 900_000);

describe("the Fenel call-site rule (engine:inferCallSiteInstance)", () => {
  test("Iso.decode s : Result String Bytes fixes s = String and a = Bytes", () => {
    const outcome = inferCallSiteInstance({
      scheme: isoDecodeScheme,
      arguments: [stringType],
      expected: groundResult("String", STRING, "Bytes", BYTES),
      path: "iso-bytes",
    });
    expect(classParameters(outcome)).toEqual([
      { name: "s", identity: STRING, publicName: "String" },
      { name: "a", identity: BYTES, publicName: "Bytes" },
    ]);
    const { argumentTypes, resultType, classParameters: rows } = solved(outcome);
    expect(argumentTypes).toHaveLength(1);
    expect(argumentTypes[0]!.body).toEqual(ref("String"));
    expect(argumentTypes[0]!.nominals).toEqual([{ path: [], identity: STRING, publicName: "String" }]);
    expect(resultType.body).toEqual(resultOf(ref("String"), ref("Bytes")));
    expect(resultType.nominals).toEqual([
      nominal(errPath, STRING, "String"),
      nominal(okPath, BYTES, "Bytes"),
    ]);
    expect(rows[1]!.type).toEqual(bytesType);
  }, 180_000);

  test("the same call written : Result String JsonValue fixes a = JsonValue", () => {
    const outcome = inferCallSiteInstance({
      scheme: isoDecodeScheme,
      arguments: [stringType],
      expected: groundResult("String", STRING, "JsonValue", JSON_VALUE),
    });
    expect(classParameters(outcome)).toEqual([
      { name: "s", identity: STRING, publicName: "String" },
      { name: "a", identity: JSON_VALUE, publicName: "JsonValue" },
    ]);
  }, 180_000);

  test("a nominal Result application in the scheme meets a structural written Result", () => {
    const outcome = inferCallSiteInstance({
      scheme: isoDecodeAppScheme,
      arguments: [stringType],
      expected: groundResult("String", STRING, "Bytes", BYTES),
    });
    expect(classParameters(outcome).map(({ identity }) => identity)).toEqual([STRING, BYTES]);
  }, 180_000);

  test("an expected type contradicting the method is rejected", () => {
    const maybeBytes = ground(maybeOf(ref("Bytes")), [
      nominal(["$variant", "cases", "1", "fields", "0", "type"], BYTES, "Bytes"),
    ]);
    expect(rejectedCodes(inferCallSiteInstance({
      scheme: isoDecodeScheme,
      arguments: [stringType],
      expected: maybeBytes,
    }))).toEqual(["inference.constructor-mismatch"]);
    expect(rejectedCodes(inferCallSiteInstance({
      scheme: isoDecodeScheme,
      arguments: [stringType],
      expected: groundResult("Int", INT, "Bytes", BYTES),
    }))).toEqual(["inference.nominal-mismatch"]);
  }, 180_000);

  test("without an expected type the parameters nothing fixes are named, never guessed", () => {
    expect(inferCallSiteInstance({ scheme: isoDecodeScheme, arguments: [stringType] }))
      .toEqual({ $tag: "Unfixed", parameters: ["a"] });
    expect(inferCallSiteInstance({ scheme: isoDecodeScheme, arguments: [undefined] }))
      .toEqual({ $tag: "Unfixed", parameters: ["s", "a"] });
    expect(inferCallSiteInstance({
      scheme: isoDecodeScheme,
      arguments: [undefined],
      expected: groundResult("String", STRING, "Bytes", BYTES),
    })).toEqual({ $tag: "Unfixed", parameters: ["s"] });
  }, 180_000);

  test("an unknown argument whose slot the context solves reports its solved type", () => {
    const outcome = inferCallSiteInstance({
      scheme: roundtripScheme,
      arguments: [undefined],
      expected: groundResult("String", STRING, "JsonValue", JSON_VALUE),
    });
    expect(classParameters(outcome)).toEqual([
      { name: "a", identity: JSON_VALUE, publicName: "JsonValue" },
    ]);
    expect(solved(outcome).argumentTypes).toEqual([
      callSiteNominalGroundType(JSON_VALUE, "JsonValue"),
    ]);
  }, 180_000);

  test("a class parameter solved to an application or a structural type is rejected", () => {
    const maybeInt = ground(resultOf(ref("String"), maybeOf(ref("Int"))), [
      nominal(errPath, STRING, "String"),
      nominal([...okPath, "$variant", "cases", "1", "fields", "0", "type"], INT, "Int"),
    ]);
    expect(rejectedCodes(inferCallSiteInstance({
      scheme: isoDecodeScheme,
      arguments: [stringType],
      expected: maybeInt,
    }))).toEqual(["call-site.non-nominal-parameter"]);
    const listInt = ground(
      resultOf(ref("String"), { $el: { call: ["List", ref("Int")] } }),
      [
        nominal(errPath, STRING, "String"),
        nominal(okPath, '["system","List"]', "List"),
        nominal([...okPath, "$el", "call", "1"], INT, "Int"),
      ],
      [{
        path: [...okPath],
        headRef: "List",
        args: [ref("Int")],
        kind: { $tag: "KArrow", input: K_TYPE, output: K_TYPE },
      }],
    );
    const outcome = inferCallSiteInstance({
      scheme: isoDecodeScheme,
      arguments: [stringType],
      expected: listInt,
    });
    expect(rejectedCodes(outcome)).toEqual(["call-site.non-nominal-parameter"]);
    if (outcome.$tag === "Rejected") expect(outcome.diagnostics[0]!.message).toContain(": a");
  }, 180_000);

  test("argument evidence is unified with its declared parameter", () => {
    expect(classParameters(inferCallSiteInstance({
      scheme: concreteScheme,
      arguments: [stringType],
      expected: intType,
    }))).toEqual([{ name: "a", identity: INT, publicName: "Int" }]);
    expect(rejectedCodes(inferCallSiteInstance({
      scheme: concreteScheme,
      arguments: [intType],
      expected: intType,
    }))).toEqual(["inference.nominal-mismatch"]);
  }, 180_000);

  test("only an exact full application is typed", () => {
    expect(rejectedCodes(inferCallSiteInstance({
      scheme: isoDecodeScheme,
      arguments: [stringType, stringType],
    }))).toEqual(["call-site.arity"]);
    expect(rejectedCodes(inferCallSiteInstance({
      scheme: isoDecodeScheme,
      arguments: [],
    }))).toEqual(["call-site.arity"]);
  }, 180_000);

  test("the boundary fails closed on non-ground or incomplete evidence", () => {
    // A free type variable in written evidence.
    expect(inferCallSiteInstance({
      scheme: isoDecodeScheme,
      arguments: [ground({ $var: "x" })],
    }).$tag).toBe("Rejected");
    // A type application without its application sidecar.
    expect(inferCallSiteInstance({
      scheme: isoDecodeScheme,
      arguments: [stringType],
      expected: ground({ $el: { call: ["Result", ref("String"), ref("Bytes")] } }),
    }).$tag).toBe("Rejected");
    // A quantified "ground" type.
    expect(rejectedCodes(inferCallSiteInstance({
      scheme: isoDecodeScheme,
      arguments: [{ quantified: [variable("x", "x")], body: { $var: "x" } }],
    }))).toEqual(["call-site.marshal"]);
    // A nominal sidecar that disagrees with the spelling it annotates.
    expect(rejectedCodes(inferCallSiteInstance({
      scheme: isoDecodeScheme,
      arguments: [ground(ref("String"), [nominal([], STRING, "Text")])],
    }))).toEqual(["call-site.marshal"]);
  }, 180_000);

  test("a raw-spelled String in a scheme meets the system String owner", () => {
    const rawScheme: TypeScheme = {
      quantified: [variable("Raw:a", "a")],
      body: arrow([ref("String")], { $var: "a" }),
    };
    expect(classParameters(inferCallSiteInstance({
      scheme: rawScheme,
      arguments: [stringType],
      expected: intType,
    }))).toEqual([{ name: "a", identity: INT, publicName: "Int" }]);
    // A raw-spelled non-scalar is its spelling only: it never meets an owner.
    const rawErrorScheme: TypeScheme = {
      quantified: [variable("RawErr:a", "a")],
      body: arrow([{ $var: "a" }], resultOf(ref("MigrationError"), { $var: "a" })),
    };
    expect(rejectedCodes(inferCallSiteInstance({
      scheme: rawErrorScheme,
      arguments: [intType],
      expected: groundResult("MigrationError", '["system","MigrationError"]', "Int", INT),
    }))).toEqual(["inference.nominal-mismatch"]);
  }, 180_000);

  test("the call-site view of a scheme owns its unowned system spellings, and nothing else", () => {
    const MIGRATION_ERROR = '["system","MigrationError"]';
    const prelude = (spelling: string): string | undefined =>
      spelling === "MigrationError" || spelling === "String" || spelling === "Result"
        ? `["system","${spelling}"]`
        : undefined;
    const errType = [...returnsPath, ...errPath];
    const scheme: TypeScheme = {
      quantified: [variable("View:a", "a")],
      body: arrow(
        [ref("Foreign"), ref("other.MigrationError")],
        resultOf(
          ref("MigrationError"),
          // A `$mu` binder shadows the prelude spelling it reuses.
          { $mu: { var: "String", body: maybeOf(ref("String")) } } as FenelType,
        ),
      ),
      // An owner the declaration frame already chose is never replaced.
      nominals: [nominal(["$arrow", "params", "0", "type"], '["x","Foreign"]', "Foreign")],
    };
    const viewed = attachCallSitePreludeNominals(scheme, prelude);
    expect(viewed.body).toBe(scheme.body);
    expect(viewed.nominals).toEqual([
      nominal(["$arrow", "params", "0", "type"], '["x","Foreign"]', "Foreign"),
      nominal(errType, MIGRATION_ERROR, "MigrationError"),
    ]);
    // An application head is owned exactly as a bare reference is.
    const applied = attachCallSitePreludeNominals(isoDecodeAppScheme, prelude);
    expect(applied.nominals).toEqual(isoDecodeAppScheme.nominals);
    const unowned: TypeScheme = { ...isoDecodeAppScheme, nominals: [] };
    expect(attachCallSitePreludeNominals(unowned, prelude).nominals).toEqual([
      nominal([...returnsPath, "$el", "call", "1"], STRING, "String"),
      nominal(returnsPath, RESULT, "Result"),
    ]);
    // Nothing to own: the very same scheme object.
    expect(attachCallSitePreludeNominals(concreteScheme, prelude)).toBe(concreteScheme);
    // The owned view is what makes a std method meet its written type.
    const owned = attachCallSitePreludeNominals({
      quantified: [variable("Owned:a", "a")],
      body: arrow([{ $var: "a" }], resultOf(ref("MigrationError"), { $var: "a" })),
    }, prelude);
    expect(classParameters(inferCallSiteInstance({
      scheme: owned,
      arguments: [intType],
      expected: groundResult("MigrationError", MIGRATION_ERROR, "Int", INT),
    }))).toEqual([{ name: "a", identity: INT, publicName: "Int" }]);
  }, 180_000);
});

describe("registry call-site hooks (system registry)", () => {
  test("one frozen bundle, on the registry and on every evaluation context", () => {
    const hooks = system.callSiteTyping;
    expect(Object.isFrozen(hooks)).toBe(true);
    expect(system.evaluateContext()._callSiteTyping).toBe(hooks);
    expect(system.evaluateContext()._callSiteTyping).toBe(hooks);
  }, 180_000);

  test("methodScheme publishes only Solved registry schemes", () => {
    const hooks = system.callSiteTyping;
    expect(hooks.methodScheme("NoSuchClass.method")).toMatchObject({ ok: false, reason: "missing" });
    const solvedRow = system.listCapabilityMethodSignatures().find((row) =>
      row.outcome.$tag === "Solved" && row.scheme?.quantified.length === 1);
    expect(solvedRow).toBeDefined();
    const published = hooks.methodScheme(solvedRow!.targetId);
    expect(published).toMatchObject({
      ok: true,
      classParameters: solvedRow!.scheme!.quantified.map((variable) => variable.sourceName),
    });
    const fencedRow = system.listCapabilityMethodSignatures().find((row) =>
      row.outcome.$tag !== "Solved");
    if (fencedRow !== undefined) {
      expect(hooks.methodScheme(fencedRow.targetId)).toMatchObject({ ok: false, reason: "fenced" });
    }
  }, 180_000);

  test("Encodable.encode, when its scheme is published, is typed by its argument and result", () => {
    const hooks = system.callSiteTyping;
    const published = hooks.methodScheme("Encodable.encode");
    if (!published.ok) {
      expect(published.reason).toBe("fenced");
      return;
    }
    expect(published.classParameters).toEqual(["s", "a"]);
    const jsonValue = hooks.resolveType(ref("JsonValue"), "codec:jsonDecode");
    const expected = hooks.resolveType(
      { $el: { call: ["Result", ref("String"), ref("String")] } },
      "codec:jsonDecode",
    );
    if (!jsonValue.ok || !expected.ok) throw new Error("codec types must resolve in codec");
    const outcome = hooks.infer({
      scheme: published.scheme,
      arguments: [jsonValue.type],
      expected: expected.type,
    });
    expect(classParameters(outcome).map(({ name, identity }) => [name, identity])).toEqual([
      ["s", STRING],
      ["a", JSON_VALUE],
    ]);
  }, 180_000);

  test("Iso.decode and Decodable.decode, when published, take their instance from the written type", () => {
    const hooks = system.callSiteTyping;
    const resolve = (type: FenelType): CallSiteGroundType => {
      const resolution = hooks.resolveType(type, "codec:jsonDecode");
      if (!resolution.ok) throw new Error(JSON.stringify(resolution));
      return resolution.type;
    };
    const iso = hooks.methodScheme("Iso.decode");
    if (!iso.ok) {
      expect(iso.reason).toBe("fenced");
    } else {
      expect(iso.classParameters).toEqual(["s", "a"]);
      const argument = hooks.reflect("eyJhIjoxfQ==");
      if (argument?.type === undefined) throw new Error("a String value reflects to String");
      // The parser lowers `Result String JsonValue` to the structural variant.
      const outcome = hooks.infer({
        scheme: iso.scheme,
        arguments: [argument.type],
        expected: resolve(resultOf(ref("String"), ref("JsonValue"))),
      });
      expect(classParameters(outcome).map(({ name, identity }) => [name, identity])).toEqual([
        ["s", STRING],
        ["a", JSON_VALUE],
      ]);
      expect(solved(outcome).classParameters.map((row) => hooks.legacyKey(row)))
        .toEqual([{ ok: true, key: "String" }, { ok: true, key: "JsonValue" }]);
      // No written type: the argument fixes `s`, nothing fixes `a`.
      expect(hooks.infer({ scheme: iso.scheme, arguments: [argument.type] }))
        .toEqual({ $tag: "Unfixed", parameters: ["a"] });
      // A written result the method cannot return.
      expect(rejectedCodes(hooks.infer({
        scheme: iso.scheme,
        arguments: [argument.type],
        expected: resolve(maybeOf(ref("JsonValue"))),
      }))).toEqual(["inference.constructor-mismatch"]);
      expect(rejectedCodes(hooks.infer({
        scheme: iso.scheme,
        arguments: [argument.type],
        expected: resolve(resultOf(ref("Int"), ref("JsonValue"))),
      }))).toEqual(["inference.nominal-mismatch"]);
    }
    const decodable = hooks.methodScheme("Decodable.decode");
    if (!decodable.ok) {
      expect(decodable.reason).toBe("fenced");
      return;
    }
    const expected = resolve(resultOf(ref("String"), ref("Int")));
    const outcome = hooks.infer({
      scheme: decodable.scheme,
      arguments: [resolve(ref("JsonValue"))],
      expected,
    });
    expect(solved(outcome).classParameters.map((row) => hooks.legacyKey(row)))
      .toEqual([{ ok: true, key: "JsonValue" }, { ok: true, key: "Int" }]);
    expect(hooks.member(solved(outcome).resultType, { $tag: "Ok", _0: 3 }, null)).toBe("yes");
    expect(hooks.member(solved(outcome).resultType, { $tag: "Ok", _0: 3.5 }, null)).toBe("no");
  }, 180_000);

  test("methodScheme gives a std class's spelling-only system names their owners", () => {
    const hooks = system.callSiteTyping;
    const published = hooks.methodScheme("Migration.forward");
    if (!published.ok) {
      expect(published.reason).toBe("fenced");
      return;
    }
    const errType = [...returnsPath, ...errPath];
    // The registry publishes `MigrationError` as a spelling (its std source
    // frame owns no system type); the call-site view owns it.
    const registered = system.getCapabilityMethodSignature("Migration.forward");
    expect((registered?.scheme?.nominals ?? []).some((row) =>
      JSON.stringify(row.path) === JSON.stringify(errType))).toBe(false);
    expect(published.scheme.nominals).toContainEqual(
      nominal(errType, '["system","MigrationError"]', "MigrationError"),
    );
    expect(published.classParameters).toEqual(["v1", "v2"]);

    const source = "migration:profileDemoV1ToV2";
    const resolve = (type: FenelType): CallSiteGroundType => {
      const resolution = hooks.resolveType(type, source);
      if (!resolution.ok) throw new Error(JSON.stringify(resolution));
      return resolution.type;
    };
    const expected = resolve(resultOf(ref("MigrationError"), ref("ProfileDemoV2")));
    const outcome = hooks.infer({
      scheme: published.scheme,
      arguments: [resolve(ref("ProfileDemoV1"))],
      expected,
    });
    expect(solved(outcome).classParameters.map((row) => hooks.legacyKey(row))).toEqual([
      { ok: true, key: "ProfileDemoV1" },
      { ok: true, key: "ProfileDemoV2" },
    ]);
    // Strict membership decides the migration's wire values.
    const profile = { firstName: "Ada", lastName: "Lovelace", email: "" };
    expect(hooks.member(expected, { $tag: "Ok", _0: profile }, null)).toBe("yes");
    expect(hooks.member(expected, { $tag: "Err", _0: { $tag: "FieldMissing", field: "email" } }, null))
      .toBe("yes");
    expect(hooks.member(expected, { $tag: "Ok", _0: { firstName: "Ada" } }, null)).toBe("no");
    expect(hooks.member(expected, { $tag: "Err", _0: { $tag: "NotAMigrationError" } }, null)).toBe("no");
  }, 180_000);

  test("resolveType is lexical: the source module, then the system prelude", () => {
    const hooks = system.callSiteTyping;
    const inCodec = hooks.resolveType(ref("JsonValue"), "codec:jsonDecode");
    expect(inCodec).toEqual({
      ok: true,
      type: callSiteNominalGroundType(JSON_VALUE, "JsonValue"),
    });
    const result = hooks.resolveType(
      { $el: { call: ["Result", ref("String"), ref("JsonValue")] } },
      "codec:jsonDecode",
    );
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.type.applications).toEqual([{
      path: [],
      headRef: "Result",
      args: [ref("String"), ref("JsonValue")],
      kind: K_BINARY,
    }]);
    // Sidecar rows are ordered by their occurrence key, as registry schemes are.
    expect(result.type.nominals).toEqual([
      nominal(["$el", "call", "1"], STRING, "String"),
      nominal(["$el", "call", "2"], JSON_VALUE, "JsonValue"),
      nominal([], RESULT, "Result"),
    ]);
    expect(hooks.resolveType(ref("Result"), "codec:jsonDecode"))
      .toMatchObject({ ok: false, reason: "malformed", spelling: "Result" });
    expect(hooks.resolveType({ $el: { call: ["Result", ref("String")] } }, "codec:jsonDecode"))
      .toMatchObject({ ok: false, reason: "malformed", spelling: "Result" });
    expect(hooks.resolveType({ $var: "a" }, "codec:jsonDecode"))
      .toMatchObject({ ok: false, reason: "malformed" });
    expect(hooks.resolveType(ref("JsonValue"), "no-such:function"))
      .toMatchObject({ ok: false, reason: "missing", spelling: "JsonValue" });
  }, 180_000);

  test("detached resolution admits exact qualification and the system scalars only", () => {
    const hooks = system.callSiteTyping;
    expect(hooks.resolveType(ref("String"), undefined))
      .toEqual({ ok: true, type: stringType });
    expect(hooks.resolveType(ref("Int"), undefined))
      .toEqual({ ok: true, type: intType });
    expect(hooks.resolveType(ref("Boolean"), undefined))
      .toEqual({ ok: true, type: callSiteNominalGroundType('["system","Boolean"]', "Boolean") });
    expect(hooks.resolveType(ref("Number"), undefined))
      .toEqual({ ok: true, type: callSiteNominalGroundType('["system","Number"]', "Number") });
    // A non-scalar system type needs a source frame (or qualification).
    expect(hooks.resolveType(ref("MigrationError"), undefined))
      .toMatchObject({ ok: false, reason: "missing", spelling: "MigrationError" });
    expect(hooks.resolveType(resultOf(ref("String"), ref("Int")), undefined))
      .toMatchObject({ ok: true });
    expect(hooks.resolveType(ref("codec.JsonValue"), undefined)).toEqual({
      ok: true,
      type: callSiteNominalGroundType(JSON_VALUE, "codec.JsonValue"),
    });
    expect(hooks.resolveType(ref("JsonValue"), undefined))
      .toMatchObject({ ok: false, reason: "missing", spelling: "JsonValue" });
    expect(hooks.resolveType({ $el: { call: ["Result", ref("String"), ref("Int")] } }, undefined))
      .toMatchObject({ ok: false, reason: "missing", spelling: "Result" });
    expect(hooks.resolveType(ref("NoSuchModule.JsonValue"), "codec:jsonDecode"))
      .toMatchObject({ ok: false, reason: "missing" });
  }, 180_000);

  test("reflect names registered owners and nothing else", () => {
    const hooks = system.callSiteTyping;
    expect(hooks.reflect("text")).toEqual({ identity: STRING, publicName: "String", type: stringType });
    expect(hooks.reflect(4)?.identity).toBe('["system","Number"]');
    expect(hooks.reflect(true)?.identity).toBe('["system","Boolean"]');
    const list = hooks.reflect([1, 2]);
    expect(list?.identity).toBe('["system","List"]');
    expect(list?.type).toBeUndefined();
    expect(hooks.reflect({ $tag: "JsonString", value: "x" })).toEqual({
      identity: JSON_VALUE,
      publicName: "JsonValue",
      type: callSiteNominalGroundType(JSON_VALUE, "JsonValue"),
    });
    expect(hooks.reflect({ key: "k", value: { $tag: "JsonNull" } })).toBeUndefined();
    expect(hooks.reflect(new Uint8Array([1, 2]))).toBeUndefined();
    expect(hooks.reflect(null)).toBeUndefined();
    expect(hooks.reflect(undefined)).toBeUndefined();
    expect(hooks.reflect({ $tag: "NoSuchConstructorAnywhere" })).toBeUndefined();
  }, 180_000);

  test("legacyKey projects a resolved owner to its instance-key spelling", () => {
    const hooks = system.callSiteTyping;
    expect(hooks.legacyKey({ identity: JSON_VALUE, publicName: "JsonValue" }))
      .toEqual({ ok: true, key: "JsonValue" });
    expect(hooks.legacyKey({ identity: JSON_VALUE, publicName: "codec.JsonValue" }))
      .toEqual({ ok: true, key: "JsonValue" });
    expect(hooks.legacyKey({ identity: STRING, publicName: "String" }))
      .toEqual({ ok: true, key: "String" });
    expect(hooks.legacyKey({ identity: BYTES, publicName: "Bytes" }).ok).toBe(false);
    expect(hooks.legacyKey({ identity: "String", publicName: "String" }).ok).toBe(false);
  }, 180_000);

  test("member is strict membership: yes, no, or unknown", () => {
    const hooks = system.callSiteTyping;
    const resolve = (type: FenelType, source?: string): CallSiteGroundType => {
      const resolution = hooks.resolveType(type, source);
      if (!resolution.ok) throw new Error(JSON.stringify(resolution));
      return resolution.type;
    };
    const member = (type: CallSiteGroundType, value: unknown) => hooks.member(type, value, null);
    const jsonString = { $tag: "JsonString", value: "x" };

    expect(member(stringType, "abc")).toBe("yes");
    expect(member(stringType, 5)).toBe("no");
    expect(member(intType, 5)).toBe("yes");
    expect(member(intType, 5.5)).toBe("no");
    expect(member(intType, "5")).toBe("no");

    const jsonValue = resolve(ref("JsonValue"), "codec:jsonDecode");
    expect(member(jsonValue, jsonString)).toBe("yes");
    expect(member(jsonValue, { $tag: "JsonNull" })).toBe("yes");
    expect(member(jsonValue, { $tag: "JsonBool", value: 3 })).toBe("no");
    expect(member(jsonValue, { $tag: "Nope" })).toBe("no");
    expect(member(jsonValue, "raw")).toBe("no");

    const resultJson = resolve(
      { $el: { call: ["Result", ref("String"), ref("JsonValue")] } },
      "codec:jsonDecode",
    );
    expect(member(resultJson, { $tag: "Ok", _0: jsonString })).toBe("yes");
    expect(member(resultJson, { $tag: "Err", _0: "bad" })).toBe("yes");
    expect(member(resultJson, { $tag: "Ok", _0: "raw" })).toBe("no");
    expect(member(resultJson, jsonString)).toBe("no");
    // The structural spelling of the same written type decides identically.
    const structural = resolve(resultOf(ref("String"), ref("JsonValue")), "codec:jsonDecode");
    expect(member(structural, { $tag: "Ok", _0: jsonString })).toBe("yes");
    expect(member(structural, { $tag: "Ok", _0: 1 })).toBe("no");

    const resultInt = resolve(resultOf(ref("String"), ref("Int")), "codec:jsonDecode");
    expect(member(resultInt, { $tag: "Ok", _0: 3 })).toBe("yes");
    expect(member(resultInt, { $tag: "Ok", _0: 3.5 })).toBe("no");
    expect(member(resultInt, { $tag: "Err", _0: 3 })).toBe("no");

    // A list field is a JS array at run time, and the judgment does not read
    // the List host carrier (tcb-ledger row mem.ctor: runtime pattern matching
    // does not read it either), so a JSON array or object is undecided, never
    // a false yes or no. A field that is no list at all is still refuted.
    // FOLLOW-UP: runtime pattern matching and the compilers must read the List
    // host carrier before membership may.
    expect(member(jsonValue, { $tag: "JsonArray", items: [jsonString] })).toBe("unknown");
    expect(member(jsonValue, { $tag: "JsonArray", items: [] })).toBe("unknown");
    expect(member(jsonValue, { $tag: "JsonObject", pairs: [{ key: "k", value: jsonString }] }))
      .toBe("unknown");
    expect(member(jsonValue, { $tag: "JsonArray", items: [jsonString, 5] })).toBe("unknown");
    expect(member(jsonValue, { $tag: "JsonArray", items: 5 })).toBe("no");
    const consSpine = { $tag: "Cons", head: 1, tail: { $tag: "Nil" } };
    const listInt = resolve({
      $opaque: {
        name: "List",
        pure: {
          $variant: {
            cases: [
              { name: "Nil", label: NOTHING, fields: [] },
              {
                name: "Cons",
                label: NOTHING,
                fields: [named("head", 11, ref("Int")), named("tail", 12, ref("List"))],
              },
            ],
          },
        },
      },
    } as FenelType, "codec:jsonDecode");
    expect(member(listInt, [1, 2])).toBe("unknown");
    expect(member(listInt, [1, "2"])).toBe("unknown");
    expect(member(listInt, [])).toBe("unknown");
    expect(member(listInt, consSpine)).toBe("yes");
    expect(member(listInt, { $tag: "Cons", head: "1", tail: { $tag: "Nil" } })).toBe("no");
    expect(member(listInt, "12")).toBe("no");

    const entry = resolve(ref("JsonObjectEntry"), "codec:jsonDecode");
    expect(member(entry, { key: "k", value: jsonString })).toBe("yes");
    expect(member(entry, { key: 1, value: jsonString })).toBe("no");

    const record = resolve({
      $record: { fields: [named("name", 1, ref("String")), named("age", 2, ref("Int"))] },
    }, "codec:jsonDecode");
    expect(member(record, { name: "Ada", age: 36 })).toBe("yes");
    expect(member(record, { name: "Ada", age: "36" })).toBe("no");
    expect(member(record, { name: "Ada" })).toBe("no");
  }, 180_000);

  test("Bytes is a registered system type: it resolves to its system identity and decides by its membership face", () => {
    // Registered since the end of Phase 2d (`Byte`, `Bytes` in Fenel). The
    // unowned spelling still abstains (see "a spelling with no owner …" below).
    const hooks = system.callSiteTyping;
    const systemBytes = '["system","Bytes"]';
    const resolution = hooks.resolveType(ref("Bytes"), "codec:jsonDecode");
    expect(resolution).toEqual({ ok: true, type: callSiteNominalGroundType(systemBytes, "Bytes") });
    if (!resolution.ok) throw new Error("Bytes did not resolve");
    expect(hooks.legacyKey({ identity: systemBytes, publicName: "Bytes" })).toEqual({ ok: true, key: "Bytes" });
    expect(hooks.member(resolution.type, new Uint8Array([1]), null)).toBe("yes");
    expect(hooks.member(resolution.type, "aGVsbG8=", null)).toBe("no");
    expect(hooks.member(ground(ref("Bytes")), new Uint8Array([1]), null)).toBe("unknown");
  }, 180_000);

  test("end to end: resolved evidence and expected type select the complete class application", () => {
    const hooks = system.callSiteTyping;
    const argument = hooks.reflect("aGVsbG8=");
    const expected = hooks.resolveType(
      { $el: { call: ["Result", ref("String"), ref("JsonValue")] } },
      "codec:jsonDecode",
    );
    if (argument?.type === undefined || !expected.ok) throw new Error("resolution failed");
    const outcome = hooks.infer({
      scheme: isoDecodeScheme,
      arguments: [argument.type],
      expected: expected.type,
    });
    const keys = solved(outcome).classParameters.map((row) => hooks.legacyKey(row));
    expect(keys).toEqual([{ ok: true, key: "String" }, { ok: true, key: "JsonValue" }]);
  }, 180_000);
});

describe("registry call-site hooks (controlled registries)", () => {
  const fixture = (
    name: string,
    entities: FenelModule["entities"],
    imports?: FenelModule["imports"],
  ): FenelModule => {
    const id = `${name}:value`;
    return {
      name,
      label: name,
      entities,
      ...(imports === undefined ? {} : { imports }),
      functions: [{ id, params: [], returns: ref("Number") }],
      nativeImpls: { [id]: () => 1 },
    };
  };
  let registry: ModuleRegistry;
  beforeAll(() => {
    registry = createRegistry([
      fixture("alpha", [
        { id: "Thing", type: ref("Number") },
        { id: "Unique", type: ref("String") },
      ]),
      fixture("beta", [], [{ module: "alpha", names: ["Thing"] }]),
      fixture("gamma", [{ id: "Thing", type: ref("Boolean") }]),
      fixture("delta", []),
    ], { publishCatalogEntities: false });
  }, 900_000);

  test("a spelling resolves in its source module and its selected imports only", () => {
    const hooks = registry.callSiteTyping;
    const identityOf = (type: FenelType, source: string | undefined) => {
      const resolution = hooks.resolveType(type, source);
      return resolution.ok ? resolution.type.nominals?.[0]?.identity : resolution.reason;
    };
    expect(identityOf(ref("Thing"), "alpha:value")).toBe('["alpha","Thing"]');
    expect(identityOf(ref("Thing"), "beta:value")).toBe('["alpha","Thing"]');
    expect(identityOf(ref("Thing"), "gamma:value")).toBe('["gamma","Thing"]');
    expect(identityOf(ref("Thing"), "delta:value")).toBe("missing");
    // Global uniqueness of a spelling is never identity.
    expect(identityOf(ref("Unique"), "delta:value")).toBe("missing");
    expect(identityOf(ref("Unique"), undefined)).toBe("missing");
    expect(identityOf(ref("Unique"), "beta:value")).toBe("missing");
    // Exact qualification resolves from anywhere, detached included.
    expect(identityOf(ref("alpha.Unique"), "delta:value")).toBe('["alpha","Unique"]');
    expect(identityOf(ref("gamma.Thing"), undefined)).toBe('["gamma","Thing"]');
    expect(identityOf(ref("Thing"), undefined)).toBe("missing");
  }, 180_000);

  test("legacyKey refuses a spelling two registered types share", () => {
    const hooks = registry.callSiteTyping;
    const thing = hooks.legacyKey({ identity: '["alpha","Thing"]', publicName: "Thing" });
    expect(thing.ok).toBe(false);
    if (!thing.ok) expect(thing.message).toContain("ambiguous");
    expect(hooks.legacyKey({ identity: '["alpha","Unique"]', publicName: "Unique" }))
      .toEqual({ ok: true, key: "Unique" });
  }, 180_000);
});

// ---------------------------------------------------------------------------
// Review round (slice R-A): strict membership keeps the nominal identity the
// resolution established and closes the type over its owners in Fenel
// (`engine:callSiteMembershipProjection`); the judgment abstains on the List
// host carrier, and no wrapper rewrites a verdict; a written type is snapshotted
// before any of its code can run; the system prelude answers only a spelling
// no explicit selection governs, and owns spelling-only names of std schemes
// only.
// ---------------------------------------------------------------------------

const PRIV_STRING = '["priv","String"]';
const MIGRATION_ERROR = '["system","MigrationError"]';

/** The parser's inline `List a` (`$opaque List` over its cons view). */
const inlineListOf = (element: FenelType, headOrdinal: number): FenelType => ({
  $opaque: {
    name: "List",
    pure: {
      $variant: {
        cases: [
          { name: "Nil", label: NOTHING, fields: [] },
          {
            name: "Cons",
            label: NOTHING,
            fields: [named("head", headOrdinal, element), named("tail", headOrdinal + 1, ref("List"))],
          },
        ],
      },
    },
  },
} as FenelType);

const nominalView = (
  identity: string,
  name: string,
  type: FenelType,
): CallSiteNominalEntity => ({
  identity,
  name,
  type,
  kind: K_TYPE,
  binders: [],
  opaque: typeof type === "object" && type !== null && "$opaque" in type,
  uniqueSpelling: true,
});

/** A registry-free nominal frame over a fixed table: `scopes[frameKey]` maps a
 * spelling to an identity, the frame key being a source function id or an
 * owner identity (its declaration frame). */
function fakeFrame(
  entities: readonly CallSiteNominalEntity[],
  scopes: Record<string, Record<string, string>>,
): CallSiteNominalFrame {
  const byIdentity = new Map(entities.map((entity) => [entity.identity, entity]));
  const resolveIn = (key: string | undefined, spelling: string): CallSiteNominalResolution => {
    const identity = key === undefined ? undefined : scopes[key]?.[spelling];
    const entity = identity === undefined ? undefined : byIdentity.get(identity);
    return entity === undefined
      ? { ok: false, reason: "missing", message: `${spelling} is not visible` }
      : { ok: true, identity: entity.identity, kind: entity.kind };
  };
  return {
    resolveSpelling: (source, spelling) => resolveIn(source, spelling),
    resolveInEntity: (identity, spelling) => resolveIn(identity, spelling),
    entity: (identity) => byIdentity.get(identity),
    system: (name) => byIdentity.get(JSON.stringify(["system", name])),
  };
}

describe("strict membership keeps the owner the resolution chose", () => {
  const privString = nominalView(PRIV_STRING, "String", { $opaque: { name: "String" } } as FenelType);
  const systemString = nominalView(STRING, "String", { $opaque: { name: "String" } } as FenelType);
  // A system entity spelled `String` that is NOT the system owner of `String`.
  const systemAlias = nominalView('["system","Alias"]', "String", { $opaque: { name: "String" } } as FenelType);
  const label = (identity: string) => nominalView(identity, "Label", {
    $variant: { cases: [{ name: "Label", label: NOTHING, fields: [positional(0, ref("String"))] }] },
  } as FenelType);
  const privLabel = label('["priv","Label"]');
  const pubLabel = label('["pub","Label"]');
  const looseLabel = label('["loose","Label"]');
  const frame = fakeFrame(
    [privString, systemString, systemAlias, privLabel, pubLabel, looseLabel],
    {
      [privLabel.identity]: { String: PRIV_STRING },
      [pubLabel.identity]: { String: STRING },
    },
  );
  const hooks = () => createCallSiteTypingHooks({
    frame: () => frame,
    methodSignature: () => undefined,
    methodDeclaredInStd: () => false,
    constructorWireNames: () => ({}),
    defaultEvaluateContext: () => system.evaluateContext(),
  });
  const owned = (name: string, identity: string) => ground(ref(name), [nominal([], identity, name)]);

  test("a private opaque spelled like a system scalar has no face: the judgment abstains", () => {
    const { member } = hooks();
    // The exact system owner of `String` is the String face.
    expect(member(owned("String", STRING), "text", null)).toBe("yes");
    expect(member(owned("String", STRING), 5, null)).toBe("no");
    // Any other opaque owner spelled `String` is not: no verdict, never "yes".
    expect(member(owned("String", PRIV_STRING), "text", null)).toBe("unknown");
    expect(member(owned("String", PRIV_STRING), 5, null)).toBe("unknown");
    expect(member(owned("String", '["system","Alias"]'), "text", null)).toBe("unknown");
    // Nested: a constructor field typed by the private owner, resolved in its
    // declaration's own frame.
    expect(member(owned("Label", privLabel.identity), { $tag: "Label", _0: "text" }, null)).toBe("unknown");
    expect(member(owned("Label", pubLabel.identity), { $tag: "Label", _0: "text" }, null)).toBe("yes");
    expect(member(owned("Label", pubLabel.identity), { $tag: "Label", _0: 5 }, null)).toBe("no");
  }, 180_000);

  test("a spelling with no owner is the kernel's intrinsic scalar at the top level only", () => {
    const { member } = hooks();
    // The raw intrinsic spellings the unifier equates with the system owner.
    expect(member(ground(ref("String")), "text", null)).toBe("yes");
    expect(member(ground(ref("Number")), 2.5, null)).toBe("yes");
    expect(member(ground(ref("Boolean")), true, null)).toBe("yes");
    // Nothing else: an unowned Int, an unknown name.
    expect(member(ground(ref("Int")), 5, null)).toBe("unknown");
    expect(member(ground(ref("Bytes")), new Uint8Array([1]), null)).toBe("unknown");
    // Inside a declaration an unresolved spelling abstains (`loose` resolves
    // nothing in its own frame).
    expect(member(owned("Label", looseLabel.identity), { $tag: "Label", _0: "text" }, null)).toBe("unknown");
  }, 180_000);

  describe("in a registry (bare, qualified, aliased, import-named and nested spellings)", () => {
    let registry: ModuleRegistry;
    const fixture = (
      name: string,
      entities: FenelModule["entities"],
      imports?: FenelModule["imports"],
    ): FenelModule => {
      const id = `${name}:value`;
      return {
        name,
        label: name,
        entities,
        ...(imports === undefined ? {} : { imports }),
        functions: [{ id, params: [], returns: ref("Number") }],
        nativeImpls: { [id]: () => 1 },
      };
    };
    beforeAll(() => {
      registry = createRegistry([
        fixture("priv", [
          { id: "String", type: { $opaque: { name: "String" } } as FenelType },
          {
            id: "Box",
            type: { $variant: { cases: [{ name: "Box", label: NOTHING, fields: [positional(0, ref("String"))] }] } } as FenelType,
          },
          {
            // `Tree a = Leaf | Node (Tree a) a (Tree a)`, its recursive
            // occurrences written as the parser writes a self-reference.
            id: "Tree",
            params: ["a"],
            type: {
              $variant: {
                cases: [
                  { name: "Leaf", label: NOTHING, fields: [] },
                  {
                    name: "Node",
                    label: NOTHING,
                    fields: [
                      positional(0, ref("Tree")),
                      positional(1, { $var: "a" } as FenelType),
                      positional(2, ref("Tree")),
                    ],
                  },
                ],
              },
            } as FenelType,
          },
        ]),
        fixture("aliaser", [], [{ module: "priv", as: "p" }]),
        fixture("namer", [], [{ module: "priv", names: ["String"] }]),
        fixture("other", [{ id: "Thing", type: ref("Number") }]),
        fixture("importer", [], [{ module: "other", names: ["MigrationError"] }]),
        fixture("otherAlias", [], [{ module: "other", as: "o" }]),
        fixture("hider", [], [{ module: "other", hiding: ["Thing"] }]),
        fixture("plain", []),
      ], { publishCatalogEntities: false });
    }, 900_000);

    const resolved = (type: FenelType, source: string | undefined) => {
      const resolution = registry.callSiteTyping.resolveType(type, source);
      if (!resolution.ok) throw new Error(JSON.stringify(resolution));
      return resolution.type;
    };
    const identityOf = (type: FenelType, source: string | undefined) => {
      const resolution = registry.callSiteTyping.resolveType(type, source);
      return resolution.ok ? resolution.type.nominals?.[0]?.identity : resolution.reason;
    };

    test("every spelling of the private String keeps its owner and has no face", () => {
      const { member } = registry.callSiteTyping;
      const spellings: Array<[FenelType, string | undefined]> = [
        [ref("String"), "priv:value"],
        [ref("priv.String"), undefined],
        [ref("p.String"), "aliaser:value"],
        [ref("String"), "namer:value"],
      ];
      for (const [type, source] of spellings) {
        expect(identityOf(type, source), JSON.stringify(type)).toBe(PRIV_STRING);
        expect(member(resolved(type, source), "text", null), JSON.stringify(type)).toBe("unknown");
      }
      // Nested: a declared constructor field and a written record field.
      expect(member(resolved(ref("Box"), "priv:value"), { $tag: "Box", _0: "text" }, null)).toBe("unknown");
      const record = resolved({ $record: { fields: [named("label", 31, ref("String"))] } }, "priv:value");
      expect(member(record, { label: "text" }, null)).toBe("unknown");
    }, 180_000);

    test("a parameterized recursive declaration unfolds through its self-reference", () => {
      const { member } = registry.callSiteTyping;
      const treeOfInt = resolved({ $el: { call: ["Tree", ref("Int")] } }, "priv:value");
      const leaf = { $tag: "Leaf" };
      const node = (left: unknown, value: unknown, right: unknown) =>
        ({ $tag: "Node", _0: left, _1: value, _2: right });
      expect(member(treeOfInt, leaf, null)).toBe("yes");
      expect(member(treeOfInt, node(leaf, 5, node(leaf, 6, leaf)), null)).toBe("yes");
      expect(member(treeOfInt, node(leaf, 5, node(leaf, "x", leaf)), null)).toBe("no");
      expect(member(treeOfInt, node(leaf, 5, 7), null)).toBe("no");
    }, 180_000);

    test("the system prelude answers only a spelling no explicit selection governs", () => {
      // No selection: the prelude every module sees.
      expect(identityOf(ref("MigrationError"), "plain:value")).toBe(MIGRATION_ERROR);
      // A hiding import that does not cover the spelling selects nothing.
      expect(identityOf(ref("MigrationError"), "hider:value")).toBe(MIGRATION_ERROR);
      // An import naming the spelling, a qualification and an alias each
      // select `other`, which has no such member: missing, never the system type.
      expect(identityOf(ref("MigrationError"), "importer:value")).toBe("missing");
      expect(identityOf(ref("other.MigrationError"), "importer:value")).toBe("missing");
      expect(identityOf(ref("o.MigrationError"), "otherAlias:value")).toBe("missing");
    }, 180_000);
  });
});

describe("the List host carrier is undecided, in both Boolean contexts", () => {
  // `Nil | Cons head: Int tail: List Int` written as a plain variant: no μ, so
  // the array meets the constructor face directly. The face abstains on a host
  // array against Nil, Cons or the anonymous record former (tcb-ledger row
  // mem.ctor), so no Boolean context can turn an array into a definite; the
  // tagged cons chain is decided in every context.
  const listVariant: FenelType = {
    $variant: {
      cases: [
        { name: "Nil", label: NOTHING, fields: [] },
        {
          name: "Cons",
          label: NOTHING,
          fields: [named("head", 41, ref("Int")), named("tail", 42, inlineListOf(ref("Int"), 43))],
        },
      ],
    },
  } as FenelType;
  const nilOnly: FenelType = {
    $variant: { cases: [{ name: "Nil", label: NOTHING, fields: [] }] },
  } as FenelType;

  test("membership, complement and difference abstain on arrays, and decide the tagged chain", () => {
    const hooks = system.callSiteTyping;
    const resolved = (type: FenelType) => {
      const resolution = hooks.resolveType(type, "codec:jsonDecode");
      if (!resolution.ok) throw new Error(JSON.stringify(resolution));
      return resolution.type;
    };
    const member = (type: FenelType, value: unknown) => hooks.member(resolved(type), value, null);
    const outside = { $complement: listVariant } as FenelType;
    const nonEmpty = { $intersect: [listVariant, { $complement: nilOnly }] } as FenelType;
    for (const value of [[1, 2], [], [1, "a"]]) {
      expect(member(listVariant, value), JSON.stringify(value)).toBe("unknown");
      expect(member(outside, value), `complement ${JSON.stringify(value)}`).toBe("unknown");
      expect(member(nonEmpty, value), `non-empty ${JSON.stringify(value)}`).toBe("unknown");
    }
    const nil = { $tag: "Nil" };
    const one = { $tag: "Cons", head: 1, tail: nil };
    const bad = { $tag: "Cons", head: 1, tail: { $tag: "Cons", head: "a", tail: nil } };
    expect(member(listVariant, nil)).toBe("yes");
    expect(member(listVariant, one)).toBe("yes");
    expect(member(listVariant, bad)).toBe("no");
    expect(member(outside, one)).toBe("no");
    expect(member(outside, bad)).toBe("yes");
    expect(member(outside, "x")).toBe("yes");
    expect(member(nonEmpty, nil)).toBe("no");
    expect(member(nonEmpty, one)).toBe("yes");
    expect(member(nonEmpty, bad)).toBe("no");
    // Through a resolved declaration: a JSON array holds a host array, so it
    // is undecided in JsonValue and in its complement alike; a JSON scalar and
    // a raw string are decided.
    const notJson = { $complement: ref("JsonValue") } as FenelType;
    const jsonArray = { $tag: "JsonArray", items: [{ $tag: "JsonString", value: "x" }] };
    expect(member(ref("JsonValue"), jsonArray)).toBe("unknown");
    expect(member(notJson, jsonArray)).toBe("unknown");
    expect(member(notJson, { $tag: "JsonArray", items: [5] })).toBe("unknown");
    expect(member(notJson, { $tag: "JsonNumber", value: 1 })).toBe("no");
    expect(member(notJson, "raw")).toBe("yes");
  }, 180_000);

  test("a written μ closes over its binder, through an inline List inside it", () => {
    // `μ Rose. Leaf | Node kids: List Rose`: the element set of the inner List
    // refers to the OUTER binder; the Fenel expansion renames both binders.
    const rose: FenelType = {
      $mu: {
        var: "Rose",
        body: {
          $variant: {
            cases: [
              { name: "Leaf", label: NOTHING, fields: [] },
              { name: "Node", label: NOTHING, fields: [named("kids", 51, inlineListOf(ref("Rose"), 52))] },
            ],
          },
        },
      },
    } as FenelType;
    const resolution = system.callSiteTyping.resolveType(rose, "codec:jsonDecode");
    if (!resolution.ok) throw new Error(JSON.stringify(resolution));
    const member = (value: unknown) => system.callSiteTyping.member(resolution.type, value, null);
    const leaf = { $tag: "Leaf" };
    // The kids are written as tagged cons chains: the judgment decides those,
    // and abstains on a host array (tcb-ledger row mem.ctor).
    const list = (...items: unknown[]): unknown =>
      items.reduceRight<unknown>((tail, head) => ({ $tag: "Cons", head, tail }), { $tag: "Nil" });
    expect(member(leaf)).toBe("yes");
    expect(member({ $tag: "Node", kids: list() })).toBe("yes");
    expect(member({ $tag: "Node", kids: list(leaf, { $tag: "Node", kids: list(leaf) }) })).toBe("yes");
    expect(member({ $tag: "Node", kids: list(leaf, 5) })).toBe("no");
    expect(member({ $tag: "Node", kids: list({ $tag: "Node", kids: list("x") }) })).toBe("no");
    expect(member({ $tag: "Node", kids: [] })).toBe("unknown");
    expect(member({ $tag: "Node", kids: [leaf] })).toBe("unknown");
  }, 180_000);
});

describe("a written type is audited before any of its code runs", () => {
  const hostileRef = (): { value: FenelType; reads: () => number } => {
    let count = 0;
    const value = {};
    Object.defineProperty(value, "$ref", {
      enumerable: true,
      get: () => {
        count += 1;
        return "String";
      },
    });
    return { value: value as FenelType, reads: () => count };
  };

  test("an enumerable getter is rejected with zero executions", () => {
    const resolveString = (): CallSiteNominalResolution => ({ ok: true, identity: STRING, kind: K_TYPE });
    const top = hostileRef();
    expect(resolveCallSiteGroundType(top.value, resolveString)).toMatchObject({ ok: false, reason: "malformed" });
    expect(top.reads()).toBe(0);
    // Nested inside a structural type.
    const nested = hostileRef();
    expect(resolveCallSiteGroundType(resultOf(ref("String"), nested.value), resolveString))
      .toMatchObject({ ok: false, reason: "malformed" });
    expect(nested.reads()).toBe(0);
    // Through the registry hook.
    const hooked = hostileRef();
    expect(system.callSiteTyping.resolveType(hooked.value, undefined))
      .toMatchObject({ ok: false, reason: "malformed" });
    expect(hooked.reads()).toBe(0);
  }, 180_000);
});

describe("the prelude view of a method scheme is for std classes only", () => {
  const migrationError = nominalView(MIGRATION_ERROR, "MigrationError", {
    $variant: { cases: [{ name: "FieldMissing", label: NOTHING, fields: [] }] },
  } as FenelType);
  const frame = fakeFrame([migrationError], {});
  const scheme: TypeScheme = {
    quantified: [variable("Gate:a", "a")],
    body: arrow([{ $var: "a" }], resultOf(ref("MigrationError"), { $var: "a" })),
  };
  const hooks = createCallSiteTypingHooks({
    frame: () => frame,
    methodSignature: () => ({ outcome: { $tag: "Solved" }, scheme }),
    methodDeclaredInStd: (qualifiedName) => qualifiedName.startsWith("Std."),
    constructorWireNames: () => ({}),
    defaultEvaluateContext: () => undefined,
  });
  const expected = groundResult("MigrationError", MIGRATION_ERROR, "Int", INT);

  test("a std scheme's spelling-only system name is std's own declaration", () => {
    const std = hooks.methodScheme("Std.method");
    if (!std.ok) throw new Error(JSON.stringify(std));
    expect(std.scheme.nominals).toEqual([nominal([...returnsPath, ...errPath], MIGRATION_ERROR, "MigrationError")]);
    expect(classParameters(hooks.infer({ scheme: std.scheme, arguments: [intType], expected })))
      .toEqual([{ name: "a", identity: INT, publicName: "Int" }]);
  }, 180_000);

  test("any other scheme keeps the missing binding unresolved and fails closed", () => {
    const user = hooks.methodScheme("User.method");
    if (!user.ok) throw new Error(JSON.stringify(user));
    expect(user.scheme).toBe(scheme);
    expect(rejectedCodes(hooks.infer({ scheme: user.scheme, arguments: [intType], expected })))
      .toEqual(["inference.nominal-mismatch"]);
  }, 180_000);
});
