import { describe, expect, test } from "bun:test";

import { loadFenelModule } from "./fenel-module";
import { createLocalRegistry } from "./repository-registry";
import { SYSTEM_REGISTRY_MODULES } from "./system-registry-modules";
import type { FenelModule } from "./types";

// A Local module that imports `system` under an alias or with `hiding`, and
// whose bodies spell `system.T.C`, crashed the registry build: building that
// module's Name frame inside the transitive-requires pass establishes the
// `system` root (it enters the registry's module heads), and the next
// `system.T.C` lookup read the constructor catalogue binding before its
// declaration (TDZ). Before signature finalization the catalogue is empty, so
// the pass must read such a name exactly as it does while `system` is not yet a
// head: unresolved, whatever order the modules' frames are built in.
const LONG = 540_000;

function positional(m: FenelModule): FenelModule {
  return {
    ...m,
    functions: (m.functions ?? []).map((f) => ({
      ...f,
      params: f.params.map((param, index) => ({ ...param, key: { $tag: "PositionalField", index } as const })),
    })),
  };
}

function load(lines: string[], name: string, imports?: FenelModule["imports"]): FenelModule {
  const loaded = positional(loadFenelModule(lines.join("\n"), name));
  return imports === undefined ? loaded : { ...loaded, imports };
}

// `usrsysa`: alias import; two roots spell `system.T.C` (the second is looked
// up after the first root built the frame). `usrsysh`: hiding import.
// `usrsysp`: no import at all, same spellings, whose `requires` must not depend
// on whether another module's frame was built first.
const aliased = () => load([
  "module usrsysa where",
  "consed : Number -> List Number",
  "consed _0 = system.List.Cons _0 system.List.Nil",
  "again : Number -> List Number",
  "again _0 = system.List.Cons _0 (consed _0)",
], "usrsysa", [{ module: "system", as: "Sys" }]);
const hiding = () => load([
  "module usrsysh where",
  "listed : Number -> List Number",
  "listed _0 = system.List.Cons _0 system.List.Nil",
], "usrsysh", [{ module: "system", hiding: ["Expr"] }]);
const plain = () => load([
  "module usrsysp where",
  "single : Number -> List Number",
  "single _0 = system.List.Cons _0 system.List.Nil",
], "usrsysp");

const userRequires = (reg: ReturnType<typeof createLocalRegistry>, ids: readonly string[]) =>
  Object.fromEntries(ids.map((id) => [id, JSON.stringify(reg.getFunction(id)?.requires ?? null)]));
const USER_IDS = ["usrsysa:consed", "usrsysa:again", "usrsysh:listed", "usrsysp:single"];

describe("Local modules importing system with an alias or hiding", () => {
  test("build, keep the alias and hiding frames, and read system.T.C independently of frame order", () => {
    const first = createLocalRegistry(SYSTEM_REGISTRY_MODULES, [aliased(), hiding(), plain()]);
    const second = createLocalRegistry(SYSTEM_REGISTRY_MODULES, [plain(), hiding(), aliased()]);

    for (const id of USER_IDS) expect(first.getFunction(id)?.id).toBe(id);
    expect(userRequires(first, USER_IDS)).toEqual(userRequires(second, USER_IDS));

    // The finished registry resolves the constructor through the system root
    // (finalization built the catalogue), as the evaluator reads it.
    expect(first.listModuleMembers("system")).toContain("List");
    const cons = first.resolveModuleMember("system", "List", ["Cons"]);
    expect(cons.kind).toBe("function");
    expect(second.resolveModuleMember("system", "List", ["Cons"])).toEqual(cons);

    // Alias and hiding semantics are unchanged: the alias frame maps `Sys` to
    // `system` and binds its members qualified only (`Sys.List`, never a bare
    // `List`) beside the module's own members (bare and module-qualified); the
    // hiding import never binds the hidden name.
    const aliasFrame = first.getModuleImportFrame("usrsysa");
    expect(aliasFrame?.aliases).toEqual({ Sys: "system" });
    const aliasNames = Object.keys(aliasFrame?.names ?? {});
    expect(aliasNames).toContain("Sys.List");
    expect(aliasNames).not.toContain("List");
    expect(aliasNames.filter((name) => !name.startsWith("Sys.")).sort())
      .toEqual(["again", "consed", "usrsysa.again", "usrsysa.consed"]);
    expect(aliasFrame?.names["consed"]).toBe("usrsysa:consed");
    const hidingFrame = first.getModuleImportFrame("usrsysh");
    expect(Object.hasOwn(hidingFrame?.names ?? {}, "Expr")).toBe(false);
    expect(second.getModuleImportFrame("usrsysa")).toEqual(aliasFrame);
    expect(second.getModuleImportFrame("usrsysh")).toEqual(hidingFrame);
  }, LONG);
});
