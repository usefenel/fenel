// ---------------------------------------------------------------------------
// Per-owner type identity — the Fenel decisions (modules-as-values Phase 5,
// slices S0 and S2; `fenel/modules/engine/type-identity.fenel`).
//
// The keeper table, the owner-keyed lock key and the re-key plan are Fenel
// values and bodies; TypeScript only gathers candidates and applies the plan.
// These tests call the bodies through the engine dispatch seam directly, on
// controlled candidate lists, so every refusal is pinned without a lock run.
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";
import { dispatchEngineBody } from "./engine-bodies-dispatch";

const LONG = 120_000;
const NOTHING = { $tag: "Nothing" } as const;
const just = (value: string) => ({ $tag: "Just", _0: value });

const ANIMATION_OLD = "8d5e3398-7464-4a83-9157-2a80d24fc40a";
const FILE_OLD = "a1c8799a-dfdb-480f-b6ca-7c75c9ec3349";
const GAME_OLD = "5c40deb3-8398-447d-8b6a-707818e7a294";
const U1 = "71000000-0000-4000-8000-000000000001";
const U2 = "71000000-0000-4000-8000-000000000002";

type Facts = {
  bare?: string;
  keyed?: string;
  parametric?: boolean;
  dispatchClass?: boolean;
  systemDeclared?: boolean;
};

function candidate(owner: string, name: string, facts: Facts = {}) {
  return {
    $tag: "TypeIdentityCandidate",
    owner,
    name,
    parametric: facts.parametric ?? false,
    dispatchClass: facts.dispatchClass ?? false,
    systemDeclared: facts.systemDeclared ?? false,
    bareId: facts.bare === undefined ? NOTHING : just(facts.bare),
    keyedId: facts.keyed === undefined ? NOTHING : just(facts.keyed),
  };
}

type Plan = { actions: Array<Record<string, unknown>>; refusals: string[] };
const plan = (candidates: unknown[]): Plan =>
  dispatchEngineBody("engine:typeIdentityRekeyPlan", [candidates]) as Plan;
const key = (owner: string, name: string): string =>
  dispatchEngineBody("engine:typeIdentityLockKey", [just(owner), name]) as string;

describe("S0 — the keeper table is one recorded Fenel value", () => {
  test("three two-owner names, each with its old UUID, its keeper and the other owner", () => {
    expect(dispatchEngineBody("engine:typeIdentityKeepers", [])).toEqual([
      { $tag: "TypeIdentityKeeper", name: "Animation", oldId: ANIMATION_OLD, keeper: "animation", others: ["telegram"] },
      { $tag: "TypeIdentityKeeper", name: "File", oldId: FILE_OLD, keeper: "telegram", others: ["std"] },
      { $tag: "TypeIdentityKeeper", name: "Game", oldId: GAME_OLD, keeper: "games", others: ["telegram"] },
    ]);
  }, LONG);
});

describe("S2 — typeIdentityLockKey composes the field-identity owner codec", () => {
  test("an owner and a name give type/module/<owner>/<Name>", () => {
    expect(key("telegram", "Animation")).toBe("type/module/telegram/Animation");
    expect(key("system", "String")).toBe("type/module/system/String");
  }, LONG);

  test("it is exactly fieldIdentityOwnerIndexKey of the normalized type owner, so it stays injective", () => {
    for (const [owner, name] of [["a b", "T"], ["x/y", "T"], ["demo", "demo:Thing"], ["%", "100%"]] as const) {
      const viaCodec = dispatchEngineBody("engine:fieldIdentityOwnerIndexKey", [
        dispatchEngineBody("engine:fieldIdentityNormalizeTypeOwner", [just(owner), name]),
      ]);
      expect(key(owner, name)).toBe(viaCodec as string);
    }
    // Owner and name are encoded separately: a slash in either cannot forge
    // another owner's key.
    expect(key("x/y", "T")).not.toBe(key("x", "y/T"));
    expect(dispatchEngineBody("engine:typeIdentityLockKey", [NOTHING, "T"])).toBe("type/none/T");
  }, LONG);

  test("typeIdentityLockKeys is the same key for many coordinates in one call", () => {
    expect(dispatchEngineBody("engine:typeIdentityLockKeys", [
      [just("telegram"), just("animation"), just("system")],
      ["Animation", "Animation", "Expr"],
    ])).toEqual([
      "type/module/telegram/Animation",
      "type/module/animation/Animation",
      "type/module/system/Expr",
    ]);
  }, LONG);
});

describe("S2 — the re-key plan", () => {
  test("a single-owner bare row is renamed in place with its UUID; an owner key is retained; a new type is minted", () => {
    const result = plan([
      candidate("telegram", "Update", { bare: U1 }),
      candidate("telegram", "Update", { bare: U1 }),
      candidate("system", "String", { keyed: U2 }),
      candidate("std", "Fresh"),
    ]);
    expect(result.refusals).toEqual([]);
    expect(result.actions).toEqual([
      { $tag: "TypeIdentityRekey", name: "Update", oldKey: "Update", newKey: "type/module/telegram/Update", id: U1 },
      { $tag: "TypeIdentityRetain", name: "String", newKey: "type/module/system/String", id: U2 },
      { $tag: "TypeIdentityMint", name: "Fresh", newKey: "type/module/std/Fresh" },
    ]);
  }, LONG);

  test("a two-owner name: the keeper takes the bare row's UUID, the other owner is minted", () => {
    const result = plan([
      candidate("telegram", "Animation", { bare: ANIMATION_OLD }),
      candidate("animation", "Animation", { bare: ANIMATION_OLD }),
    ]);
    expect(result.refusals).toEqual([]);
    expect(result.actions).toEqual([
      {
        $tag: "TypeIdentityRekey",
        name: "Animation",
        oldKey: "Animation",
        newKey: "type/module/animation/Animation",
        id: ANIMATION_OLD,
      },
      { $tag: "TypeIdentityMint", name: "Animation", newKey: "type/module/telegram/Animation" },
    ]);
  }, LONG);

  test("after the re-key the same census only retains (the plan converges)", () => {
    const result = plan([
      candidate("telegram", "File", { keyed: FILE_OLD }),
      candidate("std", "File", { keyed: U2 }),
    ]);
    expect(result.refusals).toEqual([]);
    expect(result.actions).toEqual([
      { $tag: "TypeIdentityRetain", name: "File", newKey: "type/module/telegram/File", id: FILE_OLD },
      { $tag: "TypeIdentityRetain", name: "File", newKey: "type/module/std/File", id: U2 },
    ]);
  }, LONG);

  test("a two-owner name with no keeper is refused, naming both owners", () => {
    const result = plan([
      candidate("first", "Shared", { bare: U1 }),
      candidate("second", "Shared", { bare: U1 }),
    ]);
    expect(result.actions).toEqual([]);
    expect(result.refusals).toHaveLength(1);
    expect(result.refusals[0]).toContain("Shared");
    expect(result.refusals[0]).toContain("first");
    expect(result.refusals[0]).toContain("second");
    expect(result.refusals[0]).toContain("keeper");
  }, LONG);

  test("a keeper UUID mismatch is refused, in the bare row and under the keeper's key", () => {
    for (const facts of [{ bare: U1 }, { keyed: U1 }]) {
      const result = plan([
        candidate("games", "Game", facts),
        candidate("telegram", "Game", { bare: facts.bare }),
      ]);
      expect(result.actions.filter((action) => action.newKey === "type/module/games/Game")).toEqual([]);
      expect(result.refusals.some((message) =>
        message.includes("Game") && message.includes(GAME_OLD) && message.includes(U1))).toBe(true);
    }
    // The keeper's UUID under the OTHER owner's key is a mismatch too.
    const swapped = plan([
      candidate("games", "Game", { keyed: U2 }),
      candidate("telegram", "Game", { keyed: GAME_OLD }),
    ]);
    expect(swapped.refusals.length).toBeGreaterThan(0);
    expect(swapped.refusals.join("\n")).toContain(GAME_OLD);
  }, LONG);

  test("a retired bare key beside its owner key is refused", () => {
    const single = plan([candidate("telegram", "Update", { bare: U1, keyed: U2 })]);
    expect(single.actions).toEqual([]);
    expect(single.refusals).toHaveLength(1);
    expect(single.refusals[0]).toContain("retired bare");
    expect(single.refusals[0]).toContain("type/module/telegram/Update");

    const kept = plan([
      candidate("animation", "Animation", { bare: ANIMATION_OLD, keyed: ANIMATION_OLD }),
      candidate("telegram", "Animation", { bare: ANIMATION_OLD, keyed: U2 }),
    ]);
    expect(kept.refusals.join("\n")).toContain("retired bare");
  }, LONG);

  test("an owner the keeper table does not record is refused", () => {
    const result = plan([
      candidate("animation", "Animation", { bare: ANIMATION_OLD }),
      candidate("telegram", "Animation", { bare: ANIMATION_OLD }),
      candidate("movie", "Animation", { bare: ANIMATION_OLD }),
    ]);
    expect(result.refusals.join("\n")).toContain("movie");
  }, LONG);

  test("callable system families keep one Type owner, including generic class records; existing rows keep their UUIDs", () => {
    const result = plan([
      candidate("system", "Maybe", { parametric: true }),
      candidate("system", "Expr", { parametric: true, bare: U1 }),
      candidate("system", "Functor", { dispatchClass: true, parametric: true }),
      candidate("dispatch", "LookupResult", { parametric: true, systemDeclared: true }),
      candidate("system", "LookupResult", { parametric: true, systemDeclared: true }),
      candidate("view", "Grid", { parametric: true, bare: U2 }),
    ]);
    expect(result.refusals).toEqual([]);
    expect(result.actions).toEqual([
      { $tag: "TypeIdentityMint", name: "Maybe", newKey: "type/module/system/Maybe" },
      { $tag: "TypeIdentityRekey", name: "Expr", oldKey: "Expr", newKey: "type/module/system/Expr", id: U1 },
      { $tag: "TypeIdentityMint", name: "Functor", newKey: "type/module/system/Functor" },
      { $tag: "TypeIdentityMint", name: "LookupResult", newKey: "type/module/system/LookupResult" },
      { $tag: "TypeIdentityRekey", name: "Grid", oldKey: "Grid", newKey: "type/module/view/Grid", id: U2 },
    ]);
    expect(dispatchEngineBody("engine:typeIdentityRetainedSystemTypes", []))
      .toEqual(["Expr", "Pattern", "Syntax", "Verified"]);
    expect(plan([candidate("system", "Maybe", { parametric: true, keyed: U1 })]).actions).toEqual([
      { $tag: "TypeIdentityRetain", name: "Maybe", newKey: "type/module/system/Maybe", id: U1 },
    ]);
  }, LONG);
});
