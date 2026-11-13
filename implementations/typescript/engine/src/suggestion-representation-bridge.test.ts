// Nov 11 (Rom, on a list of numbers offered "Array to list" and "List to array":
// "Aren't array and list the same in Fenel?!"). `view:suggestionRepresentationBridge`
// (suggestions.fenel) decides from a function's own tags that it is a
// representation bridge, which Suggestions on data never offer. This runs the
// Fenel rule over the actual tags the sources declare: every List/String spine
// bridge and numeric-tower crossing is marked; codec isos and the FRP, game and
// query bridges (real operations) and the engine's type-floor isos are not.
import { describe, expect, test } from "bun:test";
import { evaluate } from "./json-logic";
import { createRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { pictureModule } from "./modules/picture";
import { viewModule } from "./modules/view";
import { codecModule } from "./modules/codec";
import { eventsModule } from "./modules/events";
import { gamesModule } from "./modules/games";
import { queryModule } from "./modules/query";
import { engineModule } from "./modules/engine";
import type { FenelModule } from "./types";

const ctx = createRegistry([stdModule, pictureModule, viewModule]).evaluateContext();
const bridge = (tags: string[]) =>
  evaluate({ call: ["view:suggestionRepresentationBridge", { var: "tags" }] } as never, { tags }, ctx);
function tagsOf(module: FenelModule, id: string): string[] {
  const tags = (module.instances ?? []).find(instance => instance.typeName === "Taggable" && instance.args[0] === id)?.methods.tags;
  if (!Array.isArray(tags)) throw new Error(`${id} declares no tags`);
  return tags as string[];
}

const HIDDEN = [
  "listToArray", "arrayToList", "stringToCharList", "charListToString",
  "numberToInt", "intToNumber", "intToRefined", "intFromRefined",
  "numberToNat", "natToNumber", "natToRefined", "natFromRefined",
  "rationalToNumber", "numberToRational", "ratToRefined", "ratFromRefined",
  "ratToReal", "numberToReal", "realToNumber", "realToRefined", "realFromRefined",
  "towerToDouble", "doubleToTower",
].map(name => [stdModule, `std:${name}`] as const);

const KEPT = [
  ...["base64Encode", "base64Decode", "jsonEncode", "jsonDecode", "canonicalJsonEncode", "canonicalJsonDecode"]
    .map(name => [codecModule, `codec:${name}`] as const),
  ...["step", "accum", "behaviorToAnim", "behaviorToSound"].map(name => [eventsModule, `events:${name}`] as const),
  ...["gameToAnim", "gameToMovie"].map(name => [gamesModule, `games:${name}`] as const),
  ...["rel", "relOne"].map(name => [queryModule, `query:${name}`] as const),
  ...["variantToUnion", "unionToVariant", "recordToIntersect", "intersectToRecord"].map(name => [engineModule, `engine:${name}`] as const),
  ...["reverse", "upper", "double"].map(name => [stdModule, `std:${name}`] as const),
];

describe("suggestionRepresentationBridge", () => {
  test("marks every representation bridge the sources tag", () => {
    for (const [module, id] of HIDDEN) expect(bridge(tagsOf(module, id)), id).toBe(true);
  });

  test("keeps codec isos, FRP/game/query bridges, type-floor isos and ordinary operations", () => {
    for (const [module, id] of KEPT) expect(bridge(tagsOf(module, id)), id).toBe(false);
  });

  test("needs both a bridge/iso tag and the representation it crosses", () => {
    expect(bridge(["list", "array", "repr", "bridge"])).toBe(true);
    expect(bridge(["numeric", "int", "iso"])).toBe(true);
    expect(bridge(["bridge"])).toBe(false);
    expect(bridge(["iso"])).toBe(false);
    expect(bridge(["repr", "numeric"])).toBe(false);
    expect(bridge([])).toBe(false);
  });
});
