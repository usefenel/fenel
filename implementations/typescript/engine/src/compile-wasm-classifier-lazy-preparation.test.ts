import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const classifierSource = readFileSync(
  new URL("./compile-wasm-self-host-classifier.ts", import.meta.url),
  "utf8",
);

describe("Wasm classifier lazy preparation boundary", () => {
  it("warms metadata and samples without eagerly compiling the helper roster", () => {
    const start = classifierSource.indexOf("export function prepareClassifier");
    const end = classifierSource.indexOf(
      "// Phase 5b30 — public classifier API.",
      start,
    );
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const prepareSource = classifierSource.slice(start, end);

    expect(prepareSource).toContain("getCompilerMetadataRegistry()");
    expect(prepareSource).toContain("getHarnessCtorDefs()");
    expect(prepareSource).toContain("getFnSamples()");
    expect(prepareSource).not.toContain("sharedWasmHelperFns");
    expect(prepareSource).not.toContain("ensureSharedWasmHelperPrepared");
  });

  it("prepares only imports of the compiled cell before fresh instantiation", () => {
    expect(classifierSource).toContain("ensureSharedWasmImportsPrepared(mod)");
    expect(classifierSource).toContain("new WebAssembly.Instance(");
    expect(classifierSource).not.toContain("ensureSharedWasmHelpersCompiled");
  });

  it("revalidates the complete immutable input before an identity-cache hit", () => {
    const start = classifierSource.indexOf("function prepareWasmCompilation");
    const end = classifierSource.indexOf("function compiledWasmModule", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const preparationSource = classifierSource.slice(start, end);
    const sourceBuild = preparationSource.indexOf("const source: CompileSource");
    const snapshot = preparationSource.indexOf("exactImmutableDataSnapshot(source)");
    const cacheRead = preparationSource.indexOf("preparedWasmCompilations.get");

    expect(sourceBuild).toBeGreaterThanOrEqual(0);
    expect(snapshot).toBeGreaterThan(sourceBuild);
    expect(cacheRead).toBeGreaterThan(snapshot);
    expect(preparationSource).toContain("exactImmutableDataEqual(");
    expect(preparationSource).toContain("inputFingerprint: inputSnapshot.value");
    expect(preparationSource).not.toContain(
      "const cached = preparedWasmCompilations.get(fn as object);\n  if (cached !== undefined) return cached;",
    );
  });
});
