// ---------------------------------------------------------------------------
// rights R3a — ownership AT THE SELECTION SITES (engine side).
//
// Brief: `workstreams/rights/briefs/r3a-account-partitioned-dispatch.md` §6.
// Instrument law (§6 R0.5): expected values are source literals, every negative
// ships a positive control, a pin reads the PRODUCTION object where the claim is
// about production, and a mutant that does not compile is not a neuter.
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";

const A = "r3a-account-a";
const B = "r3a-account-b";
const LONG = 200_000;

async function frameFor(account: string): Promise<Record<string, unknown>> {
  const { mintTestAuthorityForAccount, testDescriptorEnvelope, dispatchTestKernel } =
    await import("./authority-test-support");
  const kernel = dispatchTestKernel();
  return {
    natives: {},
    _activeTags: [] as string[],
    _authority: mintTestAuthorityForAccount(account, testDescriptorEnvelope([], kernel), kernel),
  };
}

describe("rights R3a — ownership at the selection sites", () => {
  async function fixture() {
    const { createDispatchRegistry } = await import("./dispatch-registry");
    const reg = createDispatchRegistry();
    reg.defineClass({
      name: "R3aOwned",
      params: [{ name: "t" }],
      methods: [{ name: "who", params: [], returns: { $ref: "String" } }],
    });
    reg.addInstance({
      typeName: "R3aOwned", args: ["T"], methods: { who: "boot" }, scope: { kind: "global" },
    });
    reg.addInstance({
      typeName: "R3aOwned", args: ["T"], methods: { who: "A" },
      scope: { kind: "account", accountId: A }, priority: 100,
    });
    reg.addInstance({
      typeName: "R3aOwned", args: ["T"], methods: { who: "B" },
      scope: { kind: "account", accountId: B }, priority: 100,
    });
    return reg;
  }

  // §6 pin 4 (the OWNERSHIP half) — an owned row is selected by its owner and by
  // nobody else, and a frame with no account gets the boot row. Asserted through
  // the PRODUCTION predicate and the PRODUCTION resolver.
  //
  // Neuters: (a) `instanceVisible`'s account arm returns `true` unconditionally;
  // (b) `asAccountScoped` stamps `{kind:"global"}` — a VALID spelling, so a
  // census of spellings alone stays green while this goes RED.
  test("pin 4 — an owned row is selected by its owner and by nobody else", async () => {
    const { GLOBAL_ONLY, instanceVisible } = await import("./dispatch-registry");
    const { resolveEffect } = await import("./effect-dispatch");
    const reg = await fixture();

    const pick = async (account: string): Promise<unknown> => {
      const r = resolveEffect(await frameFor(account) as never, reg, "R3aOwned", "T");
      if (r?.source.kind !== "instance") throw new Error("expected an instance");
      return r.source.instance.methods["who"];
    };
    expect(await pick(A)).toBe("A");
    expect(await pick(B)).toBe("B");

    const anonymous = { natives: {}, _activeTags: [] as string[] };
    const r = resolveEffect(anonymous, reg, "R3aOwned", "T");
    if (r?.source.kind !== "instance") throw new Error("expected an instance");
    expect(r.source.instance.methods["who"]).toBe("boot");

    expect(reg.listInstances("R3aOwned").filter((i) => instanceVisible(i, GLOBAL_ONLY)))
      .toHaveLength(1);
  }, LONG);

  // §6 pin 4 (the SPELLINGS + COUNT + PRODUCER half) — after a real account load
  // every scope is a valid spelling, none is the retired bare bucket, the count
  // of rows owned by the applied account equals the number applied, and a
  // refresh of ONE account leaves the other's rows alone (the σ-binding shape at
  // the registry level: `removeInstancesByScope("account")` used to leave `[]`).
  test("pin 4 — applying an account's instances stamps exactly that account, once per row", async () => {
    const { createDispatchRegistry } = await import("./dispatch-registry");
    const { applyAccountSpecInstances, refreshAccountInstances } = await import("./account-registries");
    const reg = createDispatchRegistry();
    const rows = [
      { typeName: "R3aApplied", args: ["x"], methods: { who: "1" } },
      { typeName: "R3aApplied", args: ["y"], methods: { who: "2" } },
      // an authored scope on the row is DISCARDED — ownership is derived from
      // who loaded it, never from what the row claims.
      { typeName: "R3aApplied", args: ["z"], methods: { who: "3" }, scope: { kind: "global" } as const },
    ];
    applyAccountSpecInstances(reg, A, rows as never);
    applyAccountSpecInstances(reg, B, [rows[0]] as never);

    const scopes = reg.listInstances("R3aApplied").map((i) => i.scope);
    expect(scopes).toEqual([
      { kind: "account", accountId: A },
      { kind: "account", accountId: A },
      { kind: "account", accountId: A },
      { kind: "account", accountId: B },
    ]);
    expect(scopes.filter((s) => typeof s === "string")).toEqual([]);

    refreshAccountInstances(reg, A, []);
    expect(reg.listInstances("R3aApplied").map((i) => i.methods["who"])).toEqual(["1"]);
    expect(reg.listInstances("R3aApplied").map((i) => i.scope))
      .toEqual([{ kind: "account", accountId: B }]);

    // an empty account id is NOT an account (§12 trap 32)
    expect(() => applyAccountSpecInstances(reg, "", rows as never)).toThrow(/non-empty accountId/);
  }, LONG);

  // §6 pin 4b — THE FACET PRODUCER DERIVES ITS OWNER TOO.
  //
  // ⚠ THE ROUND-2 FIX HAD NO PIN (review round 5, Grok). Reverting
  // `account-field-registry.ts`'s stamp to `scope: facet.scope` — which is what
  // shipped before round 2 — left every R3a pin GREEN, because pin 14
  // hand-supplied the ADT to `createRegistry` instead of asking the producer for
  // it, and `account-field-registry.test.ts` only checks that the key routes to
  // the account branch, which the bare `"account"` marker still does. So the
  // completion note claimed a stamp that nothing observed.
  //
  // This drives the PRODUCTION projection and then asks the question the stamp
  // exists to answer: is the row visible to its owner's frame, and to nobody
  // else's. A bare `"account"` marker fails BOTH halves after the flip — it is
  // invisible even to the account that owns the facet.
  //
  // Neuter: `scope: facet.scope as never` at `account-field-registry.ts:113`.
  // RED: the scope is the string `"account"`, and A's own frame cannot see it.
  test("pin 4b — the account facet producer stamps the owner, and the owner alone can see it", async () => {
    const { projectAccountFieldRegistrySnapshot } = await import("./account-field-registry");
    const { instanceVisible, frameVisibility } = await import("./dispatch-registry");
    const FIELD = "8c1e2f00-0000-4000-8000-00000000f1e1";
    // the facet DATA producers emit the bare marker — that is the input, and it
    // is exactly what must NOT reach the row.
    const snapshot = {
      owners: [],
      fields: [{
        id: FIELD,
        currentCodeName: "title",
        status: "live",
        realm: "account",
        reuseVisibility: "account",
      }],
      facets: [{
        fieldId: FIELD,
        typeName: "Codeable",
        methods: { codeName: "title" },
        scope: "account",
        priority: 100,
      }],
    };

    const projected = projectAccountFieldRegistrySnapshot(A, snapshot as never);
    const rows = projected.fieldRepresentations;
    // NOT VACUOUS: the projection really produced the facet.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.args).toEqual([FIELD]);

    // (a) the SHAPE is the derived ADT, not the argued marker
    expect(rows[0]!.scope).toEqual({ kind: "account", accountId: A });

    // (b) and the CONSEQUENCE, which is the actual claim: A sees it, B does not.
    const row = { typeName: "Codeable", args: [FIELD], methods: {}, scope: rows[0]!.scope } as never;
    expect(instanceVisible(row, frameVisibility(await frameFor(A) as never))).toBe(true);
    expect(instanceVisible(row, frameVisibility(await frameFor(B) as never))).toBe(false);

    // (c) the same snapshot under a DIFFERENT account is owned by that one —
    // the owner comes from the registry being built, never from the facet.
    const other = projectAccountFieldRegistrySnapshot(B, snapshot as never);
    expect(other.fieldRepresentations[0]!.scope).toEqual({ kind: "account", accountId: B });
  }, LONG);

  // §6 pin 18 — DELETION IS OWNER-SCOPED AND OWNER-REQUIRED. A boot row and
  // another account's row both survive A's removal, and `removeInstancesOwnedBy`
  // names one account.
  //
  // Neuter: an `args[0]`-only filter in `removeInstance`. §5's install-door claim
  // rests here — this is what neutralises the door's pool-poisoning downstream.
  test("pin 18 — removal touches only the naming owner's rows", async () => {
    const reg = await fixture();
    reg.removeInstance("R3aOwned", "T", A);
    expect(reg.listInstances("R3aOwned").map((i) => i.methods["who"])).toEqual(["boot", "B"]);

    // an empty owner removes nothing at all
    reg.removeInstance("R3aOwned", "T", "");
    expect(reg.listInstances("R3aOwned")).toHaveLength(2);

    reg.removeInstancesOwnedBy(B);
    expect(reg.listInstances("R3aOwned").map((i) => i.methods["who"])).toEqual(["boot"]);

    // ⚠ AND THE BOOT ROW IS NOT REMOVABLE THROUGH THE API AT ALL — no owner
    // names it, which is §4.7's "no production path removes a global row".
    reg.removeInstance("R3aOwned", "T", A);
    reg.removeInstance("R3aOwned", "T", B);
    reg.removeInstancesOwnedBy(A);
    expect(reg.listInstances("R3aOwned").map((i) => i.methods["who"])).toEqual(["boot"]);
  }, LONG);

  // §6 pin 11 — `BY_PRIORITY` FILTERS BEFORE IT SORTS. This arm used to sort the
  // whole class and return the top row before consulting any visibility, so an
  // account row at priority > 100 won the capability pick for EVERY account —
  // the executed `{"before":"fenel","after":"mailgun"}` shape.
  //
  // Neuter: drop the pre-sort filter. RED: B's instance wins.
  test("pin 11 — a high-priority owned row does not win the capability pick", async () => {
    const { createDispatchRegistry, GLOBAL_ONLY } = await import("./dispatch-registry");
    const { resolveEffect, BY_PRIORITY } = await import("./effect-dispatch");
    const reg = createDispatchRegistry();
    reg.defineClass({
      name: "R3aCapability",
      params: [{ name: "t" }],
      methods: [{ name: "send", params: [], returns: { $ref: "String" } }],
    });
    reg.addInstance({
      typeName: "R3aCapability", args: ["fenel"], methods: { send: "boot" },
      scope: { kind: "global" }, priority: 100,
    });
    reg.addInstance({
      typeName: "R3aCapability", args: ["mailgun"], methods: { send: "B" },
      scope: { kind: "account", accountId: B }, priority: 9_999,
    });
    const picked = resolveEffect(undefined, reg, "R3aCapability", BY_PRIORITY, GLOBAL_ONLY);
    if (picked?.source.kind !== "instance") throw new Error("expected an instance");
    expect(picked.source.instance.methods["send"]).toBe("boot");

    // POSITIVE CONTROL — the pick is not simply frozen: a HIGHER-priority
    // repository row does win, so what the fence excludes is ownership and not
    // priority.
    reg.addInstance({
      typeName: "R3aCapability", args: ["override"], methods: { send: "boot-override" },
      scope: { kind: "global" }, priority: 500,
    });
    const again = resolveEffect(undefined, reg, "R3aCapability", BY_PRIORITY, GLOBAL_ONLY);
    if (again?.source.kind !== "instance") throw new Error("expected an instance");
    expect(again.source.instance.methods["send"]).toBe("boot-override");
  }, LONG);

  // §6 pin 8 — STRUCTURAL dispatch filters its rules AND keys BOTH caches on the
  // account and on a COLLISION-FREE tags digest.
  //
  // ⚠ THIS IS A MECHANISM PIN AND STAYS ONE, deliberately — but the FIRST cut
  // of it did not pin (review round 1, Fable). It read the two `cacheKey`
  // TEMPLATES for `${visibilityKey}` and never read `visibilityCacheKey`'s
  // BODY, so a mutant that dropped the ACCOUNT from the digest while leaving
  // both templates intact shipped GREEN — and its behavioural consequence is
  // that account B is served account A's `ByPattern` rules out of A's cache
  // line, which is the exact cross-account structural leak the fence exists
  // for. The pin now reads the digest function itself.
  //
  // ⚠ THE COLLISION HALF IS BEHAVIOURAL NOW (review round 10, Astra). It was a
  // source read, and the slice it read stopped at the `}` closing
  // `${visibility.account ?? ""}` — so the RETURNED tags component was never
  // looked at, and `${tags}` → `${tags.length}` typechecked, kept every
  // assertion below true, and gave `["ab"]` and `["cd"]` the same cache line.
  // "The claim is about the shape of the key, which a verdict cannot see" was
  // wrong: a key is a VALUE, and two visibilities agreeing on it is exactly a
  // verdict. What genuinely needs the fixture the old note describes is the
  // downstream LEAK (a `ByPattern` rule served across accounts); the key's
  // injectivity does not, and is pinned directly through a test seam.
  test("pin 8 — the structural caches key on the account and a collision-free tags digest", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { __visibilityCacheKeyForTests: key } = await import("./effect-dispatch");
    const { GLOBAL_ONLY } = await import("./dispatch-registry");
    const vis = (account: string | null, tags: readonly string[]) =>
      ({ kind: "frame", account, tags }) as never;

    // ---- THE KEY IS INJECTIVE ON EVERY COORDINATE IT CLAIMS ----
    // same LENGTH, different tags — the `${tags.length}` mutant dies here
    expect(key(vis(A, ["ab"]))).not.toBe(key(vis(A, ["cd"])));
    // same CONCATENATION, different tags — the `join("")` mutant dies here
    expect(key(vis(A, ["xy"]))).not.toBe(key(vis(A, ["x", "y"])));
    // same tags, different account — dropping the account dies here
    expect(key(vis(A, ["t"]))).not.toBe(key(vis(B, ["t"])));
    // an anonymous frame is not GLOBAL_ONLY
    expect(key(vis(null, []))).not.toBe(key(GLOBAL_ONLY));
    // ⚠ AND ONE COLLISION IS LEFT STANDING, NAMED. An anonymous frame and an
    // account whose id is the empty string DO share a key (`account ?? ""`).
    // It is not a leak because the collision has no inhabitant: `""` is refused
    // as an account id at every producer (`assertAccountId` throws) and
    // `instanceVisible`'s account arm requires a NON-EMPTY owner, so no row can
    // ever be owned by it. Asserting they differ would be asserting a fact
    // about a state the system cannot reach.
    expect(key(vis(null, []))).toBe(key(vis("", [])));
    // …and it is STABLE: order and duplicates do not make a new line
    expect(key(vis(A, ["p", "q"]))).toBe(key(vis(A, ["q", "p", "p"])));
    expect(key(GLOBAL_ONLY)).toBe(key(GLOBAL_ONLY));

    const source = readFileSync(join(import.meta.dir, "effect-dispatch.ts"), "utf8");

    // THE DIGEST FUNCTION'S OWN BODY — the part the first cut never read.
    const digestStart = source.indexOf("function visibilityCacheKey");
    expect(digestStart).toBeGreaterThan(-1);
    const digest = source.slice(digestStart, source.indexOf("}", source.indexOf("return `frame", digestStart)));
    // the ACCOUNT is in the key
    expect(digest).toContain("visibility.account");
    // GLOBAL_ONLY gets a key of its own, so a fenced read is never served from
    // a frame-derived line or the reverse
    expect(digest).toContain('return "globalOnly"');
    // and the tags are a SORTED DISTINCT SET, serialised — not ANY join. The
    // brief names `join("")` because it maps `["xy"]` and `["x","y"]` to one
    // key; `join(",")` collides the same way, so the assertion is on the join
    // FAMILY rather than on one spelling.
    expect(digest).toContain("JSON.stringify([...new Set(visibility.tags)].sort())");
    expect(digest).not.toMatch(/visibility\.tags\.join\(/);

    // BOTH caches carry the discriminator: the per-class RULE cache and the
    // per-(class, key) RESULT cache.
    const cacheKeys = [...source.matchAll(/const cacheKey = `([^`]*)`/g)].map((m) => m[1]);
    expect(cacheKeys.length).toBeGreaterThanOrEqual(2);
    expect(cacheKeys[0]).toContain("${typeName}");
    expect(cacheKeys[0]).toContain("${visibilityKey}");
    expect(cacheKeys[1]).toContain("${key}");
    expect(cacheKeys[1]).toContain("${visibilityKey}");
    // the RULES themselves are filtered, not merely the cache key
    expect(source).toContain("if (!instanceVisible(inst, visibility)) continue;");
  }, LONG);

  // §6 pin 15 — SOURCE-MODULE INSTANCES ARE NOT STAMPED, and are isolated by
  // registry IDENTITY instead. Stamping them would hide them from their own
  // authoring session, which evaluates under a bare `registry.evaluateContext()`
  // and therefore derives no account.
  test("pin 15 — a source module's own instances are unstamped and privately held", async () => {
    const { createDispatchRegistry } = await import("./dispatch-registry");
    const { sourceModuleDispatchRegistry } = await import("./authoring/source-module");
    const base = createDispatchRegistry();
    base.defineClass({
      name: "R3aSourceHost",
      params: [{ name: "t" }],
      methods: [{ name: "m", params: [], returns: { $ref: "String" } }],
    });
    const prepared = [{
      module: {
        name: "r3aSource",
        instances: [{ typeName: "R3aSourceHost", args: ["S"], methods: { m: "source" } }],
      },
    }];
    const local = sourceModuleDispatchRegistry(prepared as never, base);
    const rows = local.listInstances("R3aSourceHost");
    expect(rows).toHaveLength(1);
    // UNSTAMPED — no ownership coordinate at all.
    expect(rows[0]!.scope).toBeUndefined();
    // and PRIVATE: the shared base never saw it.
    expect(base.listInstances("R3aSourceHost")).toEqual([]);
  }, LONG);
});
