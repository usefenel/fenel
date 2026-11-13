// ---------------------------------------------------------------------------
// Migration — typed schema-evolution as typeclass instances.
//
// Phase 10 of the implementation roadmap. The fifth load-bearing instance of
// the meta-pattern from `design/structural-introspection.md` (Instance 5):
// each pairwise type-version transition is a typeclass instance carrying the
// forward/backward transformation + an epistemic-status-flavoured
// `Losslessness` flag. Migrations compose like Iso instances; the migration
// graph becomes a first-class queryable value.
//
// Today, schema evolution in Fenel is implicit — types change in code,
// persisted data reads against the new schema via JSON structural laxity.
// This phase makes evolution explicit and typed:
//
//   Migration v1 v2 = Migration
//     forward          : v1 -> Result MigrationError v2
//     backward         : Maybe (v2 -> Result MigrationError v1)
//                                           -- Just on Lossless, Nothing on Lossy
//     losslessness     : Losslessness      -- Lossless | Lossy { reason: String }
//     roundtripSamples : List v1           -- per-instance samples driving the laws
//
//   Losslessness = Lossless | Lossy reason: String
//   MigrationError = FieldMissing field: String | TypeIncompatible … | …
//
// All three are declared in `fenel/std/interfaces.fenel` (modules-as-values
// Phase 2d); the TypeScript types below mirror their wire shapes.
//
// Composition rules (this file's `composeMigration` helper):
//
//   Lossless ∘ Lossless = Lossless        (backward composed in reverse)
//   Lossless ∘ Lossy    = Lossy { reason: <inner>.reason }
//   Lossy    ∘ Lossless = Lossy { reason: <outer>.reason }
//   Lossy    ∘ Lossy    = Lossy { reason: "composed of: <m1>, <m2>" }
//
// The registry (`registerMigration` / `findMigration` / `findMigrationPath`)
// mirrors Phase 9's `registerAggregable` pattern: a process-wide side-table
// keyed by `(v1Tag, v2Tag)`. Instance objects flow through unchanged — the
// registry is just a fast index for the BFS path-finder. User migrations
// register at module load; the path-finder produces shortest-path chains.
//
// See:
//   - `design/structural-introspection.md` Instance 5 — the Migration story
//     this phase implements.
//   - `design/implementation-roadmap.md` Phase 10 entry.
//   - `implementations/typescript/engine/src/codec.ts` — Iso composition,
//     which Migration mirrors at the value-level.
//   - `implementations/typescript/engine/src/aggregable.ts` — Phase 9 open-
//     registry pattern this borrows.
// ---------------------------------------------------------------------------

import type { FenelType, FieldDef, Interface, Instance } from "./types";
import { functionRefHandle, List } from "./type-foundation";

// ---------------------------------------------------------------------------
// Losslessness — Lossless | Lossy { reason: String }
//
// Tags whether a migration's `backward` direction is well-defined.
// `Lossless` migrations roundtrip exactly: `backward(forward(v1)) = Ok v1`
// for every v1 in the source type. `Lossy` migrations forget information
// (e.g. drop a field, narrow an enum) and therefore can't define a unique
// inverse — `backward` is `Nothing` and the `reason` field documents the
// lost information.
//
// Composed migrations conservatively poison losslessness: any Lossy leg
// makes the composition Lossy. The composed reason aggregates per-leg
// reasons so users can trace where loss happens.
// ---------------------------------------------------------------------------

export type Losslessness =
  | { readonly $tag: "Lossless" }
  | { readonly $tag: "Lossy"; readonly reason: string };

export const LOSSLESS: Losslessness = { $tag: "Lossless" };
export function lossy(reason: string): Losslessness {
  return { $tag: "Lossy", reason };
}

export function isLossless(l: Losslessness): boolean {
  return l.$tag === "Lossless";
}

// ---------------------------------------------------------------------------
// MigrationError — structured failure shape returned by `forward` / `backward`
//
//   FieldMissing       — required field absent from the source value
//   TypeIncompatible   — field has a value but its type can't be converted
//                        to the target field's type
//   DefaultUnavailable — target requires a value the migration can't supply
//                        (e.g. backward over a Lossy field's default)
//   InvariantViolation — invariant violation in the migration function
//                        itself; bug, not user error
//
// Stored as `$tag`-discriminated records so Fenel-side pattern matching
// works uniformly. The migration shape uses Result<MigrationError, _> on
// every direction — the canonical Fenel `{$tag: "Ok"|"Err", _0}` wire
// form so handlers compose through evaluator dispatch unchanged.
// ---------------------------------------------------------------------------

export type MigrationError =
  | { readonly $tag: "FieldMissing"; readonly field: string }
  | {
      readonly $tag: "TypeIncompatible";
      readonly field: string;
      readonly expected: string;
      readonly actual: string;
    }
  | { readonly $tag: "DefaultUnavailable"; readonly field: string }
  | { readonly $tag: "InvariantViolation"; readonly message: string };

export function migrationFieldMissing(field: string): MigrationError {
  return { $tag: "FieldMissing", field };
}
export function migrationTypeIncompatible(
  field: string,
  expected: string,
  actual: string,
): MigrationError {
  return { $tag: "TypeIncompatible", field, expected, actual };
}
export function migrationDefaultUnavailable(field: string): MigrationError {
  return { $tag: "DefaultUnavailable", field };
}
export function migrationInternalError(message: string): MigrationError {
  return { $tag: "InvariantViolation", message };
}

// ---------------------------------------------------------------------------
// Migration v1 v2 — typeclass declaration
//
// Two type parameters name the source and target versions (the demo
// instances use the types `ProfileDemoV1` / `ProfileDemoV2`). The instance
// carries:
//
//   forward          : the function `v1 -> Result MigrationError v2`
//   backward         : Maybe the function `v2 -> Result MigrationError v1`
//                      (Just on Lossless, Nothing on Lossy — encoded as
//                      `{$tag: "Just", _0: <function>}` / `{$tag: "Nothing"}`)
//   losslessness     : Lossless | Lossy { reason }
//   roundtripSamples : per-instance v1 values driving the laws
//
// The fields hold the functions themselves: a `.fenel` instance writes
// `forward = migration.profileDemoV1ToV2`, loaded as the reference
// `{$ref: "migration.profileDemoV1ToV2"}`, and `backward = Just
// migration.profileDemoV2ToV1`, lowered by its declared field type to
// `{$tag: "Just", _0: {$ref: …}}` (modules-as-values Phase 2d). A function
// id string and an inline `{fn: […]}` closure (what `composeMigration`
// builds) are accepted too. `{call: [{var: "forward"}, v1]}` applies any of
// them. Two class parameters, so every method stays at return position: an
// instance is selected by its complete type, never by one argument's type.
//
// `backward` is a Maybe so the class shape carries the Lossless/Lossy split
// at the method level. The audit flags any Lossy instance with a Just-tagged
// backward as a shape violation (cross-checked in tests below).
//
// The method signatures are written out as data exactly as the `.fenel`
// record parses (`seedFromType`), pinned in
// `modules-as-values-phase-2d-codec-migration.test.ts`. Seed data
// (ts-exceptions-ledger A2).
//
// Laws (each delegates per-case iteration to a TS-native check):
//
//   migration-roundtrip-lossless
//     `backward(forward(v1)) = Ok v1` for every v1 in the instance's
//     `roundtripSamples`. Lossy instances are vacuously satisfied (the
//     property reads `losslessness` and returns `Just true` via the
//     native's vacuous branch). Sample iteration happens inside
//     `migration:roundtripCheck` — the law is closed-form at the
//     property level, but the underlying evidence is empirical, so the
//     description records the per-instance sample shape and the
//     audit's `pass` status carries that evidence in spirit.
//
//   migration-forward-total
//     `forward(v1)` returns `Ok _` (no `MigrationError` surfaces) for
//     every v1 in `roundtripSamples`. This is the irreplaceable
//     contract of a migration — an instance whose forward fails on its
//     own declared samples is refuted. Same structure as the lossless
//     law; the check native iterates internally.
// ---------------------------------------------------------------------------

const NO_LABEL = { $tag: "Nothing" } as const;
const positional = (index: number, type: FenelType): FieldDef => ({
  name: `_${index}`,
  key: { $tag: "PositionalField", index },
  label: NO_LABEL,
  type,
  ui: NO_LABEL,
  meta: {},
});
/** `Result MigrationError <ok>` as the parser inlines it: `Err _0 | Ok _0`. */
const resultMigrationError = (ok: FenelType): FenelType => ({
  $variant: {
    cases: [
      { name: "Err", label: NO_LABEL, fields: [positional(0, { $ref: "MigrationError" })] },
      { name: "Ok", label: NO_LABEL, fields: [positional(0, ok)] },
    ],
  },
});
/** `Maybe (v2 -> Result MigrationError v1)` as the parser inlines it. */
const MAYBE_BACKWARD: FenelType = {
  $variant: {
    cases: [
      { name: "Nothing", label: NO_LABEL },
      {
        name: "Just",
        label: NO_LABEL,
        fields: [
          positional(0, {
            $arrow: {
              params: [positional(0, { $var: "v2" })],
              returns: resultMigrationError({ $var: "v1" }),
            },
          }),
        ],
      },
    ],
  },
};

export const migration: Interface = {
  name: "Migration",
  description:
    "Typed schema evolution: each pairwise type-version transition is an instance carrying forward / backward functions and a losslessness flag. Compose via `composeMigration` to derive multi-step migrations. The migration graph is a first-class queryable value (see `findMigrationPath`). See `design/structural-introspection.md` Instance 5 + `design/implementation-roadmap.md` Phase 10.",
  params: [{ name: "v1" }, { name: "v2" }],
  methods: [
    {
      name: "forward",
      description:
        "The forward migration, `v1 -> Result MigrationError v2`. Always defined — the contract of a migration is that the forward direction is total-but-fallible.",
      params: [positional(0, { $var: "v1" })],
      returns: resultMigrationError({ $var: "v2" }),
    },
    {
      name: "backward",
      description:
        "Maybe the backward migration, `v2 -> Result MigrationError v1`: `Just` the function on Lossless instances, `Nothing` on Lossy. Encoded as the canonical Fenel `Maybe a` wire shape (`{$tag: \"Nothing\"}` / `{$tag: \"Just\", _0: <function>}`) so the typeclass shape itself disallows a well-defined inverse on lossy migrations.",
      params: [],
      returns: MAYBE_BACKWARD,
    },
    {
      name: "losslessness",
      description:
        "`Lossless` if the migration roundtrips exactly; `Lossy { reason }` when the migration forgets information. Composition is conservative: any Lossy leg makes the composition Lossy. The reason field documents the source of loss.",
      params: [],
      returns: { $ref: "Losslessness" },
    },
    {
      name: "roundtripSamples",
      description:
        "Per-instance sample list (List<v1>) driving the `migration-roundtrip-lossless` and `migration-forward-total` laws. Each Migration carries its own samples — the law-validator filters per-instance through this method rather than pulling shared samples from the typeclass declaration. Storybook-style: a small, varied set covering empty / typical / edge values for v1. Lossy instances may still supply samples; the roundtrip law is vacuous on those (no backward) but the forward-total law still runs.",
      params: [],
      returns: List({ $var: "v1" }),
    },
  ],
  laws: [
    {
      name: "migration-roundtrip-lossless",
      description:
        "For every v1 in the instance's `roundtripSamples`, `backward(forward(v1)) = Ok v1`. Vacuous on Lossy instances (their `backward` is Nothing). The per-case check `migration:roundtripCheck` applies the forward / backward functions, applies the round-trip, and asserts deepEq with the original v1; sample iteration happens inside the native so the law-validator sees a single closed-form property. The audit picks this up as `pass` (SolverChecked) — the evidence is empirical iteration but the dispatch-level statement is binary. Future work: promote per-instance to kernel-verified SampleTested via a `migration:propose` Prover instance (Phase 11+ follow-up, mirrors Phase 8's Compilable promotion).",
      forall: [],
      property: {
        deepEq: [
          {
            call: [
              "migration:roundtripCheck",
              { var: "forward" },
              { var: "backward" },
              { var: "losslessness" },
              { var: "roundtripSamples" },
            ],
          },
          { $tag: "Just", _0: true },
        ],
      },
    },
    {
      name: "migration-forward-total",
      description:
        "For every v1 in the instance's `roundtripSamples`, `forward(v1)` returns `Ok _` (no MigrationError surfaces). The forward direction is the irreplaceable contract of a migration — an instance whose forward fails on its own declared samples is refuted. Sample iteration via `migration:forwardTotalCheck`. Always non-vacuous (runs on every instance, regardless of losslessness).",
      forall: [],
      property: {
        deepEq: [
          {
            call: [
              "migration:forwardTotalCheck",
              { var: "forward" },
              { var: "roundtripSamples" },
            ],
          },
          { $tag: "Just", _0: true },
        ],
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Aggregate export — consumed by builtin-classes.ts to merge into the global
// `builtinTypeclasses` array.
// ---------------------------------------------------------------------------

export const migrationTypeclasses: Interface[] = [migration];


// ---------------------------------------------------------------------------
// Open registry — registerMigration / findMigration / findMigrationPath
//
// Mirrors Phase 9's `registerAggregable` pattern: a process-wide side-table
// keyed by `(v1Tag, v2Tag)` strings. Instance objects flow through unchanged
// — the registry is just a fast index for the typeclass-instance walk that
// the path-finder uses.
//
// Why a separate index instead of going through the typeclass registry
// directly: the path-finder needs cheap neighbour enumeration ("what
// versions can I migrate FROM v1?"), which the typeclass registry's
// O(n) instance walk doesn't give. The registry is the side-effect of
// `registerMigration`; the typeclass registry separately carries the same
// instances for dispatch.
// ---------------------------------------------------------------------------

const migrationRegistry: Map<string, Instance> = new Map();
const migrationsByV1: Map<string, Set<string>> = new Map();

/** Lookup key for the migration registry. */
function migrationKey(v1: string, v2: string): string {
  return `${v1}->${v2}`;
}

/**
 * Register a Migration instance keyed by its `(args[0], args[1])` version
 * pair. Idempotent — re-registering the same key overwrites. The instance
 * object is also expected to be registered with the global typeclass
 * registry (via SYSTEM_MODULES); this function just adds it to the
 * path-finding index.
 *
 * Throws if `inst.args` doesn't have at least two string version tags —
 * the migration shape requires exact source / target identification.
 */
export function registerMigration(inst: Instance): void {
  if (inst.typeName !== "Migration") {
    throw new Error(
      `registerMigration: expected class "Migration", got "${inst.typeName}"`,
    );
  }
  const v1 = inst.args[0];
  const v2 = inst.args[1];
  if (typeof v1 !== "string" || typeof v2 !== "string") {
    throw new Error(
      `registerMigration: expected string version tags in args[0], args[1]; got ${JSON.stringify(inst.args)}`,
    );
  }
  migrationRegistry.set(migrationKey(v1, v2), inst);
  let outs = migrationsByV1.get(v1);
  if (!outs) {
    outs = new Set();
    migrationsByV1.set(v1, outs);
  }
  outs.add(v2);
}

/** Direct lookup. Returns the registered Migration instance or `undefined`. */
export function findMigration(
  v1: string,
  v2: string,
): Instance | undefined {
  return migrationRegistry.get(migrationKey(v1, v2));
}

/**
 * BFS over the migration graph. Returns either:
 *   `Just [m1, m2, ..., mn]`  — a shortest chain such that composing the
 *                                forwards lands V1 in Vn (Lossy if any
 *                                intermediate is Lossy)
 *   `Nothing`                  — no path exists (disconnected versions)
 *
 * Self-loop (`v1 === v2`) returns `Just []` — the identity migration is
 * the empty composition. Composition with `composeMigration` over the
 * returned chain produces the multi-hop Migration instance; callers that
 * want the chain itself (for diagnostics, partial application, etc.) read
 * the array directly.
 *
 * BFS gives the *shortest* path. The migration graph is typically small
 * (per-entity version chain), so BFS dominates DFS-with-backtracking on
 * both clarity and performance. No backtracking optimisations here —
 * pre-mature for a graph that's rarely more than ~10 nodes.
 */
export function findMigrationPath(
  v1: string,
  v2: string,
): { $tag: "Just"; _0: Instance[] } | { $tag: "Nothing" } {
  if (v1 === v2) return { $tag: "Just", _0: [] };
  // BFS: queue of (current-version, chain-to-reach-it). Visited set
  // prevents cycles (e.g. a renamed-back-and-forth migration loop).
  const queue: Array<{ at: string; chain: Instance[] }> = [
    { at: v1, chain: [] },
  ];
  const visited = new Set<string>([v1]);
  while (queue.length > 0) {
    const { at, chain } = queue.shift()!;
    const outs = migrationsByV1.get(at);
    if (!outs) continue;
    for (const next of outs) {
      if (visited.has(next)) continue;
      const inst = migrationRegistry.get(migrationKey(at, next));
      if (!inst) continue; // defensive; should never happen given the index invariant
      const nextChain = [...chain, inst];
      if (next === v2) return { $tag: "Just", _0: nextChain };
      visited.add(next);
      queue.push({ at: next, chain: nextChain });
    }
  }
  return { $tag: "Nothing" };
}

/** Enumerate every registered Migration instance — useful for tests, the
 *  audit script, and registry-introspection UI. Returns an unsorted array;
 *  callers that want a stable order sort by `args[0]` / `args[1]`. */
export function listMigrations(): Instance[] {
  return Array.from(migrationRegistry.values());
}

/** Test-only helper: drop a Migration instance from both the registry and
 *  the path-finding index. Used by tests that register a stub V3→V4 and
 *  want to clean up afterwards. Production code never needs this. */
export function unregisterMigration(v1: string, v2: string): void {
  migrationRegistry.delete(migrationKey(v1, v2));
  const outs = migrationsByV1.get(v1);
  if (outs) {
    outs.delete(v2);
    if (outs.size === 0) migrationsByV1.delete(v1);
  }
}

// ---------------------------------------------------------------------------
// composeMigration — pointwise composition for Migration instances.
//
// Mirrors `composeIso` in `codec.ts`. The composed instance:
//
//   composed.forward : v1 → Result MigrationError v3
//     step 1 = m1.forward(v1)   : Result E v2
//     step 2 (when Ok v2) = m2.forward(v2) : Result E v3
//     propagate Err.
//
//   composed.backward : v3 → Result MigrationError v1     (Lossless only)
//     step 1 = m2.backward(v3)  : Result E v2
//     step 2 (when Ok v2) = m1.backward(v2) : Result E v1
//
//   composed.losslessness:
//     Lossless ∘ Lossless = Lossless
//     Lossless ∘ Lossy    = Lossy { reason: <inner>.reason }
//     Lossy    ∘ Lossless = Lossy { reason: <outer>.reason }
//     Lossy    ∘ Lossy    = Lossy { reason: "composed of: <m1>, <m2>" }
//
//   composed.roundtripSamples: m1.roundtripSamples
//     The composed migration starts from v1, so the m1 samples are the
//     right ones to drive its laws. (m2.roundtripSamples are v2 values,
//     which the composed.forward shouldn't be tested with — they're
//     intermediate.)
//
// Method bodies are inline `{fn: [...]}` closures that call the input
// migrations' functions (references, function ids or closures) — the same
// shape as `composeIso`. The composed instance gets `priority: -1` so an explicitly-
// registered authoritative migration always wins on overlapping (v1, v2)
// pairs.
//
// The composed instance does NOT auto-register itself — callers that want
// the path-finder to see it call `registerMigration(composed)` explicitly.
// Default behaviour: composition is derived on-the-fly from a path returned
// by `findMigrationPath`, not stored.
// ---------------------------------------------------------------------------

export function composeMigration(
  m1: Instance,
  m2: Instance,
  options: { args?: Instance["args"]; label?: string } = {},
): Instance {
  if (m1.typeName !== "Migration" || m2.typeName !== "Migration") {
    throw new Error(
      `composeMigration: both inputs must be Migration instances (got ${m1.typeName}, ${m2.typeName})`,
    );
  }
  const m1Forward = callableHead(m1.methods["forward"], "composeMigration: the first Migration's `forward`");
  const m2Forward = callableHead(m2.methods["forward"], "composeMigration: the second Migration's `forward`");
  const m1Backward = m1.methods["backward"];
  const m2Backward = m2.methods["backward"];
  const m1Loss = readLosslessness(m1.methods["losslessness"], "composeMigration: the first Migration's `losslessness`");
  const m2Loss = readLosslessness(m2.methods["losslessness"], "composeMigration: the second Migration's `losslessness`");

  // composed.forward : v1 → Result E v3
  //   step 1 = m1.forward(v1)          : Result E v2
  //   step 2 (when Ok v2) = m2.forward(v2) : Result E v3
  //
  // Method values may be function references (`{$ref}`, the authored
  // instances), function id strings, or inline `{fn: [...]}` closures
  // (produced by prior compose calls). The evaluator's
  // `{call: [methodValue, arg]}` form applies each of them, so compose
  // chains freely.
  const composedForward = {
    fn: [
      "_v1",
      {
        match: [
          { call: [m1Forward, { var: "_v1" }] },
          { $tag: "Err", _0: { $bind: "_err" } },
          { construct: ["Err", { var: "_err" }] }, // propagate the error unchanged
          { $tag: "Ok", _0: { $bind: "_v2" } },
          { call: [m2Forward, { var: "_v2" }] },
        ],
      },
    ],
  };

  // Composed losslessness — any Lossy leg poisons the composition.
  let composedLoss: Losslessness;
  if (m1Loss.$tag === "Lossless" && m2Loss.$tag === "Lossless") {
    composedLoss = LOSSLESS;
  } else if (m1Loss.$tag === "Lossless" && m2Loss.$tag === "Lossy") {
    composedLoss = lossy(m2Loss.reason);
  } else if (m1Loss.$tag === "Lossy" && m2Loss.$tag === "Lossless") {
    composedLoss = lossy(m1Loss.reason);
  } else {
    const r1 = m1Loss.$tag === "Lossy" ? m1Loss.reason : "unknown";
    const r2 = m2Loss.$tag === "Lossy" ? m2Loss.reason : "unknown";
    const m1Label = labelOf(m1);
    const m2Label = labelOf(m2);
    composedLoss = lossy(`composed of: ${m1Label} (${r1}), ${m2Label} (${r2})`);
  }

  // composed.backward — defined only when BOTH legs are Lossless. The
  // wire shape mirrors how instance methods carry Maybe-wrapped backward
  // values: `{$tag: "Just", _0: <function>}` / `{$tag: "Nothing"}`. Inside
  // the Just we accept a reference, a function id or an inline closure (same
  // chain-freely posture as `forward`); a malformed backward throws.
  let composedBackward: unknown;
  const m1BackwardCallable = readJustCallable(m1Backward, "composeMigration: the first Migration's `backward`");
  const m2BackwardCallable = readJustCallable(m2Backward, "composeMigration: the second Migration's `backward`");
  if (
    composedLoss.$tag === "Lossless" &&
    m1BackwardCallable !== undefined &&
    m2BackwardCallable !== undefined
  ) {
    // composed.backward : v3 → Result E v1
    //   step 1 = m2.backward(v3)          : Result E v2
    //   step 2 (when Ok v2) = m1.backward(v2) : Result E v1
    composedBackward = {
      $tag: "Just",
      _0: {
        fn: [
          "_v3",
          {
            match: [
              { call: [m2BackwardCallable, { var: "_v3" }] },
              { $tag: "Err", _0: { $bind: "_err" } },
              { construct: ["Err", { var: "_err" }] }, // propagate the error unchanged
              { $tag: "Ok", _0: { $bind: "_v2" } },
              { call: [m1BackwardCallable, { var: "_v2" }] },
            ],
          },
        ],
      },
    };
  } else {
    composedBackward = { $tag: "Nothing" };
  }

  // Composed roundtripSamples — m1's samples are v1 values, which is the
  // correct input type for composed.forward. Default to m1's samples; the
  // caller can override via `options` (not exposed today, but the shape
  // supports it).
  const composedSamples = m1.methods["roundtripSamples"] ?? [];

  return {
    typeName: "Migration",
    args: options.args ?? [
      ...m1.args.slice(0, 1), // v1 from m1
      ...m2.args.slice(1, 2), // v3 from m2
    ],
    methods: {
      forward: composedForward,
      backward: composedBackward,
      losslessness: composedLoss,
      roundtripSamples: composedSamples,
    },
    priority: -1,
    ...(options.label !== undefined ? { label: options.label } : {}),
  };
}

/** Compose a chain (e.g. the output of `findMigrationPath`) into a single
 *  Migration. Empty chain throws — there's no canonical identity migration
 *  instance to return (an identity migration would name its own (v, v)
 *  pair, which the caller would have to supply). Single-element chain
 *  is the input. */
export function composeMigrationChain(
  chain: Instance[],
): Instance {
  if (chain.length === 0) {
    throw new Error(
      "composeMigrationChain: cannot compose an empty chain (no identity migration is implied — supply the source pair if needed)",
    );
  }
  let acc = chain[0]!;
  for (let i = 1; i < chain.length; i++) {
    acc = composeMigration(acc, chain[i]!);
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** The call head for a callable method value, or a loud error. Accepted:
 *   - a function reference `{$ref: handle}` (read as an OWN data property,
 *     `functionRefHandle`) → a fresh `{$ref: handle}`;
 *   - a non-empty function id string → itself;
 *   - an inline closure `{fn: [paramName, body]}` (what compose builds) →
 *     itself.
 *  Anything else is malformed and throws, naming `what`. Exported for the
 *  migration check natives (fenel/modules/migration/ffi). */
export function callableHead(v: unknown, what: string): string | object {
  if (typeof v === "string") {
    if (v.length > 0) return v;
  } else if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    const handle = functionRefHandle(v);
    if (handle !== undefined) return { $ref: handle };
    const fn = Object.getOwnPropertyDescriptor(v, "fn");
    if (fn !== undefined && "value" in fn && Array.isArray(fn.value)) return v;
  }
  throw new Error(
    `${what} must be a function reference, a function id string or an inline closure; got ${describeValue(v)}`,
  );
}

/** Read a `Maybe <function>` method value. `{$tag: "Nothing"}` → `undefined`;
 *  `{$tag: "Just", _0: <callable>}` → the call head for the callable (see
 *  `callableHead`). A Just whose payload is not callable, and anything that is
 *  not a Maybe, is malformed and throws: a malformed Just is never read as
 *  Nothing. Exported for the migration check natives. */
export function readJustCallable(v: unknown, what: string): string | object | undefined {
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    const tag = Object.getOwnPropertyDescriptor(v, "$tag");
    const tagValue = tag !== undefined && "value" in tag ? tag.value : undefined;
    if (tagValue === "Nothing") return undefined;
    if (tagValue === "Just") {
      const payload = Object.getOwnPropertyDescriptor(v, "_0");
      if (payload === undefined || !("value" in payload)) {
        throw new Error(`${what}: a Just without a payload is malformed; got ${describeValue(v)}`);
      }
      return callableHead(payload.value, `${what} (the Just payload)`);
    }
  }
  throw new Error(`${what} must be Nothing or Just a function; got ${describeValue(v)}`);
}

/** Read a `Losslessness` value (`Lossless` | `Lossy { reason }`), or throw. */
function readLosslessness(v: unknown, what: string): Losslessness {
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    const o = v as { $tag?: unknown; reason?: unknown };
    if (o.$tag === "Lossless") return LOSSLESS;
    if (o.$tag === "Lossy" && typeof o.reason === "string") return lossy(o.reason);
  }
  throw new Error(`${what} must be Lossless or Lossy { reason }; got ${describeValue(v)}`);
}

function describeValue(v: unknown): string {
  try {
    const text = JSON.stringify(v);
    return text === undefined ? String(v) : text;
  } catch {
    return String(v);
  }
}

/** Best-effort label for diagnostic strings. Falls back to args. */
function labelOf(inst: Instance): string {
  if (typeof inst.label === "string") return inst.label;
  return `Migration<${inst.args.map((a) => JSON.stringify(a)).join(", ")}>`;
}

/** Test-only helper. Drops every registered migration. Used by tests that
 *  want a clean slate after registering stubs. Production never calls. */
export function _clearMigrationRegistry_TEST_ONLY(): void {
  migrationRegistry.clear();
  migrationsByV1.clear();
}
