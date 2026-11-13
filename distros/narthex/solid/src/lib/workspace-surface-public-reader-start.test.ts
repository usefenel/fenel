import { describe, expect, test } from "bun:test";

// Lane S (Nov 8): the public reader has no `prepareAfter` (it reads only the
// checked repository), yet it used to be requested only once the workspace
// model's first Local operation answered (39-120 s measured in the browser:
// the public worker was created right after that reply). The surface now
// starts it where the model wait begins. Source-order wiring check; the
// browser proof (worker creation before the Local reply) is in the lane report.
const source = (await Bun.file(new URL("./workspace-surface.tsx", import.meta.url)).text()).replace(/\r\n?/g, "\n");

function body(start: string): string {
  const at = source.indexOf(start);
  if (at < 0) throw new Error(`Boundary moved: ${start}`);
  return source.slice(at, at + 12_000);
}

describe("the public reader starts before the workspace model wait", () => {
  test("only a public destination starts its reader, through the keyed entry", () => {
    const helper = body("function startPublicReader(");
    const end = helper.indexOf("\n  }\n");
    const code = helper.slice(0, end);
    expect(code).toContain('target?.$tag !== "PublicSource"');
    expect(code).toContain("reader(target).request();");
    expect(code).not.toContain("prepareModel");
    expect(code).not.toContain("store.prepare");
  });

  test("an addressed public source starts its reader before the model preparation", () => {
    const prepare = body("prepare: source => {");
    const started = prepare.indexOf("startPublicReader(source);");
    expect(started).toBeGreaterThan(0);
    expect(started).toBeLessThan(prepare.indexOf("return prepareModel();"));
  });

  for (const owner of ["async function focusLens(", "async function addLens("]) test(`${owner} starts a public destination before awaiting the model`, () => {
    const code = body(owner);
    const started = code.indexOf("startPublicReader(targetSource ?? ");
    expect(started).toBeGreaterThan(0);
    expect(started).toBeLessThan(code.indexOf("await props.store.prepare();"));
  });
});
