import { expect, test } from "bun:test";
import type { FenelType } from "@fenel/engine/types";
import { createRepositoryRegistry } from "@fenel/engine/repository-registry";
import { stdModule } from "@fenel/engine/modules/std";
import { timeModule } from "@fenel/engine/modules/time";
import { buildAuthoringCatalogSnapshot, createAuthoringEnvironment } from "@fenel/engine/authoring/environment";
import { Nothing } from "@fenel/engine/type-foundation";
import { createDispatchRegistry, dispatchRegistry, resolveEffect } from "@fenel/engine";
import { typeConstructorOf } from "../../../../../implementations/typescript/engine/src/effect-dispatch";
import { detectTypeKind, TYPE_KIND_LABELS } from "@fenel/engine/authoring/type";
import { createReaderPresentation, projectReaderValueReadInSession, type ReaderPresentationSource, type SourceReaderValueReadInput } from "./reader-presentation";
import { typeIconForPresentation } from "./type-icon-presentation";

test("production List Iconable reaches computed graph badges and respects the captured reader", async () => {
  // The source-owned foundation instance supplies the base List icon. There
  // is no test-owned List icon or constant knownTypeIconName in this reader.
  const pool = createDispatchRegistry();
  for (const cls of dispatchRegistry.listClasses()) pool.defineClass(cls);
  for (const cls of dispatchRegistry.listClasses()) {
    for (const instance of dispatchRegistry.listInstances(cls.name)) pool.addInstance(instance);
  }
  const registry = createRepositoryRegistry([stdModule], { dispatchRegistry: pool });
  const frame = { ...registry.evaluateContext(), _activeTags: ["icon-source"] };
  const source: ReaderPresentationSource = { registry, session: { evaluateContext: frame }, catalog: [] };
  const reader = createReaderPresentation(() => source);
  const wordsType = registry.getFunction("std:words")!.returns;
  const listType = registry.getFunction("std:join")!.params[0]!.type;
  expect(reader.representation("Iconable", "List")?.icon).toBe("list");
  expect(reader.representation("Iconable", registry.getUuid("List")!)?.icon).toBe("list");
  const icon = (type: FenelType | undefined, value?: unknown) => {
    const kind = type && detectTypeKind(type);
    return typeIconForPresentation(type, {
      icon: target => typeof target === "string" ? reader.representation("Iconable", target)?.icon
        : resolveEffect(frame, pool, "Iconable", target)?.methods.icon,
      canonicalName: identity => registry.getIdentifiedEntity(identity)?.id ?? identity,
      reflectedIdentity: typeConstructorOf(value, frame),
      kindLabel: kind ? TYPE_KIND_LABELS[kind] : undefined,
    });
  };
  expect(icon(wordsType)).toBe("list");
  expect(icon(listType)).toBe("list");
  expect(icon({ $ref: registry.getUuid("List") ?? "List" })).toBe("list");
  expect(icon({ $ref: "String" })).toBe("type");
  expect(icon({ $ref: "UnregisteredType" })).toBe("type-set");
  const applied: FenelType = { $el: { call: ["List", { $ref: "String" }] } };
  // Production has no generic Iconable row masking this witness. Runtime
  // reflection supplies the outer owner, without changing its element type.
  expect(resolveEffect(frame, pool, "Iconable", applied)).toBeUndefined();
  expect(icon(applied, ["the", "quick", "brown", "fox"])).toBe("list");

  // Exercise the exact prepared graph-data adapter which formerly omitted
  // the icon. Its observed data and inferred type stay independently owned.
  const editor = await Bun.file(new URL("./expression-runner/index.tsx", import.meta.url)).text();
  const start = editor.indexOf("  const graphData = createMemo<ExpressionGraphValue | undefined>");
  const end = editor.indexOf("  const graphType =", start);
  if (start < 0 || end < start) throw new Error("Prepared graph data boundary changed");
  const node = { kind: "call", fnId: "std:words", args: [{ kind: "literal", value: "the quick brown fox" }] };
  let observed: { value: unknown; type?: FenelType; typeIcon?: string; valueIcon?: string } = { value: ["the", "quick", "brown", "fox"] };
  const adapter = new Function("createMemo", "graphValue", "props", "currentInference", "resolvedFieldType", "preparedTypeIcon", "session", "reader", "detectStructuralForm",
    `${new Bun.Transpiler({ loader: "ts" }).transformSync(editor.slice(start, end))}; return graphData;`)(
    (read: () => unknown) => read, () => observed, { node },
    () => ({ outcome: { $tag: "Solved" }, scheme: { body: wordsType } }), () => listType,
    (type: FenelType, _session: unknown, _reader: unknown, value: unknown) => icon(type, value), source.session, reader, () => null,
  ) as () => typeof observed;
  expect(adapter()).toMatchObject({ value: observed.value, type: wordsType, typeIcon: "list" });
  expect(adapter().type).toBe(wordsType);
  if (process.env["FENEL_TYPE_ICON_CAPTURE"] === "1") {
    await Bun.write(new URL("../../../../../.tmp-diag/type-icons-20261011/badge-data.json", import.meta.url), JSON.stringify({
      before: { value: observed.value, type: wordsType, typeLabel: "List of strings" },
      after: { value: adapter().value, type: adapter().type, typeLabel: "List of strings", typeIcon: adapter().typeIcon },
      scope: "Actual production std words type and reader Iconable; controlled observed list value. Before reproduces omitted graphData typeIcon.",
    }));
  }
  observed = { ...observed, type: wordsType, valueIcon: "pin" };
  expect(adapter()).toMatchObject({ typeIcon: "list", valueIcon: "pin" });
  observed = { ...observed, typeIcon: "star" };
  expect(adapter().typeIcon).toBe("star");

  pool.addInstance({ typeName: "Iconable", args: ["List"], methods: { icon: "star" }, priority: 100,
    scope: { kind: "tag", tag: "icon-source" } });
  pool.addInstance({ typeName: "Iconable", args: ["List"], methods: { icon: "pin" }, priority: 1000,
    scope: { kind: "tag", tag: "other-source" } });
  expect(icon(wordsType)).toBe("star");
  expect(icon(listType)).toBe("star");
  expect(reader.representation("Iconable", registry.getUuid("List")!)?.icon).toBe("star");
  pool.addInstance({ typeName: "Iconable", args: [{ $el: { call: ["List", "String"] } }], methods: { icon: "pin" }, priority: 200,
    scope: { kind: "tag", tag: "icon-source" } });
  expect(icon(applied, ["the", "quick", "brown", "fox"])).toBe("pin");
  source.metadata = new Map([["List", new Map()]]);
  expect(reader.representation("Iconable", "List")).toBeUndefined();
  expect(icon(listType)).toBe("list");
}, 120_000);

test("production CalendarDate Iconable reaches a tagged record field through the Local read packet", () => {
  const pool = createDispatchRegistry();
  for (const cls of dispatchRegistry.listClasses()) pool.defineClass(cls);
  for (const cls of dispatchRegistry.listClasses())
    for (const instance of dispatchRegistry.listInstances(cls.name)) pool.addInstance(instance);
  const registry = createRepositoryRegistry([stdModule, timeModule], { dispatchRegistry: pool });
  const frame = registry.evaluateContext();
  const environment = createAuthoringEnvironment(buildAuthoringCatalogSnapshot([]));
  const session = { registry, evaluateContext: frame, environment };
  const calendarDate = { $ref: "4a6fd49d-82cb-4446-99f5-49afe6c07d09" } satisfies FenelType;
  // The source annotation supplies this icon. The fixture registers none.
  const source: ReaderPresentationSource = { registry, session, catalog: [] };
  const reader = createReaderPresentation(() => source);
  expect(registry.getIdentifiedEntity(calendarDate.$ref)).toBeDefined();
  expect(reader.representation("Iconable", calendarDate.$ref)?.icon).toBe("calendar");
  const record = { $record: { fields: [{ name: "date",
    key: { $tag: "NamedField", ref: { $ref: "e808a887-bbf2-4af2-b936-a2d04ccae455" } },
    type: calendarDate, label: Nothing, ui: Nothing, meta: {},
  }] } } as FenelType;
  const input: SourceReaderValueReadInput = {
    value: { $tag: "3a5887cf-f2ef-483d-a9e2-0e21c44b7eb2", date: { year: 2026, month: 11, day: 3 } },
    type: record, typeLookup: "registry", views: [], componentNames: [],
  };
  const packet = projectReaderValueReadInSession(input, session, source, ["calendar", "type-set"]);
  const date = packet.children.find(child => child.key === "date");
  expect(date?.declaredType).toEqual(calendarDate);
  expect(date?.type).toEqual(calendarDate);
  expect(date?.typeIcon).toBe("calendar");

  // A captured representation miss remains authoritative. Correct type
  // transport must not bypass that source or invent an icon from its name.
  const missingSource = { ...source, metadata: new Map([["CalendarDate", new Map<string, Record<string, unknown>>()],
    [calendarDate.$ref, new Map<string, Record<string, unknown>>()]]), };
  const missing = projectReaderValueReadInSession(input, session, missingSource, ["calendar", "type-set"])
    .children.find(child => child.key === "date");
  expect(missing?.type).toEqual(calendarDate);
  expect(missing?.typeIcon).toBe("type-set");
}, 120_000);
