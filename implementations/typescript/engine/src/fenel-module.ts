import { rememberCanonicalLoadedModuleOrigin } from "./owner-input-provenance";
// ---------------------------------------------------------------------------
// Fenel module loader — `.fenel` source text → FenelModule
//
// Parses a Fenel source string, walks the program declarations, and emits a
// `FenelModule` with `FenelFunction`s, typeclass-instance identity entries,
// entity types, and any fixity overrides.
//
// Pairing logic:
//   - `name : Type`  (type_sig)  — gives the function its signature
//   - `name p... = body`  (def)  — gives the function its body
//
// A def WITHOUT a matching type_sig carries explicit Absent slot obligations
// beside unique compatibility holes. Those holes are never signature
// authority: registry inference must replace every Absent slot before the
// function reaches a public view. A type_sig
// without a matching def is dropped — UNLESS it carries an `@native`
// directive, in which case it is a FOREIGN DECLARATION (module-substrate
// Phase 3b): a function whose implementation is an irreducible host-IO leaf
// supplied by the module's `nativeImpls` (the per-module `ffi/` leaf), keyed
// by codeName. Such a sig emits a BODYLESS `FenelFunction` (the registry
// resolves the call to the native — `FenelFunction.body` is optional exactly
// for natives / IO primitives) plus the same Codeable + identity facets a
// Fenel-bodied function gets. This is what lets a `module … where` file be the
// source of truth for a native-carrying module's *declarations* while the
// irreducible JS leaf lives in `ffi/`.
//
// Type-defs become entries in `FenelModule.entities` (single-constructor)
// or are surfaced as ADT entities (multi-constructor → `$variant`).
// ---------------------------------------------------------------------------

import type {
  Expression,
  FenelFunction,
  FenelModule,
  FenelType,
  FieldDef,
  FunctionBody,
  Instance,
  Constraint,
  TypeExpr,
  FunctionSignatureDeclaration,
  SlotDeclaration,
  TypeScheme,
  FieldFacetSourceDirective,
} from "./types";
import { parsedViaCache } from "./parse-cache";
import { parse as parseFenelTypeScript, sourceApplicationsForBoundType } from "./fenel-parser";
import type { LocaleString } from "./locale";
import { registerLoadedFunctionSignatureDeclaration } from "./signature-declaration-transport";
import { enterFenelModuleLoad, exitFenelModuleLoad } from "./engine-require";

// A2/B3 host-object materialization only: preserve authored names as own data
// properties while the existing loader walks their values. In particular,
// `__proto__` must never change a copied record's JavaScript prototype.
function defineLoadedProperty(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
}

type Maybe<T> = { $tag: "Nothing" } | { $tag: "Just"; _0: T };
const Nothing: Maybe<never> = { $tag: "Nothing" };
const Just = <T>(value: T): Maybe<T> => ({ $tag: "Just", _0: value });

// AST shapes emitted by the parser for top-level declarations.
// `directives` (module-substrate Phase 3a) — the `@label` / `@description` /
// `@category` / `@tags` / `@ioAction` / … facet directives the parser captures
// on a function decl, lifted by the loader into identity-facet ClassInstances
// (the `.fenel` analogue of a TS `defineFunction`'s identity record).
type FacetDirective = { name: string; args: string[] };
type DefAST = { def: { name: string; params: string[]; body: unknown; directives?: FacetDirective[] } };

// ---------------------------------------------------------------------------
// declaration-annotations Phase 1 (A.0) — THE DIRECTIVE POLICY MIRROR.
//
// This is a MECHANICAL MIRROR of `fenel/modules/engine/directive-policy.fenel`,
// which is the SOURCE OF TRUTH. It is not freestanding TypeScript: it is a
// law-bound projection of a Fenel fact, pinned byte-for-byte by
// `fenel-directive-policy.test.ts` (which parses the `.fenel` table, decodes
// the rows structurally, and asserts deep equality with this array). Edit the
// `.fenel` file first; update this mirror in the SAME commit.
//
// The mirror exists because the gate runs at the loader's bootstrap position —
// `loadFenelModule` is what loads `directive-policy.fenel` itself, so the gate
// cannot read the table through the loader without a cycle. Same discipline as
// the class-seed manifests (`design/class-seed-manifests.md` pattern: derive +
// gate byte-identically, never diverge silently).
//
// SCOPE FENCE: this mapping is CLOSED, exactly as the surface it describes is
// closed today. The OPEN, registry-driven mapping (design/declaration-
// annotations.md §2 defect 1) is the P2+ elaborator's, not this phase's.
// ---------------------------------------------------------------------------
type DirectiveMultiplicity = "DmScalar" | "DmAccumulating" | "DmSelectorKeyed";
type DirectiveContext = "DcAnyDecl" | "DcFunctionDecl" | "DcTypeDecl";
type DirectiveStage = "DsLoad" | "DsParse";
/** One admitted directive name. `maxArgs: null` mirrors the Fenel `Nothing`
 *  (unbounded); a number mirrors `Just n`. */
export type DirectivePolicyRow = {
  name: string;
  minArgs: number;
  maxArgs: number | null;
  multiplicity: DirectiveMultiplicity;
  keyArity: number;
  context: DirectiveContext;
  stage: DirectiveStage;
};
export const DIRECTIVE_POLICY: readonly DirectivePolicyRow[] = [
  { name: "label", minArgs: 1, maxArgs: 1, multiplicity: "DmScalar", keyArity: 0, context: "DcAnyDecl", stage: "DsLoad" },
  { name: "description", minArgs: 1, maxArgs: 1, multiplicity: "DmScalar", keyArity: 0, context: "DcAnyDecl", stage: "DsLoad" },
  { name: "tags", minArgs: 1, maxArgs: null, multiplicity: "DmAccumulating", keyArity: 0, context: "DcAnyDecl", stage: "DsLoad" },
  { name: "category", minArgs: 1, maxArgs: 1, multiplicity: "DmScalar", keyArity: 0, context: "DcAnyDecl", stage: "DsLoad" },
  { name: "icon", minArgs: 1, maxArgs: 1, multiplicity: "DmScalar", keyArity: 0, context: "DcAnyDecl", stage: "DsLoad" },
  { name: "emoji", minArgs: 1, maxArgs: 1, multiplicity: "DmScalar", keyArity: 0, context: "DcAnyDecl", stage: "DsLoad" },
  { name: "codeName", minArgs: 1, maxArgs: 1, multiplicity: "DmScalar", keyArity: 0, context: "DcAnyDecl", stage: "DsLoad" },
  { name: "entity", minArgs: 0, maxArgs: 0, multiplicity: "DmScalar", keyArity: 0, context: "DcTypeDecl", stage: "DsLoad" },
  { name: "discriminator", minArgs: 1, maxArgs: 1, multiplicity: "DmScalar", keyArity: 0, context: "DcTypeDecl", stage: "DsParse" },
  { name: "native", minArgs: 0, maxArgs: 0, multiplicity: "DmScalar", keyArity: 0, context: "DcFunctionDecl", stage: "DsLoad" },
  { name: "requires", minArgs: 1, maxArgs: null, multiplicity: "DmAccumulating", keyArity: 0, context: "DcFunctionDecl", stage: "DsLoad" },
  { name: "ioAction", minArgs: 1, maxArgs: 1, multiplicity: "DmScalar", keyArity: 0, context: "DcFunctionDecl", stage: "DsLoad" },
  { name: "stopAction", minArgs: 1, maxArgs: 1, multiplicity: "DmScalar", keyArity: 0, context: "DcFunctionDecl", stage: "DsLoad" },
  { name: "listInstancesAction", minArgs: 1, maxArgs: 1, multiplicity: "DmScalar", keyArity: 0, context: "DcFunctionDecl", stage: "DsLoad" },
  { name: "fieldLabel", minArgs: 2, maxArgs: 2, multiplicity: "DmSelectorKeyed", keyArity: 1, context: "DcAnyDecl", stage: "DsLoad" },
  { name: "valueLabel", minArgs: 2, maxArgs: 2, multiplicity: "DmSelectorKeyed", keyArity: 1, context: "DcTypeDecl", stage: "DsLoad" },
  { name: "widget", minArgs: 2, maxArgs: 2, multiplicity: "DmSelectorKeyed", keyArity: 1, context: "DcTypeDecl", stage: "DsLoad" },
  { name: "helpText", minArgs: 2, maxArgs: 2, multiplicity: "DmSelectorKeyed", keyArity: 1, context: "DcTypeDecl", stage: "DsLoad" },
  { name: "fieldReusable", minArgs: 1, maxArgs: 1, multiplicity: "DmSelectorKeyed", keyArity: 1, context: "DcTypeDecl", stage: "DsLoad" },
];
const DIRECTIVE_POLICY_BY_NAME = new Map(DIRECTIVE_POLICY.map((p) => [p.name, p]));
const DIRECTIVE_KNOWN_NAMES = DIRECTIVE_POLICY.map((p) => p.name).sort().join(", ");

/** The declaration kinds a raw directive occurrence can sit on. `sig` and `def`
 *  are the two function-decl carriers (the loader merges their directives by
 *  name); `typedef` is the type-decl carrier. */
type DeclKind = "sig" | "def" | "typedef";
/** One RAW directive-carrying declaration, captured before any collation. */
type DirectiveSite = { declName: string; declKind: DeclKind; directives: FacetDirective[] };

/** Thrown when a `.fenel` source violates the directive policy. Distinct type so
 *  callers can tell a fail-closed policy rejection from a parse/marshal error. */
export class DirectivePolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DirectivePolicyError";
  }
}

const contextAdmits = (context: DirectiveContext, kind: DeclKind): boolean =>
  context === "DcAnyDecl"
  || (context === "DcTypeDecl" && kind === "typedef")
  || (context === "DcFunctionDecl" && (kind === "sig" || kind === "def"));

const declKindLabel = (kind: DeclKind): string =>
  kind === "typedef" ? "a type declaration" : "a function declaration";

/**
 * declaration-annotations Phase 1 (A.2/A.3) — THE FAIL-CLOSED LOAD GATE.
 *
 * Validates EVERY raw directive occurrence against `DIRECTIVE_POLICY` *before*
 * the by-name collation and *before* any LOAD-STAGE semantic consumer runs.
 * (Load-stage: `@discriminator` is interpreted at the PARSE stage by whichever
 * parser produced the AST, so validation cannot precede that one. It is still
 * validated here.) Prior to this the
 * surface was fail-open in four distinct ways, each of them silent data loss:
 *
 *   - an unknown name (`@lable`) was dropped with no diagnostic;
 *   - an out-of-schema argument count was accepted and read partially;
 *   - a directive on the wrong declaration kind was read by no consumer;
 *   - a duplicate scalar kept only its FIRST occurrence (`ds.find`), so the
 *     second silently vanished — this shipped two WRONG labels at HEAD.
 *
 * Multiplicity is a PER-NAME policy, not one rule: scalars at most once,
 * `@tags`/`@requires` accumulate, and the field-selector family repeats keyed
 * by its leading selector argument (HEAD legitimately repeats all three).
 *
 * `defNames` / `nonVariantTypeNames` supply the merged invariants that need
 * cross-declaration knowledge: `@native` marks an ORPHAN signature (a `@native`
 * sig that also has a definition is never read by the native loop), `@codeName`
 * on a type declaration only means something when that declaration is an
 * `@entity`, and `@discriminator` selects a variant's case-tag slot so it is
 * meaningless on a refined / alias declaration.
 *
 * Note on `@discriminator`: the loader VALIDATES it here but still CONSUMES
 * nothing — its consumer is the parse stage (`syntax-to-jsonlogic.fenel`'s
 * `typedefFrame` and the `fenel-parser.ts` mirror), which is what the policy
 * table's `stage` column records. Validation and consumption are different
 * jobs; leaving it out of the gate entirely would let `@discriminator "a" "b"`
 * on a function be silently ignored, which is the fail-open shape this closes.
 */
function validateDirectives(
  sites: readonly DirectiveSite[],
  moduleName: string,
  defNames: ReadonlySet<string>,
  nonVariantTypeNames: ReadonlySet<string>,
  typeDeclNames: readonly string[],
): void {
  const errors: string[] = [];
  const at = (site: DirectiveSite, d: FacetDirective) =>
    `${moduleName}.${site.declName}: @${d.name}`;

  // Pass 1 — per-OCCURRENCE: name, arity, placement.
  for (const site of sites) {
    for (const d of site.directives) {
      const policy = DIRECTIVE_POLICY_BY_NAME.get(d.name);
      if (policy === undefined) {
        errors.push(
          `${at(site, d)} is not a known directive. Known directives: ${DIRECTIVE_KNOWN_NAMES}.`,
        );
        continue;
      }
      if (d.args.length < policy.minArgs) {
        errors.push(
          `${at(site, d)} takes at least ${policy.minArgs} argument(s), got ${d.args.length}.`,
        );
      } else if (policy.maxArgs !== null && d.args.length > policy.maxArgs) {
        errors.push(
          `${at(site, d)} takes at most ${policy.maxArgs} argument(s), got ${d.args.length}.`,
        );
      }
      if (!contextAdmits(policy.context, site.declKind)) {
        errors.push(
          `${at(site, d)} may not be placed on ${declKindLabel(site.declKind)} `
          + `(it is admitted on ${policy.context === "DcTypeDecl" ? "type declarations" : "function declarations"} only).`,
        );
      }
    }
  }

  // Pass 2 — per-NAME multiplicity, over the MERGED-by-declaration-name set
  // (a function's directives may be split across its signature and its
  // definition; the loader concatenates them, so the duplicate check must see
  // the merged run — that is exactly how the two live `@label` defects hid).
  const merged = new Map<string, { kinds: Set<DeclKind>; ds: FacetDirective[] }>();
  for (const site of sites) {
    const entry = merged.get(site.declName) ?? { kinds: new Set<DeclKind>(), ds: [] };
    entry.kinds.add(site.declKind);
    entry.ds.push(...site.directives);
    merged.set(site.declName, entry);
  }
  for (const [declName, entry] of merged) {
    const counts = new Map<string, number>();
    const selectorKeys = new Map<string, Set<string>>();
    for (const d of entry.ds) {
      const policy = DIRECTIVE_POLICY_BY_NAME.get(d.name);
      if (policy === undefined) continue; // already reported in pass 1
      counts.set(d.name, (counts.get(d.name) ?? 0) + 1);
      if (policy.multiplicity === "DmSelectorKeyed") {
        const key = d.args.slice(0, policy.keyArity).join(" ");
        const seen = selectorKeys.get(d.name) ?? new Set<string>();
        if (seen.has(key)) {
          errors.push(
            `${moduleName}.${declName}: @${d.name} "${d.args.slice(0, policy.keyArity).join('" "')}" `
            + `is declared more than once. A selector-keyed directive may repeat, but not on the same selector.`,
          );
        }
        seen.add(key);
        selectorKeys.set(d.name, seen);
      }
    }
    for (const [name, count] of counts) {
      const policy = DIRECTIVE_POLICY_BY_NAME.get(name)!;
      if (policy.multiplicity === "DmScalar" && count > 1) {
        errors.push(
          `${moduleName}.${declName}: @${name} is declared ${count} times but takes at most one occurrence `
          + `(only the first was ever read, so the rest were silent data loss). `
          + `A directive block interrupted by a comment still attaches to the SAME declaration — `
          + `check whether one of them was written for a neighbouring declaration.`,
        );
      }
    }
    // Merged invariant — `@native` marks an ORPHAN signature. A `@native` that
    // also has a definition is skipped by the foreign-declaration loop below
    // (`if (defs.has(name)) continue`), so the marker would be read by nobody.
    if (counts.has("native") && defNames.has(declName)) {
      errors.push(
        `${moduleName}.${declName}: @native marks a signature whose implementation is a host-IO leaf, `
        + `but this declaration also has a Fenel definition. Remove @native or remove the definition.`,
      );
    }
    // Merged invariant — a directive-carrying signature with no definition and
    // no `@native` is DROPPED whole by the loader, taking its directives with
    // it. That is the same silent data loss this gate exists to close.
    if (
      entry.ds.length > 0
      && entry.kinds.has("sig")
      && !entry.kinds.has("typedef")
      && !defNames.has(declName)
      && !counts.has("native")
    ) {
      errors.push(
        `${moduleName}.${declName}: this signature carries directives but has no definition and no @native, `
        + `so the loader drops the declaration and every directive on it. `
        + `Add a definition, add @native, or remove the directives.`,
      );
    }
    // Merged invariant — `@discriminator` selects the case-tag slot of a
    // VARIANT, so it has no meaning on a refined / alias type declaration. The
    // TS perf-branch parser already throws on this shape; the Fenel emitter
    // does not, so without this check the two disagree on a program only one of
    // them rejects. Checking it here rejects it whichever parser produced the AST.
    if (counts.has("discriminator") && nonVariantTypeNames.has(declName)) {
      errors.push(
        `${moduleName}.${declName}: @discriminator applies only to variant-form type `
        + `declarations, not to a refined or alias declaration (it selects the case-tag slot).`,
      );
    }
    // Merged invariant (Part B) — `@codeName` on a TYPE declaration sets the
    // registered entity id, which is only meaningful for an `@entity`. Without
    // the marker the facets would key an id that no entity registers under.
    if (entry.kinds.has("typedef") && counts.has("codeName") && !counts.has("entity")) {
      errors.push(
        `${moduleName}.${declName}: @codeName sets the registered entity id, but this type declaration `
        + `is not marked @entity, so nothing registers under that id. Add @entity or remove @codeName.`,
      );
    }
  }

  // Cross-declaration invariant — EFFECTIVE type codeName uniqueness within the
  // source. `@codeName` lets a type declaration register under an id that is not
  // its declaration name, so two type decls in one file can collide on the
  // effective id. That matters because promotion (`hasLiftedCodeable`,
  // system-entities.ts) matches a codeName STRING globally rather than carrying
  // declaration ownership: given a collision, the lifted `Codeable` of the
  // MARKED declaration can promote the UNMARKED one that happens to share the
  // id, and the marked one is then skipped as already-registered. Rejecting the
  // collision here removes the single-source case at zero corpus cost (the 8
  // same-name pairs in the tree are all CROSS-file, and none share a module).
  // The cross-module case is a promotion-provenance defect that predates this
  // phase and is memo'd in the workstream roadmap, not fixed here.
  // NOTE: driven by `typeDeclNames`, not by `sites` — a DIRECTIVE-LESS type decl
  // is exactly the one that can be hijacked (it contributes no Codeable of its
  // own, so it is invisible in `sites`), and it is the victim in the collision.
  const byEffectiveCodeName = new Map<string, string[]>();
  for (const declName of typeDeclNames) {
    const codeName = merged.get(declName)?.ds.find((d) => d.name === "codeName")?.args[0]
      ?? declName;
    byEffectiveCodeName.set(codeName, [
      ...(byEffectiveCodeName.get(codeName) ?? []),
      declName,
    ]);
  }
  for (const [codeName, declNames] of byEffectiveCodeName) {
    const distinct = [...new Set(declNames)];
    if (distinct.length > 1) {
      errors.push(
        `${moduleName}: type declarations ${distinct.join(", ")} all register under the `
        + `effective codeName "${codeName}". Registration identity must be unique — a `
        + `collision lets one declaration's @entity promote another. Give each its own @codeName.`,
      );
    }
  }

  if (errors.length > 0) {
    throw new DirectivePolicyError(
      `Directive policy violations in module "${moduleName}":\n  - ${errors.join("\n  - ")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// modules-as-values Phase 3a — THE DECLARATION-NAME RULES MIRROR.
//
// A MECHANICAL MIRROR of `fenel/modules/engine/declaration-names.fenel`, the
// SOURCE OF TRUTH for what `_` may be and when two declarations clash. The
// loader runs before any Fenel code can, so it cannot call those bodies; this
// mirror is pinned to them by `fenel-module-declaration-names-parity.test.ts`,
// which runs both over the same declaration lists and asserts deep equality,
// messages included. Values are shaped like the Fenel ADTs (`$tag` + named
// fields, Maybe as Just/Nothing) so the two compare directly. Edit the `.fenel`
// file first; update this mirror in the SAME commit.
// ---------------------------------------------------------------------------

/** `_` spells "no name" in declaration position (design/module-system.md §3). */
const UNNAMED = "_";

type DeclarationForm =
  | { $tag: "SignatureForm" }
  | { $tag: "DefinitionForm" }
  | { $tag: "TypeForm" }
  | { $tag: "OtherForm" };

/** One top-level declaration as the name rules see it (the Fenel
 *  `DeclarationHead`). `codeName` is set exactly when the loader registers a
 *  function for this declaration. */
export type DeclarationHead = {
  $tag: "DeclarationHead";
  form: DeclarationForm;
  name: Maybe<string>;
  codeName: Maybe<string>;
  file: string;
  index: number;
  hasParams: boolean;
  hasDirectives: boolean;
  typeHead: Maybe<string>;
  bodyHead: Maybe<string>;
};

/** One name a file-top selection opens (the Fenel `ImportSelection`):
 *  `using source (name)` or the legacy `import source (name)`, written at
 *  declaration `index` (from 0) of `file`. modules-as-values Phase 5c-1a. */
export type ImportSelection = {
  $tag: "ImportSelection";
  name: string;
  source: string;
  file: string;
  index: number;
};

type UnnamedDeclarationFault =
  | "UnpairedSignature"
  | "UnpairedDefinition"
  | "UnnamedWithParameters"
  | "UnnamedNotInstance"
  | "UnnamedWithDirectives";

/** The Fenel `DeclarationNameError` ADT, value for value. */
export type DeclarationNameErrorValue =
  | {
      $tag: "UnnamedDeclarationError";
      fault: { $tag: UnnamedDeclarationFault };
      number: number;
      declaration: DeclarationHead;
      message: string;
    }
  | { $tag: "DuplicateDeclaration"; name: string; first: DeclarationHead; second: DeclarationHead; message: string }
  | { $tag: "CodeNameClash"; codeName: string; first: DeclarationHead; second: DeclarationHead; message: string }
  | { $tag: "SelectionConflict"; name: string; first: ImportSelection; second: ImportSelection; message: string };

/** Thrown when a module's declarations break the name rules. Distinct type so
 *  callers can tell it from a parse error or a directive-policy rejection. */
export class DeclarationNameError extends Error {
  readonly errors: readonly DeclarationNameErrorValue[];
  constructor(moduleName: string, errors: readonly DeclarationNameErrorValue[]) {
    super(
      `Declaration name errors in module "${moduleName}":\n  - ${errors.map((e) => e.message).join("\n  - ")}`,
    );
    this.name = "DeclarationNameError";
    this.errors = errors;
  }
}

const declarationSiteText = (decl: DeclarationHead): string =>
  `declaration ${decl.index + 1} in ${decl.file}`;

const declarationNamespace = (form: DeclarationForm): string | null =>
  form.$tag === "SignatureForm" ? "signature"
  : form.$tag === "DefinitionForm" ? "definition"
  : form.$tag === "TypeForm" ? "type declaration"
  : null;

const isUnnamedOfForm = (decl: DeclarationHead, form: DeclarationForm["$tag"]): boolean =>
  decl.form.$tag === form && decl.name.$tag === "Nothing";

function unnamedError(
  fault: UnnamedDeclarationFault,
  ordinal: number,
  decl: DeclarationHead,
  text: string,
): DeclarationNameErrorValue {
  const noun = declarationNamespace(decl.form) ?? "declaration";
  return {
    $tag: "UnnamedDeclarationError",
    fault: { $tag: fault },
    number: ordinal,
    declaration: decl,
    message: `unnamed declaration #${ordinal}: the "_" ${noun} at ${declarationSiteText(decl)}${text}`,
  };
}

const unpairedSignatureError = (ordinal: number, sig: DeclarationHead): DeclarationNameErrorValue =>
  unnamedError("UnpairedSignature", ordinal, sig,
    ' is not immediately followed by a "_" definition. Each "_" signature pairs with the "_" definition right after it.');

const unnamedParameterErrors = (ordinal: number, decl: DeclarationHead): DeclarationNameErrorValue[] =>
  decl.hasParams
    ? [unnamedError("UnnamedWithParameters", ordinal, decl,
        " takes parameters. An unnamed declaration is an instance value, not a function.")]
    : [];

const unnamedDirectiveErrors = (ordinal: number, decl: DeclarationHead): DeclarationNameErrorValue[] =>
  decl.hasDirectives
    ? [unnamedError("UnnamedWithDirectives", ordinal, decl,
        " carries directives. An unnamed declaration has no name for them to attach to, so they would be silently discarded.")]
    : [];

function unnamedBodyErrors(ordinal: number, sig: DeclarationHead, decl: DeclarationHead): DeclarationNameErrorValue[] {
  if (sig.typeHead.$tag === "Just" && decl.bodyHead.$tag === "Just" && decl.bodyHead._0 === sig.typeHead._0) {
    return [];
  }
  const text = sig.typeHead.$tag === "Just"
    ? ` must be a constructor application of its signature's type "${sig.typeHead._0}", as in _ = ${sig.typeHead._0} { ... }.`
    : " cannot be an instance: its signature does not name a type.";
  return [unnamedError("UnnamedNotInstance", ordinal, decl, text)];
}

/** Mirror of `declarationUnnamedErrors`: every refusal of a `_` declaration in
 *  one file, in source order. Empty means every `_` pair is one instance. */
export function declarationUnnamedErrors(heads: readonly DeclarationHead[]): DeclarationNameErrorValue[] {
  let count = 0;
  let pending: DeclarationHead | null = null;
  const errors: DeclarationNameErrorValue[] = [];
  for (const decl of heads) {
    if (pending !== null) {
      const sig: DeclarationHead = pending;
      pending = null;
      if (isUnnamedOfForm(decl, "DefinitionForm")) {
        errors.push(
          ...unnamedParameterErrors(count, decl),
          ...unnamedBodyErrors(count, sig, decl),
          ...unnamedDirectiveErrors(count, decl),
        );
        continue;
      }
      errors.push(unpairedSignatureError(count, sig));
    }
    if (isUnnamedOfForm(decl, "SignatureForm")) {
      count += 1;
      pending = decl;
      errors.push(...unnamedDirectiveErrors(count, decl));
    } else if (isUnnamedOfForm(decl, "DefinitionForm")) {
      count += 1;
      errors.push(
        unnamedError("UnpairedDefinition", count, decl,
          ' has no "_" signature immediately before it. An unnamed instance is found by its type and parameters, so it needs a signature.'),
        ...unnamedParameterErrors(count, decl),
        ...unnamedDirectiveErrors(count, decl),
      );
    }
  }
  if (pending !== null) errors.push(unpairedSignatureError(count, pending));
  return errors;
}

const quotedSiteText = (decl: DeclarationHead): string =>
  `"${decl.name.$tag === "Just" ? decl.name._0 : UNNAMED}" (${declarationSiteText(decl)})`;

/** Mirror of `declarationNameClashes`: a second declaration of one name in one
 *  namespace, and a second function of one effective code name (unless both
 *  share a name, which is the duplicate already reported). `_` never clashes.
 *  The name and code-name indexes are separate namespaces. */
export function declarationNameClashes(heads: readonly DeclarationHead[]): DeclarationNameErrorValue[] {
  const byName = new Map<string, DeclarationHead>();
  const byCodeName = new Map<string, DeclarationHead>();
  const errors: DeclarationNameErrorValue[] = [];
  for (const decl of heads) {
    if (decl.name.$tag !== "Just") continue;
    const declName = decl.name._0;
    const space = declarationNamespace(decl.form);
    if (space !== null) {
      const earlier = byName.get(`${space} ${declName}`);
      if (earlier === undefined) {
        byName.set(`${space} ${declName}`, decl);
      } else {
        errors.push({
          $tag: "DuplicateDeclaration",
          name: declName,
          first: earlier,
          second: decl,
          message: `duplicate ${space} "${declName}": ${declarationSiteText(earlier)} and ${declarationSiteText(decl)}. `
            + "A name is declared once in a module; rename or remove one of them.",
        });
      }
    }
    if (decl.codeName.$tag === "Just") {
      const code = decl.codeName._0;
      const earlier = byCodeName.get(code);
      if (earlier === undefined) {
        byCodeName.set(code, decl);
      } else if (!(earlier.name.$tag === "Just" && earlier.name._0 === declName)) {
        errors.push({
          $tag: "CodeNameClash",
          codeName: code,
          first: earlier,
          second: decl,
          message: `code name "${code}" is registered by two functions, ${quotedSiteText(earlier)} and ${quotedSiteText(decl)}. `
            + "A function's @codeName, or its name when it has none, must be unique in its module.",
        });
      }
    }
  }
  return errors;
}

/** Mirror of `declarationGroupClashes`: the clashes among the files of one
 *  union group. Across files the rule sees every named definition (functions
 *  and named instances share a namespace; an instance-file value has no
 *  function id) and every declaration that registers a function. */
export function declarationGroupClashes(heads: readonly DeclarationHead[]): DeclarationNameErrorValue[] {
  return declarationNameClashes(heads.filter((decl) =>
    (decl.form.$tag === "DefinitionForm" && decl.name.$tag === "Just") || decl.codeName.$tag === "Just"));
}

/** Mirror of `declarationSelectionConflicts` (modules-as-values Phase 5c-1a):
 *  two file-top selections of one name from two different sources are an
 *  error naming both; each later conflict is reported against the first
 *  selection of the name. One name selected twice from one source is fine, and
 *  a module's own member is not a selection, so it never clashes (it wins over
 *  imports at resolution). */
export function declarationSelectionConflicts(selections: readonly ImportSelection[]): DeclarationNameErrorValue[] {
  const bySelected = new Map<string, ImportSelection>();
  const errors: DeclarationNameErrorValue[] = [];
  for (const sel of selections) {
    const earlier = bySelected.get(sel.name);
    if (earlier === undefined) {
      bySelected.set(sel.name, sel);
    } else if (earlier.source !== sel.source) {
      errors.push({
        $tag: "SelectionConflict",
        name: sel.name,
        first: earlier,
        second: sel,
        message: `"${sel.name}" is selected from two sources: ${selectionSiteText(earlier)} and ${selectionSiteText(sel)}. `
          + `A module opens a name from one source; keep one selection and write the other as ${sel.source}.${sel.name}.`,
      });
    }
  }
  return errors;
}

const selectionSiteText = (sel: ImportSelection): string =>
  `${sel.source} (declaration ${sel.index + 1} in ${sel.file})`;

type TypeSigAST = {
  type_sig: {
    name: string;
    type: unknown;
    scheme?: TypeScheme;
    directives?: FacetDirective[];
  };
};
type TypeDefAST = {
  type_def: {
    name: string;
    params?: string[];
    binding?: Omit<TypeScheme, "body">;
    /** Present for ADT/record decls (multi-/single-constructor form). Absent
     *  for refinement decls (which set `refined` instead) and for type-expr-
     *  alias opaque decls (which set `alias` instead). */
    constructors?: Array<{
      name: string;
      fields: Array<{
        name?: string;
        key?: FieldDef["key"];
        type?: unknown;
      }>;
    }>;
    /** Present iff the source declared a refinement-form type-def
     *  (`Email = String | isValidEmail` / `Char = Nat | value ∈ <set>`).
     *  The parser emits the already-built `{$refined: {base, set}}` shape;
     *  `typeDefToFenelType` returns it directly (optionally $opaque-wrapped). */
    refined?: { $refined: { base: unknown; set: unknown } };
    /** Present iff the source declared a type-expression-RHS opaque-decl
     *  (`opaque "string" String = List Char`). Phase 2.11 extended the
     *  opaque-decl grammar with this third arm — selected when the body
     *  has no `|` and no `<ident>:` at depth 0 — so atoms whose pure side
     *  is a parametric type-application (like `Str.pure = List Char`) can
     *  be authored in `.fenel` without a wrapping single-zero-field-ctor.
     *  Mutually exclusive with `refined` and `constructors`. */
    alias?: unknown;
    /** Present iff the source declared the type with the `opaque "<repr>"`
     *  keyword. The wrap to `$opaque { name, repr, pure }` happens in
     *  `typeDefToFenelType`. */
    opaque?: { repr: string };
    /** Phase 3e — custom variant discriminator slot, sourced from the
     *  `@discriminator "<name>"` directive grammar. When set, the lowered
     *  `$variant` carries the `discriminator` slot (consumed by validate /
     *  field-meta / json-schema / widget-hint, all of which fall back to
     *  `"$tag"` when absent — case-to-tag Step 2). Also forces the single-ctor-with-named-
     *  fields case to stay a `$variant` rather than collapse to a
     *  `$record` — the discriminator only makes sense on variants. */
    discriminator?: string;
    /** FM-retire-E1 (Ext-1) — facet directives the parser captures above an
     *  entity type-decl (`@label` / `@description` / `@icon` / `@fieldLabel` /
     *  …), lifted by the loader into the entity's identity-facet ClassInstances
     *  (the `.fenel` analogue of a `defineSystemEntity` identity record). */
    directives?: FacetDirective[];
  };
};
type FixityAST = { fixity: { op: string; assoc: "l" | "r" | "n"; prec: number } };
// Phase 2a (module-substrate) — the `module … where` header and the four
// Haskell `import` forms. Captured onto `FenelModule` (name + imports); NOT
// yet resolved (Phase 2b).
type ModuleDeclAST = { module_decl: { name: string } };
type ImportDeclAST = {
  import_decl: {
    module: string;
    qualified?: boolean;
    names?: string[];
    as?: string;
    hiding?: string[];
  };
};

type Decl = DefAST | TypeSigAST | TypeDefAST | FixityAST | ModuleDeclAST | ImportDeclAST;

function isDef(d: unknown): d is DefAST {
  return typeof d === "object" && d !== null && "def" in d;
}
function isTypeSig(d: unknown): d is TypeSigAST {
  return typeof d === "object" && d !== null && "type_sig" in d;
}
function isTypeDef(d: unknown): d is TypeDefAST {
  return typeof d === "object" && d !== null && "type_def" in d;
}
function isFixity(d: unknown): d is FixityAST {
  return typeof d === "object" && d !== null && "fixity" in d;
}
function isModuleDecl(d: unknown): d is ModuleDeclAST {
  return typeof d === "object" && d !== null && "module_decl" in d;
}
function isImportDecl(d: unknown): d is ImportDeclAST {
  return typeof d === "object" && d !== null && "import_decl" in d;
}

export type LoadFenelModuleOptions = {
  /** Locale for the parser (en/fr/es/ar). Defaults to en. */
  locale?: string;
  /** Module-level label (defaults to the moduleName). */
  label?: string;
  /**
   * Phase 3.2b — declares, per spec name, which method fields hold a FenelType
   * *value* (e.g. `AggregableSpec`'s `inputType` / `outputType`, declared
   * `FenelType` in the spec). Authoring `inputType = List` parses `List`
   * (uppercase, value position) to a nullary constructor application
   * `{construct:["List"]}`, which `lowerConstructLiteral` would lower to the
   * runtime VALUE `{$tag:"List"}`. A type-valued field instead lowers it to the
   * TYPE REFERENCE `{$named:"List"}` — the shape a type-ref const holds.
   *
   * This is DECLARATIVE, not a shape-guess: the caller (which legitimately
   * knows its own spec) asserts the field is type-valued. The loader makes NO
   * type-vs-value inference from the parsed shape — a guess would corrupt real
   * nullary-variant method values like `Nothing` (which must stay
   * `{$tag:"Nothing"}`). Keeps the loader circular-import-free (the caller, not
   * `system-entities`, supplies the set).
   *
   * Keyed by spec name (`"Aggregable"`); the value is the list of
   * type-valued field names (`["inputType", "outputType"]`).
   */
  typeValuedFields?: Record<string, string[]>;
  /**
   * Phase 3.4b — the non-suffix replacement for the loader's old
   * `endsWith("Spec")` dispatch-instance gate (blocker #1 of the three the
   * suffix performed). When `true`, EVERY typed value-decl this source
   * carries is a dispatch *instance* (a typed value the registry resolves by
   * type) — so it is by-type-indexed but NOT also registered as a by-name
   * function and gets no auto Codeable/Labelable/Categorizable identity.
   *
   * This is the "instance file" marker: a dedicated `instances.fenel` (or
   * `std/dispatch-instances.fenel`) contains ONLY dispatch instances, so the
   * file IS the signal — model-faithful (the marker becomes the file, not a
   * per-type name suffix; `design/unified-dispatch.md`). Used in preference
   * to a caller-supplied `dispatchClasses` set because the per-module instance
   * files load at module-IMPORT time, before `dispatchRegistry` exists (a circular
   * import), so they can't read `dispatchRegistry.listClasses()`. Grep-confirmed
   * (Phase 3.4b): zero inline dispatch instances live in non-instance `.fenel`
   * files, so the file-level marker is exact.
   *
   * Default (`undefined`/`false`): a typed value-decl is BOTH by-type-indexed
   * AND by-name-callable with identity — the data-record-constant facet
   * (`emptyKeyboardState : KeyboardState = KeyboardState { … }`), unchanged
   * from Phase 3.4a.
   */
  dispatchInstanceFile?: boolean;
  /**
   * Bootstrap-only escape for source projections that are themselves members
   * of the registry used by the default Fenel parser. Such projections cannot
   * enter `parsedViaCache` on a stale/disabled cache: its Fenel fallback would
   * need the not-yet-initialized registry profile. The sanctioned TypeScript
   * parser is the B1 parity mirror and has no registry dependency.
   *
   * Keep this narrow: ordinary repository modules must use the default cached
   * Fenel parser path so parser cutover remains observable.
   */
  bootstrapParser?: "typescript";
};

/**
 * Parse a `.fenel` source text and produce a FenelModule.
 *
 *   loadFenelModule(`
 *     addOne : Number -> Number
 *     addOne x = x + 1
 *
 *     Color = Red | Green | Blue
 *   `, "demo")
 *   // → FenelModule { functions: [addOne], entities: [{ name: "Color", type: $variant }] }
 */
export function loadFenelModule(
  src: string,
  moduleName: string,
  opts: LoadFenelModuleOptions = {},
): FenelModule {
  const loaded = loadFenelModuleWithHeads(src, moduleName, opts).module;
  rememberCanonicalLoadedModuleOrigin(loaded, src, moduleName, opts);
  return loaded;
}

/** The declaration list the name rules judge for one source, exactly as
 *  `loadFenelModule` builds it. Exported for the parity test. */
export function declarationHeadsOf(
  src: string,
  file: string,
  opts: LoadFenelModuleOptions = {},
): DeclarationHead[] {
  return declarationHeads(parseDeclarations(src, file, opts), file, opts);
}

/** The file-top selections the selection rule judges for one source, exactly
 *  as `loadFenelModule` builds them. Exported for the parity test. */
export function importSelectionsOf(
  src: string,
  file: string,
  opts: LoadFenelModuleOptions = {},
): ImportSelection[] {
  return importSelections(parseDeclarations(src, file, opts), file);
}

/** `loadFenelModule`, plus the declaration list and file-top selections its
 *  name rules judged — the union loader needs them to apply the same rules
 *  across files. */
function loadFenelModuleWithHeads(
  src: string,
  moduleName: string,
  opts: LoadFenelModuleOptions,
): { module: FenelModule; heads: DeclarationHead[]; selections: ImportSelection[] } {
  const decls = parseDeclarations(src, moduleName, opts);

  // A `module Foo where` header is the module's identity (OQ3 — header-driven,
  // not directory-driven), overriding the arg-supplied `moduleName`. Header-
  // less files (the 143 existing ones) keep the arg as the fallback. A single
  // file carrying multiple headers is malformed; we take the first. Same-named
  // headers across files union in `loadFenelModuleUnion`, which applies the
  // name rules across them. (Resolved before either load gate below so each
  // diagnostic names the module the way the rest of the loader does.)
  const header = decls.find(isModuleDecl);
  const effectiveName = header !== undefined ? header.module_decl.name : moduleName;

  // modules-as-values Phase 3a — THE NAME GATE, before any collation: `_`
  // pairs, duplicate names and code-name collisions are load errors (rules in
  // declaration-names.fenel, mirrored above). It runs before the directive
  // gate because a `_` has no name for its directives to merge under, and a
  // second declaration of a name would merge its directives into the first's.
  const heads = declarationHeads(decls, moduleName, opts);
  // modules-as-values Phase 5c-1a — two selections of one name from two
  // sources (declarationSelectionConflicts) join the same gate.
  const selections = importSelections(decls, moduleName);
  const nameErrors = [
    ...declarationUnnamedErrors(heads),
    ...declarationNameClashes(heads),
    ...declarationSelectionConflicts(selections),
  ];
  if (nameErrors.length > 0) throw new DeclarationNameError(effectiveName, nameErrors);

  // Collate type_sigs and defs by name for pairing.
  const sigs = new Map<string, TypeSigAST["type_sig"]>();
  const defs = new Map<string, { params: string[]; body: unknown }>();
  const typeDefs: TypeDefAST["type_def"][] = [];
  // Fixity decls don't currently surface on FenelModule — they're a parser
  // concern (precedence). Captured here for future module-level metadata.
  const fixities: FixityAST["fixity"][] = [];
  // Phase 2a — captured `import` forms. Capture only: imports ride onto
  // `FenelModule.imports` but are NOT resolved yet (Phase 2b).
  const importDecls: ImportDeclAST["import_decl"][] = [];
  // Phase 3a (module-substrate) — `@facet` directives a function decl carries,
  // keyed by function name. Collected from BOTH the type_sig and the def
  // (whichever the author placed them on), so the `@label`/`@description`/etc.
  // block can sit above either. The loader lifts these into identity-facet
  // ClassInstances keyed by the function's id below.
  const directivesByName = new Map<string, FacetDirective[]>();
  // declaration-annotations Phase 1 (A.2) — RAW occurrences first, collation
  // second. The gate must see each directive with the declaration KIND it was
  // written on (placement is part of the policy), and it must run BEFORE the
  // by-name merge and before any LOAD-STAGE consumer — otherwise a rejected
  // directive has already been read. (Precisely: load-stage. `@discriminator` is
  // consumed at the PARSE stage, so by the time the loader sees the AST it is
  // already lifted into `td.discriminator` by whichever parser ran. The gate
  // still validates it — see `validateDirectives` — it just cannot precede that
  // parser's own consumption. That split is what the policy `stage` column
  // records.) Source order is preserved throughout: the merge order below is
  // load order, which is what `@tags` accumulation and the field-facet /
  // value-label emission order depend on.
  const directiveSites: DirectiveSite[] = [];
  const addDirectives = (name: string, kind: DeclKind, ds: FacetDirective[] | undefined) => {
    if (!ds || ds.length === 0) return;
    directiveSites.push({ declName: name, declKind: kind, directives: ds });
  };

  // Each `_` pair gets its own key, which no identifier can spell (`_#1`,
  // `_#2`, …), so two pairs never merge. The name gate guarantees a `_`
  // definition directly follows its `_` signature, so it takes the key that
  // signature opened.
  let unnamedCount = 0;
  const sigKey = (name: string): string => name === UNNAMED ? `${UNNAMED}#${++unnamedCount}` : name;
  const defKey = (name: string): string => name === UNNAMED ? `${UNNAMED}#${unnamedCount}` : name;

  for (const d of decls) {
    if (isTypeSig(d)) { const key = sigKey(d.type_sig.name); sigs.set(key, d.type_sig); addDirectives(key, "sig", d.type_sig.directives); }
    else if (isDef(d)) { const key = defKey(d.def.name); defs.set(key, { params: d.def.params, body: d.def.body }); addDirectives(key, "def", d.def.directives); }
    else if (isTypeDef(d)) { typeDefs.push(d.type_def); addDirectives(d.type_def.name, "typedef", d.type_def.directives); }
    else if (isFixity(d)) fixities.push(d.fixity);
    else if (isImportDecl(d)) importDecls.push(d.import_decl);
  }

  // THE GATE — fail closed before collation, before any load-stage semantic
  // consumer. A violation is a
  // module-LOAD ERROR, not a warning: the whole point is that a typo'd or
  // misplaced directive can no longer be silently discarded.
  validateDirectives(
    directiveSites,
    effectiveName,
    new Set(defs.keys()),
    new Set(
      typeDefs
        .filter((td) => td.refined !== undefined || td.alias !== undefined)
        .map((td) => td.name),
    ),
    typeDefs.map((td) => td.name),
  );

  // Validated — now collate by declaration name, in source order.
  for (const site of directiveSites) {
    const existing = directivesByName.get(site.declName) ?? [];
    directivesByName.set(site.declName, [...existing, ...site.directives]);
  }

  const functions: FenelFunction[] = [];
  const functionSignatureDeclarations: FunctionSignatureDeclaration[] = [];
  const instances: Instance[] = [];
  // Same-file type bodies, so `name : Recipe` can recover the arrow inside a
  // constantly-true refinement. The scheme sidecar stays the written `$ref`.
  // Each file is loaded before the module union, so a type defined in another
  // file of the same module is not visible here and stays a non-arrow sig.
  const typeBodies = new Map<string, unknown>();
  for (const td of typeDefs) typeBodies.set(td.name, typeDefToFenelType(td));

  for (const [name, body] of defs) {
    const sigDecl = sigs.get(name);
    const sig = sigDecl?.type;

    // An unnamed pair is exactly one instance, in any file: it is found by its
    // type and parameters, so it has no function, no Codeable and no lock row.
    // The name gate checked that its body constructs its signature's type, so
    // the signature-driven path always matches.
    if (name.startsWith(`${UNNAMED}#`)) {
      const typed = deriveTypedValueDecl(sig, body.body, opts.typeValuedFields, opts.dispatchInstanceFile === true);
      if (typed === null) {
        throw new Error(`loadFenelModule: unnamed declaration ${name} in module "${effectiveName}" is not an instance`);
      }
      instances.push(typed.inst);
      continue;
    }

    // Phase 3.4a (typeclass-substrate-completion) — UNIFIED value registry, no
    // instance-vs-constant routing. "An instance is a typed value": ANY nullary
    // value-decl whose body constructs a type is a typed value that feeds the
    // dispatch type-index, keyed by that type's constructor (design/unified-
    // dispatch.md § "An instance is a typed value — there is nothing special to
    // recognize"). `profileReferenceable : ReferenceableSpec profile` (a
    // dispatch instance) and `emptyKeyboardState = KeyboardState { … }` (a
    // data-record constant) are recognised + by-type-indexed IDENTICALLY — there
    // is no suffix gate deciding "instance XOR function", no separate store the
    // value is routed into.
    //
    // What the value's TYPE decides is the *presentation* facet below, a uniform
    // type-rule (not store-routing): a value that is a pure dispatch instance
    // (carried by an instance file — `opts.dispatchInstanceFile`, the Phase 3.4b
    // non-suffix replacement for the retired `endsWith("Spec")` gate) is NOT
    // also registered as a by-name callable function and gets no auto identity
    // (Codeable/Labelable/Categorizable). A value of any other kind (a
    // data-record constant, an ordinary function) IS by-name callable with
    // identity. The by-type indexing above ran uniformly for both.
    // modules-as-values Phase 5a — a NAMED instance-file value keeps its name
    // and authored record (the `declaration` carrier, attached by
    // `buildSpecInstance` only when `dispatchInstanceFile`): it gets no
    // function below, so the carrier is how the bundle's member index finds it.
    const typed =
      body.params.length === 0
        ? deriveTypedValueDecl(sig, body.body, opts.typeValuedFields, opts.dispatchInstanceFile === true, name)
        : null;
    if (typed) instances.push(typed.inst);
    if (typed?.isDispatchClass) {
      // declaration-annotations Phase 1 (A.2) — the LAST fail-open drop on this
      // path. A pure dispatch instance gets no by-name identity, so the `continue`
      // below skips `@requires` / `@codeName` / `liftIdentityFacets` entirely —
      // any directive written here would be accepted by the policy gate (it is a
      // well-formed function-decl directive) and then silently discarded. The
      // gate cannot see this: whether a declaration is a dispatch instance is
      // only known HERE, after `deriveTypedValueDecl`. So the check lives here,
      // still before any load-stage semantic consumer reads them (collation and
      // the policy gate have inspected them, but nothing has ACTED on them).
      // Zero corpus occurrences.
      const dispatchDirectives = directivesByName.get(name) ?? [];
      if (dispatchDirectives.length > 0) {
        throw new DirectivePolicyError(
          `Directive policy violations in module "${effectiveName}":\n  - `
          + `${effectiveName}.${name}: ${dispatchDirectives.map((d) => `@${d.name}`).join(", ")} `
          + `on a dispatch instance. An instance-file value is indexed by TYPE and gets no `
          + `by-name identity, so these directives would be silently discarded. Remove them, `
          + `or move the declaration out of the instance file.`,
        );
      }
      continue;
    }

    const id = `${effectiveName}:${name}`;
    const ds = directivesByName.get(name) ?? [];
    const codeName = ds.find((d) => d.name === "codeName")?.args[0] ?? name;
    const { params, returns, paramDeclarations, returnDeclaration } =
      signatureForDef(id, body.params, sameModuleArrow(sig, typeBodies));
    // Phase 3o (module-substrate) — `@requires "ClassId"` directive. Effects are
    // INFERRED for Fenel-bodied fns (attachInferredRequires walks the body), so a
    // Fenel-bodied def rarely needs this; it exists for the BODYLESS `@native`
    // path below (an IO leaf has no body to infer from — its capability constraint
    // must be declared). Honored on the def-path too for completeness.
    const requires = liftRequiresFromDirectives(ds);
    // FM-retire-11 (L1) — rewrite local-applying bare-string call heads to
    // `{var}` heads (seed binders = the def's param names), so a body that
    // applies a function-typed local (`($) f x = f x`) carries the working
    // `{var}`-head shape for the interpreter AND the self-host compiler. See the
    // pass header above (`resolveLocalCallHeads`).
    const resolvedBody = resolveLocalCallHeads(body.body, body.params);
    const fn: FenelFunction = {
      id,
      params,
      returns,
      body: resolvedBody as FunctionBody,
      ...(requires ? { requires } : {}),
    };
    functions.push(fn);
    const signatureDeclaration: FunctionSignatureDeclaration = {
      functionId: id,
      declarationName: name,
      codeName,
      ...(sigDecl === undefined
        ? {}
        : { scheme: sourceTypeScheme(sigDecl) }),
      params: paramDeclarations,
      returns: returnDeclaration,
    };
    functionSignatureDeclarations.push(signatureDeclaration);
    registerLoadedFunctionSignatureDeclaration(fn, signatureDeclaration);
    // Phase 3c (module-substrate) — `@codeName` directive override. By default
    // the codeName IS the def name; a `@codeName "x"` directive overrides it for
    // the (rare but real) case where a global codeName must disambiguate from a
    // same-named helper in another module while the fnId keeps the short name
    // (e.g. `payments:listOrEmpty` whose codeName is `listOrEmptyPayments` to
    // avoid colliding with `purchases:listOrEmpty`). Without the directive,
    // codeName === name, so every header-less / undecorated file is unaffected.
    const functionFacetStart = instances.length;
    instances.push({ typeName: "Codeable", args: [id], methods: { codeName } });

    // Phase 3a (module-substrate) — `@facet` directives override / extend the
    // auto-derived identity. A function with no directives behaves EXACTLY as
    // before (humanized Labelable + module-name Categorizable, no other facets)
    // — the migration surface is purely additive over the 143 header-less files.
    liftIdentityFacets(instances, id, ds);
    markFunctionFacetArguments(instances, functionFacetStart, id);
  }

  // Phase 3b (module-substrate) — FOREIGN (native-backed) declarations. A
  // `name : Type` sig carrying an `@native` directive with NO matching def is a
  // function whose implementation is an irreducible host-IO leaf supplied by
  // the module's `nativeImpls` ffi/ leaf (keyed by codeName). Emit a BODYLESS
  // `FenelFunction` (the registry resolves the call to the native; no Fenel
  // body) plus the SAME Codeable + identity facets a Fenel-bodied function
  // gets. A sig WITHOUT `@native` and without a def stays dropped (orphan-sig
  // back-compat over the 143 existing files — only the explicit marker opts in).
  for (const [name, sigDecl] of sigs) {
    if (defs.has(name)) continue;
    const ds = directivesByName.get(name) ?? [];
    if (!ds.some((d) => d.name === "native")) continue;
    const id = `${effectiveName}:${name}`;
    const { params, returns } = signatureFromSig(sameModuleArrow(sigDecl.type, typeBodies));
    // A bodyless native IO leaf has no body to infer effects from — its
    // capability constraint rides an `@requires "ClassId"` directive (Phase 3o).
    const requires = liftRequiresFromDirectives(ds);
    const codeName = ds.find((d) => d.name === "codeName")?.args[0] ?? name;
    const fn: FenelFunction = { id, params, returns, ...(requires ? { requires } : {}) };
    functions.push(fn);
    const authoredSource = sourceTypeSig(effectiveName, name);
    const signatureDeclaration: FunctionSignatureDeclaration = {
      functionId: id,
      declarationName: name,
      codeName,
      scheme: sourceTypeScheme(sigDecl),
      params: params.map(() => authoredSource),
      returns: authoredSource,
    };
    functionSignatureDeclarations.push(signatureDeclaration);
    registerLoadedFunctionSignatureDeclaration(fn, signatureDeclaration);
    const functionFacetStart = instances.length;
    instances.push({ typeName: "Codeable", args: [id], methods: { codeName } });
    liftIdentityFacets(instances, id, ds);
    markFunctionFacetArguments(instances, functionFacetStart, id);
  }

  // Type-defs become entity registrations. The td.name string becomes the
  // entity's `id` — typeclass instances (Codeable / Labelable / …) attach
  // to that id to supply identity facets, same convention as the system
  // entity registry. No `name` field on the entity record itself.
  const entities: NonNullable<FenelModule["entities"]> = [];
  const fieldFacetDirectives: NonNullable<FenelModule["fieldFacetDirectives"]> = [];
  const fieldFacetOwners: Array<{
    declaration: string;
    owner: FieldFacetSourceDirective["owner"];
  }> = [
    ...functionSignatureDeclarations.map((declaration) => ({
      declaration: declaration.declarationName,
      owner: { functionId: declaration.functionId },
    })),
    ...typeDefs.map((declaration) => ({
      declaration: declaration.name,
      owner: { module: effectiveName, entityId: declaration.name },
    })),
  ];
  // Retain selectors for the same field-facet judgment after identity collection.
  for (const { declaration, owner } of fieldFacetOwners) {
    for (const d of directivesByName.get(declaration) ?? []) {
      const path = d.args[0]!;
      const source: FieldFacetSourceDirective["source"] | undefined =
        d.name === "fieldLabel" ? { kind: "label", label: d.args[1]! }
        : d.name === "widget" ? { kind: "widget", widget: d.args[1]! }
        : d.name === "helpText" ? { kind: "helpText", helpText: d.args[1]! }
        : d.name === "fieldReusable" ? { kind: "repositoryReuse" }
        : undefined;
      if (source !== undefined) fieldFacetDirectives.push({
        owner,
        selector: path,
        source,
        provenance: { module: effectiveName, declaration, selector: path },
      });
    }
  }
  // FM-retire-Z — harvested `field: T = expr` method-default channel, keyed by
  // type_def name. The retired `FieldDef.default` slot's replacement: surfaced
  // on the module + threaded into `seedFromType` for class records.
  const methodDefaults: Record<string, Record<string, unknown>> = {};
  // declaration-annotations Phase 1 (Part B) — THE EXPLICIT ENTITY GATE.
  //
  // This used to be a COVERT gate: a type declaration got a lifted `Codeable`
  // — and thereby foundation→`systemEntities` PROMOTION (`hasLiftedCodeable`,
  // system-entities.ts) — iff it happened to carry one of twelve *metadata*
  // facet names (`ENTITY_IDENTITY_FACETS`). Registration identity rode on
  // metadata presence, so writing `@label` on an internal helper type silently
  // promoted it to a system entity, and an entity that wanted no metadata could
  // not be one. The marker is now EXPLICIT:
  //
  //   1. `entities.push` stays UNCONDITIONAL — raw registration semantics are
  //      untouched (this gate never controlled that).
  //   2. `Codeable` is emitted iff `@entity` is present (`@codeName` continues
  //      to set the id when present).
  //   3. Identity facets lift INDEPENDENTLY — metadata without `@entity` stays
  //      metadata; it no longer implies `Codeable` and cannot promote.
  //   4. `@discriminator`-only decls stay identity-inert, exactly as before.
  //
  // `@entity` is transitional syntax: design §5 "@codeName / entity
  // registration / @discriminator — structural syntax" makes registration
  // identity a declaration form, which P6 replaces this marker with.
  for (const td of typeDefs) {
    const ds = directivesByName.get(td.name) ?? [];
    let type = typeDefToFenelType(td);
    const typeDefinitionValueNames = new Set(
      (td.constructors ?? []).flatMap((constructor) =>
        constructor.fields.flatMap((field) => field.name === undefined ? [] : [field.name])
      ),
    );
    // FM-retire-Z — harvest any `field: T = expr` method defaults on this type.
    const harvested = harvestMethodDefaults(td);
    if (harvested) defineLoadedProperty(methodDefaults, td.name, harvested);
    // FM-retire-E1 Step 2 — `codeName` is the REGISTERED system-entity id, which
    // can differ from the type_def name. The parser requires an UPPERCASE
    // type_def head (`Currency`), but ~59 system-entity ids ship lowercase
    // (`currency`) and MUST stay lowercase byte-for-byte (the codeName the
    // frontend holds + resolves via `referenceTypeByCodeName`,
    // `{$named:"currency"}` refs, the `entity_type` column).
    // `@codeName "currency"` carries that lowercase id; it defaults to `td.name`.
    // It keys every lifted facet instance (Codeable / Labelable / per-field
    // Labelable) — symmetric with `defineSystemEntity`, where `id = spec.codeName`
    // is the single dispatch key — and rides on the entity record (`codeName`
    // field below) so the auto-register loop registers the system entity under
    // it. The module-entity `id` itself STAYS the type_def name so
    // `foundationTemplates().entities` keeps its PascalCase keys (the deferred
    // `defineSystemEntity` callers + the load test resolve by that name).
    const codeName = ds.find((d) => d.name === "codeName")?.args[0] ?? td.name;
    for (const d of ds) {
      // FM-retire-E1 Step 3 — `@valueLabel "<value>" "<Label>"` on an
      // `$enum`-refined-String atom: lift each into a per-value Labelable keyed
      // `<id>.<value>`. The renderer, when deriving a select's choices from the
      // atom's `$enum` set, resolves each value's label via this instance with a
      // `humanizeCodeName(value)` fallback (see `enumOptionLabel` in field-meta).
      // Author ONLY the irregular labels humanize can't reproduce (`group` →
      // "Group / Organization"); the rest derive for free. Distinct from
      // `@fieldLabel` (which keys a record/variant FIELD path); a refined atom has
      // no fields, so `<atom>.<value>` never collides with `<entity>.<field>`.
      if (d.name === "valueLabel" && d.args.length >= 2) {
        const value = d.args[0]!;
        const label = d.args[1]!;
        instances.push({ typeName: "Labelable", args: [`${codeName}.${value}`], methods: { label } });
      }
    }
    // FM-retire-E1 Step 7 — thread the type_def HEAD params (`Maybe a` →
    // `["a"]`) onto the entity. The parser records them on `td.params`; the
    // loader used to drop them, so a parametric `.fenel` entity reached the
    // catalog param-less. Bound occurrences now arrive as `$var`, but walking
    // the body would still lose unused parameters and declaration order;
    // carrying the explicit head is the authoritative source. This lets the
    // system-entities auto-register loop register parametric entities (Maybe /
    // Result / Either / LookupResult) with their declared params.
    // Stamp the OWNING module (the effectiveName of the file that DEFINES the
    // type) onto the entity. A module that later PULLS IN another's types (e.g.
    // compile-{js,wasm,llvm} each `loadFenelModule(IR_TYPES_SRC, "engine")`)
    // must not relabel them as its own — `createRegistry` reads `e.module ??
    // mod.name`, so a stamped owner survives the containing-module tag. This is
    // what makes the shared engine IR types surface once, as `engine.<Name>`,
    // instead of triplicated under each compile target.
    entities.push({
      id: td.name,
      type,
      module: effectiveName,
      ...(codeName !== td.name ? { codeName } : {}),
      ...(td.params && td.params.length > 0 ? { params: td.params } : {}),
      ...(td.binding === undefined
        ? {}
        : {
            typeScheme: {
              quantified: td.binding.quantified,
              body: type,
              applications: sourceApplicationsForBoundType(
                type,
                td.binding.quantified,
                [],
                typeDefinitionValueNames,
              ) as TypeScheme["applications"],
              diagnostics: td.binding.diagnostics,
            },
          }),
    });
    // Codeable — the identity signal, now keyed on the EXPLICIT `@entity`
    // marker rather than on "carries any of twelve metadata names".
    if (ds.some((d) => d.name === "entity")) {
      instances.push({ typeName: "Codeable", args: [codeName], methods: { codeName } });
    }
    // Identity facets lift regardless of `@entity`. Each facet is individually
    // presence-gated inside `liftIdentityFacets`, so a directive-less or
    // `@discriminator`-only type_def still emits nothing at all. The only names
    // it reads that were NOT in the old twelve are the `@ioAction` trio, and
    // the policy table admits those on function declarations only — so running
    // it unconditionally cannot resurrect a facet the old gate suppressed.
    liftIdentityFacets(instances, codeName, ds);
  }

  const loaded: FenelModule = {
    name: effectiveName,
    label: Just(opts.label ?? effectiveName),
    functions,
    functionSignatureDeclarations,
    instances,
    entities,
    ...(fieldFacetDirectives.length > 0 ? { fieldFacetDirectives } : {}),
    ...(Object.keys(methodDefaults).length > 0 ? { methodDefaults } : {}),
    ...(fixities.length > 0 ? { fixities } : {}),
    ...(importDecls.length > 0 ? { imports: importDecls } : {}),
  };
  return { module: loaded, heads, selections };
}

// ---------------------------------------------------------------------------
// Phase 3m (module-substrate) — the CROSS-FILE HEADER UNION + dup-name load
// error (OQ3). Multiple `.fenel` files that share a `module M where` header
// UNION into one module's `Name → Ref` namespace; a duplicate top-level name
// (function OR type) within one module = a LOAD-TIME ERROR (Haskell semantics —
// NOT last-wins, NOT silent-merge).
//
// `loadFenelModule` (above) is single-source: one `src` → one `FenelModule`,
// the header overriding the `name` arg. This is the merge point ABOVE it. Each
// source is parsed + loaded INDEPENDENTLY (honouring the "concatenating
// `.fenel` breaks parsing" rule — parse-then-merge, never string-concat), then
// the resulting modules are GROUPED BY their header-driven `.name` (OQ3 — the
// header is identity, not the dir / `name` arg). Same-header files union;
// distinct-header files stay distinct modules. Returns one `FenelModule` per
// header group, in first-seen order.
// ---------------------------------------------------------------------------

type UnionSource = { src: string; name: string; opts?: LoadFenelModuleOptions };
type UnionMember = { file: string; module: FenelModule; heads: DeclarationHead[]; selections: ImportSelection[] };

/**
 * Load several `.fenel` sources and union the ones that share a `module … where`
 * header into one module each. Returns one `FenelModule` per distinct header
 * group, in first-seen order.
 *
 *   loadFenelModuleUnion([
 *     { src: subjectSrc, name: "subject-fallback" },  // module subject where
 *     { src: sessionSrc, name: "session-fallback" },  // module auth where
 *     { src: cookiesSrc, name: "cookies-fallback" },  // module auth where
 *   ])
 *   // → [ { name: "subject", … }, { name: "auth", … (session ∪ cookies) } ]
 *
 * A single-file group passes through verbatim (byte-identical to a lone
 * `loadFenelModule`). A multi-file group unions its members' `functions` /
 * `entities` / `instances` / `imports` / `fixities`; a top-level name colliding
 * across two files of the SAME group throws a precise load-time error
 * (`module <M>: duplicate definition "<name>" in <fileA> and <fileB>`), and so
 * do a named instance or a function code name declared in two files
 * (`DeclarationNameError`, from the declaration-name rules).
 *
 * `labels[name]` overrides a group's module-level label.
 */
export function loadFenelModuleUnion(
  sources: UnionSource[],
  unionOpts: { labels?: Record<string, string> } = {},
): FenelModule[] {
  // 1. Load each source independently (parse-then-merge, never string-concat),
  //    keeping the declaration list each one's name rules judged. A caller that
  //    gives every source the module's name (the engine union) gets the
  //    source's position added to its heads' file, so the two sides of a
  //    cross-file clash stay distinguishable.
  const nameCounts = new Map<string, number>();
  for (const s of sources) nameCounts.set(s.name, (nameCounts.get(s.name) ?? 0) + 1);
  const loaded: UnionMember[] = sources.map((s, i) => {
    const { module: loadedModule, heads, selections } = loadFenelModuleWithHeads(s.src, s.name, s.opts ?? {});
    const file = nameCounts.get(s.name)! > 1 ? `${s.name} (source ${i + 1})` : s.name;
    return {
      file: s.name,
      module: loadedModule,
      heads: file === s.name ? heads : heads.map((h) => ({ ...h, file })),
      selections: file === s.name ? selections : selections.map((sel) => ({ ...sel, file })),
    };
  });

  // 2. Group by the header-driven module name (OQ3 — header is identity, not
  //    the directory / `name` arg). First-seen order is preserved.
  const order: string[] = [];
  const groups = new Map<string, UnionMember[]>();
  for (const entry of loaded) {
    const key = entry.module.name;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(entry);
  }

  // 3. Union each group; single-file groups pass through verbatim.
  return order.map((name) => {
    const members = groups.get(name)!;
    const label = unionOpts.labels?.[name];
    if (members.length === 1) {
      const only = members[0]!.module;
      return label !== undefined ? { ...only, label: Just(label) } : only;
    }
    return unionModuleGroup(name, members, label);
  });
}

/** Merge same-header `FenelModule`s into one, throwing on a cross-file
 *  duplicate top-level name. Functions and types occupy SEPARATE namespaces
 *  (a type `Foo` and a function `foo` do not collide — Haskell), so they are
 *  tracked apart. Within ONE file the sig+def pairing already collated to a
 *  single function per name (`loadFenelModule`'s `defs`/`sigs` maps), so a
 *  duplicate can only ever be a genuine CROSS-file clash — the intentional
 *  sig+def pairing never trips it. */
function unionModuleGroup(
  name: string,
  members: UnionMember[],
  label: string | undefined,
): FenelModule {
  const functions: FenelFunction[] = [];
  const entities: NonNullable<FenelModule["entities"]> = [];
  const instances: Instance[] = [];
  const imports: NonNullable<FenelModule["imports"]> = [];
  const fixities: NonNullable<FenelModule["fixities"]> = [];
  const methodDefaults: Record<string, Record<string, unknown>> = {};
  const fieldFacetDirectives: NonNullable<FenelModule["fieldFacetDirectives"]> = [];
  const functionSignatureDeclarations: FunctionSignatureDeclaration[] = [];
  const fnFile = new Map<string, string>(); // fn id   → defining file
  const tyFile = new Map<string, string>(); // type id → defining file
  // declaration-annotations Phase 1 (Part B) — a SEPARATE namespace. `@codeName`
  // makes the REGISTERED id independent of the declaration id, so the two must
  // be tracked apart: `Original @codeName "Alias"` beside a declaration actually
  // NAMED `Alias` is legal (raw ids {Original, Alias} unique, effective ids
  // {Alias, Other} unique) and folding both into one map falsely rejects it —
  // in whichever order the files load.
  const tyEffectiveFile = new Map<string, string>(); // effective (registered) id → file

  for (const { file, module: memberModule } of members) {
    for (const fn of memberModule.functions ?? []) {
      const prev = fnFile.get(fn.id);
      if (prev !== undefined) {
        const member = fn.id.slice(fn.id.indexOf(":") + 1);
        throw new Error(
          `module ${name}: duplicate definition "${member}" in ${prev} and ${file}`,
        );
      }
      fnFile.set(fn.id, file);
      functions.push(fn);
    }
    for (const ent of memberModule.entities ?? []) {
      const prev = tyFile.get(ent.id);
      if (prev !== undefined) {
        throw new Error(
          `module ${name}: duplicate definition "${ent.id}" in ${prev} and ${file}`,
        );
      }
      tyFile.set(ent.id, file);
      // declaration-annotations Phase 1 (Part B) — EFFECTIVE registration id
      // uniqueness across the union, tracked in its OWN namespace.
      //
      // `@codeName` lets a type register under an id that is not its declaration
      // name, so `Unmarked` in one file and `Marked @codeName "Unmarked"` in a
      // sibling file of the SAME module both register as "Unmarked" while their
      // `ent.id`s differ — and promotion (`hasLiftedCodeable`, system-entities.ts)
      // matches that id STRING globally, so the marked one's `@entity` can promote
      // the unmarked one. `validateDirectives` catches this within a single
      // source; this is the same invariant at the cross-file union boundary.
      //
      // The two namespaces must NOT share a map. Declaration ids and registered
      // ids are independent, so `Original @codeName "Alias"` beside a
      // declaration literally named `Alias` is legal — raw {Original, Alias} and
      // effective {Alias, Other} are each internally unique. Recording effective
      // ids into `tyFile` made that pair a false duplicate (and, worse, an
      // order-DEPENDENT one: it surfaced as a raw-duplicate error in one file
      // order and an effective-collision error in the other).
      //
      // Every effective id is recorded, including when it equals `ent.id` — the
      // default codeName IS the registration id, so an undecorated declaration
      // must still be able to collide with a later `@codeName` that names it.
      const effectiveId = (ent as { codeName?: string }).codeName ?? ent.id;
      const prevEffective = tyEffectiveFile.get(effectiveId);
      if (prevEffective !== undefined) {
        throw new Error(
          `module ${name}: type "${ent.id}" in ${file} registers under the effective `
          + `codeName "${effectiveId}", which is already registered by ${prevEffective}. `
          + `Registration identity must be unique — a collision lets one declaration's `
          + `@entity promote another.`,
        );
      }
      tyEffectiveFile.set(effectiveId, file);
      entities.push(ent);
    }
    instances.push(...(memberModule.instances ?? []));
    functionSignatureDeclarations.push(...(memberModule.functionSignatureDeclarations ?? []));
    fieldFacetDirectives.push(...(memberModule.fieldFacetDirectives ?? []));
    if (memberModule.imports) imports.push(...memberModule.imports);
    if (memberModule.fixities) fixities.push(...memberModule.fixities);
    for (const [key, value] of Object.entries(memberModule.methodDefaults ?? {})) {
      defineLoadedProperty(methodDefaults, key, value);
    }
  }

  // modules-as-values Phase 3a — the declaration-name rules across the files.
  // Each file passed them alone; the id checks above keep their messages for
  // the clashes they already caught. What only this sees: a named instance in
  // an instance file (it has no function id) and two functions registered
  // under one effective code name.
  // A file-top selection applies to every file of the module, so two files
  // selecting one name from two sources conflict (Phase 5c-1a).
  const clashes = [
    ...declarationGroupClashes(members.flatMap((m) => m.heads)),
    ...declarationSelectionConflicts(members.flatMap((m) => m.selections)),
  ];
  if (clashes.length > 0) throw new DeclarationNameError(name, clashes);

  return {
    name,
    label: Just(label ?? name),
    functions,
    functionSignatureDeclarations,
    entities,
    instances,
    ...(Object.keys(methodDefaults).length > 0 ? { methodDefaults } : {}),
    ...(fieldFacetDirectives.length > 0 ? { fieldFacetDirectives } : {}),
    ...(fixities.length > 0 ? { fixities } : {}),
    ...(imports.length > 0 ? { imports } : {}),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a source into its top-level declarations, in source order. */
function parseDeclarations(src: string, moduleName: string, opts: LoadFenelModuleOptions): Decl[] {
  // parser-substrate Phase 5c — the warm-boot seam. `parsedViaCache` returns a
  // cached pre-parsed AST (when present + enabled) or falls through to the live
  // parser; the result is byte-identical to `parse(src, opts.locale)`. The 5d
  // parser flip swaps the live-parser fallback INSIDE `parse-cache.ts`, leaving
  // this call untouched.
  //
  // module-substrate M1 — the parse is bracketed by the module-load latch. A
  // module-scope `loadFenelModule` that MISSES the cache drives the live Fenel
  // parser, which needs the interpreted harness, which needs the very module
  // graph this call is part of. `getHarness` consults the latch to refuse that
  // re-entry BEFORE it host-requires an in-flight module (which used to leave
  // the graph half-evaluated and crash an unrelated consumer later). try/finally
  // is load-bearing: an unbalanced exit would fence the engine onto the
  // TypeScript parser for the rest of the process.
  const ast = ((): ReturnType<typeof parsedViaCache> => {
    enterFenelModuleLoad(moduleName);
    try {
      return opts.bootstrapParser === "typescript"
        ? parseFenelTypeScript(src, opts.locale)
        : parsedViaCache(src, opts.locale);
    } finally {
      exitFenelModuleLoad();
    }
  })();
  return flattenProgram(ast);
}

/** The declaration list the name rules judge: one head per top-level
 *  declaration, in source order. A head's `codeName` is set exactly when the
 *  code below registers a function for it — a named definition that is not an
 *  instance-file value, or an `@native` signature without a definition — using
 *  the same by-name directive merge and the same `@codeName` default. */
function declarationHeads(
  decls: readonly Decl[],
  file: string,
  opts: LoadFenelModuleOptions,
): DeclarationHead[] {
  const directives = new Map<string, FacetDirective[]>();
  const sigTypes = new Map<string, unknown>();
  const defNames = new Set<string>();
  const merge = (name: string, ds: FacetDirective[] | undefined): void => {
    directives.set(name, [...(directives.get(name) ?? []), ...(ds ?? [])]);
  };
  for (const d of decls) {
    if (isTypeSig(d) && d.type_sig.name !== UNNAMED) {
      merge(d.type_sig.name, d.type_sig.directives);
      sigTypes.set(d.type_sig.name, d.type_sig.type);
    } else if (isDef(d) && d.def.name !== UNNAMED) {
      merge(d.def.name, d.def.directives);
      defNames.add(d.def.name);
    }
  }
  const codeNameOf = (name: string): Maybe<string> =>
    Just(directives.get(name)?.find((x) => x.name === "codeName")?.args[0] ?? name);
  const nameOf = (name: string): Maybe<string> => (name === UNNAMED ? Nothing : Just(name));
  const head = (index: number, form: DeclarationForm["$tag"], name: Maybe<string>): DeclarationHead => ({
    $tag: "DeclarationHead",
    form: { $tag: form } as DeclarationForm,
    name,
    codeName: Nothing,
    file,
    index,
    hasParams: false,
    hasDirectives: false,
    typeHead: Nothing,
    bodyHead: Nothing,
  });

  return decls.map((d, index): DeclarationHead => {
    if (isTypeSig(d)) {
      const { name, type } = d.type_sig;
      const native = name !== UNNAMED && !defNames.has(name)
        && (directives.get(name) ?? []).some((x) => x.name === "native");
      const app = matchTypeApplication(type);
      return {
        ...head(index, "SignatureForm", nameOf(name)),
        codeName: native ? codeNameOf(name) : Nothing,
        hasDirectives: (d.type_sig.directives ?? []).length > 0,
        typeHead: app === null ? Nothing : Just(app.typeName),
      };
    }
    if (isDef(d)) {
      const { name, params, body } = d.def;
      const instanceOnly = opts.dispatchInstanceFile === true && params.length === 0
        && recognizeTypedValue(sigTypes.get(name), body) !== null;
      const ctor = constructHead(body);
      return {
        ...head(index, "DefinitionForm", nameOf(name)),
        codeName: name !== UNNAMED && !instanceOnly ? codeNameOf(name) : Nothing,
        hasParams: params.length > 0,
        hasDirectives: (d.def.directives ?? []).length > 0,
        bodyHead: ctor !== null && extractConstructorRecord(body, ctor) !== null ? Just(ctor) : Nothing,
      };
    }
    if (isTypeDef(d)) {
      return {
        ...head(index, "TypeForm", Just(d.type_def.name)),
        hasDirectives: (d.type_def.directives ?? []).length > 0,
      };
    }
    return head(index, "OtherForm", Nothing);
  });
}

/** The file-top selections of one source, in source order: one per name of
 *  each selective import frame (`using M (a, b)` / `import M (a, b)`). */
function importSelections(decls: readonly Decl[], file: string): ImportSelection[] {
  const out: ImportSelection[] = [];
  decls.forEach((d, index) => {
    if (!isImportDecl(d)) return;
    for (const name of d.import_decl.names ?? []) {
      out.push({ $tag: "ImportSelection", name, source: d.import_decl.module, file, index });
    }
  });
  return out;
}

function flattenProgram(ast: unknown): Decl[] {
  if (ast == null) return [];
  if (typeof ast === "object" && "program" in (ast as object)) {
    const items = (ast as { program: unknown[] }).program;
    // field-identity Phase 4 (D6) — defense-in-depth twin of the parser-level
    // reject (a `{program:…}` can still arrive from a pre-D6 parse-cache entry
    // or a hand-built AST): a top-level item that is not a declaration was,
    // until Phase 4, silently DROPPED here — the silent-wrong-code half of the
    // stabilization's layout-hazard class (a stray application argument
    // vanished while its callee stayed a partial). Reject loudly instead.
    const stray = items.findIndex((it) =>
      !(isDef(it) || isTypeSig(it) || isTypeDef(it) || isFixity(it) ||
        isModuleDecl(it) || isImportDecl(it)),
    );
    if (stray >= 0) {
      throw new Error(
        `loadFenelModule: stray top-level expression statement (program item ${stray} is not a ` +
        `declaration) — a module's top level admits only declarations`,
      );
    }
    return items as Decl[];
  }
  // Single declaration unwrapped, or a bare expression we ignore.
  if (
    isDef(ast) || isTypeSig(ast) || isTypeDef(ast) || isFixity(ast) ||
    isModuleDecl(ast) || isImportDecl(ast)
  ) return [ast as Decl];
  return [];
}

type LoadedSignaturePieces = {
  params: FieldDef[];
  returns: FenelType;
  paramDeclarations: SlotDeclaration[];
  returnDeclaration: SlotDeclaration;
};

function sourceTypeSig(
  moduleName: string,
  declaration: string,
): Extract<SlotDeclaration, { readonly $tag: "Authored" }> {
  return {
    $tag: "Authored",
    source: { $tag: "SourceTypeSig", module: moduleName, declaration },
  };
}

function absentCompatibilityType(
  functionId: string,
  slot: string,
): FenelType {
  // FenelFunction's compatibility shape still requires a ground-type slot at
  // loader output. Give every absent obligation a distinct, deterministic
  // spelling so even a raw/debug consumer cannot accidentally couple two
  // missing slots as the former shared `$var: "a"` did. The adjacent
  // SlotDeclaration, not this spelling, is authoritative.
  return { $var: `__absent__${functionId}__${slot}` };
}

function sourceTypeScheme(sig: TypeSigAST["type_sig"]): TypeScheme {
  if (sig.scheme === undefined) {
    throw new TypeError(
      "loadFenelModule: source type signature is missing its authoritative parser scheme sidecar",
    );
  }
  return sig.scheme;
}

/** Build params + returns for a function. If a type sig is provided, use
 *  it; otherwise record independent Absent obligations and place unique,
 *  non-authoritative holes in the compatibility FenelFunction projection.
 *
 *  Walks curried arrow layers, pairing each layer's params with the def's
 *  param names in order. `f : A -> B -> C -> D` with `f x y z = ...` peels
 *  three arrow layers (one name per layer); `f : (A, B) -> C` with
 *  `f x y = ...` consumes both names from a single arrow's param list.
 *  Mixed forms like `(A, B) -> C -> D` work transparently. Param names
 *  with no signature data (def has more params than sig has arrow layers)
 *  receive distinct non-authoritative compatibility holes; the cursor at the
 *  end becomes `returns`. */
/** Compatibility arrow for a same-file name.
 *
 * `Recipe = (Pantry -> List Ingredients) | if true then true else true` is a
 * refinement, not a synonym. A signature written `: Recipe` is a `$ref`.
 * Walk that ref, then a refinement base, and return the arrow when one is
 * reached. A name whose base is not an arrow (an email refinement of String)
 * returns the original signature. The authored scheme is left untouched. */
function sameModuleArrow(sig: unknown, byName: ReadonlyMap<string, unknown>): unknown {
  if (!sig || typeof sig !== "object") return sig;
  const seen = new Set<unknown>();
  let current: unknown = sig;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if ("$arrow" in current) return current;
    if ("$refined" in current) {
      current = (current as { $refined?: { base?: unknown } }).$refined?.base;
      continue;
    }
    if ("$ref" in current) {
      const name = (current as { $ref?: unknown }).$ref;
      if (typeof name !== "string") return sig;
      const dot = name.lastIndexOf(".");
      const colon = name.lastIndexOf(":");
      const cut = Math.max(dot, colon);
      const local = cut >= 0 ? name.slice(cut + 1) : name;
      const defined = byName.get(local) ?? byName.get(name);
      if (defined === undefined) return sig;
      current = defined;
      continue;
    }
    return sig;
  }
  return sig;
}

function signatureForDef(
  functionId: string,
  paramNames: string[],
  sig: unknown,
): LoadedSignaturePieces {
  const separator = functionId.indexOf(":");
  const source = sourceTypeSig(
    separator < 0 ? "" : functionId.slice(0, separator),
    separator < 0 ? functionId : functionId.slice(separator + 1),
  );
  if (!sig || typeof sig !== "object") {
    return {
      params: paramNames.map((nm, index) => ({
        name: nm,
        label: Nothing,
        type: absentCompatibilityType(functionId, `param-${index}`),
        meta: {},
        ui: Nothing,
      })),
      returns: absentCompatibilityType(functionId, "return"),
      paramDeclarations: paramNames.map(() => ({ $tag: "Absent" })),
      returnDeclaration: { $tag: "Absent" },
    };
  }
  if (!("$arrow" in (sig as object))) {
    return {
      params: paramNames.map((nm, index) => ({
        name: nm,
        label: Nothing,
        type: absentCompatibilityType(functionId, `param-${index}`),
        meta: {},
        ui: Nothing,
      })),
      returns: sig as FenelType,
      paramDeclarations: paramNames.map(() => ({ $tag: "Absent" })),
      returnDeclaration: source,
    };
  }

  const params: FieldDef[] = [];
  const paramDeclarations: SlotDeclaration[] = [];
  let cursor: FenelType = sig as FenelType;
  let nameIdx = 0;

  while (
    nameIdx < paramNames.length &&
    cursor &&
    typeof cursor === "object" &&
    "$arrow" in (cursor as object)
  ) {
    const arrow = (cursor as { $arrow: { params: Array<{ name?: string; type: FenelType }>; returns: FenelType } }).$arrow;
    for (let i = 0; i < arrow.params.length && nameIdx < paramNames.length; i++) {
      params.push({ name: paramNames[nameIdx]!, label: Nothing, type: arrow.params[i]!.type, meta: {}, ui: Nothing });
      paramDeclarations.push(source);
      nameIdx++;
    }
    cursor = arrow.returns;
  }

  while (nameIdx < paramNames.length) {
    params.push({
      name: paramNames[nameIdx]!,
      label: Nothing,
      type: absentCompatibilityType(functionId, `param-${nameIdx}`),
      meta: {},
      ui: Nothing,
    });
    paramDeclarations.push({ $tag: "Absent" });
    nameIdx++;
  }

  return {
    params,
    returns: cursor,
    paramDeclarations,
    returnDeclaration: source,
  };
}

/** Phase 3b (module-substrate) — build params + returns for a FOREIGN
 *  declaration directly from its `name : Type` sig (no def supplies param
 *  names). Walks curried arrow layers, taking each arrow param's `name` (from
 *  the `(iso: String) -> …` named-param syntax) or synthesising `_<i>` for the
 *  bare `String -> …` form. A non-arrow sig (`now : Timestamp`) yields zero
 *  params + the sig as the return type. Sister of `signatureForDef`, which
 *  pairs a def's param names against the arrow layers; here the names ride on
 *  the sig itself. */
function signatureFromSig(sig: unknown): { params: FieldDef[]; returns: FenelType } {
  if (sig === null || sig === undefined || typeof sig !== "object") {
    throw new TypeError("foreign declaration has a malformed or absent signature type");
  }
  if (!("$arrow" in sig)) {
    return { params: [], returns: sig as FenelType };
  }
  const params: FieldDef[] = [];
  let cursor: FenelType = sig as FenelType;
  while (cursor && typeof cursor === "object" && "$arrow" in (cursor as object)) {
    const arrow = (cursor as {
      $arrow: {
        params: Array<{
          name?: string;
          key?: FieldDef["key"];
          type: FenelType;
        }>;
        returns: FenelType;
      };
    }).$arrow;
    for (const p of arrow.params) {
      const index = params.length;
      const key =
        p.key?.$tag === "PositionalField"
          ? ({ $tag: "PositionalField", index } as const)
          : p.key;
      params.push({
        name: key?.$tag === "PositionalField" ? `_${index}` : (p.name ?? `_${index}`),
        ...(key === undefined ? {} : { key }),
        label: Nothing,
        type: p.type,
        meta: {},
        ui: Nothing,
      });
    }
    cursor = arrow.returns;
  }
  return { params, returns: cursor };
}

function requiredTypeDefFieldType(
  field: { type?: unknown },
  typeName: string,
  constructorName: string,
  index: number,
): FenelType {
  if (field.type === undefined || field.type === null || typeof field.type !== "object") {
    throw new TypeError(
      `${typeName}.${constructorName} field ${index} has no well-formed type`,
    );
  }
  return field.type as FenelType;
}

// ---------------------------------------------------------------------------
// FM-retire-11 (L1) — post-parse scope-resolution pass
//
// The parser strips the `{var}` wrapper off a lowercase application head
// (fenel-parser.ts ~1606: `f x` → `{call:["f", …]}` with a BARE-STRING head,
// never `{call:[{var:"f"}, …]}`). For a pure-Fenel body that APPLIES a
// function-typed LOCAL (a param / lambda-param / let / match-bound name —
// `($) f x = f x`, `(.) f g = \x -> f (g x)`, `bindResult r f = … f _x`), that
// bare-string head must resolve to the captured local, not the flat global
// registry. The interpreter handled this dynamically (the 9c `callOp` band-aid:
// rewrite the head to `{var}` when it names a key in the runtime env); the
// self-host compiler's chokepoint `normalise-to-core:resolveCallee` lowers a
// bare-string head as a GLOBAL `$fenel.f` → `$fenel.f is not a function`.
//
// This pass closes the gap at the SOURCE: a single post-parse walk over every
// loaded body that rewrites a local-applying head `{call:["f", …]}` →
// `{call:[{var:"f"}, …]}` IFF `f` resolves to an in-scope binder. Every
// downstream consumer (interpreter / 3 compilers / printer) then sees the
// working `{var}`-head shape; `.`/`$` self-host losslessly (identical core IR —
// `{var}`→`$dyn:` via resolveCallee); and the `callOp` band-aid is retired.
// Blast radius is surgical (measured: 1 local-applying head across 5390 call
// sites pre-port; 3 post-port — `.`/`$`/bindResult); the 5389 global heads are
// correctly left as bare strings. Rule recap (the whole risk surface): rewrite
// ONLY a string head that is in the binder set at that point; innermost
// shadowing wins (fresh child binder set per scope); args walk recursively but
// only the head position is rewritten; a head already `{var}` is left
// (idempotent).
// ---------------------------------------------------------------------------

function extendBinders(binders: ReadonlySet<string>, names: string[]): Set<string> {
  const s = new Set(binders);
  for (const n of names) s.add(n);
  return s;
}

/** Collect the names a match pattern binds (recursively). The parser emits
 *  `{$bind: name}` for a lowercase pattern ident, `{$tag: C, _0: <pat>, …}` for
 *  a constructor pattern (recurse into the field patterns), `"_"` for wildcard,
 *  and literals for literal patterns. A bare `{var: name}` is also treated as a
 *  binder (defensive — the brief's full pattern surface). A `{$guard: […]}`
 *  wrapper is unwrapped by the caller (rewriteMatchArgs) before this runs. */
function collectPatternBinders(pattern: unknown, acc: Set<string>): void {
  if (pattern === null || typeof pattern !== "object") return;
  if (Array.isArray(pattern)) { for (const p of pattern) collectPatternBinders(p, acc); return; }
  const obj = pattern as Record<string, unknown>;
  if (typeof obj.$bind === "string") { acc.add(obj.$bind); return; }
  if (typeof obj.var === "string") { acc.add(obj.var); return; }
  for (const [k, v] of Object.entries(obj)) {
    if (k === "$tag") continue; // the constructor name, not a binder
    collectPatternBinders(v, acc); // field patterns (_0, named, nested ctors)
  }
}

/** Rewrite a `{call:[head, …args]}` arg list: rewrite the head to `{var}` iff
 *  it is a bare string naming an in-scope binder; recurse into an object head
 *  (already `{var}`, or a computed head) and every arg under the same binders.
 *  Only the head position is head-rewritten.
 *
 *  modules-as-values Phase 5a — a DOTTED head is judged by its FIRST segment:
 *  `state.error x` with a local `state` is field access on the local
 *  (`{var:"state.error"}`, the same reading as in value position), never the
 *  `state` bundle's member (design/module-system.md §3, "Local bindings
 *  shadow bundles"). An unbound first segment leaves the head a
 *  bundle-qualified string. */
function rewriteCallArgs(callArr: unknown, binders: ReadonlySet<string>): unknown[] {
  if (!Array.isArray(callArr) || callArr.length === 0) return callArr as unknown[];
  const head = callArr[0];
  const rewrittenHead =
    typeof head === "string"
      ? (binders.has(localHeadRoot(head)) ? { var: head } : head)
      : resolveLocalHeads(head, binders);
  return [rewrittenHead, ...callArr.slice(1).map((a) => resolveLocalHeads(a, binders))];
}

/** The binder a string call head reads: the whole head, or the segment before
 *  its first `.` (`state.error.inner` → `state`). */
function localHeadRoot(head: string): string {
  const dot = head.indexOf(".");
  return dot <= 0 ? head : head.slice(0, dot);
}

/** Rewrite a `{fn: …}` lambda — both the paren-list `[[p…], body]` and the flat
 *  `[p1, …, body]` shapes (the parser emits the flat form; the runtime + the
 *  self-host compiler accept both). Params extend the binder set over the body. */
function rewriteFn(fnArr: unknown, binders: ReadonlySet<string>): unknown {
  if (!Array.isArray(fnArr) || fnArr.length === 0) return fnArr;
  // type-substrate P1(a.13) review round 4 (Codex): the ARITY guard, mirroring
  // `fnOp`. The canonical form always carries TWO elements, so a single-element
  // `{fn:[X]}` is the FLAT form and `X` is the BODY — including when `X` is a
  // LIST, which is exactly what the parser emits for `\ -> [...]`. Without the
  // guard this arm read that body as a parameter vector and never rewrote its
  // local call heads: `outer f = \ -> [f 1]` loaded as `{fn:[[{call:["f",1]}]]}`
  // and applied to `[null]` instead of `[2]`.
  if (fnArr.length >= 2 && Array.isArray(fnArr[0])) {
    const params = (fnArr[0] as unknown[]).filter((p): p is string => typeof p === "string");
    const child = extendBinders(binders, params);
    const out = fnArr.slice();
    if (fnArr.length >= 2) out[1] = resolveLocalHeads(fnArr[1], child);
    return out;
  }
  // Flat form: last element is the body, everything before is a param name.
  const params = fnArr.slice(0, -1).filter((p): p is string => typeof p === "string");
  const child = extendBinders(binders, params);
  const out = fnArr.slice(0, -1);
  out.push(resolveLocalHeads(fnArr[fnArr.length - 1], child));
  return out;
}

/** Rewrite a `{match:[scrut, pat1, body1, …]}` (flat alternating). The scrutinee
 *  walks under the outer binders; each arm's pattern-binds extend the binder set
 *  over THAT arm's body (and its `$guard` expr) only; a trailing odd remainder
 *  is the default body (evaluator's args[i] fallthrough). Patterns carry no call
 *  heads, so they pass through unchanged. */
function rewriteMatchArgs(matchArr: unknown, binders: ReadonlySet<string>): unknown[] {
  if (!Array.isArray(matchArr) || matchArr.length === 0) return matchArr as unknown[];
  const out: unknown[] = [resolveLocalHeads(matchArr[0], binders)];
  let i = 1;
  for (; i + 1 < matchArr.length; i += 2) {
    const pat = matchArr[i];
    if (pat && typeof pat === "object" && !Array.isArray(pat) && "$guard" in (pat as object)) {
      const g = (pat as { $guard: unknown[] }).$guard;
      const arm = new Set(binders);
      collectPatternBinders(g[0], arm);
      out.push({ $guard: [g[0], resolveLocalHeads(g[1], arm)] });
      out.push(resolveLocalHeads(matchArr[i + 1], arm));
      continue;
    }
    const arm = new Set(binders);
    collectPatternBinders(pat, arm);
    out.push(pat);
    out.push(resolveLocalHeads(matchArr[i + 1], arm));
  }
  if (i < matchArr.length) out.push(resolveLocalHeads(matchArr[i], binders));
  return out;
}

/** Rewrite an object-keyed `let` binding record sequentially: each value walks
 *  under the binders accumulated so far (a later binding sees the earlier ones),
 *  matching the evaluator's `localData` accumulation. Returns the rewritten
 *  record + the binder set extended with every bound name (so an enclosing `do`
 *  can carry the bindings to subsequent statements). */
function rewriteLetBindings(
  letObj: unknown,
  binders: ReadonlySet<string>,
): { bindings: unknown; binders: Set<string> } {
  if (!letObj || typeof letObj !== "object" || Array.isArray(letObj)) {
    return { bindings: letObj, binders: new Set(binders) };
  }
  let cur = new Set(binders);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(letObj as Record<string, unknown>)) {
    defineLoadedProperty(out, k, resolveLocalHeads(v, cur));
    cur = new Set(cur).add(k);
  }
  return { bindings: out, binders: cur };
}

/** Rewrite a `{do:[…]}` sequence, threading let-bound names to later statements
 *  (the evaluator's `do` binds each `{let:{…}}` item's names into the local env
 *  for subsequent items). */
function rewriteDo(items: unknown, binders: ReadonlySet<string>): unknown[] {
  if (!Array.isArray(items)) return items as unknown[];
  let cur = new Set(binders);
  return items.map((item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const keys = Object.keys(item as object);
      if (keys.length === 1 && keys[0] === "let") {
        const r = rewriteLetBindings((item as { let: unknown }).let, cur);
        cur = r.binders;
        return { let: r.bindings };
      }
    }
    return resolveLocalHeads(item, cur);
  });
}

/** Rewrite a `{where:[body, bindings]}`. The binding names are mutually
 *  recursive (Haskell `where`) and scope over both the body and each other, so
 *  every binding value + the body walk under the binders extended with all
 *  binding keys. */
function rewriteWhere(whereArr: unknown, binders: ReadonlySet<string>): unknown[] {
  if (!Array.isArray(whereArr) || whereArr.length < 2) {
    return Array.isArray(whereArr)
      ? whereArr.map((n) => resolveLocalHeads(n, binders))
      : (whereArr as unknown[]);
  }
  const bindingsObj = whereArr[1];
  const child = new Set(binders);
  if (bindingsObj && typeof bindingsObj === "object" && !Array.isArray(bindingsObj)) {
    for (const k of Object.keys(bindingsObj as object)) child.add(k);
  }
  const body = resolveLocalHeads(whereArr[0], child);
  let newBindings: unknown = bindingsObj;
  if (bindingsObj && typeof bindingsObj === "object" && !Array.isArray(bindingsObj)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(bindingsObj as Record<string, unknown>)) {
      defineLoadedProperty(out, k, resolveLocalHeads(v, child));
    }
    newBindings = out;
  }
  return [body, newBindings];
}

/** The L1 walker — recurse over a body expression, rewriting local-applying
 *  call heads to `{var}`. Binder-introducing forms (`fn` / `match` / `let` /
 *  `do` / `where`) extend a fresh child binder set over their scoped sub-trees;
 *  everything else recurses generically under the same set. */
function resolveLocalHeads(node: unknown, binders: ReadonlySet<string>): unknown {
  if (Array.isArray(node)) return node.map((n) => resolveLocalHeads(n, binders));
  if (!node || typeof node !== "object") return node;
  const obj = node as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 1) {
    const k = keys[0]!;
    switch (k) {
      case "var": return node; // a reference leaf (string payload) — nothing to rewrite
      case "call": return { call: rewriteCallArgs(obj.call, binders) };
      case "fn": return { fn: rewriteFn(obj.fn, binders) };
      case "match": return { match: rewriteMatchArgs(obj.match, binders) };
      case "let": return { let: rewriteLetBindings(obj.let, binders).bindings };
      case "do": return { do: rewriteDo(obj.do, binders) };
      case "where": return { where: rewriteWhere(obj.where, binders) };
    }
  }
  const out: Record<string, unknown> = {};
  for (const [kk, vv] of Object.entries(obj)) defineLoadedProperty(out, kk, resolveLocalHeads(vv, binders));
  return out;
}

/** L1 entry point — rewrite a loaded body's local-applying call heads to `{var}`
 *  heads, seeding the binder set with the function's param names. Exported for
 *  the FM-retire-11 unit tests (the binder/shadowing regression pins). */
export function resolveLocalCallHeads(body: unknown, paramNames: string[]): unknown {
  return resolveLocalHeads(body, new Set(paramNames));
}

/** Lift the `@facet` directives a function decl carries into identity-facet
 *  `Instance`s keyed by the function's id — the `.fenel` analogue of a TS
 *  `defineFunction`'s identity record. Shared (Phase 3b) by the Fenel-bodied
 *  path AND the foreign-declaration (`@native`) path so both emit identical
 *  facets. `firstArg("x")` reads `@x "value"`; `allArgs("x")` reads
 *  `@x "a" "b" …`. Phase 3j (identity-as-fallback): EVERY facet — Labelable and
 *  Categorizable included — emits an instance ONLY when its directive is present,
 *  exactly matching `defineFunction`, which omits the instance for any unset
 *  field. The humanized-codeName / module-name defaults that used to be stamped
 *  unconditionally now live at READ time in `displayLabel` / `displayCategory`.
 *  The structural `@native` marker is not a facet and is ignored here. */
// Phase 3o (module-substrate) — lift `@requires "ClassId"` directives into a
// function's `requires: Constraint[]`. Each arg is a spec-entity id (e.g.
// "HasTelegramBot" / "HasStateIO"); one Constraint per arg, scope-parameterised
// `{$var:"scope"}` (the universal effect-row variable the audit + dispatch
// already use). Returns undefined when no `@requires` directive is present so
// every undecorated file is byte-unaffected. Primarily for BODYLESS `@native`
// IO leaves (no body → effects can't be inferred — they must be declared).
function liftRequiresFromDirectives(ds: FacetDirective[]): Constraint[] | undefined {
  const entityIds = ds.filter((d) => d.name === "requires").flatMap((d) => d.args);
  if (entityIds.length === 0) return undefined;
  return entityIds.map((entityId) => ({
    class: { $tag: "Id" as const, entityId },
    args: [{ $var: "scope" } as unknown as TypeExpr],
  }));
}

/** B3 provenance for facets emitted beside one actual function definition.
 * Entity/type facets use the same lifting helper without this marker. */
function markFunctionFacetArguments(instances: Instance[], start: number, functionId: string): void {
  const references = Object.freeze([functionId]);
  for (let index = start; index < instances.length; index += 1) Object.defineProperty(instances[index]!, "sourceArgumentFunctionIds", {
    value: references, enumerable: false, writable: false, configurable: false,
  });
}

function liftIdentityFacets(
  instances: Instance[],
  id: string,
  ds: FacetDirective[],
): void {
  const firstArg = (n: string): string | undefined => ds.find((d) => d.name === n)?.args[0];
  // declaration-annotations Phase 1 (A.3) — ACCUMULATING multiplicity. `@tags`
  // and `@requires` concatenate their arguments across occurrences, in source
  // order. This used to read only the FIRST occurrence (`ds.find`), so a second
  // `@tags` line was silently dropped — the same fail-open defect the load gate
  // now closes for scalars. (`liftRequiresFromDirectives` already accumulated;
  // this brings `@tags` onto the same declared policy. No corpus declaration
  // repeats `@tags` today, so the emitted instances are unchanged.)
  const allArgs = (n: string): string[] | undefined => {
    const matched = ds.filter((x) => x.name === n);
    return matched.length > 0 ? matched.flatMap((d) => d.args) : undefined;
  };
  // Labelable — Phase 3j (identity-as-fallback): emit ONLY when `@label` is
  // present. The loader used to stamp a humanized-codeName default
  // UNCONDITIONALLY — storing a DERIVED display name as if it were authored
  // data (the anti-pattern this workstream collapses: a precomputed fallback
  // masquerading as an instance). The default now lives at READ time, in the
  // `displayLabel` fallback (`getLabel id ?? humanizeCodeName (getCodeName id)
  // ?? id`, fenel/modules/engine/identifiable.fenel). This makes the `.fenel`
  // loader SYMMETRIC with `defineFunction` (function-builder.ts:128 — Labelable
  // only `if (identity.label !== undefined)`). Per-account / per-locusView
  // overrides still shadow it downstream.
  const label = firstArg("label");
  if (label !== undefined) {
    instances.push({ typeName: "Labelable", args: [id], methods: { label } });
  }
  // Categorizable — Phase 3j: emit ONLY when `@category` is present. The
  // module-name default moves to the read-time `displayCategory` fallback
  // (`getCategory id ?? the id's module prefix ?? "uncategorized"`). Law-NEUTRAL
  // (Categorizable carries no `*NonEmpty` law field, so the audit count is
  // unaffected) but removes another stored derivable — symmetric with
  // `defineFunction` (function-builder.ts:138 — Categorizable only when set).
  const category = firstArg("category");
  if (category !== undefined) {
    instances.push({ typeName: "Categorizable", args: [id], methods: { category } });
  }
  const description = firstArg("description");
  if (description !== undefined) {
    instances.push({ typeName: "Describable", args: [id], methods: { description } });
  }
  const tags = allArgs("tags");
  if (tags !== undefined && tags.length > 0) {
    instances.push({ typeName: "Taggable", args: [id], methods: { tags } });
  }
  const icon = firstArg("icon");
  if (icon !== undefined) {
    instances.push({ typeName: "Iconable", args: [id], methods: { icon } });
  }
  const emoji = firstArg("emoji");
  if (emoji !== undefined) {
    instances.push({ typeName: "Emojiable", args: [id], methods: { emoji } });
  }
  const ioAction = firstArg("ioAction");
  const stopAction = firstArg("stopAction");
  const listInstancesAction = firstArg("listInstancesAction");
  if (ioAction !== undefined || stopAction !== undefined || listInstancesAction !== undefined) {
    const methods: Record<string, unknown> = {};
    if (ioAction !== undefined) methods.ioAction = ioAction;
    if (stopAction !== undefined) methods.stopAction = stopAction;
    if (listInstancesAction !== undefined) methods.listInstancesAction = listInstancesAction;
    instances.push({ typeName: "IOInvokable", args: [id], methods });
  }
}

/**
 * Turn a camelCase / snake_case codeName into a human label.
 *   "runTelegramCollector" → "Run Telegram Collector"
 *   "send_message_text"    → "Send Message Text"
 *   "URL"                  → "URL"
 *
 * Used as the default Labelable for `.fenel`-source functions when
 * the source doesn't declare one explicitly. Per-account / per-card
 * overrides shadow this; the derivation is just a discoverable
 * default.
 */
export function humanizeCodeName(name: string): string {
  if (!name) return name;
  // Insert spaces at camelCase boundaries: lowercase→uppercase,
  // uppercase→uppercase-followed-by-lowercase (handles "URLPath" → "URL Path").
  const spaced = name
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/_+/g, " ")
    .replace(/-+/g, " ");
  // Title-case each word but leave all-caps words alone (URL stays URL).
  return spaced
    .split(" ")
    .filter((w) => w.length > 0)
    .map((w) => (w === w.toUpperCase() ? w : w[0]!.toUpperCase() + w.slice(1)))
    .join(" ");
}

/** Convert a type_def AST to a FenelType.
 *
 *  Auto-named positional fields (`_0`, `_1`, …) are the parser's encoding for
 *  positional payloads — they aren't user-chosen names. Single-constructor
 *  types collapse to a `$record` only when ALL fields are explicitly named
 *  (i.e., not auto-positional); otherwise they stay as a single-case `$variant`
 *  so callers must pattern-match to extract the payload.
 *
 *  If the type_def carries an `opaque: { repr }` annotation (parser emits this
 *  when the source says `opaque "<repr>" Name = ...`), the resulting type is
 *  wrapped in `$opaque { name, pure: <type> }` — the canonical representation-
 *  aware atom shape. representation-substrate Phase 5a — the AST annotation
 *  `opaque: { repr }` is still the "is-opaque" FLAG that drives the wrap, but
 *  its `repr` string is NO LONGER copied into the type (the field retired; the
 *  native rep lives in the per-type `Reprable JsRuntime` instance). The surface
 *  syntax `opaque "<repr>"` is a now-ignored annotation until 5b drops the keyword.
 */
function typeDefToFenelType(td: TypeDefAST["type_def"]): FenelType {
  // Refinement-form decl (`Email = String | isValidEmail` or the SetExpr
  // form `Char = Nat | value ∈ <set>`). The parser already emitted the
  // canonical `{$refined: {base, set}}` shape; pass it through and wrap
  // in `$opaque` if the decl was `opaque "<repr>" Name = …`.
  if (td.refined) {
    const refined = td.refined as FenelType;
    return td.opaque
      ? { $opaque: { name: td.name, pure: refined } }
      : refined;
  }
  // Type-expr-alias decl (`opaque "string" String = List Char`). The parser
  // emitted a single FenelType in the `alias` slot — pass it through (and
  // wrap in `$opaque` if the source carried the opaque keyword). Phase
  // 2.11 added this branch; a non-opaque alias is parsed identically and
  // returns the bare type expression (the syntactic surface for that
  // outside `opaque` doesn't exist yet — see Phase 2.12 framing for the
  // `type X = Y` alias-syntax follow-up).
  if (td.alias) {
    const alias = td.alias as FenelType;
    return td.opaque
      ? { $opaque: { name: td.name, pure: alias } }
      : alias;
  }
  const pure = typeDefToPureFenelType(td);
  if (td.opaque) {
    return { $opaque: { name: td.name, pure } };
  }
  return pure;
}

// Phase 7d / FM-retire-Z — lower a parsed field-default expr to the value that
// lands (via `seedFromType`'s `methodDefaults` sidecar) in a derived
// `InterfaceMethod.body`. Nullary Bool constructors fold to JS booleans — the SAME
// coercion the `construct` op applies (`{construct:["True"|"False"]}` → JS bool
// in json-logic.ts) — so a `.fenel` `isErasable: Boolean = False` byte-matches
// the deleted seed's `body: false`. String / number / other literals pass through.
function coerceDefaultValue(v: unknown): unknown {
  if (v && typeof v === "object" && !Array.isArray(v) && "construct" in v) {
    const args = (v as { construct: unknown[] }).construct;
    if (Array.isArray(args) && args.length === 1) {
      if (args[0] === "True") return true;
      if (args[0] === "False") return false;
    }
  }
  return v;
}

// FM-retire-Z — harvest the parsed `field: T = expr` method-default channel.
// The `FieldDef.default` slot is retired; instead the loader collects each
// class-record field carrying a `Just` default into a per-type
// `{ <fieldName>: <coerced body> }` map, surfaced on the module as
// `methodDefaults[<typeName>]`. `seedFromType` consumes it (the boot path
// threads it in) to populate `InterfaceMethod.body` — byte-identical to the
// pre-retirement `FieldDef.default` → `InterfaceMethod.body` derivation. This is
// the ONLY consumer; the `field: T = expr` surface stays the class-method-
// default authoring form (no non-class `.fenel` entity authors one — verified
// at HEAD). Returns `undefined` when no field carries a default.
function harvestMethodDefaults(
  td: TypeDefAST["type_def"],
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const c of td.constructors ?? []) {
    for (const f of c.fields ?? []) {
      const d = (f as { default?: { $tag?: string; _0?: unknown } }).default;
      if (d && d.$tag === "Just" && f.name) {
        defineLoadedProperty(out, f.name, coerceDefaultValue(d._0));
      }
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function typeDefToPureFenelType(td: TypeDefAST["type_def"]): FenelType {
  // field-identity Phase 2a: parser-origin positionality is explicit. The
  // loader consumes that origin and never reclassifies `_n` spellings; the
  // Fenel identity kernel alone owns the legacy no-key compatibility bridge.
  const isAutoPositional = (f: { name?: string; key?: FieldDef["key"] }) =>
    f.name === undefined || f.key?.$tag === "PositionalField";
  const ctors = td.constructors ?? [];
  // Phase 3e — when a `@discriminator` directive is present, the decl
  // must stay a `$variant` even if it would otherwise collapse to a
  // single-ctor `$record` (the discriminator only makes sense on
  // variants — see Phase 3e brief Watch-out §6).
  const withDiscriminator = (cases: Array<{ name: string; label: Maybe<LocaleString>; fields?: FieldDef[] }>): FenelType => ({
    $variant: td.discriminator !== undefined
      ? { discriminator: td.discriminator, cases }
      : { cases },
  });
  if (ctors.length === 1) {
    const c = ctors[0]!;
    if (c.fields.length === 0) {
      return withDiscriminator([{ name: c.name, label: Nothing, fields: [] }]);
    }
    if (
      td.discriminator === undefined &&
      c.fields.every((f) => f.name && !isAutoPositional(f))
    ) {
      return {
        $record: {
          fields: c.fields.map((f) => ({
            name: f.name!,
            ...(f.key === undefined ? {} : { key: f.key }),
            label: Nothing,
            type: requiredTypeDefFieldType(f, td.name, c.name, c.fields.indexOf(f)),
            meta: {},
            ui: Nothing,
          })),
        },
      };
    }
    return withDiscriminator([{
      name: c.name,
      label: Nothing,
      fields: c.fields.map((f, i) => ({
        name: f.name ?? `_${i}`,
        ...(f.key === undefined ? {} : { key: f.key }),
        label: Nothing,
        type: requiredTypeDefFieldType(f, td.name, c.name, i),
        meta: {},
        ui: Nothing,
      })),
    }]);
  }
  return withDiscriminator(ctors.map((c) => ({
    name: c.name,
    label: Nothing,
    fields: c.fields.map((f, i) => ({
      name: f.name ?? `_${i}`,
      ...(f.key === undefined ? {} : { key: f.key }),
      label: Nothing,
      type: requiredTypeDefFieldType(f, td.name, c.name, i),
      meta: {},
      ui: Nothing,
    })),
  })));
}

// ---------------------------------------------------------------------------
// Phase 3.4a — typed value-decl recognizer (NO instance-vs-constant routing)
//
// `loadFenelModule` derives a dispatch type-index entry (a `Instance`) from
// ANY nullary value-decl whose body constructs a type — the value's TYPE keys
// the entry. This is the "an instance is a typed value" model made literal: the
// "instance-ness" lives in the type, exactly as `x : Int = 3` is an Int value.
// There is no suffix gate selecting which value-decls become index entries
// (`emptyKeyboardState : KeyboardState` and `profileReferenceable :
// Referenceable profile` are indexed identically); whether a value is a pure
// dispatch instance is the caller's `dispatchInstanceFile` marker (Phase 3.4b),
// feeding presentation only, never the indexing.
// `design/unified-dispatch.md` § "An instance is a typed value".
// ---------------------------------------------------------------------------

/** A named/applied type sig peeled to its constructor head + args. Phase 3.4c —
 *  the `Spec` suffix is gone, so `typeName` IS the declared head (also used for
 *  the `typeValuedFields` lookup). universal-dispatch-convergence Phase 3 folded
 *  the former identical `className`/`typeName` pair into this single field. */
type TypeApplication = {
  typeName: string; args: TypeExpr[];
  readonly sourceArgumentReferences?: readonly (string | undefined)[];
};

/** Peel ANY named/applied type sig to its constructor + args (Phase 3.4a —
 *  generalised from the now-retired suffix-gated `matchSpecApplication`).
 *
 *  Surface shapes the parser emits (7g-parser: `{$named}`→`{$ref}` for the
 *  user-written nullary type-name; the `$el` applied form is unchanged, its
 *  args fold via `normalizeSpecArg`):
 *   - applied:  `Foo Bar`   → `{$el: {call: ["Foo", {$ref: "Bar"}]}}`
 *   - nullary:  `Foo`       → `{$ref: "Foo"}`  (was `{$named: "Foo"}`)
 *
 *  Arrow types are function types, NOT constructed-value types → null. No
 *  registry lookup, so the loader stays free of a circular import on
 *  `system-entities`. Fold `{$ref}` ≡ `{$named}` here (a 7b–7f loader-side
 *  miss, like `normalizeSpecArg`). */
function matchTypeApplication(sig: unknown): TypeApplication | null {
  if (!sig || typeof sig !== "object") return null;
  if ("$arrow" in sig) return null;
  if ("$el" in sig) {
    const el = (sig as { $el?: { call?: unknown[] } }).$el;
    if (el && Array.isArray(el.call) && el.call.length >= 1 && typeof el.call[0] === "string") {
      const typeName = el.call[0] as string;
      const sourceArgs = el.call.slice(1);
      const references = sourceArgs.map((arg) => {
        if (arg === null || typeof arg !== "object" || Array.isArray(arg) || Reflect.ownKeys(arg).length !== 1) return undefined;
        const reference = Object.getOwnPropertyDescriptor(arg, "$ref");
        return reference && "value" in reference && typeof reference.value === "string" ? reference.value : undefined;
      });
      const application: TypeApplication = {
        typeName,
        args: sourceArgs.map(normalizeSpecArg),
      };
      Object.defineProperty(application, "sourceArgumentReferences", {
        value: Object.freeze(references), enumerable: false, writable: false, configurable: false,
      });
      return application;
    }
    return null;
  }
  const nullaryName =
    "$named" in sig
      ? (sig as { $named?: unknown }).$named
      : "$ref" in sig
        ? (sig as { $ref?: unknown }).$ref
        : undefined;
  if (typeof nullaryName === "string") {
    return { typeName: nullaryName, args: [] };
  }
  return null;
}

/** The constructor head of a `{construct: [Head, …]}` body, if any. The parser
 *  only emits `construct` nodes for uppercase-headed applications, so a non-null
 *  result is always a type/constructor name. */
function constructHead(body: unknown): string | null {
  if (body && typeof body === "object" && "construct" in (body as object)) {
    const c = (body as { construct?: unknown[] }).construct;
    if (Array.isArray(c) && typeof c[0] === "string") return c[0];
  }
  return null;
}

/** Build the dispatch-index `Instance` for a typed value-decl: lower its
 *  method record (Phase 3.2 / 3.2b semantics), lift the `priority` / `label`
 *  slots, and project dispatch-sidecar scope metadata. `typeName` is the
 *  LITERAL declared head, used to look up the caller-supplied
 *  `typeValuedFields` set. */
function buildSpecInstance(
  typeName: string,
  args: TypeExpr[],
  fields: Record<string, unknown>,
  typeValuedFields: Record<string, string[]> | undefined,
  dispatchInstanceFile: boolean,
  declarationName?: string,
  /** modules-as-values Phase 5a — the type the declaration's SIGNATURE
   *  declares, when it differs from the constructor head `typeName` (`bx :
   *  Box` / `bx = MkBox { … }`). Recorded on the `declaration` carrier only;
   *  the dispatch instance stays keyed by `typeName` / `args`. */
  declaredType?: { typeName: string; args: TypeExpr[] },
  sourceArgumentReferences?: readonly (string | undefined)[],
): Instance {
  // Phase 3.2 / 3.2b — lower non-string method values to the canonical runtime
  // shape downstream dispatch reads (constructor literal → `{$tag,…}`; a method
  // field declared `FenelType` in `typeValuedFields` → the type ref `{$named}`).
  const typeFields = typeValuedFields?.[typeName] ?? [];
  const lowered = lowerSpecMethods(fields, typeFields) as Record<string, unknown>;
  // modules-as-values Phase 5a (A2/A4) — the authored record, captured NOW:
  // after the method lowering, before the lifts below delete `priority` /
  // `label` / `scope` from `lowered`, and as a private deep copy so nothing
  // that later mutates the dispatch methods reaches it.
  const authored = dispatchInstanceFile && declarationName !== undefined
    ? Object.freeze({ $tag: typeName, ...(copyDeclarationData(lowered) as Record<string, unknown>) })
    : undefined;
  const inst: Instance = { typeName, args, methods: lowered };
  if (sourceArgumentReferences !== undefined) Object.defineProperty(inst, "sourceArgumentReferences", {
    value: Object.freeze([...sourceArgumentReferences]), enumerable: false, writable: false, configurable: false,
  });
  // Provider dispatch ordering (listProvidersSorted) consults `priority`; lift
  // it out of the method record into the cache slot when authored numerically
  // AND drop it from `methods` (symmetric with `label` below) so the projected
  // method record stays the pure dispatch-method set — a capability provider
  // instance (`EmailService mailgun = EmailService { send = …, priority = 50 }`)
  // must not expose `priority` as a callable method key.
  if (typeof lowered.priority === "number") {
    inst.priority = lowered.priority;
    delete lowered.priority;
  }
  // Lift a top-level `label` method-field into the `Instance.label` slot
  // (mirrors the `priority` lift) and drop it from `methods` so the projected
  // method record stays byte-identical to the legacy const's `methods`.
  if (typeof lowered.label === "string") {
    inst.label = lowered.label;
    delete lowered.label;
  }
  // Landing 1 A1 — an authored effect dictionary must retain the persisted
  // instance visibility that its retired TS registration carried. Instance
  // sidecars may therefore carry `scope = "<tag>"` as projection metadata,
  // alongside the established `priority` / `label` metadata fields above.
  // Keep the lift gated on `dispatchInstanceFile`: an ordinary typed record
  // constant is allowed to have a real data field named `scope`.
  if (dispatchInstanceFile && typeof lowered.scope === "string") {
    const scope = lowered.scope;
    // ⚠ rights R3a — `"account"` IS NOT A SIDECAR SCOPE. It has never been a
    // tag anyone activates (zero production `_activeTags` writers), and after
    // R3a it is not a scope spelling at all: account ownership is DERIVED from
    // the writing frame's authenticated authority, never authored. An authored
    // `account` here would be a sidecar claiming an ownership it cannot have,
    // so it is a LOAD ERROR rather than a silently-invisible row. `global` and
    // genuine tags still lift.
    if (scope === "account") {
      throw new Error(
        "dispatch-instance sidecar scope: `account` is not an authorable scope " +
          "(rights R3a — account ownership is derived from the writing frame's " +
          "authority; global and tag instances are boot-declared). " +
          `Offending instance: ${inst.typeName}.`,
      );
    }
    inst.scope = scope === "global"
      ? { kind: "global" }
      : { kind: "tag", tag: scope };
    delete lowered.scope;
  }
  if (authored !== undefined) {
    // Non-enumerable (see `Instance.declaration`): every existing projection
    // of the instance — spreads, JSON, structural equality — is unchanged.
    Object.defineProperty(inst, "declaration", {
      value: Object.freeze({
        name: declarationName,
        value: authored,
        // The declared type application, apart from the authored constructor
        // tag the value keeps: the member index finds the owner by it.
        type: Object.freeze({
          name: declaredType?.typeName ?? typeName,
          args: copyDeclarationData(declaredType?.args ?? args) as readonly TypeExpr[],
        }),
      }),
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }
  return inst;
}

/** A frozen deep copy of loader IR data (plain records, arrays, scalars). */
function copyDeclarationData(value: unknown): unknown {
  if (Array.isArray(value)) return Object.freeze(value.map(copyDeclarationData));
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) defineLoadedProperty(out, key, copyDeclarationData(child));
  return Object.freeze(out);
}

type TypedValueDecl = { inst: Instance; isDispatchClass: boolean };

/** Recognise a nullary value-decl as a typed value (Phase 3.4a — replaces the
 *  suffix-gated routing). Returns the derived dispatch-index entry plus whether
 *  the value is a pure dispatch *instance* (`isDispatchClass`, supplied by the
 *  caller via `dispatchInstanceFile` — Phase 3.4b's non-suffix replacement for
 *  the retired `endsWith("Spec")` gate); the caller uses the latter ONLY for
 *  the by-name/identity presentation facet, never to decide whether to index
 *  (indexing is uniform). Two recognition paths:
 *
 *   - declared-type: `name : T a… = T { … }` — the sig names the type, the body
 *     constructs it. typeName/args derive from the SIG (it carries the
 *     type-application args, e.g. `Referenceable profile` → args `["profile"]`).
 *   - body-only:     `name = Ctor { … }` (no sig — e.g. `emptyKeyboardState`).
 *     The constructor head IS the (single-constructor) record type, so the
 *     value's runtime type-constructor is that head; args = [] (a value needing
 *     type-args declares a sig the declared-type path already matched). Variant-
 *     CASE bodies (`x = Just 5`) key under the case name, which is no dispatch
 *     class — harmless (nothing resolves it); the model's `_caseOwner`-based
 *     reflection that maps a case to its owning type is the evaluator's job, not
 *     the (registry-free) loader's. */
function deriveTypedValueDecl(
  sig: unknown,
  body: unknown,
  typeValuedFields: Record<string, string[]> | undefined,
  dispatchInstanceFile: boolean,
  /** modules-as-values Phase 5a — the declaration's name, for the instance's
   *  `declaration` carrier (attached only in an instance file). An unnamed
   *  (`_`) declaration passes none. */
  declarationName?: string,
): TypedValueDecl | null {
  const value = recognizeTypedValue(sig, body);
  if (value === null) return null;
  return {
    inst: buildSpecInstance(
      value.typeName,
      value.args,
      value.fields,
      typeValuedFields,
      dispatchInstanceFile,
      declarationName,
      value.declared,
      value.sourceArgumentReferences,
    ),
    isDispatchClass: dispatchInstanceFile,
  };
}

/** The recognition half of `deriveTypedValueDecl`: the type a nullary
 *  value-decl is indexed under, its args, and its field record — or null when
 *  it is not a typed value. The declaration-name heads use it to tell an
 *  instance-file value from a function without building the instance.
 *
 *  modules-as-values Phase 5a — when the signature declares a type the body's
 *  constructor is not named after (`bx : Box` / `bx = MkBox { … }`), the value
 *  is still indexed under the constructor head (as before), and `declared`
 *  keeps the signature's type application for the `declaration` carrier. */
function recognizeTypedValue(
  sig: unknown,
  body: unknown,
): {
  typeName: string;
  args: TypeExpr[];
  fields: Record<string, unknown>;
  sourceArgumentReferences?: readonly (string | undefined)[];
  declared?: { typeName: string; args: TypeExpr[] };
} | null {
  const app = matchTypeApplication(sig);
  if (app) {
    const rec = extractConstructorRecord(body, app.typeName);
    if (rec) return { typeName: app.typeName, args: app.args, fields: rec.fields,
      ...(app.sourceArgumentReferences === undefined ? {} : { sourceArgumentReferences: app.sourceArgumentReferences }) };
  }
  const head = constructHead(body);
  if (head) {
    const rec = extractConstructorRecord(body, head);
    if (rec) {
      return {
        typeName: head,
        args: [],
        fields: rec.fields,
        ...(app ? { declared: { typeName: app.typeName, args: app.args } } : {}),
      };
    }
  }
  return null;
}

/** Normalise a type-application argument to the shape `dispatch-registry.ts`'s
 *  `matchExpr` dispatches on. A concrete `{$named: "X"}` / `{$ref: "X"}`
 *  collapses to the bare string `"X"` (the matcher's string-pattern branch
 *  matches a string pattern against an LHS `{$named: "X"}`); `{$var}` and
 *  `{$el: {call}}` pass through unchanged (the matcher handles those directly).
 *
 *  7g-parser: the parser now emits `{$ref: "X"}` (was `{$named: "X"}`) for a
 *  user-written type-name arg, so an instance sig `Iso String Bytes` lowers to
 *  args `[{$ref:"String"}, {$ref:"Bytes"}]`. This loader-side name-extractor is
 *  a 7b–7f miss (the consumer arc reached the runtime/validation/set-algebra
 *  side, not the loader's dispatch-instance projection); fold `{$ref}` ≡
 *  `{$named}` so dispatch-instance keys stay the bare-string form downstream
 *  lookups (`pickCodecInst`/`pickAggregableInst`) compare against. */
function normalizeSpecArg(arg: unknown): TypeExpr {
  if (arg && typeof arg === "object") {
    if ("$named" in (arg as object)) {
      const n = (arg as { $named?: unknown }).$named;
      if (typeof n === "string") return n;
    }
    if ("$ref" in (arg as object)) {
      const r = (arg as { $ref?: unknown }).$ref;
      if (typeof r === "string") return r;
    }
  }
  return arg as TypeExpr;
}

/** Recognise a constructor-application body `<X>Spec { f1 = v1, ... }` whose
 *  head matches `specName`, returning the field record (the projected
 *  `methods`). A no-field marker body `<X>Spec` yields an empty record.
 *  Returns null when the body isn't a construct of `specName`. */
function extractConstructorRecord(
  body: unknown,
  specName: string,
): { fields: Record<string, unknown> } | null {
  if (!body || typeof body !== "object" || !("construct" in (body as object))) {
    return null;
  }
  const c = (body as { construct?: unknown[] }).construct;
  if (!Array.isArray(c) || c.length < 1 || c[0] !== specName) return null;
  const rec = c[1];
  if (rec === undefined) return { fields: {} };
  if (rec && typeof rec === "object" && !Array.isArray(rec)) {
    return { fields: rec as Record<string, unknown> };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Phase 3.2 — non-string method-value lowering
//
// The parser emits a constructor application (`Just "x"`, `Lossless`,
// `Lossy { reason = "..." }`) as a `{construct:[Ctor, ...payload]}` node; the
// legacy TS `Instance` consts held the *evaluated* `{$tag, ...}` runtime
// shape downstream dispatch (pattern matching, the migration path-finder)
// reads. `lowerConstructLiteral` bridges the two with the SAME pure structural
// transform the `construct` op (`json-logic.ts`) applies — WITHOUT evaluating
// (no `EvaluateContext`, no registry/`system-entities` import; the loader stays
// circular-import-free, mirroring the Phase 3 helpers).
// ---------------------------------------------------------------------------

/** Lower a parsed literal value to the canonical runtime shape the `construct`
 *  op produces. Pure structural transform:
 *   - `{construct:["True"]}`           → `true`          (Bool opaque repr)
 *   - `{construct:["False"]}`          → `false`
 *   - `{construct:[C]}`                → `{$tag: C}`                       (nullary)
 *   - `{construct:[C, {f=v, ...}]}`    → `{$tag: C, f: lower(v), ...}`     (named record payload)
 *   - `{construct:[C, a, b, ...]}`     → `{$tag: C, _0: lower(a), _1: lower(b), ...}` (positional)
 *
 *  Recurses into arrays and plain records so nested constructors
 *  (`Just (Lossy {...})`) and list/record method values lower correctly.
 *  Strings / numbers / booleans / null pass through untouched (list/record
 *  literals already parse to plain arrays/objects).
 *
 *  Disambiguation note: the `construct` op decides named-vs-positional from the
 *  constructor's declared field set (`ctx._constructors`). The loader has no
 *  such context, so it disambiguates structurally instead — a single payload
 *  that is itself a `{construct}` node (or an array) is always POSITIONAL
 *  (→ `_0`), never spread as a named record. For hand-authored instance method
 *  values (literals, no `{var}` refs) this matches the op's with-ctorDef
 *  behavior exactly; the byte-identity probe against the live const is the
 *  guard. */
function lowerConstructLiteral(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(lowerConstructLiteral);
  if (!node || typeof node !== "object") return node;
  const obj = node as Record<string, unknown>;
  if ("construct" in obj && Array.isArray(obj.construct)) {
    const c = obj.construct;
    const name = c[0] as string;
    if (c.length === 1) {
      // Bool is opaque-wrapped (`True | False` pure, JS boolean repr) — the
      // construct op coerces nullary `True`/`False` to JS booleans.
      if (name === "True") return true;
      if (name === "False") return false;
      return { $tag: name };
    }
    const result: Record<string, unknown> = { $tag: name };
    const payload = c[1];
    const isNamedRecord =
      c.length === 2 &&
      payload !== null &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      !("construct" in (payload as object));
    if (isNamedRecord) {
      for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
        defineLoadedProperty(result, k, lowerConstructLiteral(v));
      }
    } else {
      for (let i = 1; i < c.length; i++) {
        defineLoadedProperty(result, `_${i - 1}`, lowerConstructLiteral(c[i]));
      }
    }
    return result;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    defineLoadedProperty(out, k, lowerConstructLiteral(v));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Phase 3.2b — type-as-value method lowering
//
// `lowerSpecMethods` lowers a spec instance's method record, branching per
// field on whether it is type-valued (caller-declared via `typeValuedFields`).
// A type-valued field holds a FenelType VALUE; a bare nullary
// `{construct:["X"]}` is the TYPE reference `{$named:"X"}`, NOT the runtime
// value `{$tag:"X"}` a value constructor lowers to. Everything else routes
// through the ordinary `lowerConstructLiteral`. The disambiguation is
// DECLARATIVE (the caller asserts which fields are type-valued); the loader
// makes no shape-guess that could corrupt nullary-variant values (`Nothing`).
// ---------------------------------------------------------------------------

/** Recognise a bare point-free function reference: a node that is EXACTLY
 *  `{var: "<name>"}` (single key `var`, string value). Returns `<name>`, else
 *  null. This is the precise shape the parser emits for a method authored
 *  point-free (`resolve = getInstanceById`); anything nested (a `{var}` INSIDE
 *  a lambda / call / construct) is NOT this shape and is left untouched. */
function asBareVarReference(node: unknown): string | null {
  if (!node || typeof node !== "object" || Array.isArray(node)) return null;
  const keys = Object.keys(node as Record<string, unknown>);
  if (keys.length !== 1 || keys[0] !== "var") return null;
  const v = (node as { var: unknown }).var;
  return typeof v === "string" ? v : null;
}

/** Lower a spec instance's method record. Three branches per field:
 *   - type-valued (names in `typeValuedFields`)        → `lowerTypeValue`
 *   - a bare point-free function reference `{var: n}`  → `{$ref: n}`   (Phase 10)
 *   - everything else                                  → `lowerConstructLiteral`
 *
 *  Phase 10 (typed-function-references — the spec-instance reference-method
 *  loader flip): a method whose value is a bare point-free function reference
 *  (`uuidIdentifiable = Identifiable { resolve = getInstanceById }` → the parser
 *  emits `resolve`'s value as `{var:"getInstanceById"}`) lowers to the
 *  dispatch-ready reference `{$ref:"getInstanceById"}`. This is the LOAD-time
 *  sibling of the Phase-2 `resolveVar` flip in the evaluator (`{var:"abs"}` →
 *  `{$ref}`); without it the persisted method value was an unresolved `{var}`
 *  node — not the callable `{$ref}` dispatch consumes — which is why every
 *  reference/arrow-method instance had to be a hand-written TS `Instance`
 *  const. The handle is the **codeableName** (the var name), NOT a UUID: the
 *  flip is a pure shape rewrite (no id lookup), so it is ordering-safe even
 *  though `lowerSpecMethods` runs while the registry is still populating;
 *  dispatch resolves the codeableName handle via `getFunction` (id-or-codeName)
 *  at CALL time, when the registry is complete. Phase 6/7 already made a `{$ref}`
 *  handle UUID-or-codeableName, so this needs no new dispatch support.
 *
 *  Scope guardrails (the correctness exclusions — see the Phase 10 brief):
 *   - Nullary variant constructors arrive as `{construct:[…]}`, NOT `{var}` —
 *     owned by `lowerConstructLiteral`'s construct-branch. Untouched.
 *   - Type-valued method fields route through `lowerTypeValue` (the `{$named}`
 *     dispatch-key exception lives there) — a different branch. Untouched.
 *   - Lambdas (`\x -> …` → `{fn:[…]}`) / applications (`{call:[…]}`) are NOT a
 *     bare `{var}`; they fall to `lowerConstructLiteral`, and a `{var:"x"}`
 *     NESTED in a lambda body (a lexical param, not a function ref) passes
 *     through unchanged — the flip is the TOP-LEVEL method value ONLY. */
function lowerSpecMethods(
  fields: Record<string, unknown>,
  typeValuedFields: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeValuedFields.includes(k)) {
      defineLoadedProperty(out, k, lowerTypeValue(v));
      continue;
    }
    // Only the top-level value flips. A `{var}` NESTED in a constructor
    // payload, a list or a record literal is not lowered, because the IR
    // cannot tell a reference from data there: the record literal
    // `Packet { var = "hello" }` and the application `Packet hello` both parse
    // to `{construct:["Packet",{var:"hello"}]}`, and a nested record such as
    // `{ call = std.add }` has the shape of an expression node. So
    // `Just migration.x` keeps the known-wrong `{$tag:"Just", var:…}`. Lowering
    // it needs record/expression provenance in the IR, or the constructor's
    // declared fields at registry time.
    const refName = asBareVarReference(v);
    defineLoadedProperty(out, k, refName !== null ? { $ref: refName } : lowerConstructLiteral(v));
  }
  return out;
}

/** Lower a method value that holds a FenelType (not a runtime value).
 *   - `{$named: "X"}` / `{$ref: "X"}` → unchanged (already a type reference)
 *   - `{construct: ["X"]}`            → `{$named: "X"}`  (bare nullary type ref)
 *   - anything else                   → unchanged (pass-through)
 *
 *  7g-retire-4b: this emits `{$named}` DELIBERATELY (one of the documented
 *  grep-proof exceptions, alongside `decidable-membership`'s `SHAPE_KEY`). It is
 *  a **dispatch-lowering internal**, not a type-system/UI/persisted type ref:
 *  the aggregable/codec instance method-value VALUES stay `{$named}` (2b's
 *  surprise #2 kept them so the dispatch byte-identity oracle holds), and
 *  `normalizeSpecArg` immediately projects this output to the bare-string
 *  dispatch key (`pickCodecInst`/`pickAggregableInst` compare the string), so
 *  `{$named}` vs `{$ref}` is invisible downstream. Returns `unknown`, so it never
 *  hit the union swap. Reads BOTH forms (a flipped input passes through).
 *
 *  Scope (Phase 3.2b Decision #5): BARE type references only. Applied
 *  type-values (`List Char` → a multi-element construct / `$el.call` /
 *  container shape) are OUT OF SCOPE; if one is hit it passes through
 *  un-lowered (the byte-identity probe is the guard — it surfaces the wrong
 *  shape before deletion rather than the loader silently rewriting an applied
 *  type). aggregable uses only bare refs (List / Nat / Number / Any). */
function lowerTypeValue(node: unknown): unknown {
  if (!node || typeof node !== "object") return node;
  const obj = node as Record<string, unknown>;
  if ("$named" in obj || "$ref" in obj) return node;
  if ("construct" in obj && Array.isArray(obj.construct)) {
    const c = obj.construct;
    if (c.length === 1 && typeof c[0] === "string") {
      return { $ref: c[0] };
    }
  }
  return node;
}

/** Re-export types so consumers can write the same source-shape we emit. */
export type { Expression };
export {
  matchTypeApplication,
  normalizeSpecArg,
  deriveTypedValueDecl,
  extractConstructorRecord,
  lowerConstructLiteral,
  lowerTypeValue,
};

// browser-engine-compat Phase 1b: self-register this module's live namespace so
// engineRequire("fenel-module") resolves even at EVAL-TIME (a caller that statically imports
// this module runs its own eval-time builder calls AFTER this module is fully loaded,
// i.e. before the index.ts aggregator runs). See engine-require.ts.
import * as __self_fenel_module from "./fenel-module";
import { registerEngineModule as __reg_fenel_module } from "./engine-require";
__reg_fenel_module("fenel-module", __self_fenel_module);
