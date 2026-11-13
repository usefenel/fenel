import { describe, expect, test } from "bun:test";

import { createRegistry } from "./registry";
import type {
  FenelModule,
  FenelType,
  FieldDef,
  Kind,
  TypeScheme,
} from "./types";

const Nothing = { $tag: "Nothing" } as const;
const KType: Kind = { $tag: "KType" };
const UnaryKind: Kind = { $tag: "KArrow", input: KType, output: KType };

function field(name: string, type: FenelType): FieldDef {
  return { name, type, label: Nothing, ui: Nothing, meta: {} };
}

function moduleWithScheme(
  id: string,
  type: FenelType,
  typeScheme: TypeScheme,
): FenelModule {
  return {
    name: `scheme-projection-${id}`,
    label: "Scheme projection",
    entities: [{ id, module: `scheme-projection-${id}`, type, typeScheme }],
    functions: [],
    instances: [],
  };
}

function sourceHandleRegistry(module: FenelModule) {
  return createRegistry([module], {
    publishCatalogEntities: false,
    fieldIdentity: {
      mode: "source-handles",
      defaultRealm: "repository-source",
    },
  });
}

describe("registry entity scheme projection", () => {
  test("reattaches nested application args to the identified body without mutating source", () => {
    const payloadField = field("payload", { $ref: "String" });
    const applicationArgument: FenelType = {
      $record: { fields: [payloadField] },
    };
    const appliedType: FenelType = {
      $el: { call: ["Box", applicationArgument] },
    };
    const body: FenelType = {
      $record: { fields: [field("wrapped", appliedType)] },
    };
    const typeScheme: TypeScheme = {
      quantified: [],
      body,
      applications: [{
        path: ["$record", "fields", "0", "type"],
        headRef: "Box",
        args: [applicationArgument],
        kind: UnaryKind,
      }],
    };
    const entityId = "NestedApplicationCarrier";
    const registry = sourceHandleRegistry(moduleWithScheme(entityId, body, typeScheme));

    const identified = registry.getIdentifiedEntity(entityId);
    expect(identified).toBeDefined();
    expect(identified?.typeScheme?.body).toBe(identified?.type);
    if (identified === undefined || !("$record" in identified.type)) {
      throw new Error("expected identified record entity");
    }
    const identifiedApplication = identified.type.$record.fields[0]!.type;
    if (!("$el" in identifiedApplication)) {
      throw new Error("expected identified type application");
    }
    const call = (identifiedApplication.$el as { call?: unknown[] }).call;
    if (!Array.isArray(call) || call.length !== 2) {
      throw new Error("expected unary identified type application");
    }
    const bodyArgument = call[1] as FenelType;
    const sidecarArgument = identified.typeScheme?.applications?.[0]?.args[0];
    expect(sidecarArgument).toBe(bodyArgument);
    if (!("$record" in bodyArgument)) {
      throw new Error("expected identified record application argument");
    }
    expect(bodyArgument.$record.fields[0]!.key?.$tag).toBe("NamedField");

    expect(payloadField.key).toBeUndefined();
    expect(typeScheme.body).toBe(body);
    expect(typeScheme.applications?.[0]?.args[0]).toBe(applicationArgument);
    expect(applicationArgument.$record.fields[0]!.key).toBeUndefined();
  }, 180_000);

  test("freezes public identified entities before lazy constructor inference", () => {
    const body: FenelType = {
      $variant: {
        cases: [{
          name: "Some",
          label: Nothing,
          fields: [field("value", { $var: "a" })],
        }],
      },
    };
    const typeScheme: TypeScheme = {
      quantified: [{ id: "frozen-option:q0", sourceName: "a", kind: KType }],
      body,
    };
    const module = moduleWithScheme("FrozenOption", body, typeScheme);
    const left = sourceHandleRegistry(module);
    const right = sourceHandleRegistry(module);

    const identified = left.getIdentifiedEntity("FrozenOption");
    const listed = left.listIdentifiedEntities();
    expect(identified).toBeDefined();
    expect(Object.isFrozen(listed)).toBe(true);
    expect(Object.isFrozen(identified)).toBe(true);
    expect(Object.isFrozen(identified?.type)).toBe(true);
    expect(Object.isFrozen(identified?.typeScheme)).toBe(true);
    expect(Object.isFrozen(identified?.typeScheme?.quantified)).toBe(true);
    expect(identified?.typeScheme?.body).toBe(identified?.type);
    expect(Object.isFrozen(body)).toBe(false);
    expect(Object.isFrozen(typeScheme)).toBe(false);

    if (
      identified === undefined
      || !("$variant" in identified.type)
      || identified.typeScheme === undefined
    ) {
      throw new Error("expected identified variant entity with a scheme");
    }
    expect(listed).toContain(identified);
    const publicCase = identified.type.$variant.cases[0]!;
    const publicVariable = identified.typeScheme.quantified[0]!;
    expect(Object.isFrozen(publicCase)).toBe(true);
    expect(Object.isFrozen(publicVariable)).toBe(true);

    // These writes happen before the first constructor-signature read.  A
    // mutable cached view would rename the constructor and its quantified
    // variable at the authoritative lazy-inference boundary.
    expect(Reflect.set(publicCase, "name", "Poisoned")).toBe(false);
    expect(Reflect.set(publicVariable, "sourceName", "poisoned")).toBe(false);
    expect(Reflect.set(listed, "0", { ...identified, id: "Poisoned" })).toBe(false);

    const leftSignature = left.listConstructorSignatures().find((row) =>
      row.ownerName === "FrozenOption" && row.name === "Some"
    );
    const rightSignature = right.listConstructorSignatures().find((row) =>
      row.ownerName === "FrozenOption" && row.name === "Some"
    );
    expect(leftSignature).toBeDefined();
    expect(leftSignature).toEqual(rightSignature);
    expect(leftSignature?.outcome.$tag).toBe("Solved");
    expect(leftSignature?.scheme?.quantified[0]?.sourceName).toBe("a");
  }, 180_000);

  test("isolates compatibility module/entity faces before lazy constructor inference", () => {
    const body: FenelType = {
      $variant: {
        cases: [{
          name: "Some",
          label: Nothing,
          fields: [{
            ...field("_0", { $var: "a" }),
            key: { $tag: "PositionalField", index: 0 },
          }],
        }],
      },
    };
    const typeScheme: TypeScheme = {
      quantified: [{ id: "public-option:q0", sourceName: "a", kind: KType }],
      body,
    };
    const module = moduleWithScheme("PublicOption", body, typeScheme);
    const left = sourceHandleRegistry(module);

    const publicEntity = left.getEntity("PublicOption");
    const moduleEntity = left.modules[0]?.entities?.[0];
    expect(publicEntity).toBeDefined();
    expect(moduleEntity as unknown).not.toBe(publicEntity);
    expect(moduleEntity as unknown).toEqual(publicEntity as unknown);
    expect(publicEntity).not.toBe(module.entities?.[0]);
    expect(Object.isFrozen(left.modules[0])).toBe(true);
    expect(Object.isFrozen(left.modules[0]?.entities)).toBe(true);
    expect(Object.isFrozen(publicEntity)).toBe(true);
    expect(Object.isFrozen(publicEntity?.type)).toBe(true);
    expect(Object.isFrozen(publicEntity?.typeScheme)).toBe(true);

    if (
      publicEntity === undefined
      || !("$variant" in publicEntity.type)
      || publicEntity.typeScheme === undefined
    ) {
      throw new Error("expected compatibility variant entity with a scheme");
    }
    const publicCase = publicEntity.type.$variant.cases[0]!;
    const publicVariable = publicEntity.typeScheme.quantified[0]!;
    // These writes precede both the second registry construction and either
    // registry's lazy constructor-catalog read. A normal public face must not
    // provide a path back into their shared module input.
    expect(Reflect.set(publicCase, "name", "Poisoned")).toBe(false);
    expect(Reflect.set(publicVariable, "sourceName", "poisoned")).toBe(false);
    expect(Reflect.set(left.modules[0]!.entities!, "0", {
      ...publicEntity,
      id: "Poisoned",
    })).toBe(false);

    expect("$variant" in body ? body.$variant.cases[0]!.name : undefined).toBe("Some");
    expect(typeScheme.quantified[0]!.sourceName).toBe("a");
    const right = sourceHandleRegistry(module);
    expect(right.getEntity("PublicOption")).not.toBe(publicEntity);

    const leftSignature = left.listConstructorSignatures().find((row) =>
      row.ownerName === "PublicOption" && row.name === "Some"
    );
    const rightSignature = right.listConstructorSignatures().find((row) =>
      row.ownerName === "PublicOption" && row.name === "Some"
    );
    expect(leftSignature).toEqual(rightSignature);
    expect(leftSignature?.outcome.$tag).toBe("Solved");
    expect(leftSignature?.scheme?.quantified[0]?.sourceName).toBe("a");
  }, 180_000);

  test("rejects accessors, cycles, and sparse arrays at entity scheme ingress", () => {
    {
      let getterCalls = 0;
      const scheme: Record<string, unknown> = { quantified: [] };
      Object.defineProperty(scheme, "body", {
        enumerable: true,
        get() {
          getterCalls += 1;
          return { $ref: "String" };
        },
      });
      expect(() => sourceHandleRegistry(moduleWithScheme(
        "AccessorScheme",
        { $ref: "Fallback" },
        scheme as TypeScheme,
      ))).toThrow(/accessor property "body" is not allowed/);
      expect(getterCalls).toBe(0);
    }

    {
      const scheme: Record<string, unknown> = { quantified: [] };
      scheme.body = scheme;
      expect(() => sourceHandleRegistry(moduleWithScheme(
        "CyclicScheme",
        { $ref: "Fallback" },
        scheme as TypeScheme,
      ))).toThrow(/cyclic transport data is not allowed/);
    }

    {
      const applications = new Array(1);
      const scheme = {
        quantified: [],
        body: { $ref: "String" },
        applications,
      } as unknown as TypeScheme;
      expect(() => sourceHandleRegistry(moduleWithScheme(
        "SparseScheme",
        { $ref: "Fallback" },
        scheme,
      ))).toThrow(/sparse array slot 0 is not allowed/);
    }
  });
});
