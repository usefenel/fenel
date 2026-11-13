import { describe, expect, test } from "bun:test";
import { checkSetMembership, convertReaderInstances, isReaderExtensionMethod, projectReaderReferences, runReaderExtension } from "./authoring-worker-reader-extensions";
import type { AuthoringSession } from "./account-authoring-session";

const fn = { id: "demo:double", params: [], returns: { $ref: "Number" } };
const session = {
  registry: {
    getIdentifiedEntity: (id: string) => id === "Shape" ? { id: "Shape", type: { $ref: "ShapeDef" } } : undefined,
    getUuid: (id: string) => id === "demo:double" ? "uuid-double" : undefined,
  },
  evaluateContext: {
    getFunction: (id: string) => id === "uuid-double" || id === "demo:double" ? fn : undefined,
    _typeFamilyOwner: (id: string) => id === "uuid-double" ? { identity: "demo:double", type: { $ref: "Fam" } } : undefined,
  },
} as unknown as AuthoringSession;

describe("B3 reader extensions (worker side)", () => {
  test("only the extension methods are forwarded", () => {
    expect(isReaderExtensionMethod("project-reader-references")).toBe(true);
    expect(isReaderExtensionMethod("project-reader-type-presentations")).toBe(true);
    expect(isReaderExtensionMethod("check-set-membership")).toBe(true);
    expect(isReaderExtensionMethod("project-reader-metadata")).toBe(false);
  });

  test("references carry the worker frame's lookups, and a miss stays a miss", () => {
    const { references } = projectReaderReferences(["uuid-double", "Shape", "nothing"], session);
    expect(references[0]).toEqual({ target: "uuid-double", reference: { fn, handle: "uuid-double",
      typeFamilyOwner: { identity: "demo:double", type: { $ref: "Fam" } } } });
    // B4 F2: an entity reference also carries its id (and nominal identity, when the registry has one).
    expect(references[1]).toEqual({ target: "Shape", reference: { entityType: { $ref: "ShapeDef" }, entityOwner: { id: "Shape" } } });
    expect(references[2]).toEqual({ target: "nothing" });
  });

  test("B4 unit E: definitions carry the registry's own entity and function lookups, only when asked", () => {
    const shape = { id: "Shape", type: { $ref: "ShapeDef" } };
    const add = { id: "std:add", params: [], returns: { $ref: "Number" } };
    const frame = { ...session, registry: { ...session.registry,
      getIdentifiedEntity: (id: string) => id === "Shape" || id === "shape-alias" ? { ...shape, interface: { hidden: true } } : undefined,
      // The registry's lookup, distinct from the frame's `getFunction`.
      getFunction: (id: string) => id === "std.add" ? add : undefined } } as unknown as AuthoringSession;
    const asked = projectReaderReferences(["shape-alias", "std.add", "nothing"], frame, true).references;
    // Only the definition: no duplicated frame `fn` or entity type.
    expect(asked[0]).toEqual({ target: "shape-alias", reference: { definition: { entity: shape } } });
    expect(Object.keys(projectReaderReferences(["demo:double"], { ...frame, registry: { ...frame.registry,
      getFunction: () => fn } } as unknown as AuthoringSession, true).references[0]!.reference!)).toEqual(["definition"]);
    expect(asked[1]).toEqual({ target: "std.add", reference: { definition: { fn: add } } });
    expect(asked[2]).toEqual({ target: "nothing" });
    // Unasked, the existing reply is unchanged.
    expect(projectReaderReferences(["std.add"], frame).references).toEqual([{ target: "std.add" }]);
  });

  test("B4 unit E: the instance wire pair is forwarded and calls the existing owners with this session's registry", async () => {
    expect(isReaderExtensionMethod("decode-reader-instances")).toBe(true);
    expect(isReaderExtensionMethod("encode-reader-instances")).toBe(true);
    const wire = await import("@fenel/engine/authoring/type");
    const frame = { registry: undefined } as unknown as AuthoringSession;
    const instance = { typeName: "Labelable", args: ["target"], methods: { label: "Hello" } };
    for (const valueEncoding of [undefined, wire.INSTANCE_JSON_ENCODING] as const) {
      const item = valueEncoding === undefined ? { instance } : { instance, valueEncoding };
      expect(convertReaderInstances({ method: "decode-reader-instances", instances: [item] }, frame).instances)
        .toEqual([wire.instanceFromJsonWire(instance, undefined, undefined, valueEncoding)]);
      expect(convertReaderInstances({ method: "encode-reader-instances", instances: [item] }, frame).instances)
        .toEqual([wire.instanceToJsonWire(instance, undefined, undefined, valueEncoding)]);
    }
    const reply = await runReaderExtension({ method: "decode-reader-instances", instances: [{ instance }] }, frame, undefined, async () => {});
    expect(reply).toEqual({ instances: [wire.instanceFromJsonWire(instance)] });
    await expect(runReaderExtension({ method: "decode-reader-instances", instances: [{ instance: [] }] } as never, frame, undefined, async () => {}))
      .rejects.toThrow("could not be read");
    await expect(runReaderExtension({ method: "decode-reader-instances", instances: [{ instance, valueEncoding: "other" }] } as never, frame,
      undefined, async () => {})).rejects.toThrow("Unsupported instance encoding");
  });

  test("membership keeps Tri answers; a failing judgment abstains as Nothing, never false", () => {
    const frame = { evaluateContext: {} } as unknown as AuthoringSession;
    const result = checkSetMembership({ method: "check-set-membership",
      set: { $tag: "SeEnum", values: [1, 2] }, values: [1, 3] }, frame);
    expect(result.verdicts.map(verdict => verdict.$tag === "Just" ? verdict._0 : "unknown")).toEqual([true, false]);
    const broken = checkSetMembership({ method: "check-set-membership",
      set: { $tag: "SeRef", handle: "missing:Set" }, values: [1] }, frame);
    expect(broken.verdicts[0]!.$tag === "Just" && broken.verdicts[0]!._0 === false).toBe(false);
  });
});
