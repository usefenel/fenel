import { expect, test } from "bun:test";
import { dispatchEngineBody, dispatchedJsonLogicToSyntax } from "./engine-bodies-dispatch";
import { positionalCompileFieldSlots } from "./compile-field-slots";

test("large constructor metadata lookups retain first matching fields, wire name and ambiguity", () => {
  const fields = positionalCompileFieldSlots(["first"]);
  const unrelated = Array.from({ length: 22_221 }, (_, index) => ({ name: `Other${index}`, wireName: `Other${index}`, fields: [], ambiguous: false }));
  const entries = [...unrelated,
    { name: "Target", wireName: "FirstWire", fields, ambiguous: false },
    { name: "Target", wireName: "LaterWire", fields: [], ambiguous: true },
  ];
  expect(dispatchEngineBody("engine:lookupCtorDefAmbiguous", ["Target", entries])).toBe(false);
  expect(dispatchEngineBody("engine:lookupCtorDef", ["Target", entries])).toEqual({ $tag: "Just", _0: fields });
  expect(dispatchEngineBody("engine:lookupCtorWireName", ["Target", entries])).toBe("FirstWire");
  expect(dispatchEngineBody("engine:lookupCtorDefAmbiguous", ["Missing", entries])).toBe(false);
  expect(dispatchEngineBody("engine:lookupCtorDef", ["Missing", entries])).toEqual({ $tag: "Nothing" });
  expect(dispatchEngineBody("engine:lookupCtorWireName", ["Missing", entries])).toBe("Missing");
  expect(dispatchEngineBody("engine:lookupCtorDefAmbiguous", ["Target", [{ ...entries.at(-1)!, ambiguous: true }, ...entries]])).toBe(true);
}, 60_000);

test("the production syntax adapter handles tagged values after a large unrelated constructor roster", () => {
  const definitions = Object.fromEntries(Array.from({ length: 22_221 }, (_, index) => [`Other${index}`, []]));
  const result = dispatchedJsonLogicToSyntax({ $tag: "Target", _0: 7 }, definitions) as { $tag: string; _0: { $tag: string; ctor: string } };
  expect(result.$tag).toBe("Ok");
  expect(result._0.$tag).toBe("SConstruct");
  expect(result._0.ctor).toBe("Target");
}, 60_000);
