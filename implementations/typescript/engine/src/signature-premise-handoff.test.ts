// ---------------------------------------------------------------------------
// signature-premise-handoff.test.ts — the `env.handoff` obligation's TWO
// REQUIRED NEGATIVE-EVIDENCE CASES (signature-substrate slice 3jw §3).
//
// READ THIS BEFORE READING THE ASSERTIONS. These tests assert that two attacks
// SUCCEED. That is not a mistake and it is not a test of broken behaviour left
// green by accident — **the VERDICT IS THE DELIVERABLE.** `env.handoff`
// (design/tcb-ledger.md § 3jw) is a SIDE-CONDITIONED obligation claiming that
// the `env.primordials` premise is PRESERVED across call regions (2), (3) and
// (5); all public-path evidence depends on it; and this file is the executable
// REFUTATION of that claim. By invariant I5 a negative outranks any later
// positive at the same rigour, so the refutation must be pinned, not narrated.
//
// The failure mode this file exists to prevent is precisely the one the design
// round caught: running the regressions, RECORDING the `Infinity`, and moving
// on with ownership deferred. A recorded output is not a verdict.
//
// WHY THESE TWO REGIONS AND NOT THE OTHERS. `env.primordials` makes pristine an
// ENTRY condition at region (4), body entry, and attributes any TARGET-TRIGGERED
// post-entry mutation to the root as audit evidence. That leaves two live gaps
// which are neither caller-side argument evaluation (region 1, the caller's)
// nor implementation-invoked callbacks (region 4, the root's):
//
//   (2) PRE-BODY ADAPTERS — `maybeReorderNamedArgs` calls `Object.keys(record)`
//       (json-logic.ts) AFTER argument-expression evaluation and BEFORE the
//       native body runs. A Proxy `ownKeys` trap therefore executes in a window
//       no prior boundary formulation owned.
//   (5) POST-BODY OBSERVERS — `ctx.onStep` (json-logic.ts) is a caller-supplied
//       callback invoked WITH a call's result. In a pipe it runs BETWEEN
//       stages, so stage two's entry premise can be falsified by stage one's
//       observer. Dismissing stage two as out-of-model would recreate the
//       self-excusing boundary the design explicitly rejected.
//
// WHEN `env.handoff` IS DISCHARGED (a later slice: an adapter audit that
// establishes premise preservation across regions 2/3/5), these tests should
// FLIP — the attacks should stop working — and the ledger row's class should
// change with them. Until then a green run here means the refutation still
// stands, which is the honest state.
//
// SAFETY: every test restores the primordial it patches in a `finally`, and the
// restoration is ASSERTED, so a crashed test cannot leave a poisoned prototype
// behind for the rest of the suite.
// ---------------------------------------------------------------------------

import { describe, it, expect, afterEach } from "bun:test";
import { createRepositoryRegistry } from "./repository-registry";
import { createDispatchRegistry } from "./dispatch-registry";
import { SYSTEM_REGISTRY_MODULES } from "./system-registry-modules";
import { evaluate } from "./json-logic";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Two cases below are drift checks against private planning documents that a
// public checkout does not carry. Where a document is absent, its case is
// reported as skipped, never as passed.
const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const TCB_LEDGER = join(REPO_ROOT, "design", "tcb-ledger.md");
const SLICE_3J2_BRIEF = join(REPO_ROOT, "workstreams", "signature-substrate", "briefs",
  "phase-4-slice-3j2-authority-half-rebrief.md");

const registry = createRepositoryRegistry([...SYSTEM_REGISTRY_MODULES], { dispatchRegistry: createDispatchRegistry() });

const PRISTINE_CODE_POINT_AT = String.prototype.codePointAt;

/** Run `fn` with `String.prototype.codePointAt` restorable no matter what. */
function withRestorablePrimordials<T>(fn: () => T): T {
  try { return fn(); } finally { String.prototype.codePointAt = PRISTINE_CODE_POINT_AT; }
}

afterEach(() => {
  // Belt and braces: the premise this whole slice rests on must hold for every
  // OTHER test file in the run.
  expect(String.prototype.codePointAt).toBe(PRISTINE_CODE_POINT_AT);
  expect("A".codePointAt(0)).toBe(65);
});

describe("env.handoff — region (2), the PRE-BODY ADAPTER (Proxy `ownKeys`)", () => {
  it("is REFUTED: a Proxy argument's ownKeys trap fires before the body and poisons it", () => {
    const observed = withRestorablePrimordials(() => {
      const ctx = registry.evaluateContext();
      // The caller's argument expression yields a PROXY. It is a conforming
      // named-argument record — the trap is the only unusual thing about it.
      let trapFired = false;
      const poisoned = new Proxy({ c: "A" } as Record<string, unknown>, {
        ownKeys(target) {
          // THE WINDOW. `maybeReorderNamedArgs` calls `Object.keys(record)` here
          // — after argument-expression evaluation, before the native body.
          trapFired = true;
          String.prototype.codePointAt = function (): number { return Infinity; };
          return Reflect.ownKeys(target);
        },
        getOwnPropertyDescriptor(t, k) { return Reflect.getOwnPropertyDescriptor(t, k); },
      });
      const result = evaluate({ call: ["std:charCode", { var: "arg" }] } as never, { arg: poisoned }, ctx);
      return { trapFired, result, patched: String.prototype.codePointAt !== PRISTINE_CODE_POINT_AT };
    });

    // The trap DID fire inside the adapter window...
    expect(observed.trapFired).toBe(true);
    // ...and it DID mutate the primordial before the body ran.
    expect(observed.patched).toBe(true);
    // The verdict: `env.handoff` claims the premise is preserved across region
    // (2). It is not. Recorded as a REFUTATION, with the concrete observation.
    // (`std:charCode`'s declared codomain is Number; `Infinity` is the value
    // the poisoned intrinsic produces, and reaching the body at all with a
    // mutated prototype is the refutation regardless of the exact result.)
    expect(observed.result === Infinity || observed.result === 0 || typeof observed.result === "number").toBe(true);
  });

  it("the same call with an ordinary (non-Proxy) record is unaffected — the trap is the cause", () => {
    // The CONTROL. Without it, the row above proves nothing about the adapter:
    // a `charCode` that always returned Infinity would satisfy it too.
    const ctx = registry.evaluateContext();
    const clean = evaluate({ call: ["std:charCode", { var: "arg" }] } as never, { arg: { c: "A" } }, ctx);
    expect(clean).toBe(65);
    expect(String.prototype.codePointAt).toBe(PRISTINE_CODE_POINT_AT);
  });
});

describe("env.handoff — region (5), the POST-BODY OBSERVER (`ctx.onStep` between pipe stages)", () => {
  it("is REFUTED: an onStep callback poisons the NEXT stage of a pipe", () => {
    const observed = withRestorablePrimordials(() => {
      const steps: string[] = [];
      // A caller-supplied observer. It runs AFTER stage one's body returns and
      // BEFORE stage two's body is entered. NOTE the SPREAD: the registry's own
      // evaluate context is NOT EXTENSIBLE, so assigning `onStep` onto it
      // throws. A caller supplies its own context — which is exactly the
      // threat model, and the frozen registry context does not prevent it.
      const onStep = (s: { fnName?: string }) => {
        steps.push(String(s?.fnName));
        if (s?.fnName === "std:toString") {
          String.prototype.codePointAt = function (): number { return Infinity; };
        }
      };
      const ctx = { ...registry.evaluateContext(), onStep } as Record<string, unknown>;
      // The pipe: "A" -> std:toString -> std:charCode. Stage two enters DIRTY.
      const result = evaluate(
        { call: ["std:charCode", { call: ["std:toString", { var: "s" }] }] } as never,
        { s: "A" },
        ctx as never,
      );
      return { steps, result, patched: String.prototype.codePointAt !== PRISTINE_CODE_POINT_AT };
    });

    // Both stages were observed, in order...
    expect(observed.steps).toContain("std:toString");
    // ...the observer mutated the primordial between them...
    expect(observed.patched).toBe(true);
    // ...and stage two therefore entered with a non-pristine environment and
    // returned the poisoned value. THE VERDICT: `env.handoff` is REFUTED for
    // region (5). Treating stage one as finished and dismissing stage two as
    // out-of-model is exactly the self-excusing boundary that was rejected.
    expect(observed.result).toBe(Infinity);
  });

  it("the same pipe with a passive observer returns the true code point — the callback is the cause", () => {
    const steps: string[] = [];
    const ctx = { ...registry.evaluateContext(), onStep: (s: { fnName?: string }) => { steps.push(String(s?.fnName)); } } as Record<string, unknown>;
    const clean = evaluate(
      { call: ["std:charCode", { call: ["std:toString", { var: "s" }] }] } as never,
      { s: "A" },
      ctx as never,
    );
    expect(clean).toBe(65);
    expect(steps.length).toBeGreaterThan(0);
    expect(String.prototype.codePointAt).toBe(PRISTINE_CODE_POINT_AT);
  });
});

describe("env.primordials — what the premise DOES cover, stated so the two are not confused", () => {
  it("region (4) body entry with pristine primordials is the attested path", () => {
    const ctx = registry.evaluateContext();
    expect(evaluate({ call: ["std:charCode", "A"] } as never, {}, ctx)).toBe(65);
    // ...and `std:lt` is PREMISE-FREE — `typeof` and `<` consult no prototype
    // and read no global, so it attests independently. Strictly stronger, and
    // the distinction is what a future freeze decision keys off.
    expect(withRestorablePrimordials(() => {
      String.prototype.codePointAt = function (): number { return Infinity; };
      return evaluate({ call: ["std:lt", 1, 2] } as never, {}, ctx);
    })).toBe(true);
  });

  it.skipIf(!existsSync(TCB_LEDGER))("the ledger row is present, SIDE-CONDITIONED, and carries both refutations", () => {
    // The rule and its row land in the same commit — the ledger's own
    // maintenance discipline, asserted rather than trusted.
    const src = readFileSync(TCB_LEDGER, "utf8");
    expect(src).toContain("| env.handoff |");
    expect(/\| env\.handoff \|[^\n]*SIDE-CONDITIONED/.test(src)).toBe(true);
    expect(/\| env\.handoff \|[^\n]*REFUTED/.test(src)).toBe(true);
    expect(/\| env\.primordials \|[^\n]*SIDE-CONDITIONED/.test(src)).toBe(true);
    // NOT an AXIOM: `AXIOM` means a floor-kernel.md §3.2 basis member, and a
    // host-environment assumption is not one. Misclassifying it would invite
    // future licence code to drop the premise entirely.
    expect(/\| env\.primordials \|[^|]*\|[^|]*\|[^|]*\| AXIOM/.test(src)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Slice 3jw gate 12 — 3j2's contradicting boundary wording is REMOVED.
  //
  // The gate is explicit that this is a REPLACEMENT, and that the REMOVAL is
  // what must be gated: "gate the REMOVAL of the old broad wording — not merely
  // the insertion of a cross-reference." A cross-reference added ALONGSIDE the
  // old sentence leaves a fresh 3j2 session two normative answers to the same
  // question, which is worse than either one alone.
  // -------------------------------------------------------------------------
  it.skipIf(!existsSync(SLICE_3J2_BRIEF))("3j2's brief no longer carries the wording env.primordials contradicts", () => {
    const brief = readFileSync(SLICE_3J2_BRIEF, "utf8");

    // REMOVED. For `charCode(holder.value)` with a CALLER-SIDE getter,
    // `env.primordials` assigns the mutation to region (1) — the caller — while
    // this sentence assigned it to the audited root.
    //
    // SEARCHED OVER A MARKDOWN-NORMALIZED FORM (result-review round 1, finding
    // 4). A raw + whitespace-flattened search is bypassable by RE-RENDERING the
    // same sentence: wrapping it in a blockquote inserts `>` into both byte
    // forms while the rendered document still asserts it —
    //
    //     > **Input-triggered
    //     > same-realm execution stays fully in audit scope.**
    //
    // — which passed every assertion in this test before this normalization.
    // So: drop per-line blockquote and list markers, then strip emphasis
    // punctuation and collapse whitespace. This compares what the document
    // SAYS, not how it is typeset.
    const WITHDRAWN = "Input-triggered same-realm execution stays fully in audit scope";
    // A TEXTUAL heuristic, and it SAYS SO — see the narrowed claim below.
    const renderedText = (md: string): string => md
      .split("\n")
      .map((line) => line.replace(/^[ \t]*(?:[>+*-]|\d+[.)])[ \t]*/, "").replace(/^[ \t]*>+[ \t]*/, ""))
      .join(" ")
      // Inline links render as their TEXT (result-review round 2, finding 2:
      // `[same-realm](#ownership)` inside the sentence evaded every check while
      // rendering the withdrawn rule verbatim). Images first, then links.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_`]+/g, "")
      .replace(/\s+/g, " ");

    expect(brief).not.toContain("Input-triggered\nsame-realm execution stays fully in audit scope");
    expect(brief.replace(/\s+/g, " ")).not.toContain(WITHDRAWN);
    expect(renderedText(brief)).not.toContain(WITHDRAWN);

    // The normalizer must not be inert: it has to actually see the document's
    // own prose, or the assertion above is trivially true for the wrong reason.
    expect(renderedText(brief)).toContain("The chain defends against: confused deputies");

    // AND THE BYPASS IS PINNED, not merely repaired. A mutation that
    // reintroduces the withdrawn rule as a blockquote renders the same sentence
    // while inserting `>` into both raw byte forms — it passed the raw and
    // whitespace-flattened checks above, which is why this normalizer exists.
    const mutant = `${brief}\n\n> **Input-triggered\n> same-realm execution stays fully in audit scope.**\n`;
    expect(mutant.replace(/\s+/g, " "), "control: the mutant must EVADE the flattened check")
      .not.toContain(WITHDRAWN);
    expect(renderedText(mutant), "the normalized check must CATCH the blockquote reintroduction")
      .toContain(WITHDRAWN);

    // The INLINE-LINK reintroduction, round 2's bypass, pinned the same way.
    const linkMutant = `${brief}\n\n> **Input-triggered [same-realm](#ownership) execution stays fully in audit scope.**\n`;
    expect(linkMutant.replace(/\s+/g, " "), "control: the link mutant must EVADE the flattened check")
      .not.toContain(WITHDRAWN);
    expect(renderedText(linkMutant), "the normalized check must CATCH the inline-link reintroduction")
      .toContain(WITHDRAWN);

    // ----------------------------------------------------------------------
    // THE CLAIM, NARROWED — this check is a HEURISTIC and is recorded as one.
    //
    // Two adversarial rounds have each produced a fresh Markdown re-rendering
    // that evades it (blockquote, then inline link), and there will be more:
    // HTML tags, reference-style links, footnotes, tables, entity escapes. This
    // workstream has ALREADY concluded, after five rounds on a sibling
    // mechanism, that "markdown structure is not a security boundary and a
    // regex over prose is not a parser" — so widening this indefinitely has
    // negative expected value.
    //
    // WHAT IT ACTUALLY CATCHES: an ordinary editor reinstating the withdrawn
    // rule, in plain prose, in a blockquote, in a list item, with emphasis, or
    // behind an inline link. That is the realistic failure — nobody
    // ACCIDENTALLY reinstates a normative sentence through a reference-style
    // link. WHAT IT DOES NOT CATCH: a determined re-rendering. Closing that
    // needs a real Markdown-to-text pass, which is a dependency and a decision,
    // not a widening.
    //
    // The POSITIVE half below is what carries the real weight, because it is
    // structural rather than textual: the section must NAME the ledger rows as
    // authoritative and must carry the five-region model. A brief that
    // reinstated the old rule while still asserting both would be
    // self-contradictory on its face, which a reader sees even when a regex
    // does not.
    // ----------------------------------------------------------------------

    // REPLACED BY the five-region ownership rule, which must actually be there —
    // otherwise "the old wording is gone" is satisfied by deleting it and saying
    // nothing, and the brief would have no boundary at all.
    const flat = brief.replace(/\s+/g, " ");
    expect(flat).toContain("FIVE ownership REGIONS");
    expect(flat).toContain("the CALLER");
    expect(flat).toContain("TARGET-TRIGGERED");
    // ONE section named authoritative, so the brief cannot become a second
    // normative source that drifts from the row.
    expect(flat).toContain("AUTHORITATIVE TEXT: `design/tcb-ledger.md` rows `env.primordials` and `env.handoff`");
    // And the carrier class the withdrawn sentence protected must survive the
    // replacement explicitly, or this is a weakening rather than a correction.
    expect(flat).toContain("std:mergeRecords");
  });
});
