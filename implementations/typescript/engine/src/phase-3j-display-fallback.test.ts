// ---------------------------------------------------------------------------
// phase-3j-display-fallback.test.ts — module-substrate Phase 3j conformance.
//
// Phase 3j (identity-as-fallback) stops the `.fenel` loader (liftIdentityFacets)
// from auto-stamping a humanized-codeName Labelable + module-name Categorizable
// on EVERY migrated function — a stored derivable masquerading as authored data
// (the anti-pattern this workstream collapses). A function now carries Codeable
// (the mandatory dispatch key) + only the facets it explicitly declares, exactly
// like the retired `defineFunction` path. The derived display moves to READ time:
//
//   displayLabel id    = getLabel id    ?? humanizeCodeName (getCodeName id) ?? id
//   displayCategory id = getCategory id ?? the id's module-prefix           ?? "uncategorized"
//
// getLabel / getCategory stay HONEST passthroughs ("is there an instance?");
// catalog/editor DISPLAY reads route through displayLabel / displayCategory so
// no surface shows a blank once the loader stops auto-stamping.
//
// We register controlled fixture instances into the GLOBAL `dispatchRegistry` the
// dispatch substrate (`dispatchLookupOne`) reads, then exercise the dispatched
// wrappers — proving each rung of the fallback chain WITHOUT depending on a
// specific migrated module's churn-prone identity counts.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { humanizeCodeName } from "./fenel-module";
import { dispatchRegistry } from "./system-entities";
import {
  dispatchedDisplayLabel,
  dispatchedDisplayCategory,
  dispatchedGetLabel,
  dispatchedGetCategory,
} from "./engine-bodies-dispatch";

// Three post-3j footprints a real migrated function can have:
//   (a) explicit @label + @category — kept verbatim.
//   (b) Codeable-ONLY (the post-3j default for an undecorated fn) — the display
//       fns fall to the humanized codeName / module-prefix.
//   (c) no instances at all — the terminal id / "uncategorized" rung.
dispatchRegistry.addInstance({ typeName: "Codeable", args: ["fixture:withLabel"], methods: { codeName: "withLabel" } });
dispatchRegistry.addInstance({ typeName: "Labelable", args: ["fixture:withLabel"], methods: { label: "Explicit Label" } });
dispatchRegistry.addInstance({ typeName: "Categorizable", args: ["fixture:withLabel"], methods: { category: "MyCat" } });
dispatchRegistry.addInstance({ typeName: "Codeable", args: ["fixture:listOrEmpty"], methods: { codeName: "listOrEmpty" } });

describe("Phase 3j — displayLabel read-time fallback", () => {
  test("explicit @label wins (displayLabel returns the Labelable label)", () => {
    expect(dispatchedDisplayLabel("fixture:withLabel")).toBe("Explicit Label");
  });

  test("no Labelable → humanized codeName (the default the loader no longer stamps)", () => {
    // Proves both the fallback rung AND that the humanizeCodeName native is wired
    // into the displayLabel body — if it weren't, the `humanizeCodeName cn` call
    // would fail to resolve.
    expect(dispatchedDisplayLabel("fixture:listOrEmpty")).toBe("List Or Empty");
  });

  test("no Labelable + no Codeable → the id itself (terminal rung)", () => {
    expect(dispatchedDisplayLabel("fixture:ghost")).toBe("fixture:ghost");
  });

  test("getLabel stays an HONEST passthrough — undefined for a Codeable-only id", () => {
    // The loader-symmetry change: an undecorated fn carries NO Labelable, so the
    // honest probe returns Nothing (→ undefined); only the display fallback fills
    // it in.
    expect(dispatchedGetLabel("fixture:listOrEmpty")).toBeUndefined();
  });
});

describe("Phase 3j — displayCategory read-time fallback", () => {
  test("explicit @category wins", () => {
    expect(dispatchedDisplayCategory("fixture:withLabel")).toBe("MyCat");
  });

  test("no Categorizable → the id's module-prefix (restores the old auto-category)", () => {
    expect(dispatchedDisplayCategory("fixture:listOrEmpty")).toBe("fixture");
  });

  test("an unprefixed id → 'uncategorized'", () => {
    expect(dispatchedDisplayCategory("bareid")).toBe("uncategorized");
  });

  test("getCategory stays an HONEST passthrough — undefined for an uncategorized id", () => {
    expect(dispatchedGetCategory("fixture:listOrEmpty")).toBeUndefined();
  });
});

describe("Phase 3j — humanizeCodeName (the read-time label derivation)", () => {
  test("camelCase → Title Case", () => {
    expect(humanizeCodeName("runTelegramCollector")).toBe("Run Telegram Collector");
  });
  test("snake_case → Title Case", () => {
    expect(humanizeCodeName("send_message_text")).toBe("Send Message Text");
  });
  test("all-caps words stay verbatim", () => {
    expect(humanizeCodeName("URL")).toBe("URL");
  });
  test("single word capitalizes (events:constant → Constant)", () => {
    expect(humanizeCodeName("constant")).toBe("Constant");
  });
});
