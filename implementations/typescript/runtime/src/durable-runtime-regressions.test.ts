import { describe, expect, it, spyOn } from "bun:test";
import { fileURLToPath } from "node:url";
import { PgDialect } from "drizzle-orm/pg-core";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { functions } from "@fenel/db";
import * as dbModule from "@fenel/db";
import { createRegistry } from "@fenel/engine/registry";
import { dispatchRegistry } from "@fenel/engine/system-entities";
import { stdModule } from "@fenel/engine/modules/std";
import { ioModule } from "@fenel/engine/modules/io";
import { dashboardModule } from "@fenel/engine/modules/dashboard";
import { eventsModule } from "@fenel/engine/modules/events";
import { stateModule } from "@fenel/engine/modules/state";
import { functionDefinitionFromJsonWire, functionDefinitionToJsonWire, typeFromJsonWire, typeToJsonWire } from "@fenel/engine/authoring/expression";
import { CHECKPOINT_VALUE_ENCODING, encodeCheckpointVariables, decodeCheckpointVariables } from "@fenel/engine/checkpoint-json";
import { Just, Nothing, type Maybe } from "@fenel/engine/type-foundation";
import type { Trace, IOHandlerContext, FenelType, FenelFunction } from "@fenel/engine/types";
import {
  executeInstance, resumeWaitingInstance, callUserFunction, loadRegistry,
  reconcileChildWait, registerIOHandlers, turn, type RuntimeDependencies,
} from "./evaluator";
import { runEphemeralFunction } from "./hook-runner";
import { dispatchedSelectWaitingToResume } from "./runtime-bodies-dispatch";
import { registerStateHandlers } from "./handlers/state";
import * as triggers from "./triggers";
import * as runtime from "./evaluator";
import { mintAuthority } from "@fenel/engine/authority";

type Row = Record<string, any>;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
// Registry boot is deliberately memoized in production too. Each fixture
// replaces its leaf handlers; stored rows and traces remain isolated.
const testRegistry = createRegistry([
  stdModule, ioModule,
  { name: "dashboard", label: "Dashboard projections", functions: dashboardModule.functions?.filter((fn) => ["dashboard:defaultToIo", "dashboard:awaitingDisplayValue", "dashboard:awaitingSchema", "dashboard:projectAwaitingRow"].includes(fn.id)) },
  { name: "events", label: "Event ingress", functions: eventsModule.functions?.filter((fn) => fn.id === "events:emitEvent") },
  { name: "state", label: "Event IO leaves", functions: stateModule.functions?.filter((fn) => ["state:appendEvent", "state:dispatchEventTriggers"].includes(fn.id)) },
  {
    name: "audit", label: "Throwing native fixture",
    functions: [
      { id: "audit:pureFail", params: [], returns: { $ref: "Int" } },
      { id: "audit:zero", params: [], returns: { $ref: "Int" }, body: 0 },
      { id: "audit:typeCarrier", params: [], returns: { $type: true } },
      { id: "audit:bytesCarrier", params: [], returns: { $ref: "Bytes" } },
      { id: "audit:dateRow", params: [], returns: { $ref: "Value" } },
      { id: "audit:invalidDate", params: [], returns: { $ref: "Value" } },
      { id: "audit:decoratedDate", params: [], returns: { $ref: "Value" } },
    ],
    nativeImpls: {
      "audit:pureFail": () => { throw new Error("pure native failed"); },
      "audit:typeCarrier": () => ({ $refined: { base: { $ref: "String" }, set: { $pattern: { t: "rep", child: { t: "eps" }, min: 0, max: Infinity } } } }),
      "audit:bytesCarrier": () => new Uint8Array([1, 2]),
      "audit:dateRow": () => ({ id: "row", createdAt: new Date("2026-09-08T12:30:00Z"), children: [{ updatedAt: new Date("2026-09-08T13:45:00Z") }] }),
      "audit:invalidDate": () => new Date(NaN),
      "audit:decoratedDate": () => Object.assign(new Date(0), { toJSON: () => { throw new Error("User toJSON must not execute"); } }),
    },
  },
]);

/** Minimal storage double, interpreting the actual Drizzle predicates. It
 * checks account/status/JSONB CAS predicates, and stores JSON snapshots just
 * like the real persistence boundary. Every bound WHERE placeholder must
 * belong to a modeled equality predicate before any row is considered.
 * Unknown parameterized predicates throw, including on empty tables, so a
 * future production condition cannot silently weaken this fixture's checks.
 * No evaluator decisions are copied. */
function fixture(registry = testRegistry) {
  const instances = new Map<string, Row>();
  const definitions = new Map<string, Row>();
  const traces: Trace[] = [];
  const dialect = new PgDialect();
  const updates: { sql: string; params: unknown[] }[] = [];
  // A PostgreSQL JSONB numeric can retain digits that JSON.parse rounds. Keep
  // its stored text separate when a regression needs that driver boundary.
  const storedVariablesText = new Map<string, string>();
  let sequence = 0;
  let onUpdate: ((change: Row) => void) | undefined;
  const rowsFor = (table: unknown) => table === functions ? definitions : instances;
  const matches = (condition: SQL | undefined): ((row: Row) => boolean) => {
    if (!condition) return () => true;
    const query = dialect.sqlToQuery(condition);
    const columns = [...query.sql.matchAll(/"(?:function_instances|functions)"\."([a-z_]+)" = \$(\d+)/g)];
    const tokens = [...query.sql.matchAll(/"function_instances"\."variables"->>'_suspensionId' = \$(\d+)/g)];
    // Track occurrences, not only parameter numbers: an unknown condition
    // that reuses a modeled placeholder must still be rejected.
    const modeled = new Set([...columns, ...tokens].map((match) => match.index! + match[0].lastIndexOf("$")));
    for (const placeholder of query.sql.matchAll(/\$(\d+)\b/g)) {
      const index = Number(placeholder[1]) - 1;
      if (!modeled.has(placeholder.index!) || index < 0 || index >= query.params.length) {
        throw new Error(`Unsupported storage fixture WHERE parameter ${placeholder[0]}: ${query.sql}`);
      }
    }
    const fieldName = (name: string) => name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    return (row: Row): boolean => {
      for (const match of columns) {
        const field = fieldName(match[1]!);
        const parameter = query.params[Number(match[2]) - 1];
        if (field === "variables") {
          if ((storedVariablesText.get(row.id) ?? JSON.stringify(row[field])) !== (typeof parameter === "string" ? parameter : JSON.stringify(parameter))) return false;
        } else if (row[field] !== parameter) return false;
      }
      for (const match of tokens) {
        if (row.variables?._suspensionId !== query.params[Number(match[1]) - 1]) return false;
      }
      for (const match of query.sql.matchAll(/"(?:function_instances|functions)"\."([a-z_]+)" is null/g)) {
        if (row[fieldName(match[1]!)] != null) return false;
      }
      return true;
    };
  };
  const queryBuilder = (run: () => Row[]) => ({
    limit: async (limit: number) => clone(run().slice(0, limit)),
    returning: async () => clone(run()),
    then: (yes: (rows: Row[]) => unknown, no: (error: unknown) => unknown) => Promise.resolve().then(() => clone(run())).then(yes, no),
  });
  const db = {
    async transaction<T>(operation: (transaction: unknown) => Promise<T>): Promise<T> {
      return operation({ ...db, execute: async () => [] });
    },
    select: () => ({ from: (table: unknown) => ({ where: (condition: SQL) => queryBuilder(() => [...rowsFor(table).values()].filter(matches(condition))) }) }),
    insert: (table: unknown) => ({ values: (input: Row) => ({ returning: async () => {
      const row = clone({ id: `instance-${++sequence}`, parentInstanceId: null, ...input });
      rowsFor(table).set(row.id, row);
      return [clone(row)];
    } }) }),
    update: (table: unknown) => ({ set: (change: Row) => ({ where: (condition: SQL) => queryBuilder(() => {
      updates.push(dialect.sqlToQuery(condition));
      const found = [...rowsFor(table).values()].filter(matches(condition));
      onUpdate?.(change);
      for (const row of found) {
        if (Object.prototype.hasOwnProperty.call(change, "variables")) storedVariablesText.delete(row.id);
        Object.assign(row, clone(change));
      }
      return found;
    }) }) }),
  };
  registerIOHandlers(registry, { getInputRegistry: async () => registry });
  const dependencies: RuntimeDependencies = {
    getDb: () => db as unknown as ReturnType<RuntimeDependencies["getDb"]>,
    loadRegistry: () => registry,
    getInputRegistry: async () => registry,
    insertTraces: async (batch) => { traces.push(...clone(batch)); },
  };
  const define = (name: string, body: unknown) => {
    const row = { id: `fn-${name}`, name, accountId: "account", active: true, sourceRegistryId: null, function: { body } };
    definitions.set(row.id, row);
    return row;
  };
  const start = (name: string, body: unknown, variables: Row = {}) => {
    const fn = define(name, body);
    const row = { id: `instance-${++sequence}`, accountId: "account", profileId: "profile", parentInstanceId: null, functionId: fn.id, status: "running", variables };
    instances.set(row.id, row);
    return row.id;
  };
  const setStoredVariables = (id: string, json: string) => {
    instances.get(id)!.variables = JSON.parse(json);
    storedVariablesText.set(id, json);
  };
  return { instances, definitions, registry, dependencies, define, start, traces, updates, setStoredVariables, observeUpdate: (observer: (change: Row) => void) => { onUpdate = observer; } };
}

const read = (event: string, timeout: Maybe<string> = Nothing) => ({
  call: ["read", { $record: { fields: [] } }, Just(`event:${event}`), Nothing, timeout],
});
/** rights R2a — one permissive authority over the FIXTURE registry, so these
 *  pins keep observing what they were written to observe (durable-loop
 *  mechanics) rather than the authority gate. The gate has its own pins. */
function testAuthority(f: { registry: ReturnType<typeof createRegistry> }) {
  return mintAuthority(f.registry, {
    envelope: f.registry.evaluateAuthorityFunction(
      "authority:descriptorEnvelope",
      [f.registry.listPerformDescriptors()],
    ),
    issuer: "test",
    accountId: "account",
    principal: null,
    lane: null,
    grant: null,
    mintedAt: 0,
  });
}

const authority = { issuer: "event-match" as const, accountId: "account" };

function eventHost(f: ReturnType<typeof fixture>) {
  const productionExecute = runtime.executeInstance;
  const productionResume = runtime.resumeWaitingInstance;
  const db = spyOn(dbModule, "getDb").mockImplementation(f.dependencies.getDb);
  const subscriptions = spyOn(dbModule, "findSubscriptionsByEventType").mockResolvedValue([]);
  const append = spyOn(dbModule, "appendEvent").mockResolvedValue({ id: 1 } as any);
  const execute = spyOn(runtime, "executeInstance").mockImplementation((id, preloaded, auth) => productionExecute(id, preloaded, auth, f.dependencies));
  const resume = spyOn(runtime, "resumeWaitingInstance").mockImplementation((id, event, issuer) => productionResume(id, event, issuer, f.dependencies));
  return {
    subscriptions,
    restore: () => { resume.mockRestore(); execute.mockRestore(); append.mockRestore(); subscriptions.mockRestore(); db.mockRestore(); },
  };
}

/** C1: full product boot publishes process-global metadata. Keep these real
 * body integrations in separate processes so the reduced durable-loop
 * fixtures below retain their own routing and metadata. A true result means
 * the child completed the assertions and the parent has no more work. */
async function runFullRegistryFixtureInChild(testName: string, timeoutMs = 150_000): Promise<boolean> {
  if (process.env["FENEL_DURABLE_PRODUCT_FIXTURE_CHILD"] === testName) return false;
  const child = Bun.spawn([
    process.execPath, "--no-env-file", "test", "--timeout", "180000",
    fileURLToPath(import.meta.url), "--test-name-pattern", testName,
  ], {
    env: { ...process.env, FENEL_DURABLE_PRODUCT_FIXTURE_CHILD: testName },
    stdout: "pipe", stderr: "pipe", timeout: timeoutMs, killSignal: "SIGKILL",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
  expect(code).toBe(0);
  expect(stdout.split(/\r?\n/)).toContain(`FENEL_DURABLE_PRODUCT_FIXTURE_OK:${testName}`);
  return true;
}

describe("durable runtime audit regressions", () => {
  it("full execute types catalog projects real labels despite canonical name ambiguity", async () => {
    if (process.env["FENEL_CANONICAL_CATALOG_TEST_CHILD"] !== "1") {
      // C1: the full runtime boot publishes process-global metadata. Reuse
      // the subprocess-probe pattern so this real integration cannot change
      // the reduced registries used by the remaining durable-loop cases.
      const child = Bun.spawn([
        process.execPath, "--no-env-file", "test", "--timeout", "180000",
        fileURLToPath(import.meta.url), "--test-name-pattern",
        "full execute types catalog projects real labels despite canonical name ambiguity",
      ], {
        env: { ...process.env, FENEL_CANONICAL_CATALOG_TEST_CHILD: "1" },
        stdout: "pipe", stderr: "pipe",
      });
      const [code, stdout, stderr] = await Promise.all([
        child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
      ]);
      if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
      expect(code).toBe(0);
      return;
    }
    // C1: reuse the actual runtime and dashboard body with the whole checked
    // product roster. Only storage/registry read leaves return fixture data.
    const registry = loadRegistry();
    const f = fixture(registry);
    const presentations = [
      { name: "CanonicalCatalogFixture", label: { de: "Kontakt", en: "Contact" },
        description: { fr: "Description française", en: "English description" }, expectedLabel: "Contact", expectedDescription: "English description" },
      { name: "CanonicalCatalogEmptyEnglish", label: { de: "Kontakt", en: "" },
        description: { fr: "Description française", en: "" }, expectedLabel: "", expectedDescription: "" },
      { name: "CanonicalCatalogEmptyMap", label: {}, description: {},
        expectedLabel: "[object Object]", expectedDescription: "[object Object]" },
    ];
    const originalPresentations = clone(presentations);
    const dbRows = presentations.map((row, index) => ({ id: `catalog-row-${index}`, accountId: "account", name: row.name,
      type: { $ref: "String" }, extra: { retained: true }, createdAt: "2026-10-01T00:00:00.000Z" }));
    const original = clone(dbRows);
    for (const row of presentations) {
      // Unique public boot-row metadata in this test process: the existing
      // runtime bridge reads global representations through the engine harness.
      // No representation helper or canonical projection is replaced.
      dispatchRegistry.addInstance({ typeName: "Labelable", args: [row.name], methods: { label: row.label }, scope: { kind: "global" } });
      dispatchRegistry.addInstance({ typeName: "Describable", args: [row.name], methods: { description: row.description }, scope: { kind: "global" } });
    }
    try {
      const reads: string[] = [];
      registry.registerIOHandler("state.list_types", async () => {
        reads.push("types"); return { action: "continue", value: dbRows };
      });
      registry.registerIOHandler("dispatch.list_system_entities", async () => {
        reads.push("system"); return { action: "continue", value: [{ id: "CheckQuantityInput", type: { $ref: "Number" } }] };
      });
      registry.registerIOHandler("dispatch.list_module_entities", async () => {
        reads.push("modules"); return { action: "continue", value: [{ id: "LocaleDemoProjection", module: "LocaleDemo", type: { $ref: "String" } }] };
      });
      const actual = registry.getFunction("dashboard.listTypesMerged")!;
      const id = f.start(actual.id, actual.body!, { accountId: "account" });
      const result = await executeInstance(id, undefined, testAuthority(f), f.dependencies) as Row[];
      expect(f.instances.get(id)!.status).toBe("completed");
      expect(reads).toEqual(["types", "system", "modules"]);
      expect(result).toHaveLength(5);
      presentations.forEach((row, index) => {
        expect(result[index]).toEqual({ ...dbRows[index], label: row.expectedLabel, description: row.expectedDescription });
      });
      expect(result[3]).toMatchObject({ name: "CheckQuantityInput", label: "CheckQuantityInput", type: { $ref: "Number" } });
      expect(result[4]).toMatchObject({ id: "LocaleDemo.LocaleDemoProjection", name: "LocaleDemoProjection", label: "LocaleDemoProjection" });
      expect(decodeCheckpointVariables(f.instances.get(id)!.variables, f.instances.get(id)!.variablesEncoding)._lastResult)
        .toEqual(result);
      expect(dbRows).toEqual(original);
      expect(presentations).toEqual(originalPresentations);
    } finally {
      runtime.resetRegistryCache();
    }
  }, 180_000);

  it("dashboard native metadata stays native through the real helper and persisted result path", async () => {
    const testName = "dashboard native metadata stays native through the real helper and persisted result path";
    if (await runFullRegistryFixtureInChild(testName)) return;
    const registry = loadRegistry();
    const unbounded: FenelType = { $refined: { base: { $ref: "String" }, set: { $tag: "SePattern", pattern: { t: "rep", child: { t: "eps" }, min: 0, max: Infinity } } } };
    // This is the same JSON-column decode performed by the actual DB getters.
    const decodedType = typeFromJsonWire(clone(typeToJsonWire(unbounded)));
    const functionSpec: FenelFunction = { id: "account:unbounded", params: [], returns: unbounded, body: "" };
    const decodedFunction = functionDefinitionFromJsonWire(clone(functionDefinitionToJsonWire(functionSpec)));
    expect(decodedType).toEqual(unbounded);
    expect(decodedFunction.returns).toEqual(unbounded);
    const typeRows = [{ id: "type-row", accountId: "account", name: "UnboundedText", type: decodedType, createdAt: new Date("2026-09-08T12:00:00Z") }];
    const functionRows = [{ id: "function-row", accountId: "account", name: "account:unbounded", function: decodedFunction, active: true }];
    registry.registerIOHandler("state.list_types", async () => ({ action: "continue", value: typeRows }));
    registry.registerIOHandler("state.list_functions", async () => ({ action: "continue", value: functionRows }));
    registry.registerIOHandler("dispatch.list_system_entities", async () => ({ action: "continue", value: [] }));
    registry.registerIOHandler("dispatch.list_module_entities", async () => ({ action: "continue", value: [] }));
    registry.registerIOHandler("dispatch.list_module_functions", async () => ({ action: "continue", value: [] }));
    for (const name of ["dashboard:listTypesMerged", "dashboard:listFunctionsMerged"]) {
      const f = fixture(registry);
      const actual = dashboardModule.functions?.find((fn) => fn.id === name);
      if (!actual || actual.body === undefined) throw new Error(`Missing real dashboard body ${name}`);
      const id = f.start(name, actual.body, { accountId: "account" });
      const result = await executeInstance(id, undefined, testAuthority(f), f.dependencies) as Row[];
      const stored = f.instances.get(id)!;
      expect(stored.status).toBe("completed");
      expect(stored.variablesEncoding).toBe(CHECKPOINT_VALUE_ENCODING);
      const persisted = decodeCheckpointVariables(stored.variables, stored.variablesEncoding)._lastResult as Row[];
      if (name === "dashboard:listTypesMerged") {
        expect(result[0]!.type).toEqual(unbounded);
        expect(persisted).toEqual([{ ...typeRows[0], createdAt: "2026-09-08T12:00:00.000Z", label: "UnboundedText", description: null }]);
      } else {
        expect(result).toEqual(functionRows);
        expect(persisted).toEqual(functionRows);
      }
    }
    process.stdout.write(`FENEL_DURABLE_PRODUCT_FIXTURE_OK:${testName}\n`);
  }, 180_000);

  it("indexed dashboard merges preserve source precedence, duplicate rows, and prototype-shaped names", async () => {
    const testName = "indexed dashboard merges preserve source precedence, duplicate rows, and prototype-shaped names";
    if (await runFullRegistryFixtureInChild(testName)) return;
    const registry = loadRegistry();
    const fn = (id: string) => ({ id, params: [], returns: { $ref: "String" }, body: "value" });
    const dbFunctions = [
      { id: "db-1", name: "stored-first", function: fn("shared") },
      { id: "db-2", name: "stored-second", function: fn("shared") },
      { id: "db-3", name: "stored-prototype", function: fn("__proto__") },
    ];
    registry.registerIOHandler("state.list_functions", async () => ({ action: "continue", value: dbFunctions }));
    registry.registerIOHandler("dispatch.list_module_functions", async () => ({ action: "continue", value: ["shared", "new", "new", "__proto__", "constructor"].map(fn) }));
    const dbTypes = ["shared", "shared", "__proto__"].map((name, index) => ({ id: `db-type-${index}`, name, type: { $ref: "String" } }));
    const entities = (ids: string[]) => ids.map((id) => ({ id, type: { $ref: "String" }, module: "audit" }));
    registry.registerIOHandler("state.list_types", async () => ({ action: "continue", value: dbTypes }));
    registry.registerIOHandler("dispatch.list_system_entities", async () => ({ action: "continue", value: entities(["shared", "system-only", "system-only", "__proto__"]) }));
    registry.registerIOHandler("dispatch.list_module_entities", async () => ({ action: "continue", value: entities(["shared", "system-only", "module-only", "module-only", "constructor"]) }));
    for (const [name, expected] of [
      ["dashboard:listFunctionsMerged", ["stored-first", "stored-second", "stored-prototype", "new", "new", "constructor"]],
      ["dashboard:listTypesMerged", ["shared", "shared", "__proto__", "system-only", "system-only", "module-only", "module-only", "constructor"]],
    ] as const) {
      const f = fixture(registry);
      const actual = dashboardModule.functions!.find((candidate) => candidate.id === name)!;
      const id = f.start(name, actual.body!, { accountId: "account" });
      const result = await executeInstance(id, undefined, testAuthority(f), f.dependencies) as Row[];
      expect(result.map((row) => row.name)).toEqual([...expected]);
      expect(result.slice(0, 3).map((row) => row.id)).toEqual((name.endsWith("FunctionsMerged") ? dbFunctions : dbTypes).map((row) => row.id));
    }
    process.stdout.write(`FENEL_DURABLE_PRODUCT_FIXTURE_OK:${testName}\n`);
  }, 180_000);

  it("SQL Date DTO results keep canonical ISO timestamps and never invoke arbitrary toJSON", async () => {
    const f = fixture();
    const id = f.start("date-row", { call: ["audit:dateRow"] });
    await executeInstance(id, undefined, testAuthority(f), f.dependencies);
    expect(f.instances.get(id)?.variables._lastResult).toEqual({ id: "row", createdAt: "2026-09-08T12:30:00.000Z", children: [{ updatedAt: "2026-09-08T13:45:00.000Z" }] });
    for (const action of ["audit:invalidDate", "audit:decoratedDate"]) {
      const invalid = f.start(action, { call: [action] });
      await expect(executeInstance(invalid, undefined, testAuthority(f), f.dependencies)).rejects.toThrow("Durable checkpoint cannot store this value");
      expect(f.instances.get(invalid)?.variables._error).not.toContain("User toJSON must not execute");
      expect(f.instances.get(invalid)?.status).toBe("failed");
    }
  });

  it("native Type/Bytes results and resumed values survive durable checkpoints", async () => {
    for (const action of ["audit:typeCarrier", "audit:bytesCarrier"]) {
      const f = fixture();
      const id = f.start(action, { call: [action] }, { original: "retained" });
      const result = await executeInstance(id, undefined, testAuthority(f), f.dependencies);
      const stored = f.instances.get(id)!;
      expect(stored.status).toBe("completed");
      expect(decodeCheckpointVariables(stored.variables, stored.variablesEncoding)._lastResult).toEqual(result);
      const paused = f.start(`${action}-paused`, { do: [{ let: { saved: { call: [action] } } }, read("next"), { var: "saved" }] });
      await executeInstance(paused, undefined, testAuthority(f), f.dependencies);
      expect(f.instances.get(paused)?.status).toBe("waiting_event");
      expect(await resumeWaitingInstance(paused, { accepted: true }, { ...authority, authority: testAuthority(f), authority: testAuthority(f) }, f.dependencies)).toEqual({ resumed: true });
      const completed = f.instances.get(paused)!;
      expect(decodeCheckpointVariables(completed.variables, completed.variablesEncoding)._lastResult).toEqual(result);
    }
  });

  it("native initial parameters and marker-shaped values survive calls and ephemeral hooks", async () => {
    const f = fixture();
    f.define("echo-native", { var: "value" });
    const value = { number: Infinity, bytes: new Uint8Array([3, 4]), literal: { $fenelCheckpoint: ["number", "+infinity"] } };
    expect(await callUserFunction("echo-native", { value }, { accountId: "account", profileId: "profile", authority: testAuthority(f) }, f.dependencies)).toEqual({ action: "continue", value });
    expect(await runEphemeralFunction("account", "echo-native", { value }, testAuthority(f), f.dependencies)).toEqual(value);
    const id = f.start("resume-bytes", { do: [read("ready"), { var: "_lastResult" }] });
    await executeInstance(id, undefined, testAuthority(f), f.dependencies);
    expect(await resumeWaitingInstance(id, { value }, { ...authority, authority: testAuthority(f), authority: testAuthority(f) }, f.dependencies)).toEqual({ resumed: true });
    const row = f.instances.get(id)!;
    expect(decodeCheckpointVariables(row.variables, row.variablesEncoding)._lastResult).toEqual({ value });
  });

  it("fresh starts ignore supplied continuations while retaining ordinary input data", async () => {
    const f = fixture();
    const input = {
      _evalStack: [{ exprs: [739], index: 0 }], _letTarget: "injected",
      _retryRequest: { action: "audit.never", params: {} },
      _suspendMeta: { $tag: "WaitTimer", wakeAt: "2000-01-01T00:00:00Z" },
      _suspensionId: "caller-token", _timeoutAt: "2000-01-01T00:00:00Z",
      _evalEnv: { suspensionId: "caller-token", variables: { injected: true } },
      _ordinary: "retained", nested: { _evalStack: "ordinary nested data" },
    };
    const id = f.start("fresh-selected-body", 17, encodeCheckpointVariables(input));
    f.instances.get(id)!.variablesEncoding = CHECKPOINT_VALUE_ENCODING;
    expect(await executeInstance(id, undefined, testAuthority(f), f.dependencies)).toBe(17);
    const row = f.instances.get(id)!;
    expect(row.status).toBe("completed");
    expect(decodeCheckpointVariables(row.variables, row.variablesEncoding)).toMatchObject({ ...input, _lastResult: 17 });
  });

  it("manual and subscribed starts execute their selected body despite checkpoint-shaped payloads", async () => {
    const f = fixture();
    const manual = f.define("manual-selected", 17);
    const subscriber = f.define("event-selected", 23);
    const payload = {
      _evalStack: [{ exprs: [739], index: 0 }], _letTarget: "injected",
      _retryRequest: { action: "audit.never", params: {} },
      _suspendMeta: { $tag: "WaitTimer", wakeAt: "2000-01-01T00:00:00Z" },
      _suspensionId: "caller-token", _timeoutAt: "2000-01-01T00:00:00Z",
      _evalEnv: { suspensionId: "caller-token", variables: { injected: true } },
      nested: { _evalStack: "ordinary nested data" },
    };
    const host = eventHost(f);
    const mint = spyOn(runtime, "mintLaneAuthorityFor").mockResolvedValue(testAuthority(f));
    try {
      const manualId = await triggers.startFunctionInstanceByName("account", manual.name, "profile", "manual", payload, testAuthority(f));
      const manualRow = f.instances.get(manualId)!;
      expect(manualRow).toMatchObject({ status: "completed", functionId: manual.id, variables: { _lastResult: 17, event: payload, form: payload } });
      host.subscriptions.mockResolvedValue([{
        handlerFunctionId: subscriber.id, metadata: JSON.stringify({ trigger: { type: "approved" } }),
      }] as any);
      await triggers.processEvent("account", "approved", payload, "profile");
      const eventRow = [...f.instances.values()].find((row) => row.functionId === subscriber.id)!;
      expect(eventRow).toMatchObject({ status: "completed", variables: { _lastResult: 23, event: payload, form: payload } });
    } finally {
      mint.mockRestore(); host.restore();
    }
  });

  it("child arguments named checkpoint controls survive fresh execution and genuine resume", async () => {
    const f = fixture();
    const keys = ["_evalStack", "_letTarget", "_retryRequest", "_suspendMeta", "_suspensionId", "_timeoutAt", "_evalEnv", "_ordinary"];
    for (const [index, name] of keys.entries()) {
      const value = name === "_evalStack" ? [{ exprs: [739], index: 0 }]
        : name === "_retryRequest" ? { action: "audit.never", params: {} }
        : { retained: name };
      f.define(`echo-control-${index}`, { do: [read("ready"), { var: name }] });
      expect(await callUserFunction(`echo-control-${index}`, { [name]: value }, {
        accountId: "account", profileId: "profile", authority: testAuthority(f),
      }, f.dependencies)).toMatchObject({ action: "suspend" });
      const child = [...f.instances.values()].at(-1)!;
      expect(child.status).toBe("waiting_event");
      expect(child.variables._evalEnv.suspensionId).toBe(child.variables._suspensionId);
      expect(child.variables._evalEnv.variables[name]).toEqual(value);
      expect(child.variables._retryRequest).toBeUndefined();
      expect(await resumeWaitingInstance(child.id, {}, { ...authority, authority: testAuthority(f) }, f.dependencies)).toEqual({ resumed: true });
      expect(decodeCheckpointVariables(child.variables, child.variablesEncoding)._lastResult).toEqual(value);
    }
  });

  it("legacy waits do not trust input named evalEnv, even when its shape resembles a snapshot", async () => {
    const f = fixture();
    for (const savedToken of [undefined, "runtime-token"]) {
      const value = { suspensionId: "caller-token", variables: { answer: 739 } };
      const id = f.start("legacy-env", 0);
      Object.assign(f.instances.get(id)!, {
        status: "waiting_event", variablesEncoding: CHECKPOINT_VALUE_ENCODING,
        variables: encodeCheckpointVariables({
          _evalStack: [{ exprs: [read("legacy"), { var: "answer" }], index: 0 }],
          _suspensionId: savedToken, _evalEnv: value, answer: 17,
        }),
      });
      expect(await resumeWaitingInstance(id, {}, { ...authority, authority: testAuthority(f) }, f.dependencies)).toEqual({ resumed: true });
      const row = f.instances.get(id)!;
      expect(decodeCheckpointVariables(row.variables, row.variablesEncoding)).toMatchObject({ _lastResult: 17, _evalEnv: value });
    }
  });

  it("repeated waits replace control metadata while retaining colliding input in their environment", async () => {
    const f = fixture();
    const input = {
      _evalStack: [{ exprs: [739], index: 0 }], _letTarget: "injected",
      _retryRequest: { action: "audit.never", params: {} },
      _suspendMeta: { $tag: "WaitTimer", wakeAt: "2000-01-01T00:00:00Z" },
      _suspensionId: "caller-token", _timeoutAt: "2000-01-01T00:00:00Z",
      _evalEnv: { suspensionId: "caller-token", variables: { injected: true } },
    };
    const id = f.start("colliding-two-waits", { do: [
      { let: { first: read("first") } }, { let: { second: read("second") } }, { var: "_evalEnv" },
    ] }, input);
    await executeInstance(id, undefined, testAuthority(f), f.dependencies);
    const first = clone(f.instances.get(id)!.variables);
    expect(first._suspensionId).not.toBe(input._suspensionId);
    expect(first._letTarget).toBe("first");
    expect(first._retryRequest).toBeUndefined();
    expect(first._timeoutAt).toBeUndefined();
    expect(first._suspendMeta.event).toBe("first");
    expect(await resumeWaitingInstance(id, { answer: 1 }, { ...authority, authority: testAuthority(f), expectedVariables: first }, f.dependencies)).toEqual({ resumed: true });
    const second = clone(f.instances.get(id)!.variables);
    expect(second._suspensionId).not.toBe(first._suspensionId);
    expect(second._evalEnv.suspensionId).toBe(second._suspensionId);
    expect(second._evalEnv.variables).toMatchObject({ ...input, first: { answer: 1 } });
    expect(second._letTarget).toBe("second");
    expect(second._retryRequest).toBeUndefined();
    expect(second._timeoutAt).toBeUndefined();
    expect(second._suspendMeta.event).toBe("second");
    expect(await resumeWaitingInstance(id, { answer: 2 }, { ...authority, authority: testAuthority(f), expectedVariables: second }, f.dependencies)).toEqual({ resumed: true });
    const completed = f.instances.get(id)!;
    expect(completed.status).toBe("completed");
    expect(decodeCheckpointVariables(completed.variables, completed.variablesEncoding)).toMatchObject({
      ...input, first: { answer: 1 }, second: { answer: 2 }, _lastResult: input._evalEnv,
    });
  });

  it("native literal data in saved expression frames is restored without shape reinterpretation", async () => {
    const f = fixture();
    const literal = { $fenelCheckpoint: ["number", "+infinity"], native: Infinity };
    const id = f.start("saved-frame", 0);
    Object.assign(f.instances.get(id)!, { status: "waiting_event", variablesEncoding: CHECKPOINT_VALUE_ENCODING, variables: encodeCheckpointVariables({ _evalStack: [{ exprs: [read("legacy"), { var: ["missing", literal] }], index: 0 }] }) });
    expect(await resumeWaitingInstance(id, {}, { ...authority, authority: testAuthority(f) }, f.dependencies)).toEqual({ resumed: true });
    const row = f.instances.get(id)!;
    expect(decodeCheckpointVariables(row.variables, row.variablesEncoding)._lastResult).toEqual(literal);
  });

  it("new call entry uses the atomic active gate while pinned source children keep historical owners", async () => {
    const f = fixture();
    f.define("ordinary", 4);
    f.dependencies.createActiveFunctionInstance = async () => { throw new Error("Function is unavailable for a new run"); };
    await expect(callUserFunction("ordinary", {}, { accountId: "account", profileId: "profile", authority: testAuthority(f) }, f.dependencies)).rejects.toThrow("unavailable for a new run");
    expect(f.instances.size).toBe(0);
    const source = f.define("Pinned:run", 99);
    Object.assign(source, { active: false, sourceRegistryId: "pinned-v1" });
    f.dependencies.resolveSourceFunction = async () => ({ id: "Pinned:run", params: [], returns: { $ref: "Number" }, body: 8 });
    const result = await callUserFunction("Pinned:run", {}, { accountId: "account", profileId: "profile", authority: testAuthority(f), sourceFunctionOwners: new Map([["Pinned:run", "pinned-v1"]]) }, f.dependencies);
    expect(result).toEqual({ action: "continue", value: 8 });
  });

  it("source entries execute authoritative version bodies and preserve that version on resume", async () => {
    const f = fixture();
    const id = f.start("SourceLive:run", { var: "poisonedCachedBody" });
    f.definitions.get("fn-SourceLive:run")!.sourceRegistryId = "source-v1";
    const selected: unknown[][] = [];
    f.dependencies.loadAccountRegistry = async (...args) => { selected.push(args); return f.registry; };
    f.dependencies.resolveSourceFunction = async (accountId, registryId, functionId) => {
      expect([accountId, registryId, functionId]).toEqual(["account", "source-v1", "SourceLive:run"]);
      return { id: functionId, params: [], returns: { $ref: "Value" }, body: { do: [read("ok"), 47] } };
    };
    await executeInstance(id, undefined, testAuthority(f), f.dependencies);
    expect(f.instances.get(id)?.status).toBe("waiting_event");
    f.definitions.get("fn-SourceLive:run")!.active = false;
    expect(await resumeWaitingInstance(id, { answer: 1 }, { ...authority, authority: testAuthority(f), authority: testAuthority(f) }, f.dependencies)).toEqual({ resumed: true });
    expect(f.instances.get(id)?.variables._lastResult).toBe(47);
    expect(selected).toEqual([["account", "source-v1"], ["account", "source-v1"]]);
  }, 120_000);

  it("source provenance fails closed before cached code or a saved continuation runs", async () => {
    const f = fixture();
    const id = f.start("SourceLive:run", 99);
    const physical = f.definitions.get("fn-SourceLive:run")!;
    physical.sourceRegistryId = "foreign-private-version";
    f.dependencies.loadAccountRegistry = async () => { throw new Error("Source version is unavailable in this account"); };
    await expect(executeInstance(id, undefined, testAuthority(f), f.dependencies)).rejects.toThrow("unavailable in this account");
    f.dependencies.loadAccountRegistry = async () => f.registry;
    f.dependencies.resolveSourceFunction = async () => { throw new Error("Source function is not declared by its owning version"); };
    f.instances.get(id)!.variables = { _evalStack: [{ exprs: [91], index: 0 }] };
    await expect(executeInstance(id, undefined, testAuthority(f), f.dependencies)).rejects.toThrow("not declared by its owning version");
    expect(f.instances.get(id)?.variables._lastResult).toBeUndefined();
    physical.accountId = "another-account";
    await expect(executeInstance(id, undefined, testAuthority(f), f.dependencies)).rejects.toThrow("different accounts");
  });

  it("a source native declaration cannot execute a forged cached implementation", async () => {
    const f = fixture();
    const id = f.start("NativeSource:external", 99);
    f.definitions.get("fn-NativeSource:external")!.sourceRegistryId = "source-native";
    f.dependencies.resolveSourceFunction = async () => ({ id: "NativeSource:external", params: [], returns: { $ref: "Number" } });
    await expect(executeInstance(id, undefined, testAuthority(f), f.dependencies)).rejects.toThrow("Source native declaration has no host implementation");
    expect(f.instances.get(id)?.status).toBe("failed");
    expect(f.instances.get(id)?.variables._lastResult).toBeUndefined();
  });

  it("rejects unmodeled SQL parameters before row mismatch or an empty-table shortcut", async () => {
    const f = fixture();
    f.define("fixture-condition", 0);
    const db = f.dependencies.getDb();
    await expect(db.select().from(functions).where(and(
      eq(functions.id, "missing-row"), sql`${functions.name} <> ${"unsupported"}`,
    )).limit(1)).rejects.toThrow("Unsupported storage fixture WHERE parameter $2");
    f.definitions.clear();
    await expect(db.select().from(functions).where(sql`${functions.name} <> ${"unsupported"}`).limit(1))
      .rejects.toThrow("Unsupported storage fixture WHERE parameter $1");
  }, 120_000);

  it("ephemeral hooks without a profile persist null and only return completed values", async () => {
    const f = fixture();
    f.define("hook", 17);
    expect(await runEphemeralFunction("account", "hook", {}, testAuthority(f), f.dependencies)).toBe(17);
    expect([...f.instances.values()][0]?.profileId).toBeNull();
    f.define("waiting-hook", read("ok"));
    await expect(runEphemeralFunction("account", "waiting-hook", {}, testAuthority(f), f.dependencies)).rejects.toThrow("did not complete");
  }, 120_000);

  it("preserves false, zero, empty-string, and null bodies through real execution", async () => {
    const f = fixture();
    for (const [index, body] of [false, 0, "", null].entries()) {
      const id = f.start(`literal-${index}`, body);
      await executeInstance(id, undefined, testAuthority(f), f.dependencies);
      expect(f.instances.get(id)?.status).toBe("completed");
      expect(f.instances.get(id)?.variables._lastResult).toBe(body);
    }
  }, 120_000);

  it("calls a registered falsy body inline without misclassifying it as missing IO", () => {
    const f = fixture();
    const result = turn({ stack: [{ exprs: [{ call: ["audit:zero"] }], index: 0 }], env: {}, letTarget: Nothing }, f.registry, testAuthority(f));
    expect(result.outcome).toBe("done");
    if (result.outcome === "done") expect(result.value).toBe(0);
  }, 120_000);

  it("claims a waiting turn once under simultaneous resumes", async () => {
    const f = fixture();
    let effects = 0;
    f.registry.registerIOHandler("audit.effect", async () => ({ action: "continue", value: ++effects }));
    const id = f.start("claim", { do: [read("approved"), { call: ["audit.effect"] }] });
    await executeInstance(id, undefined, testAuthority(f), f.dependencies);
    const snapshot = clone(f.instances.get(id)!.variables);
    const outcomes = await Promise.all([1, 2].map(() => resumeWaitingInstance(id, {}, { ...authority, authority: testAuthority(f), expectedVariables: snapshot }, f.dependencies)));
    expect(outcomes.filter((outcome) => outcome.resumed)).toHaveLength(1);
    expect(effects).toBe(1);
    expect(f.instances.get(id)?.status).toBe("completed");
    const claims = f.updates.filter((query) => query.sql.includes("->>'_suspensionId'"));
    expect(claims).toHaveLength(2);
    for (const claim of claims) {
      expect(claim.sql).toContain('"account_id" =');
      expect(claim.sql).toContain('"status" =');
      expect(claim.sql).not.toContain('"variables" =');
      expect(claim.params).toContain(snapshot._suspensionId);
    }
  }, 120_000);

  it("claims a token-bearing wait when the JSONB driver rounds a stored numeric value", async () => {
    const f = fixture();
    const id = f.start("numeric-json-roundtrip", { do: [read("approved"), 41] }, { largeValue: 0 });
    await executeInstance(id, undefined, testAuthority(f), f.dependencies);
    const stored = JSON.stringify(f.instances.get(id)!.variables).replace('"largeValue":0', '"largeValue":9007199254740993');
    f.setStoredVariables(id, stored);
    const snapshot = clone(f.instances.get(id)!.variables);
    expect(JSON.stringify(snapshot)).not.toBe(stored);
    expect(await resumeWaitingInstance(id, {}, { ...authority, authority: testAuthority(f), expectedVariables: snapshot }, f.dependencies)).toEqual({ resumed: true });
    expect(f.instances.get(id)).toMatchObject({ status: "completed", variables: { _lastResult: 41 } });
  }, 120_000);

  it("does not let a stale scan wake a later wait of the same status", async () => {
    const f = fixture();
    const id = f.start("two-waits", { do: [read("first"), read("second"), 42] });
    await executeInstance(id, undefined, testAuthority(f), f.dependencies);
    const old = clone(f.instances.get(id)!.variables);
    await resumeWaitingInstance(id, {}, { ...authority, authority: testAuthority(f), expectedVariables: old }, f.dependencies);
    const current = clone(f.instances.get(id)!.variables);
    expect(current._suspensionId).not.toBe(old._suspensionId);
    expect(await resumeWaitingInstance(id, {}, { ...authority, authority: testAuthority(f), expectedVariables: old }, f.dependencies)).toEqual({ resumed: false, reason: "not-resumable" });
    expect(f.instances.get(id)?.variables).toEqual(current);
  }, 120_000);

  it("an event wakes existing waits without satisfying the first wait of a newly triggered run", async () => {
    const f = fixture();
    const existing = f.start("existing-wait", { do: [read("approved"), 11] });
    await executeInstance(existing, undefined, testAuthority(f), f.dependencies);
    const subscribed = f.define("event-subscriber", { do: [read("approved"), 22] });
    const productionExecute = runtime.executeInstance;
    const productionResume = runtime.resumeWaitingInstance;
    const db = spyOn(dbModule, "getDb").mockImplementation(f.dependencies.getDb);
    const subscriptions = spyOn(dbModule, "findSubscriptionsByEventType").mockResolvedValue([{
      handlerFunctionId: subscribed.id, metadata: JSON.stringify({ trigger: { type: "approved" } }),
    }] as any);
    const append = spyOn(dbModule, "appendEvent").mockResolvedValue({ id: 1 } as any);
    const execute = spyOn(runtime, "executeInstance").mockImplementation((id, preloaded, auth) => productionExecute(id, preloaded, auth, f.dependencies));
    const resume = spyOn(runtime, "resumeWaitingInstance").mockImplementation((id, event, issuer) => productionResume(id, event, issuer, f.dependencies));
    try {
      await triggers.processEvent("account", "approved", {}, "profile");
      expect(f.instances.get(existing)).toMatchObject({ status: "completed", variables: { _lastResult: 11 } });
      const created = [...f.instances.values()].find((row) => row.functionId === subscribed.id)!;
      expect(created).toMatchObject({ status: "waiting_event", profileId: "profile" });
      expect(created.variables._suspendMeta.event).toBe("approved");
      expect(append).toHaveBeenCalledTimes(1);
    } finally {
      resume.mockRestore(); execute.mockRestore(); append.mockRestore(); subscriptions.mockRestore(); db.mockRestore();
    }
  }, 120_000);

  it("event-triggered primitive reads fail visibly while record reads return the full envelope", async () => {
    const f = fixture();
    const incompatible = f.define("event-primitive-read", { call: ["read", { $ref: "String" }, Just("event:approved"), Nothing, Nothing] });
    const compatible = f.start("event-record-read", read("approved"));
    await executeInstance(compatible, undefined, testAuthority(f), f.dependencies);
    const host = eventHost(f);
    host.subscriptions.mockResolvedValue([{
      handlerFunctionId: incompatible.id, metadata: JSON.stringify({ trigger: { type: "begin" } }),
    }] as any);
    try {
      await expect(triggers.processEvent("account", "begin", {}, "profile")).rejects.toThrow("event sources return record envelopes");
      const failed = [...f.instances.values()].find((row) => row.functionId === incompatible.id)!;
      expect(failed.status).toBe("failed");
      expect(failed.variables._suspendMeta).toBeUndefined();
      expect(failed.variables._error).toContain("event sources return record envelopes");

      host.subscriptions.mockResolvedValue([]);
      const payload = { answer: "approved", value: { retain: "nested payload" } };
      await triggers.processEvent("account", "approved", payload, "profile");
      expect(f.instances.get(compatible)).toMatchObject({ status: "completed", variables: { _lastResult: { type: "approved", ...payload } } });
    } finally {
      host.restore();
    }
  }, 120_000);

  it("rejects proven primitive event incompatibility and permits undecided schemas", async () => {
    const f = fixture();
    for (const name of ["Number", "Boolean"]) {
      const id = f.start(`event-${name}`, { call: ["read", { $ref: name }, Just("event:approved"), Nothing, Nothing] });
      await expect(executeInstance(id, undefined, testAuthority(f), f.dependencies)).rejects.toThrow("event sources return record envelopes");
      expect(f.instances.get(id)?.status).toBe("failed");
    }
    for (const schema of [{ $union: [{ $ref: "String" }, { $record: { fields: [] } }] }, { $ref: "UnknownEventType" }]) {
      const id = f.start(`event-undecided-${f.instances.size}`, { call: ["read", schema, Just("event:approved"), Nothing, Nothing] });
      await executeInstance(id, undefined, testAuthority(f), f.dependencies);
      expect(f.instances.get(id)?.status).toBe("waiting_event");
    }
  }, 120_000);

  it("reports incompatible event input without logging payloads and preserves the wait for a later valid event", async () => {
    const f = fixture();
    const accepted = { type: "approved", answer: "accepted" };
    const schema = { $refined: { base: { $record: { fields: [] } }, set: { $tag: "SeEnum", values: [accepted] } } };
    const id = f.start("event-validation-diagnostic", { call: ["read", schema, Just("event:approved"), Nothing, Nothing] });
    await executeInstance(id, undefined, testAuthority(f), f.dependencies);
    const token = f.instances.get(id)!.variables._suspensionId;
    const host = eventHost(f);
    const warning = spyOn(console, "warn").mockImplementation(() => {});
    try {
      await triggers.processEvent("account", "approved", { answer: "PRIVATE_REJECTED_PAYLOAD" }, "profile");
      expect(f.instances.get(id)).toMatchObject({ status: "waiting_event", variables: { _suspensionId: token } });
      expect(warning).toHaveBeenCalledTimes(1);
      expect(warning).toHaveBeenCalledWith("[runtime] Event did not match the waiting input type", { accountId: "account", instanceId: id, eventType: "approved" });
      expect(JSON.stringify(warning.mock.calls)).not.toContain("PRIVATE_REJECTED_PAYLOAD");
      await triggers.processEvent("account", "approved", { answer: "accepted" }, "profile");
      expect(f.instances.get(id)).toMatchObject({ status: "completed", variables: { _lastResult: accepted } });
      expect(warning).toHaveBeenCalledTimes(1);
    } finally {
      warning.mockRestore();
      host.restore();
    }
  }, 120_000);

  it("requires the displayed manual prompt nonce and rejects it after the next prompt", async () => {
    const f = fixture();
    const choice = { call: ["read", { $ref: "String" }, Nothing, Just("Answer"), Nothing] };
    const id = f.start("manual-prompts", { do: [choice, choice, 42] });
    await executeInstance(id, undefined, testAuthority(f), f.dependencies);
    const first = f.instances.get(id)!.variables._suspensionId;
    const caller = { issuer: "caller" as const, accountId: "account", authority: testAuthority(f) };
    expect(await resumeWaitingInstance(id, { choice: "missing nonce" }, caller, f.dependencies)).toEqual({ resumed: false, reason: "stale-wait" });
    expect(await resumeWaitingInstance(id, { choice: "first answer" }, { ...caller, expectedSuspensionId: first }, f.dependencies)).toEqual({ resumed: true });
    const next = f.instances.get(id)!.variables._suspensionId;
    expect(next).not.toBe(first);
    expect(await resumeWaitingInstance(id, { choice: "stale answer" }, { ...caller, expectedSuspensionId: first }, f.dependencies)).toEqual({ resumed: false, reason: "stale-wait" });
    expect(f.instances.get(id)?.status).toBe("awaiting_choice");
    expect(f.instances.get(id)?.variables._suspensionId).toBe(next);
    expect(await resumeWaitingInstance(id, { choice: "second answer" }, { ...caller, expectedSuspensionId: next }, f.dependencies)).toEqual({ resumed: true });
    expect(f.instances.get(id)?.variables._lastResult).toBe(42);

    const legacy = f.start("legacy-prompt", choice);
    await executeInstance(legacy, undefined, testAuthority(f), f.dependencies);
    delete f.instances.get(legacy)!.variables._suspensionId;
    expect(await resumeWaitingInstance(legacy, { choice: "legacy answer" }, caller, f.dependencies)).toEqual({ resumed: true });
    expect(f.updates.some((query) => query.sql.includes('"variables" =') && query.params.includes(legacy))).toBe(true);
  }, 120_000);

  it("keeps cancelled instances and foreign accounts unclaimed", async () => {
    const f = fixture();
    const id = f.start("cancelled", read("ok"));
    await executeInstance(id, undefined, testAuthority(f), f.dependencies);
    expect(await resumeWaitingInstance(id, {}, { ...authority, authority: testAuthority(f), accountId: "other" }, f.dependencies)).toEqual({ resumed: false, reason: "not-found" });
    f.instances.get(id)!.status = "cancelled";
    expect(await resumeWaitingInstance(id, {}, { ...authority, authority: testAuthority(f), authority: testAuthority(f) }, f.dependencies)).toEqual({ resumed: false, reason: "not-resumable" });
  }, 120_000);

  it("persists thrown IO failure, original variables, evaluator state, and failed trace", async () => {
    const f = fixture();
    f.registry.registerIOHandler("audit.fail", async () => { throw new Error("provider unavailable"); });
    const id = f.start("failure", { call: ["audit.fail"] }, { retained: 12 });
    await expect(executeInstance(id, undefined, testAuthority(f), f.dependencies)).rejects.toThrow("provider unavailable");
    const row = f.instances.get(id)!;
    expect(row.status).toBe("failed");
    expect(row.variables.retained).toBe(12);
    expect(row.variables._evalStack).toBeDefined();
    expect(row.variables._error).toContain("provider unavailable");
    expect(f.traces.some((trace) => trace.status === "failed" && trace.error.$tag === "Just")).toBe(true);
  }, 120_000);

  it("does not overwrite cancellation that arrives during IO", async () => {
    const f = fixture();
    let id = "";
    f.registry.registerIOHandler("audit.cancel", async () => {
      f.instances.get(id)!.status = "cancelled";
      return { action: "continue", value: true };
    });
    id = f.start("cancel-during-io", { call: ["audit.cancel"] });
    await executeInstance(id, undefined, testAuthority(f), f.dependencies);
    expect(f.instances.get(id)?.status).toBe("cancelled");
  }, 120_000);

  it("persists pure exceptions on initial execution and after IO or a resumed wait", async () => {
    const f = fixture();
    const failure = { call: ["audit:pureFail"] };
    const initial = f.start("pure-failure", failure, { retained: 7 });
    await expect(executeInstance(initial, undefined, testAuthority(f), f.dependencies)).rejects.toThrow("pure native failed");
    expect(f.instances.get(initial)).toMatchObject({ status: "failed", variables: { retained: 7, _error: "Error: pure native failed" } });

    f.registry.registerIOHandler("audit.before-pure-failure", async () => ({ action: "continue", value: 23 }));
    const afterIO = f.start("pure-failure-after-io", { do: [
      { let: { response: { call: ["audit.before-pure-failure"] } } }, failure,
    ] });
    await expect(executeInstance(afterIO, undefined, testAuthority(f), f.dependencies)).rejects.toThrow("pure native failed");
    expect(f.instances.get(afterIO)).toMatchObject({ status: "failed", variables: { response: 23 } });
    expect(f.traces.some((trace) => trace.instanceId === afterIO && trace.status === "completed")).toBe(true);

    const resumed = f.start("pure-failure-after-resume", { do: [
      { let: { answer: read("approved") } }, failure,
    ] });
    await executeInstance(resumed, undefined, testAuthority(f), f.dependencies);
    await expect(resumeWaitingInstance(resumed, { accepted: true }, { ...authority, authority: testAuthority(f), authority: testAuthority(f) }, f.dependencies)).rejects.toThrow("pure native failed");
    expect(f.instances.get(resumed)).toMatchObject({ status: "failed", variables: { answer: { accepted: true } } });
  }, 120_000);

  it("does not start subsequent IO after cancellation during an earlier operation", async () => {
    const f = fixture();
    let id = "";
    let effects = 0;
    f.registry.registerIOHandler("audit.cancel-before-next", async () => {
      f.instances.get(id)!.status = "cancelled";
      return { action: "continue", value: true };
    });
    f.registry.registerIOHandler("audit.effect-after-cancel", async () => ({ action: "continue", value: ++effects }));
    id = f.start("cancel-before-next", { do: [
      { call: ["audit.cancel-before-next"] },
      { call: ["audit.effect-after-cancel"] },
    ] });
    await executeInstance(id, undefined, testAuthority(f), f.dependencies);
    expect(f.instances.get(id)?.status).toBe("cancelled");
    expect(effects).toBe(0);
    expect(f.traces).toHaveLength(1);
    expect(f.traces[0]?.status).toBe("completed");
  }, 120_000);

  it("reports trace persistence failure without falsifying a completed IO result", async () => {
    const f = fixture();
    f.registry.registerIOHandler("audit.trace-failure", async () => ({ action: "continue", value: 12 }));
    const id = f.start("trace-failure", { call: ["audit.trace-failure"] });
    const diagnostic = spyOn(console, "error").mockImplementation(() => {});
    try {
      await executeInstance(id, undefined, testAuthority(f), { ...f.dependencies, insertTraces: async () => { throw new Error("trace store unavailable"); } });
      expect(f.instances.get(id)?.status).toBe("completed");
      expect(f.instances.get(id)?.variables._lastResult).toBe(12);
      expect(diagnostic).toHaveBeenCalled();
    } finally {
      diagnostic.mockRestore();
    }
  }, 120_000);

  it("retries the original rate-limited request and binds its real result", async () => {
    const f = fixture();
    let attempts = 0;
    f.registry.registerIOHandler("audit.limited", async (params) => {
      expect(params.arg0).toBe("payload");
      if (++attempts === 1) return { action: "suspend", status: "waiting_timer", meta: Just({ $tag: "WaitTimer", wakeAt: new Date().toISOString(), retryReason: Just({ $tag: "TelegramRetry", description: "retry" }) }) };
      return { action: "continue", value: { delivered: true } };
    });
    const id = f.start("retry", { do: [{ let: { delivered: { call: ["audit.limited", "payload"] } } }, { var: "delivered" }] });
    await executeInstance(id, undefined, testAuthority(f), f.dependencies);
    expect(f.instances.get(id)?.variables._retryRequest.action).toBe("audit.limited");
    await resumeWaitingInstance(id, { type: "_timer_fired" }, { issuer: "timer-sweep", accountId: "account", authority: testAuthority(f) }, f.dependencies);
    expect(attempts).toBe(2);
    expect(f.instances.get(id)?.variables._lastResult).toEqual({ delivered: true });
    expect(f.instances.get(id)?.variables._retryRequest).toBeUndefined();
  }, 120_000);

  it("persists timer suspension when legacy metadata omits retryReason", async () => {
    const f = fixture();
    let attempts = 0;
    f.registry.registerIOHandler("audit.legacy-timer", async () => {
      attempts++;
      return { action: "suspend", status: "waiting_timer", meta: Just({ $tag: "WaitTimer", wakeAt: new Date().toISOString() } as never) };
    });
    const id = f.start("legacy-timer", { do: [{ call: ["audit.legacy-timer"] }, 31] });
    await executeInstance(id, undefined, testAuthority(f), f.dependencies);
    expect(f.instances.get(id)?.status).toBe("waiting_timer");
    expect(f.instances.get(id)?.variables._retryRequest).toBeUndefined();
    await resumeWaitingInstance(id, {}, { issuer: "timer-sweep", accountId: "account", authority: testAuthority(f) }, f.dependencies);
    expect(attempts).toBe(1);
    expect(f.instances.get(id)).toMatchObject({ status: "completed", variables: { _lastResult: 31 } });
  }, 120_000);

  it("suspends canonical reads with independent schema, filter, and deadline", async () => {
    const f = fixture();
    const id = f.start("read", read("approved", Just("10ms")));
    await executeInstance(id, undefined, testAuthority(f), f.dependencies);
    const row = f.instances.get(id)!;
    expect(row.status).toBe("waiting_event");
    expect(row.variables._suspendMeta.filter).toEqual({ event: "approved" });
    expect(row.variables._suspendMeta.schema.$tag).toBe("Just");
    expect(dispatchedSelectWaitingToResume([row as any], "approved", {}, "profile")).toEqual([id]);
    expect(dispatchedSelectWaitingToResume([row as any], "approved", {}, "other-profile")).toEqual([]);
    expect(Number.isFinite(Date.parse(row.variables._timeoutAt))).toBe(true);
    await resumeWaitingInstance(id, { timeout: true }, { issuer: "timer-sweep", accountId: "account", authority: testAuthority(f) }, f.dependencies);
    expect(row.status).toBe("completed");
    expect(row.variables._lastResult).toEqual({ timeout: true });
    expect(row.variables._timeoutAt).toBeUndefined();
  }, 120_000);

  it("Nothing source opens typed input; invalid event data leaves the wait intact", async () => {
    const f = fixture();
    const id = f.start("choice", { call: ["read", { $record: { fields: [] } }, Nothing, Nothing, Nothing] });
    await executeInstance(id, undefined, testAuthority(f), f.dependencies);
    expect(f.instances.get(id)?.status).toBe("awaiting_choice");
    // String is a real type and a record is not a member of it.
    f.instances.get(id)!.variables._suspendMeta.schema.schema = { $ref: "String" };
    const caller = { issuer: "caller" as const, accountId: "account", authority: testAuthority(f), expectedSuspensionId: f.instances.get(id)!.variables._suspensionId };
    expect(await resumeWaitingInstance(id, { wrong: true }, caller, f.dependencies)).toEqual({ resumed: false, reason: "invalid-input" });
    expect(f.instances.get(id)?.status).toBe("awaiting_choice");
    expect(await resumeWaitingInstance(id, { choice: "typed value" }, caller, f.dependencies)).toEqual({ resumed: true });
    expect(f.instances.get(id)?.variables._lastResult).toBe("typed value");
  }, 120_000);

  it("the real awaiting projection unwraps display Maybe values and preserves type plus nonce", async () => {
    const f = fixture();
    for (const source of [Nothing, Just("event:approved")]) {
      const schema = source.$tag === "Just" ? { $record: { fields: [] } } : { $ref: "String" };
      const id = f.start(`projection-${source.$tag}`, { call: ["read", schema, source, Just("Please answer"), Nothing] });
      await executeInstance(id, undefined, testAuthority(f), f.dependencies);
      const row = f.instances.get(id)!;
      const result = turn({ stack: [{ exprs: [{ call: ["dashboard:projectAwaitingRow", { var: "row" }] }], index: 0 }], env: { row }, letTarget: Nothing }, f.registry, testAuthority(f));
      expect(result.outcome).toBe("done");
      if (result.outcome !== "done") throw new Error("expected pure awaiting projection");
      const output = result.value as Row;
      expect(output.prompt).toBe("Please answer");
      expect(output.source).toBe(source.$tag === "Just" ? source._0 : null);
      expect(output.schema).toEqual(schema);
      expect(output.suspensionId).toBe(row.variables._suspensionId);
    }
    const schema = { $ref: "String" };
    const legacy = { id: "legacy", variables: { _suspendMeta: { $tag: "AwaitingChoice", schema: { prompt: "Old prompt", source: "old-source", schema } } } };
    const projected = turn({ stack: [{ exprs: [{ call: ["dashboard:projectAwaitingRow", { var: "row" }] }], index: 0 }], env: { row: legacy }, letTarget: Nothing }, f.registry, testAuthority(f));
    expect(projected.outcome).toBe("done");
    if (projected.outcome === "done") expect(projected.value).toMatchObject({ prompt: "Old prompt", source: "old-source", schema, suspensionId: null });
  }, 120_000);

  it("propagates child suspension through multiple callers and returns only completion value", async () => {
    const f = fixture();
    f.define("leaf", { do: [read("approved"), 73] });
    f.define("middle", { call: ["leaf"] });
    const parent = f.start("parent", { do: [{ let: { answer: { call: ["middle"] } } }, { var: "answer" }] });
    await executeInstance(parent, undefined, testAuthority(f), f.dependencies);
    const middle = [...f.instances.values()].find((row) => row.parentInstanceId === parent)!;
    const leaf = [...f.instances.values()].find((row) => row.parentInstanceId === middle.id)!;
    expect(f.instances.get(parent)?.variables._suspendMeta).toEqual({ $tag: "WaitChild", instanceId: middle.id });
    expect(await resumeWaitingInstance(parent, {}, { ...authority, authority: testAuthority(f), authority: testAuthority(f) }, f.dependencies)).toEqual({ resumed: false, reason: "not-resumable" });
    await resumeWaitingInstance(leaf.id, {}, { ...authority, authority: testAuthority(f), authority: testAuthority(f) }, f.dependencies);
    expect(f.instances.get(parent)?.status).toBe("completed");
    expect(f.instances.get(parent)?.variables._lastResult).toBe(73);
    expect(middle.status).toBe("completed");
  }, 120_000);

  it("reconciles child cancellation after an interrupted completion callback", async () => {
    const f = fixture();
    f.define("leaf", read("approved"));
    const parent = f.start("parent", { call: ["leaf"] });
    await executeInstance(parent, undefined, testAuthority(f), f.dependencies);
    const child = [...f.instances.values()].find((row) => row.parentInstanceId === parent)!;
    child.status = "cancelled";
    await reconcileChildWait(parent, "account", f.dependencies);
    expect(f.instances.get(parent)?.status).toBe("failed");
    expect(f.instances.get(parent)?.variables._error).toContain("cancelled");
  }, 120_000);

  it("reconciles completion that races ahead of the parent's saved wait", async () => {
    const f = fixture();
    f.define("racing-leaf", read("approved"));
    const parent = f.start("racing-parent", { call: ["racing-leaf"] });
    f.observeUpdate((change) => {
      const meta = change.variables?._suspendMeta;
      if (meta?.$tag === "WaitChild") {
        const child = f.instances.get(meta.instanceId)!;
        child.status = "completed";
        child.variables = { _lastResult: 91 };
      }
    });
    await executeInstance(parent, undefined, testAuthority(f), f.dependencies);
    expect(f.instances.get(parent)?.status).toBe("completed");
    expect(f.instances.get(parent)?.variables._lastResult).toBe(91);
  }, 120_000);

  it("propagates a resumed child's IO failure to its waiting caller", async () => {
    const f = fixture();
    f.registry.registerIOHandler("audit.child-failure", async () => { throw new Error("child provider failed"); });
    f.define("failing-leaf", { do: [read("approved"), { call: ["audit.child-failure"] }] });
    const parent = f.start("failing-parent", { call: ["failing-leaf"] });
    await executeInstance(parent, undefined, testAuthority(f), f.dependencies);
    const child = [...f.instances.values()].find((row) => row.parentInstanceId === parent)!;
    await expect(resumeWaitingInstance(child.id, {}, { ...authority, authority: testAuthority(f), authority: testAuthority(f) }, f.dependencies)).rejects.toThrow("child provider failed");
    expect(child.status).toBe("failed");
    expect(f.instances.get(parent)?.status).toBe("failed");
    expect(f.instances.get(parent)?.variables._error).toContain("child provider failed");
  }, 120_000);

  it("a standalone child call reports suspension instead of continue/null", async () => {
    const f = fixture();
    f.define("leaf", read("approved"));
    const outcome = await callUserFunction("leaf", {}, { accountId: "account", profileId: "", authority: testAuthority(f) }, f.dependencies);
    expect(outcome.action).toBe("suspend");
    expect([...f.instances.values()][0]?.profileId).toBeNull();
  }, 120_000);

  it("emit exercises the existing Fenel event contract with decoded payload", async () => {
    const f = fixture();
    const calls: unknown[] = [];
    const ctx: IOHandlerContext = {
      accountId: "account", profileId: "profile",
      // rights R2a — minted LAZILY. These fixtures register handlers after the
      // context is built, and an envelope is computed from the descriptor list
      // AS IT WAS AT MINT TIME; a handle captured too early correctly refuses a
      // descriptor registered later. Reading it per use is what a real request
      // does anyway — its authority is minted when the request arrives, after
      // the registry is fully built.
      get authority() { return testAuthority(f); },
      callFunction: async (slug, args) => { calls.push([slug, args]); return null; },
      dispatchAction: async () => { throw new Error("unexpected dispatch"); },
    };
    expect(await f.registry.getIOHandler("emit")!({ type: "approved", payload: Just({ ok: true }) }, ctx)).toEqual({ action: "continue", value: true });
    expect(calls).toEqual([["events:emitEvent", { eventType: "approved", payload: { ok: true }, profileId: Just("profile") }]]);
  }, 120_000);

  it("primitive emit executes the real Fenel append-then-dispatch body", async () => {
    const testName = "primitive emit executes the real Fenel append-then-dispatch body";
    if (await runFullRegistryFixtureInChild(testName, 100_000)) return;
    const f = fixture(loadRegistry());
    const order: string[] = [];
    const occurrences: Row[] = [];
    const dispatched: Row[] = [];
    f.registry.registerIOHandler("state.append_event", async (params) => {
      order.push("append"); occurrences.push(params); return { action: "continue", value: null };
    });
    f.registry.registerIOHandler("state.dispatch_event_triggers", async (params) => {
      order.push("dispatch"); dispatched.push(params); return { action: "continue", value: null };
    });
    f.define("events:emitEvent", f.registry.getFunction("events:emitEvent")!.body);
    const id = f.start("emit-production-body", { call: ["emit", "approved", Just({ ok: true })] });
    await executeInstance(id, undefined, testAuthority(f), f.dependencies);
    expect(order).toEqual(["append", "dispatch"]);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]).toMatchObject({ type: "approved", payload: { ok: true }, profileId: Just("profile") });
    expect(dispatched).toEqual([{ eventType: "approved", payload: { ok: true } }]);
    expect(f.instances.get(id)?.variables._lastResult).toBe(true);
    process.stdout.write(`FENEL_DURABLE_PRODUCT_FIXTURE_OK:${testName}\n`);
  }, 120_000);

  it("allows exactly the four public config keys and refuses secrets before any read", async () => {
    const f = fixture();
    const reads: string[] = [];
    registerIOHandlers(f.registry, { readPublicConfig: (key) => { reads.push(key); return `synthetic:${key}`; } });
    const ctx: IOHandlerContext = {
      accountId: "account", profileId: "profile",
      // rights R2a — minted LAZILY. These fixtures register handlers after the
      // context is built, and an envelope is computed from the descriptor list
      // AS IT WAS AT MINT TIME; a handle captured too early correctly refuses a
      // descriptor registered later. Reading it per use is what a real request
      // does anyway — its authority is minted when the request arrives, after
      // the registry is fully built.
      get authority() { return testAuthority(f); },
      callFunction: async () => null, dispatchAction: async () => null,
    };
    for (const key of ["DATABASE_URL", "STRIPE_SECRET_KEY", "AUDIT_NON_SECRET_SENTINEL", "__proto__"]) {
      await expect(f.registry.getIOHandler("io.env_get")!({ key }, ctx)).rejects.toThrow("not public application configuration");
    }
    expect(reads).toEqual([]);
    for (const key of ["WEBHOOK_BASE_URL", "EMAIL_FROM", "PAYMENT_SUCCESS_URL", "PAYMENT_CANCEL_URL"]) {
      expect(await f.registry.getIOHandler("io.env_get")!({ key }, ctx)).toEqual({ action: "continue", value: Just(`synthetic:${key}`) });
    }
    expect(reads).toHaveLength(4);
  }, 120_000);

  it("the trigger dispatch leaf carries the ambient profile", async () => {
    const f = fixture();
    registerStateHandlers(f.registry);
    const dispatchEvent = spyOn(triggers, "processEvent").mockResolvedValue(undefined);
    const ctx: IOHandlerContext = {
      accountId: "account", profileId: "profile",
      // rights R2a — minted LAZILY. These fixtures register handlers after the
      // context is built, and an envelope is computed from the descriptor list
      // AS IT WAS AT MINT TIME; a handle captured too early correctly refuses a
      // descriptor registered later. Reading it per use is what a real request
      // does anyway — its authority is minted when the request arrives, after
      // the registry is fully built.
      get authority() { return testAuthority(f); },
      callFunction: async () => null, dispatchAction: async () => null,
    };
    try {
      await f.registry.getIOHandler("state.dispatch_event_triggers")!({ eventType: "approved", payload: { ok: true } }, ctx);
      expect(dispatchEvent).toHaveBeenCalledWith("account", "approved", { ok: true }, "profile");
    } finally {
      dispatchEvent.mockRestore();
    }
  }, 120_000);

  it("the resume leaf returns the canonical instance envelope consumed by the dashboard", async () => {
    const f = fixture();
    const id = f.start("choice-envelope", { call: ["read", { $ref: "String" }, Nothing, Nothing, Nothing] });
    await executeInstance(id, undefined, testAuthority(f), f.dependencies);
    registerStateHandlers(f.registry);
    const productionResume = runtime.resumeWaitingInstance;
    const resume = spyOn(runtime, "resumeWaitingInstance").mockImplementation((instanceId, event, issuer) => productionResume(instanceId, event, issuer, f.dependencies));
    const db = spyOn(dbModule, "getDb").mockImplementation(f.dependencies.getDb);
    const ctx: IOHandlerContext = {
      accountId: "account", profileId: "profile",
      // rights R2a — minted LAZILY. These fixtures register handlers after the
      // context is built, and an envelope is computed from the descriptor list
      // AS IT WAS AT MINT TIME; a handle captured too early correctly refuses a
      // descriptor registered later. Reading it per use is what a real request
      // does anyway — its authority is minted when the request arrives, after
      // the registry is fully built.
      get authority() { return testAuthority(f); },
      callFunction: async () => null, dispatchAction: async () => null,
    };
    try {
      const result = await f.registry.getIOHandler("state.resume_waiting_instance")!({ instanceId: id, event: { choice: "answer" }, expectedSuspensionId: Just(f.instances.get(id)!.variables._suspensionId) }, ctx);
      expect(result.action).toBe("continue");
      if (result.action !== "continue") throw new Error("expected resume result");
      const value = result.value as { ok: boolean; instance: Maybe<Row> };
      expect(value.ok).toBe(true);
      expect(value.instance.$tag).toBe("Just");
      if (value.instance.$tag === "Just") expect(value.instance._0.variables._lastResult).toBe("answer");

      for (const terminal of ["cancelled", "failed"]) {
        let terminalId = "";
        f.registry.registerIOHandler("audit.terminal-after-choice", async () => {
          const row = f.instances.get(terminalId)!;
          row.status = terminal;
          if (terminal === "failed") row.variables._error = "recorded failure";
          return { action: "continue", value: 99 };
        });
        terminalId = f.start(`${terminal}-choice`, { do: [read("approved"), { call: ["audit.terminal-after-choice"] }] });
        await executeInstance(terminalId, undefined, testAuthority(f), f.dependencies);
        expect(await f.registry.getIOHandler("state.resume_waiting_instance")!({ instanceId: terminalId, event: {}, expectedSuspensionId: Just(f.instances.get(terminalId)!.variables._suspensionId) }, ctx)).toEqual({
          action: "continue", value: { ok: false, error: terminal === "failed" ? "recorded failure" : "instance cancelled" },
        });
      }
    } finally {
      resume.mockRestore();
      db.mockRestore();
    }
  }, 120_000);
});
