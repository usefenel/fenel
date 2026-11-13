import { describe, expect, test } from "bun:test";
import {
  apiRowToDraft,
  declaredClassParams,
  draftToApiBody,
  draftsToRepresentationMethods,
  instanceKey,
  instanceRowKey,
  pendingDraftsOf,
  representationMethodsToDrafts,
  representationPresetDraft,
  rowsByClass,
  seedInstanceArgs,
  withDraft,
  isEmptyMethods,
  type InstanceDraft,
} from "./instance-draft";

describe("instance draft codec", () => {
  test("ordinary edits retain instance label and conditional requirements", () => {
    const instance = {
      typeName: "Eq", args: [{ $var: "a" }], methods: { eq: { $ref: "fixture:eq" } },
      label: "Conditional equality", where: [{ class: { $tag: "Id", entityId: "Ord" }, args: [{ $var: "a" }] }],
      scope: { kind: "tag", tag: "preview" }, priority: 0,
    };
    const draft = apiRowToDraft({ id: "row-1", instance: instance as any });
    expect(draftToApiBody(draft).instance).toEqual(instance as any);
  });
  test("API row projects to Instance draft", () => {
    expect(
      apiRowToDraft({
        id: "row-1",
        typeName: "Monoid",
        args: ["String"],
        instance: {
          typeName: "Monoid",
          args: ["String"],
          methods: { mempty: "", mappend: "std:concat" },
          priority: 10,
        },
      }),
    ).toEqual({
      typeName: "Monoid",
      args: ["String"],
      methods: { mempty: "", mappend: "std:concat" },
      priority: 10,
    });
  });

  test("draft serializes to canonical API body", () => {
    expect(
      draftToApiBody({
        typeName: "Infixable",
        args: ["std:add"],
        methods: { notation: "+", precedence: 6 },
      }),
    ).toEqual({
      typeName: "Infixable",
      args: ["std:add"],
      instance: {
        typeName: "Infixable",
        args: ["std:add"],
        methods: { notation: "+", precedence: 6 },
      },
    });
  });

  test("representation preset is an ordinary Instance", () => {
    expect(representationPresetDraft("Labelable", "value-1", { label: "Total" })).toEqual({
      typeName: "Labelable",
      args: ["value-1"],
      methods: { label: "Total" },
    });
  });

  test("representation draft adapter drops empty method records", () => {
    const drafts = representationMethodsToDrafts({
      Labelable: { label: "Total" },
      Describable: { description: "" },
    }, "value-1");
    expect(drafts['Labelable:["value-1"]']).toEqual({
      typeName: "Labelable",
      args: ["value-1"],
      methods: { label: "Total" },
    });
    expect(draftsToRepresentationMethods(drafts)).toEqual({
      Labelable: { label: "Total" },
    });
  });

  test("canonical Maybe-valued Displayable hints are not discarded as empty", () => {
    const nothing = { $tag: "Nothing" };
    const hint = {
      widget: { $tag: "Just", _0: "textarea" },
      placeholder: nothing,
      helpText: nothing,
      prefix: nothing,
      suffix: nothing,
      options: nothing,
      format: nothing,
      columns: nothing,
      refFilter: nothing,
    };
    expect(isEmptyMethods({ hint })).toBe(false);
    expect(isEmptyMethods({
      hint: Object.fromEntries(Object.keys(hint).map((key) => [key, nothing])),
    })).toBe(true);
  });
});

// modules-as-values Phase 2d: an instance is identified by its class and EVERY
// argument, so `Iso String Bytes` and `Iso String JsonValue` are two instances.
describe("instance identity", () => {
  const bytes: InstanceDraft = { typeName: "Iso", args: ["String", "Bytes"], methods: { decode: { $ref: "codec:base64Decode" } } };
  const json: InstanceDraft = { typeName: "Iso", args: ["String", "JsonValue"], methods: { decode: { $ref: "codec:jsonDecode" } } };

  test("two instances of one class sharing a first argument have two keys", () => {
    expect(instanceKey(bytes)).not.toBe(instanceKey(json));
    expect(instanceKey(bytes)).toBe('Iso:["String","Bytes"]');
  });

  test("a persisted row is keyed by its row id, else by its full identity", () => {
    expect(instanceRowKey({ id: "row-1", typeName: "Iso", args: bytes.args })).toBe("row:row-1");
    expect(instanceRowKey({ id: "row-2", typeName: "Iso", args: json.args })).toBe("row:row-2");
    expect(instanceRowKey({ typeName: "Iso", args: bytes.args })).toBe('instance:Iso:["String","Bytes"]');
    expect(instanceRowKey({ typeName: "Iso", args: json.args })).not.toBe(instanceRowKey({ typeName: "Iso", args: bytes.args }));
  });

  test("rows of one class on one target are all kept, in order", () => {
    const entries = [
      { row: { id: "a" }, draft: bytes },
      { row: { id: "b" }, draft: json },
      { row: { id: "c" }, draft: { typeName: "Iso", args: ["Bytes", "String"], methods: {} } },
      { row: { id: "d" }, draft: { typeName: "Labelable", args: ["String"], methods: {} } },
    ];
    const grouped = rowsByClass(entries, "String");
    expect(grouped.get("Iso")?.map((entry) => entry.row.id)).toEqual(["a", "b"]);
    expect(grouped.get("Labelable")?.map((entry) => entry.row.id)).toEqual(["d"]);
    expect(rowsByClass(entries).get("Iso")?.length).toBe(3);
  });

  test("pending drafts are read by value, whatever their map key", () => {
    const drafts = { Iso: bytes, [instanceKey(json)]: json, Labelable: { typeName: "Labelable", args: ["String"], methods: {} } };
    expect(pendingDraftsOf(drafts, "Iso", "String").map((entry) => entry.key)).toEqual(["Iso", instanceKey(json)]);
    expect(pendingDraftsOf(drafts, "Iso", "Bytes")).toEqual([]);
  });

  test("a saved draft replaces the entry it was opened from, under its full identity", () => {
    const opened = { Iso: bytes, [instanceKey(json)]: json };
    const edited = { ...bytes, methods: { decode: { $ref: "codec:base64DecodeStrict" } } };
    const next = withDraft(opened, "Iso", edited);
    expect(Object.keys(next).sort()).toEqual([instanceKey(bytes), instanceKey(json)].sort());
    expect(next[instanceKey(bytes)]).toBe(edited);
    expect(next[instanceKey(json)]).toBe(json);
    // A changed coordinate moves the draft to its new identity.
    const moved = { ...json, args: ["String", "Text"] };
    expect(Object.keys(withDraft(next, instanceKey(json), moved)).sort()).toEqual([instanceKey(bytes), instanceKey(moved)].sort());
    // Dropping removes both the opened key and the identity.
    expect(withDraft(next, instanceKey(json), json, true)).toEqual({ [instanceKey(bytes)]: edited });
  });

  test("the representation adapters round-trip through identity keys", () => {
    const drafts = representationMethodsToDrafts({ Labelable: { label: "Total" } }, "value-1");
    expect(Object.keys(drafts)).toEqual(['Labelable:["value-1"]']);
    expect(draftsToRepresentationMethods(drafts)).toEqual({ Labelable: { label: "Total" } });
    // An older class-keyed map still reads by the draft's own class.
    expect(draftsToRepresentationMethods({ Labelable: { typeName: "Labelable", args: [], methods: { label: "X" } } })).toEqual({ Labelable: { label: "X" } });
  });
});

describe("declared class parameters", () => {
  test("the declaration's parameters win over the dispatch seed's", () => {
    // Reprable's seed keeps only `a` (its routing override); its declaration is `Reprable target a`.
    expect(declaredClassParams([{ name: "target", constraints: [] }, { name: "a", constraints: [] }], [{ name: "a" }])).toEqual(["target", "a"]);
    expect(declaredClassParams(["s", "a"], [{ name: "s" }])).toEqual(["s", "a"]);
  });

  test("the seed is used only when no declaration is loaded", () => {
    expect(declaredClassParams(undefined, [{ name: "a" }])).toEqual(["a"]);
    expect(declaredClassParams([], [{ name: "" }])).toEqual(["Type"]);
    expect(declaredClassParams(undefined, undefined)).toEqual([]);
  });

  test("a fixed target fills the first slot; the other coordinates stay open", () => {
    expect(seedInstanceArgs(["s", "a"], "String")).toEqual(["String", "a"]);
    expect(seedInstanceArgs(["target"], "value-1")).toEqual(["value-1"]);
    expect(seedInstanceArgs([], "value-1")).toEqual(["value-1"]);
    expect(seedInstanceArgs(["target", "a"])).toEqual(["target", "a"]);
  });
});
