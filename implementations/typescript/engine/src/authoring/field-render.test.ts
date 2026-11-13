import { describe, expect, it } from "vitest";
import type { EditDisplay, Expression, FieldDef, FenelType, SetExpr } from "../types";
import { Just, List, Nothing, Bool, Int, Nat, Rational, Str, Char } from "../type-foundation";
import {
  fieldChoiceSelectionPlan,
  fieldEditPlan,
  fieldRecordEditPlan,
  fieldRecordSlotPlan,
  fieldTypeLabelPlan,
  marshalFieldEditType,
} from "./field-render";
import { dispatchEngineBody, withInterpretedCompiledArtifacts } from "../engine-bodies-dispatch";

function ui(partial: Partial<EditDisplay> = {}): EditDisplay {
  return {
    widget: Nothing,
    placeholder: Nothing,
    helpText: Nothing,
    options: Nothing,
    columns: Nothing,
    refFilter: Nothing,
    prefix: Nothing,
    suffix: Nothing,
    format: Nothing,
    ...partial,
  };
}

function field(name: string, type: FenelType, overrides: Partial<FieldDef> = {}): FieldDef {
  return {
    name,
    label: Nothing,
    type,
    ui: Nothing,
    meta: {},
    ...overrides,
  };
}

const stringType: FenelType = { $ref: "String" };
const numberType: FenelType = { $ref: "Number" };

describe("declared constructor record slots", () => {
  it("preserves stored named or ordinal wires and unrelated own data", () => withInterpretedCompiledArtifacts(() => {
    const caller = { _constructors: { BridgeRecord: ["title", "count"] } };
    const extra = { preserved: true };
    const named = { $tag: "BridgeRecord", title: "before", _1: 7, extra };
    const positional = { $tag: "BridgeRecord", _0: "before", _1: 7, extra };
    for (const [value, wire] of [[named, "title"], [positional, "_0"]] as const) {
      expect(fieldRecordSlotPlan(value, "title", caller)).toMatchObject({ $tag: "Ok", _0: { wire, value: Just("before") } });
      const result = fieldRecordEditPlan(value, "title", "after", caller);
      expect(result.$tag).toBe("Ok");
      if (result.$tag !== "Ok") throw new Error("expected source edit");
      expect(result._0).toEqual({ ...value, [wire]: "after" });
      expect((result._0 as Record<string, unknown>).extra).toBe(extra);
      expect(Object.hasOwn(result._0 as object, wire === "title" ? "_0" : "title")).toBe(false);
    }
    const literal = { _0: "dictionary key", extra };
    expect(fieldRecordSlotPlan(literal, "title", caller)).toMatchObject({ $tag: "Ok", _0: { wire: "title", value: Nothing } });
    expect(fieldRecordEditPlan(literal, "title", "added", caller)).toMatchObject({ $tag: "Ok", _0: { _0: "dictionary key", title: "added", extra } });
  }));

  it("refuses duplicate spellings and unreadable own fields without invoking accessors", () => withInterpretedCompiledArtifacts(() => {
    const caller = { _constructors: { BridgeRecord: ["title"] } };
    const duplicate = { $tag: "BridgeRecord", title: "named", _0: "positional" };
    expect(fieldRecordSlotPlan(duplicate, "title", caller).$tag).toBe("Err");
    expect(fieldRecordEditPlan(duplicate, "title", "after", caller).$tag).toBe("Err");
    let reads = 0;
    const unreadable = { $tag: "BridgeRecord" };
    Object.defineProperty(unreadable, "_0", { get: () => { reads++; return "hidden"; }, enumerable: true });
    expect(fieldRecordSlotPlan(unreadable, "title", caller).$tag).toBe("Err");
    expect(fieldRecordEditPlan(unreadable, "title", "after", caller).$tag).toBe("Err");
    expect(reads).toBe(0);
  }));
});

describe("typed finite choices", () => {
  it("preserves numbers, booleans, lists and records as inhabitants", () => withInterpretedCompiledArtifacts(() => {
    const values = [1, "1", false, "false", "", [1, 2], { order: 1 }, { order: 2 }];
    const plan = fieldEditPlan({ field: field("choice", {
      $refined: { base: { $ref: "Any" }, set: { $tag: "SeEnum", values } },
    }) });
    expect(plan.editor.kind).toBe("select");
    if (plan.editor.kind !== "select") throw new Error("expected select");
    expect(plan.editor.options.map(option => option.value)).toEqual(values);
    expect(plan.editor.options[5]!.value).toBe(values[5]);
    expect(plan.editor.options[6]!.value).toBe(values[6]);
    expect(plan.editor.options.every(option => option.label !== "[object Object]")).toBe(true);
  }));

  it("matches structurally copied values without conflating scalar representations", () => withInterpretedCompiledArtifacts(() => {
    const values = [1, "1", false, "false", "", [1, 2], { order: 1 }, { order: 2 }];
    const options = values.map(value => ({ value, label: "Same visible label" }));
    for (let index = 0; index < values.length; index++) {
      const value = JSON.parse(JSON.stringify(values[index]));
      expect(fieldChoiceSelectionPlan(options, value)).toEqual({ selectedIndex: Just(index) });
    }
    expect(fieldChoiceSelectionPlan(options, undefined)).toEqual({ selectedIndex: Nothing });
    expect(fieldChoiceSelectionPlan(options, { order: 3 })).toEqual({ selectedIndex: Nothing });
  }));

  it("uses existing finite enumeration for deduplication and exact intersections", () => withInterpretedCompiledArtifacts(() => {
    const record = { token: "same" };
    const type: FenelType = { $refined: { base: { $ref: "Any" }, set: {
      $tag: "SeIntersect", branches: [
        { $tag: "SeEnum", values: [1, "1", record, { token: "same" }] },
        { $tag: "SeEnum", values: ["1", { token: "same" }] },
      ],
    } } };
    const plan = fieldEditPlan({ field: field("choice", type) });
    expect(plan.editor.kind).toBe("select");
    if (plan.editor.kind !== "select") throw new Error("expected select");
    expect(plan.editor.options.map(option => option.value)).toEqual(["1", record]);
  }));

  it("keeps nonenumerable refinements on the existing general editor", () => withInterpretedCompiledArtifacts(() => {
    const type: FenelType = { $refined: { base: numberType, set: {
      $tag: "SeUnion", branches: [
        { $tag: "SeEnum", values: [1, 2] },
        { $tag: "SeInterval", interval: { lo: Just({ value: 10, inclusive: true }), hi: Nothing } },
      ],
    } } };
    expect(fieldEditPlan({ field: field("choice", type) }).editor.kind).toBe("number");
  }));

  it("keeps explicit labels separate from record data and refuses nontext Telegram options", () => withInterpretedCompiledArtifacts(() => {
    const value = { dimension: [0, 0, 0, 0, 1], scale: 1, origin: 273.15 };
    const options = [{ value, label: "celsius" }];
    const unitType: FenelType = { $record: { fields: [
      field("dimension", identifiedList(numberType)), field("scale", numberType), field("origin", numberType),
    ] } };
    const plan = fieldEditPlan({ field: field("choice", unitType),
      presentationOverride: { display: ui({ options: Just(options) }) } });
    expect(plan.editor.kind).toBe("select");
    if (plan.editor.kind !== "select") throw new Error("expected select");
    expect(plan.editor.options).toEqual(options);
    expect(plan.editor.options[0]!.value).toBe(value);
    expect(dispatchEngineBody("engine:fieldTextChoiceOptionsPlan", [options])).toEqual({
      $tag: "Err", _0: "Telegram finite choices currently require String values.",
    });
    const textual = [{ value: "", label: "Empty" }, { value: "alpha", label: "Alpha" }];
    expect(dispatchEngineBody("engine:fieldTextChoiceOptionsPlan", [textual])).toEqual({ $tag: "Ok", _0: textual });
  }));
});

/** The bootstrap List factory now carries its lock-derived canonical slots. */
function identifiedList(element: FenelType): FenelType {
  return List(element);
}

describe("field render authoring plan", () => {
  it("keeps the named LocaleString editor distinct from ordinary string maps", () => {
    expect(fieldEditPlan({ field: field("label", { $ref: "LocaleString" }) }).editor.kind).toBe("locale-string");
    const map: FenelType = { $map: { keys: { $tag: "SeRef", handle: "String" }, values: { $ref: "String" } } };
    expect(fieldEditPlan({ field: field("labels", map) }).editor.kind).toBe("map");
  });
  it("keeps finite scalar maps editable through the general typed map surface", () => withInterpretedCompiledArtifacts(() => {
    const keys: SetExpr = { $tag: "SeEnum", values: ["red", "green", "blue"] };
    const variant: FenelType = { $variant: { cases: [
      { name: "Pending", label: Nothing, fields: [] },
      { name: "Ready", label: Nothing, fields: [] },
    ] } };
    for (const values of [numberType, stringType, variant]) {
      const type: FenelType = { $map: { keys, values } };
      const plan = fieldEditPlan({ field: field("channels", type) });
      expect(plan.editor).toEqual({ kind: "map", rawType: type });
    }
  }));
  it("retains finite record maps as typed row and column matrices", () => withInterpretedCompiledArtifacts(() => {
    const keys: SetExpr = { $tag: "SeEnum", values: ["red", "green", "blue"] };
    const columns = [field("amount", numberType), field("label", stringType)];
    const record: FenelType = { $record: { fields: columns } };
    for (const values of [record, { $refined: { base: record, set: { $tag: "SeAll" } } }] as FenelType[]) {
      const type: FenelType = { $map: { keys, values } };
      expect(fieldEditPlan({ field: field("channels", type) }).editor).toEqual({
        kind: "matrix", rawType: type, columns,
        rows: ["red", "green", "blue"].map(key => ({ key, label: key })),
      });
    }
  }));
  it("keeps native opaque runtime representations in scalar editors", () => {
    for (const [type, kind] of [[Bool, "boolean"], [Int, "number"], [Nat, "number"], [Rational, "number"], [Str, "text"], [Char, "text"]] as const) {
      expect(fieldEditPlan({ field: field("native", type) }).editor.kind).toBe(kind);
    }
  });
  it("retains exact Rational identity and avoids floating sliders", () => withInterpretedCompiledArtifacts(() => {
    for (const type of [Rational, { $ref: "Rational" }] as FenelType[]) {
      const plan = fieldEditPlan({ field: field("ratio", type) });
      expect(plan.typeLabel).toBe("Rational");
      expect(plan.editor.kind).toBe("number");
      if (plan.editor.kind !== "number") throw new Error("expected exact numeric editor");
      expect(plan.editor.representation).toBe("rational");
      expect(plan.editor.bounds).toBeUndefined();
    }
    const refined: FenelType = { $refined: { base: Rational, set: {
      $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 1, inclusive: true }) },
    } } };
    const editor = fieldEditPlan({ field: field("bounded", refined) }).editor;
    expect(editor.kind).toBe("number");
    if (editor.kind !== "number") throw new Error("expected exact numeric editor");
    expect(editor.representation).toBe("rational");
    expect(editor.widget).not.toBe("slider");
    expect(editor.bounds).toBeUndefined();
  }));
  it("keeps tagged scalar editors tied to their base type", () => withInterpretedCompiledArtifacts(() => {
    const phantom: FenelType = { $refined: { base: { $ref: "MeasureExpr" }, set: { $tag: "SeEnum", values: [{ $tag: "MeasureOne" }] } } };
    const currency: FenelType = { $refined: { base: stringType, set: { $tag: "SeEnum", values: ["USD"] } } };
    for (const [base, expected, representation] of [[Rational, "Rational", "rational"], [numberType, "Number", "number"]] as const) {
      for (const tag of [phantom, currency]) {
        const type: FenelType = { $tagged: { value: base, phantom: tag } };
        const plan = fieldEditPlan({ field: field("magnitude", type) });
        expect(plan.typeLabel).toBe(expected);
        expect(plan.editor.kind).toBe("number");
        if (plan.editor.kind !== "number") throw new Error("expected tagged scalar numeric editor");
        expect(plan.editor.representation).toBe(representation);
        expect(plan.editor.rawType).toBe(type);
      }
    }
    const text = fieldEditPlan({ field: field("label", { $tagged: { value: stringType, phantom: currency } }) });
    expect(text.editor.kind).toBe("text");
  }));
  it("plans the public Bytes carrier without eager catalogue projections", () => {
    const plan = fieldEditPlan({ field: field("bytes", { $ref: "Bytes" }), value: Uint8Array.of(0, 255) });
    expect(plan.typeLabel).toBe("Bytes");
    expect(plan.editor.rawType).toEqual({ $ref: "Bytes" });
  });
  it("labels structural field types through the Fenel plan", () => {
    const recordType: FenelType = {
      $record: {
        fields: [
          field("email", stringType),
          field("score", numberType),
          field("active", { $ref: "Boolean" }),
          field("joinedAt", { $ref: "Date" }),
        ],
      },
    };

    expect(fieldTypeLabelPlan(recordType)).toBe("{email, score, active, ...}");
    expect(fieldTypeLabelPlan({ $arrow: { params: [field("ctx", recordType)], returns: stringType } })).toBe("(ctx: {email, score, active, ...}) -> String");
  });

  it("plans text, number, boolean, date, and select editors", () => {
    const emailPlan = fieldEditPlan({
      field: field("email", { $refined: { base: stringType, set: { $tag: "SeRef", handle: "format:email" } } }),
    });
    expect(emailPlan.label).toBe("email");
    expect(emailPlan.editor.kind).toBe("text");
    if (emailPlan.editor.kind !== "text") throw new Error("expected text");
    expect(emailPlan.editor.inputType).toBe("email");
    expect(emailPlan.editor.icon).toBe("mail");
    expect(emailPlan.editor.placeholder).toBe("user@example.com");

    const interval: SetExpr = {
      $tag: "SeInterval",
      interval: {
        lo: Just({ value: 1, inclusive: true }),
        hi: Just({ value: 5, inclusive: true }),
      },
    };
    const integer: SetExpr = { $tag: "SeRef", handle: "Int" };
    const numberPlan = fieldEditPlan({
      field: field("rating", {
        $refined: {
          base: numberType,
          set: { $tag: "SeIntersect", branches: [interval, integer] },
        },
      }),
    });
    expect(numberPlan.editor.kind).toBe("number");
    if (numberPlan.editor.kind !== "number") throw new Error("expected number");
    expect(numberPlan.editor.integer).toBe(true);
    expect(numberPlan.editor.bounds).toMatchObject({ lo: 1, hi: 5, step: 1 });

    expect(fieldEditPlan({ field: field("active", { $ref: "Boolean" }) }).editor.kind).toBe("boolean");

    const datePlan = fieldEditPlan({
      field: field("startsAt", { $ref: "Date" }),
      presentationOverride: { display: ui({ format: Just("datetime") }) },
    });
    expect(datePlan.editor.kind).toBe("date");
    if (datePlan.editor.kind !== "date") throw new Error("expected date");
    expect(datePlan.editor.inputType).toBe("datetime-local");

    const selectPlan = fieldEditPlan({
      field: field("status", stringType),
      presentationOverride: {
        display: ui({
          widget: Just("radio"),
          options: Just([
            { value: "draft", label: "Draft" },
            { value: "live", label: "Live" },
          ]),
        }),
      },
    });
    expect(selectPlan.editor.kind).toBe("select");
    if (selectPlan.editor.kind !== "select") throw new Error("expected select");
    expect(selectPlan.editor.radio).toBe(true);
    expect(selectPlan.editor.options.map((o) => o.value)).toEqual(["draft", "live"]);
  });

  it("plans list item defaults, record child fields, and variant case defaults", () => {
    const listPlan = fieldEditPlan({ field: field("tags", identifiedList(stringType)) });
    expect(listPlan.editor.kind).toBe("list");
    if (listPlan.editor.kind !== "list") throw new Error("expected list");
    expect(listPlan.editor.itemDefault).toBe("");

    const recordFields = [field("title", stringType), field("count", numberType)];
    const recordPlan = fieldEditPlan({ field: field("payload", { $record: { fields: recordFields } }) });
    expect(recordPlan.editor.kind).toBe("record");
    if (recordPlan.editor.kind !== "record") throw new Error("expected record");
    expect(recordPlan.editor.fields.map((f) => f.name)).toEqual(["title", "count"]);

    const variantType: FenelType = {
      $variant: {
        discriminator: "kind",
        cases: [
          { name: "Text", label: Nothing, fields: [field("body", stringType)] },
          { name: "Count", label: Nothing, fields: [field("n", numberType)] },
        ],
      },
    };
    const variantPlan = fieldEditPlan({ field: field("value", variantType) });
    expect(variantPlan.editor.kind).toBe("variant");
    if (variantPlan.editor.kind !== "variant") throw new Error("expected variant");
    expect(variantPlan.editor.cases[0]?.defaultValue).toEqual({ kind: "Text", body: "" });
    expect(variantPlan.editor.cases[1]?.defaultValue).toEqual({ kind: "Count", n: 0 });
  });

  it("resolves dependent $el types before planning", () => {
    const plan = fieldEditPlan({
      field: field("value", { $el: { var: "type" } } as unknown as FenelType),
      recordValues: { type: { $ref: "String" } },
    });
    expect(plan.editor.kind).toBe("text");
    expect(plan.typeLabel).toBe("String");
  });

  it("plans tagged refs with contextual display, default, then legacy filter precedence", () => {
    const profileRef: FenelType = {
      $tagged: {
        value: { $ref: "Id" },
        phantom: {
          $refined: { base: stringType, set: { $tag: "SeEnum", values: ["profile"] } },
        },
      },
    };
    const uiFilter: Expression = { "==": [{ var: "candidate.status" }, "active"] };
    const legacyFilter: Expression = { "==": [{ var: "candidate.kind" }, "legacy"] };

    const uiPlan = fieldEditPlan({
      field: field("profileId", profileRef),
      presentationOverride: { display: ui({ refFilter: Just(uiFilter) }) },
    });
    expect(uiPlan.editor.kind).toBe("ref");
    if (uiPlan.editor.kind !== "ref") throw new Error("expected ref");
    expect(uiPlan.editor.filterSource).toBe("field-ui");
    expect(uiPlan.editor.filter).toEqual(uiFilter);

    const defaultPlan = fieldEditPlan({ field: field("profileId", profileRef) });
    expect(defaultPlan.editor.kind).toBe("ref");
    if (defaultPlan.editor.kind !== "ref") throw new Error("expected ref");
    expect(defaultPlan.editor.filterSource).toBe("filterable-default");

    const countryRef: FenelType = {
      $tagged: {
        value: { $ref: "Id" },
        phantom: {
          $refined: { base: stringType, set: { $tag: "SeEnum", values: ["country"] } },
        },
      },
    };
    const legacyPlan = fieldEditPlan({
      field: field("countryId", countryRef, {
        meta: { refFilter: legacyFilter } as unknown as FieldDef["meta"],
      }),
    });
    expect(legacyPlan.editor.kind).toBe("ref");
    if (legacyPlan.editor.kind !== "ref") throw new Error("expected ref");
    expect(legacyPlan.editor.filterSource).toBe("legacy-meta");
    expect(legacyPlan.editor.filter).toEqual(legacyFilter);
  });

  it("marshals wrappers into explicit FieldEditType tags", () => {
    expect(marshalFieldEditType(stringType).$tag).toBe("FtNamed");
    expect(marshalFieldEditType({ $refined: { base: stringType, set: { $tag: "SeRef", handle: "format:url" } } }).$tag).toBe("FtRefined");
  });
});
