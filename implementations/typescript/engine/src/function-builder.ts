// ---------------------------------------------------------------------------
// Function declaration helper.
//
// A FenelFunction value is just `{ id, params, returns, body? }`. Everything
// else (name / codeName, label, description, category, icon, tags, aliases)
// is identity surface that lives in typeclass instances keyed by the
// function's id — exactly the same pattern as for entity types.
//
// `defineFunction` packages a function declaration into both halves:
//   1. the pure spec (consumed by the registry / evaluator)
//   2. the typeclass instances (consumed by the typeclass registry to drive
//      labels / descriptions / categories / dispatch by codeName)
//
// Modules collect the resulting `fns` and `instances` and surface both via
// FenelModule.{functions, instances}.
// ---------------------------------------------------------------------------

import type {
  Constraint,
  FenelFunction,
  FenelType,
  FieldDef,
  FunctionBody,
  FunctionExample,
  LocaleString,
  Instance,
} from "./types";

/** Pure function spec — what the runtime needs to call it. */
export type FunctionSpec = {
  id: string;
  params: FieldDef[];
  returns: FenelType;
  body?: FunctionBody;
  /**
   * Interface constraints required to run this function. Each says
   * "an instance of `class` for `args` must be available in scope".
   * Replaces the legacy `ioAction` string with structured effect
   * tracking. See `design/effect-system.md`.
   */
  requires?: Constraint[];
};

/** Identity surface — what the catalog / dispatch / picker / storybook need.
 *  All optional except `codeName` (the dispatch key in `{ call: [name, ...] }`).
 *  Anything omitted simply produces no typeclass instance for that aspect.
 *
 *  `examples` lives here — not in FunctionSpec — because they are *values*
 *  about the function (storybook content), not part of the function's pure
 *  definition. Same pattern as label / description / category: identity
 *  facets stored as typeclass instances keyed by the function's id. */
export type FunctionIdentity = {
  /** Fenel-language code identifier — the string used in `{ call: [name, ...] }`.
   *  May be locale-aware (Codeable ships LocaleString). */
  codeName: LocaleString;
  /** Human display label. Falls back to codeName if absent. */
  label?: LocaleString;
  /** Description / documentation (also doubles as AI prompt body). */
  description?: LocaleString;
  /** Category for grouping in catalogs. */
  category?: string;
  /** Default icon — a lucide-style identifier (e.g. `"pin"`, `"bot"`,
   *  `"mail"`). Distinct from `emoji`: `icon` registers `Iconable` for
   *  surfaces that render glyphs from the icon library (sidebars,
   *  buttons, type cards). For an emoji glyph, use `emoji` instead. */
  icon?: string;
  /** Default emoji glyph (e.g. `"📌"`, `"🤖"`). Registers an
   *  `Emojiable` instance — sister to `Iconable`, used by surfaces
   *  that prefer compact emoji rendering (chat, Telegram, terminal). */
  emoji?: string;
  /** Free-form tags for search / filtering. */
  tags?: string[];
  /** Runtime IO handler action name (e.g. `"telegram_collector.run"`).
   *  When set, runtime callers dispatch to this handler instead of
   *  treating the function as a pure / native call. */
  ioAction?: string;
  /** Optional companion handler that undoes the io effect. When set,
   *  the dashboard renders a Stop button next to Run on instance cards. */
  stopAction?: string;
  /** Optional handler that returns the live deployments (rows) created
   *  by this function. Surfaces as the "Instances" view on function
   *  pin cards / function detail pages. */
  listInstancesAction?: string;
  /** Identifier projections to non-Fenel targets (Python / JS / SQL / …). */
  aliases?: Record<string, string>;
  /** Storybook rows demonstrating the function on concrete inputs.
   *  Emitted as a `Storyboardable` typeclass instance; readers go through
   *  `getStoryboard(fn.id)` rather than touching the function spec. */
  examples?: FunctionExample[];
};

export type DefinedFunction = {
  fn: FenelFunction;
  instances: Instance[];
};

/**
 * Bundle a function spec + identity into a FenelFunction value and its
 * supporting typeclass instances.
 *
 * The returned `fn` carries ONLY the spec (id, params, returns, body). The
 * `instances` list is fed into the typeclass registry so dispatch by
 * codeName works and consumers can read label/description/etc. via
 * getLabel(fn.id) / getDescription(fn.id) / getCategory(fn.id) / etc.
 *
 * NOTE: during the migration to id-only FenelFunction, this helper still
 * populates the legacy `name` field on the returned spec (mirroring the
 * codeName) so existing call sites that read `fn.name` keep working. The
 * field is removed from FenelFunction once all consumers route through
 * the typeclass dispatch.
 */
export function defineFunction(
  spec: FunctionSpec,
  identity: FunctionIdentity,
): DefinedFunction {
  const fn: FenelFunction = {
    id: spec.id,
    params: spec.params,
    returns: spec.returns,
    body: spec.body,
    ...(spec.requires ? { requires: spec.requires } : {}),
  };

  const instances: Instance[] = [
    { typeName: "Codeable", args: [spec.id], methods: { codeName: identity.codeName } },
  ];

  if (identity.label !== undefined) {
    instances.push({ typeName: "Labelable", args: [spec.id], methods: { label: identity.label } });
  }
  if (identity.description !== undefined) {
    instances.push({
      typeName: "Describable",
      args: [spec.id],
      methods: { description: identity.description },
    });
  }
  if (identity.category !== undefined) {
    instances.push({
      typeName: "Categorizable",
      args: [spec.id],
      methods: { category: identity.category },
    });
  }
  if (identity.icon !== undefined) {
    instances.push({ typeName: "Iconable", args: [spec.id], methods: { icon: identity.icon } });
  }
  if (identity.emoji !== undefined) {
    instances.push({ typeName: "Emojiable", args: [spec.id], methods: { emoji: identity.emoji } });
  }
  if (identity.tags !== undefined && identity.tags.length > 0) {
    instances.push({ typeName: "Taggable", args: [spec.id], methods: { tags: identity.tags } });
  }
  if (
    identity.ioAction !== undefined ||
    identity.stopAction !== undefined ||
    identity.listInstancesAction !== undefined
  ) {
    const methods: Record<string, unknown> = {};
    if (identity.ioAction !== undefined) methods.ioAction = identity.ioAction;
    if (identity.stopAction !== undefined) methods.stopAction = identity.stopAction;
    if (identity.listInstancesAction !== undefined) methods.listInstancesAction = identity.listInstancesAction;
    instances.push({
      typeName: "IOInvokable",
      args: [spec.id],
      methods,
    });
  }
  if (identity.aliases !== undefined && Object.keys(identity.aliases).length > 0) {
    instances.push({
      typeName: "Aliasable",
      args: [spec.id],
      methods: { aliases: identity.aliases },
    });
  }
  if (identity.examples !== undefined && identity.examples.length > 0) {
    instances.push({
      typeName: "Storyboardable",
      args: [spec.id],
      methods: { storyboard: identity.examples },
    });
  }

  for (const instance of instances) Object.defineProperty(instance, "sourceArgumentFunctionIds", {
    value: Object.freeze([fn.id]), enumerable: false, writable: false, configurable: false,
  });
  return { fn, instances };
}

/**
 * Convenience: define many functions at once and aggregate their specs +
 * instances. Useful at module bottom: `const { fns, instances } =
 * defineFunctions([ defineFunction(...), defineFunction(...), ... ])`.
 */
export function collectFunctions(
  defined: DefinedFunction[],
): { fns: FenelFunction[]; instances: Instance[] } {
  const fns: FenelFunction[] = [];
  const instances: Instance[] = [];
  for (const d of defined) {
    fns.push(d.fn);
    instances.push(...d.instances);
  }
  return { fns, instances };
}

/**
 * Rekey a name-indexed native-impls map to id-indexed using the standard
 * `<module>:<name>` id format. Used by modules that declare natives
 * once as a `Record<codeName, native>` and want to expose them id-keyed
 * to match the unified dispatch path.
 *
 * The dispatch path also falls back to name-keyed lookup, so this
 * transformation is optional — but applying it eliminates the legacy
 * lookup branch and makes the runtime contract uniform.
 */
export function rekeyNativesById<T>(
  natives: Record<string, T>,
  modulePrefix: string,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [name, fn] of Object.entries(natives)) {
    out[`${modulePrefix}:${name}`] = fn;
  }
  return out;
}
