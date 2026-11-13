// Harness certificate v2 (engine.memo.engine-body-replay, 2026-11-01): the
// row re-check, the side condition its row encoding rests on, and the
// stability of every part across a whole realm boot. Part sensitivity is in
// engine-body-replay-binding.test.ts, digest-walk equalities and the zero-copy
// counter in engine-body-digest-bytes.test.ts.
//
// Builds the engine harness (and, for the stability test, a Local tab and the
// seed in a fresh realm): run in the shared heavy slot.
import "./engine-body-host-install";
import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  __getHarnessForTests,
  HARNESS_CERTIFICATE_PARTS,
  harnessCertificateInput,
  harnessCertificateOf,
  harnessCertificatePartDigests,
  harnessCertificateRows,
  type HarnessCertificateRow,
} from "./engine-bodies-dispatch";
import { digestEngineBodyDefinitions, digestEngineBodyPool, __engineBodyDigestEncodingForTests } from "./engine-body-memo";
import { cloneRegistryModuleIngress, effectiveRegistryModules } from "./registry";
import type { FenelFunction, FenelModule } from "./types";

const here = dirname(fileURLToPath(import.meta.url));

const fn = (id: string, params: readonly string[], extra: Record<string, unknown> = {}): FenelFunction =>
  ({ id, params: params.map((name) => ({ name, type: { $ref: "Number" } })), returns: { $ref: "Number" }, body: 1, ...extra }) as unknown as FenelFunction;
const mod = (name: string, functions: FenelFunction[]): FenelModule => ({ name, functions }) as FenelModule;

describe("certificate v2 row re-check", () => {
  const definitions = [mod("a", [fn("a:f", ["x"]), fn("a:g", [])]), mod("b", []), { name: "c" } as FenelModule, mod("d", [fn("d:h", ["p", "q"])])];
  const rowsOf = () => [fn("d:h", ["p", "q"], { requires: [{ className: "Eq" }] }), fn("a:g", []), fn("a:f", ["x"])];

  test("the rows are the definitions' functions in position order, each naming its position and not its body", () => {
    expect(harnessCertificateRows(definitions, rowsOf())).toEqual([
      ["a:f", ["x"], null, [0, 0]],
      ["a:g", [], null, [0, 1]],
      ["d:h", ["p", "q"], [{ className: "Eq" }], [3, 0]],
    ]);
  });

  test("an added, a missing, a duplicated or a renamed row, a renamed parameter and a twice-defined id are refused", () => {
    const refusals: Record<string, ReturnType<typeof harnessCertificateRows>> = {
      addedRow: harnessCertificateRows(definitions, [...rowsOf(), fn("x:extra", [])]),
      missingRow: harnessCertificateRows(definitions, rowsOf().slice(1)),
      duplicatedRow: harnessCertificateRows(definitions, [...rowsOf().slice(0, 2), fn("a:g", [])]),
      renamedRow: harnessCertificateRows(definitions, [...rowsOf().slice(0, 2), fn("a:F", ["x"])]),
      renamedParameter: harnessCertificateRows(definitions, [...rowsOf().slice(0, 2), fn("a:f", ["y"])]),
      extraParameter: harnessCertificateRows(definitions, [...rowsOf().slice(0, 2), fn("a:f", ["x", "y"])]),
      twiceDefined: harnessCertificateRows([...definitions, mod("e", [fn("a:f", ["x"])])], rowsOf()),
      accessorFunctions: harnessCertificateRows([Object.defineProperty({ name: "z" }, "functions", { get: () => [], enumerable: true }), ...definitions], rowsOf()),
    };
    for (const [name, answer] of Object.entries(refusals)) {
      expect({ name, refused: !Array.isArray(answer) && typeof (answer as { refused?: unknown }).refused === "string" })
        .toEqual({ name, refused: true });
    }
    // A refused re-check states no certificate at all.
    const input = harnessCertificateInput();
    expect(harnessCertificateOf({ ...input, rows: { refused: "x" } })).toBeUndefined();
  }, 300_000);
});

describe("certificate v2 over the real harness", () => {
  test("the effective list is the factory's (authority first), and every one of its functions has exactly one row", () => {
    const input = harnessCertificateInput();
    const { reg } = __getHarnessForTests();
    expect(input.definitions[0]!.name).toBe("authority");
    expect(effectiveRegistryModules(input.definitions.slice(1) as FenelModule[])).toEqual(input.definitions as FenelModule[]);
    expect(Array.isArray(input.rows)).toBe(true);
    const rows = input.rows as readonly HarnessCertificateRow[];
    const defined = input.definitions.reduce((n, m) => n + (m.functions?.length ?? 0), 0);
    expect(rows.length).toBe(defined);
    expect(reg.listFunctions().length).toBe(defined);
    const authorityRows = rows.filter((row) => row[3][0] === 0);
    expect(authorityRows.length).toBe(input.definitions[0]!.functions!.length);
    expect(authorityRows.some((row) => row[0] === "authority:permits")).toBe(true);
    expect(new Set(rows.map((row) => `${row[3][0]}:${row[3][1]}`)).size).toBe(rows.length);
    expect(HARNESS_CERTIFICATE_PARTS.every((name) => name in input)).toBe(true);
    expect(harnessCertificateOf(input)).toMatch(/^[0-9a-f]{64}$/);
  }, 300_000);

  // A part that cannot be encoded (e.g. a host function or a Map reaching the
  // pool-encoded system entities) states no certificate, which silently turns
  // the replay off: name the part.
  test("every v2 part digest is defined on the real harness, the system-entities part included", () => {
    const parts = harnessCertificatePartDigests(harnessCertificateInput()) as Record<string, string | undefined>;
    expect(Object.keys(parts)).toEqual([...HARNESS_CERTIFICATE_PARTS]);
    for (const name of HARNESS_CERTIFICATE_PARTS) {
      expect({ name, digest: /^[0-9a-f]{64}$/.test(parts[name] ?? "") }).toEqual({ name, digest: true });
    }
  }, 300_000);

  // The side condition the row encoding rests on (not re-checked at run
  // time): the bootstrap's only write to a row is `requires`, so every row is
  // the ingress copy of the definition at its position, frozen in place. A
  // FRESH copier output over the same effective list (one shared copy map, as
  // the factory copies) must therefore equal the rows once `requires` is
  // grafted from the row the way the requires pass writes it (assignment),
  // with integrity state ignored: rows are frozen, a fresh copy is not. The
  // pool encoding is that comparison (enumerability, order and sharing kept;
  // writable, configurable and extensibility dropped).
  test("every row is a fresh ingress copy of its definition, requires aside", () => {
    const input = harnessCertificateInput();
    const rows = input.rows as readonly HarnessCertificateRow[];
    const { reg } = __getHarnessForTests();
    const byId = new Map(reg.listFunctions().map((row) => [row.id, row] as const));
    const copies = new WeakMap<object, unknown>();
    const fresh = input.definitions.map((definition, index) =>
      cloneRegistryModuleIngress(definition as FenelModule, `certificate side condition modules[${index}]`, copies));
    const registryRows: FenelFunction[] = [];
    const freshRows: FenelFunction[] = [];
    for (const [id, , , [m, f]] of rows) {
      const row = byId.get(id)!;
      const copy = fresh[m]!.functions![f]! as FenelFunction & Record<string, unknown>;
      expect(copy.id).toBe(id);
      if (Object.hasOwn(row, "requires")) copy.requires = row.requires;
      registryRows.push(row);
      freshRows.push(copy);
    }
    expect(Object.isFrozen(registryRows[0])).toBe(true);
    expect(Object.isFrozen(freshRows[0])).toBe(false);
    const live = digestEngineBodyPool(registryRows);
    expect(live).toMatch(/^[0-9a-f]{64}$/);
    const copied = digestEngineBodyPool(freshRows);
    if (live !== copied) {
      const first = registryRows.findIndex((row, index) =>
        __engineBodyDigestEncodingForTests(row, "pool") !== __engineBodyDigestEncodingForTests(freshRows[index], "pool"));
      throw new Error(`row ${registryRows[first]?.id} differs from the ingress copy of its definition`);
    }
    expect(copied).toBe(live);
  }, 300_000);
});

// Registry builds freeze shared nodes of the system-entity inputs in place
// (measured: a shared `{ $tag: "Nothing" }` label reached from 66 of 220
// entries, frozen during a seed build). The factory never reads integrity
// state from these inputs (it copies them with the strict copier), so their
// part leaves it out; content still moves it (binding test). Runs last in
// this realm: it freezes the live inputs, as a later build would.
describe("certificate v2 system entities", () => {
  test("freezing the system-entity inputs in place moves neither their part nor the certificate", () => {
    const input = harnessCertificateInput();
    const base = harnessCertificatePartDigests(input) as Record<string, string>;
    const certificate = harnessCertificateOf(input);
    const definitionsEncoding = digestEngineBodyDefinitions(input.systemEntities);
    // Like a later build, freeze only nodes the harness definitions do not
    // also reach (the definitions part keeps integrity state and is pinned
    // stable across a boot by the realm test below).
    const inDefinitions = new WeakSet<object>();
    const mark = (value: unknown): void => {
      if (value === null || typeof value !== "object" || inDefinitions.has(value)) return;
      inDefinitions.add(value);
      if (value instanceof Map) { for (const [k, x] of value) { mark(k); mark(x); } return; }
      if (value instanceof Set) { for (const x of value) mark(x); return; }
      for (const key of Reflect.ownKeys(value)) mark(Object.getOwnPropertyDescriptor(value, key)?.value);
    };
    mark(input.definitions);
    const frozen = new WeakSet<object>();
    let nodes = 0;
    const deepFreeze = (value: unknown): void => {
      if (value === null || typeof value !== "object" || frozen.has(value) || inDefinitions.has(value)) return;
      frozen.add(value);
      if (!Object.isFrozen(value)) nodes += 1;
      for (const key of Reflect.ownKeys(value)) deepFreeze(Object.getOwnPropertyDescriptor(value, key)?.value);
      Object.freeze(value);
    };
    deepFreeze(input.systemEntities);
    expect(nodes).toBeGreaterThan(0);
    // The freeze did change what the integrity-keeping encoding sees.
    expect(digestEngineBodyDefinitions(input.systemEntities)).not.toBe(definitionsEncoding);
    const after = harnessCertificateInput();
    expect(harnessCertificatePartDigests(after) as Record<string, string>).toEqual(base);
    expect(harnessCertificateOf(after)).toBe(certificate);
  }, 300_000);
});

describe("certificate v2 stability across a realm boot", () => {
  // Fresh realm (its own process): parts right after the harness build, then
  // a replay installation, a Local tab build and the seed build, then the
  // parts again. Heavy (a seed build): run alone, in the shared heavy slot.
  test("no part moves between the harness build and the end of a boot with replay, Local and seed builds", () => {
    const result = Bun.spawnSync(["bun", join(here, "engine-body-memo-drift.fixture.ts"), "harness-certificate-stability"], {
      cwd: here,
      env: { ...process.env, NODE_ENV: "production", FENEL_ENGINE_BODY_REPLAY: "" },
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) throw new Error(`realm failed: ${result.stderr.toString().slice(-2000)}`);
    const out = JSON.parse(result.stdout.toString().trim().split("\n").at(-1) ?? "{}") as {
      before: Record<string, string>; after: Record<string, string>; certificate: string;
      install: { accepted: boolean }; local: { calls: number }; seedMs: number; seedCalls: number;
    };
    console.log(`[certificate-stability] seed ${out.seedMs} ms, memo calls ${out.seedCalls}, local calls ${out.local.calls}, install ${JSON.stringify(out.install)}`);
    expect(out.install).toEqual({ accepted: true });
    expect(out.local.calls).toBeGreaterThan(0);
    expect(out.seedCalls).toBeGreaterThan(out.local.calls);
    expect(Object.keys(out.before)).toEqual([...HARNESS_CERTIFICATE_PARTS]);
    for (const name of HARNESS_CERTIFICATE_PARTS) expect(out.before[name]).toMatch(/^[0-9a-f]{64}$/);
    expect(out.after).toEqual(out.before);
    expect(out.certificate).toMatch(/^[0-9a-f]{64}$/);
  }, 1_200_000);
});
