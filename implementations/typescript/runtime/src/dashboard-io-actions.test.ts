// GP-34: exercise the real dashboard bodies in the production execute profile.
// Only storage leaves are replaced; IOInvokable selection, its rows,
// the caller frame and the runtime evaluator remain the production paths (C1).
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Just, Nothing } from "@fenel/engine/type-foundation";
import { peelList, peelMaybe } from "@fenel/engine/set-algebra";
import type { FenelType } from "@fenel/engine/types";
import { mintRequestAuthority } from "./authority-mint";
import { loadRegistry, resetRegistryCache, runUnpersistedCallForTest } from "./evaluator";

const registry = loadRegistry();
let storedFunction: { id: string } | undefined;
const defaultRuns = [{ id: "run-1", status: "completed" }];
let runs: Record<string, unknown>[] = defaultRuns;
let storedInstance: Record<string, unknown> | undefined;
let resumedResult: Record<string, unknown> = { ok: false, error: "resume failed" };
let completedInstance: Record<string, unknown> | undefined;
const readFunctionNames: unknown[] = [];
const listedFunctionIds: unknown[] = [];
const readInstanceIds: unknown[] = [];
const resumeRequests: Record<string, unknown>[] = [];
const completedFunctionIds: unknown[] = [];
registry.registerIOHandler("state:getFunction", async (params) => {
  readFunctionNames.push(params.name);
  return { action: "continue", value: storedFunction === undefined ? Nothing : Just(storedFunction) };
});
registry.registerIOHandler("state:listFunctionInstances", async (params) => {
  listedFunctionIds.push(params.fnDbId);
  return { action: "continue", value: runs };
});
registry.registerIOHandler("state:getFunctionInstance", async (params) => {
  readInstanceIds.push(params.instanceId);
  return { action: "continue", value: storedInstance === undefined ? Nothing : Just(storedInstance) };
});
registry.registerIOHandler("state:resumeWaitingInstance", async (params) => {
  resumeRequests.push(params);
  return { action: "continue", value: resumedResult };
});
registry.registerIOHandler("state:findLastCompletedInstance", async (params) => {
  completedFunctionIds.push(params.fnDbId);
  return { action: "continue", value: completedInstance === undefined ? Nothing : Just(completedInstance) };
});
const accountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const authority = mintRequestAuthority(registry, {
  accountId, role: "owner", membershipId: "dashboard-io-test-membership",
  subject: { $tag: "User", accountId, userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
});

async function call(name: string, params: Record<string, unknown>) {
  const result = await runUnpersistedCallForTest(
    `dashboard:${name}`, params, { accountId, profileId: "", authority }, registry,
  );
  expect(result.action).toBe("continue");
  return result.value;
}

beforeEach(() => {
  storedFunction = storedInstance = completedInstance = undefined;
  resumedResult = { ok: false, error: "resume failed" };
  runs = defaultRuns;
  readFunctionNames.length = listedFunctionIds.length = readInstanceIds.length = resumeRequests.length = completedFunctionIds.length = 0;
});

afterAll(() => {
  // The test owns these temporary leaf replacements. Discard its cached
  // registry rather than treating getIOHandler's mediated wrapper as a leaf.
  resetRegistryCache();
});

describe("dashboard IOInvokable action reads (GP-34)", () => {
  test("projection signatures expose the wire fields rather than empty records", () => {
    const fields = (type: FenelType | undefined) => {
      if (!type || !("$record" in type)) throw new Error("Expected an explicit record projection");
      return type.$record.fields.map((field) => field.name).sort();
    };
    const returns = (name: string) => registry.getFunction(`dashboard:${name}`)?.returns;
    const awaitingFields = ["instanceId", "suspensionId", "functionId", "functionName", "status", "prompt", "source", "schema", "createdAt"].sort();
    expect(fields(returns("projectAwaitingRow"))).toEqual(awaitingFields);
    expect(fields(peelList(returns("listAwaiting")!)?.elem)).toEqual(awaitingFields);
    expect(fields(returns("projectCompletedInstance"))).toEqual(["ok", "value", "suspended", "status", "error"].sort());
    expect(fields(returns("projectSuspendedInstance"))).toEqual(["ok", "suspended", "status", "suspensionId", "value", "error"].sort());
    expect(fields(returns("resolveAwaitingErr"))).toEqual(["ok", "error", "suspended", "status", "value"].sort());
    const resultFields = ["id", "value", "startedAt", "completedAt"].sort();
    expect(fields(returns("projectLastResult"))).toEqual(resultFields);
    expect(fields(peelMaybe(returns("lastResult")!)?.value)).toEqual(resultFields);
    expect(returns("resolveAwaiting")).toHaveProperty("$map");
    expect(registry.getFunction("dashboard:hasBody")?.params[0]?.type).toHaveProperty("$map");
  });

  // modules-as-values follow-up (2026-10-02): the registry build's static effect
  // fold resolves the two-segment bundle path `dispatch.lookupOne` (an IO leaf
  // declaring HasRegistry), as the effect audit always did.
  test("the effect fold sees the dispatch.lookupOne bundle path", () => {
    const classes = (name: string) => (registry.getFunction(`dashboard:${name}`)?.requires ?? []).map((c) => c.class.entityId);
    expect(classes("ioRunAction")).toContain("HasRegistry");
  });

  test("one-shot Run uses the existing execute-profile instance", async () => {
    expect(registry.getFunction("engine:getIOAction")).toBeUndefined();
    expect(await call("runDecision", { fnId: "io:random_hex" })).toEqual({ $tag: "OneShotRun", action: "io.random_hex" });
    expect(await call("runDecision", { fnId: "std:add" })).toEqual({ $tag: "NoActionConfigured", fnId: "std:add", mode: "run" });
  }, 60_000);

  test("one-shot Stop uses the existing execute-profile instance", async () => {
    expect(registry.getFunction("engine:getStopAction")).toBeUndefined();
    expect(await call("stopDecision", { fnId: "telegram:runCollector" })).toEqual({ $tag: "OneShotStop", action: "telegram_collector.stop" });
    expect(await call("stopDecision", { fnId: "io:random_hex" })).toEqual({ $tag: "NoActionConfigured", fnId: "io:random_hex", mode: "stop" });
  }, 60_000);

  test("invocation decisions retain the API's named payload fields in every arm", async () => {
    storedFunction = undefined;
    expect(await call("durableDecision", { fnId: "missing:stored" })).toEqual({ $tag: "NotSeededInDb", fnId: "missing:stored" });
    expect(await call("decideInvoke", { fnId: "missing:module", mode: "run" })).toEqual({ $tag: "NotFoundFn", fnId: "missing:module" });
    expect(await call("decideInvoke", { fnId: "io:random_hex", mode: "run" })).toEqual({ $tag: "OneShotRun", action: "io.random_hex" });
    expect(await call("decideInvoke", { fnId: "telegram:runCollector", mode: "stop" })).toEqual({ $tag: "OneShotStop", action: "telegram_collector.stop" });
    storedFunction = { id: "stored-if-else" };
    expect(await call("decideInvoke", { fnId: "std:ifElse", mode: "run" })).toEqual({ $tag: "DurableStart", dbFnId: "stored-if-else" });
    storedFunction = undefined;
  }, 60_000);

  test("top-level Stop, bodyless Run and missing functions never read the unused durable branch", async () => {
    expect(await call("decideInvoke", { fnId: "std:ifElse", mode: "stop" })).toEqual({ $tag: "NoActionConfigured", fnId: "std:ifElse", mode: "stop" });
    expect(await call("decideInvoke", { fnId: "telegram:runCollector", mode: "stop" })).toEqual({ $tag: "OneShotStop", action: "telegram_collector.stop" });
    expect(await call("decideInvoke", { fnId: "io:random_hex", mode: "run" })).toEqual({ $tag: "OneShotRun", action: "io.random_hex" });
    expect(await call("decideInvoke", { fnId: "missing:module", mode: "run" })).toEqual({ $tag: "NotFoundFn", fnId: "missing:module" });
    expect(readFunctionNames).toEqual([]);
    expect(listedFunctionIds).toEqual([]);
  }, 60_000);

  test("top-level durable Run performs exactly one lookup for both seeded and missing rows", async () => {
    storedFunction = { id: "stored-if-else" };
    expect(await call("decideInvoke", { fnId: "std:ifElse", mode: "run" })).toEqual({ $tag: "DurableStart", dbFnId: "stored-if-else" });
    expect(readFunctionNames).toEqual(["std:ifElse"]);
    storedFunction = undefined;
    expect(await call("decideInvoke", { fnId: "std:ifElse", mode: "run" })).toEqual({ $tag: "NotSeededInDb", fnId: "std:ifElse" });
    expect(readFunctionNames).toEqual(["std:ifElse", "std:ifElse"]);
  }, 60_000);

  test("instance lists keep existing runs and always return a canonical Maybe action", async () => {
    expect(registry.getFunction("engine:getListInstancesAction")).toBeUndefined();
    storedFunction = { id: "stored-collector" };
    readFunctionNames.length = listedFunctionIds.length = 0;
    expect(await call("listIoInstancesBase", { fnName: "telegram:runCollector" })).toEqual({ runs, listAction: Just("telegram_collector.list") });
    expect(readFunctionNames).toEqual(["telegram:runCollector"]);
    expect(listedFunctionIds).toEqual([Just("stored-collector")]);
    storedFunction = undefined;
    expect(await call("listIoInstancesBase", { fnName: "io:random_hex" })).toEqual({ runs: [], listAction: Nothing });
    expect(await call("listIoInstancesBase", { fnName: "missing:io" })).toEqual({ runs: [], listAction: Nothing });
    expect(listedFunctionIds).toHaveLength(1);
  }, 60_000);

  test("action fields normalize raw, Maybe and missing boundary encodings once", async () => {
    for (const [raw, expected] of [
      ["example.action", Just("example.action")],
      [Just("example.action"), Just("example.action")],
      [Nothing, Nothing],
      [undefined, Nothing],
      [12, Nothing],
      [Just(12), Nothing],
      [{ unexpected: "action" }, Nothing],
    ] as const) {
      expect(await call("ioActionName", { raw })).toEqual(expected);
    }
  }, 60_000);

  test("awaiting rows keep choice, event and missing-sidecar wire projections", async () => {
    const requestedType = { $ref: "String" };
    const common = { functionId: "stored-choice", functionName: "choose", status: "awaiting_choice", startedAt: "2026-09-30T09:00:00Z" };
    runs = [
      { ...common, id: "choice-1", variables: { _suspensionId: "prompt-1", _suspendMeta: { $tag: "AwaitingChoice", schema: { prompt: Just("Choose"), source: Just("form"), schema: requestedType } } } },
      { ...common, id: "event-1", functionName: null, status: "waiting_event", variables: { _suspensionId: "prompt-2", _suspendMeta: { $tag: "WaitEvent", event: "chosen", schema: Just(requestedType), prompt: Just("Wait for choice") } } },
      { ...common, id: "timer-1", status: "waiting_timer", variables: {} },
    ];
    expect(await call("listAwaiting", {})).toEqual([
      { instanceId: "choice-1", suspensionId: "prompt-1", functionId: common.functionId, functionName: "choose", status: "awaiting_choice", prompt: "Choose", source: "form", schema: requestedType, createdAt: common.startedAt },
      { instanceId: "event-1", suspensionId: "prompt-2", functionId: common.functionId, functionName: common.functionId, status: "waiting_event", prompt: "Wait for choice", source: "event:chosen", schema: requestedType, createdAt: common.startedAt },
      { instanceId: "timer-1", suspensionId: null, functionId: common.functionId, functionName: "choose", status: "waiting_timer", prompt: null, source: null, schema: null, createdAt: common.startedAt },
    ]);
    expect(listedFunctionIds).toEqual([Nothing]);
  }, 60_000);

  test("last result preserves arbitrary values and both stages of absence", async () => {
    expect(await call("lastResult", { fnName: "choose" })).toEqual(Nothing);
    expect(completedFunctionIds).toEqual([]);
    storedFunction = { id: "stored-choice" };
    expect(await call("lastResult", { fnName: "choose" })).toEqual(Nothing);
    completedInstance = { id: "completed-1", variables: { _lastResult: Just({ selected: [1, 2] }) }, startedAt: "start", completedAt: "finish" };
    expect(await call("lastResult", { fnName: "choose" })).toEqual(Just({ id: "completed-1", value: Just({ selected: [1, 2] }), startedAt: "start", completedAt: "finish" }));
    expect(completedFunctionIds).toEqual(["stored-choice", "stored-choice"]);
  }, 60_000);

  test("resolve checks existence before resuming and preserves the error envelope", async () => {
    const params = { instanceId: "waiting-1", value: { selected: true }, expectedSuspensionId: Just("prompt-1") };
    expect(await call("resolveAwaiting", params)).toEqual({ ok: false, error: "Instance not found", suspended: false, status: null, value: null });
    expect(resumeRequests).toEqual([]);
    storedInstance = { id: "waiting-1" };
    resumedResult = { ok: false, error: "This prompt has changed. Refresh before responding." };
    expect(await call("resolveAwaiting", params)).toEqual({ ok: false, error: resumedResult.error, suspended: false, status: null, value: null });
    expect(readInstanceIds).toEqual(["waiting-1", "waiting-1"]);
    expect(resumeRequests).toEqual([{ instanceId: "waiting-1", event: { choice: params.value }, expectedSuspensionId: params.expectedSuspensionId }]);
  }, 60_000);

  test("resolve preserves distinct completed and suspended key sets", async () => {
    storedInstance = { id: "waiting-1" };
    const params = { instanceId: "waiting-1", value: 3, expectedSuspensionId: Nothing };
    resumedResult = { ok: true, instance: Just({ status: "completed", variables: { _lastResult: { answer: 3 } } }) };
    expect(await call("resolveAwaiting", params)).toEqual({ ok: true, value: { answer: 3 }, suspended: false, status: null, error: null });
    resumedResult = { ok: true, instance: Just({ status: "waiting_event", variables: { _suspensionId: "prompt-2" } }) };
    expect(await call("resolveAwaiting", params)).toEqual({ ok: true, suspended: true, status: "waiting_event", suspensionId: "prompt-2", value: null, error: null });
    expect(resumeRequests).toHaveLength(2);
  }, 60_000);
});
