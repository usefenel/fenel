import { expect, test } from "bun:test";
import { dataChangesShown, editInLocalShown } from "./edit-in-local";

const clean = { readOnly: false, dirty: false, saving: false };

test("Save and Discard show for a writable value with unsaved or saving changes", () => {
  expect(dataChangesShown(undefined)).toBe(false);
  expect(dataChangesShown(clean)).toBe(false);
  expect(dataChangesShown({ ...clean, dirty: true })).toBe(true);
  expect(dataChangesShown({ ...clean, saving: true })).toBe(true);
  expect(dataChangesShown({ readOnly: true, dirty: true, saving: false })).toBe(false);
});

test("Edit in Local shows where Save and Discard sit when the datum offers a Local copy (owner review, Nov 11)", () => {
  // A public datum: no expression session, or a read-only clean one.
  expect(editInLocalShown(true, undefined)).toBe(true);
  expect(editInLocalShown(true, { ...clean, readOnly: true })).toBe(true);
  expect(editInLocalShown(true, clean)).toBe(true);
  // Not offered: never shown.
  expect(editInLocalShown(false, undefined)).toBe(false);
  expect(editInLocalShown(false, clean)).toBe(false);
});

test("Edit in Local never shows together with Save and Discard", () => {
  for (const state of [{ ...clean, dirty: true }, { ...clean, saving: true }, { ...clean, dirty: true, saving: true }]) {
    expect(dataChangesShown(state)).toBe(true);
    expect(editInLocalShown(true, state)).toBe(false);
  }
});

test("the lone canvas button is gone from the shell surface; both surfaces use the summary action", async () => {
  const entry = await Bun.file(new URL("./home-entry.tsx", import.meta.url)).text();
  expect(entry).not.toContain(`<Show when={focusDemoCopy()}>{branch => <div style="margin: 0 0 0.75rem">`);
  expect(entry).toContain("<LensEditInLocalAction");
  const home = await Bun.file(new URL("../routes/app/home.tsx", import.meta.url)).text();
  expect(home).toContain("editInLocalShown(");
  expect(home).toContain("dataChangesShown(");
});
