import { expect, test } from "bun:test";

// Exercise the real runtime helper with its existing registry/authority seams
// injected. No database, registry mutation, mint, or effect implementation is
// available to this fixture: any accidental execution is a hard failure.
const evaluator = await Bun.file(new URL("./evaluator.ts", import.meta.url)).text();
const start = evaluator.indexOf("export async function permitsIOActionAs(");
const end = evaluator.indexOf("export async function invokeIOActionAs(", start);
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(evaluator.slice(start, end).replace("export async", "async"));
const build = new Function("authenticateAuthority", "loadAccountExecutionRegistry", "isJustTrue", `${code}; return permitsIOActionAs;`);
const descriptor = "state:editLocusRoot";
const justTrue = (value: unknown) => !!value && typeof value === "object" && "$tag" in value && value.$tag === "Just" && "_0" in value && value._0 === true;

test("read-only capability asks the perform judgment under the handle's own account", async () => {
  const handle = {};
  const envelope = { scoped: true };
  const seen: unknown[] = [];
  const permit = build((candidate: unknown) => candidate === handle ? { accountId: "owner", envelope } : undefined,
    async (accountId: string) => {
      seen.push(accountId);
      return { listPerformDescriptors: () => [descriptor], performJudge: (...args: unknown[]) => { seen.push(args); return { $tag: "Just", _0: true }; } };
    }, justTrue);
  expect(await permit(handle, descriptor, { id: "owner" })).toBe(true);
  expect(seen).toEqual(["owner", [envelope, { descriptor, args: [{ id: "owner" }] }]]);
  expect(await permit({}, descriptor, { id: "owner" })).toBe(false);
  expect(seen).toHaveLength(2);
});

test("unknown, refused, malformed and unavailable judgments cannot enable editing", async () => {
  for (const verdict of [{ $tag: "Nothing" }, { $tag: "Just", _0: false }, true, { $tag: "Just", _0: "true" }, null,
    Object.create({ $tag: "Just", _0: true }), Object.assign(Object.create({ _0: true }), { $tag: "Just" })]) {
    const permit = build(() => ({ accountId: "owner", envelope: {} }), async () => ({
      listPerformDescriptors: () => [descriptor], performJudge: () => verdict,
    }), justTrue);
    expect(await permit({}, descriptor, { id: "owner" })).toBe(false);
  }
  const unavailable = build(() => ({ accountId: "owner", envelope: {} }), async () => { throw new Error("not ready"); }, justTrue);
  expect(await unavailable({}, descriptor, { id: "owner" })).toBe(false);
  const missing = build(() => ({ accountId: "owner", envelope: {} }), async () => ({
    listPerformDescriptors: () => [], performJudge: () => { throw new Error("unknown descriptor must not be judged"); },
  }), justTrue);
  expect(await missing({}, descriptor, { id: "owner" })).toBe(false);
});
