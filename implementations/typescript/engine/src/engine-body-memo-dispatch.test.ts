// S1a — the engine-body memo at the real dispatcher and the real interpreter:
// a call with a caller frame is never memoized, NODE_ENV=test and fixtures
// switch it off, an uncertified native (std:now) or an exception absorbed by a
// native leaves the result unstored. Builds only the engine harness.
import "./engine-body-host-install";
import { afterEach, describe, expect, test } from "bun:test";
import {
  __clearFnBodyFixturesForTests,
  __engineBodyMemoHostForTests,
  __registerFnBodyFixtureForTests,
  __resetEngineBodyReplayForTests,
  engineHarnessCertificate,
  installEngineBodyReplayArtifactText,
  dispatchCompiledResolveDispatch,
  dispatchCompiledResolver,
  dispatchEngineBody,
  harnessForTests,
  setAlgebraDeciderNativesCtx,
} from "./engine-bodies-dispatch";
import { dispatchRegistry } from "./system-entities";
import { stdModule } from "./modules/std";
import { registerNamedSet } from "./set-algebra";
import { replayArtifactText } from "./engine-body-replay";
import { evaluatorHookGenerationForMemo } from "./json-logic";
import { sha256OfEncoding } from "./engine-body-memo";
import {
  __setEngineBodyMemoForTests,
  clearEngineBodyMemo,
  clearEngineBodyMemoPartition,
  engineBodyMemoStats,
  exportEngineBodyMemoEntries,
  memoizedEngineBodyCall,
  REPOSITORY_PARTITION,
  withEngineBodyMemoPartition,
} from "./engine-body-memo";
import {
  evaluate,
  installServedDispatcher,
  invokeCallable,
  withRuntimeRepresentationProjection,
  type EvaluateContext,
  type ServedBareNameResolver,
  type ServedDispatchResolver,
} from "./json-logic";

const FN = "engine:typeIdentityLockKeys";
const ARGS = (): unknown[] => [[{ $tag: "Just", _0: "std" }], ["Maybe"]];
const inPartition = <T>(op: () => T): T => withEngineBodyMemoPartition("test", op as never) as T;

afterEach(() => {
  __setEngineBodyMemoForTests(null);
  __clearFnBodyFixturesForTests();
  clearEngineBodyMemo();
});

describe("dispatchEngineBody memo boundary (D1, D3, D7)", () => {
  test("a caller-less call is stored then replayed with an equal value", () => {
    __setEngineBodyMemoForTests(true);
    const first = inPartition(() => dispatchEngineBody(FN, ARGS()));
    const second = inPartition(() => dispatchEngineBody(FN, ARGS()));
    expect(second).toEqual(first);
    expect(engineBodyMemoStats().byFn[FN]).toMatchObject({ calls: 2, hits: 1, stored: 1 });
  });

  test("a body on the Fenel unmemoized list runs without the memo; an unlisted body keeps it", () => {
    __setEngineBodyMemoForTests(true);
    const delta = "engine:collectFieldIdentitiesDelta";
    // Whatever the kernel answers for a malformed request, the memo never sees the call.
    try { inPartition(() => dispatchEngineBody(delta, [{ $tag: "NoKernel" }, { $tag: "NoInput" }])); } catch { /* the kernel's own answer */ }
    expect(engineBodyMemoStats().byFn[delta]).toBeUndefined();
    expect(dispatchEngineBody("engine:anaUnmemoizedBodies", [])).toEqual([delta,
      "engine:fieldFacetsBase", "engine:projectFieldFacetsDelta"]);
    inPartition(() => dispatchEngineBody(FN, ARGS()));
    expect(engineBodyMemoStats().byFn[FN]).toMatchObject({ calls: 1, stored: 1 });
  });

  test("a call with a caller frame is never memoized", () => {
    __setEngineBodyMemoForTests(true);
    const caller = harnessForTests().ctx;
    inPartition(() => dispatchEngineBody(FN, ARGS(), caller));
    inPartition(() => dispatchEngineBody(FN, ARGS(), caller));
    expect(engineBodyMemoStats().byFn[FN]).toBeUndefined();
  });

  test("no memo outside a partition", () => {
    __setEngineBodyMemoForTests(true);
    dispatchEngineBody(FN, ARGS());
    expect(engineBodyMemoStats().byFn[FN]).toBeUndefined();
  });

  test("NODE_ENV=test switches the memo off by default", () => {
    expect(process.env["NODE_ENV"]).toBe("test");
    inPartition(() => dispatchEngineBody(FN, ARGS()));
    expect(engineBodyMemoStats().byFn[FN]).toBeUndefined();
  });

  test("a populated fixture map switches it off, and the fixture generation is part of the key", () => {
    __setEngineBodyMemoForTests(true);
    inPartition(() => dispatchEngineBody(FN, ARGS()));
    expect(engineBodyMemoStats().byFn[FN]).toMatchObject({ calls: 1, stored: 1 });
    __registerFnBodyFixtureForTests("s1ScratchFixture", 1);
    inPartition(() => dispatchEngineBody(FN, ARGS()));
    expect(engineBodyMemoStats().byFn[FN]).toMatchObject({ calls: 1, stored: 1 });
    __clearFnBodyFixturesForTests();
    inPartition(() => dispatchEngineBody(FN, ARGS()));
    // The entry stored before the fixture generation moved is not replayed.
    expect(engineBodyMemoStats().byFn[FN]).toMatchObject({ calls: 2, hits: 0, stored: 2 });
  });
});

describe("eligibility extents and evaluator hooks (review round A, item 1)", () => {
  test("no memo inside a runtime-representation projection extent", () => {
    __setEngineBodyMemoForTests(true);
    withRuntimeRepresentationProjection(harnessForTests().ctx, () => inPartition(() => dispatchEngineBody(FN, ARGS())));
    expect(engineBodyMemoStats().byFn[FN]).toBeUndefined();
  });

  test("reinstalling an evaluator hook moves the code state: the earlier entry is not replayed", () => {
    __setEngineBodyMemoForTests(true);
    inPartition(() => dispatchEngineBody(FN, ARGS()));
    installServedDispatcher({
      resolveBareName: dispatchCompiledResolver as ServedBareNameResolver,
      resolveDispatch: dispatchCompiledResolveDispatch as ServedDispatchResolver,
    });
    inPartition(() => dispatchEngineBody(FN, ARGS()));
    expect(engineBodyMemoStats().byFn[FN]).toMatchObject({ calls: 2, hits: 0, stored: 2 });
  });
});

describe("the recording instrument through the real interpreter (D4)", () => {
  const leaves = (): ReadonlySet<string> => {
    const raw = dispatchEngineBody("engine:anaDeterministicNativeLeaves", []) as string[];
    return new Set(raw);
  };

  function run(fnId: string, body: unknown, ctx: EvaluateContext, certified: ReadonlySet<string>): { calls: number } {
    const counter = { calls: 0 };
    const host = {
      codeState: () => "pool:0;fixtures:0",
      deterministicLeaves: () => certified,
      hostVariantLeaves: () => new Set<string>(),
      hostFingerprint: () => "engine:test",
      compute: () => {
        counter.calls += 1;
        return evaluate(body, {}, ctx);
      },
    };
    inPartition(() => memoizedEngineBodyCall(fnId, [], host));
    inPartition(() => memoizedEngineBodyCall(fnId, [], host));
    return counter;
  }

  test("the Fenel list excludes std:now and admits std:add", () => {
    const list = leaves();
    expect(list.has("std:now")).toBe(false);
    expect(list.has("std:formatDate")).toBe(false);
    expect(list.has("std:add")).toBe(true);
  });

  test("descriptor observation and numeric finiteness are source-certified; coercive finiteness remains tainted", () => {
    const certified = leaves(), ctx = harnessForTests().ctx;
    expect(certified.has("std:representationValueSnapshot")).toBe(true);
    expect(certified.has("std:numberIsFinite")).toBe(true);
    expect(run("s1:physical-descriptor", { call: ["std:representationValueSnapshot", { r: 1, g: 2 }] }, ctx, certified).calls).toBe(1);
    expect(engineBodyMemoStats().byFn["s1:physical-descriptor"]).toMatchObject({ hits: 1, stored: 1 });
    expect(run("s1:physical-finite", { call: ["std:numberIsFinite", 42] }, ctx, certified).calls).toBe(1);
    expect(run("s1:physical-coercion", { call: ["std:numberIsFinite", "42"] }, ctx, certified).calls).toBe(2);
    expect(engineBodyMemoStats().byFn["s1:physical-coercion"]?.notStored).toEqual({ "host numeric coercion": 2 });
  });

  test("the actual caller-free physical helper replays only exact data and its private partition can be cleared", () => {
    __setEngineBodyMemoForTests(true); // Test enablement only; source leaf gates remain real.
    const fn = "engine:surfaceReaderHasPreview", partition = "test:physical-snapshot";
    const image = { width: 1, height: 1, pixels: [{ r: 1, g: 2, b: 3, a: 255 }] };
    const preview = () => withEngineBodyMemoPartition(partition, () => dispatchEngineBody(fn, [image, false]));
    try {
      expect(preview()).toBe(true); expect(preview()).toBe(true);
      expect(engineBodyMemoStats().byFn[fn]).toMatchObject({ calls: 2, computed: 1, hits: 1, stored: 1, notStored: {} });
      image.pixels[0]!.r = -1;
      expect(preview()).toBe(false);
      expect(engineBodyMemoStats().byFn[fn]).toMatchObject({ calls: 3, computed: 2, hits: 1, stored: 2 });
      clearEngineBodyMemoPartition(partition);
      expect(preview()).toBe(false);
      expect(engineBodyMemoStats().byFn[fn]).toMatchObject({ calls: 4, computed: 3, hits: 1 });
    } finally { clearEngineBodyMemoPartition(partition); }
    expect(engineBodyMemoStats().entries).toBe(0);
  });


  test("a body reaching std:now is not stored; a body reaching only std:add is", () => {
    const ctx = harnessForTests().ctx;
    const certified = leaves();
    const nowRun = run("s1:now", { call: ["std:now"] }, ctx, certified);
    expect(nowRun.calls).toBe(2);
    expect(engineBodyMemoStats().byFn["s1:now"]?.notStored).toEqual({ "uncertified native std:now": 2 });
    const addRun = run("s1:add", { call: ["std:add", 1, 2] }, ctx, certified);
    expect(addRun.calls).toBe(1);
    expect(engineBodyMemoStats().byFn["s1:add"]?.leaves).toEqual(["std:add"]);
  });

  test("an exception absorbed by a native (crossing an evaluator door) prevents storing", () => {
    const base = harnessForTests().ctx;
    let throwIt = true;
    const ctx: EvaluateContext = {
      ...base,
      natives: { ...(base.natives ?? {}), "s1:boom": () => { if (throwIt) throw new RangeError("boom"); return 1; } },
      nativesCtx: {
        ...(base.nativesCtx ?? {}),
        "s1:absorb": (c: EvaluateContext, callable: unknown) => {
          try {
            return invokeCallable(callable, [], c);
          } catch {
            return { $tag: "Nothing" };
          }
        },
      },
    };
    const certified = new Set(["s1:absorb", "s1:boom"]);
    const body = { call: ["s1:absorb", { $ref: "s1:boom" }] };
    const absorbed = run("s1:absorbed", body, ctx, certified);
    expect(absorbed.calls).toBe(2);
    expect(engineBodyMemoStats().byFn["s1:absorbed"]?.notStored).toEqual({ "exception crossed an evaluator door": 2 });
    throwIt = false;
    const clean = run("s1:clean", body, ctx, certified);
    expect(clean.calls).toBe(1);
  });
});

describe("real wiring: the code state and the recording hooks (review round A)", () => {
  const twice = (host: ReturnType<typeof __engineBodyMemoHostForTests>, fnId: string): unknown => {
    inPartition(() => memoizedEngineBodyCall(fnId, [], host));
    return inPartition(() => memoizedEngineBodyCall(fnId, [], host));
  };
  const storedHostChecks = (fnId: string) =>
    exportEngineBodyMemoEntries("test").find((entry) => entry.fnId === fnId)?.hostChecks;

  test("a global-pool addInstance between two caller-less calls is a miss", () => {
    __setEngineBodyMemoForTests(true);
    inPartition(() => dispatchEngineBody(FN, ARGS()));
    inPartition(() => dispatchEngineBody(FN, ARGS()));
    expect(engineBodyMemoStats().byFn[FN]).toMatchObject({ calls: 2, hits: 1, stored: 1 });
    const owner = "s1-memo-pool-probe";
    dispatchRegistry.addInstance({
      typeName: "S1MemoPoolProbe", args: [], methods: {}, scope: { kind: "account", accountId: owner },
    } as never);
    try {
      inPartition(() => dispatchEngineBody(FN, ARGS()));
      expect(engineBodyMemoStats().byFn[FN]).toMatchObject({ calls: 3, hits: 1, stored: 2 });
    } finally {
      dispatchRegistry.removeInstancesOwnedBy(owner);
    }
  });

  test("a body reaching std:lower is stored bound to the live case-mapping fingerprint", () => {
    const ctx = harnessForTests().ctx;
    let runs = 0;
    const host = __engineBodyMemoHostForTests(() => {
      runs += 1;
      return evaluate({ call: ["std:lower", "ÀBΣ"] }, {}, ctx);
    });
    twice(host, "s1:lower");
    expect(runs).toBe(1);
    expect(engineBodyMemoStats().byFn["s1:lower"]).toMatchObject({ stored: 1, hits: 1, hostBound: 1 });
    expect(host.hostFingerprint!("std:lower")).toMatch(/^case:[0-9a-f]{64}$/);
    expect(host.hostFingerprint!("std:sort")).toMatch(/^engine:bun-/);
    expect(storedHostChecks("s1:lower"))
      .toEqual([["std:lower", host.hostFingerprint!("std:lower")]]);
  });

  test("a body that lowercased only ASCII text, or sorted, is stored without a host check", () => {
    const ctx = harnessForTests().ctx;
    let runs = 0;
    const host = __engineBodyMemoHostForTests(() => {
      runs += 1;
      const lowered = evaluate({ call: ["std:lower", "AbC-09_Z"] }, {}, ctx);
      const sorted = evaluate({ call: ["std:sort", { $ref: "std:id" }, [3, Number.NaN, "10", 2, 9]] }, {}, ctx);
      return [lowered, sorted];
    });
    const first = twice(host, "s1:ascii-sort");
    // std:sort: incomparable keys (NaN, text beside numbers) are a tie.
    expect(first).toEqual(["abc-09_z", [3, Number.NaN, "10", 2, 9]]);
    expect(runs).toBe(1);
    const row = engineBodyMemoStats().byFn["s1:ascii-sort"];
    expect(row).toMatchObject({ stored: 1, hits: 1, hostBound: 0 });
    expect([...row!.leaves]).toEqual(expect.arrayContaining(["std:lower", "std:sort"]));
    expect(storedHostChecks("s1:ascii-sort")).toBeUndefined();
  });

  test("a host read reported outside interpreter selection still binds the entry", () => {
    // Compiled parser/resolver closures call the std:lower native directly; its
    // report of a non-ASCII read binds the entry although no leaf was noted.
    const lower = stdModule.nativeImpls!["std:lower"] as (text: unknown) => unknown;
    let runs = 0;
    const host = __engineBodyMemoHostForTests(() => {
      runs += 1;
      return [lower("ASCII"), lower("ÉTÉ")];
    });
    expect(twice(host, "s1:direct-lower")).toEqual(["ascii", "été"]);
    expect(runs).toBe(1);
    expect(storedHostChecks("s1:direct-lower"))
      .toEqual([["std:lower", host.hostFingerprint!("std:lower")]]);
  });

  test("std:map over {$ref: std:now} is not stored", () => {
    const ctx = harnessForTests().ctx;
    let runs = 0;
    const host = __engineBodyMemoHostForTests(() => {
      runs += 1;
      return evaluate({ call: ["std:map", { $ref: "std:now" }, [1, 2]] }, {}, ctx);
    });
    twice(host, "s1:map-now");
    expect(runs).toBe(2);
    expect(engineBodyMemoStats().byFn["s1:map-now"]?.notStored).toEqual({ "uncertified native std:now": 2 });
  });

  test("a real NAMED_SETS read (containsNamedGlobal through namedMember) is not stored", () => {
    registerNamedSet("s1:memo-probe-set", (v) => v === 1);
    const base = harnessForTests().ctx;
    const ctx: EvaluateContext = {
      ...base,
      nativesCtx: Object.assign(Object.create(null), base.nativesCtx ?? {}, setAlgebraDeciderNativesCtx(null)),
    };
    let runs = 0;
    const real = __engineBodyMemoHostForTests(() => {
      runs += 1;
      return evaluate({ call: ["namedMember", "s1:memo-probe-set", 1] }, {}, ctx);
    });
    // namedMember itself is certified here, so only the process-global read
    // can keep the result out.
    const certified = new Set([...(real.deterministicLeaves() ?? []), "namedMember"]);
    const host = { ...real, deterministicLeaves: () => certified };
    inPartition(() => memoizedEngineBodyCall("s1:named", [], host));
    const second = inPartition(() => memoizedEngineBodyCall("s1:named", [], host));
    expect(second).toEqual({ $tag: "Just", _0: true });
    expect(runs).toBe(2);
    expect(engineBodyMemoStats().byFn["s1:named"]?.notStored).toEqual({ "process-global read (NAMED_SETS)": 2 });
  });

  // Last: a type_def installs a dynamic constructor table on its context.
  test("a real type_def inside a harness-context body is not stored", () => {
    const ctx: EvaluateContext = { ...harnessForTests().ctx };
    let runs = 0;
    const host = __engineBodyMemoHostForTests(() => {
      runs += 1;
      return evaluate({ do: [{ type_def: { name: "S1MemoT", constructors: [{ name: "S1MemoC", fields: [] }] } }, 1] }, {}, ctx);
    });
    twice(host, "s1:typedef");
    expect(runs).toBe(2);
    expect(engineBodyMemoStats().byFn["s1:typedef"]?.notStored).toEqual({ "type_def declaration": 2 });
  });
});

describe("S1b browser loader seam: installEngineBodyReplayArtifactText", () => {
  test("a matching artifact serves a caller-less call; a wrong epoch or certificate is refused", () => {
    __setEngineBodyMemoForTests(true);
    // Learn the call's portable key the way the generator does: record it in-realm,
    // in the public repository partition (the artifact holds only those entries).
    withEngineBodyMemoPartition(REPOSITORY_PARTITION, () => dispatchEngineBody(FN, ARGS()));
    const certificate = engineHarnessCertificate();
    expect(certificate).toMatch(/^[0-9a-f]{64}$/);
    const text = (header: { sourceEpoch: string; harnessCertificate: string }, keyDigest: string) =>
      replayArtifactText({ ...header, hookGeneration: evaluatorHookGenerationForMemo() }, [
        { keyDigest, fnId: FN, value: ["s1-replayed-marker"] },
      ]);
    const pinned = (body: string, sourceEpoch: string | undefined) => ({ textDigest: sha256OfEncoding(body), sourceEpoch });
    // The entry key: the in-realm portable key of the recorded call.
    const { exportEngineBodyMemoEntries } = require("./engine-body-memo") as typeof import("./engine-body-memo");
    const recorded = exportEngineBodyMemoEntries(REPOSITORY_PARTITION).find((entry) => entry.fnId === FN);
    expect(recorded).toBeDefined();
    const keyDigest = recorded!.keyDigest;

    __resetEngineBodyReplayForTests();
    const good = text({ sourceEpoch: "E1", harnessCertificate: certificate! }, keyDigest);
    expect(installEngineBodyReplayArtifactText(good, pinned(good, "E2")))
      .toEqual({ accepted: false, refused: "source epoch differs" });
    __resetEngineBodyReplayForTests();
    expect(installEngineBodyReplayArtifactText(good, pinned(good, undefined)))
      .toEqual({ accepted: false, refused: "no bundle source epoch (dev/serve mode)" });
    __resetEngineBodyReplayForTests();
    expect(installEngineBodyReplayArtifactText(good, pinned(good + "x", "E1")))
      .toEqual({ accepted: false, refused: "artifact digest differs from its pin" });
    __resetEngineBodyReplayForTests();
    const wrongCertificate = text({ sourceEpoch: "E1", harnessCertificate: "0".repeat(64) }, keyDigest);
    expect(installEngineBodyReplayArtifactText(wrongCertificate, pinned(wrongCertificate, "E1")))
      .toEqual({ accepted: false, refused: "harness certificate differs" });
    __resetEngineBodyReplayForTests();
    expect(installEngineBodyReplayArtifactText(good, pinned(good, "E1")))
      .toEqual({ accepted: true });
    clearEngineBodyMemo(); // force an in-realm miss: the artifact must serve it
    const served = inPartition(() => dispatchEngineBody(FN, ARGS()));
    expect(served).toEqual(["s1-replayed-marker"]);
    expect(engineBodyMemoStats().byFn[FN]).toMatchObject({ artifactHits: 1, computed: 0 });
    __resetEngineBodyReplayForTests();
  });

  test("a body id absent from the artifact index skips the portable-key digest and the lookup", () => {
    __setEngineBodyMemoForTests(true);
    const certificate = engineHarnessCertificate();
    const body = replayArtifactText({ sourceEpoch: "E1", harnessCertificate: certificate!, hookGeneration: evaluatorHookGenerationForMemo() },
      [{ keyDigest: "0".repeat(64), fnId: FN, value: ["marker"] }]);
    __resetEngineBodyReplayForTests();
    expect(installEngineBodyReplayArtifactText(body, { textDigest: sha256OfEncoding(body), sourceEpoch: "E1" }))
      .toEqual({ accepted: true });
    try {
      const real = __engineBodyMemoHostForTests(() => "computed");
      let lookups = 0;
      const spied = { ...real, replayLookup: (key: string) => { lookups += 1; return real.replayLookup!(key); } };
      // Absent from the index: no lookup (and so no digest of the portable key).
      expect(inPartition(() => memoizedEngineBodyCall("test:absent-from-index", [1], spied))).toBe("computed");
      expect(lookups).toBe(0);
      // Present in the index: looked up (a miss here: no entry has this digest).
      expect(inPartition(() => memoizedEngineBodyCall(FN, [2], spied))).toBe("computed");
      expect(lookups).toBe(1);
      expect(engineBodyMemoStats().byFn["test:absent-from-index"]).toMatchObject({ computed: 1, artifactHits: 0 });
    } finally {
      __resetEngineBodyReplayForTests();
    }
  });
});
