import { describe, expect, test } from "bun:test";
import type { ModuleRegistry } from "@fenel/engine/registry";
import type { EntityRegistration, FieldDef, IOHandler } from "@fenel/engine/types";
import { registerStateHandlers } from "./state";

const FIELD_A = "10000000-0000-4000-8000-00000000000a";
const FIELD_B = "10000000-0000-4000-8000-00000000000b";
const Nothing = { $tag: "Nothing" } as const;

function accountRegistry(
  fieldId: string,
  expressionWidget: boolean,
): ModuleRegistry {
  const field: FieldDef = {
    name: "amount",
    key: { $tag: "NamedField", ref: { $ref: fieldId } },
    type: { $ref: "Number" },
    label: Nothing,
    ui: Nothing,
    meta: {},
  };
  const entity: EntityRegistration = {
    id: "SharedForm",
    type: { $record: { fields: [field] } },
  };
  return {
    evaluateContext: () => ({ _fieldCurrentWire: { [fieldId]: "amount" } }),
    getIdentifiedEntity: (name: string) => name === "SharedForm" ? entity : undefined,
    getIdentifiedFunction: () => undefined,
    getEntity: () => undefined,
    getFieldRepresentation: (typeName: string, requestedId: string) => {
      if (requestedId !== fieldId) throw new Error("cross-account field lookup");
      return typeName === "Codeable"
        ? { typeName, args: [fieldId], methods: { codeName: "amount" }, scope: "account" }
        : undefined;
    },
    resolveFieldPresentation: (requestedId: string) => {
      if (requestedId !== fieldId) throw new Error("cross-account field lookup");
      return {
        label: expressionWidget ? "Account A amount" : "Account B amount",
        ...(expressionWidget
          ? { display: { widget: { $tag: "Just", _0: "markup-expression" } } }
          : {}),
        source: "uuid-field-facet" as const,
      };
    },
  } as unknown as ModuleRegistry;
}

describe("state validation account field registry", () => {
  test("uses the requesting account's identified type and Displayable facet", async () => {
    const handlers = new Map<string, IOHandler>();
    const registrationRegistry = {
      registerIOHandler: (name: string, handler: IOHandler) => handlers.set(name, handler),
      getIOHandler: (name: string) => handlers.get(name),
    } as unknown as ModuleRegistry;
    const registries = new Map([
      ["A", accountRegistry(FIELD_A, true)],
      ["B", accountRegistry(FIELD_B, false)],
    ]);
    const requestedAccounts: string[] = [];
    registerStateHandlers(registrationRegistry, {
      getAccountFieldRegistry: async (accountId) => {
        requestedAccounts.push(accountId);
        const registry = registries.get(accountId);
        if (!registry) throw new Error(`missing registry ${accountId}`);
        return registry;
      },
    });
    const validate = handlers.get("state.validate_entity_instance")!;

    const accountA = await validate(
      { typeName: "SharedForm", raw: { amount: "expression payload" } },
      { accountId: "A" } as never,
    );
    const accountB = await validate(
      { typeName: "SharedForm", raw: { amount: "expression payload" } },
      { accountId: "B" } as never,
    );

    expect(accountA.value).toEqual({
      ok: true,
      value: { amount: "expression payload" },
    });
    expect(accountB.value).toMatchObject({ ok: false });
    expect(requestedAccounts).toEqual(["A", "B"]);
  }, 180_000);
});
