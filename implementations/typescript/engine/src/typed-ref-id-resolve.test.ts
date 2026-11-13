// ---------------------------------------------------------------------------
// typed-ref-id-resolve.test.ts — typed-function-references Phase 8c proof.
//
// 8c is the resolution-as-dispatch step of the `Id<X>` ⇄ `ref` fold. This file
// covers what 8c LANDED:
//
//   Step 1 (LANDED) — `state:getInstanceByName`, the CodeableName persistence
//     leaf. 8a declared the `Identifiable CodeableName` instance with a resolve
//     target `Ref("state:getInstanceByName")` that NAMED A FUNCTION THAT DID NOT
//     EXIST (the 8a GAP, TODO.md:917). Step 1 creates it (spec + IO handler + DB
//     leaf), so BOTH handle-kind instances now name registered functions. This
//     is the pure-additive half — proven 0-delta against the gate.
//
//   Steps 2–4 (DEFERRED, with a documented blocker) — the resolution FLIP (make
//     `Identifiable.resolve` the live deref path) does NOT land here. The audit
//     found there is no generic two-armed `Id<X>` deref bridge to retire — every
//     deref is an explicit `getInstance <typeName> <id>` leaf call whose handle
//     kind is statically UUID — AND the existing value-type dispatch substrate
//     keys on `typeConstructorOf(handle)`, which is `"String"` for EVERY handle
//     value, so it cannot select the `UUID` vs `CodeableName` instance from the
//     runtime value alone. So the class STAYS INERT (the 8a INERT assertions in
//     typed-ref-id-builder.test.ts remain TRUE and are NOT flipped). See the
//     roadmap's Phase-8c completion notes for the full finding + recommendation.
//
// Brief: workstreams/.../briefs/phase-8c-resolution-as-dispatch.md.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { Maybe, Ref, isRef } from "./type-foundation";
import { stateModule } from "./modules/state";
import { createRegistry } from "./registry";
import { dispatchRegistry } from "./system-entities";
import type { FenelFunction, Instance } from "./types";

const stateFns = stateModule.functions as FenelFunction[];
const fnById = (id: string) => stateFns.find((f) => f.id === id);
// A `{$ref}` handle is UUID-or-codeableName (typed-function-references Phase
// 6/7): resolution mirrors dispatch's `getFunction` (id-or-codeName) at call
// time — built over the state module so the Codeable reverse-lookup is wired.
const stateReg = createRegistry([stateModule]);
const fnByRef = (ref: string) => stateReg.getFunction(ref);
// Phase 10 moved the two Identifiable instances to `.fenel`; read them from the
// registry instead of the (now-deleted) TS consts.
const identifiableByArg = (arg: string): Instance =>
  ([...dispatchRegistry.listInstances("Identifiable")] as Instance[]).find(
    (i) => i.args[0] === arg,
  )!;
const uuidIdentifiable = identifiableByArg("UUID");
const codeableNameIdentifiable = identifiableByArg("CodeableName");

// ---------------------------------------------------------------------------
// Step 1 — the new CodeableName persistence leaf is registered.
// ---------------------------------------------------------------------------

describe("Phase 8c Step 1 — state:getInstanceByName exists", () => {
  test("the spec is registered in the state module", () => {
    const fn = fnById("state:getInstanceByName");
    expect(fn, "state:getInstanceByName must exist (8a GAP closed)").toBeDefined();
  });

  test("params are [codeName, entityType-narrowing] and the return honors Maybe", () => {
    const fn = fnById("state:getInstanceByName")!;
    expect(fn.params.map((p) => p.name)).toEqual(["codeName", "entityType"]);
    // codeName is a plain String handle; entityType is the optional narrowing.
    expect(fn.params[0]!.type).toEqual({ $ref: "String" });
    expect(fn.params[1]!.type).toEqual(Maybe({ $ref: "String" }));
    // Maybe<envelope> — the IO-handler return-type contract (Just/Nothing),
    // shape-symmetric with getInstanceById so resolve is uniform across kinds.
    expect(fn.returns).toEqual(Maybe({ $record: { fields: [] } }));
  });

  test("shape-symmetric with getInstanceById (the UUID sibling)", () => {
    const byName = fnById("state:getInstanceByName")!;
    const byId = fnById("state:getInstanceById")!;
    expect(byName.returns).toEqual(byId.returns);
  });
});

// ---------------------------------------------------------------------------
// The 8a GAP is closed: BOTH Identifiable instances name registered functions.
// ---------------------------------------------------------------------------

describe("Phase 8c Step 1 — both handle kinds resolve to real functions", () => {
  test("UUID instance → getInstanceById (registered)", () => {
    const m = uuidIdentifiable.methods.resolve;
    expect(isRef(m)).toBe(true);
    // Phase 10: `.fenel`-authored point-free `resolve = getInstanceById` → the
    // codeableName handle `{$ref:"getInstanceById"}` (was the fnId handle
    // `Ref("state:getInstanceById")` as a TS const). Resolves to the same fn.
    expect(m).toEqual(Ref("getInstanceById"));
    expect(fnByRef((m as { $ref: string }).$ref), "named fn must resolve").toBeDefined();
    expect(fnByRef((m as { $ref: string }).$ref)!.id).toBe("state:getInstanceById");
  });

  test("CodeableName instance → getInstanceByName (registered — 8a GAP closed)", () => {
    const m = codeableNameIdentifiable.methods.resolve;
    expect(isRef(m)).toBe(true);
    expect(m).toEqual(Ref("getInstanceByName"));
    // Before 8c this {$ref} named a NON-EXISTENT function (the 8a GAP). Now it
    // resolves — the CodeableName resolve target is a real persistence leaf.
    expect(fnByRef((m as { $ref: string }).$ref), "named fn must resolve").toBeDefined();
    expect(fnByRef((m as { $ref: string }).$ref)!.id).toBe("state:getInstanceByName");
  });
});

// ---------------------------------------------------------------------------
// The class STAYS INERT — the resolution flip (Steps 2–4) is deferred. Step 1
// wired NO consumer to Identifiable; the resolve methods are still typed {$ref}
// consts, unchanged. (The opaque deref still flows through the explicit
// getInstance leaf calls / phantomEntityName, NOT a `resolve` dispatch — see the
// builder test's INERT pin, which remains valid.)
// ---------------------------------------------------------------------------

describe("Phase 8c — resolution flip DEFERRED, class still inert", () => {
  test("resolve methods are still typed {$ref} consts (no dispatch wiring added)", () => {
    expect(isRef(uuidIdentifiable.methods.resolve)).toBe(true);
    expect(isRef(codeableNameIdentifiable.methods.resolve)).toBe(true);
  });
});
