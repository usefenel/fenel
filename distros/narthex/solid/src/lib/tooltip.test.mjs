import { describe, expect, test } from "bun:test";

// The tooltip layer's checklist rows and its focus rules (2026-11-12). The
// row parser is compiled from the production source; the layer's event rules
// are pinned as source facts, since no DOM boots here.
const source = (await Bun.file(new URL("./tooltip.tsx", import.meta.url)).text()).replaceAll("\r\n", "\n");
const styles = (await Bun.file(new URL("./tooltip.css", import.meta.url)).text()).replaceAll("\r\n", "\n");
function section(text, begin, end) {
  const start = text.indexOf(begin), finish = text.indexOf(end, start + begin.length);
  if (start < 0 || finish < start) throw new Error(`The tooltip fixture boundary moved: ${begin}`);
  return text.slice(start, finish);
}
const transpiler = new Bun.Transpiler({ loader: "ts" });
const tooltipLines = new Function(`${transpiler.transformSync(section(source, "const MARKS:", "/** The tooltip a focused control shows"))
  .replace(/^export /gm, "")}; return tooltipLines;`)();

describe("a checklist tooltip", () => {
  test("each line gives its mark, its label and its detail; a line without a mark is a heading", () => {
    expect(tooltipLines("✓ at least 8 characters\n○ contains a digit — keep typing\n✗ valid email — \"?\" can't go here (character 11)\n? age ≥ 18 — not checked"))
      .toEqual([
        { indent: 0, mark: "met", label: "at least 8 characters", detail: undefined },
        { indent: 0, mark: "notyet", label: "contains a digit", detail: "keep typing" },
        { indent: 0, mark: "failed", label: "valid email", detail: "\"?\" can't go here (character 11)" },
        { indent: 0, mark: "unknown", label: "age ≥ 18", detail: "not checked" },
      ]);
    expect(tooltipLines("Phone\n  ✓ valid phone\n    ○ country")).toEqual([
      { indent: 0, mark: undefined, label: "Phone", detail: undefined },
      { indent: 1, mark: "met", label: "valid phone", detail: undefined },
      { indent: 2, mark: "notyet", label: "country", detail: undefined },
    ]);
  });

  test("ordinary text is never read as a mark, and a dash inside a heading stays in it", () => {
    expect(tooltipLines("Show only the inputs — and their hints")).toEqual([
      { indent: 0, mark: undefined, label: "Show only the inputs — and their hints", detail: undefined }]);
    expect(tooltipLines("✓")).toEqual([{ indent: 0, mark: undefined, label: "✓", detail: undefined }]);
    expect(tooltipLines("")).toEqual([{ indent: 0, mark: undefined, label: "", detail: undefined }]);
  });

  test("an indented row without a mark is a plain row one step in (a field's example under its rules)", () => {
    expect(tooltipLines("○ valid phone — keep typing\n  for example +1 555 123 4567")).toEqual([
      { indent: 0, mark: "notyet", label: "valid phone", detail: "keep typing" },
      { indent: 1, mark: undefined, label: "for example +1 555 123 4567", detail: undefined },
    ]);
    expect(source).toContain('style={{ "padding-inline-start": `${line.indent * 1.17}rem` }}>');
  });

  test("a row being checked carries the waiting mark, a state of its own", () => {
    expect(tooltipLines("· valid email\n  · local")).toEqual([
      { indent: 0, mark: "waiting", label: "valid email", detail: undefined },
      { indent: 1, mark: "waiting", label: "local", detail: undefined },
    ]);
  });

  test("every mark the rows can carry has its colour on the dark bubble", () => {
    for (const mark of ["met", "notyet", "failed", "unknown", "waiting"])
      expect(styles).toContain(`.fenel-tooltip__line--${mark} .fenel-tooltip__mark`);
  });
});

describe("the layer's focus and follow rules", () => {
  test("a focused control without its own tooltip opens its field's marked control, at once", () => {
    expect(source).toContain('const FOCUS_HOST = "[data-tooltip-focus-host]";');
    expect(source).toContain('const ON_FOCUS = "[data-tooltip][data-tooltip-on-focus]";');
    const enter = section(source, "    const enter = (event: Event) => {", "    const leave = (event: Event) => {");
    expect(enter).toContain('if (event.type === "focusin") {');
    expect(enter).toContain("if (proxy && label) show(proxy, label, true);");
    // The pointer crossing bare page space does not close the focused field's tooltip.
    expect(enter).toContain('if (target && event.type === "pointerover" && !focusHeld()) hide();');
  });

  test("the pointer, a click inside the field and a scroll keep a focus tooltip; Escape and leaving the field close it", () => {
    expect(source).toContain("if (pointer && focusHeld()) return;");
    expect(source).toContain("const press = () => { if (!focusHeld()) hide(); };");
    expect(source).toContain("const shift = () => { if (focusHeld()) place(); else hide(); };");
    expect(source).toContain("if (target) dismissed = document.activeElement;");
    expect(source).toContain('document.addEventListener("focusout", leave, true);');
  });

  test("an open bubble follows its control's text and its waiting state without replaying the opening", () => {
    expect(source).toContain('observer.observe(element, { attributes: true, attributeFilter: ["data-tooltip", "data-tooltip-pending"] });');
    const follow = section(source, "  function follow(element: HTMLElement) {", "  /** Open the focused field's own tooltip");
    expect(follow).toContain("if (!label || !element.isConnected) { hide(); return; }");
    expect(follow).toContain("setSteady(true);");
    expect(styles).toContain(".fenel-tooltip--steady { animation: none; }");
  });

  test("beside: outside the named surface on its right, else on its left, level with the field; else the ordinary place below", () => {
    const place = section(source, "  function place() {", "  function show(element: HTMLElement");
    const right = place.indexOf("if (surface.right + BESIDE_GAP + size.width <= window.innerWidth - EDGE) {");
    const left = place.indexOf("if (surface.left - BESIDE_GAP - size.width >= EDGE) {");
    const below = place.indexOf("const below = anchor.bottom + GAP + size.height <= window.innerHeight - EDGE");
    expect(right).toBeGreaterThan(0);
    expect(left).toBeGreaterThan(right);
    expect(below).toBeGreaterThan(left);
    expect(place).toContain("const surface = (beside ? element.closest(beside) : null)?.getBoundingClientRect() ?? anchor;");
    expect(place).toContain("const top = Math.max(EDGE, Math.min(anchor.top, window.innerHeight - size.height - EDGE));");
  });

  test("the browser's own title tooltip stays retired", () => {
    expect(source).not.toMatch(/\btitle=/);
  });
});
