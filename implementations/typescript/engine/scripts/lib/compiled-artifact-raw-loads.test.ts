// Draft C1 controls only. No registry, build or browser is needed by this file.
import { describe, expect, test } from "bun:test";
import { repositoryRelativePath } from "./artifact-bytes";
import { censusDirectRawModuleLoads } from "./compiled-artifact-acquisition";

const path = repositoryRelativePath("implementations/typescript/engine/src/modules/example.ts");
const fixture = `
import { loadFenelModule, loadFenelModuleUnion } from "../fenel-module";
import SOURCE from "../../../../../fenel/examples/example.fenel?raw";
export const value: FenelModule = loadFenelModule(SOURCE, "Example", { label: "Example data" });
export const VALUES: readonly FenelModule[] = [value];
`;

describe("bounded raw loader provenance observations", () => {
  test("reports exact standalone source/options/result/array facts without minting role authority", () => {
    const rows = censusDirectRawModuleLoads(path, fixture);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.closedStandaloneShape).toBe(true);
    expect(rows[0]!.fallbackName).toBe("Example");
    expect(rows[0]!.options).toEqual({ label: "Example data" });
    expect(rows[0]!.resultBinding).toBe("value");
    expect(rows[0]!.identifierArrays[0]!.members).toEqual(["value"]);
    expect(rows[0]!.canonicalTargetEstablished).toBe(false);
    expect(rows[0]!.consumerRolesEstablished).toBe(false);
  });
  test.each([
    fixture + "const alias = SOURCE;\n",
    fixture + "const alias = value;\n",
    fixture + "const all = value.functions;\n",
    fixture + "function shadow(loadFenelModule: unknown) {}\n",
    fixture.replace('label: "Example data"', 'label: computedLabel'),
    fixture.replace('label: "Example data"', 'label: "one", label: "two"'),
    fixture.replace('label: "Example data"', '__proto__: "ignored"'),
    fixture.replace('loadFenelModule(SOURCE', 'loadFenelModuleUnion(SOURCE'),
  ])("unknown/aliased/computed shapes remain byte-bound", source => {
    expect(censusDirectRawModuleLoads(path, source)[0]!.closedStandaloneShape).toBe(false);
  });
  test("a lookalike loader name does not establish canonical target or downstream roles", () => {
    const row = censusDirectRawModuleLoads(path, fixture.replace('../fenel-module', '../lookalike'))[0]!;
    expect(row.loaderSpecifier).toBe("../lookalike");
    expect(row.canonicalTargetEstablished).toBe(false);
    expect(row.consumerRolesEstablished).toBe(false);
  });
});
