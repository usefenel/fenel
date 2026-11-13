import { describe, expect, test } from "bun:test";
import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import foundationSource from "../../../../fenel/std/foundation.fenel?raw";
import movieSource from "../../../../fenel/modules/movie/types.fenel?raw";
import authoritySource from "../../../../fenel/modules/authority/authority.fenel?raw";
import validateSource from "../../../../fenel/modules/engine/validate.fenel?raw";
import {
  bindSourceTypeSignature,
  parse,
  type ParsedSourceTypeScheme,
} from "./fenel-parser";
import {
  dispatchEngineBody,
  PARSE_VIA_FENEL_FAIL,
  parseViaFenelParser,
  setParserInterpreted,
} from "./engine-bodies-dispatch";
import {
  parseCacheEnabled,
  parsedViaCache,
  setParseCacheEnabled,
} from "./parse-cache";

type Frame = Record<string, Record<string, unknown>>;

function parsedFrames(parsed: unknown): Frame[] {
  if (parsed && typeof parsed === "object" && "program" in parsed)
    return (parsed as { program: Frame[] }).program;
  return parsed && typeof parsed === "object" ? [parsed as Frame] : [];
}

function frames(source: string): Frame[] {
  return parsedFrames(parse(source) as unknown);
}

function signature(source: string): {
  name: string;
  type: unknown;
  scheme: ParsedSourceTypeScheme;
} {
  const frame = frames(source).find((candidate) => "type_sig" in candidate);
  if (!frame) throw new Error(`missing type signature in ${source}`);
  return frame.type_sig as never;
}

function typeDefinition(source: string): Record<string, unknown> {
  const frame = frames(source).find((candidate) => "type_def" in candidate);
  if (!frame) throw new Error(`missing type definition in ${source}`);
  return frame.type_def!;
}

function signatureSidecars(parsed: unknown): Array<{
  name: string;
  type: unknown;
  scheme: ParsedSourceTypeScheme;
}> {
  return parsedFrames(parsed)
    .filter((frame) => "type_sig" in frame)
    .map((frame) => {
      const declaration = frame.type_sig as {
        name: string;
        type: unknown;
        scheme: ParsedSourceTypeScheme;
      };
      return {
        name: declaration.name,
        type: declaration.type,
        scheme: declaration.scheme,
      };
    });
}

const KTYPE = { $tag: "KType" } as const;
const K1 = { $tag: "KArrow", input: KTYPE, output: KTYPE } as const;
const K2 = { $tag: "KArrow", input: KTYPE, output: K1 } as const;

const REPOSITORY_ROOT = join(import.meta.dir, "..", "..", "..", "..");

function boundReferenceLeaks(
  value: unknown,
  boundNames: ReadonlySet<string>,
  path: readonly string[] = [],
  active: WeakSet<object> = new WeakSet<object>(),
): Array<{ spelling: string; path: readonly string[] }> {
  if (value === null || typeof value !== "object") return [];
  if (active.has(value)) return [];
  active.add(value);
  try {
    const leaks: Array<{ spelling: string; path: readonly string[] }> = [];
    if (!Array.isArray(value)) {
      const ref = Object.getOwnPropertyDescriptor(value, "$ref");
      if (ref && "value" in ref && typeof ref.value === "string" && boundNames.has(ref.value)) {
        leaks.push({ spelling: ref.value, path });
      }
    }
    const entries = Array.isArray(value)
      ? value.map((item, index) => [String(index), item] as const)
      : Object.entries(value);
    for (const [key, child] of entries) {
      leaks.push(...boundReferenceLeaks(child, boundNames, [...path, key], active));
    }
    return leaks;
  } finally {
    active.delete(value);
  }
}

describe("source scheme parser — declaration-scoped binding and kinds", () => {
  test("constructor continuation fields preserve the preceding alternatives in source order", () => {
    const original = [
      { name: "First", fields: [] },
      { name: "Second", fields: [{ name: "old", type: { mk: "ref", name: "Number" } }] },
      { name: "Third", fields: [] },
    ];
    const additions = [
      { name: "text", type: { mk: "ref", name: "String" } },
      { name: "flag", type: { mk: "ref", name: "Boolean" } },
      { name: "count", type: { mk: "ref", name: "Number" } },
    ];
    let actual: unknown = original;
    for (let index = 0; index < additions.length; index++) {
      actual = dispatchEngineBody("engine:appendFieldsToLastCtor", [actual, [additions[index]]]);
      expect(actual).toEqual([
        original[0], original[1], { name: "Third", fields: additions.slice(0, index + 1) },
      ]);
    }
  }, 300_000);

  test("multiline variants retain constructors when the first constructor differs from the type", () => {
    for (const [source, names] of [
      ["Choice = First value: String\n  | Second reason: String", ["First", "Second"]],
      ["Choice =\n  First value: String\n  | Second reason: String", ["First", "Second"]],
      ["Choice = Choice value: String\n  | Second reason: String", ["Choice", "Second"]],
      ["Choice =\n  First reason: String\n  | Second reason: String\n  | Third parsed: JsonValue reason: String\n  | Fourth parsed: JsonValue purchase: StatisticsPurchase amountMembership: Maybe Boolean", ["First", "Second", "Third", "Fourth"]],
      ['@discriminator "$tag"\nChoice = First reason: String\n  | Second reason: String\n  | Third parsed: JsonValue reason: String\n  | Fourth parsed: JsonValue purchase: StatisticsPurchase amountMembership: Maybe Boolean', ["First", "Second", "Third", "Fourth"]],
      ["Choice = First\n  a: String\n  b: Number\n  | Second\n  c: String\n  d: Boolean\n  | Third", ["First", "Second", "Third"]],
      ["Choice = First\n  | Second\n  | Third", ["First", "Second", "Third"]],
    ] as const) {
      const expected = typeDefinition(source);
      const actual = parsedFrames(parseViaFenelParser(source)).find((frame) => "type_def" in frame)?.type_def;
      expect(actual).toEqual(expected);
      expect((actual?.constructors as Array<{ name: string }>).map((ctor) => ctor.name)).toEqual([...names]);
    }
  }, 300_000);

  test("Fenel compiled/interpreted parsers and the TS mirror agree on authoritative scheme sidecars", () => {
    // One declaration covers binders, an application sidecar, a stable kind
    // diagnostic, and the compatibility body without paying the interpreted
    // parser cost once per independent top-level group.
    const source = "badKind : f -> f a";
    const ts = signatureSidecars(parse(source));
    const compiledRaw = parseViaFenelParser(source);
    expect(compiledRaw).not.toBe(PARSE_VIA_FENEL_FAIL);
    const compiled = signatureSidecars(compiledRaw);

    setParserInterpreted(true);
    let interpretedRaw: unknown;
    try {
      interpretedRaw = parseViaFenelParser(source);
    } finally {
      setParserInterpreted(null);
    }
    expect(interpretedRaw).not.toBe(PARSE_VIA_FENEL_FAIL);
    const interpreted = signatureSidecars(interpretedRaw);

    expect(compiled).toEqual(ts);
    expect(interpreted).toEqual(ts);
    for (const row of [...ts, ...compiled, ...interpreted]) {
      expect(row.scheme.body).toEqual(row.type);
    }
  }, 300_000);

  test("the compiled Fenel parser matches the TS mirror for source-binding regressions", () => {
    const source = `
collision : (a: List a) -> List a
nestedContainer : List (f a)
wrongList : List (f a) b
Tree f a = Node next: Tree (f a)
Solo = Solo first: String
  second: Number
`;
    const fenel = parseViaFenelParser(source);
    expect(fenel).not.toBe(PARSE_VIA_FENEL_FAIL);
    expect(parsedFrames(fenel)).toEqual(parsedFrames(parse(source)));
  }, 180_000);

  test("the bootstrap parse cache retains authoritative source scheme sidecars", () => {
    const prior = parseCacheEnabled();
    setParseCacheEnabled(true);
    try {
      // foundation.fenel is in the cold-boot cache manifest, whose independent
      // ABI already carries schemes even while the main cache awaits the final
      // phase regeneration.
      expect(signatureSidecars(parsedViaCache(foundationSource))).toEqual(
        signatureSidecars(parse(foundationSource)),
      );
    } finally {
      setParseCacheEnabled(prior);
    }
  }, 180_000);

  test("the complete source corpus has no declaration-bound variable encoded as a nominal $ref", () => {
    const files = globSync("fenel/**/*.fenel", { cwd: REPOSITORY_ROOT }).sort();
    const failures: string[] = [];
    const leaks: Array<{
      file: string;
      declaration: string;
      spelling: string;
      path: readonly string[];
    }> = [];
    let parsedFiles = 0;
    let boundVariables = 0;

    for (const relativeFile of files) {
      const file = relativeFile.replaceAll("\\", "/");
      let parsed: unknown;
      try {
        parsed = parse(readFileSync(join(REPOSITORY_ROOT, relativeFile), "utf8"));
        parsedFiles += 1;
      } catch (error) {
        failures.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }

      for (const frame of parsedFrames(parsed)) {
        if ("type_sig" in frame) {
          const declaration = frame.type_sig as {
            name: string;
            scheme: ParsedSourceTypeScheme;
          };
          const names = new Set(declaration.scheme.quantified.map(({ sourceName }) => sourceName));
          boundVariables += names.size;
          for (const leak of boundReferenceLeaks(declaration.scheme.body, names)) {
            leaks.push({ file, declaration: declaration.name, ...leak });
          }
        }
        if ("type_def" in frame) {
          const declaration = frame.type_def as {
            name: string;
            binding: ParsedSourceTypeScheme;
          } & Record<string, unknown>;
          const names = new Set(declaration.binding.quantified.map(({ sourceName }) => sourceName));
          boundVariables += names.size;
          const { binding: _binding, ...compatibilityDeclaration } = declaration;
          for (const leak of boundReferenceLeaks(compatibilityDeclaration, names)) {
            leaks.push({ file, declaration: declaration.name, ...leak });
          }
        }
      }
    }

    expect(files.length).toBeGreaterThan(300);
    expect(parsedFiles).toBe(files.length - 1);
    // Signature-substrate Phase 2 closeout: the exact post-expansion binder
    // intentionally excludes erased Map-key arguments, EntityRef string
    // phantoms, and recursive self-application arguments. The reviewed corpus
    // count is 4,837; retain a broad-coverage floor without re-admitting those
    // non-occurrences as fake quantified variables.
    expect(boundVariables).toBeGreaterThan(4_500);
    expect(failures).toEqual([
      'fenel/modules/inputs.fenel: Unexpected = ("=") (line 16)',
    ]);
    expect(leaks).toEqual([]);
  }, 180_000);

  test("id binds one rigid source variable and uses $var in the compatibility body", () => {
    const parsed = signature("id : a -> a");
    expect(parsed.scheme.quantified).toEqual([
      { id: "q0", sourceName: "a", kind: KTYPE },
    ]);
    expect(parsed.type).toEqual(parsed.scheme.body);
    expect(JSON.stringify(parsed.type)).toContain('"$var":"a"');
    expect(JSON.stringify(parsed.type)).not.toContain('"$ref":"a"');
  });

  test("const and nested record/tuple occurrences share declaration-local binders", () => {
    const parsed = signature("const : { left: Maybe a, pair: (a, b) } -> b -> a");
    expect(parsed.scheme.quantified).toEqual([
      { id: "q0", sourceName: "a", kind: KTYPE },
      { id: "q1", sourceName: "b", kind: KTYPE },
    ]);
    expect(JSON.stringify(parsed.type)).not.toMatch(/"\$ref":"[ab]"/);
  });

  test("the same spelling in two signatures starts a fresh local q0 scope", () => {
    const parsed = frames("first : a -> a\nsecond : a -> a")
      .filter((frame) => "type_sig" in frame)
      .map((frame) => frame.type_sig as { name: string; scheme: ParsedSourceTypeScheme });
    expect(parsed.map((item) => [item.name, item.scheme.quantified])).toEqual([
      ["first", [{ id: "q0", sourceName: "a", kind: KTYPE }]],
      ["second", [{ id: "q0", sourceName: "a", kind: KTYPE }]],
    ]);
    expect(parsed[0]!.scheme).not.toBe(parsed[1]!.scheme);
  });

  test("constructor variables, nominal applications, and dependent values stay distinct", () => {
    const higher = signature("higher : f a -> f a");
    expect(higher.scheme.quantified).toEqual([
      { id: "q0", sourceName: "f", kind: K1 },
      { id: "q1", sourceName: "a", kind: KTYPE },
    ]);
    expect(higher.scheme.applications).toEqual([
      expect.objectContaining({ headVarId: "q0", args: [{ $var: "a" }], kind: K1 }),
      expect.objectContaining({ headVarId: "q0", args: [{ $var: "a" }], kind: K1 }),
    ]);
    expect(higher.scheme.applications.every((application) => !("headRef" in application))).toBe(true);

    const nominal = signature("nominal : Foo a -> pkg.Result");
    expect(nominal.scheme.applications).toEqual([
      expect.objectContaining({ headRef: "Foo", args: [{ $var: "a" }], kind: K1 }),
    ]);
    expect(nominal.scheme.applications[0]).not.toHaveProperty("headVarId");
    expect(JSON.stringify(nominal.type)).toContain('"$ref":"pkg.Result"');

    const dependent = signature("dependent : (typeId: String) -> schemaOf typeId");
    expect(dependent.scheme.quantified).toEqual([]);
    expect(dependent.scheme.applications).toEqual([]);
    expect(JSON.stringify(dependent.type)).toContain('"var":"typeId"');
  });

  test("a canonical List argument remains a type variable when its spelling matches a named value parameter", () => {
    const parsed = signature("collision : (a: List a) -> List a");
    expect(parsed.scheme.quantified).toEqual([
      { id: "q0", sourceName: "a", kind: KTYPE },
    ]);
    expect(parsed.scheme.applications).toEqual([]);
    expect(JSON.stringify(parsed.type)).toContain('"$var":"a"');
    expect(JSON.stringify(parsed.type)).not.toContain('"var":"a"');
    expect(JSON.stringify(parsed.type)).not.toContain('"$ref":"a"');
  });

  test("angle and juxtaposition applications bind to the same scheme", () => {
    const angle = signature("angle : Foo<a>");
    const juxtaposed = signature("juxtaposed : Foo a");
    expect(angle.type).toEqual(juxtaposed.type);
    expect(angle.scheme.quantified).toEqual(juxtaposed.scheme.quantified);
    expect(angle.scheme.applications.map(({ path: _path, ...application }) => application)).toEqual(
      juxtaposed.scheme.applications.map(({ path: _path, ...application }) => application),
    );
  });

  test("nested application paths select compatibility $el.call arguments", () => {
    const parsed = signature(
      "nested : Foo (Bar a) -> String -> Baz (Qux a)",
    );
    expect(parsed.scheme.applications.map((application) => ({
      head: "headRef" in application ? application.headRef : application.headVarId,
      path: application.path,
    }))).toEqual([
      {
        head: "Foo",
        path: ["$arrow", "params", "0", "type"],
      },
      {
        head: "Bar",
        path: ["$arrow", "params", "0", "type", "$el", "call", "1"],
      },
      {
        head: "Baz",
        path: ["$arrow", "returns", "$arrow", "returns"],
      },
      {
        head: "Qux",
        path: [
          "$arrow", "returns", "$arrow", "returns", "$el", "call", "1",
        ],
      },
    ]);
  });

  test("nested applications rebase through the canonical List expansion", () => {
    const parsed = signature("nestedContainer : List (f a)");
    expect(parsed.scheme.applications).toEqual([
      expect.objectContaining({
        path: ["$opaque", "pure", "$variant", "cases", "1", "fields", "0", "type"],
        headVarId: "q0",
        args: [{ $var: "a" }],
        kind: K1,
      }),
    ]);
  });

  test("a wrong-arity canonical name falls back to $el and ordinary application paths", () => {
    const parsed = signature("wrongList : List (f a) b");
    expect(parsed.type).toEqual({
      $el: {
        call: [
          "List",
          { $el: { call: ["f", { $var: "a" }] } },
          { $var: "b" },
        ],
      },
    });
    expect(parsed.scheme.applications).toEqual([
      {
        path: [],
        headRef: "List",
        args: [
          { $el: { call: ["f", { $var: "a" }] } },
          { $var: "b" },
        ],
        kind: K2,
      },
      {
        path: ["$el", "call", "1"],
        headVarId: "q0",
        args: [{ $var: "a" }],
        kind: K1,
      },
    ]);
  });

  test("the Fenel binder hides only string-shaped EntityRef arguments from the source scheme", () => {
    const bind = (arg: unknown) => dispatchEngineBody(
      "engine:sourceBindSignature",
      ["entity", { mk: "app", head: "EntityRef", args: [arg] }],
    ) as {
      type: unknown;
      scheme: ParsedSourceTypeScheme;
    };

    for (const bound of [
      bind("profile"),
      bind({ mk: "strlit", value: "profile" }),
    ]) {
      expect(bound.scheme.quantified).toEqual([]);
      expect(bound.scheme.applications).toEqual([]);
      expect(bound.scheme.diagnostics).toEqual([]);
      expect(bound.scheme.body).toEqual(bound.type);
    }

    const nonString = bind({ mk: "ref", name: "a" });
    expect(nonString.scheme.quantified).toEqual([
      expect.objectContaining({ id: "q0", sourceName: "a" }),
    ]);
    expect(nonString.scheme.applications).toEqual([
      expect.objectContaining({
        path: [],
        headRef: "EntityRef",
        args: [{ mk: "var", name: "a" }],
      }),
    ]);
  }, 30_000);

  test("explicit type-definition parameters bind, infer constructor kind, and fence unbound names", () => {
    const higher = typeDefinition("HK f a = HK value: f a");
    expect(higher.binding).toEqual({
      quantified: [
        { id: "q0", sourceName: "f", kind: K1 },
        { id: "q1", sourceName: "a", kind: KTYPE },
      ],
      applications: [expect.objectContaining({ headVarId: "q0", args: [{ $var: "a" }], kind: K1 })],
      diagnostics: [],
    });
    expect(JSON.stringify(higher.constructors)).not.toMatch(/"\$ref":"[fa]"/);

    const unbound = typeDefinition("Loose = Loose value: a");
    expect(unbound.binding).toEqual({
      quantified: [],
      applications: [],
      diagnostics: [expect.objectContaining({
        code: "UnboundTypeIdentifier",
        declaration: "Loose",
        spelling: "a",
      })],
    });
    expect(JSON.stringify(unbound.constructors)).toContain('"$ref":"a"');
  });

  test("explicit type-definition parameters bind by declaration membership, independent of casing", () => {
    const upper = typeDefinition("Upper F A = Upper value: F A");
    expect(upper.binding).toEqual({
      quantified: [
        { id: "q0", sourceName: "F", kind: K1 },
        { id: "q1", sourceName: "A", kind: KTYPE },
      ],
      applications: [expect.objectContaining({ headVarId: "q0", args: [{ $var: "A" }], kind: K1 })],
      diagnostics: [],
    });
    expect(JSON.stringify(upper.constructors)).not.toMatch(/"\$ref":"[FA]"/);
  });

  test("type-definition self applications collapse before their arguments reach the binding", () => {
    const tree = typeDefinition("Tree f a = Node next: Tree (f a)");
    expect(tree.binding).toEqual({
      quantified: [
        { id: "q0", sourceName: "f", kind: KTYPE },
        { id: "q1", sourceName: "a", kind: KTYPE },
      ],
      applications: [],
      diagnostics: [],
    });
    expect(tree.constructors).toEqual([
      expect.objectContaining({
        name: "Node",
        fields: [expect.objectContaining({ name: "next", type: { $ref: "Tree" } })],
      }),
    ]);
  });

  test("nested self applications collapse only in an outer application's sidecar arguments", () => {
    const wrap = typeDefinition(
      "data Wrap where\n  Mk : Box (Wrap a) -> Wrap",
    );
    const binding = wrap.binding as {
      applications: ParsedSourceTypeScheme["applications"];
      diagnostics: ParsedSourceTypeScheme["diagnostics"];
    };
    expect(binding.applications).toHaveLength(2);
    expect(binding.applications).toEqual([
      expect.objectContaining({ headRef: "Box", args: [{ $ref: "Wrap" }] }),
      expect.objectContaining({ headRef: "Box", args: [{ $ref: "Wrap" }] }),
    ]);
    expect(binding.diagnostics).toEqual([]);

    const constructor = (wrap.constructors as Array<{
      type: unknown;
      fields: Array<{ type: unknown }>;
    }>)[0]!;
    expect(JSON.stringify(constructor.type)).toContain('"call":["Wrap"');
    expect(JSON.stringify(constructor.fields[0]!.type)).toContain('"call":["Wrap"');
  });

  test("incompatible constructor arities retain a stable KindMismatch diagnostic", () => {
    const parsed = signature("badKind : f -> f a");
    expect(parsed.scheme.diagnostics).toEqual([
      expect.objectContaining({
        code: "KindMismatch",
        declaration: "badKind",
        spelling: "f",
      }),
    ]);
  });

  test("binding diagnostics are emitted per source occurrence", () => {
    const repeatedUnbound = typeDefinition(
      "Repeated = First value: a | Middle value: b | Last value: a",
    );
    const repeatedBinding = repeatedUnbound.binding as {
      diagnostics: ParsedSourceTypeScheme["diagnostics"];
    };
    expect(repeatedBinding.diagnostics).toEqual([
      expect.objectContaining({
        code: "UnboundTypeIdentifier",
        spelling: "a",
        path: ["constructors", "0", "fields", "0", "type"],
      }),
      expect.objectContaining({
        code: "UnboundTypeIdentifier",
        spelling: "a",
        path: ["constructors", "2", "fields", "0", "type"],
      }),
      expect.objectContaining({
        code: "UnboundTypeIdentifier",
        spelling: "b",
        path: ["constructors", "1", "fields", "0", "type"],
      }),
    ]);

    const repeatedMismatch = signature("badKinds : f -> f a -> f b");
    expect(repeatedMismatch.scheme.diagnostics).toEqual([
      expect.objectContaining({ code: "KindMismatch", spelling: "f" }),
      expect.objectContaining({ code: "KindMismatch", spelling: "f" }),
    ]);
    expect(repeatedMismatch.scheme.diagnostics.map((diagnostic) => diagnostic.path)).toEqual([
      ["$arrow", "returns", "$arrow", "params", "0", "type"],
      ["$arrow", "returns", "$arrow", "returns"],
    ]);
  });

  test("malformed own-data applications produce diagnostics without invoking accessors", () => {
    let getterCalls = 0;
    const hostile: Record<string, unknown> = {};
    Object.defineProperty(hostile, "$el", {
      enumerable: true,
      get() {
        getterCalls++;
        return { call: ["f", { $ref: "a" }] };
      },
    });
    const bound = bindSourceTypeSignature("hostile", hostile);
    expect(getterCalls).toBe(0);
    expect(bound.scheme.diagnostics).toEqual([
      expect.objectContaining({ code: "MalformedSchemeApplication", declaration: "hostile" }),
    ]);
  });
});

describe("multiline ADT layout", () => {
  test("a singleton constructor retains every indented continuation field", () => {
    const solo = typeDefinition(`
Solo = Solo first: String
  second: Number
  third: Maybe String
`);
    const constructors = solo.constructors as Array<{
      name: string;
      fields: Array<{ name: string }>;
    }>;
    expect(constructors.map((ctor) => [ctor.name, ctor.fields.map((field) => field.name)])).toEqual([
      ["Solo", ["first", "second", "third"]],
    ]);
  });

  test("single and peer constructors preserve fields, comments, blanks, and the following declaration", () => {
    const parsed = frames(`
Shape = Rect first: Maybe (List String)
  -- an intervening comment belongs to layout, not the type

  width: Number
  | Point x: Number
    y: Number

Next = Next value: String
`);
    const shape = parsed[0]!.type_def as {
      constructors: Array<{ name: string; fields: Array<{ name: string }> }>;
    };
    expect(shape.constructors.map((ctor) => [ctor.name, ctor.fields.map((field) => field.name)])).toEqual([
      ["Rect", ["first", "width"]],
      ["Point", ["x", "y"]],
    ]);
    expect((parsed[1]!.type_def as { name: string }).name).toBe("Next");
  });

  test("the reviewed corpus delta is exactly 52 continuation fields", () => {
    const continuationCount = (source: string): number =>
      source.split(/\r?\n/).filter((line) => /^\s+[A-Za-z_][A-Za-z0-9_]*\s*:/.test(line)).length;
    expect(continuationCount(movieSource)).toBe(5);
    expect(continuationCount(authoritySource)).toBe(2);
    expect(continuationCount(validateSource)).toBe(45);
    expect(
      continuationCount(movieSource) + continuationCount(authoritySource) + continuationCount(validateSource),
    ).toBe(52);
  });

  test("ActRow and RecordedMovie retain their complete ordered field sets", () => {
    // rights R2a — `PolicyView` was the original multiline-record pin here and
    // it is deleted with the second policy engine. `ActRow` is its successor in
    // the same role: a multiline constructor whose field ORDER is load-bearing.
    const row = frames(authoritySource)
      .find((frame) => (frame.type_def as { name?: string } | undefined)?.name === "ActRow")!
      .type_def as { constructors: Array<{ fields: Array<{ name: string }> }> };
    expect(row.constructors[0]!.fields.map((field) => field.name)).toEqual([
      "descriptors", "args",
    ]);

    const movie = frames(movieSource)
      .find((frame) => (frame.type_def as { name?: string } | undefined)?.name === "RecordedMovie")!
      .type_def as { constructors: Array<{ fields: Array<{ name: string }> }> };
    expect(movie.constructors[0]!.fields.map((field) => field.name)).toEqual([
      "fps", "width", "height", "frames", "audio",
    ]);
  });
});
