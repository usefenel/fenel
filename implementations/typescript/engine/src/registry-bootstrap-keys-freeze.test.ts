// perf 2026-11-01 (harness slice 1d): the engine bootstrap factory freezes its
// own ingress function graph with a keys-only walk (`freezeRegistryNode`'s
// `keysOnly`) instead of descriptor reflection. It must leave exactly the state
// the descriptor walk leaves: for every node of the real harness function
// graph, paired by path, the same recorded freeze code (or none) and the same
// frozenness, over the same graph shape (shared nodes included).
//
// The freeze memo is realm-global, so each walk runs in its own FRESH realm
// (a child Bun process): one with the descriptor walk (the oracle), one with
// the keys-only walk (the shipped default). Heavy: two harness builds.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

type RealmStats = { roots: number; nodes: number; keysListed: number; unfrozen: number };

/** Builds the harness in a fresh realm and writes one line per node of its
 * function graph (depth-first in own-key order from each listed function):
 * `path <TAB> id <TAB> kind <TAB> code <TAB> frozen`, or `path <TAB> ->id`
 * for a node reached again. */
function runRealm(mode: "descriptors" | "keys", out: string): RealmStats {
  const code = `
    await import("./index.ts");
    await import("./engine-modules.ts");
    const registry = await import("./registry.ts");
    const dispatch = await import("./engine-bodies-dispatch.ts");
    const seam = registry.__bootstrapFreezeForTests;
    seam.useDescriptorWalk(${JSON.stringify(mode === "descriptors")});
    const before = seam.keysListedNodes();
    const reg = dispatch.__getHarnessForTests().reg;
    const keysListed = seam.keysListedNodes() - before;
    const fns = reg.listFunctions();
    const again = reg.listFunctions();
    if (fns.length !== again.length || fns.some((fn, i) => fn !== again[i])) {
      throw new Error("listFunctions does not hand out the registry's own function objects");
    }
    const ids = new Map();
    const lines = [];
    let unfrozen = 0;
    const stack = [];
    for (let i = fns.length - 1; i >= 0; i -= 1) stack.push(["fn" + i, fns[i]]);
    while (stack.length > 0) {
      const [path, node] = stack.pop();
      const prior = ids.get(node);
      if (prior !== undefined) { lines.push(path + "\\t->" + prior); continue; }
      const id = ids.size;
      ids.set(node, id);
      const kind = node instanceof Uint8Array ? "bytes" : Array.isArray(node) ? "array"
        : Object.getPrototypeOf(node) === null ? "null-record" : "record";
      const frozen = Object.isFrozen(node);
      if (!frozen && kind !== "bytes") unfrozen += 1;
      lines.push(path + "\\t" + id + "\\t" + kind + "\\t" + String(seam.recordedCode(node)) + "\\t" + frozen);
      if (kind === "bytes") continue;
      const keys = Reflect.ownKeys(node);
      for (let k = keys.length - 1; k >= 0; k -= 1) {
        const key = keys[k];
        const descriptor = Object.getOwnPropertyDescriptor(node, key);
        if (!("value" in descriptor)) { lines.push(path + "/" + String(key) + "\\taccessor"); continue; }
        const value = descriptor.value;
        if (value !== null && typeof value === "object") stack.push([id + "/" + String(key), value]);
      }
    }
    (await import("node:fs")).writeFileSync(${JSON.stringify(out)}, lines.join("\\n"));
    console.log(JSON.stringify({ roots: fns.length, nodes: ids.size, keysListed, unfrozen }));
  `;
  const result = Bun.spawnSync(["bun", "-e", code], { cwd: here, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`${mode} realm failed: ${result.stderr.toString()}`);
  return JSON.parse(result.stdout.toString().trim().split("\n").at(-1) ?? "") as RealmStats;
}

describe("bootstrap keys-only freeze", () => {
  test("leaves every node of the harness function graph exactly as the descriptor walk does", () => {
    const dir = mkdtempSync(join(tmpdir(), "fenel-keys-freeze-"));
    try {
      const oracleFile = join(dir, "descriptors.txt");
      const keysFile = join(dir, "keys.txt");
      const oracle = runRealm("descriptors", oracleFile);
      const keys = runRealm("keys", keysFile);
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ oracle, keys }));
      const oracleLines = readFileSync(oracleFile, "utf8").split("\n");
      const keysLines = readFileSync(keysFile, "utf8").split("\n");
      const differences: string[] = [];
      const length = Math.max(oracleLines.length, keysLines.length);
      for (let index = 0; index < length && differences.length < 8; index += 1) {
        if (oracleLines[index] !== keysLines[index]) {
          differences.push(`line ${index}: descriptors ${oracleLines[index]} | keys ${keysLines[index]}`);
        }
      }
      expect(differences).toEqual([]);
      expect(keysLines.length).toBe(oracleLines.length);
      expect(keys.roots).toBe(oracle.roots);
      expect(keys.nodes).toBe(oracle.nodes);
      expect(keys.roots).toBeGreaterThan(7000);
      // The oracle realm never lists by keys; the shipped realm does the bulk
      // of the bootstrap freeze that way, and freezes the whole graph.
      expect(oracle.keysListed).toBe(0);
      expect(keys.keysListed).toBeGreaterThan(keys.nodes / 4);
      expect(keys.unfrozen).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 600_000);
});
