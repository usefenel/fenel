import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Execute the actual recorder orchestration with held host dependencies. This
// pins publication scope and fail-closed receipts without loading the engine
// graph; the real recorder/replay check separately establishes kernel parity.
const source = readFileSync(new URL("./record-engine-body-replay.ts", import.meta.url), "utf8");
const start = source.indexOf("async function recordCanonicalRepositoryBase(");
const end = source.indexOf("\n/** Observe the actual ordered builds", start);
if (start < 0 || end < 0) throw new Error("canonical Base recorder source boundary moved");
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start, end));
const exportStart = source.indexOf("const baseEntries = entries.filter(");
const exportEnd = source.indexOf("const { bytes, stamp } =", exportStart);
if (exportStart < 0 || exportEnd < 0) throw new Error("canonical Base export guard source boundary moved");
const exportCode = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(exportStart, exportEnd));
const baseFn = "engine:collectFieldIdentitiesBase";
const facetsFn = "engine:projectFieldFacets";
const fixtureId = "bc37bff0-54c7-484b-bf0e-4c0d7e968781";
const canonicalKindRows = [["repository-id", "field"], ["repository-reservation", "reserved"]];

const cliStart = source.indexOf("function parseReplayProfiles(");
const cliEnd = source.indexOf("\nconst repositoryRoot =", cliStart);
const profilesStart = source.indexOf("async function recordReplayProfiles(");
const profilesEnd = source.indexOf("\ntry { await recordReplayProfiles(profiles); }", profilesStart);
if ([cliStart, cliEnd, profilesStart, profilesEnd].some(index => index < 0))
  throw new Error("recorder profile orchestration source boundary moved");
const transpiler = new Bun.Transpiler({ loader: "ts" });
const parseProfiles = new Function(`${transpiler.transformSync(source.slice(cliStart, cliEnd))}\nreturn parseReplayProfiles;`)();
const profileCode = transpiler.transformSync(source.slice(profilesStart, profilesEnd));

function profileHarness(controls = {}) {
  const events = [];
  const metrics = [];
  const modules = new Map(["seed", "execute"].map(role => [role, [{ name: role }]]));
  let currentSystem = controls.warmSystem ? {} : null;
  let clock = 0;
  const stats = { entries: 0, bytes: 0, textChars: 0, keyChars: 0, evictions: 0, byFn: {} };
  const addRow = name => {
    stats.entries += 1;
    stats.bytes += 42;
    stats.textChars += 12;
    stats.keyChars += 9;
    stats.byFn[name] = { calls: 1, computed: 1, hits: 0, stored: 1, artifactHits: 0,
      encodeMs: 3, computeMs: 5, copyMs: 2, artifactMs: 0, leaves: ["fixture:leaf"],
      hostBound: 0, repositoryHits: 0, refused: {}, notStored: {} };
  };
  const manifest = {
    modulesFor(role) {
      events.push(`modules:${role}`);
      if (!modules.has(role)) throw new Error("SYSTEM must not enter the module manifest");
      return modules.get(role);
    },
  };
  const repository = {
    createRepositoryRegistry(actual) {
      const role = actual[0].name;
      expect(actual).toBe(modules.get(role));
      events.push(`registry:${role}`);
      if (controls.roleThrows === role) throw new Error(`failed ${role}`);
      addRow(`registry:${role}`);
      if (controls.warmSystemOnRole === role) currentSystem = {};
    },
  };
  const system = {
    peekSystemRegistry() { events.push("system:peek"); return currentSystem; },
    getSystemRegistry() {
      events.push("system:get");
      if (controls.systemThrows) throw new Error("failed SYSTEM");
      currentSystem = {};
      addRow("registry:system");
      return currentSystem;
    },
  };
  const recordBase = controls.recordBase ?? (async (actual, role) => {
    expect(actual).toBe(modules.get(role));
    events.push(`base:${role}`);
    if (controls.baseThrows === role) throw new Error(`failed ${role} Base`);
    addRow(`base:${role}`);
  });
  const memo = controls.memo ?? { engineBodyMemoStats: () => structuredClone(stats) };
  const projectedModules = [{ name: "projected" }];
  modules.set("projected", projectedModules);
  const projected = {
    projectedWorkspaceModules() { events.push("modules:projected"); return projectedModules; },
  };
  const run = new Function("memo", "manifest", "repository", "system", "projected", "recordCanonicalRepositoryBase", "performance", "log",
    `${profileCode}\nreturn recordReplayProfiles;`)(memo, manifest, repository, system, projected, recordBase,
    { now: () => ++clock }, message => {
      expect(message.startsWith("profile-metrics ")).toBe(true);
      const metric = JSON.parse(message.slice("profile-metrics ".length));
      metrics.push(metric);
      controls.onMetric?.(metric);
    });
  return { run, events, metrics };
}

describe("replay recorder profile selection", () => {
  test("defaults to seed followed by actual SYSTEM and preserves explicit histories", () => {
    expect(parseProfiles([])).toEqual(["projected", "seed", "system"]);
    for (const profiles of [["seed"], ["execute"], ["seed", "system"], ["system", "seed"], ["execute", "system", "seed"],
      ["projected", "seed"], ["seed", "projected", "system"]])
      expect(parseProfiles(profiles)).toEqual(profiles);
  });

  test("rejects unknown names, duplicate profiles and missing canonical Base roles", () => {
    for (const profiles of [["SYSTEM"], ["unknown", "seed"], ["seed", "--system"], ["seed", "seed"],
      ["system", "system", "seed"], ["system"]])
      expect(() => parseProfiles(profiles)).toThrow();
    expect(() => parseProfiles(["system"])).toThrow("requires seed or execute");
    expect(() => parseProfiles(["seed", "mystery"])).toThrow('unknown recording profile "mystery"');
    // Invalid CLI input exits before any source scan or dynamic engine import.
    const validation = source.indexOf("profiles = parseReplayProfiles(process.argv.slice(3))");
    expect(validation).toBeGreaterThan(0);
    expect(validation).toBeLessThan(source.indexOf("const before = computeEngineBodyReplaySourceEpoch("));
    expect(validation).toBeLessThan(source.indexOf("await import(join(src,"));
  });
});

describe("replay recorder actual SYSTEM history and metrics", () => {
  test("uses the actual cold accessor in both histories and retains each role's Base", async () => {
    for (const profiles of [["seed", "system"], ["system", "seed"], ["system", "execute", "seed"], ["projected", "seed", "system"]]) {
      const h = profileHarness();
      await h.run(profiles);
      expect(h.events).toEqual(profiles.flatMap(profile => profile === "system" ? ["system:peek", "system:get"]
        : profile === "projected" ? ["modules:projected", "registry:projected"]
          : [`modules:${profile}`, `registry:${profile}`, `base:${profile}`]));
      expect(h.metrics.map(({ profile, phase, completed }) => [profile, phase, completed])).toEqual(
        profiles.flatMap(profile => profile === "system" || profile === "projected" ? [[profile, "registry", true]]
          : [[profile, "registry", true], [profile, "canonical-base", true]]));
    }
  });

  test("refuses a warm SYSTEM without rebuilding, clearing or pretending it was cold", async () => {
    for (const controls of [{ warmSystem: true }, { warmSystemOnRole: "seed" }]) {
      const h = profileHarness(controls);
      await expect(h.run(["seed", "system"])).rejects.toThrow("SYSTEM was already constructed");
      expect(h.events).not.toContain("system:get");
      expect(h.metrics.at(-1)).toMatchObject({ profile: "system", phase: "registry", completed: false });
      expect(h.metrics.at(-1).before).toEqual(h.metrics.at(-1).after);
    }
  });

  test("reports full observed snapshots without manufacturing absent rows or subtracting counters", async () => {
    const h = profileHarness();
    await h.run(["system", "seed"]);
    const first = h.metrics[0];
    expect(first.before).toEqual({ entries: 0, bytes: 0, textChars: 0, keyChars: 0, evictions: 0, byFn: {} });
    expect(first.after).toMatchObject({ entries: 1, bytes: 42, textChars: 12, keyChars: 9, evictions: 0 });
    expect(first.after.byFn["registry:system"]).toMatchObject({ calls: 1, stored: 1, computed: 1,
      refused: {}, notStored: {}, leaves: ["fixture:leaf"], encodeMs: 3, computeMs: 5, copyMs: 2 });
    expect(first.elapsedMs).toBe(1);
    expect(first.after).toEqual(h.metrics[1].before);
    expect(h.metrics[1].after).toEqual(h.metrics[2].before);
    expect(Object.keys(first.after.byFn)).toEqual(["registry:system"]);
  });

  test("propagates role, SYSTEM and Base failures, reports failure and stops later builds", async () => {
    for (const controls of [{ roleThrows: "seed" }, { systemThrows: true }, { baseThrows: "seed" }]) {
      const h = profileHarness(controls);
      await expect(h.run(["seed", "system", "execute"])).rejects.toThrow("failed");
      expect(h.events).not.toContain("modules:execute");
      expect(h.metrics.at(-1).completed).toBe(false);
    }
  });

  test("actual Base failures report observed snapshots before the original top-level cleanup and exit", async () => {
    const refusalStart = source.indexOf("const refuse = (reason: string)");
    const refusalEnd = source.indexOf("\n\n// 1.", refusalStart);
    const invocationEnd = source.indexOf("\n// 3. Export", profilesEnd);
    if (refusalStart < 0 || refusalEnd < 0 || invocationEnd < 0)
      throw new Error("recorder refusal source boundary moved");
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const invoke = new AsyncFunction("recordReplayProfiles", "profiles", "existsSync", "rmSync", "outPath", "stampPath", "console", "process",
      transpiler.transformSync(source.slice(refusalStart, refusalEnd) + source.slice(profilesEnd, invocationEnd)));
    for (const controls of [{ noStorage: true }, { noRequest: true }]) {
      const base = harness(controls);
      const order = [];
      const h = profileHarness({ recordBase: base.record, memo: base.memo,
        onMetric: metric => order.push({ kind: "metric", metric }) });
      const files = new Set(["fixture.gz", "fixture.gz.stamp.json"]);
      const exit = new Error("held process exit");
      await expect(invoke(h.run, ["seed", "system"], path => files.has(path), path => {
        order.push({ kind: "remove", path }); files.delete(path);
      }, "fixture.gz", "fixture.gz.stamp.json", { error: message => order.push({ kind: "refusal", message }) },
      { exit: code => { order.push({ kind: "exit", code }); throw exit; } })).rejects.toBe(exit);
      expect(order.map(event => event.kind)).toEqual(["metric", "metric", "remove", "remove", "refusal", "exit"]);
      const failed = order[1].metric;
      expect(failed).toMatchObject({ profile: "seed", phase: "canonical-base", completed: false });
      expect(failed.before).toEqual({ byFn: {} });
      if (controls.noRequest) {
        expect(failed.after.byFn[baseFn]).toBeUndefined();
        expect(order[4].message).toContain("seed canonical Base was not recorded through the registry preparation host");
      } else {
        expect(failed.after.byFn[baseFn]).toMatchObject({ calls: 1, computed: 1,
          stored: 0, notStored: { "uncertified leaf": 1 } });
        expect(order[4].message).toContain("seed canonical Base: Base was not retained by the public memo");
      }
      expect(order[4].message).toStartWith("record-engine-body-replay: REFUSED — ");
      expect(order[5].code).toBe(1);
      expect(files.size).toBe(0);
      expect(h.events).not.toContain("system:get");
    }
  });
});

function harness(controls = {}) {
  let partition = null;
  let stats;
  let facetStats;
  const events = [];
  const refusals = [];
  const retainedPartitions = new Set();
  const modules = [{ name: "repository-fixture" }];
  const sharedMarker = Object.freeze(Object.assign(Object.create(null), { key: "raw marker" }));
  const roots = [{ realm: "repository-source", marker: sharedMarker }, { realm: "transient-draft", marker: sharedMarker }];
  const options = { mode: "strict-embedded", lock: new Map([["lock", "repository-id"]]),
    identityKinds: new Map([...canonicalKindRows, [fixtureId, "function"]]),
    baseIdentityKinds: controls.missingKinds ? undefined
      : new Map(controls.collidingKinds ? [[fixtureId, "function"]] : controls.kindRows ?? canonicalKindRows) };
  const repositoryIdentities = { repositoryIdentityKinds: () => new Map(canonicalKindRows) };
  const base = { kernel: {} };
  const collection = { marker: {} };
  const request = { kind: "fieldsDelta", roots, options, baseKey: "real-registry-key", roster: ["real-roster"] };
  const memo = {
    REPOSITORY_PARTITION: "repository",
    engineBodyMemoStats: () => ({ byFn: {
      ...(stats === undefined ? {} : { [baseFn]: structuredClone(stats) }),
      ...(facetStats === undefined ? {} : { [facetsFn]: structuredClone(facetStats) }),
    } }),
    withEngineBodyMemoPartition(value, run, options) {
      const prior = partition;
      partition = value;
      events.push({ kind: "partition-open", partition, options });
      try { return run(); } finally {
        partition = prior;
        if (options?.retain === false) {
          retainedPartitions.delete(value);
          events.push({ kind: "partition-cleanup", partition, cleared: value });
        }
      }
    },
  };
  const fieldIdentity = {
    tryCollectFieldIdentityBase(actualRoots, actualOptions) {
      events.push({ kind: "base", partition, roots: actualRoots, options: actualOptions });
      if (controls.baseThrows) throw controls.baseThrows;
      if (controls.baseRefuses) return { ok: false, reason: "fixture-base-refusal" };
      stats ??= { calls: 0, stored: 0, hits: 0, repositoryHits: 0, artifactHits: 0, computed: 0, refused: {}, notStored: {} };
      if (partition !== "repository") {
        if (controls.cloneBaseThrows) throw controls.cloneBaseThrows;
        if (controls.cloneBaseRefuses) return { ok: false, reason: "fixture-clone-refusal" };
        stats.calls += 1;
        if (controls.cloneMiss) {
          stats.computed += 1;
          stats.stored += 1;
          retainedPartitions.add(partition);
        } else {
          stats.hits += 1;
          stats.repositoryHits += 1;
        }
        for (const [key, value] of Object.entries(controls.cloneStats ?? {})) stats[key] += value;
        if (controls.cloneRefused) stats.refused["host fingerprint differs"] = 1;
        if (controls.cloneNotStored) stats.notStored["storage unavailable"] = 1;
        return { ok: true, base: { cloned: true } };
      }
      stats.calls += 1;
      if (controls.noStorage) stats.notStored["uncertified leaf"] = (stats.notStored["uncertified leaf"] ?? 0) + 1;
      else stats[controls.receipt ?? "stored"] += 1;
      if (controls.receipt === undefined) stats.computed += 1;
      if (controls.failedArtifactStorage) stats.notStored["storage unavailable"] = 1;
      return { ok: true, base };
    },
    collectFieldIdentitiesThroughBase(actualRoots, actualOptions, actualBase) {
      events.push({ kind: "delta", partition, roots: actualRoots, options: actualOptions, base: actualBase });
      return controls.deltaFallback ? { outcome: "DeltaKindsTouchBase" } : { collection, outcome: "delta" };
    },
  };
  const preparation = {
    createRegistryPreparationHost: acquire => ({ acquire }),
    runRegistryPreparation(value) {
      events.push({ kind: value.kind, partition, input: value });
      if (value.kind === "facets" && partition !== null) {
        // The public facets entry was recorded by the repository build; a
        // transported (cloned) request looked up privately hits it.
        facetStats ??= { calls: 0, stored: 0, hits: 0, repositoryHits: 0, artifactHits: 0, computed: 0, refused: {}, notStored: {} };
        facetStats.calls += 1;
        if (controls.facetsMiss) { facetStats.computed += 1; facetStats.stored += 1; }
        else { facetStats.hits += 1; facetStats.repositoryHits += 1; }
        if (controls.facetsRefused) facetStats.refused["host fingerprint differs"] = 1;
      }
      return { marker: value.kind };
    },
  };
  const localFields = {
    async createLocalFieldRegistryAsync(actualModules, sourceId, snapshot, config) {
      events.push({ kind: "build", partition, modules: actualModules, sourceId, snapshot });
      const lease = await config.preparationHost.acquire();
      if (!controls.noRequest) {
        try { events.push({ kind: "answer", answer: await lease.run(request) }); }
        catch (error) {
          // Production scheduling can swallow a failed Delta and still finish
          // the registry correctly through the monolithic field path.
          events.push({ kind: "caught", error });
          await lease.run({ kind: "fields", roots, options });
        }
      }
      if (!controls.noFacets) await lease.run({ kind: "facets", entities: [], identities: [], directives: [] });
      await lease.run({ kind: "constructors", entities: [] });
      lease.release();
      return {};
    },
  };
  const cloneRequest = value => {
    events.push({ kind: "clone", partition, input: value });
    if (controls.cloneThrows) throw controls.cloneThrows;
    return structuredClone(value);
  };
  const refuse = reason => { refusals.push(reason); throw new Error(`REFUSED: ${reason}`); };
  const record = new Function("memo", "fieldIdentity", "preparation", "localFields", "repositoryIdentities", "structuredClone", "refuse", "log",
    `${code}\nreturn recordCanonicalRepositoryBase;`)(memo, fieldIdentity, preparation, localFields, repositoryIdentities, cloneRequest, refuse,
      message => events.push({ kind: "log", message }));
  return { run: async (role = "seed") => {
    try { await record(modules, role); }
    catch (error) { refuse(error instanceof Error ? error.message : String(error)); }
  }, record, memo, events, refusals, roots, options, modules, base, collection, request, retainedPartitions };
}

describe("canonical repository Base recorder host protocol", () => {
  test("records only the Base publicly and passes the real request unchanged to ordinary Delta", async () => {
    const h = harness();
    await h.run();
    const build = h.events.find(event => event.kind === "build");
    expect(build.partition).toBeNull();
    expect(build.modules).toBe(h.modules);
    expect(build.sourceId).toBe("engine-body-replay-public-fixture");
    expect(build.snapshot.fields).toEqual([]);
    expect(build.snapshot.facets).toEqual([]);
    expect(build.snapshot.owners).toHaveLength(1);
    expect(build.snapshot.owners[0].definition).toEqual({ id: fixtureId, params: [], returns: { $ref: "Number" }, body: 0 });
    const base = h.events.find(event => event.kind === "base");
    const delta = h.events.find(event => event.kind === "delta");
    expect(base.partition).toBe("repository");
    expect(delta.partition).toBeNull();
    expect(base.roots).toBe(h.roots);
    expect(delta.roots).toBe(h.roots);
    expect(base.options).toBe(h.options);
    expect(delta.options).toBe(h.options);
    expect(delta.base).toBe(h.base);
    expect(h.events.filter(event => ["constructors"].includes(event.kind)).every(event => event.partition === null)).toBe(true);
    expect(h.events.find(event => event.kind === "answer").answer).toEqual({ collection: h.collection, outcome: "delta", retained: "made" });
    expect(h.refusals).toEqual([]);
  });

  test("accepts exact existing-table and admitted-artifact receipts for every role", async () => {
    for (const receipt of ["hits", "artifactHits"]) {
      const h = harness({ receipt });
      await h.run("seed");
      await h.run("execute");
      expect(h.events.filter(event => event.kind === "base" && event.partition === "repository")).toHaveLength(2);
      expect(h.events.filter(event => event.kind === "base" && event.partition !== "repository")).toHaveLength(2);
      expect(h.refusals).toEqual([]);
    }
  });

  test("refuses a missing canonical universe or one containing the tooling Local identity", async () => {
    for (const control of [{ missingKinds: true }, { collidingKinds: true }]) {
      const h = harness(control);
      await expect(h.run()).rejects.toThrow("repository-only Base identity universe");
      expect(h.events.some(event => event.kind === "base")).toBe(false);
    }
  });

  test("requires every canonical identity row with its exact kind and insertion order", async () => {
    for (const kindRows of [
      [...canonicalKindRows].reverse(),
      [["repository-id", "type"], canonicalKindRows[1]],
      canonicalKindRows.slice(0, 1),
      [...canonicalKindRows, ["other-local-id", "function"]],
      [["other-repository-id", "field"], canonicalKindRows[1]],
    ]) {
      const h = harness({ kindRows });
      await expect(h.run()).rejects.toThrow("repository-only Base identity universe");
      expect(h.events.some(event => event.kind === "base")).toBe(false);
    }
  });

  test("refuses Base errors even when ordinary scheduling completes through fallback", async () => {
    for (const control of [{ baseRefuses: true }, { baseThrows: new Error("native failure") }]) {
      const h = harness(control);
      await expect(h.run()).rejects.toThrow("REFUSED: seed canonical Base:");
      expect(h.events.some(event => event.kind === "caught")).toBe(true);
      expect(h.events.filter(event => ["fields", "constructors"].includes(event.kind)).every(event => event.partition === null)).toBe(true);
    }
  });

  test("successful computation or artifact lookup without public retention is insufficient", async () => {
    for (const control of [{ noStorage: true }, { receipt: "artifactHits", failedArtifactStorage: true }]) {
      const h = harness(control);
      await expect(h.run()).rejects.toThrow("Base was not retained by the public memo");
      expect(h.events.some(event => event.kind === "delta")).toBe(false);
    }
  });

  test("clones the whole raw request outside public scope and requires its private lookup to reuse the public entry", async () => {
    const h = harness();
    await h.run();
    const cloning = h.events.find(event => event.kind === "clone");
    const cloneBase = h.events.find(event => event.kind === "base" && event.partition !== "repository");
    expect(cloning.partition).toBeNull();
    expect(cloning.input).toBe(h.request);
    expect(Object.getPrototypeOf(cloning.input.roots[0].marker)).toBeNull();
    expect(Object.isFrozen(cloning.input.roots[0].marker)).toBe(true);
    expect(cloneBase.partition).toBe("local:engine-body-replay-transport-fixture");
    expect(cloneBase.roots).not.toBe(h.roots);
    expect(cloneBase.options).not.toBe(h.options);
    expect(cloneBase.roots[0].marker).toBe(cloneBase.roots[1].marker);
    expect(Object.getPrototypeOf(cloneBase.roots[0].marker)).toBe(Object.prototype);
    expect(Object.isFrozen(cloneBase.roots[0].marker)).toBe(false);
    expect([...cloneBase.options.baseIdentityKinds]).toEqual([...h.options.baseIdentityKinds]);
    expect(h.events.find(event => event.kind === "partition-open" && event.partition === cloneBase.partition).options).toEqual({ retain: false });
    expect(h.events.find(event => event.kind === "partition-cleanup")).toEqual({
      kind: "partition-cleanup", partition: null, cleared: cloneBase.partition,
    });
    expect(h.events.find(event => event.kind === "delta").base).toBe(h.base);
    expect(h.retainedPartitions.size).toBe(0);
  });

  test("clone failures and refused or thrown cloned Base attempts cannot be hidden by fallback", async () => {
    for (const control of [
      { cloneThrows: new Error("clone failed") },
      { cloneBaseThrows: new Error("clone Base failed") },
      { cloneBaseRefuses: true },
    ]) {
      const h = harness(control);
      await expect(h.run()).rejects.toThrow("REFUSED: seed canonical Base:");
      expect(h.events.some(event => event.kind === "delta")).toBe(false);
      expect(h.events.filter(event => ["fields", "constructors"].includes(event.kind)).every(event => event.partition === null)).toBe(true);
      if (!control.cloneThrows) expect(h.events.some(event => event.kind === "partition-cleanup")).toBe(true);
      expect(h.retainedPartitions.size).toBe(0);
    }
  });

  test("rejects clone-only computation, artifact hits and any extra work or refusal instead of a public-table hit", async () => {
    for (const control of [
      { cloneMiss: true },
      { cloneStats: { hits: -1, repositoryHits: -1, artifactHits: 1 } },
      { cloneStats: { repositoryHits: -1 } },
      { cloneStats: { calls: 1 } },
      { cloneStats: { computed: 1 } },
      { cloneStats: { stored: 1 } },
      { cloneStats: { artifactHits: 1 } },
      { cloneRefused: true },
      { cloneNotStored: true },
    ]) {
      const h = harness(control);
      await expect(h.run()).rejects.toThrow("transported Base did not hit the recorded public entry");
      expect(h.events.some(event => event.kind === "delta")).toBe(false);
      expect(h.events.some(event => event.kind === "partition-cleanup")).toBe(true);
      expect(h.retainedPartitions.size).toBe(0);
    }
  });

  test("checks the transported facets request privately against the public entry, and refuses a miss", async () => {
    const h = harness();
    await h.run();
    const facets = h.events.filter(event => event.kind === "facets");
    expect(facets).toHaveLength(1);
    expect(facets[0].partition).toBe("local:engine-body-replay-facets-transport-fixture");
    expect(h.events.find(event => event.kind === "partition-open" && event.partition === facets[0].partition).options)
      .toEqual({ retain: false });
    expect(h.events.some(event => event.kind === "partition-cleanup" && event.cleared === facets[0].partition)).toBe(true);
    expect(h.events.filter(event => event.kind === "clone").map(event => event.input.kind)).toEqual(["fieldsDelta", "facets"]);
    expect(h.refusals).toEqual([]);
    for (const control of [{ facetsMiss: true }, { facetsRefused: true }]) {
      const miss = harness(control);
      await expect(miss.run()).rejects.toThrow("transported facets did not hit the recorded public entry");
    }
    const none = harness({ noFacets: true });
    await expect(none.run()).rejects.toThrow("transported facets were not checked");
  });

  test("refuses absent registry capture and an unsuccessful ordinary Delta", async () => {
    const absent = harness({ noRequest: true });
    await expect(absent.run()).rejects.toThrow("was not recorded through the registry preparation host");
    const fallback = harness({ deltaFallback: true });
    await expect(fallback.run()).rejects.toThrow("did not collect through Delta: DeltaKindsTouchBase");
  });
});

describe("canonical Base replay portability export gate", () => {
  const check = entries => new Function("entries", "refuse", "log", exportCode)(entries,
    reason => { throw new Error(`REFUSED: ${reason}`); }, () => {});
  const lowerFingerprint = `case:${"a1".repeat(32)}`;

  test("accepts no host dependency and portable lowercase corpus checks", () => {
    for (const entry of [
      { fnId: baseFn },
      { fnId: baseFn, hostChecks: [] },
      { fnId: baseFn, hostChecks: [["std:lower", lowerFingerprint]] },
    ]) expect(() => check([entry])).not.toThrow();
    // Other repository entries retain the existing host-specific replay
    // contract; this stronger cross-host requirement is only for the Base.
    expect(() => check([{ fnId: baseFn }, { fnId: "other:body", hostChecks: [["std:sort", "engine:bun"]] }])).not.toThrow();
  });

  test("rejects nonportable leaves, unknown engines and malformed lowercase fingerprints", () => {
    for (const hostChecks of [
      [["std:sort", "engine:bun"]],
      [["std:sort", lowerFingerprint]],
      [["std:lower", "engine:bun"]],
      [["std:lower", "engine:unknown"]],
      [["std:lower", `case:${"a".repeat(63)}`]],
      [["std:lower", `case:${"a".repeat(65)}`]],
      [["std:lower", `case:${"g".repeat(64)}`]],
      [["std:lower", `${lowerFingerprint}\n`]],
      [["std:lower", null]],
      [["std:upper", lowerFingerprint]],
      [["std:lower", lowerFingerprint], ["std:sort", "engine:bun"]],
      [["std:lower"]],
      [["std:lower", lowerFingerprint, "extra"]],
      [null],
      new Array(1),
      null,
      "malformed",
    ]) expect(() => check([{ fnId: baseFn, hostChecks }])).toThrow("canonical Base replay has nonportable host checks");
  });

  test("requires an exported Base entry", () => {
    expect(() => check([])).toThrow("exported no canonical repository Base");
    expect(() => check([{ fnId: "other:body" }])).toThrow("exported no canonical repository Base");
  });
});
