// B3 declaration/schema boundary. The canonical Fenel parser and printer own
// all source syntax; this adapter carries the type editor's field records.
import { parse } from "./fenel-parser";
import { print, type PrintSourceContext } from "./engine-bodies-dispatch";
import type { FenelType, FieldKey } from "./types";

type SchemaField = {
  id: string;
  key?: FieldKey;
  label?: string;
  type?: FenelType;
};

type SourceRecordDeclaration = {
  name: string;
  params?: string[];
  constructors: { name: string; fields: { name: string; key?: FieldKey; type: FenelType; default?: unknown }[] }[];
  directives?: { name: string; args: unknown[] }[];
};

/** An entity is an ordinary single-constructor record declaration. */
export function printEntityDef(
  name: string,
  label: string,
  schema: SchemaField[],
  description?: string,
  source?: PrintSourceContext,
): string {
  return print({ type_def: {
    name,
    directives: [
      ...(label && label !== name ? [{ name: "label", args: [label] }] : []),
      ...(description ? [{ name: "description", args: [description] }] : []),
      ...schema.filter((field) => field.label && field.label !== field.id).map((field) => ({ name: "fieldLabel", args: [field.id, field.label] })),
    ],
    constructors: [{ name, fields: schema.map((field) => ({
      name: field.id,
      ...(field.key === undefined ? {} : { key: field.key }),
      type: field.type ?? { $ref: "String" },
    })) }],
  } }, undefined, source);
}

/** Adapt the canonical declaration AST; no independent type grammar exists. */
export function parseEntityDef(code: string): { name: string; label: string; schema: SchemaField[] } | { error: string } {
  try {
    const parsed = parse(code) as { type_def?: SourceRecordDeclaration; program?: { type_def?: SourceRecordDeclaration }[] };
    const definition = parsed.type_def ?? (parsed.program?.length === 1 ? parsed.program[0]?.type_def : undefined);
    if (!definition || definition.params?.length || definition.constructors?.length !== 1 || definition.constructors[0]?.name !== definition.name) {
      return { error: "Expected one single-constructor record declaration: Name = Name field: Type." };
    }
    if (definition.constructors[0].fields.some((field) => field.default !== undefined)) {
      return { error: "Field defaults belong to the complete declaration editor." };
    }
    const label = definition.directives?.find((directive) => directive.name === "label")?.args[0];
    return {
      name: definition.name,
      label: typeof label === "string" ? label : definition.name,
      schema: definition.constructors[0].fields.map((field) => ({
        id: field.name,
        ...(field.key === undefined ? {} : { key: field.key }),
        label: definition.directives?.find((directive) => directive.name === "fieldLabel" && directive.args[0] === field.name)?.args[1] as string | undefined,
        type: field.type,
      })),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
