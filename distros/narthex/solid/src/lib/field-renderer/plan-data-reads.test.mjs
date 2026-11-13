import { describe, expect, test } from "bun:test";

// A Local field plan is reused while only data it does not read changes
// (FieldRenderer.tsx planReadsData; demo 1 dropped keys, 2026-11-08). That
// reuse is sound only while the engine reads the typed value solely for a list
// editor's canonical choices, and the sibling values solely through `$el`
// dependent types. This suite pins those reads at their owners: a new read of
// either must update planReadsData in the same change.
const root = new URL("../../../../../../", import.meta.url);
const [fenel, engine, renderer] = await Promise.all([
  Bun.file(new URL("fenel/modules/engine/field-render-plan.fenel", root)).text(),
  Bun.file(new URL("implementations/typescript/engine/src/authoring/field-render.ts", root)).text(),
  Bun.file(new URL("./FieldRenderer.tsx", import.meta.url)).text(),
]);

describe("the field plan's reads of typed data", () => {
  test("the Fenel edit plan reads the value only in the list composite", () => {
    const reads = fenel.split(/\r?\n/).filter(line => /\binput\.value\b/.test(line));
    expect(reads).toHaveLength(1);
    expect(reads[0]).toContain("fieldListCanonicalChoicesPlan options input.canonicalListContext input.listMembership input.value");
    const start = fenel.indexOf("fieldCompositePlan input base = case base of");
    const branch = fenel.slice(start, fenel.indexOf("FtRecord { fields = fs } ->", start));
    expect(start).toBeGreaterThan(0);
    expect(branch).toContain("input.value");
    expect(branch).toContain("FtList");
  });

  test("the TypeScript plan passes the value through and reads it only for canonical list membership", () => {
    const reads = engine.split(/\r?\n/).filter(line => /\bargs\.value\b/.test(line)).map(line => line.trim());
    expect(reads).toEqual([
      "value: args.value,",
      "listMembership: canonicalListContext.$tag === \"Just\" ? fieldListMembership(expected, args.value, caller, args.registry) : Nothing,",
    ]);
  });

  test("sibling values reach the plan only through $el resolution", () => {
    const reads = engine.split(/\r?\n/).filter(line => /recordValues/.test(line) && !/^\s*(recordValues\?:|options: \{ recordValues\?)/.test(line))
      .map(line => line.trim());
    for (const line of reads) expect(line).toMatch(/resolveDependentType|peelEl|marshalFieldEditType|listDefault\(|recordValues: (useValues|concreteValues) \? args\.recordValues : undefined|recordValues\?: Record<string, unknown>,|"\$el" in type/);
    expect(engine).toContain("const resolved = \"$el\" in type ? resolveDependentType(type, options.recordValues, options.evaluateContext) : type;");
  });

  test("FieldRenderer's reuse rule names exactly those reads", () => {
    const rule = renderer.slice(renderer.indexOf("function planReadsData("), renderer.indexOf("function containsDependentType("));
    expect(rule).toContain("value: result.plan.editor.kind === \"list\"");
    expect(rule).toContain("recordValues: containsDependentType(field)");
  });
});
