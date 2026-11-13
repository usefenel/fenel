// Public type submission has one account-aware validation boundary. The raw
// request cannot reach either a behavior function or persistence: submit first
// resolves the canonical type name, submitValidate invokes
// state:validateEntityInstance, and submitValidated dispatches only the coerced
// validation.value.

import { describe, expect, test } from "bun:test";
import { invokeCallable } from "./json-logic";
import { typesModule } from "./modules/types";
import { stdModule } from "./modules/std";
import { createRegistry } from "./registry";
import { dispatchRegistry } from "./system-entities";
import { Just, Nothing } from "./type-foundation";

const reg = createRegistry([stdModule, typesModule], { dispatchRegistry });
const ctx = reg.evaluateContext();

/**
 * module-substrate M1 — the ActionErr message carrier walk (round-2 walk,
 * hardened at round 3 from a BLOCKLIST into an ALLOWLIST).
 *
 * Substring pins were defeated twice: first by mentioning the sanitizer without
 * routing the value through it, then by aliasing the raw value into a second
 * binding. Round 3 defeated the first walk twice more — by SHADOWING (a later
 * `let safe = r.error` overwrites the sanitized `safe` at runtime while the walk
 * still saw one sanitized binding) and by an ARBITRARY CALL HEAD (`id r.error`
 * classified merely as "a call" and passed).
 *
 * So the rule is now an allowlist, and it is deliberately conservative:
 *
 *   A value may occupy an `ActionErr.message` slot only if it is
 *     1. the reserved literal itself — the ONE producer (`types:submit`); or
 *     2. a call to a head in SANITIZING_HEADS; or
 *     3. a `{var: v}` where EVERY `let` binding of `v` anywhere in that body is a
 *        call to a SANITIZING_HEADS head.
 *
 * Rule 3 is "every binding", not "some binding" and not "the last binding":
 * that makes it immune to shadowing and to evaluation order without the walk
 * needing real scope analysis. A body that binds a name twice, once sanitized
 * and once raw, is rejected — which is the correct answer for this property even
 * though such a body could in principle be benign.
 */
const SANITIZING_HEADS = new Set(["submitSafeMessage", "submitValidationMessage"]);

/** Recognise an AST operator ONLY when it is the node's sole key. The runtime
 *  dispatches `let`/`where`/`fn`/`construct`/… that way, so an ordinary record
 *  that merely carries a field named `construct` is DATA, not an operator.
 *  Testing bare presence would both invent `ActionErr`s that do not exist and
 *  let a fabricated `let` field mint a sanitized binding. */
function op(n: unknown, key: string): unknown {
  if (n === null || typeof n !== "object" || Array.isArray(n)) return undefined;
  const keys = Object.keys(n as Record<string, unknown>);
  return keys.length === 1 && keys[0] === key ? (n as Record<string, unknown>)[key] : undefined;
}

const visitNodes = (n: unknown, f: (node: Record<string, unknown>) => void): void => {
  if (n === null || typeof n !== "object") return;
  f(n as Record<string, unknown>);
  // `Object.values` already yields array elements — visiting both double-counts.
  for (const v of Object.values(n as Record<string, unknown>)) visitNodes(v, f);
};

const callHeadOf = (n: unknown): string | undefined => {
  const c = op(n, "call");
  return Array.isArray(c) && typeof c[0] === "string" ? c[0] : undefined;
};

const RESERVED_TOKEN = "__embed_gate_not_found__";

/** How a name got its value, for the sanitization fixpoint below. */
type BindingRhs =
  | { readonly kind: "sanitizing" }                 // a call to a SANITIZING_HEADS head
  | { readonly kind: "safeLiteral" }                // a string literal that is not the marker
  | { readonly kind: "alias"; readonly of: string } // `let b = a`
  | { readonly kind: "opaque" };                    // anything else, incl. params + binders

function classifyRhs(v: unknown): BindingRhs {
  const head = callHeadOf(v);
  if (head !== undefined) {
    return SANITIZING_HEADS.has(head) ? { kind: "sanitizing" } : { kind: "opaque" };
  }
  if (typeof v === "string") {
    return v === RESERVED_TOKEN ? { kind: "opaque" } : { kind: "safeLiteral" };
  }
  const alias = op(v, "var");
  if (typeof alias === "string") return { kind: "alias", of: alias };
  return { kind: "opaque" };
}

/**
 * For every name bound anywhere in a function, is EVERY binding of it safe to
 * place in an `ActionErr.message`?
 *
 * "Every", not "some" and not "the last" — that is what makes it immune to
 * shadowing and to evaluation order without real scope analysis.
 *
 * BINDER FORMS COVERED: `def` PARAMETERS (passed in — they live beside the body,
 * not inside it), `let`, `$bind` pattern binders, `where`, and lambda
 * parameters. A parameter or pattern binder receives an arbitrary caller value,
 * so it is never sanitized. **If the surface gains another binding form, add it
 * here in the same change** — three separate review rounds each found a missing
 * binder, every time by naming a form nobody had enumerated.
 *
 * Resolution is a LEAST fixpoint, so an alias chain (`let b = a`) is followed
 * while a cycle (`let a = b; let b = a`) is never declared safe.
 */
function bindingSanitizationMap(
  body: unknown,
  paramNames: readonly string[] = [],
): Map<string, boolean> {
  const bindings = new Map<string, BindingRhs[]>();
  const note = (name: string, rhs: BindingRhs): void => {
    const list = bindings.get(name);
    if (list === undefined) bindings.set(name, [rhs]);
    else list.push(rhs);
  };
  for (const pn of paramNames) note(pn, { kind: "opaque" });

  const noteRecord = (rec: unknown): void => {
    if (rec === null || typeof rec !== "object" || Array.isArray(rec)) return;
    for (const [name, val] of Object.entries(rec as Record<string, unknown>)) {
      note(name, classifyRhs(val));
    }
  };
  visitNodes(body, (node) => {
    const bound = node["$bind"];
    if (typeof bound === "string" && Object.keys(node).length === 1) {
      note(bound, { kind: "opaque" });
    }
    // `let` has TWO recognisers and they disagree. Ordinary operator dispatch
    // wants a sole key, but the `do` STATEMENT path binds any object that
    // merely HAS a `let` key (`json-logic.ts:1432`, `"let" in expr`). So a
    // multi-key record carrying a `let` field is a REAL binding inside a `do`.
    // Honour both: a sole-key `let` may be sanitizing; a multi-key one binds
    // the same names but is never treated as sanitized. Conservative in both
    // directions — it can only ever cost a false positive.
    const soleLet = op(node, "let");
    if (soleLet !== undefined) noteRecord(soleLet);
    else {
      const looseLet = node["let"];
      if (looseLet !== null && typeof looseLet === "object" && !Array.isArray(looseLet)) {
        for (const name of Object.keys(looseLet as Record<string, unknown>)) {
          note(name, { kind: "opaque" });
        }
      }
    }
    const w = op(node, "where");
    if (Array.isArray(w) && w.length >= 2) noteRecord(w[1]);
    const fn = op(node, "fn");
    // `{fn:[…params, body]}` — the LAST element is the body, never a parameter.
    // A lambda returning a string literal emits `{fn:["x","safe"]}`, so
    // "strings until the first non-string" would mistake the body for a param.
    if (Array.isArray(fn)) {
      for (const el of fn.slice(0, -1)) if (typeof el === "string") note(el, { kind: "opaque" });
    }
  });

  // Least fixpoint: nothing is sanitized until proved so.
  const sanitized = new Map<string, boolean>();
  for (const name of bindings.keys()) sanitized.set(name, false);
  for (;;) {
    let changed = false;
    for (const [name, rhss] of bindings) {
      if (sanitized.get(name) === true) continue;
      const ok = rhss.every((r) =>
        r.kind === "sanitizing"
        || r.kind === "safeLiteral"
        || (r.kind === "alias" && sanitized.get(r.of) === true));
      if (ok) { sanitized.set(name, true); changed = true; }
    }
    if (!changed) break;
  }
  return sanitized;
}

/**
 * Everything that can occupy an `ActionErr.message` slot, classified.
 * Acceptable: the marker literal itself (the ONE producer), a sanitizing call,
 * or a `var` every binding of which is safe. Anything else is an offender.
 */
function actionErrMessageCarriers(body: unknown, paramNames: readonly string[] = []): string[] {
  const safeName = bindingSanitizationMap(body, paramNames);
  const carriers: string[] = [];
  visitNodes(body, (node) => {
    const ctor = op(node, "construct");
    if (!Array.isArray(ctor) || ctor[0] !== "ActionErr") return;
    const m = (ctor[1] as { message?: unknown } | undefined)?.message;
    if (typeof m === "string") { carriers.push(`literal:${m}`); return; }
    const head = callHeadOf(m);
    if (head !== undefined) {
      carriers.push(SANITIZING_HEADS.has(head) ? `sanitizing-call:${head}` : `UNSANITIZED-CALL:${head}`);
      return;
    }
    const v = op(m, "var");
    if (typeof v === "string") {
      carriers.push(safeName.get(v) === true ? `sanitized-var:${v}` : `RAW-VAR:${v}`);
      return;
    }
    carriers.push(`UNCLASSIFIED:${JSON.stringify(m)}`);
  });
  return carriers;
}

/**
 * Expressions in RESULT (tail) position — every value the function can return.
 * Needed because `SANITIZING_HEADS` trusts `submitValidationMessage` by NAME,
 * and that is only sound while its own body returns nothing unsanitized.
 *
 * Transparent wrappers (`::` annotations, `withInstance` scope frames) are
 * descended through: they evaluate to the value inside, so treating them as
 * opaque results would reject safe refactors rather than catch anything.
 */
function resultExpressions(node: unknown): unknown[] {
  if (node === null || typeof node !== "object") return [node];
  const seq = op(node, "do");
  if (Array.isArray(seq)) return seq.length === 0 ? [] : resultExpressions(seq[seq.length - 1]);
  const cond = op(node, "if");
  if (Array.isArray(cond)) return cond.slice(1).flatMap((b) => resultExpressions(b));
  const m = op(node, "match");
  // `[scrutinee, pattern, body, …]` with an OPTIONAL UNPAIRED FINAL element —
  // the `_ -> body` catch-all. Verified against the parser: `case x of "a" ->
  // "A"` plus a `_` arm emits `[{var:x}, "a", "A", {var:x}]`, catch-all at 3.
  if (Array.isArray(m)) {
    const bodies: unknown[] = [];
    let i = 1;
    for (; i + 1 < m.length; i += 2) bodies.push(m[i + 1]);
    if (i < m.length) bodies.push(m[i]);
    return bodies.flatMap((b) => resultExpressions(b));
  }
  const w = op(node, "where");
  if (Array.isArray(w) && w.length >= 1) return resultExpressions(w[0]);
  const ann = op(node, "ann");
  if (Array.isArray(ann) && ann.length >= 1) return resultExpressions(ann[0]);
  const wi = op(node, "withInstance");
  if (Array.isArray(wi) && wi.length >= 2) return resultExpressions(wi[1]);
  const lets = op(node, "let");
  if (lets !== null && typeof lets === "object" && !Array.isArray(lets)) {
    const vals = Object.values(lets as Record<string, unknown>);
    if (vals.length > 0) return resultExpressions(vals[vals.length - 1]);
  }
  return [node];
}


function bodyOf(id: string): string {
  const body = reg.getFunction(id)?.body;
  expect(body).toBeTruthy();
  return JSON.stringify(body);
}

describe("Phase 2b — public type submit validation convergence", () => {
  test("the public form view carries the canonical name needed for identified browser projection", () => {
    const body = bodyOf("types:formViewOf");
    expect(body).toContain('"typeName":{"var":"row.name"}');
    expect(body).toContain('"type":{"var":"row.type"}');
    expect(body).toContain('"rootBinding":{"call":["publicTypeRootBinding",{"var":"row"}]}');
  });

  test("public views capture account UUID provenance and explicitly mark repository rows", () => {
    const row = { id: "type-row", name: "PublicType", type: { $ref: "String" }, isSystem: false };
    expect(invokeCallable("types:publicTypeRootBinding", [row], ctx)).toEqual({ origin: "account", id: "type-row", name: "PublicType" });
    const { isSystem: _flag, ...legacyRow } = row;
    expect(invokeCallable("types:publicTypeRootBinding", [legacyRow], ctx)).toEqual({ origin: "account", id: "type-row", name: "PublicType" });
    expect(invokeCallable("types:publicTypeRootBinding", [{ ...row, isSystem: true }], ctx)).toEqual({ origin: "repository", id: "type-row", name: "PublicType" });
    expect(bodyOf("types:resolveTypeBySystemEntity")).toContain('"isSystem":true');
  });

  test("public Codeable fallback ignores non-types and fails closed on distinct type targets", () => {
    const first = { id: "type-a", name: "TypeA", type: { $ref: "String" } };
    const same = { ...first };
    const second = { id: "type-b", name: "TypeB", type: { $ref: "Number" } };

    expect(invokeCallable(
      "types:selectResolvedTypeCodeables",
      [[Nothing, Just(first), Nothing, Just(same)]],
      ctx,
    )).toEqual(Just(first));
    expect(invokeCallable(
      "types:selectResolvedTypeCodeables",
      [[Nothing, Just(first), Just(second)]],
      ctx,
    )).toEqual(Nothing);

    const fallback = bodyOf("types:resolveTypeByCodeName");
    expect(fallback).toContain('"selectResolvedTypeCodeables"');
    expect(fallback).toContain('"resolveTypeCodeableRow"');
    expect(fallback).toContain('"listTypes"');
    expect(fallback).not.toContain('"find"');
    expect(invokeCallable(
      "types:resolveTypeCodeableRow",
      [[first, second], { targetEntityType: "Field" }],
      ctx,
    )).toEqual(Nothing);
    expect(invokeCallable(
      "types:resolveTypeCodeableRow",
      [[first, second], { targetEntityType: "type-b" }],
      ctx,
    )).toEqual(Just(second));
  });

  test("the canonical submit pipeline is wired and the pre-validation capture arm is gone", () => {
    expect(reg.getFunction("types:submit")?.id).toBe("types:submit");
    expect(reg.getFunctionByCodeName("submit")?.id).toBe("types:submit");
    expect(reg.getFunction("types:submitValidate")?.id).toBe("types:submitValidate");
    expect(reg.getFunction("types:submitValidated")?.id).toBe("types:submitValidated");
    expect(reg.getFunction("types:submitCapture")).toBeUndefined();
  });

  // rights Phase C3 — re-pinned. `submit` used to take the caller's public slug
  // and re-run the three-arm `resolveType` on it. It now takes the BOUND
  // canonical type-row UUID that the embed lane's publication gate authorised,
  // and re-reads it through the account-scoped, UUID-keyed `getTypeById`. The
  // `row.name` pin stays and is now load-bearing in a stronger way: the name
  // used for validation and the behavior probe must be DERIVED from that read,
  // never taken from the request. A regression to `resolveType` here would make
  // the gate advisory again, so the negative pin is the point of this test.
  test("submit binds the authorised type id and never re-resolves a caller-supplied name", () => {
    const body = bodyOf("types:submit");
    expect(body).toContain('"getTypeById"');
    expect(body).toContain('"typeId"');
    expect(body).not.toContain('"resolveType"');
    expect(body).toContain('"submitValidate"');
    expect(body).toContain('"row.name"');
    expect(body).not.toContain('"getFunction"');
  });

  // rights Phase C3 — the embed lane's gate, pinned as a chain. Each link is a
  // separate failure mode: losing the id re-read re-admits the system-entity
  // arm, losing the reserved-name refusal lets the grant store be minted
  // through the lane it guards, and losing the publication read opens the lane
  // to every registered type in the named account.
  test("the embed gate binds by id, refuses the grant store, and requires a publication", () => {
    expect(bodyOf("types:embedResolve")).toContain('"resolveType"');
    expect(bodyOf("types:embedResolve")).toContain('"embedBindById"');

    const bind = bodyOf("types:embedBindById");
    expect(bind).toContain('"getTypeById"');
    expect(bind).toContain('"embedRefuseGrantStore"');

    const refuse = bodyOf("types:embedRefuseGrantStore");
    expect(refuse).toContain("EmbedPublication");
    expect(refuse).toContain('"embedRequirePublication"');

    const require_ = bodyOf("types:embedRequirePublication");
    expect(require_).toContain("EmbedPublication");
    expect(require_).toContain('"listInstancesByName"');
    expect(require_).toContain('"canonical.id"');
  });

  // GET must bind the same way POST does; re-resolving a name here would leak
  // the $record of any registered type in the named account.
  test("formView serves the bound id, not a re-resolved slug", () => {
    const body = bodyOf("types:formView");
    expect(body).toContain('"getTypeById"');
    expect(body).not.toContain('"resolveType"');
  });

  // The capture must reach `tryCreateInstanceByName`'s existence-checked UUID
  // arm. Its bare-name arm passes any non-UUID string through unchecked.
  test("the generic capture arm is id-keyed", () => {
    const body = bodyOf("types:submitCreate");
    expect(body).toContain('"tryCreateInstanceByName"');
    expect(body).toContain('"typeId"');
  });

  // rights C3 — the embed route reads `__embed_gate_not_found__` as "the row the
  // publication gate bound has vanished" and answers 404 instead of its usual
  // 422. That is only safe while the token has exactly ONE producer. Both other
  // arms forward text this module did not author (a validator message; a raw
  // backend Error.message from state.ts's catch), so each must launder it —
  // otherwise a backend error carrying the token impersonates a gate miss.
  //
  // module-substrate M1 — the guard used to be INLINED at both forwarding sites
  // because adding a function to this module crashed engine boot. That defect is
  // repaired, so there is now ONE sanitizer and this pins the shape that makes
  // the one-producer claim structural: the token literal may appear in exactly
  // two bodies across the whole module — `submit` (which PRODUCES it) and
  // `submitSafeMessage` (which COMPARES against it) — and every forwarding body
  // must delegate rather than carry its own copy.
  test("the gate token has exactly one producer and one sanitizer", () => {
    const carriers = (typesModule.functions ?? [])
      .filter((f) => JSON.stringify(f.body ?? null).includes("__embed_gate_not_found__"))
      .map((f) => f.id)
      .sort();
    expect(carriers).toEqual(["types:submit", "types:submitSafeMessage"]);

    // The forwarding bodies must ROUTE THEIR FORWARDED VALUE through the
    // sanitizer — not merely mention it somewhere. A body that called
    // `submitSafeMessage` on an unrelated value and still returned the raw
    // forwarded text would satisfy a substring check while leaking the token,
    // so pin the value flow: sanitizer(forwarded) in, sanitized out.
    const vm = bodyOf("types:submitValidationMessage");
    expect(vm).toContain('{"call":["submitSafeMessage",{"var":"error.message"}]}');
    // (A round-1 residual check that forbade EVERY other mention of
    // `error.message` used to sit here. It has been removed: the
    // `resultExpressions` check below decides the same property precisely,
    // over what the function can RETURN, while the substring version also
    // rejected benign mentions such as `if eq error.message ""`.)

    const sc = bodyOf("types:submitCreate");
    expect(sc).toContain('{"call":["submitSafeMessage",{"var":"r.error"}]}');
    // The error arm returns the SANITIZED binding, never the backend string.
    expect(sc).toContain('"message":{"var":"safe"}');
    expect(sc).not.toContain('"message":{"var":"r.error"}');

    // The property the substring pins above only approximate: across EVERY
    // function in the module, nothing may occupy an `ActionErr.message` slot
    // except the reserved literal (one producer) or a sanitized carrier. An
    // alias binding — the way to defeat the pins — shows up here as `RAW-VAR:`.
    const byFn = new Map<string, string[]>();
    for (const f of typesModule.functions ?? []) {
      const cs = actionErrMessageCarriers(
        f.body,
        (f.params ?? []).map((prm) => prm.name),
      );
      if (cs.length > 0) byFn.set(f.id, cs);
    }
    const offenders = [...byFn].flatMap(([id, cs]) =>
      cs.filter((c) =>
        c.startsWith("RAW-VAR:")
        || c.startsWith("UNCLASSIFIED:")
        || c.startsWith("UNSANITIZED-CALL:"),
      ).map((c) => `${id} → ${c}`),
    );
    expect(offenders).toEqual([]);
    // Rule 2 trusts `submitValidationMessage` BY NAME. That is only sound while
    // every value it can return is itself sanitized — so verify it rather than
    // assume it. (`submitSafeMessage` is excluded: it IS the sanitizer, and its
    // contract is pinned behaviourally by the tests below.)
    const vmFn = (typesModule.functions ?? []).find((f) => f.id === "types:submitValidationMessage");
    const vmBindings = bindingSanitizationMap(
      vmFn?.body,
      (vmFn?.params ?? []).map((prm) => prm.name),
    );
    const vmResults = resultExpressions(vmFn?.body).map((r) => {
      if (typeof r === "string") return r === "__embed_gate_not_found__" ? "LITERAL-TOKEN" : "safe-literal";
      const head = callHeadOf(r);
      if (head !== undefined) return SANITIZING_HEADS.has(head) ? "sanitizing-call" : `UNSANITIZED-CALL:${head}`;
      // Same rule as the carrier walk: a `var` is acceptable exactly when every
      // binding of that name is a sanitizer call. Without this the two checks
      // disagreed, and an ordinary `let cleaned = submitSafeMessage …; cleaned`
      // refactor was rejected.
      const v = (r as { var?: unknown } | null)?.var;
      if (typeof v === "string") {
        return vmBindings.get(v) === true ? "sanitized-var" : `UNSANITIZED-VAR:${v}`;
      }
      return `UNSANITIZED:${JSON.stringify(r)}`;
    });
    expect(vmResults.filter((r) => r.startsWith("UNSANITIZED") || r === "LITERAL-TOKEN")).toEqual([]);
    expect(vmResults.some((r) => r === "sanitizing-call" || r === "sanitized-var")).toBe(true);

    // …and the reserved literal occupies such a slot in exactly one function.
    const literalProducers = [...byFn]
      .filter(([, cs]) => cs.includes("literal:__embed_gate_not_found__"))
      .map(([id]) => id);
    expect(literalProducers).toEqual(["types:submit"]);

    // `submit` produces the token as its RESULT; the sanitizer never does.
    expect(bodyOf("types:submit")).toContain("__embed_gate_not_found__");
  });

  // The `do` statement path binds any object carrying a `let` key, not only a
  // sole-key one (`json-logic.ts:1432`). Pinned directly on the analyser
  // because the surface spelling for such a record is awkward while the
  // property — a multi-key `let` must not read as sanitized — is not.
  test("a multi-key `let` statement still counts as a binding", () => {
    const sanitized = { call: ["submitSafeMessage", { var: "r.error" }] };
    const body = {
      do: [
        { let: { safe: sanitized } },
        { note: "inert", let: { safe: { var: "r.error" } } },
        { construct: ["ActionErr", { message: { var: "safe" } }] },
      ],
    };
    expect(actionErrMessageCarriers(body)).toEqual(["RAW-VAR:safe"]);
    // …and the ordinary sole-key form still resolves as sanitized.
    const clean = {
      do: [
        { let: { safe: sanitized } },
        { construct: ["ActionErr", { message: { var: "safe" } }] },
      ],
    };
    expect(actionErrMessageCarriers(clean)).toEqual(["sanitized-var:safe"]);
  });

  test("the shared sanitizer launders the reserved token and passes everything else", () => {
    expect(
      invokeCallable("types:submitSafeMessage", ["__embed_gate_not_found__"], ctx),
    ).toBe("Submission failed");
    expect(
      invokeCallable("types:submitSafeMessage", ["Account email is required"], ctx),
    ).toBe("Account email is required");
    expect(invokeCallable("types:submitSafeMessage", [""], ctx)).toBe("");
  });

  // The capture arm forwards a raw backend `Error.message`; it must launder too.
  test("the capture arm's backend error cannot impersonate the gate token", () => {
    expect(
      invokeCallable("types:submitSafeMessage", ["__embed_gate_not_found__"], ctx),
    ).toBe("Submission failed");
  });

  test("forwarded messages cannot impersonate the gate token", () => {
    expect(
      invokeCallable(
        "types:submitValidationMessage",
        [[{ path: "email", message: "__embed_gate_not_found__" }]],
        ctx,
      ),
    ).toBe("Submission failed");
    // Everything else passes through untouched — the 422 surface is unchanged.
    expect(
      invokeCallable(
        "types:submitValidationMessage",
        [[{ path: "email", message: "Account email is required" }]],
        ctx,
      ),
    ).toBe("Account email is required");
  });

  test("submitValidate uses the account registry leaf and forwards only its coerced value", () => {
    const body = bodyOf("types:submitValidate");
    expect(body).toContain('"validateEntityInstance"');
    expect(body).toContain('"validation.value"');
    expect(body).toContain('"submitValidated"');
    expect(body).not.toContain('"validateValue"');
    expect(body).not.toContain('"schema"');
  });

  test("both behavior and capture lanes receive the already-validated value", () => {
    const body = bodyOf("types:submitValidated");
    expect(body).toContain('"getFunction"');
    expect(body).toContain('"submitCall"');
    expect(body).toContain('"submitCreate"');
    expect(body.match(/\{"var":"data"\}/g)?.length).toBe(2);
  });

  test("structured validation failures retain the public string error envelope", () => {
    expect(
      invokeCallable(
        "types:submitValidationMessage",
        [[{ path: "email", message: "Account email is required" }]],
        ctx,
      ),
    ).toBe("Account email is required");
    expect(invokeCallable("types:submitValidationMessage", [[]], ctx)).toBe(
      "Validation failed",
    );
  });
});
