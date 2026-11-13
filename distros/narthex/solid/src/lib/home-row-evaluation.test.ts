import { describe, expect, test } from "bun:test";

// B3 (T7/T8): layout rows evaluate through the shared worker-backed card
// evaluation for every reader kind; a Local card has no IO affordance, so no
// IO argument is evaluated on the page and no invokeIOAction is reached.
const home = await Bun.file(new URL("../routes/app/home.tsx", import.meta.url)).text();
function body(header: string): string {
  const start = home.indexOf(header);
  if (start < 0) throw new Error(`Home boundary moved: ${header}`);
  const next = home.indexOf("\nfunction ", start + header.length);
  return home.slice(start, next < 0 ? undefined : next);
}

describe("B3 Home rows and Local IO", () => {
  for (const header of ["function TableRow(", "function CalendarItemView(", "function TimelineItemBody(", "function TreeNodeView("]) {
    test(`T7: ${header.slice(9, -1)} never evaluates on the page`, () => {
      const code = body(header);
      expect(code).toContain("useRowEvaluation(props)");
      expect(code).not.toContain("evaluateAuthoringExpression(expr");
    });
  }

  test("T7: the shared row evaluation is the worker-backed card evaluation", () => {
    const code = body("function useRowEvaluation(");
    expect(code).toContain("createLocusCardEvaluation(");
    expect(code).not.toContain("evaluateAuthoringExpression");
    expect(code).not.toContain("evaluateSessionExpression");
  });

  test("T8: a Local reader offers no IO action, so IO arguments are never evaluated for it", () => {
    const helpers = body("function useHomeReader(");
    expect(helpers).toMatch(/getIOAction: \(id: string\) => reader\?\.kind === "local" \? undefined/);
    expect(helpers).toMatch(/getStopAction: \(id: string\) => \{\s+if \(reader\?\.kind === "local"\) return undefined;/);
  });
});
