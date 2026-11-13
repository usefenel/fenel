// ---------------------------------------------------------------------------
// module-migrate-notify.test.ts — typed-function-references FenelModule-
// retirement Phase FM-retire-7 Step 2 parity proof.
//
// `notify:sendTgDm` was the lone surviving `defineFunction` in telegram.ts — a
// `notify:`-prefixed action body hand-hosted in the telegram module. Step 2
// spins it out to its own minimal `notify` module (engine/src/modules/notify.ts
// over `module notify where` tg-dm.fenel + a thin `loadFenelModule`, the
// email-webhooks precedent). Importing `notifyModule` runs the loader at
// module-eval time, so a parse error in the `.fenel` fails this file.
//
// Pins the substrate outcome: the 6 fns register under the `notify:` id-prefix
// (sendTgDm's id `notify:sendTgDm` is byte-identical to the retired spec id →
// the core/actions consumer needs 0 edits); sendTgDm carries its `.fenel` body +
// facet parity (label/description/tags) + `@ioAction "notify.send_tg_dm"` +
// `@requires "HasStateIO"`; @category is OMITTED (category "notify" === the
// `notify:` id prefix → the Phase-3j read-time-derives rule, so NO stored
// Categorizable); the 5 helpers ride Codeable-only.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { notifyModule } from "./modules/notify";
import type { Instance } from "./types";

const ENTRY = "notify:sendTgDm";
const HELPERS = [
  "notify:isTelegramPlatform",
  "notify:pickTgRow",
  "notify:handleStrForEvent",
  "notify:deliverIfNonEmpty",
  "notify:deliverWithHandle",
];
const STATE_IO = [
  { class: { $tag: "Id", entityId: "HasStateIO" }, args: [{ $var: "scope" }] },
];

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

const fns = notifyModule.functions ?? [];
const insts = notifyModule.instances ?? [];

describe("notify migration — header-driven identity + roster", () => {
  test("the `module notify where` header is authoritative (module name = `notify`)", () => {
    expect(notifyModule.name).toBe("notify");
  });

  test("the 6 fns register under the `notify:` id-prefix (entry + 5 helpers)", () => {
    expect(fns.map((f) => f.id).sort()).toEqual([ENTRY, ...HELPERS].sort());
  });

  test("the module declares no entities (tg-dm.fenel is bodies-only)", () => {
    expect((notifyModule.entities ?? []).length).toBe(0);
  });

  test("every fn carries its `.fenel` body (0 bodyless)", () => {
    expect(fns.filter((f) => !f.body).map((f) => f.id)).toEqual([]);
  });
});

describe("notify migration — sendTgDm identity + IO wiring (byte-identity vs the retired spec)", () => {
  test("Codeable codeName is the unprefixed `sendTgDm`", () => {
    expect(methodOf(insts, "Codeable", ENTRY)).toEqual({ codeName: "sendTgDm" });
  });

  test("Labelable / Describable / Taggable parity", () => {
    expect(methodOf(insts, "Labelable", ENTRY)).toEqual({ label: "Send Telegram DM (action body)" });
    expect(methodOf(insts, "Taggable", ENTRY)).toEqual({ tags: ["notify", "telegram", "dm", "action", "phase-14a"] });
    const d = methodOf(insts, "Describable", ENTRY) as { description?: string } | undefined;
    expect(typeof d?.description).toBe("string");
    expect((d?.description ?? "")).toContain("Fenel-bodied tg_dm action body");
  });

  test("IOInvokable carries `notify.send_tg_dm`", () => {
    expect(methodOf(insts, "IOInvokable", ENTRY)).toEqual({ ioAction: "notify.send_tg_dm" });
  });

  test("`@requires \"HasStateIO\"` preserved byte-identically", () => {
    const entry = fns.find((f) => f.id === ENTRY);
    expect((entry as { requires?: unknown }).requires).toEqual(STATE_IO as never);
  });

  test("NO stored Categorizable (3j read-time: category derives from the `notify:` id prefix)", () => {
    expect(methodOf(insts, "Categorizable", ENTRY)).toBeUndefined();
  });
});

describe("notify migration — the 5 helpers ride Codeable-only", () => {
  test("each helper has a body + a Codeable, and NO Labelable/Describable/Taggable/Categorizable", () => {
    for (const id of HELPERS) {
      expect(fns.find((f) => f.id === id)?.body).toBeDefined();
      expect(methodOf(insts, "Codeable", id)).toBeDefined();
      expect(methodOf(insts, "Labelable", id)).toBeUndefined();
      expect(methodOf(insts, "Describable", id)).toBeUndefined();
      expect(methodOf(insts, "Taggable", id)).toBeUndefined();
      expect(methodOf(insts, "Categorizable", id)).toBeUndefined();
    }
  });
});
