import { describe, expect, test } from "bun:test";
import { createRegistry } from "@fenel/engine/registry";
import type { FenelType, IOHandler } from "@fenel/engine/types";
import { stdModule } from "@fenel/engine/modules/std";
import { cryptoModule } from "@fenel/engine/modules/crypto";
import { validateValue } from "@fenel/engine/validation";
import { registerStateHandlers } from "./state";
import { storageRuntimeModule } from "./storage-backends";
import { Maybe, Nothing } from "@fenel/engine/type-foundation";
import { valueToJsonWire, valueFromJsonWire } from "@fenel/engine/authoring/type";

describe("named type value persistence", () => {
  test("universal validation returns actual scalar and constructor values", () => {
    const cases: [FenelType, unknown][] = [
      [{ $ref: "String" }, "hello"],
      [{ $ref: "Boolean" }, false],
      [{ $ref: "Number" }, 0],
      [{ $ref: "Bytes" }, new Uint8Array([0, 255])],
      [Maybe({ $ref: "String" }), null],
      [{ $union: [{ $ref: "Number" }, { $ref: "String" }] }, 3],
      [{ $variant: { cases: [{ name: "Pending", label: Nothing }, { name: "Ready", label: Nothing }] } }, { $tag: "Ready" }],
    ];
    for (const [type, value] of cases) {
      const result = validateValue(type, value, null, { functions: {} });
      expect(result.errors).toEqual([]);
      expect(result.value).toEqual(value);
    }
  }, 120_000);

  test("unsupported projections remain undecided and empty lattice types reject", () => {
    expect(validateValue({ $unit: true }, null, null, { functions: {} })).toMatchObject({ valid: false, value: null });
    expect(validateValue({ $tuple: [{ $ref: "Number" }] }, [1], null, { functions: {} })).toMatchObject({ valid: false, value: [1] });
    expect(validateValue({ $union: [] }, 1, null, { functions: {} })).toMatchObject({ valid: false, value: 1 });
    expect(validateValue({ $ref: "Bytes" }, [0, 255], null, { functions: {} }).valid).toBe(false);
  }, 120_000);

  test("registered native instances create, list, replace and reopen through Memory storage", async () => {
    const choice: FenelType = { $variant: { cases: [{ name: "Pending", label: Nothing }, { name: "Ready", label: Nothing }] } };
    const union: FenelType = { $union: [{ $ref: "Number" }, { $record: { fields: [] } }] };
    const registry = createRegistry([stdModule, storageRuntimeModule, cryptoModule, { name: "value-fixture", label: "Value fixture", entities: [
      { id: "TestChoice", type: choice },
      { id: "TestMaybe", type: Maybe({ $ref: "String" }) },
      { id: "TestTypeValue", type: { $type: true } },
      { id: "TestUnionRaw", type: union },
    ] }]);
    registerStateHandlers(registry);
    const context = { accountId: `named-value-test-${crypto.randomUUID()}`, profileId: "", callFunction: async () => null, dispatchAction: async () => null, signedQueueUrl: () => "" } as never;
    const handler = (name: string) => registry.getIOHandler(name)! as IOHandler;
    const values: [string, unknown, unknown][] = [["String", "before", "after"], ["Number", 0, 12], ["Boolean", false, true], ["TestChoice", { $tag: "Ready" }, { $tag: "Pending" }], ["TestMaybe", null, Nothing]];
    for (const [typeName, original, replacement] of values) {
      const created = await handler("state.try_create_instance_by_name")({ typeName, value: original }, context);
      const outcome = created.value as { ok: boolean; value: string; error?: string };
      expect(outcome.ok, outcome.error).toBe(true);
      const loaded = await handler("state.get_instance_by_id")({ id: outcome.value }, context);
      expect((loaded.value as { _0: { data: unknown } })._0.data).toEqual(original);
      await handler("state.update_instance")({ instanceId: outcome.value, value: replacement }, context);
      const reopened = await handler("state.get_instance")({ typeId: typeName, instanceId: outcome.value }, context);
      expect(reopened.value).toEqual({ $tag: "Just", _0: replacement });
      const listed = await handler("state.list_instances_by_name")({ typeName }, context);
      expect((listed.value as { id: string; data: unknown }[]).find((row) => row.id === outcome.value)?.data).toEqual(replacement);
    }
    const typeValue: FenelType = {
      $refined: {
        base: { $ref: "String" },
        set: { $tag: "SePattern", pattern: { t: "rep", child: { t: "match", pred: { $tag: "SeAll" } }, min: 0, max: Infinity } },
      },
    };
    const createdType = await handler("state.try_create_instance_by_name")({ typeName: "TestTypeValue", value: typeValue }, context);
    const typeOutcome = createdType.value as { ok: boolean; value: string; error?: string };
    expect(typeOutcome.ok, typeOutcome.error).toBe(true);
    const storedType = await handler("state.get_instance_by_id")({ id: typeOutcome.value }, context);
    expect((storedType.value as { _0: { data: any; dataEncoding?: string | null } })._0.data.$refined.set.pattern.max).toBe(Infinity);
    expect((storedType.value as { _0: { dataEncoding?: string | null } })._0.dataEncoding).toBeNull();
    const reopenedType = await handler("state.get_instance")({ typeId: "TestTypeValue", instanceId: typeOutcome.value }, context);
    expect((reopenedType.value as { _0: unknown })._0).toEqual(typeValue);
    const wire = valueToJsonWire({ $type: true }, typeValue, registry);
    expect(valueFromJsonWire({ $type: true }, JSON.parse(JSON.stringify(wire)), registry)).toEqual(typeValue);
    const markerShapedRaw = valueToJsonWire(union, 7, registry);
    const rawCreate = await handler("state.try_create_instance_by_name")({ typeName: "TestUnionRaw", value: markerShapedRaw }, context);
    const rawId = (rawCreate.value as { value: string }).value;
    const rawRead = await handler("state.get_instance")({ typeId: "TestUnionRaw", instanceId: rawId }, context);
    expect((rawRead.value as { _0: unknown })._0).toEqual(markerShapedRaw);
  }, 120_000);
});
