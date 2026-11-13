import { observeOwnerModuleRoleRoster } from "./owner-input-provenance";
// ---------------------------------------------------------------------------
// System entity definitions — seeded for every account
//
// Concrete entities (profile, item, plan, etc.) are hand-written.
//
// Reference-data entities (country, currency, language, platform) ship rows
// alongside the type via the static-data registry. There's no distinction
// between "std" and "user-seeded" — both are just sources Fenel consumes.
//
// 9b-K: EntitySpec is now a thin shell. Identity (label/description/icon) is
// registered as Labelable/Describable/Iconable typeclass instances; reference
// rows are by-type instances in the unified register. Consumers go through
// getLabel/getDescription/`dispatchRegistry.listInstances` rather than reading
// EntitySpec fields directly.
// ---------------------------------------------------------------------------

import type { FenelModule, FenelType, FieldBinding, LocaleString, Interface, Instance, ProviderScope, TypeConstructorParam, TypeScheme } from "./types";
import { Anything, Bool, Maybe, List, Fin, Vec, foundationTemplates, foundationEntityInstances, foundationEntityRegs, Just, Nothing, refHandle } from "./type-foundation";
import { loadFenelModule } from "./fenel-module";
import { getInterfaceTypeSchemeSource, registerInterfaceTypeScheme } from "./signature-declaration-transport";
import { REPOSITORY_IDENTITY_MANIFEST } from "./repository-identity-manifest";
// 3b-2 — route SetExpr producer through buildSetExpr
import { buildSetExpr } from "./set-marker";
import { getFixityInstances, SYMBOLIC_ALIAS_NOTATIONS } from "./parser-fixities";
import { seedFromType } from "./effect-dispatch";
import typeclassSpecsSrc from "../../../../fenel/std/interfaces.fenel?raw";
import typeclassInstancesSrc from "../../../../fenel/std/dispatch-instances.fenel?raw";
import canonicalListDomainSrc from "../../../../fenel/modules/engine/canonical-list-domain.fenel?raw";
import algebraSpecsSrc from "../../../../fenel/std/algebra.fenel?raw";
import formatsInstancesSrc from "../../../../fenel/modules/formats/instances.fenel?raw";
// storage-as-effect Phase 3a — the reference rows are `.fenel` value-decls
// loaded by `reference-data.ts` (the hand-maintained `.ts` data arrays are
// deleted). `countries`/`currencies`/`platforms` feed the boot typeclass
// derivations (PhoneFormat / HandleFormat / ExchangeRate, below);
// `referenceInstances` register into `dispatchRegistry` as pure by-type dispatch
// targets — so "list the currencies" is the universal by-type query
// (`dispatchRegistry.listInstances`) the frontend reads directly (Phase 3d).
import {
  countries,
  currencies,
  platforms,
  referenceInstances,
} from "./reference-data";
import { createDispatchRegistry, declaringModuleOfInstance, GLOBAL_ONLY, instanceVisible, type DispatchRegistry } from "./dispatch-registry";
import { cloneStockSourceData, rememberStockModuleSource, snapshotStockSourceData, stockSourceModuleData } from "./stock-source-module";
import {
  builtinTypeclasses,
  builtinInstances,
} from "./builtin-classes";
import { builtinInputableInstances } from "./input-strategies";
import {
  entityTypeclasses,
  deriveExchangeRateInstances,
} from "./entity-typeclasses";
// Phase 3.3d — Phone/Handle derived-family instances are materialised by the
// Fenel-bodied factories in modules/formats.ts. They CANNOT be added inside
// buildRegistry (the factory runs through the engine-pure body harness, which
// pulls in this very registry — accessing `systemEntities` here, before it is
// defined, hits the TDZ). They're registered lazily at the runtime post-boot
// stage via `ensureDerivedFormatInstancesRegistered` (below), called from
// runtime/src/evaluator.ts:loadRegistry once the evaluator is ready.
import { derivePhoneInstances, deriveHandleInstances } from "./modules/formats";
import { stdModule } from "./modules/std";
import { controlModule } from "./modules/control";
import { ioModule } from "./modules/io";
import { timeModule } from "./modules/time";
import {
  ecomModule,
  ecomTypeclasses,
  ecomCapabilities,
  ecomProviders,
  ecomCapabilitySource,
  ecomTypeclassSource,
} from "./modules/ecom";
import { pictureModule } from "./modules/picture";
import {
  publicDrawingDemoModule, publicUtilityDemoModule, publicShowcaseDemoModule, publicImportDemoModule, publicRecipeFunctionsModule,
  publicSolverDemoModule, encyclopediaModule, publicEncyclopediaDemoModule, publicGreekAlphabetDemoModule, publicImageDemoModule,
  publicCheckDemoModule, publicLocaleDemoModule, publicStatisticsDemoModule, publicAnimationDemoModule, publicRecipeDemoModule,
  publicDocumentDemoModule, publicClaimsDemoModule, publicAxiomsDemoModule, publicPasswordRecordDemoModule,
} from "./modules/public-demos";
import { unitsModule } from "./modules/units";
import { soundModule } from "./modules/sound";
import { animationModule } from "./modules/animation";
import { movieModule } from "./modules/movie";
import { trackModule } from "./modules/track";
import { eventsModule } from "./modules/events";
import { gamesModule } from "./modules/games";
import { dispatchModule } from "./modules/dispatch";
import { crossmodalModule } from "./modules/crossmodal";
import { viewModule } from "./modules/view";
import { pathModule } from "./modules/path";
import { emailModule, emailCapabilities, emailProviders, emailCapabilitySource } from "./modules/email";
import { twitterModule } from "./modules/twitter";
import { socialModule, socialTypeclasses } from "./modules/social";
import { licenseModule } from "./modules/license";
import { templateModule } from "./modules/templates";
import { aiModule, aiCapabilities, aiProviders, aiCapabilitySource } from "./modules/ai";
import { telegramModule, telegramCapabilities, telegramCapabilitySource } from "./modules/telegram";
import { stateModule } from "./modules/state";
import { storageModule } from "./modules/storage";
import { cryptoModule } from "./modules/crypto";
import { codecModule } from "./modules/codec";
import { dashboardModule } from "./modules/dashboard";
import { emailWebhooksModule } from "./modules/email-webhooks";
import { notifyModule } from "./modules/notify";
import { webhooksModule } from "./modules/webhooks";
import { subscriptionsModule } from "./modules/subscriptions";
import { proxyLinksModule } from "./modules/proxyLinks";
import { pagesModule } from "./modules/pages";
import { receiptModule } from "./modules/receipt";
import { inventoryModule } from "./modules/inventory";
import { purchasesModule } from "./modules/purchases";
import { paymentsModule } from "./modules/payments";
import { profilesModule } from "./modules/profiles";
import { importsModule } from "./modules/imports";
import { itemsModule } from "./modules/items";
import { typesModule } from "./modules/types";
import { plansModule } from "./modules/plans";
import { entitlementsModule } from "./modules/entitlements";
import { channelsModule } from "./modules/channels";
import { actionResultModule } from "./modules/action-result";
import { authModule } from "./modules/auth";
import { decidableMembershipModule } from "./modules/decidable-membership";
import { aggregableModule } from "./modules/aggregable";
import { migrationModule } from "./modules/migration";
import { proverModule } from "./modules/prover";
import { compileJsModule } from "./modules/compile-js";
import { compileWasmModule } from "./modules/compile-wasm";
import { compileLlvmModule } from "./modules/compile-llvm";
import { evaluatorStrategiesModule } from "./modules/evaluator-strategies";
import { algebraModule } from "./modules/algebra";
import { queryModule } from "./modules/query";

// All accounts see the same set of system entities. Reference data
// (countries, currencies, languages, platforms) ships rows alongside the
// type via the static-data registry — see `setStaticData` registrations
// further down. There is no distinction between "std" and "user-seeded"
// entities at the type level; both are just sources Fenel can consume.

// ---------------------------------------------------------------------------
// Interface registry — shared instance, populated with builtins
// ---------------------------------------------------------------------------

/** FINDING (the one genuine exception to "param = entity.params[0]"): a class's
 *  DISPATCH param is almost always its FIRST type parameter — EXCEPT
 *  `Reprable target a`, the sole multi-parameter system class, whose dispatch
 *  param is the SECOND (`a`); the leading `target` is scope-resolved. Hoisted
 *  with `registerClassEntityInto` (signature-substrate P4-prep) so the
 *  Representational-marker closure shares the exact roster rule. */
const DISPATCH_PARAM_OVERRIDE: Record<string, string> = { Reprable: "a" };

/** Register one `.fenel` class entity as a dispatch seed, deriving the class
 *  param from `entity.params[0]` (`DISPATCH_PARAM_OVERRIDE` for `Reprable`).
 *  Hoisted from `buildRegistry`'s local closure (signature-substrate P4-prep,
 *  D0b) so the Representational-marker registration closure below can register
 *  a marked-but-unrostered std class from the same source path as the
 *  `systemClasses` roster. `isRegisteredClass` + per-class `methodDefaults`
 *  are passed UNIFORMLY: `seedFromType` only acts on them for a class that
 *  actually has a super field / a default-body method. Exported so tests
 *  register a test-module class through this exact path. */
export function registerClassEntityInto(
  reg: DispatchRegistry,
  mod: FenelModule,
  name: string,
): void {
  const entity = mod.entities?.find((e) => e.id === name);
  if (!entity?.type) {
    throw new Error(`class registration: missing class ${name} in its .fenel source`);
  }
  const override = DISPATCH_PARAM_OVERRIDE[name];
  const classParam = override ?? entity.params?.[0];
  if (!classParam) {
    throw new Error(`class registration: class ${name} declares no type parameter`);
  }
  // modules-as-values Phase 2d — the seed keeps EVERY class parameter, in
  // header order, so a multi-parameter class is selected by its complete
  // type (`dispatchPositionForSeed` fences it to return position). Reprable
  // is the exception: its override keeps the one-parameter seed `[a]` and its
  // argument route on `a`; moving it to the complete-type rule is Stage 3 of
  // the brief, a deliberate, pinned route change.
  const classParams = override === undefined ? entity.params ?? [classParam] : [classParam];
  reg.defineClass(
    seedFromType(name, entity.type, classParam, {
      classParams,
      isRegisteredClass: (n) => reg.getClass(n) !== undefined,
      methodDefaults: mod.methodDefaults?.[name],
      ...(entity.typeScheme === undefined ? {} : { typeScheme: entity.typeScheme }),
      sourceModule: mod,
    }),
  );
}

function buildRegistry(): DispatchRegistry {
  const reg = createDispatchRegistry();

  // Core typeclasses (Referenceable, Groupable, HasDefault, Undefinable, Inputable)
  for (const tc of builtinTypeclasses) reg.defineClass(tc);
  // modules-as-values Phase 2d — the five codec/migration classes keep their
  // hand-written TypeScript seeds (their law bodies live there; sample
  // discharge reads `.laws`), whose methods and parameters equal the `.fenel`
  // records (pinned by modules-as-values-phase-2d-codec-migration.test.ts).
  // Attach the parser-owned scheme sidecar of each `.fenel` record, with its
  // std source module, onto the EXISTING seed object, so a qualified method
  // (`Iso.decode`) gets a Solved signature whose names resolve in the class's
  // own source. Seed data (ts-exceptions-ledger A2); no seed is redefined.
  {
    const specSource = loadFenelModule(typeclassSpecsSrc, "std");
    for (const name of ["Encodable", "Decodable", "Iso", "Lens", "Migration"]) {
      const seed = reg.getClass(name);
      const scheme = specSource.entities?.find((e) => e.id === name)?.typeScheme;
      if (seed === undefined || scheme === undefined) {
        throw new Error(`class registration: ${name} needs its TypeScript seed and its .fenel type scheme`);
      }
      registerInterfaceTypeScheme(seed, scheme, specSource);
    }
  }
  // ===========================================================================
  // Class-seed registration — DATA-DRIVEN from the `.fenel` class declarations
  // (resolution-substrate Phase 2, Commit 1, 2026-06-30). A class is an ordinary
  // record type; its dispatch seed is DERIVED by `seedFromType` from the loaded
  // entity — the class param comes from `entity.params[0]` (it is ON the entity,
  // never re-typed in a TS column), law + superclass fields are erased by the
  // seed's field classifier, and method-default bodies ride the harvested
  // `methodDefaults` sidecar. This RETIRES the hand-listed
  // `[typeName, classParam][]` manifests (the former trinity / pureClasses /
  // lawClasses / superClasses / defaultClasses + Groupable loops): the param
  // column was pure duplication of `.fenel` data, and the per-list distinction
  // was identical `seedFromType` calls that DISSOLVE once the options are passed
  // uniformly (they no-op for a class with no super field / no default body).
  //
  // FINDING (surfaced to Rom — see the roadmap): the brief's "iterate every class
  // entity, no list" is safe ONLY for algebra.fenel (every entity there is a
  // class registering here). typeclass-specs.fenel is MULTI-OWNER — it declares
  // 100+ class types, but feature modules (telegram / codec / social / ai /
  // email / prover / decidable-membership / aggregable / …) own + register most
  // of them via their own `seedFromType` calls. buildRegistry owns only the
  // SYSTEM subset (`systemClasses` below), so a flat NAME list stays — it is NOT
  // redundant with the file (the file has more classes than register here). Only
  // the param COLUMN was redundant, and that is gone.

  // Hoisted to module level (signature-substrate P4-prep, D0b):
  // `registerClassEntityInto` + the `Reprable` DISPATCH_PARAM_OVERRIDE — see
  // above `buildRegistry`. The local name keeps every roster call site
  // unchanged; ORDER still matters for supers — a super must be
  // `defineClass`'d before its subclass or `supersOf` silently drops it.
  const registerClassEntity = (mod: FenelModule, name: string): void =>
    registerClassEntityInto(reg, mod, name);

  // FP-algebra classes (fenel/std/algebra.fenel) — the truly data-driven case:
  // EVERY entity in this file is a class registering here, so iterate them
  // directly (no name list). Declaring a NEW class in algebra.fenel — e.g.
  // `Sequential f` (resolution-substrate Phase 2) — registers it with ZERO new
  // TS. Functor / Monad / Monoid / Foldable / Applicative / Traversable /
  // Representable / Lift each derive their dispatch seed (the class param from
  // `entity.params[0]`, the return-position methods like `return` / `mempty` /
  // `pure` / `tabulate` surfaced as None-with-reason by `dispatchPositionForSeed`).
  // A BARE `seedFromType` call (no opts) — exactly the deleted trinity loop's
  // shape — since no algebra class has a super field or a default-body method
  // (their `Verified Boolean` law fields are erased by the always-on classifier).
  {
    const algebraClasses = loadFenelModule(algebraSpecsSrc, "std");
    for (const entity of algebraClasses.entities ?? []) {
      const classParam = entity.params?.[0];
      if (!classParam) {
        throw new Error(`buildRegistry: algebra.fenel class ${entity.id} has no type parameter`);
      }
      // modules-as-values Phase 2d — every declared parameter, as
      // `registerClassEntityInto` keeps them (no algebra class has two today).
      reg.defineClass(seedFromType(entity.id, entity.type, classParam, {
        classParams: entity.params!,
        ...(entity.typeScheme === undefined ? {} : { typeScheme: entity.typeScheme }),
        sourceModule: algebraClasses,
      }));
    }
  }

  // System representational / effect / law / numeric classes
  // (fenel/std/typeclass-specs.fenel) — the SYSTEM subset buildRegistry owns
  // (see the FINDING above). ORDER is super-dependency order: HasNetwork before
  // HasHTTP/HasEmail; HasHTTP before HasSocialMedia/HasTelegramBot; Eq before
  // Ord; Referenceable before Groupable. The former pure/law/super/default loop
  // split is gone — one uniform registration over the names, param from the
  // entity, options applied where they bite.
  {
    const specClasses = loadFenelModule(typeclassSpecsSrc, "std");
    const systemClasses: string[] = [
      // pure-signature representational + effect + numeric classes
      "HasDefault", "Describable", "Exportable", "Sampleable", "Soundable", "Picturable",
      "Viewable", "Categorizable", "Taggable", "Representational", "FieldRepresentational", "IOInvokable",
      "Layout", "Inputable", "Versionable", "HasNetwork", "HasStateIO",
      "HasStdin", "HasStdout", "HasFileSystem", "HasTime", "HasRandom", "HasLog",
      "HasIO", "HasRegistry", "HasControlFlow", "HasWasmBuilder", "StorageHandler", "Prefixable",
      "Truthy", "Resolvable", "Filterable", "Symbolable", "Subsumable",
      "Displayable", "Exemplifiable", "Storyboardable", "Infixable", "Aliasable",
      "Renderable", "Identifiable", "Eq", "Numeric", "Enumerable",
      // law classes (a `Verified Boolean` field, erased from the dispatch method set)
      "Labelable", "Codeable", "Iconable", "Emojiable", "Reprable",
      // superclass classes (super field erased + stamped `seed.supers`) — AFTER
      // their supers above
      "HasHTTP", "HasEmail", "HasSocialMedia", "HasTelegramBot", "Ord",
      // method-default-body classes (the default rides the `methodDefaults` sidecar)
      "Referenceable", "Undefinable", "Groupable",
    ];
    for (const name of systemClasses) registerClassEntity(specClasses, name);
  }

  for (const inst of builtinInstances) reg.addInstance(inst);
  // Phase 3 (typeclass-substrate-completion) — the clean string/array/empty-
  // method instances that previously lived as hand-authored consts in
  // builtin-classes.ts are now Fenel-authored typed value declarations in
  // fenel/std/dispatch-instances.fenel. `loadFenelModule` projects each
  // `name : <X>Spec arg = <X>Spec { ... }` value-decl into the legacy
  // `Instance { typeName, args, methods }` cache shape (typeName =
  // <X>, args from the type-application, methods from the record fields).
  // representation-substrate Phase 1 — `typeValuedFields: {Reprable: ["native"]}`
  // lowers the Bool instance's `native = Boolean` from the runtime value
  // `{$tag:"Boolean"}` to the TYPE reference `{$named:"Boolean"}` (the same
  // type-as-value mechanism Aggregable's `inputType` + AddressFormat's
  // `addressType` use; no new TS kind — the existing loader option). No other
  // instance in this file declares a type-valued field, so the option is inert
  // for them. These rows (like the fixity, formats, reference and
  // system-module rows below) record their declaring module, so a registry
  // build binds their lambda methods (Truthy, the Resolvable stubs, the Bool
  // Reprable lift/lower) in that module's scope
  // (`DispatchRegistry.bindDeclaredMethods`).
  for (const inst of loadFenelModule(typeclassInstancesSrc, "std", {
    dispatchInstanceFile: true,
    typeValuedFields: { Reprable: ["native"] },
  }).instances ?? []) {
    reg.addInstance(inst, { declaringModule: "std" });
  }
  // Operator-fixity instances (Infixable / Prefixable) — Fenel-authored in
  // fenel/std/parser-fixities.fenel (typed-function-references Phase 12). The
  // parser + printer consume these via `getFixityInstances`; here they register
  // into `dispatchRegistry` for introspection parity (the editor's operator picker,
  // `listInstances("Infixable")`). The `&&`/`||` symbolic aliases are EXCLUDED —
  // pure parser sugar that the legacy `builtinInstances` never registered (they
  // would surface as duplicate `and`/`or` entries to the picker).
  {
    const { infixables, prefixables } = getFixityInstances();
    for (const inst of [...infixables, ...prefixables]) {
      const notation = inst.methods?.notation;
      if (typeof notation === "string" && SYMBOLIC_ALIAS_NOTATIONS.has(notation)) continue;
      reg.addInstance(inst, { declaringModule: "std" });
    }
  }
  // Inputable instances — derived from the static defaultChannels map.
  for (const inst of builtinInputableInstances) reg.addInstance(inst);

  // Entity-derived typeclasses (PhoneFormat, AddressFormat, HandleFormat)
  for (const tc of entityTypeclasses) reg.defineClass(tc);
  // NB Phone + Handle INSTANCES are NOT added here (Phase 3.3d): their
  // Fenel-bodied factories run through the engine-pure body harness, which
  // can't execute mid-buildRegistry. They're registered at the runtime
  // post-boot stage — see `ensureDerivedFormatInstancesRegistered` below.
  // Spatial + AddressFormat (+ future curated format families) instances —
  // Phase 3.3b/3.3c: Fenel-authored value-decls in
  // fenel/modules/formats/instances.fenel, projected (string args from the
  // type-application) to the Instance shape. `typeValuedFields` lowers
  // AddressFormat's `addressType = UsAddress` to the TYPE reference
  // `{$named:"UsAddress"}` (not the runtime value `{$tag:"UsAddress"}`) — the
  // same type-as-value mechanism aggregable's `inputType`/`outputType` use.
  // Spatial declares no type-valued fields, so it is unaffected.
  for (const inst of loadFenelModule(formatsInstancesSrc, "formats", {
    dispatchInstanceFile: true,
    typeValuedFields: { AddressFormat: ["addressType"] },
  }).instances ?? []) {
    reg.addInstance(inst, { declaringModule: "formats" });
  }
  // (Handle instances — registered at the post-boot stage, see above.)
  // Exchange rate instances derived from currency entity data
  for (const inst of deriveExchangeRateInstances(currencies)) reg.addInstance(inst);

  // storage-as-effect Phase 3a — the country / currency / language / platform
  // reference rows (`.fenel` value-decls in `reference-data.ts`) register as
  // pure global-scope by-type dispatch targets. `reg.listInstances("Currency")`
  // now returns every Currency row — the static-data collapse (the rows are
  // values in the one register; design/unified-dispatch.md §241). The frontend
  // reads these directly via that by-type query (Phase 3d retired the shim).
  for (const inst of referenceInstances) reg.addInstance(inst, { declaringModule: "std" });

  return reg;
}

type StockClassSource = {
  seed: Interface;
  provenance?: { scheme: TypeScheme; sourceModule?: FenelModule };
};
type StockRowSource = { row: Instance; declaringModule?: string };
type StockCapture<T> = { ok: true; value: T } | { ok: false; reason: string };
type StockPoolSource = { classes: StockClassSource[]; rows: StockRowSource[] };

function captureStockSource<T>(read: () => T): StockCapture<T> {
  try { return { ok: true, value: snapshotStockSourceData(read()) }; }
  catch (error) { return { ok: false, reason: error instanceof Error ? error.message : "stock source capture unavailable" }; }
}

function stockSourceValue<T>(captured: StockCapture<T> | undefined): T {
  if (captured === undefined) throw new Error("stock source initialization incomplete");
  if (!captured.ok) throw new Error(captured.reason);
  return cloneStockSourceData(captured.value);
}

function stockClassSources(seeds: readonly Interface[], requireSource = false): StockClassSource[] {
  const sources = new Map<FenelModule, FenelModule>();
  return seeds.map(seed => {
    const provenance = getInterfaceTypeSchemeSource(seed);
    if (requireSource && provenance?.sourceModule === undefined) throw new Error(`stock class source unavailable: ${seed.name}`);
    const source = provenance?.sourceModule;
    if (source !== undefined && !sources.has(source)) {
      rememberStockModuleSource(source);
      sources.set(source, stockSourceModuleData(source));
    }
    return { seed, ...(provenance === undefined ? {} : { provenance: {
      scheme: provenance.scheme,
      ...(source === undefined ? {} : { sourceModule: sources.get(source)! }),
    } }) };
  });
}

function installStockClasses(reg: DispatchRegistry, classes: StockClassSource[]): void {
  for (const { seed, provenance } of classes) {
    if (provenance !== undefined) registerInterfaceTypeScheme(seed, provenance.scheme, provenance.sourceModule);
    reg.defineClass(seed);
  }
}

let privateStockCoreSources: StockCapture<StockPoolSource> | undefined;
export const dispatchRegistry = (() => {
  const reg = buildRegistry();
  // Snapshot private copies before the original mutable pool is exposed.
  privateStockCoreSources = captureStockSource(() => ({
    classes: stockClassSources(reg.listClasses()),
    rows: reg.listInstances().map(row => {
      const declaringModule = declaringModuleOfInstance(row);
      return { row, ...(declaringModule === undefined ? {} : { declaringModule }) };
    }),
  }));
  return reg;
})();

// ---------------------------------------------------------------------------
// Post-boot derived-format-family registration (Phase 3.3d).
//
// PhoneFormat + HandleFormat instances are produced by Fenel-bodied factories
// (fenel/modules/formats/factories.fenel) that run through the engine's
// pure-body dispatch harness. That harness builds a ModuleRegistry which reads
// `systemEntities` — so it cannot run while THIS module is still initialising
// (buildRegistry runs before `systemEntities` is defined → TDZ). Instead we
// register them lazily, once, after module init: the runtime calls this from
// `loadRegistry` (post-evaluator), and the catalog's display path reads the
// same factory output directly. Process-memoised, so repeated calls are no-ops.
//
// Date is deliberately NOT registered (catalog/preset-only surface, matching
// its pre-3.3d behaviour). ExchangeRate stays in buildRegistry (TS factory).
let _derivedFormatsRegistered = false;
export function ensureDerivedFormatInstancesRegistered(): void {
  if (_derivedFormatsRegistered) return;
  _derivedFormatsRegistered = true;
  for (const inst of derivePhoneInstances(countries)) dispatchRegistry.addInstance(inst);
  for (const inst of deriveHandleInstances(platforms)) dispatchRegistry.addInstance(inst);
}

// ---------------------------------------------------------------------------
// SystemEntity + defineSystemEntity helper
//
// Identity is UUID-typed: `id` is the canonical machine identifier — today a
// stable codeName string, future a UUID v4/v5. All human-readable facets
// (label, codeName, description, icon, …) live in the typeclass registry
// as Codeable / Labelable / Describable / Iconable instances keyed by `id`.
// The SystemEntity struct itself only carries the structural type.
//
// `defineSystemEntity` is the canonical way to register a system entity —
// it registers the four identity-typeclass instances and returns the
// SystemEntity record. Author each entity with this helper rather than
// constructing the record directly so identity always travels with the
// type definition.
// ---------------------------------------------------------------------------

/** A single registration in the system type registry. `id` is the canonical
 *  machine identifier (today: codeName string; future: UUID). Identity
 *  facets, relations, and Viewable defaults all live in sibling typeclass-
 *  instance registries — read them via `getLabel(id)` / `getCodeName(id)`.
 *
 *  Two shapes coexist in one registry:
 *   - Concrete entity:        `{ id, type }`
 *   - Parametric (pure):      `{ id, params, type }` where `type` references
 *                             `params` via `{$var: ...}` */
export type SystemEntity = {
  id: string;
  /** Trusted source producer's definition/import frame; never an authority. */
  sourceModule?: FenelModule;
  /** Original binding in that defining source frame. */
  sourceDeclarationName?: string;
  /** Type parameters — absent for concrete types, present for parametric
   *  type families (Maybe<T>, Result<E,A>, Either<E,A>, …). */
  params?: TypeConstructorParam[];
  /** Structural definition. Always set for concrete entities, and for
   *  parametric types whose body is a static FenelType with `$var` refs. */
  type?: FenelType;
  /** Source binding/kind/application evidence for `.fenel`-authored types. */
  typeScheme?: TypeScheme;
};

/** Author a system entity / parametric type. Side-effect: registers
 *  Codeable / Labelable / Describable / Iconable instances at the entity's
 *  id (= spec.codeName for now). Returns the SystemEntity record so it can
 *  be embedded in the `systemEntities` array literal. */
function defineSystemEntity(spec: {
  codeName: string;
  label?: LocaleString;
  description?: LocaleString;
  icon?: string;
  type?: FenelType;
  params?: TypeConstructorParam[];
  typeScheme?: TypeScheme;
}): SystemEntity {
  const id = spec.codeName;
  dispatchRegistry.addInstance({
    typeName: "Codeable",
    args: [id],
    methods: { codeName: spec.codeName },
  });
  if (spec.label !== undefined) {
    dispatchRegistry.addInstance({
      typeName: "Labelable",
      args: [id],
      methods: { label: spec.label },
    });
  }
  if (spec.description !== undefined) {
    dispatchRegistry.addInstance({
      typeName: "Describable",
      args: [id],
      methods: { description: spec.description },
    });
  }
  if (spec.icon !== undefined) {
    dispatchRegistry.addInstance({
      typeName: "Iconable",
      args: [id],
      methods: { icon: spec.icon },
    });
  }
  const resolvedType = spec.type;
  const out: SystemEntity = { id };
  if (resolvedType !== undefined) {
    out.type = resolvedType;
    // A concrete host-authored entity has a complete monomorphic declaration,
    // so publish that authority at its authoring boundary.  Constructor
    // inference must never rebuild a scheme later from the compatibility
    // `type` face.  Parametric/dependent host entities still have to provide an
    // explicit kinded sidecar; this ground case makes no binder or kind choice.
    if (spec.typeScheme === undefined && (spec.params?.length ?? 0) === 0) {
      out.typeScheme = { quantified: [], body: resolvedType };
    }
  }
  if (spec.params !== undefined) out.params = spec.params;
  if (spec.typeScheme !== undefined) out.typeScheme = spec.typeScheme;
  return out;
}

// All system entities (top-level and relations) author with the canonical
// `type: FenelType` ($record) shape. The legacy `schema: FormField[]`
// sidecar is gone; DB-loaded rows that still hold the legacy shape are
// normalized at the queries layer (`fillType` in db/queries/entity-definitions).
//
// Per 9b-L: identity (label/description/icon) lives in the typeclass
// registry, default views in the Viewable typeclass, and relations in
// `relations-registry.ts`. Each entry here is just `{ name, type }`.

// module-substrate Phase 1 / FM-retire-E1 Step 7 — `Module` + `Ref` core types,
// authored in `fenel/modules/core/module.fenel`. `Module` is now FLIPPED: its
// `@label`/`@icon`/`@description` directives are lifted by the loader and the
// decl is threaded into the auto-register path by `foundationTemplates()` (see
// type-foundation.ts Step-7 threading), so its `defineSystemEntity` is DELETED.
// `Ref` carries NO directive → no lifted Codeable → the auto-loop's gate skips
// it (it stays registered via its surviving `defineSystemEntity` below until the
// bare type-alias surface lands — D1).

export const systemEntities: SystemEntity[] = [
  // FM-retire-E1 Step 3 — `profile` / `item` / `inventory` / `purchase` / `form`
  // FLIPPED: their `defineSystemEntity` is DELETED. Identity (`@label`/…) +
  // per-field labels (`@fieldLabel`) + per-value option labels (`@valueLabel` on
  // the enum atoms) are now `.fenel`-authored and auto-registered; `fieldDefaults`
  // dissolved into a type-level `HasDefault` on the field's enum atom
  // (`fenel/std/dispatch-instances.fenel`); `fieldUi.options` DELETED, the
  // select set derived from the atom's `$enum` + per-value labels by the renderer
  // (`enumOptionLabel`).
  //
  // FM-retire-E1 Step 5 — `plan` + `function` FLIPPED too: their per-field WIDGET
  // hint (`fieldUi.terms` = expression editor / `fieldUi.function` = function-
  // editor) is authored as `@widget`/`@helpText`; the Fenel field-facet kernel
  // resolves the source selectors to UUID-keyed `Displayable` instances. No
  // declaration `field.ui` overlay remains. `function`'s
  // `active`/`version` `fieldDefaults` are DROPPED as runtime-dead (the DB columns
  // own them; see function.fenel). Both `defineSystemEntity` calls are GONE.

  // ---- Phase 4 of field-meta-collapse — tree-hierarchical types --------
  //
  // GeoLevel + GeoPath underpin `Place : GeoLevel -> Type` (places.ts).
  // The recipe generalizes to any tree-hierarchical domain (taxonomy,
  // org chart, Dewey decimal): swap the level ADT + path record. See
  // `design/tree-hierarchical-types.md`.
  // ----------------------------------------------------------------------

  defineSystemEntity({
    codeName: "GeoLevel",
    label: "Geo Level",
    description:
      "Precision level in a geographic hierarchy. Used as the phantom domain for `Place : GeoLevel -> Type`. Six canonical levels — coarsest to finest: Country, Region, City, PostalCode, Street, Address. Constructor names are `Geo`-prefixed (`GeoCountry`, `GeoRegion`, …) to avoid global namespace collision with other system constructors (notably email's `Address` record); user-facing labels strip the prefix.",
    icon: "layers",
    // Nullary-constructor variant. Each constructor is a typed level
    // tag; the GeoLevel ADT is what the `Place` phantom carries via
    // `$enum [<tagged-level>]` (see places.ts:Place). The `Geo*` prefix
    // is load-bearing — variant case names register in the global
    // `_constructors` map (registry.ts:343-356); unprefixed `Address`
    // collided with email module's Address record on previous attempt.
    type: {
      $variant: {
        cases: [
          { name: "GeoCountry", label: Just("Country") },
          { name: "GeoRegion", label: Just("Region") },
          { name: "GeoCity", label: Just("City") },
          { name: "GeoPostalCode", label: Just("Postal Code") },
          { name: "GeoStreet", label: Just("Street") },
          { name: "GeoAddress", label: Just("Address") },
        ],
      },
    },
  }),
  defineSystemEntity({
    codeName: "GeoPath",
    label: "Geo Path",
    description:
      "The runtime path inside a `Place`-typed value — country plus optional deeper levels (region / city / postal code / street / address). The phantom-side `Place lvl` declares the depth-as-type fact; this record carries the path-as-runtime-value. The 'deeper Just implies shallower Just' invariant is enforced by the `Resolvable.validateGeoPath` typeclass method, not by the substrate.",
    icon: "map-pin",
    type: {
      $record: {
        fields: [
          {
            name: "country",
            label: Just("Country"),
            type: {
              $tagged: {
                value: { $ref: "Id" },
                phantom: {
                  $refined: {
                    base: { $ref: "String" },
                    set: buildSetExpr.enum(["country"]),
                  },
                },
              },
            },
            meta: {},
            ui: Nothing,
          },
          {
            name: "region",
            label: Just("Region"),
            type: Maybe({
              $tagged: {
                value: { $ref: "Id" },
                phantom: {
                  $refined: {
                    base: { $ref: "String" },
                    set: buildSetExpr.enum(["region"]),
                  },
                },
              },
            }),
            meta: {},
            ui: Nothing,
          },
          {
            name: "city",
            label: Just("City"),
            type: Maybe({
              $tagged: {
                value: { $ref: "Id" },
                phantom: {
                  $refined: {
                    base: { $ref: "String" },
                    set: buildSetExpr.enum(["city"]),
                  },
                },
              },
            }),
            meta: {},
            ui: Nothing,
          },
          {
            name: "postalCode",
            label: Just("Postal Code"),
            type: Maybe({ $ref: "String" }),
            meta: {},
            ui: Nothing,
          },
          {
            name: "street",
            label: Just("Street"),
            type: Maybe({ $ref: "String" }),
            meta: {},
            ui: Nothing,
          },
          {
            name: "address",
            label: Just("Address"),
            type: Maybe({ $ref: "String" }),
            meta: {},
            ui: Nothing,
          },
        ],
      },
    },
  }),


  // ---- Admin / infrastructure entities --------------------------------
  // Phase 12b — `account` / `integration` / `entity_definition` are
  // registered to give them a FenelType in the system registry so
  // `state:validateEntityInstance` can validate POST/PUT bodies against
  // them. These live in dedicated SQL tables (accounts / integrations /
  // types), NOT in entity_instances — registering them is purely for the
  // validation surface (the routes still persist via raw drizzle).
  //
  // FM-retire-E1 Step 6 — their inline-TS `defineSystemEntity` calls are
  // GONE; the shapes + identity now live in
  // `fenel/std/entities/{account,integration,entity_definition}.fenel`
  // and the auto-register loop (below) registers them. See those files
  // for the per-entity notes — notably entity_definition.fenel for why
  // `name`/`label`/`description` collapsed OUT of the $record (Phase
  // 9a/9a-4) and how `types.name` stays the persistence key.

  // ---- Foundation types ------------------------------------------------
  // Bool / Maybe / Result are part of the std namespace — concrete and
  // parametric primitives that user types can reference and pattern-match
  // against. Living in `systemEntities` means the editor's constructor
  // picker discovers them through the same catalog walk as any other ADT;
  // the legacy `FOUNDATION_VARIANT_TYPES` table in the editor (which used
  // to hand-roll their constructor entries) is retired alongside.
  // FM-retire-E1 Step 7 — `Boolean` stays an inline `defineSystemEntity`: its
  // `$opaque.name` is "Boolean" (the entity codeName) while the `opaque
  // "boolean" Bool` decl yields `$opaque.name: "Bool"` (the type_def head) —
  // a rename `@codeName` does NOT reach (`@codeName` sets the registered id,
  // not the inner `$opaque.name`). No clean `.fenel` authoring surface
  // reproduces it, so Boolean is a documented justified residual pending an
  // opaque-name-from-codeName loader rule (Rom call). `foundation-load.test`
  // normalises this exact discrepancy via `pureOpaque` (name → "_").
  defineSystemEntity({
    codeName: "Boolean",
    label: "Boolean",
    description: "Two-constructor sum type: True | False. Opaque-wrapped for runtime efficiency (JS booleans) but conceptually a $variant ADT.",
    icon: "toggle-left",
    type: Bool,
  }),
  // B3 structural registration only: expose the existing complement of Void
  // through the ordinary system owner. Lookup and membership keep their owners.
  defineSystemEntity({
    codeName: "Anything",
    label: "Anything",
    description: "Every Fenel value (the existing complement of Void).",
    type: Anything,
  }),
  // FM-retire-E1 Step 7 — `Maybe` / `Result` / `Either` FLIPPED: their
  // `defineSystemEntity` calls are DELETED. Identity (`@label`/`@icon`/
  // `@description`) is authored on the decls in `fenel/std/foundation.fenel`
  // and lifted by the loader; the head params (`Maybe a` → `[a]`) flow through
  // `foundationEntityRegs`; the auto-register loop preserves their source-bound
  // `$var` occurrences and kinded typeScheme sidecars. Only the param NAME
  // changes T→a / E→e / A→a, which the oracle re-pins. `LookupResult` likewise FLIPPED to
  // `fenel/std/entities/LookupResult.fenel` (the `LookupResult(a)` builder stays
  // the dispatch-side producer).

  // ---- Parametric type constructors -----------------------------------
  // Parametric types live in the same registry as concrete entities; they're
  // distinguished by the presence of `params`. (FM-retire-E1 Step 4 removed
  // `Group` + the whole `instantiate` callback mechanism — `Group a` is just
  // `List (Id a)` / `Tree (Id a)`, already expressible; no parametric type
  // generates a persistent entity at apply time anymore.)
  // Draft<T> — universal "in-progress / capture-first" wrapper for any
  // record type T. Every field of T becomes Either<String, fieldType>:
  // Left = raw user input preserved for later reconciliation, Right =
  // parsed-and-validated typed value. Used by low-friction form-fill
  // flows (Telegram lead capture) where blocking on validation costs
  // users; a separate review queue UX reconciles Lefts to Rights and
  // promotes the Draft to a clean T instance.
  //
  // The parametric resolution machinery (instantiate that walks T's
  // fields and rewrites each type) is deferred — for now the entity
  // is declared parametric so the catalog knows it exists, but
  // validateInstanceData intercepts `Draft<*>` entityTypes and accepts
  // their data permissively. Inner-T validation runs at `promote`
  // time, when the Draft is unwrapped.
  //
  // FM-retire-E1 Step 7 — `Draft` stays a JUSTIFIED RESIDUAL (the documented
  // floor of this brief). Unlike Maybe / Result / Either / LookupResult, it has
  // NO `type:` slot — it is a placeholder whose field-rewrite (`T_field` →
  // `Either<String, T_field>`) needs the parametric-resolution / `$el`
  // field-rewrite machinery that does not exist yet. Per
  // [[zero-natives-means-justified-not-zero]], inventing a bodyless-decl
  // directive for one entity is the anti-pattern; this call is the honest
  // residual, retired when that machinery lands.
  defineSystemEntity({
    codeName: "Draft",
    label: "Draft",
    description:
      "In-progress capture of any record type T. Field values are Either<String, T_field>: Left for raw text awaiting reconciliation, Right for validated typed values. `promote` unwraps a fully-Right Draft into a clean T instance.",
    icon: "edit",
    params: [{ name: "T", constraints: [] }],
  }),

  // array-substrate Phase 1a.5 — the canonical `Vec n a = $map (Fin n) a` + its
  // index type `Fin n` registered as first-class PARAMETRIC system entities (D1
  // verdict — the `Id`/`Maybe`/`List` system-entity marshal-boundary path: the
  // `$map`/`SeInterval` `$`-keys cannot be authored by a `.fenel` `type … =`
  // decl, so the registration rides the ledgered TS boundary, NOT a Fenel surface
  // — a `fenel-surface-extensions` map-type surface is the future). The `type`
  // slot carries the `$map`/`$refined` schema (built by the type-foundation
  // builders with the value-param `n` as a `{$expr:{var:"n"}}` bound + the
  // type-param `a` as `{$var:"a"}`). Because they carry `params`, `buildGenerics`
  // (type-catalog.ts) surfaces them as `ctor:Vec` / `ctor:Fin` with `entity.type`
  // ⇒ `deriveResolveSchema` resolves the `$map` schema ⇒ Step-0 makes a tagged
  // `Vec` value marshal to `TtMap` ⇒ it inherits the Phase-1a `(Map k)` algebra
  // PARAMETRICALLY (NO bespoke nominal `Vec` Functor instance — the fence). The
  // legacy display-only `ctor:Vec` catalog stub is RETIRED in the same change.
  defineSystemEntity({
    codeName: "Vec",
    label: "Vec",
    description:
      "Vec n a = $map (Fin n) a — the canonical fixed-length vector: a TOTAL function from the finite index set `Fin n` to `a` (the representable / Naperian atom). Total indexing (`i : Fin n` is in-bounds by construction), unlike the retired `$refined List (length==n)` form. `$map`-shaped ⇒ inherits Functor/Foldable/Traversable over its values for free. The JS array is the shared runtime repr (`$opaque.repr` is optimization); the `$map` view is the source of truth.",
    icon: "list",
    type: Vec({ $var: "a" } as FenelType, { var: "n" } as never),
    params: [
      { name: "n", constraints: [] },
      { name: "a", constraints: [] },
    ],
  }),
  defineSystemEntity({
    codeName: "Fin",
    label: "Fin",
    description:
      "Fin n : Type — the index set of one array axis = `$refined Nat [0, n)`, the half-open integer interval of valid indices. The standalone-type face of `Vec`'s key set (the `index`/`tabulate` arg). `n` may be a literal or a runtime-bound value (a `{$expr}` interval bound).",
    icon: "hash",
    type: Fin({ var: "n" } as never),
    params: [{ name: "n", constraints: [] }],
  }),

  // ---- Action-params entities (Phase 13b sub-step 1, 2026-05-25) ------
  // Each action handler's wrapper-side validation routes through
  // `state:validateEntityInstance(<action_name>_params, params, false)` —
  // the canonical 12b primitive. The entries below back the 5-action
  // smallest cluster (channels + dynamic_resources + items + purchases +
  // inventory); subsequent 13b sub-steps register the rest of the surface.
  // Decision B from the 13b pre-pass: register every action-params schema
  // as a system entity under the `<action_name>_params` naming convention,
  // reusing the existing 12b primitive instead of adding a sister
  // `state:validatePartialAgainst`. Optional Zod `.optional()` /
  // `.default(...)` fields lift to `Maybe<T>` — wrappers apply the literal
  // default after validation when needed.
  // action-subsumption Phase 2 (2026-06-08) — `create_channel_params` DELETED.
  // The public create_channel action is now the typed Fenel function
  // `channels:createChannel`; dispatch validates args against `paramRecordOf(fn)`,
  // so the schema-mirror entity is redundant. The refinements it carried (slug
  // `NonEmptyStr`, the channel-type `$enum` via `ChannelType`, the optional
  // `config`) live on the function params in fenel/modules/channels/channels.fenel.
  // action-subsumption Phase 1 (2026-06-08) — `create_item_params` +
  // `update_item_params` DELETED. The public create_item / update_item actions
  // are now the typed Fenel functions `items:createItem` / `items:updateItem`;
  // dispatch validates args against `paramRecordOf(fn)` (the function's own
  // param-record), so the standalone schema-mirror entities are redundant. The
  // refinements they carried (the item-type `$enum`, the `format:uuid` itemId)
  // live on the function params via `ItemType` / `Uuid` in
  // fenel/modules/items/items.fenel.
  // action-subsumption Phase 3 (2026-06-08) — `create_purchase_params` +
  // `mark_payment_step_paid_params` DELETED. The public create_purchase /
  // mark_payment_step_paid actions are now the typed Fenel functions
  // `purchases:createPurchase` / `purchases:markStepPaid`; their params carry the
  // refinements (profileId / purchaseId : Uuid; planSlug / stepSlug / provider :
  // NonEmptyStr; data / providerRef optional). The plan-field-defaulting +
  // step-complete-FSM residuals stay body-side.
  // action-subsumption Phase 2 (2026-06-08) — `grant_step_entitlements_params`
  // DELETED. The public grant_step_entitlements action is now the typed Fenel
  // function `purchases:grantStepEntitlements`; its params (purchaseId : Uuid,
  // stepSlug : NonEmptyStr) carry the refinements.
  // action-subsumption Phase 3 (2026-06-08) — `create_inventory_params` +
  // `reserve_spot_params` DELETED. The public create_inventory / reserve_spot
  // actions are now the typed Fenel functions `inventory:createInventory` /
  // `inventory:reserveSpot`; their params carry the refinements (slug /
  // inventorySlug : NonEmptyStr; capacity : PositiveNat; enforce : Maybe
  // EnforceMode; profileId : Uuid; entitlementId : Maybe Uuid). The `enforce ??
  // "soft"` default + capacity FSM residuals stay body-side.
  // action-subsumption Phase 2 (2026-06-08) — `release_spot_params` +
  // `get_inventory_status_params` DELETED. The public release_spot /
  // get_inventory_status actions are now the typed Fenel functions
  // `inventory:releaseSpot` / `inventory:getInventoryStatusAction`; their params
  // (reservationId : Uuid; inventorySlug : NonEmptyStr) carry the refinements.

  // ---- Action-params entities (Phase 13b sub-step 2, 2026-05-25) ------
  // Notifications + entitlements + payments + plans cluster. 3 shared
  // sub-entities (ButtonPayload + PlanGrant + PlanStep) are referenced by
  // the action-params records via `{$ref: "..."}`. Decision G1 (z.coerce.date
  // substrate) resolved NEGATIVE — wrapper-side `new Date(str).toISOString()`
  // canonicalises an ISO 8601 input field typed as `Maybe<String>`; no
  // parseInput coerce-arm added. Decision G2 (createPlan 1-step vs N-step
  // mutual-exclusion) stays body-side; see comment in
  // core/src/actions/plans.ts.
  //
  // FM-retire-E1 Step 6 — the 3 shared sub-entities' inline-TS
  // `defineSystemEntity` calls are GONE; they're now authored as
  // `fenel/std/entities/{ButtonPayload,PlanGrant,PlanStep}.fenel` (each
  // carrying a bare `@codeName` to trip the loader's identity-facet gate)
  // and registered by the auto-register loop. The lazy `{$ref:"PlanGrant"}`
  // in PlanStep.grants resolves via the catalog at use, so load order is
  // irrelevant.
  // action-subsumption Phase N (2026-06-10) — `send_email_params` DELETED. The
  // public send_email action is now the typed Fenel function `email:sendEmail`
  // (fenel/modules/email/email.fenel); its params ARE the validation contract
  // (D2 — no mirror entity): profileId : Uuid, template : NonEmptyStr, include :
  // Maybe (Map String String). `attachments` was accepted-but-ignored with no
  // caller passing it (D-B) → dropped. This was the LAST `*_params` entity; the
  // action-subsumption arc is CLOSED (26/26 ported-or-collapsed,
  // `validateActionParams` + the last legacy registerAction handler retired).
  // action-subsumption Phase 3b (2026-06-08) — `tg_dm_params` DELETED. The public
  // tg_dm action is now the typed Fenel function `notify:sendTgDm`; its params carry
  // the refinements (profileId : Uuid, message : NonEmptyStr, buttons : Maybe (List
  // ButtonPayload)). The body normalizes its return to ActionOk on port.
  // action-subsumption Phase 3 (2026-06-08) — `grant_entitlement_params` DELETED.
  // The public grant_entitlement action is now the typed Fenel function
  // `entitlements:grantEntitlement`; its params carry the refinements (profileId :
  // Uuid, entitlementSlug : NonEmptyStr, purchaseId : Maybe Uuid, the optional ISO
  // date + payload fields). The `startsAt ?? now` default stays body-side.
  // action-subsumption Phase 2 (2026-06-08) — `revoke_entitlement_params` +
  // `check_access_params` DELETED → `entitlements:revokeEntitlement` /
  // `entitlements:checkAccess` (params carry the refinements).
  // action-subsumption Phase 3b (2026-06-08) — `create_payment_link_params` +
  // `send_payment_link_params` DELETED. The public create_payment_link /
  // send_payment_link actions are now the typed Fenel functions
  // `payments:createPaymentLink` / `payments:sendPaymentLink`; their params carry
  // the refinements (profileId : Uuid, planSlug : NonEmptyStr, successUrl/cancelUrl :
  // Maybe UrlStr, via : Maybe ViaMode [hosted in items], amount : Maybe PositiveNat
  // — RE-TIGHTENED 2026-06-10, PositiveNat now registered into systemEntities). The
  // env-default URLs (`io:envGet`) + `via ?? "email"` defaults moved body-side.
  // action-subsumption Phase 3 (2026-06-08) — `create_plan_params` +
  // `update_plan_params` DELETED. The public create_plan / update_plan actions
  // are now the typed Fenel functions `plans:createPlan` / `plans:updatePlan`;
  // their params carry the refinements (slug / name : NonEmptyStr; amount : Maybe
  // NonNegInt; providers : Maybe (List String); grants : Maybe (List PlanGrant);
  // steps : Maybe (List PlanStep) — the PlanGrant / PlanStep sub-record `{$ref}`s
  // referenced by name; onRefund : Maybe OnRefundMode; planId : Uuid). The G2
  // 1-vs-N-step exclusion + patch-merge residuals stay body-side.
  // ---- Action-params entities (Phase 13b sub-step 3, 2026-05-25) ------
  // Profiles + imports cluster. 1 shared sub-entity (ProfileHandleInput)
  // declared first so create_profile_params can reference it via
  // `{$named: "..."}`. Decision G1 recipe applied verbatim to the 4
  // `z.coerce.date()` fields (createProfile.handles[…].validFrom/validTo +
  // appendHandle.validFrom/validTo) — `Maybe<String>` ISO 8601 wire
  // fields canonicalised wrapper-side via `new Date(str).toISOString()`.
  // Decision H (dual-shape `handles` divergence): createProfile carries a
  // `List<ProfileHandleInput>` (full typed records), createOrMergeProfile
  // carries a flat platform→handle map — the latter is a deliberate
  // ergonomic shortcut for the quick-import path. Both register under the
  // same field name `handles`; the validation engine treats each entity in
  // isolation so there's no cross-entity coupling. Decision R3 (the
  // `mapping` / flat `handles` $map<String, String> shape) resolved to
  // open record (`Maybe<{$record: {fields: []}}>`) rather than `$map`,
  // because validate.ts:416-432 routes non-enum-key `$map` to
  // LocaleString — wrong validator for plain `Record<string, string>`.
  // Wrapper TS-types the destructured value with `Record<string, string>`
  // so the homogeneous-value-type constraint is preserved at the
  // TypeScript layer (just not at the runtime validation layer).
  // FM-retire-E1 Step 6 — ProfileHandleInput's inline-TS `defineSystemEntity`
  // is GONE; it's now `fenel/std/entities/ProfileHandleInput.fenel` (bare
  // `@codeName` to trip the identity-facet gate) + the auto-register loop.
  // action-subsumption Phase 3 (2026-06-08) — `create_profile_params` +
  // `append_handle_params` DELETED. The public create_profile / append_handle
  // actions are now the typed Fenel functions `profiles:createProfile` /
  // `profiles:appendHandle`; their params carry the refinements (email : Maybe
  // EmailStr; type : Maybe ProfileType; gender : Maybe ProfileGender; handles :
  // Maybe (List ProfileHandleInput) — all reused from fenel/std/entities; profileId
  // : Uuid; platform / handle : NonEmptyStr). The auto-email-handle + ISO-canon
  // residuals stay body-side.
  // action-subsumption Phase 2 (2026-06-08) — `archive_profile_params` DELETED.
  // The public archive_profile action is now the typed Fenel function
  // `profiles:archiveProfile`; its param (profileId : Uuid) carries the
  // format:uuid refinement.
  // action-subsumption Phase 3 (2026-06-08) — `merge_profiles_params` +
  // `create_or_merge_profile_params` + `import_profiles_params` DELETED. The
  // public merge_profiles / create_or_merge_profile / import_profiles actions are
  // now the typed Fenel functions `profiles:mergeProfiles` /
  // `profiles:createOrMergeProfile` / `imports:importProfiles`; their params carry
  // the refinements (sourceProfileId / targetProfileId : Uuid; email : Maybe
  // EmailStr; handles : Maybe ({}) open-map; data : NonEmptyStr; format : Maybe
  // ImportFormat; tags : Maybe (List String)). The open-map identity resolution +
  // `mapping ?? {}` / `tags ?? []` + DEFAULT_MAPPING-merge residuals stay
  // body-side; the vestigial `merge` field is dropped (validate ignores extras).

  // forms-collapse Phase 4 Stage 3 (2026-06-08) — the `FormOnSubmitAction` +
  // `OnSubmitRule` entities RETIRED. The dissolved `onSubmit` is an ordinary
  // funnel-function body + returned value (LOCK-1 — no directive ADT). The TS
  // types `OnSubmitAction`/`OnSubmitRule` (engine types.ts) stay (canonical-maybe
  // regression surface). `submit_form_params` already retired in 3b below.

  // forms-collapse Phase 3b (2026-06-08) — `submit_form_params` RETIRED with
  // the `submit_form` action (the type-funnel submit path is the only path now;
  // a funnel's input shape IS its registered `$record` type, not a params
  // entity). Its deletion + `create_form_params`'s below unblock
  // action-subsumption Phase N → 26/26.

  // ---- Form definition entities (Phase 13b sub-step 5, 2026-05-25) ------
  // Decision 18 resolved (d) — a fourth option not listed in the brief:
  // register LocaleString as `$map<String, String>` rather than the brief's
  // (a) `$variant {Plain | Localized}` / (c) `$named String` choices. The
  // engine already has a dedicated `validateLocaleString` (validate.ts:576-
  // 593) that accepts BOTH the plain-string and the per-locale-record wire
  // shape, and validate.ts:416-432 routes `$map` (without enum keys) to it.
  // So `$named: "LocaleString"` resolving to this $map fires the existing
  // validator — no caller wire-shape change, no wrapper-side variant
  // lifting. Option (a) would have forced 23 cross-file consumers (per the
  // grep at sub-step 5 open) to wrap label/placeholder/helpText values in
  // `{$tag: "Plain", value: ...}` form; option (c) would have rejected the
  // record-form wire shape that existing API callers already use. Option
  // (d) preserves both contracts at zero cost.
  defineSystemEntity({
    codeName: "LocaleString",
    type: { $map: { keys: { $tag: "SeRef", handle: "String" }, values: { $ref: "String" } } },
  }),
  defineSystemEntity({
    codeName: "field_ui_hint",
    type: {
      $record: {
        fields: [
          { name: "widget", label: Nothing, type: Maybe({ $ref: "String" }), meta: {}, ui: Nothing },
          { name: "placeholder", label: Nothing, type: Maybe({ $ref: "LocaleString" }), meta: {}, ui: Nothing },
          { name: "helpText", label: Nothing, type: Maybe({ $ref: "LocaleString" }), meta: {}, ui: Nothing },
          { name: "prefix", label: Nothing, type: Maybe({ $ref: "LocaleString" }), meta: {}, ui: Nothing },
          { name: "suffix", label: Nothing, type: Maybe({ $ref: "LocaleString" }), meta: {}, ui: Nothing },
          // columns: PositiveNat. Zod's `.max(12)` constraint stays body-
          // side (no substrate primitive expresses a bounded-Nat refinement
          // today); the existing PositiveNat lift gives the >= 1 guard.
          { name: "columns", label: Nothing, type: Maybe({ $ref: "PositiveNat" }), meta: {}, ui: Nothing },
          // options: list of opaque option records (legacy escape hatch);
          // open-record items match Zod's `z.array(z.unknown())`.
          { name: "options", label: Nothing, type: Maybe(List({ $record: { fields: [] } })), meta: {}, ui: Nothing },
          { name: "format", label: Nothing, type: Maybe({ $ref: "String" }), meta: {}, ui: Nothing },
          // refFilter: JSON-Logic Expression evaluated against
          // `{_self, candidate}` to narrow the entity picker. Open-record
          // shape matches Zod's "any Expression" looseness (Decision 17).
          // Phase 5b of field-meta-collapse — relocated from
          // FieldMetadata.refFilter.
          { name: "refFilter", label: Nothing, type: Maybe({ $record: { fields: [] } }), meta: {}, ui: Nothing },
        ],
      },
    },
  }),
  // forms-collapse Phase 4 Stage 3 (2026-06-08) — the `form_field` entity RETIRED
  // (the legacy authoring field shape). A funnel's fields ARE its registered
  // `$record`'s FieldDefs. `field_ui_hint` (above) STAYS — it's the `Displayable`
  // typeclass's hint record, not forms-specific.
  // forms-collapse Phase 3b (2026-06-08) — `create_form_params` RETIRED with
  // the `create_form` action. Authoring a funnel = registering its input `$record`
  // type (`register_type`, D-REG=B); there is no separate "form params" shape.
  // module-substrate Phase 1 — `Module` (the Name → Ref view) + `Ref` (nominal
  // id). Source of truth: `fenel/modules/core/module.fenel`. Registered via the
  // `systemEntities` route (NOT a `FenelModule`) so they're available everywhere
  // through the `systemEntities` seed in `createRegistry` (registry.ts:169) —
  // sidestepping the three divergent module-list literals (SYSTEM_MODULES /
  // runtime `loadRegistry` / self-host classifiers). Catalog surfacing is free
  // (`registerCatalogEntities`, registry.ts:182). Identity (name / label /
  // description / icon) rides on the Codeable / Labelable / … instances
  // `defineSystemEntity` registers keyed by id — the nominal "names are
  // projections keyed by id" pattern — NOT on struct fields.
  defineSystemEntity({
    codeName: "Ref",
    label: "Ref",
    description:
      "A nominal id pointing at any definition (type / function / instance / module) — the value a module's `members` view maps each name to. MVP: a bare nominal token over today's id model (codeName strings; no UUID, no phantom). A Ref spans all definition kinds, so it is deliberately NOT Id<SomeEntity>; the typed, kind-aware Ref is refined later by the typed-function-references workstream.",
    icon: "link",
    // Path (b): `Ref ≡ Id`. The parser has no non-opaque type-alias surface, so
    // the structural type is the `{$ref: "Id"}` reference directly (the
    // `module.fenel` `Ref = Id` line carries the intent — see its divergence
    // ladder). `Id` is the conventional leaf nominal-token type (string at the
    // codec boundary — json-schema.ts:396).
    type: { $ref: "Id" },
  }),
  // FM-retire-E1 Step 7 — `Module` FLIPPED: its `defineSystemEntity` is DELETED.
  // Identity (`@label`/`@icon`/`@description`) is authored on the `Module` decl
  // in `fenel/modules/core/module.fenel` and lifted by the loader; the
  // moduleCore facet-threading below pushes its reg + instances into the
  // auto-register path. `Ref` (above) is NOT flipped — its bare type-alias
  // surface is the genuine D1 Rom call (typed-function-references Tier 3).
];

// ---------------------------------------------------------------------------
// Spec record types — Phase 10a sub-step 2.
//
// Each registered Interface collapses into a parametric record type:
// `LabelableSpec a = LabelableSpec { label: LocaleString }`. The record's
// fields are the typeclass's methods; nullary methods (`params: []`) project
// to `field: returns`, multi-param methods project to `field: (p1 -> p2 -> r)`.
//
// Why: the unified-dispatch design (see design/unified-dispatch.md) folds
// typeclass declarations into ordinary parametric record types — a "spec"
// is just a normal type whose instances are normal entity rows. This loop
// emits the spec entities from the canonical Interface declarations so the
// catalog and entity-id picker surface them uniformly with every other
// system entity.
//
// Coexistence path (Phase 10a sub-step 2): the in-memory dispatchRegistry
// cache stays as the dispatch source of truth. Spec entities become the
// public catalog face; persisted entity_instances rows for spec codenames
// merge into the cache via the per-account loader (the second source path
// in db/src/queries/account-registries.ts). Full table consolidation +
// typed-Id key migration lives in Phase 10a sub-steps 3-4.
// ---------------------------------------------------------------------------

/** Spec entities — one per Interface in the registry. Authored as record
 *  types so the catalog surfaces them in their own "spec" section and
 *  EntityIdPicker can offer them as Id<<SpecName>> targets.
 *
 *  Phase 2 of typeclass-substrate-completion (2026-05-28): every uppercase-
 *  named spec record is now authored in `fenel/std/typeclass-specs.fenel`.
 *  The Stage 2 seed-walk (and its `typeclassToSpecRecord` + `lawNameToFieldName`
 *  helpers) retired together. Lowercase-named module capabilities (messaging /
 *  payment / ai / email / telegram_*) had no spec records pre-Phase-2 either —
 *  their typeclasses register after this file's load-time block, so Stage 2
 *  never derived them; renaming them is deferred to Phase 2.5. */
export const specEntities: SystemEntity[] = [];

// Load hand-authored spec records from fenel/std/typeclass-specs.fenel.
// The .fenel file is the canonical authoring surface for both:
//   (a) spec records (entity id ends with "Spec") — register as
//       specEntities so they surface in the catalog's "spec" section and
//       feed the dispatched-spec codename list.
//   (b) auxiliary ADTs used BY specs (e.g. Evidence + Verified from
//       Phase 10a sub-step 3) — register as ordinary systemEntities so
//       they surface in the catalog's "entity" section and don't
//       accidentally end up in `dispatchedSpecCodeNames`.
//
// Phase 3.4b — the `Spec` suffix is RETIRED as the marker. (a) vs (b) is now
// decided by `isDispatchClassEntity(entity.id)` = "there is a registered
// dispatch class for this type" (`dispatchRegistry.getClass(id) !== undefined`),
// the model-faithful signal. Spec records (`Labelable`, `EmailService`, …)
// have a registered class → "spec"; auxiliary ADTs (`Evidence` / `Verified`
// / `DispatchKey`) have none → "entity". The `Email` collision is resolved
// (the capability is `EmailService`; the data `Email` has no class), so
// `getClass` no longer mis-routes it. Every class must be registered before
// this block runs — hence MODULE_TYPECLASSES is `defineClass`'d just above.
const canonicalListDomainSource = loadFenelModule(canonicalListDomainSrc, "engine");
const canonicalListDomainEntity = canonicalListDomainSource.entities?.find(entity => entity.id === "CanonicalListDomain");
if (canonicalListDomainEntity === undefined) throw new Error("CanonicalListDomain source declaration is missing");
const canonicalListDomainClass = seedFromType("CanonicalListDomain", canonicalListDomainEntity.type, "a", {
  sourceModule: canonicalListDomainSource,
  ...(canonicalListDomainEntity.typeScheme === undefined ? {} : { typeScheme: canonicalListDomainEntity.typeScheme }),
});
const MODULE_TYPECLASSES: Interface[] = [
  ...ecomTypeclasses,
  ...socialTypeclasses,
  ...ecomCapabilities,
  ...emailCapabilities,
  ...aiCapabilities,
  ...telegramCapabilities,
  canonicalListDomainClass,
];
const MODULE_PROVIDER_INSTANCES: Instance[] = [
  ...ecomProviders,
  ...emailProviders,
  ...aiProviders,
];
const privateStockModuleClassSources = captureStockSource(() => stockClassSources(MODULE_TYPECLASSES, true));
for (const tc of MODULE_TYPECLASSES) dispatchRegistry.defineClass(tc);

function stockCorePool(): DispatchRegistry {
  const core = stockSourceValue(privateStockCoreSources);
  const reg = createDispatchRegistry();
  installStockClasses(reg, core.classes);
  installStockClasses(reg, stockSourceValue(privateStockModuleClassSources));
  for (const { row, declaringModule } of core.rows) {
    reg.addInstance(row, declaringModule === undefined ? undefined : { declaringModule });
  }
  return reg;
}

/** A2: reconstruct stock registrations from their declaring source, never
 * from the mutable runtime pool. Call only after module initialization. */
export function createStockDispatchRegistry(): DispatchRegistry {
  const reg = stockCorePool();
  installStockClasses(reg, stockSourceValue(privateStockMarkerClassSources));
  return reg;
}

const privateStockMarkerClassSources = captureStockSource(() => {
  const reg = stockCorePool();
  const prior = new Set(reg.listClasses().map(seed => seed.name));
  const source = loadFenelModule(typeclassSpecsSrc, "std");
  for (const marker of reg.listInstances("Representational")) {
    const name = Array.isArray(marker.args) ? marker.args[0] : undefined;
    if (typeof name !== "string" || name.length === 0) throw new Error("stock class marker is unavailable");
    if (reg.getClass(name) === undefined) registerClassEntityInto(reg, source, name);
  }
  return stockClassSources(reg.listClasses().filter(seed => !prior.has(seed.name)), true);
});

// ---------------------------------------------------------------------------
// signature-substrate P4-prep (D0b) — the Representational-marker registration
// closure. Every repository-authored `Representational c` marker must resolve
// to exactly one registered, source-owned dispatch class (P2 surprise 55:
// `Submittable` was marked + persisted but absent from the `systemClasses`
// roster, so `representationalClasses` silently dropped it). A marked class
// neither the roster nor a feature module registered is registered HERE from
// its typeclass-specs declaration — MISSING-ONLY (an already-registered
// marked class is never redefined; `defineClass` is last-wins and a redefine
// would silently override a feature owner). A marker whose class has no
// declaration anywhere fails closed. Runs AFTER the module classes above so
// feature-owned marked classes are visible, and BEFORE the spec-entity
// routing below so a newly registered class routes into the "spec" section.
// ---------------------------------------------------------------------------
{
  const specClassesForMarkers = loadFenelModule(typeclassSpecsSrc, "std");
  for (const marker of dispatchRegistry.listInstances("Representational")) {
    const className = Array.isArray(marker.args) ? marker.args[0] : undefined;
    if (typeof className !== "string" || className.length === 0) {
      throw new Error("Representational marker with no class-name argument");
    }
    if (dispatchRegistry.getClass(className) !== undefined) continue;
    registerClassEntityInto(dispatchRegistry, specClassesForMarkers, className);
  }
}
// The FP-trinity spec records (Functor / Monad / Monoid) declared in
// fenel/std/algebra.fenel are BOTH the readable catalog surface AND (Phase
// 3.3a) the dispatch-authoritative source: `buildRegistry` derives the
// dispatch seeds from these same `.fenel` record types via `seedFromType`.
// They load through the SAME spec-entity routing as typeclass-specs.fenel
// below: since `getClass(name)` is defined for all three (the derived seeds
// were `defineClass`'d in buildRegistry), `isDispatchClassEntity` routes them
// into the catalog "spec" section. Each file is parsed independently
// (`loadFenelModule` per source — the "concatenating .fenel breaks parsing"
// rule is respected).
//
// signature-substrate P4-prep (D0b) — the routing additionally ingests the
// MODULE-LOCAL capability/typeclass sources: the deleted std interfaces.fenel
// duplicates (AI, EmailService, the 16 Telegram*, Messaging, Payment,
// Storage, HasPreview) RE-SOURCE their spec-entity faces from the live
// module-local owners instead of dropping them, preserving the "every
// uppercase registered class has a Fenel-authored spec entity" invariant
// (phase-2-spec-record-migration.test.ts) while fixing the live
// spec-face/dispatch-face disagreements the stale copies carried (e.g. the
// std EmailService face's retired snake_case `domain_*` method names).
const specEntitySources: FenelModule[] = [
  loadFenelModule(typeclassSpecsSrc, "std"),
  loadFenelModule(algebraSpecsSrc, "std"),
  aiCapabilitySource,
  emailCapabilitySource,
  telegramCapabilitySource,
  ecomCapabilitySource,
  ecomTypeclassSource,
];
for (const specsMod of specEntitySources) {
  for (const entity of specsMod.entities ?? []) {
    if (systemEntities.some((e) => e.id === entity.id)) continue;
    if (specEntities.some((e) => e.id === entity.id)) continue;
    // The source declaration head and kinded scheme sidecar own binder order.
    // Never rediscover parameters by walking `$var` body shapes: that loses
    // unused binders, scope, kinds, and declaration order.
    if (entity.typeScheme === undefined) {
      throw new Error(`${entity.id}: Fenel-authored spec entity is missing its type scheme`);
    }
    const sourceParams = entity.params ?? [];
    const schemeParams = entity.typeScheme.quantified.map(({ sourceName }) => sourceName);
    if (
      sourceParams.length !== schemeParams.length
      || sourceParams.some((param, index) => (typeof param === "string" ? param : param.name) !== schemeParams[index])
    ) {
      throw new Error(`${entity.id}: source header parameters and type-scheme binders disagree`);
    }
    const params: TypeConstructorParam[] = sourceParams.map(param => typeof param === "string"
      ? { name: param, constraints: [] } : param);
    const entitySpec: Parameters<typeof defineSystemEntity>[0] = {
      codeName: entity.id,
      type: entity.type,
      ...(entity.typeScheme === undefined ? {} : { typeScheme: entity.typeScheme }),
    };
    if (params.length > 0) entitySpec.params = params;
    if (isDispatchClassEntity(entity.id)) {
      specEntities.push(defineSystemEntity(entitySpec));
    } else {
      systemEntities.push(defineSystemEntity(entitySpec));
    }
  }
}

// ---------------------------------------------------------------------------
// FM-retire-E1 Step 2 — auto-register `.fenel`-flipped system entities.
//
// The per-entity `fenel/std/entities/*.fenel` files load through
// `foundationTemplates()`, which exposes each entity's structurally normalized
// `$record`/`$variant`/refined shape in `.entities[id]` and — as of
// Step 2 — its loader-lifted identity-facet ClassInstances in
// `foundationEntityInstances`. An entity is "flipped" when its hand-written
// `defineSystemEntity({…})` is DELETED and replaced by `@label`/`@description`/
// `@icon`/`@fieldLabel`(+`@codeName`) directives on its `.fenel` `type_def`.
// This loop is the missing mechanism: it registers every loaded `.fenel` entity
// NOT already in `systemEntities` (the same dedup pattern the spec-loop above
// uses), pushing `{id, type}` + re-asserting its lifted facets into the
// registry. Entities still carrying a `defineSystemEntity` (the deferred
// profile / item / plan / … with `fieldUi`/`fieldDefaults`, + the Class-P
// type-families) are skipped — their facets come from that surviving call, so
// the dedup avoids the double-registration `addInstance` would otherwise admit
// (it does NOT dedupe — `dispatch-registry.ts`). Runs BEFORE the refined-atom
// load-time invariant below so the auto-registered atoms (UrlStr / Latitude /
// …) are present when that check scans `systemEntities`.
{
  foundationTemplates(); // forces the load pass → populates foundationEntityRegs / foundationEntityInstances
  const registered = new Set(systemEntities.map((e) => e.id));
  // A flipped entity is identified by its loader-lifted Codeable (emitted ONLY
  // when the `.fenel` type_def carries an identity directive). Gating on the
  // lifted Codeable is what keeps the DEFERRED entities inert: `profile` /
  // `item` / … keep their `defineSystemEntity` (registered as the lowercase id)
  // and carry NO directive on their PascalCase `Profile` / `Item` type_def, so
  // they have no lifted Codeable and are never registered here. The atoms
  // declared INSIDE those deferred files (`ProfileType`, `ItemType`, …) DO carry
  // directives, so they surface correctly. `foundationEntityRegs` supplies the
  // `(codeName, processedType)` pair — the codeName is the byte-identical
  // registered id (lowercase where the type_def name is PascalCase).
  const hasLiftedCodeable = (codeName: string): boolean =>
    foundationEntityInstances.some((i) => i.typeName === "Codeable" && i.args[0] === codeName);
  for (const reg of foundationEntityRegs) {
    const id = reg.codeName;
    if (!hasLiftedCodeable(id)) continue;
    if (registered.has(id)) {
      const existing = systemEntities.find((entity) => entity.id === id);
      if (existing !== undefined && reg.sourceModule !== undefined) {
        existing.sourceModule = reg.sourceModule;
        existing.sourceDeclarationName = reg.sourceDeclarationName;
      }
      continue;
    }
    const type = reg.type;
    // FM-retire-E1 Step 7 — parametric entities (Maybe / Result / Either /
    // LookupResult) carry head params (`reg.params`). Source binding has already
    // classified their occurrences as authoritative `$var`; promotion must not
    // infer binder membership again from a matching nominal `$ref` spelling.
    const entityParams: TypeConstructorParam[] = (reg.params ?? []).map(param => typeof param === "string"
      ? { name: param, constraints: [] } : param);
    const typeScheme = reg.typeScheme === undefined
      ? undefined
      : { ...reg.typeScheme, body: type };
    systemEntities.push({
      id,
      type,
      ...(entityParams.length > 0 ? { params: entityParams } : {}),
      ...(typeScheme === undefined ? {} : { typeScheme }),
      ...(reg.sourceModule === undefined ? {} : { sourceModule: reg.sourceModule }),
      ...(reg.sourceDeclarationName === undefined ? {} : { sourceDeclarationName: reg.sourceDeclarationName }),
    });
    registered.add(id);
    // Re-assert this entity's lifted facets: the entity-level instances
    // (Codeable / Labelable / Describable / Iconable, `args[0] === id`) plus the
    // per-field Labelables (`args[0]` starts with `${id}.`). Only this entity's —
    // a skipped entity's facets stay sourced from its `defineSystemEntity`.
    for (const fi of foundationEntityInstances) {
      const a0 = fi.args[0];
      if (typeof a0 !== "string") continue;
      if (a0 === id || a0.startsWith(`${id}.`)) dispatchRegistry.addInstance(fi);
    }
  }
}

// ---------------------------------------------------------------------------
// action-subsumption Phase 1b Part A — register the foundation `paths`
// refined-atom family (NonEmptyStr / EmojiString / DriveLetter / PathStr) into
// `systemEntities` so a `{$ref:"NonEmptyStr"}` field resolves in `validate()`
// exactly like a `t.entities` refined atom (UrlStr / Latitude / …) does.
//
// These atoms are authored in `fenel/std/paths.fenel`, but the loader drops
// them into `foundationTemplates().paths` — a sub-map the auto-register loop
// above does NOT scan (it reads `foundationEntityRegs`, sourced solely from
// `t.entities`). So `getEntityTypeByName("NonEmptyStr")` returned `undefined`
// and `validate()` hit "Unknown field type" for EVERY `NonEmptyStr` field:
// ~20 system entities (the `*_params` slugs + planSlug / provider / …) were
// silently failing their slug/name refinement. This is NOT a language-concept-
// in-TS addition ([[feedback-no-language-concept-in-ts]]): the type is already
// `.fenel`-authored (`paths.fenel:30`, `NonEmptyStr = String | value.length >
// 0`); this wires it through the SAME `systemEntities` registration the
// `entities` refined atoms get. Register ONLY the `$refined` atoms — the
// Path / PathSegment / PathRoot ADTs stay catalog-absent (no `{$ref:X}`
// referrer among registered entities). Runs BEFORE the load-time invariant so
// the registered atoms are present when that check scans `systemEntities`.
{
  const t = foundationTemplates();
  const registered = new Set(systemEntities.map((e) => e.id));
  for (const [name, ty] of Object.entries(t.paths)) {
    if (registered.has(name)) continue;
    if (ty && typeof ty === "object" && "$refined" in ty) {
      systemEntities.push({ id: name, type: ty });
      registered.add(name);
    }
  }
}

// ---------------------------------------------------------------------------
// action-subsumption (deferred-faithfulness tail) — register the foundation
// numeric refinement presets (`PositiveNat` / `NonNegInt`) into `systemEntities`
// so a `{$ref:"PositiveNat"}` / `{$ref:"NonNegInt"}` field resolves in
// `validate()` exactly like `NonEmptyStr` (the paths-block sibling above) does.
//
// Diagnosis (2026-06-10): unlike `NonEmptyStr` (which lands in
// `foundationTemplates().paths` and rides the loop above) and the `t.entities`
// refined atoms (which ride the Codeable-gated auto-register loop higher up),
// `PositiveNat` / `NonNegInt` are exposed as TOP-LEVEL named fields on the
// `FoundationTemplates` struct (`t.PositiveNat` / `t.NonNegInt`) — they sit in
// neither bucket, so NO loop scanned them. `getEntityTypeByName("PositiveNat")`
// returned `undefined` → `refType` yielded `{$void}` → the field fell through to
// the atom switch, which doesn't know `PositiveNat`, so module-fn params that
// should have carried the refinement were downgraded to `Number` (the 3b gap:
// payments `amount`, items/inventory capacity). This is NOT a language-concept-
// in-TS addition ([[feedback-no-language-concept-in-ts]]): both types are
// `.fenel`-authored (`foundation.fenel:82` `PositiveNat = Nat | value ∈ [1..)`
// / `:84` `NonNegInt = Int | value ∈ [0..)`); this wires them through the SAME
// `systemEntities` registration `NonEmptyStr` / the `entities` refined atoms get.
{
  const t = foundationTemplates();
  const registered = new Set(systemEntities.map((e) => e.id));
  for (const name of ["PositiveNat", "NonNegInt"] as const) {
    if (registered.has(name)) continue;
    const ty = t[name];
    if (ty && typeof ty === "object" && "$refined" in ty) {
      systemEntities.push({ id: name, type: ty });
      registered.add(name);
    }
  }
}

// ---------------------------------------------------------------------------
// Load-time invariant — every refined-atom `{$named: X}` reference inside
// a registered entity's structural type MUST resolve, where "refined atom"
// means X is an entry in foundationTemplates().entities authored as a
// `$refined` shape (e.g. UrlStr / Latitude / PhoneNumber). Phase 12b
// surfaced the gap: validate() resolves non-built-in `{$named: X}` via
// `getCatalogEntry("entity:" + X)`, which only matches registered system
// entities. When a .fenel file extracts a top-level refined atom but
// doesn't register it as a system entity, downstream entities that
// reference it fail with "Unknown field type" at first-validate-call —
// previously masked by the Zod prelude, now exposed. This check runs after
// both arrays are fully assembled and throws on violation, so any future
// atom-registration gap (new refined atom added to a .fenel file but not
// wired into systemEntities) fails fast at module-load instead.
//
// SCOPE: refined atoms only. Non-atom cross-entity references (LocaleString,
// CollectorEntry, GeoPoint, Block, ConversationStatus, $opaque pure mu-
// self-references via the List/Map opaques, type parameters via $var) are
// NOT in scope — they're either pre-existing gaps for a separate sweep
// (LocaleString-class), recursive type shapes (List/Map), or parametric-
// type pattern noise. The atom-specific scope keeps this check focused on
// the 12b finding without false positives.
{
  const refinedAtomNames = new Set<string>();
  const t = foundationTemplates();
  for (const [name, ty] of Object.entries(t.entities)) {
    if (ty && typeof ty === "object" && "$refined" in ty) {
      refinedAtomNames.add(name);
    }
  }
  // Phase 1b Part A — ALSO scan the `paths` sub-map. Its refined atoms
  // (NonEmptyStr / …) are referenced by `{$ref:X}` exactly like the `entities`
  // atoms, but were invisible to this invariant (it scanned only `t.entities`)
  // — which is precisely why the NonEmptyStr-unregistered gap slipped past
  // load. Folding `t.paths` in makes any future `.paths` refined atom that's
  // referenced-but-unregistered fail fast here instead of at first validate.
  for (const [name, ty] of Object.entries(t.paths)) {
    if (ty && typeof ty === "object" && "$refined" in ty) {
      refinedAtomNames.add(name);
    }
  }
  // action-subsumption tail — ALSO fold the top-level numeric refinement presets
  // (`PositiveNat` / `NonNegInt`). They live on neither `t.entities` nor `t.paths`
  // (they're named struct fields), so without this they were invisible to the
  // invariant — the same blind spot that let the pre-fix `Number`-fallback gap go
  // unnoticed. Now a future `{$ref:"PositiveNat"}` reference whose registration
  // regressed fails fast here instead of silently mis-resolving.
  for (const name of ["PositiveNat", "NonNegInt"] as const) {
    const ty = t[name];
    if (ty && typeof ty === "object" && "$refined" in ty) {
      refinedAtomNames.add(name);
    }
  }
  const registeredNames = new Set<string>([
    ...systemEntities.map((e) => e.id),
    ...specEntities.map((e) => e.id),
  ]);
  type Violation = { parent: string; path: string; atom: string };
  const violations: Violation[] = [];
  const visitField = (parent: string, path: string, ty: unknown): void => {
    if (!ty || typeof ty !== "object") return;
    const x = ty as Record<string, unknown>;
    if ("$tagged" in x) return; // string-id leaf (validate.ts:384)
    if ("$el" in x) return; // dependent type — resolved at validate-time
    {
      // 7g-retire-2c fold: name-handle of `{$named}` OR its `{$ref}` twin.
      const name = refHandle(x);
      if (name !== undefined) {
        // Only flag refined-atom references that aren't registered.
        if (refinedAtomNames.has(name) && !registeredNames.has(name)) {
          violations.push({ parent, path, atom: name });
        }
        return;
      }
    }
    if ("$record" in x) {
      const rec = x.$record as { fields: Array<{ name: string; type: unknown }> };
      for (const f of rec.fields) visitField(parent, path ? `${path}.${f.name}` : f.name, f.type);
      return;
    }
    if ("$variant" in x) {
      const v = x.$variant as { cases: Array<{ name: string; fields?: Array<{ name: string; type: unknown }> }> };
      for (const c of v.cases) {
        for (const f of c.fields ?? []) visitField(parent, `${path}|${c.name}.${f.name}`, f.type);
      }
      return;
    }
    if ("$opaque" in x) {
      const o = x.$opaque as { pure?: unknown };
      if (o.pure !== undefined) visitField(parent, `${path}<opaque.pure>`, o.pure);
      return;
    }
    if ("$refined" in x) {
      const r = x.$refined as { base: unknown };
      visitField(parent, `${path}<refined.base>`, r.base);
      return;
    }
    if ("$arrow" in x) {
      const a = x.$arrow as { params: Array<{ name: string; type: unknown }>; returns: unknown };
      for (const p of a.params) visitField(parent, `${path}<arrow.${p.name}>`, p.type);
      visitField(parent, `${path}<arrow.returns>`, a.returns);
      return;
    }
    if ("$tuple" in x) {
      const arr = x.$tuple as unknown[];
      for (let i = 0; i < arr.length; i++) visitField(parent, `${path}[${i}]`, arr[i]);
      return;
    }
    if ("$map" in x) {
      const m = x.$map as { values?: unknown };
      if (m.values !== undefined) visitField(parent, `${path}<map.values>`, m.values);
      return;
    }
    if ("$el" in x) {
      // Phase 1 of typeclass-substrate-completion: walk into `$el.call` args
      // the same way the retired `$app.args` walker did.
      const e = x.$el as unknown;
      if (e && typeof e === "object" && !Array.isArray(e) && "call" in (e as object)) {
        const call = (e as { call?: unknown[] }).call;
        if (Array.isArray(call)) {
          for (let i = 1; i < call.length; i++) {
            visitField(parent, `${path}<el.call.arg>`, call[i]);
          }
        }
      }
      return;
    }
  };
  for (const entity of [...systemEntities, ...specEntities]) {
    if (entity.type) visitField(entity.id, "", entity.type);
  }
  if (violations.length > 0) {
    const lines = violations
      .map((v) => `  - refined atom '${v.atom}' referenced by entity '${v.parent}'.${v.path}`)
      .join("\n");
    throw new Error(
      `system-entities: ${violations.length} unregistered refined-atom reference(s):\n${lines}\n` +
        `Add each via defineSystemEntity, sourcing the type from foundationTemplates().entities.<atom>.`,
    );
  }
}

/** The set of spec-record entity codenames — used by the per-account
 *  instance loader (db/src/queries/account-registries.ts) to pull
 *  entity_instances rows of these types and merge them into the typeclass
 *  registry alongside the legacy typeclass_instances table.
 *
 *  Convention-only marker for "dispatched": any entity whose codeName ends
 *  in `Spec` and was emitted from the spec-record loop above is a dispatch
 *  target. Phase 10a sub-step 4 may promote this to an explicit
 *  `dispatched: bool` field on entity definitions if multiple dispatch
 *  namespaces collide. */
export const dispatchedSpecCodeNames: ReadonlyArray<string> =
  specEntities.map((e) => e.id);

/** Map from spec entity codeName to its dispatch class name. The loader uses
 *  this to translate entity_instances rows (keyed by entity_type) into
 *  Instance records (keyed by `class`).
 *
 *  Phase 3.4b/3.4c — the entity codeName IS the class name now (suffix dropped
 *  from the corpus AND the Constraint `entityId`s), so this is an IDENTITY map. */
export const interfaceCodeNameToName: ReadonlyMap<string, string> = new Map(
  specEntities.map((e) => [e.id, e.id] as const),
);

/** Phase 3.4a/3.4b — TYPE-based classifier: is this entity's type a dispatch
 *  class (a record-of-methods the registry resolves instances of by type)?
 *
 *  The catalog (`type-catalog.ts`) + the spec-entity routing block above use
 *  this to place a value in the "spec" vs "entity" section by its TYPE rather
 *  than by which store-array it was sorted into — the partition is computed
 *  over the unified entity set, not trusted from two pre-routed arrays.
 *
 *  Phase 3.4b RETIRED the `<X>Spec` suffix handle (Phase 3.4a's interim
 *  marker) in favour of the model-faithful signal: **there is a registered
 *  dispatch class for this type** (`dispatchRegistry.getClass(id) !== undefined`).
 *  An instance is a typed value; "type T is an instance of class C" = "a value
 *  of type `C T` is resolvable" — so a type IS a dispatch class exactly when a
 *  class record is registered under its (now suffix-free) name. The `Email`
 *  NAME collision that blocked this in 3.4a is resolved (the email capability
 *  is `EmailService`; the data entity `Email` has no class → `getClass("Email")`
 *  is undefined → it routes to "entity", correctly). All classes — incl. the
 *  module capabilities — are registered before any caller runs. */
export function isDispatchClassEntity(entityId: string): boolean {
  return dispatchRegistry.getClass(entityId) !== undefined;
}


/** Resolve a name reference to a system entity. Two-stage lookup:
 *
 *   1. Direct `id` match — today `id` is the codeName string, so this
 *      catches both UUID (future) and codeName references in one pass.
 *   2. Codeable instance fallback — find an instance whose `codeName`
 *      (any locale, plain string or LocaleString record) equals `query`,
 *      then return the entity at the instance's target id. Lets the
 *      `query` be a locale-specific codeName (`"Booléen"` resolving to
 *      the same entity as `"Boolean"`) and prepares for the day `id`
 *      becomes a real UUID (then direct `id === query` only matches
 *      UUIDs, and codeName lookups MUST go through Codeable).
 *
 *  Single point of resolution — every `{$named: "..."}` lookup goes
 *  through here so the codeName / UUID switch is one localized change. */
export function resolveNamed(query: string): SystemEntity | undefined {
  // Stage 1: direct id match — search both the main systemEntities array
  // AND the parallel specEntities array (Phase 10a sub-step 2). Both are
  // first-class system entities; the only reason they're separate arrays
  // is the construction-order dependency (spec entities are derived from
  // the typeclass registry which is populated alongside systemEntities).
  const direct =
    systemEntities.find((e) => e.id === query) ??
    specEntities.find((e) => e.id === query);
  if (direct) return direct;
  // Stage 2: Codeable codeName lookup.
  //
  // ⚠ rights R3a — REPOSITORY ROWS ONLY, and this is an HONEST FENCE rather
  // than a withdrawal (§12 trap 11). A SYSTEM ENTITY's identity is not an
  // account overlay: this scan is how `{$named: …}` and `getSystemEntity` find
  // a type, and `validateInstanceData` calls it on an account-type miss. Raw,
  // it let one account NAME A SYSTEM TYPE FOR EVERYONE — executed during the
  // design review, where a B-owned `Codeable` mapping a fresh alias to
  // `Boolean` changed the shared lookup from `null` to `"Boolean"` for every
  // caller. There is no account-scoped system-entity namespace to restore.
  for (const inst of dispatchRegistry.listInstances("Codeable")) {
    if (!instanceVisible(inst, GLOBAL_ONLY)) continue;
    const codeName = inst.methods?.codeName;
    let matches = false;
    if (typeof codeName === "string") {
      matches = codeName === query;
    } else if (codeName && typeof codeName === "object") {
      for (const v of Object.values(codeName as Record<string, unknown>)) {
        if (v === query) { matches = true; break; }
      }
    }
    if (!matches) continue;
    const targetId = inst.args[0];
    if (typeof targetId !== "string") continue;
    const entity = systemEntities.find((e) => e.id === targetId);
    if (entity) return entity;
  }
  return undefined;
}

/** Lookup a system entity by id. Returns the FenelType-bearing record;
 *  use getLabel / getDescription / getIcon / getDefaultView / getRelations
 *  for everything else (each lives in its own sibling registry). */
export function getSystemEntity(id: string): SystemEntity | undefined {
  return resolveNamed(id);
}

// Codeable / Labelable / Describable / Iconable instances are now
// registered inline by `defineSystemEntity` during the systemEntities
// array construction. No separate identity map / registration loop here.

// ---------------------------------------------------------------------------
// Default views — what TypeView each entity nominates for full / inline
// rendering. Registered as Viewable typeclass instances; consumers read
// via getDefaultView / getDefaultInlineView (in identifiable.ts).
// ---------------------------------------------------------------------------

const SYSTEM_VIEWS: Record<string, { defaultView?: string; defaultInlineView?: string }> = {
  country: { defaultView: "country-display" },
  currency: { defaultView: "currency-display" },
  language: { defaultView: "language-display" },
};

for (const [name, view] of Object.entries(SYSTEM_VIEWS)) {
  const methods: Record<string, unknown> = {};
  if (view.defaultView) methods.defaultView = view.defaultView;
  if (view.defaultInlineView) methods.defaultInlineView = view.defaultInlineView;
  if (Object.keys(methods).length > 0) {
    dispatchRegistry.addInstance({
      typeName: "Viewable",
      args: [name],
      methods,
    });
  }
}

// ---------------------------------------------------------------------------
// Relations — gone. Each "1:N relation" is now a separate entity type
// declared in systemEntities above (profile_handle, profile_phone, etc.)
// with a $tagged Id<profile> back-ref field. The per-instance UI auto-
// discovers them via discoverBackRefs(parentName).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Function identity — same Labelable/Describable/Codeable surface for
// FenelFunction names. Functions and entities share the typeclass-instance
// namespace; getLabel("add") works the same as getLabel("profile"). The
// `name` field of FenelFunction lives in the same flat namespace.
// ---------------------------------------------------------------------------

// Register identity for built-in functions. Modules now declare their own
// typeclass instances via `defineFunction` (see function-builder.ts), which
// produces Codeable / Labelable / Describable / Categorizable / Taggable /
// Iconable / Aliasable instances keyed by the function's id. We just merge
// each module's instances into the global typeclass registry.
// Iterate every system module so each one's typeclass instances
// (Codeable / Labelable / Categorizable / IOInvokable / …) make it
// into the global registry. Without this, lookups like
// `getIOAction("io:env_get")` returned undefined for any module not
// explicitly listed below — the runtime evaluator would then fall
// back to the call's codeName as the IO action and miss the
// registered handler.
const SYSTEM_MODULES = [
  stdModule,
  controlModule,
  ioModule,
  timeModule,
  ecomModule,
  pictureModule,
  publicDrawingDemoModule,
  publicUtilityDemoModule,
  publicShowcaseDemoModule,
  publicImportDemoModule,
  publicRecipeFunctionsModule,
  // Their source `_ : Viewable Solutions` / `_ : Viewable PlantSpeciesSets…`
  // rows and type identity facets select the shared read bodies in every reader.
  publicSolverDemoModule,
  encyclopediaModule,
  // Their types' labels and descriptions are instances too: without these two the Countries list read
  // "List of encyclopedia countries" and the Greek letters lost their authored names (Nov 12).
  publicEncyclopediaDemoModule,
  publicGreekAlphabetDemoModule,
  // The other public demos, for the same reason: their types' and functions' authored labels and
  // descriptions (and a few typed sample values) reach readers only through these instances.
  publicImageDemoModule,
  publicCheckDemoModule,
  publicLocaleDemoModule,
  publicStatisticsDemoModule,
  publicAnimationDemoModule,
  publicRecipeDemoModule,
  publicDocumentDemoModule,
  publicClaimsDemoModule,
  publicAxiomsDemoModule,
  publicPasswordRecordDemoModule,
  unitsModule,
  soundModule,
  animationModule,
  movieModule,
  trackModule,
  eventsModule,
  gamesModule,
  dispatchModule,
  crossmodalModule,
  viewModule,
  pathModule,
  emailModule,
  twitterModule,
  socialModule,
  licenseModule,
  templateModule,
  aiModule,
  stateModule,
  storageModule,
  cryptoModule,
  telegramModule,
  codecModule,
  dashboardModule,
  emailWebhooksModule,
  notifyModule,
  webhooksModule,
  subscriptionsModule,
  proxyLinksModule,
  pagesModule,
  receiptModule,
  inventoryModule,
  purchasesModule,
  paymentsModule,
  profilesModule,
  importsModule,
  itemsModule,
  typesModule,
  plansModule,
  entitlementsModule,
  channelsModule,
  actionResultModule,
  authModule,
  decidableMembershipModule,
  proverModule,
  compileJsModule,
  compileWasmModule,
  compileLlvmModule,
  evaluatorStrategiesModule,
  aggregableModule,
  migrationModule,
  // solver-extension Phase 4 — the live relational-query bridge (query:rel /
  // query:relOne route a production query through the engine's curated dispatch
  // harness). Its per-fn identity facets (Codeable / Labelable / …) register
  // here like every other module's.
  queryModule,
  // Phase 5 of typeclass-substrate-completion — Functor / Monad / Monoid
  // method functions + Maybe/List/Result instances. The classes are DERIVED
  // from fenel/std/algebra.fenel via `seedFromType` and `defineClass`'d in
  // `buildRegistry()` before this block (Phase 3.3a), so the instances resolve
  // their class.
  algebraModule,
];
// Capture shared source graphs before their rows become mutable global data.
for (const mod of [stdModule, emailModule, dispatchModule, codecModule, unitsModule, timeModule,
  aggregableModule, proverModule, decidableMembershipModule, evaluatorStrategiesModule]) rememberStockModuleSource(mod);
observeOwnerModuleRoleRoster("global-installer", "system/SYSTEM_MODULES", SYSTEM_MODULES);
for (const mod of SYSTEM_MODULES) {
  for (const fn_inst of mod.instances ?? []) {
    dispatchRegistry.addInstance(fn_inst, { declaringModule: mod.name });
  }
}

// Callable representation: extends A2/B3 with the existing D-6b-3 boot DATA
// tuple. Its existing ByPattern wire carries a qualified spelling; the
// resolver lifts that handle to Ref before the Fenel predicate applies it.
// The Fenel predicate owns arrow recognition; nominal instances win.
dispatchRegistry.addInstance({
  typeName: "Iconable",
  args: [{ $pattern: "engine.isArrowType" } as never],
  methods: { icon: "function" },
});

// unified-static-analysis Phase 6b — the always-on DERIVED `Functor` instance
// (the kinds-arc capstone). ONE structural `ByPattern` instance keyed by the
// `engine:isUnaryConstructor` kind predicate: every `* -> *` type WITHOUT an
// authored `Functor` instance gets `fmap` for FREE via the generic
// schema-directed fold (`engine:deriveFmap` → `engine:deriveFmapFold`). It is the
// LAST-resort fall-through — `resolveStructural` runs only after the nominal
// block→tag→global cascade misses, so `Maybe`/`List`/`Result` keep their authored
// instances (nominal precedence is structural; D-6b-2). The derived instance
// dispatches through the SHIPPED `matchStructural` substrate (5c made kinds a live
// `ByPattern` bound; 6a made real parametric constructors resolve by kind).
//
// D-6b-3 — registered as a DATA line here (the brief's accepted fallback) rather
// than via a `.fenel` `dispatchRegister` body @ boot: the Fenel hook would need
// `dispatchEngineBody` → `getHarness` → `createRegistry`, which RE-ENTERS this
// module mid-load (the Phase-4 re-entrancy reality — `defaultSpecRegistry` is not
// yet initialized at this top-level statement); AND the instance args
// (`{$pattern}`) are a `$`-key a `.fenel` decl cannot author. This is pure DATA
// (one global instance tuple), not logic — NOT the [[feedback_no_language_concept_in_ts]]
// violation (which is per-type/per-value FACTS as TS maps). The fmap DECISION is
// 100% the `.fenel` `engine:deriveFmapFold` body. Confirmed it does NOT trip the
// audit `no-new-instance-const` content gate (that keys on `: Instance`
// type annotations, not `addInstance` calls).
dispatchRegistry.addInstance({
  typeName: "Functor",
  args: [{ $pattern: "engine:isUnaryConstructor" } as never],
  methods: { fmap: "engine:deriveFmap" },
});

// unified-static-analysis Phase 6c — the always-on DERIVED `Foldable` instance.
// The Foldable sibling of the Functor capstone above: ONE structural `ByPattern`
// instance keyed by the same `engine:isUnaryConstructor` kind predicate, so every
// `* -> *` type WITHOUT an authored Foldable instance gets `foldr` for FREE via
// the generic schema-directed fold (`engine:deriveFoldr` → `engine:deriveFoldrFold`).
// LAST-resort fall-through (`resolveStructural` runs after the nominal cascade), so
// the authored `Maybe`/`List`/`Result` Foldable instances (algebra-instances.fenel)
// keep precedence (D-6c-4). Same D-6b-3 DATA-line registration rationale as Functor:
// the `{$pattern}` arg is a `$`-key a `.fenel` decl cannot author; the fold DECISION
// is 100% the `.fenel` `engine:deriveFoldrFold` body.
dispatchRegistry.addInstance({
  typeName: "Foldable",
  args: [{ $pattern: "engine:isUnaryConstructor" } as never],
  methods: { foldr: "engine:deriveFoldr" },
});

// unified-static-analysis Phase 6d — the always-on DERIVED `Traversable`
// instance. The Traversable sibling of the Functor/Foldable capstones: ONE
// structural `ByPattern` instance keyed by the same `engine:isUnaryConstructor`
// kind predicate, so every `* -> *` type WITHOUT an authored Traversable
// instance gets `traverse` (and `sequenceA` over it) for FREE via the generic
// schema-directed sequencing (`engine:deriveTraverse` → `engine:deriveTraverseFold`).
// LAST-resort fall-through (`resolveStructural` runs after the nominal cascade), so
// the authored `Maybe`/`List`/`Result` Traversable instances (algebra-instances.fenel)
// keep precedence. Same D-6b-3 DATA-line registration rationale as Functor/Foldable:
// the `{$pattern}` arg is a `$`-key a `.fenel` decl cannot author; the sequencing
// DECISION is 100% the `.fenel` `engine:deriveTraverseFold` body (the bridge only
// reflects the owning type + resolves the applicative `g`, D-6d-2).
dispatchRegistry.addInstance({
  typeName: "Traversable",
  args: [{ $pattern: "engine:isUnaryConstructor" } as never],
  methods: { traverse: "engine:deriveTraverse" },
});

// array-substrate Phase 1a — the `$map`/`Map k` former joins the algebra. THREE
// structural `ByPattern` instances keyed by the `engine:isMapShaped` STRUCTURAL
// predicate (match-structural.fenel, the `isRecordType` sibling — `TtMap` is the
// marshalled `$map` shape): every `$map`-shaped type (`Vec n a = $map (Fin n) a`,
// `Array`, a user `Map String User`) gets `fmap`/`foldr`/`traverse` over its
// VALUES for FREE — NO per-type code (the array-workstream payoff: Phase 1b is
// "register Vec/Array; they inherit"). UNLIKE the unary-constructor derived
// instances above, the methods are PLAIN `algebra:*` bodies (algebra-methods.fenel)
// — a map operation iterates the value's `entries` directly, needing NO schema
// marshal (so no `engine:derive*` bridge). `traverse` delegates the effect-
// sequencing to the List nominal traverse + `Functor.fmap` (the g-threading
// problem solved by composition, zero new TS).
//
// THE DISPATCH FACT (the Phase-1a Step-0 PROBE verdict — STRUCTURAL, the brief's
// on-thesis default): runtime dispatch keys on `typeConstructorOf(value)`, which
// reflects a value's `$tag`. The structural instance FIRES for a `$map` value that
// carries a `$tag` naming a CONCRETE registered type whose schema is bare-`$map`
// (so `typeConstructorOf → name → getEntityTypeByName → $map → marshalTraversalType
// → TtMap → isMapShaped True` ⇒ `resolveStructural` selects the methods). A bare
// untagged map (a locale-string `{en,fr}`) has no reflectable identity ⇒ no
// dispatch (UNIVERSAL — any untagged record is the same; not map-specific). A
// PARAMETRIC `$map`-shaped ctor (a registered `Vec n a` in the catalog `ctor:`
// section, not `entity:`) ALSO does not resolve structurally — `getEntityTypeByName`
// is entity-only, so `resolveStructural`'s shape-marshal gate fast-misses; Phase 1b's
// parametric Vec needs concrete-per-instantiation registration OR a `resolveStructural`
// `ctor:`-consult extension (recorded as the Phase-1a finding). Same D-6b-3 DATA-line
// registration rationale as the derived instances: the `{$pattern}` arg is a `$`-key
// a `.fenel` decl cannot author; the DECISION is 100% the `.fenel` `algebra:map*` bodies.
dispatchRegistry.addInstance({
  typeName: "Functor",
  args: [{ $pattern: "engine:isMapShaped" } as never],
  methods: { fmap: "algebra:mapFmap" },
});
dispatchRegistry.addInstance({
  typeName: "Foldable",
  args: [{ $pattern: "engine:isMapShaped" } as never],
  methods: { foldr: "algebra:mapFoldr" },
});
dispatchRegistry.addInstance({
  typeName: "Traversable",
  args: [{ $pattern: "engine:isMapShaped" } as never],
  methods: { traverse: "algebra:mapTraverse" },
});

// array-substrate Phase 2 — `Lift (Map k)` STRUCTURAL instance (the broadcasting
// / rank-polymorphism arm). The SAME `{$pattern:"engine:isMapShaped"}` ByPattern
// path as the Functor/Foldable/Traversable (Map k) instances above (NOT a nominal
// `Lift Vec` — that would re-special-case what the 1a structural fix generalized;
// design §4's Phase-2 row "author NOMINAL Lift Vec" is STALE, corrected here). So
// every `$map`-shaped value (`Vec n a`, a nested `Array`, a user `Map K V`) gets
// `zip2`/broadcast for free. `zip2` points at the rank-polymorphic driver
// `algebra:liftZip2`: the Phase-2 D1 finding is that `zip2` CANNOT be pure arg-1
// dispatch (a scalar-first `zip2 f 5 vec` has no `Lift` instance at arg 1 — the
// scalar is rank-0, a kind difference, §2c), so the broadcast is realized as a std
// driver that routes on the `liftIsScalar` rank-0-vs-≥1 KIND test + recurses — the
// kind test SELECTS the rank arm (instance resolution in spirit), NOT a hand-rolled
// shape-equality `if` (that is the Phase-4 conformance fence). `each` is NOT a Lift
// method — it IS `fmap`, shipped as the derived std alias `algebra:each` (D3). Same
// D-6b-3 DATA-line rationale: the `{$pattern}` arg is a `$`-key a `.fenel` decl
// cannot author; the DECISION is 100% the `.fenel` `algebra:liftZip2` driver.
dispatchRegistry.addInstance({
  typeName: "Lift",
  args: [{ $pattern: "engine:isMapShaped" } as never],
  methods: { zip2: "algebra:liftZip2" },
});

// named-membership-to-fenel Phase 1 — the `Membership` registry: one instance
// per PORTED named set, keyed (ByType, string target) on the name; `member` is
// the fnId of a Fenel `Value -> Bool` predicate (set-algebra-deciders.fenel) the
// `engine:namedContains` body resolves + applies. This is the registry
// CONTRIBUTION POINT (the registry stays where names are contributed; what
// moved to Fenel is who DECIDES). Registered as DATA lines — the same
// boot-dispatch-instance shape as the derived Functor/Foldable/Traversable
// above + the phone/handle instances: a `.fenel` `dispatchRegister` body @ boot
// re-enters createRegistry mid-load (the D-6b-3 re-entrancy reality), and the
// ByType key is the only form `dispatchLookupOne`/`resolveEffect` match today
// (ByValue lookup is RESERVED at HEAD — the Phase-0 note's nominal "ByValue" is
// not yet a resolvable key). The DECISION is 100% the `.fenel` predicate
// bodies; this table is the name→decider wiring, not logic. Un-ported names
// stay in TS NAMED_SETS (reached via the wrapper's dual-registry fall-through);
// each later phase moves names here, shrinking NAMED_SETS toward empty.
const MEMBERSHIP_PORTED: Array<[string, string]> = [
  // Numeric tower + aliases
  ["ℕ", "std:natExactMembership"],
  ["Nat", "std:natExactMembership"],
  ["ℤ", "std:intExactMembership"],
  ["Int", "std:intExactMembership"],
  ["ℚ", "std:rationalMembership"],
  ["ℝ", "engine:membershipReal"],
  ["Rational", "std:rationalMembership"],
  ["Real", "engine:membershipReal"],
  ["Number", "engine:membershipReal"],
  // String / boolean
  ["String", "engine:membershipString"],
  ["Bytes", "engine:membershipBytes"],
  ["NonEmpty", "engine:membershipNonEmpty"],
  ["Boolean", "engine:membershipBoolean"],
  ["Bool", "engine:membershipBoolean"],
  // Char — signature-substrate slice 3jw §2a. `Char` was in `seNamedEmpty`'s
  // ten definitionally-inhabited names but had NO Membership instance, so
  // `namedContains Char "a"` answered `Nothing`: an emptiness/inhabitation
  // asymmetry that made every Char witness proposal unre-checkable. One DATA
  // row; the DECISION is the `.fenel` predicate (unicode-scalar semantics over
  // the one-code-point-string carrier). Owner-approved 2026-08-06 by default
  // (§2a's ask; no answer in time, recommendation was APPROVE).
  ["Char", "engine:membershipChar"],
  // list:* exact constraints
  ["list:distinct", "engine:membershipListDistinct"],
  ["list:ascending", "engine:membershipListAscending"],
  ["list:descending", "engine:membershipListDescending"],
  ["list:nondecreasing", "engine:membershipListNondecreasing"],
  ["list:nonincreasing", "engine:membershipListNonincreasing"],
  // format:path:* clean string-op flavours (Phase 1) + the regex-resistant
  // windows / portable / no-reserved (Phase 3c — now Fenel deciders too)
  ["format:path", "engine:membershipFormatPath"],
  ["format:path:posix", "engine:membershipFormatPathPosix"],
  ["format:path:absolute", "engine:membershipFormatPathAbsolute"],
  ["format:path:relative", "engine:membershipFormatPathRelative"],
  ["format:path:no-traversal", "engine:membershipFormatPathNoTraversal"],
  ["format:path:no-current", "engine:membershipFormatPathNoCurrent"],
  ["format:path:no-hidden", "engine:membershipFormatPathNoHidden"],
  ["format:path:no-empty-segment", "engine:membershipFormatPathNoEmptySegment"],
  ["format:path:no-trailing-sep", "engine:membershipFormatPathNoTrailingSep"],
  ["format:path:no-null-byte", "engine:membershipFormatPathNoNullByte"],
  ["format:path:no-alt-stream", "engine:membershipFormatPathNoAltStream"],
  ["format:path:no-trailing-space-or-dot", "engine:membershipFormatPathNoTrailingSpaceOrDot"],
  // Phase 3 — format:url* (parsed in Fenel via parseUrlParts; no `new URL()`
  // host leaf) + format:date/datetime (the defined clean acceptance set; no
  // `new Date()` host leaf). ZERO new TS — pure string-op Membership bodies.
  // format:url is no longer here (demo 10, 2026-11-08): its registered Pattern
  // (format-presets.ts) is its check, and the live hints read the same Pattern.
  ["format:url:web", "engine:membershipFormatUrlWeb"],
  ["format:url:nolocalhost", "engine:membershipFormatUrlNolocalhost"],
  ["format:url:noprivate", "engine:membershipFormatUrlNoprivate"],
  ["format:url:secure", "engine:membershipFormatUrlSecure"],
  ["format:url:strict", "engine:membershipFormatUrlStrict"],
  ["format:url:ws", "engine:membershipFormatUrlWs"],
  ["format:url:ftp", "engine:membershipFormatUrlFtp"],
  ["format:url:nosubdomain", "engine:membershipFormatUrlNosubdomain"],
  ["format:url:noquery", "engine:membershipFormatUrlNoquery"],
  ["format:url:nofragment", "engine:membershipFormatUrlNofragment"],
  ["format:url:noport", "engine:membershipFormatUrlNoport"],
  // format:date and format:datetime were identical (`new Date()`) at HEAD and
  // share the one `dateAcceptable`-style body (Decisions #1 = clean set).
  ["format:date", "engine:membershipFormatDate"],
  ["format:datetime", "engine:membershipFormatDate"],
  // Phase 3c — the 6 regex-resistant format predicates (KEPT in NAMED_SETS by
  // Phases 1/2 as "not Pattern-expressible" / "regex-structural"). Pure string-
  // op Membership bodies, ZERO new TS; byte-identical to the kept regexes over
  // the Step-0 adversarial differential (the loose IPv6 `::` regex reproduced
  // exactly — D-ipv6). Their NAMED_SETS closures were DELETED same step. After
  // this, no `format:*` name is decided by TS in engine NAMED_SETS — the only
  // `format:*` residents are the 3 `patternMember` (Fenel-deciding) entries +
  // the runtime format-presets, D-A2-codepoint-blocked from joining this table
  // (see set-algebra.ts's NAMED_SETS header).
  // format:phone: a registered Pattern too (format-presets.ts, demo 10).
  ["format:ip", "engine:membershipFormatIp"],
  ["format:postal-code", "engine:membershipFormatPostalCode"],
  ["format:path:windows", "engine:membershipFormatPathWindows"],
  ["format:path:portable", "engine:membershipFormatPathPortable"],
  ["format:path:no-reserved", "engine:membershipFormatPathNoReserved"],
];
for (const [name, member] of MEMBERSHIP_PORTED) {
  dispatchRegistry.addInstance({ typeName: "Membership", args: [name], methods: { member: { $ref: member } } });
}

// Phase 10a-5d-followup-2 — module-declared spec records flow directly
// into the shared `dispatchRegistry`. The legacy `mod.typeclasses` /
// `mod.capabilities` / `mod.providers` slots were retired; each module
// that declared them now exports the data as a named const which is
// imported here and dispatched into the canonical typeclass-registry
// surface. `typeclasses[]` (structural) + `capabilities[]` (domain-
// integration) both feed `defineClass` since both are `Interface`;
// `providers[]` feeds `addInstance` since providers ARE instances. The
// surface name distinction was conceptual, not structural — collapsed
// here. `dispatchRegistry.getClass(name)` is the canonical surface for
// every registered spec record regardless of original declaration site.
//
// Phase 3.4b — `MODULE_TYPECLASSES` (the class `defineClass` registration)
// was MOVED earlier, to just before the spec-entity routing block, because
// that block now partitions catalog entities by `isDispatchClassEntity` =
// `getClass(id) !== undefined` (the suffix-free recognition). The module
// capability classes (`EmailService` / `Messaging` / `AI` / `Telegram*` / …)
// must be registered before the routing runs, or their (now suffix-free)
// spec entities would mis-route into the catalog "entity" section. Provider
// INSTANCES stay here — `addInstance` doesn't require a pre-registered class
// and instances don't affect the entity routing.
for (const prov of MODULE_PROVIDER_INSTANCES) dispatchRegistry.addInstance(prov);

// ---------------------------------------------------------------------------
// Static reference rows — the `getStaticData` / `hasStaticData` /
// `listStaticDataEntities` by-type-query shim (storage-as-effect Phase 3a) +
// its `country._flag`-via-`std:countryFlag` M-view materializer (Phase 3c) were
// RETIRED in Phase 3d (D5 slice 4). The country / currency / language / platform
// rows are `.fenel` value-decls registered into `dispatchRegistry` as pure by-type
// dispatch targets (`buildRegistry` above); the frontend now reads them DIRECTLY
// through the universal by-type register query — `dispatchRegistry.listInstances(
// <RowType>)` — via the `~/lib/reference-data` adapter, resolving the codeName→
// type-name link through `referenceTypeByCodeName` (the loader's own pairing) and
// materializing `country._flag` AT THE EDGE by calling the `std:countryFlag`
// projection. No special-case static accessor survives: reference data is just
// instances in the one register, queried one way.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Default field bindings — virtual fields for system entities
//
// These declare WHAT is bound, not HOW to fetch. The actual FieldProvider
// must be registered by the application at startup (different per environment).
// ---------------------------------------------------------------------------

export const repositoryProviderScope: ProviderScope = {
  $tag: "RepositoryProviderScope",
  registryId: REPOSITORY_IDENTITY_MANIFEST.digest,
};

const countryCodeField = { $ref: "65434517-24b1-423f-a90d-3e0aed6e1b8f" } as const;

export const defaultFieldBindings: FieldBinding[] = [
  {
    target: {
      scope: repositoryProviderScope,
      owner: "country",
      field: { $ref: "77f0169a-1bbb-46f3-8051-a8e46dade04a" },
    },
    provider: "geo-boundaries",
    keyField: countryCodeField,
  },
  {
    target: {
      scope: repositoryProviderScope,
      owner: "country",
      field: { $ref: "cd52c958-3207-482e-80dc-b4f313fc1059" },
    },
    provider: "geo-centroids",
    keyField: countryCodeField,
  },
];

// browser-engine-compat Phase 1b: self-register this module's live namespace so
// engineRequire("system-entities") resolves even at EVAL-TIME (a caller that statically imports
// this module runs its own eval-time builder calls AFTER this module is fully loaded,
// i.e. before the index.ts aggregator runs). See engine-require.ts.
import * as __self_system_entities from "./system-entities";
import { registerEngineModule as __reg_system_entities } from "./engine-require";
__reg_system_entities("system-entities", __self_system_entities);
