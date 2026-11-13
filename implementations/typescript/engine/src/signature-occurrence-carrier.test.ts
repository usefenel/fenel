// ---------------------------------------------------------------------------
// signature-occurrence-carrier.test.ts — the Phase 4+4b OCCURRENCE-KEYED
// ANNOTATED CARRIER (slice 3f; the first half of P4-D3).
//
// The ledger answers what evidence a body DEMANDS and deliberately OVER-reports.
// This carrier is the IDENTITY projection over the same rows, and these tests
// pin the property that projection exists for:
//
//   following raw semantic occurrence P through the carrier reaches exactly the
//   node whose role, spelling, target and child topology agree with P's ledger
//   row — and one runtime occurrence issues AT MOST ONE identity.
//
// LAYER 1 — identity and correspondence over the shapes D3 needs.
// LAYER 2 — the closed refusals (flat-route disagreement, wire projection,
//           whole-ledger readiness, the constructor alias).
// LAYER 3 — the dormant preflight/lookup, with synthetic per-occurrence arrows,
//           which is what makes the slice testable with no solve behind it.
// LAYER 4 — the inertness TRIPWIRES (called tripwires, not proofs).
// ---------------------------------------------------------------------------

import { beforeAll, describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  dispatchEngineBody,
  dispatchedValidationCarrier,
  dispatchedValidationPreflight,
  dispatchedValidationOccurrenceLookup,
  dispatchedValidationCarrierContract,
  type ValidationLedgerRouteInput,
} from "./engine-bodies-dispatch";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..", "..");
const read = (relative: string): string => readFileSync(join(REPO, relative), "utf8");

/**
 * The CODE of a `.fenel` source, with comment lines and `@description` /
 * `@label` directive text removed. A textual ban has to scan what executes:
 * scanning prose makes a file fail for DOCUMENTING the hazard it avoids, which
 * is precisely backwards.
 */
const readCode = (relative: string): string =>
  read(relative)
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("--") && !trimmed.startsWith("@");
    })
    .join("\n");

const AUTHORITATIVE = { bodyHash: "body-hash-1", astAbi: "ast-abi-1", parser: "authoritative" };

const route = (
  name: string,
  targetId: string,
  kind = "function",
  status: ValidationLedgerRouteInput["status"] = "resolved",
): ValidationLedgerRouteInput => ({ name, status, targetId, kind, candidates: [], diagnostics: [] });

const ROUTES: ValidationLedgerRouteInput[] = [
  route("f", "m:f"),
  route("g", "m:g"),
  route("R", "@ctor/m/R/R", "constructor"),
];
const ARITIES = [
  { targetId: "m:f", arity: 1 },
  { targetId: "m:g", arity: 1 },
  { targetId: "@ctor/m/R/R", arity: 1 },
];
const WIRES = [{ source: "R", wire: "R" }];

type Carrier = {
  callerId: string;
  root: Record<string, unknown>;
  snapshot: Record<string, unknown>;
  readiness: { $tag: string };
  identities: Array<{ callerId: string; role: string; path: Array<Record<string, unknown>>; targetId: string; kind: string }>;
  fences: Array<{ $tag: string }>;
};

/** The stand-in inputs digest this isolation suite binds every carrier to. */
const CARRIER_INPUTS_HASH = { domain: "fenel.validation.inputs.v1", hex: "3g-carrier-suite" };

function carry(
  body: unknown,
  over: Partial<{
    routes: ValidationLedgerRouteInput[];
    flat: ValidationLedgerRouteInput[];
    wires: { source: string; wire: string }[];
    params: string[];
    provenance: typeof AUTHORITATIVE;
  }> = {},
): { tag: string; carrier?: Carrier; reason?: Record<string, unknown> } {
  const out = dispatchedValidationCarrier({
    callerId: "m:caller",
    body,
    paramNames: over.params ?? [],
    routes: over.routes ?? ROUTES,
    arities: ARITIES,
    provenance: over.provenance ?? AUTHORITATIVE,
    flatRoutes: over.flat ?? over.routes ?? ROUTES,
    wireProjections: over.wires ?? WIRES,
    // slice 3g — the combined INPUTS digest is now part of the snapshot, so the
    // carrier binds the tables it was built from and not merely the body. This
    // suite exercises the carrier in isolation, so it passes a fixed stand-in;
    // the real digest is computed inside `vteValidate`, which is the only place
    // it can be computed without taking the caller's word for it.
    inputsHash: CARRIER_INPUTS_HASH,
  }) as { $tag: string; carrier?: Carrier; reason?: Record<string, unknown> };
  return { tag: out.$tag, carrier: out.carrier, reason: out.reason };
}

/** A stable, collision-visible rendering of an occurrence identity's path. */
const renderPath = (path: Array<Record<string, unknown>>): string =>
  path
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

const paths = (carrier: Carrier): string[] => carrier.identities.map((id) => renderPath(id.path));

const SYNTHETIC_ARROW = { $tag: "SeArrow", params: [], returns: { $tag: "SeAll" } };
const SYNTHETIC_HASH = { $tag: "ValidationHash", domain: "fenel.validation.scheme.v1", hex: "00" };

/** One synthetic per-occurrence arrow per live identity — no solve behind it. */
const tableFor = (carrier: Carrier) =>
  carrier.identities.map((useId) => ({
    useId,
    snapshot: carrier.snapshot,
    schemeHash: SYNTHETIC_HASH,
    instance: SYNTHETIC_ARROW,
  }));

// ---------------------------------------------------------------------------
// LAYER 1 — occurrence identity and the correspondence property
// ---------------------------------------------------------------------------

// Engine init happens on the first dispatch and costs seconds; paid here so no
// individual test is really measuring boot time (the first test in this file
// was doing exactly that and started timing out when the engine union grew).
beforeAll(() => {
  dispatchEngineBody("engine:vcaCarrierVersion", [0]);
});

describe("carrier — occurrence functional identity", () => {
  it("two uses of the SAME function in one body receive DIFFERENT identities", () => {
    const { tag, carrier } = carry([{ call: ["f", 1] }, { call: ["f", 2] }]);
    expect(tag).toBe("VcoCarrier");
    expect(carrier!.identities.length).toBe(2);
    // Same caller, same role, same target — the PATH is what separates them,
    // which is exactly what P4-D3's per-use fresh meta namespace needs.
    expect(carrier!.identities.map((id) => id.targetId)).toEqual(["m:f", "m:f"]);
    expect(paths(carrier!)).toEqual(["VpsSeq[0]", "VpsSeq[1]"]);
    expect(new Set(paths(carrier!)).size).toBe(2);
  });

  it("an identity is a semantic record — caller, role, typed path, target, kind", () => {
    const { carrier } = carry({ call: ["f", 1] });
    const [id] = carrier!.identities;
    expect(id!.callerId).toBe("m:caller");
    expect(id!.role).toBe("VurCall");
    expect(id!.targetId).toBe("m:f");
    expect(id!.kind).toBe("function");
    // Never a rendered surrogate: the path is the typed segment list itself.
    expect(Array.isArray(id!.path)).toBe(true);
    expect(JSON.stringify(id!)).not.toContain("[object Object]");
  });

  it("an intrinsic rule is identified as an intrinsic, not a function edge", () => {
    const { carrier } = carry({ add: [1, 2] }, { flat: [] });
    expect(carrier!.identities.length).toBe(1);
    expect(carrier!.identities[0]!.role).toBe("VurIntrinsic");
    expect(carrier!.identities[0]!.kind).toBe("intrinsic");
  });

  it("a lexical binding is a POSITIVE occurrence, and the ledger is then not yet ready", () => {
    const { carrier } = carry({ var: "x" }, { params: ["x"] });
    expect(carrier!.identities.length).toBe(1);
    expect(carrier!.identities[0]!.role).toBe("VurLexical");
    // slice 3h — THE LEXICAL SPLIT. An ordinary lexical READ is no longer a
    // typed pending: the binder identity IS the evidence and the checker's Γ
    // discipline discharges it, so the ledger is structurally READY. What still
    // pends is the APPLIED lexical callable, a disjoint status.
    expect(carrier!.readiness.$tag).toBe("VrdStructurallyReady");
    expect(carrier!.fences.length).toBe(0);
  });

  it("a registered reference consumed as a VALUE is identified as a reference", () => {
    const { carrier } = carry({ var: "f" });
    expect(carrier!.identities.length).toBe(1);
    expect(carrier!.identities[0]!.role).toBe("VurReference");
    expect(carrier!.identities[0]!.targetId).toBe("m:f");
  });

  it("nested occurrences do not collide, and every node path is distinct", () => {
    const { tag, carrier } = carry({ call: ["f", { call: ["g", 1] }] });
    expect(tag).toBe("VcoCarrier");
    expect(paths(carrier!).sort()).toEqual(["", "VpsArg[0]"].sort());
    expect(new Set(paths(carrier!)).size).toBe(carrier!.identities.length);
  });

  it("two occurrences that would COLLIDE if a path segment were dropped stay separate", () => {
    // Both calls to `g` sit under the same parent; only the argument INDEX
    // separates them. A projection that dropped the index would merge them.
    const { carrier } = carry({ call: ["f", { call: ["g", 1] }, { call: ["g", 2] }] });
    const gPaths = carrier!.identities
      .filter((id) => id.targetId === "m:g")
      .map((id) => renderPath(id.path));
    expect(gPaths.length).toBe(2);
    expect(new Set(gPaths).size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// LAYER 2 — the closed refusals
// ---------------------------------------------------------------------------

describe("carrier — the closed refusals", () => {
  it("a FROZEN/FLAT target disagreement fences before the occurrence can supply evidence", () => {
    // The 2b round-1 finding: `A:f` declared locally, `B:g` code-named `f`.
    // Both answers are POSITIVE and they differ.
    const { carrier } = carry({ call: ["f", 1] }, {
      flat: [route("f", "other:g")],
    });
    expect(carrier!.identities.length).toBe(0);
    expect(carrier!.fences.length).toBe(1);
  });

  it("an ABSENT flat route is a fence — absence of a second opinion is not agreement", () => {
    const { carrier } = carry({ call: ["f", 1] }, { flat: [] });
    expect(carrier!.identities.length).toBe(0);
    expect(carrier!.fences.length).toBe(1);
  });

  it("a KNOWN_OP is EXEMPT from flat agreement — it never consults the registry", () => {
    // `KNOWN_OPS` dispatches structurally BEFORE any registry lookup, so
    // `{and:[…]}` stays the language rule even when the flat registry also
    // carries `and`. Inverting this class fenced correct bodies.
    const { carrier } = carry({ and: [true, false] }, { flat: [route("and", "m:and")] });
    expect(carrier!.identities.length).toBe(1);
    expect(carrier!.fences.length).toBe(0);
  });

  it("a builtin-op-native FALLBACK row is INVERTED — a flat entry contradicts the miss", () => {
    // `add` is not a KNOWN_OP: it reaches the native only after `ctx.getFunction`
    // misses, so a flat table that knows the spelling really does disagree.
    const { carrier } = carry({ add: [1, 2] }, { flat: [route("add", "m:add")] });
    expect(carrier!.identities.length).toBe(0);
    expect(carrier!.fences.length).toBe(1);
  });

  it("a registered keyed call takes the REGISTERED branch, not the builtin one", () => {
    // The environment must carry the frozen routes: without them the carrier
    // silently routed every registered keyed call to the builtin-intrinsic
    // branch, and every reconciliation check still passed.
    const { carrier } = carry({ g: [1] });
    expect(carrier!.identities.length).toBe(1);
    expect(carrier!.identities[0]!.role).toBe("VurCall");
    expect(carrier!.identities[0]!.targetId).toBe("m:g");
  });

  it("a constructor with NO authoritative wire projection fences, fail-closed", () => {
    const { carrier } = carry({ construct: ["R", { x: 1 }] }, { wires: [] });
    expect(carrier!.identities.length).toBe(0);
    expect(carrier!.fences.length).toBe(1);
  });

  it("a source constructor ALIASED onto a Boolean wire fences", () => {
    // The runtime projects through `_constructorWireNames` and only then applies
    // the Boolean fast path, so this evaluates to a NATIVE boolean.
    const { carrier } = carry({ construct: ["R", { x: 1 }] }, {
      wires: [{ source: "R", wire: "True" }],
    });
    expect(carrier!.identities.length).toBe(0);
    expect(carrier!.fences.length).toBe(1);
  });

  it("BOTH constructor payload readings alias — neither issues an identity beneath it", () => {
    // The 3e result-review counterexample: the positional reading sees an `ann`
    // form and walks argument 0 only, while the runtime's NAMED branch evaluates
    // the whole field value and reaches `g`. Neither reading may be chosen, so
    // neither may issue an identity.
    const { carrier } = carry({ construct: ["R", { ann: [0, { call: ["g", 1] }] }] });
    const targets = carrier!.identities.map((id) => id.targetId);
    expect(targets).toContain("@ctor/m/R/R");
    expect(targets).not.toContain("m:g");
    expect(carrier!.fences.length).toBeGreaterThan(0);
  });

  it("a PLAIN-RECORD payload aliases too — the coincidence shortcut was tautological", () => {
    // `{construct:["R",{x:…,y:0}]}`: the withdrawn shortcut declared the two
    // readings coincident (a test that always holds, because `namedFields` is
    // built from those very fields) and issued the sole live identity on the
    // NAMED path — the branch the runtime does not take when `R`'s declared
    // fields are not `x`/`y`. Deciding the reading needs the registered field
    // table, which is slice 3g's; until then both readings alias.
    const { carrier } = carry({ construct: ["R", { x: { call: ["g", 1] }, y: 0 }] });
    const targets = carrier!.identities.map((id) => id.targetId);
    expect(targets).toContain("@ctor/m/R/R");
    expect(targets).not.toContain("m:g");
    expect(carrier!.fences.length).toBeGreaterThan(0);
  });

  it("a Boolean ALIAS fences at every arity — the projected tag is not the source name", () => {
    // Source `R` mapping to wire `True` disagrees with the carrier's own
    // `VcpConstruct { ctor = "R" }` at any arity, so the alias branch fires
    // before arity is even consulted.
    const bool = [{ source: "R", wire: "True" }];
    expect(carry({ construct: ["R", 1] }, { wires: bool }).carrier!.identities.length).toBe(0);
    expect(carry({ construct: ["R", 1, 2] }, { wires: bool }).carrier!.identities.length).toBe(0);
  });

  it("a NON-aliased Boolean wire fences at ZERO PAYLOAD only", () => {
    // The runtime's native-Boolean shortcut fires when the construct carries
    // NOTHING but the tag — json-logic.ts tests `args.length === 1` COUNTING
    // the tag — so `{construct:["True"]}` evaluates to a native boolean (no
    // tagged value exists for a field-wire reading, and an identity would
    // claim a construction the runtime never performs), while ANY payload
    // builds an ordinary tagged value the carrier handles normally.
    // (Fable audit 2026-07-31 — the landed pin asserted the tag-inclusive
    // count against the carrier's tag-exclusive payload argument and was
    // wrong in both directions.)
    const routes = [...ROUTES, route("True", "@ctor/m/Bool/True", "constructor")];
    const wires = [{ source: "True", wire: "True" }];
    const zero = carry({ construct: ["True"] }, { routes, wires });
    expect(zero.carrier!.identities.length).toBe(0);
    expect(zero.carrier!.fences.length).toBe(1);
    const one = carry({ construct: ["True", 1] }, { routes, wires });
    expect(one.carrier!.identities.length).toBe(1);
    const two = carry({ construct: ["True", 1, 2] }, { routes, wires });
    expect(two.carrier!.identities.length).toBe(1);
  });

  it("an AMBIGUOUS wire table refuses rather than taking the first entry", () => {
    const { carrier } = carry({ construct: ["R", { x: 1 }] }, {
      wires: [{ source: "R", wire: "R" }, { source: "R", wire: "Other" }],
    });
    expect(carrier!.identities.length).toBe(0);
    expect(carrier!.fences.length).toBe(1);
  });

  it("an UNSUPPORTED projection may never issue a live identity, whichever arm built it", () => {
    // `{missing:["x"]}` gets a resolved known-op row and an unsupported
    // projection; before the central invariant it published a live identity.
    const { carrier } = carry({ missing: ["x"] }, { flat: [] });
    expect(carrier!.identities.length).toBe(0);
    expect(carrier!.fences.length).toBe(1);
  });

  it("a missing spelling is a FINAL fence on the whole ledger", () => {
    const { carrier } = carry({ call: ["nope", 1] });
    expect(carrier!.readiness.$tag).toBe("VrdFinalFence");
    expect(carrier!.identities.length).toBe(0);
  });

  it("an ambiguous spelling is a FINAL fence", () => {
    const { carrier } = carry({ call: ["amb", 1] }, {
      routes: [...ROUTES, {
        name: "amb", status: "ambiguous", targetId: "", kind: "function",
        candidates: ["a:amb", "b:amb"], diagnostics: [],
      }],
    });
    expect(carrier!.readiness.$tag).toBe("VrdFinalFence");
  });

  it("a divergent parser representation fences BEFORE any node is built", () => {
    const { tag, carrier, reason } = carry({ call: ["f", 1] }, {
      provenance: { bodyHash: "b", astAbi: "a", parser: "some-other-parser" },
    });
    expect(tag).toBe("VcoFenced");
    expect(carrier).toBeUndefined();
    expect(String(reason?.["$tag"])).toBe("RsnParserRepresentationDivergence");
  });
});

// ---------------------------------------------------------------------------
// LAYER 3 — the DORMANT preflight and lookup
// ---------------------------------------------------------------------------

describe("carrier — the dormant, non-authoritative occurrence table", () => {
  it("a complete synthetic per-occurrence table passes preflight", () => {
    const { carrier } = carry([{ call: ["f", 1] }, { call: ["f", 2] }]);
    const out = dispatchedValidationPreflight(carrier!, tableFor(carrier!)) as { $tag: string };
    expect(out.$tag).toBe("VckReady");
  });

  it("a MISSING entry refuses — the table and the identities must be in bijection", () => {
    const { carrier } = carry([{ call: ["f", 1] }, { call: ["f", 2] }]);
    const out = dispatchedValidationPreflight(carrier!, tableFor(carrier!).slice(1)) as { $tag: string };
    expect(out.$tag).toBe("VckRefused");
  });

  it("an EXTRA entry refuses just as a missing one does", () => {
    const { carrier } = carry({ call: ["f", 1] });
    const table = tableFor(carrier!);
    const extra = [...table, { ...table[0]!, useId: { ...table[0]!.useId, targetId: "m:g" } }];
    const out = dispatchedValidationPreflight(carrier!, extra) as { $tag: string };
    expect(out.$tag).toBe("VckRefused");
  });

  it("a DUPLICATE occurrence key refuses", () => {
    const { carrier } = carry({ call: ["f", 1] });
    const table = tableFor(carrier!);
    const dup = [table[0]!, table[0]!];
    const out = dispatchedValidationPreflight(carrier!, dup) as { $tag: string };
    expect(out.$tag).toBe("VckRefused");
  });

  it("a table built against a DIFFERENT body is stale and refuses", () => {
    const { carrier } = carry({ call: ["f", 1] });
    const stale = tableFor(carrier!).map((entry) => ({
      ...entry,
      snapshot: { ...(entry.snapshot as Record<string, unknown>), bodyHash: "a-different-body" },
    }));
    const out = dispatchedValidationPreflight(carrier!, stale) as { $tag: string };
    expect(out.$tag).toBe("VckRefused");
  });

  it("a NOT-YET-READY ledger refuses even with a complete table", () => {
    // slice 3h: an ordinary lexical READ is ready now, so the pending demand
    // this test needs is the APPLIED lexical callable — `VrpExactOrigin`, still
    // 3i's and still unmet.
    const { carrier } = carry({ call: [{ var: "x" }, 1] }, { params: ["x"] });
    expect(carrier!.readiness.$tag).toBe("VrdNeedsRefinement");
    const out = dispatchedValidationPreflight(carrier!, tableFor(carrier!)) as { $tag: string };
    expect(out.$tag).toBe("VckRefused");
  });

  it("a carrier carrying ANY fence refuses", () => {
    const { carrier } = carry({ call: ["f", 1] }, { flat: [] });
    const out = dispatchedValidationPreflight(carrier!, tableFor(carrier!)) as { $tag: string };
    expect(out.$tag).toBe("VckRefused");
  });

  it("a lookup MISS is Nothing — there is no fallback of any kind", () => {
    const { carrier } = carry([{ call: ["f", 1] }, { call: ["f", 2] }]);
    const table = tableFor(carrier!);
    // An id that was never emitted: same caller, role and path, different target.
    const neverEmitted = { ...table[0]!.useId, targetId: "never:emitted" };
    const miss = dispatchedValidationOccurrenceLookup(neverEmitted, table) as { $tag: string };
    expect(miss.$tag).toBe("Nothing");
    // Not the function id's instance, not a sibling use's, not the top set.
    const hit = dispatchedValidationOccurrenceLookup(table[0]!.useId, table) as { $tag: string };
    expect(hit.$tag).toBe("Just");
  });

  it("two uses of one function can hold DIFFERENT instances without sharing", () => {
    const { carrier } = carry([{ call: ["f", 1] }, { call: ["f", 2] }]);
    const table = tableFor(carrier!);
    const distinct = table.map((entry, index) => ({
      ...entry,
      instance: { $tag: "SeArrow", params: [], returns: { $tag: "SeEnum", values: [index] } },
    }));
    const first = dispatchedValidationOccurrenceLookup(distinct[0]!.useId, distinct) as { $tag: string; _0?: unknown };
    const second = dispatchedValidationOccurrenceLookup(distinct[1]!.useId, distinct) as { $tag: string; _0?: unknown };
    expect(JSON.stringify(first)).not.toBe(JSON.stringify(second));
  });
});

// ---------------------------------------------------------------------------
// LAYER 4 — inertness TRIPWIRES (named tripwires, not proofs)
// ---------------------------------------------------------------------------

describe("carrier — the inertness tripwires", () => {
  const CARRIER_SOURCE = "fenel/modules/engine/validation-carrier.fenel";

  it("(tripwire) no judgment-reachable Fenel source references the carrier vocabulary", () => {
    // A TRIPWIRE, not a proof: registering a `.fenel` module extends the global
    // registry DOMAIN, and generic host dispatch resolves by name, so a textual
    // scan cannot establish behavioural inertness. It catches the direct wiring.
    const JUDGMENT_SOURCES = [
      "fenel/modules/engine/check.fenel",
      "fenel/modules/engine/set-algebra-deciders.fenel",
      "fenel/modules/engine/judgment.fenel",
      "fenel/modules/engine/kernel.fenel",
      "fenel/modules/engine/synthesize.fenel",
      "fenel/modules/engine/inhabit.fenel",
    ];
    for (const source of JUDGMENT_SOURCES) {
      const text = read(source);
      for (const symbol of ["vcaCarrier", "vckPreflightTable", "vckLookup", "VcaUseId"]) {
        expect(text.includes(symbol), `${source} references ${symbol}`).toBe(false);
      }
    }
  });

  it("the carrier never reaches the checker through the forbidden re-lift", () => {
    const text = readCode(CARRIER_SOURCE);
    expect(text).not.toContain("jsonLogicToSyntax");
    expect(text).not.toContain("dispatchedJsonLogicToExpr");
    expect(text).not.toContain("jsonLogicToExpr");
  });

  it("the carrier renders no number into an identity (the boxed-number landmine)", () => {
    const text = readCode(CARRIER_SOURCE);
    expect(text).not.toContain("toString");
  });

  it("the carrier declares no fallback vocabulary on a lookup miss", () => {
    const text = readCode(CARRIER_SOURCE);
    // `SeAll` as a lookup fallback is the specific hazard the parent names.
    expect(text).not.toContain("SeAll");
  });

  it("the carrier contract states its obligations executably", () => {
    const clauses = dispatchedValidationCarrierContract() as Array<{ id: string; requirement: string; satisfiedBy: string }>;
    const ids = clauses.map((clause) => clause.id);
    expect(ids).toContain("occurrence-keyed-observation-targets");
    expect(ids).toContain("no-lookup-fallback");
    expect(ids).toContain("whole-ledger-readiness-first");
    expect(ids).toContain("frozen-flat-target-agreement");
    expect(ids).toContain("one-runtime-occurrence-one-identity");
    for (const clause of clauses) {
      expect(clause.requirement.length).toBeGreaterThan(0);
      expect(clause.satisfiedBy.length).toBeGreaterThan(0);
    }
  });

  it("(D5) the 3g obligation to convert ObsCallTarget off its SPELLING key is recorded", () => {
    const clauses = dispatchedValidationCarrierContract() as Array<{ id: string; requirement: string }>;
    const clause = clauses.find((entry) => entry.id === "occurrence-keyed-observation-targets");
    expect(clause).toBeDefined();
    expect(clause!.requirement).toContain("never by a raw call spelling");
    // And the carrier itself must not CALL the spelling-keyed observation
    // lookup. The contract clause names it in prose, so the ban scans code with
    // string literals removed — a name inside a quoted requirement is the
    // obligation being recorded, not the hazard being committed.
    const code = readCode(CARRIER_SOURCE).replace(/"[^"]*"/g, '""');
    expect(code).not.toContain("vobTargetLookup");
  });
});
