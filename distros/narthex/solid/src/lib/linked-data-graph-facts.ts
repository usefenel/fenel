// What the linked-data graph reads about its cards from the reader, without
// evaluating anything: each card's kind (to join the lines of holders of one
// kind) and the name a holder's own type gives the field that holds a link
// (for a link Fenel's walk leaves unnamed). Display glue over existing
// reflection and field presentation; the page (home.tsx) and the registry-
// backed test (linked-data-graph-query.test.ts) use the same functions.

import type { FenelType } from "@fenel/engine/types";
import { recordFieldsForType } from "@fenel/engine/authoring/expression";
import { typeConstructorOf } from "../../../../../implementations/typescript/engine/src/effect-dispatch";
import type { AuthoringSession } from "./expression-runner/account-authoring-session";
import { transferContainerShape } from "./data-transfer/expressions";
import { fieldSlotName } from "./layout-renderer/typed-read-field-slots";
import { displayNameText } from "./display-name";
import type { LinkedEdge, LinkedPathStep } from "./linked-data-graph";

/** A card's kind: its value's own type constructor (a project's is Project, a
 * person's PublicPerson), else its declared type's identity. Not
 * `carrierTypeName`, which names media carriers only: with it every record
 * had no kind and no join ever formed (B17). */
export function linkedKind(session: AuthoringSession, declared: FenelType | undefined, value: unknown): string | undefined {
  try {
    const nominal = typeConstructorOf(value, session.evaluateContext);
    if (nominal) return nominal;
  } catch { /* no reflected constructor: the declaration answers */ }
  return declared && "$ref" in declared && typeof declared.$ref === "string" ? declared.$ref : undefined;
}

/** The name a record type gives one of its fields, as the record's own rows
 * show it (its Labelable facet, its declared label). */
export function declaredFieldName(session: AuthoringSession, type: FenelType | undefined, field: LinkedPathStep | undefined): string | undefined {
  if (typeof field !== "string" || !type) return undefined;
  try {
    const declared = recordFieldsForType(transferContainerShape(type, session.environment, () => session.evaluateContext),
      session.environment)?.find(row => row.name === field);
    return declared ? displayNameText(fieldSlotName(declared, session.registry))?.trim() || undefined : undefined;
  } catch { return undefined; }
}

/** Names every link Fenel left unnamed by its holder's field, in place: the
 * field is where the holder holds the target (`fieldOf`), its name the one the
 * holder's type declares (its declared type, else its value's own). */
export function nameUnnamedLinks(session: AuthoringSession, edges: readonly LinkedEdge[],
  fieldOf: (edge: LinkedEdge) => LinkedPathStep | undefined,
  holder: (id: string) => { declared?: FenelType; value?: unknown }): void {
  for (const edge of edges) {
    if (edge.labels.length) continue;
    const known = holder(edge.from);
    const reflected = known.declared ? undefined : linkedKind(session, undefined, known.value);
    const name = declaredFieldName(session, known.declared ?? (reflected ? { $ref: reflected } as FenelType : undefined), fieldOf(edge));
    if (name) edge.labels = [name];
  }
}
