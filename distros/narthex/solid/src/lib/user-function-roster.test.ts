import { beforeAll, describe, expect, test } from "bun:test";
import type { CatalogSection } from "@fenel/engine";
import type { FenelFunction } from "@fenel/engine/types";
import { modulesFor } from "@fenel/engine/module-manifest";
import { createRepositoryRegistry } from "@fenel/engine/repository-registry";
import { buildAuthoringCatalogSnapshot, createAuthoringEnvironment } from "@fenel/engine/authoring/environment";
import { inferAuthoringExpression, type ExprNode } from "@fenel/engine/authoring/expression";
import { peelMaybeForAuthoring } from "@fenel/engine/authoring/type";
import { createAccountAuthoringSession, type AuthoringSession } from "./expression-runner/account-authoring-session";
import { createDetachedAuthoringEnvironment } from "./expression-runner/detached-authoring-environment";
import { accountFunctionRows, type AccountFunctionRow } from "./user-function-roster";

const plain = (id: string): FenelFunction => ({ id, params: [], returns: { $ref: "String" }, body: "account value" });

describe("account function roster provenance", () => {
  test("only actual system copies of repository members leave the account overlay", () => {
    const repositoryIds = new Set(["std:id", "std:appendItem"]);
    const rows: Array<AccountFunctionRow & { name?: string; id?: string }> = [
      { function: plain("std:id"), isSystem: true, sourceRegistryId: null },
      { function: plain("std:appendItem"), isSystem: true, id: "module:std:appendItem" },
      { function: plain("account:own"), isSystem: false },
      // A genuine user-owned same-id override is not a managed source copy.
      { function: plain("std:id"), isSystem: false },
      { function: plain("core-only:submit"), isSystem: true },
      { function: plain("account:legacy") },
      { function: plain("installed:helper"), sourceRegistryId: "source-owner" },
      { function: plain("another:body"), name: "std:id", id: "module:std:id", isSystem: true },
    ];
    expect(accountFunctionRows(rows, repositoryIds)).toEqual([rows[2]!, rows[3]!, rows[4]!, rows[5]!, rows[7]!]);
    expect(rows).toHaveLength(8);
  });
});

describe("real seeded standard-library schemes in account authoring", () => {
  let base: AuthoringSession;
  let seeded: AccountFunctionRow[];
  let repositoryIds: Set<string>;
  const standardIds = ["std:id", "std:appendItem", "std:head"];
  const literal = (value: unknown): ExprNode => ({ kind: "literal", value });
  const call = (fnId: string, ...args: ExprNode[]): ExprNode => ({ kind: "call", fnId, args });
  const list = call("std:appendItem", literal(2), call("std:appendItem", literal(1), literal([])));
  const lookup = call("std:id", call("std:head", list));

  beforeAll(() => {
    const sourceModules = modulesFor("seed");
    repositoryIds = new Set(sourceModules.flatMap((entry) => (entry.functions ?? []).map((fn) => fn.id)));
    const standard = sourceModules.find((entry) => entry.name === "std");
    if (!standard) throw new Error("The real std module is absent.");
    // Real source declarations and actual registered schemes, not invented
    // quantified fixtures. The DB seeder persists this same identified spec.
    const registry = createRepositoryRegistry([standard]);
    const functions = standardIds.map((id) => {
      const fn = registry.getIdentifiedFunction(id);
      if (!fn) throw new Error(`The real ${id} source function is absent.`);
      expect(registry.getFunctionSignatureInfo(id)?.outcome.$tag).toBe("Solved");
      expect(registry.getFunctionScheme(id)?.quantified.length).toBeGreaterThan(0);
      return fn;
    });
    const sections: CatalogSection[] = [{ id: "function", label: "Functions", description: "", entries: functions.map((fn) => ({
      id: fn.id, name: fn.id, description: "", category: "function", fn,
    })) }];
    const environment = createDetachedAuthoringEnvironment(createAuthoringEnvironment(buildAuthoringCatalogSnapshot(sections, { registry })));
    base = { mode: "detached", registry, environment, catalog: environment.catalog, evaluateContext: registry.evaluateContext() };
    seeded = functions.map((fn) => ({ function: structuredClone(fn), isSystem: true, sourceRegistryId: null }));
  }, 180_000);

  test("the old seeded overlay loses binders and breaks a real id/head/appendItem chain", () => {
    const old = createAccountAuthoringSession(base, { accountId: "roster-fixture", functions: seeded.map((row) => row.function) });
    expect(old.environment.getFunctionEntry?.("std:id")?.scheme?.quantified).toEqual([]);
    expect(inferAuthoringExpression(lookup, old.environment).outcome.$tag).not.toBe("Solved");
  });

  test("source schemes survive while user and backend-only functions remain present", () => {
    const own = { function: plain("account:hello"), isSystem: false };
    const backendOnly = { function: plain("core-only:submit"), isSystem: true };
    const selected = accountFunctionRows([...seeded, own, backendOnly], repositoryIds).map((row) => row.function);
    const account = createAccountAuthoringSession(base, { accountId: "roster-fixture", functions: selected });
    for (const id of standardIds) {
      expect(account.environment.getFunctionEntry?.(id)?.scheme).toEqual(base.environment.getFunctionEntry?.(id)?.scheme);
      expect(account.environment.getFunctionEntry?.(id)?.scheme?.quantified.length).toBeGreaterThan(0);
    }
    expect(account.environment.getFunctionEntry?.("account:hello")).toBeDefined();
    expect(account.environment.getFunctionEntry?.("core-only:submit")).toBeDefined();
    const original = inferAuthoringExpression(lookup, base.environment);
    const result = inferAuthoringExpression(lookup, account.environment);
    expect(original.outcome.$tag).toBe("Solved");
    expect(result.outcome.$tag).toBe("Solved");
    expect(result.scheme).toEqual(original.scheme);
    expect(peelMaybeForAuthoring(result.type!)?.value).toEqual({ $ref: "Number" });
  });
});
