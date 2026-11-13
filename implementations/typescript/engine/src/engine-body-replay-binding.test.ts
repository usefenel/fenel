// S1b fix round — what binds a replay artifact to a realm: the harness
// certificate's sensitivity, the source epoch helper, the pool content digest,
// the process-start epoch binding, and the worker-entry install pattern.
import "./engine-body-host-install";
import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDispatchRegistry } from "./dispatch-registry";
import {
  HARNESS_CERTIFICATE_PARTS,
  harnessCertificateInput,
  harnessCertificateOf,
  harnessCertificatePartDigests,
  poolContentDigest,
  type HarnessCertificateInput,
  type HarnessCertificatePart,
  type HarnessCertificateRow,
} from "./engine-bodies-dispatch";
import { __engineBodyDigestEncodingForTests } from "./engine-body-memo";
import { computeEngineBodyReplaySourceEpoch, ENGINE_BODY_REPLAY_TOOL_FILES } from "../scripts/lib/engine-body-replay-epoch";
import { REPOSITORY_BYTE_UNIVERSE } from "../scripts/lib/artifact-bytes";
import type { FenelFunction, FenelModule } from "./types";

const here = dirname(fileURLToPath(import.meta.url));
const repoTmp = join(here, "..", "..", "..", "..", ".tmp");

function realm(args: string[], env: Record<string, string> = {}): Record<string, unknown> {
  const result = Bun.spawnSync(["bun", "--preload", join(here, "engine-body-host-install.ts"), ...args], {
    cwd: here,
    env: { ...process.env, NODE_ENV: "production", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(`realm failed: ${result.stderr.toString()}`);
  return JSON.parse(result.stdout.toString().trim().split("\n").at(-1) ?? "{}") as Record<string, unknown>;
}

describe("harness certificate sensitivity", () => {
  // Certificate v2 (2026-11-01): each part is its own digest. A change moves
  // exactly its part and the certificate. A definition body is covered by the
  // definitions part only (rows name their body's position instead), so the
  // body variants are compared with a control that copies the same function
  // without changing it: the copy alone changes integrity state.
  test("v2: a definition body (std's and authority:permits'), a requires, a position, a native key, a context native key, compiled metadata and a system entity each move their part", () => {
    const input = harnessCertificateInput();
    expect(Array.isArray(input.rows)).toBe(true);
    const rows = input.rows as readonly HarnessCertificateRow[];
    const base = harnessCertificateOf(input);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(harnessCertificateOf(input)).toBe(base);
    const baseParts = harnessCertificatePartDigests(input) as Record<HarnessCertificatePart, string>;
    expect(Object.keys(baseParts)).toEqual([...HARNESS_CERTIFICATE_PARTS]);
    const definitions = input.definitions;
    // v1 digested the harness modules without `authority`; v2 digests the
    // factory's effective list, authority first.
    expect(definitions[0]!.name).toBe("authority");
    const withFunction = (m: number, f: number, change: (fn: FenelFunction) => FenelFunction): HarnessCertificateInput => {
      const mod = definitions[m]!;
      const changed: FenelModule = { ...mod, functions: mod.functions!.map((fn, k) => (k === f ? change(fn) : fn)) };
      return { ...input, definitions: definitions.map((x, k) => (k === m ? changed : x)) };
    };
    const permitsAt = definitions[0]!.functions!.findIndex((fn) => fn.id === "authority:permits");
    expect(permitsAt).toBeGreaterThanOrEqual(0);
    const std = definitions.findIndex((mod) => mod.name === "std");
    const i = rows.findIndex((r) => r[1].length > 0);
    const [id, params, requires, [m, f]] = rows[i]!;
    const withRow = (row: HarnessCertificateRow): HarnessCertificateInput =>
      ({ ...input, rows: rows.map((r, k) => (k === i ? row : r)) });
    const systemLists = input.systemEntities as readonly (readonly Record<string, unknown>[])[];
    const withSystemEntity = (change: (entity: Record<string, unknown>) => Record<string, unknown>): HarnessCertificateInput =>
      ({ ...input, systemEntities: systemLists.map((list, k) => (k === 0 ? [change(list[0]!), ...list.slice(1)] : list)) });
    const variants: Record<string, readonly [HarnessCertificateInput, HarnessCertificatePart, HarnessCertificateInput?]> = {
      stdBody: [withFunction(std, 0, (fn) => ({ ...fn, body: { s1Changed: fn.body } })), "definitions",
        withFunction(std, 0, (fn) => ({ ...fn }))],
      authorityPermitsBody: [withFunction(0, permitsAt, (fn) => ({ ...fn, body: { s1Changed: fn.body } })), "definitions",
        withFunction(0, permitsAt, (fn) => ({ ...fn }))],
      requires: [withRow([id, params, [...((requires as unknown[] | null) ?? []), "S1Class"], [m, f]]), "rows"],
      position: [withRow([id, params, requires, [m, f + 1]]), "rows"],
      nativeKey: [{ ...input, nativeKeys: [...input.nativeKeys.slice(1), `${input.nativeKeys[0]}S1`] }, "nativeKeys"],
      contextNativeKey: [{ ...input, contextNativeKeys: [...input.contextNativeKeys, "s1:extra"] }, "contextNativeKeys"],
      compiledMetadata: [{ ...input, compiledArtifacts: [...(input.compiledArtifacts as unknown[]), ["S1", "x"]] }, "compiledArtifacts"],
      systemEntityType: [withSystemEntity((entity) => ({ ...entity, type: { $ref: "S1Changed" } })), "systemEntities",
        withSystemEntity((entity) => ({ ...entity }))],
    };
    for (const [name, [variant, part, control]] of Object.entries(variants)) {
      const parts = harnessCertificatePartDigests(variant) as Record<HarnessCertificatePart, string>;
      const moved = HARNESS_CERTIFICATE_PARTS.filter((key) => parts[key] !== baseParts[key]);
      expect({ name, moved, certificateMoved: harnessCertificateOf(variant) !== base })
        .toEqual({ name, moved: [part], certificateMoved: true });
      if (control !== undefined) {
        const controlParts = harnessCertificatePartDigests(control) as Record<HarnessCertificatePart, string>;
        expect({ name, againstUnchangedCopy: parts[part] !== controlParts[part] }).toEqual({ name, againstUnchangedCopy: true });
      }
    }
  }, 300_000);

  // 2026-10-31: the production bundle's minifier renamed 77 of 274 host
  // functions, so every built worker refused the replay. A host function in
  // the definitions counts by presence and slot, never by its `.name`.
  test("renaming a host function does not move the definitions digest; removing or replacing one does", () => {
    const named = (name: string): (() => number) => {
      const fn = () => 1;
      Object.defineProperty(fn, "name", { value: name });
      return fn;
    };
    const digest = (value: unknown) => __engineBodyDigestEncodingForTests(value, "definitions");
    const base = digest({ natives: { strReplaceAll: named("strReplaceAll"), other: named("other") } });
    expect(base).toBeDefined();
    expect(digest({ natives: { strReplaceAll: named("yn"), other: named("Dt") } })).toBe(base);
    expect(digest({ natives: { strReplaceAll: named("strReplaceAll") } })).not.toBe(base);
    expect(digest({ natives: { strReplaceAll: named("strReplaceAll"), other: 1 } })).not.toBe(base);
    expect(digest({ natives: { strReplaceAll: named("strReplaceAll"), renamedKey: named("other") } })).not.toBe(base);
  });
});

describe("source epoch helper", () => {
  test("it moves when a universe file's bytes change, and not otherwise", () => {
    const root = join(repoTmp, `s1-epoch-${process.pid}`);
    try {
      for (const dir of REPOSITORY_BYTE_UNIVERSE.recursiveRoots) mkdirSync(join(root, dir), { recursive: true });
      for (const file of [...REPOSITORY_BYTE_UNIVERSE.exactFiles, ...ENGINE_BODY_REPLAY_TOOL_FILES]) {
        mkdirSync(dirname(join(root, file)), { recursive: true });
        writeFileSync(join(root, file), `exact ${file}\n`);
      }
      writeFileSync(join(root, "fenel", "a.fenel"), "module a where\n");
      writeFileSync(join(root, REPOSITORY_BYTE_UNIVERSE.recursiveRoots[1]!, "x.ts"), "export const x = 1;\n");
      const first = computeEngineBodyReplaySourceEpoch(root);
      expect(computeEngineBodyReplaySourceEpoch(root).digest).toBe(first.digest);
      writeFileSync(join(root, "fenel", "a.fenel"), "module a where\n-- edited\n");
      const edited = computeEngineBodyReplaySourceEpoch(root);
      expect(edited.digest).not.toBe(first.digest);
      // A changed artifact tool (the recorder) moves it too.
      writeFileSync(join(root, ENGINE_BODY_REPLAY_TOOL_FILES[0]!), "// changed recorder\n");
      const toolEdited = computeEngineBodyReplaySourceEpoch(root);
      expect(toolEdited.digest).not.toBe(edited.digest);
      writeFileSync(join(root, ENGINE_BODY_REPLAY_TOOL_FILES[0]!), `exact ${ENGINE_BODY_REPLAY_TOOL_FILES[0]}\n`);
      // An excluded recoverable output does not move it.
      const excluded = REPOSITORY_BYTE_UNIVERSE.exclusions[0]!;
      mkdirSync(dirname(join(root, excluded)), { recursive: true });
      writeFileSync(join(root, excluded), "generated\n");
      expect(computeEngineBodyReplaySourceEpoch(root).digest).toBe(edited.digest);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("pool content digest", () => {
  const pool = (row: Record<string, unknown>) => {
    const p = createDispatchRegistry();
    p.addInstance({ typeName: "S1Probe", args: [], methods: { m: 1 }, ...row } as never);
    return poolContentDigest(p);
  };

  test("priority, scope and method changes each move it; equal content gives equal digests", () => {
    const base = pool({});
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(pool({})).toBe(base);
    expect(pool({ priority: 5 })).not.toBe(base);
    expect(pool({ scope: { kind: "account", accountId: "s1" } })).not.toBe(base);
    expect(pool({ methods: { m: 2 } })).not.toBe(base);
  });

  test("freezing pool objects in place does not move it (registry builds do this without a stamp move)", () => {
    const p = createDispatchRegistry();
    const row = { typeName: "S1Probe", args: [], methods: { m: { label: { en: "x" } } } };
    p.addInstance(row as never);
    const before = poolContentDigest(p);
    for (const listed of p.listInstances()) Object.freeze((listed.methods as { m: { label: object } }).m.label);
    expect(poolContentDigest(p)).toBe(before);
  });

  test("the harness pool digest is equal across two fresh realms", () => {
    const code = `const d = await import(${JSON.stringify(join(here, "engine-bodies-dispatch.ts").replace(/\\/g, "/"))}); console.log(JSON.stringify(d.enginePoolDigestCheck()));`;
    const a = realm(["-e", code]);
    const b = realm(["-e", code]);
    expect(a.fresh).toMatch(/^[0-9a-f]{64}$/);
    expect(a.cached).toBe(a.fresh);
    expect(b).toEqual(a);
  }, 300_000);
});

describe("process-start epoch binding (engine-require)", () => {
  const binding = (env: Record<string, string>) => realm(["-e",
    `const r = await import(${JSON.stringify(join(here, "engine-require.ts").replace(/\\/g, "/"))}); console.log(JSON.stringify(r.engineBodyReplaySourceEpochBinding()));`], env);

  test("no artifact configured: nothing is bound (and nothing is hashed)", () => {
    expect(binding({ FENEL_ENGINE_BODY_REPLAY: "" })).toEqual({ refused: "no artifact configured" });
  }, 120_000);

  test("the epoch is hashed from the tree at process start (production and dev alike)", () => {
    const live = computeEngineBodyReplaySourceEpoch(join(here, "..", "..", "..", "..")).digest;
    // A deployed build stamp is NOT trusted any more: it changes nothing.
    expect(binding({ FENEL_ENGINE_BODY_REPLAY: "x.gz", FENEL_BUILD_STAMP: join(here, "no-such-stamp.json") })).toEqual({ epoch: live });
  }, 600_000);

  test("a source file dated after the process start refuses the binding", () => {
    const file = join(here, "..", "..", "..", "..", "fenel", "README.md");
    const original = statSync(file);
    try {
      const future = new Date(Date.now() + 10 * 60_000);
      utimesSync(file, original.atime, future);
      expect(binding({ FENEL_ENGINE_BODY_REPLAY: "x.gz" })).toEqual({ refused: "a source file was modified after the process started" });
    } finally {
      utimesSync(file, original.atime, original.mtime);
    }
  }, 600_000);

  test("--hot / --watch refuse the binding", () => {
    const fixture = join(here, "engine-require-binding.fixture.ts");
    expect(realm(["--hot", fixture], { FENEL_ENGINE_BODY_REPLAY: "x.gz" })).toEqual({ refused: "the process runs under --hot/--watch" });
    expect(realm(["--watch", fixture], { FENEL_ENGINE_BODY_REPLAY: "x.gz" })).toEqual({ refused: "the process runs under --hot/--watch" });
  }, 120_000);
});

describe("worker-entry install pattern", () => {
  test("install import then a dynamic import of the real entry: the order check passes and proxies are tracked", () => {
    expect(realm([join(here, "proxy-tracking-pattern-entry.fixture.ts")], { FENEL_SIMULATE_BROWSER: "1" }))
      .toEqual({ order: "ok", proxy: "proxy" });
  }, 120_000);

  test("engine code evaluated before the install: the order check fails and the memo refuses", () => {
    const out = realm([join(here, "proxy-tracking-pattern-bad.fixture.ts")], { FENEL_SIMULATE_BROWSER: "1" });
    expect(String(out.order)).toContain("installed after the engine's root module evaluated");
    expect(out.proxy).toBe("no host proxy detector");
  }, 120_000);
});
