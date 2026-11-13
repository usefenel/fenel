// ---------------------------------------------------------------------------
// rights R3a — THE WRITE SIDE, the honest fences, and the harness bound.
//
// Brief: `workstreams/rights/briefs/r3a-account-partitioned-dispatch.md` §6
// pins 2, 12b, 14, 16, 17, 19, 21.
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";
// ⚠ STATIC IMPORTS, IN THIS ORDER. A dynamic `await import()` of the FFI leaf as
// the FIRST engine import inverts the module-init order and trips the
// json-logic / engine-bodies-dispatch install cycle
// ("Cannot access servedResolveBareName before initialization"). The sibling
// isolation test loads them the same way for the same reason.
import { dispatchNativesCtx } from "../../../../fenel/modules/dispatch/ffi/dispatch-ffi";
import { createDispatchRegistry } from "./dispatch-registry";
import { createRegistry } from "./registry";
import { dispatchRegistry, getSystemEntity } from "./system-entities";
import { resolveEffect } from "./effect-dispatch";
import { invokeCallable } from "./json-logic";
import { Ref } from "./type-foundation";
import { __getHarnessForTests } from "./engine-bodies-dispatch";
import {
  accountDispatchFrame, dispatchTestKernel, mintTestAuthorityForAccount, testDescriptorEnvelope,
} from "./authority-test-support";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const A = "r3a-write-account-a";
const B = "r3a-write-account-b";
const POISON = "r3a-poison-account";
const LONG = 200_000;

/** Blank every string / template / comment so a brace count cannot be fooled
 *  by one inside a literal. Length-preserving, so indices stay comparable. */
function maskLiterals(src: string): string {
  const out = src.split("");
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") { out[i] = " "; i += 1; }
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const e = src.indexOf("*/", i + 2);
      const stop = e < 0 ? src.length : e + 2;
      while (i < stop) { if (src[i] !== "\n") out[i] = " "; i += 1; }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      out[i] = " ";
      i += 1;
      while (i < src.length) {
        if (src[i] === "\\") { out[i] = " "; out[i + 1] = " "; i += 2; continue; }
        if (src[i] === c) { out[i] = " "; i += 1; break; }
        if (src[i] !== "\n") out[i] = " ";
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return out.join("");
}

/** Does this function body NAME a registry mutator, in any spelling?
 *
 *  ⚠ ONE READ, OVER A COMMENT-ONLY MASK (review round 8, Astra). Round 7 used
 *  two reads — the full mask, plus a raw check for a bracketed string LITERAL —
 *  and a name held in a VARIABLE defeated both: the full mask blanks
 *  `"addInstance"`, and `registry[writer](…)` has no literal in the brackets.
 *  Keeping strings and dropping comments is the mask this question actually
 *  wants: the fence is NAMING a mutator, and a name is a name whether it is an
 *  identifier, a bracketed literal, or a string assigned to a variable. Prose
 *  still does not count. Enumerating call shapes (`.x(`, `.x (`, `["x"](`,
 *  destructured, via-variable) is a game this pin lost in rounds 6, 7 and 8. */
function reachesMutator(body: string): boolean {
  return /\b(addInstance|removeInstance)\b/.test(maskCommentsOnly(body));
}

/** Blank COMMENTS, keep string and template content. Length-preserving. */
function maskCommentsOnly(src: string): string {
  const out = src.split("");
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") { out[i] = " "; i += 1; }
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const e = src.indexOf("*/", i + 2);
      const stop = e < 0 ? src.length : e + 2;
      while (i < stop) { if (src[i] !== "\n") out[i] = " "; i += 1; }
      continue;
    }
    // step OVER a literal so a `//` inside one is not read as a comment
    if (c === '"' || c === "'" || c === "`") {
      i += 1;
      while (i < src.length) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === c) { i += 1; break; }
        if (c !== "`" && src[i] === "\n") break;
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return out.join("");
}

const BY_TYPE = (target: string) => ({ $tag: "ByType", target });
const NO_SCOPE = { $tag: "Nothing" };

function probeClass() {
  const reg = createDispatchRegistry();
  reg.defineClass({
    name: "R3aWritable",
    params: [{ name: "t" }],
    methods: [{ name: "owner", params: [], returns: { $ref: "String" } }],
  });
  return reg;
}

describe("rights R3a — the write-site disposition", () => {
  // §6 pin 16 — THE `scope` ARGUMENT IS IGNORED. `Just "global"`, `Nothing` and
  // `Just "sometag"` all stamp the WRITING FRAME's account, and account B does
  // not see the row. A requested `global` is a NARROWING, not an escalation.
  //
  // Neuter: the native writes the requested scope. RED: a `{kind:"global"}` row
  // appears and B resolves it.
  test("pin 16 — the argued scope is ignored; the frame's account owns the row", async () => {
    const reg = probeClass();
    const frameA = accountDispatchFrame(A, reg) as never;

    for (const [i, scope] of [NO_SCOPE, { $tag: "Just", _0: "global" }, { $tag: "Just", _0: "sometag" }].entries()) {
      dispatchNativesCtx.register(frameA, "R3aWritable", BY_TYPE(`t${i}`), { owner: "A" }, scope);
    }
    expect(reg.listInstances("R3aWritable").map((r) => r.scope)).toEqual([
      { kind: "account", accountId: A },
      { kind: "account", accountId: A },
      { kind: "account", accountId: A },
    ]);

    // …and B does not see any of them.
    const frameB = accountDispatchFrame(B) as never;
    for (const i of [0, 1, 2]) {
      expect(resolveEffect(frameB, reg, "R3aWritable", `t${i}`)).toBeUndefined();
      expect(resolveEffect(frameA, reg, "R3aWritable", `t${i}`)).toBeDefined();
    }

    // ⚠ AND THE ASYNC IO HANDLER, WHICH IS THE OTHER MEDIATED PATH (review
    // round 3, Grok). This pin claimed "both paths" and ran one: the handler at
    // `runtime/src/handlers/dispatch.ts` could have gone on honouring
    // `params.scope` — stamping `{kind:"global"}` for a caller that argues
    // `Just "global"`, over HTTP or a durable turn — with every assertion above
    // green.
    //
    // ⚠ READ FROM SOURCE HERE, AND THAT IS NOT THE WHOLE PIN (review round 4,
    // Astra). Driving the handler needs the runtime registry and this is the
    // engine suite — but a source assertion cannot see a SWALLOWED refusal: a
    // try/catch around `registrationOwner` falling back to a poison account
    // keeps every line below true. The BEHAVIOURAL half is
    // `runtime/src/rights-r3a-dispatch-ownership.test.ts` → "the ASYNC write
    // path, driven", which registers through the real handler and asserts both
    // the stamped owner and the refusal.
    const handler = readFileSync(
      join(import.meta.dir, "../../runtime/src/handlers/dispatch.ts"), "utf8",
    );
    const registerBody = handler.slice(
      handler.indexOf('reg.registerIOHandler("dispatch.register"'),
      handler.indexOf('reg.registerIOHandler("dispatch.lookup"'),
    );
    expect(registerBody.length).toBeGreaterThan(200);
    // it asks the SAME disposition through the SAME decode…
    expect(registerBody).toContain("registrationOwner(");
    expect(registerBody).toContain('scope: { kind: "account", accountId }');
    // …and the argued scope reaches nothing: `normaliseScope` is DELETED (the
    // file still NAMES it in a comment saying so, which is why this asserts on
    // the DEFINITION and the CALL rather than on the string) and
    // `params["scope"]` is not read at all.
    expect(handler).not.toContain("function normaliseScope");
    expect(handler).not.toMatch(/[^a-zA-Z]normaliseScope\(/);
    expect(registerBody).not.toContain('params["scope"]');
  }, LONG);

  // §6 pin 17 — A NULL FRAME ACCOUNT REFUSES, and this is the fence that closes
  // the executed `$where`-under-the-harness channel: an authored predicate
  // evaluated under the engine harness's registry-bootstrap frame derives no
  // account, so it cannot plant a row at all. The design review EXECUTED the
  // opposite — an authentic account-A authority with an EMPTY envelope was
  // refused at `dispatch:register` directly and still wrote a `{kind:"global"}`
  // row from inside a `SeWhere` predicate.
  //
  // ⚠ THE MUTANT IS `Err -> Ok (ScopeOwned "<poison>")` in the Fenel body — a
  // mechanism that EXISTS. `Ok ScopeGlobal` is not a neuter: that constructor
  // does not exist, and forcing the shape past the decode is refused, which is
  // the opposite of a neuter (§12 trap 30).
  test("pin 17 — a frame that derives no account cannot write, and says so", async () => {
    const reg = probeClass();
    const kernel = dispatchTestKernel();

    // (a) the registry-bootstrap / harness shape: a full evaluation frame that
    // can resolve the disposition but authenticates to no account.
    const noAccount = { ...kernel.evaluateContext(), _specRegistry: reg } as never;
    expect(() => dispatchNativesCtx.register(noAccount, "R3aWritable", BY_TYPE("x"), { owner: "?" }, NO_SCOPE))
      .toThrow(/requires an account frame/);
    expect(reg.listInstances("R3aWritable")).toEqual([]);

    // (b) an EMPTY account id is not an account (§12 trap 32).
    const empty = {
      ...kernel.evaluateContext(),
      _specRegistry: reg,
      _authority: mintTestAuthorityForAccount("", testDescriptorEnvelope([], kernel), kernel),
    } as never;
    expect(() => dispatchNativesCtx.register(empty, "R3aWritable", BY_TYPE("y"), { owner: "?" }, NO_SCOPE))
      .toThrow(/account frame/);
    expect(reg.listInstances("R3aWritable")).toEqual([]);

    // ⚠ THE ASYNC IO HANDLER REFUSES THE SAME WAY (review round 3, Grok). It
    // calls the SAME `registrationOwner` decode under
    // `{...reg.evaluateContext(), _authority: ctx.authority}`, so a frame with
    // no account refuses there too — and `unregister` with it. This is the
    // STRUCTURAL half; the behavioural half is in the runtime suite, for the
    // reason pin 16's note gives.
    const handlerSrc = readFileSync(
      join(import.meta.dir, "../../runtime/src/handlers/dispatch.ts"), "utf8",
    );
    for (const act of ["dispatch.register", "dispatch.unregister"]) {
      const from = handlerSrc.indexOf(`reg.registerIOHandler("${act}"`);
      expect(from).toBeGreaterThan(-1);
      const body = handlerSrc.slice(from, from + 1800);
      expect(body).toContain("registrationOwner(");
      expect(body).toContain("_authority: ctx.authority");
    }

    // (c) UNREGISTER refuses the same way, so a no-account frame cannot delete a
    // boot row either.
    reg.addInstance({ typeName: "R3aWritable", args: ["boot"], methods: { owner: "boot" }, scope: { kind: "global" } });
    expect(() => dispatchNativesCtx.unregister(noAccount, "R3aWritable", "boot"))
      .toThrow(/requires an account frame/);
    expect(reg.listInstances("R3aWritable")).toHaveLength(1);

    // POSITIVE CONTROL — the same native under a frame that DOES derive an
    // account writes, so the refusal is about the account and not about the
    // native being broken.
    dispatchNativesCtx.register(
      accountDispatchFrame(A, reg) as never, "R3aWritable", BY_TYPE("z"), { owner: "A" }, NO_SCOPE,
    );
    expect(reg.listInstances("R3aWritable")).toHaveLength(2);
    void POISON;
  }, LONG);

  // §6 pin 18 (the NATIVE half) — deletion through the native is owner-scoped:
  // A's `unregister` leaves a boot row and B's row standing.
  test("pin 18(native) — unregister removes only the calling frame's own rows", async () => {
    const reg = probeClass();
    reg.addInstance({ typeName: "R3aWritable", args: ["shared"], methods: { owner: "boot" }, scope: { kind: "global" } });
    dispatchNativesCtx.register(accountDispatchFrame(A, reg) as never, "R3aWritable", BY_TYPE("shared"), { owner: "A" }, NO_SCOPE);
    dispatchNativesCtx.register(accountDispatchFrame(B, reg) as never, "R3aWritable", BY_TYPE("shared"), { owner: "B" }, NO_SCOPE);
    expect(reg.listInstances("R3aWritable")).toHaveLength(3);

    dispatchNativesCtx.unregister(accountDispatchFrame(A, reg) as never, "R3aWritable", "shared");
    expect(reg.listInstances("R3aWritable").map((r) => r.methods["owner"])).toEqual(["boot", "B"]);
  }, LONG);

  // §6 pin 19 — THE DISPOSITION IS FENEL, IT IS WIRED, AND THE DECODE REFUSES
  // THE UNREADABLE. This is the DECODE pin; it does not replace pin 21.
  test("pin 19 — the registration scope is decided by a Fenel body, and an unreadable verdict refuses", async () => {
    const frame = accountDispatchFrame(A) as never;

    // The BODY exists, is reachable through the dispatch seam, and answers in
    // the shape the decode requires. A third `.fenel` file is invisible until it
    // is merged into the seam (§12 trap 29) — if it were not merged, this call
    // would not resolve and both natives would refuse.
    expect(invokeCallable(Ref("dispatch:registrationScope"), [{ $tag: "Just", _0: A }], frame))
      .toEqual({ $tag: "Ok", _0: { $tag: "ScopeOwned", accountId: A } });
    expect(invokeCallable(Ref("dispatch:registrationScope"), [{ $tag: "Nothing" }], frame))
      .toEqual({
        $tag: "Err",
        _0: "dispatch registration requires an account frame; global and tag instances are boot-declared",
      });
    // an empty id is refused BY THE BODY as well as by the derivation
    expect(invokeCallable(Ref("dispatch:registrationScope"), [{ $tag: "Just", _0: "" }], frame))
      .toEqual({ $tag: "Err", _0: "dispatch registration requires a non-empty account frame" });

    // ⚠ AN UNRESOLVABLE DISPOSITION IS A REFUSAL, NOT AN ESCAPE. A frame that
    // cannot evaluate the body at all — the shape a minimal fixture or a
    // never-merged seam file produces — refuses loudly and writes nothing.
    const reg = probeClass();
    const blind = { _specRegistry: reg } as never;
    // ⚠ AND THE SHAPE OF THE FAILURE IS THE SILENT-NULL TRAP, CAUGHT. An
    // unresolvable Fenel name does not throw — it evaluates to `null` — so the
    // decode's "no readable verdict" arm is the one that fires, and it refuses.
    // If the decode had treated an unreadable verdict as "no opinion" instead,
    // this call would have written a row under no account at all.
    expect(() => dispatchNativesCtx.register(blind, "R3aWritable", BY_TYPE("q"), { owner: "?" }, NO_SCOPE))
      .toThrow(/dispatch:register: the registration-scope disposition returned no readable verdict/);
    expect(reg.listInstances("R3aWritable")).toEqual([]);
  }, LONG);
});

describe("rights R3a — the honest fences", () => {
  // §6 pin 12b — `resolveNamed` IS REPOSITORY-ONLY. A B-owned `Codeable` row
  // mapping a FRESH alias (not a system id, so stage 1 cannot short-circuit)
  // must not name a system type for anyone.
  //
  // Executed during the design review, raw: `{"before":null,"after":"Boolean"}`
  // — one account renamed a system type for every caller.
  //
  // Neuter: make the stage-2 scan raw again. RED: `"Boolean"` after.
  test("pin 12b — an account-owned Codeable alias cannot name a system entity", async () => {
    const ALIAS = "r3aAliasForBoolean";
    expect(getSystemEntity(ALIAS)).toBeUndefined();
    dispatchRegistry.addInstance({
      typeName: "Codeable",
      args: ["Boolean"],
      methods: { codeName: ALIAS },
      scope: { kind: "account", accountId: B },
    });
    try {
      expect(getSystemEntity(ALIAS)).toBeUndefined();

      // POSITIVE CONTROL — the stage-2 scan is not dead: a REPOSITORY-owned
      // alias for the same target DOES resolve, so what changed is ownership.
      const REPO_ALIAS = "r3aRepoAliasForBoolean";
      dispatchRegistry.addInstance({
        typeName: "Codeable",
        args: ["Boolean"],
        methods: { codeName: REPO_ALIAS },
        scope: { kind: "global" },
      });
      try {
        expect(getSystemEntity(REPO_ALIAS)?.id).toBe("Boolean");
      } finally {
        // a repository row is NOT removable through the owner-scoped API, so
        // the alias is unique per run and simply left behind.
        void REPO_ALIAS;
      }
    } finally {
      dispatchRegistry.removeInstance("Codeable", "Boolean", B);
    }
  }, LONG);

  // §6 pin 14 — THE FACET INDEX ACCEPTS THE OWNERSHIP ADT. `fieldRepresentationKey`
  // used to test only the bare string and the `account` TAG, so an
  // `{kind:"account", accountId}` facet fell through to the REPOSITORY branch and
  // a repository facet for the same `(typeName, field)` made the index throw
  // `duplicate exact instance`. The stamp and this read must land together.
  //
  // Neuter: revert `fieldRepresentationKey`. RED: `duplicate exact instance`.
  test("pin 14 — an account-owned facet and a repository facet coexist in the index", async () => {
    const facets = [
      { typeName: "R3aFacet", args: ["field-1"], methods: { label: "repo" }, scope: { kind: "global" } as const },
      {
        typeName: "R3aFacet", args: ["field-1"], methods: { label: "owned" },
        scope: { kind: "account", accountId: A } as const,
      },
    ];
    const reg = createRegistry([], { fieldRepresentations: facets as never });
    expect(reg.getFieldRepresentation("R3aFacet", "field-1", "repository")?.methods["label"]).toBe("repo");
    expect(reg.getFieldRepresentation("R3aFacet", "field-1", "account")?.methods["label"]).toBe("owned");
  }, LONG);
});

describe("rights R3a — the enumeration's projected scope", () => {
  // §4.6's invariant, on the OTHER projection.
  //
  // ⚠ THE PROJECTION MUST NOT DISAGREE WITH THE PREDICATE (review round 8,
  // Astra). `dispatch:listAllInstances` re-labels each admitted row with
  // `scope: inst.scope ?? null`, and review round 6 made an explicit `null` an
  // unrecognised shape — so a boot row that `instanceVisible` had just ADMITTED
  // was handed to the Fenel side wearing a coordinate that same predicate
  // refuses. Absent IS global (§4.4).
  //
  // Neuter: `inst.scope ?? null`. RED on both halves.
  test("§4.6 — every enumerated row carries a scope the predicate accepts", async () => {
    const { dispatchNativesCtx } = await import("../../../../fenel/modules/dispatch/ffi/dispatch-ffi");
    const { dispatchRegistry } = await import("./system-entities");
    const { instanceVisible, GLOBAL_ONLY } = await import("./dispatch-registry");
    const CLASS = "R3aEnumProjected";
    // an ABSENT scope — the boot spelling, and the one that used to become null
    dispatchRegistry.addInstance({ typeName: CLASS, args: ["boot"], methods: { m: "boot" } } as never);
    dispatchRegistry.addInstance({
      typeName: CLASS, args: ["g"], methods: { m: "g" }, scope: { kind: "global" },
    });

    const rows = dispatchNativesCtx.listAllInstances(
      { natives: {}, _activeTags: [], _specRegistry: dispatchRegistry } as never, CLASS,
    ) as Array<{ args: unknown[]; scope: unknown }>;
    // NOT VACUOUS: both rows came back.
    expect(rows).toHaveLength(2);

    for (const row of rows) {
      expect(row.scope).not.toBeNull();
      // the projected coordinate round-trips through the predicate that admitted it
      expect(instanceVisible({ scope: row.scope } as never, GLOBAL_ONLY)).toBe(true);
    }
    expect(rows.map((r) => r.scope)).toEqual([{ kind: "global" }, { kind: "global" }]);
  }, LONG);
});

describe("rights R3a — the reconstructed representation", () => {
  // §4.8 — `reconstructInstance` must DROP the bare `"account"` spelling.
  //
  // ⚠ THE BRIEF REQUIRED THIS AND IT NEVER LANDED (review round 6, Astra). It
  // stamped the retired marker onto a row whose scope it does not know — the
  // Fenel body returns METHODS — so after the flip the returned row was
  // invisible to EVERYONE, including under `GLOBAL_ONLY`, for a boot row that
  // is globally visible in the registry it came from.
  //
  // Neuter: put `scope: "account"` back. RED on both halves.
  test("§4.8 — the reconstructed row fabricates no ownership", async () => {
    const { dispatchedGetRepresentation } = await import("./engine-bodies-dispatch");
    const { instanceVisible, GLOBAL_ONLY } = await import("./dispatch-registry");
    const { dispatchRegistry } = await import("./system-entities");
    const CLASS = "Labelable";
    const target = "R3aReconstructed.alpha";
    // ⚠ WRITTEN AS A BOOT ROW, NOT THROUGH `setRepresentation` — that path is
    // now a MEDIATED WRITE and refuses a frame with no account, which is pin
    // 17 doing its job. The claim here is about the READ wrapper.
    dispatchRegistry.addInstance({
      typeName: CLASS, args: [target], methods: { label: "Alpha" },
      scope: { kind: "global" },
    });

    const got = dispatchedGetRepresentation(CLASS, target);
    // NOT VACUOUS: the row really came back.
    expect(got).toBeDefined();
    expect((got!.methods as Record<string, unknown>)["label"]).toBe("Alpha");

    // (a) no fabricated coordinate at all
    expect(Object.prototype.hasOwnProperty.call(got!, "scope")).toBe(false);
    expect(got!.scope).toBeUndefined();

    // (b) and the CONSEQUENCE: the row the caller was handed is still visible.
    expect(instanceVisible(got!, GLOBAL_ONLY)).toBe(true);
  }, LONG);
});

describe("rights R3a — the harness bound", () => {
  // §6 pin 21 — THE HARNESS WRITE SURFACE, AS A COMPLETE SET.
  //
  // "No runtime handlers on the harness" alone would stay green under a new
  // engine-resident writer, which is exactly how the `$where`-under-the-harness
  // channel would re-open with pin 19 still green. So the pin fixes the SET.
  //
  // Neuters: (a) add a harness-resident writer that reaches `addInstance`;
  // (b) make a production `lookup` implementation write through `addInstance`
  // and assert the OBSERVED writer subset changes. Deleting a name from the
  // expected list is an ORACLE EDIT, not a neuter.
  test("pin 21 — the harness perform table carries exactly seven dispatch descriptors, two of which write", async () => {
    const harness = __getHarnessForTests();
    const dispatchDescriptors = harness.reg.listPerformDescriptors()
      .filter((d) => d.startsWith("dispatch:") || d.startsWith("dispatch."))
      .sort();
    // A SOURCE LITERAL, complete.
    expect(dispatchDescriptors).toEqual([
      "dispatch:getType",
      "dispatch:listAllInstances",
      "dispatch:lookup",
      "dispatch:lookupAll",
      "dispatch:lookupOne",
      "dispatch:register",
      "dispatch:unregister",
    ]);

    // …and the WRITER subset, measured by reading the shipped implementations
    // rather than by trusting the names.
    const ffi = readFileSync(
      join(import.meta.dir, "../../../../fenel/modules/dispatch/ffi/dispatch-ffi.ts"),
      "utf8",
    );
    const writers = ["register", "unregister"].filter((name) => {
      const at = ffi.indexOf(`function dispatch${name[0]!.toUpperCase()}${name.slice(1)}Native`);
      if (at < 0) return false;
      const body = ffi.slice(at, at + 2600);
      // ⚠ THE TEST IS THE NAME, NOT A CALL SHAPE (review rounds 6 and 7).
      // Round 6 taught this pin whitespace (`registry.addInstance ({…})`) and
      // round 7 got past it again with `registry["addInstance"](…)` and with a
      // destructured `const { addInstance } = registry`. Enumerating spellings
      // of "reaches a mutator" is a losing game; NAMING one at all is the
      // fence. Read over a masked copy so a mention in a comment or a string
      // is not a hit.
      return reachesMutator(body);
    });
    expect(writers).toEqual(["register", "unregister"]);

    // No OTHER dispatch native reaches a mutator.
    //
    // ⚠ THE BODY IS THE WHOLE FUNCTION (review round 3, Grok). This sliced to
    // the first `\n}`, which for every one of these is the OPENING GUARD `if`
    // — so the body after it was never read, and the brief's own neuter (b) — a
    // `lookup` implementation writing a sentinel through `addInstance` — left
    // the pin green while the `$where`-under-harness write channel re-opened
    // with pin 19 still passing.
    for (const name of ["Lookup", "LookupOne", "LookupAll", "ListAllInstances", "GetType"]) {
      const at = ffi.indexOf(`function dispatch${name}Native`);
      expect(at).toBeGreaterThan(-1);
      // ⚠ THE BRACE COUNT RUNS OVER A MASKED COPY (review round 4, Astra).
      // Counting braces in raw source let a `}` inside a STRING close the
      // function early: `void "}";` before an `addInstance` call made the
      // extraction stop after 266 characters — past the length floor, and
      // short of the write.
      const ffiMask = maskLiterals(ffi);
      const open = ffiMask.indexOf("{", ffiMask.indexOf(")", at));
      let depth = 0;
      let close = open;
      for (; close < ffiMask.length; close += 1) {
        if (ffiMask[close] === "{") depth += 1;
        else if (ffiMask[close] === "}") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      const body = ffi.slice(open, close + 1);
      // NOT VACUOUS: the real bodies are hundreds of characters, and the old
      // slice was tens.
      expect(body.length).toBeGreaterThan(200);
      expect(reachesMutator(body)).toBe(false);
    }
  }, LONG);
});
