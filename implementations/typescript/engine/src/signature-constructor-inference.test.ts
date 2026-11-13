import { describe, expect, test } from "bun:test";

import {
  compileConstructorCatalogCandidates,
  type CompileConstructorCandidate,
} from "./compile-field-slots";
import { dispatchedJsonLogicToSyntax } from "./engine-bodies-dispatch";
import { createRegistry } from "./registry";
import { createAccountRegistry } from "./repository-registry";
import { repositoryIdentityLock } from "./repository-identity-manifest";
import { List, Maybe, Nothing } from "./type-foundation";
import {
  buildAuthoringCatalogSnapshot,
  createAuthoringEnvironment,
} from "./authoring/environment";
import { inferJsonLogicPatternBindings } from "./signature-inference";
import { evaluate, matchPattern } from "./json-logic";
import type {
  FenelFunction,
  FenelModule,
  FenelType,
  FieldDef,
  FieldKey,
  FunctionSignatureDeclaration,
  TypeScheme,
} from "./types";

const ref = (name: string): FenelType => ({ $ref: name });
const variable = (name: string): FenelType => ({ $var: name });

function positionalField(name: string, index: number, type: FenelType): FieldDef {
  return {
    name,
    key: { $tag: "PositionalField", index },
    type,
    label: Nothing,
    ui: Nothing,
    meta: {},
  };
}

function namedField(name: string, handle: string, type: FenelType): FieldDef {
  return {
    name,
    key: { $tag: "NamedField", ref: { $ref: handle } },
    type,
    label: Nothing,
    ui: Nothing,
    meta: {},
  };
}

type InferredFunction = {
  readonly fn: FenelFunction;
  readonly declaration: FunctionSignatureDeclaration;
};

function inferredFunction(
  moduleName: string,
  codeName: string,
  params: readonly string[],
  body: unknown,
): InferredFunction {
  const id = `${moduleName}:${codeName}`;
  return {
    fn: {
      id,
      params: params.map((name, index) =>
        positionalField(name, index, variable(`compat-${codeName}-${index}`))
      ),
      returns: variable(`compat-${codeName}-return`),
      body: body as FenelFunction["body"],
    },
    declaration: {
      functionId: id,
      declarationName: codeName,
      codeName,
      params: params.map(() => ({ $tag: "Absent" } as const)),
      returns: { $tag: "Absent" },
    },
  };
}

function createTestRegistry(
  modules: FenelModule[],
  fields: ReadonlyArray<{ readonly id: string; readonly currentCodeName: string }> = [],
) {
  return createAccountRegistry([], modules, {
    ...(fields.length === 0 ? {} : { externalFields: fields }),
    ...(fields.length === 0
      ? {}
      : { identityKinds: new Map(fields.map((field) => [field.id, "field"])) }),
  });
}

type Entity = NonNullable<FenelModule["entities"]>[number];

function testModule(
  name: string,
  entities: readonly Entity[],
  functions: readonly InferredFunction[] = [],
): FenelModule {
  return {
    name,
    label: name,
    entities: [...entities],
    functions: functions.map((entry) => entry.fn),
    functionSignatureDeclarations: functions.map((entry) => entry.declaration),
    instances: functions.map((entry) => ({
      typeName: "Codeable",
      args: [entry.fn.id],
      methods: { codeName: entry.declaration.codeName },
    })),
  };
}

function variantEntity(
  moduleName: string,
  id: string,
  params: readonly string[],
  cases: ReadonlyArray<{ readonly name: string; readonly fields: readonly FieldDef[] }>,
): Entity {
  const type = {
    $variant: {
      cases: cases.map((variantCase) => ({
        name: variantCase.name,
        label: Nothing,
        fields: [...variantCase.fields],
      })),
    },
  } satisfies FenelType;
  const typeScheme: TypeScheme = {
    quantified: params.map((sourceName, index) => ({
      id: `${moduleName}:${id}:q${index}`,
      sourceName,
      kind: { $tag: "KType" },
    })),
    body: type,
  };
  return {
    id,
    module: moduleName,
    params: [...params],
    type,
    typeScheme,
  };
}

function arrowBody(scheme: TypeScheme): Extract<FenelType, { $arrow: unknown }>["$arrow"] {
  if (!("$arrow" in scheme.body)) {
    throw new Error(`expected arrow scheme, received ${JSON.stringify(scheme.body)}`);
  }
  return scheme.body.$arrow;
}

function variableName(type: FenelType): string {
  if (!("$var" in type)) throw new Error(`expected variable, received ${JSON.stringify(type)}`);
  return type.$var;
}

function application(type: FenelType): { readonly head: string; readonly args: FenelType[] } {
  if (!("$el" in type)) {
    throw new Error(`expected scheme application, received ${JSON.stringify(type)}`);
  }
  const call = (type.$el as { call?: unknown[] }).call;
  if (!Array.isArray(call) || typeof call[0] !== "string") {
    throw new Error(`expected application call, received ${JSON.stringify(type)}`);
  }
  return { head: call[0], args: call.slice(1) as FenelType[] };
}

function recordFields(type: FenelType): ReadonlyMap<string, FenelType> {
  if (!("$record" in type)) {
    throw new Error(`expected record, received ${JSON.stringify(type)}`);
  }
  return new Map(type.$record.fields.map((field) => [field.name, field.type]));
}

function constructorCandidate(
  candidates: readonly CompileConstructorCandidate[],
  ownerId: string,
  name: string,
): CompileConstructorCandidate {
  const candidate = candidates.find((entry) => entry.ownerId === ownerId && entry.name === name);
  if (candidate === undefined) throw new Error(`missing ${ownerId}.${name} constructor candidate`);
  return candidate;
}

describe("registry constructor signature inference", () => {
  test("publishes Fenel-derived higher-kinded constructor schemes for authoring", () => {
    const kType = { $tag: "KType" } as const;
    const k1 = { $tag: "KArrow", input: kType, output: kType } as const;
    const applied: FenelType = { $el: { call: ["f", variable("a")] } };
    const type = {
      $variant: {
        cases: [{
          name: "Wrap",
          label: Nothing,
          fields: [positionalField("_0", 0, applied)],
        }],
      },
    } satisfies FenelType;
    const box: Entity = {
      id: "HigherBox",
      module: "higher-box",
      params: ["f", "a"],
      type,
      typeScheme: {
        quantified: [
          { id: "higher-box:HigherBox:q0", sourceName: "f", kind: k1 },
          { id: "higher-box:HigherBox:q1", sourceName: "a", kind: kType },
        ],
        body: type,
        applications: [{
          path: ["$variant", "cases", "0", "fields", "0", "type"],
          headVarId: "higher-box:HigherBox:q0",
          args: [variable("a")],
          kind: k1,
        }],
      },
    };
    const registry = createTestRegistry([testModule("higher-box", [box])]);
    const signature = registry.listConstructorSignatures().find((row) =>
      row.ownerModule === "higher-box" && row.name === "Wrap"
    );
    expect(signature?.outcome.$tag).toBe("Solved");
    expect(signature?.scheme?.quantified.map(({ sourceName, kind }) => ({ sourceName, kind })))
      .toEqual([
        { sourceName: "f", kind: k1 },
        { sourceName: "a", kind: kType },
      ]);
    expect(signature?.scheme?.applications?.map((entry) => ({
      path: entry.path,
      head: "headVarId" in entry ? entry.headVarId : entry.headRef,
      kind: entry.kind,
    }))).toEqual([
      {
        path: ["$arrow", "params", "0", "type"],
        head: "higher-box:HigherBox:q0",
        kind: k1,
      },
      {
        path: ["$arrow", "returns"],
        head: "HigherBox",
        kind: {
          $tag: "KArrow",
          input: k1,
          output: { $tag: "KArrow", input: kType, output: kType },
        },
      },
    ]);
    expect(signature?.params[0]?.key).toEqual({ $tag: "PositionalField", index: 0 });
  }, 180_000);

  test("materializes kinded constructors before strict source signature finalization", () => {
    const box = variantEntity("lazy-constructor", "Box", ["a"], [{
      name: "Wrap",
      fields: [positionalField("_0", 0, variable("a"))],
    }]);
    const roundTrip = inferredFunction(
      "lazy-constructor",
      "roundTrip",
      ["_0"],
      {
        match: [
          { var: "_0" },
          { $tag: "Wrap", _0: { $bind: "value" } },
          { construct: ["Wrap", { var: "value" }] },
        ],
      },
    );

    const lock = repositoryIdentityLock();
    const registry = createRegistry([
      testModule("lazy-constructor", [box], [roundTrip]),
    ], {
      publishCatalogEntities: false,
      codeNameLock: lock,
      fieldIdentity: {
        mode: "strict-embedded",
        defaultRealm: "repository-source",
        lock,
      },
    });

    const effective = registry.getFunction(roundTrip.fn.id)!;
    const parameter = application(effective.params[0]!.type);
    expect(parameter.head).toBe("Box");
    expect(parameter.args).toHaveLength(1);
    expect(effective.returns).toEqual(effective.params[0]!.type);
    expect(registry.getFunctionSignatureInfo(roundTrip.fn.id)).toBeDefined();
    expect(registry.listConstructorSignatures().find(({ name }) => name === "Wrap")?.outcome)
      .toEqual({ $tag: "Solved" });
  }, 180_000);

  test("an opaque alias does not re-export a nested nominal owner's constructors", () => {
    const sequenceType = {
      $opaque: {
        name: "Sequence",
        pure: {
          $variant: {
            cases: [
              { name: "SeqNil", label: Nothing },
              {
                name: "SeqCons",
                label: Nothing,
                fields: [
                  positionalField("_0", 0, ref("Number")),
                  positionalField("_1", 1, ref("Sequence")),
                ],
              },
            ],
          },
        },
      },
    } satisfies FenelType;
    const aliasType = {
      $opaque: { name: "TextAlias", pure: sequenceType },
    } satisfies FenelType;
    const entities: Entity[] = [
      {
        id: "Sequence",
        module: "opaque-alias",
        type: sequenceType,
        typeScheme: { quantified: [], body: sequenceType },
      },
      {
        id: "TextAlias",
        module: "opaque-alias",
        type: aliasType,
        typeScheme: { quantified: [], body: aliasType },
      },
    ];

    const registry = createTestRegistry([testModule("opaque-alias", entities)]);
    const catalog = compileConstructorCatalogCandidates(registry);
    expect(catalog.filter(({ ownerId }) => ownerId === "Sequence").map(({ name }) => name))
      .toEqual(["SeqCons", "SeqNil"]);
    expect(catalog.some(({ ownerId }) => ownerId === "TextAlias")).toBeFalse();
    expect(registry.listConstructorSignatures().some(({ ownerName }) => ownerName === "TextAlias"))
      .toBeFalse();
  }, 180_000);

  test("keeps duplicate same-id constructor owners module-qualified in authoring", () => {
    const left = variantEntity("left", "Shared", [], [{ name: "Dup", fields: [] }]);
    const right = variantEntity("right", "Shared", [], [{ name: "Dup", fields: [] }]);
    const registry = createTestRegistry([
      testModule("left", [left]),
      testModule("right", [right]),
    ]);
    const signatures = registry.listConstructorSignatures().filter(({ name }) => name === "Dup");
    expect(signatures.map(({ ownerModule }) => ownerModule).sort()).toEqual(["left", "right"]);
    expect(new Set(signatures.map(({ ownerIdentity }) => ownerIdentity)).size).toBe(2);

    const snapshot = buildAuthoringCatalogSnapshot([], { registry });
    expect(snapshot.patternConstructors?.filter(({ id }) => id === "Dup")).toHaveLength(2);
    const result = inferJsonLogicPatternBindings(
      { $tag: "Dup" },
      ref("Shared"),
      createAuthoringEnvironment(snapshot),
    );
    expect(result.outcome.$tag).toBe("AnnotationRequired");
    if (result.outcome.$tag === "AnnotationRequired") {
      expect(result.outcome.diagnostics.map(({ code }) => code)).toContain(
        "inference.ambiguous-call",
      );
    }
  }, 180_000);

  test("publishes final constructor fences through source-frame routes", () => {
    const declared = variantEntity("fenced-wire", "Fenced", [], [{
      name: "NeedsScheme",
      fields: [],
    }]);
    const { typeScheme: _discardedScheme, ...fencedEntity } = declared;
    const registry = createTestRegistry([
      testModule("fenced-wire", [fencedEntity]),
    ]);
    const signature = registry.listConstructorSignatures()
      .find(({ name }) => name === "NeedsScheme");
    expect(signature?.outcome.$tag).toBe("AnnotationRequired");

    const row = registry.listSourceConstructorResolutions("fenced-wire")
      .find(({ name }) => name === "NeedsScheme");
    expect(row).toMatchObject({
      status: "fenced",
      targetId: signature?.targetId,
      verdict: "AnnotationRequired",
    });
    expect(row?.diagnostics).toEqual(signature?.outcome.$tag === "AnnotationRequired"
      ? signature.outcome.diagnostics
      : undefined);
  }, 180_000);

  test("persists exact duplicate constructor targets while evaluating their short wire tag and owner fields", () => {
    const leftValueKey = "11111111-1111-4111-8111-111111111111";
    const rightValueKey = "22222222-2222-4222-8222-222222222222";
    const left = variantEntity("left-wire", "Shared", [], [{
      name: "Dup",
      fields: [namedField("leftValue", leftValueKey, ref("String"))],
    }]);
    const right = variantEntity("right-wire", "Shared", [], [{
      name: "Dup",
      fields: [namedField("rightValue", rightValueKey, ref("String"))],
    }, {
      name: "OnlyRight",
      fields: [],
    }]);
    const consumer: FenelModule = {
      ...testModule("wire-consumer", []),
      imports: [
        { module: "left-wire", as: "L" },
        { module: "right-wire", as: "R" },
        { module: "left-wire", as: "D" },
        { module: "right-wire", as: "D" },
      ],
    };
    const selectiveConsumer: FenelModule = {
      ...testModule("wire-selective-consumer", []),
      imports: [
        { module: "left-wire", names: ["Dup", "OnlyRight"] },
        { module: "right-wire", names: ["Dup"] },
      ],
    };
    const hidingConsumer: FenelModule = {
      ...testModule("wire-hiding-consumer", []),
      imports: [{ module: "left-wire", hiding: [] }],
    };
    const registry = createTestRegistry([
      testModule("left-wire", [left]),
      testModule("right-wire", [right]),
      consumer,
      selectiveConsumer,
      hidingConsumer,
    ], [
      { id: leftValueKey, currentCodeName: "leftValue" },
      { id: rightValueKey, currentCodeName: "rightValue" },
    ]);
    const rows = new Map(
      registry.listSourceConstructorResolutions("wire-consumer")
        .map((row) => [row.name, row] as const),
    );
    expect(rows.get("Dup")?.status).toBe("ambiguous");
    expect(rows.get("D.Dup")?.targetId).toStartWith("@ctor/right-wire/Shared/Dup");
    const leftTarget = rows.get("L.Dup")?.targetId;
    const rightTarget = rows.get("R.Dup")?.targetId;
    expect(leftTarget).toStartWith("@ctor/left-wire/Shared/Dup");
    expect(rightTarget).toStartWith("@ctor/right-wire/Shared/Dup");
    if (leftTarget === undefined || rightTarget === undefined) {
      throw new Error("missing exact duplicate constructor routes");
    }
    const selectiveRows = new Map(
      registry.listSourceConstructorResolutions(selectiveConsumer.name)
        .map((row) => [row.name, row] as const),
    );
    expect(selectiveRows.get("Dup")?.targetId).toBe(rightTarget);
    expect(selectiveRows.get("OnlyRight")?.status).toBe("missing");
    const hidingRows = new Map(
      registry.listSourceConstructorResolutions(hidingConsumer.name)
        .map((row) => [row.name, row] as const),
    );
    expect(hidingRows.get("Dup")?.targetId).toBe(leftTarget);

    const ctx = registry.evaluateContext();
    const leftValue = evaluate({
      construct: [leftTarget, { leftValue: "left" }],
    }, {}, ctx) as Record<string, unknown>;
    const rightValue = evaluate({
      construct: [rightTarget, { rightValue: "right" }],
    }, {}, ctx) as Record<string, unknown>;
    expect(leftValue.$tag).toBe("Dup");
    expect(leftValue.leftValue).toBe("left");
    expect("rightValue" in leftValue).toBeFalse();
    expect(rightValue.$tag).toBe("Dup");
    expect(rightValue.rightValue).toBe("right");
    expect("leftValue" in rightValue).toBeFalse();

    expect(matchPattern(leftValue, {
      $tag: leftTarget,
      leftValue: { $bind: "selected" },
    }, ctx)).toEqual({ selected: "left" });
    expect(matchPattern(leftValue, {
      $tag: rightTarget,
      rightValue: { $bind: "selected" },
    }, ctx)).toBeNull();

    expect(() => evaluate({ construct: [leftTarget] }, {}, {
      _constructors: { [leftTarget]: [] },
    })).toThrow("must be a non-empty short tag outside the reserved @ctor/ namespace");
    expect(() => evaluate({ construct: [leftTarget] }, {}, {
      _constructors: { [leftTarget]: [] },
      _constructorWireNames: { [leftTarget]: 42 } as unknown as Record<string, string>,
    })).toThrow("must be a non-empty short tag outside the reserved @ctor/ namespace");
    expect(() => evaluate({ construct: [leftTarget] }, {}, {
      _constructors: { [leftTarget]: [] },
      _constructorWireNames: { [leftTarget]: "" },
    })).toThrow("must be a non-empty short tag outside the reserved @ctor/ namespace");
    expect(() => evaluate({ construct: ["Dup"] }, {}, {
      _constructors: { Dup: [] },
      _constructorWireNames: { Dup: leftTarget },
    })).toThrow("must be a non-empty short tag outside the reserved @ctor/ namespace");
  }, 180_000);

  test("collect-requirements defers constructor inference until lockless fields are minted", () => {
    const recordedMovieType = {
      $record: {
        fields: [{
          name: "fps",
          type: ref("Number"),
          label: Nothing,
          ui: Nothing,
          meta: {},
        }],
      },
    } satisfies FenelType;
    const recordedMovie: Entity = {
      id: "RecordedMovie",
      module: "movie",
      type: recordedMovieType,
      typeScheme: { quantified: [], body: recordedMovieType },
    };
    const makeRecordedMovie = inferredFunction(
      "movie",
      "makeRecordedMovie",
      ["_0"],
      { construct: ["RecordedMovie", { var: "_0" }] },
    );
    const mod = testModule("movie", [recordedMovie], [makeRecordedMovie]);
    // Registry construction now carries the full repository identity
    // projection even for a narrow module fixture. Seed that stable baseline
    // so collect mode reports only this fixture's intentionally lockless field.
    const physical = repositoryIdentityLock();
    // Type rows are keyed by their owner (per-owner type identity).
    physical.set("type/module/movie/RecordedMovie", "11111111-1111-4111-8111-111111111111");
    physical.set("movie:makeRecordedMovie", "22222222-2222-4222-8222-222222222222");

    const collecting = createRegistry([mod], {
      codeNameLock: physical,
      fieldIdentity: {
        mode: "collect-requirements",
        defaultRealm: "repository-source",
        lock: physical,
      },
    });
    const requests = collecting.listFieldLockRequests();
    const fpsRequest = requests.find((request) => request.name.includes("fps"));
    expect(fpsRequest).toBeDefined();
    if (fpsRequest === undefined) throw new Error("missing RecordedMovie.fps lock request");
    expect(collecting.getFunctionSignatureInfo(makeRecordedMovie.fn.id)).toBeUndefined();

    const minted = new Map(physical);
    const usedIds = new Set(minted.values());
    let serial = 1;
    for (const request of requests) {
      let id: string;
      do {
        id = `ffffffff-ffff-4fff-8fff-${serial.toString(16).padStart(12, "0")}`;
        serial += 1;
      } while (usedIds.has(id));
      usedIds.add(id);
      minted.set(request.name, id);
    }
    const strict = createRegistry([mod], {
      codeNameLock: minted,
      fieldIdentity: {
        mode: "strict-embedded",
        defaultRealm: "repository-source",
        lock: minted,
      },
    });
    const effective = strict.getFunction(makeRecordedMovie.fn.id)!;
    expect(effective.params[0]!.type).toEqual(ref("Number"));
    expect(effective.returns).toEqual(ref("RecordedMovie"));
    expect(strict.getFunctionSignatureInfo(makeRecordedMovie.fn.id)).toBeDefined();
    const identified = strict.getIdentifiedEntity("RecordedMovie")!;
    const identifiedScheme = identified.typeScheme;
    expect(identifiedScheme?.body).toBe(identified.type);
    if (identifiedScheme === undefined || !("$record" in identifiedScheme.body)) {
      throw new Error("expected identified RecordedMovie record scheme");
    }
    expect(identifiedScheme.body.$record.fields[0]!.key).toEqual({
      $tag: "NamedField",
      ref: { $ref: minted.get(fpsRequest.name)! },
    });
    expect("key" in recordedMovieType.$record.fields[0]!).toBeFalse();
  }, 360_000);

  test("telegram Parsed wins locally over AIResponse.Parsed in either module order, including named patterns", () => {
    const aiParsedKey = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const telegramParsedKey = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const aiResponse = variantEntity("ai", "AIResponse", [], [{
      name: "Parsed",
      fields: [namedField("modelValue", aiParsedKey, ref("Number"))],
    }]);
    const fieldParseResult = variantEntity("telegram", "FieldParseResult", [], [{
      name: "Parsed",
      fields: [namedField("draftText", telegramParsedKey, ref("String"))],
    }]);
    const wrapDraftField = inferredFunction(
      "telegram",
      "wrapDraftField",
      ["_0"],
      { construct: ["Parsed", { var: "_0" }] },
    );
    const unwrapDraftField = inferredFunction(
      "telegram",
      "unwrapDraftField",
      ["_0"],
      {
        match: [
          { var: "_0" },
          { $tag: "Parsed", draftText: { $bind: "text" } },
          { var: "text" },
        ],
      },
    );
    const ai = testModule("ai", [aiResponse]);
    const telegram = testModule(
      "telegram",
      [fieldParseResult],
      [wrapDraftField, unwrapDraftField],
    );
    const fieldIdentity = [
      { id: aiParsedKey, currentCodeName: "modelValue" },
      { id: telegramParsedKey, currentCodeName: "draftText" },
    ];

    for (const modules of [[ai, telegram], [telegram, ai]]) {
      const registry = createTestRegistry(modules, fieldIdentity);
      const wrap = registry.getFunction("telegram:wrapDraftField")!;
      expect(wrap.params[0]!.type).toEqual(ref("String"));
      expect(wrap.returns).toEqual(ref("FieldParseResult"));

      const unwrap = registry.getFunction("telegram:unwrapDraftField")!;
      expect(unwrap.params[0]!.type).toEqual(ref("FieldParseResult"));
      expect(unwrap.returns).toEqual(ref("String"));

      const catalog = compileConstructorCatalogCandidates(registry);
      const telegramParsed = constructorCandidate(catalog, "FieldParseResult", "Parsed");
      const aiParsed = constructorCandidate(catalog, "AIResponse", "Parsed");
      expect(telegramParsed.fields[0]!.key).toEqual({
        $tag: "NamedField",
        ref: { $ref: telegramParsedKey },
      });
      expect(aiParsed.fields[0]!.key).toEqual({
        $tag: "NamedField",
        ref: { $ref: aiParsedKey },
      });

      const syntaxResult = dispatchedJsonLogicToSyntax(unwrapDraftField.fn.body, {
        Parsed: telegramParsed.fields,
      }) as {
        readonly $tag: "Ok" | "Err";
        readonly _0?: {
          readonly arms?: ReadonlyArray<{
            readonly pattern?: { readonly fields?: ReadonlyArray<{ readonly key: FieldKey }> };
          }>;
        };
      };
      expect(syntaxResult.$tag).toBe("Ok");
      expect(syntaxResult._0?.arms?.[0]?.pattern?.fields?.[0]?.key).toEqual({
        $tag: "NamedField",
        ref: { $ref: telegramParsedKey },
      });
    }
  }, 360_000);

  test("two distinct local BotCommand owners remain explicitly ambiguous", () => {
    const first = variantEntity("telegram", "PrimaryBotCommand", [], [{
      name: "BotCommand",
      fields: [namedField(
        "command",
        "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        ref("String"),
      )],
    }]);
    const second = variantEntity("telegram", "SecondaryBotCommand", [], [{
      name: "BotCommand",
      fields: [namedField(
        "sequence",
        "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        ref("Number"),
      )],
    }]);
    const make = inferredFunction(
      "telegram",
      "makeBotCommand",
      ["_0"],
      { construct: ["BotCommand", { var: "_0" }] },
    );

    expect(() => createTestRegistry(
      [testModule("telegram", [first, second], [make])],
      [
        { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", currentCodeName: "command" },
        { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", currentCodeName: "sequence" },
      ],
    )).toThrow(/inference\.ambiguous-call: call target is ambiguous: \$ctor:BotCommand/);
  }, 180_000);

  test("same-id parameterized owners remain distinct even when their expansions coincide", () => {
    const left = variantEntity("left", "Shared", ["a"], [{
      name: "LeftShared",
      fields: [positionalField("_0", 0, variable("a"))],
    }]);
    const right = variantEntity("right", "Shared", ["a"], [{
      name: "RightShared",
      fields: [positionalField("_0", 0, variable("a"))],
    }]);
    const probe = inferredFunction(
      "probe",
      "sameIdOwnersStayDistinct",
      ["_0", "_1", "_2"],
      {
        left: {
          call: [{ var: "_0" }, { construct: ["LeftShared", { var: "_1" }] }],
        },
        right: {
          call: [{ var: "_0" }, { construct: ["RightShared", { var: "_2" }] }],
        },
      },
    );

    // Reusing one monomorphic callback at these two exact nominal owners is
    // precisely the bounded rank-1 higher-rank fence. If owner identity were
    // collapsed by their shared public id/expansion, this would infer cleanly.
    expect(() => createTestRegistry([
      testModule("left", [left]),
      testModule("right", [right]),
      testModule("probe", [], [probe]),
    ])).toThrow(/inference\.higher-rank/);
  }, 180_000);

  test("source-authored aliased nominal applications resolve to the exact duplicate owner", () => {
    const left = variantEntity("left", "Shared", ["a"], [{
      name: "LeftShared",
      fields: [positionalField("_0", 0, variable("a"))],
    }]);
    const right = variantEntity("right", "Shared", ["a"], [{
      name: "RightShared",
      fields: [positionalField("_0", 0, variable("a"))],
    }]);
    const kType = { $tag: "KType" } as const;
    const k1 = { $tag: "KArrow", input: kType, output: kType } as const;
    const leftA = {
      $el: { call: ["L.Shared", variable("a")] },
    } satisfies FenelType;
    const acceptParam = positionalField("_0", 0, leftA);
    const authored = {
      $tag: "Authored" as const,
      source: {
        $tag: "SourceTypeSig" as const,
        module: "probe",
        declaration: "acceptLeft",
      },
    };
    const acceptLeft: InferredFunction = {
      fn: {
        id: "probe:acceptLeft",
        params: [acceptParam],
        returns: ref("String"),
        body: "accepted",
      },
      declaration: {
        functionId: "probe:acceptLeft",
        declarationName: "acceptLeft",
        codeName: "acceptLeft",
        scheme: {
          quantified: [{ id: "probe:acceptLeft:q0", sourceName: "a", kind: kType }],
          body: {
            $arrow: { params: [acceptParam], returns: ref("String") },
          },
          applications: [{
            path: ["$arrow", "params", "0", "type"],
            headRef: "L.Shared",
            args: [variable("a")],
            kind: k1,
          }],
          diagnostics: [],
        },
        params: [authored],
        returns: authored,
      },
    };
    const useLeft = inferredFunction(
      "probe",
      "useLeft",
      ["_0"],
      { call: ["acceptLeft", { construct: ["LeftShared", { var: "_0" }] }] },
    );
    const probeModule = {
      ...testModule("probe", [], [acceptLeft, useLeft]),
      imports: [
        { module: "left", as: "L" },
        { module: "right", as: "R" },
      ],
    } satisfies FenelModule;

    const registry = createTestRegistry([
      testModule("left", [left]),
      testModule("right", [right]),
      probeModule,
    ]);
    const acceptScheme = registry.getFunctionSignatureInfo("probe:acceptLeft")!.scheme;
    expect(acceptScheme.nominals).toContainEqual({
      path: ["$arrow", "params", "0", "type"],
      identity: '["left","Shared"]',
      publicName: "L.Shared",
    });
    expect(acceptScheme.applications?.[0]?.kind).toEqual(k1);
    expect(registry.getFunction("probe:useLeft")?.returns).toEqual(ref("String"));

    const useRight = inferredFunction(
      "probe",
      "useRight",
      ["_0"],
      { call: ["acceptLeft", { construct: ["RightShared", { var: "_0" }] }] },
    );
    const wrongProbeModule = {
      ...testModule("probe", [], [acceptLeft, useRight]),
      imports: probeModule.imports,
    } satisfies FenelModule;
    expect(() => createTestRegistry([
      testModule("left", [left]),
      testModule("right", [right]),
      wrongProbeModule,
    ])).toThrow(/inference\.nominal-mismatch/);
  }, 360_000);

  test("patterns over external structural Maybe (List a) unify with nominal constructors", () => {
    const maybe = variantEntity("system", "Maybe", ["a"], [
      { name: "Nothing", fields: [] },
      { name: "Just", fields: [positionalField("_0", 0, variable("a"))] },
    ]);
    const listA = List(variable("a"));
    const maybeListA = Maybe(listA);
    const tailParam = positionalField("_0", 0, listA);
    const authored = {
      $tag: "Authored" as const,
      source: {
        $tag: "SourceTypeSig" as const,
        module: "system",
        declaration: "tail",
      },
    };
    const tail: InferredFunction = {
      fn: {
        id: "system:tail",
        params: [tailParam],
        returns: maybeListA,
        body: { var: "_0" },
      },
      declaration: {
        functionId: "system:tail",
        declarationName: "tail",
        codeName: "tail",
        scheme: {
          quantified: [{
            id: "system:tail:q0",
            sourceName: "a",
            kind: { $tag: "KType" },
          }],
          body: { $arrow: { params: [tailParam], returns: maybeListA } },
        },
        params: [authored],
        returns: authored,
      },
    };
    const unwrap = inferredFunction(
      "system",
      "unwrapTail",
      ["_0"],
      {
        match: [
          { call: ["tail", { var: "_0" }] },
          { $tag: "Just", _0: { $bind: "rest" } },
          { var: "rest" },
        ],
      },
    );

    const registry = createTestRegistry([
      testModule("system", [maybe], [tail, unwrap]),
    ]);
    const effective = registry.getFunction(unwrap.fn.id)!;
    expect(effective.params[0]!.type).toEqual(effective.returns);
    expect(effective.returns).toHaveProperty("$opaque.name", "List");

    const just = registry.listConstructorSignatures().find((signature) =>
      signature.ownerModule === "system" && signature.name === "Just"
    );
    expect(just?.outcome.$tag).toBe("Solved");
    expect(application(arrowBody(just!.scheme!).returns).head).toBe("Maybe");
  }, 180_000);

  test("an unresolved field in an unselected constructor does not fence an exact selected constructor", () => {
    const base = variantEntity("sample", "Choice", [], [
      { name: "Clean", fields: [] },
      { name: "Loose", fields: [positionalField("_0", 0, ref("a"))] },
      { name: "AlsoLoose", fields: [positionalField("_0", 0, ref("a"))] },
    ]);
    const choice: Entity = {
      ...base,
      typeScheme: {
        ...base.typeScheme!,
        diagnostics: [{
          code: "UnboundTypeIdentifier",
          declaration: "Choice",
          path: ["constructors", "1", "fields", "0", "type"],
          spelling: "a",
          message: "unbound lowercase type identifier a in declaration Choice",
        }, {
          code: "UnboundTypeIdentifier",
          declaration: "Choice",
          path: ["constructors", "2", "fields", "0", "type"],
          spelling: "a",
          message: "unbound lowercase type identifier a in declaration Choice",
        }],
      },
    };
    const makeClean = inferredFunction(
      "sample",
      "makeClean",
      [],
      { construct: ["Clean"] },
    );
    const cleanRegistry = createTestRegistry([
      testModule("sample", [choice], [makeClean]),
    ]);
    expect(cleanRegistry.getFunction(makeClean.fn.id)!.returns).toEqual(ref("Choice"));

    const makeLoose = inferredFunction(
      "sample",
      "makeLoose",
      ["_0"],
      { construct: ["Loose", { var: "_0" }] },
    );
    expect(() => createTestRegistry([
      testModule("sample", [choice], [makeLoose]),
    ])).toThrow(/inference\.source-scheme: constructor Loose of Choice has unresolved source binding diagnostics/);

    const makeAlsoLoose = inferredFunction(
      "sample",
      "makeAlsoLoose",
      ["_0"],
      { construct: ["AlsoLoose", { var: "_0" }] },
    );
    expect(() => createTestRegistry([
      testModule("sample", [choice], [makeAlsoLoose]),
    ])).toThrow(/inference\.source-scheme: constructor AlsoLoose of Choice has unresolved source binding diagnostics/);
  }, 600_000);

  test("Left, Right, Just, and Ok instantiate fresh variables and retain result-only variables", () => {
    const result = variantEntity("poly", "Result", ["error", "value"], [
      {
        name: "Left",
        fields: [positionalField("_0", 0, variable("error"))],
      },
      {
        name: "Right",
        fields: [positionalField("_0", 0, variable("value"))],
      },
      {
        name: "Ok",
        fields: [positionalField("_0", 0, variable("value"))],
      },
    ]);
    const maybe = variantEntity("poly", "Maybe", ["value"], [{
      name: "Just",
      fields: [positionalField("_0", 0, variable("value"))],
    }]);
    const probe = inferredFunction(
      "poly",
      "constructorFreshness",
      ["_0", "_1", "_2", "_3", "_4", "_5"],
      {
        leftOne: { construct: ["Left", { var: "_0" }] },
        leftTwo: { construct: ["Left", { var: "_1" }] },
        rightValue: { construct: ["Right", { var: "_2" }] },
        justOne: { construct: ["Just", { var: "_3" }] },
        justTwo: { construct: ["Just", { var: "_4" }] },
        okValue: { construct: ["Ok", { var: "_5" }] },
      },
    );
    const registry = createTestRegistry([testModule("poly", [result, maybe], [probe])]);
    const scheme = registry.getFunctionSignatureInfo(probe.fn.id)!.scheme;
    const arrow = arrowBody(scheme);
    const params = arrow.params.map((param) => variableName(param.type));
    expect(new Set(params).size).toBe(6);

    const fields = recordFields(arrow.returns);
    const leftOne = application(fields.get("leftOne")!);
    const leftTwo = application(fields.get("leftTwo")!);
    const right = application(fields.get("rightValue")!);
    const justOne = application(fields.get("justOne")!);
    const justTwo = application(fields.get("justTwo")!);
    const ok = application(fields.get("okValue")!);

    expect([leftOne.head, leftTwo.head, right.head, ok.head]).toEqual([
      "Result",
      "Result",
      "Result",
      "Result",
    ]);
    expect([justOne.head, justTwo.head]).toEqual(["Maybe", "Maybe"]);
    expect(variableName(leftOne.args[0]!)).toBe(params[0]!);
    expect(variableName(leftTwo.args[0]!)).toBe(params[1]!);
    expect(variableName(right.args[1]!)).toBe(params[2]!);
    expect(variableName(justOne.args[0]!)).toBe(params[3]!);
    expect(variableName(justTwo.args[0]!)).toBe(params[4]!);
    expect(variableName(ok.args[1]!)).toBe(params[5]!);

    const resultOnly = [
      variableName(leftOne.args[1]!),
      variableName(leftTwo.args[1]!),
      variableName(right.args[0]!),
      variableName(ok.args[0]!),
    ];
    expect(new Set(resultOnly).size).toBe(4);
    expect(resultOnly.every((name) => !params.includes(name))).toBe(true);
    expect(scheme.quantified).toHaveLength(10);
    expect(scheme.applications?.map((entry) => "headRef" in entry ? entry.headRef : "")).toEqual([
      "Maybe",
      "Maybe",
      "Result",
      "Result",
      "Result",
      "Result",
    ]);
  }, 180_000);
});
