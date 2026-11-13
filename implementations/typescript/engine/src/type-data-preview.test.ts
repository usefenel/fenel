import { describe, expect, test } from "bun:test";
import { dispatchEngineBody, marshalTraversalType } from "./engine-bodies-dispatch";
import { projectLocusTypeDescriptions } from "./authoring/locus-type-presentation";
import type { FenelType, FieldDef } from "./types";

// C1 harness: execute the authored projection through the canonical type seam.
const nothing = { $tag: "Nothing" } as const;
const yes = { $tag: "Just", _0: true } as const;
const no = { $tag: "Just", _0: false } as const;
const unit: FenelType = { $unit: true };
const empty: FenelType = { $void: true };
const dependent: FenelType = { $el: { var: "chosenType" } };
const unresolved: FenelType = { $ref: "PreviewUnresolvedType" };
const field = (type: FenelType, index: number): FieldDef => ({
  name: `_${index}`, key: { $tag: "PositionalField", index }, type,
  label: nothing, ui: nothing, meta: {},
});
const record = (...types: FenelType[]): FenelType => ({ $record: { fields: types.map(field) } });
const details = (type: FenelType) => dispatchEngineBody("engine:typeDataPreviewDetails", [marshalTraversalType(type)]) as {
  summary: string; dependent: typeof nothing | typeof yes | typeof no;
};

describe("declared type preview information", () => {
  test("counts fields for records and single constructors, and variants for choices", () => {
    expect(details(record(unit, empty))).toEqual({ summary: "2 fields", dependent: no });
    expect(details({ $variant: { cases: [{ name: "Only", label: nothing, fields: [field(unit, 0)] }] } }))
      .toEqual({ summary: "1 field", dependent: no });
    expect(details({ $variant: { cases: [{ name: "Ready", label: nothing }, { name: "Refused", label: nothing }] } }))
      .toEqual({ summary: "2 variants", dependent: no });
    expect(details(record())).toEqual({ summary: "0 fields", dependent: no });
    expect(details({ $variant: { cases: [] } })).toEqual({ summary: "0 variants", dependent: no });
  });

  test("keeps other structural forms meaningful without calling them variants", () => {
    const cases: Array<[FenelType, string]> = [
      [{ $tuple: [unit, empty] }, "2 items"],
      [{ $union: [unit, empty] }, "2 branches"],
      [{ $intersect: [unit] }, "1 branch"],
      [{ $complement: empty }, "Complement type"],
      [{ $arrow: { params: [field(unit, 0)], returns: empty } }, "1 parameter"],
      [{ $map: { keys: { $tag: "SeAll" }, values: unit } }, "Map"],
      [unit, "Unit type"], [empty, "Empty type"], [{ $type: true }, "Type of types"],
      [{ $var: "a" }, "Type parameter"],
      [{ $refined: { base: unit, set: { $tag: "SeAll" } } }, "Refined · Unit type"],
      [{ $mu: { var: "x", body: { $var: "x" } } }, "Recursive · Type parameter"],
      [{ $tagged: { value: unit, phantom: empty } }, "Tagged · Unit type"],
      [{ $opaque: { name: "PreviewOpaque", pure: record(unit) } }, "1 field"],
    ];
    for (const [type, summary] of cases) expect(details(type)).toEqual({ summary, dependent: no });
  });

  test("detects dependence in nested fields, signatures, wrappers and lattice branches", () => {
    const cases: FenelType[] = [
      dependent, record(dependent), { $variant: { cases: [{ name: "HasType", label: nothing, fields: [field(dependent, 0)] }] } },
      { $tuple: [unit, dependent] }, { $union: [unit, dependent] }, { $intersect: [dependent] },
      { $complement: dependent }, { $map: { keys: { $tag: "SeAll" }, values: dependent } },
      { $refined: { base: dependent, set: { $tag: "SeAll" } } },
      { $mu: { var: "x", body: record(dependent) } },
      { $tagged: { value: unit, phantom: dependent } },
      { $opaque: { name: "DependentPreview", pure: record(dependent) } },
      { $arrow: { params: [field(unit, 0)], returns: dependent } },
      { $arrow: { params: [field(dependent, 0)], returns: unit } },
    ];
    for (const type of cases) expect(details(type).dependent).toEqual(yes);
  });

  test("abstains on unresolved names and syntax, and known dependence wins in either order", () => {
    const unknown = { $future: unit } as unknown as FenelType;
    expect(details(unresolved)).toEqual({ summary: "Named type", dependent: nothing });
    expect(details(unknown)).toEqual({ summary: "Unresolved type", dependent: nothing });
    expect(details(record(unit, unresolved)).dependent).toEqual(nothing);
    expect(details(record(unresolved, dependent)).dependent).toEqual(yes);
    expect(details(record(dependent, unresolved)).dependent).toEqual(yes);
    expect(details({ $union: [unknown, dependent] }).dependent).toEqual(yes);
  });

  test("does not mistake type-only dollar-el applications for value-dependent types", () => {
    const typeOnly: FenelType = { $el: { call: ["PreviewGeneric", unit] } };
    expect(marshalTraversalType(typeOnly)).toMatchObject({ $tag: "TtApp" });
    expect(details(typeOnly)).toEqual({ summary: "Type application", dependent: nothing });
    const valueArgument: FenelType = { $el: { call: ["PreviewGeneric", { var: "length" }] } };
    expect(marshalTraversalType(valueArgument)).toMatchObject({ $tag: "TtEl" });
    expect(details(valueArgument)).toEqual({ summary: "Dependent type", dependent: yes });
    expect(details({ $el: { call: ["PreviewGeneric", dependent] } }).dependent).toEqual(yes);
  });

  test("the same nominal handle keeps each explicit reader's declaration facts", () => {
    const shared: FenelType = { $ref: "PreviewSharedOwner" };
    const choices: FenelType = { $variant: { cases: [{ name: "Left", label: nothing }, { name: "Right", label: nothing }] } };
    const fields: FenelType = { $variant: { cases: [{ name: "Single", label: nothing, fields: [field(unit, 0), field(unit, 1), field(unit, 2)] }] } };
    const describe = (shape: FenelType) => projectLocusTypeDescriptions({ type: shared }, undefined, undefined,
      handle => handle === shared.$ref ? shape : undefined)[0]!;
    const left = describe(choices);
    const right = describe(fields);
    expect(left.type).toBe(shared);
    expect(right.type).toBe(shared);
    expect(left.previewShape).toBe(choices);
    expect(right.previewShape).toBe(fields);
    expect(left.previewDetails).toEqual({ summary: "2 variants", dependent: no });
    expect(right.previewDetails).toEqual({ summary: "3 fields", dependent: no });
    expect(describe(choices).previewDetails).toEqual(left.previewDetails);
    expect(projectLocusTypeDescriptions({ type: shared })[0]!.previewDetails)
      .toEqual({ summary: "Named type", dependent: nothing });
  });

  test("preview peeling preserves dependence evidence from tagged and refined declarations", () => {
    const tagged: FenelType = { $tagged: { value: record(unit), phantom: dependent } };
    const taggedDescription = projectLocusTypeDescriptions({ type: tagged })[0]!;
    expect(taggedDescription.previewShape).toEqual(record(unit));
    expect(taggedDescription.previewDetails).toEqual({ summary: "1 field", dependent: yes });
    const refined: FenelType = { $refined: { base: record(dependent), set: { $tag: "SeAll" } } };
    const refinedDescription = projectLocusTypeDescriptions({ type: refined })[0]!;
    expect(refinedDescription.previewShape).toEqual(record(dependent));
    expect(refinedDescription.previewDetails).toEqual({ summary: "1 field", dependent: yes });
    expect(projectLocusTypeDescriptions({ type: unresolved })[0]!.previewDetails)
      .toEqual({ summary: "Named type", dependent: nothing });
  });
});
