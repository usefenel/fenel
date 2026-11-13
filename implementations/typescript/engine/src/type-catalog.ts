import { observeOwnerFullCatalogueRead } from "./owner-input-producer-state";
// ---------------------------------------------------------------------------
// Type Catalog — browsable registry of the entire FenelType system
//
// Organizes all types into categories for the /dashboard/types page:
//   Atoms      — String, Number, Boolean, Date
//   Foundation — Unit/Void/Bool ADT, Char, NonEmptyStr, number tower (ℕ⊂ℤ⊂ℚ),
//                refined integers (PositiveNat, NonNegInt), Pair/Tagged/Refined,
//                Timestamp, Path ADT pieces — the algebraic primitives that
//                build everything else
//   Formats    — email, phone, URL, UUID, handle, postal code
//   Units      — mass, distance, volume, time, area, temperature, currency
//   Composites — list, record, union, maybe
//   References — ref to any entity type
//   Entities   — profile, item, plan, country, etc.
//   Interfaces  — PhoneFormat, AddressFormat, HandleFormat, Labelable, …
//   Generics   — Group<T>, Vec<T, n>, LengthBoundedString, Sigma
// ---------------------------------------------------------------------------

import type { SetExpr, FenelType, Interface, Instance, TypeConstructor, TypeConstructorParam, FenelFunction, LocaleString, TypeScheme } from "./types";
import type { ModuleRegistry } from "./registry";
import { engineRequire } from "./engine-require";
import type { FenelModule } from "./types";
// registry-unification Phase 1 — the seed/catalog module list is no longer
// hand-maintained here. It derives from the ONE role-tagged manifest, so it can
// never again drift out of lockstep with the durable-execute list (the
// `dashboard`-missing prod-down bug, `ec3c46be`). The `execute ⊆ seed` invariant
// is guarded by `module-manifest.test.ts`.
import { modulesFor } from "./module-manifest";

const ALL_MODULES: FenelModule[] = modulesFor("seed");
import type { UnitFamily } from "./units";
import { unitFamilies } from "./units";
import {
  systemEntities,
  specEntities,
  isDispatchClassEntity,
  dispatchRegistry,
} from "./system-entities";
import {
  dispatchedGetLabel as getLabel,
  dispatchedGetDescription as getDescription,
  dispatchedGetCodeName as getCodeName,
  dispatchedGetTags as getTags,
  dispatchedCatalogueDescription as catalogueDescription,
  // Phase 3j (module-substrate) — read-time display fallbacks. The loader no
  // longer auto-stamps a humanized-codeName Labelable / module-name
  // Categorizable on every function, so the function-catalog name + category
  // reads route through these to keep the humanized / module-prefix fallback at
  // display time (no blank, no raw lowercase codeName).
  dispatchedDisplayLabel as displayLabel,
  dispatchedDisplayCategory as displayCategory,
} from "./engine-bodies-dispatch";
import {
  phoneFormat,
  addressFormat,
  handleFormat,
  exchangeRate,
  deriveExchangeRateInstances,
} from "./entity-typeclasses";
// Phase 3.3d — Phone/Handle derived instances are Fenel-bodied (modules/formats);
// the catalog reads them for its display counts via the same memoised wrappers.
import { derivePhoneInstances, deriveHandleInstances } from "./modules/formats";
import { countries, currencies, platforms } from "./reference-data";
import { loadFenelModule } from "./fenel-module";
import {
  REPOSITORY_IDENTITY_MANIFEST,
  repositoryIdentityKinds,
  repositoryIdentityLock,
} from "./repository-identity-manifest";
import { repositoryFieldFacetModule } from "./repository-field-facet-module";
import formatsInstancesSrc from "../../../../fenel/modules/formats/instances.fenel?raw";

// ---------------------------------------------------------------------------
// Catalog types
// ---------------------------------------------------------------------------

export type TypeCategory =
  | "atom"
  | "foundation"
  | "format"
  | "unit"
  | "composite"
  | "entity"
  | "interface"
  | "constructor"
  | "function";

export type CatalogEntry = {
  /** Unique identifier within the catalog */
  id: string;
  /** Display name */
  name: LocaleString;
  /** Brief description */
  description: LocaleString;
  /** Category for grouping */
  category: TypeCategory;
  /** Optional subcategory for further grouping (e.g. "global" entities) */
  subcategory?: string;
  /** The SetExpr constraint that defines this type (for formats) */
  set?: SetExpr;
  /** For entities (concrete and parametric): the registration shape from
   *  `systemEntities`. Concrete entries have `type`; parametric entries
   *  have `params` (and optionally `type` referencing `params` via `$var`,
   *  or `instantiate` for runtime entity-generating constructors). */
  entity?: { id: string; type?: FenelType; params?: TypeConstructorParam[] };
  /** For typeclasses: the class definition */
  typeclass?: Interface;
  /** For typeclasses: the instances */
  instances?: Instance[];
  /** For constructors: the constructor definition */
  typeCtor?: TypeConstructor;
  /** For units: the dimension */
  dimension?: UnitFamily;
  /** Generated from (for Group<T> instances) */
  generatedFrom?: string;
  /** Number of instances (for typeclasses) */
  instanceCount?: number;
  /** For functions: the FenelFunction */
  fn?: FenelFunction;
  /** Authoritative registry-local function scheme paired with `fn`. */
  scheme?: TypeScheme;
  /** Tags for searchability */
  tags?: string[];
};

export type CatalogSection = {
  id: TypeCategory;
  label: LocaleString;
  description: LocaleString;
  entries: CatalogEntry[];
};

// ---------------------------------------------------------------------------
// Build the catalog
// ---------------------------------------------------------------------------

export function buildCatalog(functionRegistry?: ModuleRegistry): CatalogSection[] {
  observeOwnerFullCatalogueRead("buildCatalog");
  return [
    buildAtoms(),
    buildFoundation(),
    buildFormats(),
    buildUnits(),
    buildComposites(),
    buildFunctions(functionRegistry),
    buildEntities(functionRegistry),
    buildInterfaces(),
    buildGenerics(),
  ];
}

// -- Atoms --

function buildAtoms(): CatalogSection {
  return {
    id: "atom",
    label: "Atoms",
    description: "The four raw primitives — everything else is built from these",
    entries: [
      {
        id: "string",
        name: "String",
        description: "Text value — constrained by format, pattern, or enum",
        category: "atom",
        tags: ["text", "primitive"],
      },
      {
        id: "number",
        name: "Number",
        description: "Numeric value — constrained by interval, integer, natural",
        category: "atom",
        set: { $tag: "SeRef", handle: "ℝ" },
        tags: ["numeric", "primitive"],
      },
      {
        id: "boolean",
        name: "Boolean",
        description: "True or false",
        category: "atom",
        tags: ["flag", "primitive"],
      },
      {
        id: "date",
        name: "Date/Time Interval",
        description: "Calendar date or datetime — constrained by interval",
        category: "atom",
        tags: ["temporal", "primitive"],
      },
    ],
  };
}

// -- Foundation --
//
// Algebraic primitives surfaced from `type-foundation.ts`: the number tower
// (ℕ ⊂ ℤ ⊂ ℚ ⊂ ℝ), refined-integer presets (PositiveNat, NonNegInt),
// non-empty strings, the Unit/Void/Bool/Char ADTs, and the structural
// constructors used to build sets, paths, and timestamps. These are the
// "building blocks of the building blocks" — most user types refine or
// combine these rather than referencing them directly.

function buildFoundation(): CatalogSection {
  return {
    id: "foundation",
    label: "Foundation",
    description: "Algebraic primitives — number tower, ADTs, refined integers, structural constructors",
    entries: [
      // Number tower
      {
        id: "natural",
        name: "Natural (ℕ)",
        description: "Non-negative integer — ℤ ∩ [0, ∞)",
        category: "foundation",
        set: { $tag: "SeRef", handle: "ℕ" },
        tags: ["numeric", "number-tower"],
      },
      {
        id: "integer",
        name: "Integer (ℤ)",
        description: "Whole number — a number where value = floor(value)",
        category: "foundation",
        set: { $tag: "SeRef", handle: "ℤ" },
        tags: ["numeric", "number-tower"],
      },
      {
        id: "rational",
        name: "Rational (ℚ)",
        description: "Exact ratio num/den, lowest terms — no IEEE 754 precision loss",
        category: "foundation",
        set: { $tag: "SeRef", handle: "ℚ" },
        tags: ["numeric", "number-tower", "exact"],
      },
      {
        id: "real",
        name: "Real (ℝ)",
        description: "Finite real number (machine float)",
        category: "foundation",
        set: { $tag: "SeRef", handle: "ℝ" },
        tags: ["numeric", "number-tower"],
      },
      {
        id: "positive-nat",
        name: "PositiveNat",
        description: "Natural number > 0 — refined integer preset",
        category: "foundation",
        tags: ["numeric", "refined", "preset"],
      },
      {
        id: "non-neg-int",
        name: "NonNegInt",
        description: "Integer ≥ 0 — refined integer preset",
        category: "foundation",
        tags: ["numeric", "refined", "preset"],
      },
      // Algebraic ADTs
      {
        id: "void",
        name: "Void",
        description: "The empty type — no inhabitants. Used for impossible cases.",
        category: "foundation",
        tags: ["adt", "empty"],
      },
      {
        id: "unit",
        name: "Unit",
        description: "The single-inhabitant type. Used as 'no payload' marker on variants.",
        category: "foundation",
        tags: ["adt", "trivial"],
      },
      {
        id: "bool-adt",
        name: "Bool (ADT)",
        description: "Two-constructor sum type: True | False — the structural sibling of Boolean.",
        category: "foundation",
        tags: ["adt", "sum-type", "boolean"],
      },
      {
        id: "char",
        name: "Char",
        description: "A single Unicode codepoint. Strings are List<Char>.",
        category: "foundation",
        tags: ["text", "unicode"],
      },
      {
        id: "non-empty-str",
        name: "NonEmptyStr",
        description: "Refined String of length ≥ 1",
        category: "foundation",
        tags: ["text", "refined", "preset"],
      },
      // Structural constructors
      {
        id: "pair",
        name: "Pair<A, B>",
        description: "Two-field record { fst: A, snd: B } — the ground form for tuples",
        category: "foundation",
        tags: ["product", "tuple", "constructor"],
      },
      {
        id: "tagged",
        name: "Tagged<T, Phantom>",
        description: "Phantom-typed wrapper over T — Id<\"profile\">, Currency-tagged amounts, unit-tagged numbers",
        category: "foundation",
        tags: ["phantom", "constructor"],
      },
      {
        id: "refined",
        name: "Refined<T, Set>",
        description: "Subtype of T whose values inhabit Set — the foundation of every constraint",
        category: "foundation",
        tags: ["constraint", "constructor"],
      },
      {
        id: "path-segment",
        name: "PathSegment",
        description: "ADT case used by the Path ADT: Empty | Dot | DotDot | Name<NonEmptyStr>",
        category: "foundation",
        tags: ["filesystem", "path", "adt"],
      },
      {
        id: "path-root",
        name: "PathRoot",
        description: "ADT: PosixRoot | DriveRoot<DriveLetter> | UncRoot<NonEmptyStr, NonEmptyStr>",
        category: "foundation",
        tags: ["filesystem", "path", "adt"],
      },
      // Image / pixel data — proper structural types, not refined strings.
      // RgbaPixel is the raster encoding; Color is a positive frequency.
      // Image stores List<RgbaPixel> in row-major order. Storybook renders it
      // through a canvas widget, image-processing functions transform the
      // matrix directly.
      {
        id: "color",
        name: "Color",
        description: "Positive finite light frequency in hertz. Spectra carry weighted mixtures; opacity belongs to composition.",
        category: "foundation",
        entity: { id: "Color" },
        tags: ["media", "visual", "color"],
      },
      {
        id: "rgba-pixel",
        name: "RgbaPixel",
        description: "RGBA raster encoding — r/g/b/a byte channels, with alpha as encoded coverage. This is display data; Color is frequency data.",
        category: "foundation",
        entity: { id: "RgbaPixel" },
        tags: ["media", "visual", "pixel", "encoding"],
      },
      {
        id: "image",
        name: "Image",
        description: "Encoded raster image — width, height and row-major List RgbaPixel. Spectral source remains separate from display projection.",
        category: "foundation",
        entity: { id: "Image" },
        tags: ["media", "visual", "raster"],
      },
      // Picture / Sound / Animation / Movie / Track / Event / Game —
      // signal-based media types. Picture is Raster | Field; the rest
      // mirror its shape over different (domain, codomain) pairs. See
      // implementations/typescript/engine/src/modules/{picture,sound,animation,movie,track,events,games}.ts
      // for the math definitions; sample-media.ts ships pre-rendered
      // Exemplifiable values that the storybook visualises directly.
      {
        id: "point",
        name: "Point",
        description: "2D coordinate — record { x: Number, y: Number }. Used as the domain of Picture and most spatial operations.",
        category: "foundation",
        tags: ["media", "spatial"],
      },
      {
        id: "picture",
        name: "Picture",
        description: "Raster graphics as math: Raster Image | Field (Point -> RgbaPixel). Sampling and rendering operate on explicit pixel encodings; frequency/spectrum conversion uses an explicit profile.",
        category: "foundation",
        tags: ["media", "visual", "vector", "signal"],
      },
      {
        id: "time",
        name: "Time",
        description: "Temporal coordinate — record { seconds: Number }. The 1D analogue of Point; domain of Sound, Animation, Movie, Behavior.",
        category: "foundation",
        tags: ["media", "temporal"],
      },
      {
        id: "amplitude",
        name: "Amplitude",
        description: "Stereo audio sample — record { l: Number, r: Number } where each is in [-1, 1]. The codomain of Sound.",
        category: "foundation",
        tags: ["media", "audio"],
      },
      {
        id: "audio-buffer",
        name: "AudioBuffer",
        description: "Sampled PCM audio — record { sampleRate: Number, channels: Number, samples: List(Amplitude) }. Concrete representation produced by `renderSound`.",
        category: "foundation",
        tags: ["media", "audio", "sampled"],
      },
      {
        id: "sound",
        name: "Sound",
        description: "Audio as math: variant Buffer AudioBuffer | Wave (Time -> Amplitude). `sampleSound` reads amplitudes at any time; `renderSound` materialises to a Buffer. Generators (sine, sawtooth, square) and ops (gain, mix, delay, pitch) are ordinary functions over Sound.",
        category: "foundation",
        tags: ["media", "audio", "signal"],
      },
      {
        id: "frame-sequence",
        name: "FrameSequence",
        description: "Pre-rendered animation buffer — record { fps: Number, frames: List(Image) }. Result of `renderAnim`.",
        category: "foundation",
        tags: ["media", "video", "sampled"],
      },
      {
        id: "animation",
        name: "Animation",
        description: "Pictures over time: variant Frames FrameSequence | Animate (Time -> Picture). `sampleAnim` returns the Picture at any time; `renderAnim` rasterises to a list of Image frames.",
        category: "foundation",
        tags: ["media", "video", "signal"],
      },
      {
        id: "scene",
        name: "Scene",
        description: "What's visible AND audible at one instant — record { visual: Picture, audio: Amplitude }. The codomain of Movie.",
        category: "foundation",
        tags: ["media", "av"],
      },
      {
        id: "recorded-movie",
        name: "RecordedMovie",
        description: "Pre-rendered movie — record { fps, width, height, frames: List(Image), audio: AudioBuffer }. Result of `renderMovie`.",
        category: "foundation",
        tags: ["media", "av", "sampled"],
      },
      {
        id: "movie",
        name: "Movie",
        description: "Visual + audio together: variant Recorded RecordedMovie | MovieAt (Time -> Scene). `sampleMovie` returns the Scene at any time; `renderMovie` materialises synchronised frames + audio.",
        category: "foundation",
        tags: ["media", "av", "signal"],
      },
      {
        id: "track-entry",
        name: "TrackEntry",
        description: "One sound at one start time — record { start: Number, sound: Sound }. Building block of Track.",
        category: "foundation",
        tags: ["media", "audio"],
      },
      {
        id: "track",
        name: "Track",
        description: "Sequenced sounds over time — record { entries: List(TrackEntry) }. `mixDown` collapses to a Sound.",
        category: "foundation",
        tags: ["media", "audio", "sequence"],
      },
      {
        id: "event-entry",
        name: "EventEntry",
        description: "One discrete event — record { timestamp: Number, payload: a }. Building block of Event.",
        category: "foundation",
        tags: ["frp", "events"],
      },
      {
        id: "event",
        name: "Event",
        description: "Discrete occurrences over time — record { entries: List(EventEntry) }. The sparse signal: events fire at specific timestamps. Bridge to Behavior via `step` / `accum`.",
        category: "foundation",
        tags: ["frp", "events", "signal"],
      },
      {
        id: "behavior",
        name: "Behavior",
        description: "Continuous value over time: variant BehaviorAt (Time -> a). The dense signal — always has a value at any t. Derived from Events via `step` / `accum`; bridges to Animation / Sound via `behaviorToAnim` / `behaviorToSound`.",
        category: "foundation",
        tags: ["frp", "signal"],
      },
      {
        id: "game",
        name: "Game",
        description: "Interactive game template — record { initial: state, update: (state, input) -> state, view: state -> Picture, inputs: Event }. `gameToAnim` derives the visual stream; `gameToMovie` adds audio. Live runtime feeds DOM events into `inputs` for interactive play.",
        category: "foundation",
        tags: ["games", "interactive", "frp"],
      },
      // Home / desktop layout types — these power /dashboard/home and
      // are themselves browseable Fenel values. Registering them in the
      // catalog reinforces the principle that the OS surface is data.
      {
        id: "layout-item",
        name: "LayoutItem",
        description: "One pinned slot inside a HomeView — record { id, source, caption?, x?, y?, w?, h?, date?, … }. Layout-specific fields apply per layout (canvas: x/y/w/h, calendar: date).",
        category: "foundation",
        tags: ["ui", "home", "desktop"],
      },
      {
        id: "canvas-view",
        name: "CanvasView",
        description: "Layout: free 2D positioning. Record { kind: \"canvas\", items: List(LayoutItem) } where items have proportional x/y in [0,1]². Drag-to-reposition. Layout typeclass instance maps to \"canvas\".",
        category: "foundation",
        tags: ["ui", "home", "layout", "canvas"],
      },
      {
        id: "list-view",
        name: "ListView",
        description: "Layout: vertical stack. Record { kind: \"list\", items: List(LayoutItem) }. Layout typeclass instance maps to \"list\".",
        category: "foundation",
        tags: ["ui", "home", "layout"],
      },
      {
        id: "grid-view",
        name: "GridView",
        description: "Layout: uniform N-column grid. Record { kind: \"grid\", cols: ℕ, items: List(LayoutItem) }. Layout typeclass instance maps to \"grid\".",
        category: "foundation",
        tags: ["ui", "home", "layout"],
      },
      {
        id: "tree-view",
        name: "TreeView",
        description: "Layout: indented hierarchy. Record { kind: \"tree\", items: List(TreeItem) } where TreeItem extends LayoutItem with `children: List(TreeItem)?` and `collapsed: Bool?`. Layout typeclass instance maps to \"tree\".",
        category: "foundation",
        tags: ["ui", "home", "layout", "tree"],
      },
      {
        id: "tabs-view",
        name: "TabsView",
        description: "Layout: tab strip showing one item at a time. Record { kind: \"tabs\", items: List(LayoutItem), activeId: String? }. Layout typeclass instance maps to \"tabs\".",
        category: "foundation",
        tags: ["ui", "home", "layout", "tabs"],
      },
      {
        id: "calendar-view",
        name: "CalendarView",
        description: "Layout: month grid keyed by ISO date on each item. Record { kind: \"calendar\", year: ℕ?, month: ℕ?, items: List(LayoutItem) }. Items have an ISO `date` field; the renderer drops them in the matching day cell. Layout typeclass instance maps to \"calendar\".",
        category: "foundation",
        tags: ["ui", "home", "layout", "calendar", "temporal"],
      },
      {
        id: "timeline-view",
        name: "TimelineView",
        description: "Layout: items positioned along a horizontal time axis by millisecond timestamp. Record { kind: \"timeline\", from: ℕ?, to: ℕ?, items: List(LayoutItem) }. Items have a `ts` field; the renderer projects to x-position by linear interpolation between `from` and `to`. Layout typeclass instance maps to \"timeline\".",
        category: "foundation",
        tags: ["ui", "home", "layout", "timeline", "temporal"],
      },
      {
        id: "map-view",
        name: "MapView",
        description: "Layout: items positioned on a geographic map by lat/lng. Record { kind: \"map\", center: {lat, lng}?, zoom: ℕ?, items: List(LayoutItem) }. Items have `lat` and `lng` fields; the renderer drops a draggable marker at each. Layout typeclass instance maps to \"map\". Tiles via OpenStreetMap.",
        category: "foundation",
        tags: ["ui", "home", "layout", "map", "geographic"],
      },
      {
        id: "home-view",
        name: "HomeView",
        description: "One desktop — record { id, name, view, active }. The `view` field is any layout-able value (CanvasView, ListView, GridView, TreeView, TabsView, CalendarView, or a user-defined type with a Layout typeclass instance).",
        category: "foundation",
        tags: ["ui", "home", "desktop"],
      },
    ],
  };
}

// -- Formats --

function buildFormats(): CatalogSection {
  return {
    id: "format",
    label: "Formats",
    description: "String types with semantic validation",
    entries: [
      {
        id: "format:email",
        name: "Email Address",
        description: "RFC-like email format — user@domain.tld",
        category: "format",
        set: { $tag: "SeRef", handle: "format:email" },
        tags: ["contact", "identity"],
      },
      {
        id: "format:phone",
        name: "Phone Number",
        description: "International phone format — validated per country via PhoneFormat typeclass",
        category: "format",
        set: { $tag: "SeRef", handle: "format:phone" },
        tags: ["contact", "identity", "typeclass-enhanced"],
      },
      {
        id: "format:url",
        name: "URL",
        description: "Valid URL — https://...",
        category: "format",
        set: { $tag: "SeRef", handle: "format:url" },
        tags: ["web", "link"],
      },
      {
        id: "format:uuid",
        name: "UUID",
        description: "Universally unique identifier — 8-4-4-4-12 hex format",
        category: "format",
        set: { $tag: "SeRef", handle: "format:uuid" },
        tags: ["identity", "reference"],
      },
      {
        id: "format:handle",
        name: "Social Handle",
        description: "Username/handle — validated per platform via HandleFormat typeclass",
        category: "format",
        set: { $tag: "SeRef", handle: "format:handle" },
        tags: ["social", "identity", "typeclass-enhanced"],
      },
      {
        id: "format:postal-code",
        name: "Postal Code",
        description: "Postal/ZIP code — validated per country via AddressFormat typeclass",
        category: "format",
        set: { $tag: "SeRef", handle: "format:postal-code" },
        tags: ["address", "location"],
      },
      {
        id: "format:ip",
        name: "IP Address",
        description: "IPv4 or IPv6 address",
        category: "format",
        set: { $tag: "SeRef", handle: "format:ip" },
        tags: ["network", "technical"],
      },
      {
        id: "format:date",
        name: "Date String",
        description: "ISO date format — parseable by Date constructor",
        category: "format",
        set: { $tag: "SeRef", handle: "format:date" },
        tags: ["temporal"],
      },
      {
        id: "format:datetime",
        name: "DateTime String",
        description: "ISO datetime with timezone",
        category: "format",
        set: { $tag: "SeRef", handle: "format:datetime" },
        tags: ["temporal"],
      },
      {
        id: "format:time",
        name: "Time String",
        description: "HH:MM or HH:MM:SS format",
        category: "format",
        set: { $tag: "SeRef", handle: "format:time" },
        tags: ["temporal"],
      },
      {
        id: "format:path",
        name: "Filesystem Path",
        description: "Any non-empty path-shaped string. Compose with :posix / :windows / :portable + modifiers like :absolute, :no-traversal, :no-reserved.",
        category: "format",
        set: { $tag: "SeRef", handle: "format:path" },
        tags: ["filesystem", "path", "io"],
      },
      {
        id: "format:path:posix",
        name: "POSIX Path",
        description: "POSIX-style path — `/`-separated, no drive letter or backslash. Compose with +absolute / +no-traversal / +no-hidden / etc.",
        category: "format",
        set: { $tag: "SeRef", handle: "format:path:posix" },
        tags: ["filesystem", "path", "posix", "linux", "macos"],
      },
      {
        id: "format:path:windows",
        name: "Windows Path",
        description: "Windows path — drive letter (`C:\\`), UNC (`\\\\server\\share\\`), or relative. Reserved chars `<>:\"|?*` rejected.",
        category: "format",
        set: { $tag: "SeRef", handle: "format:path:windows" },
        tags: ["filesystem", "path", "windows"],
      },
      {
        id: "format:path:portable",
        name: "Portable Path",
        description: "Strict subset valid on every common OS — `/` only, ASCII-safe, no Windows reserved chars or names, no trailing dot/space.",
        category: "format",
        set: { $tag: "SeRef", handle: "format:path:portable" },
        tags: ["filesystem", "path", "portable", "cross-platform"],
      },
    ],
  };
}

// -- Units --

function buildUnits(): CatalogSection {
  return {
    id: "unit",
    label: "Units",
    description: "Measurable quantities with unit conversion",
    entries: unitFamilies().map((dim) => ({
      id: `unit:${dim.name}`,
      name: dim.label,
      description: dim.description,
      category: "unit" as const,
      dimension: dim,
      tags: dim.choices.map((u) => u.code),
    })),
  };
}

// -- Composites --

function buildComposites(): CatalogSection {
  return {
    id: "composite",
    label: "Composites",
    description: "Structural types that contain other types",
    entries: [
      {
        id: "list",
        name: "List a",
        description: "Ordered collection of items of type T — with optional min/max/uniqueBy constraints",
        category: "composite",
        tags: ["collection", "generic"],
      },
      {
        id: "record",
        name: "Record",
        description: "Named fields with individual schemas — nested forms",
        category: "composite",
        tags: ["object", "nested"],
      },
      {
        id: "union",
        name: "Union",
        description: "Discriminated union — one of several variant record types",
        category: "composite",
        tags: ["tagged", "variant", "sum-type"],
      },
      {
        id: "ref",
        name: "Ref Entity",
        description: "Reference to an entity instance — validated as UUID, resolved by entity type",
        category: "composite",
        tags: ["reference", "relationship"],
      },
      {
        id: "file",
        name: "File",
        description: "File descriptor (BlobValue) — url, name, size, mimeType, hash. Content-addressable.",
        category: "composite",
        tags: ["upload", "media", "blob", "asset"],
      },
      {
        id: "path-adt",
        name: "Path",
        description: "Filesystem path as an ADT — AbsolutePath { root: PosixRoot | DriveRoot | UncRoot, segments } | RelativePath { segments }. Sister to format:path:* (the string-side view).",
        category: "composite",
        tags: ["filesystem", "path", "adt", "structural"],
      },
      {
        id: "arrow",
        name: "Arrow",
        description:
          "Structural function type — `(p1: A, p2: B) → C`. The value of an arrow-typed field is any callable: a registered function name, a `fn` lambda, or a partial application. Subtyping is contravariant in params, covariant in returns. Powers higher-order functions (map / filter / fold) and partial application — invoking a function with fewer args than its arity yields an arrow with the remaining params.",
        category: "composite",
        tags: ["function", "callable", "higher-order", "partial-application"],
      },
    ],
  };
}

// -- Functions --

/** The function catalog is also the API seeding source, so its `fn` payloads
 * must be the strict identity-total views, not the raw module declarations.
 * Construct the exact seed-product identity profile lazily: a static import of
 * registry.ts here would recreate registry -> type-catalog -> registry. The
 * engineRequire boundary is browser-backed by engine-modules, self-backed once
 * registry has evaluated, and retains the established direct-test Node/Bun
 * fallback. No raw fallback is permitted if an exact function is absent. */
function catalogIdentifiedFunctionRegistry(): ModuleRegistry {
  observeOwnerFullCatalogueRead("catalogIdentifiedFunctionRegistry");
  const state = catalogRuntimeState();
  if (state.identifiedSeedFunctionRegistry !== undefined) {
    return state.identifiedSeedFunctionRegistry;
  }
  const { createRegistry } = engineRequire<typeof import("./registry")>("registry");
  const lock = repositoryIdentityLock();
  const registry = createRegistry(
    [...ALL_MODULES, repositoryFieldFacetModule()],
    {
      dispatchRegistry,
      codeNameLock: lock,
      publishCatalogEntities: false,
      fieldIdentity: {
        mode: "strict-embedded",
        defaultRealm: "repository-source",
        lock,
        identityKinds: repositoryIdentityKinds(),
        cacheKey: `catalog-seed:${REPOSITORY_IDENTITY_MANIFEST.digest}`,
      },
    },
  );
  state.identifiedSeedFunctionRegistry = registry;
  return registry;
}

function buildFunctions(functionRegistry?: ModuleRegistry): CatalogSection {
  observeOwnerFullCatalogueRead("buildFunctions");
  const entries: CatalogEntry[] = [];
  // Pull functions from every system module — not just std — so
  // module-declared fns (telegram, state, time, …) show up in the
  // catalog and downstream consumers (e.g. the desktop's
  // ALL_CATALOG_FNS / cardResultType) can recover their declared
  // returns type.
  const seen = new Set<string>();
  const sourceFns = ALL_MODULES.flatMap((m) => m.functions ?? []).filter((f) => {
    if (seen.has(f.id)) return false;
    seen.add(f.id);
    return true;
  });
  const identifiedRegistry = functionRegistry ?? catalogIdentifiedFunctionRegistry();
  const fns = sourceFns.map((sourceFn) => {
    const identified = identifiedRegistry.getIdentifiedFunction(sourceFn.id);
    if (identified === undefined || identified.id !== sourceFn.id) {
      throw new Error(
        `type catalog: ${functionRegistry ? "supplied" : "strict seed"} registry has no exact identified function ${sourceFn.id}`,
      );
    }
    return identified;
  });

  for (const fn of fns) {
    const codeName = getCodeName(fn.id) ?? fn.id;
    // Phase 3j (module-substrate) — displayCategory restores the module-name
    // grouping the loader used to STORE as a Categorizable (now conditional):
    // getCategory → the id's module-prefix → "uncategorized". Always a string,
    // so the subcategory + tag are never undefined.
    const category = displayCategory(fn.id);
    entries.push({
      id: fn.id,
      // Phase 3j — displayLabel falls getLabel → humanized codeName → id, so a
      // function with no explicit @label shows a Title-Case label rather than a
      // blank or a raw lowercase codeName.
      name: displayLabel(fn.id),
      description: catalogueDescription(fn, codeName),
      category: "function",
      subcategory: category,
      fn,
      scheme: identifiedRegistry.getFunctionScheme(fn.id),
      tags: [
        ...(getTags(fn.id) ?? []),
        category,
      ],
    });
  }

  return {
    id: "function",
    label: "Functions",
    description: "Typed, composable functions — callable from expressions",
    entries,
  };
}

// -- Entities --

function buildEntities(functionRegistry?: ModuleRegistry): CatalogSection {
  const entries: CatalogEntry[] = [];

  // Phase 3.4a — partition the UNIFIED registered-entity set BY TYPE, not by
  // which store-array an entity was sorted into. `systemEntities` and
  // `specEntities` are two arrays only for construction-order reasons; to the
  // catalog they are one value set. An entry lands in "Entities" when its type
  // is NOT a dispatch class (a record-of-methods the registry resolves
  // instances of — those go to "Specs") and is not parametric (those go to
  // "Generics"). `isDispatchClassEntity` is the TYPE classifier (this phase: the
  // `<X>Spec` type-name handle; Phase 3.4b swaps it for the real class signal).
  for (const entity of [...systemEntities, ...specEntities]) {
    // A value whose type is a dispatch class is a spec, not a data entity.
    if (isDispatchClassEntity(entity.id)) continue;
    // Skip parametric entries — they appear under constructors, not entities.
    if (entity.params?.length) continue;
    // A concrete entity must have a static `type` — defensive guard.
    if (!entity.type) continue;
    // Skip entities generated from Group<T> — they'll appear under constructors
    const isGenerated = entity.id === "geographical_set";
    const label = getLabel(entity.id) ?? entity.id;
    const description = getDescription(entity.id) ?? `${label} entity`;

    entries.push({
      id: `entity:${entity.id}`,
      name: label,
      description,
      category: "entity",
      subcategory: isGenerated ? "generated" : "core",
      entity: { id: entity.id, type: entity.type },
      generatedFrom: isGenerated
        ? 'Group<"country">'
        : undefined,
      tags: isGenerated ? ["generated", "typeclass-instance"] : [],
    });
  }

  // Module-registered entities — user-Fenel-file ADTs (`Either<E, A> = …`),
  // domain types from per-product modules, etc. They get the same shape as
  // system entities; identity facets are picked up from typeclass instances
  // the same way (`getLabel(id)` etc.), with sensible fallbacks.
  // A private registry publishes none of its own declarations, so these rows
  // can only come from OTHER registries built earlier in this process. Its
  // scoped catalogue omits them: it must not depend on realm history, and its
  // own types are listed by identity by its session layer.
  const state = catalogRuntimeState();
  const moduleEntities = functionRegistry !== undefined && state.privateRegistries.has(functionRegistry)
    ? [] : state.extraEntities;
  for (const entity of moduleEntities) {
    // Avoid double-registration if a system entity shares the id.
    if (systemEntities.some((s) => s.id === entity.id)) continue;
    // Module ADTs are data types (no `<X>Spec` dispatch-class handle) → they
    // belong in "Entities". (Per Phase 3.4a Watch-out #6 + the `Email`
    // collision: a data entity sharing a capability's NAME — `Email` — must
    // stay here; the suffix handle, not a name-class lookup, keeps it correct.)
    // Section entries stay keyed by BARE id (deduped); the qualified index that
    // backs per-module addressing lives in the catalog runtime state (see
    // getCatalogEntry).
    entries.push(moduleEntityCatalogEntry(entity));
  }

  return {
    id: "entity",
    label: "Entities",
    description: "Data types with persistence and identity",
    entries,
  };
}

// -- Typeclasses --

// -- Interfaces --
//
// The one catalog face for dispatch-target types: a Fenel "interface" is a
// record type whose fields are methods (the dispatch face — see Cornerstone 1
// / design/unified-dispatch.md). Everything is a type; there are no
// "typeclasses" as a separate kind, so this ONE section holds both faces that
// used to live in the retired `typeclass` + `spec` sections:
//   - parametric validation/behavior families with data-derived instances
//     (PhoneFormat / AddressFormat / HandleFormat / ExchangeRate), and
//   - the representation interface records (Labelable / Iconable / …), the
//     BY-TYPE view of every dispatch-class entity.
// (universal-dispatch-convergence Phase 6b — merged 2026-07-06: `interface`
// supersedes both `typeclass` and `spec`.)

function buildInterfaces(): CatalogSection {
  const phoneInstances = derivePhoneInstances(countries);
  const exchangeRateInstances = deriveExchangeRateInstances(currencies);
  const withRates = exchangeRateInstances.filter((i) => (i.methods.rate as number) > 0);
  // AddressFormat instances — Fenel-authored value-decls (Phase 3.3c). Project
  // from fenel/modules/formats/instances.fenel with the same `typeValuedFields`
  // option system-entities.ts uses, so `addressType` is the TYPE reference
  // `{$named:"UsAddress"}`. Filtered to AddressFormat (the file also holds the
  // Spatial instance).
  const addressInstances = (loadFenelModule(formatsInstancesSrc, "formats", {
    dispatchInstanceFile: true,
    typeValuedFields: { AddressFormat: ["addressType"] },
  }).instances ?? []).filter((i) => i.typeName === "AddressFormat");

  const formatEntries: CatalogEntry[] = [
      {
        id: "tc:PhoneFormat",
        name: "PhoneFormat(country)",
        description: `Phone number validation rules per country — dial code, digit pattern, length. ${phoneInstances.length} instances derived from country data.`,
        category: "interface",
        typeclass: phoneFormat,
        instances: phoneInstances,
        instanceCount: phoneInstances.length,
        tags: ["phone", "contact", "per-country", "data-derived"],
      },
      {
        id: "tc:AddressFormat",
        name: "AddressFormat(country)",
        description: `Postal address structure per country — each country's address is a first-class named $record type (UsAddress / JpAddress / …) the universal FieldRenderer drives. ${addressInstances.length} curated instances.`,
        category: "interface",
        typeclass: addressFormat,
        instances: addressInstances,
        instanceCount: addressInstances.length,
        tags: ["address", "location", "per-country"],
      },
      {
        id: "tc:HandleFormat",
        name: "HandleFormat(platform)",
        description: `Social media handle validation per platform — pattern, max length, prefix. Derived from Platform entity data. ${platforms.length} platform instances.`,
        category: "interface",
        typeclass: handleFormat,
        instances: deriveHandleInstances(platforms),
        instanceCount: platforms.length,
        tags: ["social", "identity", "per-platform"],
      },
      {
        id: "tc:ExchangeRate",
        name: "ExchangeRate(currency)",
        description: `Currency exchange rate to USD — ${withRates.length} snapshot rates, ${exchangeRateInstances.length} total currencies. Conversion is pure arithmetic on instance data, no special code.`,
        category: "interface",
        typeclass: exchangeRate,
        instances: exchangeRateInstances,
        instanceCount: exchangeRateInstances.length,
        tags: ["currency", "conversion", "per-currency", "data-derived"],
      },
  ];
  return {
    id: "interface",
    label: "Interfaces",
    description:
      "Record types whose fields are methods — the dispatch face of a type (design/unified-dispatch.md). Holds both the parametric validation/behavior families with data-derived instances (PhoneFormat / AddressFormat / …) and the representation interface records (Labelable / Iconable / …). Instances live as ordinary entity_instances rows.",
    entries: [...formatEntries, ...buildInterfaceRecordEntries()],
  };
}

// -- Interface record entries --
//
// The BY-TYPE view of the unified entity set: every value whose type is a
// dispatch class (a record-of-methods the registry resolves instances of —
// `isDispatchClassEntity`) collapses to a parametric record type
// (`Labelable a = Labelable { label: LocaleString }`) whose fields are the
// interface's methods. These surface in the merged `interface` section so
// callers can discover them via the catalog and ask EntityIdPicker for
// `Id<Labelable>` targets. (Phase 6b merged this into `buildInterfaces`; the
// standalone `spec` section retired.)

function buildInterfaceRecordEntries(): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  // Phase 3.4a — the "Specs" section is the BY-TYPE view of the unified entity
  // set: every value whose type is a dispatch class (a record-of-methods the
  // registry resolves instances of — `isDispatchClassEntity`), regardless of
  // which store-array it currently lives in. (Today that is exactly
  // `specEntities`; sourcing it from the type predicate over the unified set is
  // what makes the grouping type-driven rather than store-driven.)
  for (const entity of [...systemEntities, ...specEntities]) {
    if (!entity.type) continue;
    if (!isDispatchClassEntity(entity.id)) continue;
    const label = getLabel(entity.id) ?? entity.id;
    const description = getDescription(entity.id) ?? `${label} spec record`;
    entries.push({
      id: `spec:${entity.id}`,
      name: label,
      description,
      category: "interface",
      entity: {
        id: entity.id,
        type: entity.type,
        ...(entity.params ? { params: entity.params } : {}),
      },
      tags: ["interface", "dispatched"],
    });
  }
  return entries;
}

// -- Generics --
//
// Parameterized type families. Group<T> is the original entity-generating
// constructor; the dependent-type set (Vec<T,n>, LengthBoundedString,
// Sigma) sits alongside it because they share the same shape: a type
// schema waiting to be applied with arguments.

function buildGenerics(): CatalogSection {
  const entries: CatalogEntry[] = [];

  // Walk systemEntities for parametric entries — Maybe<T> / Result<E,A> /
  // Either<E,A> / Draft<T> / …. The same registry that holds concrete
  // entities also holds parametric type families; we distinguish by the
  // `params` field.
  for (const entity of systemEntities) {
    if (!entity.params?.length) continue;
    const label = getLabel(entity.id) ?? entity.id;
    const description = getDescription(entity.id) ?? `${label} type constructor`;
    entries.push({
      id: `ctor:${entity.id}`,
      name: label,
      description,
      category: "constructor",
      // Carry the entity registration so the editor can walk `$variant`
      // cases on parametric ADTs (Maybe<T>, Result<E,A>) the same way it
      // walks concrete entities. Entries without a static `type` are
      // skipped by the editor's peelToVariant.
      entity: { id: entity.id, type: entity.type, params: entity.params },
      tags: ["parameterized"],
    });
  }

  // Display-only entries for dependent-type families (Sigma /
  // LengthBoundedString). These live in `dependent-types.ts` as standalone
  // helpers, not in `systemEntities` — keep them surfaced here for browsing.
  //
  // array-substrate Phase 1a.5 — the display-only `ctor:Vec` stub is RETIRED:
  // `Vec` (and its index type `Fin`) are now FIRST-CLASS parametric system
  // entities (`Vec n a = $map (Fin n) a`, system-entities.ts) carrying a real
  // `entity.type`, so `buildGenerics`'s `systemEntities` walk surfaces `ctor:Vec`
  // / `ctor:Fin` with the `$map`/`$refined` schema (and `deriveResolveSchema`
  // resolves it for structural dispatch). A second display-only stub here would
  // duplicate that entry. `LengthBoundedString` stays a display stub but is now
  // documented as normalising to `Vec n Char` (the normalization law).
  entries.push(
      {
        id: "ctor:LengthBoundedString",
        name: "LengthBoundedString<n>",
        description: "String of exactly n codepoints. `LengthBoundedString(6)` returns `Vec 6 Char` = `$map (Fin 6) Char` (array-substrate Phase 1a.5 — `String` = `List Char`, so a length-`n` string IS `Vec n Char`); the late-bound form uses `$el { call: [\"lengthBoundedStringOf\", { var: \"n\" }] }`.",
        category: "constructor",
        tags: ["text", "dependent", "parameterized"],
      },
      {
        id: "ctor:Sigma",
        name: "Sigma<A, B(a)>",
        description: 'Dependent pair { fst: A, snd: B(fst) }. `SigmaGuards` selects `snd`\'s type by guard predicates over `fst` — Σ-types from dependent type theory, expressed as records over the unified `$el` substrate (an if-else chain on the guards).',
        category: "constructor",
        tags: ["product", "dependent", "parameterized"],
      },
  );

  return {
    id: "constructor",
    label: "Generics",
    description: "Parameterized type families — Group<T>, Vec<T,n>, Sigma. Apply with concrete types/values to materialize.",
    entries,
  };
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/** Additional entities registered at runtime by `createRegistry` (one
 *  call per module). Lives alongside the static `systemEntities` array
 *  so `getCatalog()` surfaces user-module ADTs (like an `Either<E, A>`
 *  defined in a `.fenel` source file) as first-class entries.
 *
 *  Without this, user-defined types parsed via `loadFenelModule` stay
 *  invisible to every editor surface that reads `getCatalog()` — type
 *  pickers, constructor pickers, pattern editors all silently miss
 *  them even though the runtime evaluator knows about them. */
// Module-qualified index — retains EVERY registered module entity keyed by its
// owning module (unlike `extraEntities`, which dedupes by BARE id for the
// display sections + `$ref` resolution). This is what lets two genuinely-distinct
// types that share a bare name across modules — telegram's `Animation` ($record)
// vs the animation module's `Animation` ($variant) — each be individually
// addressed via a qualified `entity:<module>.<name>` id (getCatalogEntry, below),
// while `getEntityTypeByName` / `$ref` stay bare-keyed and unchanged.
type CatalogRuntimeState = {
  catalog: CatalogSection[] | null;
  scopedCatalogs: WeakMap<ModuleRegistry, CatalogSection[]>;
  extraEntities: {
    id: string;
    type: FenelType;
    module?: string;
    params?: readonly (string | TypeConstructorParam)[];
  }[];
  moduleEntities: {
    id: string;
    type: FenelType;
    module: string;
    params?: readonly (string | TypeConstructorParam)[];
  }[];
  /** Bare ids with more than one semantic declaration owner (or one owner
   * that was re-registered with a different definition).  This is populated
   * while declarations register, rather than when a later cache read happens,
   * so clearing the projection cache cannot reopen an order-dependent
   * first-wins/last-wins window. */
  identifiedNameConflicts: Set<string>;
  /** Complete owner roster used to discover the collision set above. */
  declarationsByBareName: Map<string, Map<string, FenelType>>;
  identifiedEntityTypeCache: Map<string, FenelType | null>;
  identifiedSeedFunctionRegistry?: ModuleRegistry;
  /** Registries built with `publishCatalogEntities: false`. */
  privateRegistries: WeakSet<ModuleRegistry>;
};

/** Module state behind exported registration functions. A function declaration
 * is deliberate: registry bootstrap can re-enter this partially initialized
 * module, so its stores must be available before top-level evaluation reaches
 * this section. The state remains one module-local singleton; only its
 * initialization timing changes. */
function catalogRuntimeState(): CatalogRuntimeState {
  const carrier = catalogRuntimeState as typeof catalogRuntimeState & {
    value?: CatalogRuntimeState;
  };
  carrier.value ??= {
    catalog: null,
    scopedCatalogs: new WeakMap(),
    extraEntities: [],
    moduleEntities: [],
    identifiedNameConflicts: new Set(),
    declarationsByBareName: new Map(),
    identifiedEntityTypeCache: new Map(),
    privateRegistries: new WeakSet(),
  };
  return carrier.value;
}

/** A completed registry that keeps its declarations out of the process-global
 * catalogue. Its scoped `getCatalog(registry)` likewise ignores module rows
 * other registries published (see buildEntities). */
export function markPrivateCatalogRegistry(registry: ModuleRegistry): void {
  catalogRuntimeState().privateRegistries.add(registry);
}

/** Focused atomicity seam: tests can observe registration state without
 * constructing the full display catalog (which recursively boots the system
 * registry and turns a failure-path assertion into a repository-scale job). */
export function __catalogHasRegisteredEntityForTests(
  id: string,
  moduleName?: string,
): boolean {
  const state = catalogRuntimeState();
  return moduleName === undefined
    ? state.extraEntities.some((entity) => entity.id === id)
    : state.moduleEntities.some((entity) => entity.id === id && entity.module === moduleName);
}

/** Build the catalog entry for a module-registered entity. Shared by
 *  `buildCatalog` (the display sections, keyed by BARE id) and the qualified
 *  branch of `getCatalogEntry`. `entity.id` is always the bare name — the
 *  registry-side lookups (`getLabel` / `DbDataTable` / `EntityDetail`) key on it. */
function moduleEntityCatalogEntry(entity: { id: string; type: FenelType }): CatalogEntry {
  const label = getLabel(entity.id) ?? entity.id;
  const description = getDescription(entity.id) ?? `${label} entity`;
  return {
    id: `entity:${entity.id}`,
    name: label,
    description,
    category: "entity",
    subcategory: "module",
    entity: { id: entity.id, type: entity.type },
    tags: [],
  };
}

/** Register module entities so they appear under the `entity` section of
 *  `getCatalog()`. Called by `createRegistry` for each registered
 *  module's `entities` array. Invalidates the catalog cache so the next
 *  `getCatalog()` call rebuilds with the new entries included. */
export function registerCatalogEntities(
  entities: readonly {
    id: string;
    type: FenelType;
    module?: string;
    params?: readonly (string | TypeConstructorParam)[];
  }[],
): void {
  const state = catalogRuntimeState();
  const affectedBareNames = new Set<string>();
  for (const e of entities) {
    if (!e || !e.id || !e.type) continue;
    affectedBareNames.add(e.id);
    const owner = e.module ?? "<unqualified>";
    let declarations = state.declarationsByBareName.get(e.id);
    if (declarations === undefined) {
      declarations = new Map();
      state.declarationsByBareName.set(e.id, declarations);
    }
    const priorDeclaration = declarations.get(owner);
    if (
      (priorDeclaration !== undefined
        && !catalogStructuralEqual(priorDeclaration, e.type))
      || (priorDeclaration === undefined && declarations.size > 0)
    ) {
      state.identifiedNameConflicts.add(e.id);
    }
    if (priorDeclaration === undefined) declarations.set(owner, e.type);
    // Qualified index: retain per-(module, id) so distinct same-named module
    // types stay individually addressable. Only entities that carry a module.
    if (e.module) {
      const has = state.moduleEntities.some((x) => x.module === e.module && x.id === e.id);
      if (!has) state.moduleEntities.push({
        id: e.id,
        type: e.type,
        module: e.module,
        ...(e.params === undefined ? {} : { params: e.params }),
      });
    }
    // Display sections + `$ref`: deduped by BARE id, first-registration wins.
    if (state.extraEntities.some((x) => x.id === e.id)) continue;
    state.extraEntities.push({
      id: e.id,
      type: e.type,
      ...(e.module === undefined ? {} : { module: e.module }),
      ...(e.params === undefined ? {} : { params: e.params }),
    });
  }
  state.catalog = null;
  state.scopedCatalogs = new WeakMap();
  for (const name of affectedBareNames) {
    if (state.identifiedNameConflicts.has(name)) {
      state.identifiedEntityTypeCache.set(name, identifiedNameConflictSentinel());
      continue;
    }
    // A previously observed PEEK miss is transient once a declaration with
    // this exact bare name registers. Positive entries, however, are strict
    // registry projections: createRegistry can publish those views before it
    // exposes the corresponding raw catalog declarations. Preserve that
    // authority, and never evict it merely because an unrelated registry adds
    // another catalog row.
    if (state.identifiedEntityTypeCache.get(name) === null) {
      state.identifiedEntityTypeCache.delete(name);
    }
  }
}

/** Get the full catalog (cached). Account-bound editors can reuse their
 * already checked registry's identified function views and schemes. These
 * projections are scoped to that exact registry and never populate the
 * process-global repository catalog used by seeding and system consumers. */
export function getCatalog(functionRegistry?: ModuleRegistry): CatalogSection[] {
  observeOwnerFullCatalogueRead("getCatalog");
  const state = catalogRuntimeState();
  if (functionRegistry !== undefined) {
    const prior = state.scopedCatalogs.get(functionRegistry);
    if (prior !== undefined) return prior;
    const catalog = buildCatalog(functionRegistry);
    state.scopedCatalogs.set(functionRegistry, catalog);
    return catalog;
  }
  if (!state.catalog) state.catalog = buildCatalog();
  return state.catalog;
}

/** Same entity selection as buildEntities plus its qualified-name route.
 * This read has no dependency on callable signatures or display programs. */
function catalogEntityDefinition(name: string): {
  entity: { id: string; type: FenelType };
  origin: "core" | "generated" | "module";
} | undefined {
  const state = catalogRuntimeState();
  const dot = name.indexOf(".");
  if (dot > 0) {
    const qualified = state.moduleEntities.find((entry) => entry.module === name.slice(0, dot) && entry.id === name.slice(dot + 1));
    if (qualified) return { entity: qualified, origin: "module" };
  }
  for (const entity of [...systemEntities, ...specEntities]) {
    if (entity.id !== name || isDispatchClassEntity(entity.id) || entity.params?.length || !entity.type) continue;
    return { entity: { id: entity.id, type: entity.type }, origin: entity.id === "geographical_set" ? "generated" : "core" };
  }
  // buildEntities reserves even excluded system names against module rows.
  if (systemEntities.some((entity) => entity.id === name)) return undefined;
  const extra = state.extraEntities.find((entity) => entity.id === name);
  return extra ? { entity: extra, origin: "module" } : undefined;
}

/** Find a catalog entry by ID.
 *
 *  A **qualified** module-entity id — `entity:<module>.<name>` (the form the
 *  /types module-group links now emit) — resolves through the module-qualified
 *  index, so `entity:telegram.Animation` and `entity:animation.Animation` reach
 *  their OWN entries even though they share the bare name `Animation`. A **bare**
 *  `entity:<name>` id falls through to the section scan (unchanged — this is also
 *  the path `getEntityTypeByName` + `$ref` resolution take, kept bare). Module
 *  names carry no `.`; entity names carry no `.`; so exactly one `.` after the
 *  `entity:` prefix marks the qualified form. */
export function getCatalogEntry(id: string, functionRegistry?: ModuleRegistry): CatalogEntry | undefined {
  if (id.startsWith("entity:")) {
    const found = catalogEntityDefinition(id.slice("entity:".length));
    if (!found) return undefined;
    const entry = moduleEntityCatalogEntry(found.entity);
    return found.origin === "module" ? entry : { ...entry,
      subcategory: found.origin,
      generatedFrom: found.origin === "generated" ? 'Group<"country">' : undefined,
      tags: found.origin === "generated" ? ["generated", "typeclass-instance"] : [],
    };
  }
  for (const section of getCatalog(functionRegistry)) {
    const entry = section.entries.find((e) => e.id === id);
    if (entry) return entry;
  }
  return undefined;
}

/**
 * Resolve an entity/type **code-name** to its registered FenelType (the entity's
 * underlying `$record` / `$variant` kind), or `undefined` if no such entity is
 * registered. This is the type-layer analogue of `getFunction(id)` on the value
 * side — the `{$ref}` resolver (`type-foundation.ts` `refType`) injects it so a
 * reference whose handle names a type/entity resolves transparently to that
 * type (typed-function-references Phase 7b). It is the exact lookup
 * `validate.ts` already does inline (`getCatalogEntry("entity:"+name)?.entity?.type`),
 * lifted to a reusable export so 7d–7f route through one resolution path instead
 * of re-deriving it.
 */
export function getEntityTypeByName(name: string): FenelType | undefined {
  return catalogEntityDefinition(name)?.entity.type;
}

/** Bare-name collision sentinel. Distinct declarations can share a bare id
 * (telegram:Animation vs animation:Animation); a cache that let the LAST
 * publisher win would make `$ref` denotation flip with observation order — a
 * Tri-discipline hazard. A conflicted name is never a valid bare identified
 * template; qualified registry lookup is required instead. */
/** Hoisted identity sentinel: cold registry bootstrap can call exported catalog
 * functions through an ESM cycle before module-body constants initialize. The
 * function object is the stable singleton and is never invoked as a value. */
function identifiedNameConflictSentinel(): FenelType {
  return identifiedNameConflictSentinel as unknown as FenelType;
}

/** Own-data structural equality for immutable identified type graphs.
 *
 * Registry projections are fresh clones and may be cyclic.  JSON.stringify
 * therefore cannot be the equivalence test: it throws on cycles and treats
 * object insertion order as meaning.  This comparator walks sorted own keys,
 * never invokes accessors, and keeps a two-way object correspondence so two
 * differently-shaped cycles cannot compare equal by accident. */
function catalogStructuralEqual(left: unknown, right: unknown): boolean {
  const leftToRight = new WeakMap<object, object>();
  const rightToLeft = new WeakMap<object, object>();
  const equal = (a: unknown, b: unknown): boolean => {
    if (Object.is(a, b)) return true;
    if (
      a === null || b === null
      || typeof a !== "object" || typeof b !== "object"
    ) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;

    const mappedRight = leftToRight.get(a);
    if (mappedRight !== undefined) return mappedRight === b;
    const mappedLeft = rightToLeft.get(b);
    if (mappedLeft !== undefined) return mappedLeft === a;
    leftToRight.set(a, b);
    rightToLeft.set(b, a);

    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();
    if (aKeys.length !== bKeys.length) return false;
    for (let index = 0; index < aKeys.length; index += 1) {
      const key = aKeys[index]!;
      if (key !== bKeys[index]) return false;
      const aDescriptor = Object.getOwnPropertyDescriptor(a, key);
      const bDescriptor = Object.getOwnPropertyDescriptor(b, key);
      if (
        aDescriptor === undefined || bDescriptor === undefined
        || !("value" in aDescriptor) || !("value" in bDescriptor)
        || !equal(aDescriptor.value, bDescriptor.value)
      ) return false;
    }
    return true;
  };
  return equal(left, right);
}

/** Focused test seam; the production cache publisher below is its only
 * semantic consumer. */
export const __catalogStructuralEqualForTests = catalogStructuralEqual;

function publishIdentifiedEntityType(name: string, type: FenelType | null): void {
  const state = catalogRuntimeState();
  if (state.identifiedNameConflicts.has(name)) {
    state.identifiedEntityTypeCache.set(name, identifiedNameConflictSentinel());
    return;
  }
  const existing = state.identifiedEntityTypeCache.get(name);
  if (existing === undefined || existing === null) {
    state.identifiedEntityTypeCache.set(name, type);
    return;
  }
  if (existing === identifiedNameConflictSentinel() || type === null) return;
  if (existing === type) return;
  // Re-registrations of one semantic owner arrive as fresh clones of the same
  // plan.  Compare them by cycle-safe, property-order-independent own data;
  // anything else is a genuine persistent bare-name conflict.
  if (catalogStructuralEqual(existing, type)) return;
  state.identifiedNameConflicts.add(name);
  state.identifiedEntityTypeCache.set(name, identifiedNameConflictSentinel());
}

/** Publish a strict repository registry's already-normalized view. Account and
 * draft registries never call this boundary. It lets later catalog `$ref`
 * expansion reuse the exact owner-qualified result without re-running the
 * identity kernel or sharing a mutable registry DTO. */
export function registerIdentifiedCatalogEntity(entity: {
  readonly id: string;
  readonly type: FenelType;
}): void {
  publishIdentifiedEntityType(entity.id, entity.type);
}

/** Resolve one repository entity through the generated identity lock without
 * constructing another full registry. The Fenel identity kernel owns path,
 * owner, positional, duplicate, and conflict semantics; this adapter only
 * selects the exact catalog declaration roots and projects their identified
 * immutable views.
 *
 * The object-identity dependency closure is not semantic matching: repository
 * declarations deliberately reuse canonical nominal type objects (notably
 * List) inside other roots. Including those exact roots prevents the kernel
 * from mistaking a separately-owned declaration for an inline occurrence. */
export function getIdentifiedEntityTypeByName(name: string): FenelType | undefined {
  const state = catalogRuntimeState();
  if (state.identifiedNameConflicts.has(name)) return undefined;
  const cached = state.identifiedEntityTypeCache.get(name);
  if (cached !== undefined && cached !== identifiedNameConflictSentinel()) {
    return cached ?? undefined;
  }

  // Phase 4b (review F5) — this compatibility lookup is genuinely PEEK-only.
  // A type marshal must never construct the display catalog, run the identity
  // kernel, or re-enter registry construction merely to graft keys.  Strict
  // registries publish identified views into the cache above; otherwise an
  // already-built system registry is the sole fallback authority.  A cold miss
  // stays transient so the same name can resolve after boot.
  try {
    const { peekSystemRegistry } = engineRequire<typeof import("./system-registry")>("system-registry");
    const registry = peekSystemRegistry();
    if (registry === null) return undefined;
    const identified = registry.getIdentifiedEntity(name)?.type;
    publishIdentifiedEntityType(name, identified ?? null);
    return identified;
  } catch {
    return undefined;
  }
}

/**
 * The bare code-names of every entry in the catalog ENTITY section — exactly the
 * set `getEntityTypeByName` resolves (each entry's id is `entity:<name>`, so a
 * name here always round-trips through that lookup).
 *
 * typed-function-references Phase 7d made these bare names the type rows of the
 * `.fenel.lock`. They no longer are: modules-as-values Phase 5 S2 keys every
 * type row by its OWNER (`type/module/<owner>/<Name>`), and the lock generator
 * collects its type roster from each profile's identified declarations through
 * the Fenel plan in `fenel/modules/engine/type-identity.fenel`. This list stays
 * a display-catalog projection only.
 */
export function listEntityCodeNames(): string[] {
  // The identity-lock generator calls this while repository declarations are
  // still in collect-requirements form. Building the complete display catalog
  // here would also format raw function signatures before their FieldKeys have
  // been projected by a strict registry. This API's contract is the entity
  // section only, so keep that bootstrap boundary exact and do not construct
  // unrelated catalog sections as an accidental side effect.
  const section = buildEntities();
  const names = new Set<string>();
  for (const e of section.entries) {
    const id = e.entity?.id;
    if (id) names.add(id);
  }
  return [...names];
}

/** Find all entries matching a tag */
export function findByTag(tag: string): CatalogEntry[] {
  const results: CatalogEntry[] = [];
  for (const section of getCatalog()) {
    for (const entry of section.entries) {
      if (entry.tags?.includes(tag)) results.push(entry);
    }
  }
  return results;
}

// browser-engine-compat Phase 1b: self-register this module's live namespace so
// engineRequire("type-catalog") resolves even at EVAL-TIME (a caller that statically imports
// this module runs its own eval-time builder calls AFTER this module is fully loaded,
// i.e. before the index.ts aggregator runs). See engine-require.ts.
import * as __self_type_catalog from "./type-catalog";
import { registerEngineModule as __reg_type_catalog } from "./engine-require";
__reg_type_catalog("type-catalog", __self_type_catalog);
