// ---------------------------------------------------------------------------
// rights R3a — account-owned dispatch: the engine-side pins.
//
// The brief is `workstreams/rights/briefs/r3a-account-partitioned-dispatch.md`.
// Every pin here observes a BEHAVIOUR, names the mechanism whose neuter reddens
// it, and reads the PRODUCTION object wherever the production object is what
// the claim is about. The instrument law (§6 R0.5): expected values are source
// literals, every negative ships a positive control, and a mutant that does not
// compile — or that a decode already refuses — is NOT a neuter.
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";

describe("rights R3a — the retag (commit 1)", () => {
  // §6 pin 1 — THE RETAG CHANGES AVAILABILITY, asserted by the IDENTITY of the
  // selected instance rather than "something resolved".
  //
  // Before the retag the seven runtime effect dictionaries were
  // `{kind:"tag", tag:"account"}` and no production frame populates
  // `_activeTags`, so `instanceVisible` already hid them from every
  // ctx-carrying selection; IO worked only because the durable arm resolved
  // UNFILTERED. Retag first, fence second — the reverse order is a total silent
  // IO outage (§12 trap 1).
  //
  // Neuter (the ONLY one): perturb the PRODUCTION sidecar back to
  // `scope = "account"` and restore it. RED: nothing resolves under a no-tag
  // frame.
  test("pin 1 — a no-tag frame selects the boot HasStateIO dictionary by identity", async () => {
    const { dispatchRegistry } = await import("./system-entities");
    const { resolveEffect } = await import("./effect-dispatch");

    const noTagFrame = { natives: {}, _activeTags: [] as string[] };
    const resolved = resolveEffect(noTagFrame, dispatchRegistry, "HasStateIO", "account");
    expect(resolved).toBeDefined();
    expect(resolved!.source.kind).toBe("instance");
    if (resolved!.source.kind !== "instance") throw new Error("unreachable");
    const selected = resolved!.source.instance;

    // IDENTITY of the selected row — the authored boot dictionary, at the boot
    // (global) spelling, carrying the nine authored descriptors.
    expect(selected.typeName).toBe("HasStateIO");
    expect(selected.args).toEqual(["account"]);
    expect(selected.scope).toEqual({ kind: "global" });
    expect({ ...selected.methods }).toEqual({
      loadType: "state.load_type",
      schemaOf: "state.schema_of",
      createInstance: "state.create_instance",
      updateInstance: "state.update_instance",
      appendEvent: "state.append_event",
      getInstance: "state.get_instance",
      listInstances: "state.list_instances",
      tryCreateInstanceByName: "state.try_create_instance_by_name",
      pinToView: "state.pin_to_view",
    });
  }, 120_000);

  // POSITIVE CONTROL for pin 1 — NOT a neuter. A `{kind:"tag", tag:"account"}`
  // row at a STRICTLY HIGHER priority is still gated off a no-tag frame by the
  // EXISTING tag logic, so the retagged global row keeps winning. This shows
  // tags stay gated and nothing more. (An EQUAL-priority append could never
  // displace the first-registered row anyway — `addInstance` appends and the
  // sort is stable — which is why the control uses a strictly higher priority.)
  test("pin 1 control — a higher-priority tag row stays gated off a no-tag frame", async () => {
    const { createDispatchRegistry } = await import("./dispatch-registry");
    const { resolveEffect } = await import("./effect-dispatch");
    const { dispatchRegistry } = await import("./system-entities");

    const probe = createDispatchRegistry();
    const cls = dispatchRegistry.getClass("HasStateIO");
    if (cls) probe.defineClass(cls);
    probe.addInstance({
      typeName: "HasStateIO",
      args: ["account"],
      methods: { loadType: "boot.marker" },
      scope: { kind: "global" },
    });
    probe.addInstance({
      typeName: "HasStateIO",
      args: ["account"],
      methods: { loadType: "tag.marker" },
      scope: { kind: "tag", tag: "account" },
      priority: 9_999,
    });

    const noTagFrame = { natives: {}, _activeTags: [] as string[] };
    const resolved = resolveEffect(noTagFrame, probe, "HasStateIO", "account");
    if (resolved?.source.kind !== "instance") throw new Error("expected an instance");
    expect(resolved.source.instance.methods["loadType"]).toBe("boot.marker");

    // ... and the SAME row wins the moment the tag is active, which is what
    // makes the gate the explanation rather than an accident of ordering.
    const taggedFrame = { natives: {}, _activeTags: ["account"] };
    const tagged = resolveEffect(taggedFrame, probe, "HasStateIO", "account");
    if (tagged?.source.kind !== "instance") throw new Error("expected an instance");
    expect(tagged.source.instance.methods["loadType"]).toBe("tag.marker");
  }, 120_000);
});
