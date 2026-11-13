import { describe, expect, test } from "bun:test";

// C1 transport controls: run the actual Home memo bodies with a controlled
// existing presentation owner. The Fenel glyph law is tested independently.
// No engine, registry, browser build or semantic adapter is imported here.
const source = await Bun.file(new URL("../routes/app/home.tsx", import.meta.url)).text();
const transpiler = new Bun.Transpiler({ loader: "ts" });
function between(text, first, last) {
  const start = text.indexOf(first), end = text.indexOf(last, start + first.length);
  if (start < 0 || end < 0) throw new Error(`Home caption source boundary changed: ${first}`);
  return text.slice(start, end);
}
const heading = between(source, "function ValueCardHeading(", "function TypeInspectionDialog(");
const headingMemo = between(heading, "  const valuePresentation =", "  const data =");
const summaryMemo = between(source, "    const summaryPresentation =", "    const summaryIcon =");
const focusedItem = between(source, "function focusedLocusItem(", "/** Select a held type");
const reference = value => value?.reference;

function headingProjection({ overrides, own, itemId = "occurrence", value = { reference: { id: "target" } } } = {}) {
  const frame = {}, calls = [], lookups = [], projected = { icon: "owner-selected-icon", emoji: undefined };
  const imports = {
    createMemo: compute => compute,
    props: { representations: overrides, item: { id: itemId }, value },
    readLocusCatalogReference: reference,
    reader: { presentation: id => { lookups.push(id); return own; } },
    homeAuthoringSession: () => ({ evaluateContext: frame }),
    // B3: the glyph merge frame is chosen by the Home reader helper.
    presentationFrame: () => frame,
    ownPresentationFromReaderSnapshot: (...args) => { calls.push(args); return projected; },
  };
  const read = new Function(...Object.keys(imports), `${transpiler.transformSync(headingMemo)}; return valuePresentation;`)(...Object.values(imports));
  return { read, frame, calls, lookups, projected };
}

describe("Home captions transport independent occurrence facts to the existing owner", () => {
  test("an Emojiable occurrence override keeps the reader's selected Iconable fact", () => {
    const h = headingProjection({ overrides: { Emojiable: { emoji: "🍯" } }, own: { icon: "jar", emoji: undefined } });
    expect(h.read()).toBe(h.projected);
    expect(h.lookups).toEqual(["target"]);
    expect(h.calls[0][0]).toBe(h.frame);
    expect(h.calls[0][1].get("Iconable")).toEqual({ icon: "jar" });
    expect(h.calls[0][1].get("Emojiable")).toEqual({ emoji: "🍯" });
    expect(h.calls[0][2]).toBe("target");
  });

  test("each occurrence class replaces only its own fact and unknown SVG names are left to the owner", () => {
    const h = headingProjection({ overrides: { Iconable: { icon: "not-in-the-svg-table" } }, own: { emoji: "🥒" } });
    h.read();
    expect(h.calls[0][1].get("Iconable")).toEqual({ icon: "not-in-the-svg-table" });
    expect(h.calls[0][1].get("Emojiable")).toEqual({ emoji: "🥒" });
    expect(h.calls).toHaveLength(1);
  });

  test("a plain occurrence retains its actual identity and no glyph result is manufactured locally", () => {
    const h = headingProjection({ value: 12, overrides: { Iconable: { icon: "circle" }, Emojiable: { emoji: "🍅" } } });
    h.projected.icon = undefined; h.projected.emoji = "actual-source-result";
    expect(h.read()).toBe(h.projected);
    expect(h.lookups).toEqual([]);
    expect(h.calls[0][2]).toBe("occurrence");
    expect(h.calls[0][1].get("Iconable")).toEqual({ icon: "circle" });
    expect(h.calls[0][1].get("Emojiable")).toEqual({ emoji: "🍅" });
  });

  test("an unreadable occurrence field cannot replace a selected string fact", () => {
    const h = headingProjection({ overrides: { Iconable: { icon: 42 }, Emojiable: { emoji: false } }, own: { icon: "flask", emoji: "🧪" } });
    h.read();
    expect(h.calls[0][1].get("Iconable")).toEqual({ icon: "flask" });
    expect(h.calls[0][1].get("Emojiable")).toEqual({ emoji: "🧪" });
  });
});

function summaryProjection({ selectedScope, state, held, own } = {}) {
  const calls = [], frame = {}, projected = { emoji: "source-selected" };
  const imports = {
    createMemo: compute => compute,
    heldLensSubject: () => held,
    scope: () => selectedScope,
    scopeLabel: () => "selected child",
    valueScope: () => state,
    readLocusCatalogReference: reference,
    reader: { presentation: () => own },
    sourceIcon: () => "source-icon",
    props: {},
    homeAuthoringSession: () => ({ evaluateContext: frame }),
    // B3: the glyph merge frame is chosen by the Home reader helper.
    presentationFrame: () => frame,
    ownPresentationFromReaderSnapshot: (...args) => { calls.push(args); return projected; },
  };
  const read = new Function(...Object.keys(imports), `${transpiler.transformSync(focusedItem + summaryMemo)}; return summaryPresentation;`)(...Object.values(imports));
  return { read, calls, frame, projected };
}

describe("Home lens captions keep the selected occurrence and owner", () => {
  test("deep navigation drops the parent's occurrence overrides before forwarding the child's reader facts", () => {
    const h = summaryProjection({ selectedScope: { kind: "value", path: ["child"] },
      state: { ok: true, item: { id: "parent", representations: { Iconable: { icon: "parent-only" }, Emojiable: { emoji: "parent-only" } } },
        container: { reference: { id: "child-target" } } }, own: { emoji: "child-only" } });
    expect(h.read()).toBe(h.projected);
    expect(h.calls[0][0]).toBe(h.frame);
    expect(h.calls[0][1].get("Iconable")).toEqual({ icon: undefined });
    expect(h.calls[0][1].get("Emojiable")).toEqual({ emoji: "child-only" });
    expect(h.calls[0][2]).toBe("child-target");
  });

  test("the source root retains its existing static icon without acquiring a presentation frame", () => {
    const h = summaryProjection({ selectedScope: { kind: "root" } });
    expect(h.read()).toEqual({ icon: "source-icon", emoji: undefined });
    expect(h.calls).toEqual([]);
  });

  test("a held reference uses its existing selected pair unchanged", () => {
    const own = { icon: "selected", emoji: undefined };
    const h = summaryProjection({ held: { value: { reference: { id: "held" } } }, own });
    expect(h.read()).toBe(own);
    expect(h.calls).toEqual([]);
  });
});
