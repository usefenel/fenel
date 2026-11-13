import { resolveEffect, frameVisibility, instanceVisible, type CatalogEntry, type CatalogSection, type EvaluateContext, type FenelFunction, type FenelType, type FieldDef, type LocaleString, type TypeView } from "@fenel/engine";
import { bareConstructorTag, selectedRepresentationMethods } from "./constructor-presentation";
import { constructorLabel } from "./constructor-label";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { Just, Nothing, peelMaybeValue, type Maybe } from "@fenel/engine/type-foundation";
import { canonical } from "@fenel/engine/locale";
import { dispatchedReaderPresentationFromSnapshot, dispatchedCodeLensTextIsReadable, dispatchEngineBody, marshalTraversalType, marshalTraversalDeclarationType, printType, type PrintSourceContext, type ReaderPresentationSnapshotFacts, type ReaderGlyphPicture } from "@fenel/engine/engine-bodies-dispatch";
import { peelResultForAuthoring, peelListForAuthoring } from "@fenel/engine/authoring/type";
import { typeCode, typePhrase } from "@fenel/engine/authoring/expression";
import { projectLocusTypeDescriptions, type LocusTypeDescription } from "../../../../../implementations/typescript/engine/src/authoring/locus-type-presentation";
import type { AuthoringSession } from "./expression-runner/account-authoring-session";
import type { FunctionCardType } from "./function-card-body";
import { valueCardLabel, type DisplayName, type DisplayNameInput } from "./display-name";
import { fieldSlotName, fieldWireKey } from "./layout-renderer/typed-read-field-slots";
import { surfaceReaderViewPlan, surfaceReadValuePlan, surfaceLayoutRenderPlan, resolveSurfaceTypeView, type SurfaceLayoutRenderPlan, type SurfaceReadValuePlan } from "@fenel/engine/authoring/surface";
import { presentedTypeTarget, typeIconForPresentation } from "./type-icon-presentation";
import typeIconFallbacks from "./type-icon-fallbacks.json";
import { scopedConcreteType } from "./data-transfer/expressions";

/** The compact type formatter drops Result payloads to a generic choice.
 * Reuse the source-owned printer in this captured reader; unavailable source
 * projection leaves the ordinary presentation intact rather than a diagnostic. */
export function readerResultTypeLabel(type: FenelType, source: PrintSourceContext & { evaluateContext: EvaluateContext }): string | undefined {
  if (!peelResultForAuthoring(type)) return undefined;
  try {
    const code = printType(type, source);
    return dispatchedCodeLensTextIsReadable(code) ? code : undefined;
  } catch { return undefined; }
}

/** B3 DTO transport: early cards carry the same printed payload types as the
 * ready reader. The existing projector still owns traversal and type facts. */
export function projectReaderTypeDescriptions(root: Parameters<typeof projectLocusTypeDescriptions>[0],
  source: PrintSourceContext & { evaluateContext: EvaluateContext },
  resolveName?: (handle: string) => string, resolveCode = resolveName,
  resolveType: (handle: string) => FenelType | undefined = () => undefined) {
  const descriptions = new Map(projectLocusTypeDescriptions(root, resolveName, resolveCode, resolveType, source.evaluateContext)
    .map(description => [JSON.stringify(description.type), description]));
  // A return slot is not a FieldDef. Carry it explicitly beside the existing
  // field projection, including a returned function's own return slot.
  for (const description of descriptions.values()) {
    if (!("$arrow" in description.type)) continue;
    for (const result of projectLocusTypeDescriptions({ type: description.type.$arrow.returns }, resolveName, resolveCode, resolveType, source.evaluateContext)) {
      const key = JSON.stringify(result.type);
      if (!descriptions.has(key)) descriptions.set(key, result);
    }
  }
  return [...descriptions.values()].map(description => {
    const code = readerResultTypeLabel(description.type, source);
    return code === undefined ? description : { ...description, phrase: code, code };
  });
}

/** B3 reader binding only: preserve the type preview's existing projector,
 * declaration lookup and exact frame. No registry or callback enters its DTO. */
export function projectReaderTypeDescriptionsInSession(
  root: Parameters<typeof projectLocusTypeDescriptions>[0],
  session: Pick<AuthoringSession, "registry" | "environment" | "evaluateContext">,
  typeLookup: "registry" | "session",
): ReturnType<typeof projectLocusTypeDescriptions> {
  return projectLocusTypeDescriptions(root, undefined, undefined,
    name => session.registry.getIdentifiedEntity(name)?.type
      ?? (typeLookup === "session" ? session.environment.resolveTypeRef?.({ $ref: name }) : undefined),
    session.evaluateContext);
}

/** A2/B3 snapshot transport only. Fenel owns family/optional-entry projection;
 * canonical resolveEffect owns every scope/priority/structural selection. The
 * captured frame never acquires registry-read authority or executes a method. */
export function representationalClassNamesFromReaderSnapshot(frame: EvaluateContext, pool = frame._specRegistry): string[] {
  if (!pool) throw new Error("This reader has no captured representation registry.");
  const visibility = frameVisibility(frame);
  const markers = pool.listInstances("Representational").filter(row => instanceVisible(row, visibility))
    .map(row => ({ args: row.args, methods: row.methods, scope: row.scope ?? "global", priority: row.priority ?? 0 }));
  // Public reader profiles omit these pure engine helpers. Reuse their
  // existing bridge with the captured frame, as the other read projections do.
  const call = (name: string, args: unknown[]): unknown => dispatchEngineBody(`engine:${name}`, args, frame);
  const names = call("representationalClassNamesFromSnapshot", [markers, pool.listClasses().map(cls => cls.name)]);
  if (!Array.isArray(names) || names.some(name => typeof name !== "string")) throw new Error("This reader's representation family could not be read.");
  return names as string[];
}

export function representationsFromReaderSnapshot(_registry: ModuleRegistry, frame: EvaluateContext,
  target: string): Array<{ typeName: string; methods: Record<string, unknown> }> {
  const pool = frame._specRegistry;
  const names = representationalClassNamesFromReaderSnapshot(frame, pool);
  const call = (name: string, args: unknown[]): unknown => dispatchEngineBody(`engine:${name}`, args, frame);
  const resolved = names.map(typeName => {
    const selected = resolveEffect(frame, pool!, typeName, target);
    return { typeName, instance: selected ? Just(selectedRepresentationMethods(typeName, selected)) : Nothing };
  });
  const entries = call("representationEntriesFromSnapshot", [resolved]);
  if (!Array.isArray(entries)) throw new Error("This reader's captured representations could not be read.");
  return (entries as Array<{ typeName: string; instance: Record<string, unknown> }>).map(entry => ({
    typeName: entry.typeName, methods: entry.instance,
  }));
}

export type ReaderPresentation = {
  label?: LocaleString;
  description?: LocaleString;
  icon?: string;
  emoji?: string;
  picture?: ReaderGlyphPicture;
  codeName?: string;
  /** `label` is a Labelable instance's own label (authored), never a fallback
   * name: it reads as a label even when it equals `codeName`. */
  labelAuthored?: boolean;
  /** A public section that asks for its members as even tiles (each tile: the
   * value itself and its name), instead of cards of their own height. */
  layout?: "tiles";
};

/** Captured resolver provenance crosses once; the Fenel projection decides
 * which fact belongs on the data name row. Full representations stay intact. */
export function ownPresentationFromReaderSnapshot(frame: EvaluateContext | undefined,
  methods: ReadonlyMap<string, Record<string, unknown>>, iconKey: unknown): ReaderPresentation {
  const projected = dispatchedReaderPresentationFromSnapshot({
    label: methods.get("Labelable")?.label as LocaleString | undefined,
    description: methods.get("Describable")?.description as LocaleString | undefined,
    codeName: methods.get("Codeable")?.codeName as LocaleString | undefined,
    icon: methods.get("Iconable")?.icon as string | undefined,
    emoji: methods.get("Emojiable")?.emoji as string | undefined,
    picture: methods.get("Picturable")?.picture,
    iconKey,
  }, frame);
  // The engine emits a Labelable instance only for an authored label (a name
  // typed in the app, an `@label`): its projected label is that authored text.
  const authored = valueCardLabel(methods.get("Labelable")?.label)?.trim();
  const labelAuthored = !!authored && valueCardLabel(projected.label)?.trim() === authored;
  return { ...projected, codeName: projected.codeName === undefined ? undefined : canonical(projected.codeName),
    ...(labelAuthored ? { labelAuthored: true } : {}) };
}

/** B3 egress: API display text is the canonical projection of scoped data;
 * identities and optional code names are retained independently. */
export function readerPresentationDto(presentation: ReaderPresentation) {
  return { ...presentation,
    label: presentation.label === undefined ? undefined : canonical(presentation.label),
    description: presentation.description === undefined ? undefined : canonical(presentation.description),
  };
}
type PresentationRow = ReaderPresentation & { id?: string; name: string; function?: FenelFunction };
export type ReaderPresentationSource = {
  registry: ModuleRegistry;
  session: { evaluateContext: EvaluateContext };
  catalog: readonly CatalogSection[];
  functionRows?: readonly PresentationRow[];
  types?: readonly PresentationRow[];
  metadata?: ReadonlyMap<string, ReadonlyMap<string, Record<string, unknown>>>;
  ownPresentations?: ReadonlyMap<string, ReaderPresentation>;
};

/** UI metadata lookup over one captured reader snapshot. UUID references and
 * source handles denote the same registered definition; catalog display names
 * never become identity keys. Server projections, including misses, remain
 * authoritative and no instance rows are installed or re-ranked here. */
export function createReaderPresentation(read: () => ReaderPresentationSource) {
  // Reader-local display transport, revalidated against every current raw
  // selection and frame before reuse. No account or source fact crosses frames.
  const projections = new Map<string, { frame: EvaluateContext; facts: ReaderPresentationSnapshotFacts; value: ReaderPresentation }>();
  const aliases = (source: ReaderPresentationSource, id: string) => {
    const registry = source.registry;
    const entry = source.catalog.flatMap((section) => section.entries).find((candidate) => candidate.id === id);
    const target = entry?.fn?.id ?? entry?.entity?.id ?? id;
    const fn = registry.getFunction(target);
    const entity = registry.getIdentifiedEntity(target);
    // Type constructors also expose callable projections. Their presentation
    // belongs to the identified type, before the callable projection's UUID.
    // Admit the source alias only when it resolves to this exact type owner.
    const owner = entity && registry.getEntityNominalIdentity(target);
    const typeTarget = owner && registry.getEntityNominalIdentity(entity.id) === owner ? entity.id : undefined;
    return [...new Set([typeTarget, owner,
      fn && (registry.getUuid(fn.id) ?? fn.id), fn?.id, id, target, registry.getUuid(target)]
      .filter((handle): handle is string => !!handle))];
  };
  const metadataFor = (source: ReaderPresentationSource, ids: readonly string[]) => {
    for (const id of ids) {
      const projected = source.metadata?.get(id);
      if (projected !== undefined) return { target: id, methods: projected };
    }
    return undefined;
  };
  const entryFor = (source: ReaderPresentationSource, ids: readonly string[]): CatalogEntry | undefined => {
    const entries = source.catalog.flatMap((section) => section.entries);
    for (const id of ids) {
      const entry = entries.find((candidate) => candidate.id === id);
      if (entry) return entry;
    }
    return entries.find((entry) => (entry.fn && ids.includes(entry.fn.id))
      || (entry.entity && ids.includes(entry.entity.id)));
  };
  const scopedSelection = (source: ReaderPresentationSource, ids: readonly string[], typeName: string) => {
    const frame = source.session.evaluateContext;
    if (!frame._specRegistry) return undefined;
    for (const handle of ids) {
      const instance = resolveEffect(frame, frame._specRegistry, typeName, handle);
      if (instance) return instance;
    }
    return undefined;
  };
  // A Labelable's label lifted onto its row by the loader reads back as a method.
  const scopedMethods = (source: ReaderPresentationSource, ids: readonly string[], typeName: string) =>
    selectedRepresentationMethods(typeName, scopedSelection(source, ids, typeName));
  const ownPresentation = (source: ReaderPresentationSource, id: string, methods: ReadonlyMap<string, Record<string, unknown>>,
    iconKey: unknown): ReaderPresentation => {
    const frame = source.session.evaluateContext;
    const facts: ReaderPresentationSnapshotFacts = {
      label: methods.get("Labelable")?.label as LocaleString | undefined,
      description: methods.get("Describable")?.description as LocaleString | undefined,
      codeName: methods.get("Codeable")?.codeName as LocaleString | undefined,
      icon: methods.get("Iconable")?.icon as string | undefined,
      emoji: methods.get("Emojiable")?.emoji as string | undefined,
      picture: methods.get("Picturable")?.picture,
      iconKey,
    };
    const previous = projections.get(id);
    if (previous?.frame === frame && Object.keys(facts).every(key =>
      facts[key as keyof ReaderPresentationSnapshotFacts] === previous.facts[key as keyof ReaderPresentationSnapshotFacts])) return previous.value;
    const value = ownPresentationFromReaderSnapshot(frame, methods, iconKey);
    projections.set(id, { frame, facts, value });
    return value;
  };
  const presentationFor = (source: ReaderPresentationSource, id: string): ReaderPresentation | undefined => {
    const ids = aliases(source, id);
    const projected = metadataFor(source, ids);
    if (projected !== undefined) {
      const own = source.ownPresentations?.get(projected.target);
      if (own !== undefined) return own;
      // An older inert transport has no selected-key provenance. Its name
      // remains useful; it cannot supply an own data icon from a type default.
      return ownPresentation(source, id, projected.methods, undefined);
    }
    const row = [...(source.functionRows ?? []), ...(source.types ?? [])].find((item) =>
      ids.some((handle) => item.function?.id === handle || item.id === handle || item.name === handle));
    const entry = row ? undefined : entryFor(source, ids);
    const icon = scopedSelection(source, ids, "Iconable");
    // B3: the selected row's $pattern representation is a key transport fact,
    // rather than a new matching rule. Lexical rows retain their own source.
    const key: unknown = icon?.source.kind === "instance" ? icon.source.instance.args[0] : icon?.source.frame.args[0];
    const methods = new Map<string, Record<string, unknown>>();
    for (const typeName of ["Labelable", "Describable", "Codeable", "Emojiable", "Picturable"]) {
      const selected = scopedMethods(source, ids, typeName);
      if (selected) methods.set(typeName, selected);
    }
    // Explicit inert row facets are transport of their source facts. A row's
    // lookup name remains only the final label fallback, after Codeable.
    if (!methods.has("Labelable") && row?.label !== undefined) methods.set("Labelable", { label: row.label });
    if (!methods.has("Describable") && row?.description !== undefined) methods.set("Describable", { description: row.description });
    if (!methods.has("Codeable") && row?.codeName !== undefined) methods.set("Codeable", { codeName: row.codeName });
    if (!methods.has("Emojiable") && row?.emoji !== undefined) methods.set("Emojiable", { emoji: row.emoji });
    if (icon) methods.set("Iconable", icon.methods);
    if (!row && !entry && methods.size === 0) return undefined;
    const own = ownPresentation(source, id, methods, key);
    return { ...own,
      label: own.label ?? row?.name ?? entry?.name,
      description: own.description ?? entry?.description,
    };
  };
  return {
    catalogEntry(id: string) {
      const source = read();
      return entryFor(source, aliases(source, id));
    },
    presentation(id: string): ReaderPresentation | undefined {
      return presentationFor(read(), id);
    },
    ownIcon(id: string): string | undefined {
      return presentationFor(read(), id)?.icon;
    },
    representation(typeName: string, id: string): Record<string, unknown> | undefined {
      const source = read();
      const ids = aliases(source, id);
      const projected = metadataFor(source, ids);
      if (projected !== undefined) return projected.methods.get(typeName);
      return scopedMethods(source, ids, typeName);
    },
  };
}

type TypePresentationSession = Pick<AuthoringSession, "registry" | "environment" | "evaluateContext">;
type TypePresentationReader = Pick<ReturnType<typeof createReaderPresentation>, "presentation" | "representation">;

export type SourceReaderValueReadInput = {
  value: unknown;
  type?: FenelType;
  observedType?: FenelType;
  compact?: boolean;
  thumbnail?: boolean;
  templateOnly?: boolean;
  typeLookup: "registry" | "session";
  views: readonly TypeView[];
  componentNames: readonly string[];
};
export type SourceReaderValueNodePlan = {
  valueType?: FenelType;
  displayType?: FenelType;
  nominal?: string;
  reflectedIdentity?: string;
  field: FieldDef;
  fields?: FieldDef[];
  /** B4 F1: per declared field, in `fields` order, its stored wire key and
   * shown name (`typed-read-field-slots.ts`), from this registry's field
   * representations, so a Local render reads no page registry. */
  fieldSlots?: Array<{ wire: string; name: DisplayName }>;
  body: "held-type" | "callable-type" | "optional" | "preview" | "collection" | "string" | "scalar" | "structural";
  structure: "record" | "array" | "leaf";
  /** Fenel policy over the collection's declared element, never sibling names. */
  contentFirst?: boolean;
  recordLabel: string;
  heldType?: FenelType;
  callableType?: FenelType;
  optional?: { type: FenelType; present: boolean; key: "_0" };
  numeric: boolean;
  view?: TypeView;
  useLayout: boolean;
  icon?: string;
  thumbnailIcon?: string;
  glyph: { picture?: ReaderGlyphPicture; icon?: string; emoji?: string };
  scalarPlan?: SurfaceReadValuePlan;
  readPlan: SurfaceReadValuePlan | null;
  layoutPlan?: SurfaceLayoutRenderPlan;
  typePresentation?: FunctionCardType<FenelType>;
  caption?: DisplayNameInput;
  ownPresentation?: ReaderPresentation;
};
export type SourceReaderValueChildPlan = {
  key: string | number;
  path: readonly (string | number)[];
  label: string;
  declaredType?: FenelType;
  type?: FenelType;
  typeLabel: string;
  typeIcon: string;
  caption?: DisplayNameInput;
  ownPresentation?: ReaderPresentation;
  glyph: { picture?: ReaderGlyphPicture; icon?: string; emoji?: string };
};
export type SourceReaderValueReadPacket = {
  root: SourceReaderValueNodePlan;
  children: SourceReaderValueChildPlan[];
};

/** B3 captured-reader binding. Source chooses identities, type normalization,
 * display branches, physical child slots and glyph precedence. This adapter
 * supplies exact declaration/representation observations and reattaches the
 * untouched raw types and fields selected by their packet-local tokens. */
export function projectReaderValueReadInSession(args: SourceReaderValueReadInput,
  session: TypePresentationSession,
  source: Pick<ReaderPresentationSource, "catalog" | "types" | "functionRows" | "metadata" | "ownPresentations">,
  knownIconNames: readonly string[],
  /** Host scheduling only: the authoritative worker opens its existing S1
   * private snapshot partition for this one physical observation. */
  physicalPreviewScope?: (operation: () => boolean) => boolean): SourceReaderValueReadPacket {
  const registry = session.registry, frame = session.evaluateContext;
  const capturedReader = createReaderPresentation(() => ({ ...source, registry, session }));
  // Completed host observations belong only to this synchronous captured frame.
  // Exact handles/raw witnesses are keys; missing results are observations too.
  const presentations = new Map<string, ReaderPresentation | undefined>();
  const representations = new Map<string, Map<string | FenelType, Record<string, unknown> | undefined>>();
  const methods = (className: string, target: string | FenelType | undefined) => {
    if (target === undefined) return undefined;
    let rows = representations.get(className);
    if (!rows) { rows = new Map(); representations.set(className, rows); }
    if (!rows.has(target)) rows.set(target, typeof target === "string"
      ? capturedReader.representation(className, target)
      : frame._specRegistry ? resolveEffect(frame, frame._specRegistry, className, target)?.methods : undefined);
    return rows.get(target);
  };
  const reader: TypePresentationReader = {
    presentation(id) {
      if (!presentations.has(id)) presentations.set(id, capturedReader.presentation(id));
      return presentations.get(id);
    },
    representation: methods,
  };
  const labels = new Map<FenelType | undefined, string>();
  const label = (type: FenelType | undefined) => {
    if (!labels.has(type)) labels.set(type, readerTypeLabelInSession(type, session, reader));
    return labels.get(type)!;
  };
  const call = <T,>(name: string, values: unknown[]): T => dispatchEngineBody(`engine:${name}`, values, frame) as T;
  const maybe = <T,>(value: T | undefined): Maybe<T> => value === undefined ? Nothing : Just(value);
  const read = <T,>(value: Maybe<T>): T | undefined => peelMaybeValue(value) ?? undefined;
  const fields = new Map<string, FieldDef>();
  const wires = new Map<unknown, unknown>();
  let ordinal = 0;
  const wire = (type: FenelType): unknown => {
    if (wires.has(type)) return wires.get(type);
    const batch = marshalTraversalDeclarationType(type, `value-read-${ordinal++}`, { graftMissingSemanticKeys: false });
    wires.set(type, batch.type);
    for (const [token, field] of batch.fields) fields.set(token, field);
    return batch.type;
  };
  type TypeNode = { raw: FenelType };
  type TypeFact = { name: string; type: Maybe<unknown>; reference: unknown };
  const facts = new Map<string, TypeFact>();
  const observeTypes = (names: readonly string[]) => {
    for (const name of names) if (!facts.has(name)) {
      const type = registry.getIdentifiedEntity(name)?.type
        ?? (args.typeLookup === "session" ? session.environment.resolveTypeRef?.({ $ref: name }) : undefined);
      facts.set(name, { name, type: maybe(type === undefined ? undefined : wire(type)), reference: wire({ $ref: name }) });
    }
  };
  type Types = { queries: string[]; nominal: Maybe<string>; valueType: Maybe<TypeNode>; displayType: Maybe<TypeNode>;
    resolved: Maybe<TypeNode>; optional: Maybe<TypeNode>; callable: Maybe<FenelType>; universe: boolean; numeric: boolean;
    fieldTokens: Maybe<string[]> };
  const typesFor = (value: unknown, declared?: FenelType, observed?: FenelType) => {
    const reflected = call<Maybe<string>>("surfaceReaderReflection", [value, frame._caseOwner ?? {}]);
    const input = [maybe(declared === undefined ? undefined : wire(declared)), maybe(observed === undefined ? undefined : wire(observed)), reflected];
    let plan: Types;
    do {
      plan = call<Types>("surfaceReaderValueTypesPlan", [...input, [...facts.values()]]);
      observeTypes(plan.queries);
    } while (plan.queries.length);
    return { plan, reflected };
  };
  const icons = new Map<FenelType | undefined, Map<string | undefined, string>>();
  const iconFor = (type: FenelType | undefined, reflected: Maybe<string>) => {
    const reflectedName = read(reflected);
    let rows = icons.get(type);
    if (!rows) { rows = new Map(); icons.set(type, rows); }
    if (rows.has(reflectedName)) return rows.get(reflectedName)!;
    const request = call<{ target: Maybe<string | FenelType>; identity: Maybe<string>; declared: Maybe<string>; kind: Maybe<string> }>(
      "surfaceReaderIconTarget", [maybe(type === undefined ? undefined : wire(type)), reflected]);
    const target = read(request.target), identity = read(request.identity);
    const scoped = maybe(methods("Iconable", target)?.icon);
    const fallback = read(call<Maybe<string>>("surfaceReaderIconFallbackTarget", [request, scoped]));
    const icon = call<string>("surfaceReaderIconPlan", [request, scoped,
      maybe(methods("Iconable", fallback)?.icon), maybe(identity === undefined ? undefined : registry.getIdentifiedEntity(identity)?.id ?? identity),
      knownIconNames, typeIconFallbacks]);
    rows.set(reflectedName, icon);
    return icon;
  };
  const ownFor = (value: unknown) => {
    const reference = read(call<Maybe<string>>("surfaceReaderReference", [value]));
    const own = reference === undefined ? undefined : reader.presentation(reference);
    // A bare constructor is named by its own Labelable, keyed by its tag, the
    // key its glyph uses (`_ : Labelable "SolanumLycopersicum"`); never its type's.
    const tag = reference === undefined ? bareConstructorTag(value) : undefined;
    const label = own?.label ?? (tag === undefined ? undefined : constructorLabel(frame, tag));
    // An authored label reads as a label even when it equals the code name
    // (display-name.ts presentedDisplayName); the rest is the Fenel caption rule.
    const authored = own?.labelAuthored ? valueCardLabel(own.label)?.trim() : undefined;
    const caption = authored ? { text: valueCardLabel(own!.label)!, code: false }
      : read(call<Maybe<DisplayNameInput>>("surfaceReaderCaption", [maybe(label), maybe(own?.codeName)]));
    return { own, caption };
  };
  const glyphFor = (value: unknown, reflected: Maybe<string>, nominal: Maybe<string>, enabled = true) => {
    const keys = call<string[]>("surfaceReaderDemandedGlyphKeys", [enabled, value, reflected, nominal]);
    const glyph = call<{ picture: Maybe<ReaderGlyphPicture>; icon: Maybe<string>; emoji: Maybe<string> }>("surfaceReaderGlyphPlan", [keys.map(key => ({
      picture: maybe(methods("Picturable", key)?.picture), icon: maybe(methods("Iconable", key)?.icon), emoji: maybe(methods("Emojiable", key)?.emoji),
    })), knownIconNames]);
    return { picture: read(glyph.picture), icon: read(glyph.icon), emoji: read(glyph.emoji) };
  };
  const { plan: types, reflected } = typesFor(args.value, args.type, args.observedType);
  const nominal = read(types.nominal), valueType = read(types.valueType)?.raw, displayType = read(types.displayType)?.raw;
  // Native carrier observation is host-runtime B3; the source owns precedence
  // with file, image and markup data. No native object crosses as a callable.
  const binary = args.value instanceof ArrayBuffer || ArrayBuffer.isView(args.value);
  // Deliberate physical-scope correction: this source helper classifies
  // carrier data only. Reader overrides do not redefine physical shape;
  // scoped dispatch, dependent types and layout retain their current frame.
  const physicalPreview = () => dispatchEngineBody("engine:surfaceReaderHasPreview", [args.value, binary]) as boolean;
  const preview = physicalPreviewScope ? physicalPreviewScope(physicalPreview) : physicalPreview();
  const body = call<{ body: SourceReaderValueNodePlan["body"]; structure: SourceReaderValueNodePlan["structure"];
    recordLabel: string; recordCarrier: boolean; held: boolean; present: boolean }>("surfaceReaderBodyPlan", [args.value, types,
      call<boolean>("surfaceReaderTypeLike", [args.value]), preview]);
  const tokens = read(types.fieldTokens);
  const selectedFields = tokens?.map(token => {
    const field = fields.get(token);
    if (!field) throw new Error("This reader's field projection is unavailable.");
    return field;
  });
  const selection = surfaceReaderViewPlan({ views: args.views, componentNames: args.componentNames,
    methods: methods("Viewable", nominal), compact: !!args.compact,
    hasFields: selectedFields !== undefined, record: body.recordCarrier, evaluateContext: frame });
  const display = selection.view && read(selection.view.display);
  const readDisplay = display && read(display.read);
  const valueOwn = ownFor(args.value);
  const declared = maybe(args.type === undefined ? undefined : wire(args.type));
  const rootIconTarget = read(call<Maybe<string | FenelType>>("surfaceReaderRepresentationTarget", [types.nominal, declared]));
  const rootIcon = read(call<Maybe<string>>("surfaceReaderKnownIcon", [maybe(methods("Iconable", rootIconTarget)?.icon), knownIconNames]));
  const optionalType = read(types.optional);
  const root: SourceReaderValueNodePlan = {
    valueType, displayType, nominal, reflectedIdentity: read(reflected),
    field: { name: "value", type: call<FenelType>("surfaceReaderFieldType", [types.valueType, { $ref: "Any" }]), label: Nothing, meta: {}, ui: Nothing },
    fields: selectedFields,
    ...(selectedFields ? { fieldSlots: selectedFields.map(field => ({ wire: fieldWireKey(field, registry), name: fieldSlotName(field, registry) })) } : {}),
    body: body.body, structure: body.structure, recordLabel: body.recordLabel,
    heldType: body.held ? args.value as FenelType : undefined, callableType: read(types.callable),
    optional: optionalType ? { type: optionalType.raw, present: body.present, key: "_0" } : undefined,
    numeric: types.numeric, view: selection.view, useLayout: selection.useLayout,
    icon: rootIcon,
    thumbnailIcon: read(call<Maybe<string>>("surfaceReaderThumbnailIcon", [declared, types.nominal, iconFor(args.type, types.nominal)])),
    glyph: glyphFor(args.value, reflected, types.nominal, !!args.thumbnail),
    scalarPlan: body.body === "scalar" ? surfaceReadValuePlan(args.value, undefined, "scalar", frame) : undefined,
    readPlan: readDisplay ? surfaceReadValuePlan(args.value, readDisplay, "read-display", frame) : null,
    caption: valueOwn.caption, ownPresentation: valueOwn.own,
  };
  if (displayType !== undefined) {
    const target = call<{ target: Maybe<string | FenelType> }>("surfaceReaderIconTarget", [Just(wire(displayType)), Nothing]);
    const identity = read(target.target);
    const own = typeof identity === "string" ? reader.presentation(identity) : undefined;
    root.typePresentation = { type: displayType, label: label(displayType),
      ownIcon: own?.icon, ownEmoji: own?.emoji, icon: iconFor(displayType, Nothing) };
  }
  if (selection.useLayout && selection.view?.layout && selectedFields) root.layoutPlan = surfaceLayoutRenderPlan({
    environment: { registry, authoring: session.environment, catalog: { views: [...args.views], targetTypeOptions: [], componentNames: [...args.componentNames], defaultViewByTypeName: {} } },
    layout: selection.view.layout, fields: selectedFields, values: args.value as Record<string, unknown>, mode: "read",
    resolveTemplate: name => resolveSurfaceTypeView(args.views, name, frame), evaluateContext: frame,
  });
  let shape = valueType;
  if (shape !== undefined) {
    const seen = new Set<FenelType>();
    for (let depth = 0; depth < 32 && !seen.has(shape); depth++) {
      seen.add(shape);
      let queries: string[];
      do {
        queries = call<string[]>("surfaceReaderTypeQueries", [wire(shape), [...facts.values()], []]);
        observeTypes(queries);
      } while (queries.length);
      const step: { type: TypeNode; dependent: Maybe<FenelType> } = call<{ type: TypeNode; dependent: Maybe<FenelType> }>("surfaceReaderTransferStep", [wire(shape), [...facts.values()], []]);
      shape = step.type.raw;
      const dependent: FenelType | undefined = read(step.dependent);
      if (dependent === undefined) break;
      const next = scopedConcreteType(dependent, frame, session.environment, registry);
      if (next === undefined || next === dependent) break;
      shape = next;
    }
  }
  const listElement = shape === undefined ? undefined : peelListForAuthoring(shape)?.elem;
  if (listElement !== undefined) {
    let queries: string[];
    do {
      queries = call<string[]>("surfaceReaderTypeQueries", [wire(listElement), [...facts.values()], []]);
      observeTypes(queries);
    } while (queries.length);
  }
  root.contentFirst = call<boolean>("surfaceCollectionContentFirst", [
    maybe(listElement === undefined ? undefined : wire(listElement)), [...facts.values()],
  ]);
  const physical = preview ? [] : call<Array<{ key: string | number; label: string }>>("surfaceReaderPhysicalChildren", [args.value]);
  const tag = call<Maybe<string>>("surfaceReaderOwnString", [args.value, "$tag"]);
  const children = physical.map(child => {
    const value = Reflect.get(args.value as object, child.key);
    const declaredType = read(call<Maybe<FenelType>>("surfaceReaderChildTypePlan", [maybe(shape === undefined ? undefined : wire(shape)), maybe(listElement), child.key, tag, [...facts.values()]]));
    const childTypes = typesFor(value, declaredType);
    const type = read(childTypes.plan.displayType)?.raw;
    const own = ownFor(value);
    return { ...child, path: [child.key], declaredType, type,
      typeLabel: label(type), typeIcon: iconFor(type, childTypes.reflected),
      caption: own.caption, ownPresentation: own.own, glyph: glyphFor(value, childTypes.reflected, childTypes.plan.nominal) };
  });
  return { root, children };
}

/** Existing typed-reader formatting bound to its captured semantic owners.
 * The browser and worker share this adapter; card article normalization stays
 * with the renderer. A supplied reader's representation miss stays a miss. */
export function readerTypeLabelInSession(type: FenelType | undefined, session: TypePresentationSession,
  reader?: TypePresentationReader, fieldRegistry?: ModuleRegistry): string {
  const resultLabel = type && readerResultTypeLabel(type, {
    evaluateContext: session.evaluateContext,
    get referenceRoutes() { return session.environment.catalog.referenceRoutes; },
    get constructorRoutes() { return session.environment.catalog.exactConstructorRoutes; },
    get constructorTargets() { return session.environment.catalog.patternConstructors; },
  });
  if (resultLabel !== undefined) return resultLabel;
  const labelFor = (handle: string) => {
    const presentation = reader?.presentation(handle);
    const frame = session.evaluateContext;
    const methods = (name: string) => reader ? reader.representation(name, handle)
      : frame._specRegistry ? resolveEffect(frame, frame._specRegistry, name, handle)?.methods : undefined;
    return valueCardLabel(presentation?.label ?? methods("Labelable")?.label)
      || presentation?.codeName || valueCardLabel(methods("Codeable")?.codeName)
      || (fieldRegistry ?? session.registry).getIdentifiedEntity(handle)?.id || handle;
  };
  return (type ? typePhrase(speakableTypeVariables(type), labelFor) || typeCode(type, labelFor) : undefined) || "Anything";
}

/** In words, a type variable alone is a letter made plural: a graph node typed
 * `List a` read "List of as". Spoken, an unconstrained variable is
 * "anything" ("List of anything"); the Fenel code keeps the variable. Returns
 * the same object when the type has no variable. Display only. */
export function speakableTypeVariables(type: FenelType): FenelType {
  const walk = (value: unknown): unknown => {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) {
      const items = value.map(walk);
      return items.some((item, index) => item !== value[index]) ? items : value;
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 1 && keys[0] === "$var" && typeof record.$var === "string") return { $complement: { $void: true } };
    let changed = false;
    const entries = keys.map(key => {
      const next = walk(record[key]);
      if (next !== record[key]) changed = true;
      return [key, next] as const;
    });
    return changed ? Object.fromEntries(entries) : value;
  };
  return walk(type) as FenelType;
}

/** The same selected own glyph and type-default facts used by read cards.
 * Icon components remain in the browser; only their inert name roster is
 * needed to validate a selected Iconable value here. */
export function readerTypePresentationInSession(type: FenelType, session: TypePresentationSession,
  reader?: TypePresentationReader, fieldRegistry?: ModuleRegistry,
  knownIcons?: Readonly<Record<string, unknown>>): FunctionCardType<FenelType> {
  const registry = fieldRegistry ?? session.registry;
  const frame = session.evaluateContext;
  const target = presentedTypeTarget(type);
  const own = target ? reader?.presentation(target) : undefined;
  return { type, label: readerTypeLabelInSession(type, session, reader, fieldRegistry), ownIcon: own?.icon, ownEmoji: own?.emoji,
    icon: typeIconForPresentation(type, {
      icon: target => typeof target === "string" && reader ? reader.representation("Iconable", target)?.icon
        : frame._specRegistry ? resolveEffect(frame, frame._specRegistry, "Iconable", target)?.methods.icon : undefined,
      canonicalName: identity => registry.getIdentifiedEntity(identity)?.id ?? identity,
      knownIcons,
    }) };
}

export type ReaderTypePreviewPacket = {
  root: FenelType;
  rows: Array<{ type: FenelType; description: LocusTypeDescription; presentation: FunctionCardType<FenelType>;
    /** In the same order as this row's previewShape variant cases. */
    caseRecords?: FenelType[] }>;
  fieldLabels: Array<{ field: FieldDef; label: string }>;
};

/** A2/B3 packet construction over the existing Fenel syntax traversal and
 * reader projectors. Object identity is only packet-local graph bookkeeping;
 * it is not type equality, a registry cache, or checking evidence. Local's
 * worker supplies its exact admitted source rows, frame and definition reader. */
export function projectReaderTypePreviewInSession(type: FenelType, session: TypePresentationSession,
  typeLookup: "registry" | "session",
  source: Pick<ReaderPresentationSource, "catalog" | "types" | "functionRows">,
  knownIcons: readonly string[]): ReaderTypePreviewPacket {
  const registry = session.registry;
  const reader = createReaderPresentation(() => ({ ...source, registry, session }));
  const iconNames = Object.fromEntries(knownIcons.map(name => [name, true]));
  const resolveType = (name: string) => registry.getIdentifiedEntity(name)?.type
    ?? (typeLookup === "session" ? session.environment.resolveTypeRef?.({ $ref: name }) : undefined);
  const printSource = {
    evaluateContext: session.evaluateContext,
    get referenceRoutes() { return session.environment.catalog.referenceRoutes; },
    get constructorRoutes() { return session.environment.catalog.exactConstructorRoutes; },
    get constructorTargets() { return session.environment.catalog.patternConstructors; },
  };
  const packet: ReaderTypePreviewPacket = { root: type, rows: [], fieldLabels: [] };
  const queued = new Set<FenelType>([type]);
  const pending = [type];
  const projectedFields = new Set<FieldDef>();
  const descriptionsByNode = new Map<FenelType, LocusTypeDescription>();
  const observedSyntaxNodes = new Set<FenelType>();
  // One direct $ref denotes the same captured declaration throughout this
  // request. Reuse its observation when a resolver materializes fresh carrier
  // objects; these are source bindings, not structural type-equality keys.
  const referenceDescriptions = new Map<string, LocusTypeDescription>();
  const casesByShape = new Map<FenelType, FenelType[]>();
  const enqueue = (nodes: readonly FenelType[]) => {
    for (const node of nodes) if (!queued.has(node)) { queued.add(node); pending.push(node); }
  };
  const syntaxNodes = (node: FenelType): FenelType[] => {
    // A prior Fenel plan already supplied this exact raw subtree's descendants.
    // Its one-node carrier is sufficient for the per-row wire slots below.
    if (observedSyntaxNodes.has(node)) return [node];
    const marshalled = marshalTraversalType(node) as { invalid?: boolean };
    if (marshalled.invalid === true) throw new TypeError("This type preview has an invalid type carrier.");
    // The public walkType adapter requires admitted field identities. Draft
    // previews also contain unkeyed fields: like typeDataPreviewDetails, this
    // syntax-only projection invokes the SAME Fenel walker without asserting
    // semantic admission. The explicit reader frame remains in force.
    const nodes = dispatchEngineBody("engine:walkTypePlan", [marshalled, []], session.evaluateContext) as FenelType[];
    for (const supplied of nodes) observedSyntaxNodes.add(supplied);
    return nodes;
  };
  for (let index = 0; index < pending.length; index++) {
    const node = pending[index]!;
    const originalNodes = syntaxNodes(node);
    const observed = "$ref" in node ? referenceDescriptions.get(node.$ref) : undefined;
    let description = observed ? { ...observed, type: node } : descriptionsByNode.get(node);
    if (!description) {
      // The owner already describes nested fields and arrow returns. Retain
      // every exact raw-node observation, instead of recomputing and discarding
      // those descendants for each later row of this same packet.
      for (const supplied of projectReaderTypeDescriptions({ type: node }, printSource, undefined, undefined, resolveType)) {
        if (!descriptionsByNode.has(supplied.type)) descriptionsByNode.set(supplied.type, supplied);
        if ("$ref" in supplied.type && !referenceDescriptions.has(supplied.type.$ref))
          referenceDescriptions.set(supplied.type.$ref, supplied);
      }
      description = descriptionsByNode.get(node);
    }
    if (!description || description.type !== node) throw new Error("This type description is unavailable.");
    if ("$ref" in node && !observed) referenceDescriptions.set(node.$ref, description);
    const shape = description.previewShape ?? node;
    const shapeNodes = shape === node ? originalNodes : syntaxNodes(shape);
    let caseRecords = casesByShape.get(shape);
    if (!caseRecords && "$variant" in shape && shape.$variant.cases.length !== 1) {
      caseRecords = shape.$variant.cases.map(entry => ({ $record: { fields: entry.fields ?? [] } }));
      casesByShape.set(shape, caseRecords);
    }
    packet.rows.push({ type: node, description,
      presentation: readerTypePresentationInSession(node, session, reader, registry, iconNames),
      ...(caseRecords === undefined ? {} : { caseRecords }),
    });
    // These $-key branches carry existing wire slots, not a competing recursive
    // type walker. Fenel supplies all structural descendants, including returns.
    for (const carrier of [...originalNodes, ...shapeNodes]) {
      const fields = "$record" in carrier ? carrier.$record.fields : "$variant" in carrier
        ? carrier.$variant.cases.flatMap(entry => entry.fields ?? []) : "$arrow" in carrier ? carrier.$arrow.params : [];
      for (const field of fields) if (!projectedFields.has(field)) {
        projectedFields.add(field);
        const label = field.key?.$tag === "NamedField"
          ? valueCardLabel(registry.getFieldRepresentation("Labelable", field.key.ref.$ref)?.methods.label) || field.name : field.name;
        packet.fieldLabels.push({ field, label });
      }
    }
    // The renderer binds the original type to its observed shape; describing
    // the fresh shape root again could unfold another equivalent carrier
    // indefinitely. Its displayed descendants still use the same Fenel plan.
    enqueue(originalNodes.slice(1));
    if (shape !== node) enqueue(shapeNodes.slice(1));
    if (caseRecords) enqueue(caseRecords);
  }
  return packet;
}
