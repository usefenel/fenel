// ---------------------------------------------------------------------------
// Dispatch interface + instance types — the in-memory shapes the dispatch
// registry (`dispatch-registry.ts`) reads to answer the type-indexed dispatch
// query. There is nothing nominal here: an interface is just a registered
// `.fenel` record type (read through `effect-dispatch.ts:seedFromType`) and
// an instance is just a typed value `{ typeName, args, methods }`. These
// types are the STRUCTURAL representation of those two facts.
//
// Rename chain: `Typeclass*` → `Spec*` → `Class*` → the neutral universal-dispatch
// vocabulary (Rom decisions 2026-07-06). The instance record `ClassInstance` →
// **`Instance`**; the interface (class-declaration) `ClassSeed` → **`Interface`**
// (+ `ClassMethod`/`ClassLaw` → `InterfaceMethod`/`InterfaceLaw`); the registry
// `specRegistry`/`SpecRecordRegistry` → `dispatchRegistry`/`DispatchRegistry`; the
// DB-query surface `getSpecInstance`/`createSpecInstance`/`SpecRow` →
// `getDispatchInstance`/`createDispatchInstance`/`InstanceRow`. Runtime shapes are
// byte-for-byte unchanged — only the names moved.
//
// WHY these names: a typeclass IS a type, and dispatch is UNIVERSAL (resolve ANY
// value by the runtime type of a dispatch argument, in scope) — so an `Instance`
// is just "a scoped instance of a type, registered for dispatch" (NOT a
// "class"-special thing), and an `Interface` is the method-signature contract it
// satisfies. `Instance` / `Interface` are the dispatch registry's structural INDEX
// reps (the `$opaque`-rep of the registry: `methods` IS the value's record;
// `(typeName, args)` is the dispatch key DERIVED from its declared type) — not
// conceptual primitives.
//
// Fenel-boundary residual (being landed by the `universal-dispatch-convergence`
// workstream — a COORDINATED TS + `.fenel` + parse-cache/codename-lock-regen pass, NOT
// a TS-only codemod; a TS-only rename silently broke the `engine:structuralInstancesFor`
// marshal (`typeName`) AND the `dispatch:getType` native binding (`getType`) AND the
// dispatch fn-id oracle, all reverted 2026-07-06). DONE (Phase 3 sub-pass E, 2026-07-06):
// the Fenel fn + TS helper `refreshAccountSpecInstances` → **`refreshAccountInstances`**
// (the `dispatch.refresh_account_spec_instances` ioAction wire key kept as an inert
// serialization detail). DONE (Phase 3 B+C+A, 2026-07-06): the `Instance.typeName`
// dispatch-key field + persisted `entity_instances.data.type` (migration 0088). DONE
// (Phase 4 M-C, 2026-07-06): the A∪B store convergence — `EntityRegistration` carries
// `interface?` so `getEntity`/`getCapability` project ONE store (`getEntity(n).interface`
// IS the dispatch face). DONE (Phase 5): the Fenel-bound dispatch verb
// `dispatch:getClass`/`dispatchGetClass` → `dispatch:getType`/`dispatchGetType` (its native
// still reads the internal `DispatchRegistry.getClass` index method — kept as the hot-path
// projection returning an `Interface`, i.e. the dispatch FACE, not the record type, so it
// is NOT itself renamed to `getType`). See `workstreams/universal-dispatch-convergence/`.
// De-classed (TS-only, SAFE, landed): the types (`Instance` / `Interface` /
// `InterfaceMethod` / `InterfaceLaw`), the registry var (`dispatchRegistry`), the db-query
// functions (`*DispatchInstance` / `InstanceRow`), `interfaceCodeNameToName`, the files.
//
// `Interface`s are no longer hand-written per class — the FP trinity is
// DERIVED from its `.fenel` record type via `seedFromType` (Phase 3.3a). The
// representational / effect builtins still author a `Interface` literal in
// `builtin-classes.ts` because their `.fenel` records carry method `body`
// defaults / `supers` / law-fields that `seedFromType` does not reconstruct
// yet (documented residual — see the roadmap's Phase 3.3a notes).
//
// The persisted JSONB key under `entity_instances.data` is `type` (Phase 3 /
// migration 0088; legacy `class` read as a fallback) — see the projection helper
// at `db/src/queries/dispatch-instances.ts` for the read/write translation. The
// in-memory `Instance.typeName` field is the TS surface only.
// ---------------------------------------------------------------------------
import type {
  Constraint,
  Expression,
  FieldDef,
  FunctionBody,
  FenelType,
  ForallEntry,
  InstanceScope,
  LocaleString,
  TypeExpr,
  TypeParam,
} from "./types";

/** A method declared by a dispatch class. Each method has a name (its
 *  identifier within the class — a field of the class record), an optional
 *  label / description for UI, params, returns, and an optional default body. */
export type InterfaceMethod = {
  name: string;
  label?: LocaleString;
  description?: LocaleString;
  params: FieldDef[];
  returns: FenelType;
  body?: FunctionBody;
};

/** A machine-checkable law (property that all instances must satisfy). */
export type InterfaceLaw = {
  name: string;
  description?: LocaleString;
  forall: ForallEntry[];
  property: Expression;
};

/**
 * A class seed — the in-memory declaration shape the dispatch registry reads
 * (`defineClass` / `getClass`). A class IS a record type; this seed is just
 * the projection of that record type into `(name, params, methods, …)`. The
 * FP trinity's seeds are produced by `effect-dispatch.ts:seedFromType` from
 * the registered `.fenel` record; the representational / effect builtins
 * still author a literal in `builtin-classes.ts` (documented residual). Same
 * runtime shape as the legacy `Typeclass` ADT / `SpecRecordSeed`.
 */
export type Interface = {
  name: string;
  label?: LocaleString;
  description?: LocaleString;
  params?: TypeParam[];
  supers?: Constraint[];
  methods: InterfaceMethod[];
  laws?: InterfaceLaw[];
};

/**
 * A class instance — a typed value witnessing that a type / target satisfies
 * a dispatch class. There is nothing special to recognize: `methods` is the
 * value's record, and `(typeName, args)` is the dispatch key derived from
 * its declared type. The persisted JSONB key under `entity_instances.data`
 * is `type` (universal-dispatch-convergence Phase 3 — migration 0088 renamed
 * the legacy `class` key); the projection layer in
 * `db/src/queries/dispatch-instances.ts` translates `data.type` ↔
 * `inst.typeName` at the read/write boundary. Same runtime shape as the
 * legacy `TypeclassInstance` / `SpecInstance`.
 */
export type Instance = {
  typeName: string;
  args: TypeExpr[];
  label?: LocaleString;
  where?: Constraint[];
  methods: Record<string, unknown>;
  scope?: InstanceScope;
  priority?: number;
  /** Private loader evidence for arguments authored as exact reference atoms,
   * before projection to dispatch keys. A frozen, non-enumerable own data
   * property; undefined positions denote literal, generic or structural data.
   * Its presence marks an explicit source application, even without references.
   * Written names remain intact until the declaring source scope binds them. */
  readonly sourceArgumentReferences?: readonly (string | undefined)[];
  /** Loader-emitted facets already name an actual function definition. Keep
   * that identity provenance separate from unresolved source spellings, as a
   * frozen, non-enumerable own data property. */
  readonly sourceArgumentFunctionIds?: readonly (string | undefined)[];
  /** modules-as-values Phase 5a — the named declaration an instance-file value
   *  was loaded from (`fenel-module.ts` `buildSpecInstance`). Set ONLY on a
   *  named value of a `dispatchInstanceFile` source: an ordinary typed constant
   *  is already a function member, and a `_` instance has no name.
   *
   *  A NON-ENUMERABLE own data property: spreads, `JSON.stringify` and
   *  structural equality never see it, so every sidecar that forwards
   *  `.instances` carries it unchanged and no existing projection of the
   *  instance changes shape. The registry reads it at ingress from the module
   *  it was given (the module member index); dispatch ingress strips it
   *  (`dispatch-registry.ts` `withoutInstanceDeclaration`), so it never reaches
   *  the dispatch pool, `listInstances`, persisted rows or the routing table. */
  readonly declaration?: InstanceDeclaration;
};

/** modules-as-values Phase 5a — a named instance's declaration: its source name
 *  and the record it was authored as (`{ $tag: "Iso", encode: {$ref}, decode:
 *  {$ref}, label: … }`), captured after the loader's method lowering and
 *  BEFORE `label` / `priority` / `scope` are lifted into dispatch metadata.
 *  Derived resolver data, not a `Module` value: no function, `Codeable` or lock
 *  row is created for it. */
export type InstanceDeclaration = {
  readonly name: string;
  readonly value: Readonly<Record<string, unknown>>;
  /** The type application the declaration's SIGNATURE declares (`bx : Box`),
   *  kept apart from the constructor tag the value carries (`MkBox`): the
   *  member index proves the owner and reads the fields by it. Absent on a
   *  hand-built carrier, which then declares the instance's own type. */
  readonly type?: { readonly name: string; readonly args: readonly TypeExpr[] };
};
