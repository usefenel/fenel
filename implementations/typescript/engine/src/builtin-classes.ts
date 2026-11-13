// ---------------------------------------------------------------------------
// Built-in typeclasses, instances, and type constructors
//
// The first inhabitants of FenelType's typeclass system:
//
//   Referenceable a           — has identity, can be referenced
//   Groupable a               — can be organized into named groups
//   Group :: Groupable a => a -> Type   — parameterized grouping entity
// ---------------------------------------------------------------------------

import { SAMPLE_IMAGES } from "./image-data";
import {
  SAMPLE_SOUNDS,
  SAMPLE_ANIMATIONS,
  SAMPLE_MOVIES,
  SAMPLE_TRACKS,
  SAMPLE_EVENTS,
  SAMPLE_GAMES,
} from "./sample-media";
import type {
  Interface,
  Instance,
} from "./types";
import { codecTypeclasses } from "./codec";
import { decidableMembershipTypeclasses } from "./decidable-membership";
import { proverTypeclasses } from "./prover";
import { compilableTypeclasses } from "./compilable";
import { evaluatorTypeclasses } from "./evaluator-class";
import { aggregableTypeclasses } from "./aggregable";
import { migrationTypeclasses } from "./migration";

// ---------------------------------------------------------------------------
// Typeclasses
// ---------------------------------------------------------------------------

// Phase 7d (typeclass-substrate-completion) DELETED the hand-written
// `referenceable` / `groupable` / `undefinable` `Interface` literals. They are
// now DERIVED from the `.fenel` class records (`typeclass-specs.fenel`) via
// `seedFromType` + `defineClass` in `buildRegistry` (system-entities.ts), like
// the pure classes (7a), law classes (7bc), and effect-supers classes (7b′).
//
// The new surface this phase introduced: a class-record field's DEFAULT value
// `field: T = <expr>` IS a typeclass method's DEFAULT BODY (locked-model "a
// method is a field"). `seedFromType` carries `FieldDef.default` → the derived
// `InterfaceMethod.body` — the exact slot `dispatch-registry.ts:resolve` already read as
// the instance-omitted fallback (no parallel resolution path). So:
//   • Referenceable — `refId: String = "id"`  → body "id".
//   • Undefinable   — `isErasable: Boolean = False` → body false (the `= False`
//     Bool constructor is coerced to JS `false` at load, byte-matching the
//     deleted seed).
//   • Groupable — the CAPSTONE composing all three class-declaration features:
//     super `referenceable: Referenceable a` (`$el`-typed obligation field, 7b′)
//     + law `structureValid: Verified Boolean` (7bc) + default
//     `groupStructure: String = "flat"` (7d). Both the super + law fields are
//     erased from the dispatch method set; the derived seed's methods
//     (`groupName`/`groupLabel`/`groupStructure`), `body` defaults, and
//     `supers` (`[Referenceable a]`) byte-match the deleted literal. The
//     `groupStructure` return is plain `String` (refinement lives in the law) —
//     an INTENTIONAL idiomatic accept, not a byte-identity failure (Decision #5).

// `Undefinable a` — types whose values may be absent in non-Fenel
// representations (JSON Schema's `required: false`, JSON's `undefined`, SQL's
// NULL). Inside Fenel optionality is `Maybe a` (a tagged sum, no undefined);
// Undefinable is the *projection* into those non-Fenel worlds — `isErasable`
// answers "may this type's values be omitted in serialisation?". The class is
// DERIVED in Phase 7d from `Undefinable a = Undefinable isErasable: Boolean =
// False` (the `= False` default body lands in `InterfaceMethod.body`, coerced to JS
// `false`). The `Maybe a` / `FieldMetadata` INSTANCES (`isErasable: true`)
// remain TS-side below.

// ---------------------------------------------------------------------------
// Identifiable surface — every named Fenel thing has one identity (UUID),
// and *facets* of that identity (label, codeName, description, icon, aliases)
// come from typeclass instances. Struct fields stay for backwards compat
// during the transition; typeclass dispatch is the long-term home.
// ---------------------------------------------------------------------------

// Phase 7bc (typeclass-substrate-completion) DELETED the hand-written
// `labelable` / `codeable` / `iconable` `Interface` literals. They are now
// DERIVED from the `.fenel` class records (`typeclass-specs.fenel`) via
// `seedFromType` + `defineClass` in `buildRegistry` (system-entities.ts),
// exactly as the FP trinity (3.3a) and the 28 pure classes (7a) are. Each
// record carries a `Verified Boolean` law field (`labelNonEmpty`, …) which the
// field-type classifier ERASES from the dispatch method set — the law itself is
// read from the entity TYPE by `law-validation.ts`, not from a `Interface.laws`
// array. Phase 7e DERIVED Emojiable the same way (a LAW class): its `.fenel`
// record carries `emojiNonEmpty: Verified Boolean` (erased like Labelable's) PLUS
// a refined-return divergence — the deleted seed declared `emoji : String | value
// ∈ str:emoji`; the `.fenel` field is plain `String`. The refined RETURN is a
// documented ACCEPT (not validated against instance data the way a class LAW is,
// so dropping it loses no runtime check; cf. Infixable's `associativity` +
// Groupable's `groupStructure`). See the system-entities.ts law-class block.

// Phase 7f (typeclass-substrate-completion) DELETED the hand-written
// `renderable` `Interface` literal that used to live here — the LAST one. It
// was DEAD CODE: a 1-nullary `render: String` seed registered at boot via the
// `builtinTypeclasses` loop, then OVERWRITTEN by the richer 3-field LIVE seed
// from `modules/templates.ts` (`defineClass` is a `Map.set`; MODULE_TYPECLASSES
// ran after). Both seeds are now deleted; Renderable derives from its `.fenel`
// class record (`typeclass-specs.fenel`) via `seedFromType` + `defineClass` in
// `buildRegistry` (system-entities.ts `pureClasses`) after the `format`→`a`
// param fix. `render` is now correctly a FUNCTION-typed field (`Markup -> a`),
// not a fn-id String. The 4 instances (email/sms/telegram/pdf) survive on
// `templateModule.instances` and still resolve through `registry.ts`'s
// `renderByTag`. With this, `builtinTypeclasses` is `[]` — zero hand-written
// class seeds, the class-side end state of the workstream.

// Phase 7e (typeclass-substrate-completion) DELETED the hand-written
// `exemplifiable` / `storyboardable` / `aliasable` `Interface` literals. They
// are now DERIVED from the `.fenel` class records (`typeclass-specs.fenel`) via
// `seedFromType` + `defineClass` in `buildRegistry` (system-entities.ts), in
// `pureClasses`:
//   • Exemplifiable (`examples: List a`) + Storyboardable (`storyboard: List f`,
//     param `f`) derive with the seed's `$var`-element shape now that
//     `normalizeClassParam` recurses into the `List` `$opaque.pure` container
//     (effect-dispatch.ts — Phase 7e MECHANISM 1).
//   • Aliasable (`aliases: Map String String`) derives with the parser's
//     canonical `{$ref:"String"}` Map key (7g-retire-2b #2a — the parser hardcodes
//     Map keys to the canonical `String`, `Str` retired; the deleted seed's
//     aspirational `TargetLanguage` key is neither a registered entity nor
//     parseable). The Map-key divergence is a documented ACCEPT, exempt
//     from byte-identity — cosmetic, dispatch-irrelevant (the method is nullary).

// ---------------------------------------------------------------------------
// Effect typeclasses
//
// These are the "capabilities" a function can require — declared via
// `requires: TypeclassConstraint[]` on the FenelFunction record. The
// dispatch resolver looks up an instance of each required class in the
// active scope and routes the call to the instance's method.
//
// Hierarchy via `supers`: HasHTTP requires HasNetwork, HasEmail
// requires HasNetwork, etc. Ensures coarser capabilities are
// auto-satisfied when finer ones are.
//
// Domain typeclasses (HasStateIO, HasEmail, HasSocialMedia) are
// medium-grained — multiple methods per class, one class per
// capability domain. See design/effect-system.md for the granularity
// rationale.
// ---------------------------------------------------------------------------

// Phase 7b′ (typeclass-substrate-completion) DELETED the four effect-supers
// `Interface` literals that lived here — `hasHTTP` / `hasEmail` /
// `hasSocialMedia` / `hasTelegramBot`. Their dispatch seeds are now DERIVED
// from the `.fenel` class records (`typeclass-specs.fenel`) via `seedFromType`
// + `defineClass` in `buildRegistry` (system-entities.ts), exactly as the pure
// classes (7a) and law classes (7bc) are. The superclass constraint is sourced
// from an `$el`-typed obligation FIELD on the class record (`HasHTTP scope =
// HasHTTP network: HasNetwork scope …`) — NO `=>` sugar, NO sidecar — recognized
// + erased by the field-type classifier (`effect-dispatch.ts:isSuperclassField`/
// `supersOf`), NOT a hand-written `supers:[]` array. The derived seed's method
// set, dispatch positions, and `supers` byte-match the deleted literals — proven
// per-class in `phase-7b-supers-fenel-surface.test.ts`.

// ---------------------------------------------------------------------------
// Instances
// ---------------------------------------------------------------------------

// Referenceable / Groupable / the String|Number|Int|Nat HasDefault entries
// migrated to `fenel/std/dispatch-instances.fenel` in Phase 3 of
// typeclass-substrate-completion (2026-05-28). typed-function-references
// Phase 11 (2026-06-05) finished the HasDefault slice: `booleanHasDefault`
// (`default = False`) joined the `.fenel` file (the `= False` Bool constructor
// coerces to JS `false` byte-identically), and `unitHasDefault` (`default =
// null`) was DROPPED — it was runtime-dead (`defaultValueFor` short-circuits a
// `$unit` type to null before any registry lookup, AND its `case "Unit"`
// fallback returns null identically, so the instance changed nothing; `null`
// is not a Fenel value). No HasDefault instances remain TS-side.

// -- Undefinable — projection into "may be absent" non-Fenel representations --
// Default for any type without an instance: not erasable. The Maybe a
// constructor is the one type whose values legitimately project to "absent".
// typed-function-references Phase 11 moved `fieldMetadataUndefinable` (a single
// boolean method) to the `.fenel` file; `maybeUndefinable` stays TS-side
// because its applied-type arg `Undefinable (Maybe a)` expands to a full
// `$variant` in sig position (and `a` → `{$ref}`, not the `{$var}` the const
// holds), so the projected dispatch key diverges from the const's
// `{$el:{call:["Maybe",{$var:"a"}]}}` — migrating it would move the
// unevaluated-Maybe `isErasableType` registry path (set-algebra.ts step 3).

export const maybeUndefinable: Instance = {
  typeName: "Undefinable",
  args: [{ $el: { call: ["Maybe", { $var: "a" }] } }],
  methods: { isErasable: true },
};

// Phase 8 preview-instance for Phase 9's `FieldDef.meta?` → `FieldMetadata`
// lift. After Phase 9 declares the slot as `FieldMetadata` (no `?:`, no
// `Maybe<>` wrapper), the codec layer reads this Undefinable instance to
// know the meta sidecar can be omitted from the serialised form when
// empty/absent. The TS-side `FieldMetadata` type lives in `field-meta.ts`;
// the registry indexes the instance by the name "FieldMetadata" — matcher
// uses string equality, no FieldMetadata import needed here.
// typed-function-references Phase 11 moved `fieldMetadataUndefinable` to
// `fenel/std/dispatch-instances.fenel` (a single boolean method round-trips
// byte-identically via the `= True` Bool coercion).

// -- Exemplifiable — sample values for the storybook surface --
// These are deliberately a small, varied set: the storybook isn't a test
// suite, it's a "what does this type look like with concrete values" lens.
// Edge cases (empty, very large, unicode) live alongside ordinary values
// so reviewers immediately notice if a widget mishandles any of them.
//
// typed-function-references Phase 11 moved String/Nat/Boolean to
// `fenel/std/dispatch-instances.fenel`. Number/Int stay TS-side: their arrays
// carry NEGATIVE literals (`-1`, `-273.15`, `-42`), which the parser lowers to
// `{call:["negate",N]}` — not the plain `-N` these consts store — so they don't
// round-trip byte-identically yet (a negative-number-literal lexer gap; folding
// it is a loader decision, deferred). The media Exemplifiable below stay TS-side
// because their `examples` are TS-GENERATED sample matrices, not hand-authored
// instance data.

export const numberExemplifiable: Instance = {
  typeName: "Exemplifiable",
  args: ["Number"],
  methods: { examples: [0, 1, -1, 3.14159, 42, -273.15, 1_000_000] },
};

export const intExemplifiable: Instance = {
  typeName: "Exemplifiable",
  args: ["Int"],
  methods: { examples: [0, 1, -1, 7, -42, 100] },
};

// Image is a structural Fenel type (record { width, height, pixels:
// List<RgbaPixel> }) — see `./image-data` for the type definition and the
// programmatically-generated sample matrices. The storybook renders
// these values through a canvas widget in the dashboard.
export const imageExemplifiable: Instance = {
  typeName: "Exemplifiable",
  args: ["Image"],
  methods: { examples: SAMPLE_IMAGES },
};

// Sound / Animation / Movie / Track / Event examples — pre-rendered to
// concrete Buffer / Frames / Recorded / record shapes (no live closures)
// so the storybook widgets can read pure data. See `./sample-media` for
// the math used to generate each.
export const soundExemplifiable: Instance = {
  typeName: "Exemplifiable",
  args: ["Sound"],
  methods: { examples: SAMPLE_SOUNDS },
};

export const animationExemplifiable: Instance = {
  typeName: "Exemplifiable",
  args: ["Animation"],
  methods: { examples: SAMPLE_ANIMATIONS },
};

export const movieExemplifiable: Instance = {
  typeName: "Exemplifiable",
  args: ["Movie"],
  methods: { examples: SAMPLE_MOVIES },
};

export const trackExemplifiable: Instance = {
  typeName: "Exemplifiable",
  args: ["Track"],
  methods: { examples: SAMPLE_TRACKS },
};

export const eventExemplifiable: Instance = {
  typeName: "Exemplifiable",
  args: ["Event"],
  methods: { examples: SAMPLE_EVENTS },
};

export const gameExemplifiable: Instance = {
  typeName: "Exemplifiable",
  args: ["Game"],
  methods: { examples: SAMPLE_GAMES },
};

// Exportable / Layout / Representational :: X marker instances migrated to
// `fenel/std/dispatch-instances.fenel` in Phase 3 of typeclass-substrate-
// completion (2026-05-28). Exportable = downloadable file formats per type
// (frontend reads via `getExportFormats(typeName)`); Layout = built-in view
// shapes used by /dashboard/home; Representational = the marker set the
// shared RepresentationsPanel queries via `instancesOf("Representational")`.
// See design/representations.md for the Representational architecture.

// ---------------------------------------------------------------------------
// Infixable — functions that can be rendered/parsed as infix operators.
//
// The replacement for the legacy hardcoded JSON-Logic operator special-
// casing (`OPERATOR_SPECS` in the editor, `case "+" / case "and" / ...`
// in `json-logic.ts`). Any Fenel function with an `Infixable` instance
// declares its operator notation, binding strength, and associativity —
// the editor consults this to render infix; the parser consults it to
// recognise infix tokens; future user-defined operators just require a
// function + Infixable instance.
//
// Precedence follows Haskell's 0..9 convention (higher = binds tighter):
//
//   9 — function application (n/a — Infixable is for binary operators)
//   8 — exponent ^
//   7 — multiplicative * / % div mod
//   6 — additive + -
//   5 — list/sequence ++ : <>
//   4 — comparison == /= < > <= >=
//   3 — logical and (&&)
//   2 — logical or  (||)
//   1 — sequencing/seq
//   0 — application $
//
// Associativity is `left | right | none`. Mixed-associativity expressions
// at the same precedence require parens; `none` means the operator can't
// be chained at all (e.g. `a == b == c` is rejected).
//
// Phase 7e (typeclass-substrate-completion) DELETED the hand-written
// `infixable` `Interface` literal. It is now DERIVED from the `.fenel` class
// record (`typeclass-specs.fenel`) via `seedFromType` + `defineClass` in
// `buildRegistry` (system-entities.ts), in `pureClasses`. The `.fenel`
// `associativity: String` field derives a plain-`String` return; the deleted
// seed's refined `String | value ∈ {left,right,none}` enum is a documented
// ACCEPT (a refined RETURN on a nullary method isn't validated against instance
// data the way a class LAW is, so dropping it loses no runtime check; cf.
// Emojiable's `emoji` + Groupable's `groupStructure`). The Infixable INSTANCES
// (now `.fenel`-authored in `fenel/std/parser-fixities.fenel`) dispatch by the
// `"Infixable"` typeName string and are UNTOUCHED by deriving the class seed.
// ---------------------------------------------------------------------------

// Built-in Infixable instances for std:* operator functions, plus the
// matching Prefixable instances for unary `not` / `-`. The args[0] slot
// is the function id — same fn-keyed convention as Codeable / Labelable /
// Categorizable. Adding a new infix or prefix operator means defining a
// function and registering the relevant typeclass instance keyed by its id;
// no engine changes required.
//
// typed-function-references Phase 12 RETIRED the hand-written TS consts that
// used to live in `parser-fixities.ts` (and were re-exported here): the
// `Infixable` / `Prefixable` instances are now Fenel-authored typed values in
// `fenel/std/parser-fixities.fenel`. `parser-fixities.ts` projects them lazily
// (`getFixityInstances`) for the parser + printer; `buildRegistry`
// (system-entities.ts) registers them into `dispatchRegistry` for introspection.
// None flow through `builtinInstances` anymore.

// Bool truthy = identity (True → True, False → False). typed-function-references
// Phase 11 moved `boolTruthy` to `fenel/std/dispatch-instances.fenel`: the
// lambda `\x -> x` lowers to `{fn:["x",{var:"x"}]}` byte-identically (the nested
// `{var:"x"}` is a lexical param, untouched by the loader's top-level-only
// bare-`{var}`→`{$ref}` flip).

// Per-level Resolvable instances for `Place : GeoLevel -> Type` (six, one per
// GeoLevel). typed-function-references Phase 11 moved the `makePlaceResolvable`
// factory + its six consts to `fenel/std/dispatch-instances.fenel` — the args
// (a dotted tag `Place.GeoCountry`) project to the bare-string arg byte-
// identically, and the three lambda methods (`\x y -> 0`, `\x -> True`,
// `\x -> x`) lower to the same `{fn:[…]}` shapes (the `True` coerces to JS
// `true`). The method bodies are still sensible-default stubs (0 = equal,
// True = accept, identity = pass-through); the per-level ordering logic that
// reads the phantom GeoLevel + delegates to `compareGeoLevel` is a deferred
// follow-up unchanged by the authoring-surface move.

// Filterable — per-entity-type default filter for entity-ref pickers
// (Phase 5b.2 of field-meta-collapse). The class declaration is derived from the
// `.fenel` Filterable record; the `profile` instance (the canonical self-exclude
// rule) is now `.fenel`-authored in fenel/std/dispatch-instances.fenel
// (typed-function-references Phase 10c) — its `defaultFilter` Expression parses
// to the canonical call-form `{call:["neq",…]}`, replacing this TS const's
// legacy operator-form `{"!=":[…]}` (same evaluation by `defaultFilterFor`).

// ---------------------------------------------------------------------------
// Phase 8a of typed-function-references (2026-06-05) — the OPEN `Identifiable h`
// handle class's two instances (UUID / CodeableName handle kinds), declared
// INERTLY. As of typed-function-references Phase 10 (2026-06-05) they are
// `.fenel`-authored value-decls in `fenel/std/dispatch-instances.fenel`, NOT
// TS consts here: Phase 10 taught `lowerSpecMethods` to lower a bare point-free
// reference method (`resolve = getInstanceById` → `{var:"getInstanceById"}`) to
// the dispatch-ready codeableName-handle `{$ref:"getInstanceById"}`, which is
// exactly what stranded these (and every reference-method instance) as TS
// consts before. `resolve` for the UUID handle reads by id (`getInstanceById`);
// for the CodeableName handle by codeName (`getInstanceByName`, the 8c Step 1
// leaf). Still INERT — nothing resolves through `Identifiable` until the
// deferred 8c-2 resolution flip (blocked on the value-vs-type dispatch-key
// finding). The codeName `{$ref}` handle resolves via `getFunction`
// (id-or-codeName) identically to the fnId handle the consts carried.
//
// ---------------------------------------------------------------------------
// Algebra — the canonical FP trinity (Functor / Monad / Monoid). Phase 5 of
// typeclass-substrate-completion declared these as ordinary `.fenel` record
// types in `fenel/std/algebra.fenel`; Phase 3.3a DELETED their parallel
// hand-written TS `Interface`s (`functorClass` / `monadClass` / `monoidClass`)
// — a `.fenel` class declaration is now dispatch-authoritative. `buildRegistry`
// (system-entities.ts) derives the three seeds from the registered `.fenel`
// record types via `effect-dispatch.ts:seedFromType` and `defineClass`es them.
// `dispatchPositionForSeed` reads the derived seed identically to the deleted
// literal: `fmap`→1, `bind`→0, `mappend`→0 are argument-position; `return` /
// `mempty` are return-position → `RETURN_POSITION` (witness elaboration is
// inference-owned). The discovery that unblocked the deletion: angle-bracket
// application `m<a>` parses to `{$el:{call:["m", …]}}` — a dispatch-readable
// shape `seedFromType` normalizes (Phase 5 had believed the parser couldn't
// represent the higher-kinded sigs, and kept the TS seeds). The Maybe/List/
// Result instances are Fenel-authored typed values (algebra-instances.fenel),
// projected via `engine/src/modules/algebra.ts`.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Aggregated exports — for populating a DispatchRegistry
// ---------------------------------------------------------------------------

export const builtinTypeclasses: Interface[] = [
  // Phase 7a (typeclass-substrate-completion) DELETED the 28 PURE-signature
  // representational + effect Interface literals that used to live here — they
  // are now DERIVED from the `.fenel` class records (`typeclass-specs.fenel`)
  // via `seedFromType` + `defineClass` in `buildRegistry` (system-entities.ts),
  // exactly as the FP trinity is (3.3a). Phases 7bc / 7b′ / 7d / 7e cleared the
  // rest of the residue — laws (Labelable / Codeable / Iconable / Emojiable),
  // supers (HasHTTP / HasEmail / HasSocialMedia / HasTelegramBot), method-`body`
  // defaults (Referenceable / Undefinable / Groupable), and the record/seed-
  // divergent five (Emojiable / Infixable / Aliasable / Exemplifiable /
  // Storyboardable) are all derived now.
  //
  // Phase 7f DERIVED the LAST one — Renderable (the `format`→`a` param fix made
  // it pure-signature; it derives in `pureClasses`). There are now ZERO
  // hand-written `Interface` literals in this array's representational/effect/
  // algebra range — the class-side arc (7a→7f) is COMPLETE. What remains below
  // are the Phase-2-5-roadmap module class families (Codec / DecidableMembership
  // / Prover / Compilable), declared in their own modules, not hand-written
  // representational seeds.
  // Effect-supers classes (hasHTTP / hasEmail / hasSocialMedia / hasTelegramBot)
  // DERIVED in Phase 7b′ via the `=>` supers surface — no hand-written seed.
  // Codec / Iso / Lens — Phase 2 of the implementation roadmap. The
  // typeclass declarations live in `./codec.ts`; their instances ride
  // along with the codec module's per-function instances through
  // SYSTEM_MODULES in `system-entities.ts`. See
  // `design/structural-introspection.md` Instance 2.
  ...codecTypeclasses,
  // DecidableMembership — Phase 3 of the implementation roadmap.
  // Replaces the closed SetExpr ADT switch in set-algebra.ts with a
  // registry of per-shape decision procedures. Instances ride along
  // with the decidable-membership module's per-shape functions through
  // SYSTEM_MODULES. See `design/structural-introspection.md` Instance 1.
  ...decidableMembershipTypeclasses,
  // Prover — Phase 4 of the implementation roadmap. Curry-Howard
  // substrate: typeclass-dispatched proposers + a small in-engine
  // kernel that re-checks every proof term. Instances ride along with
  // the prover module's per-shape proposers. See
  // `design/structural-introspection.md` Instance 3 and
  // `prompts/phase-4-prover.md`.
  ...proverTypeclasses,
  // Compilable — Phase 5 of the implementation roadmap. Compilation
  // targets are typeclass instances dispatched on the target's name
  // (JsAst / WasmModule / MachineCode). Each instance carries a `compile`
  // method id that points at a composed lowering pipeline through typed
  // IR dialects. See `design/structural-introspection.md` Instance 6
  // and `prompts/phase-5-compilable.md`.
  ...compilableTypeclasses,
  // Evaluator — Phase 6 of the implementation roadmap. Evaluation
  // strategies are typeclass instances dispatched on the strategy's
  // name (EagerStrategy / LazyStrategy / future PartialStrategy /
  // TracedStrategy / …). Each instance carries an `eval` method id
  // that interprets a JSON-Logic expression under that strategy.
  // Per-scope dispatch dissolves the lazy-vs-eager debate. See
  // `design/structural-introspection.md` Instance 7 and
  // `prompts/phase-6-evaluator.md`.
  ...evaluatorTypeclasses,
  // Aggregable — Phase 9 of the implementation roadmap. Aggregator
  // functions declare their structural properties (input/output type,
  // monotonicity, preimage/image SetExpr functions) so the set-algebra
  // can recognise composition shapes (`agg(value) op K`) inside `$where`
  // and route through the Aggregable instance to restore the
  // structural-subtype reasoning the retired `$preimage` constructor
  // enabled. User-defined aggregators participate by registering their
  // own instance. See `design/implementation-roadmap.md` Phase 9 and
  // `prompts/phase-9-aggregable.md`.
  ...aggregableTypeclasses,
  // Migration — Phase 10 of the implementation roadmap. Typed schema
  // evolution: each pairwise type-version transition is a typeclass
  // instance carrying forward / backward functions and a losslessness
  // flag. Migrations compose like Iso instances; the migration graph
  // becomes a first-class queryable value (BFS path-finding over the
  // typeclass-instance registry). See
  // `design/structural-introspection.md` Instance 5 and
  // `prompts/phase-10-migration.md`.
  ...migrationTypeclasses,
  // Algebra — the canonical FP trinity (Functor / Monad / Monoid) is NOT here:
  // Phase 3.3a deleted the hand-written `functorClass` / `monadClass` /
  // `monoidClass` seeds. They are derived from `fenel/std/algebra.fenel` via
  // `seedFromType` and `defineClass`'d directly in `buildRegistry`
  // (system-entities.ts) — a `.fenel` class declaration is dispatch-authoritative.
];

// Phase 3 of typeclass-substrate-completion (2026-05-28) migrated the clean
// string/array/empty-method instances (Referenceable / Groupable / the
// String|Number|Int|Nat HasDefault entries / Layout / Representational /
// Exportable) to Fenel typed value declarations in
// `fenel/std/dispatch-instances.fenel`. They flow into `dispatchRegistry` via
// the `loadFenelModule(...).instances` projection in `buildRegistry()`
// (system-entities.ts), NOT through this array. typed-function-references
// Phases 10/10c/11 cleared most of the rest: the reference-method instances
// (Identifiable, the module Sampleable/Renderable, profileFilterable — Phase
// 10/10c), then the non-reference slice (Phase 11) — the lambda-method
// instances (Truthy, the 6 Resolvable), the boolean-method instances
// (booleanHasDefault, fieldMetadataUndefinable), and three primitive
// Exemplifiable arrays (String/Nat/Boolean). `unitHasDefault` was dropped
// (runtime-dead). The instances kept below are the genuine remaining
// deferrals, each with a concrete encoding reason:
//   • `maybeUndefinable` — `{$el:{call:["Maybe",…]}}` arg canonically unfolds
//     to `$variant` in sig position, diverging from the const's dispatch key
//     (see Phase 1 + the const's note above);
//   • Number/Int Exemplifiable — NEGATIVE literals lower to `{call:["negate",N]}`,
//     not the plain `-N` the const stores (a negative-number-literal lexer gap);
//   • the media Exemplifiable — TS-GENERATED sample matrices, not hand-authored
//     instance data (porting the generators is a separate task).
// The operator-fixity instances (Infixable/Prefixable) were the last bootstrap-
// circular holdout; typed-function-references Phase 12 moved them to
// `fenel/std/parser-fixities.fenel` (the fixity file is itself fixity-free to
// parse, dissolving the circularity).
export const builtinInstances: Instance[] = [
  // HasDefault — fully migrated/dropped in typed-function-references Phase 11
  // (Boolean → .fenel; Unit dropped as runtime-dead). No entries here.
  // Undefinable — `maybeUndefinable` stays (its applied-type arg can't project
  // byte-identically); `fieldMetadataUndefinable` moved to .fenel in Phase 11.
  maybeUndefinable,
  // Exemplifiable — Number/Int (negative literals) + the media sample matrices
  // stay TS-side; String/Nat/Boolean moved to .fenel in Phase 11.
  numberExemplifiable,
  intExemplifiable,
  imageExemplifiable,
  soundExemplifiable,
  animationExemplifiable,
  movieExemplifiable,
  trackExemplifiable,
  eventExemplifiable,
  gameExemplifiable,
  // Infixable / Prefixable — the operator-fixity instances moved to
  // `fenel/std/parser-fixities.fenel` in typed-function-references Phase 12.
  // The bootstrap circularity ("the parser sources fixity from these to parse
  // `.fenel` at all") dissolved because the fixity file is itself fixity-free to
  // parse. The parser + printer consume them via `parser-fixities.ts`
  // (`getFixityInstances`); `buildRegistry` registers them into `dispatchRegistry`
  // for introspection parity (excluding the `&&`/`||` symbolic aliases, which
  // were never registered). No entries here.
  // Truthy — `boolTruthy` (the `\x -> x` identity) moved to .fenel in
  // typed-function-references Phase 11 (lambda methods round-trip as `{fn}`).
  // Resolvable — the 6 per-GeoLevel `Place : GeoLevel -> Type` instances
  // (field-meta-collapse Phase 4) also moved to .fenel in Phase 11 (dotted-tag
  // args project to bare strings; the lambda stubs round-trip as `{fn}`).
  // Filterable — the `profile` self-exclude default filter is now `.fenel`-
  // authored in fenel/std/dispatch-instances.fenel (typed-function-references
  // Phase 10c). Tree Group<X> fields still carry an inline `ui.refFilter`
  // override pending per-X dynamic Filterable instance generation — see the
  // `Group<X>` factory's `if (isTree)` block in this file.
  // Identifiable — the OPEN handle class's two instances (Phase 8a) are now
  // `.fenel`-authored value-decls in fenel/std/dispatch-instances.fenel
  // (typed-function-references Phase 10 — the loader's bare-`{var}`→`{$ref}`
  // flip unstranded them from TS consts here). They register via the same
  // `loadFenelModule(...).instances` path as the other dispatch instances;
  // still INERT (the 8c-2 resolution flip stays deferred).
];

// `builtinConstructors` removed in Phase 2 of the unified-dispatch
// overhaul — parametric type constructors live in `systemEntities` with
// `params` + `instantiate` set, alongside concrete entities.
