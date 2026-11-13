import { describe, expect, test } from "bun:test";
import { Nothing } from "../type-foundation";
import type { FenelType, Kind, SchemeVar, TypeConstructorParam, TypeScheme } from "../types";
import { authoringKindType, editAuthoringGenericParameters, type AuthoringGenericEditResult } from "./generic-parameters";
import { buildAuthoringSignatureDeclaration } from "./signature-authoring";
import { finalizeRegistryFunctionSignatures } from "../signature-inference";

const kType: Kind = { $tag: "KType" };
const kArrow: Kind = { $tag: "KArrow", input: kType, output: kType };
const variable = (id: string, sourceName = "a", kind: Kind = kType): SchemeVar => ({ id, sourceName, kind });
const scheme = (body: FenelType, quantified: readonly SchemeVar[] = [variable("a-owner")]): TypeScheme => ({ quantified, body });
function accepted(result: AuthoringGenericEditResult) {
  if (!result.ok) throw new Error(result.message);
  return result;
}
function refused(result: AuthoringGenericEditResult, pattern: RegExp) {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.message).toMatch(pattern);
}

describe("Fenel-owned explicit generic parameter edits", () => {
  test("ordinary TypeBuilder types project kinds and used-kind changes refuse", () => {
    const projected = authoringKindType(kArrow);
    if (!projected.ok) throw new Error(projected.message);
    expect(authoringKindType(kType)).toEqual({ ok: true, type: { $type: true } });
    const original = scheme({ $unit: true });
    const changed = accepted(editAuthoringGenericParameters(original, { kind: "set-kind", id: "a-owner", type: projected.type }));
    expect(changed.scheme.quantified).toEqual([variable("a-owner", "a", kArrow)]);
    expect(changed.scheme.body).toBe(original.body);
    refused(editAuthoringGenericParameters(scheme({ $var: "a" }), { kind: "set-kind", id: "a-owner", type: projected.type }), /Remove.*uses/);
    accepted(editAuthoringGenericParameters(scheme({ $var: "a" }), { kind: "set-kind", id: "a-owner", type: { $type: true } }));
    refused(editAuthoringGenericParameters(original, { kind: "set-kind", id: "a-owner", type: { $ref: "Nat" } }), /ordinary function parameter/);
  });
  test("new binders keep caller identities and kinds, independent across declarations", () => {
    const body: FenelType = { $unit: true };
    const first = accepted(editAuthoringGenericParameters(scheme(body, []), { kind: "add", variable: variable("first") }, []));
    const second = accepted(editAuthoringGenericParameters(scheme(body, []), { kind: "add", variable: variable("second", "f", kArrow) }, []));
    expect(first.scheme.quantified).toEqual([variable("first")]);
    expect(second.scheme.quantified).toEqual([variable("second", "f", kArrow)]);
    expect(first.params).toEqual([{ name: "a", constraints: [] }]);
    expect(first.scheme.body).toBe(body);
    refused(editAuthoringGenericParameters(first.scheme, { kind: "add", variable: variable("first", "b") }), /identity/);
  });

  test("Maybe a rename retains shape, positional field identity, metadata and sidecars", () => {
    const field = { name: "_0", key: { $tag: "PositionalField" as const, index: 0 }, type: { $var: "a" } as FenelType, label: Nothing, ui: Nothing, meta: {}, retainedExtension: undefined };
    const body: FenelType = { $variant: { cases: [{ name: "Nothing", fields: [], label: Nothing }, { name: "Just", fields: [field], label: Nothing }] } };
    const original: TypeScheme = { ...scheme(body), applications: [], nominals: [], diagnostics: [{ code: "retained", declaration: "Maybe", path: [], spelling: "a", message: "Retained diagnostic" }] };
    const result = accepted(editAuthoringGenericParameters(original, { kind: "rename", id: "a-owner", sourceName: "element" }, [{ name: "a", constraints: [] }]));
    expect(result.scheme.quantified).toEqual([variable("a-owner", "element")]);
    expect(result.params).toEqual([{ name: "element", constraints: [] }]);
    if (!("$variant" in result.scheme.body)) throw new Error("Expected variant");
    const after = result.scheme.body.$variant.cases[1]!.fields![0]!;
    expect(after.type).toEqual({ $var: "element" });
    expect(after.key).toBe(field.key);
    expect(after.meta).toBe(field.meta);
    expect(Object.hasOwn(after, "retainedExtension")).toBe(true);
    expect(result.scheme.applications).toBe(original.applications);
    expect(result.scheme.nominals).toBe(original.nominals);
    expect(result.scheme.diagnostics).toBe(original.diagnostics);
    expect(field.type).toEqual({ $var: "a" });
  });

  test("recursive shadowing is preserved and capture refuses", () => {
    const shadow: FenelType = { $mu: { var: "a", body: { $var: "a" } } };
    const original = scheme({ $tuple: [{ $var: "a" }, shadow] });
    const result = accepted(editAuthoringGenericParameters(original, { kind: "rename", id: "a-owner", sourceName: "b" }));
    expect(result.scheme.body).toEqual({ $tuple: [{ $var: "b" }, shadow] });
    if (!("$tuple" in result.scheme.body)) throw new Error("Expected tuple");
    expect(result.scheme.body.$tuple[1]).toBe(shadow);
    refused(editAuthoringGenericParameters(scheme({ $mu: { var: "b", body: { $var: "a" } } }), { kind: "rename", id: "a-owner", sourceName: "b" }), /capture/);
    accepted(editAuthoringGenericParameters(scheme(shadow), { kind: "remove", id: "a-owner" }));
  });

  test("used removal and adding a binder over a free variable refuse", () => {
    refused(editAuthoringGenericParameters(scheme({ $var: "a" }), { kind: "remove", id: "a-owner" }), /still used/);
    refused(editAuthoringGenericParameters(scheme({ $var: "a" }, []), { kind: "add", variable: variable("fresh") }), /capture/);
    refused(editAuthoringGenericParameters(scheme({ $var: "unknown" }), { kind: "rename", id: "a-owner", sourceName: "b" }), /established binder/);
  });

  test("renaming refuses capture of free application heads while preserving nominal labels", () => {
    const arg: FenelType = { $ref: "Number" };
    const original: TypeScheme = {
      ...scheme({ $tuple: [{ $var: "a" }, { $el: { call: ["f", arg] } }] }),
      applications: [{ path: ["$tuple", "1"], headRef: "f", kind: kArrow, args: [arg] }],
    };
    refused(editAuthoringGenericParameters(original, { kind: "rename", id: "a-owner", sourceName: "f" }), /capture/);
    expect(original.quantified[0]!.sourceName).toBe("a");
    expect(original.applications?.[0]?.headRef).toBe("f");
    accepted(editAuthoringGenericParameters(original, { kind: "rename", id: "a-owner", sourceName: "a" }));
    const labels = scheme({ $tuple: [{ $var: "a" }, { $ref: "f" }, { $opaque: { name: "f", pure: { $unit: true } } }, { $mu: { var: "f", body: { $var: "f" } } }] });
    const renamed = accepted(editAuthoringGenericParameters(labels, { kind: "rename", id: "a-owner", sourceName: "f" }));
    expect(renamed.scheme.quantified[0]!.sourceName).toBe("f");
    if (!("$tuple" in renamed.scheme.body) || !("$tuple" in labels.body)) throw new Error("Expected tuple");
    expect(renamed.scheme.body.$tuple.slice(1)).toEqual(labels.body.$tuple.slice(1));
  });

  test("higher-kinded heads keep their ids while body and redundant args rename together", () => {
    const arg: FenelType = { $var: "a" };
    const original: TypeScheme = {
      ...scheme({ $el: { call: ["f", arg] } }, [variable("f-owner", "f", kArrow), variable("a-owner")]),
      applications: [{ path: [], headVarId: "f-owner", kind: kArrow, args: [arg] }],
      nominals: [], diagnostics: [],
    };
    const head = accepted(editAuthoringGenericParameters(original, { kind: "rename", id: "f-owner", sourceName: "g" }));
    expect(head.scheme.body).toEqual({ $el: { call: ["g", arg] } });
    expect(head.scheme.applications).toBe(original.applications);
    const argument = accepted(editAuthoringGenericParameters(head.scheme, { kind: "rename", id: "a-owner", sourceName: "b" }));
    expect(argument.scheme.body).toEqual({ $el: { call: ["g", { $var: "b" }] } });
    expect(argument.scheme.applications?.[0]).toEqual({ path: [], headVarId: "f-owner", kind: kArrow, args: [{ $var: "b" }] });
    expect(argument.scheme.nominals).toBe(original.nominals);
    expect(argument.scheme.diagnostics).toBe(original.diagnostics);
    refused(editAuthoringGenericParameters(original, { kind: "remove", id: "f-owner" }), /still used/);
    refused(editAuthoringGenericParameters({ ...original, applications: [] }, { kind: "rename", id: "f-owner", sourceName: "g" }), /sidecar/);
    refused(editAuthoringGenericParameters({ ...original, applications: [{ ...original.applications![0]!, args: [{ $unit: true }] }] }, { kind: "rename", id: "a-owner", sourceName: "b" }), /disagrees/);
  });

  test("constructor parameter strings, constraints and unrelated metadata survive", () => {
    const params: readonly TypeConstructorParam[] = [{ name: "a", constraints: [{ class: { $tag: "Id", entityId: "Eq" }, args: [{ $var: "a" }] }] }];
    const original = scheme({ $unit: true });
    const result = accepted(editAuthoringGenericParameters(original, { kind: "rename", id: "a-owner", sourceName: "b" }, params));
    expect(result.params).toEqual([{ name: "b", constraints: [{ class: params[0]!.constraints[0]!.class, args: [{ $var: "b" }] }] }]);
    expect(result.scheme.body).toBe(original.body);
    refused(editAuthoringGenericParameters(original, { kind: "remove", id: "a-owner" }, params), /still used/);
    expect(accepted(editAuthoringGenericParameters(original, { kind: "rename", id: "a-owner", sourceName: "b" }, ["a"])).params).toEqual(["b"]);
    refused(editAuthoringGenericParameters(original, { kind: "remove", id: "a-owner" }, ["wrong"]), /disagree/);
  });

  test("embedded predicate type annotations participate in usage, rename and recursive capture", () => {
    const annotation: FenelType = { $var: "a" };
    const refined: FenelType = { $refined: { base: { $unit: true }, set: { $tag: "SeWhere", pred: { ann: [true, annotation] } } } };
    const original = scheme(refined);
    refused(editAuthoringGenericParameters(original, { kind: "remove", id: "a-owner" }), /still used/);
    const result = accepted(editAuthoringGenericParameters(original, { kind: "rename", id: "a-owner", sourceName: "b" }));
    expect(result.scheme.body).toEqual({ $refined: { base: { $unit: true }, set: { $tag: "SeWhere", pred: { ann: [true, { $var: "b" }] } } } });
    expect(annotation).toEqual({ $var: "a" });
    refused(editAuthoringGenericParameters(scheme({ $mu: { var: "b", body: refined } }), { kind: "rename", id: "a-owner", sourceName: "b" }), /capture/);
    const keys: FenelType = { $map: { keys: { $tag: "SeWhere", pred: { ann: [true, { $var: "a" }] } }, values: { $unit: true } } };
    refused(editAuthoringGenericParameters(scheme(keys), { kind: "remove", id: "a-owner" }), /still used/);
  });

  test("all structural type positions retain their wrappers while bound occurrences rename", () => {
    const v: FenelType = { $var: "a" };
    const body: FenelType = { $arrow: {
      params: [{ name: "value", key: { $tag: "PositionalField", index: 0 }, type: { $map: { keys: { $tag: "SeAll" }, values: v } }, label: Nothing, ui: Nothing, meta: {} }],
      returns: { $tagged: {
        value: { $opaque: { name: "Envelope", pure: { $record: { fields: [{ name: "field", key: { $tag: "PositionalField", index: 0 }, type: v, label: Nothing, ui: Nothing, meta: {} }] } } } },
        phantom: { $union: [{ $intersect: [v, { $complement: v }] }, { $refined: { base: v, set: { $tag: "SeAll" } } }] },
      } },
    } };
    const result = accepted(editAuthoringGenericParameters(scheme(body), { kind: "rename", id: "a-owner", sourceName: "b" }));
    expect(JSON.stringify(result.scheme.body)).not.toContain('"$var":"a"');
    expect(JSON.stringify(result.scheme.body).match(/"\$var":"b"/g)).toHaveLength(5);
  });

  test("renamed explicit generic identities survive canonical callable admission", () => {
    for (const id of ["first-independent-binder", "second-independent-binder"]) {
      const param = { name: "value", key: { $tag: "PositionalField" as const, index: 0 }, type: { $var: "a" } as FenelType, label: Nothing, ui: Nothing, meta: {} };
      const initial = scheme({ $arrow: { params: [param], returns: { $var: "a" } } }, [variable(id)]);
      const authored = accepted(editAuthoringGenericParameters(initial, { kind: "rename", id, sourceName: "element" })).scheme;
      if (!("$arrow" in authored.body)) throw new Error("Expected arrow");
      const fn = { id: `generic-test:${id}`, ...authored.body.$arrow, body: { var: "value" } };
      const declaration = buildAuthoringSignatureDeclaration({ functionId: fn.id, declarationName: "identity", codeName: "identity", ownerModule: "generic-test", parameterCount: 1, inferResult: true, scheme: authored });
      const [result] = finalizeRegistryFunctionSignatures([{ fn, declaration, implementationOrigin: { $tag: "FenelBody" } }], { resolutions: [] });
      expect(result?.info.outcome.$tag).toBe("Solved");
      expect(result?.info.scheme.quantified).toEqual([variable(id, "element")]);
      expect(result?.fn.returns).toEqual({ $var: "element" });
    }
  });

  test("malformed, accessor-bearing and context-free dependent types refuse without getter execution", () => {
    let reads = 0;
    const malformed = { get $var() { reads += 1; return "a"; } } as FenelType;
    refused(editAuthoringGenericParameters(scheme(malformed), { kind: "remove", id: "a-owner" }), /Accessor/);
    expect(reads).toBe(0);
    refused(editAuthoringGenericParameters(scheme({ $el: { var: "selectedType" } }), { kind: "remove", id: "a-owner" }), /binder context/);
    refused(editAuthoringGenericParameters(scheme({ $tuple: [undefined] } as unknown as FenelType), { kind: "remove", id: "a-owner" }), /malformed/);
    refused(editAuthoringGenericParameters(scheme({ $unit: true }), { kind: "rename", id: "a-owner", sourceName: "let" }), /identifier/);
  });
});
