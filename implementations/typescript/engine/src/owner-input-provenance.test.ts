import { expect, test } from "bun:test";
import { beginOwnerModuleProvenanceRecording, carryCanonicalLoadedModuleOrigin,
  observeOwnerModuleRoleRoster, rememberCanonicalLoadedModuleOrigin } from "./owner-input-provenance";
import type { FenelModule } from "./types";

test("origin/whole-roster observations do not establish semantic role completeness", () => {
  const recording = beginOwnerModuleProvenanceRecording();
  const module: FenelModule = { name: "Example", label: { $tag: "Just", _0: "Example" },
    entities: [], functions: [] };
  rememberCanonicalLoadedModuleOrigin(module, "module Example where", "fallback", { label: "Example" });
  const copy = structuredClone(module);
  carryCanonicalLoadedModuleOrigin(module, copy);
  observeOwnerModuleRoleRoster("constructor", "fixture/all", [module, copy, { ...module }]);
  module.functions!.push({ id: "Example:new", params: [], returns: { $ref: "Number" }, body: 1 });
  observeOwnerModuleRoleRoster("primary", "fixture/mutated", [module]);
  const result = recording.finish();
  expect(result.authority).toBe("NONE");
  expect(result.completeConsumerRolesEstablished).toBe(false);
  expect(result.origins).toHaveLength(1);
  expect(result.rosters[0]!.members.map(member => member.originOrdinal)).toEqual([0, 0, null]);
  expect(result.rosters[0]!.members.map(member => member.unchangedCanonicalData)).toEqual([true, true, false]);
  expect(result.rosters[1]!.members[0]!.unchangedCanonicalData).toBe(false);
});

test("unknown transforming source copies remain unknown", () => {
  const recording = beginOwnerModuleProvenanceRecording();
  const module: FenelModule = { name: "Example", label: { $tag: "Just", _0: "Example" }, functions: [] };
  rememberCanonicalLoadedModuleOrigin(module, "source", "Example", {});
  const copy = { ...module, label: { $tag: "Just" as const, _0: "transformed" } };
  carryCanonicalLoadedModuleOrigin(module, copy);
  observeOwnerModuleRoleRoster("harness", "fixture/transformed", [copy]);
  const result = recording.finish();
  expect(result.refusals).toHaveLength(1);
  expect(result.rosters[0]!.members[0]!.originOrdinal).toBe(null);
});
