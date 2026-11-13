import { describe, expect, test } from "bun:test";

import { loadFenelModule } from "./fenel-module";
import { authModule } from "./modules/auth";
import { dispatchModule } from "./modules/dispatch";
import { proverModule } from "./modules/prover";
import { createEngineBootstrapRegistry } from "./registry";
import type { FenelModule } from "./types";

function declarationCodeNameFor(module: FenelModule, functionId: string): string | undefined {
  const instance = (module.instances ?? []).find((candidate) =>
    candidate.typeName === "Codeable" && candidate.args[0] === functionId
  );
  const codeName = instance?.methods.codeName;
  return typeof codeName === "string" ? codeName : undefined;
}

function expectCompleteSourceRoster(module: FenelModule): void {
  const declarations = module.functionSignatureDeclarations ?? [];
  for (const fn of module.functions ?? []) {
    const codeName = declarationCodeNameFor(module, fn.id);
    const matches = declarations.filter((declaration) =>
      declaration.functionId === fn.id
      || (codeName !== undefined && declaration.codeName === codeName)
    );
    expect(matches, `${module.name}:${fn.id} must retain one source declaration`).toHaveLength(1);
  }
}

describe("Fenel module signature-sidecar composition", () => {
  test("an explicit declaration roster cannot silently omit an appended loader function", () => {
    const first = loadFenelModule(`
      first : String -> String
      first value = value
    `, "composition");
    const second = loadFenelModule(`
      second : String -> String
      second value = value
    `, "composition");
    const broken: FenelModule = {
      ...first,
      functions: [...(first.functions ?? []), ...(second.functions ?? [])],
      instances: [...(first.instances ?? []), ...(second.instances ?? [])],
    };

    expect(() => createEngineBootstrapRegistry([broken])).toThrow(
      "registry module composition: function signature declaration roster omits loader declaration composition:second",
    );
  }, 30_000);

  test("production partial-module compositions retain every source declaration", () => {
    expectCompleteSourceRoster(authModule);
    expectCompleteSourceRoster(dispatchModule);
    expectCompleteSourceRoster(proverModule);
  });
});
