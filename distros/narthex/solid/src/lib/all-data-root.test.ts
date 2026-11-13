// C1: the async host projection uses current Fenel targets and the existing
// closed operation dispatcher. Type handles/descriptions are inert host facts.
import { describe, expect, test } from "bun:test";
import { loadFenelModule } from "../../../../../implementations/typescript/engine/src/fenel-module";
import { evaluate, type EvaluateContext } from "../../../../../implementations/typescript/engine/src/json-logic";
import { stdNatives, stdNativesCtx } from "../../../../../fenel/modules/std/ffi/std-ffi";
import type { WorkspaceModel } from "./workspace-model-loader";
import { runLocalOrdinaryOperation } from "./local-ordinary-operations";
import { projectAllDataRoot, projectAllDataRootAsync, type AllDataRootOperate } from "./all-data-root";

// GLOBAL_ONLY: literal source roster, no authenticated account/reader/authority.
const functions = new Map<string, NonNullable<ReturnType<typeof loadFenelModule>["functions"]>[number]>();
for (const [path, name] of [["view/types.fenel", "view"], ["std/not.fenel", "std"]]) {
  const owner = loadFenelModule(await Bun.file(new URL(`../../../../../fenel/modules/${path}`, import.meta.url)).text(), name!,
    { bootstrapParser: "typescript" });
  for (const fn of owner.functions ?? []) {
    functions.set(fn.id, fn); functions.set(fn.id.replace(":", "."), fn); functions.set(fn.id.slice(fn.id.indexOf(":") + 1), fn);
  }
}
const context: EvaluateContext = { getFunction: name => functions.get(name),
  natives: Object.assign(Object.create(null), stdNatives), nativesCtx: Object.assign(Object.create(null), stdNativesCtx) };
const model = {
  workspaceCall: <T>(name: string, ...args: unknown[]): T => evaluate({ call: [`view:${name}`,
    ...args.map((_, index) => ({ var: `arg${index}` }))] },
    Object.fromEntries(args.map((arg, index) => [`arg${index}`, arg])), context) as T,
  allDataRootTypes: () => ({ type: { $ref: "fixture.ListTarget" }, targetType: { $ref: "fixture.Target" } }),
  allDataRootDescriptions: () => [],
} as unknown as WorkspaceModel;

describe("async All data projection", () => {
  test("keeps the synchronous producer's Fenel targets and one captured presentation roster", async () => {
    const accounts = [{ id: "all", label: "All data" }, { id: "public", label: "Public" },
      { id: "local", label: "Local", icon: "computer" }, { id: "authorized", label: "Account" }];
    const expected = projectAllDataRoot(model, accounts);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const operations: string[] = [];
    const operate: AllDataRootOperate = async operation => {
      operations.push(operation.kind);
      const result = runLocalOrdinaryOperation(model, operation);
      if (operation.kind === "allDataRootTargets") await held;
      return result;
    };
    const pending = projectAllDataRootAsync(operate, accounts);
    accounts[2]!.label = "Changed during projection"; accounts[2]!.icon = "changed";
    accounts.push({ id: "later", label: "Added during projection" });
    release();
    const actual = await pending;
    expect(actual).toEqual(expected);
    expect(actual.items.map(item => item.id)).toEqual(["public", "local", "authorized"]);
    expect(operations).toEqual(["allDataRootTargets", "allDataRootTypes", "allDataRootDescriptions"]);
  });

  test("propagates a posted operation failure without a second invocation", async () => {
    const operations: string[] = [];
    const operate: AllDataRootOperate = async operation => {
      operations.push(operation.kind);
      if (operation.kind === "allDataRootTargets") throw new Error("The captured worker refused");
      return runLocalOrdinaryOperation(model, operation);
    };
    await expect(projectAllDataRootAsync(operate, [{ id: "local", label: "Local" }])).rejects.toThrow("The captured worker refused");
    expect(operations).toEqual(["allDataRootTargets", "allDataRootTypes"]);
  });
});
