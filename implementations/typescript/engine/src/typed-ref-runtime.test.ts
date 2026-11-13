// ---------------------------------------------------------------------------
// typed-ref-runtime.test.ts — typed-function-references Phase 2 proof.
//
// Phase 2 introduces the general, id-backed, **type-transparent** reference
// value `{$ref: id}` (the `Ref` substrate) and wires the FUNCTION case end-to-
// end while keeping the legacy bare-string callable working (back-compat — a
// later phase removes the string arm).
//
// This test pins, against a registry built from [std]:
//   • the ONE producer flipped in Phase 2 (bare-ident `{var:"abs"}` → `{$ref}`)
//   • the consume path: `invokeCallable` applies a `{$ref}` (full + partial)
//   • the HOF VALUE positions take a `{$ref}` (call/apply value, |>, pipe step,
//     std:map / std:filter), while a call HEAD keeps the literal string
//   • η-reduction applies a returned `{$ref}`
//
// Phase 5 (clean break) UPDATE: the bare-string callable-VALUE arm is retired.
// `invokeCallable("abs", …)` now returns null; `|>` with a bare-string right is
// rejected. The call HEAD (`{call:["add",…]}`, a literal `pipe` step) keeps the
// string until Phase 6. The flipped assertions are marked `FLIPPED (Phase 5)`.
//   • `refType` resolves a `{$ref}` to the referent's `$arrow`; unresolvable
//     ids degrade gracefully (no throw at apply; `{$void}` from `refType`)
//
// Canonical spec: design/typed-function-references.md ("References — the `Ref`
// substrate").
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { stdModule } from "./modules/std";
import { createRegistry } from "./registry";
import { evaluate, invokeCallable } from "./json-logic";
import { Ref, isRef, refType } from "./type-foundation";
import { getCatalog, getEntityTypeByName } from "./type-catalog";
import { loadLock } from "./codename-lock";
import type { FenelType } from "./types";

// Phase 6 (typed-function-references) — build WITH the codeName↔UUID lock so
// each std function gains its opaque UUID identity (registry-local, via
// `getUuid` — NOT a field on the shared spec) and a `{$ref:uuid}` resolves
// through the dual-registered registry. The bare-ident producer (`resolveVar`)
// now emits the UUID, so the assertions resolve the identity via `getUuid` (the
// handle), with the codeName ("abs") a Codeable projection over it.
const reg = createRegistry([stdModule], { codeNameLock: loadLock() });
const ctx = reg.evaluateContext();

const absId = reg.getUuid("abs")!;
const addId = reg.getUuid("add")!;
const negateId = reg.getUuid("negate")!;
const gtId = reg.getUuid("gt")!;
const mapId = reg.getUuid("map")!;
const filterId = reg.getUuid("filter")!;

describe("Phase 2 — bare-ident producer flips to {$ref}", () => {
  test("`{var:'abs'}` resolves to a typed reference, not the bare string", () => {
    const v = evaluate({ var: "abs" }, {}, ctx);
    expect(isRef(v)).toBe(true);
    expect(v).toEqual({ $ref: absId });
  });

  test("the handle is the opaque UUID identity even when the user typed the codeName", () => {
    // `abs`'s codeName is "abs"; its UUID identity is `absId`. The ref carries
    // the UUID (Phase 6), not the slug — the codeName is a Codeable projection.
    expect((evaluate({ var: "abs" }, {}, ctx) as { $ref: string }).$ref).toBe(absId);
  });

  test("a bare-ident the registry does NOT know stays a plain miss (fallback)", () => {
    expect(evaluate({ var: "definitelyNotAFunction" }, {}, ctx)).toBe(null);
  });
});

describe("Phase 2 — invokeFunction consumes {$ref} (full + partial)", () => {
  test("full application of a {$ref} callable", () => {
    expect(invokeCallable(Ref(addId), [2, 3], ctx)).toBe(5);
  });

  test("partial application of a {$ref} callable, then completion", () => {
    const partial = invokeCallable(Ref(addId), [2], ctx);
    // Under-applied → a partial sentinel, not a final value.
    expect(typeof partial === "object" && partial !== null).toBe(true);
    expect(invokeCallable(partial, [3], ctx)).toBe(5);
  });

  test("unary {$ref} application", () => {
    expect(invokeCallable(Ref(negateId), [7], ctx)).toBe(-7);
  });
});

describe("Phase 5 — HOF VALUE positions take {$ref}; the call HEAD keeps the string", () => {
  // Phase 5 clean break: a function passed AS A VALUE (HOF callback, `|>` right,
  // η-returned) must be `{$ref}`/closure/partial. A string at a call HEAD
  // (`call`/`apply` arg0, a literal `pipe` step) is role #1 — KEPT until Phase 6.
  test("call: {$ref} (via bare-ident) and the literal string HEAD both dispatch", () => {
    // `{var:"add"}` yields {$ref} (a value); `"add"` is the literal head (role #1).
    expect(evaluate({ call: [{ var: "add" }, 2, 3] }, {}, ctx)).toBe(5);
    expect(evaluate({ call: ["add", 2, 3] }, {}, ctx)).toBe(5); // HEAD — kept (boot-safety)
  });

  test("apply: {$ref} value and the literal string HEAD both dispatch", () => {
    expect(evaluate({ apply: [{ var: "add" }, [2, 3]] }, {}, ctx)).toBe(5);
    expect(evaluate({ apply: ["add", [2, 3]] }, {}, ctx)).toBe(5); // HEAD — kept
  });

  test("|> (pipeBin): a {$ref} right dispatches; a bare-string right is rejected", () => {
    expect(evaluate({ "|>": [7, { var: "negate" }] }, {}, ctx)).toBe(-7);
    // `|>`'s right is a callable VALUE — a bare string no longer dispatches.
    expect(evaluate({ "|>": [7, "negate"] }, {}, ctx)).toBe(null); // FLIPPED (Phase 5)
  });

  test("pipe (multi-step): a {$ref} step AND a literal step name both dispatch", () => {
    // `negate` arrives as a {$ref} value bound through a var.
    expect(evaluate({ pipe: [7, { var: "negate" }] }, {}, ctx)).toBe(-7);
    // A literal `pipe` step name is a HEAD (role #1) — kept.
    expect(evaluate({ pipe: [7, "negate"] }, {}, ctx)).toBe(-7); // HEAD — kept
  });

  test("std:map accepts a {$ref} callback (the std HOF value path)", () => {
    // Both the HOF and its callback are {$ref} values — no bare string anywhere.
    expect(invokeCallable(Ref(mapId), [Ref(absId), [-1, 2, -3]], ctx)).toEqual([1, 2, 3]);
  });

  test("std:filter accepts a {$ref} predicate (partial-applied)", () => {
    // gt(0, b) = `0 > b` keeps negatives: filter (gt 0) xs. The partial is
    // built from a {$ref}-headed application.
    const keepNeg = invokeCallable(Ref(gtId), [0], ctx); // partial gt(0, _)
    expect(invokeCallable(Ref(filterId), [keepNeg, [-2, -1, 0, 1, 2]], ctx)).toEqual([-2, -1]);
  });
});

describe("Phase 5 — value-position clean break (|> right + η-returned reject a bare string)", () => {
  // SCOPED Phase 5 (pending Rom's D1 lock on the invokeCallable HOF entry): the
  // genuine callable-VALUE positions reject a bare string; invokeCallable's own
  // first-arg string is a call-by-NAME head, kept until Phase 6.
  test("invokeCallable applies a {$ref} value (the typed callable)", () => {
    expect(invokeCallable(Ref(absId), [-5], ctx)).toBe(5);
  });

  test("η-reduction does NOT re-apply a returned bare string", () => {
    // A 0-param closure whose body is a literal string returns it as-is; with a
    // leftover arg it is no longer treated as a callable (bare-string value arm
    // gone). Old behaviour would have η-applied "negate" to 5 → -5.
    expect(evaluate({ apply: [{ fn: [[], "negate"] }, [5]] }, {}, ctx)).toBe("negate");
  });

  test("invokeCallable's bare-string first-arg still resolves by NAME (head, retires P6)", () => {
    // Call-by-name (the dominant corpus use) is name resolution = a head, kept
    // until Phase 6 with callOp's head + getFunction's codeName arm.
    expect(invokeCallable("abs", [-5], ctx)).toBe(5);
  });
});

describe("Phase 2 — η-reduction applies a returned {$ref}", () => {
  test("a 0-param closure returning {$ref} applies leftover args", () => {
    // `(λ. abs)` applied to -5 → abs returned as {$ref} → η-applied to -5 → 5.
    expect(evaluate({ apply: [{ fn: [[], { var: "abs" }] }, [-5]] }, {}, ctx)).toBe(5);
  });
});

describe("Phase 2 — refType resolves the referent's type; graceful on miss", () => {
  test("refType({$ref}) → the function's $arrow", () => {
    const t = refType(Ref(addId), ctx.getFunction!) as { $arrow?: { params: unknown[] } };
    expect("$arrow" in t).toBe(true);
    expect(t.$arrow!.params.length).toBe(2);
  });

  test("refType on an unresolvable id degrades to {$void}, never throws", () => {
    expect(refType(Ref("nope:missing"), ctx.getFunction!)).toEqual({ $void: true });
  });

  test("applying an unresolvable {$ref} returns null (no throw)", () => {
    expect(invokeCallable(Ref("nope:missing"), [1], ctx)).toBe(null);
  });
});

describe("Phase 6 — the producer carries the UUID identity; the slug still bridges", () => {
  // UUID-as-sibling: `spec.id` stays the slug (natives/dispatch key); the opaque
  // UUID identity lives registry-LOCAL (`getUuid`), NOT on the shared spec. The
  // `{$ref}` producer emits the UUID; a legacy `{$ref:slug}` (persisted bodies,
  // authored instances) bridges to the SAME function via `getFunction`'s
  // slug/codeName arm — no rewrite.
  const absSlug = reg.getFunction("abs")!.id; // the slug `id` (e.g. "std:abs")

  test("the produced ref's handle is a v4 UUID, not the slug", () => {
    const v = evaluate({ var: "abs" }, {}, ctx) as { $ref: string };
    expect(v.$ref).toBe(absId);
    expect(v.$ref).not.toBe(absSlug);
    // v4 UUID shape: 8-4-4-4-12 hex.
    expect(v.$ref).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test("a UUID ref and the legacy slug ref resolve to the SAME function", () => {
    // Both dispatch abs(-5) → 5: identity (uuid) and bridge (slug) are one fn.
    expect(invokeCallable(Ref(absId), [-5], ctx)).toBe(5); // UUID identity
    expect(invokeCallable(Ref(absSlug), [-5], ctx)).toBe(5); // legacy slug bridge
    expect(reg.getFunction(absId)).toBe(reg.getFunction(absSlug)!); // same spec object
  });

  test("the UUID is registry-local (getUuid), the spec stays a pure slug-keyed value", () => {
    // `getUuid` resolves by slug OR codeName; the spec object is NOT mutated with
    // a `uuid` field (that mutation leaked across registries in the first cut).
    expect(reg.getUuid(absSlug)).toBe(absId);
    expect(reg.getUuid("abs")).toBe(absId); // by codeName too
    expect(reg.getFunction(absId)!.id).toBe(absSlug);
    expect("uuid" in reg.getFunction(absId)!).toBe(false); // no field on the shared spec
  });

  test("a lock-less registry over the SAME module emits + resolves the slug (no leak)", async () => {
    // The regression guard: a sibling lock-less registry must NOT see a UUID on
    // the shared stdModule specs (it would emit `{$ref:uuid}` it can't resolve).
    const lockless = createRegistry([stdModule]); // no codeNameLock
    const lctx = lockless.evaluateContext();
    const v = evaluate({ var: "abs" }, {}, lctx) as { $ref: string };
    expect(v.$ref).toBe(absSlug); // slug, NOT the UUID
    expect(evaluate({ "|>": [-5, { var: "abs" }] }, {}, lctx)).toBe(5); // resolves
  }, 15_000);
});

describe("Phase 7b — refType resolves a {$ref} in TYPE position (the keystone)", () => {
  // The type-layer merge keystone: one resolver returns the referent's TYPE,
  // whether the referent is a function (→ $arrow, value-position) or a type/
  // entity (→ its kind, type-position). Pure ADD — `getEntityType` is an
  // optional injected lookup; existing 2-arg callers are unchanged.
  // Decisions: design/typed-function-references.md § "The type-layer merge".

  // A distinct sentinel FenelType standing in for an entity's resolved kind.
  const FOO: FenelType = { $tuple: [{ $ref: "Number" }] } as unknown as FenelType;
  const stubEntity = (name: string): FenelType | undefined => (name === "Foo" ? FOO : undefined);

  test("a {$ref} whose handle names a TYPE/entity resolves to that type (type-position)", () => {
    expect(refType(Ref("Foo"), () => undefined, stubEntity)).toEqual(FOO);
  });

  test("function-first precedence: a function handle still resolves to its $arrow (no regression)", () => {
    const t = refType(Ref(addId), ctx.getFunction!, stubEntity) as { $arrow?: { params: unknown[] } };
    expect("$arrow" in t).toBe(true);
    expect(t.$arrow!.params.length).toBe(2); // entity stub NOT consulted for a function handle
  });

  test("the handle may be a codeable-NAME, not just a UUID (the common authoring form)", () => {
    // `abs`'s codeName "abs" (not its UUID) still resolves transparently to the arrow.
    const t = refType(Ref("abs"), ctx.getFunction!) as { $arrow?: unknown };
    expect("$arrow" in t).toBe(true);
  });

  test("an unresolvable handle (neither function nor entity) degrades to {$void}", () => {
    expect(refType(Ref("definitelyNothing"), ctx.getFunction!, () => undefined)).toEqual({ $void: true });
  });

  test("getEntityTypeByName composes with refType against the REAL catalog (derived, non-brittle)", () => {
    // Derive an entity name FROM the catalog at runtime (don't hardcode — avoids
    // the Phase-6 global-state flakiness). If the catalog has an entity, the
    // helper resolves it and refType returns the same type; else the stub test
    // above already proves the logic.
    let entName: string | undefined;
    for (const section of getCatalog()) {
      for (const e of section.entries) {
        if (e.id.startsWith("entity:") && getEntityTypeByName(e.id.slice("entity:".length))) {
          entName = e.id.slice("entity:".length);
          break;
        }
      }
      if (entName) break;
    }
    if (entName) {
      const viaHelper = getEntityTypeByName(entName)!;
      expect(viaHelper).toBeDefined();
      expect(refType(Ref(entName), () => undefined, getEntityTypeByName)).toEqual(viaHelper);
    }
  });
});
