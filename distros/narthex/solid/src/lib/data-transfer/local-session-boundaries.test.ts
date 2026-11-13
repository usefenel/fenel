import { describe, expect, test } from "bun:test";
import { createAuthoringEnvironment } from "@fenel/engine/authoring/environment";
import { List, Maybe, Nothing } from "@fenel/engine/type-foundation";
import type { FenelType, FieldDef } from "@fenel/engine/types";
import { inertAuthoringSession, type AuthoringSession } from "../expression-runner/account-authoring-session";
import { childValueType, framelessDisplayType } from "./child-type";
import { adaptTransferForSession, analyzeWorkspaceTransfer } from "./session-analysis";
import { TransferError } from "./types";

// B4 wave 4 lane S: a Local reader's page session has no frame (its
// `evaluateContext` throws). The child type of a container reads the frame
// only for a dependent (`$el`) type, which stays undecided on a frameless
// session; the transfer analysis refuses its page fallback for it.
const number: FenelType = { $ref: "Number" };
const field = (name: string, type: FenelType): FieldDef => ({ name, type, label: Nothing, ui: Nothing, meta: {} });
const point: FenelType = { $record: { fields: [field("x", number), field("y", number)] } };
const environment = createAuthoringEnvironment({ types: [], functions: [], capabilities: [], catalogTypes: [],
  operatorCodeNameByNotation: new Map() } as never);
const registry = new Proxy({}, { get(_target, key) { throw new Error(`A page registry read (${String(key)})`); } }) as never;
let frameReads = 0;
const framed: AuthoringSession = Object.freeze({ mode: "detached", registry, catalog: environment.catalog, environment,
  get evaluateContext(): never { frameReads++; throw new Error("A page frame read"); } });
const frameless = inertAuthoringSession({ mode: "detached", registry, catalog: environment.catalog, environment });

describe("a frameless page session's child types and transfer analysis", () => {
  test("a record or list child type never reads the frame, framed or frameless", () => {
    frameReads = 0;
    for (const session of [framed, frameless]) {
      expect(childValueType({ x: 1, y: 2 }, point, "x", session)).toBe(number);
      expect(childValueType([1], List(number), 0, session)).toBe(number);
    }
    expect(frameReads).toBe(0);
  });

  test("a tagged record constructor keeps its declared fields without reading a frame", () => {
    frameReads = 0;
    const value = { $tag: "Point", x: 1, y: 2 };
    for (const session of [framed, frameless]) {
      expect(childValueType(value, point, "x", session)).toBe(number);
      expect(childValueType(value, point, "y", session)).toBe(number);
      expect(childValueType(value, point, "missing", session)).toBeUndefined();
    }
    expect(frameReads).toBe(0);
  });

  test("an encyclopedia record preserves its captured child declarations without inspecting their values", () => {
    // The production EncyclopediaGenusEntry is a single named constructor:
    // a $record declaration whose runtime value still carries its $tag.
    const genus: FenelType = { $ref: "PlantGenus" };
    const species = List({ $ref: "PlantSpecies" });
    const plates = List({ $ref: "BotanicalIllustration" });
    const entry: FenelType = { $record: { fields: [
      field("genus", genus), field("species", species), field("plates", plates),
    ] } };
    const captured = createAuthoringEnvironment({ functions: [], capabilities: [], catalogTypes: [],
      operatorCodeNameByNotation: new Map(), types: [{ id: "EncyclopediaGenusEntry", entityId: "EncyclopediaGenusEntry",
        name: "EncyclopediaGenusEntry", description: "", category: "type", type: entry }] });
    const session = inertAuthoringSession({ mode: "detached", registry, catalog: captured.catalog, environment: captured });
    const reference: FenelType = { $ref: "EncyclopediaGenusEntry" };
    // Read-time type projection must not materialize the image-containing
    // plates value or infer a new type from any of these child payloads.
    const value = { $tag: "EncyclopediaGenusEntry",
      get genus(): never { throw new Error("Genus value was read for a declared child type"); },
      get species(): never { throw new Error("Species value was read for a declared child type"); },
      get plates(): never { throw new Error("Plate value was read for a declared child type"); },
    };
    expect(childValueType(value, reference, "genus", session)).toEqual(genus);
    expect(childValueType(value, reference, "species", session)).toEqual(species);
    expect(childValueType(value, reference, "plates", session)).toEqual(plates);
    expect(childValueType(value, reference, "missing", session)).toBeUndefined();
    // A visible constructor tag does not rebind an unavailable declaration.
    expect(childValueType(value, { $ref: "UnavailableEntry" }, "plates", session)).toBeUndefined();
    expect(childValueType(value, undefined, "plates", session)).toBeUndefined();
  });

  test("genuine variants retain exact case and field selection", () => {
    frameReads = 0;
    const text: FenelType = { $ref: "String" };
    const variant: FenelType = { $variant: { cases: [
      { name: "Measured", label: Nothing, fields: [field("value", number)] },
      { name: "Named", label: Nothing, fields: [field("value", text)] },
      { name: "Empty", label: Nothing, fields: [] },
    ] } };
    for (const session of [framed, frameless]) {
      expect(childValueType({ $tag: "Measured", value: 1 }, variant, "value", session)).toBe(number);
      expect(childValueType({ $tag: "Named", value: "one" }, variant, "value", session)).toBe(text);
      expect(childValueType({ $tag: "Empty" }, variant, "value", session)).toBeUndefined();
      expect(childValueType({ $tag: "Unknown", value: 1 }, variant, "value", session)).toBeUndefined();
      expect(childValueType({ value: 1 }, variant, "value", session)).toBeUndefined();
      expect(childValueType({ $tag: "Measured", value: 1 }, variant, "missing", session)).toBeUndefined();
    }
    expect(frameReads).toBe(0);
  });

  test("a record tag does not resolve missing or frameless dependent declarations", () => {
    const value = { $tag: "Point", x: 1, y: 2 };
    expect(childValueType(value, undefined, "x", frameless)).toBeUndefined();
    expect(childValueType(value, { $ref: "UnavailablePoint" }, "x", frameless)).toBeUndefined();
    expect(childValueType(value, { $record: { fields: [] } }, "x", frameless)).toBeUndefined();
    const dependent = { $el: { var: "shape" } } as unknown as FenelType;
    expect(childValueType(value, dependent, "x", frameless)).toBeUndefined();
  });

  test("a dependent child type is undecided on a frameless session, never a guess", () => {
    const dependent = { $el: { var: "shape" } } as unknown as FenelType;
    expect(childValueType({ x: 1 }, dependent, "x", frameless)).toBeUndefined();
    expect(childValueType([1], dependent, 0, frameless)).toBeUndefined();
  });

  test("a type application the environment projects (Maybe Number) keeps its child type on a frameless session", () => {
    // The environment alone resolves `{$el: {call: ["Maybe", T]}}` (no frame).
    const payload: FenelType = { $var: "a" };
    const applied: FenelType = { $el: { call: ["Maybe", payload] } } as unknown as FenelType;
    const kind = { $tag: "KArrow" as const, input: { $tag: "KType" as const }, output: { $tag: "KType" as const } };
    const constructors = ["Nothing", "Just"].map(tag => {
      const params = tag === "Just" ? [{ ...field("_0", payload), key: { $tag: "PositionalField" as const, index: 0 } }] : [];
      return { id: tag, targetId: `@ctor/test/Maybe/${tag}`, codeName: tag, label: tag, description: "", kind: "constructor",
        parentModule: "test", parentEntity: "Maybe", params, returns: applied, signatureOutcome: { $tag: "Solved" }, scheme: {
          quantified: [{ id: "a", sourceName: "a", kind: { $tag: "KType" as const } }],
          body: { $arrow: { params, returns: applied } },
          applications: [{ path: ["$arrow", "returns"], headRef: "Maybe", kind, args: [payload] }],
          nominals: [{ path: ["$arrow", "returns"], identity: '["system","Maybe"]', publicName: "Maybe" }],
        } };
    });
    const generic = createAuthoringEnvironment({ capabilities: [], catalogTypes: [], operatorCodeNameByNotation: new Map(),
      types: [{ id: "Maybe", entityId: "Maybe", name: "Maybe", description: "", category: "type", type: Maybe(payload) }],
      functions: constructors } as never);
    const session = inertAuthoringSession({ mode: "detached", registry, catalog: generic.catalog, environment: generic });
    const appliedNumber = { $el: { call: ["Maybe", number] } } as unknown as FenelType;
    expect(childValueType({ $tag: "Just", _0: 1 }, appliedNumber, "_0", session)).toEqual(number);
  });

  test("a frameless Graph display type keeps the generic-yields-to-observed rule without page reflection", () => {
    const any = { $complement: { $void: true } } as unknown as FenelType;
    const text: FenelType = { $ref: "String" };
    expect(framelessDisplayType({ $var: "a" }, number, environment)).toBe(number);
    expect(framelessDisplayType(any, number, environment)).toBe(number);
    expect(framelessDisplayType(text, number, environment)).toBe(text);
    expect(framelessDisplayType({ $var: "a" }, any, environment)).toEqual({ $var: "a" });
    expect(framelessDisplayType(undefined, number, environment)).toBe(number);
  });

  test("the transfer analysis refuses its page fallback for a frameless session without a worker", async () => {
    const items = [{ value: 1, typeName: "Number", label: "One" }] as never;
    for (const run of [() => analyzeWorkspaceTransfer(items, frameless),
      () => adaptTransferForSession(items, { session: frameless, type: number } as never)]) {
      let refusal: unknown;
      try { await run(); } catch (error) { refusal = error; }
      expect(refusal).toBeInstanceOf(TransferError);
      expect((refusal as Error).message).toContain("editing tools are not ready");
    }
  });
});
