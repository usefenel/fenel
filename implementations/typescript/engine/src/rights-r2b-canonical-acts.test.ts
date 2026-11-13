// ---------------------------------------------------------------------------
// rights R2b — canonical acts, the reserved namespace, the seam allowlist, and
// the `ArgRecord` axis.
//
// Brief: `workstreams/rights/briefs/r2b-authority-spine-ii.md` §6.
//
// ⚠ WHAT IS NOT HERE, AND WHY. The pins that read the PRODUCTION perform table
// (one name per act over all 1727 descriptors; the policy lists being listed;
// the general row's set equality) live in the runtime suite, because
// `loadRegistry()` is the runtime's. A pin on `authorityTestKernel()` — `std`
// only — would pass while the production table carried 221 alias pairs, which
// is precisely the defect this phase exists to make unrepresentable.
//
// ⚠ EVERY PIN HERE WAS OBSERVED RED BEFORE IT WAS TRUSTED, one neuter at a
// time, with the red text recorded in the phase completion note.
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";
import { createRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { perform, type PerformOutcome } from "./perform";
import { evaluate, type EvaluateContext } from "./json-logic";
import { assertSourceModuleNamespaces, prepareSourceModule, sourceModuleRegistry } from "./authoring/source-module";
import { authorityTestKernel, mintTestAuthority, mintTestAuthorityFor, testPerformTable } from "./authority-test-support";
import { loadFenelModule } from "./fenel-module";
import MEMBERSHIP_FENEL from "../../../../fenel/modules/auth/membership.fenel?raw";

const LONG = 400_000;

function enumSet(values: readonly unknown[]): unknown {
  return { $tag: "SeEnum", values: [...values] };
}
function rowEnvelope(rows: readonly unknown[]): unknown {
  return { $tag: "EvRows", rows: [...rows] };
}
function row(descriptors: unknown, args: readonly unknown[] = []): unknown {
  return { $tag: "ActRow", descriptors, args: [...args] };
}
function act(descriptor: string, fields: Record<string, unknown> = {}): unknown {
  return {
    $tag: "Act",
    descriptor,
    args: [fields],
    fields: Object.entries(fields).map(([name, value]) => ({ $tag: "ActField", name, value })),
  };
}

// ---------------------------------------------------------------------------
// §6.2 / §6.3 — THE JUDGED NAME IS THE CANONICAL ONE, and so is the refusal.
// ---------------------------------------------------------------------------

describe("rights R2b — perform judges the CANONICAL act", () => {
  function canonicalFixture() {
    const registry = authorityTestKernel();
    const table = testPerformTable(registry);
    let hits = 0;
    table.register("state.create_instance", () => { hits += 1; return "created"; }, 0);
    // The implementation MOVES to the function id; the dotted action stays as a
    // one-hop alias.
    expect(table.canonicalize("state:createInstance", "state.create_instance")).toBe(true);
    return { registry, table, hits: () => hits };
  }

  test("2 — an envelope naming the CANONICAL id permits BOTH spellings", () => {
    const f = canonicalFixture();
    const frame: EvaluateContext = {
      _performTable: f.table.handle,
      _authority: mintTestAuthorityFor(["state:createInstance"], f.registry),
    };
    // Neuter: judge `act.descriptor` instead of the canonical name in
    // `perform`. RED reads: `authority refused "state.create_instance"`.
    expect(perform(frame, { descriptor: "state.create_instance", args: [{}] })).toBe("created");
    expect(perform(frame, { descriptor: "state:createInstance", args: [{}] })).toBe("created");
    expect(f.hits()).toBe(2);
  }, LONG);

  test("2 — an envelope naming the ALIAS spelling permits NEITHER", () => {
    const f = canonicalFixture();
    const frame: EvaluateContext = {
      _performTable: f.table.handle,
      _authority: mintTestAuthorityFor(["state.create_instance"], f.registry),
    };
    // ⚠ THIS IS THE HALF THAT MAKES THE TRAP UNREPRESENTABLE. Under R2a a
    // policy list holding one of an act's two spellings silently permitted that
    // spelling; now a list holding the NON-canonical one permits nothing at all,
    // loudly, on the first call.
    expect(() => perform(frame, { descriptor: "state.create_instance", args: [{}] }))
      .toThrow(/authority refused "state:createInstance" \(refused\)/);
    expect(() => perform(frame, { descriptor: "state:createInstance", args: [{}] }))
      .toThrow(/authority refused "state:createInstance" \(refused\)/);
    expect(f.hits()).toBe(0);
  }, LONG);

  test("3 — the refusal and the outcome hook both name the CANONICAL act", () => {
    const f = canonicalFixture();
    const seen: Array<{ descriptor: string; kind: string }> = [];
    f.table.onOutcome((a, outcome: PerformOutcome) => {
      seen.push({ descriptor: a.descriptor, kind: outcome.kind });
    });
    const refusing: EvaluateContext = {
      _performTable: f.table.handle,
      _authority: mintTestAuthorityFor(["probe:other"], f.registry),
    };
    let caught: unknown;
    try {
      perform(refusing, { descriptor: "state.create_instance", args: [{}] });
    } catch (error) { caught = error; }
    // Neuter: thread the requested name into `AuthorityRefused`. RED reads the
    // dotted spelling in `.descriptor`.
    expect((caught as { descriptor?: string }).descriptor).toBe("state:createInstance");
    const permitting: EvaluateContext = {
      _performTable: f.table.handle,
      _authority: mintTestAuthorityFor(["state:createInstance"], f.registry),
    };
    perform(permitting, { descriptor: "state.create_instance", args: [{}] });
    expect(seen).toEqual([{ descriptor: "state:createInstance", kind: "settled" }]);
  }, LONG);

  test("canonicalize's precondition holds, and a failed one mutates NOTHING", () => {
    const registry = authorityTestKernel();
    const table = testPerformTable(registry);
    table.register("probe:impl", () => "impl", 0);
    // The alias side must hold an IMPLEMENTATION.
    expect(table.canonicalize("probe:canon", "probe:absent")).toBe(false);
    expect(table.listDescriptors()).toEqual(["probe:impl"]);
    // A canonical name that already holds a DIFFERENT implementation refuses.
    table.register("probe:taken", () => "taken", 0);
    expect(table.canonicalize("probe:taken", "probe:impl")).toBe(false);
    expect(table.listDescriptors()).toEqual(["probe:impl", "probe:taken"]);
    // The real move: the implementation lands on the canonical name and the
    // alias is no longer listed.
    expect(table.canonicalize("probe:canon", "probe:impl")).toBe(true);
    expect(table.listDescriptors()).toEqual(["probe:canon", "probe:taken"]);
    // ⚠ A SECOND CALL RETURNS FALSE, and that is the contract rather than a
    // wart: the precondition is "the ALIAS side holds an implementation", and
    // after the move it holds an alias. It refuses instead of re-moving, and it
    // mutates nothing. `registerFenelBodyDispatchers` never reaches here twice
    // anyway — its `reg.getIOHandler(fn.id)` guard fires first — but a partial
    // re-apply would be far worse than a refusal, so the refusal is pinned.
    expect(table.canonicalize("probe:canon", "probe:impl")).toBe(false);
    expect(table.listDescriptors()).toEqual(["probe:canon", "probe:taken"]);
    // And the alias still RESOLVES — every existing caller keeps its spelling.
    const frame: EvaluateContext = {
      _performTable: table.handle,
      _authority: mintTestAuthorityFor(["probe:canon"], registry),
    };
    expect(perform(frame, { descriptor: "probe:impl", args: [] })).toBe("impl");
  }, LONG);

  test("an alias CHAIN cannot judge one name and execute another", () => {
    // ⚠ THE ONE-HOP PROPERTY. `perform` canonicalises (one hop) and then reads
    // the canonical entry's OWN implementation. If it followed a second hop,
    // `A → B → C` would be JUDGED as `B` — because that is what
    // `canonicalDescriptor` returns — and EXECUTED as `C`'s implementation,
    // which is precisely the judge-one-execute-another shape canonicalisation
    // exists to close. No production path builds such a chain, so this pin is
    // about what is REPRESENTABLE rather than about what happens.
    //
    // Neuter: restore `resolveImplementation(table, canonical)` in `perform`.
    // RED reads: `"c"` is returned — B was judged and C ran.
    const registry = authorityTestKernel();
    const table = testPerformTable(registry);
    let cHits = 0;
    table.register("chain:c", () => { cHits += 1; return "c"; }, 0);
    expect(table.alias("chain:b", "chain:c")).toBe(true);
    expect(table.alias("chain:a", "chain:b")).toBe(true);
    const frame: EvaluateContext = {
      _performTable: table.handle,
      _authority: mintTestAuthorityFor(["chain:a", "chain:b", "chain:c"], registry),
    };
    // `chain:a` canonicalises to `chain:b`, which holds no implementation.
    expect(() => perform(frame, { descriptor: "chain:a", args: [] }))
      .toThrow(/no implementation for "chain:b"/);
    expect(cHits).toBe(0);
    // THE CONTROL, one hop apart: `chain:b` reaches `chain:c`.
    expect(perform(frame, { descriptor: "chain:b", args: [] })).toBe("c");
    expect(cHits).toBe(1);
  }, LONG);
});

// ---------------------------------------------------------------------------
// §6.7 / §6.9 — THE RESERVED NAMESPACE AND THE SEAM ALLOWLIST.
// ---------------------------------------------------------------------------

describe("rights R2b — the checker's own namespace is reserved", () => {
  test("7 — every namespace a registry occupies is reserved, `authority` included", () => {
    const registry = createRegistry([stdModule]);
    const reserved = new Set(registry.listReservedNamespaces());
    // ⚠ THE ONE THAT MOTIVATED THE RULE. It appears in no manifest —
    // `createRegistrySteps` PREPENDS it — so the old manifest-derived
    // reservation admitted an account module named `authority`, which then
    // shadowed the checker and refused every act in that account.
    expect(reserved).toContain("authority");
    for (const name of reserved) {
      expect(
        () => assertSourceModuleNamespaces([{ module: { name } } as never], reserved),
        name,
      ).toThrow(/reserved/);
    }
    // THE CONTROL, one input apart: a fresh name is admitted.
    expect(() => assertSourceModuleNamespaces(
      [{ module: { name: "r2b-not-reserved" } } as never],
      reserved,
    )).not.toThrow();
  }, LONG);

  test("7 — an ACCOUNT MODULE named `authority` is refused by NAME, at preparation", () => {
    const registry = createRegistry([stdModule]);
    const reserved = new Set(registry.listReservedNamespaces());
    // A hand-built module needs its field identities or it fails on the
    // identity lock instead, which would prove nothing about the reservation.
    const prepared = prepareSourceModule(
      "module authority where\n\nevil : String -> String\nevil x = x\n",
      "authority",
      { version: 1, fields: [] },
      () => "00000000-0000-4000-8000-000000000001",
    );
    // Neuter: build the reserved set from the manifest lists again. RED reads:
    // no throw here, and a bind-time `authority seam: "authority:topEnvelope"
    // has no body in this registry` later — the accidental refusal, not a rule.
    expect(() => assertSourceModuleNamespaces([prepared], reserved))
      .toThrow(/Source module namespace is reserved or already installed: authority/);
  }, LONG);

  test("7 — the PRODUCTION entry point supplies a reserved set that carries `authority`", () => {
    // ⚠ THE SHAPE RULE, AND THE NEUTER PASS IS WHAT FOUND IT. The two pins above
    // hand `assertSourceModuleNamespaces` a reserved set they built themselves,
    // so they observe the ASSERTION and say nothing about whether the production
    // callers pass a good set. Neutering `reservedModuleNames()` back to the
    // manifest-derived list left both GREEN. This pin enters through
    // `sourceModuleRegistry`, which supplies its own set — the same function the
    // authoring surfaces and `validateSourceAwareAccountSnapshot` call.
    //
    // Neuter: `reservedModuleNames()` returns
    // `[...SYSTEM_REGISTRY_MODULES, ...modulesFor("seed")].map((m) => m.name)`.
    // RED reads: no throw, and the build proceeds to a bind-time
    // `authority seam: "authority:topEnvelope" has no body in this registry` —
    // the ACCIDENTAL refusal this phase replaced with a rule.
    const prepared = prepareSourceModule(
      "module authority where\n\nevil : String -> String\nevil x = x\n",
      "authority",
      { version: 1, fields: [] },
      () => "00000000-0000-4000-8000-000000000002",
    );
    expect(() => sourceModuleRegistry([prepared]))
      .toThrow(/Source module namespace is reserved or already installed: authority/);
    // And the namespaces that are NOT module names are reserved too — `subject`
    // rides inside the auth module through `functionNamespaceOverrides`, so a
    // module-name-only reservation would have left it installable.
    const subject = prepareSourceModule(
      "module subject where\n\nevil : String -> String\nevil x = x\n",
      "subject",
      { version: 1, fields: [] },
      () => "00000000-0000-4000-8000-000000000003",
    );
    expect(() => sourceModuleRegistry([subject]))
      .toThrow(/Source module namespace is reserved or already installed: subject/);
  }, LONG);

  test("9 — the host seam is an ALLOWLIST, not a prefix", () => {
    const registry = createRegistry([stdModule]);
    // Not an authority function at all.
    expect(() => registry.evaluateAuthorityFunction("std:add", [1, 2]))
      .toThrow(/is not an authority function/);
    // An `authority:` body that is NOT a host policy entry point. Neuter:
    // prefix-only. RED reads: the call returns a value instead of throwing.
    for (const internal of [
      "authority:scalarSetOk",
      "authority:scalarSetShapeOk",
      "authority:memberScalar",
      "authority:authorityEnumMember",
    ]) {
      expect(() => registry.evaluateAuthorityFunction(internal, [enumSet(["a"]), 0]), internal)
        .toThrow(/is not a host-reachable authority entry point/);
    }
    // THE CONTROL: the judgment itself still runs through the same seam.
    expect(registry.evaluateAuthorityFunction("authority:permits", [
      rowEnvelope([row(enumSet(["probe:a"]))]),
      act("probe:a"),
    ])).toEqual({ $tag: "Just", _0: true });
  }, LONG);
});

// ---------------------------------------------------------------------------
// §6.15 — THE `ArgRecord` AXIS: its semantics, its admission, and its agreement
// with `ArgField` on the one-entry case.
// ---------------------------------------------------------------------------

describe("rights R2b — ArgRecord is Kleene AND over named entries", () => {
  const registry = authorityTestKernel();
  const permits = (envelope: unknown, a: unknown) =>
    registry.evaluateAuthorityFunction("authority:permits", [envelope, a]);
  const recordAxis = (entries: Array<[string, unknown]>) => ({
    $tag: "ArgRecord",
    fields: entries.map(([name, set]) => ({ $tag: "FieldAxis", name, set })),
  });

  test("15 — conjunction, absent entries, and the empty/duplicate refusals", () => {
    const envelope = rowEnvelope([row(
      enumSet(["probe:a"]),
      [recordAxis([["accountId", enumSet(["A"])], ["role", enumSet(["owner", "member"])]])],
    )]);
    // Both entries satisfied.
    expect(permits(envelope, act("probe:a", { accountId: "A", role: "owner" })))
      .toEqual({ $tag: "Just", _0: true });
    // Either one wrong refuses — AND, not OR. Neuter: OR over the entries.
    expect(permits(envelope, act("probe:a", { accountId: "B", role: "owner" })))
      .toEqual({ $tag: "Just", _0: false });
    expect(permits(envelope, act("probe:a", { accountId: "A", role: "janitor" })))
      .toEqual({ $tag: "Just", _0: false });
    // An ABSENT entry refuses: a restriction on a field the act does not carry
    // is not satisfied by the act's silence. Neuter: absent → Just true.
    expect(permits(envelope, act("probe:a", { accountId: "A" })))
      .toEqual({ $tag: "Just", _0: false });
    expect(permits(envelope, act("probe:a", {})))
      .toEqual({ $tag: "Just", _0: false });

    // Admission refuses the empty list and a duplicate name, at the MINT.
    expect(() => mintTestAuthority(
      rowEnvelope([row(enumSet(["probe:a"]), [{ $tag: "ArgRecord", fields: [] }])]),
      registry,
    )).toThrow(/record axis has no field axes/);
    expect(() => mintTestAuthority(
      rowEnvelope([row(enumSet(["probe:a"]), [recordAxis([
        ["accountId", enumSet(["A"])], ["accountId", enumSet(["B"])],
      ])])]),
      registry,
    )).toThrow(/duplicate field names/);
    expect(() => mintTestAuthority(
      rowEnvelope([row(enumSet(["probe:a"]), [recordAxis([["", enumSet(["A"])]])])]),
      registry,
    )).toThrow(/empty field name/);
    // A set outside the admitted fragment is refused inside a record axis too.
    expect(() => mintTestAuthority(
      rowEnvelope([row(enumSet(["probe:a"]), [recordAxis([["accountId", { $tag: "SeAll" }]])])]),
      registry,
    )).toThrow(/outside the admitted scalar fragment/);
    // And at EXERCISE, independently of how it got into the envelope.
    expect(permits(
      rowEnvelope([row(enumSet(["probe:a"]), [recordAxis([["accountId", { $tag: "SeAll" }]])])]),
      act("probe:a", { accountId: "A" }),
    )).toEqual({ $tag: "Nothing" });
    // ⚠ AND THE EMPTY LIST IS RE-CHECKED AT EXERCISE TOO, because it is the one
    // structural property of a record axis that changes what the axis DENOTES:
    // no entries means NO restriction, which is what `ArgAny` spells. Admission
    // refuses it, and so does exercise — an envelope written into the private
    // table past the mint gets no free pass on that axis.
    // Neuter: `authorityRecordAxisMember` calls `authorityRecordAxis` directly.
    // RED reads: `{"$tag":"Just","_0":true}` — a vacuous permit.
    expect(permits(
      rowEnvelope([row(enumSet(["probe:a"]), [{ $tag: "ArgRecord", fields: [] }])]),
      act("probe:a", { accountId: "A" }),
    )).toEqual({ $tag: "Nothing" });
    // A well-formed record axis mints.
    expect(() => mintTestAuthority(envelope, registry)).not.toThrow();
  }, LONG);

  test("15 — ArgRecord [one entry] AGREES with ArgField on a seeded grid", () => {
    const sets: unknown[] = [
      enumSet([]), enumSet(["A"]), enumSet(["A", "B"]), enumSet([1, 2]),
      enumSet([true]), { $tag: "SeNone" },
      { $tag: "SeUnion", branches: [enumSet(["A"]), enumSet(["B"])] },
      { $tag: "SeIntersect", branches: [enumSet(["A", "B"]), enumSet(["B"])] },
      { $tag: "SeDiff", left: enumSet(["A", "B"]), right: enumSet(["B"]) },
      // Outside the fragment — BOTH faces must abstain, which is what makes
      // `Nothing` one of the three values this grid observes.
      { $tag: "SeAll" },
      { $tag: "SeRef", handle: "Bot" },
    ];
    const acts: unknown[] = [
      act("probe:a", { accountId: "A" }),
      act("probe:a", { accountId: "B" }),
      act("probe:a", { accountId: 1 }),
      act("probe:a", { accountId: true }),
      act("probe:a", { other: "A" }),
      act("probe:a", {}),
      act("probe:b", { accountId: "A" }),
      // A field whose value is an OBJECT: `elem` matches by reference, so both
      // faces must agree on refusing it.
      act("probe:a", { accountId: { $tag: "Just", _0: "A" } }),
      act("probe:a", { accountId: "A", role: "owner" }),
      act("probe:a", { role: "owner" }),
    ];
    const seen = new Set<string>();
    let compared = 0;
    const disagreements: string[] = [];
    for (const set of sets) {
      for (const name of ["accountId", "role"]) {
        for (const a of acts) {
          const withField = permits(
            rowEnvelope([row(enumSet(["probe:a"]), [{ $tag: "ArgField", name, set }])]),
            a,
          );
          const withRecord = permits(
            rowEnvelope([row(enumSet(["probe:a"]), [recordAxis([[name, set]])])]),
            a,
          );
          compared += 1;
          seen.add(JSON.stringify(withField));
          if (JSON.stringify(withField) !== JSON.stringify(withRecord)) {
            disagreements.push(
              `${name} ∈ ${JSON.stringify(set)} on ${JSON.stringify(a)}: `
              + `ArgField=${JSON.stringify(withField)} ArgRecord=${JSON.stringify(withRecord)}`,
            );
          }
        }
      }
    }
    expect(compared).toBeGreaterThanOrEqual(200);
    // All THREE Tri values are exercised, so "they agree" is not "they both
    // always refuse".
    expect(seen.size).toBe(3);
    expect(disagreements).toEqual([]);
  }, LONG);

  test("15 — ArgRecord counts toward the node budget", () => {
    // Not a separate rule so much as a statement that the new former is not a
    // hole in the resource bound: a record axis whose entries carry oversized
    // enums is refused at the mint like any other.
    const huge = enumSet(Array.from({ length: 65537 }, (_v, i) => `d${i}`));
    expect(() => mintTestAuthority(
      rowEnvelope([row(enumSet(["probe:a"]), [recordAxis([["accountId", huge]])])]),
      registry,
    )).toThrow(/authority mint refused/);
  }, LONG);
});

// The evaluator import is used by the agreement grid's sibling in the R2a file;
// referenced here so a future edit that needs it does not re-derive the import.
void evaluate;

// ---------------------------------------------------------------------------
// THE IDENTITY REALM'S auth-MODULE PREFIX RULE, and the list that fences it.
//
// The rule selects every `auth:` descriptor into the realm envelope, because
// every bodied auth function IS on the authentication chain — that was true
// while the module held only the session lifecycle. rights R2b put a PRODUCT
// surface in the same module (`membership.fenel` joins the union by header), so
// the rule now needs an exclusion, and an exclusion written by hand is a list
// that goes stale the moment someone adds a fifth orchestrator.
//
// This pin ties the exclusion to the FILE: EVERY bodied function
// `membership.fenel` declares must be excluded, and nothing else.
//
// ⚠ EVERY BODIED FUNCTION, NOT EVERY DOOR (review round 3). An earlier spelling
// of both the list and this pin used the `@ioAction`-bearing subset, which left
// the five private helpers in the realm — and two of them,
// `authChangeMemberRoleNow` / `authRemoveMemberNow`, are the orchestrators MINUS
// their last-owner guard. The pin AGREED with the list because both were derived
// the same wrong way, which is how a mirror pin fails: it re-derives the defect
// instead of observing it.
//
// ⚠ AND THIS PIN SEES ONE FILE. The `auth` module is a cross-file union, so a
// fifth orchestrator added in a NEW file carrying `module auth where` is invisible
// here. The guard for that is in `rights-r2b-partition.test.ts`, which enumerates
// what the LIVE realm grants and refuses to let that set grow silently.
// ---------------------------------------------------------------------------

describe("rights R2b — the realm's auth prefix rule excludes the member-management surface", () => {
  test("the exclusion is exactly membership.fenel's bodied functions", () => {
    const registry = createRegistry([stdModule]);
    const excluded = registry.evaluateAuthorityFunction(
      "authority:membershipModuleDescriptors", [0],
    ) as string[];
    // The FILE, not a copy of the list: `loadFenelModule` over the same source
    // the auth union loads.
    const membership = loadFenelModule(MEMBERSHIP_FENEL, "auth");
    const bodiedIds = (membership.functions ?? [])
      .filter((fn: { id: string; body?: unknown }) => fn.body !== undefined && fn.body !== null)
      .map((fn: { id: string }) => fn.id)
      .sort();
    // Neuter: add a fifth orchestrator — or a sixth private helper — to
    // `membership.fenel` without touching `membershipModuleDescriptors`. RED
    // reads: the two sets differ by that name, which is exactly the one that
    // would re-enter the realm.
    expect([...excluded].sort()).toEqual(bodiedIds);
    expect(bodiedIds.length).toBeGreaterThan(0);
    // The two the round-3 finding was about, named so a future narrowing of the
    // rule back to the doors is a RED rather than a silent re-entry.
    expect(bodiedIds).toContain("auth:authChangeMemberRoleNow");
    expect(bodiedIds).toContain("auth:authRemoveMemberNow");

    // And the rule really removes them: an `auth:` descriptor in the exclusion
    // is NOT in the realm, one outside it IS.
    const all = [...bodiedIds, "auth:issueSession", "auth:resolveFromRow", "state:createInstance"];
    const realm = registry.evaluateAuthorityFunction("authority:identityRealmEnvelope", [all]);
    const permits = (descriptor: string) => registry.evaluateAuthorityFunction(
      "authority:permits", [realm, act(descriptor)],
    );
    for (const id of bodiedIds) expect(permits(id), id).toEqual({ $tag: "Just", _0: false });
    expect(permits("auth:issueSession")).toEqual({ $tag: "Just", _0: true });
    expect(permits("auth:resolveFromRow")).toEqual({ $tag: "Just", _0: true });
    expect(permits("state:createInstance")).toEqual({ $tag: "Just", _0: false });
  }, LONG);
});
