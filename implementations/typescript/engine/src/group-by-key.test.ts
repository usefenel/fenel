// Typed grouping (ordinary-maps phase 0, 2026-11-06; .tmp-night/map LEDGER M1-M3).
//
//   bun test --timeout 60000 ./src/group-by-key.test.ts   (engine dir, FENEL_PARSER_LEGACY=1)
//
// M1: std.exactValueEqual is the A4 bridge to the existing exact equality owner
//     engine:deepEqValueTri; its verdict is that owner's verdict.
// M2: std.groupByKey keeps actual typed keys (no text coercion), compares them
//     with that owner, refuses (Nothing) on an undecided comparison, and shares
//     the one grouping traversal (std.groupFold) with the legacy groupBy body.
// M3: OrdinaryMap's key argument has a Type kind for CalendarDate, and the
//     documented refusal for legacy Date (it has no Type owner).
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadFenelModule } from "./fenel-module";
import { invokeCallable, moduleSourceCoordinate, pureEvaluateContext, type EvaluateContext } from "./json-logic";
import { createRegistry, type ModuleRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { timeModule } from "./modules/time";
import { dispatchRegistry } from "./system-entities";
import { dispatchEngineBody, PARSE_VIA_FENEL_FAIL, parseViaFenelParser, withInterpretedResolver } from "./engine-bodies-dispatch";
import { parse } from "./fenel-parser";
import { assertCallableTypeFamilyArguments } from "./callable-type-families";

const SOURCE = `module GroupByKeyProbe where

using time (CalendarDate)

Person = Person name: String phone: String
Transaction = Transaction amount: Number person: Person day: { year: Int, month: Int, day: Int }

alexOne : Person
alexOne = Person { name = "Alex", phone = "+14155552671" }

alexTwo : Person
alexTwo = Person { name = "Alex", phone = "+14155552672" }

sam : Person
sam = Person { name = "Sam", phone = "+14155552673" }

transactions : List Transaction
transactions = [
  Transaction { amount = 10, person = Person { name = "Alex", phone = "+14155552671" }, day = { year = 2024, month = 2, day = 29 } },
  Transaction { amount = 20, person = Person { name = "Alex", phone = "+14155552672" }, day = { year = 2024, month = 3, day = 1 } },
  Transaction { amount = 30, person = Person { name = "Alex", phone = "+14155552671" }, day = { year = 2024, month = 2, day = 29 } },
  Transaction { amount = 40, person = Person { name = "Sam", phone = "+14155552673" }, day = { year = 2024, month = 12, day = 31 } },
  Transaction { amount = 50, person = Person { name = "Sam", phone = "+14155552673" }, day = { year = 2025, month = 1, day = 1 } }
  ]

byPerson : (txs: List Transaction) -> Maybe (OrdinaryMap Person (List Transaction))
byPerson txs = groupByKey (\\t -> t.person) txs

byPersonAsText : (txs: List Transaction) -> Maybe (OrdinaryMap String (List Transaction))
byPersonAsText txs = groupByKey (\\t -> t.person) txs

byDay : (txs: List Transaction) -> Maybe (OrdinaryMap ({ year: Int, month: Int, day: Int }) (List Transaction))
byDay txs = groupByKey (\\t -> t.day) txs

sameClosure : Maybe Bool
sameClosure = let f = (\\x -> x) in exactValueEqual f f

freshClosures : Maybe Bool
freshClosures = exactValueEqual (\\x -> x) (\\x -> x)

calendarKeyed : (dates: List CalendarDate) -> Maybe (OrdinaryMap CalendarDate (List CalendarDate))
calendarKeyed dates = groupByKey (\\d -> d) dates
`;

let registry: ModuleRegistry;
let ctx: EvaluateContext;
const run = <T>(f: () => T): T => withInterpretedResolver(f);
const callStd = (name: string, args: unknown[], context: EvaluateContext = ctx): unknown =>
  run(() => invokeCallable({ $ref: `std:${name}` }, args, context));
const callProbe = (name: string, args: unknown[] = []): unknown =>
  run(() => invokeCallable({ $ref: `GroupByKeyProbe:${name}` }, args, ctx));
const person = (name: string, phone: string) => ({ $tag: "Person", name, phone });
const deep = (n: number): unknown => (n <= 0 ? [] : [deep(n - 1)]);
const JUST_TRUE = { $tag: "Just", _0: true };
const JUST_FALSE = { $tag: "Just", _0: false };
const NOTHING = { $tag: "Nothing" };

// A probe key function: a ctx native the evaluator invokes by name, recording
// each element it is asked for (call order) and optionally throwing.
const seen: unknown[] = [];
const failure = new Error("probe key failure");
let keyOf: (value: unknown) => unknown = value => value;
const keyContext = (): EvaluateContext => ({ ...ctx, natives: { ...ctx.natives, probeKey: (value: unknown) => {
  seen.push(value);
  return keyOf(value);
} } });
const probeKey = { $ref: "probeKey" };

beforeAll(() => run(() => {
  registry = createRegistry([stdModule, timeModule, loadFenelModule(SOURCE, "GroupByKeyProbe")], { dispatchRegistry });
  ctx = registry.evaluateContext();
}), 900_000);

describe("M1 — std.exactValueEqual forwards to engine:deepEqValueTri", () => {
  const pairs: Array<[string, unknown, unknown, unknown]> = [
    ["equal Person records", person("Alex", "+1"), person("Alex", "+1"), JUST_TRUE],
    ["same name, different phone", person("Alex", "+1"), person("Alex", "+2"), JUST_FALSE],
    ["equal civil days", { year: 2024, month: 2, day: 29 }, { year: 2024, month: 2, day: 29 }, JUST_TRUE],
    ["different civil days", { year: 2024, month: 2, day: 29 }, { year: 2024, month: 3, day: 1 }, JUST_FALSE],
    ["depth-200 nested lists (over the owner's depth budget)", deep(200), deep(200), NOTHING],
  ];
  for (const [name, left, right, expected] of pairs) {
    test(name, () => {
      expect(callStd("exactValueEqual", [left, right])).toEqual(expected);
      expect(callStd("exactValueEqual", [left, right])).toEqual(run(() => dispatchEngineBody("engine:deepEqValueTri", [left, right], ctx)));
    }, 300_000);
  }
  test("callables compare by identity", () => {
    const closure = { __fenelFn: true, params: ["x"], body: { var: "x" }, closure: {} };
    const twin = { __fenelFn: true, params: ["x"], body: { var: "x" }, closure: {} };
    expect(callStd("exactValueEqual", [closure, closure])).toEqual(JUST_TRUE);
    expect(callStd("exactValueEqual", [closure, twin])).toEqual(JUST_FALSE);
    // In source, each read of a let-bound closure is a fresh carrier (as for eq),
    // and two lambda literals are distinct callables.
    console.log(JSON.stringify({ sourceSameClosure: callProbe("sameClosure"), sourceFreshClosures: callProbe("freshClosures") }));
    expect(callProbe("freshClosures")).not.toEqual(JUST_TRUE);
  }, 300_000);
  test("a host-shaped key (an accessor property) is undecided", () => {
    const host = Object.defineProperty({}, "year", { get: () => 2024, enumerable: true });
    expect(callStd("exactValueEqual", [host, { year: 2024 }])).toEqual(NOTHING);
  }, 300_000);
});

describe("M2 — std.groupByKey", () => {
  const summary = (value: unknown) => {
    const map = (value as { $tag: string; _0?: { $tag: string; entries: Array<{ key: unknown; value: Array<{ amount: number }> }> } });
    if (map.$tag !== "Just") return map;
    return { tag: map._0!.$tag, groups: map._0!.entries.map(entry => ({ key: entry.key, amounts: entry.value.map(t => t.amount) })) };
  };
  const txs = () => callProbe("transactions");

  test("(a) Person keys: same name with different phones stay apart; equal content shares a group", () => {
    const grouped = summary(callProbe("byPerson", [txs()]));
    expect(grouped).toEqual({ tag: "OrdinaryMap", groups: [
      { key: person("Alex", "+14155552671"), amounts: [10, 30] },
      { key: person("Alex", "+14155552672"), amounts: [20] },
      { key: person("Sam", "+14155552673"), amounts: [40, 50] },
    ] });
  }, 300_000);

  test("(a) each group keeps its first key representative and member order", () => {
    const first = { $tag: "Row", key: { b: 2, a: 1 }, id: 1 };
    const second = { $tag: "Row", key: { a: 1, b: 2 }, id: 2 };
    keyOf = value => (value as { key: unknown }).key;
    try {
      const out = callStd("groupByKey", [probeKey, [first, second]], keyContext()) as { _0: { entries: Array<{ key: unknown; value: unknown[] }> } };
      expect(out._0.entries.length).toBe(1);
      expect(out._0.entries[0]!.key).toBe(first.key);
      expect(out._0.entries[0]!.value).toEqual([first, second]);
    } finally { keyOf = value => value; }
  }, 300_000);

  test("(b) civil-day keys, leap day and month/year boundaries", () => {
    const grouped = summary(callProbe("byDay", [txs()]));
    expect(grouped).toEqual({ tag: "OrdinaryMap", groups: [
      { key: { year: 2024, month: 2, day: 29 }, amounts: [10, 30] },
      { key: { year: 2024, month: 3, day: 1 }, amounts: [20] },
      { key: { year: 2024, month: 12, day: 31 }, amounts: [40] },
      { key: { year: 2025, month: 1, day: 1 }, amounts: [50] },
    ] });
  }, 300_000);

  test("(c) the empty list is a decided empty Map", () => {
    expect(callProbe("byPerson", [[]])).toEqual({ $tag: "Just", _0: { $tag: "OrdinaryMap", entries: [] } });
  }, 300_000);

  test("(d) an undecided key comparison refuses the grouping and computes no later key", () => {
    seen.length = 0;
    keyOf = value => (value === "c" ? "c" : deep(200));
    try {
      expect(callStd("groupByKey", [probeKey, ["a", "b", "c"]], keyContext())).toEqual(NOTHING);
      expect(seen).toEqual(["a", "b"]);
    } finally { keyOf = value => value; }
  }, 300_000);

  test("(e) the key callback runs once per element, left to right; the first error stops it", () => {
    seen.length = 0;
    expect(summaryKeys(callStd("groupByKey", [probeKey, ["a", "b", "a"]], keyContext()))).toEqual(["a", "b"]);
    expect(seen).toEqual(["a", "b", "a"]);
    seen.length = 0;
    keyOf = value => { if (value === "stop") throw failure; return value; };
    try {
      expect(() => callStd("groupByKey", [probeKey, ["first", "stop", "later"]], keyContext())).toThrow();
      expect(seen).toEqual(["first", "stop"]);
    } finally { keyOf = value => value; }
  }, 300_000);

  test("(f) every new and refactored grouping function has a Solved signature", () => {
    for (const name of ["groupFold", "groupByKeyInsert", "groupByKey", "groupByRecordInsert", "groupByAcc", "groupBy"]) {
      const info = registry.getFunctionSignatureInfo(`std:${name}`);
      expect({ name, outcome: info?.outcome }).toEqual({ name, outcome: { $tag: "Solved" } });
    }
  }, 300_000);

  test("(g) calls declared Maybe (OrdinaryMap Person (List Transaction)) and the civil-day twin are Solved", () => {
    expect(registry.getFunctionSignatureInfo("GroupByKeyProbe:byPerson")?.outcome).toEqual({ $tag: "Solved" });
    expect(registry.getFunctionSignatureInfo("GroupByKeyProbe:byDay")?.outcome).toEqual({ $tag: "Solved" });
    // Recorded, not gated: the declared-result check does not refute a different
    // key type inside the OrdinaryMap application (application arguments abstain).
    console.log(JSON.stringify({ byPersonAsTextOutcome: registry.getFunctionSignatureInfo("GroupByKeyProbe:byPersonAsText")?.outcome }));
  }, 300_000);

  test("(h) grouping.fenel parses identically with both parsers", () => {
    const source = readFileSync(join(import.meta.dir, "../../../../fenel/modules/std/grouping.fenel"), "utf8");
    const fenelTree = parseViaFenelParser(source, { mode: "build-verification" });
    expect(fenelTree).not.toBe(PARSE_VIA_FENEL_FAIL);
    expect(fenelTree).toEqual(parse(source));
  }, 300_000);
});

describe("M9 — aggregations per key (mapValues, countByKey, sumByKey)", () => {
  const amounts = (value: unknown) => {
    const map = value as { $tag: string; _0?: { $tag: string; entries: Array<{ key: unknown; value: unknown }> } };
    return map.$tag === "Just" ? { tag: map._0!.$tag, entries: map._0!.entries.map(entry => [entry.key, entry.value]) } : map;
  };
  const byPersonKey = { __fenelFn: true, params: ["t"], body: { var: "t.person" }, closure: {} };
  const amountOf = { __fenelFn: true, params: ["t"], body: { var: "t.amount" }, closure: {} };
  const alexOne = person("Alex", "+14155552671"), alexTwo = person("Alex", "+14155552672"), samKey = person("Sam", "+14155552673");

  test("countByKey counts each group, in first-encounter order", () => {
    expect(amounts(callStd("countByKey", [byPersonKey, callProbe("transactions")]))).toEqual({ tag: "OrdinaryMap",
      entries: [[alexOne, 2], [alexTwo, 1], [samKey, 2]] });
  }, 300_000);

  test("sumByKey sums the amounts of each group", () => {
    expect(amounts(callStd("sumByKey", [byPersonKey, amountOf, callProbe("transactions")]))).toEqual({ tag: "OrdinaryMap",
      entries: [[alexOne, 40], [alexTwo, 20], [samKey, 90]] });
  }, 300_000);

  test("mapValues keeps keys and order; an empty list and an undecided key behave as groupByKey", () => {
    const map = { $tag: "OrdinaryMap", entries: [{ key: "a", value: [1, 2] }, { key: "b", value: [] }] };
    const size = { __fenelFn: true, params: ["rows"], body: { call: ["count", { var: "rows" }] }, closure: {} };
    expect(callStd("mapValues", [size, map])).toEqual({ $tag: "OrdinaryMap", entries: [{ key: "a", value: 2 }, { key: "b", value: 0 }] });
    expect(callStd("countByKey", [byPersonKey, []])).toEqual({ $tag: "Just", _0: { $tag: "OrdinaryMap", entries: [] } });
    keyOf = () => deep(200);
    try { expect(callStd("countByKey", [probeKey, ["a", "b"]], keyContext())).toEqual(NOTHING); }
    finally { keyOf = value => value; }
  }, 300_000);

  // Demo 1 (2026-11-07, D4): Count / Sum per key on a grouping result itself.
  test("countPerKey and sumPerKey aggregate a grouping and keep an undecided one undecided", () => {
    const grouped = callStd("groupByKey", [byPersonKey, callProbe("transactions")]);
    expect(amounts(callStd("countPerKey", [grouped]))).toEqual({ tag: "OrdinaryMap", entries: [[alexOne, 2], [alexTwo, 1], [samKey, 2]] });
    expect(amounts(callStd("sumPerKey", [amountOf, grouped]))).toEqual({ tag: "OrdinaryMap", entries: [[alexOne, 40], [alexTwo, 20], [samKey, 90]] });
    expect(callStd("countPerKey", [NOTHING])).toEqual(NOTHING);
    expect(callStd("sumPerKey", [amountOf, NOTHING])).toEqual(NOTHING);
  }, 300_000);

  test("the aggregations have Solved signatures", () => {
    for (const name of ["mapValues", "countByKey", "sumByKey", "countPerKey", "sumPerKey"]) {
      expect({ name, outcome: registry.getFunctionSignatureInfo(`std:${name}`)?.outcome }).toEqual({ name, outcome: { $tag: "Solved" } });
    }
  }, 300_000);
});

function summaryKeys(value: unknown): unknown {
  const map = value as { $tag: string; _0?: { entries: Array<{ key: unknown }> } };
  return map.$tag === "Just" ? map._0!.entries.map(entry => entry.key) : map;
}

describe("M3 — OrdinaryMap key kinds", () => {
  test("CalendarDate is a Type argument of OrdinaryMap; legacy Date reports the documented refusal", () => {
    const reader = pureEvaluateContext(ctx);
    const mapOwner = reader._typeFamilyOwner?.("OrdinaryMap", moduleSourceCoordinate("std"));
    if (mapOwner === undefined) throw new Error("OrdinaryMap has no std type-family owner");
    const calendar = reader._typeFamilyOwner?.("CalendarDate", moduleSourceCoordinate("time"));
    if (calendar === undefined) throw new Error("CalendarDate has no time type-family owner");
    const exact = { $ref: calendar.identity };
    run(() => {
      expect(assertCallableTypeFamilyArguments(mapOwner, [exact, exact], reader)).toEqual({ $tag: "KType" });
      expect(() => assertCallableTypeFamilyArguments(mapOwner, [{ $ref: "Date" }, exact], reader)).toThrow(/no established Type or type-generator kind/);
    });
  }, 300_000);

  test("signature outcomes of the CalendarDate functions (recorded, not gated)", () => {
    const outcomes = Object.fromEntries(["calendarDate", "decodeCalendarDate", "encodeCalendarDate"].map(name =>
      [name, registry.getFunctionSignatureInfo(`time:${name}`)?.outcome]));
    console.log(JSON.stringify({ calendarDateSignatureOutcomes: outcomes }));
    expect(outcomes.encodeCalendarDate).toEqual({ $tag: "Solved" });
    expect(registry.getFunctionSignatureInfo("GroupByKeyProbe:calendarKeyed")?.outcome).toEqual({ $tag: "Solved" });
  }, 300_000);
});
