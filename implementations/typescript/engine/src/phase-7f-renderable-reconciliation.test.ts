// ---------------------------------------------------------------------------
// Phase 7f — Renderable reconciliation + `builtin-classes.ts` class-seed thin
// shim (the FIFTH and FINAL class-side phase).
//
// 7a derived the 28 pure-signature classes; 7bc gave laws a home; 7b′ gave
// supers a home; 7d gave method-body defaults a home; 7e cleared the five
// record/seed-divergent classes. After 7e, exactly ONE residual hand-written
// `Interface` literal remained: Renderable. This phase derives it.
//
// THE FINDING (made during 7f scoping): there were TWO competing `Renderable`
// `Interface`s. The DEAD one (`builtin-classes.ts`, 1-nullary `render: String`)
// was registered at boot via the `builtinTypeclasses` loop, then OVERWRITTEN by
// the richer LIVE one (`modules/templates.ts`, 3 methods) — `defineClass` is a
// `Map.set` and `MODULE_TYPECLASSES` ran after. The 3-field shape was therefore
// already live. Deleting the DEAD builtin seed alone is a no-op; deleting the
// LIVE templates seed is what re-sources the derivation.
//
// THE DECISION (with Rom, 2026-05-30): `render` is a FUNCTION, typed `Markup ->
// a` (an `$arrow`), not a fn-id String. Functions are first-class values in
// Fenel now; a method that points to an implementation is a function-typed
// field. The `format`/`a` param bug (class param `format`, body returns `a`) is
// fixed → `Renderable a`, making the record pure-signature: it derives in
// `pureClasses` and byte-matches the deleted LIVE templates seed.
//
// FOLLOW-UP (LANDED): 7f left the INSTANCES storing `render: "<codeName>"` — a
// String value, identical to every sibling (Sampleable / Soundable / Viewable);
// 7f made the TYPE honest (arrow over a string value), surfacing the debt.
// typed-function-references Phase 3 then converted the function-reference VALUES
// to typed `{$ref:id}` references (the `Ref` substrate). The (E) assertion below
// pins the post-Phase-3 `{$ref}` value form.
//
// This suite pins:
//   (A) boot-registry resolution with the LIVE templates seed's 3-method shape +
//       dispatch positions;
//   (B) the boot seed is BYTE-IDENTICAL to a fresh `seedFromType` derivation
//       (param `"a"`), and equals the explicit target shape (Decision #6);
//   (C) Renderable is GONE from `builtinTypeclasses` — the array carries zero
//       representational/effect/algebra hand-written seeds (only the Phase-2-5
//       roadmap module families remain, declared in their own modules);
//   (D) `render` is a FUNCTION-typed field — the `.fenel` record's `render`
//       field type is an `$arrow`, not `$ref:"String"`;
//   (E) the 4 instances (email/sms/telegram/pdf) survive on
//       `templateModule.instances`, independent of the deleted seed, each with
//       the string `render` value that `registry.ts`'s `renderByTag` reads.
//
// Brief: `briefs/phase-7f-renderable-reconciliation-and-thin-shim.md`.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "bun:test";
import {
  seedFromType,
  methodDispatchPosition,
  RETURN_POSITION as RP,
} from "./effect-dispatch";
import { loadFenelModule } from "./fenel-module";
import { dispatchRegistry } from "./system-entities";
import { builtinTypeclasses } from "./builtin-classes";
import { templateModule } from "./modules/templates";
import { Maybe, isRef } from "./type-foundation";
import type { FenelType } from "./types";
import TYPECLASS_SPECS_SRC from "../../../../fenel/std/interfaces.fenel?raw";

const specs = loadFenelModule(TYPECLASS_SPECS_SRC, "std");
const typeOf = (id: string): FenelType => {
  const t = specs.entities?.find((e) => e.id === id)?.type;
  if (!t) throw new Error(`missing .fenel class ${id}`);
  return t;
};

describe("Phase 7f — (A) Renderable resolves with the LIVE templates 3-method shape", () => {
  it("method set is [render, mime_type, max_length]", () => {
    const seed = dispatchRegistry.getClass("Renderable");
    expect(seed, "Renderable resolves in the boot registry").toBeDefined();
    expect(seed!.methods.map((m) => m.name)).toEqual(["render", "mime_type", "max_length"]);
  });

  it("render is arity 1 (the `Markup` arg); mime_type / max_length are nullary", () => {
    const seed = dispatchRegistry.getClass("Renderable")!;
    const render = seed.methods.find((m) => m.name === "render")!;
    expect(render.params!.length).toBe(1);
    expect(seed.methods.find((m) => m.name === "mime_type")!.params!.length).toBe(0);
    expect(seed.methods.find((m) => m.name === "max_length")!.params!.length).toBe(0);
  });

  it("dispatch positions: render arg 0 (the class-param-typed return drives dispatch); the nullary pair are RETURN_POSITION", () => {
    // `render` returns the class param `a` (return-position dispatch); its single
    // `Markup` arg is not class-param-typed. mime_type/max_length are nullary.
    expect(methodDispatchPosition(dispatchRegistry, "Renderable", "render")).toBe(RP);
    expect(methodDispatchPosition(dispatchRegistry, "Renderable", "mime_type")).toBe(RP);
    expect(methodDispatchPosition(dispatchRegistry, "Renderable", "max_length")).toBe(RP);
  });
});

describe("Phase 7f — (B) the boot seed is byte-identical to a fresh derivation (param `a`)", () => {
  it("dispatchRegistry.getClass ≡ seedFromType(.fenel record, 'a')", () => {
    expect(dispatchRegistry.getClass("Renderable")).toEqual(
      seedFromType("Renderable", typeOf("Renderable"), "a"),
    );
  });

  it("matches the explicit Decision #6 target shape", () => {
    const seed = seedFromType("Renderable", typeOf("Renderable"), "a");
    const render = seed.methods.find((m) => m.name === "render")!;
    // render : Markup -> a  ⇒ arity 1, returns the class var `a` (NOT a dangling
    // `{$ref:"a"}` — that was the pre-fix `format`/`a` bug).
    expect(render.params!.length).toBe(1);
    // 7g-parser: the non-param type `Markup` parses to `{$ref}` (was `{$ref}`);
    // the class param `a` still normalizes to `{$var:"a"}` (normalizeClassParam
    // folds `{$ref:param}`→`{$var:param}`), asserted next.
    expect(render.params![0]!.type).toEqual({ $ref: "Markup" } as never);
    expect(render.returns).toEqual({ $var: "a" });
    // mime_type : String  (7g-parser: the type-name ref is now {$ref})
    expect(seed.methods.find((m) => m.name === "mime_type")!.returns).toEqual({ $ref: "String" } as never);
    // max_length : Maybe<Number>  ({$ref} inner; cast — {$ref} is not yet a FenelType-union member until 7g-retire)
    expect(seed.methods.find((m) => m.name === "max_length")!.returns).toEqual(
      Maybe({ $ref: "Number" } as unknown as FenelType),
    );
  });
});

describe("Phase 7f — (C) builtinTypeclasses carries NO hand-written Renderable seed", () => {
  const names = new Set(builtinTypeclasses.map((c) => c.name));

  it("Renderable is GONE — the LAST representational hand-written seed is derived", () => {
    expect(names.has("Renderable")).toBe(false);
  });

  it("the only residual seeds are the Phase-2-5 roadmap module families (Codec / DecidableMembership / Prover / Compilable), not representational classes", () => {
    // Class-side end state: zero hand-written REPRESENTATIONAL / EFFECT / ALGEBRA
    // seeds. What remains are roadmap module class families declared in their own
    // modules (codec.ts / decidable-membership / prover / compilable) and spread
    // in — none of them a hand-written representational `Interface` literal.
    const ROADMAP = new Set([
      "Encodable", "Decodable", "Iso", "Lens",
      "DecidableMembership", "Prover", "Compilable", "Evaluator",
      "Aggregable", "Migration",
    ]);
    for (const n of names) {
      expect(ROADMAP.has(n), `${n} is an unexpected residual hand-written seed`).toBe(true);
    }
  });
});

describe("Phase 7f — (D) render is a FUNCTION-typed field (an $arrow, not a fn-id String)", () => {
  it("the .fenel Renderable record's `render` field type is an $arrow", () => {
    const rec = typeOf("Renderable") as { $record?: { fields: Array<{ name: string; type: FenelType }> } };
    const renderField = rec.$record!.fields.find((f) => f.name === "render")!;
    expect("$arrow" in (renderField.type as object)).toBe(true);
    // and it is NOT the dead builtin seed's 1-nullary `render: String`.
    expect(renderField.type).not.toEqual({ $ref: "String" });
  });
});

describe("Phase 7f — (E) the 4 instances survive independently of the deleted seed", () => {
  const renderable = (templateModule.instances ?? []).filter((i) => i.typeName === "Renderable");

  it("email / sms / telegram / pdf all register on templateModule.instances", () => {
    expect(renderable.map((i) => String(i.args[0])).sort()).toEqual(
      ["email", "pdf", "sms", "telegram"],
    );
  });

  it("each instance's `render` is a typed `{$ref}` that registry.ts's renderByTag reads", () => {
    // typed-function-references Phase 3: the instance VALUES are now typed
    // `{$ref:id}` references (the `Ref` substrate), not bare codeName strings.
    // `renderByTag` keys on `typeName === "Renderable"` + extracts the id from
    // the `{$ref}` (registry.ts, isRef arm) — independent of the class-seed shape.
    for (const inst of renderable) {
      expect(isRef(inst.methods.render)).toBe(true);
    }
    const byTag = Object.fromEntries(renderable.map((i) => [String(i.args[0]), inst_render(i)]));
    expect(byTag).toEqual({
      email: "markup_to_html",
      sms: "markup_to_plaintext",
      telegram: "markup_to_telegram_md",
      pdf: "markup_to_pdf",
    });
  });
});

// The id behind the `{$ref}` — the handle the renderByTag table extracts.
function inst_render(i: { methods: Record<string, unknown> }): unknown {
  const r = i.methods.render;
  return isRef(r) ? r.$ref : r;
}
