import { describe, expect, test } from "bun:test";

import { SYSTEM_REGISTRY_MODULES } from "./system-registry-modules";

describe("system registry module closure", () => {
  test("email's ActionOk dependency has one exact constructor owner", () => {
    const email = SYSTEM_REGISTRY_MODULES.find((module) => module.name === "email");
    expect(email?.functions?.some((fn) => fn.id === "email:emailNotDelivered")).toBe(true);

    const owners = SYSTEM_REGISTRY_MODULES.flatMap((module) =>
      (module.entities ?? []).flatMap((entity) => {
        if (!("$variant" in entity.type)) return [];
        if (!entity.type.$variant.cases.some((variantCase) => variantCase.name === "ActionOk")) {
          return [];
        }
        return [{ containerModule: module.name, entityId: entity.id, ownerModule: entity.module }];
      })
    );

    expect(owners).toEqual([{
      containerModule: "action-result",
      entityId: "ActionResult",
      ownerModule: "core-action-result",
    }]);
  });
});
