import { describe, expect, test } from "bun:test";

import { telegramModule } from "./modules/telegram";
import { systemEntities } from "./system-entities";

function requireGroundScheme(
  entities: readonly {
    readonly id: string;
    readonly type?: unknown;
    readonly typeScheme?: { readonly quantified: readonly unknown[]; readonly body: unknown };
  }[],
  id: string,
): void {
  const entity = entities.find((candidate) => candidate.id === id);
  expect(entity, `missing ${id}`).toBeDefined();
  expect(entity?.typeScheme?.quantified).toEqual([]);
  expect(entity?.typeScheme?.body).toBe(entity?.type);
}

describe("host entity scheme authority", () => {
  test("publishes schemes for concrete system constructor owners", () => {
    for (const id of ["Boolean", "GeoLevel", "GeoPath", "field_ui_hint"]) {
      requireGroundScheme(systemEntities, id);
    }
  });

  test("publishes schemes for concrete Telegram host entities", () => {
    const entities = telegramModule.entities ?? [];
    for (const id of [
      "BotToken",
      "BotId",
      "Url",
      "MessageText",
      "CallbackData",
      "CallbackText",
      "TgLinkKind",
      "CollectorEntry",
      "TelegramFormCompletedPayload",
    ]) {
      requireGroundScheme(entities, id);
    }
  });

  // Per-owner type identity S1: Telegram's TypeScript copy of Handle (the same
  // `format:handle` refinement) is gone; `handle : Handle` names the system type.
  test("Handle is the system declaration, never a Telegram copy", () => {
    expect((telegramModule.entities ?? []).some((entity) => entity.id === "Handle")).toBe(false);
    requireGroundScheme(systemEntities, "Handle");
  });
});

describe("promoted source constructor provenance", () => {
  test("retains std Expr source scheme and derives ELit/EVar through their actual prelude", async () => {
    const [{ createRepositoryRegistry }, { evaluate }, { dispatchEngineBody }] = await Promise.all([
      import("./repository-registry"), import("./json-logic"), import("./engine-bodies-dispatch"),
    ]);
    const source = systemEntities.find(entity => entity.id === "Expr");
    expect(source?.sourceModule?.name).toBe("std");
    expect(source?.typeScheme?.quantified.map(variable => variable.sourceName)).toEqual(["a"]);
    const registry = createRepositoryRegistry([]);
    const constructors = registry.listConstructorSignatures().filter(row => row.ownerName === "Expr");
    const literal = constructors.find(row => row.name === "ELit");
    const variable = constructors.find(row => row.name === "EVar");
    expect(literal?.outcome.$tag).toBe("Solved");
    expect(variable?.outcome.$tag).toBe("Solved");
    expect(literal?.ownerModule).toBe("system");
    expect(literal?.scheme?.quantified.map(row => row.sourceName)).toEqual(["a"]);
    if (!literal) throw new Error("Missing registered ELit constructor");
    const value = evaluate({ construct: [literal.targetId, { value: 42 }] }, {}, registry.evaluateContext());
    expect(value).toEqual({ $tag: "ELit", value: 42 });
    expect(dispatchEngineBody("engine:exprToJsonLogic", [value])).toBe(42);
  }, 180_000);

  test("a source from another namespace or an explicitly missing import retains the nominal fence", async () => {
    const [{ createRepositoryRegistry }, { loadFenelModule }] = await Promise.all([
      import("./repository-registry"), import("./fenel-module"),
    ]);
    const promoted = systemEntities.find(entity => entity.id === "Expr");
    if (!promoted?.sourceModule) throw new Error("Missing captured Expr source");
    const original = promoted.sourceModule;
    try {
      for (const frame of [loadFenelModule("module otherSource where", "otherSource"),
        loadFenelModule("module std where\nimport absent (String)", "std")]) {
        promoted.sourceModule = frame;
        const registry = createRepositoryRegistry([]);
        const literal = registry.listConstructorSignatures().find(row => row.ownerName === "Expr" && row.name === "ELit");
        expect(literal?.outcome.$tag).toBe("AnnotationRequired");
      }
    } finally { promoted.sourceModule = original; }
  }, 180_000);

  test("the captured source's import shadows the system prelude by exact nominal identity", async () => {
    const [{ createRepositoryRegistry }, { loadFenelModule }] = await Promise.all([
      import("./repository-registry"), import("./fenel-module"),
    ]);
    const promoted = systemEntities.find(entity => entity.id === "Expr");
    if (!promoted?.sourceModule) throw new Error("Missing captured Expr source");
    const original = promoted.sourceModule;
    const type = { $opaque: { name: "ForeignString", pure: { $ref: "Number" } } };
    try {
      promoted.sourceModule = loadFenelModule("module std where\nimport other (String)", "std");
      const registry = createRepositoryRegistry([{ name: "other", label: "Other", entities: [{
        id: "String", module: "other", type, typeScheme: { quantified: [], body: type },
      }] }]);
      const variable = registry.listConstructorSignatures().find(row => row.ownerName === "Expr" && row.name === "EVar");
      expect(variable?.outcome.$tag).toBe("Solved");
      expect(variable?.scheme?.nominals?.some(row => row.identity === JSON.stringify(["other", "String"]))).toBe(true);
      expect(variable?.scheme?.nominals?.some(row => row.identity === JSON.stringify(["system", "String"]))).toBe(false);
    } finally { promoted.sourceModule = original; }
  }, 180_000);
});
