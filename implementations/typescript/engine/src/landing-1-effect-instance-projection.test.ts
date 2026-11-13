import { describe, expect, test } from "bun:test";
import { loadFenelModule } from "./fenel-module";
import { createRegistry } from "./registry";
import EFFECT_INSTANCES_FENEL from "../../../../fenel/std/dispatch-instances.fenel?raw";
import { GLOBAL_ONLY } from "./dispatch-registry";

// rights R3a commit 1 (THE RETAG) — the seven runtime effect dictionaries are
// boot-DECLARED repository rows, not rows any account owns. They used to be
// authored `scope = "account"`, which the loader lifted to `{kind:"tag",
// tag:"account"}`; no production frame has ever populated `_activeTags`, so the
// visibility predicate already hid them and IO worked only because the durable
// arm resolved UNFILTERED. Retagging BEFORE the fence is what makes the fence
// safe; filtering first would have been a total silent IO outage.
const BOOT_SCOPE = { kind: "global" } as const;
const HAS_STATE_IO_METHODS = {
  loadType: "state.load_type",
  schemaOf: "state.schema_of",
  createInstance: "state.create_instance",
  updateInstance: "state.update_instance",
  appendEvent: "state.append_event",
  getInstance: "state.get_instance",
  listInstances: "state.list_instances",
  tryCreateInstanceByName: "state.try_create_instance_by_name",
  pinToView: "state.pin_to_view",
} as const;

describe("Landing 1 A1 — Fenel-authored runtime effect instances", () => {
  test("projects authored scope metadata without leaking it into methods", () => {
    const source = [
      'accountLog : HasLog "account"',
      'accountLog = HasLog { log = "log", scope = "global" }',
    ].join("\n");
    const instances = loadFenelModule(source, "probe", {
      dispatchInstanceFile: true,
    }).instances ?? [];

    expect(instances).toEqual([
      {
        typeName: "HasLog",
        args: ["account"],
        methods: { log: "log" },
        scope: BOOT_SCOPE,
      },
    ]);
  });

  test("loads every account runtime effect dictionary as scoped descriptor data", () => {
    const projected = loadFenelModule(EFFECT_INSTANCES_FENEL, "std", {
      dispatchInstanceFile: true,
    }).instances ?? [];
    const expected = [
      ["HasRandom", { uuid: { $ref: "crypto.uuidV4" } }],
      [
        "HasStateIO",
        HAS_STATE_IO_METHODS,
      ],
      [
        "HasTelegramBot",
        {
          runCollector: "telegram_collector.run",
          stopCollector: "telegram_collector.stop",
          handleUpdate: "telegram_collector.handle_update",
          findBotById: "telegram.find_bot_by_id",
          sendMessageText: "telegram.send_message_text",
          sendFieldPrompt: "telegram.send_field_prompt",
        },
      ],
      [
        "HasIO",
        {
          read: "read",
          sleep: "sleep",
          wait: "wait",
          end_function: "end_function",
          emit: "emit",
          call_function: "call_function",
        },
      ],
      ["HasHTTP", { request: "http_request" }],
      [
        "HasControlFlow",
        {
          retry: "retry",
          with_timeout: "with_timeout",
          on_error: "on_error",
          bracket: "bracket",
          parallel: "parallel",
          race: "race",
          any: "any",
          for_each: "for_each",
        },
      ],
      ["HasLog", { log: "log" }],
    ] as const;

    for (const [typeName, methods] of expected) {
      const matches = projected.filter(
        (instance) => instance.typeName === typeName
          && instance.args.length === 1
          && instance.args[0] === "account",
      );
      expect(matches, `${typeName} account instance`).toHaveLength(1);
      expect(matches[0]).toEqual({
        typeName,
        args: ["account"],
        methods,
        scope: BOOT_SCOPE,
      });
    }

    const uuidRef = expected[0][1].uuid;
    expect(uuidRef).toEqual({ $ref: "crypto.uuidV4" });
  });

  // §6 pin 23 — THE LOADER REFUSES A BARE-`account` SIDECAR, and still admits
  // `global` and a genuine tag. After R3a, account ownership is DERIVED from the
  // writing frame's authenticated authority and is never authorable; a sidecar
  // claiming it is a LOAD ERROR rather than a silently-invisible row.
  test("a dispatch-instance sidecar may not author the `account` scope", () => {
    const refused = [
      'accountLog : HasLog "account"',
      'accountLog = HasLog { log = "log", scope = "account" }',
    ].join("\n");
    expect(() =>
      loadFenelModule(refused, "probe", { dispatchInstanceFile: true }),
    ).toThrow(/`account` is not an authorable scope/);

    // POSITIVE CONTROL 1 — `global` still lifts to the global spelling.
    const globalSidecar = [
      'bootLog : HasLog "account"',
      'bootLog = HasLog { log = "log", scope = "global" }',
    ].join("\n");
    expect(
      (loadFenelModule(globalSidecar, "probe", { dispatchInstanceFile: true }).instances ?? [])[0]?.scope,
    ).toEqual({ kind: "global" });

    // POSITIVE CONTROL 2 — a GENUINE tag (one nobody activates today, but a
    // legal coordinate) still lifts to the tag spelling. R3a does not retire
    // the tag axis (that is UDC Phase 7); it retires the bare `account` string.
    const tagSidecar = [
      'experimentLog : HasLog "account"',
      'experimentLog = HasLog { log = "log", scope = "beta-cohort" }',
    ].join("\n");
    expect(
      (loadFenelModule(tagSidecar, "probe", { dispatchInstanceFile: true }).instances ?? [])[0]?.scope,
    ).toEqual({ kind: "tag", tag: "beta-cohort" });

    // POSITIVE CONTROL 3 — an ORDINARY typed record constant is still allowed a
    // real data field named `scope`; the refusal is gated on
    // `dispatchInstanceFile`, exactly as the lift it guards is.
    expect(() =>
      loadFenelModule(refused, "probe", { dispatchInstanceFile: false }),
    ).not.toThrow();
  });

  test("the declared HasStateIO roster retains all nine authored descriptors at resolution", async () => {
    const { dispatchRegistry } = await import("./system-entities");
    expect(
      dispatchRegistry.getClass("HasStateIO")?.methods.map((method) => method.name),
    ).toEqual([
      "createInstance",
      "getInstance",
      "updateInstance",
      "listInstances",
      "appendEvent",
      "loadType",
      "schemaOf",
      "tryCreateInstanceByName",
      "pinToView",
    ]);

    const resolved = dispatchRegistry.resolve("account", "HasStateIO", GLOBAL_ONLY);
    expect(resolved).toBeDefined();
    expect({ ...resolved }).toEqual(HAS_STATE_IO_METHODS);
  }, 60_000);

  test("resolves the authored dotted UUID reference to its canonical function", async () => {
    const projected = loadFenelModule(EFFECT_INSTANCES_FENEL, "std", {
      dispatchInstanceFile: true,
    }).instances ?? [];
    const random = projected.find(
      (instance) => instance.typeName === "HasRandom"
        && instance.args[0] === "account",
    );
    const uuidRef = random?.methods.uuid as { $ref?: unknown } | undefined;
    expect(uuidRef).toEqual({ $ref: "crypto.uuidV4" });
    if (typeof uuidRef?.$ref !== "string") {
      throw new Error("HasRandom.uuid did not project to a function reference");
    }

    // Dynamic module imports match the crypto registry oracle and avoid the
    // catalog's static-initialisation cycle.
    const { stdModule } = await import("./modules/std");
    const { cryptoModule } = await import("./modules/crypto");
    const reg = createRegistry([stdModule, cryptoModule]);
    expect(reg.getFunction(uuidRef.$ref)?.id).toBe("crypto:uuidV4");
  }, 60_000);
});
