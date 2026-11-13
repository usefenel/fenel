import { describe, expect, test } from "bun:test";
import { createDispatchRegistry } from "../../../../../implementations/typescript/engine/src/dispatch-registry";
import { withInterpretedCompiledArtifacts } from "../../../../../implementations/typescript/engine/src/engine-bodies-dispatch";
import { List, Nothing } from "../../../../../implementations/typescript/engine/src/type-foundation";
import { projectReaderValueReadInSession } from "./reader-presentation";

// A bare constructor is named by its own Labelable, keyed by its tag, as its
// glyph is by its Picturable / Emojiable (the tree of life's
// `_ : Labelable "SolanumLycopersicum"`, whose label the Fenel loader keeps on
// the row). The same inert reader fixture as reader-value-source.test.mjs.
const underSource = work => withInterpretedCompiledArtifacts(work);
const icons = ["star", "heart"];

function fixture() {
  const definitions = new Map();
  const pool = createDispatchRegistry();
  const frame = { _specRegistry: pool, _activeTags: [], _caseOwner: { SolanumLycopersicum: "LivingThing", Mammalia: "LivingThing" } };
  definitions.set("LivingThing", { $variant: { cases: [{ name: "SolanumLycopersicum", fields: [] }, { name: "Mammalia", fields: [] }] } });
  const registry = {
    getIdentifiedEntity: name => definitions.has(name) ? { id: name, type: definitions.get(name) } : undefined,
    getFunction: () => undefined, getUuid: () => undefined,
    getEntityNominalIdentity: name => definitions.has(name) ? name : undefined,
    getFieldRepresentation: () => undefined,
  };
  const session = { registry, evaluateContext: frame, environment: {
    catalog: { types: [], functions: [], referenceRoutes: [], exactConstructorRoutes: [], patternConstructors: [] },
    resolveTypeRef: type => definitions.get(type.$ref),
  } };
  const project = (value, type) => projectReaderValueReadInSession({ value, type, typeLookup: "session", views: [], componentNames: [] },
    session, { catalog: [], types: [], functionRows: [] }, icons);
  return { project, pool };
}

describe("a bare constructor's caption is its own Labelable", () => {
  test("the loader's row label (methods {}) names the item, in a list and alone", () => underSource(() => {
    const f = fixture();
    f.pool.addInstance({ typeName: "Labelable", args: ["SolanumLycopersicum"], methods: {}, label: "Solanum lycopersicum" });
    f.pool.addInstance({ typeName: "Labelable", args: ["Mammalia"], methods: { label: "Mammals" } });
    const list = [{ $tag: "SolanumLycopersicum" }, { $tag: "Mammalia" }];
    const packet = f.project(list, List({ $ref: "LivingThing" }));
    expect(packet.children.map(child => child.caption)).toEqual([{ text: "Solanum lycopersicum", code: false }, { text: "Mammals", code: false }]);
    expect(f.project({ $tag: "SolanumLycopersicum" }, { $ref: "LivingThing" }).root.caption).toEqual({ text: "Solanum lycopersicum", code: false });
  }), 60_000);

  test("no Labelable, a payload or another key gives no caption, as before", () => underSource(() => {
    const f = fixture();
    f.pool.addInstance({ typeName: "Labelable", args: ["Just"], methods: { label: "Present" } });
    expect(f.project({ $tag: "SolanumLycopersicum" }).root.caption).toBeUndefined();
    expect(f.project({ $tag: "Just", _0: 1 }).root.caption).toBeUndefined();
    expect(f.project(Nothing).root.caption).toBeUndefined();
  }), 60_000);
});
