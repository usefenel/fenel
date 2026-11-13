import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Demo 1 (Nov 8): entering data reads like a simple form. Source pins for the
// copy Rom ruled on (no programming words on type cards, empty data says
// nothing) and for the New data dialog's simple lens wiring.
const root = process.env.SIMPLE_ENTRY_SOURCE_ROOT ?? join(import.meta.dir, "..");
const home = readFileSync(join(root, "routes/app/home.tsx"), "utf8");
const valueCard = readFileSync(join(root, "lib/value-card.tsx"), "utf8");

describe("type cards (Rom, Nov 8)", () => {
  const card = home.slice(home.indexOf("function TypePinCard("), home.indexOf("function entityNameFromTaggedId("));
  test("carry no action buttons: no Instantiate / Instances on the card", () => {
    expect(card).not.toMatch(/>\s*Instantiate\s*</);
    expect(card).not.toContain(': "Instances"');
    expect(card).not.toContain("<button");
    // Empty data says nothing.
    expect(card).not.toContain("No data of this type yet.");
  });
  test("show the type's definition rows (not the compact icon strip) outside inline cards", () => {
    expect(card).toContain("<TypeDataPreview type={type()} compact={inline()}");
  });
  test("offer New <Type> and See all <Type> in the right-click menu", () => {
    expect(home).toContain('{ id: "type-new", label: `New ${label}`');
    expect(home).toContain('{ id: "type-see-all", label: `See all ${label}`');
  });
});

describe("an empty list card says nothing", () => {
  const strip = valueCard.slice(valueCard.indexOf("<Show when={showPreviews()}>"));
  test("no Empty list text and no 0 items count", () => {
    expect(strip.slice(0, strip.indexOf("</Show></Show>"))).not.toContain("Empty list");
    // Not even a caller's count ("0 items" from a list card's own label).
    expect(valueCard).toMatch(/\{props\.items\.length === 0 \? ""\s+: props\.countLabel \?\?/);
  });
});

describe("the New data dialog's simple lens", () => {
  const modal = home.slice(home.indexOf("function NewValueModal("), home.indexOf("function TypeComposer("));
  test("passes the lens to the canonical editor and keeps Advanced one click away", () => {
    expect(modal).toContain('presentation={simpleLens() ? "simple" : "full"}');
    expect(modal).toContain('aria-label={inlineCard() || simpleLens() ? "Advanced" : "Simple form"}');
  });
  test("Create exposes the whole typed draft's shared hints and waits for positive validation", () => {
    expect(modal).toContain('disabled={saving() || !creationReady()}');
    expect(modal).toContain('data-tooltip={creationValidationTooltip()}');
    expect(modal).toContain('<MembershipHintsView hints={creationValidationHints()} compact embedded />');
    expect(modal).toContain('hintsTooltipText(creationValidationHints(), true, fields, issue)');
    expect(modal).not.toContain("simpleRefusal()");
    expect(modal).not.toContain("Open Advanced to see why.");
  });
});
