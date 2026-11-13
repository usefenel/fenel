// ---------------------------------------------------------------------------
// module-migrate-state.test.ts — typed-function-references FenelModule-
// retirement Phase FM-retire-8 Step 1 parity proof.
//
// The 142 portable `state:*` bodyless IO leaves were lifted from hand-wrapped
// `defineFunction` specs in state.ts to `fenel/modules/state/io-leaves.fenel`
// (`module state where` — the telegram/io.fenel mechanic) and merged back in via
// `loadFenelModule`. Importing `stateModule` runs the loader at module-eval time,
// so a parse error in the `.fenel` fails this file.
//
// Pins the substrate outcome of the bulk port:
//   - the 142 ported leaves register under the `state:` id-prefix, each bodyless
//     (the `@native` bodyless foreign-decl), `@ioAction "state.*"` + `@requires
//     "HasStateIO"` byte-faithful, Codeable codeName === the unprefixed id, with
//     Labelable / Describable / Taggable identity, and NO stored Categorizable
//     (Phase-3j read-time derives the category from the `state:` id prefix).
//   - FM-retire-10 (2026-06-07): the 4 dependent-typing fns (schemaOf /
//     typeclassMethodsSchema / tryCreateInstanceByName / registerRepresentation)
//     ALSO ported to io-leaves.fenel once two parser extensions gave them a sig
//     surface — Ext1 = the `Type` type-atom (`-> Type` ⇒ `{$type:true}`), Ext2 =
//     the lowercase-headed `$el` dependent param (`value : schemaOf typeId` ⇒
//     `{$el:{call:["schemaOf",{var:"typeId"}]}}`). state.ts is now a pure loader
//     at 0 `defineFunction`; all 146 `state:*` fns are `.fenel`-authored.
//
// crypto:* / dispatch:* residuals are NOT asserted here — they ride their own
// oracles (Steps 2-3 spin them out). This oracle keys only on `state:*`.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { stateModule } from "./modules/state";
import type { Instance, FenelFunction } from "./types";

// FM-retire-10 — the 4 dependent-typing fns are now ALSO `.fenel`-authored
// leaves; kept as a named roster only for the dependent-typing showcase block.
const DEPENDENT = [
  "state:schemaOf",
  "state:typeclassMethodsSchema",
  "state:tryCreateInstanceByName",
  "state:registerRepresentation",
];
const STATE_IO: NonNullable<FenelFunction["requires"]> = [
  { class: { $tag: "Id", entityId: "HasStateIO" }, args: [{ $var: "scope" }] },
];

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

const fns = stateModule.functions ?? [];
const insts = stateModule.instances ?? [];
const stateFns = fns.filter((f) => f.id.startsWith("state:"));
// Preserve the old port's facet oracle without requiring new leaves to extend
// legacy annotation shorthand. The personal leaf uses its canonical act id.
const ported = stateFns.filter((fn) => fn.id !== "state:ensurePersonalAccount");

describe("state migration — header-driven identity + roster", () => {
  test("the `module state where` header is authoritative (module name = `state`)", () => {
    expect(stateModule.name).toBe("state");
  });

  // forms-collapse Phase 4 Stage 3 — findFormBySlug + storeFormSubmission RETIRED
  // (the forms surface is gone), so 146 → 144 state:* leaves.
  // storage-as-effect Phase 4a — createPageSubmission RETIRED (the page-submit
  // lane captures via state:tryCreateInstanceByName now), so 144 → 143.
  // The old count missed readLocusRoot, editLocusRoot and setFunctionActive.
  // Personal identity adds one new canonical leaf to those 148 existing ones.
  test("the state roster includes the canonical personal-account identity leaf", () => {
    expect(stateFns.length).toBe(149);
    expect(ported.length).toBe(148);
    const personal = stateFns.find((fn) => fn.id === "state:ensurePersonalAccount")!;
    expect(personal.params.map((param) => param.name)).toEqual(["userId", "candidateAccount", "candidateMembership"]);
    expect(personal.body).toBeUndefined();
    expect(personal.requires).toEqual(STATE_IO);
    expect(methodOf(insts, "Codeable", personal.id)).toEqual({ codeName: "ensurePersonalAccount" });
    expect(methodOf(insts, "IOInvokable", personal.id)).toBeUndefined();
  });

  test("catalog revisions remain an account-scoped State IO capability", () => {
    const fn = stateFns.find((candidate) => candidate.id === "state:catalogReadRevision")!;
    expect(fn.params.map((param) => param.name)).toEqual(["catalog"]);
    expect(fn.params[0]!.type).toEqual({ $ref: "String" });
    expect(fn.returns).toEqual({ $ref: "String" });
    expect(fn.requires).toEqual(STATE_IO);
    expect(methodOf(insts, "IOInvokable", fn.id)).toEqual({ ioAction: "state.catalog_read_revision" });
  });

  test("the 4 dependent-typing fns are registered (now `.fenel`-authored leaves — state.ts at 0 defineFunction)", () => {
    for (const id of DEPENDENT) {
      expect(stateFns.find((f) => f.id === id)).toBeDefined();
    }
  });

  test("the `.fenel` leaves are bodies-only — no extra entities leaked from the port", () => {
    // The io-leaves.fenel declares only function sigs; entities come from the
    // type registry, not this seam.
    expect((stateModule.entities ?? []).length).toBe(0);
  });
});

describe("state migration — the 142 ported leaves are bodyless IO with HasStateIO + facet parity", () => {
  test("every ported leaf is bodyless (the `@native` bodyless foreign-decl)", () => {
    expect(ported.filter((f) => (f as { body?: unknown }).body !== undefined).map((f) => f.id)).toEqual([]);
  });

  test("every ported leaf carries `@requires \"HasStateIO\"` byte-identically", () => {
    for (const f of ported) {
      expect((f as { requires?: unknown }).requires).toEqual(STATE_IO as never);
    }
  });

  test("every ported leaf carries `@ioAction \"state.*\"` (IOInvokable)", () => {
    for (const f of ported) {
      const io = methodOf(insts, "IOInvokable", f.id) as { ioAction?: string } | undefined;
      expect(typeof io?.ioAction).toBe("string");
      expect(io?.ioAction?.startsWith("state.")).toBe(true);
    }
  });

  test("every ported leaf's Codeable codeName === the unprefixed id", () => {
    for (const f of ported) {
      const suffix = f.id.slice("state:".length);
      expect(methodOf(insts, "Codeable", f.id)).toEqual({ codeName: suffix });
    }
  });

  test("every ported leaf carries Labelable + Describable + Taggable identity", () => {
    for (const f of ported) {
      expect(methodOf(insts, "Labelable", f.id)).toBeDefined();
      expect(methodOf(insts, "Describable", f.id)).toBeDefined();
      expect(methodOf(insts, "Taggable", f.id)).toBeDefined();
    }
  });

  test("NO stored Categorizable on any ported leaf (3j read-time: category derives from the `state:` id prefix)", () => {
    for (const f of ported) {
      expect(methodOf(insts, "Categorizable", f.id)).toBeUndefined();
    }
  });
});

describe("state migration — spot-checks (the named leaves the orchestrators call by id)", () => {
  function leaf(id: string): FenelFunction | undefined {
    return ported.find((f) => f.id === id);
  }

  test("pinToView keeps its Iconable + Emojiable facets across the port", () => {
    expect(leaf("state:pinToView")).toBeDefined();
    expect(methodOf(insts, "Iconable", "state:pinToView")).toEqual({ icon: "pin" });
    expect(methodOf(insts, "Emojiable", "state:pinToView")).toEqual({ emoji: "📌" });
  });

  test("the core persistence leaves are present (createInstance / getInstance / updateInstance / appendEvent / listInstances)", () => {
    for (const id of [
      "state:createInstance",
      "state:getInstance",
      "state:updateInstance",
      "state:appendEvent",
      "state:listInstances",
    ]) {
      expect(leaf(id)).toBeDefined();
    }
  });

  test("the `where`-named param leaf (listInstances) ported cleanly (the parser soft-keyword fix)", () => {
    const f = leaf("state:listInstances");
    expect(f?.params.map((p) => p.name)).toEqual(["typeId", "where"]);
  });
});

// ===========================================================================
// FM-retire-10 — the dependent-sig showcase. The 4 type-level leaves authored
// their dependent signatures in `.fenel` surface syntax via Ext1 (`Type`
// type-atom) + Ext2 (lowercase-headed `$el` dependent param). These assertions
// pin the EXACT loaded shapes — the "Fenel dependent types authored in surface
// syntax" milestone (audit §2).
// ===========================================================================

describe("state FM-retire-10 — the dependent-sig surface (Ext1 `Type` + Ext2 `$el`)", () => {
  function leaf(id: string): FenelFunction | undefined {
    return stateFns.find((f) => f.id === id);
  }

  test("Ext1 — schemaOf / typeclassMethodsSchema RETURN `{$type:true}` (the `Type` type-atom)", () => {
    expect(leaf("state:schemaOf")?.returns).toEqual({ $type: true } as never);
    expect(leaf("state:typeclassMethodsSchema")?.returns).toEqual({ $type: true } as never);
  });

  test("Ext1 — schemaOf's param is `EntityRef<entity_definition>` (the Id phantom)", () => {
    const p = leaf("state:schemaOf")?.params?.[0];
    expect(p?.name).toBe("typeId");
    expect((p?.type as { $tagged?: { phantom?: { $refined?: { set?: unknown } } } }).$tagged?.phantom?.$refined?.set)
      .toEqual({ $tag: "SeEnum", values: ["entity_definition"] });
  });

  test("Ext2 — tryCreateInstanceByName.value is EXACTLY `{$el:{call:[\"schemaOf\",{var:\"typeId\"}]}}`", () => {
    const f = leaf("state:tryCreateInstanceByName");
    expect(f?.params.map((p) => p.name)).toEqual(["typeId", "value"]);
    expect(f?.params?.[1]?.type).toEqual({ $el: { call: ["schemaOf", { var: "typeId" }] } } as never);
  });

  test("Ext2 — registerRepresentation.methods is EXACTLY `{$el:{call:[\"typeclassMethodsSchema\",{var:\"typeName\"}]}}`", () => {
    const f = leaf("state:registerRepresentation");
    expect(f?.params.map((p) => p.name)).toEqual(["targetId", "typeName", "methods"]);
    expect(f?.params?.[2]?.type).toEqual({ $el: { call: ["typeclassMethodsSchema", { var: "typeName" }] } } as never);
  });

  test("Decision B — tryCreateInstanceByName's return is the tightened Result record (not the empty-record placeholder)", () => {
    const ret = leaf("state:tryCreateInstanceByName")?.returns as { $record?: { fields?: Array<{ name: string }> } };
    expect(ret.$record?.fields?.map((f) => f.name)).toEqual(["ok", "value", "error"]);
  });
});
