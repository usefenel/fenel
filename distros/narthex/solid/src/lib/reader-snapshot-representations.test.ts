import { expect, test } from "bun:test";
import { createRegistry } from "@fenel/engine/registry";
import { createDispatchRegistry, dispatchRegistry, representationsForTarget } from "@fenel/engine";
import { stdModule } from "../../../../../implementations/typescript/engine/src/modules/std";
import { engineModule } from "../../../../../implementations/typescript/engine/src/modules/engine";
import { dispatchModule } from "../../../../../implementations/typescript/engine/src/modules/dispatch";
import { mintAnonymousAuthority } from "../../../../../implementations/typescript/runtime/src/authority-mint";
import { perform } from "../../../../../implementations/typescript/engine/src/perform";
import { representationsFromReaderSnapshot } from "./reader-presentation";

test("captured representation metadata preserves anonymous refusal and canonical source priority", () => {
  const pool = createDispatchRegistry();
  for (const name of ["Representational", "Labelable", "Iconable"]) {
    const cls = dispatchRegistry.getClass(name);
    if (!cls) throw new Error(`Missing repository class ${name}`);
    pool.defineClass(cls);
  }
  pool.addInstance({ typeName: "Representational", args: ["Labelable"], methods: {}, scope: "global" });
  pool.addInstance({ typeName: "Representational", args: ["Iconable"], methods: {}, scope: { kind: "account", accountId: "other-account" } });
  pool.addInstance({ typeName: "Representational", args: ["UnregisteredClass"], methods: {}, scope: "global" });
  const target = "a811e498-4af0-4268-8934-319b238342cf";
  pool.addInstance({ typeName: "Labelable", args: [target], methods: { label: "global" }, priority: 1, scope: "global" });
  pool.addInstance({ typeName: "Labelable", args: [target], methods: { label: "this source" }, priority: 100, scope: { kind: "tag", tag: "source-one" } });
  pool.addInstance({ typeName: "Labelable", args: [target], methods: { label: "another source" }, priority: 1000, scope: { kind: "tag", tag: "source-two" } });
  pool.addInstance({ typeName: "Labelable", args: [target], methods: { label: "lower priority" }, priority: 10, scope: { kind: "tag", tag: "source-one" } });
  pool.addInstance({ typeName: "Iconable", args: [target], methods: { icon: "not in visible family" }, scope: "global" });
  const registry = createRegistry([stdModule, engineModule, dispatchModule], { dispatchRegistry: pool });
  const frame = { ...registry.evaluateContext(), _authority: mintAnonymousAuthority(registry), _activeTags: ["source-one"] };
  const listNative = frame.nativesCtx?.["dispatch:listAllInstances"];
  expect(() => perform(frame, { descriptor: "dispatch:listAllInstances", args: ["Representational"] })).toThrow(/authority refused/);
  expect(() => representationsForTarget(target, frame)).toThrow(/authority refused|was not mediated/);
  expect(representationsFromReaderSnapshot(registry, frame, target)).toEqual([
    { typeName: "Labelable", methods: { label: "this source" } },
  ]);
  expect(frame.nativesCtx?.["dispatch:listAllInstances"]).toBe(listNative);
  expect(() => perform(frame, { descriptor: "dispatch:listAllInstances", args: ["Representational"] })).toThrow(/authority refused/);
  expect(() => representationsForTarget(target, frame)).toThrow(/authority refused|was not mediated/);
}, 180_000);
