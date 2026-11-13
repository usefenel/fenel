import { expect, test } from "bun:test";
import { dispatchEngineBody, withInterpretedResolver } from "./engine-bodies-dispatch";
import type { EvaluateContext } from "./json-logic";

const base = "550e8400-e29b-41d4-a716-446655440000";
const legacy = (value: string): boolean => value.length === 36
  && dispatchEngineBody("engine:fieldIdentityUuidHexFrom", [value, 0]) === true
  && "12345".includes(value.slice(14, 15).toLowerCase())
  && "89ab".includes(value.slice(19, 20).toLowerCase());

function uuidCases(): Set<string> {
  const cases = new Set([base, base.toUpperCase(), "", base + "\n", base.slice(1), base + "0"]);
  for (let position = 0; position < base.length; position++) {
    for (const replacement of ["0", "9", "a", "f", "A", "F", "g", "-", " ", "\n", "\0", "é", "İ", "𝔄"]) {
      cases.add(base.slice(0, position) + replacement + base.slice(position + 1));
    }
  }
  for (const version of "0123456789abcdef") {
    for (const variant of "0123456789aAbBcCdDeEfF") {
      cases.add(base.slice(0, 14) + version + base.slice(15, 19) + variant + base.slice(20));
    }
  }
  return cases;
}

test("UUID shape checks keep string contains when the caller shadows its bare name", () => {
  // C1: reproduce the projected reader's set:contains collision without
  // replacing the curated std.contains primitive or acquiring a full reader.
  let bareContainsReads = 0;
  const caller: EvaluateContext = {
    getFunction: name => {
      if (name === "contains") {
        bareContainsReads++;
        throw new Error("the caller's bare contains selects set membership");
      }
      return undefined;
    },
  };
  const cases: Array<[string[], boolean]> = [
    [[base], true],
    [[base.toUpperCase()], true],
    [[base.replace("5", "x")], false],
    // Non-ASCII forces the lower-backed fallback, which must also use the
    // string primitive before rejecting its existing x placeholder.
    [[`${base.replace("5", "x")}é`], false],
    [[`${base}|${base}`], false],
    [[base.slice(0, 20), base.slice(20)], false],
  ];
  withInterpretedResolver(() => {
    for (const [ids, accepted] of cases) {
      expect(dispatchEngineBody("engine:fieldIdentityUuidShapes", [ids], caller), JSON.stringify(ids)).toBe(accepted);
    }
  });
  expect(bareContainsReads).toBe(0);
}, 60_000);

test("bulk UUID validation preserves the recursive predicate's character and position rules", () => {
  withInterpretedResolver(() => {
    for (const value of uuidCases()) {
      expect(dispatchEngineBody("engine:fieldIdentityIsUuid", [value]), JSON.stringify(value)).toBe(legacy(value));
    }
  });
}, 120_000);

test("ordinary version 1–5 UUIDs retain both accepted variant cases", () => {
  withInterpretedResolver(() => {
    for (const version of "12345") for (const variant of "89aAbB") {
      const value = base.slice(0, 14) + version + base.slice(15, 19) + variant + base.slice(20);
      expect(dispatchEngineBody("engine:fieldIdentityIsUuid", [value])).toBe(true);
    }
  });
}, 120_000);

// The lock check validates every id at once and runs the per-row fold only
// when that fails, so an id the batch wrongly accepted would never be looked
// at again. It must accept exactly what the single check accepts, alone and
// beside a valid id, including ids that hold its own `x` placeholder or `|`
// separator.
test("the batched lock check accepts exactly what the single UUID check accepts", () => {
  withInterpretedResolver(() => {
    const cases = uuidCases();
    for (const value of [base.replace("5", "x"), base.replace("-", "x"), `${base}|${base}`, base.slice(0, 20), "|", "x"]) {
      cases.add(value);
    }
    for (const value of cases) {
      const single = dispatchEngineBody("engine:fieldIdentityIsUuid", [value]);
      expect(dispatchEngineBody("engine:fieldIdentityAllUuids", [[value]]), JSON.stringify(value)).toBe(single);
      expect(dispatchEngineBody("engine:fieldIdentityAllUuids", [[base, value]]), JSON.stringify(value)).toBe(single);
      expect(dispatchEngineBody("engine:fieldIdentityAllUuids", [[value, base]]), JSON.stringify(value)).toBe(single);
    }
    // One id split in two, or two ids joined into one, is not two ids.
    expect(dispatchEngineBody("engine:fieldIdentityAllUuids", [[base.slice(0, 20), base.slice(20)]])).toBe(false);
    expect(dispatchEngineBody("engine:fieldIdentityAllUuids", [[`${base}|${base}`, base]])).toBe(false);
  });
}, 300_000);

test("a lock with a malformed id still names its first failing row", () => {
  withInterpretedResolver(() => {
    const entry = (name: string, id: string) => ({ $tag: "FieldLockEntry", name, id });
    expect(dispatchEngineBody("engine:fieldIdentityValidateLockEntries", [[entry("a", base), entry("b", base.toUpperCase())]]))
      .toEqual({ $tag: "Nothing" });
    const failed = dispatchEngineBody("engine:fieldIdentityValidateLockEntries", [[
      entry("a", base),
      entry("b", base.replace("4", "x")),
      entry("c", "not-a-uuid"),
    ]]) as { $tag: string; _0?: { $tag: string; handle: string } };
    expect(failed.$tag).toBe("Just");
    expect(failed._0?.$tag).toBe("InvalidFieldUuid");
    expect(failed._0?.handle).toBe(base.replace("4", "x"));
  });
}, 120_000);
