import { expect, test } from "bun:test";
import { createRoot, createSignal, createEffect, flush } from "../../node_modules/solid-js/dist/solid.dev.js";

// Fix lane A (Nov 8): after an in-place apply the Local row reloads: Home's
// `current()` is a new row object with the same id (or briefly no row). A Solid 2
// effect's apply reruns whenever its compute reruns, even for an equal key, so
// the effect that clears notices on a data change cleared the "Applied …" notice
// and its Undo right after the apply raised it (seen in the real app: no Undo).
const home = (await Bun.file(new URL("../routes/app/home.tsx", import.meta.url)).text()).replace(/\r\n?/g, "\n");
const marker = home.indexOf("setDismissedNotices([]); setAppliedNotice(undefined);");
if (marker < 0) throw new Error("Notices owner effect moved");
const effectStart = home.lastIndexOf("\n  createEffect(", marker);
const ownerStart = home.lastIndexOf("\n  let noticesOwner", marker);
const start = ownerStart > effectStart - 400 && ownerStart >= 0 ? ownerStart : effectStart;
const end = home.indexOf("});", home.indexOf("setSuggestionApplyError(undefined);", marker)) + 3;
const install = new Function("createEffect", "sessionEpoch", "current", "setDismissedNotices", "setAppliedNotice", "setSuggestionApplyError",
  new Bun.Transpiler({ loader: "ts" }).transformSync(home.slice(start, end)));

test("a row that only reloads keeps the applied notice; another row or session clears it", () => {
  const cleared = [];
  let dispose;
  const [epoch, setEpoch] = createSignal(1);
  const [row, setRow] = createSignal({ id: "local" });
  createRoot(stop => {
    dispose = stop;
    install(createEffect, epoch, row, () => {}, value => { if (value === undefined) cleared.push(`${epoch()}:${row()?.id}`); }, () => {});
  });
  flush();
  const initial = cleared.length;
  setRow({ id: "local" }); flush(); // the in-place apply reloads the row (same id)
  expect(cleared.length).toBe(initial);
  setRow(null); flush();            // or the row is briefly missing
  setRow({ id: "local" }); flush(); // the same row is back
  expect(cleared.length).toBe(initial);
  setRow({ id: "other" }); flush(); // another row
  expect(cleared.length).toBe(initial + 1);
  setEpoch(2); flush();             // another session
  expect(cleared.length).toBe(initial + 2);
  dispose();
});
