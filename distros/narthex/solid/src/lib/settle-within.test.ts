// Lane reloadcreate (Nov 13): a Create in the Local tab stayed on "Creating…"
// for minutes after its write had committed (worker traffic dump: the root
// append, its publication and its storage commit all answered; the page kept
// "Updating data…", i.e. Home's changeRoot still running). The action waited
// on `await refresh(all)`, the display catch-up of Home's root read, which can
// stay unsettled; the user clicked Create again and saved the type twice.
// A committed write's catch-up may hold the action only for a bounded time.
import { describe, expect, test } from "bun:test";
import { DISPLAY_CATCH_UP_WAIT_MS, settleWithin } from "./settle-within";

const homeSource = (await Bun.file(new URL("../routes/app/home.tsx", import.meta.url)).text()).replaceAll("\r\n", "\n");
function section(start: string, end: string): string {
  const first = homeSource.indexOf(start), last = homeSource.indexOf(end, first + start.length);
  if (first < 0 || last < 0) throw new Error(`home.tsx boundary changed: ${start}`);
  return homeSource.slice(first, last);
}

describe("settleWithin", () => {
  test("a wait that never settles ends after the bound", async () => {
    const started = Date.now();
    expect(await settleWithin(new Promise(() => {}), 30)).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });
  test("a settled wait reports true, a failure is rethrown", async () => {
    expect(await settleWithin(Promise.resolve(1), 1000)).toBe(true);
    await expect(settleWithin(Promise.reject(new Error("refused")), 1000)).rejects.toThrow("refused");
  });
  test("a failure after the bound is not reported (no unhandled rejection)", async () => {
    let fail!: (error: Error) => void;
    const late = new Promise((_, reject) => { fail = reject; });
    expect(await settleWithin(late, 10)).toBe(false);
    fail(new Error("late"));
    await new Promise(r => setTimeout(r, 10));
  });
  test("the bound is seconds, not minutes", () => {
    expect(DISPLAY_CATCH_UP_WAIT_MS).toBeGreaterThanOrEqual(5_000);
    expect(DISPLAY_CATCH_UP_WAIT_MS).toBeLessThanOrEqual(30_000);
  });
});

describe("Home's create path never waits unbounded on the root display catch-up", () => {
  test("changeRoot: after the acknowledged write the refresh is bounded", () => {
    const body = section("async function changeRoot(", "const current = () =>");
    const afterWrite = body.slice(body.indexOf("acknowledgeRootRevision(accountId, written.root.revision"));
    expect(afterWrite).toContain("settleWithin(refresh(all), DISPLAY_CATCH_UP_WAIT_MS)");
    expect(afterWrite.slice(0, afterWrite.indexOf("} catch (error)"))).not.toMatch(/await refresh\(all\);/);
  });
  test("homeData.add: the reads before the append are bounded", () => {
    const body = section("async add(source: { expr: ExprNode; valueType?: FenelType }", "// Adding lands in the scope you are IN.");
    expect(body).not.toMatch(/await refresh\((all|savedAll)\);/);
    expect(body).toContain("settleWithin(refresh(all), DISPLAY_CATCH_UP_WAIT_MS)");
    expect(body).toContain("settleWithin(refresh(savedAll), DISPLAY_CATCH_UP_WAIT_MS)");
  });
});
