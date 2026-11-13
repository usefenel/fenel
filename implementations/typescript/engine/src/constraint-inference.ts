// ---------------------------------------------------------------------------
// Constraint (requires) inference — collect the transitive set of typeclass
// constraints a function carries by walking its body for function calls.
//
//   - walks the function body for `call` / `pipe` / `apply` ops
//   - collects each callee's declared `requires`
//   - dedupes by class spec-id + first arg
//   - returns the union
//
// NAMING — the file is `constraint-inference.ts` (RENAMED from the legacy
// `effect-inference.ts`, 2026-07-01). Effects fold into typeclasses, which fold
// into types (the subsumption arc), so a function's `requires` is a list of
// typeclass CONSTRAINTS, and propagating them transitively up the call graph is
// CONSTRAINT inference — a piece of TYPE inference, NOT a separate "effect"
// concern (there is NO "effect inference" as a distinct pass: effect = type).
// This is ALSO not the whole type checker — the set-based / liquid-refinement
// type inference lives in `fenel-check.fenel` / `analyze.fenel`; THIS file is
// only the `requires`-constraint transitive-closure slice. The exported symbols
// keep their historical names (`inferTransitiveRequires` etc. — already accurate,
// they infer `requires`) for API stability (registry / audit / index consumers).
//
// ── unified-static-analysis Phase 4 — SOURCE OF TRUTH vs PERFORMANCE BRANCH ──
//
// The SOURCE OF TRUTH for the inference FOLD is now Fenel:
// `fenel/modules/engine/analyze.fenel` § D (`inferRequiresFor` /
// `findUndeclaredRequiresFor`), riding the SAME call-graph reachability closure
// (`anaReachClose` / `anaEdgesFrom` / `anaReachable`) as the SCC totality census
// — the workstream's "one call graph, two consumers" thesis (the genuine 2-birds
// is the CLOSURE, per the Phase-4 brief). `effect-inference-fenel.test.ts`
// parity-gates the Fenel fold against this TS on the oracle fixtures.
//
// THIS FILE IS THE LEDGERED TS PERFORMANCE / BOOTSTRAP BRANCH (the AGENTS.md
// opaque-repr-for-functions pattern — a measured fast path over the `.fenel`
// source of truth, NOT an independent reimplementation of the language concept).
// Three HEAD realities the Phase-4 audit surfaced FORCE it (a clean retirement is
// blocked, not chosen):
//
//   1. RE-ENTRANCY (the decisive one). `attachInferredRequires` runs INSIDE every
//      `createRegistry` (registry.ts), and the Fenel-dispatch harness
//      (`engine-bodies-dispatch.getHarness`) ITSELF builds a registry — so the
//      load-time pass CANNOT route through `dispatchEngineBody`: it would recurse
//      infinitely during harness construction (createRegistry → infer → getHarness
//      → createRegistry → …). The load pass MUST stay TS.
//   2. THE CALLEE WALK IS A `$`-KEY BOUNDARY. `collectCalledFunctions` walks RAW
//      JSON-Logic (`call`/`pipe`/`apply`), whose keys ARE evaluator ops — a shape
//      a `.fenel` body cannot author/walk. AND `pipe`/`apply` do NOT lower to core
//      `Expr` (normalise-to-core rejects them), so reusing `analyzeCallees` over a
//      lowered body would silently DROP their callees (a parity break — the brief's
//      "Option A" is not viable at HEAD). The walk stays the TS marshal boundary;
//      the Fenel fold consumes pre-extracted `{ id, callees, requires }` records.
//   3. LATENCY / SCALE. Both consumers run over the full registry (~2200 fns) —
//      the load pass on EVERY build, the audit's `findUndeclaredRequires` once per
//      function. The interpreted Fenel path (no TCO) is the same regime that
//      overflowed the 3f totality census; routing either consumer through it is a
//      measurable regression / overflow risk.
//
// The Fenel-dispatch SEAM (`*ViaFenel`, below) exists for the parity gate + the
// FUTURE flip: when the compiled self-host path makes Fenel dispatch viable
// (the parser-substrate precedent — keep the TS perf branch, defer the delete),
// the consumers can move to `*ViaFenel`. Until then the TS bodies are the live
// path and the Fenel fold is the parity-checked source of truth.
//
// See `design/unified-dispatch.md`, `design/effect-system.md`, and
// `workstreams/unified-static-analysis/briefs/phase-4-effects-fold-in-retire-effect-inference.md`.
// ---------------------------------------------------------------------------

// browser-engine-compat Phase 1b: browser-safe lazy module lookup (was require())
import { engineRequire } from "./engine-require";
import type { Constraint, FenelFunction } from "./types";

// ---------------------------------------------------------------------------
// Constraint class resolution — maps a Constraint's `class` field to a
// stable dedup key (the spec entity id, e.g. `"HasStateIOSpec"`). Post-
// migration (0062) every Constraint.class is `{$tag: "Id", entityId}`;
// the legacy bare-string + back-compat lookup deleted in 10a-5d-followup-5.
// ---------------------------------------------------------------------------

export type ResolvedConstraintClass = { readonly specId: string };

/** Unwrap a Constraint's `class` field into its spec entity id. */
export function resolveConstraintClass(
  classRef: { readonly $tag: "Id"; readonly entityId: string },
): ResolvedConstraintClass {
  return { specId: classRef.entityId };
}

// ---------------------------------------------------------------------------
// unified-static-analysis Phase 4b — the `$dyn` / INDIRECT-DISPATCH closure.
//
// `collectCalledFunctions` used to SILENTLY DROP an indirect dispatch — a
// `call`/`apply` head (or `pipe` stage) that is a non-string EXPRESSION (a
// function held in a param/local: `applyOne f x = f x`, `(.) f g = \x -> f (g
// x)`). The callee is a runtime VALUE, not a literal fn-id, so its transitive
// `requires` never entered the fold ⇒ the higher-order function was inferred
// PURE — UNSOUND. The walk now emits a `$`-prefixed sentinel callee TOKEN
// (`DYN_CALLEE`) so the Fenel fold (`analyze.fenel` § D, the SOURCE OF TRUTH for
// the decision) can SEE the indirect dispatch and apply the effect-opaque FLOOR.
//
// The DECISION ("$dyn callee ⇒ effect-opaque") lives in the Fenel
// `inferRequiresFor` arm; the TS bodies below MIRROR it (this file is the
// ledgered perf branch — see the module header). The sentinel CONSTRAINT VALUE
// (a `$`-key `{$tag:"Id"}` shape a `.fenel` body cannot author) is defined here
// and threaded into the fold as `dynSentinel`.
//
// ── effect-visibility Phase 1 + 2b — the VAR-REF callee edge ──
// `collectCalledFunctions` additionally emits every dotless single-key
// `{var:"name"}` base when the `varRefs` channel is requested: `true` mixes
// them into the callee set (the inference/seam call sites — the BFS lookup
// skips unresolvables), a `Set` receives them separately (the runtime purity
// gate — an unresolvable call HEAD must stay impure while an unresolvable VAR
// is a plain data read; one walk, two channels, each consumer's
// miss-semantics explicit). Mirrors `analyze.fenel` § A `anaCalleesIn`'s
// `EVar` arm (the source of truth). The `$dyn` sentinel emission rules are
// UNCHANGED — a resolvable bare-name ref is a PRECISE edge, not an opaque
// dispatch.
//
// ── modules-as-values follow-up (2026-10-02) — BUNDLE PATHS ──
// A dotted read or an uppercase `{method}` head that the consumer's lookup
// resolves is a precise edge (`inferenceCalleeNames`; the runtime purity gate
// reads the same dotted channel, `collectDottedVarRefs`). A dotted CALL the
// lookup cannot resolve (`pings.pinger.go x`, an alias head, a missing member,
// an applied class method) is a call the fold cannot see: effect-opaque, the
// `$dyn` floor (`isUnresolvedBundlePathCallee`), in the BFS and in the seam.
// Name resolution stays host-side; the Fenel fold's `$dyn` decision is the
// one that applies.
//
// ── TS fix review (2026-10-03) — CALLER SCOPE ──
// A callee name means what the CALLER's scope makes it mean: `probeRead` in a
// module that imports it from `effectlib` is `effectlib:probeRead`, whatever
// another module's `probeRead` is. Every lookup therefore receives the
// function whose body spelled the name (`InferenceLookup`; a lookup that
// ignores it keeps the flat, scope-free reading), and the walks key what they
// have visited by the function a name resolved to, never by the spelling.
// ---------------------------------------------------------------------------

/** Resolve a callee name spelled in `caller`'s body (codeName, id, dotted
 *  bundle path). `caller` is the function whose body holds the spelling, so a
 *  registry can read it in that function's module scope; a lookup that
 *  ignores it resolves every spelling the same way everywhere. */
export type InferenceLookup = (name: string, caller?: FenelFunction) => FenelFunction | undefined;

// ── TS fix re-review (2026-10-03, astra C2 items 4-6) ──
// - A legacy `pipe` partial stage `["name", extra…]` CALLS `name` (with the
//   piped value first): its head is a callee and its extra arguments are
//   walked. It used to be walked as an array, whose string head names
//   nothing, so `{pipe:[5,["probeIO.read"]]}` inferred no requires.
// - A `|>` stage `{call:[name, args…]}` is a known PARTIAL only when it is
//   provably an under-application of `name` (`isStaticPipeStage` with the
//   consumer's arity, `CalleeArity`): otherwise the call runs and the stage
//   applies whatever callable it RETURNS (`take r = r.go; x |> take r`), which
//   no walk can see — an indirect dispatch (`$dyn`).
// - A call-position name the lookup cannot resolve is never evidence of
//   purity: a dotless head that names no function may be a class method
//   dispatched by the bare-name resolver (`_resolveBareName` answers
//   "dispatch") or a late-bound action, so it is effect-opaque (`$dyn`), like
//   an unresolved bundle path. A variable READ that resolves nothing stays
//   data (a parameter, a local).

/** The arity of a callee name as the consumer's registry resolves it (in the
 *  scope of the body that spells it); undefined = not a known function. */
export type CalleeArity = (name: string) => number | undefined;

/** The optional channels of `collectCalledFunctions`: `arityOf` decides whether
 *  a `|>` `{call}` stage is a provable partial (`isStaticPipeStage`); `calls`
 *  receives every name spelled in CALL position (a call/apply string head, a
 *  string pipe stage, a pipe partial's head), never a variable read. */
export type CalleeWalkOptions = {
  readonly arityOf?: CalleeArity;
  readonly calls?: Set<string>;
};

/** The callee-graph token for an INDIRECT / dynamic dispatch (the roadmap's
 *  `$dyn:` vocabulary). `$`-prefixed so it can never collide with a real fnId. */
export const DYN_CALLEE = "$dyn";

/** The effect-OPAQUE sentinel constraint — the conservative FLOOR (D-4b-1). A
 *  function performing an indirect dispatch carries this in its INFERRED requires
 *  so it can never be certified pure (a sound over-approximation). It is NOT a
 *  declarable / dispatchable constraint: `attachInferredRequires` STRIPS it from
 *  runtime `fn.requires` (dispatch / self-host / partial-eval read the stripped
 *  set, unchanged), and `findUndeclaredRequires` EXEMPTS it (D-4b-4 — an
 *  inference-completeness marker, not a missing declaration). Its `class.entityId`
 *  IS `DYN_CALLEE`, so the dedup key is the stable `"$dyn::null"`. */
export const EFFECT_OPAQUE_SENTINEL: Constraint = {
  class: { $tag: "Id", entityId: DYN_CALLEE },
  args: [],
};

/** Recognize the effect-opaque sentinel (by its reserved `$dyn` class id). */
function isEffectOpaqueSentinel(c: Constraint): boolean {
  return c.class.entityId === DYN_CALLEE;
}

/**
 * Walk a JSON Logic body for `{ call: [name, ...] }` / `{ pipe: ... }` /
 * `{ apply: ... }` ops and return the set of called function names.
 * Recurses into all nested expressions.
 *
 * EXPORTED (durable-eval-perf Approach C) for the runtime's structural
 * purity gate (`yieldsIO`), which needs the SAME callee set — including the
 * `$dyn` sentinel for indirect dispatch — that the effect fold trusts, so the
 * two analyses can never disagree about what a body reaches.
 *
 * `varRefs` (effect-visibility Phase 1 + 2b — the VAR-REF callee edge,
 * mirroring `analyze.fenel` § A `anaCalleesIn`'s `EVar` arm, the source of
 * truth): every dotless single-key `{var:"name"}` node ALSO emits `name` — a
 * function referenced by BARE NAME (argument position `map helper xs`,
 * let-value position `let x = listSystemEntities`) parses to `{var:…}`, not a
 * call head, and was invisible to this walk. Emission is registry-free; a
 * plain data var simply fails the consumer's lookup and is dropped — the same
 * "resolves ⇒ edge" semantics as the Fenel arm's `knownIds` membership gate.
 * A local binder shadowing a fn name yields a FALSE edge, which only ADDS
 * requires / blocks purity — sound direction (the conservative no-scope-tree
 * precedent of `anaCalleesInArms`; the Phase-2b shadow-collision fence pins
 * why scope-tree "smartness" here would be UNSOUND, not just unnecessary).
 * Dotted vars are NOT emitted here: a dotted read is a bundle path or a data
 * field read, which only a registry can tell, so `collectDottedVarRefs`
 * collects them for the consumer to resolve (an actual invocation of a
 * fn-valued field surfaces as a non-string call head ⇒ `$dyn`).
 *
 * A `|>` stage is read as a `pipe` stage (`{"|>": [x, f]}` is `f x`): a string,
 * a `{call:[name, …]}` that is provably an UNDER-application of `name`
 * (`options.arityOf`; without it, never) or an inline lambda (whose body is
 * walked) is static; anything else — `s |> f` with a parameter `f`, `x |>
 * take r` where `take r` is a full application returning a callable — is an
 * indirect dispatch (`$dyn`). A legacy `pipe` partial stage `["name", …extra]`
 * names `name` as a callee and walks its extra arguments.
 *
 * `options.calls` receives the names spelled in CALL position (see
 * `CalleeWalkOptions`), so a consumer can tell an unresolved call head (never
 * evidence of purity) from an unresolved variable read (data).
 *
 * The channel selects the consumer's miss-semantics (Phase 2b):
 *   - `true` — emit var names into `out`, mixed with call heads. For the
 *     inference/seam consumers, whose BFS lookup SKIPS unresolvable names.
 *   - a `Set` — emit var names into that separate set. For the runtime purity
 *     gate, whose callee loop treats an unresolvable name as IMPURE (an
 *     unknown call head must stay impure) while an unresolvable VAR is a
 *     plain local/data read (must be skipped) — one walk, two channels, each
 *     consumer's miss-semantics explicit.
 *   - absent — call/apply heads + pipe stages only (the pre-Phase-1 walk).
 */
export function collectCalledFunctions(
  body: unknown,
  out: Set<string>,
  varRefs?: boolean | Set<string>,
  options?: CalleeWalkOptions,
): void {
  if (body === null || typeof body !== "object") return;
  if (Array.isArray(body)) {
    for (const item of body) collectCalledFunctions(item, out, varRefs, options);
    return;
  }
  const obj = body as Record<string, unknown>;
  if (varRefs) {
    const keys = Object.keys(obj);
    if (keys.length === 1 && keys[0] === "var" && typeof obj["var"] === "string") {
      const name = obj["var"] as string;
      if (name.length > 0 && !name.includes(".")) {
        (varRefs === true ? out : varRefs).add(name);
      }
      return; // a single-key {var:"…"} has no subterms to walk
    }
  }
  for (const [op, args] of Object.entries(obj)) {
    if (op === "call" && Array.isArray(args) && args.length > 0) {
      const name = args[0];
      // Literal-string head = a statically-known callee; a non-string head is an
      // INDIRECT dispatch (a function held in a param/local) — emit the `$dyn`
      // sentinel instead of dropping it (Phase 4b). Recurse into the head too
      // (it may itself contain literal-string calls) and the tail args.
      if (typeof name === "string") addCallee(out, options, name);
      else { out.add(DYN_CALLEE); collectCalledFunctions(name, out, varRefs, options); }
      for (let i = 1; i < args.length; i++) collectCalledFunctions(args[i], out, varRefs, options);
      continue;
    }
    if (op === "pipe" && Array.isArray(args)) {
      // Pipe is `[seedExpr, fn1, fn2, ...]`. Index 0 is the piped VALUE (a seed,
      // never a dispatch target: `pipeOp` evaluates it as an expression, so a
      // literal string there is data and is walked only as an expression);
      // stages (i>=1) can be a string (fn name), a `["fnName", extra]` partial
      // (`pipeOp` CALLS `fnName` with the piped value first: its head is a
      // callee and its extras are walked), or an inline expression — any other
      // stage is an INDIRECT dispatch (`$dyn`).
      if (args.length > 0) collectCalledFunctions(args[0], out, varRefs, options);
      for (let i = 1; i < args.length; i++) {
        const item = args[i];
        if (typeof item === "string") { addCallee(out, options, item); continue; }
        if (Array.isArray(item) && item.length > 0 && typeof item[0] === "string") {
          addCallee(out, options, item[0]);
          for (let j = 1; j < item.length; j++) collectCalledFunctions(item[j], out, varRefs, options);
          continue;
        }
        out.add(DYN_CALLEE);
        collectCalledFunctions(item, out, varRefs, options);
      }
      continue;
    }
    if (op === "|>" && Array.isArray(args)) {
      // `{"|>": [seed, stage]}` — the seed is the piped VALUE (`pipeBinOp`
      // evaluates it as an expression: a literal string there names no
      // function), walked only as an expression. The stage is an expression
      // whose value is applied to the seed: a static stage
      // (`isStaticPipeStage`: an inline lambda, or a provable partial) is
      // walked below; any other stage is an indirect dispatch. (A literal
      // string stage stays a callee, the conservative reading, as for `pipe`.)
      if (args.length > 0) collectCalledFunctions(args[0], out, varRefs, options);
      for (let i = 1; i < args.length; i++) {
        const item = args[i];
        if (typeof item === "string") { addCallee(out, options, item); continue; }
        if (!isStaticPipeStage(item, options?.arityOf)) out.add(DYN_CALLEE);
        collectCalledFunctions(item, out, varRefs, options);
      }
      continue;
    }
    if (op === "apply" && Array.isArray(args) && args.length > 0) {
      const fn = args[0];
      // Same as `call`: a non-string applied head is an indirect dispatch.
      if (typeof fn === "string") addCallee(out, options, fn);
      else { out.add(DYN_CALLEE); collectCalledFunctions(fn, out, varRefs, options); }
      for (let i = 1; i < args.length; i++) collectCalledFunctions(args[i], out, varRefs, options);
      continue;
    }
    // Generic recursion for all other ops
    collectCalledFunctions(args, out, varRefs, options);
  }
}

/** A name spelled in CALL position: a callee, and a member of `options.calls`. */
function addCallee(out: Set<string>, options: CalleeWalkOptions | undefined, name: string): void {
  out.add(name);
  options?.calls?.add(name);
}

/** A `|>` stage whose application the walk sees statically: exactly `{fn: […]}`
 *  (an inline lambda: applying it runs only its own, walked, body), or exactly
 *  `{call: [name, …args]}` with a string head that is provably an
 *  UNDER-application of `name` (`isProvableUnderApplication`): the call builds
 *  a partial and the stage completes it, so `name` (a callee of the `{call}`)
 *  is the only code that runs. A full or over-application RETURNS a callable
 *  the walk cannot see, and without `arityOf` nothing is provable. Shared with
 *  the runtime purity gate's head refinement. */
export function isStaticPipeStage(stage: unknown, arityOf?: CalleeArity): boolean {
  if (stage === null || typeof stage !== "object" || Array.isArray(stage)) return false;
  const keys = Object.keys(stage);
  if (keys.length !== 1) return false;
  const operand = (stage as Record<string, unknown>)[keys[0]!];
  if (keys[0] === "fn") return Array.isArray(operand);
  if (keys[0] !== "call" || !Array.isArray(operand) || typeof operand[0] !== "string") return false;
  return isProvableUnderApplication(operand[0], operand.slice(1), arityOf);
}

/** Is `{call: [name, …args]}` certainly an under-application (`invokeFunction`
 *  builds a partial: fewer arguments than `name`'s parameters)? The arity is
 *  the consumer's (`arityOf`; unknown = no). One argument is the named-args
 *  case: a sole RECORD whose keys cover every formal is a full application
 *  (`maybeReorderNamedArgs`), so a sole argument must be an expression that
 *  cannot evaluate to such a record — a primitive or array literal, a lambda,
 *  or a `$`-keyed literal (a wire value, never named args). */
function isProvableUnderApplication(name: string, args: readonly unknown[], arityOf: CalleeArity | undefined): boolean {
  if (arityOf === undefined) return false;
  const arity = arityOf(name);
  if (arity === undefined || args.length >= arity) return false;
  if (args.length !== 1) return true;
  const sole = args[0];
  if (sole === null || typeof sole !== "object" || Array.isArray(sole)) return true;
  const soleKeys = Object.keys(sole);
  if (soleKeys.length === 0 || soleKeys.some((key) => key.startsWith("$"))) return true;
  return soleKeys.length === 1 && soleKeys[0] === "fn" && Array.isArray((sole as { fn: unknown }).fn);
}

/** Every DOTTED `{var}` read in a body, lambdas included (modules-as-values
 *  Phase 5a: a dotted read may be a bundle path, so whether it is an edge is
 *  the consumer's registry question; `collectCalledFunctions` emits dotless
 *  names only). Both `{var:"p"}` and the defaulted `{var:["p", d]}` count.
 *  With `methods`, every `{method:[Head, member, …]}` node's `Head.member` is
 *  collected too: a BARE one (a read) into `methods.read`, an APPLIED one (a
 *  call) into `methods.applied`. One walk, two consumers: the static effect
 *  fold below and the durable runtime's purity gate
 *  (`runtime/src/evaluator.ts`), each with its own miss-semantics. */
export function collectDottedVarRefs(
  node: unknown,
  out: Set<string>,
  methods?: { readonly read: Set<string>; readonly applied: Set<string> },
): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const el of node) collectDottedVarRefs(el, out, methods);
    return;
  }
  const keys = Object.keys(node);
  if (keys.length === 1 && keys[0] === "var") {
    const operand = (node as { var: unknown }).var;
    const path = Array.isArray(operand) ? operand[0] : operand;
    if (typeof path === "string" && path.indexOf(".") > 0) out.add(path);
    if (Array.isArray(operand)) for (let i = 1; i < operand.length; i++) collectDottedVarRefs(operand[i], out, methods);
    return;
  }
  if (methods !== undefined && keys.length === 1 && keys[0] === "method") {
    const operands = (node as { method: unknown }).method;
    const head = Array.isArray(operands) ? methodBundleHead(operands) : null;
    if (head !== null) ((operands as unknown[]).length >= 3 ? methods.applied : methods.read).add(`${head[0]}.${head[1]}`);
  }
  for (const key of keys) collectDottedVarRefs((node as Record<string, unknown>)[key], out, methods);
}

/** The `[Head, member]` of a `{method}` node's operands when both are dotless
 *  strings (the shape the parser emits for `Bundle.member`), else null. */
export function methodBundleHead(operands: readonly unknown[]): [string, string] | null {
  const head = operands[0];
  const member = operands[1];
  if (typeof head !== "string" || typeof member !== "string") return null;
  if (head.length === 0 || member.length === 0 || head.indexOf(".") >= 0 || member.indexOf(".") >= 0) return null;
  return [head, member];
}

/** A callee name the lookup cannot resolve is a call the fold cannot see when
 *  it is a BUNDLE PATH: dotted, not a canonical `m:x` id, not a `$` token
 *  (`pings.pinger.go x`, an alias head, a missing member, a class `{method}`).
 *  The inference consumers treat it as effect-opaque (`$dyn`), exactly as an
 *  applied parameter; an unresolved dotless name stays a plain miss. */
function isUnresolvedBundlePathCallee(name: string): boolean {
  return name.includes(".") && !name.includes(":") && !name.startsWith("$");
}

/** TS fix re-review (2026-10-03, astra C2 item 6) — a DOTLESS name spelled in
 *  call position that the lookup cannot resolve is a call the fold cannot see
 *  (a class method the bare-name resolver dispatches, `bareFetch x`; a
 *  late-bound action): effect-opaque, exactly as an unresolved bundle path. */
function isUnresolvedBareCallee(name: string): boolean {
  return name.length > 0 && !name.includes(".") && !name.includes(":") && !name.startsWith("$");
}

/** The callee names of one body for the INFERENCE consumers (`names`), and the
 *  subset spelled in call position (`calls`). */
type InferenceCallees = { readonly names: ReadonlySet<string>; readonly calls: ReadonlySet<string> };

/** Is the unresolved name `name` effect-opaque for the inference consumers? An
 *  unresolved bundle path (only call positions and resolved reads reach
 *  `names` dotted), or an unresolved dotless CALL head; a dotless variable read
 *  that resolves nothing is data. */
function unresolvedCalleeIsOpaque(name: string, callees: InferenceCallees): boolean {
  return isUnresolvedBundlePathCallee(name) || (callees.calls.has(name) && isUnresolvedBareCallee(name));
}

/** The callee names of one body for the INFERENCE consumers (the BFS below and
 *  the Fenel seam `gatherReachable`): call/apply heads, pipe and `|>` stages,
 *  the `$dyn` token and bare-name `{var}` refs (`collectCalledFunctions`, a
 *  `|>` partial judged with the callee arities `lookupFn` gives in the
 *  caller's scope), plus the dotted channel (`collectDottedVarRefs`). A dotted
 *  read or a bare `{method}` member joins only when `lookupFn` resolves it (an
 *  edge; an unresolved read is data, so the bundle-path floor never fires on
 *  `state.next`); an applied `{method}` head always joins, so an unresolved
 *  one meets that floor as a call. `calls` holds the names spelled in call
 *  position (applied `{method}` heads included). */
function inferenceCalleeNames(
  caller: FenelFunction,
  body: unknown,
  lookupFn: InferenceLookup,
): InferenceCallees {
  const called = new Set<string>();
  const calls = new Set<string>();
  const arityOf: CalleeArity = (name) => {
    const params = lookupFn(name, caller)?.params;
    return Array.isArray(params) ? params.length : undefined;
  };
  collectCalledFunctions(body, called, true, { arityOf, calls });
  const reads = new Set<string>();
  const applied = new Set<string>();
  collectDottedVarRefs(body, reads, { read: reads, applied });
  for (const name of reads) if (lookupFn(name, caller) !== undefined) called.add(name);
  for (const name of applied) {
    called.add(name);
    calls.add(name);
  }
  return { names: called, calls };
}

// modules-as-values Phase 2d — keyed on the COMPLETE argument tuple: `Iso String
// Bytes` and `Iso String JsonValue` are two constraints, not one deduped by
// their shared first argument.
export function constraintKey(c: Constraint): string {
  return `${resolveConstraintClass(c.class).specId}::${JSON.stringify(c.args ?? [])}`;
}

/**
 * Aggregate the transitive `requires` set for a function. Walks its
 * body, looks up each called function in the registry, unions their
 * declared `requires` with the function's own.
 *
 * `lookupFn` resolves a name (codeName or id) to its FenelFunction, in the
 * scope of the function whose body spelled it (`InferenceLookup`). Caller
 * passes `(name) => moduleRegistry.getFunction(name)` or similar (scope-free).
 *
 * Returned constraints are deduped by (class, args[0]).
 *
 * Pure functions return an empty array. A function with declared
 * `requires` includes its own constraints in the result.
 */
const NO_CALLEES: InferenceCallees = Object.freeze({ names: new Set<string>(), calls: new Set<string>() });

/** One caller's out-edges for the inference walks (harness slice 1a,
 *  2026-11-01): the functions its callee names resolve to, in the order the
 *  names were met (repeats kept), and whether its body holds an effect-opaque
 *  call (the `$dyn` token, or an unresolved bundle path or call head). */
type ResolvedCallees = { readonly targets: readonly FenelFunction[]; readonly opaque: boolean };

type ResolvedCalleesFor = (caller: FenelFunction) => ResolvedCallees;

const NO_RESOLVED_CALLEES: ResolvedCallees = Object.freeze({ targets: Object.freeze([]), opaque: false });

/** The resolved out-edges of each caller, computed once per caller and kept
 *  for the life of the returned function. Each name is resolved in the scope
 *  of the body that spelled it (`lookupFn(name, caller)`), exactly as the walk
 *  resolved it when it met the name; keeping the answer is sound because a
 *  lookup reads only name tables that this pass never writes (the pass writes
 *  `fn.requires` alone, and no lookup reads it). */
function resolvedCalleesMemo(lookupFn: InferenceLookup): ResolvedCalleesFor {
  const cache = new WeakMap<FenelFunction, ResolvedCallees>();
  return (caller) => {
    const cached = cache.get(caller);
    if (cached !== undefined) return cached;
    let resolved = NO_RESOLVED_CALLEES;
    if (caller.body !== undefined) {
      const callees = inferenceCalleeNames(caller, caller.body, lookupFn);
      const targets: FenelFunction[] = [];
      let opaque = false;
      for (const name of callees.names) {
        // `$dyn` is a sentinel token, never a real fn. An unresolved
        // bundle-path call or dotless call head is effect-opaque
        // (`unresolvedCalleeIsOpaque`); any other miss is data.
        if (name === DYN_CALLEE) { opaque = true; continue; }
        const callee = lookupFn(name, caller);
        if (!callee) {
          if (unresolvedCalleeIsOpaque(name, callees)) opaque = true;
          continue;
        }
        targets.push(callee);
      }
      resolved = { targets, opaque };
    }
    cache.set(caller, resolved);
    return resolved;
  };
}

function inferTransitiveRequiresResolved(
  fn: FenelFunction,
  resolvedCalleesFor: ResolvedCalleesFor,
): Constraint[] {
  const seenKeys = new Set<string>();
  const out: Constraint[] = [];

  function add(c: Constraint): void {
    const k = constraintKey(c);
    if (seenKeys.has(k)) return;
    seenKeys.add(k);
    out.push(c);
  }

  // Self-declared
  for (const c of fn.requires ?? []) add(c);

  // Transitive — walk body for callees. `includeVarRefs: true` (effect-
  // visibility Phase 1): a fn referenced by BARE NAME (`{var:…}` in argument /
  // let-value position) is a reach edge too — mirrors analyze.fenel § A's
  // `EVar` arm (the source of truth). Unresolvable names (plain data vars,
  // params, locals) fall out at the `lookupFn` miss below — "resolves ⇒ edge".
  if (fn.body !== undefined) {
    let sawDyn = false;
    // TS fix review (2026-10-03) — each name is resolved in the scope of the
    // body that spelled it (`lookupFn(name, caller)`) when it is met, and the
    // walk keys what it has visited by the RESOLVED function: one spelling may
    // name two functions in two callers. The order of first visits, and so of
    // the constraints, is the historical name-ordered BFS's (the resolved
    // targets keep the order of the names).
    const visited = new Set<string>([fn.id]);
    const queue: FenelFunction[] = [];
    const enqueueCalleesOf = (caller: FenelFunction): void => {
      const edges = resolvedCalleesFor(caller);
      if (edges.opaque) sawDyn = true;
      for (const callee of edges.targets) {
        if (visited.has(callee.id)) continue;
        visited.add(callee.id);
        queue.push(callee);
      }
    };
    enqueueCalleesOf(fn);
    let queueIndex = 0;
    while (queueIndex < queue.length) {
      const callee = queue[queueIndex++]!;
      for (const c of callee.requires ?? []) add(c);
      // Recurse into the callee's body too
      if (callee.body !== undefined) enqueueCalleesOf(callee);
    }
    // Phase 4b — the `$dyn` arm (MIRRORS the Fenel `inferRequiresFor` decision,
    // the source of truth): any reached function performs an INDIRECT dispatch ⇒
    // the target carries the effect-opaque sentinel and can't be certified pure.
    if (sawDyn) add(EFFECT_OPAQUE_SENTINEL);
  }

  return out;
}

export function inferTransitiveRequires(
  fn: FenelFunction,
  lookupFn: InferenceLookup,
): Constraint[] {
  // One root may reach the same function through several exact/code-name
  // spellings. Preserve the historical name-ordered BFS while scanning and
  // resolving each immutable body only once for this query.
  return inferTransitiveRequiresResolved(fn, resolvedCalleesMemo(lookupFn));
}

/** Does `fn` carry a constraint other than the effect-opaque sentinel? Read
 *  defensively: a malformed entry counts (its root is then walked, and fails,
 *  exactly as before). */
function carriesRealRequires(fn: FenelFunction): boolean {
  for (const c of fn.requires ?? []) {
    if ((c as Partial<Constraint> | null | undefined)?.class?.entityId !== DYN_CALLEE) return true;
  }
  return false;
}

/** Harness slice 1a (2026-11-01) — the roots whose result can be non-empty:
 *  every function (by object) whose call closure, itself included, holds a
 *  function that carries a real constraint before the pass. The closure is the
 *  object graph of `resolvedCalleesFor`, the very edges the per-root walk
 *  follows; the walk's id-keyed `visited` can only prune it, so this set
 *  over-approximates what any walk reaches.
 *
 *  Why every other root writes nothing, today and here: a function's
 *  `requires` gains a real constraint during the pass only by its own walk,
 *  which copies constraints its closure already carried. By induction over
 *  the roster order, a function that carries a real constraint at any point of
 *  the pass reaches one that carried it before the pass; and a callee's
 *  closure is contained in its caller's. So a root outside this set meets only
 *  empty or sentinel-only `requires`, its result filters to empty, and the
 *  loop below writes nothing for it. */
function rootsReachingRealRequires(
  fns: readonly FenelFunction[],
  resolvedCalleesFor: ResolvedCalleesFor,
): ReadonlySet<FenelFunction> {
  const callersOf = new Map<FenelFunction, FenelFunction[]>();
  const seen = new Set<FenelFunction>();
  const carriers: FenelFunction[] = [];
  const stack: FenelFunction[] = [];
  for (const root of fns) {
    if (seen.has(root)) continue;
    seen.add(root);
    stack.push(root);
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (carriesRealRequires(node)) carriers.push(node);
      if (node.body === undefined) continue;
      for (const callee of resolvedCalleesFor(node).targets) {
        const callers = callersOf.get(callee);
        if (callers === undefined) callersOf.set(callee, [node]);
        else callers.push(node);
        if (seen.has(callee)) continue;
        seen.add(callee);
        stack.push(callee);
      }
    }
  }
  const reaching = new Set<FenelFunction>(carriers);
  const work = carriers.slice();
  while (work.length > 0) {
    const node = work.pop()!;
    for (const caller of callersOf.get(node) ?? []) {
      if (reaching.has(caller)) continue;
      reaching.add(caller);
      work.push(caller);
    }
  }
  return reaching;
}

/**
 * Compare a function's *declared* requires against its *inferred*
 * transitive requires. Returns the constraints used transitively but
 * not declared — i.e. effects the function performs without
 * announcing them on its signature.
 *
 * Phase 5.2 will turn missing declarations into a type error; for
 * now the function is informational, used by tooling to surface
 * "this function should declare HasStateIO" warnings in the editor.
 */
export function findUndeclaredRequires(
  fn: FenelFunction,
  lookupFn: InferenceLookup,
): Constraint[] {
  const declared = new Set((fn.requires ?? []).map(constraintKey));
  const inferred = inferTransitiveRequires(fn, lookupFn);
  // Phase 4b — EXEMPT the effect-opaque `$dyn` sentinel (D-4b-4). It is an
  // inference-completeness marker for indirect dispatch, NOT a missing
  // declaration the author can add — so it must never surface as a spurious
  // "undeclared requires" on a higher-order function (`.`/`$`/`bindResult`/…).
  return inferred.filter(
    (c) => !declared.has(constraintKey(c)) && !isEffectOpaqueSentinel(c),
  );
}

/**
 * Mutate every function in a list to carry its inferred transitive
 * requires. The function's own already-declared `requires` is taken
 * as the seed; transitive callees are walked via `lookupFn`. Result
 * is the deduped union.
 *
 * Used by post-load workflows (e.g. `.fenel` source modules whose
 * parser doesn't yet emit `requires` syntactically) to populate the
 * effect set automatically. Idempotent — re-running adds nothing
 * new once the inference has settled.
 *
 * Two-pass within a list is safe: same-list callees might not have
 * their inferred requires attached on the first iteration, but the
 * inference walks all the way through callees' bodies, not just
 * their `requires` fields. So a function calling another function
 * in the same list picks up that target's transitive requires
 * regardless of order.
 *
 * NOTE: mutates `fn.requires` in place. Callers that need a copy
 * should clone the array first.
 */
export function attachInferredRequires(
  fns: FenelFunction[],
  lookupFn: InferenceLookup,
): void {
  // Registry construction asks the same reachability question for thousands of
  // roots. Bodies and name tables do not change during this pass, so each
  // body's ordered callee scan and its resolution are kept across roots
  // (`resolvedCalleesMemo`). Harness slice 1a (2026-11-01): only the roots
  // whose closure holds a real constraint are walked
  // (`rootsReachingRealRequires`; 93 of 7,801 in the bootstrap harness); every
  // other root's walk would end empty and write nothing. The walked roots run
  // the same BFS in the same roster order, reading each callee's `requires` as
  // the earlier roots left it, so arrays, order, constraint identities and the
  // in-place update order are byte-identical
  // (`constraint-inference-roots.test.ts` holds the previous pass as its
  // oracle).
  const resolvedCalleesFor = resolvedCalleesMemo(lookupFn);
  const reaching = rootsReachingRealRequires(fns, resolvedCalleesFor);
  for (const fn of fns) {
    if (!reaching.has(fn)) continue;
    // Phase 4b — STRIP the effect-opaque `$dyn` sentinel before writing runtime
    // `fn.requires` (D-4b-3). It is not a declarable / dispatchable constraint —
    // the downstream readers of `fn.requires` (effect dispatch, the self-host
    // classifiers, the partial-evaluator) must see only the function's REAL
    // declarable effects. The sentinel lives in the inference QUERY output (the
    // soundness-complete analysis), not the runtime requires. A combinator whose
    // ONLY inferred constraint is the sentinel therefore keeps `requires` clean
    // (the `length === 0` skip below), preserving its self-host/dispatch path.
    const inferred = inferTransitiveRequiresResolved(fn, resolvedCalleesFor).filter(
      (c) => !isEffectOpaqueSentinel(c),
    );
    if (inferred.length === 0) continue;
    fn.requires = inferred;
  }
}

// ---------------------------------------------------------------------------
// The Fenel-dispatch SEAM — the marshalling boundary (category B) that routes
// the inference FOLD through the Fenel source of truth
// (`engine:inferRequiresFor` / `engine:findUndeclaredRequiresFor` in
// `analyze.fenel`). NOT on the production path today (see the re-entrancy /
// latency ledger in the file header) — it backs `effect-inference-fenel.test.ts`
// (the parity gate proving the Fenel fold matches this TS) and the FUTURE flip
// when compiled-Fenel dispatch is viable. The seam (a) pre-resolves the reachable
// function set host-side (the callee walk is the `$`-key boundary that must stay
// TS), (b) marshals each constraint to a `{ key, orig }` wrapper — the dedup key
// computed host-side as a String (the kernel precedent: std `eq` is shallow,
// `deepEq` is key-form-only, so structural equality is pre-computed in the seam),
// and (c) unwraps `.orig` from the result.
// ---------------------------------------------------------------------------

type MarshalledConstraint = { readonly key: string; readonly orig: Constraint };
type MarshalledFn = {
  readonly id: string;
  readonly callees: string[];
  readonly requires: MarshalledConstraint[];
};

function marshalConstraint(c: Constraint): MarshalledConstraint {
  return { key: constraintKey(c), orig: c };
}

/**
 * Gather the function set reachable from `fn` (inclusive), each marshalled to
 * the `{ id, callees, requires }` shape the Fenel fold folds over. `callees` are
 * the registry-resolvable callee ids (∩ the lookup-able set) — the directed
 * call-graph edges out of the node. The reachability closure + requires-union
 * happen in Fenel; this just resolves the node set host-side.
 */
function gatherReachable(
  fn: FenelFunction,
  lookupFn: InferenceLookup,
): MarshalledFn[] {
  const map = new Map<string, MarshalledFn>();
  const stack: FenelFunction[] = [fn];
  while (stack.length > 0) {
    const f = stack.pop()!;
    if (map.has(f.id)) continue;
    // includeVarRefs (effect-visibility Phase 1) — the seam pre-resolves the
    // reachable set for the Fenel fold, so var-referenced fns enter it here;
    // unresolvable var names drop at the `lookupFn` miss below. The same
    // callee names as the TS BFS (`inferenceCalleeNames`), each resolved in
    // the scope of `f`, whose body spelled it.
    const calleeNames = f.body === undefined ? NO_CALLEES : inferenceCalleeNames(f, f.body, lookupFn);
    const callees: string[] = [];
    for (const n of calleeNames.names) {
      // Phase 4b — preserve the `$dyn` indirect-dispatch token in the marshalled
      // callees (it resolves to no function, but the Fenel fold's `$dyn` arm
      // reads it from `callees` to apply the effect-opaque floor). Pass it
      // through directly rather than dropping it on the `lookupFn` miss.
      if (n === DYN_CALLEE) { callees.push(DYN_CALLEE); continue; }
      const callee = lookupFn(n, f);
      if (callee) {
        callees.push(callee.id);
        if (!map.has(callee.id)) stack.push(callee);
      } else if (unresolvedCalleeIsOpaque(n, calleeNames) && !callees.includes(DYN_CALLEE)) {
        // An unresolved bundle-path call or dotless call head reaches the fold
        // as the `$dyn` token (the BFS's floor); the Fenel decision is
        // unchanged.
        callees.push(DYN_CALLEE);
      }
    }
    map.set(f.id, { id: f.id, callees, requires: (f.requires ?? []).map(marshalConstraint) });
  }
  return [...map.values()];
}

function dispatchInfer(fnId: string, fn: FenelFunction, fns: MarshalledFn[]): Constraint[] {
  // Lazy require — break the static cycle (effect-inference is imported by
  // registry, which engine-bodies-dispatch lazily requires).
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchEngineBody } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  const target = fns.find((m) => m.id === fn.id);
  if (!target) return [];
  // Phase 4b — thread the marshalled effect-opaque sentinel as the fold's third
  // arg. The Fenel `$dyn` arm DECIDES its inclusion (the floor-vs-north-star
  // model lives in the fold); the seam only supplies the `$`-key Constraint VALUE
  // a `.fenel` body cannot author, carried opaque and unwrapped via `.orig`.
  const dynSentinel = marshalConstraint(EFFECT_OPAQUE_SENTINEL);
  const res = dispatchEngineBody(fnId, [target, fns, dynSentinel]) as MarshalledConstraint[];
  return res.map((w) => w.orig);
}

/**
 * `inferTransitiveRequires` via the Fenel source-of-truth fold
 * (`engine:inferRequiresFor`). Parity-gated against the TS above.
 */
export function inferTransitiveRequiresViaFenel(
  fn: FenelFunction,
  lookupFn: InferenceLookup,
): Constraint[] {
  return dispatchInfer("engine:inferRequiresFor", fn, gatherReachable(fn, lookupFn));
}

/**
 * `findUndeclaredRequires` via the Fenel source-of-truth fold
 * (`engine:findUndeclaredRequiresFor`). Parity-gated against the TS above.
 */
export function findUndeclaredRequiresViaFenel(
  fn: FenelFunction,
  lookupFn: InferenceLookup,
): Constraint[] {
  return dispatchInfer("engine:findUndeclaredRequiresFor", fn, gatherReachable(fn, lookupFn));
}
