import { expect, test } from "bun:test";
import { flush } from "solid-js";
import { createIOCallController } from "./io-call-controller";

test("a suspended card retains the exact prompt nonce returned by its invocation", async () => {
  const controller = createIOCallController({
    info: () => ({ fnId: "question", args: [] }),
    evaluate: (value) => value,
    invoke: async () => ({ ok: true, suspended: true, instanceId: "instance", status: "awaiting_choice", suspensionId: "prompt-one" }),
  });
  await controller.dispatch("run");
  expect(controller.state()).toEqual({
    kind: "suspended", instanceId: "instance", status: "awaiting_choice", suspensionId: "prompt-one",
  });
  controller.setState({ kind: "suspended", instanceId: "instance", status: "awaiting_choice", suspensionId: "prompt-two" });
  // Solid 2 stages writes to the microtask queue: a read in the same tick still
  // sees the last committed value, so an imperative assertion must flush first.
  flush();
  expect(controller.state()).toMatchObject({ suspensionId: "prompt-two" });
});

test("a legacy invocation without a nonce retains explicit absence", async () => {
  const controller = createIOCallController({
    info: () => ({ fnId: "question", args: [] }),
    evaluate: (value) => value,
    invoke: async () => ({ ok: true, suspended: true, instanceId: "legacy" }),
  });
  await controller.dispatch("run");
  expect(controller.state()).toMatchObject({ kind: "suspended", suspensionId: null });
});

test("typed Stop failure retains the original typed handle and error for retry", async () => {
  const handle = { $tag: "Ok", _0: "deployment-id" };
  const failure = { $tag: "Just", _0: "Provider refused to stop" };
  const calls: unknown[][] = [];
  let fail = true;
  const controller = createIOCallController({
    info: () => ({ fnId: "deploy", args: [], stopAction: "undeploy" }),
    evaluate: (value) => value,
    invoke: async (_fnId, args, mode) => {
      calls.push(args);
      return mode === "run" ? { ok: true, value: handle }
        : fail ? { ok: true, value: failure, stopped: false, error: failure._0 }
        : { ok: true, value: { $tag: "Nothing" }, stopped: true };
    },
  });
  await controller.dispatch("run");
  expect(controller.state()).toEqual({ kind: "success", value: handle });
  await controller.dispatch("stop");
  expect(controller.state()).toEqual({ kind: "error", message: failure._0, value: failure });
  expect(controller.canStop()).toBe(true);
  fail = false;
  await controller.dispatch("stop");
  expect(calls).toEqual([[], [handle], [handle]]);
  expect(controller.canStop()).toBe(false);
  expect(controller.state()).toEqual({ kind: "idle" });
});

test("HTTP success alone cannot discard a deployment handle", async () => {
  const controller = createIOCallController({
    info: () => ({ fnId: "deploy", args: [], stopAction: "undeploy" }),
    evaluate: (value) => value,
    invoke: async () => ({ ok: true, value: "deployment-id" }),
  });
  await controller.dispatch("run");
  await controller.dispatch("stop");
  expect(controller.state()).toMatchObject({ kind: "error", message: "Stop did not confirm successful completion." });
  expect(controller.canStop()).toBe(true);
});

test("an ordinary Result-valued run retains its typed display", async () => {
  const result = { $tag: "Err", _0: "ordinary application result" };
  const controller = createIOCallController({
    info: () => ({ fnId: "calculate", args: [] }),
    evaluate: (value) => value,
    invoke: async () => ({ ok: true, value: result }),
  });
  await controller.dispatch("run");
  expect(controller.state()).toEqual({ kind: "success", value: result });
  expect(controller.canStop()).toBe(false);
});
