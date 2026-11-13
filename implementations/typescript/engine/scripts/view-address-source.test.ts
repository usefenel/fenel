import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { loadFenelModule } from "../src/fenel-module";
import { evaluate, type EvaluateContext } from "../src/json-logic";
import { stdNatives, stdNativesCtx } from "../../../../fenel/modules/std/ffi/std-ffi";

// C1: run the current Fenel address owner with existing std operations only.
// GLOBAL_ONLY: this isolated source fixture has no account, persisted root,
// authority, resolver registry or product reader acquisition.
const owner = loadFenelModule(readFileSync(new URL("../../../../fenel/modules/view/address.fenel", import.meta.url), "utf8"), "view");
const functionsById = new Map((owner.functions ?? []).map(fn => [fn.id, fn]));
const functionsByName = new Map((owner.functions ?? []).map(fn => [fn.id.split(":").at(-1)!, fn]));
const context: EvaluateContext = {
  getFunction: name => functionsById.get(name) ?? functionsByName.get(name),
  natives: Object.assign(Object.create(null), stdNatives),
  nativesCtx: Object.assign(Object.create(null), stdNativesCtx),
  _constructors: { Ok: ["_0"], Err: ["_0"] },
};

type Member = { id: string; name: string; aliases: string[]; position: number };
const member = (name: string, position: number, id = `identity-${position}`, aliases: string[] = []): Member => ({ id, name, aliases, position });
const accepted = (value: unknown) => ({ $tag: "Ok", _0: value });
function call(name: string, ...args: unknown[]) {
  return evaluate({ call: [`view:${name}`, ...args.map((_, index) => ({ var: `arg${index}` }))] },
    Object.fromEntries(args.map((arg, index) => [`arg${index}`, arg])), context) as { $tag: string; _0: unknown };
}
const index = (members: Member[], segment: string, positions = false) => call("addressMemberIndex", members, segment, positions);
const segment = (members: Member[], position: number, positions = false) => call("addressMemberSegment", members, position, positions);

describe("Fenel addressed member selection", () => {
  test("names, explicit aliases and identities select the same member", () => {
    const members = [member("std", 0, "first", ["library"]), member("demo", 1)];
    for (const name of ["std", "library", "_first"]) expect(index(members, name)).toEqual(accepted(0));
    expect(segment(members, 0)).toEqual(accepted("std"));
    expect(index(members, "Std").$tag).toBe("Err");
  });

  test("a missing or empty segment never picks a neighbour", () => {
    for (const members of [[], [member("", 0, "", [""])]]) {
      for (const name of ["", "missing", "_"]) expect(index(members, name).$tag).toBe("Err");
    }
  });

  test("duplicate names and aliases refuse while a unique identity remains usable", () => {
    const members = [member("same", 0, "first", ["alias"]), member("same", 1, "second", ["alias"])];
    expect(index(members, "same").$tag).toBe("Err");
    expect(index(members, "alias").$tag).toBe("Err");
    expect(segment(members, 0)).toEqual(accepted("_first"));
    expect(segment(members, 1)).toEqual(accepted("_second"));
  });

  test("collisions between a name and another identity never choose a match", () => {
    const members = [member("_second", 0, "first"), member("", 1, "second")];
    expect(index(members, "_second").$tag).toBe("Err");
    expect(segment(members, 0)).toEqual(accepted("_first"));
    expect(segment(members, 1).$tag).toBe("Err");
  });

  test("one member matching through several facts is still one match", () => {
    const members = [member("_same", 0, "same", ["_same", "_same", "1"])];
    expect(index(members, "_same", true)).toEqual(accepted(0));
    expect(index(members, "1", true)).toEqual(accepted(0));
  });

  test("list positions are one-based original coordinates, independent of supplied order", () => {
    const members = [member("", 4, ""), member("", 1, "")];
    expect(index(members, "5", true)).toEqual(accepted(0));
    expect(index(members, "2", true)).toEqual(accepted(1));
    expect(segment(members, 0, true)).toEqual(accepted("5"));
    expect(index(members, "5", false).$tag).toBe("Err");
    for (const name of ["0", "05", "+5", "5.0", "5e0", " 5", "5 "]) expect(index(members, name, true).$tag).toBe("Err");
  });

  test("numeric record names remain ordinary fields without admitting positions", () => {
    const members = [member("2", 0), member("other", 1)];
    expect(index(members, "2", false)).toEqual(accepted(0));
    expect(segment(members, 0, false)).toEqual(accepted("2"));
    expect(index(members, "2", true).$tag).toBe("Err");
    expect(segment(members, 0, true)).toEqual(accepted("_identity-0"));
  });

  test("duplicate identities or list coordinates are refused", () => {
    expect(index([member("", 0, "shared"), member("", 1, "shared")], "_shared").$tag).toBe("Err");
    const members = [member("", 0, ""), member("", 0, "")];
    expect(index(members, "1", true).$tag).toBe("Err");
    expect(segment(members, 0, true).$tag).toBe("Err");
  });

  test("noninteger, unsafe and coerced numeric positions do not produce addresses", () => {
    for (const position of [-1, 0.5, NaN, Infinity, 9007199254740991, "0" as unknown as number]) {
      const members = [member("", position, "")];
      expect(segment(members, 0, true).$tag).toBe("Err");
      expect(index(members, "1", true).$tag).toBe("Err");
    }
    for (const position of [-1, 0.5, NaN, Infinity, 2, "0" as unknown as number]) {
      expect(segment([member("std", 0)], position).$tag).toBe("Err");
    }
  });

  test("Unicode and literal slash names stay data; transport owns encoding", () => {
    const members = [member("Ελλάδα", 0), member("a/b", 1)];
    for (let position = 0; position < members.length; position++) {
      const named = segment(members, position);
      expect(named).toEqual(accepted(members[position]!.name));
      expect(index(members, named._0 as string)).toEqual(accepted(position));
    }
  });

  test("dot path instructions retain name lookup but canonicalize through stable identities", () => {
    const members = [member(".", 0, "dot-field"), member("..", 1, "parent-field")];
    for (let position = 0; position < members.length; position++) {
      const entry = members[position]!;
      expect(index(members, entry.name)).toEqual(accepted(position));
      const canonical = segment(members, position);
      expect(canonical).toEqual(accepted(`_${entry.id}`));
      expect(index(members, canonical._0 as string)).toEqual(accepted(position));
    }
  });

  test("a dot-named raw field without identity cannot emit an ancestor link", () => {
    for (const name of [".", ".."]) {
      const members = [member(name, 0, "")];
      expect(index(members, name)).toEqual(accepted(0));
      expect(segment(members, 0, false).$tag).toBe("Err");
      expect(segment(members, 0, true).$tag).toBe("Err");
    }
    const collision = [member(".", 0, "dot-field"), member("_dot-field", 1, "other-field")];
    expect(segment(collision, 0).$tag).toBe("Err");
    for (const name of ["...", ".config", "%2E", "%2E%2E"]) {
      expect(segment([member(name, 0, "")], 0)).toEqual(accepted(name));
    }
  });
});
