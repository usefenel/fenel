/**
 * signature-substrate Phase 4+4b slice 3c — the root enumerator (3c-D3), the
 * conservative honesty detector (3c-D3), and the typed per-root claim artifact
 * (3c-D4).
 *
 * WHAT THIS IS, STATED BEFORE ANYTHING ELSE. This emits an **inert analysis
 * artifact with NO authority**. It never issues, and cannot issue, a positive
 * honesty certificate: `Honest` is not one of the outcomes, and the absence of
 * a detector hit is never read as evidence of honesty. P4-D5 (slice 3f) owns
 * certificate authority, the branded issuer, and
 * `generate-signature-primitive-manifest.ts`; this artifact is one of the
 * inputs D5 checks its own independently-derived inventory AGAINST. Keeping the
 * two separate is what stops a self-authorizing loop where one generator
 * discovers roots, infers honesty, writes rows, and a gate then trusts row
 * presence.
 *
 * THREE DELIBERATE CONSERVATISMS:
 *
 *  1. `Function.prototype.toString` is used ONLY as a REFUTER INPUT — text to
 *     find a witness of an escape in — and NEVER as implementation identity or
 *     as a proof of honesty. The parent brief forbids it as identity
 *     ("Do not use object identity or `Function.prototype.toString` as
 *     implementation identity"), and that prohibition is about ADMITTING a
 *     root. Reading source to REFUTE one is sound in a way reading it to admit
 *     one is not: a lying `toString` can only cost us a missed refutation,
 *     which lands in `UnknownFenced`, never a false admission. Build-input
 *     identity (the conservative source-universe digest below) is a separate,
 *     coarse, over-invalidating field.
 *
 *  2. The enumerator reads the natives maps from `registry.evaluateContext()`,
 *     which is where they actually live — NOT from `registry.nativeImpls` /
 *     `registry.nativeImplsCtx`, which do not exist on `ModuleRegistry`. The
 *     slice-3b census (`signature-phase-4-census.ts`) casts for those two
 *     absent properties and therefore classifies EVERY host native as a body or
 *     an external handler while still printing a plausible-looking table. That
 *     defect was found by the 3c design review; this module is the one
 *     authority so the two cannot drift again.
 *
 *  3. Every root gets exactly one outcome, and the harness reports its OWN
 *     blindness as a number plus a set of conservation identities that fail
 *     loudly. A detector that got blinder must not be able to go green.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

import type { FenelFunction, FenelType } from "../src/types";

// ---------------------------------------------------------------------------
// Canonical JSON — key-sorted, array order preserved. Capture serialization
// only; NOT the S2 certificate byte encoder, and never certificate hash
// material.
// ---------------------------------------------------------------------------

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort(compareCodeUnits)) {
      out[key] = sortKeysDeep(record[key]);
    }
    return out;
  }
  return value;
}

export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value), null, 2);
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// PORTABLE SOURCE HASHING (slice 3jw rider 1, 2026-08-08).
//
// This artifact hashes SOURCE FILES, and it used to hash their CHECKOUT bytes.
// `.gitattributes` pins `*.fenel` and `generated/*.ts` to `eol=lf`, but says
// nothing about the rest of `*.ts` — so with `core.autocrlf=true` a Windows
// checkout materializes CRLF where an `ubuntu-latest` + `actions/checkout@v4`
// run materializes LF. MEASURED at the time this was written: 218 of the 470
// declared source rows disagreed between the two checkouts, so an artifact
// generated on Windows would have been REJECTED by CI's
// `--check` + `audit-effects` freshness gate, and vice versa.
//
// The repair is to hash the CANONICAL LF form, exactly as the parse-cache and
// compiled-parser layers already LF-canonicalize at read (see `.gitattributes`'
// own "defense in depth" note). It is deliberately exported and CONSUMED by
// `audit-effects.ts`'s freshness half rather than duplicated there: the two
// sides must agree or the drift gate silently flips meaning, and a shared
// symbol makes that structural instead of conventional.
//
// This is a PORTABILITY canonicalization, not a semantic one — it changes
// which bytes are hashed, never which roots are enumerated or claimed.
// ---------------------------------------------------------------------------

/** The canonical (LF) form of a source file's text, for hashing only. */
export function canonicalSourceText(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

/** SHA-256 over a source file's canonical LF bytes. The ONE definition; the
 *  audit's freshness check imports this rather than re-spelling it. */
export function sourceTextDigest(text: string): string {
  return sha256(canonicalSourceText(text));
}

// ---------------------------------------------------------------------------
// The claim vocabulary (3c-D3). CLOSED, and deliberately WITHOUT an `Honest`
// case — there is no way to spell "this root is honest" in this artifact.
// ---------------------------------------------------------------------------

export type HonestyClaim =
  /** A concrete syntactic witness of a value escaping the declared return
   *  type was found in the root's own source. A refutation, not a suspicion. */
  | "WitnessedEscape"
  /** A human reviewed this exact root and asserted the range claim. An
   *  explicit TRUSTED PREMISE, never inferred. The reviewed list is empty. */
  | "ManuallyAttested"
  /** Every egress of the root is recursively checked at runtime. Not
   *  syntactically provable here; the list is empty. */
  | "RuntimeChecked"
  /** Everything else. The analysis could not conclude — which INCLUDES every
   *  root where no escape witness was found, because absence of a witness is
   *  not evidence of honesty. */
  | "UnknownFenced";

/** Roots a human has reviewed and attested. EMPTY, and it must stay empty
 *  until a slice actually does the review — an attestation is a trusted
 *  premise that enters the TCB, so it is a ledger row, not a convenience. */
const MANUALLY_ATTESTED: ReadonlyArray<{ readonly id: string; readonly evidence: string }> = [];

/** Roots whose every egress is recursively checked. EMPTY: no root ships such
 *  a check today, and claiming one without it would be exactly the
 *  over-claiming this slice exists to stop. */
const RUNTIME_CHECKED: ReadonlyArray<{ readonly id: string; readonly evidence: string }> = [];

// ---------------------------------------------------------------------------
// The source universe — the conservative build-input digest (3c-D4).
//
// Per the parent brief's 2026-07-23 amendment: an exact transitive closure of
// every reachable branch is NOT computable for dynamic Bun/TypeScript code and
// must not be claimed. This is a declared SUPERSET at package granularity:
// over-invalidation is fine, a silently omitted dependency is not. It is
// build-input freshness, NOT runtime bytecode attestation.
// ---------------------------------------------------------------------------

/** A declared superset by DIRECTORY, because a directory is the honest unit.
 *  Listing individual files was the first attempt and it was wrong: it omitted
 *  every `src/modules/*.ts` native map (including the one this slice edited),
 *  almost every `ffi/` leaf, and the `.fenel` declarations — so a native could
 *  change while the artifact still read as fresh. */
const SOURCE_UNIVERSE_DIRS: ReadonlyArray<{ dir: string; suffix: string }> = [
  { dir: "fenel/modules", suffix: ".ts" },
  { dir: "fenel/modules", suffix: ".fenel" },
  { dir: "fenel/std", suffix: ".fenel" },
  { dir: "implementations/typescript/engine/src/modules", suffix: ".ts" },
];

const SOURCE_UNIVERSE_FILES: readonly string[] = [
  "implementations/typescript/engine/src/string-ops.ts",
  "implementations/typescript/engine/src/image-ops.ts",
  "implementations/typescript/engine/src/json-logic.ts",
  "implementations/typescript/engine/src/function-builder.ts",
  "implementations/typescript/engine/scripts/generate-signature-honesty-claims.ts",
  "bun.lock",
];

function walkFiles(dir: string, suffix: string, into: string[]): void {
  let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
  try {
    entries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name === "node_modules") continue;
      walkFiles(full, suffix, into);
    } else if (e.isFile() && full.endsWith(suffix)) {
      into.push(full);
    }
  }
}

function sourceUniverseDigest(): { digest: string; fileCount: number; files: Record<string, string> } {
  const paths: string[] = [...SOURCE_UNIVERSE_FILES];
  for (const { dir, suffix } of SOURCE_UNIVERSE_DIRS) walkFiles(dir, suffix, paths);
  const files: Record<string, string> = {};
  for (const relative of [...new Set(paths)].sort(compareCodeUnits)) {
    try {
      // LF-canonical, so the digest is the same on a Windows and a CI checkout.
      files[relative] = sourceTextDigest(readFileSync(relative, "utf8"));
    } catch {
      // A missing declared input is itself drift — record it rather than
      // silently shrinking the universe.
      files[relative] = "MISSING";
    }
  }
  return { digest: sha256(canonicalJson(files)), fileCount: Object.keys(files).length, files };
}

// ---------------------------------------------------------------------------
// The root enumerator (3c-D3) — ONE authority, profile-aware.
//
// The active-implementation order is `invokeFunction`'s own
// (json-logic.ts): ctx-aware natives by id, then by name, then plain natives by
// id, then by name, then the Fenel body. A function with a body that is
// SHADOWED by a native is a `NativeWithFallback` whose ACTIVE branch is the
// native, so it IS a root; a function with no body and no native is an
// external-handler DECLARATION, which is a root whose implementation may not
// even be installed.
// ---------------------------------------------------------------------------

export type RootOrigin = "HostNative" | "NativeWithFallback" | "ExternalHandlerDeclaration";

export type RootRoute = {
  readonly origin: RootOrigin | "FenelBody";
  readonly tier: "nativeImplsCtx" | "nativeImpls" | "";
  readonly key: string;
  /** More than one DISTINCT implementation is reachable for this function
   *  depending on the call-site spelling. `invokeFunction` selects by the name
   *  the caller wrote, so such a root has no single active implementation and
   *  must never be admitted on the strength of one of them. The reported
   *  `origin`/`tier`/`key` are the CANONICAL-ID route in that case; the
   *  artifact's authority is restricted to canonical-id invocation and the
   *  alias routes are reported alongside rather than folded away. */
  readonly ambiguous?: true;
  /** Present only when `ambiguous` — every candidate spelling and the route it
   *  actually reaches, so the restriction is visible rather than implicit. */
  readonly spellings?: Readonly<Record<string, string>>;
};

/** Resolve a function's active route from the candidate keys that reach it,
 *  in `invokeFunction`'s own order: every ctx-native candidate before any plain
 *  native, and within a tier the id before the code-name spellings.
 *
 *  KEYING ON `fn.id` ALONE WAS WRONG — that was the first version, and round 2
 *  found eight functions (7 SYSTEM, 1 seed) whose native lives under a key the
 *  id never matches (`kernel:verify` is implemented at `kernel:kernelVerify`),
 *  because `rekeyNativesById` builds `<modulePrefix>:<mapKey>` blindly and a
 *  `@codeName` breaks the equality. An id-only scan called every one of them an
 *  external-handler declaration — the exact "went blind while the table still
 *  looked plausible" failure this module exists to prevent. */
/** The route reached by ONE written call spelling — slice 3d-D6.
 *
 *  `invokeFunction` selects PER SPELLING: for the name the caller actually
 *  wrote it tries the ctx map, then the plain map, and only then the body
 *  (json-logic.ts). It does NOT scan every alias. The union scan below models
 *  the FUNCTION's reachable implementations; this models what one call site
 *  actually reaches, and the two differ whenever an alias carries a native the
 *  canonical id does not — there, canonical-id invocation runs the BODY while
 *  the union scan reports the alias's native as the function's active branch.
 *
 *  Both tiers are reported because the tier is not decoration: a ctx-native and
 *  a plain native have DIFFERENT ABIs (the former receives the whole
 *  `EvaluateContext` as its first argument), so two entries that are the same
 *  function object are still not the same route. */
export function activeRouteForSpelling(
  specId: string,
  writtenKey: string,
  natives: Record<string, unknown>,
  nativesCtx: Record<string, unknown>,
  hasBody: boolean,
): RootRoute {
  // ROUND-2 REPAIR. The first version probed `ctx[written] → plain[written]`,
  // which is NOT the runtime ladder: `invokeFunction` resolves the spec first
  // and then tries `nativesCtx[spec.id]` BEFORE `nativesCtx[writtenName]`, and
  // `natives[spec.id]` before `natives[writtenName]` (json-logic.ts). So a call
  // written under an alias still reaches a native registered at the CANONICAL
  // id, and the earlier model reported such a call as body-only. It also
  // mis-ranked an alias ctx-native against a canonical plain native.
  const ladder: Array<["nativeImplsCtx" | "nativeImpls", string]> = [
    ["nativeImplsCtx", specId],
    ["nativeImplsCtx", writtenKey],
    ["nativeImpls", specId],
    ["nativeImpls", writtenKey],
  ];
  for (const [tier, key] of ladder) {
    const map = tier === "nativeImplsCtx" ? nativesCtx : natives;
    if (typeof map[key] === "function") {
      return { origin: hasBody ? "NativeWithFallback" : "HostNative", tier, key };
    }
  }
  return hasBody
    ? { origin: "FenelBody", tier: "", key: "" }
    : { origin: "ExternalHandlerDeclaration", tier: "", key: "" };
}

/** Is this route the same OBLIGATION as that one? Tier included, because the
 *  ABI differs between the maps; the implementation identity is compared too,
 *  so two spellings landing on the same function object at the same tier under
 *  different keys are still one obligation. */
function sameRoute(
  a: RootRoute,
  b: RootRoute,
  natives: Record<string, unknown>,
  nativesCtx: Record<string, unknown>,
): boolean {
  if (a.origin !== b.origin || a.tier !== b.tier) return false;
  if (a.tier === "") return true;
  const pick = (r: RootRoute) => (r.tier === "nativeImplsCtx" ? nativesCtx[r.key] : natives[r.key]);
  return pick(a) === pick(b);
}

/** Resolve a function's active route from the candidate keys that reach it.
 *
 *  KEYING ON `fn.id` ALONE WAS WRONG — that was the first version, and round 2
 *  found eight functions (7 SYSTEM, 1 seed) whose native lives under a key the
 *  id never matches (`kernel:verify` is implemented at `kernel:kernelVerify`),
 *  because `rekeyNativesById` builds `<modulePrefix>:<mapKey>` blindly and a
 *  `@codeName` breaks the equality. An id-only scan called every one of them an
 *  external-handler declaration — the exact "went blind while the table still
 *  looked plausible" failure this module exists to prevent.
 *
 *  SLICE 3d-D6 REBUILT IT ON THE PER-SPELLING RESOLVER, and the winner changed
 *  meaning. 3c unioned the candidates and scanned every ctx candidate before
 *  every plain one, which is not what the runtime does; the reported winner
 *  could therefore be an implementation NO canonical-id call site reaches. The
 *  winner is now the CANONICAL-ID route — `candidateKeys[0]`, which the caller
 *  passes as `fn.id` — and every other spelling is compared against it. A
 *  disagreement sets `ambiguous`, and the artifact's authority is restricted to
 *  canonical-id invocation, with the alias routes reported in `spellings` so a
 *  reader can see what the restriction is hiding rather than having it silently
 *  folded into one winner. */
export function activeRouteFor(
  candidateKeys: readonly string[],
  natives: Record<string, unknown>,
  nativesCtx: Record<string, unknown>,
  hasBody: boolean,
): RootRoute {
  const canonicalKey = candidateKeys[0];
  if (canonicalKey === undefined) {
    return hasBody
      ? { origin: "FenelBody", tier: "", key: "" }
      : { origin: "ExternalHandlerDeclaration", tier: "", key: "" };
  }
  const canonical = activeRouteForSpelling(canonicalKey, canonicalKey, natives, nativesCtx, hasBody);
  const spellings: Record<string, string> = {};
  let ambiguous = false;
  for (const k of candidateKeys) {
    const route = activeRouteForSpelling(canonicalKey, k, natives, nativesCtx, hasBody);
    spellings[k] = route.tier === "" ? route.origin : `${route.tier}:${route.key}`;
    if (!sameRoute(route, canonical, natives, nativesCtx)) ambiguous = true;
  }
  return {
    ...canonical,
    ...(ambiguous ? { ambiguous: true as const, spellings } : {}),
  };
}

/** Single-key form — states the runtime order in one place; what the tests pin. */
export function activeRoute(
  id: string,
  natives: Record<string, unknown>,
  nativesCtx: Record<string, unknown>,
  hasBody: boolean,
): RootRoute {
  return activeRouteFor([id], natives, nativesCtx, hasBody);
}

// ---------------------------------------------------------------------------
// The conservative detector (3c-D3).
// ---------------------------------------------------------------------------

/** A literal nullish egress in the root's own source. Host `undefined` and
 *  host `null` are never canonical inhabitants of ANY Fenel type (cornerstone
 *  7 — no null; absence is `Nothing`), so a literal nullish return IS a
 *  witnessed range escape, whatever the declared type. The one exception is
 *  handled by the caller: a `$unit` / `$void` return, where the runtime
 *  representation question is itself open.
 *
 *  KEPT DELIBERATELY NARROW — return position only. A `WitnessedEscape` is a
 *  REFUTATION and it hard-fails the audit gate, so a false positive is not the
 *  "safe" direction here the way an extra fence would be: it would force
 *  allowlist entries for roots that are fine. Nullish literals in other
 *  positions (`x === undefined`, `a ?? null`, `{k: null}`, a ternary arm) are
 *  therefore NOT matched, and such a root lands in `UnknownFenced` — which is
 *  the honest answer, since the analysis genuinely did not establish anything.
 *  The `|$` alternatives matter: `Function.prototype.toString` of a
 *  concise-body arrow has no trailing delimiter at all. */
const NULLISH_RETURN =
  /return\s+(?:undefined|null)\s*(?:[;,)}\r\n]|$)|return\s*;|=>\s*(?:undefined|null)\s*(?:[;,)}\r\n]|$)/;

/** Strip line/block comments and string & template literals before looking for
 *  an egress. Round 2 produced three natives that return `1` and were
 *  classified `WitnessedEscape` purely because `return null` appeared inside a
 *  comment or a string. A refutation a comment can trigger is not a refutation.
 *  Deliberately simple. **It does NOT parse regex literals, and unlike the
 *  comment/string cases that is not a safe direction:** a function containing
 *  `/return null;/` as a regex is classified `WitnessedEscape` even though it
 *  returns honestly. A false refutation costs an allowlist row for a root that
 *  is fine — noise, not unsoundness, since the artifact admits nothing either
 *  way — but the earlier claim here that over-stripping "only ever loses a
 *  refutation" was wrong in this one direction and is corrected rather than
 *  quietly left standing. */
export function stripNonCode(source: string): string {
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i]!;
    const d = source[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === "\"" || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < n && source[i] !== quote) {
        if (source[i] === "\\") i++;
        i++;
      }
      i++;
      out += "STR";
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function typeTagOf(type: unknown): string {
  if (type === null || typeof type !== "object") return "";
  const record = type as Record<string, unknown>;
  const keys = Object.keys(record);
  // `{$ref:"Unit"}` is the REAL registered spelling of unit; `{$unit:true}` is
  // the structural one. Distinguishing them matters because only unit-ish
  // returns get the nullish-egress exception.
  if (keys.length === 1 && keys[0] === "$ref") return `$ref:${String(record.$ref)}`;
  return keys.length === 1 ? keys[0]! : keys.sort(compareCodeUnits).join("+");
}

function isUnitish(tag: string): boolean {
  return tag === "$unit" || tag === "$void" || tag === "$ref:Unit";
}

export type Detection = {
  readonly claim: HonestyClaim;
  readonly reasons: readonly string[];
  readonly witness?: string;
  /** true when the analysis could not READ the implementation at all — the
   *  harness's own blindness, reported as a number by the caller. */
  readonly unreadable: boolean;
};

export function detect(impl: unknown, returns: FenelType): Detection {
  if (typeof impl !== "function") {
    // NOT counted as blindness. An external-handler DECLARATION has nothing
    // installed to read, which is an expected state (there are 58 in SYSTEM and
    // 212 in seed), not an analysis that lost sight of an implementation.
    // Conflating the two is what made the first `unreadable` ceiling of 0
    // unsatisfiable.
    return {
      claim: "UnknownFenced",
      reasons: ["no-installed-implementation-to-analyse"],
      unreadable: false,
    };
  }
  let raw: string;
  try {
    raw = Function.prototype.toString.call(impl);
  } catch {
    return { claim: "UnknownFenced", reasons: ["source-unreadable"], unreadable: true };
  }
  if (raw.includes("[native code]")) {
    return { claim: "UnknownFenced", reasons: ["host-intrinsic-or-bound-function"], unreadable: true };
  }
  const source = stripNonCode(raw);

  const reasons: string[] = [];
  // An async native returns a PROMISE through the plain-native ABI, which
  // `invokeFunction` passes through unawaited — a different ABI from the
  // external-handler envelope, which IS awaited. Never conclude anything.
  const isAsync = impl.constructor?.name === "AsyncFunction" || /^\s*async[\s(]/.test(source);
  if (isAsync) reasons.push("async-implementation-returns-a-promise-through-the-unawaited-native-abi");
  if (/\bthrow\b/.test(source)) reasons.push("can-throw-totality-is-a-separate-claim");

  const returnTag = typeTagOf(returns);
  const witness = NULLISH_RETURN.exec(source);
  if (witness !== null) {
    if (isUnitish(returnTag)) {
      // Decided explicitly (the brief asked): `matchesShape` accepting nullish
      // for `$unit` is a stale INGRESS TOLERANCE, not a sanctioned
      // representation — but flipping it needs every `$unit` ingress audited,
      // so this stays fenced rather than refuted here.
      return {
        claim: "UnknownFenced",
        reasons: [...reasons, "unit-or-void-return-representation-undecided"],
        witness: witness[0],
        unreadable: false,
      };
    }
    return {
      claim: "WitnessedEscape",
      reasons: [...reasons, "literal-nullish-egress-in-own-source"],
      witness: witness[0],
      unreadable: false,
    };
  }

  // NO WITNESS FOUND. This is where honesty is NOT concluded. Every root
  // without a witness is fenced, and the reasons say what would have to be
  // proved instead.
  reasons.push("no-escape-witness-found-which-is-not-evidence-of-honesty");
  if (/\breturn\s+[A-Za-z_$][\w$]*\s*\(/.test(source) || /=>\s*[A-Za-z_$][\w$]*\s*\(/.test(source)) {
    reasons.push("returns-a-call-result-interprocedural-analysis-not-performed");
  }
  if (returnTag === "$var") {
    // Universal semantics: the claim must hold at EVERY instantiation. The
    // live D5 classifier already fences non-ground roots; this mirrors it.
    reasons.push("declared-return-is-a-bare-type-variable-claim-must-hold-at-every-instantiation");
  }
  return { claim: "UnknownFenced", reasons, unreadable: false };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

type ClaimRow = {
  readonly profile: string;
  readonly id: string;
  readonly origin: RootOrigin;
  readonly tier: string;
  readonly key: string;
  readonly schemeHash: string;
  readonly returnTag: string;
  readonly claim: HonestyClaim;
  readonly reasons: readonly string[];
  readonly witness?: string;
  readonly evidence?: string;
  /** Every native key that reaches this function, in `invokeFunction`'s order.
   *  Recorded because `key` alone names only the WINNER, and a later consumer
   *  must be able to see that other routes exist. */
  readonly routes?: readonly string[];
  /** Two or more DISTINCT implementations are reachable depending on the
   *  call-site spelling. Computed but DROPPED from the row in the first
   *  version — a flag that never leaves the generator protects nothing. */
  readonly ambiguous?: true;
  /** Slice 3d-D6: on an ambiguous root, the route each candidate spelling
   *  actually reaches. The row's `origin`/`tier`/`key` describe the
   *  CANONICAL-ID route only, and this is what that restriction is hiding. */
  readonly spellings?: Readonly<Record<string, string>>;
};

async function buildProfile(
  profile: string,
  modules: readonly unknown[],
): Promise<{
  rows: ClaimRow[];
  counts: Record<string, number>;
  orphanKeys: string[];
  nativeKeyCount: number;
  bodyAmbiguities: Array<{ id: string; spellings: Readonly<Record<string, string>> }>;
}> {
  const { createRepositoryRegistry } = await import("../src/repository-registry");
  const { createDispatchRegistry } = await import("../src/dispatch-registry");

  const registry = createRepositoryRegistry([...(modules as never[])], {
    dispatchRegistry: createDispatchRegistry(),
  });
  const ctx = registry.evaluateContext() as unknown as {
    natives?: Record<string, unknown>;
    nativesCtx?: Record<string, unknown>;
  };
  const natives = ctx.natives ?? {};
  const nativesCtx = ctx.nativesCtx ?? {};

  const attested = new Map(MANUALLY_ATTESTED.map((r) => [r.id, r.evidence]));
  const checked = new Map(RUNTIME_CHECKED.map((r) => [r.id, r.evidence]));

  // THE SECOND DIRECTION. Resolve every native KEY back to the spec it reaches,
  // so a native registered under a code-name key is attributed to its function
  // instead of being invisible, and so a key that reaches NO spec is reported
  // as an orphan rather than silently dropped.
  const keysByFnId = new Map<string, string[]>();
  const orphanKeys: string[] = [];
  for (const key of [...Object.keys(nativesCtx), ...Object.keys(natives)]) {
    // `rekeyNativesById` prefixes the MAP key with the module name, and that map
    // key is the code-name spelling, which need not equal the function id. So
    // resolve the prefixed form first and then the bare tail — `getFunction`
    // resolves by id OR code-name, so `kernel:kernelVerify` finds nothing while
    // `kernelVerify` finds `kernel:verify`. Missing the second lookup is what
    // made these read as orphans.
    //
    // The tail lookup is MODULE-LOCAL, and that guard is load-bearing rather
    // than defensive: the registry's global code-name map is explicitly
    // LAST-WINS on collision (`registry.ts`), and the repository already
    // documents `sample` / `render` as colliding names. A bare global lookup
    // would therefore silently attribute a native to a function in a DIFFERENT
    // module after any future collision — attributing an implementation to a
    // function that does not have it, which is worse than the orphan it fixes.
    // Requiring the resolved id to carry the key's own module prefix turns that
    // silent misattribution back into a reported orphan.
    const colon = key.indexOf(":");
    const prefix = colon >= 0 ? key.slice(0, colon + 1) : "";
    const bare = colon >= 0 ? key.slice(colon + 1) : key;
    let spec = registry.getFunction(key) as FenelFunction | undefined;
    if (spec === undefined && colon >= 0) {
      const byTail = registry.getFunction(bare) as FenelFunction | undefined;
      if (byTail !== undefined && byTail.id.startsWith(prefix)) spec = byTail;
    }
    if (spec === undefined) {
      if (!orphanKeys.includes(key)) orphanKeys.push(key);
      continue;
    }
    const list = keysByFnId.get(spec.id) ?? [];
    if (!list.includes(key)) list.push(key);
    keysByFnId.set(spec.id, list);
  }

  const rows: ClaimRow[] = [];
  /** Functions whose CANONICAL id reaches their Fenel body while some ALIAS
   *  reaches a host native. Not roots, so they carry no claim row — but a
   *  consumer that treats them as "a body" would be wrong for the alias call
   *  site, so they are reported rather than dropped. */
  const bodyAmbiguities: Array<{ id: string; spellings: Readonly<Record<string, string>> }> = [];
  const counts: Record<string, number> = {
    effectiveFunctions: 0,
    fenelBody: 0,
    fenelBodyRouteAmbiguous: 0,
    roots: 0,
    unreadable: 0,
    routeAmbiguous: 0,
    orphanNativeKeys: orphanKeys.length,
    externalHandlerDeclarations: 0,
    WitnessedEscape: 0,
    ManuallyAttested: 0,
    RuntimeChecked: 0,
    UnknownFenced: 0,
  };

  const functions = registry.listFunctions() as FenelFunction[];
  for (const fn of functions) {
    counts.effectiveFunctions!++;
    // The id FIRST (that is `invokeFunction`'s own preference), then every
    // other key that resolves to this spec.
    const candidates = [fn.id, ...(keysByFnId.get(fn.id) ?? []).filter((k) => k !== fn.id)];
    const route = activeRouteFor(candidates, natives, nativesCtx, fn.body !== undefined);
    if (route.origin === "FenelBody") {
      counts.fenelBody!++;
      // ROUND-2 REPAIR — this `continue` used to DROP the ambiguity, and that
      // was the wrong one to drop. A function whose CANONICAL id reaches its
      // Fenel body while an ALIAS reaches a host native is precisely the case a
      // later consumer must not treat as "a body", so it is counted and named
      // here rather than vanishing because the canonical route happens not to
      // be a root.
      if (route.ambiguous) {
        counts.fenelBodyRouteAmbiguous!++;
        bodyAmbiguities.push({ id: fn.id, spellings: route.spellings ?? {} });
      }
      continue;
    }
    counts.roots!++;
    if (route.ambiguous) counts.routeAmbiguous!++;
    if (route.origin === "ExternalHandlerDeclaration") counts.externalHandlerDeclarations!++;

    const info = registry.getFunctionSignatureInfo(fn.id);
    const schemeHash = info === undefined
      ? "NO-SIGNATURE-INFO"
      : sha256(canonicalJson(info.scheme ?? null));

    const impl = route.tier === "nativeImplsCtx"
      ? nativesCtx[route.key]
      : route.tier === "nativeImpls"
        ? natives[route.key]
        : undefined;

    let detection = detect(impl, fn.returns);
    let evidence: string | undefined;
    // A reviewed attestation OVERRIDES only a fence, never a refutation: a
    // human may not attest away a witnessed escape.
    if (detection.claim === "UnknownFenced" && attested.has(fn.id)) {
      evidence = attested.get(fn.id)!;
      detection = { ...detection, claim: "ManuallyAttested" };
    } else if (detection.claim === "UnknownFenced" && checked.has(fn.id)) {
      evidence = checked.get(fn.id)!;
      detection = { ...detection, claim: "RuntimeChecked" };
    }

    if (detection.unreadable) counts.unreadable!++;
    counts[detection.claim] = (counts[detection.claim] ?? 0) + 1;

    rows.push({
      profile,
      id: fn.id,
      origin: route.origin as RootOrigin,
      tier: route.tier,
      key: route.key,
      schemeHash,
      returnTag: typeTagOf(fn.returns),
      claim: detection.claim,
      reasons: detection.reasons,
      ...(detection.witness ? { witness: detection.witness } : {}),
      ...(evidence ? { evidence } : {}),
      ...(candidates.length > 1 ? { routes: candidates } : {}),
      ...(route.ambiguous ? { ambiguous: true as const } : {}),
      ...(route.spellings ? { spellings: route.spellings } : {}),
    });
  }

  rows.sort((a, b) => compareCodeUnits(a.id, b.id));
  orphanKeys.sort(compareCodeUnits);
  const nativeKeyCount = new Set([...Object.keys(nativesCtx), ...Object.keys(natives)]).size;
  counts.nativeKeys = nativeKeyCount;
  bodyAmbiguities.sort((a, b) => compareCodeUnits(a.id, b.id));
  return { rows, counts, orphanKeys, nativeKeyCount, bodyAmbiguities };
}

/** Conservation identities.
 *
 *  THREE OF THESE ARE TAUTOLOGIES AND THAT IS SAID OUT LOUD. The partition,
 *  row-count and body+roots equalities hold by construction over
 *  `listFunctions()` — every listed function is mechanically assigned exactly
 *  one partition, claim and row — so they catch a coding mistake in the
 *  assembly and nothing else. They are NOT evidence that the right
 *  implementation was selected.
 *
 *  The identities that can actually FAIL, and are therefore the ones doing
 *  work, are the last three: a native map that vanished (`nativeKeys === 0`),
 *  a key that reaches no spec (`orphanNativeKeys`), and a host implementation
 *  the analysis could not read. Those are the shapes "the analysis went blind"
 *  actually takes. */
function conservationErrors(
  counts: Record<string, number>,
  rowCount: number,
  nativeKeyCount: number,
): string[] {
  const errors: string[] = [];
  const partition = (counts.WitnessedEscape ?? 0) + (counts.ManuallyAttested ?? 0)
    + (counts.RuntimeChecked ?? 0) + (counts.UnknownFenced ?? 0);
  if (partition !== counts.roots) {
    errors.push(`claim partition ${partition} != roots ${counts.roots}`);
  }
  if (rowCount !== counts.roots) {
    errors.push(`emitted rows ${rowCount} != roots ${counts.roots}`);
  }
  if ((counts.fenelBody ?? 0) + (counts.roots ?? 0) !== counts.effectiveFunctions) {
    errors.push(
      `fenelBody ${counts.fenelBody} + roots ${counts.roots} != effectiveFunctions ${counts.effectiveFunctions}`,
    );
  }
  // The ones that BITE. `roots !== 0` was the first version's blindness guard
  // and it is useless on its own: bodyless external declarations count as roots
  // even when both native maps have been lost entirely.
  if (nativeKeyCount === 0) {
    errors.push("zero native keys visible — the natives maps are not being seen");
  }
  // Orphan keys are REPORTED, not fatal. A native key that reaches no registered
  // function is a real pre-existing condition of this repository, and failing on
  // it would only force an allowlist nobody analysed. The drift protection is
  // the artifact itself: the orphan SET is written into the rows, so
  // `--check`'s byte comparison fails the moment one appears, disappears, or
  // changes. That is the property Codex's round-2 note actually asked for
  // ("the conservation logic would not notice a FUTURE one").
  if ((counts.unreadable ?? 0) > 0) {
    errors.push(
      `${counts.unreadable} installed host implementation(s) could not be READ — `
      + "the analysis lost sight of a root it is supposed to cover",
    );
  }
  return errors;
}

export async function buildArtifact(): Promise<Record<string, unknown>> {
  const { SYSTEM_REGISTRY_MODULES } = await import("../src/system-registry-modules");
  const { modulesFor } = await import("../src/module-manifest");

  const profiles: Record<string, unknown> = {};
  const allRows: ClaimRow[] = [];
  const errors: string[] = [];

  for (const [profile, modules] of [
    ["SYSTEM", SYSTEM_REGISTRY_MODULES],
    ["seed", modulesFor("seed")],
  ] as const) {
    const { rows, counts, orphanKeys, nativeKeyCount, bodyAmbiguities } =
      await buildProfile(profile, modules as readonly unknown[]);
    errors.push(
      ...conservationErrors(counts, rows.length, nativeKeyCount)
        .map((e) => `${profile}: ${e}`),
    );
    profiles[profile] = { counts, orphanKeys, bodyAmbiguities, rows };
    allRows.push(...rows);
  }
  // A vacuous artifact must not pass. Both profiles are required, and an empty
  // source universe would make every freshness check trivially true.
  for (const required of ["SYSTEM", "seed"]) {
    if (profiles[required] === undefined) errors.push(`missing required profile ${required}`);
  }

  const universe = sourceUniverseDigest();
  if (universe.fileCount < 100) {
    errors.push(`source universe collapsed to ${universe.fileCount} file(s) — it is a declared superset`);
  }
  return {
    schemaVersion: "fenel.signature.honesty.claims.v1",
    authority: "NONE — inert analysis artifact. No row admits a signature; "
      + "`Honest` is not expressible. P4-D5 (slice 3f) owns certificate authority.",
    // Slice 3d-D6. Even as an inert artifact a row DESCRIBES something, and
    // what it describes is narrower than "this function's implementation":
    // `invokeFunction` selects per WRITTEN SPELLING, so a row's
    // origin/tier/key is the route reached by CANONICAL-ID invocation and
    // nothing else. An alias spelling can reach a different implementation —
    // or reach the Fenel body where the canonical id reaches a native, and
    // vice versa. Those rows carry `ambiguous` plus a `spellings` map. Stating
    // the restriction is the point: 3c's enumerator unioned the spellings and
    // reported one winner, so a row could name an implementation no
    // canonical-id call site reaches.
    routeScope: "CANONICAL-ID INVOCATION ONLY. A row's origin/tier/key is the "
      + "route `invokeFunction` selects for the function's own id; alias "
      + "spellings are NOT covered and an `ambiguous` row lists what each "
      + "spelling reaches in `spellings`.",
    detector: {
      outcomes: ["WitnessedEscape", "ManuallyAttested", "RuntimeChecked", "UnknownFenced"],
      manuallyAttestedCount: MANUALLY_ATTESTED.length,
      runtimeCheckedCount: RUNTIME_CHECKED.length,
    },
    sourceUniverse: universe,
    conservationErrors: errors,
    profiles,
  };
}

const ARTIFACT_PATH = "implementations/typescript/engine/src/generated/signature-honesty-claims.json";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const artifact = await buildArtifact();
  const text = `${canonicalJson(artifact)}\n`;

  const conservation = artifact.conservationErrors as string[];
  if (conservation.length > 0) {
    for (const e of conservation) console.error(`[honesty-claims] CONSERVATION FAILURE: ${e}`);
    process.exit(1);
  }

  if (args.includes("--json")) {
    process.stdout.write(text);
    return;
  }
  if (args.includes("--check")) {
    let current: string;
    try {
      current = readFileSync(ARTIFACT_PATH, "utf8");
    } catch {
      console.error(`[honesty-claims] MISSING ${ARTIFACT_PATH} — run the writer.`);
      process.exit(1);
      return;
    }
    // Compare CANONICAL forms (rider 1). `.gitattributes` now pins this file to
    // `eol=lf` so the checkout bytes should already match, but a source-hash-only
    // fix would leave the ARTIFACT's own comparison checkout-dependent — a
    // CRLF materialization of byte-identical content would read as DRIFT. Both
    // belts, because the failure is a false RED on another machine.
    if (canonicalSourceText(current) !== canonicalSourceText(text)) {
      console.error(`[honesty-claims] DRIFT — ${ARTIFACT_PATH} is stale. Run the writer and review the delta.`);
      process.exit(1);
    }
    console.log("[honesty-claims] --check OK");
    return;
  }
  const { writeFileSync } = await import("node:fs");
  writeFileSync(ARTIFACT_PATH, text, "utf8");
  const profiles = artifact.profiles as Record<string, { counts: Record<string, number> }>;
  for (const [profile, p] of Object.entries(profiles)) {
    console.log(
      `[honesty-claims] ${profile}: roots=${p.counts.roots} `
      + `WitnessedEscape=${p.counts.WitnessedEscape} UnknownFenced=${p.counts.UnknownFenced} `
      + `unreadable=${p.counts.unreadable} (fenelBody=${p.counts.fenelBody})`,
    );
  }
  console.log(`[honesty-claims] wrote ${ARTIFACT_PATH}`);
}

if (import.meta.main) {
  await main();
}
