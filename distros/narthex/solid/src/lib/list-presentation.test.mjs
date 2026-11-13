// C1: run the existing renderer preference and repository-projection boundaries
// with controlled host leaves. The full DB/source integration remains separate.
import { describe, expect, test } from "bun:test";

const root = new URL("../../../../../", import.meta.url);
const home = await Bun.file(new URL("distros/narthex/solid/src/routes/app/home.tsx", root)).text();
const adapter = await Bun.file(new URL("implementations/typescript/engine/src/authoring/locus-commands.ts", root)).text();
const migration = await Bun.file(new URL("implementations/typescript/db/src/queries/locus-root-model.ts", root)).text();
function section(source, from, to) {
  const start = source.indexOf(from), end = to ? source.indexOf(to, start) : source.length;
  if (start < 0 || end <= start) throw new Error(`List presentation boundary moved: ${from}`);
  return new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start, end)).replace(/^export /gm, "");
}
const currentKindCode = section(home, "  const currentKind =", "  // The current authorized transport");
function currentKind({ saved, selected, focus = "root", canvas = true } = {}) {
  const bindings = {
    props: { pane: selected ? { presentation: () => selected } : undefined },
    layoutOptions: () => ["list", "grid", "value", ...(canvas ? ["canvas"] : [])].map(value => ({ value })),
    heldLensSubject: () => undefined, localCodePresentation: () => undefined,
    accountKey: () => "local", scopeKey: () => "root", scope: () => ({ kind: focus }),
    valueScope: () => undefined, scopeSubject: () => ({ row: saved ? { view: { kind: saved } } : null }),
  };
  return new Function(...Object.keys(bindings), `${currentKindCode}; return currentKind();`)(...Object.values(bindings));
}

describe("ordinary list presentation defaults", () => {
  test("missing presentation and old saved-list canvas use List; deliberate Grid and Canvas remain selected", () => {
    expect(currentKind()).toBe("list");
    expect(currentKind({ saved: "grid" })).toBe("grid");
    expect(currentKind({ saved: "list", selected: "grid" })).toBe("grid");
    expect(currentKind({ saved: "canvas", focus: "view" })).toBe("list");
    expect(currentKind({ saved: "canvas", focus: "value", canvas: false })).toBe("list");
    expect(currentKind({ saved: "list", selected: "canvas" })).toBe("canvas");
  });

  test("the repository adapter defers acquisition and returns the exact Fenel projection", () => {
    const context = {}, result = { kind: "list" };
    let acquisitions = 0;
    const project = new Function("engineRequire", "resolveEvaluator", `${section(adapter, "export function defaultListLayout(")}; return defaultListLayout;`)(
      name => { expect(name).toBe("system-registry"); return { getSystemEvaluateContext() { acquisitions++; return context; } }; },
      frame => { expect(frame).toBe(context); return (body, values, active) => {
        expect(body).toEqual({ call: ["view:defaultListLayout"] });
        expect(values).toEqual({}); expect(active).toBe(context); return result;
      }; },
    );
    expect(acquisitions).toBe(0);
    expect(project()).toBe(result);
    expect(acquisitions).toBe(1);
  });

  test("fresh account migration consumes the existing source-owned default without overriding it", () => {
    const layout = { kind: "list" };
    let projections = 0;
    const migrate = new Function("defaultListLayout", "locusListType", "locusListExpression", "assertLocusRoot",
      `${section(migration, "export function migrateLocusRows(", "export function legacyLocusRevision(")}; return migrateLocusRows;`)(
      () => { projections++; return layout; }, () => ({ list: true }), items => ({ items }), () => {},
    );
    expect(migrate([]).layout).toBe(layout);
    expect(projections).toBe(1);
  });
});
