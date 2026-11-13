// ---------------------------------------------------------------------------
// JSON Schema ↔ Fenel bidirectional conversion (draft 2020-12)
//
// Forward:  FenelType / FormField → JSON Schema
// Reverse:  JSON Schema → FenelType / SetExpr / FormField[]
//
// Usage:
//   fenelTypeToJsonSchema(type, meta?)       // single type → JSON Schema
//   formToJsonSchema(fields)                 // FormField[] → JSON Schema object
//   formDefinitionToJsonSchema(definition)   // FormDefinition → full JSON Schema
//   jsonSchemaToSetExpr(schema)              // JSON Schema → SetExpr constraints
//   jsonSchemaToFenelType(schema)            // JSON Schema → FenelType + meta
//   jsonSchemaToFormFields(schema)           // JSON Schema object → FormField[]
// ---------------------------------------------------------------------------

import type {
  FenelType,
  FieldDef,
  FormDefinition,
  SetExpr,
} from "./types";
import { canonical } from "./locale";
import { entitySchemaFields, formDefinitionFields, type FieldMetadata } from "./field-meta";
import { draftStringFromTaggedLevel } from "./places";
import {
  dispatchedGetLabel as getLabel,
  dispatchedGetDescription as getDescription,
  dispatchedJsonSchemaForwardPlan,
  dispatchEngineBody,
  type JsonSchemaForwardPlanWire,
} from "./engine-bodies-dispatch";
import { List, Maybe, Just, Nothing, peelMaybeValue } from "./type-foundation";
import type { ModuleRegistry } from "./registry";
import { resolveIdentifiedFieldView } from "./identified-field-view";
import type { FieldOwner } from "./field-identity";
import {
  FieldAuthoringError,
  fieldOccurrenceDraftToFieldDef,
  tryNormalizeFieldOccurrenceDraft,
  type DurableFieldEntity,
  type NormalizedFieldOccurrenceDraft,
} from "./field-authoring";

// ---- JSON Schema types (subset of draft 2020-12) -------------------------

export type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  const?: unknown;
  format?: string;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  not?: JsonSchema;
  discriminator?: { propertyName: string };
  description?: string;
  title?: string;
  default?: unknown;
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  additionalProperties?: boolean | JsonSchema;
  [key: string]: unknown;
};

// ---- SetExpr → JSON Schema constraint ------------------------------------

// set-algebra-to-fenel Phase 3b-3c — this pure-structural SetExpr → JSON-schema
// reader is now a `.fenel` body (`fenel/modules/engine/json-schema.fenel`,
// registered as `engine:setExprToConstraints` in the engine module union). The
// body reads the registered `$tag` `Se*` ADT directly (dual-reading the legacy
// `$`-key form as transition tolerance, mirroring the old `peelSetExpr` dual-read)
// and serialises the SePattern arm via the already-Fenel `rxhPatternToRegex` ∘
// `rxhReadPat` (the lead of the three `patternToRegex` readers). This TS function
// is the thin dispatch seam — pass the raw `set` + `baseType`. Forward
// FenelType recursion is planned in Fenel over the shared ValidationType marker.
function setExprToConstraints(set: SetExpr, baseType: "string" | "number"): Partial<JsonSchema> {
  return dispatchEngineBody("engine:setExprToConstraints", [set, baseType]) as Partial<JsonSchema>;
}

// ---- FenelType → JSON Schema (canonical) ---------------------------------

function forwardMaybeValue<T>(value: { $tag: "Just"; _0: T } | { $tag: "Nothing" }): T | undefined {
  return value.$tag === "Just" ? value._0 : undefined;
}

function applyFieldSchemaPresentation(
  schema: JsonSchema,
  field: FieldDef,
  registry?: ModuleRegistry,
): JsonSchema {
  if (registry !== undefined && field.key?.$tag !== "PositionalField") {
    const view = resolveIdentifiedFieldView(registry, field);
    schema.title = canonical(view.presentation.label);
    const helpText = peelMaybeValue(view.display?.helpText ?? Nothing);
    if (helpText !== null) schema.description = canonical(helpText);
  }
  return schema;
}

function jsonSchemaPropertyMap(): Record<string, JsonSchema> {
  return Object.create(null) as Record<string, JsonSchema>;
}

function defineJsonSchemaProperty(
  properties: Record<string, JsonSchema>,
  name: string,
  value: JsonSchema,
): void {
  Object.defineProperty(properties, name, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

/** Serialize a Fenel-selected semantic plan to JSON-schema wire keys. */
function serializeJsonSchemaForwardPlan(
  plan: JsonSchemaForwardPlanWire,
  registry?: ModuleRegistry,
): JsonSchema {
  switch (plan.$tag) {
    case "JsfInvalid":
      throw new TypeError(plan.message);

    case "JsfMaybe":
      return {
        oneOf: [serializeJsonSchemaForwardPlan(plan.inner, registry), { type: "null" }],
      };

    case "JsfList":
      return {
        type: "array",
        items: serializeJsonSchemaForwardPlan(plan.item, registry),
      };

    case "JsfRecord": {
      const properties = jsonSchemaPropertyMap();
      const required: string[] = [];
      for (const field of plan.fields) {
        defineJsonSchemaProperty(
          properties,
          field.wireName,
          applyFieldSchemaPresentation(
            serializeJsonSchemaForwardPlan(field.plan, registry),
            field.rawField,
            registry,
          ),
        );
        if (field.required) required.push(field.wireName);
      }
      const schema: JsonSchema = {
        type: "object",
        properties,
        additionalProperties: false,
      };
      if (required.length > 0) schema.required = required;
      return schema;
    }

    case "JsfVariant": {
      const cases: JsonSchema[] = [];
      for (const variantCase of plan.cases) {
        const properties = jsonSchemaPropertyMap();
        defineJsonSchemaProperty(
          properties,
          plan.discriminator,
          { type: "string", const: variantCase.name },
        );
        const required = [plan.discriminator];
        for (const field of variantCase.fields) {
          defineJsonSchemaProperty(
            properties,
            field.wireName,
            applyFieldSchemaPresentation(
              serializeJsonSchemaForwardPlan(field.plan, registry),
              field.rawField,
              registry,
            ),
          );
          if (field.required) required.push(field.wireName);
        }
        cases.push({
          type: "object",
          properties,
          required,
          additionalProperties: false,
        });
      }
      return {
        oneOf: cases,
        discriminator: { propertyName: plan.discriminator },
      };
    }

    case "JsfMap": {
      const rowSchema = serializeJsonSchemaForwardPlan(plan.value, registry);
      const properties = jsonSchemaPropertyMap();
      for (const key of plan.keys) {
        defineJsonSchemaProperty(properties, key, rowSchema);
      }
      return {
        type: "object",
        properties,
        required: [...plan.keys],
        additionalProperties: false,
      };
    }

    case "JsfLocaleMap":
      return {
        oneOf: [
          { type: "string" },
          {
            type: "object",
            additionalProperties: serializeJsonSchemaForwardPlan(plan.value, registry),
          },
        ],
        description: "Translatable string (plain or locale map)",
      };

    case "JsfString": {
      const schema: JsonSchema = { type: "string" };
      const set = forwardMaybeValue(plan.set);
      if (set !== undefined) Object.assign(schema, setExprToConstraints(set, "string"));
      return schema;
    }

    case "JsfNumber": {
      const schema: JsonSchema = { type: "number" };
      const set = forwardMaybeValue(plan.set);
      if (set !== undefined) {
        const constraints = setExprToConstraints(set, "number");
        if (constraints.type === "integer") {
          schema.type = "integer";
          delete constraints.type;
        }
        Object.assign(schema, constraints);
      }
      return schema;
    }

    case "JsfTagged": {
      const schema = serializeJsonSchemaForwardPlan(plan.inner, registry);
      const unit = forwardMaybeValue(plan.unit);
      if (unit !== undefined) schema["x-unit"] = unit;
      return schema;
    }

    case "JsfRational": {
      const schema: JsonSchema = {
        type: "object",
        properties: {
          $tag: { const: "Rational" },
          num: { type: "string", pattern: "^-?(0|[1-9][0-9]*)$" },
          den: { type: "string", pattern: "^[1-9][0-9]*$" },
        },
        required: ["$tag", "num", "den"],
        additionalProperties: false,
        "x-fenel-type": "Rational",
      };
      return schema;
    }

    case "JsfBoolean":
      return { type: "boolean" };

    case "JsfDate": {
      const schema: JsonSchema = { type: "string", format: "date-time" };
      const set = forwardMaybeValue(plan.set);
      if (set !== undefined) Object.assign(schema, setExprToConstraints(set, "string"));
      return schema;
    }

    case "JsfFile":
      return {
        type: "object",
        description: "File descriptor (BlobValue)",
        properties: {
          url: { type: "string", format: "uri" },
          name: { type: "string" },
          size: { type: "number" },
          mimeType: { type: "string" },
          hash: { type: "string" },
        },
        required: ["url", "name", "size", "mimeType"],
      };

    case "JsfMarkup":
      return { type: "object", description: "Markup AST (Element | Text)" };

    case "JsfGeo": {
      const schema: JsonSchema = {
        type: "object",
        properties: {
          country: { type: "string", description: "Country ID" },
          region: { oneOf: [{ type: "string" }, { type: "null" }] },
          city: { oneOf: [{ type: "string" }, { type: "null" }] },
          postalCode: { oneOf: [{ type: "string" }, { type: "null" }] },
          street: { oneOf: [{ type: "string" }, { type: "null" }] },
          address: { oneOf: [{ type: "string" }, { type: "null" }] },
        },
        required: ["country"],
        additionalProperties: false,
      };
      const level = forwardMaybeValue(plan.level);
      if (level !== undefined) {
        schema["x-geo-level"] = draftStringFromTaggedLevel(
          level as Parameters<typeof draftStringFromTaggedLevel>[0],
        );
      }
      return schema;
    }

    case "JsfEntityRef":
      return { type: "string", description: `Reference to ${plan.entityType}` };

    case "JsfId":
      return { type: "string" };

    case "JsfNamed":
      return { description: `Named type: ${plan.name}` };

    case "JsfEmpty":
      return {};
  }
}

/**
 * Canonical conversion: FenelType → JSON Schema. The historical metadata
 * argument remains source-compatible but no longer selects schema semantics.
 */
export function fenelTypeToJsonSchema(
  type: FenelType,
  meta: FieldMetadata = {},
  registry?: ModuleRegistry,
  seenNamedTypes: ReadonlySet<string> = new Set(),
): JsonSchema {
  // FieldMetadata is retained as a source-compatible argument. All semantic
  // schema selection now comes from the type marker and registry facts.
  void meta;
  return serializeJsonSchemaForwardPlan(
    dispatchedJsonSchemaForwardPlan(type, { registry, seenNamedTypes }),
    registry,
  );
}

// ---- FieldDef[] → JSON Schema object -------------------------------------

function formFieldsToJsonSchema(
  fields: readonly FieldDef[],
  registry?: ModuleRegistry,
): JsonSchema {
  return fenelTypeToJsonSchema({ $record: { fields: [...fields] } }, {}, registry);
}

/** Convert a FieldDef[] to a JSON Schema object. */
export function formToJsonSchema(
  fields: readonly FieldDef[],
  opts?: { title?: string; description?: string; registry?: ModuleRegistry },
): JsonSchema {
  const schema = formFieldsToJsonSchema(fields, opts?.registry);
  if (opts?.title) schema.title = opts.title;
  if (opts?.description) schema.description = opts.description;
  return schema;
}

/**
 * Convert a FormDefinition to a JSON Schema.
 */
export function formDefinitionToJsonSchema(
  definition: FormDefinition,
  options?: { registry?: ModuleRegistry },
): JsonSchema {
  const schema = formFieldsToJsonSchema(formDefinitionFields(definition), options?.registry);
  schema.title = definition.slug;

  // Convert $defs to JSON Schema $defs
  if (definition.$defs) {
    schema.$defs = jsonSchemaPropertyMap();
    for (const [name, type] of Object.entries(definition.$defs)) {
      defineJsonSchemaProperty(
        schema.$defs,
        name,
        fenelTypeToJsonSchema(type, {}, options?.registry),
      );
    }
  }

  return schema;
}

/**
 * Convert an EntitySpec-like object to a JSON Schema. Accepts both the
 * canonical `type: FenelType` ($record) and a legacy raw-DB-row shape
 * (a `schema` JSONB array) via `entitySchemaFields`.
 */
export function entityToJsonSchema(entity: {
  id: string;
  type?: import("./types").FenelType;
  schema?: unknown;
}): JsonSchema {
  const schema = formFieldsToJsonSchema(entitySchemaFields(entity));
  schema.title = canonical(getLabel(entity.id) ?? entity.id);
  const description = getDescription(entity.id);
  if (description) schema.description = canonical(description);
  // Relations are first-class entities now (post-9b-P) — they don't nest
  // inline in the parent's JSON schema. Each related type has its own
  // entityToJsonSchema(...) emission keyed by entity name.
  return schema;
}

// ===========================================================================
// REVERSE: JSON Schema → Fenel
// ===========================================================================

// ---- JSON Schema → SetExpr -----------------------------------------------

/**
 * Extract SetExpr constraints from a JSON Schema.
 * Handles: enum, minimum/maximum, exclusiveMinimum/exclusiveMaximum,
 * pattern, format, not, anyOf, allOf, oneOf.
 *
 * Returns undefined if no constraints are expressible.
 */
export function jsonSchemaToSetExpr(schema: JsonSchema): SetExpr | undefined {
  const marker = createJsonSchemaReverseMarshal(schema).marker;
  assertJsonSchemaReverseMarkerPlan(marker);
  const planned = dispatchEngineBody("engine:jsonSchemaReverseSet", [marker]) as
    FenelMaybe<SetExpr>;
  return planned.$tag === "Just" ? planned._0 : undefined;
}

// ---- JSON Schema -> explicit Fenel authoring plan -------------------------

export type JsonSchemaIdentityIntent =
  | { $tag: "JsonSchemaMintField"; wireName: string }
  | { $tag: "JsonSchemaReuseField"; key: import("./types").FieldKey; wireName: string };

export type JsonSchemaIdentityPlanIssue = {
  code:
    | "invalid-wire-name"
    | "duplicate-wire-projection"
    | "invalid-reused-field"
    | "positional-reuse"
    | "duplicate-reused-field"
    | "invalid-json-literal";
  wireName: string;
  keyToken: string;
  message: string;
};

export class JsonSchemaAuthoringError extends TypeError {
  readonly issue: JsonSchemaIdentityPlanIssue;

  constructor(issue: JsonSchemaIdentityPlanIssue) {
    super(issue.message);
    this.name = "JsonSchemaAuthoringError";
    this.issue = issue;
  }
}

export type JsonSchemaTypeAuthoringPlan =
  | { $tag: "UseType"; type: FenelType }
  | { $tag: "ListType"; item: JsonSchemaTypeAuthoringPlan; constraint?: SetExpr }
  | { $tag: "RecordType"; fields: JsonSchemaFieldAuthoringPlan[] }
  | {
      $tag: "VariantType";
      discriminator: string;
      cases: Array<{ name: string; fields: JsonSchemaFieldAuthoringPlan[] }>;
    };

export type JsonSchemaFieldAuthoringPlan = {
  identity: JsonSchemaIdentityIntent;
  wireName: string;
  required: boolean;
  typePlan: JsonSchemaTypeAuthoringPlan;
  title?: string;
  description?: string;
  meta: FieldMetadata;
};

export type JsonSchemaAuthoringPlan = {
  $tag: "JsonSchemaAuthoringPlan";
  typePlan: JsonSchemaTypeAuthoringPlan;
  meta: FieldMetadata;
};

export type JsonSchemaAuthoringOptions = {
  reuseField?: (
    path: readonly string[],
    schema: JsonSchema,
  ) => import("./types").FieldKey | undefined;
};

export type JsonSchemaAuthoringApplyOptions = JsonSchemaAuthoringOptions & {
  /** Owner context required by the ordinary Phase-2b authoring validator. */
  owner: FieldOwner;
  /** Live/tombstoned field inventory used to validate explicit reuse and to
   * reject entropy that collides with an already-reserved UUID. */
  availableFields: readonly DurableFieldEntity[];
  /** Authorized entropy leaf. It is invoked exactly once for each MintField
   * intent; schema planning itself remains deterministic and entropy-free. */
  mintFieldId: (request: {
    path: readonly string[];
    wireName: string;
  }) => string;
};

export type AppliedJsonSchemaAuthoringPlan = {
  type: FenelType;
  meta: FieldMetadata;
  fields: readonly FieldDef[];
  drafts: readonly NormalizedFieldOccurrenceDraft[];
  mintedFieldIds: readonly string[];
};

type FenelMaybe<T> =
  | { $tag: "Nothing" }
  | { $tag: "Just"; _0: T };

type JsonSchemaMarkerSlot<T = unknown> = {
  present: boolean;
  value: T;
};

type JsonSchemaReverseMarkerProperty = {
  location: number;
  wireName: string;
  schema: JsonSchemaReverseMarker;
  reuse: JsonSchemaReverseReuseMarker;
};

type JsonSchemaReverseReuseMarker = {
  present: boolean;
  kind: unknown;
  referenceValue: unknown;
  indexValue: unknown;
};

type JsonSchemaReverseJsonEntryMarker = {
  key: string;
  value: JsonSchemaReverseJsonValueMarker;
};

type JsonSchemaReverseJsonValueMarker = {
  kind: "null" | "boolean" | "number" | "string" | "array" | "object" | "unsupported";
  value: unknown;
  items: JsonSchemaReverseJsonValueMarker[];
  entries: JsonSchemaReverseJsonEntryMarker[];
};

type JsonSchemaReverseMarker = {
  typeValue: JsonSchemaMarkerSlot;
  referenceValue: JsonSchemaMarkerSlot;
  propertyRows: JsonSchemaReverseMarkerProperty[];
  requiredNames: unknown[];
  itemsSchema: JsonSchemaMarkerSlot<JsonSchemaReverseMarker>;
  enumValues: JsonSchemaMarkerSlot<JsonSchemaReverseJsonValueMarker>;
  constValue: JsonSchemaMarkerSlot<JsonSchemaReverseJsonValueMarker>;
  formatValue: JsonSchemaMarkerSlot;
  patternValue: JsonSchemaMarkerSlot;
  minimumValue: JsonSchemaMarkerSlot;
  maximumValue: JsonSchemaMarkerSlot;
  exclusiveMinimumValue: JsonSchemaMarkerSlot;
  exclusiveMaximumValue: JsonSchemaMarkerSlot;
  multipleOfValue: JsonSchemaMarkerSlot;
  minItemsValue: JsonSchemaMarkerSlot;
  maxItemsValue: JsonSchemaMarkerSlot;
  uniqueItemsValue: JsonSchemaMarkerSlot;
  anyOfSchemas: JsonSchemaReverseMarker[];
  allOfSchemas: JsonSchemaReverseMarker[];
  oneOfSchemas: JsonSchemaReverseMarker[];
  notSchema: JsonSchemaMarkerSlot<JsonSchemaReverseMarker>;
  discriminatorName: JsonSchemaMarkerSlot;
  titleValue: JsonSchemaMarkerSlot;
  descriptionValue: JsonSchemaMarkerSlot;
};

type JsonSchemaReverseWireField = {
  identity: JsonSchemaIdentityIntent;
  wireName: string;
  required: boolean;
  typePlan: JsonSchemaReverseWireTypePlan;
  title: FenelMaybe<string>;
  description: FenelMaybe<string>;
};

type JsonSchemaReverseWireTypePlan =
  | { kind: "use"; base: string; constraint: FenelMaybe<SetExpr> }
  | { kind: "list"; item: JsonSchemaReverseWireTypePlan; constraint: FenelMaybe<SetExpr> }
  | { kind: "record"; fields: JsonSchemaReverseWireField[] }
  | {
      kind: "variant";
      discriminator: string;
      cases: Array<{ name: string; fields: JsonSchemaReverseWireField[] }>;
    };

type JsonSchemaReverseResult<T> = {
  ok: boolean;
  plan: T;
  code: JsonSchemaIdentityPlanIssue["code"] | "";
  wireName: string;
  keyToken: string;
  message: string;
};

type JsonSchemaReverseReuseRequest = {
  location: number;
  path: string[];
  wireName: string;
};

type JsonSchemaReverseMarshalState = {
  nextLocation: number;
  rows: JsonSchemaReverseMarkerProperty[];
  sources: JsonSchema[];
};

type JsonSchemaReverseMarshal = JsonSchemaReverseMarshalState & {
  marker: JsonSchemaReverseMarker;
};

const hasOwnJsonSchemaKey = (record: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

function jsonSchemaMarkerRecord<T extends object>(
  entries: ReadonlyArray<readonly [PropertyKey, unknown]>,
): T {
  const record = Object.create(null) as T;
  for (const [key, value] of entries) {
    Object.defineProperty(record, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return record;
}

function jsonSchemaOwnRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function jsonSchemaOwnValue(
  record: Record<string, unknown>,
  key: string,
): unknown {
  if (!hasOwnJsonSchemaKey(record, key)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && "value" in descriptor
    ? descriptor.value
    : undefined;
}

function jsonSchemaDataArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor !== undefined && "value" in descriptor) result.push(descriptor.value);
  }
  return result;
}

function jsonSchemaMarkerSlot(
  record: Record<string, unknown>,
  key: string,
): JsonSchemaMarkerSlot {
  const rawValue = jsonSchemaOwnValue(record, key);
  const value = Array.isArray(rawValue) ? jsonSchemaDataArray(rawValue) : rawValue;
  return jsonSchemaMarkerRecord<JsonSchemaMarkerSlot>([
    ["present", value !== undefined],
    ["value", value],
  ]);
}

function jsonSchemaMarkerArray(
  record: Record<string, unknown>,
  key: string,
): unknown[] {
  const value = jsonSchemaOwnValue(record, key);
  return jsonSchemaDataArray(value);
}

function marshalJsonSchemaJsonValue(
  value: unknown,
  activeObjects: WeakSet<object> = new WeakSet<object>(),
): JsonSchemaReverseJsonValueMarker {
  let kind: JsonSchemaReverseJsonValueMarker["kind"] = "unsupported";
  let scalar: unknown;
  let items: JsonSchemaReverseJsonValueMarker[] = [];
  let entries: JsonSchemaReverseJsonEntryMarker[] = [];

  if (value === null) kind = "null";
  else if (typeof value === "boolean" || typeof value === "string") {
    kind = typeof value === "boolean" ? "boolean" : "string";
    scalar = value;
  } else if (typeof value === "number") {
    if (Number.isFinite(value)) {
      kind = "number";
      scalar = value;
    } else {
      // Mechanical JSON-domain fact only. Fenel decides that every
      // `unsupported` marker invalidates the complete authoring plan.
      scalar = "non-finite-number";
    }
  } else if (Array.isArray(value)) {
    if (activeObjects.has(value)) {
      scalar = "cyclic-reference";
    } else {
      activeObjects.add(value);
      try {
        kind = "array";
        for (let index = 0; index < value.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          if (descriptor === undefined) {
            kind = "unsupported";
            scalar = "sparse-array";
            items = [];
            break;
          }
          if (!("value" in descriptor)) {
            kind = "unsupported";
            scalar = "accessor-array-index";
            items = [];
            break;
          }
          items.push(marshalJsonSchemaJsonValue(descriptor.value, activeObjects));
        }
      } finally {
        activeObjects.delete(value);
      }
    }
  } else {
    const record = jsonSchemaOwnRecord(value);
    if (record !== undefined) {
      if (activeObjects.has(record)) {
        scalar = "cyclic-reference";
      } else {
        activeObjects.add(record);
        try {
          kind = "object";
          entries = Object.keys(record).flatMap((key) => {
            const descriptor = Object.getOwnPropertyDescriptor(record, key);
            return descriptor !== undefined && "value" in descriptor
              ? [jsonSchemaMarkerRecord<JsonSchemaReverseJsonEntryMarker>([
                  ["key", key],
                  ["value", marshalJsonSchemaJsonValue(descriptor.value, activeObjects)],
                ])]
              : [];
          });
        } finally {
          // Path-local activity, rather than a permanent visited set, rejects
          // cycles while preserving JSON-valid shared DAGs by value.
          activeObjects.delete(record);
        }
      }
    } else {
      // Mechanical host-kind fact only. Fenel recursively decides whether this
      // kind is a valid JSON literal and rejects the complete reverse marker
      // before any reuse callback, authoring action, or entropy request.
      scalar = typeof value;
    }
  }

  return jsonSchemaMarkerRecord<JsonSchemaReverseJsonValueMarker>([
    ["kind", kind],
    ["value", scalar],
    ["items", items],
    ["entries", entries],
  ]);
}

function jsonSchemaJsonMarkerSlot(
  record: Record<string, unknown>,
  key: string,
): JsonSchemaMarkerSlot<JsonSchemaReverseJsonValueMarker> {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  const present = descriptor !== undefined && "value" in descriptor;
  const rawValue = present ? descriptor.value : undefined;
  return jsonSchemaMarkerRecord<JsonSchemaMarkerSlot<JsonSchemaReverseJsonValueMarker>>([
    ["present", present],
    ["value", marshalJsonSchemaJsonValue(rawValue)],
  ]);
}

function jsonSchemaReverseReuseMarker(
  key?: import("./types").FieldKey,
): JsonSchemaReverseReuseMarker {
  const record = key === undefined ? undefined : jsonSchemaOwnRecord(key);
  const ref = record === undefined
    ? undefined
    : jsonSchemaOwnRecord(jsonSchemaOwnValue(record, "ref"));
  return jsonSchemaMarkerRecord<JsonSchemaReverseReuseMarker>([
    ["present", key !== undefined],
    ["kind", record === undefined ? undefined : jsonSchemaOwnValue(record, "$tag")],
    ["referenceValue", ref === undefined ? undefined : jsonSchemaOwnValue(ref, "$ref")],
    ["indexValue", record === undefined ? undefined : jsonSchemaOwnValue(record, "index")],
  ]);
}

/**
 * Mechanical JSON-Schema ingress codec. It performs no type/constraint policy:
 * it reads own data properties once and turns dynamic property maps into
 * ordered rows. Fixed marker keys are deliberately `$`-free; `$ref` is renamed
 * to `referenceValue` at this barrier. Reuse facts are attached afterward at
 * the Fenel-selected semantic paths, without reading the raw schema again.
 */
function marshalJsonSchemaReverseMarker(
  schema: unknown,
  state: JsonSchemaReverseMarshalState,
): JsonSchemaReverseMarker {
  const record = jsonSchemaOwnRecord(schema) ?? jsonSchemaMarkerRecord<Record<string, unknown>>([]);

  const marshalChildren = (key: "anyOf" | "allOf" | "oneOf"): JsonSchemaReverseMarker[] =>
    jsonSchemaMarkerArray(record, key).map((child) =>
      marshalJsonSchemaReverseMarker(child, state));

  const rawProperties = jsonSchemaOwnRecord(jsonSchemaOwnValue(record, "properties"));
  const propertyRows = Object.keys(rawProperties ?? {}).flatMap((wireName) => {
    const descriptor = rawProperties === undefined
      ? undefined
      : Object.getOwnPropertyDescriptor(rawProperties, wireName);
    if (descriptor === undefined || !("value" in descriptor)) return [];
    const child = descriptor.value;
    const location = state.nextLocation;
    state.nextLocation += 1;
    state.sources[location] = child as JsonSchema;
    const row = jsonSchemaMarkerRecord<JsonSchemaReverseMarkerProperty>([
      ["location", location],
      ["wireName", wireName],
      ["schema", marshalJsonSchemaReverseMarker(child, state)],
      ["reuse", jsonSchemaReverseReuseMarker()],
    ]);
    state.rows[location] = row;
    return [row];
  });

  const itemsValue = jsonSchemaOwnValue(record, "items");
  const itemsSchema = jsonSchemaMarkerRecord<JsonSchemaMarkerSlot<JsonSchemaReverseMarker>>([
    ["present", itemsValue !== undefined],
    ["value", itemsValue === undefined
      ? jsonSchemaMarkerRecord<Record<string, never>>([])
      : marshalJsonSchemaReverseMarker(itemsValue, state)],
  ]);
  const notValue = jsonSchemaOwnValue(record, "not");
  const notSchema = jsonSchemaMarkerRecord<JsonSchemaMarkerSlot<JsonSchemaReverseMarker>>([
    ["present", notValue !== undefined],
    ["value", notValue === undefined
      ? jsonSchemaMarkerRecord<Record<string, never>>([])
      : marshalJsonSchemaReverseMarker(notValue, state)],
  ]);
  const discriminator = jsonSchemaOwnRecord(jsonSchemaOwnValue(record, "discriminator"));
  const discriminatorName = discriminator === undefined
    ? jsonSchemaMarkerRecord<JsonSchemaMarkerSlot>([["present", false], ["value", undefined]])
    : jsonSchemaMarkerSlot(discriminator, "propertyName");

  return jsonSchemaMarkerRecord<JsonSchemaReverseMarker>([
    ["typeValue", jsonSchemaMarkerSlot(record, "type")],
    ["referenceValue", jsonSchemaMarkerSlot(record, "$ref")],
    ["propertyRows", propertyRows],
    ["requiredNames", jsonSchemaMarkerArray(record, "required")],
    ["itemsSchema", itemsSchema],
    ["enumValues", jsonSchemaJsonMarkerSlot(record, "enum")],
    ["constValue", jsonSchemaJsonMarkerSlot(record, "const")],
    ["formatValue", jsonSchemaMarkerSlot(record, "format")],
    ["patternValue", jsonSchemaMarkerSlot(record, "pattern")],
    ["minimumValue", jsonSchemaMarkerSlot(record, "minimum")],
    ["maximumValue", jsonSchemaMarkerSlot(record, "maximum")],
    ["exclusiveMinimumValue", jsonSchemaMarkerSlot(record, "exclusiveMinimum")],
    ["exclusiveMaximumValue", jsonSchemaMarkerSlot(record, "exclusiveMaximum")],
    ["multipleOfValue", jsonSchemaMarkerSlot(record, "multipleOf")],
    ["minItemsValue", jsonSchemaMarkerSlot(record, "minItems")],
    ["maxItemsValue", jsonSchemaMarkerSlot(record, "maxItems")],
    ["uniqueItemsValue", jsonSchemaMarkerSlot(record, "uniqueItems")],
    ["anyOfSchemas", marshalChildren("anyOf")],
    ["allOfSchemas", marshalChildren("allOf")],
    ["oneOfSchemas", marshalChildren("oneOf")],
    ["notSchema", notSchema],
    ["discriminatorName", discriminatorName],
    ["titleValue", jsonSchemaMarkerSlot(record, "title")],
    ["descriptionValue", jsonSchemaMarkerSlot(record, "description")],
  ]);
}

function createJsonSchemaReverseMarshal(schema: JsonSchema): JsonSchemaReverseMarshal {
  const state: JsonSchemaReverseMarshalState = {
    nextLocation: 0,
    rows: [],
    sources: [],
  };
  const marker = marshalJsonSchemaReverseMarker(schema, state);
  return { ...state, marker };
}

function marshalJsonSchemaReverseWithReuse(
  schema: JsonSchema,
  options: JsonSchemaAuthoringOptions,
  requestFnId:
    | "engine:jsonSchemaReverseReuseRequests"
    | "engine:jsonSchemaReverseFormReuseRequests",
): JsonSchemaReverseMarker {
  const marshalled = createJsonSchemaReverseMarshal(schema);
  assertJsonSchemaReverseMarkerPlan(marshalled.marker);
  if (options.reuseField === undefined) return marshalled.marker;
  const requests = dispatchEngineBody(requestFnId, [marshalled.marker]) as
    JsonSchemaReverseReuseRequest[];
  for (const request of requests) {
    const row = marshalled.rows[request.location];
    const source = marshalled.sources[request.location];
    if (row === undefined) {
      throw new TypeError(`JSON Schema reverse planner requested unknown property ${request.location}`);
    }
    const reuse = options.reuseField(request.path, source as JsonSchema);
    if (reuse !== undefined) row.reuse = jsonSchemaReverseReuseMarker(reuse);
  }
  return marshalled.marker;
}

function jsonSchemaReverseValue<T>(value: FenelMaybe<T>): T | undefined {
  return value.$tag === "Just" ? value._0 : undefined;
}

function jsonSchemaReversePlanOrThrow<T>(result: JsonSchemaReverseResult<T>): T {
  if (result.ok) return result.plan;
  throw new JsonSchemaAuthoringError({
    code: result.code || "invalid-reused-field",
    wireName: result.wireName,
    keyToken: result.keyToken,
    message: result.message || "invalid JSON Schema field identity plan",
  });
}

/** Fenel-owned whole-marker preflight. This runs before reuse callbacks and the
 * authorized entropy/application edge; TS only dispatches and unwraps Result. */
function assertJsonSchemaReverseMarkerPlan(
  marker: JsonSchemaReverseMarker,
): void {
  const result = dispatchEngineBody("engine:jsonSchemaReversePlan", [marker]) as
    JsonSchemaReverseResult<JsonSchemaReverseWireTypePlan>;
  void jsonSchemaReversePlanOrThrow(result);
}

function serializeJsonSchemaReverseField(
  field: JsonSchemaReverseWireField,
): JsonSchemaFieldAuthoringPlan {
  const title = jsonSchemaReverseValue(field.title);
  const description = jsonSchemaReverseValue(field.description);
  return {
    identity: field.identity,
    wireName: field.wireName,
    required: field.required,
    typePlan: serializeJsonSchemaReverseType(field.typePlan),
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    meta: {},
  };
}

function serializeJsonSchemaReverseType(
  plan: JsonSchemaReverseWireTypePlan,
): JsonSchemaTypeAuthoringPlan {
  switch (plan.kind) {
    case "use": {
      const base: FenelType = { $ref: plan.base };
      const set = jsonSchemaReverseValue(plan.constraint);
      return {
        $tag: "UseType",
        type: set === undefined ? base : { $refined: { base, set } },
      };
    }
    case "list": {
      const constraint = jsonSchemaReverseValue(plan.constraint);
      return {
        $tag: "ListType",
        item: serializeJsonSchemaReverseType(plan.item),
        ...(constraint === undefined ? {} : { constraint }),
      };
    }
    case "record":
      return {
        $tag: "RecordType",
        fields: plan.fields.map(serializeJsonSchemaReverseField),
      };
    case "variant":
      return {
        $tag: "VariantType",
        discriminator: plan.discriminator,
        cases: plan.cases.map((variantCase) => ({
          name: variantCase.name,
          fields: variantCase.fields.map(serializeJsonSchemaReverseField),
        })),
      };
  }
}

export function jsonSchemaToFenelType(
  schema: JsonSchema,
  options: JsonSchemaAuthoringOptions = {},
): JsonSchemaAuthoringPlan {
  const marker = marshalJsonSchemaReverseWithReuse(
    schema,
    options,
    "engine:jsonSchemaReverseReuseRequests",
  );
  const result = dispatchEngineBody("engine:jsonSchemaReversePlan", [marker]) as
    JsonSchemaReverseResult<JsonSchemaReverseWireTypePlan>;
  return {
    $tag: "JsonSchemaAuthoringPlan",
    typePlan: serializeJsonSchemaReverseType(jsonSchemaReversePlanOrThrow(result)),
    meta: {},
  };
}

/**
 * Apply the reverse-schema authoring plan at an explicit IO edge.
 *
 * The Fenel planner chooses Mint/Reuse intent. This adapter only injects UUID
 * entropy for Mint intents, serializes the identity-bearing plan to FieldDef,
 * and submits every occurrence to Phase-2b's field-authoring validator before
 * any identified type is returned.
 */
export function applyJsonSchemaAuthoringPlan(
  schema: JsonSchema,
  options: JsonSchemaAuthoringApplyOptions,
): AppliedJsonSchemaAuthoringPlan {
  const plan = jsonSchemaToFenelType(schema, options);
  const available = [...options.availableFields];
  const fields: FieldDef[] = [];
  const drafts: NormalizedFieldOccurrenceDraft[] = [];
  const mintedFieldIds: string[] = [];

  const materializeType = (
    typePlan: JsonSchemaTypeAuthoringPlan,
    path: readonly string[],
  ): FenelType => {
    switch (typePlan.$tag) {
      case "UseType":
        return typePlan.type;
      case "ListType": {
        const list = List(materializeType(typePlan.item, [...path, "item"]));
        return typePlan.constraint === undefined
          ? list
          : { $refined: { base: list, set: typePlan.constraint } };
      }
      case "RecordType":
        return {
          $record: {
            fields: typePlan.fields.map((fieldPlan) =>
              materializeField(fieldPlan, [...path, fieldPlan.wireName])),
          },
        };
      case "VariantType":
        return {
          $variant: {
            discriminator: typePlan.discriminator,
            cases: typePlan.cases.map((casePlan) => ({
              name: casePlan.name,
              label: Nothing,
              fields: casePlan.fields.map((fieldPlan) =>
                materializeField(fieldPlan, [
                  ...path,
                  `case:${casePlan.name}`,
                  fieldPlan.wireName,
                ])),
            })),
          },
        };
    }
  };

  const materializeField = (
    fieldPlan: JsonSchemaFieldAuthoringPlan,
    path: readonly string[],
  ): FieldDef => {
    const plannedType = materializeType(fieldPlan.typePlan, path);
    const occurrenceType = fieldPlan.required ? plannedType : Maybe(plannedType);
    const identity = fieldPlan.identity;
    const fieldId = identity.$tag === "JsonSchemaMintField"
      ? options.mintFieldId({ path, wireName: fieldPlan.wireName })
      : identity.key.$tag === "NamedField"
        ? identity.key.ref.$ref
        : "";
    const action = identity.$tag === "JsonSchemaMintField"
      ? { kind: "new" as const, fieldId }
      : { kind: "reuse" as const, fieldId };
    const normalized = tryNormalizeFieldOccurrenceDraft({
      draftId: `json-schema:${path.map(encodeURIComponent).join("/")}`,
      owner: options.owner,
      action,
      codeName: fieldPlan.wireName,
      occurrenceType,
      facets: {
        ...(fieldPlan.title === undefined ? {} : { label: fieldPlan.title }),
        ...(fieldPlan.description === undefined
          ? {}
          : { description: fieldPlan.description }),
      },
    }, available);
    if (!normalized.ok) throw new FieldAuthoringError(normalized.error);

    drafts.push(normalized.value);
    const materialized = {
      ...fieldOccurrenceDraftToFieldDef(normalized.value),
      label: fieldPlan.title === undefined ? Nothing : Just(fieldPlan.title),
    };
    fields.push(materialized);
    if (identity.$tag === "JsonSchemaMintField") {
      mintedFieldIds.push(fieldId);
      // Reserve injected entropy immediately so a buggy source cannot return
      // the same UUID for a later Mint intent in this application.
      available.push({
        id: fieldId,
        currentCodeName: fieldPlan.wireName,
        status: "live",
        realm: "account",
        reuseVisibility: "account",
      });
    }
    return materialized;
  };

  return {
    type: materializeType(plan.typePlan, []),
    meta: plan.meta,
    fields,
    drafts,
    mintedFieldIds,
  };
}

export function jsonSchemaToFormFields(
  schema: JsonSchema,
  options: JsonSchemaAuthoringOptions = {},
): JsonSchemaFieldAuthoringPlan[] {
  const marker = marshalJsonSchemaReverseWithReuse(
    schema,
    options,
    "engine:jsonSchemaReverseFormReuseRequests",
  );
  const result = dispatchEngineBody("engine:jsonSchemaReverseFormFields", [marker]) as
    JsonSchemaReverseResult<JsonSchemaReverseWireField[]>;
  return jsonSchemaReversePlanOrThrow(result).map(serializeJsonSchemaReverseField);
}
