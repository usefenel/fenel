// Phase 4 — canonical SetExpr boundary convergence.
//
// SetExpr is a single public 14-case `$tag` ADT. The boundary remains
// deliberately tolerant of the historical 11 `$`-key spellings, but those
// spellings are unknown wire input — never members of the SetExpr type.

import { describe, expect, it } from "bun:test";
import setExprTypesSrc from "../../../../fenel/modules/engine/set-expr-types.fenel?raw";
import { loadFenelModule } from "./fenel-module";
import {
  SET_EXPR_TAGS,
  buildSetExpr,
  isSetExpr,
  liftTypeSetMarkers,
  peelSetExpr,
  setExprToDollarKey,
  setExprToTag,
  type SetExprView,
} from "./set-marker";
import { Just, stripEmptyVariantFields } from "./type-foundation";
import type { Expression, FenelType, FieldKey, Interval, Pattern, SetExpr } from "./types";
import { fenelTypeToJsonSchema } from "./json-schema";
import { validate } from "./validate";
import { widgetForType } from "./widget-hint";
import { parseEntityDef, printEntityDef } from "./entity-def-printer";
import { print } from "./engine-bodies-dispatch";
import { elem } from "./markup";
import { validateWithHints } from "./validation-hints";

type SetExprTag = (typeof SET_EXPR_TAGS)[number];
type KeysOfUnion<T> = T extends unknown ? keyof T : never;
type PublicLegacyKey = Exclude<Extract<KeysOfUnion<SetExpr>, `$${string}`>, "$tag">;

// Compile-time contract: the public union has no legacy `$foo` keys.
const PUBLIC_SET_EXPR_HAS_NO_LEGACY_KEYS: [PublicLegacyKey] extends [never] ? true : never = true;
void PUBLIC_SET_EXPR_HAS_NO_LEGACY_KEYS;

// @ts-expect-error — legacy wire input is intentionally not a public SetExpr.
const LEGACY_INPUT_CANNOT_MASQUERADE_AS_SET_EXPR: SetExpr = { $all: true };
void LEGACY_INPUT_CANNOT_MASQUERADE_AS_SET_EXPR;

const IV: Interval = {
  lo: Just({ value: 0, inclusive: true }),
  hi: Just({ value: 10, inclusive: false }),
};
const PRED: Expression = { ">": [{ var: "x" }, 0] };
const PAT: Pattern = { t: "match", pred: { $tag: "SeEnum", values: ["a"] } };
const key = (n: number): FieldKey => ({
  $tag: "NamedField",
  ref: { $ref: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}` },
});

const canonicalForms: Record<SetExprTag, SetExpr> = {
  SeAll: { $tag: "SeAll" },
  SeNone: { $tag: "SeNone" },
  SeEnum: { $tag: "SeEnum", values: ["x", "y", 3] },
  SeInterval: { $tag: "SeInterval", interval: IV },
  SeRef: { $tag: "SeRef", handle: "Integer" },
  SePattern: { $tag: "SePattern", pattern: PAT },
  SeWhere: { $tag: "SeWhere", pred: PRED },
  SeCtor: {
    $tag: "SeCtor",
    ctor: "Pair",
    fields: [
      { $tag: "SetCtorField", key: key(1), wireName: "left", set: { $tag: "SeEnum", values: [1] } },
      { $tag: "SetCtorField", key: key(2), wireName: "right", set: { $tag: "SeAll" } },
    ],
  },
  SeMu: { $tag: "SeMu", var: "X", body: { $tag: "SeRef", handle: "X" } },
  SeArrow: {
    $tag: "SeArrow",
    params: [{ $tag: "SetArrowParam", key: key(3), wireName: "value", set: { $tag: "SeEnum", values: [1] } }],
    returns: { $tag: "SeAll" },
  },
  // signature-substrate Phase 4 slice 3a — the validation rigid atom κ. It is a
  // recognized member of the roster (the recognizer and the canonicalization
  // gateway must know one, or every host boundary silently reclassifies it as
  // "not a set expression"); the `$`-key egress codec is where non-escape is
  // enforced, and the loops below carve that asymmetry out explicitly.
  SeRigid: { $tag: "SeRigid", scopeToken: "scope-1", ordinal: 0, kind: { $tag: "KType" } },
  SeUnion: { $tag: "SeUnion", branches: [{ $tag: "SeEnum", values: [1] }, { $tag: "SeRef", handle: "Integer" }] },
  SeIntersect: { $tag: "SeIntersect", branches: [{ $tag: "SeRef", handle: "Integer" }, { $tag: "SeInterval", interval: IV }] },
  SeDiff: { $tag: "SeDiff", left: { $tag: "SeAll" }, right: { $tag: "SeEnum", values: [1] } },
  SeComplement: { $tag: "SeComplement", inner: { $tag: "SeRef", handle: "Integer" } },
};

const LEGACY_TAGS = [
  "SeAll",
  "SeNone",
  "SeEnum",
  "SeInterval",
  "SeRef",
  "SePattern",
  "SeWhere",
  "SeUnion",
  "SeIntersect",
  "SeDiff",
  "SeComplement",
] as const;
type LegacyTag = (typeof LEGACY_TAGS)[number];

// These are intentionally unknown boundary values. Do not cast them to
// SetExpr: recognizing them must not revive a public legacy union.
const legacyForms: Record<LegacyTag, unknown> = {
  SeAll: { $all: true },
  SeNone: { $none: true },
  SeEnum: { $enum: ["x", "y", 3] },
  SeInterval: { $interval: IV },
  SeRef: { $ref: "Integer" },
  SePattern: { $pattern: { t: "match", pred: { $enum: ["a"] } } },
  SeWhere: { $where: PRED },
  SeUnion: { $union: [{ $enum: [1] }, { $ref: "Integer" }] },
  SeIntersect: { $intersect: [{ $ref: "Integer" }, { $interval: IV }] },
  SeDiff: { $diff: [{ $all: true }, { $enum: [1] }] },
  SeComplement: { $complement: { $ref: "Integer" } },
};

function unreachable(value: never): never {
  throw new Error(`Unhandled SetExpr view: ${JSON.stringify(value)}`);
}

/** Fully peel a tree into a spelling-independent test representation. */
function canon(set: unknown): unknown {
  const view: SetExprView<unknown> | null = peelSetExpr(set);
  if (view === null) return { kind: "Point", value: set };
  switch (view.kind) {
    case "SeAll":
    case "SeNone":
      return { kind: view.kind };
    case "SeEnum":
      return { kind: view.kind, values: view.values };
    case "SeInterval":
      return { kind: view.kind, interval: view.interval };
    case "SeRef":
      return { kind: view.kind, handle: view.handle };
    case "SePattern":
      return { kind: view.kind, pattern: view.pattern };
    case "SeWhere":
      return { kind: view.kind, pred: view.pred };
    case "SeCtor":
      return {
        kind: view.kind,
        ctor: view.ctor,
        fields: view.fields.map((field) => ({ key: field.key, wireName: field.wireName, set: canon(field.set) })),
      };
    case "SeMu":
      return { kind: view.kind, var: view.var, body: canon(view.body) };
    case "SeArrow":
      return {
        kind: view.kind,
        params: view.params.map((param) => ({ key: param.key, wireName: param.wireName, set: canon(param.set) })),
        returns: canon(view.returns),
      };
    case "SeUnion":
    case "SeIntersect":
      return { kind: view.kind, branches: view.branches.map(canon) };
    case "SeDiff":
      return { kind: view.kind, left: canon(view.left), right: canon(view.right) };
    case "SeComplement":
      return { kind: view.kind, inner: canon(view.inner) };
    case "SeRigid":
      return {
        kind: view.kind,
        scopeToken: view.scopeToken,
        ordinal: view.ordinal,
        rigidKind: view.rigidKind,
      };
    default:
      return unreachable(view);
  }
}

describe("the one SetExpr roster", () => {
  it("matches the registered Fenel SetExpr ADT exactly and in order", () => {
    const mod = loadFenelModule(setExprTypesSrc, "engine");
    const entity = (mod.entities ?? []).find((entry) => entry.id === "SetExpr");
    if (!entity) throw new Error("set-expr-types.fenel missing SetExpr");
    const type = stripEmptyVariantFields(entity.type) as FenelType;
    const registeredTags = (type as { $variant: { cases: Array<{ name: string }> } }).$variant.cases.map((entry) => entry.name);

    // signature-substrate Phase 4 slice 3a — 15 with the validation rigid atom.
    expect(SET_EXPR_TAGS).toHaveLength(15);
    expect(registeredTags).toEqual([...SET_EXPR_TAGS]);
    expect(Object.keys(canonicalForms)).toEqual([...SET_EXPR_TAGS]);
  });
});

describe("canonical SetExpr values", () => {
  for (const tag of SET_EXPR_TAGS) {
    it(`recognizes and peels ${tag}`, () => {
      const value = canonicalForms[tag];
      expect(isSetExpr(value)).toBe(true);
      expect(peelSetExpr(value)?.kind).toBe(tag);
      // signature-substrate P4 slice 3a — canonicalizing a validation rigid is
      // OPT-IN (`setExprToTag` is the untrusted-input gateway for the query API
      // and the permission-policy store). Recognition stays unconditional.
      expect(setExprToTag(value, tag === "SeRigid" ? { admitValidationRigid: true } : undefined))
        .toEqual(value);
    });
  }

  it("buildSetExpr covers all 15 canonical cases and typed child records", () => {
    const built: Record<SetExprTag, SetExpr> = {
      SeAll: buildSetExpr.all(),
      SeNone: buildSetExpr.none(),
      SeEnum: buildSetExpr.enum([1]),
      SeInterval: buildSetExpr.interval(IV),
      SeRef: buildSetExpr.ref("Integer"),
      SePattern: buildSetExpr.pattern(PAT),
      SeWhere: buildSetExpr.where(PRED),
      SeCtor: buildSetExpr.ctor("Box", [buildSetExpr.ctorField(key(4), "value", buildSetExpr.all())]),
      SeMu: buildSetExpr.mu("X", buildSetExpr.ref("X")),
      SeArrow: buildSetExpr.arrow([buildSetExpr.arrowParam(key(5), "x", buildSetExpr.all())], buildSetExpr.none()),
      SeRigid: buildSetExpr.rigid("scope-1", 0, { $tag: "KType" }),
      SeUnion: buildSetExpr.union([buildSetExpr.all()]),
      SeIntersect: buildSetExpr.intersect([buildSetExpr.all()]),
      SeDiff: buildSetExpr.diff(buildSetExpr.all(), buildSetExpr.none()),
      SeComplement: buildSetExpr.complement(buildSetExpr.none()),
    };

    expect(Object.keys(built)).toEqual([...SET_EXPR_TAGS]);
    for (const tag of SET_EXPR_TAGS) expect(built[tag].$tag).toBe(tag);
    expect(built.SeCtor).toEqual({
      $tag: "SeCtor",
      ctor: "Box",
      fields: [{ $tag: "SetCtorField", key: key(4), wireName: "value", set: { $tag: "SeAll" } }],
    });
    expect(built.SeArrow).toEqual({
      $tag: "SeArrow",
      params: [{ $tag: "SetArrowParam", key: key(5), wireName: "x", set: { $tag: "SeAll" } }],
      returns: { $tag: "SeNone" },
    });
  });
});

describe("legacy boundary tolerance", () => {
  for (const tag of LEGACY_TAGS) {
    it(`accepts legacy ${tag} as unknown and canonicalizes it`, () => {
      const legacy: unknown = legacyForms[tag];
      expect(isSetExpr(legacy)).toBe(true);
      expect(peelSetExpr(legacy)?.kind).toBe(tag);
      expect(setExprToTag(legacy)).toEqual(canonicalForms[tag]);
    });
  }

  it("isSetExpr is Boolean-only and does not narrow legacy unknown to SetExpr", () => {
    const legacy: unknown = { $all: true };
    if (!isSetExpr(legacy)) throw new Error("legacy boundary value was not recognized");
    // @ts-expect-error — Boolean recognition deliberately does not narrow unknown.
    const canonical: SetExpr = legacy;
    void canonical;
    expect(legacy).toEqual({ $all: true });
  });
});

describe("mixed and deep trees", () => {
  const mixed: unknown = {
    $tag: "SeCtor",
    ctor: "Node",
    fields: [
      { $tag: "SetCtorField", key: key(6), wireName: "value", set: { $enum: [1, 2] } },
      {
        $tag: "SetCtorField",
        key: key(7),
        wireName: "next",
        set: {
          $tag: "SeArrow",
          params: [
            {
              $tag: "SetArrowParam",
              key: key(8),
              wireName: "input",
              set: { $union: [{ $all: true }, { $tag: "SeNone" }] },
            },
          ],
          returns: {
            $tag: "SeMu",
            var: "X",
            body: { $diff: [{ $ref: "X" }, { $complement: { $none: true } }] },
          },
        },
      },
    ],
  };

  const tagged = setExprToTag(mixed);

  it("canonicalizes every nested legacy-capable child", () => {
    expect(tagged).toEqual({
      $tag: "SeCtor",
      ctor: "Node",
      fields: [
        { $tag: "SetCtorField", key: key(6), wireName: "value", set: { $tag: "SeEnum", values: [1, 2] } },
        {
          $tag: "SetCtorField",
          key: key(7),
          wireName: "next",
          set: {
            $tag: "SeArrow",
            params: [
              {
                $tag: "SetArrowParam",
                key: key(8),
                wireName: "input",
                set: { $tag: "SeUnion", branches: [{ $tag: "SeAll" }, { $tag: "SeNone" }] },
              },
            ],
            returns: {
              $tag: "SeMu",
              var: "X",
              body: {
                $tag: "SeDiff",
                left: { $tag: "SeRef", handle: "X" },
                right: { $tag: "SeComplement", inner: { $tag: "SeNone" } },
              },
            },
          },
        },
      ],
    });
    expect(canon(mixed)).toEqual(canon(tagged));
  });

  it("keeps deep formers tagged in the dollar direction while lowering children", () => {
    expect(setExprToDollarKey(mixed)).toEqual({
      $tag: "SeCtor",
      ctor: "Node",
      fields: [
        { $tag: "SetCtorField", key: key(6), wireName: "value", set: { $enum: [1, 2] } },
        {
          $tag: "SetCtorField",
          key: key(7),
          wireName: "next",
          set: {
            $tag: "SeArrow",
            params: [
              {
                $tag: "SetArrowParam",
                key: key(8),
                wireName: "input",
                set: { $union: [{ $all: true }, { $none: true }] },
              },
            ],
            returns: {
              $tag: "SeMu",
              var: "X",
              body: { $diff: [{ $ref: "X" }, { $complement: { $none: true } }] },
            },
          },
        },
      ],
    });
  });

  it("canonicalizes SetExpr children nested inside Pattern match/group nodes", () => {
    const legacyPattern: unknown = {
      $pattern: {
        t: "group",
        name: "capture",
        child: {
          t: "seq",
          a: { t: "match", pred: { $enum: ["a"] } },
          b: { t: "rep", child: { t: "match", pred: { $all: true } }, min: 0, max: 3 },
        },
        type: { $complement: { $none: true } },
      },
    };
    const canonicalPattern: SetExpr = {
      $tag: "SePattern",
      pattern: {
        t: "group",
        name: "capture",
        child: {
          t: "seq",
          a: { t: "match", pred: { $tag: "SeEnum", values: ["a"] } },
          b: {
            t: "rep",
            child: { t: "match", pred: { $tag: "SeAll" } },
            min: 0,
            max: 3,
          },
        },
        type: { $tag: "SeComplement", inner: { $tag: "SeNone" } },
      },
    };

    expect(setExprToTag(legacyPattern)).toEqual(canonicalPattern);
    expect(setExprToDollarKey(canonicalPattern)).toEqual(legacyPattern);
  });
});

describe("tag/dollar round trips", () => {
  for (const tag of LEGACY_TAGS) {
    it(`legacy ${tag} survives tag → dollar`, () => {
      expect(setExprToDollarKey(setExprToTag(legacyForms[tag]))).toEqual(legacyForms[tag]);
    });
  }

  for (const tag of SET_EXPR_TAGS) {
    // signature-substrate Phase 4 slice 3a — SeRigid is deliberately EXCLUDED
    // from the `$`-key round trip: it has no `$`-key spelling, so the egress
    // codec rejects rather than emits. The dedicated assertions below pin that
    // rejection (and the asymmetry: canonicalization DOES round-trip).
    if (tag === "SeRigid") continue;
    it(`canonical ${tag} survives dollar → tag`, () => {
      expect(setExprToTag(setExprToDollarKey(canonicalForms[tag]))).toEqual(canonicalForms[tag]);
    });
  }

  it("SeRigid is recognized and canonicalized but REJECTED at `$`-key egress", () => {
    const rigid = canonicalForms.SeRigid;
    // Recognition is unconditional; canonicalization requires the caller to
    // declare validation provenance; egress is closed outright.
    expect(isSetExpr(rigid)).toBe(true);
    expect(peelSetExpr(rigid)?.kind).toBe("SeRigid");
    expect(setExprToTag(rigid, { admitValidationRigid: true })).toEqual(rigid);
    expect(() => setExprToTag(rigid)).toThrow(/untrusted or non-validation caller/);
    // Egress: closed. There is no `$`-key spelling to emit.
    expect(() => setExprToDollarKey(rigid)).toThrow(/no `\$`-key spelling|fenel\.validation\.rigid/);
    // ...and closed AT ANY DEPTH — the recursive arms route back through the
    // same guard, so a rigid buried in a compound cannot ride out inside a
    // sibling's legacy envelope.
    expect(() => setExprToDollarKey({ $tag: "SeUnion", branches: [{ $tag: "SeAll" }, rigid] } as SetExpr))
      .toThrow(/fenel\.validation\.rigid/);
    expect(() => setExprToDollarKey({ $tag: "SeComplement", inner: rigid } as SetExpr))
      .toThrow(/fenel\.validation\.rigid/);
    expect(() => setExprToDollarKey({ $tag: "SeMu", var: "X", body: rigid } as SetExpr))
      .toThrow(/fenel\.validation\.rigid/);
  });
});

describe("deprecated type-to-set compatibility", () => {
  it("canonicalizes valid legacy SetExpr input through liftTypeSetMarkers", () => {
    expect(liftTypeSetMarkers({ $union: [{ $all: true }, { $none: true }] })).toEqual({
      $tag: "SeUnion",
      branches: [{ $tag: "SeAll" }, { $tag: "SeNone" }],
    });
  });
});

describe("malformed values", () => {
  const malformed: unknown[] = [
    null,
    42,
    "set",
    [1],
    { name: "Alice" },
    { $tag: "Just", _0: 5 },
    { $tag: "SeEnum", values: "not-an-array" },
    { $tag: "SeInterval", interval: { $bind: "interval" } },
    { $tag: "SeRef", handle: 42 },
    { $tag: "SePattern", pattern: { $bind: "pattern" } },
    { $tag: "SePattern", pattern: { t: "match", pred: { $bind: "pred" } } },
    { $tag: "SePattern", pattern: { t: "seq", a: { t: "eps" }, b: { t: "unknown" } } },
    { $tag: "SeWhere", pred: { $bind: "pred" } },
    { $tag: "SeCtor", ctor: "Box", fields: { $bind: "fields" } },
    { $tag: "SeCtor", ctor: "Box", fields: [{ $tag: "SetCtorField", name: 1, set: { $tag: "SeAll" } }] },
    { $tag: "SeCtor", ctor: "Box", fields: [{ $tag: "SetCtorField", name: "x", set: { $bind: "s" } }] },
    { $tag: "SeMu", var: "X", body: { $bind: "body" } },
    { $tag: "SeArrow", params: { $bind: "params" }, returns: { $tag: "SeAll" } },
    { $tag: "SeArrow", params: [{ $tag: "SetArrowParam", name: "x", set: { $bind: "s" } }], returns: { $tag: "SeAll" } },
    { $tag: "SeArrow", params: [], returns: { $bind: "returns" } },
    { $tag: "SeUnion", branches: { $bind: "branches" } },
    { $tag: "SeIntersect", branches: { $bind: "branches" } },
    { $tag: "SeDiff", left: { $bind: "left" }, right: { $tag: "SeAll" } },
    { $tag: "SeComplement", inner: { $bind: "inner" } },
    { $all: false },
    { $enum: "not-an-array" },
    { $interval: { $bind: "interval" } },
    { $named: "Integer" },
    { $pattern: { $bind: "pattern" } },
    { $where: { $bind: "pred" } },
    { $union: { $bind: "branches" } },
    { $diff: [{ $all: true }] },
    { $all: true, extra: true },
  ];

  for (const [index, value] of malformed.entries()) {
    it(`rejects malformed boundary value #${index + 1}`, () => {
      expect(peelSetExpr(value)).toBeNull();
      expect(isSetExpr(value)).toBe(false);
      expect(() => setExprToTag(value)).toThrow(TypeError);
    });
  }

  it("rejects malformed descendants when deep canonicalization reaches them", () => {
    const shallowlyRecognizable: unknown = { $tag: "SeUnion", branches: [{ nope: true }] };
    expect(peelSetExpr(shallowlyRecognizable)?.kind).toBe("SeUnion");
    expect(() => setExprToTag(shallowlyRecognizable)).toThrow(TypeError);
  });
});

describe("canonical boundary consumers", () => {
  const canonicalMap: FenelType = {
    $map: {
      keys: buildSetExpr.enum(["row"]),
      values: { $record: { fields: [] } },
    },
  };
  const legacyMap = {
    $map: {
      keys: { $enum: ["row"] },
      values: { $record: { fields: [] } },
    },
  } as unknown as FenelType;

  it("gives canonical and legacy finite-map keys the same JSON Schema", () => {
    const expected = {
      type: "object",
      properties: {
        row: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
      required: ["row"],
      additionalProperties: false,
    };
    expect(fenelTypeToJsonSchema(canonicalMap)).toEqual(expected);
    expect(fenelTypeToJsonSchema(legacyMap)).toEqual(expected);
  });

  it("routes canonical and legacy finite-map keys through the same validator", () => {
    expect(validate(canonicalMap, { row: 42 }, null).valid).toBe(true);
    expect(validate(legacyMap, { row: 42 }, null).valid).toBe(true);
  });

  it("routes canonical and legacy finite-map keys through matrix UX and printing", () => {
    expect(widgetForType(canonicalMap).widget).toBe("matrix-editor");
    expect(widgetForType(legacyMap).widget).toBe("matrix-editor");
    const canonicalPrinted = printEntityDef("matrix", "MatrixExample", [{ id: "rows", type: canonicalMap }]);
    const legacyPrinted = printEntityDef("matrix", "MatrixExample", [{ id: "rows", type: legacyMap }]);
    expect(canonicalPrinted).toBe(legacyPrinted);
    expect(canonicalPrinted).toContain("rows: Matrix");
  });

  it("round-trips entity-printer intervals with canonical Maybe bounds", () => {
    const source = "type Sample {\n  score: Number[0..10]\n}";
    const parsed = parseEntityDef(source);
    if ("error" in parsed) throw new Error(parsed.error);
    expect(printEntityDef(parsed.name, parsed.label, parsed.schema)).toBe(source);
  });

  it("prints canonical SeWhere refinement shorthand identically to legacy input", () => {
    const pred: Expression = { call: ["isFoo", { var: "value" }] };
    const canonicalDef = {
      type_def: {
        name: "X",
        refined: { $refined: { base: { $ref: "String" }, set: buildSetExpr.where(pred) } },
      },
    } as Parameters<typeof print>[0];
    const legacyDef = {
      type_def: {
        name: "X",
        refined: { $refined: { base: { $ref: "String" }, set: { $where: pred } } },
      },
    } as Parameters<typeof print>[0];
    expect(print(canonicalDef)).toBe("X = String | isFoo");
    expect(print(canonicalDef)).toBe(print(legacyDef));
  }, 60_000);

  it("enforces canonical and legacy SeRef Markup subsets identically", () => {
    const bad = elem("video");
    const canonicalType: FenelType = {
      $refined: {
        base: { $ref: "Markup" },
        set: buildSetExpr.ref("markup:telegram-html"),
      },
    };
    const legacyType = {
      $refined: {
        base: { $ref: "Markup" },
        set: { $ref: "markup:telegram-html" },
      },
    } as unknown as FenelType;
    expect(validate(canonicalType, bad, null).valid).toBe(false);
    expect(validate(legacyType, bad, null).valid).toBe(false);
  }, 60_000);

  it("prioritizes an unfilled canonical enum-narrowed field", () => {
    const set = buildSetExpr.where({
      and: [
        { ">": [{ var: "first" }, 0] },
        { in: [{ var: "second" }, ["a", "b"]] },
      ],
    });
    const result = validateWithHints({}, set);
    expect(result.suggestedNext).toBe("second");
    expect(result.fieldHints?.find((hint) => hint.fieldId === "second")?.narrowedConstraint).toEqual(
      buildSetExpr.enum(["a", "b"]),
    );
  }, 60_000);
});
