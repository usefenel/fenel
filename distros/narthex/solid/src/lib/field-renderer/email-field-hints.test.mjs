import { beforeAll, describe, expect, test } from "bun:test";
import { loadFenelModule } from "../../../../../../implementations/typescript/engine/src/fenel-module";
import { pureEvaluateContext } from "../../../../../../implementations/typescript/engine/src/json-logic";
import { membershipHints } from "../../../../../../implementations/typescript/engine/src/validation-hints";
import { createRegistry } from "../../../../../../implementations/typescript/engine/src/registry";
import { stdModule } from "../../../../../../implementations/typescript/engine/src/modules/std";
import { decidableMembershipModule } from "../../../../../../implementations/typescript/engine/src/modules/decidable-membership";
import { setExprEntityModule } from "../../../../../../implementations/typescript/engine/src/modules/set-expr-entities";
import "../../../../../../implementations/typescript/engine/src/format-presets";

// A29 (2026-11-12): a person's e-mail while it is typed. The engine's real
// `membershipHints` over the std e-mail type's own refinement, and this lane's
// view text (compiled from refinement-hints.tsx): for each text on the way to
// rom@usefenel.com, the icon's state and the exact rows of its tooltip.
// HEAVY (it loads a registry, about a minute): run alone in the shared slot,
//   bun test --timeout 280000 ./distros/narthex/solid/src/lib/field-renderer/email-field-hints.test.mjs   (repository root)
const SOURCE = `module EmailHintProbe where

ProbeEmail = String | value ∈ format:email
`;
const repo = (path) => Bun.file(new URL(`../../../../../../${path}`, import.meta.url)).text();
const hintsSource = (await Bun.file(new URL("./refinement-hints.tsx", import.meta.url)).text()).replaceAll("\r\n", "\n");
const from = hintsSource.indexOf("export function hintBadge("), to = hintsSource.indexOf("/** Tracks whether focus", from);
if (from < 0 || to < from) throw new Error("The hints fixture boundary moved.");
const view = new Function(`${new Bun.Transpiler({ loader: "ts" }).transformSync(hintsSource.slice(from, to)).replace(/^export /gm, "")}
  return { hintIconState, fieldHintsTooltip };`)();
const log = (label, value) => console.info(`[email-hints] ${label} ${typeof value === "string" ? value : JSON.stringify(value)}`);

let set, context;
beforeAll(() => {
  const started = Date.now();
  const registry = createRegistry([stdModule, setExprEntityModule, decidableMembershipModule, loadFenelModule(SOURCE, "EmailHintProbe")]);
  context = pureEvaluateContext(registry.evaluateContext());
  const type = registry.getEntity("ProbeEmail").type;
  if (!("$refined" in type)) throw new Error("The probe must stay a refinement");
  set = type.$refined.set;
  log("registry ready after ms", Date.now() - started);
}, 270_000);

describe("the e-mail field's icon and tooltip while rom@usefenel.com is typed", () => {
  // The example a text field of this format shows: its placeholder, authored in the Fenel field plan.
  const EXAMPLE = "user@example.com";
  const look = (value) => {
    const hints = membershipHints(value, set, context);
    const icon = view.hintIconState(hints, false, value === "");
    return { value, whole: hints.state.$tag, icon, tooltip: view.fieldHintsTooltip(hints, false, icon, EXAMPLE, value),
      rules: hints.rules.map(rule => ({ label: rule.label, state: rule.state.$tag, next: rule.cursor?.humanLabel ?? null,
        failedAt: rule.cursor?.failedAt ?? null, active: rule.cursor?.activeGroup ?? null,
        parts: rule.parts.map(part => ({ name: part.name, state: part.state.$tag, start: part.start, end: part.end,
          sub: part.parts.map(sub => `${sub.name}:${sub.state.$tag}`) })) })) };
  };

  test("the probe is the std e-mail type's own refinement, and its example is the field plan's placeholder", async () => {
    expect((await repo("fenel/std/entities/profile.fenel")).replaceAll("\r\n", "\n")).toContain("@label \"Email\"\n@icon \"mail\"\n@description \"String constrained to a valid email address (format:email)\"\nEmailStr = String | value ∈ format:email");
    expect(await repo("fenel/modules/engine/field-render-plan.fenel")).toContain(`placeholder = Just "${EXAMPLE}", validationFormat = Just "email"`);
    expect(set).toEqual({ $tag: "SeRef", handle: "format:email" });
  });

  test("each text on the way, and two wrong ones", () => {
    const seen = {};
    for (const value of ["", "r", "rom", "rom@", "rom@u", "rom@usefenel", "rom@usefenel.", "rom@usefenel.c", "rom@usefenel.com", "rom@@", "rom usefenel", "rom u"]) {
      seen[value] = look(value);
      log(`"${value}"`, seen[value]);
      log(`"${value}" rows`, seen[value].tooltip.split("\n").join("  |  "));
    }
    expect(seen[""].icon).toBe("empty");
    for (const value of ["r", "rom", "rom@", "rom@usefenel", "rom@usefenel."]) expect([value, seen[value].icon]).toEqual([value, "pending"]);
    expect(seen["rom@usefenel.com"].icon).toBe("pass");
    expect(seen["rom@@"].icon).toBe("error");
    expect(seen["rom usefenel"].icon).toBe("error");
    // The example row closes every tooltip of a value that is not valid, and only those.
    expect(seen["rom@"].tooltip.endsWith(`\n  for example ${EXAMPLE}`)).toBe(true);
    expect(seen["rom@usefenel.com"].tooltip.includes("for example")).toBe(false);
    // The exact rows, as the real engine gave them on 2026-11-12 (run of 19:58, 84 s).
    const example = `  for example ${EXAMPLE}`, waiting = "○ valid email — not complete yet";
    const rows = Object.fromEntries(Object.entries(seen).map(([value, result]) => [value, result.tooltip.split("\n")]));
    expect(rows).toEqual({
      "": [waiting, example],
      "r": [waiting, "  ○ local — r", example],
      "rom": [waiting, "  ○ local — rom", example],
      "rom@": [waiting, "  ✓ local — rom", example],
      "rom@u": [waiting, "  ✓ local — rom", "  ○ domain — u", example],
      "rom@usefenel": [waiting, "  ✓ local — rom", "  ○ domain — usefenel", example],
      "rom@usefenel.": [waiting, "  ✓ local — rom", "  ○ domain — usefenel.", example],
      // The format accepts a one-letter ending: the field is valid from the first letter after the dot.
      "rom@usefenel.c": ["✓ valid email", "  ✓ local — rom", "  ✓ domain — usefenel.c"],
      "rom@usefenel.com": ["✓ valid email", "  ✓ local — rom", "  ✓ domain — usefenel.com"],
      "rom@@": ["✗ valid email — \"@\" can't go here (character 5)", "  ✓ local — rom", example],
      "rom usefenel": ["✗ valid email — a space can't go here (character 4)", "  ✗ local — rom", example],
      "rom u": ["✗ valid email — a space can't go here (character 4)", "  ✗ local — rom", example],
    });
  });
});
