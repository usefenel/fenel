import { describe, expect, test } from "bun:test";

// S1b worker-entry pattern (design/tcb-ledger.md engine.memo.engine-body-replay):
// the entry statically imports ONLY the Proxy-tracking install module and loads
// everything else by dynamic import. Built-output order is checked by
// engine-body-replay-plugin.mjs at build time; this file checks the source
// shape and the entry's message hand-over.
const entryUrl = new URL("./authoring-catalog.worker.ts", import.meta.url);
const entrySource = await Bun.file(entryUrl).text();
const mainSource = (await Bun.file(new URL("./authoring-catalog-worker-main.ts", import.meta.url)).text()).replace(/\r\n?/g, "\n");
const INSTALL = "../../../../../../implementations/typescript/engine/src/proxy-tracking-install";

describe("authoring catalogue worker entry", () => {
  test("statically imports only the install module, first; the rest is dynamic", () => {
    const imports = new Bun.Transpiler({ loader: "ts" }).scanImports(entrySource);
    expect(imports.filter(entry => entry.kind === "import-statement").map(entry => entry.path)).toEqual([INSTALL]);
    expect(imports.filter(entry => entry.kind === "dynamic-import").map(entry => entry.path).sort())
      .toEqual(["./authoring-catalog-worker-main", "./engine-body-replay-boot"]);
    const code = entrySource.replace(/\r\n?/g, "\n").replace(/^\/\/.*\n/gm, "");
    expect(code.trimStart().startsWith(`import "${INSTALL}";`)).toBe(true);
  });

  test("the real worker asserts the install order before its own body", () => {
    const assertAt = mainSource.indexOf("\nassertProxyTrackingPrecededEngine();\n");
    expect(assertAt).toBeGreaterThan(0);
    expect(assertAt).toBeLessThan(mainSource.indexOf("const scope ="));
    expect(mainSource.slice(0, assertAt).split("\n").filter(line => line && !line.startsWith("import ") && !line.startsWith("//")
      && !/^\s/.test(line))).toEqual([]);
  });

  test("messages posted while the real worker and the replay boot load are delivered once, in order, after the boot", async () => {
    const delivered: unknown[] = [];
    const listeners = new Set<(event: { data: unknown }) => void>();
    const fakeGlobal = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      addEventListener: (_type: string, listener: (event: { data: unknown }) => void) => { listeners.add(listener); },
      removeEventListener: (_type: string, listener: (event: { data: unknown }) => void) => { listeners.delete(listener); },
    };
    const post = (data: unknown) => {
      const event = { data };
      for (const listener of [...listeners]) listener(event);
      fakeGlobal.onmessage?.(event);
    };
    let finishMain!: () => void, finishBoot!: (status: unknown) => void;
    const main = new Promise<void>(resolve => { finishMain = resolve; });
    const boot = new Promise<unknown>(resolve => { finishBoot = resolve; });
    let bootSawRealWorker: Promise<unknown> | undefined;
    const transpiled = new Bun.Transpiler({ loader: "ts" }).transformSync(entrySource)
      .replace(/^import\s*"[^"]+";?$/m, "")
      .replace(/^export\s*\{\s*\};?$/m, "");
    expect(transpiled).not.toMatch(/^import\s*["{]/m);
    const code = transpiled.replaceAll("globalThis", "fakeGlobal").replace(/\bimport\(/g, "load(");
    const run = new Function("fakeGlobal", "load", `return (async () => { ${code} })();`) as
      (global: typeof fakeGlobal, load: (path: string) => Promise<unknown>) => Promise<void>;
    const done = run(fakeGlobal, async (path) => {
      if (path === "./authoring-catalog-worker-main") {
        await main;
        fakeGlobal.onmessage = (event) => { delivered.push(event.data); };
        return {};
      }
      if (path === "./engine-body-replay-boot") return { bootEngineBodyReplay: (realWorker: Promise<unknown>) => { bootSawRealWorker = realWorker; return boot; } };
      throw new Error(`unexpected import ${path}`);
    });
    post(1);
    post(2);
    finishMain();
    await Bun.sleep(1);
    post(3);
    expect(delivered).toEqual([]);
    expect(bootSawRealWorker).toBeInstanceOf(Promise);
    finishBoot({ accepted: false, refused: "off" });
    await done;
    post(4);
    expect(delivered).toEqual([1, 2, 3, 4]);
    expect(listeners.size).toBe(0);
  });
});
