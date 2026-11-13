import { describe, expect, test } from "bun:test";

// B4 F1: the field registry Home hands its renderers. For a Local reader it is
// the reader's own registry by identity with its snapshot (`reader.registry()`),
// never a read of the page session's registry; Account and public readers keep
// their session's registry. Home's render props all go through that helper.
const source = (await Bun.file(new URL("../routes/app/home.tsx", import.meta.url)).text()).replace(/\r\n/g, "\n");
const transpiler = new Bun.Transpiler({ loader: "ts" });
const start = source.indexOf("function readerFieldOwner(");
const helper = start < 0 ? undefined : new Function(`${transpiler.transformSync(source.slice(start, source.indexOf("\n}\n", start) + 3))}; return readerFieldOwner;`)();

function poisoned() {
  const reads = [];
  const session = {};
  for (const key of ["registry", "evaluateContext", "environment", "catalog"]) Object.defineProperty(session, key, { get() {
    reads.push(key); throw new Error(`Page session ${key} read for a Local reader`); } });
  return { session, reads };
}

describe("B4 F1: Home's render props for a Local reader", () => {
  test("the helper answers the reader's own registry without reading the page session", () => {
    expect(helper).toBeDefined();
    const token = { snapshot: "registry" }, page = poisoned();
    expect(helper({ kind: "local", registry: () => token }, () => page.session)).toBe(token);
    expect(page.reads).toEqual([]);
    const accountRegistry = { account: true };
    expect(helper({ kind: "account", registry: () => token }, () => ({ registry: accountRegistry }))).toBe(accountRegistry);
    expect(helper(undefined, () => ({ registry: accountRegistry }))).toBe(accountRegistry);
  });

  test("no renderer prop reads a session's registry directly", () => {
    const props = [...source.matchAll(/\b(?:fieldRegistry|registry|callableRegistry)=\{([^}]*)\}/g)].map(match => match[1]);
    const direct = props.filter(expression => /[Ss]ession\(\)\.registry/.test(expression));
    expect(direct).toEqual([]);
    expect(props.filter(expression => expression.startsWith("readerFieldOwner(")).length).toBeGreaterThanOrEqual(12);
  });

  test("the call-input tester hands no page frame to a Local reader", () => {
    expect(source).toContain('evaluateContext={reader?.kind === "local" ? undefined : props.session().evaluateContext}');
  });

  test("a Local Result label keeps the page's caption normalisation and its \"Type\" fallback while pending", () => {
    expect(source).toContain('? local ? valueCardTypeLabel(reader.typePresentation?.(projected)?.label ?? "") || "Type"');
  });
});
