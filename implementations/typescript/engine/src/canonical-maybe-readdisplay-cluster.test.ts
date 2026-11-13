// ---------------------------------------------------------------------------
// Phase 6.5 of canonical-maybe — `ReadDisplay.{format, transform, colorMap,
// labelMap, icon, emptyText, prefix, suffix, refTemplate}?` (9-slot) + the
// paired `EditDisplay.{prefix, suffix, format}?` trio collapse to canonical
// `Maybe<...>`. Phase 6.5 closes the ReadDisplay/EditDisplay Tier-A surface
// fully — both inner display types are now 100% canonical Maybe on their
// Tier-A slots.
//
// Pins:
//
//   1. ReadDisplay accepts canonical Maybe<...> on all 9 lifted slots —
//      every slot has its `$tag: "Nothing"` / `$tag: "Just"` shape.
//   2. EditDisplay now accepts canonical Maybe<...> on the trio
//      (prefix, suffix, format) — paired with ReadDisplay's matching slots.
//   3. The TS-mirror of migration 0059 lifts pre-Phase-6.5 shapes:
//        - absent slot → Nothing
//        - present-raw → Just(raw)
//        - already-lifted → unchanged (idempotent)
//   4. The walker descends into `read:` carriers AND `ui:`/`edit:` carriers,
//      and ONLY at those parent-key contexts (parent-key detection, not
//      slot-name presence).
//   5. The `format` slot appears on BOTH ReadDisplay AND EditDisplay; the
//      walker lifts both correctly without cross-contamination.
//   6. `peelMaybeValue(read?.<slot>)` reads return `null` for both Nothing
//      and absent-undefined — the universal idiom for ReadDisplay reads.
//   7. `mergeRead` semantic — child Just wins; child Nothing falls through
//      to parent; both Nothing → Nothing on output (right-biased Maybe
//      merge, identical shape to Phase 6's `mergeEdit`).
//   8. `mergeEdit` extended to handle the trio slots correctly — same
//      right-biased Maybe semantics.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Just, Nothing, peelMaybeValue } from "./type-foundation";
import type { ReadDisplay, EditDisplay, LocaleString } from "./types";
import { mergeRead } from "./template-registry";

// -- TS-side mirror of the PL/pgSQL walker in migration 0059. ----------------

function liftOneSlot(v: unknown): unknown {
  if (v === undefined || v === null) {
    return { $tag: "Nothing" };
  }
  if (typeof v === "object" && v !== null && "$tag" in v) {
    return v;
  }
  return { $tag: "Just", _0: v };
}

const READ_SLOTS = [
  "format", "transform", "colorMap", "labelMap", "icon",
  "emptyText", "prefix", "suffix", "refTemplate",
] as const;
const EDIT_TRIO = ["prefix", "suffix", "format"] as const;

function liftWalk(j: unknown, parentKey: string | null): unknown {
  if (j === null || j === undefined) return j;
  if (Array.isArray(j)) return j.map((elem) => liftWalk(elem, null));
  if (typeof j !== "object") return j;
  const obj = j as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = liftWalk(v, k);
  }
  if (parentKey === "read") {
    for (const slot of READ_SLOTS) result[slot] = liftOneSlot(result[slot]);
  } else if (parentKey === "ui" || parentKey === "edit") {
    for (const slot of EDIT_TRIO) result[slot] = liftOneSlot(result[slot]);
  }
  return result;
}

const lift = (j: unknown) => liftWalk(j, null);

// -- Tests --------------------------------------------------------------------

describe("Phase 6.5 canonical-maybe — ReadDisplay 9-slot + EditDisplay trio cluster lift", () => {
  it("accepts canonical Maybe<...> on all 9 ReadDisplay slots — all-Nothing", () => {
    const rd: ReadDisplay = {
      format: Nothing,
      transform: Nothing,
      colorMap: Nothing,
      labelMap: Nothing,
      icon: Nothing,
      emptyText: Nothing,
      prefix: Nothing,
      suffix: Nothing,
      refTemplate: Nothing,
    };
    expect(rd.format.$tag).toBe("Nothing");
    expect(rd.transform.$tag).toBe("Nothing");
    expect(rd.colorMap.$tag).toBe("Nothing");
    expect(rd.labelMap.$tag).toBe("Nothing");
    expect(rd.icon.$tag).toBe("Nothing");
    expect(rd.emptyText.$tag).toBe("Nothing");
    expect(rd.prefix.$tag).toBe("Nothing");
    expect(rd.suffix.$tag).toBe("Nothing");
    expect(rd.refTemplate.$tag).toBe("Nothing");
  });

  it("accepts canonical Maybe<...> on all 9 ReadDisplay slots — mixed", () => {
    const emptyText: LocaleString = "—";
    const prefix: LocaleString = { en: "$" };
    const colorMap = { active: "green", archived: "gray" };
    const labelMap = { active: "Active", archived: "Archived" };
    const rd: ReadDisplay = {
      format: Just("badge"),
      transform: Just("uppercase"),
      colorMap: Just(colorMap),
      labelMap: Just(labelMap),
      icon: Just("star"),
      emptyText: Just(emptyText),
      prefix: Just(prefix),
      suffix: Nothing,
      refTemplate: Just("entity-card"),
    };
    expect(peelMaybeValue(rd.format)).toBe("badge");
    expect(peelMaybeValue(rd.transform)).toBe("uppercase");
    expect(peelMaybeValue(rd.colorMap)).toEqual(colorMap);
    expect(peelMaybeValue(rd.labelMap)).toEqual(labelMap);
    expect(peelMaybeValue(rd.icon)).toBe("star");
    expect(peelMaybeValue(rd.emptyText)).toEqual(emptyText);
    expect(peelMaybeValue(rd.prefix)).toEqual(prefix);
    expect(peelMaybeValue(rd.suffix)).toBeNull();
    expect(peelMaybeValue(rd.refTemplate)).toBe("entity-card");
  });

  it("EditDisplay trio (prefix/suffix/format) is now Maybe<...>", () => {
    const ed: EditDisplay = {
      widget: Nothing,
      placeholder: Nothing,
      helpText: Nothing,
      options: Nothing,
      columns: Nothing,
      refFilter: Nothing,
      prefix: Just({ en: "$" } as LocaleString),
      suffix: Just({ en: "USD" } as LocaleString),
      format: Just("currency"),
    };
    expect(peelMaybeValue(ed.prefix)).toEqual({ en: "$" });
    expect(peelMaybeValue(ed.suffix)).toEqual({ en: "USD" });
    expect(peelMaybeValue(ed.format)).toBe("currency");
  });

  it("migration 0059 lifts absent ReadDisplay slots to Nothing under `read:` parent", () => {
    const pre = { read: { format: "badge" } };
    const post = lift(pre);
    expect(post).toEqual({
      read: {
        format: { $tag: "Just", _0: "badge" },
        transform: { $tag: "Nothing" },
        colorMap: { $tag: "Nothing" },
        labelMap: { $tag: "Nothing" },
        icon: { $tag: "Nothing" },
        emptyText: { $tag: "Nothing" },
        prefix: { $tag: "Nothing" },
        suffix: { $tag: "Nothing" },
        refTemplate: { $tag: "Nothing" },
      },
    });
  });

  it("migration 0059 lifts the EditDisplay trio under `ui:` parent", () => {
    const pre = { ui: { widget: "select", prefix: { en: "$" } } };
    const post = lift(pre) as any;
    expect(post.ui.prefix).toEqual({ $tag: "Just", _0: { en: "$" } });
    expect(post.ui.suffix).toEqual({ $tag: "Nothing" });
    expect(post.ui.format).toEqual({ $tag: "Nothing" });
    // widget passes through unchanged — 0055 handles widget/placeholder/etc.
    expect(post.ui.widget).toBe("select");
  });

  it("migration 0059 lifts the EditDisplay trio under `edit:` parent (TypeView shape)", () => {
    const pre = { display: { edit: { format: "datetime" } } };
    const post = lift(pre) as any;
    expect(post.display.edit.format).toEqual({ $tag: "Just", _0: "datetime" });
    expect(post.display.edit.prefix).toEqual({ $tag: "Nothing" });
    expect(post.display.edit.suffix).toEqual({ $tag: "Nothing" });
  });

  it("migration 0059 lifts ReadDisplay format AND EditDisplay format without cross-contamination", () => {
    const pre = {
      display: {
        read: { format: "badge" },
        edit: { format: "datetime" },
      },
    };
    const post = lift(pre) as any;
    expect(post.display.read.format).toEqual({ $tag: "Just", _0: "badge" });
    expect(post.display.edit.format).toEqual({ $tag: "Just", _0: "datetime" });
  });

  it("migration 0059 is idempotent — second pass = first pass", () => {
    const pre = {
      display: {
        read: { format: "badge", colorMap: { a: "g" } },
        edit: { format: "datetime", prefix: { en: "$" } },
      },
    };
    const once = lift(pre);
    const twice = lift(once);
    expect(twice).toEqual(once);
  });

  it("migration 0059 only descends into `read:` / `ui:` / `edit:` carriers (parent-key gating)", () => {
    // A `format` key NOT under read/ui/edit stays raw.
    const pre = { otherField: { format: "anything" } };
    const post = lift(pre);
    expect(post).toEqual({ otherField: { format: "anything" } });
  });

  it("migration 0059 lifts ReadDisplay nested inside view payloads", () => {
    const pre = {
      view: {
        display: {
          read: { icon: "star", labelMap: { a: "A" } },
        },
      },
    };
    const post = lift(pre) as any;
    expect(post.view.display.read.icon).toEqual({ $tag: "Just", _0: "star" });
    expect(post.view.display.read.labelMap).toEqual({
      $tag: "Just",
      _0: { a: "A" },
    });
    expect(post.view.display.read.format).toEqual({ $tag: "Nothing" });
  });

  it("peelMaybeValue + nullish-coalesce is the universal ReadDisplay-read idiom", () => {
    const rd: ReadDisplay = {
      format: Just("badge"),
      transform: Nothing,
      colorMap: Nothing,
      labelMap: Nothing,
      icon: Nothing,
      emptyText: Nothing,
      prefix: Nothing,
      suffix: Nothing,
      refTemplate: Nothing,
    };
    expect(peelMaybeValue(rd.format)).toBe("badge");
    expect(peelMaybeValue(rd.transform)).toBeNull();
    expect(peelMaybeValue(rd.transform) ?? "text").toBe("text");
    // From undefined read display:
    const undefRd = undefined as ReadDisplay | undefined;
    expect(peelMaybeValue(undefRd?.format ?? Nothing)).toBeNull();
  });

  it("mergeRead — child Just wins", () => {
    const parent: ReadDisplay = {
      format: Just("badge"),
      transform: Nothing,
      colorMap: Nothing,
      labelMap: Nothing,
      icon: Just("star"),
      emptyText: Nothing,
      prefix: Nothing,
      suffix: Nothing,
      refTemplate: Nothing,
    };
    const child: ReadDisplay = {
      format: Just("chip"),
      transform: Just("uppercase"),
      colorMap: Nothing,
      labelMap: Nothing,
      icon: Nothing,
      emptyText: Nothing,
      prefix: Nothing,
      suffix: Nothing,
      refTemplate: Nothing,
    };
    const merged = peelMaybeValue(mergeRead(Just(parent), Just(child)))!;
    expect(peelMaybeValue(merged.format)).toBe("chip");        // child wins
    expect(peelMaybeValue(merged.transform)).toBe("uppercase"); // only child has
    expect(peelMaybeValue(merged.icon)).toBe("star");          // only parent has
  });

  it("mergeRead — child Nothing falls through to parent", () => {
    const parent: ReadDisplay = {
      format: Just("badge"),
      transform: Nothing,
      colorMap: Nothing,
      labelMap: Nothing,
      icon: Just("star"),
      emptyText: Nothing,
      prefix: Nothing,
      suffix: Nothing,
      refTemplate: Nothing,
    };
    const merged = peelMaybeValue(mergeRead(Just(parent), Nothing))!;
    expect(peelMaybeValue(merged.format)).toBe("badge");
    expect(peelMaybeValue(merged.icon)).toBe("star");
  });

  it("mergeRead — both Nothing → Nothing on output", () => {
    const merged = mergeRead(Nothing, Nothing);
    expect(merged.$tag).toBe("Nothing");

    const allNothing: ReadDisplay = {
      format: Nothing,
      transform: Nothing,
      colorMap: Nothing,
      labelMap: Nothing,
      icon: Nothing,
      emptyText: Nothing,
      prefix: Nothing,
      suffix: Nothing,
      refTemplate: Nothing,
    };
    const merged2 = peelMaybeValue(mergeRead(Just(allNothing), Just(allNothing)))!;
    expect(merged2.format.$tag).toBe("Nothing");
    expect(merged2.icon.$tag).toBe("Nothing");
  });

  it("round-trip: ReadDisplay → JSONB-shape → TS shape preserves canonical Maybe", () => {
    const rd: ReadDisplay = {
      format: Just("badge"),
      transform: Nothing,
      colorMap: Just({ a: "g" }),
      labelMap: Nothing,
      icon: Just("star"),
      emptyText: Nothing,
      prefix: Nothing,
      suffix: Nothing,
      refTemplate: Just("card"),
    };
    const wire = JSON.parse(JSON.stringify(rd)) as ReadDisplay;
    expect(wire.format.$tag).toBe("Just");
    expect(peelMaybeValue(wire.format)).toBe("badge");
    expect(wire.transform.$tag).toBe("Nothing");
    expect(peelMaybeValue(wire.colorMap)).toEqual({ a: "g" });
  });
});
