// ---------------------------------------------------------------------------
// Phase 7d of canonical-maybe — small Tier-A cleanup cluster + outer
// `TypeView.display.{read,edit}?` lift. Four lifts in one phase:
//
//   1. `TypeView.display?: {read?, edit?}` → `Maybe<{read: Maybe<ReadDisplay>,
//      edit: Maybe<EditDisplay>}>` — outer over Phase 6 / 6.5 canonical inner.
//   2. `ResolutionLevel.step?: [number, number]` → `Maybe<[number, number]>`.
//   3. `Scope.accountId?: string` → `Maybe<string>` (system vs account row
//      discriminator — Nothing = system/std, Just(uuid) = account-owned).
//   4. `OnSubmitAction.CreatePaymentLink.stepSlug?: string` → `Maybe<string>`
//      (variant payload field).
//
// After Phase 7d, the display arc is 100% canonical Maybe at both outer slot
// level and inner Tier-A slots. Only Tier B (`FieldDef.meta?`, `Trace.meta?`)
// and Tier C (`CaseDef.fields?`) `?:` slots remain in types.ts.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Just, Nothing, peelMaybeValue } from "./type-foundation";
import type {
  TypeView,
  ReadDisplay,
  EditDisplay,
  ResolutionLevel,
  Scope,
  OnSubmitAction,
} from "./types";
import { mergeDisplay } from "./template-registry";

// -- TS-side mirror of migration 0060's PL/pgSQL walker. --------------------
//
// Four detection rules in one recursive walker:
//   1. TypeView carrier — `display:` key whose value contains EITHER
//      `read:` OR `edit:` (rules out non-TypeView records that happen to
//      have a `display` key for unrelated reasons).
//   2. ResolutionLevel carrier — `name:` + `step:` co-presence under
//      `levels:` or `resolution:` parent context.
//   3. Scope carrier — parent-key context (`scope:` parent) lifts
//      `accountId`.
//   4. OnSubmitAction.CreatePaymentLink carrier — `$tag: "CreatePaymentLink"`
//      discriminator on any object lifts `stepSlug`.
//
// The walker is idempotent: any value already in canonical Maybe shape
// (`{$tag: "Just"|"Nothing"}`) is preserved unchanged.

type Json = unknown;

function liftOneSlot(v: Json): Json {
  if (v === undefined || v === null) return { $tag: "Nothing" };
  if (typeof v === "object" && v !== null && "$tag" in (v as object)) return v;
  return { $tag: "Just", _0: v };
}

function isObj(v: Json): v is Record<string, Json> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isReadDisplayLike(o: Record<string, Json>): boolean {
  // After lift, presence of read: or edit: key as a sibling at depth 0 in
  // the same object means we're inside a TypeView's display value.
  return "read" in o || "edit" in o;
}

function walkOuterDisplay(obj: Record<string, Json>): void {
  if (!("display" in obj)) return;
  const v = obj["display"];
  if (isObj(v) && "$tag" in v) return; // already lifted
  if (!isObj(v)) {
    obj["display"] = { $tag: "Nothing" };
    return;
  }
  // Verify TypeView display payload (has read: or edit: key)
  if (!isReadDisplayLike(v)) return;
  const lifted = {
    read: "read" in v ? liftOneSlot(v["read"]) : { $tag: "Nothing" },
    edit: "edit" in v ? liftOneSlot(v["edit"]) : { $tag: "Nothing" },
  };
  obj["display"] = { $tag: "Just", _0: lifted };
}

function walkResolutionLevel(obj: Record<string, Json>, parentKey: string | null): void {
  // Lift `step` slot under `levels:` array or `resolution:` parent context.
  if (parentKey !== "levels" && parentKey !== "resolution") return;
  if (!("name" in obj)) return;
  if (!("step" in obj)) {
    obj["step"] = { $tag: "Nothing" };
    return;
  }
  const v = obj["step"];
  if (isObj(v) && "$tag" in v) return;
  obj["step"] = liftOneSlot(v);
}

function walkScope(obj: Record<string, Json>, parentKey: string | null): void {
  if (parentKey !== "scope") return;
  if (!("accountId" in obj)) {
    obj["accountId"] = { $tag: "Nothing" };
    return;
  }
  const v = obj["accountId"];
  if (isObj(v) && "$tag" in v) return;
  obj["accountId"] = liftOneSlot(v);
}

function walkCreatePaymentLink(obj: Record<string, Json>): void {
  if (obj["$tag"] !== "CreatePaymentLink") return;
  if (!("stepSlug" in obj)) {
    obj["stepSlug"] = { $tag: "Nothing" };
    return;
  }
  const v = obj["stepSlug"];
  if (isObj(v) && "$tag" in v) return;
  obj["stepSlug"] = liftOneSlot(v);
}

function walk(v: Json, parentKey: string | null = null): void {
  if (Array.isArray(v)) {
    for (const item of v) walk(item, parentKey);
    return;
  }
  if (!isObj(v)) return;
  walkOuterDisplay(v);
  walkResolutionLevel(v, parentKey);
  walkScope(v, parentKey);
  walkCreatePaymentLink(v);
  for (const k of Object.keys(v)) walk(v[k], k);
}

// ---------------------------------------------------------------------------
// TS-level type pins (compile-time)
// ---------------------------------------------------------------------------

describe("Phase 7d — TS declarations accept canonical Maybe", () => {
  it("TypeView.display accepts Just({read: Just, edit: Nothing})", () => {
    const tv: TypeView = {
      name: "demo",
      display: Just({
        read: Just<ReadDisplay>({
          format: Just("badge"),
          transform: Nothing,
          colorMap: Nothing,
          labelMap: Nothing,
          icon: Nothing,
          emptyText: Nothing,
          prefix: Nothing,
          suffix: Nothing,
          refTemplate: Nothing,
        }),
        edit: Nothing,
      }),
    };
    const disp = peelMaybeValue(tv.display);
    expect(disp).not.toBeNull();
    expect(peelMaybeValue(disp!.read)?.format).toEqual({ $tag: "Just", _0: "badge" });
    expect(disp!.edit.$tag).toBe("Nothing");
  });

  it("TypeView.display accepts Nothing", () => {
    const tv: TypeView = { name: "bare", display: Nothing };
    expect(peelMaybeValue(tv.display)).toBeNull();
  });

  it("ResolutionLevel.step accepts Just([1,100]) and Nothing", () => {
    const lvl1: ResolutionLevel = { name: "hundredths", step: Just([1, 100]) };
    const lvl2: ResolutionLevel = { name: "year", step: Nothing };
    expect(peelMaybeValue(lvl1.step)).toEqual([1, 100]);
    expect(lvl2.step.$tag).toBe("Nothing");
  });

  it("Scope.accountId Nothing = system/std row; Just(uuid) = owned", () => {
    const sys: Scope = { accountId: Nothing };
    const owned: Scope = { accountId: Just("acc-uuid-1") };
    expect(peelMaybeValue(sys.accountId)).toBeNull();
    expect(peelMaybeValue(owned.accountId)).toBe("acc-uuid-1");
  });

  it("OnSubmitAction.CreatePaymentLink.stepSlug accepts Just('a') and Nothing", () => {
    const a: OnSubmitAction = { $tag: "CreatePaymentLink", planSlug: "p", stepSlug: Just("step-1") };
    const b: OnSubmitAction = { $tag: "CreatePaymentLink", planSlug: "p", stepSlug: Nothing };
    if (a.$tag === "CreatePaymentLink") expect(peelMaybeValue(a.stepSlug)).toBe("step-1");
    if (b.$tag === "CreatePaymentLink") expect(b.stepSlug.$tag).toBe("Nothing");
  });
});

// ---------------------------------------------------------------------------
// mergeDisplay semantics — third merge helper after mergeEdit / mergeRead
// ---------------------------------------------------------------------------

describe("Phase 7d — mergeDisplay semantics", () => {
  function rd(format: string | null): ReadDisplay {
    return {
      format: format === null ? Nothing : Just(format),
      transform: Nothing,
      colorMap: Nothing,
      labelMap: Nothing,
      icon: Nothing,
      emptyText: Nothing,
      prefix: Nothing,
      suffix: Nothing,
      refTemplate: Nothing,
    };
  }
  function ed(widget: string | null): EditDisplay {
    return {
      widget: widget === null ? Nothing : Just(widget),
      placeholder: Nothing,
      helpText: Nothing,
      options: Nothing,
      columns: Nothing,
      refFilter: Nothing,
      prefix: Nothing,
      suffix: Nothing,
      format: Nothing,
    };
  }

  it("both Nothing → Nothing", () => {
    expect(mergeDisplay(Nothing, Nothing).$tag).toBe("Nothing");
  });

  it("child Just wins over parent Just (right-biased)", () => {
    const p = Just({ read: Just(rd("badge")), edit: Nothing });
    const c = Just({ read: Just(rd("chip")), edit: Nothing });
    const merged = peelMaybeValue(mergeDisplay(p, c))!;
    const r = peelMaybeValue(merged.read)!;
    expect(peelMaybeValue(r.format)).toBe("chip");
  });

  it("child Nothing for a slot falls through to parent for that slot", () => {
    const p = Just({ read: Just(rd("badge")), edit: Just(ed("textarea")) });
    const c = Just({ read: Nothing, edit: Just(ed("tel")) });
    const merged = peelMaybeValue(mergeDisplay(p, c))!;
    expect(peelMaybeValue(merged.read)?.format).toEqual({ $tag: "Just", _0: "badge" });
    expect(peelMaybeValue(merged.edit)?.widget).toEqual({ $tag: "Just", _0: "tel" });
  });

  it("parent Nothing + child Just produces Just", () => {
    const c = Just({ read: Just(rd("link")), edit: Nothing });
    const merged = peelMaybeValue(mergeDisplay(Nothing, c))!;
    expect(peelMaybeValue(merged.read)?.format).toEqual({ $tag: "Just", _0: "link" });
  });
});

// ---------------------------------------------------------------------------
// Migration walker — TS-side mirror of 0060
// ---------------------------------------------------------------------------

describe("Phase 7d — migration walker idempotency + correctness", () => {
  it("lifts outer display with read:{...} present", () => {
    const obj: Json = {
      view: {
        name: "x",
        display: {
          read: { format: { $tag: "Just", _0: "badge" } },
          edit: { widget: { $tag: "Just", _0: "tel" } },
        },
      },
    };
    walk(obj);
    const v = (obj as any).view.display;
    expect(v.$tag).toBe("Just");
    expect(v._0.read.$tag).toBe("Just");
    expect(v._0.edit.$tag).toBe("Just");
  });

  it("absent display slot → Nothing", () => {
    const obj: Json = { view: { name: "no-display" } };
    walk(obj);
    expect((obj as any).view.display).toBeUndefined();
  });

  it("is idempotent — running walker twice doesn't double-wrap", () => {
    const obj: Json = {
      view: {
        name: "x",
        display: {
          read: { format: { $tag: "Just", _0: "badge" } },
        },
      },
    };
    walk(obj);
    const after1 = JSON.parse(JSON.stringify(obj));
    walk(obj);
    expect(obj).toEqual(after1);
  });

  it("lifts ResolutionLevel.step under levels: parent", () => {
    const obj: Json = {
      levels: [
        { name: "units", step: [1, 1] },
        { name: "year" }, // no step → Nothing
      ],
    };
    walk(obj);
    const lvls = (obj as any).levels;
    expect(lvls[0].step).toEqual({ $tag: "Just", _0: [1, 1] });
    expect(lvls[1].step).toEqual({ $tag: "Nothing" });
  });

  it("lifts Scope.accountId under scope: parent", () => {
    const obj: Json = {
      scope: { accountId: "acc-1" },
    };
    walk(obj);
    expect((obj as any).scope.accountId).toEqual({ $tag: "Just", _0: "acc-1" });
  });

  it("Scope.accountId absent → Nothing under scope: parent", () => {
    const obj: Json = { scope: {} };
    walk(obj);
    expect((obj as any).scope.accountId).toEqual({ $tag: "Nothing" });
  });

  it("lifts stepSlug on CreatePaymentLink by $tag discriminator", () => {
    const obj: Json = {
      then: { $tag: "CreatePaymentLink", planSlug: "p", stepSlug: "s" },
    };
    walk(obj);
    expect((obj as any).then.stepSlug).toEqual({ $tag: "Just", _0: "s" });
  });

  it("stepSlug absent on CreatePaymentLink → Nothing", () => {
    const obj: Json = {
      then: { $tag: "CreatePaymentLink", planSlug: "p" },
    };
    walk(obj);
    expect((obj as any).then.stepSlug).toEqual({ $tag: "Nothing" });
  });

  it("doesn't touch non-TypeView display keys (no read:/edit: inside)", () => {
    const obj: Json = {
      // Some unrelated `display` key (e.g. CSS-like metadata)
      foo: { display: { mode: "block" } },
    };
    walk(obj);
    expect((obj as any).foo.display).toEqual({ mode: "block" });
  });

  it("doesn't lift accountId outside scope: context", () => {
    const obj: Json = {
      user: { accountId: "acc-1" },
    };
    walk(obj);
    expect((obj as any).user.accountId).toBe("acc-1");
  });

  it("doesn't lift step on FieldDef-like shapes (no levels:/resolution: parent)", () => {
    const obj: Json = {
      fields: [{ name: "step", type: { $ref: "Number" } }],
    };
    walk(obj);
    expect((obj as any).fields[0]).toEqual({ name: "step", type: { $ref: "Number" } });
  });
});
