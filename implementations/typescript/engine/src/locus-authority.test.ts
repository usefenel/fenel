import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { authorityTestKernel, mintTestAuthorityForAccount, testPerformTable } from "./authority-test-support";
import { perform } from "./perform";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WRITES = [
  "state:editLocusRoot", "state:clearAllActiveLocusViews", "state:createLocusView", "state:updateLocusView",
  "state:deleteLocusViewById", "state:promoteOldestLocusView", "state:pinToView",
  "state:createSavedQuery", "state:updateSavedQuery", "state:deleteSavedQuery",
];
const READS = [
  "state:readLocusRoot", "state:listLocusViews", "state:getActiveLocusView", "state:countLocusViews",
  "state:listSavedQueries", "state:listSavedQueriesByCategory", "state:searchSavedQueries", "state:getSavedQuery",
];
const NAMES = [...WRITES, ...READS, "state:unrelatedFixtureRead"];
const YES = { $tag: "Just", _0: true };
const NO = { $tag: "Just", _0: false };

function envelope(role: string) {
  return authorityTestKernel().evaluateAuthorityFunction("authority:roleEnvelope", [role, A, NAMES, []]);
}
function permits(role: string, descriptor: string, params: Record<string, unknown> = {}) {
  return authorityTestKernel().evaluateAuthorityFunction("authority:permits", [envelope(role), {
    $tag: "Act", descriptor, args: [params],
    fields: Object.entries(params).map(([name, value]) => ({ $tag: "ActField", name, value })),
  }]);
}

describe("the locus write family", () => {
  test("a viewer cannot write root data through direct native leaves", () => {
    for (const descriptor of WRITES) expect(permits("viewer", descriptor, { id: A }), descriptor).toEqual(NO);
  }, 120_000);

  test("owner and member retain writes, and all roles retain reads", () => {
    for (const role of ["owner", "member"]) {
      for (const descriptor of WRITES) expect(permits(role, descriptor, { id: A }), `${role}/${descriptor}`).toEqual(YES);
    }
    for (const role of ["owner", "member", "viewer"]) {
      for (const descriptor of READS) expect(permits(role, descriptor), `${role}/${descriptor}`).toEqual(YES);
      expect(permits(role, "state:unrelatedFixtureRead")).toEqual(YES);
    }
    for (const descriptor of NAMES) expect(permits("unknown", descriptor, { id: A })).toEqual(NO);
  });

  test("root writes constrain the actual root id, including missing and forged argument shapes", () => {
    for (const role of ["owner", "member"]) {
      for (const params of [{ id: B }, {}, { accountId: A }, { id: null }, Object.create({ id: A })]) {
        expect(permits(role, "state:editLocusRoot", params), role).toEqual(NO);
      }
      expect(permits(role, "state:editLocusRoot", { id: A, expectedRevision: 2, command: { kind: "append" } })).toEqual(YES);
    }
  });

  test("the authored family partitions the production locus and saved-query leaf declarations", () => {
    const source = readFileSync(new URL("../../../../fenel/modules/state/io-leaves.fenel", import.meta.url), "utf8");
    const actual = [...source.matchAll(/^([a-z][A-Za-z0-9]*)\s*:/gm)]
      .map((match) => match[1]!)
      .filter((name) => /Locus|SavedQuer/.test(name) || name === "pinToView")
      .map((name) => `state:${name}`).sort();
    expect(actual).toEqual([...WRITES, ...READS].sort());
    // Observe the public envelope, rather than adding private policy helpers
    // to the host authority seam solely for a test.
    const descriptors = (role: string) => new Set((envelope(role) as {
      rows: { descriptors: { $tag: "SeEnum"; values: string[] } }[];
    }).rows.flatMap((row) => row.descriptors.values));
    const viewer = descriptors("viewer");
    const member = descriptors("member");
    expect([...member].filter((name) => !viewer.has(name)).sort()).toEqual([...WRITES].sort());
    expect(WRITES.some((name) => viewer.has(name))).toBe(false);
    expect(READS.every((name) => viewer.has(name))).toBe(true);
  });

  test("the perform gate refuses canonical and dotted aliases before reaching a write handler", () => {
    const registry = authorityTestKernel();
    const table = testPerformTable(registry);
    let writes = 0;
    const aliases = [
      ["state:editLocusRoot", "state.edit_locus_root"],
      ["state:pinToView", "state.pin_to_view"],
      ["state:updateSavedQuery", "state.update_saved_query"],
    ];
    for (const [canonical, alias] of aliases) {
      table.register(alias!, () => { writes += 1; return "written"; }, 0);
      expect(table.canonicalize(canonical!, alias!)).toBe(true);
    }
    const frame = (role: string) => ({ _authority: mintTestAuthorityForAccount(A, envelope(role), registry), _performTable: table.handle });
    for (const descriptor of aliases.flat()) {
      expect(() => perform(frame("viewer"), { descriptor, args: [{ id: A }] })).toThrow("authority refused");
    }
    expect(writes).toBe(0);
    expect(() => perform(frame("owner"), { descriptor: "state.edit_locus_root", args: [{ id: B }] })).toThrow("authority refused");
    expect(writes).toBe(0);
    expect(perform(frame("member"), { descriptor: "state.edit_locus_root", args: [{ id: A }] })).toBe("written");
    expect(writes).toBe(1);
  });
});
