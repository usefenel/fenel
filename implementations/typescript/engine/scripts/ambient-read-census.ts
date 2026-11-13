/**
 * type-substrate P1(a.20) — THE AMBIENT-READ CENSUS.
 *
 * A judgment's verdict is only a claim about the runtime if the authority it
 * READ is the authority the runtime will read. Four UNSOUND-KNOWN ledger rows
 * were one defect of that shape, and the register named it four times while
 * owning it nowhere.
 *
 * The obligation is NOT "which caller can receive a witness" — that is a
 * data-flow property over an open caller graph, it defeats every syntactic
 * approximation, and P1(a.15) was withdrawn before execution by two independent
 * reviews for resting on exactly that. The obligation this instrument supports
 * is the local one: *of each READ the decider performs, can it prove the
 * authority it consulted is the exercise authority?* That set is closed and
 * syntactic — the natives merged at the decider DOORS, plus the module-private
 * side tables those natives reach — so it can be enumerated, committed, and
 * drift-checked instead of asserted in prose.
 *
 * SCOPE IS BY DOOR MEMBERSHIP, NOT BY PARAMETER SPELLING. The brief's premise 5
 * proposed grepping for `_c: EvaluateContext`; that is the wrong instrument in
 * both directions. It over-counts (31 hits tree-wide, many outside any decider
 * door) and, worse, it under-counts: every genuinely interesting read
 * (`checkCtorDeclaredWires`, `fnTypeMarker`, `namedMember`, `patternMember`)
 * takes a LIVE `c` and would not match at all. A census scoped by parameter
 * name would have checked a set disjoint from the one that matters.
 *
 *   bun implementations/typescript/engine/scripts/ambient-read-census.ts
 *   bun implementations/typescript/engine/scripts/ambient-read-census.ts --check
 *
 * `--check` rejects drift and missing side-table classifications. Regenerating
 * records an UNCLASSIFIED row for review, but cannot make it pass. Classified
 * changed rows still require review: this is not an approval gate.
 *
 * TS kind: test/tooling harness (`design/ts-exceptions-ledger.md`). No product
 * code imports it and it has no runtime effect.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as ts from "typescript";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE_SRC = join(HERE, "..", "src");
const OUT = join(HERE, "ambient-read-census.json");

/** Where a read's answer comes FROM. The question is whose authority answered,
 * never whether the parameter was spelled `_c`.
 *
 * ⚠ THE CLASSIFICATION IS OF DIRECT READS, AND `DELEGATES` IS THE FRONTIER, NOT
 * A CLEAN BILL. The first cut of this instrument had no such class and called
 * `namedMember` / `whereMember` / `namedSubsetCheck` PURE while each forwards to
 * a seam that reaches the harness. A census that under-reports is worse than
 * none, because its silence reads as evidence. Transitive classification is a
 * different instrument; this one names its own edge. */
type ReadClass =
  /** Reads no authority at all: arguments in, answer out, no forwarding. */
  | "PURE"
  /** Reads only the exercise context the CALLER supplied, through P1(a.12)'s
   * `_setAlgebraEvalCtx` own-data carrier discipline. The sound shape. */
  | "CALLER-AUTHORITY"
  /** Forwards to another engine seam whose own reads this instrument does not
   * follow. UNCLASSIFIED, not clean. */
  | "DELEGATES"
  /** Binds a registry / marshal state / form data at natives-BUILD time. Whether
   * that equals the exercise authority is the same question in a costume. */
  | "CLOSED-OVER"
  /** Reads or forwards the MERGED decider context. Sound-LOOKING and not sound:
   * the merge is `{...harness.ctx, getFunction: harness-FIRST}`, so for any name
   * the harness registry knows, the caller's own definition is never consulted. */
  | "HARNESS-SHADOWED"
  /** Reaches a process singleton or a module-global mutable table. */
  | "PROCESS-GLOBAL"
  /** Reaches a side table keyed on host object IDENTITY, so any context COPY
   * silently loses it. */
  | "IDENTITY-KEYED"
  /** A module-level side table with no authored classification. Fails the gate
   * on sight — silence is not a clean bill. */
  | "UNCLASSIFIED";

type Marker = { readonly re: RegExp; readonly cls: ReadClass; readonly why: string };

/** Ordered most-severe first: a native's PRIMARY class is the first marker that
 * matches, and EVERY matching marker is recorded, so a partial repair is
 * visible as a marker-set change even when the primary class does not move.
 * `CALLER-AUTHORITY` sits last on purpose — reading the carrier is only the
 * sound shape when nothing worse also fired. */
const MARKERS: readonly Marker[] = [
  {
    re: /\bconstructorDeclaredFieldNames\s*\(|\bconstructorTableStable\s*\(/,
    cls: "IDENTITY-KEYED",
    why: "reaches the dynamic `type_def` constructor table, a WeakMap keyed on context identity",
  },
  {
    re: /\bidentityAuthorityRegistry\s*\(|\bpeekSystemRegistry\s*\(|\bgetHarness\s*\(|\bharnessExerciseContext\s*\(|\bmergedHierarchyKeys\s*\(/,
    cls: "PROCESS-GLOBAL",
    why: "reaches the process identity authority, the engine dispatch harness, or a process-merged key set",
  },
  {
    re: /\b\w*Fixtures\s*\.\s*(get|has)\s*\(/,
    cls: "PROCESS-GLOBAL",
    why: "consults a module-global test-seam fixture map before the real authority",
  },
  { re: /\bcatalog\s*\./, cls: "PROCESS-GLOBAL", why: "reads the in-process type catalog" },
  {
    re: /\.\s*getFunction\b|\.\s*getFunctionSignatureInfo\b|_setAlgebraRequestCtx|SetAlgebraEvalContext|(?:^|[^\w$.])c(?:\s*[,)]|\s+as\s)/m,
    cls: "HARNESS-SHADOWED",
    why: "reads or forwards the merged decider context, whose name resolution is harness-FIRST",
  },
  {
    re: /\bdispatched[A-Z]\w*\s*\(|\bsa\s*\.\s*\w+\s*\(|\bengineRequire\s*\(/,
    cls: "DELEGATES",
    why: "forwards to an engine seam this instrument does not follow — UNCLASSIFIED, not clean",
  },
  {
    re: /_setAlgebraEvalCtx/,
    cls: "CALLER-AUTHORITY",
    why: "consults the caller's supplied exercise context through the P1(a.12) carrier discipline",
  },
  {
    // rights R3a — the REQUEST ACCOUNT is a per-overlay CLOSURE, not a context
    // read. A native that closes over it consults the account the authenticated
    // IO caller supplied, threaded as an ARGUMENT through every decider
    // re-entry; the thing it replaced was a read of `accountId` off the value
    // under judgment, which is the opposite of caller authority.
    re: /requestAccount/,
    cls: "CALLER-AUTHORITY",
    why: "closes over the per-call `requestAccount` — the account an authenticated IO caller supplied, threaded as an argument rather than read from the context or from the value (rights R3a)",
  },
];

/** Parameters of the native FACTORIES. A native mentioning one of these closes
 * over an authority bound when the natives map was built. */
// ⚠ `registry` and `options` were MISSING (review round 4), so
// `containmentDeciderNativesCtx.fieldKeyValidationProjection` — which captures
// `options.registry` — was committed as PURE. A census that files a registry
// capture under "reads no authority" is worse than one that omits it.
const CLOSED_OVER_BINDINGS = ["state", "coerceContext", "formData", "registry", "options"] as const;

type NativeRow = {
  readonly door: string;
  readonly native: string;
  readonly cls: ReadClass;
  readonly markers: readonly string[];
  /**
   * sha256 of this native's CODE, with COMMENTS blanked and string literals
   * PRESERVED.
   *
   * ⚠ WITHOUT THIS THE GATE HAS A HOLE, and review round 2 named it: the
   * classification is a marker SET, so any authority change that keeps the same
   * markers leaves the artifact byte-identical and `--check` prints FRESH.
   * Swapping one process global for another, or adding a SECOND ambient read of
   * a kind the native already carries, is exactly that shape — and "a new
   * ambient read is SEEN" is the whole claim of the instrument.
   *
   * Comments are blanked because prose churn in a decider native is constant in
   * this repo, and a gate that fires on it is a gate people learn to regenerate
   * without reading. STRINGS ARE NOT blanked — the first cut stripped them and
   * review round 2 showed that hides the semantics: changing the wire
   * discriminator `"NamedField"` to `"BogusField"` left the census
   * byte-identical. In these natives a string literal is a tag, a property name
   * or a discriminator, not prose.
   */
  readonly codeDigest: string;
};

type TableRow = {
  readonly file: string;
  readonly table: string;
  readonly cls: ReadClass;
  readonly note: string;
};

type Census = {
  readonly schema: "fenel.ambient-read-census.v1";
  readonly doors: readonly string[];
  readonly natives: readonly NativeRow[];
  readonly sideTables: readonly TableRow[];
  readonly counts: Readonly<Record<string, number>>;
};

/** Strip line comments, block comments and string/template literals so a marker
 * cannot match inside prose or a quoted name. Length-preserving, so spans
 * computed on the stripped text index the original. */
function strip(src: string): string {
  const out = src.split("");
  let i = 0;
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === "//") {
      const end = src.indexOf("\n", i);
      const to = end === -1 ? src.length : end;
      blank(i, to);
      i = to;
      continue;
    }
    if (two === "/*") {
      const end = src.indexOf("*/", i + 2);
      const to = end === -1 ? src.length : end + 2;
      blank(i, to);
      i = to;
      continue;
    }
    const ch = src[i]!;
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === ch) { j++; break; }
        j++;
      }
      blank(i + 1, j - 1 >= i + 1 ? j - 1 : i + 1);
      i = j;
      continue;
    }
    i++;
  }
  return out.join("");
}

/**
 * Comments only — STRING LITERALS ARE PRESERVED.
 *
 * ⚠ The first cut of the code digest hashed the fully stripped body, and review
 * round 2 showed that blanks the semantics: changing the wire discriminator
 * `"NamedField"` to `"BogusField"`, or moving a `_setAlgebraEvalCtx` property
 * name, left the census BYTE-IDENTICAL. String literals in these natives are
 * not prose — they are the tags, property names and discriminators the reads
 * turn on. Comments still go, because prose churn in a decider native is
 * constant here and a gate that fires on it is a gate people regenerate without
 * reading.
 */
function stripComments(src: string): string {
  const NL = "\n";
  const out = src.split("");
  let i = 0;
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== NL) out[k] = " ";
  };
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === "//") {
      const end = src.indexOf(NL, i);
      const to = end === -1 ? src.length : end;
      blank(i, to); i = to; continue;
    }
    if (two === "/*") {
      const end = src.indexOf("*/", i + 2);
      const to = end === -1 ? src.length : end + 2;
      blank(i, to); i = to; continue;
    }
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === ch) { j++; break; }
        j++;
      }
      i = j; continue;
    }
    i++;
  }
  return out.join("");
}

/** C2: select the factory's own returned map, never a nested native's return.
 * TypeScript syntax owns generic commas, comparisons and nested literals.
 * Unsupported return/property forms refuse rather than losing census rows. */
function factorySource(raw: string, factory: string): {
  preamble: string;
  entries: { name: string; body: string }[];
} {
  const source = ts.createSourceFile("ambient-read-source.ts", raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declarations = source.statements.filter((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === factory);
  const declaration = declarations.length === 1 ? declarations[0] : undefined;
  if (declaration?.body === undefined) throw new Error(`ambient-read-census: factory ${factory} not found or ambiguous`);
  const returns: ts.ReturnStatement[] = [];
  const collectReturns = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node)) returns.push(node);
    ts.forEachChild(node, collectReturns);
  };
  collectReturns(declaration.body);
  let expression = returns.length === 1 ? returns[0]?.expression : undefined;
  const unwrap = (node: ts.Expression): ts.Expression => {
    while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)
      || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node)) node = node.expression;
    return node;
  };
  if (expression !== undefined) expression = unwrap(expression);
  if (expression !== undefined && ts.isIdentifier(expression)) {
    const name = expression.text;
    const bindings = declaration.body.statements.flatMap(statement =>
      ts.isVariableStatement(statement) && (statement.declarationList.flags & ts.NodeFlags.Const) !== 0
        ? statement.declarationList.declarations.filter(binding => ts.isIdentifier(binding.name) && binding.name.text === name)
        : []);
    expression = bindings.length === 1 && bindings[0]?.initializer !== undefined
      ? unwrap(bindings[0].initializer) : undefined;
  }
  if (expression === undefined || !ts.isObjectLiteralExpression(expression)) {
    throw new Error(`ambient-read-census: ${factory} must return one object literal or its local const binding`);
  }
  const entries = expression.properties.map(property => {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) {
      throw new Error(`ambient-read-census: ${factory} has an unsupported native property; no entry may be skipped`);
    }
    return { name: property.name.text, body: raw.slice(property.getStart(source), property.end) };
  });
  // The preamble digest also covers post-map alias registration and the actual
  // return. Those statements can change captured authority too.
  const preamble = raw.slice(declaration.getStart(source), expression.getStart(source))
    + raw.slice(expression.end, declaration.end);
  return { preamble, entries };
}

/** Every top-level `function <name>(` in the files that carry decider natives.
 *  ⚠ REVIEW ROUND 10. `DELEGATES` was matched by THREE named seam spellings
 *  (`dispatchedX(`, `sa.x(`, `engineRequire(`), so a native whose entire body is
 *  a call to an ordinary module-level helper was committed `PURE` — measured:
 *  BOTH `canonicalListHeadFieldKey` rows, which forward through
 *  `repositoryListHeadFieldKey` to the module-global mutable
 *  `repositoryTraversalFieldKeys` cache and the lazily-initialised
 *  `traversalRepositoryIdentityLock`. A row that FORWARDS cannot be `PURE`
 *  under this instrument's own definition, and `PURE` is the strongest clean
 *  class it can award: reporting it there is the unsafe direction, and it hid a
 *  live wrong output (a caller can mutate the cached key the native hands back,
 *  and `marshalTraversalType` grafts the same alias into its public result).
 *  The frontier is therefore derived, not enumerated. */
function topLevelFunctionNames(sources: readonly string[]): ReadonlySet<string> {
  const names = new Set<string>();
  for (const src of sources) {
    for (const m of src.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*[(<]/gm)) {
      names.add(m[1] as string);
    }
  }
  return names;
}

function classify(body: string, forwardTargets: ReadonlySet<string>): { cls: ReadClass; markers: string[] } {
  const s = strip(body);
  const markers: string[] = [];
  let cls: ReadClass | undefined;
  for (const m of MARKERS) {
    if (m.re.test(s)) {
      markers.push(m.why);
      cls ??= m.cls;
    }
  }
  for (const m of s.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
    const callee = m[1] as string;
    if (!forwardTargets.has(callee)) continue;
    markers.push(`forwards to the module-level \`${callee}\` — this instrument does not follow calls`);
    if (cls === undefined) cls = "DELEGATES";
    break;
  }
  for (const binding of CLOSED_OVER_BINDINGS) {
    if (new RegExp(`\\b${binding}\\b`).test(s)) {
      markers.push(`closes over the natives-build binding \`${binding}\``);
      // CLOSED-OVER outranks DELEGATES and CALLER-AUTHORITY but not the three
      // above it, so it is applied only when nothing more severe fired.
      if (cls === undefined || cls === "DELEGATES" || cls === "CALLER-AUTHORITY") cls = "CLOSED-OVER";
      break;
    }
  }
  return { cls: cls ?? "PURE", markers: [...new Set(markers)] };
}

/** Module-private side tables the decider surface reaches. Enumerated from the
 * source rather than listed by hand: any module-level `WeakMap`/`Map`/`Set` in
 * the two files that carry the decider natives and the constructor tables. The
 * note is authored per table, because "what does this table hold" is not
 * derivable from its declaration. */
const TABLE_NOTES: Readonly<Record<string, { cls: ReadClass; note: string }>> = {
  // -------------------------------------------------------------------------
  // rights R2a (2026-09-11) — the three rows the brief required this phase to
  // classify rather than regenerate past. All three are `WeakMap`/`WeakSet`
  // memoisation keyed on an OBJECT's own identity, which is the P1(a.18)
  // IDENTITY-KEYED shape; none is a process-lifetime authority, and none needs
  // a ledger row. Each was read at its definition, not inferred from its name.
  // -------------------------------------------------------------------------
  immutableDirectRouteIndexes: {
    cls: "IDENTITY-KEYED",
    note:
      "a WeakSet of routing-index OBJECTS that have been verified frozen with a null "
      + "prototype (`engine-bodies-dispatch.ts` `directRouteJudgmentsFor`). It records a "
      + "STRUCTURAL verification about the key itself, and the property it records cannot "
      + "become false — a frozen null-prototype object stays one. A lost entry re-verifies.",
  },
  canonicalDirectRouteJudgments: {
    cls: "IDENTITY-KEYED",
    note:
      "Direct-arm resolver judgments, keyed on the REGISTRY and then on the routing INDEX "
      + "object, with separate sub-caches for the ordinary and interpreted proof scopes. "
      + "Admission is narrow by construction: only a registry-published snapshot whose "
      + "`routeIdx` slot is a non-writable non-configurable frozen null-prototype record is "
      + "eligible, and a judgment is cached only after the canonical Fenel resolver actually "
      + "returned Direct. A miss recomputes, so a lost entry costs time, not truth.",
  },
  lexicalContextFamilies: {
    cls: "IDENTITY-KEYED",
    note:
      "interns evaluator contexts across repeated module/callback transitions, keyed on the "
      + "CONTEXT object (`json-logic.ts` `lexicalEvaluateContext`). It is the one row here a "
      + "rights reader should look at twice, and it is sound: `lexicalAmbientMatches` compares "
      + "EVERY enumerable ambient slot by identity before reuse, and `_authority` is such a "
      + "slot — so a frame carrying a different authority forms a NEW family rather than "
      + "reviving the previous one's interned context. Only the `_importStack` name binding and "
      + "the `_sourceFunction` coordinate (modules-as-values Phase 2d, the lexical source of "
      + "annotation names) are allowed to vary within a family.",
  },
  annotationScans: {
    cls: "IDENTITY-KEYED",
    note:
      "memoizes, per function-BODY object, whether the body contains an `ann` node "
      + "(`json-logic.ts` `bodyReadsSourceFunction`); only then does named-body entry set the "
      + "`_sourceFunction` coordinate that call-site typing resolves annotation names through "
      + "(modules-as-values Phase 2d). A structural fact about the key. A NEGATIVE answer is cached "
      + "only for a wholly frozen body graph (every registry body is deep-frozen, so it cannot "
      + "change); an unfrozen body is rescanned and carries the coordinate, so a body that gains an "
      + "annotation never runs it detached. A lost entry rescans. tcb-ledger `eval.scope.source-function`.",
  },
  runtimeRepresentationOwnerFacts: {
    cls: "IDENTITY-KEYED",
    note:
      "canonical-source Reprable.JsRuntime candidate-presence facts, keyed ONLY on an "
      + "original or qualified engine-copied immutable RoutingTable snapshot (`json-logic.ts` "
      + "`runtimeRepresentationInspectionPlan`). The private WeakMap transports the source's "
      + "owner-name set and wildcard flag; it does not cache a selected method, membership "
      + "verdict, authority, projection or reader callback result. Internal pooled facts use "
      + "the fixed harness source in a no-perform frame. Exact canonical served hooks and "
      + "absent fixture/dynamic-constructor posture gate hits; existing hook/fixture generations "
      + "fence stores through execution and decoding. Custom hooks compute uncached. "
      + "Unqualified caller tables are never cached; version changes supply a new snapshot. Every read checks "
      + "the current lexical frames through source `representationProjectionFrameCandidate`, "
      + "preserves general scopes as potential candidates, and runs complete selection with "
      + "fresh visibility, account, priority and conflict checks before semantic inspection. "
      + "A lost entry recomputes the same immutable snapshot fact; it does not detach a "
      + "reader's authority or suppress a new frame candidate.",
  },
  canonicalImportFrames: {
    cls: "IDENTITY-KEYED",
    note:
      "maps a closure-carried import FRAME object's identity to its first descriptor-validated "
      + "frozen names/aliases snapshot (`json-logic.ts` `canonicalImportFrame`), or to the frame "
      + "itself when all three objects are frozen. This pins lexical name bindings, not just a "
      + "speed result: a live key keeps its first snapshot. `closureLexicalImports` validates "
      + "the caller-data list before this lookup, and `sameImportFrame` now reuses the caller "
      + "context only for literal frame identity, never for a mutable original whose snapshot "
      + "it holds. The registered-function import-frame path is separate; see "
      + "`eval.scope.import-snapshot` in the TCB ledger for the closure-carried condition.",
  },
  dynamicConstructorTables: {
    cls: "IDENTITY-KEYED",
    note:
      "the dynamic `type_def` constructor table, keyed on its evaluator-state owner — "
      + "ordinary `dispatchEngineBodyWithDeciderCtx` `{...ctx}` copies still cannot see it "
      + "(`chk.ctor.harness-copy`). `constructorTableStable` now refuses to certify against "
      + "a context that has one. The narrow admitted reader-metadata fork explicitly preserves "
      + "the existing root or lexical state owner through readerMetadataContextStateOwners.",
  },
  readerMetadataContextStateOwners: {
    cls: "IDENTITY-KEYED",
    note:
      "private evaluator-frame aliases created by readerStateEvaluateContext for "
      + "readerSourceMetadataEvaluateContext, authoringInvocationEvaluateContext and "
      + "noPerformEvaluateContext, and by the equivalent lexical-frame fork. Each alias retains the exact preexisting "
      + "dynamic type_def state owner while its ambient reader packet remains fresh. Keys and "
      + "values are actual host EvaluateContext objects; packets and authored row identities "
      + "cannot select an owner. No source lookup, selected instance, verdict, authority or "
      + "grant is cached. Descriptor copying preserves the original frozen posture and "
      + "AuthorityRef identity; ordinary context copies receive no alias automatically.",
  },
  privatePatternPlanCaches: {
    cls: "IDENTITY-KEYED",
    note: "a pattern-plan CACHE keyed on context identity. A miss recomputes, so a lost entry costs time, not truth.",
  },
  privateDataOwnerBindings: {
    cls: "IDENTITY-KEYED",
    note:
      "declared binding metadata, keyed on interpreter-owned DataContext objects "
      + "(`json-logic.ts` `invokeFunction` and `matchPattern`). A registered parameter "
      + "carries its type and source-function ID; a scalar constructor-field binder carries "
      + "the source-selected field type and exact captured registered Type owner identity. "
      + "This is required metadata, not a cached verdict: `copyOwnDataContext` explicitly "
      + "carries it into evaluator copies, pattern merges carry each binder's declaration, "
      + "and `defineDataContextBinding` invalidates the shadowed name. Own-data lookup "
      + "disambiguates only an ambiguous scalar Number, resolving the declaration through "
      + "the current reader's call-site typing hooks or captured Type declaration frame "
      + "before fresh Reprable selection. It carries no authority, selected method, "
      + "membership result or projection. An arbitrary external DataContext copy does not "
      + "inherit these private facts; preserving them across interpreter copies is part of "
      + "the semantic projection boundary, not a claim that losing the entry only costs time.",
  },
  fieldCurrentWireIndexByRegistry: {
    cls: "IDENTITY-KEYED",
    note: "memoizes a registry's field-wire index, keyed on the REGISTRY (the authority's own identity — the P1(a.18) shape), not on a context.",
  },
  evaluationStepObservers: {
    cls: "PROCESS-GLOBAL",
    note: "synchronous completed-step observer extent over the existing evaluator. Borrows a root context only for its finally-bounded lifetime; innermost recording is suspended during callback re-entry. Exact source object and reader-frame ownership fences control snapshot admission. It mints no authority and does not select dispatch, validate evidence or decide perform.",
  },
  _recipeCanonicalStock: {
    cls: "PROCESS-GLOBAL",
    note: "private immutable recipe comparison template over the exact stock source modules, fresh source dispatch pool and strict physical repository identities. Stores one registry/no-perform context after bootstrap. Never captures caller rows, provides a reader-miss fallback, or caches a membership verdict; unavailable artifact prerequisites refuse.",
  },
  RECIPE_CANONICAL_STOCK_MODULES: {
    cls: "PURE",
    note:
      "private literal set containing only std, fixed at module load and never mutated. "
      + "It selects the declaring-module roster of the comparison-only recipe stock registry; "
      + "the fresh stock dispatch pool still receives every stock module's instance rows. "
      + "An out-of-roster definition remains unavailable, never a reader-miss fallback. "
      + "It reads no caller or mutable registry authority. Ledger: recipe.source.route.",
  },
  recipeCanonicalReflections: {
    cls: "IDENTITY-KEYED",
    note:
      "WeakMap keyed on the private recipe STOCK object, then on the string of a plain "
      + "own-data {$ref} with no other keys. Caches only comparison-template reflections "
      + "for that fixed stock lifetime; replacing the stock selects a new cache. An own-data "
      + "master stays private and every caller, including the first, receives a fresh copy. "
      + "Uncopyable outcomes are reflected again. No caller definition or missing reader "
      + "value is supplied from it. Existing side conditions: recipe.source.route.",
  },
  RECIPE_STAGE_BODIES: {
    cls: "PURE",
    note:
      "private literal set of exactly engine:recipeSnapshotFromReaderObservation and "
      + "engine:recipeCardAnalysis, fixed at module load and never mutated. It selects "
      + "eligibility for recipeStageMemo; every other body computes normally. This roster "
      + "reads no authority and is not a purity certificate. Ledger: recipe.card.stage-memo.",
  },
  recipeStageMemo: {
    cls: "PROCESS-GLOBAL",
    note:
      "realm-local, eight-entry LRU of serialized results for the two RECIPE_STAGE_BODIES. "
      + "Key: body fnId, complete own-data argument encoding, harness dispatch-pool version, "
      + "fixture generation and evaluator-hook generation. Computation uses the argument "
      + "copy; a changed code state refuses the store. Active fixtures, unavailable code "
      + "state or refused snapshots compute without reuse; representation-inspection "
      + "suppression bypasses it. Result-copy/encoding refusal does not store; every hit "
      + "decodes a fresh value. No entry leaves the realm. This is the existing "
      + "SIDE-CONDITIONED recipe.card.stage-memo claim: the curated no-perform stages must "
      + "depend only on those inputs. It does not certify reached native leaves; this "
      + "classification records the process-global read, not a new purity proof.",
  },
  privateStockCoreSources: {
    cls: "PROCESS-GLOBAL",
    note: "private source class/instance data captured before the initial mutable global pool is exposed; each stock pool gets new writable copies and restored source provenance, never current global values or reader verdicts.",
  },
  privateStockModuleClassSources: {
    cls: "PROCESS-GLOBAL",
    note: "private immutable module-class registration data captured before global defineClass; preserves original dispatch parameters, methods and scheme/source sidecars without freezing public objects.",
  },
  privateStockMarkerClassSources: {
    cls: "PROCESS-GLOBAL",
    note: "source marker class declarations derived only in a private captured-source pool; fresh pools copy these data rather than inspecting mutable global markers or classes.",
  },
  capturedSources: {
    cls: "IDENTITY-KEYED",
    note: "stock-source-module.ts private original-module snapshots: shared source graphs captured before global row registration, source-only fixed-roster definitions captured at assembly. Failures remain failures. Native pointers are separate host bindings; every data egress is copied, including private Uint8Array buffers. No caller account data, verdict or authority is stored.",
  },
  fieldCurrentWireFixtures: {
    cls: "PROCESS-GLOBAL",
    note: "test seam consulted BEFORE the real authority in `fieldKeyCurrentWire`. Exported and unguarded.",
  },
  ctorDeclaredWiresFixtures: {
    cls: "PROCESS-GLOBAL",
    note: "test seam consulted before the real table on the internal-harness lane. Owns ledger row `chk.ctor.fixture-seam`.",
  },
  _fnTypeMarkerTestFixtures: {
    cls: "PROCESS-GLOBAL",
    note: "test seam substituting a declared signature. No ledger row of its own; recorded here so it is not invisible.",
  },
  _fnBodyTestFixtures: {
    cls: "PROCESS-GLOBAL",
    note: "test seam substituting a function body. No ledger row of its own; recorded here so it is not invisible.",
  },
  // Added in review round 1: each of these is a module-level table in a file
  // that carries decider natives, and each was silently absent because the
  // first cut skipped anything without an authored note.
  privateNativeInvocationKeys: {
    cls: "IDENTITY-KEYED",
    note:
      "required active ctx-native invocation metadata, keyed on the actual host EvaluateContext. "
      + "It retains only the active host handler identity and frozen written/resolved/selected keys; "
      + "the getter returns function-free keys only to that same handler. Nested calls restore the "
      + "previous entry in finally and outer completion/throw deletes it. It is not a result cache "
      + "and stores no authority, dispatch instance, verdict or reflection snapshot. Losing active "
      + "metadata would lose alias provenance, so installation/restoration is a semantic obligation.",
  },
  privateRoutingTables: {
    cls: "IDENTITY-KEYED",
    note:
      "the bare-name routing snapshot, read on every bare-name resolution INCLUDING inside decider "
      + "bodies. P1(a.18) re-keyed it from the context OBJECT onto the registry's own stable getter — "
      + "the repair pattern this phase reuses — so a context copy no longer loses it.",
  },
  stableMarshalledCtorDefs: {
    cls: "IDENTITY-KEYED",
    note: "memoizes a marshalled constructor-def projection. A miss recomputes, so a lost entry costs time, not truth.",
  },
  repositoryTraversalFieldKeys: {
    cls: "PROCESS-GLOBAL",
    note:
      "process-lifetime field-key table for the traversal walk. Not reached by the constructor or "
      + "wire reads this phase repaired; classified so it is not invisible. ⚠ REVIEW ROUND 10 "
      + "CORRECTED THE 'not reached' half by measurement: BOTH `canonicalListHeadFieldKey` natives "
      + "forward here through `repositoryListHeadFieldKey`, and this table hands back the CACHED "
      + "FieldKey OBJECT rather than a copy — a caller that mutates it poisons every later read, "
      + "and `marshalTraversalType` grafts the same alias into its public result (executed: a "
      + "correctly-keyed `List String` validated `true`, then `false` after the alias was mutated). "
      + "PRE-EXISTING and not repaired here; the census's job was to stop calling those two natives "
      + "PURE, which it now does.",
  },
  traversalRepositoryIdentityLock: {
    cls: "PROCESS-GLOBAL",
    note:
      "the repository identity lock, lazily read once and memoised for the process. Reached on the "
      + "same forward path as `repositoryTraversalFieldKeys`. It was invisible to three successive "
      + "widenings of the table enumerator because it is declared with an IMPLICIT undefined "
      + "(`let x: ReadonlyMap<…> | undefined;`) and every pattern so far required an initialiser.",
  },
  traversalIdentifiedSubstituteInProgress: {
    cls: "PROCESS-GLOBAL",
    note: "process-global re-entrancy guard for the traversal substitute walk. Control state, not an authority a verdict rests on.",
  },
  parserNamespaceByRegistry: {
    cls: "IDENTITY-KEYED",
    note: "compiled-parser representation cache keyed on the exact host REGISTRY object identity. This key is neither an AuthorityRef nor an evaluator-context identity, and cache reuse grants no authority. Generated common/all-shard identity domains are validated before cache/browser fast paths; namespace and shard freshness state also require the exact canonical domain identity. A changed domain replaces cached state; missing, malformed or stale domains refuse the compiled path.",
  },
  resolverNamespaceByRegistry: {
    cls: "IDENTITY-KEYED",
    note: "compiled-resolver representation cache keyed on the exact host REGISTRY object identity, with the same domain admission and invalidation as its parser twin. This key is neither an AuthorityRef nor an evaluator-context identity, and cache reuse grants no authority. Generated common/all-shard identity domains are validated before cache/browser fast paths; namespace and shard freshness state also require the exact canonical domain identity. A changed domain replaces cached state; missing, malformed or stale domains refuse the compiled path.",
  },
  privateHarnessCompiledArtifactStamps: {
    cls: "PROCESS-GLOBAL",
    note: "per-artifact freshness stamps for the harness's compiled-artifact evaluation snapshot. Build-time evidence, not a membership authority.",
  },
  engineDeterministicLeaves: {
    cls: "PROCESS-GLOBAL",
    note:
      "S1 engine-body memo: the realm's copy of the Fenel list `engine:anaDeterministicNativeLeaves`, "
      + "read once from the fixed private harness (`deterministicNativeLeaves`). Read only by the memo's "
      + "store decision, never by a decider native; an unreadable list stores nothing. Ledgered in "
      + "design/tcb-ledger.md row engine.memo.engine-body-replay.",
  },
  engineHostVariantLeaves: {
    cls: "PROCESS-GLOBAL",
    note:
      "S1b engine-body memo: the realm's copy of the Fenel list `engine:anaHostVariantNativeLeaves`, read "
      + "once from the fixed private harness. Read only by the memo's store decision (which entries carry a "
      + "host fingerprint), never by a decider native. Ledgered in design/tcb-ledger.md row "
      + "engine.memo.engine-body-replay.",
  },
  engineUnmemoizedBodies: {
    cls: "PROCESS-GLOBAL",
    note:
      "S1 engine-body memo: the realm's copy of the Fenel list `engine:anaUnmemoizedBodies` (bodies whose "
      + "memo key work exceeds their computation), read once from the fixed private harness. Read only by "
      + "`dispatchEngineBody` to choose the plain no-memo path, which is sound for every body; an unreadable "
      + "list is empty (the memo as before). Never read by a decider native. Ledgered in design/tcb-ledger.md "
      + "(engine.memo.engine-body-replay, the 2026-10-30 memo-cost amendment).",
  },
  stableCompileSlotVerdicts: {
    cls: "IDENTITY-KEYED",
    note: "memoizes compile-slot verdicts. A miss recomputes; cache, not authority.",
  },
  // Build-time constants and warn-once sets. Classified so that an
  // UNCLASSIFIED row means "something NEW appeared" rather than "four permanent
  // residents nobody ever reads" — a gate whose steady state is a handful of
  // known-ignorable rows is a gate people learn to skim.
  KNOWN_OPS: {
    cls: "PURE",
    note: "a frozen literal set of evaluator op names, fixed at module load. No authority.",
  },
  PARSER_ENTRY_SET: {
    cls: "PURE",
    note: "a frozen literal set of compiled-parser entry fnIds, fixed at module load. No authority.",
  },
  parserStaleWarnedShards: {
    cls: "PROCESS-GLOBAL",
    note: "warn-ONCE bookkeeping for stale compiled-parser shards. Affects logging only; no verdict reads it.",
  },
  resolverStaleWarnedShards: {
    cls: "PROCESS-GLOBAL",
    note: "warn-once bookkeeping for stale compiled-resolver shards. Logging only, same as its parser twin.",
  },
  // Surfaced by review round 3's widened enumerator: frozen literal key sets
  // fixed at module load. Each is a constant of the LANGUAGE, not an authority
  // any verdict reads from a registry, so none can move under a decider.
  JSON_LOGIC_IMAGE_TAGS: {
    cls: "PURE",
    note:
      "the seven constructor tags of the JsonLogic image (`JlNull` … `JlObject`) that "
      + "`marshalAnnotationType` recognizes when the json-logic-to-syntax adapter carries an "
      + "annotation's type opaquely (modules-as-values Phase 2d). A literal set fixed at module "
      + "load and never mutated. No authority.",
  },
  PATTERN_META_KEYS: {
    cls: "PURE",
    note: "the reserved pattern meta-keys ($tag/$bind/$guard). A frozen literal set fixed at module load.",
  },
  FENEL_TYPE_KEYS: {
    cls: "PURE",
    note: "the FenelType `$`-key spellings. A frozen literal set fixed at module load.",
  },
  PRINTER_TYPE_KEYS: {
    cls: "PURE",
    note: "printer-side type-key spellings. A frozen literal set fixed at module load.",
  },
  PRINTER_DECL_KEYS: {
    cls: "PURE",
    note: "printer-side declaration-key spellings. A frozen literal set fixed at module load.",
  },
  REFUTATION_CLAUSES: {
    cls: "PURE",
    note: "the three audit refutation clause names (purity / totality / signature-honesty). A frozen literal set.",
  },
  TRAVERSAL_KEYLESS_WALK_SKIP: {
    cls: "PURE",
    note: "traversal walk-skip key names. A frozen literal set fixed at module load.",
  },
  TRAVERSAL_LEGACY_SET_KEYS: {
    cls: "PURE",
    note: "legacy set-key spellings the traversal walk tolerates. A frozen literal set fixed at module load.",
  },
  _mergedHierarchyKeys: {
    cls: "PROCESS-GLOBAL",
    note:
      "the LAZILY built process-merged hierarchy key set behind `namedInHierarchy` — built once on "
      + "first use and never rebuilt, so it is a process-lifetime authority, not a cache. Invisible to "
      + "the census until review round 4 widened the enumerator to lazy bindings; recorded now because "
      + "a decider verdict reads it.",
  },
};

function sideTables(): TableRow[] {
  const rows: TableRow[] = [];
  for (const file of ["json-logic.ts", "engine-bodies-dispatch.ts"]) {
    const src = strip(readFileSync(join(ENGINE_SRC, file), "utf8"));
    // ⚠ WIDE ON PURPOSE (review round 3). The first cut required
    // `^const NAME = new (Weak)?(Map|Set)<`, so an UNTYPED `new Map()`, a `let`,
    // an `export`, or a lazily-initialised table was invisible — and a new
    // process-global read from one of those left `--check` printing FRESH,
    // which is the single thing this instrument exists to prevent. Now: any
    // module-level binding of a Map/Set/WeakMap/WeakSet, typed or not.
    // ⚠ TWO SHAPES, because review round 4 showed the eager one is not enough:
    // `let _mergedHierarchyKeys: Set<string> | null = null` is a LAZILY
    // initialised side table read by a decider helper, and it was absent from
    // the census while the doc comment claimed totality. A table that announces
    // itself only at first use is exactly the one a drift gate must not miss.
    const eager = /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*new\s+(?:Weak)?(?:Map|Set)\b/gm;
    // ⚠ AND THE INITIALISER IS OPTIONAL (review round 10). This required an
    // explicit `= null` / `= undefined`, so a declaration that relies on
    // IMPLICIT undefined was invisible — measured: `let
    // traversalRepositoryIdentityLock: ReadonlyMap<string, string> | undefined;`
    // is a module-global lazily filled by `repositorySystemTypeFieldKey` and
    // read on the path both `canonicalListHeadFieldKey` natives forward to. It
    // is the third widening of this one pattern, and the shape of the miss has
    // been the same every time: the enumerator matched a SPELLING of "a table"
    // rather than the property that matters, which is module-level mutable
    // state a decider can reach.
    const lazy = /^(?:export\s+)?(?:let|var)\s+([A-Za-z_$][\w$]*)\s*:\s*[^=;]*\b(?:Weak|Readonly)?(?:Map|Set)\s*<[^=;]*(?:=\s*(?:null|undefined)\s*)?;/gm;
    const seen = new Set<string>();
    for (const m of [...src.matchAll(eager), ...src.matchAll(lazy)]) {
      if (seen.has(m[1]!)) continue;
      seen.add(m[1]!);
      const name = m[1]!;
      const known = TABLE_NOTES[name];
      // ⚠ AN UNANNOTATED TABLE IS RECORDED, NOT SKIPPED (review round 1). The
      // first cut did `continue` here while the doc claimed to enumerate every
      // module-level table in these files — so a NEW context-keyed side table
      // could be added and read from a native and `--check` would still print
      // FRESH, which is the one thing this instrument exists to prevent. An
      // unknown table now lands as UNCLASSIFIED and trips the gate on sight.
      rows.push(known === undefined
        ? {
          file,
          table: name,
          cls: "UNCLASSIFIED",
          note:
            "NO CLASSIFICATION AUTHORED. A module-level side table in a file that carries the "
            + "decider natives. Classify it in TABLE_NOTES — if a decider read reaches it and it "
            + "is PROCESS-GLOBAL or IDENTITY-KEYED, it is a new instance of the P1(a.20) defect "
            + "shape and needs a ledger row, not just a regenerated census.",
        }
        : { file, table: name, cls: known.cls, note: known.note });
    }
  }
  return rows.sort((a, b) => (a.file + a.table).localeCompare(b.file + b.table));
}

function build(): Census {
  const raw = readFileSync(join(ENGINE_SRC, "engine-bodies-dispatch.ts"), "utf8");
  const stripped = strip(raw);
  // The forwarding frontier, derived from the source rather than enumerated as
  // three seam spellings (review round 10 — see `topLevelFunctionNames`).
  const forwardTargets = topLevelFunctionNames([
    stripped,
    strip(readFileSync(join(ENGINE_SRC, "json-logic.ts"), "utf8")),
  ]);

  // The DOORS: every site that MERGES the decider natives, plus the seams that
  // reach a decider body without merging any. Recorded as a set so a NEW door
  // is drift.
  //
  // ⚠ Two corrections from review round 1. (a) The first cut counted every
  // OCCURRENCE of the factory names, so it listed the factory DEFINITIONS and
  // the test seam's own signature as "doors" — three of eight rows were not
  // merge sites at all. A merge site is an argument to `Object.assign`, so the
  // pattern requires the trailing comma that only an argument position has.
  // (b) It omitted the plain `dispatchEngineBody` entry, which reaches decider
  // bodies with ZERO decider natives merged and against `getHarness().ctx`
  // DIRECTLY rather than a copy — the door that refuted P1(a.15)'s
  // door-closure premise, and the one `syn.witness.ctx-authority` names for the
  // `engine:solve*` family. It belongs in the census precisely because it is
  // the door a door-scoped argument forgets.
  //
  // ⚠ NO LINE NUMBERS. They made every edit above a door trip `--check`, which
  // trains blind regeneration — the exact drift this file warns against.
  const doors = new Set<string>();
  // ⚠ rights R3a — THE ARGUMENT LIST IS NOT PART OF THE DOOR. This matched
  // `setAlgebraDeciderNativesCtx(),` — with EMPTY parens — so the moment the
  // factory took its required `requestAccount` argument the instrument reported
  // the three merge sites as GONE and the tally as 5 → 2. That is an instrument
  // drift reading as a security improvement, which is the worst direction for a
  // drift gate to fail in, and regenerating past it is exactly the blind
  // regeneration this file warns against. The pattern now accepts any argument
  // list, like its two siblings below have always done.
  for (const _ of stripped.matchAll(/setAlgebraDeciderNativesCtx\([^)]*\),/g)) {
    doors.add("merges setAlgebraDeciderNativesCtx(requestAccount) into a decider nativesCtx");
  }
  for (const _ of stripped.matchAll(/validationRuntimeNativesCtx\([^)]*\),\n/g)) {
    doors.add("merges validationRuntimeNativesCtx(state, coerceContext, formData)");
  }
  // ⚠ The CONTAINMENT merge was missing from the door list even after review
  // round 2 added its factory to the native scan (round 3, N4).
  // `dispatchContainmentBody` merges it over `{...ctx}` exactly as the others
  // do. A door tally that omits a door is the same defect as a factory list
  // that omits one, one field over.
  for (const _ of stripped.matchAll(/containmentDeciderNativesCtx\([^)]*\),/g)) {
    doors.add("merges containmentDeciderNativesCtx(options) into a decider nativesCtx");
  }
  const mergeCount = [...stripped.matchAll(/setAlgebraDeciderNativesCtx\([^)]*\),/g)].length
    + [...stripped.matchAll(/validationRuntimeNativesCtx\([^)]*\),\n/g)].length
    + [...stripped.matchAll(/containmentDeciderNativesCtx\([^)]*\),/g)].length;
  doors.add(`decider-native merge sites: ${mergeCount}`);
  // ⚠ A DOOR THAT MERGES NOTHING AND CANNOT (review round 10). `dmNatives` in
  // `modules/decidable-membership.ts` publishes `set:contains` /
  // `set:decideSubset` / `set:decideDisjoint` / `set:decideEmpty` through the
  // PLAIN `nativeImpls` table, whose entries take no context parameter — so the
  // evaluator has nothing to thread and these deciders answer from fallback /
  // process authority however the caller was contextualised. Measured, with a
  // real account registry: `contains(set, {title:"x"}, {}, accountCtx)` is
  // `Just true` while `invokeCallable("set:contains", [set, {title:"x"}],
  // accountCtx)` is `Just false` — the same judgment, opposite answers, one of
  // them through the registered name. Parent-identical, so not this phase's
  // regression, and NOT repaired here.
  //
  // Its natives are deliberately NOT enumerated into the classified population:
  // doing so would report them under a class, and no class here means "reached
  // through a door that structurally cannot carry authority". Naming the door
  // is the honest form — the instrument's frontier, stated, not a silence.
  const dmSrc = readFileSync(join(ENGINE_SRC, "modules", "decidable-membership.ts"), "utf8");
  if (/nativeImpls:\s*rekeyNativesById\(dmNatives/.test(strip(dmSrc))) {
    doors.add(
      "modules/decidable-membership.ts `dmNatives` → plain `nativeImpls` — a REGISTERED decider door "
      + "whose natives take NO context parameter, so no caller authority can reach them. FRONTIER: "
      + "its natives are not classified below, because the door cannot carry what they would be "
      + "classified on. Measured to answer opposite the direct call under an account registry.",
    );
  }
  if (/__invokeDeciderRegistryReadNativeForTests/.test(stripped)) {
    doors.add("__invokeDeciderRegistryReadNativeForTests — invokes a decider read native, merging NOTHING");
  }
  if (/export function dispatchEngineBody\(/.test(stripped)) {
    doors.add(
      "dispatchEngineBody — reaches decider bodies with ZERO decider natives merged, "
      + "against getHarness().ctx DIRECTLY (not a copy); the door that refuted P1(a.15)",
    );
  }
  if (/export function dispatchEngineBodyWithDeciderCtx\(/.test(stripped)) {
    doors.add(
      "dispatchEngineBodyWithDeciderCtx — merges the decider natives over a SHALLOW COPY "
      + "of getHarness().ctx; identity-keyed side tables do not survive the spread",
    );
  }
  if (/export function dispatchedRepresentationsForTarget\([\s\S]*?caller\?: EvaluateContext/.test(stripped)
    && /_authority:\s*caller\._authority/.test(stripped)
    && /_specRegistry:\s*caller\._specRegistry/.test(stripped)) {
    doors.add(
      "dispatchedRepresentationsForTarget(target, caller) — CALLER-AUTHORITY for UI instance selection: "
      + "copies the caller's authenticated authority handle, instance registry, lexical dictionaries and active tags. "
      + "The curated harness still owns helper code, constructors and native bindings. This is a bounded display "
      + "projection, not a claim that general callable dispatch or decider reads use the reader's account.",
    );
  }

  // rights R2a (2026-09-11) — THE AUTHORITY GATE IS A DOOR, and it is the one
  // door whose whole job is to READ an ambient authority. The census exists
  // because "a decider's verdict is entitled only if the authority it READ is
  // the authority the exercise will read"; the reference monitor is the
  // exercise, so its own reads belong here by that sentence's own terms.
  //
  // Both are CALLER-AUTHORITY, and the distinction matters: the key is the
  // handle carried IN THE CALLER'S FRAME (`frame._authority`), not anything
  // derived from a context's identity, an account string, or a process global.
  // A frame clone by spread carries the same handle; a hand-built frame carries
  // none and is refused.
  // rights R3a — the OWNERSHIP DERIVATION is a caller-authority read of exactly
  // the same kind, one layer out: `frameAccount` authenticates the handle in the
  // caller's frame and takes the account off the RECORD. It is not a context
  // field, not a process global, and not derivable from a hand-built frame.
  const authoritySrc = readFileSync(join(ENGINE_SRC, "authority.ts"), "utf8");
  if (/export function frameAccount/.test(strip(authoritySrc))) {
    doors.add(
      "frameAccount(ctx) → authenticateAuthority(ctx._authority)?.accountId — CALLER-AUTHORITY. "
      + "rights R3a's ownership coordinate is DERIVED from the caller's minted handle, never "
      + "authored and never read from a context slot. A boot, harness or kernel frame "
      + "authenticates to no account and therefore sees no account-owned dispatch row; an empty "
      + "string is not an account. It is a SELECTION input and never a judgment input.",
    );
  }

  const performSrc = readFileSync(join(ENGINE_SRC, "perform.ts"), "utf8");
  if (/authenticateAuthority\(frame\._authority\)/.test(strip(performSrc))) {
    doors.add(
      "perform → authenticateAuthority(frame._authority) — CALLER-AUTHORITY. The reference "
      + "monitor's own read, keyed on the handle in the caller's frame rather than on any "
      + "context identity or process state. An absent or unminted handle refuses.",
    );
  }
  // rights R2b — the judged act is the CANONICAL one (`argued`), not the
  // requested one. The canonicalisation reads the perform table the CALLER'S
  // FRAME carries (`frame._performTable`), so it is caller-authority for the
  // same reason the handle is: a hand-built frame carries no table and refuses.
  if (/table\.judge\(record\.envelope, argued\)/.test(strip(performSrc))) {
    doors.add(
      "perform → table.judge(envelope, argued) — CALLER-AUTHORITY. Evaluates `authority:permits` "
      + "under the registry's KERNEL FRAME, which carries no perform table, no spec registry "
      + "and no block scope, so the judgment cannot itself reach a table-resident act. The "
      + "envelope judged is the one authenticated from the caller's handle, never an ambient one. "
      + "rights R2b: the ACT is canonicalised first, through the alias map of the table on the "
      + "caller's own frame — registry-static data, not process state, and unreachable from a "
      + "frame that carries no table.",
    );
  }

  const natives: NativeRow[] = [];
  // ⚠ THE FACTORY PREAMBLE IS PART OF THE READ (review round 4). A native's own
  // body is not the whole of what it reads: the code BEFORE `return {` binds
  // what the closures capture, so swapping `const registry = options.registry`
  // for `const registry = getHarness().reg` — a caller-to-harness authority
  // substitution — changed nothing any per-native digest covers, and `--check`
  // stayed FRESH. Digesting the preamble closes that.
  // ⚠ THREE factories, not two (review round 2). `containmentDeciderNativesCtx`
  // was omitted, and it is a real decider door: `dispatchContainmentBody` merges
  // it over `{...ctx}` exactly as the others do. A census that omits a door is
  // not scoped by door membership, it is scoped by whichever doors its author
  // happened to remember — the failure the brief's `_c` grep was rejected for.
  for (const factory of [
    "setAlgebraDeciderNativesCtx",
    "containmentDeciderNativesCtx",
    "validationRuntimeNativesCtx",
  ]) {
    const observed = factorySource(raw, factory);
    doors.add(
      `${factory} preamble digest: `
      + createHash("sha256")
        .update(stripComments(observed.preamble).replace(/\s+/g, " ").trim())
        .digest("hex"),
    );
    for (const entry of observed.entries) {
      const { cls, markers } = classify(entry.body, forwardTargets);
      // Hash the STRIPPED body: whitespace-collapsed so a reflow is not a
      // change, but every code edit is.
      const codeDigest = createHash("sha256")
        .update(stripComments(entry.body).replace(/\s+/g, " ").trim())
        .digest("hex");
      natives.push({ door: factory, native: entry.name, cls, markers, codeDigest });
    }
  }
  natives.sort((a, b) => (a.door + a.native).localeCompare(b.door + b.native));

  const counts: Record<string, number> = {};
  for (const n of natives) counts[n.cls] = (counts[n.cls] ?? 0) + 1;
  counts["TOTAL-NATIVES"] = natives.length;
  counts["TOTAL-SIDE-TABLES"] = sideTables().length;

  return {
    schema: "fenel.ambient-read-census.v1",
    doors: [...doors].sort(),
    natives,
    sideTables: sideTables(),
    counts,
  };
}

const census = build();
const rendered = JSON.stringify(census, null, 2) + "\n";

if (process.argv.includes("--check")) {
  const unclassified = census.sideTables.filter((row) => row.cls === "UNCLASSIFIED");
  if (unclassified.length > 0) {
    console.error(
      "ambient-read-census: UNCLASSIFIED side tables. Author their classification in TABLE_NOTES; "
      + "regenerating the census cannot clear this refusal:\n"
      + unclassified.map((row) => `  ${row.file}: ${row.table}`).join("\n"),
    );
    process.exit(1);
  }
  let committed: string;
  try {
    committed = readFileSync(OUT, "utf8");
  } catch {
    console.error("ambient-read-census: no committed census; run without --check to write one.");
    process.exit(1);
  }
  if (committed !== rendered) {
    console.error(
      "ambient-read-census: DRIFT. The decider surface's ambient reads changed and the\n"
      + "committed census did not. Re-run without --check, then read the diff: a new\n"
      + "PROCESS-GLOBAL or IDENTITY-KEYED row is a new instance of the P1(a.20) defect\n"
      + "shape and needs a ledger row, not just a regenerated file.",
    );
    process.exit(1);
  }
  console.log("ambient-read-census: FRESH");
} else {
  writeFileSync(OUT, rendered);
  const c = JSON.parse(rendered) as Census;
  console.log(`ambient-read-census: wrote ${OUT}`);
  for (const [k, v] of Object.entries(c.counts)) console.log(`  ${k.padEnd(20)} ${v}`);
}
