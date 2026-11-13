import { expect, test } from 'bun:test';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// C1 tooling: inspect actual statically evaluated TypeScript dependencies,
// including imports that existing DOM fixtures replace with their codec seam.
const library = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(library, '..');
const allowedEngineLeaves = new Set(['@fenel/engine/maybe-value', '@fenel/engine/checkpoint-json', '@fenel/engine/inference-transport', '@fenel/engine/registry-transport']);
const engineSourceRoot = resolve(library, '../../../../../implementations/typescript/engine/src');
const allowedEngineFiles = new Set([resolve(engineSourceRoot, 'maybe-value.ts'),
  resolve(engineSourceRoot, 'checkpoint-json.ts'), resolve(engineSourceRoot, 'inference-transport.ts'), resolve(engineSourceRoot, 'registry-transport.ts')]);

function preparedEnginePath(base) {
  const path = relative(engineSourceRoot, base);
  if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) return false;
  return !allowedEngineFiles.has(extname(base) ? base : `${base}.ts`);
}

function runtimeImports(source, filename) {
  const loader = filename.endsWith('.tsx') ? 'tsx' : /\.[cm]?js$/.test(filename) ? 'js' : 'ts';
  return new Bun.Transpiler({ loader }).scanImports(source)
    .filter(edge => edge.kind === 'import-statement').map(edge => edge.path);
}

async function sourceFile(base) {
  if (extname(base) && !['.ts', '.tsx', '.mjs', '.js'].includes(extname(base))) return;
  for (const filename of [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`,
    resolve(base, 'index.ts'), resolve(base, 'index.tsx')]) {
    try { if ((await stat(filename)).isFile()) return filename; } catch {}
  }
}

test('initial data surface keeps prepared engine dependencies behind acquisition', async () => {
  const surface = resolve(library, 'workspace-surface.tsx');
  const replacement = process.env.FENEL_STARTUP_IMPORT_SURFACE;
  const queue = [{ file: surface, chain: ['workspace-surface.tsx'] }];
  const seen = new Set(), eager = [];
  while (queue.length) {
    const current = queue.shift();
    if (seen.has(current.file)) continue;
    seen.add(current.file);
    const source = await readFile(current.file === surface && replacement ? resolve(replacement) : current.file, 'utf8');
    for (const specifier of runtimeImports(source, current.file)) {
      const chain = [...current.chain, specifier];
      if (specifier.startsWith('@fenel/engine')) {
        if (!allowedEngineLeaves.has(specifier)) eager.push(chain.join(' → '));
        continue;
      }
      const base = specifier.startsWith('~/') ? resolve(sourceRoot, specifier.slice(2))
        : specifier.startsWith('.') ? resolve(dirname(current.file), specifier) : undefined;
      if (!base) continue;
      // A relative import of engine code or generated JSON is the same eager
      // boundary as its package alias. Check it before non-code asset filtering.
      if (preparedEnginePath(base)) { eager.push(chain.join(' → ')); continue; }
      const file = await sourceFile(base);
      if (file) queue.push({ file, chain });
    }
  }
  expect(eager).toEqual([]);
});

test('direct engine paths retain the same boundary for code and generated data', () => {
  expect(preparedEnginePath(resolve(engineSourceRoot, 'authoring/expression-authoring'))).toBe(true);
  expect(preparedEnginePath(resolve(engineSourceRoot, 'generated/repository-identity-manifest.json'))).toBe(true);
  expect(preparedEnginePath(resolve(engineSourceRoot, 'checkpoint-json'))).toBe(false);
  expect(preparedEnginePath(resolve(engineSourceRoot, 'maybe-value.ts'))).toBe(false);
  expect(preparedEnginePath(resolve(library, 'workspace-wire.ts'))).toBe(false);
});

// C1/C2 loader regression: resolve the actual checked-in runtime edges without
// importing/evaluating an engine or registry. Reuse runtimeImports/sourceFile.
test('runtime import scanning includes static re-exports and erases explicit type-only edges', () => {
  expect(runtimeImports(`import type { A } from './type-a';
    import { type B } from './type-b'; export type { C } from './type-c';
    export { type D } from './type-d'; export * from './star';
    import { value } from './value'; import('./later');`, 'fixture.ts'))
    .toEqual(['./star', './value']);
});

test('the existing early inference snapshot leaf remains free of runtime imports', async () => {
  const leaf = Bun.resolveSync('@fenel/engine/inference-transport', library);
  expect(preparedEnginePath(leaf)).toBe(false);
  expect(runtimeImports(await readFile(leaf, 'utf8'), leaf)).toEqual([]);
});

test('the lens publication transport leaf remains free of runtime imports', async () => {
  const leaf = resolve(engineSourceRoot, 'registry-transport.ts');
  expect(preparedEnginePath(leaf)).toBe(false);
  expect(runtimeImports(await readFile(leaf, 'utf8'), leaf)).toEqual([]);
});

async function staticRuntimeFiles(entry, overrides = new Map()) {
  const queue = [entry], seen = new Set();
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    if (['.json', '.fenel'].includes(extname(file))) continue;
    const source = overrides.get(file) ?? await readFile(file, 'utf8');
    for (const specifier of runtimeImports(source, file)) {
      if (specifier.startsWith('node:')) continue;
      const target = specifier.startsWith('~/')
        ? await sourceFile(resolve(sourceRoot, specifier.slice(2)))
        : Bun.resolveSync(specifier.replace(/\?raw$/, ''), dirname(file));
      if (!target) throw new Error(`Unresolved runtime import ${file}: ${specifier}`);
      // Dependencies installed by the host are terminals. All engine/reader
      // package aliases resolve through Bun before this boundary is applied.
      if (target.split(/[\\/]/).includes('node_modules')) continue;
      queue.push(target);
    }
  }
  return seen;
}

test('engine barrel and authoring worker keep the field catalogue behind explicit demand', async () => {
  const barrel = Bun.resolveSync('@fenel/engine', library);
  const catalogue = Bun.resolveSync('@fenel/engine/repository-field-catalog', library);
  const data = Bun.resolveSync('./generated/repository-field-catalog.json', dirname(catalogue));
  const worker = resolve(library, 'expression-runner/authoring-catalog-worker-main.ts');
  const text = await readFile(barrel, 'utf8');
  const exportedCatalogue = 'export * from "./repository-field-catalog";';
  expect(text).not.toContain(exportedCatalogue);
  // Reinstate exactly the retired edge in memory: a scanner that fails to see
  // static re-exports or the current worker→barrel path must fail this control.
  const baseline = new Map([[barrel, `${text}\n${exportedCatalogue}\n`]]);
  for (const entry of [barrel, worker]) {
    const before = await staticRuntimeFiles(entry, baseline);
    expect(before.has(catalogue)).toBe(true);
    expect(before.has(data)).toBe(true);
    const after = await staticRuntimeFiles(entry);
    expect(after.has(catalogue)).toBe(false);
    expect(after.has(data)).toBe(false);
  }
  const reader = resolve(library, 'reader-registry.ts');
  const edges = new Bun.Transpiler({ loader: 'ts' }).scanImports(await readFile(reader, 'utf8'));
  const catalogueEdges = edges.filter(edge => edge.path === '@fenel/engine/repository-field-catalog');
  expect(catalogueEdges.length).toBeGreaterThan(0);
  expect(catalogueEdges.every(edge => edge.kind === 'dynamic-import')).toBe(true);
  expect(Bun.resolveSync(catalogueEdges[0].path, dirname(reader))).toBe(catalogue);
}, 60_000);


test('typed Browse borrows an engine-free reader transport and has no dedicated worker entry', async () => {
  const coreClient = resolve(library, 'home-search/core-value-suggestions-client.ts');
  const files = await staticRuntimeFiles(coreClient);
  expect([...files].filter(file => preparedEnginePath(file))).toEqual([]);
  expect(files.has(resolve(library, 'expression-runner/authoring-catalog-worker.ts'))).toBe(false);
  expect(await readFile(coreClient, 'utf8')).not.toContain('new Worker');
  expect(await sourceFile(resolve(library, 'home-search/core-value-suggestions.worker.ts'))).toBeUndefined();
});
