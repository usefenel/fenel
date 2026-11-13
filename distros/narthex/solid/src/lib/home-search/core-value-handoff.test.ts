import { describe, expect, test } from "bun:test";
import { repositoryTypeIdentity } from "@fenel/engine/repository-identity-manifest";
import type { HomeAction } from "../home-action";

// Execute the actual existing composer's mount-time initializers without
// booting an account registry. The competing name resolver deliberately returns
// an unrelated account type; checked choices must never invoke it.
const source = await Bun.file(new URL("../../routes/app/home.tsx", import.meta.url)).text();
const transpiler = new Bun.Transpiler({ loader: "ts" });
const select = (from: string, to: string) => {
  const begin = source.indexOf(from);
  if (begin < 0) throw new Error(`Missing composer initializer: ${from}`);
  return source.slice(begin, source.indexOf(to, begin));
};
const homeInitializers = select('  const initialValue = ', '  const initialPin = ')
  + select('  const [composePresetType,', '  const [composePresetReps,');
const modalInitializers = select('  const [chosenType,', '  const rootField =');
const initializeHome = new Function("initialAction", "createSignal", `${transpiler.transformSync(homeInitializers)}
return { presetType: composePresetType(), presetValueType: composePresetValueType(), presetExpr: composePresetExpr(), initialBrowse };`);
const initializeModal = new Function("initial", "createSignal", "createMemo", "expectedTypeForName", "authoringSession",
  `${transpiler.transformSync(modalInitializers)}; return expectedType();`);
const signal = (value: unknown) => [() => value, (next: unknown) => { value = next; }];
// A core scalar's identity is the type row of its system declaration (type
// rows are keyed by owner; a bare name is no lock key).
const coreType = (name: string) => {
  const id = repositoryTypeIdentity("system", name);
  if (id === undefined) throw new Error(`No repository identity for the system type ${name}`);
  return { $ref: id };
};

describe("early checked value handoff into the existing composer", () => {
  for (const [name, value] of [["Int", 15], ["Number", 0], ["Boolean", false], ["String", "  hello  "], ["String", undefined]] as const) {
    test(`${name} preserves its checked type and literal ${String(value)}`, () => {
      const type = coreType(name);
      const action: HomeAction = { kind: "new:value", typeName: name, preset: { type, value } };
      const preset = initializeHome(action, signal);
      expect(preset.presetType).toBeNull();
      expect(preset.presetValueType).toEqual(type);
      expect(preset.presetExpr).toEqual({ kind: "literal", value });
      let nameLookups = 0;
      const checked = initializeModal(preset, signal, (read: () => unknown) => read,
        () => { nameLookups++; return { $ref: "same-name-account-type" }; }, () => ({ environment: {} }));
      expect(checked).toEqual(type);
      expect(nameLookups).toBe(0);
    });
  }

  test("Browse handoff keeps the exact current query", () => {
    expect(initializeHome({ kind: "browse", query: " 15 " }, signal).initialBrowse).toEqual({ kind: "browse", query: " 15 " });
  });
});
