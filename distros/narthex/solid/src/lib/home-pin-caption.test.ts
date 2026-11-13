import { describe, expect, test } from "bun:test";

// B3 fix 2: pinning a call persists its caption only from the reader's CURRENT
// name. While a Local name is pending (a changed label whose new incarnation
// has not answered, or a failed answer), nothing is persisted.
const home = (await Bun.file(new URL("../routes/app/home.tsx", import.meta.url)).text()).replace(/\r\n/g, "\n");
const start = home.indexOf("  async function pinResult() {");
const end = home.indexOf("  function setArg(", start);
if (start < 0 || end < start) throw new Error("Home pin boundary moved");
const source = new Bun.Transpiler({ loader: "ts" }).transformSync(home.slice(start, end));

function harness(names: { current: boolean; label: string }) {
  const added: Array<{ caption: string }> = [];
  let pinned = false;
  const scope = {
    dismissed: false, pinInFlight: false, closeTimer: undefined,
    pinned: () => pinned, setPinned: (value: boolean) => { pinned = value; }, setPinning: () => {},
    draftIssue: () => undefined, props: { fnId: "uuid-fn", fnName: "doubleIt" },
    nameCurrent: (id: string) => id === "uuid-fn" && names.current,
    callableName: (_id: string, fallback?: string) => names.current ? names.label : fallback ?? "",
    cloneDraftValue: (value: unknown) => value, callExpr: () => ({ kind: "call", fnId: "uuid-fn", args: [] }),
    locusAdd: async (_source: unknown, caption: string) => { added.push({ caption }); return true; },
    close: () => {}, setTimeout: () => 0,
    // B4 slice 2: a reader without Local live guidance.
    callGuidance: undefined, setPinRefusal: () => {},
  };
  const pinResult = new Function(...Object.keys(scope), `${source}; return pinResult;`)(...Object.values(scope)) as () => Promise<void>;
  return { pinResult, added };
}

describe("B3 pinned captions", () => {
  test("a pending or stale Local name is never persisted", async () => {
    const pending = harness({ current: false, label: "Old double" });
    await pending.pinResult();
    expect(pending.added).toEqual([]);
  });

  test("the current name is persisted once answered", async () => {
    const ready = harness({ current: true, label: "Twice" });
    await ready.pinResult();
    expect(ready.added).toEqual([{ caption: "Twice(…)" }]);
  });

  test("a failed name can be retried without persisting the prior name", async () => {
    const names = { current: false, label: "Old double" };
    const call = harness(names);
    await call.pinResult();
    expect(call.added).toEqual([]);
    names.current = true; names.label = "Twice";
    await call.pinResult();
    await call.pinResult();
    expect(call.added).toEqual([{ caption: "Twice(…)" }]);
  });

  test("the pin button waits for a current name", () => {
    const button = home.slice(home.indexOf("class=\"call-modal-foot\""), home.indexOf("Add result to this data") + 40);
    expect(button).toContain("!nameCurrent(props.fnId)");
  });
});
