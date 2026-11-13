import type { AuthoringEnvironment } from "@fenel/engine/authoring/environment";
import { peelListForAuthoring } from "@fenel/engine/authoring/type";
import { contains, witnessOf } from "@fenel/engine/set-algebra";
import type { FenelType, SetExpr } from "@fenel/engine/types";
import { emptyImageValue, isInlineImageValue } from "./image-canvas-data";

export type InlineWidget = {
  kind: "scalar" | "field" | "image";
  /** Resolve aliases before handing a type to the existing field renderer. */
  type: FenelType;
  scalarType?: "string" | "number";
  /** Missing means that the widget exists, but no valid initial value is known. */
  seedValue?: unknown;
};

const NUMBER_INPUTS = new Set(["Number", "Nat", "Int", "Rational", "Real", "ℕ", "ℤ", "ℝ"]);
const STRING_INPUTS = new Set(["String", "Char"]);

function named(type: FenelType): string | undefined {
  return "$ref" in type ? type.$ref : "$opaque" in type ? type.$opaque.name : undefined;
}

function resolvedRef(type: FenelType, environment: AuthoringEnvironment): FenelType | undefined {
  if (!("$ref" in type) || environment.hasFunctionRefLiteral(type.$ref)) return undefined;
  return environment.resolveTypeRef?.(type) ?? environment.resolveNamedType?.(type.$ref);
}

function unalias(type: FenelType, environment: AuthoringEnvironment): FenelType {
  const seen = new Set<FenelType>();
  const names = new Set<string>();
  let current = type;
  while (!seen.has(current) && seen.size < 64) {
    seen.add(current);
    if ("$ref" in current) {
      if (names.has(current.$ref)) break;
      names.add(current.$ref);
    }
    const next = resolvedRef(current, environment);
    if (!next) break;
    current = next;
  }
  return current;
}

/** Recover a selected type's name from its full catalog definition. Snapshots
 * may clone the definition, so reference equality is insufficient. */
function sameTypeData(left: unknown, right: unknown, seen = new WeakMap<object, WeakSet<object>>()): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (seen.get(left)?.has(right)) return true;
  if (!seen.has(left)) seen.set(left, new WeakSet());
  seen.get(left)!.add(right);
  const a = Object.keys(left).sort();
  const b = Object.keys(right).sort();
  return a.length === b.length && a.every((key, index) => key === b[index]
    && sameTypeData((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key], seen));
}

const imageTypes = new WeakMap<AuthoringEnvironment, FenelType | undefined>();

function imageTypeIn(environment: AuthoringEnvironment): FenelType | undefined {
  if (imageTypes.has(environment)) return imageTypes.get(environment);
  const result = resolveImageTypeIn(environment);
  imageTypes.set(environment, result);
  return result;
}

function resolveImageTypeIn(environment: AuthoringEnvironment): FenelType | undefined {
  const entry = environment.catalog.types.find((type) => type.name === "Image");
  const candidate = entry?.type ?? environment.resolveNamedType?.("Image");
  if (!candidate) return undefined;
  return imageRecordType(candidate, environment);
}

function imageRecordType(type: FenelType, environment: AuthoringEnvironment): FenelType | undefined {
  const resolved = unalias(type, environment);
  // A local type with the same display name must actually describe an image.
  if (!("$record" in resolved) || resolved.$record.fields.length !== 3) return undefined;
  const fields = resolved.$record.fields;
  const width = fields.find((field) => field.name === "width");
  const height = fields.find((field) => field.name === "height");
  const pixels = fields.find((field) => field.name === "pixels");
  if (!width || !height || !pixels) return undefined;
  const isNat = (type: FenelType) => named(type) === "Nat" || named(unalias(type, environment)) === "Nat";
  if (!isNat(width.type) || !isNat(height.type)) return undefined;
  const list = peelListForAuthoring(unalias(pixels.type, environment));
  if (!list) return undefined;
  const color = unalias(list.elem, environment);
  if (!("$record" in color) || color.$record.fields.length !== 4) return undefined;
  return ["r", "g", "b", "a"].every((name) => {
    const field = color.$record.fields.find((field) => field.name === name);
    return field !== undefined && isNat(field.type);
  }) ? resolved : undefined;
}

function primitiveSeedFits(widget: InlineWidget, value: unknown): boolean {
  if ("$refined" in widget.type) {
    const member = contains(widget.type.$refined.set, value, null);
    if (member.$tag !== "Just" || !member._0) return false;
    return primitiveSeedFits({ ...widget, type: widget.type.$refined.base }, value);
  }
  if (widget.scalarType === "string") {
    return typeof value === "string" && (named(widget.type) !== "Char" || [...value].length === 1);
  }
  if (widget.scalarType === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    const name = named(widget.type);
    if (name === "Nat" || name === "ℕ") return Number.isInteger(value) && value >= 0;
    if (name === "Int" || name === "ℤ") return Number.isInteger(value);
    return true;
  }
  if (widget.kind === "image") return isInlineImageValue(value);
  // A structural widget's own seed is known to have the right shape. Do not
  // treat an arbitrary witness of an outer set as a value of its record type.
  return value !== null && value !== undefined && value === widget.seedValue;
}

function seedInRefinement(
  set: SetExpr,
  base: InlineWidget,
  examples: readonly unknown[] | undefined,
): unknown {
  const candidates = [base.seedValue, ...(examples ?? [])];
  const witness = witnessOf(set) as { $tag?: string; _0?: unknown };
  if (witness?.$tag === "Just") candidates.push(witness._0);
  return candidates.find((value) => {
    if (!primitiveSeedFits(base, value)) return false;
    const member = contains(set, value, null);
    return member.$tag === "Just" && member._0;
  });
}

/** Browser widget capabilities. A generic value/JSON/ADT renderer is not an
 * inline capability. Unsupported and unresolved types deliberately return no
 * widget; their editor can offer constructors, calls and structural forms. */
export function inlineWidgetFor(
  declaredType: FenelType | undefined,
  typeName: string | undefined,
  environment: AuthoringEnvironment,
  options: { seed?: boolean } = {},
): InlineWidget | undefined {
  const type = declaredType ?? (typeName ? { $ref: typeName } : undefined);
  if (!type) return undefined;
  const selectedDefinition = typeName ? resolvedRef({ $ref: typeName }, environment) : undefined;
  const selectedName = selectedDefinition && sameTypeData(type, selectedDefinition) ? typeName : undefined;
  const visit = (current: FenelType, seen: Set<FenelType>): InlineWidget | undefined => {
    if (seen.has(current) || seen.size > 64) return undefined;
    const nextSeen = new Set(seen).add(current);
    const name = named(current) ?? (current === type ? selectedName : undefined);
    if (name && NUMBER_INPUTS.has(name)) return {
      kind: "scalar", type: current, scalarType: "number", seedValue: 0,
    };
    if (name && STRING_INPUTS.has(name)) return {
      kind: "scalar", type: current, scalarType: "string", seedValue: name === "Char" ? "a" : "",
    };
    // These are sums with constructors, even when a runtime has a scalar rep.
    if (name === "Boolean" || name === "Bool" || name === "Unit") return undefined;
    if (name === "LocaleString") return { kind: "field", type: { $ref: "LocaleString" }, seedValue: "" };
    // Existing date and WYSIWYG markup leaves are specific widgets too. The
    // declared selection may already carry the resolved structural definition.
    if (name === "Date") return { kind: "field", type: { $ref: "Date" }, seedValue: "1970-01-01" };
    if (name === "Markup") return {
      kind: "field", type: { $ref: "Markup" }, seedValue: { $tag: "Text", value: "" },
    };
    if (name === "File") return { kind: "field", type: { $ref: "File" } };
    if ("$refined" in current) {
      const base = visit(current.$refined.base, nextSeen);
      if (!base) return undefined;
      const seedValue = options.seed === false ? undefined : seedInRefinement(
        current.$refined.set,
        base,
        typeName ? environment.examplesForTypeName?.(typeName) : undefined,
      );
      return {
        ...base,
        kind: base.kind === "image" ? "image" : "field",
        type: { $refined: { ...current.$refined, base: base.type } },
        seedValue,
      };
    }
    const resolved = resolvedRef(current, environment);
    const candidate = resolved ?? current;
    if ("$record" in candidate) {
      const imageType = imageTypeIn(environment);
      // Function parameter projections carry their own field identities and
      // presentation facets. Match the complete structural pixel schema, not
      // those unrelated facets (or just the width/height field names).
      if (imageType && imageRecordType(candidate, environment)) {
        return { kind: "image", type: candidate, seedValue: emptyImageValue() };
      }
    }
    if (resolved) return visit(resolved, nextSeen);
    if (peelListForAuthoring(current)) return { kind: "field", type: current, seedValue: [] };
    if ("$record" in current) {
      // A single-key object can invoke a runtime function. A form control
      // alone is insufficient without an unambiguous literal encoding.
      if (current.$record.fields.length <= 1) return undefined;
      const fields = current.$record.fields.map((field) => ({ field, widget: visit(field.type, nextSeen) }));
      // A record of scalar/widgets has an actual form. Other records use the
      // expression record builder so constructor-only children stay explicit.
      if (fields.some(({ widget }) => widget === undefined)) return undefined;
      return {
        kind: "field",
        type: { $record: { fields: fields.map(({ field, widget }) => ({ ...field, type: widget!.type })) } },
        seedValue: fields.every(({ widget }) => widget!.seedValue !== undefined)
          ? Object.fromEntries(fields.map(({ field, widget }) => [field.name, widget!.seedValue]))
          : undefined,
      };
    }
    if ("$map" in current) {
      // Arbitrary keys include callable names. Until the expression wire can
      // quote that data, use construction instead of advertising an unsafe
      // whole-dictionary literal editor.
      return undefined;
    }
    if ("$tuple" in current) {
      const elements = current.$tuple.map((element) => visit(element, nextSeen));
      if (elements.some((element) => element?.scalarType === undefined)) return undefined;
      return {
        kind: "field", type: { $tuple: elements.map((element) => element!.type) },
        seedValue: elements.every((element) => element!.seedValue !== undefined)
          ? elements.map((element) => element!.seedValue) : undefined,
      };
    }
    if ("$tagged" in current) {
      const inner = visit(current.$tagged.value, nextSeen);
      // FieldRenderer presents these through an entity reference picker; an
      // empty scalar is not evidence that an entity reference exists. Numeric
      // phantom tags also must not inherit a picker that writes string IDs.
      const target = named(current.$tagged.phantom);
      return inner?.scalarType === "string" && target !== undefined
        && environment.resolveNamedType?.(target) !== undefined
        ? { kind: "field", type: current } : undefined;
    }
    if ("$opaque" in current && current.$opaque.pure) return visit(current.$opaque.pure, nextSeen);
    return undefined;
  };
  return visit(type, new Set());
}
