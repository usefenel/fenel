import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { projectAuthoringScheme } from "../../../../../implementations/typescript/engine/src/authoring/scheme-projection";

// C1: execute Home's actual memo and the existing scheme projection without
// starting the application or a cold registry. The browser checks the renderer
// handoff; these controls pin captured ownership and sibling-dependent scope.
const home = readFileSync(resolve(import.meta.dir, "../routes/app/home.tsx"), "utf8");
const owner = home.indexOf("function FunctionCallModalContent(");
const start = home.indexOf("  const parameterSchemes = createMemo(() => {", owner);
const finish = home.indexOf("  const callExpr = createMemo<ExprNode>", start);
if (owner < 0 || start < 0 || finish < 0) throw new Error("Home Call parameter-scheme memo is unavailable");
const transpiler = new Bun.Transpiler({ loader: "ts", target: "browser" });
// The memo's free helper is the engine's real scheme projection, bound as a
// parameter: that module has imports since 84a2b15f, so its text cannot be inlined.
// B4 wave 4 lane H: the memo's Local branch (absent here: these are page readers).
const memo = new Function("projectAuthoringScheme", "localCallSignature", "retainedCallSignature", "authoringSession", "props", "params",
  "resolvedParams", "fn", "createMemo", `${transpiler.transformSync(home.slice(start, finish))}\nreturn parameterSchemes();`);
const run = (...args: unknown[]) => memo(projectAuthoringScheme, undefined, undefined, ...args);
const plain = { $ref: "File" };
const declared = [{ name: "file", type: plain }];
const scheme = { quantified: [], body: { $arrow: { params: declared, returns: { $unit: true } } },
  nominals: [{ path: ["$arrow", "params", "0", "type"], identity: '["std","File"]', publicName: "File" }] };

describe("Home Call captured parameter scheme handoff", () => {
  test("plain parameter slots retain the owning function's nominal sidecar", () => {
    let resolutions = 0;
    const session = { environment: { getFunctionEntry: () => ({ signatureOutcome: { $tag: "Solved" }, scheme }) },
      registry: { callSiteTyping: { resolveType: () => { resolutions++; throw new Error("No dependent type exists"); } } } };
    const result = run(() => session, { fnId: "function-identity" }, () => declared, () => declared,
      () => ({ id: "ImportDemo:fileText" }), (read: () => unknown) => read);
    expect(result[0]).toEqual({ quantified: [], body: plain,
      nominals: [{ path: [], identity: '["std","File"]', publicName: "File" }] });
    expect(resolutions).toBe(0);
  });

  test("the already-concrete sibling result resolves in the same source function frame", () => {
    const concrete = { $refined: { base: { $ref: "String" }, set: { $tag: "SeEnum", values: ["EUR", "USD"] } } };
    const actual = { quantified: [], body: concrete };
    const observed: unknown[] = [];
    const session = { environment: { getFunctionEntry: () => ({ signatureOutcome: { $tag: "Solved" }, scheme }) },
      registry: { callSiteTyping: { resolveType: (...args: unknown[]) => { observed.push(args); return { ok: true, type: actual }; } } } };
    const result = run(() => session, { fnId: "function-identity" }, () => declared,
      () => [{ ...declared[0], type: concrete }], () => ({ id: "ImportDemo:dependentInput" }), (read: () => unknown) => read);
    expect(result[0]).toBe(actual);
    expect(observed).toEqual([[concrete, "ImportDemo:dependentInput"]]);
    expect(result[0]).not.toHaveProperty("nominals");
  });

  test("unavailable signatures and unresolved concrete types never mint an expected owner", () => {
    const unavailable = { environment: { getFunctionEntry: () => ({ signatureOutcome: { $tag: "AnnotationRequired" } }) } };
    expect(run(() => unavailable, { fnId: "id" }, () => declared, () => declared,
      () => undefined, (read: () => unknown) => read)).toEqual([]);
    const unresolved = { environment: { getFunctionEntry: () => ({ signatureOutcome: { $tag: "Solved" }, scheme }) },
      registry: { callSiteTyping: { resolveType: () => ({ ok: false, reason: "missing" }) } } };
    expect(run(() => unresolved, { fnId: "id" }, () => declared,
      () => [{ ...declared[0], type: { $ref: "Unavailable" } }], () => undefined, (read: () => unknown) => read)).toEqual([undefined]);
  });
});
