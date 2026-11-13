import { expect, test } from "bun:test";
import { repositoryTypeIdentity } from "@fenel/engine/repository-identity-manifest";
import type { Candidate, ValueSuggestion } from "./value-suggestions";

// C1: the moved operation's unchanged candidate/verdict/identity projection.
// Real parser/profile equality still needs the actual worker-entry differential.
const source = await Bun.file(new URL("./core-value-suggestions-operation.ts", import.meta.url)).text();
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source.replace(/^import[^\n]+\n/gm, ""))
  .replace(/^export /gm, "");
const operation = new Function("repositoryTypeIdentity", "buildValueCandidates", "suggestValues", code + "; return coreValueSuggestions;");
const manifest = await Bun.file(new URL("../../../../../../implementations/typescript/engine/src/generated/repository-identity-manifest.json", import.meta.url)).json();
const SCALAR_IDENTITIES: Record<string, string> = {
  Int: "4762aff9-078d-46d8-a53f-336f980d229f", Number: "a55fd60e-2089-4d2b-862c-6e9d78939958",
  String: "5fab2c69-eacf-4e2e-8d95-0b835c191f4c", Boolean: "f5995014-ca80-46a0-a4b8-ee8b117b8cb9",
};
test("neutral operation keeps system owner identities and withholds a no-ID Date choice", () => {
  const names = ["Int", "Number", "String", "Boolean", "Date"];
  const candidates: Candidate[] = names.map(name => ({ id: name, typeName: name, label: name, type: { $ref: name },
    scalar: name === "Date" ? "Date" : name === "String" ? "String" : name === "Boolean" ? "Boolean" : "Number",
    constraints: [], priority: 1 }));
  let checkedNames: string[] = [];
  const run = operation(repositoryTypeIdentity, (items: unknown) => { expect(items).toEqual([]); return candidates; },
    (...args: [string, Candidate[]]) => {
      expect(args).toHaveLength(2);
      const [input, rows] = args;
      checkedNames = rows.map(row => row.typeName);
      return [...rows, candidates[4]!].map(row => ({ ...row, detail: input, score: 1, status: "complete", value: input })) as ValueSuggestion[];
    });
  const result = run("  exact text  ") as { input: string; suggestions: ValueSuggestion[] };
  expect(result.input).toBe("  exact text  ");
  expect(checkedNames).toEqual(names.slice(0, 4));
  expect(result.suggestions.map(row => row.typeName)).toEqual(checkedNames);
  for (const row of result.suggestions) {
    const key = (manifest.types as string[][]).find(([owner, name]) => owner === "system" && name === row.typeName)![2];
    const identity = (manifest.entries as string[][]).find(([entry, , kind]) => entry === key && kind === "type")![1];
    expect(identity).toBe(SCALAR_IDENTITIES[row.typeName]);
    expect(row.type).toEqual({ $ref: identity });
    expect(row.status === "complete" && row.value).toBe("  exact text  ");
  }
});
