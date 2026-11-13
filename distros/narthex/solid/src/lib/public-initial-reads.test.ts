// C1: exercise the actual inert bootstrap ingress while every evaluator is
// unavailable. No mock module or process-wide registry is installed.
import { describe, expect, test } from "bun:test";
import { CHECKPOINT_VALUE_ENCODING, decodeCheckpointValue, encodeCheckpointValue } from "@fenel/engine/checkpoint-json";
import { exprNodeToLogic, type ExprNode } from "@fenel/engine/authoring/expression";
import { createAuthoringEnvironment } from "@fenel/engine/authoring/environment";
import { detectStructuralForm } from "./expression-runner/expression-structure";
import type { PublicBootstrap } from "./public-bootstrap";

const source = await Bun.file(new URL("./public-bootstrap.ts", import.meta.url)).text();
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source)
  .replace(/^import .*;\r?\n/gm, "")
  .replace(/\bexport /g, "")
  .replace('import("./generated/public-bootstrap.json")', "loadGenerated()");

const expression: ExprNode = { kind: "call", fnId: "checked:twice", args: [{ kind: "literal", value: 2 }] };
function wire(value: unknown = 4) {
  const root = { id: "public-fenel", name: "Fenel", revision: 0, persisted: false, canEdit: false,
    type: { $ref: "Any" }, expr: { kind: "literal", value: { __list: [expression] } },
    layout: { kind: "grid" }, items: [{ id: "initial", source: { kind: "expr", expr: expression } }],
    lists: [], expressions: {}, referenceId: "locus:public-fenel" };
  return { schema: "fenel.public-bootstrap.v1", sourceDigest: "exact source", identityDigest: "exact identity",
    encoding: CHECKPOINT_VALUE_ENCODING, root: encodeCheckpointValue(root),
    workspace: encodeCheckpointValue({ value: { lenses: [{ source: { $tag: "PublicSource" } }] } }),
    initialReads: encodeCheckpointValue({ schema: "fenel.public-initial-reads.v1", sourceDigest: "exact source",
      identityDigest: "exact identity", rootId: root.id, entries: [{ expression, value }] }) };
}

function harness(snapshot: ReturnType<typeof wire>) {
  let imports = 0;
  const bindings = { CHECKPOINT_VALUE_ENCODING, encodeCheckpointValue, decodeCheckpointValue,
    loadGenerated: async () => { imports++; return { default: snapshot }; } };
  const api = new Function(...Object.keys(bindings), `${code}; return { loadPublicBootstrap, readPublicInitialValue, readPublicInitialGraphValue };`)(...Object.values(bindings)) as
    Pick<typeof import("./public-bootstrap"), "loadPublicBootstrap" | "readPublicInitialValue" | "readPublicInitialGraphValue">;
  return { ...api, imports: () => imports };
}

function referenceWire() {
  const snapshot = wire();
  const root = decodeCheckpointValue(snapshot.root, snapshot.encoding) as PublicBootstrap["root"];
  const producer: ExprNode = { kind: "ref", savedExprId: "binding-a" };
  const nested: ExprNode = { kind: "ref", savedExprId: "binding-b" };
  const terminal: ExprNode = { kind: "literal", value: 4 };
  root.expr = { kind: "literal", value: { __list: [producer] } };
  root.items[0]!.source = { kind: "expr", expr: producer };
  root.expressions = { "binding-a": nested, "binding-b": terminal };
  snapshot.root = encodeCheckpointValue(root);
  const reads = decodeCheckpointValue(snapshot.initialReads, snapshot.encoding) as NonNullable<PublicBootstrap["initialReads"]>;
  snapshot.initialReads = encodeCheckpointValue({ ...reads, entries: [{ expression: producer, value: 4,
    sources: [{ id: "binding-a", expression: nested }, { id: "binding-b", expression: terminal }],
    observations: [{ expression: terminal, value: 4 }] }] });
  return { snapshot, producer, terminal };
}

describe("checked initial public reads", () => {
  test("a retained reference is bound to its complete current public source inputs without an evaluator", async () => {
    const { snapshot, producer, terminal } = referenceWire();
    const h = harness(snapshot), { root } = await h.loadPublicBootstrap();
    expect(h.readPublicInitialValue(root, producer)).toEqual({ value: 4 });
    expect(h.readPublicInitialGraphValue(root, producer, terminal)).toEqual({ value: 4 });
    expect(root.items[0]!.source).toEqual({ kind: "expr", expr: producer });
    const target = root.expressions["binding-b"] as Extract<ExprNode, { kind: "literal" }>;
    target.value = 5;
    expect(h.readPublicInitialValue(root, producer)).toBeUndefined();
    expect(h.readPublicInitialGraphValue(root, producer, terminal)).toBeUndefined();
    target.value = 4;
    expect(h.readPublicInitialValue(root, producer)).toEqual({ value: 4 });
    root.expressions["binding-b"] = { ...target };
    expect(h.readPublicInitialValue(root, producer)).toBeUndefined();
  });

  test("missing, replaced and foreign source owners cannot borrow a retained reference result", async () => {
    for (const change of ["delete", "map", "accessor", "rootAccessor", "private", "copy"] as const) {
      const { snapshot, producer } = referenceWire();
      const h = harness(snapshot), { root } = await h.loadPublicBootstrap();
      expect(h.readPublicInitialValue(root, producer)).toEqual({ value: 4 });
      if (change === "delete") delete root.expressions["binding-b"];
      else if (change === "map") root.expressions = { ...root.expressions };
      else if (change === "accessor") Object.defineProperty(root.expressions, "binding-b", { get() { throw new Error("Source accessor ran"); } });
      else if (change === "rootAccessor") Object.defineProperty(root, "expressions", { get() { throw new Error("Source root accessor ran"); } });
      else if (change === "private") root.persisted = true;
      else { expect(h.readPublicInitialValue({ ...root }, producer)).toBeUndefined(); continue; }
      expect(h.readPublicInitialValue(root, producer)).toBeUndefined();
    }
  });

  test("reference ingress refuses absent, duplicated or mismatching admitted source facts", async () => {
    for (const change of ["absent", "missing", "duplicate", "different"] as const) {
      const { snapshot } = referenceWire();
      const reads = decodeCheckpointValue(snapshot.initialReads, snapshot.encoding) as NonNullable<PublicBootstrap["initialReads"]>;
      const entry = reads.entries[0]!;
      const sources = entry.sources!;
      snapshot.initialReads = encodeCheckpointValue({ ...reads, entries: [{ ...entry,
        sources: change === "absent" ? undefined : change === "missing" ? sources.slice(1)
          : change === "duplicate" ? [...sources, sources[0]]
          : sources.map(row => row.id === "binding-b" ? { ...row, expression: { kind: "literal", value: 99 } } : row),
      }] });
      await expect(harness(snapshot).loadPublicBootstrap()).rejects.toThrow("public initial");
    }
  });

  test("Graph reads the checked root's actual initial steps without preparing an evaluator", async () => {
    const snapshot = wire();
    const reads = decodeCheckpointValue(snapshot.initialReads, snapshot.encoding) as NonNullable<PublicBootstrap["initialReads"]>;
    const child = expression.args[0]!;
    snapshot.initialReads = encodeCheckpointValue({ ...reads, entries: [{ expression, value: 4,
      observations: [{ expression: child, value: 2 }] }] });
    const h = harness(snapshot), { root } = await h.loadPublicBootstrap();
    const source = root.items[0]!.source!;
    if (source.kind !== "expr" || source.expr.kind !== "call") throw new Error("Missing producer");
    expect(h.readPublicInitialGraphValue(root, source.expr, source.expr)).toEqual({ value: 4 });
    expect(h.readPublicInitialGraphValue(root, source.expr, source.expr.args[0])).toEqual({ value: 2 });
    expect(h.readPublicInitialGraphValue({ ...root }, source.expr, child)).toBeUndefined();
    expect(h.readPublicInitialGraphValue(root, { ...expression, fnId: "changed" }, child)).toBeUndefined();
    expect(h.readPublicInitialGraphValue(root, { ...expression, args: [{ kind: "literal", value: 3 }] }, child)).toBeUndefined();
    expect(h.readPublicInitialGraphValue(root, source.expr, { kind: "literal", value: 99 })).toBeUndefined();
    root.revision++;
    expect(h.readPublicInitialGraphValue(root, source.expr, child)).toBeUndefined();
    expect(h.imports()).toBe(1);
  });

  test("initial child observations refuse repeated indistinguishable occurrences and cross-root reads", async () => {
    const snapshot = wire();
    const reads = decodeCheckpointValue(snapshot.initialReads, snapshot.encoding) as NonNullable<PublicBootstrap["initialReads"]>;
    const child = expression.args[0]!;
    const other = { ...expression, fnId: "other:twice" };
    snapshot.initialReads = encodeCheckpointValue({ ...reads, entries: [
      { expression, value: 4, observations: [{ expression: child, value: 2 }, { expression: child, value: 7 }] },
      { expression: other, value: 8, observations: [{ expression: child, value: 3 }] },
    ] });
    const h = harness(snapshot), { root } = await h.loadPublicBootstrap();
    expect(h.readPublicInitialGraphValue(root, expression, child)).toBeUndefined();
    expect(h.readPublicInitialGraphValue(root, other, child)).toEqual({ value: 3 });
  });
  test("initial values are readable with no evaluator/editor import and retain the producing expression", async () => {
    const h = harness(wire({ count: 4, label: "checked result" }));
    const snapshot = await h.loadPublicBootstrap();
    const node = snapshot.root.items[0]!.source!;
    if (node.kind !== "expr") throw new Error("Missing original producer");
    expect(node.expr).toEqual(expression);
    expect(h.readPublicInitialValue(snapshot.root, node.expr)?.value).toEqual({ count: 4, label: "checked result" });
    expect(await h.loadPublicBootstrap()).toBe(snapshot);
    expect(h.imports()).toBe(1);
  });

  test("private, editable, copied, changed-root and changed-input data cannot borrow a result", async () => {
    const h = harness(wire()); const { root } = await h.loadPublicBootstrap();
    expect(h.readPublicInitialValue(undefined, expression)).toBeUndefined();
    expect(h.readPublicInitialValue(root, undefined)).toBeUndefined();
    expect(h.readPublicInitialValue({ ...root }, expression)).toBeUndefined();
    expect(h.readPublicInitialValue({ ...root, persisted: true }, expression)).toBeUndefined();
    expect(h.readPublicInitialValue(root, { ...expression, args: [{ kind: "literal", value: 3 }] })).toBeUndefined();
    const original = { canEdit: root.canEdit, persisted: root.persisted, id: root.id, revision: root.revision, expr: root.expr };
    for (const mutation of [{ canEdit: true }, { persisted: true }, { id: "account" }, { revision: 1 },
      { expr: structuredClone(root.expr) }]) {
      Object.assign(root, mutation);
      expect(h.readPublicInitialValue(root, expression)).toBeUndefined();
      Object.assign(root, original);
    }
    expect(h.readPublicInitialValue(root, expression)?.value).toBe(4);
  });

  test("source, identity, root and schema mismatches refuse before initial values are exposed", async () => {
    for (const mutation of [{ sourceDigest: "later source" }, { identityDigest: "later identity" },
      { rootId: "other root" }, { schema: "unrecognised" }]) {
      const snapshot = wire();
      const reads = decodeCheckpointValue(snapshot.initialReads, snapshot.encoding) as NonNullable<PublicBootstrap["initialReads"]>;
      snapshot.initialReads = encodeCheckpointValue({ ...reads, ...mutation });
      const h = harness(snapshot);
      await expect(h.loadPublicBootstrap()).rejects.toThrow("public initial reads changed");
    }
  });

  test("native atoms preserve their exact value and cannot collide with JSON null producers", async () => {
    const snapshot = wire(-Infinity);
    const reads = decodeCheckpointValue(snapshot.initialReads, snapshot.encoding) as NonNullable<PublicBootstrap["initialReads"]>;
    const nonfinite = { ...expression, args: [{ kind: "literal" as const, value: Infinity }] };
    snapshot.initialReads = encodeCheckpointValue({ ...reads, entries: [{ expression: nonfinite, value: -Infinity }] });
    const h = harness(snapshot); const { root } = await h.loadPublicBootstrap();
    expect(h.readPublicInitialValue(root, nonfinite)?.value).toBe(-Infinity);
    expect(h.readPublicInitialValue(root, { ...expression, args: [{ kind: "literal", value: null }] })).toBeUndefined();
  });

  test("an absent initial result stays unknown and duplicate producers refuse", async () => {
    const snapshot = wire();
    const reads = decodeCheckpointValue(snapshot.initialReads, snapshot.encoding) as NonNullable<PublicBootstrap["initialReads"]>;
    snapshot.initialReads = encodeCheckpointValue({ ...reads, entries: [] });
    const h = harness(snapshot); const { root } = await h.loadPublicBootstrap();
    expect(h.readPublicInitialValue(root, expression)).toBeUndefined();
    snapshot.initialReads = encodeCheckpointValue({ ...reads, entries: [...reads.entries, { expression, value: 5 }] });
    await expect(harness(snapshot).loadPublicBootstrap()).rejects.toThrow("conflicting producers");
  });
});

test("build projection delegates reachable calls to the existing reader and leaves dependencies/failures live", async () => {
  const generator = await Bun.file(new URL("../../scripts/generate-public-bootstrap.mjs", import.meta.url)).text();
  const start = generator.indexOf("const initialEntries = new Map();");
  const end = generator.indexOf("const initialReads = {", start);
  if (start < 0 || end < start) throw new Error("Initial read generation boundary changed");
  const dependency: ExprNode = { kind: "call", fnId: "checked:dependent", args: [{ kind: "ref", savedExprId: "mutable" }] };
  const failing: ExprNode = { kind: "call", fnId: "checked:refused", args: [] };
  const calls: ExprNode[] = [], failures: string[] = [];
  const classifiedSessions: Array<{ registry: unknown; environment: unknown; evaluateContext: unknown }> = [];
  const frame = { _authority: { retained: "anonymous empty" } };
  const registry = { identity: "checked public repository" }, environment = createAuthoringEnvironment();
  const plain = { raw: { kind: "call", fnId: "raw-data:never-run", args: [] } };
  const data = { session: { registry, environment, evaluateContext: { obsolete: true } }, root: { items: [{ source: { kind: "expr", expr: {
    kind: "literal", value: { __record: { fields: [{ name: "ready", value: expression },
      { name: "dependent", value: dependency }, { name: "refused", value: failing },
      { name: "duplicate", value: expression }, { name: "raw", value: { kind: "literal", value: plain } }] } },
  } } }] } };
  const bindings = { data, frame, Buffer, CHECKPOINT_VALUE_ENCODING, encodeCheckpointValue, decodeCheckpointValue,
    isDeepStrictEqual: (left: unknown, right: unknown) => {
      expect(left).toEqual(right); return true;
    },
    exprNodeToLogic, detectStructuralForm,
    evaluateAuthoringExpressionInSession: (node: ExprNode, resolver: unknown, session: { evaluateContext: unknown },
      _values: unknown, options: unknown) => {
      expect(session.evaluateContext).toBe(frame); expect(resolver).toBeUndefined(); expect(options).toEqual({ trace: false, capture: true });
      const classifiedSession = classifiedSessions.at(-1);
      if (classifiedSession === undefined) throw new Error("Reader evaluation started before session classification");
      expect(session).toBe(classifiedSession);
      calls.push(node);
      if (node === failing) throw new Error("anonymous frame refused host act");
      return { result: { value: NaN, bytes: new Uint8Array([1, 2]) }, captures: [{ site: 0, value: 2 }] };
    },
    authoringExpressionSites: (node: ExprNode) => ({ sites: node.kind === "call" ? node.args.map(node => ({ node })) : [] }),
    expressionRendersSampledMedia: (_node: ExprNode, saved: ReadonlyMap<string, ExprNode>,
      session: { registry: unknown; environment: unknown; evaluateContext: unknown }) => {
      expect(saved.size).toBe(0);
      expect(session.registry).toBe(registry); expect(session.environment).toBe(environment);
      expect(session.evaluateContext).toBe(frame);
      classifiedSessions.push(session);
      return false;
    },
    console: { log: (message: string) => failures.push(message) },
  };
  const projected = new Function(...Object.keys(bindings), `${generator.slice(start, end)}; return [...initialEntries.values()];`)(...Object.values(bindings));
  expect(calls).toEqual([expression, failing]);
  expect(classifiedSessions).toHaveLength(2);
  expect(projected).toHaveLength(1); expect(projected[0].expression).toBe(expression);
  expect(projected[0].value).toEqual({ value: NaN, bytes: new Uint8Array([1, 2]) });
  expect(projected[0].observations).toEqual([{ expression: expression.args[0], value: 2 }]);
  expect(failures).toEqual(["Public initial read remains live: checked:dependent: public source mutable is unavailable",
    "Public initial read remains live: checked:refused: anonymous frame refused host act"]);
});

async function generateReferencedFixture(producer: ExprNode, expressions: Record<string, ExprNode>, natives: Record<string, (...args: unknown[]) => unknown> = {}) {
  const generator = await Bun.file(new URL("../../scripts/generate-public-bootstrap.mjs", import.meta.url)).text();
  const start = generator.indexOf("const initialEntries = new Map();"), end = generator.indexOf("const initialReads = {", start);
  if (start < 0 || end < start) throw new Error("Initial read generation boundary changed");
  const { evaluateAuthoringExpressionInSession, authoringExpressionSites } = await import("./expression-runner/expression-evaluation");
  const { isDeepStrictEqual } = await import("node:util");
  const frame = { natives, getFunction: () => undefined };
  const environment = createAuthoringEnvironment();
  const data = { session: { mode: "detached", registry: { getFunction: () => undefined }, environment },
    root: { items: [{ source: { kind: "expr", expr: producer } }], expressions } };
  const failures: string[] = [];
  const bindings = { data, frame, Buffer, CHECKPOINT_VALUE_ENCODING, encodeCheckpointValue, decodeCheckpointValue,
    exprNodeToLogic, detectStructuralForm, evaluateAuthoringExpressionInSession, authoringExpressionSites, isDeepStrictEqual,
    inferTransferExpression: () => { throw new Error("No fixture result needs optional list inference"); },
    expressionRendersSampledMedia: (_node: ExprNode, saved: ReadonlyMap<string, ExprNode>, session: { evaluateContext: unknown }) => {
      expect(session.evaluateContext).toBe(frame);
      expect([...saved.keys()].every(id => Object.hasOwn(expressions, id))).toBe(true);
      return false;
    }, console: { log: (message: string) => failures.push(message) } };
  const entries = new Function(...Object.keys(bindings), `${generator.slice(start, end)}; return [...initialEntries.values()];`)(...Object.values(bindings)) as
    Array<NonNullable<PublicBootstrap["initialReads"]>["entries"][number]>;
  return { entries, failures, frame };
}

test("generation evaluates only the admitted reference closure and retains its exact producer and source bodies", async () => {
  const producer: ExprNode = { kind: "ref", savedExprId: "selected" };
  const child: ExprNode = { kind: "literal", value: "Ada" };
  const body: ExprNode = { kind: "literal", value: { __record: { fields: [{ name: "name", value: { kind: "ref", savedExprId: "person" } }] } } };
  const expressions = { selected: body, person: child };
  Object.defineProperty(expressions, "unrelated-image", { get() { throw new Error("Unrelated image was inspected"); }, enumerable: true });
  const result = await generateReferencedFixture(producer, expressions);
  expect(result.failures).toEqual([]);
  expect(result.entries).toHaveLength(1);
  expect(result.entries[0]!.expression).toBe(producer);
  expect(result.entries[0]!.value).toEqual({ name: "Ada" });
  expect(result.entries[0]!.sources).toEqual([{ id: "selected", expression: body }, { id: "person", expression: child }]);
  expect(result.entries[0]!.sources![0]!.expression).toBe(body);
  expect(result.entries[0]!.sources![1]!.expression).toBe(child);
});

test("missing, cyclic and accessor public source closures remain live before any evaluation", async () => {
  const producer: ExprNode = { kind: "ref", savedExprId: "selected" };
  for (const expressions of [
    {},
    { selected: { kind: "ref", savedExprId: "missing" } },
    { selected: { kind: "ref", savedExprId: "other" }, other: producer },
    Object.defineProperty({}, "selected", { get() { throw new Error("Source accessor ran"); }, enumerable: true }),
  ] as Array<Record<string, ExprNode>>) {
    const result = await generateReferencedFixture(producer, expressions);
    expect(result.entries).toEqual([]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain("public source");
    expect(result.failures[0]).not.toContain("Source accessor ran");
  }
});

test("literal marker-looking data is opaque and reference source bytes stay inside the existing transport cap", async () => {
  let calls = 0;
  const dormant: ExprNode = { kind: "literal", value: { $tag: "Payload", __record: { fields: [
    { name: "never", value: { kind: "call", fnId: "touch", args: [] } },
  ] } } };
  expect((await generateReferencedFixture(dormant, {}, { touch: () => { calls++; return 1; } })).entries).toEqual([]);
  expect(calls).toBe(0);
  const producer: ExprNode = { kind: "ref", savedExprId: "large-source" };
  const body: ExprNode = { kind: "call", fnId: "count", args: [{ kind: "literal", value: "x".repeat(600 * 1024) }] };
  const result = await generateReferencedFixture(producer, { "large-source": body }, { count: () => 1 });
  expect(result.entries).toEqual([]);
  expect(result.failures[0]).toContain("initial read exceeds its transport size");
});

test("the existing combined initial-read transport budget remains enforced", async () => {
  const value = "x".repeat(450 * 1024);
  let runs = 0;
  const natives = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`large${index}`, () => { runs++; return value; }]));
  const producer: ExprNode = { kind: "literal", value: { __list: Array.from({ length: 10 }, (_, index): ExprNode => ({
    kind: "call", fnId: `large${index}`, args: [],
  })) } };
  const result = await generateReferencedFixture(producer, {}, natives);
  expect(runs).toBe(10);
  expect(result.entries).toHaveLength(9);
  expect(result.failures.some(message => message.includes("combined transport size"))).toBe(true);
});
