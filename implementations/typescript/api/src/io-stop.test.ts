import { beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { dispatchRegistry, getIOAction } from "@fenel/engine";
import { modulesFor } from "@fenel/engine/module-manifest";
import { createRepositoryRegistry } from "@fenel/engine/repository-registry";
import { getSystemRegistry } from "@fenel/engine/system-registry";
import { Nothing, Result } from "@fenel/engine/type-foundation";
import type { ModuleRegistry } from "@fenel/engine/registry";
import type { FenelFunction } from "@fenel/engine/types";
import { resumeAfterIO, turn } from "@fenel/runtime";
import { prepareIOStop } from "./io-stop";
import { mintAuthority } from "@fenel/engine/authority";

// The first validation materializes the real repository field catalog. Match
// the repository's cold-registry budget so it cannot become a false timeout.
setDefaultTimeout(600_000);

let registry: ModuleRegistry;
let run: FenelFunction;
let stop: FenelFunction;
const botId = "a8b4cd3e-9a53-47a0-8233-19bf957d1d7f";
const okHandle = { $tag: "Ok", _0: botId };
const action = "telegram_collector.stop";

beforeAll(() => {
  registry = getSystemRegistry();
  run = registry.getFunction("telegram:runCollector")!;
  stop = registry.getFunction("telegram:stopCollector")!;
  expect(run).toBeDefined();
  expect(stop).toBeDefined();
}, 600_000);

/** The function roster is a controlled declaration fixture. Type resolution,
 * validation and IOInvokable lookups still use the actual engine. */
function declarations(runOverride: Partial<FenelFunction> = {}, stopOverride: Partial<FenelFunction> = {}): ModuleRegistry {
  const start = { ...run, ...runOverride };
  const end = { ...stop, ...stopOverride };
  return {
    ...registry,
    getFunction: (id) => id === run.id ? start : registry.getFunction(id),
    listFunctions: () => [start, end],
  };
}

describe("Stop invocation contract", () => {
  test("the real declarations adapt Result BotId to the stop function's botId parameter", () => {
    const plan = prepareIOStop(registry, run.id, action, [okHandle]);
    expect(plan.params).toEqual({ botId });
    expect(plan.params).not.toHaveProperty("botToken");
    expect(plan.complete({ $tag: "Nothing" })).toEqual({ stopped: true });
    const value = { $tag: "Just", _0: "Provider refused to stop" };
    expect(plan.complete(value)).toEqual({ stopped: false, error: value._0 });
    expect(value).toEqual({ $tag: "Just", _0: "Provider refused to stop" });
  });

  test("a failed or malformed run result cannot produce a stop request", () => {
    const reg = declarations();
    expect(() => prepareIOStop(reg, run.id, action, [{ $tag: "Err", _0: "Bad token" }]))
      .toThrow("The run failed: Bad token");
    expect(() => prepareIOStop(reg, run.id, action, [{ $tag: "Ok", _0: 5 }]))
      .toThrow("retained run result");
    expect(() => prepareIOStop(reg, run.id, action, []))
      .toThrow("single-handle contract");
  });

  test("a direct typed handle is supported without manufacturing a Result wrapper", () => {
    const reg = declarations({ returns: stop.params[0]!.type });
    expect(prepareIOStop(reg, run.id, action, [botId]).params).toEqual({ botId });
  });

  test("unsupported and ambiguous declarations fail before an IO request can be built", () => {
    const reg = declarations();
    expect(() => prepareIOStop(reg, run.id, "missing.stop", [okHandle])).toThrow("exactly one");
    expect(() => prepareIOStop({ ...reg, listFunctions: () => [stop, stop] }, run.id, action, [okHandle]))
      .toThrow("exactly one");
    expect(() => prepareIOStop(declarations({}, { params: [] }), run.id, action, [okHandle]))
      .toThrow("single-handle contract");
    expect(() => prepareIOStop(declarations({}, { returns: { $ref: "String" } }), run.id, action, [okHandle]))
      .toThrow("must return Result or Maybe String");
  });

  test("Result-returning stop functions use their typed outcome, and malformed replies fail visibly", () => {
    const reg = declarations({}, { returns: Result({ $ref: "String" }, { $ref: "String" }) });
    const plan = prepareIOStop(reg, run.id, action, [okHandle]);
    expect(plan.complete({ $tag: "Err", _0: "Denied" })).toEqual({ stopped: false, error: "Denied" });
    expect(plan.complete({ $tag: "Ok", _0: "stopped" })).toEqual({ stopped: true });
    expect(plan.complete({ $tag: "Ok", _0: null })).toMatchObject({ stopped: false });
    expect(plan.complete({ $tag: "Ok", _0: 12 })).toMatchObject({ stopped: false });
    expect(plan.complete("not a Result")).toMatchObject({ stopped: false });
  });

  test("unsupported Unit completion contracts are refused before teardown", () => {
    // null is a legitimate Unit carrier at matchesShape; changing it to {} is
    // not a repair. The current form validator rejects Unit itself. Until the
    // shared validator supports it, this view must refuse the declaration.
    const reg = declarations({}, { returns: Result({ $ref: "String" }, { $unit: true }) });
    const calls: unknown[] = [];
    expect(() => {
      const plan = prepareIOStop(reg, run.id, action, [okHandle]);
      calls.push(plan.params);
    }).toThrow("result payload type that this view cannot validate");
    expect(calls).toEqual([]);
  });

  test("payload aliases outside the readiness gate are refused without guessing", () => {
    const reg = declarations({}, { returns: Result({ $ref: "String" }, { $ref: "StopAcknowledgement" }) });
    const aliased = {
      ...reg,
      getEntity: (id: string) => id === "StopAcknowledgement"
        ? { id, type: { $ref: "String" } }
        : reg.getEntity(id),
    };
    expect(() => prepareIOStop(aliased, run.id, action, [okHandle]))
      .toThrow("result payload type that this view cannot validate");
  });
});

let executionDeclarations: ModuleRegistry | undefined;

/** Use the same declaration roster as runtime loadRegistry. The dashboard's
 * system catalog intentionally omits state IO functions, so it cannot resolve
 * the cleanup calls in this body. Runtime-only handler/storage implementation
 * installation is unnecessary here: every IO request is yielded and answered
 * below, with no provider, database or network call. */
function executionRegistry(): ModuleRegistry {
  return executionDeclarations ??= createRepositoryRegistry(modulesFor("execute"), { dispatchRegistry });
}

/** Execute the production stopCollector body through the runtime's IO yield /
 * resume boundary, retaining the production declarations and parameter names. */
function executeStopBody(deleted: unknown, found = true) {
  const execution = executionRegistry();
  const productionStop = execution.getFunction("telegram:stopCollector");
  expect(productionStop?.body).toBeDefined();
  const calls: { action: string; params: Record<string, unknown> }[] = [];
  const io = (name: string) => {
    const declaration = execution.getFunction(name);
    expect(declaration, `execute profile is missing ${name}`).toBeDefined();
    const action = getIOAction(declaration!.id);
    expect(typeof action, `${name} must have declared IO action metadata`).toBe("string");
    return action!;
  };
  const find = io("telegram:findBotById");
  const removeWebhook = io("telegram:deleteWebhookByToken");
  const cleanup = new Set([io("state:cancelAllConversations"), io("state:updateInstance"), io("state:deleteSubscription")]);
  const expectedCalls = [
    { action: find, params: { botId } },
    { action: removeWebhook, params: { token: "fake-provider-token" } },
    { action: io("state:cancelAllConversations"), params: { botId } },
    { action: io("state:updateInstance"), params: {
      instanceId: botId,
      value: { collectorConfig: Nothing, webhookUrl: Nothing, webhookSecret: Nothing },
    } },
    { action: io("state:deleteSubscription"), params: { slug: `tg-bot-${botId}` } },
  ];
  // rights R2a — `turn` takes the execution authority. This is a PURE-channel
  // test (no perform reaches a table), so a member authority over the execution
  // registry is the honest shape: it is what a real durable turn carries.
  const pureAuthority = mintAuthority(execution, {
    envelope: execution.evaluateAuthorityFunction(
      "authority:descriptorEnvelope", [execution.listPerformDescriptors()],
    ),
    issuer: "test", accountId: "", principal: null, lane: null, grant: null, mintedAt: 0,
  });
  let result = turn({ stack: [{ exprs: [productionStop!.body], index: 0 }], env: { botId }, letTarget: Nothing }, execution, pureAuthority);
  for (let count = 0; result.outcome === "io" && count < 10; count++) {
    calls.push({ action: result.request.action, params: result.request.params });
    const name = result.request.action;
    const value = name === find
      ? found ? { $tag: "Just", _0: { id: botId, token: "fake-provider-token" } } : { $tag: "Nothing" }
      : name === removeWebhook ? deleted
      : cleanup.has(name) ? null
      : (() => { throw new Error(`Unexpected IO: ${name}`); })();
    result = resumeAfterIO(result.state, value, execution, pureAuthority);
  }
  expect(result.outcome).toBe("done");
  return { calls, value: result.outcome === "done" ? result.value : undefined, expectedCalls };
}

describe("Stop provider failure", () => {
  test("a remote deletion failure preserves conversations, local binding and subscription", () => {
    const result = executeStopBody({ $tag: "Err", _0: "Remote deletion refused" });
    expect(result.calls).toEqual(result.expectedCalls.slice(0, 2));
    expect(result.value).toEqual({ $tag: "Just", _0: "Remote deletion refused" });
  });

  test("successful remote deletion proceeds through all local cleanup", () => {
    const result = executeStopBody({ $tag: "Ok", _0: null });
    expect(result.calls).toEqual(result.expectedCalls);
    expect(result.value).toEqual({ $tag: "Nothing" });
  });

  test("an absent deployment fails without calling the provider", () => {
    const result = executeStopBody({ $tag: "Ok", _0: null }, false);
    expect(result.calls).toEqual(result.expectedCalls.slice(0, 1));
    expect(result.value).toEqual({ $tag: "Just", _0: "No bot found for that id." });
  });
});
