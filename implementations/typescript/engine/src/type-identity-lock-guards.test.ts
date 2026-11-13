// ---------------------------------------------------------------------------
// The manifest guards of per-owner type identity (modules-as-values Phase 5,
// S2; `scripts/generate-codename-lock.ts` `manifestFor`). After the re-key a
// type row is keyed by its owner only, and a UUID lives under exactly one key:
// a bare type requirement, a bare type row left beside the owner keys (a
// retired key coming back) and a live UUID under two keys are all refused
// before a manifest is built.
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";
import { manifestFor } from "../scripts/generate-codename-lock";

const A = "0e000000-0000-4000-8000-000000000001";
const B = "0e000000-0000-4000-8000-000000000002";
const C = "0e000000-0000-4000-8000-000000000003";

type Kind = "function" | "type" | "field";
const kinds = (entries: Array<[string, Kind]>) => new Map<string, Kind>(entries);

describe("manifestFor — per-owner type identity guards", () => {
  test("an owner-keyed lock builds its manifest, the shared name holding two UUIDs", () => {
    const physical = new Map([
      ["type/module/animation/Animation", A],
      ["type/module/telegram/Animation", B],
      ["std:add", C],
    ]);
    const manifest = manifestFor(
      physical,
      kinds([
        ["type/module/animation/Animation", "type"],
        ["type/module/telegram/Animation", "type"],
        ["std:add", "function"],
      ]),
      new Set(["Animation"]),
    );
    expect(manifest.entries).toEqual([
      ["std:add", C, "function"],
      ["type/module/animation/Animation", A, "type"],
      ["type/module/telegram/Animation", B, "type"],
    ]);
  });

  test("a bare type requirement is refused", () => {
    expect(() => manifestFor(
      new Map([["Animation", A]]),
      kinds([["Animation", "type"]]),
      new Set(["Animation"]),
    )).toThrow(/bare type requirement.*Animation/);
  });

  test("a retired bare type row beside the owner keys is refused", () => {
    expect(() => manifestFor(
      new Map([["Animation", C], ["type/module/animation/Animation", A]]),
      kinds([["type/module/animation/Animation", "type"]]),
      new Set(["Animation"]),
    )).toThrow(/retired bare type row.*Animation/);
  });

  test("a live UUID under two keys is refused", () => {
    expect(() => manifestFor(
      new Map([["type/module/animation/Animation", A], ["type/module/telegram/Animation", A]]),
      kinds([["type/module/animation/Animation", "type"], ["type/module/telegram/Animation", "type"]]),
      new Set(["Animation"]),
    )).toThrow(/under 2 keys/);
    // A live UUID kept under a dormant (reserved) key too is the same defect.
    expect(() => manifestFor(
      new Map([["type/module/animation/Animation", A], ["OldAnimationAlias", A]]),
      kinds([["type/module/animation/Animation", "type"]]),
      new Set(["Animation"]),
    )).toThrow(/under 2 keys/);
  });
});

// The (owner, name, key) projection of the owner-keyed type rows: a reader
// that cannot run Fenel finds a type's identity by owner and name through it
// (Home's early scalar worker), never by re-spelling the key format.
describe("manifestFor — the type declaration projection", () => {
  const physical = new Map([
    ["type/module/telegram/Animation", B],
    ["type/module/animation/Animation", A],
    ["std:add", C],
  ]);
  const required = kinds([
    ["type/module/animation/Animation", "type"],
    ["type/module/telegram/Animation", "type"],
    ["std:add", "function"],
  ]);

  test("lists every declared type row as (owner, name, key), sorted by key", () => {
    const manifest = manifestFor(physical, required, new Set(["Animation"]), [
      ["telegram", "Animation", "type/module/telegram/Animation"],
      ["animation", "Animation", "type/module/animation/Animation"],
    ]);
    expect(manifest.types).toEqual([
      ["animation", "Animation", "type/module/animation/Animation"],
      ["telegram", "Animation", "type/module/telegram/Animation"],
    ]);
  });

  test("a declaration naming no live type row is refused", () => {
    expect(() => manifestFor(physical, required, new Set(["Animation"]), [
      ["games", "Animation", "type/module/games/Animation"],
    ])).toThrow(/games\.Animation.*no live type row/);
    expect(() => manifestFor(physical, required, new Set(["add"]), [
      ["std", "add", "std:add"],
    ])).toThrow(/no live type row/);
  });

  test("a type row declared twice is refused", () => {
    expect(() => manifestFor(physical, required, new Set(["Animation"]), [
      ["animation", "Animation", "type/module/animation/Animation"],
      ["animation", "Animation", "type/module/animation/Animation"],
    ])).toThrow(/declared twice/);
  });
});
