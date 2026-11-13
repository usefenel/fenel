// ---------------------------------------------------------------------------
// signature-occurrence-ledger.test.ts — the Phase 4+4b signature-use ledger.
//
// SLICE 2b SCOPE: the FAITHFUL raw-body carrier (the S1 proof gate) and the
// P4-D0a enriched frozen route carrier. Joint solving, ground instantiation,
// and the checker lookup are slice-3 additions to this file.
//
// The load-bearing tests here are DIFFERENTIALS against P2's `syntaxFromBody`
// re-lift. The S1 gate rejected that re-lift as execution-unfaithful, so each
// divergence gets a test that pins BOTH sides: what the re-lift produces (the
// wrong answer, asserted so the divergence cannot silently disappear) and what
// the ledger produces (the runtime's actual behaviour).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "bun:test";
import {
  dispatchedValidationUseLedger,
  dispatchedJsonLogicToSyntax,
  type ValidationLedgerRouteInput,
} from "./engine-bodies-dispatch";
import { getSystemRegistry } from "./system-registry";

const AUTHORITATIVE = { bodyHash: "body-hash-1", astAbi: "ast-abi-1", parser: "authoritative" };

const ROUTES: readonly ValidationLedgerRouteInput[] = [
  { name: "f", status: "resolved", targetId: "m:f", kind: "function", candidates: [], diagnostics: [] },
  { name: "g", status: "ambiguous", targetId: "", kind: "function", candidates: ["a:g", "b:g"], diagnostics: [] },
  { name: "h", status: "fenced", targetId: "m:h", kind: "function", candidates: [], diagnostics: ["annotation required"] },
  { name: "Just", status: "resolved", targetId: "@ctor/std/Maybe/Just", kind: "constructor", candidates: [], diagnostics: [] },
];
const ARITIES = [
  { targetId: "m:f", arity: 2 },
  { targetId: "@ctor/std/Maybe/Just", arity: 1 },
];

type Row = {
  site: { callerId: string; role: { $tag: string }; path: readonly Record<string, unknown>[] };
  rawKey: string;
  status: Record<string, unknown> & { $tag: string };
  saturation: Record<string, unknown> & { $tag: string };
  suppliedArgs: number;
  entersTarget: boolean;
  templateOrigin: boolean;
};

function ledger(
  body: unknown,
  paramNames: readonly string[] = [],
  routes: readonly ValidationLedgerRouteInput[] = ROUTES,
  arities: readonly { targetId: string; arity: number }[] = ARITIES,
  provenance = AUTHORITATIVE,
): { tag: string; rows: readonly Row[]; raw: any } {
  const out: any = dispatchedValidationUseLedger({
    callerId: "m:caller", body, paramNames, routes, arities, provenance,
  });
  return { tag: out.$tag, rows: (out._0?.rows ?? []) as readonly Row[], raw: out };
}

/** Render a path as a stable, collision-visible string for assertions. */
const renderPath = (row: Row): string =>
  row.site.path
    .map((segment) => {
      const tag = String(segment["$tag"]);
      const index = segment["index"];
      const key = segment["key"];
      const name = segment["name"];
      return tag
        + (index === undefined ? "" : `[${String(index)}]`)
        + (key === undefined ? "" : `{${String(key)}}`)
        + (name === undefined ? "" : `<${String(name)}>`);
    })
    .join("/");

const roles = (rows: readonly Row[]): string[] => rows.map((row) => row.site.role.$tag);
const keys = (rows: readonly Row[]): string[] => rows.map((row) => row.rawKey);

/** The re-lift's image, as JSON, so a differential can assert both sides. */
const reliftJson = (body: unknown): string =>
  JSON.stringify(dispatchedJsonLogicToSyntax(body));

describe("use ledger — faithfulness differentials against the P2 re-lift", () => {
  it("divergence 1: an array literal invents NO appendItem edges", () => {
    const body = [{ call: ["f", 1, 2] }, 3];

    // The re-lift's image: a left-folded appendItem chain — N-1 signature uses
    // the runtime never performs (`evaluate` maps the array elementwise).
    expect(reliftJson(body)).toContain("appendItem");

    const { rows } = ledger(body);
    expect(keys(rows)).toEqual(["f"]);
    expect(renderPath(rows[0]!)).toBe("VpsSeq[0]");
    expect(rows.some((row) => row.rawKey === "appendItem")).toBe(false);
  });

  it("divergence 2: a template/operator key keeps its RAW runtime spelling", () => {
    const body = { cat: ["a", "b"] };

    // The re-lift rewrites `cat` to the codeName `concat`; the runtime
    // dispatches the raw key with registry precedence.
    expect(reliftJson(body)).toContain("concat");
    expect(reliftJson(body)).not.toContain('"cat"');

    // No frozen route for `cat` ⇒ the registry-less builtin fallback, which is
    // an INTRINSIC rule, never a certificate-bearing function edge.
    const intrinsic = ledger(body).rows;
    expect(keys(intrinsic)).toEqual(["cat"]);
    expect(roles(intrinsic)).toEqual(["VurIntrinsic"]);
    expect(intrinsic[0]!.templateOrigin).toBe(true);
    expect(String(intrinsic[0]!.status["targetId"])).toBe("@intrinsic/builtin-op-native/cat");

    // A REGISTERED `cat` wins over the builtin fallback, exactly as
    // `invokeFunction` does — and the row still carries the raw key.
    const registered = ledger(body, [], [
      ...ROUTES,
      { name: "cat", status: "resolved", targetId: "m:cat", kind: "function", candidates: [], diagnostics: [] },
    ], [...ARITIES, { targetId: "m:cat", arity: 2 }]).rows;
    expect(roles(registered)).toEqual(["VurCall"]);
    expect(registered[0]!.rawKey).toBe("cat");
    expect(String(registered[0]!.status["targetId"])).toBe("m:cat");
  });

  it("divergence 3: lazy structural ops stay intrinsic, never strict calls", () => {
    for (const op of ["and", "or", "if"]) {
      const body = { [op]: [{ call: ["f", 1, 2] }, true] };
      // The re-lift strictifies and/or into SCall.
      if (op !== "if") expect(reliftJson(body)).toContain("SCall");

      const { rows } = ledger(body);
      expect(rows[0]!.site.role.$tag).toBe("VurIntrinsic");
      expect(rows[0]!.rawKey).toBe(op);
      expect(String(rows[0]!.status["targetId"])).toBe(`@intrinsic/known-op/${op}`);
      // the nested call is still ledgered, in raw index order
      expect(renderPath(rows[1]!)).toBe("VpsArg[0]");
      expect(rows[1]!.rawKey).toBe("f");
    }
  });

  it("divergence 4: let/do keep the RAW shape (never re-nested)", () => {
    const body = { do: [{ let: { a: { call: ["f", 1, 2] } } }, { var: "a" }] };
    const { rows } = ledger(body);
    // The `let` item's binding sits under the do item's own VpsSeq segment —
    // the raw nesting, not a reconstructed SLet-scoping-the-rest frame.
    expect(renderPath(rows[0]!)).toBe("VpsSeq[0]/VpsBinding[0]<a>");
    // and the binder threads FORWARD into the following statement
    expect(rows[1]!.status.$tag).toBe("UlsLexical");
    expect(renderPath(rows[1]!)).toBe("VpsSeq[1]");
  });

  it("divergence 5: a `$tag` value is inert (the runtime returns it untouched)", () => {
    const body = { $tag: "Just", _0: { call: ["f", 1, 2] } };
    // The re-lift emits SConstruct and walks the payload.
    expect(reliftJson(body)).toContain("SConstruct");
    expect(ledger(body).rows).toEqual([]);
  });

  it("divergence 6: key-as-fnId is decided by RESOLUTION, not by value shape", () => {
    // A non-array value: the re-lift's shape rule makes this a record; the
    // runtime still dispatches it as a call because the key resolves. (`u` is
    // 1-ary so the single argument is exact — a single-record argument to a
    // wider function fences separately, for the named-argument reason.)
    const body = { u: { var: "p" } };
    expect(reliftJson(body)).toContain("SRecord");

    const routes = [
      ...ROUTES,
      { name: "u", status: "resolved" as const, targetId: "m:u", kind: "function", candidates: [], diagnostics: [] },
    ];
    const resolved = ledger(body, ["p"], routes, [...ARITIES, { targetId: "m:u", arity: 1 }]).rows;
    expect(roles(resolved)).toEqual(["VurCall", "VurLexical"]);
    expect(String(resolved[0]!.status["targetId"])).toBe("m:u");

    // The same shape with an UNRESOLVED key is a single-field record literal.
    const record = ledger({ notAFunction: { var: "p" } }, ["p"]).rows;
    expect(roles(record)).toEqual(["VurLexical"]);
    expect(renderPath(record[0]!)).toBe("VpsField{notAFunction}");
  });
});

describe("use ledger — path identity", () => {
  it("sibling arguments, sequence items, bindings, fields, and arms never collide", () => {
    const body = {
      do: [
        { call: ["f", { call: ["f", 1, 2] }, { call: ["f", 3, 4] }] },
        { a: 1, b: { call: ["f", 5, 6] }, c: { call: ["f", 7, 8] } },
        { match: [{ var: "s" }, { $guard: [{ $bind: "y" }, { call: ["f", 9, 10] }] }, { call: ["f", 11, 12] }] },
      ],
    };
    const { rows } = ledger(body, ["s"]);
    const paths = rows.map(renderPath);
    expect(new Set(paths).size).toBe(paths.length);
    // the guard and the body of ONE arm are different segment KINDS
    expect(paths).toContain("VpsSeq[2]/VpsArmGuard[0]");
    expect(paths).toContain("VpsSeq[2]/VpsArmBody[0]");
    // sibling arguments differ by index, not by accident
    expect(paths).toContain("VpsSeq[0]/VpsArg[0]");
    expect(paths).toContain("VpsSeq[0]/VpsArg[1]");
    // record fields are keyed, so reordering keys cannot alias them
    expect(paths).toContain("VpsSeq[1]/VpsField{b}");
    expect(paths).toContain("VpsSeq[1]/VpsField{c}");
  });

  it("identical targets at different paths are distinct rows", () => {
    const { rows } = ledger({ call: ["f", { call: ["f", 1, 2] }, { call: ["f", 3, 4] }] });
    expect(rows.filter((row) => row.rawKey === "f")).toHaveLength(3);
    expect(new Set(rows.map(renderPath)).size).toBe(3);
  });

  it("rows are invariant under route-table and arity-table permutation", () => {
    const body = { do: [{ call: ["f", 1, 2] }, { call: ["g", 1] }, { construct: ["Just", 1] }] };
    const forward = ledger(body).rows;
    const reversed = ledger(body, [], [...ROUTES].reverse(), [...ARITIES].reverse()).rows;
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
  });
});

describe("use ledger — saturation, locality inputs, and execution entry", () => {
  it("exact / under / over application and the enters-target fact", () => {
    const exact = ledger({ call: ["f", 1, 2] }).rows[0]!;
    expect(exact.saturation.$tag).toBe("VusExact");
    expect(exact.entersTarget).toBe(true);

    const under = ledger({ call: ["f", 1] }).rows[0]!;
    expect(under.saturation.$tag).toBe("VusUnder");
    expect(under.saturation["supplied"]).toBe(1);
    // an underapplication does NOT enter the target: no execution edge
    expect(under.entersTarget).toBe(false);

    const over = ledger({ call: ["f", 1, 2, 3] }).rows[0]!;
    expect(over.saturation.$tag).toBe("VusOver");
    expect(over.entersTarget).toBe(true);
  });

  it("a registered reference consumed as a value is a Reference row that never enters", () => {
    const { rows } = ledger({ var: "f" });
    expect(roles(rows)).toEqual(["VurReference"]);
    expect(rows[0]!.status.$tag).toBe("UlsResolved");
    expect(rows[0]!.entersTarget).toBe(false);
  });

  it("an unknown arity fails closed (never a silent execution edge)", () => {
    const routes = [{ name: "u", status: "resolved" as const, targetId: "m:u", kind: "function", candidates: [], diagnostics: [] }];
    const row = ledger({ call: ["u", 1] }, [], routes, []).rows[0]!;
    expect(row.status.$tag).toBe("UlsResolved");
    expect(row.entersTarget).toBe(false);
    expect(row.saturation.$tag).toBe("VusUnder");
  });
});

describe("use ledger — negative rows are complete results", () => {
  it("missing, ambiguous, and fenced retain their exact payloads", () => {
    const missing = ledger({ call: ["nope", 1] }).rows[0]!;
    expect(missing.status.$tag).toBe("UlsMissing");
    expect(missing.status["spelling"]).toBe("nope");

    const ambiguous = ledger({ call: ["g", 1] }).rows[0]!;
    expect(ambiguous.status.$tag).toBe("UlsAmbiguous");
    expect(ambiguous.status["candidates"]).toEqual(["a:g", "b:g"]);

    const fenced = ledger({ call: ["h", 1] }).rows[0]!;
    expect(fenced.status.$tag).toBe("UlsFenced");
    // a fenced row keeps its EXACT target and diagnostics but is not callable
    expect(fenced.status["targetId"]).toBe("m:h");
    expect(fenced.status["diagnostics"]).toEqual(["annotation required"]);
  });

  it("a negative frozen row is never retried through another resolver", () => {
    // `g` is ambiguous in the frozen frame. Even though a flat lookup would
    // find `a:g`, the ledger publishes the ambiguous negative and stops.
    const row = ledger({ g: [1] }).rows[0]!;
    expect(row.status.$tag).toBe("UlsAmbiguous");
    expect(row.status["targetId"]).toBeUndefined();
  });

  it("qualified capability dispatch is always scope-dependent in this phase", () => {
    const { rows } = ledger({ method: ["Storage", "put", { call: ["f", 1, 2] }] });
    expect(rows[0]!.site.role.$tag).toBe("VurCapabilityDispatch");
    expect(rows[0]!.status.$tag).toBe("UlsDynamicOrReflective");
    expect(rows[0]!.entersTarget).toBe(false);
    // the arguments are still ledgered — no evidence-consuming use disappears
    expect(rows[1]!.rawKey).toBe("f");
  });

  it("a raw-rule intrinsic fences on its derived data context, not on a callable", () => {
    // `arrayOp`/`reduceOp` evaluate the RULE AST once per element with the
    // item merged over `data` — they never invoke a callable, so a `{fn: …}`
    // rule argument builds a closure that is never entered. The fence exists
    // for the real reason: a bare `{var}` inside the rule may bind to an ITEM
    // FIELD, so frozen-resolving it would mint a reference the runtime never
    // reads.
    for (const op of ["map", "filter", "reduce", "all", "some", "none"]) {
      const { rows } = ledger({ [op]: [{ var: "xs" }, { var: "f" }] }, ["xs"]);
      expect(rows[0]!.status.$tag).toBe("UlsDynamicOrReflective");
      expect(rows[0]!.rawKey).toBe(op);
      expect(rows[0]!.entersTarget).toBe(false);
      expect(String(rows[0]!.status["detail"])).toContain("derived per-item data context");
    }
    // Nested CALLS inside the rule are real dispatches and stay ledgered.
    const nested = ledger({ map: [{ var: "xs" }, { call: ["f", 1, 2] }] }, ["xs"]).rows;
    expect(nested.some((row) => row.rawKey === "f" && row.status.$tag === "UlsResolved")).toBe(true);
    // A non-rule eager intrinsic still resolves as an exact rule.
    const eager = ledger({ length: [{ var: "xs" }] }, ["xs"]).rows[0]!;
    expect(eager.site.role.$tag).toBe("VurIntrinsic");
    expect(eager.status.$tag).toBe("UlsResolved");
  });

  it("an overapplication RETAINS its resolved target, and its demand survives", () => {
    // `invokeFunction` eta-applies leftover arguments to a callable RESULT, so
    // `f x y z` where `f` is 2-ary enters a second target this walk never saw.
    //
    // slice 3h: degrading the row to `UlsDynamicOrReflective` discarded the
    // route, the target and the supplied count in the same step that named the
    // demand — so the checker's stagewise rule had nothing left to classify. The
    // row now RETAINS the resolved target; the demand survives as the
    // `VrpCertifiedEtaStage` pending the carrier re-raises from the row's own
    // saturation (`vckRowNeedsEtaStage`), and nothing became admissible: the
    // classifier still refuses the occurrence by name.
    const over = ledger({ call: ["f", 1, 2, 3] }).rows[0]!;
    expect(over.saturation.$tag).toBe("VusOver");
    expect(over.status.$tag).toBe("UlsResolved");
    expect(over.status["targetId"]).toBe("m:f");
    expect(over.suppliedArgs).toBe(3);
  });

  it("an UNRESOLVED overapplication degrades exactly as before", () => {
    // There is no target to retain, and `vlgRouteStatus` would publish the
    // negative row WITHOUT the eta-tail detail, losing the reason entirely.
    const over = ledger({ call: ["ghost", 1, 2, 3] }).rows[0]!;
    expect(over.status.$tag).toBe("UlsMissing");
  });

  it("a single-record application fences: named arguments expand before the partial check", () => {
    // The runtime expands `{a, b}` to positional args BEFORE deciding partial
    // application, so this ENTERS a 2-ary `f` even though the raw tail is 1.
    // Counting raw arguments would publish entersTarget=false for a call that
    // really executes.
    const named = ledger({ call: ["f", { a: 1, b: 2 }] }).rows[0]!;
    expect(named.status.$tag).toBe("UlsDynamicOrReflective");
    expect(String(named.status["detail"])).toContain("named-argument");
    // A single NON-record argument is an ordinary partial and stays resolved.
    const partial = ledger({ call: ["f", 1] }).rows[0]!;
    expect(partial.status.$tag).toBe("UlsResolved");
    expect(partial.saturation.$tag).toBe("VusUnder");
  });

  it("the dotted scan is UTF-16-domain-correct (astral names)", () => {
    // `length` counts code POINTS while `slice` indexes UTF-16 code UNITS, so
    // bounding the scan by `length` missed the separator in an astral-prefixed
    // path — silently restoring a positive frozen-frame resolution for a
    // data-dependent spelling.
    const astral = "\u{1F600}\u{1F600}.f";
    const routes = [
      ...ROUTES,
      { name: astral, status: "resolved" as const, targetId: "m:astral", kind: "function", candidates: [], diagnostics: [] },
    ];
    expect(ledger({ var: astral }, [], routes).rows[0]!.status.$tag)
      .toBe("UlsDynamicOrReflective");
  });

  it("constructor uses do NOT inherit the function-application fences", () => {
    // `construct` has no eta path (extra arguments become extra positional
    // fields) and its named-record form is ordinary construction, not the
    // arity-changing reorder the partial check sees.
    const named = ledger({ construct: ["Just", { a: 1, b: 2 }] }).rows[0]!;
    expect(named.site.role.$tag).toBe("VurConstructor");
    expect(named.status.$tag).toBe("UlsResolved");

    const over = ledger({ construct: ["Just", 1, 2] }).rows[0]!;
    expect(over.site.role.$tag).toBe("VurConstructor");
    expect(over.status.$tag).toBe("UlsResolved");
  });

  it("the named-argument fence mirrors the runtime's preconditions", () => {
    // `maybeReorderNamedArgs` reorders only a non-empty plain record with no
    // `$`-prefixed key. Everything else is an ordinary one-argument partial
    // and must stay resolved — fencing every object-shaped argument would
    // fence essentially every curried call.
    for (const arg of [{ $ref: "m:g" }, { var: "p" }, { fn: ["x", { var: "x" }] }, {}]) {
      const row = ledger({ call: ["f", arg] }, ["p"]).rows[0]!;
      expect(row.status.$tag).toBe("UlsResolved");
      expect(row.saturation.$tag).toBe("VusUnder");
    }
    // ...while a genuine multi-key plain record still fences.
    expect(ledger({ call: ["f", { a: 1, b: 2 }] }).rows[0]!.status.$tag)
      .toBe("UlsDynamicOrReflective");
  });

  it("a flat lambda with a non-literal parameter fences instead of mis-binding", () => {
    // fnOp string-coerces a flat parameter, so `1` binds the name "1". This
    // walk cannot mint that spelling; dropping it would leave `{var:"1"}`
    // resolving through the frozen frame to an unrelated target.
    const { rows } = ledger({ fn: [1, { call: [{ var: "1" }] }] });
    expect(rows[0]!.status.$tag).toBe("UlsDynamicOrReflective");
    expect(rows[0]!.rawKey).toBe("fn");
  });

  it("`ann` evaluates only its first argument", () => {
    const { rows } = ledger({ ann: [{ call: ["f", 1, 2] }, { call: ["f", 3, 4] }] });
    expect(rows).toHaveLength(1);
    expect(renderPath(rows[0]!)).toBe("VpsArg[0]");
  });

  it("a lexically bound callee applied dynamically fences instead of vanishing", () => {
    const { rows } = ledger({ call: [{ var: "cb" }, 1] }, ["cb"]);
    expect(rows[0]!.status.$tag).toBe("UlsDynamicOrReflective");
    expect(rows[0]!.entersTarget).toBe(false);
  });
});

describe("use ledger — lexical scope", () => {
  it("parameters, let binders, lambda params, and pattern binds all bind", () => {
    const param = ledger({ var: "p" }, ["p"]).rows[0]!;
    expect(param.status.$tag).toBe("UlsLexical");

    const lambda = ledger({ fn: ["q", { var: "q" }] }).rows[0]!;
    expect(lambda.status.$tag).toBe("UlsLexical");
    expect(renderPath(lambda)).toBe("VpsLambdaBody");

    const arm = ledger({ match: [{ var: "s" }, { $bind: "bound" }, { var: "bound" }] }, ["s"]).rows;
    expect(arm[1]!.status.$tag).toBe("UlsLexical");
    expect(renderPath(arm[1]!)).toBe("VpsArmBody[0]");
  });

  it("a dotted var path binds against its ROOT, not the whole spelling", () => {
    // `resolveVar` projects a field off a bound value. Matching the full
    // spelling would send every field access to the frozen frame and produce a
    // spurious `missing` fence on the most common shape in the corpus.
    const projected = ledger({ var: "bot.token" }, ["bot"]).rows[0]!;
    expect(projected.status.$tag).toBe("UlsLexical");
    expect(projected.site.role.$tag).toBe("VurLexical");

    // A deep path off the same binder is still lexical...
    expect(ledger({ var: "bot.config.url" }, ["bot"]).rows[0]!.status.$tag).toBe("UlsLexical");
    // ...but a name that merely SHARES a prefix is not bound by it.
    expect(ledger({ var: "botanist" }, ["bot"]).rows[0]!.status.$tag).toBe("UlsMissing");
    // and a genuinely unbound dotted spelling is DATA-DEPENDENT, never
    // frozen-resolved (resolveVar only falls back to the registry for a
    // single path segment).
    expect(ledger({ var: "other.thing" }, ["bot"]).rows[0]!.status.$tag)
      .toBe("UlsDynamicOrReflective");
  });

  it("a lexical binder shadows a registered spelling", () => {
    // `f` is a registered route, but a parameter named `f` shadows it.
    const shadowed = ledger({ var: "f" }, ["f"]).rows[0]!;
    expect(shadowed.status.$tag).toBe("UlsLexical");
    expect(shadowed.site.role.$tag).toBe("VurLexical");
  });

  it("`$bind` is terminal — a sibling field never invents an extra binder", () => {
    // matchPattern returns the binding immediately and never visits siblings.
    // An invented binder is not harmless: it SHADOWS a registered spelling and
    // erases that occurrence's evidence edge.
    const { rows } = ledger(
      { match: [0, { $bind: "x", nested: { $bind: "f" } }, { var: "f" }] },
    );
    const armBody = rows.find((row) => renderPath(row) === "VpsArmBody[0]")!;
    expect(armBody.status.$tag).toBe("UlsResolved");
    expect(armBody.site.role.$tag).toBe("VurReference");
  });

  it("a `do` item binds by `let` PRESENCE, not by being single-key", () => {
    // The runtime's test is `"let" in expr`; sibling fields are ignored.
    // Requiring a single key missed the binding, so a later `{var: x}` fell
    // through to the frozen frame and resolved to a different target.
    const { rows } = ledger(
      { do: [{ let: { x: 1 }, ignored: 0 }, { var: "x" }] },
      [],
      [...ROUTES, { name: "x", status: "resolved" as const, targetId: "m:x", kind: "function", candidates: [], diagnostics: [] }],
    );
    const last = rows[rows.length - 1]!;
    expect(last.status.$tag).toBe("UlsLexical");
  });

  it("the canonical `{fn: [[params], body, …]}` grammar picks the right body", () => {
    // fnOp accepts an array first argument as the parameter list and args[1]
    // as the body, ignoring trailing items. Implementing only the flat form
    // selected the trailing item as the body and lost the real occurrences.
    const { rows } = ledger({ fn: [["x"], { call: ["f", { var: "x" }, 2] }, 0] });
    expect(rows.some((row) => row.rawKey === "f" && row.status.$tag === "UlsResolved")).toBe(true);
    expect(rows.some((row) => row.rawKey === "x" && row.status.$tag === "UlsLexical")).toBe(true);
  });

  it("an unbound DOTTED variable is data-dependent, never frozen-resolved", () => {
    // resolveVar walks a dotted path through the data context and only falls
    // back to the registry for a SINGLE segment, so frozen-resolving `M.f`
    // would mint a positive reference to a target the runtime never reads.
    const routes = [
      ...ROUTES,
      { name: "M.f", status: "resolved" as const, targetId: "m:Mf", kind: "function", candidates: [], diagnostics: [] },
    ];
    const asValue = ledger({ var: "M.f" }, [], routes).rows[0]!;
    expect(asValue.status.$tag).toBe("UlsDynamicOrReflective");
    const asCallee = ledger({ call: [{ var: "M.f" }] }, [], routes).rows[0]!;
    expect(asCallee.status.$tag).toBe("UlsDynamicOrReflective");
    expect(asCallee.entersTarget).toBe(false);
  });

  it("a `$`-keyed constructor payload still walks its field values", () => {
    // The runtime's useNamed test is "every key is a declared field", so a
    // constructor declaring a `$`-spelled field takes the NAMED branch and
    // evaluates each value. Treating the payload as an inert `$` marker
    // dropped those occurrences.
    const { rows } = ledger({ construct: ["Just", { $meta: 0, x: { call: ["f", 1, 2] } }] });
    expect(rows.some((row) => row.rawKey === "f" && row.status.$tag === "UlsResolved")).toBe(true);
  });

  it("patterns contribute binders but never use rows", () => {
    // The pattern's payload looks like a call, but `matchPattern` is
    // structural — the runtime never evaluates it, so it is not a use.
    const { rows } = ledger(
      { match: [{ var: "s" }, { $tag: "Just", _0: { $bind: "y" } }, { var: "y" }] },
      ["s"],
    );
    expect(rows.map(renderPath)).toEqual(["VpsScrutinee", "VpsArmBody[0]"]);
    expect(rows[1]!.status.$tag).toBe("UlsLexical");
  });
});

describe("use ledger — parser-representation stability", () => {
  it("a non-authoritative representation fences before any row is minted", () => {
    const out = ledger({ call: ["f", 1, 2] }, [], ROUTES, ARITIES, {
      bodyHash: "h", astAbi: "abi", parser: "ts-fallback",
    });
    expect(out.tag).toBe("LgoFenced");
    expect(out.raw._0.$tag).toBe("RsnParserRepresentationDivergence");
    expect(out.rows).toEqual([]);
  });

  it("an unknown AST ABI or absent body hash also fences", () => {
    expect(ledger(1, [], ROUTES, ARITIES, { bodyHash: "h", astAbi: "", parser: "authoritative" }).tag)
      .toBe("LgoFenced");
    expect(ledger(1, [], ROUTES, ARITIES, { bodyHash: "", astAbi: "abi", parser: "authoritative" }).tag)
      .toBe("LgoFenced");
  });
});

describe("P4-D0a — the enriched frozen route carrier", () => {
  it("publishes the P2 projection byte-identically as the route-parity subset", () => {
    const registry: any = getSystemRegistry();
    const subset = (row: any): unknown => {
      const projected: Record<string, unknown> = {
        name: row.name, status: row.status, targetId: row.targetId,
      };
      if (row.verdict !== undefined) projected["verdict"] = row.verdict;
      if (row.diagnostics !== undefined) projected["diagnostics"] = row.diagnostics;
      return projected;
    };
    for (const projection of ["listSourceFunctionResolutions", "listSourceConstructorResolutions"] as const) {
      const companion = projection === "listSourceFunctionResolutions"
        ? "listSourceFunctionRouteEvidence"
        : "listSourceConstructorRouteEvidence";
      const base = registry[projection]("engine").map(subset);
      const enriched = registry[companion]("engine").map(subset);
      expect(JSON.stringify(enriched)).toBe(JSON.stringify(base));
    }
  }, 900_000);

  it("retains complete sorted candidates for ambiguous rows and nothing else", () => {
    const registry: any = getSystemRegistry();
    const rows = registry.listSourceFunctionRouteEvidence("engine");
    let ambiguous = 0;
    for (const row of rows) {
      if (row.status === "ambiguous") {
        ambiguous += 1;
        expect(row.candidateTargetIds.length).toBeGreaterThan(1);
        expect([...row.candidateTargetIds].sort()).toEqual([...row.candidateTargetIds]);
      } else {
        // A resolved row's single target lives in targetId; carrying a
        // candidate set there would invite a second resolution path.
        expect(row.candidateTargetIds).toEqual([]);
      }
    }
    expect(ambiguous).toBeGreaterThan(0);
  }, 900_000);

  it("declares a closed resolution kind on every row", () => {
    const registry: any = getSystemRegistry();
    for (const row of registry.listSourceFunctionRouteEvidence("engine")) {
      expect(["function", "constructor", "capability"]).toContain(row.kind);
    }
    for (const row of registry.listSourceConstructorRouteEvidence("engine")) {
      expect(row.kind).toBe("constructor");
    }
  }, 900_000);

  it("is deeply immutable at egress", () => {
    const registry: any = getSystemRegistry();
    const rows = registry.listSourceFunctionRouteEvidence("engine");
    expect(Object.isFrozen(rows)).toBe(true);
    expect(Object.isFrozen(rows[0])).toBe(true);
    expect(Object.isFrozen(rows[0].candidateTargetIds)).toBe(true);
  }, 900_000);
});
