import { projectAuthoringScheme, type AuthoringCatalogFunctionEntry, type AuthoringExactFunctionRoute } from "@fenel/engine/authoring/environment";
import { typeCode } from "@fenel/engine/authoring/expression";
import type { FenelType, FieldDef } from "@fenel/engine/types";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { resolveRegistryFieldPresentation } from "@fenel/engine/field-representations";
import { canonical } from "@fenel/engine/locale";
import { peelMaybeValue } from "@fenel/engine/maybe-value";
import { codeName, humanName, type DisplayName } from "../display-name";

/** DOM presentation bridge. Identified parameters use the same Fenel field
 * presentation as record fields when the field has a human label
 * (`Labelable`, e.g. `@fieldLabel "s" "Text"`); without one the parameter's
 * code name is shown as written and marked as code, never re-cased into a
 * label. A declared name remains a transport fallback only for
 * transient/legacy parameters that have no field identity yet. */
export function parameterDisplayName(
  field: FieldDef | undefined,
  ordinal: number,
  registry?: ModuleRegistry,
): DisplayName {
  if (field?.key?.$tag === "NamedField" && registry) {
    const named = identifiedParameterName(registry, field.key.ref.$ref);
    if (named.label) return humanName(named.label);
    if (named.codeName) return codeName(named.codeName);
  } else {
    const label = field?.label ? peelMaybeValue(field.label) : undefined;
    const text = label == null ? "" : canonical(label);
    if (text) return humanName(text);
  }
  return field?.name ? codeName(field.name) : humanName(`Input ${ordinal + 1}`);
}

/** An identified field's shown name in `registry`: its `Labelable` label
 * (when non-empty), and its `Codeable` code name. The page (Account) and a
 * Local reader's worker (`project-reader-field-names`) both read it here. */
export function identifiedParameterName(registry: ModuleRegistry, fieldId: string): { label?: string; codeName?: string } {
  let label: string | undefined;
  if (registry.getFieldRepresentation("Labelable", fieldId) !== undefined) {
    label = canonical(resolveRegistryFieldPresentation(registry, fieldId).label) || undefined;
  }
  if (label) return { label };
  const code = registry.getFieldRepresentation("Codeable", fieldId)?.methods.codeName;
  return typeof code === "string" && code ? { codeName: code } : {};
}

/** Plain-text form of `parameterDisplayName` (aria labels, captures). */
export function displayParameterName(
  field: FieldDef | undefined,
  ordinal: number,
  registry?: ModuleRegistry,
): string {
  return parameterDisplayName(field, ordinal, registry).text;
}

/** Search presentation names only where the captured registry has resolved
 * them. A spelling never becomes a selected target or a new import route. */
export function searchableFunctionSpellings(
  routes: readonly AuthoringExactFunctionRoute[] = [],
): ReadonlyMap<string, readonly string[]> {
  const names = new Map<string, string[]>();
  for (const route of routes) {
    if (route.status !== "resolved") continue;
    const existing = names.get(route.targetId);
    if (existing) existing.push(route.sourceName);
    else names.set(route.targetId, [route.sourceName]);
  }
  return names;
}

/** Project an already checked scheme for its label; no inference occurs here. */
export function displayFunctionSignature(
  entry: AuthoringCatalogFunctionEntry,
  displayType: (type: FenelType) => string | undefined,
): string {
  const scheme = entry.signatureOutcome?.$tag === "Solved" ? entry.scheme : undefined;
  const body = scheme?.body;
  const arrow = body && "$arrow" in body ? body.$arrow : undefined;
  const params = arrow?.params ?? entry.params;
  const returns = arrow?.returns ?? entry.returns;
  const quantified = scheme?.quantified.length ? scheme : undefined;
  const label = (type: FenelType, path: readonly string[]) => {
    const projected = scheme ? projectAuthoringScheme(scheme, path) : undefined;
    return (quantified && projected ? typeCode(projected.body)
      : displayType(type) ?? (projected ? typeCode(projected.body) : undefined)) || "?";
  };
  const ps = params.map((param, index) => `${param.name}:${label(param.type, ["$arrow", "params", String(index), "type"])}`).join(", ");
  const result = label(returns, ["$arrow", "returns"]);
  const binders = quantified ? `∀ ${quantified.quantified.map(variable => variable.sourceName).join(" ")}. ` : "";
  const owner = entry.kind === "method" && entry.parentInterface ? `${entry.parentInterface}. ` : "";
  return `${owner}${binders}(${ps}) → ${result}`;
}

export { constructorNameCounts, constructorShortName, displayCallableHandle, displayCallableName, displayFunctionName, functionDisplayName } from "./callable-names";
