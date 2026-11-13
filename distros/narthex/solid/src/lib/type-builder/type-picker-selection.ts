import type { AuthoringCatalogTypeEntry } from "@fenel/engine/authoring/environment";
import { latest } from "solid-js";
import { sessionEpoch } from "../browser-session";
import { draftValueFingerprint } from "../native-draft";
import type { ReaderRuntime } from "../reader-runtime";
import { assertReaderSourceMetadata, captureReaderSourceMetadata } from "../reader-source-metadata";
import { concreteAuthoringSession, isInertAuthoringSession, type AuthoringSession } from "../expression-runner/account-authoring-session";
import { localGuidanceCapture, localGuidanceCurrent } from "../expression-runner/live-guidance-local";
import { LOCAL_ACTION_CHANGED, LOCAL_ACTION_TOOLS_PENDING, runLocalReaderAction } from "../expression-runner/local-reader-actions";
import { projectReaderReferences, type ReaderCatalogReference } from "../expression-runner/reader-reference-ops";

/** An authored reference to the current reader's declaration. Display metadata
 * is never the stored reference; selection is not inference or Save admission. */
export type TypePickerSelection =
  | { readonly kind: "auto" }
  | {
      readonly kind: "type";
      readonly row: AuthoringCatalogTypeEntry;
      readonly reference: string;
      readonly ownership: "reader-checked" | "existing-choice";
      /** The existing identified declaration, carried by the same checked
       * reader projection. Only constructor compatibility needs its module. */
      readonly declarationOwner?: { readonly id: string; readonly module?: string };
    };

/** Capture the containing draft/occurrence synchronously at the start of a
 * pick. The returned function must remain true before the final synchronous
 * callback. An unavailable/locked target returns undefined. Reader, catalogue
 * and request lifetimes are checked by the picker itself, not by adapters. */
/** A captured target's checker. `draft`, when present, is the content of the
 * whole captured draft chain: a fresh capture with the same `draft` targets the
 * same occurrence of the same content (a reconciled copy of it). */
export type CaptureTypePickerTarget = () => ((() => boolean) & { readonly draft?: string }) | undefined;

export const TYPE_PICKER_UNAVAILABLE = "The selected type could not be resolved in this reader. Choose it again.";
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Read one reply from the existing reference projection, without interpreting
 * a type's structure or deriving an owner from its label or catalogue id. */
function readReference(reply: unknown, target: string): ReaderCatalogReference | undefined {
  if (!record(reply) || !Array.isArray(reply.references)
    || reply.references.length !== 1) throw new Error(TYPE_PICKER_UNAVAILABLE);
  const item = reply.references[0];
  if (!record(item) || item.target !== target) throw new Error(TYPE_PICKER_UNAVAILABLE);
  const reference: unknown = item.reference;
  if (reference === undefined) return undefined;
  if (!record(reference)) throw new Error(TYPE_PICKER_UNAVAILABLE);
  if (reference.entityType !== undefined && !record(reference.entityType)) throw new Error(TYPE_PICKER_UNAVAILABLE);
  if (reference.entityOwner !== undefined && (!record(reference.entityOwner) || typeof reference.entityOwner.id !== "string"
    || (Object.hasOwn(reference.entityOwner, "module") && typeof reference.entityOwner.module !== "string")
    || (Object.hasOwn(reference.entityOwner, "nominalIdentity") && typeof reference.entityOwner.nominalIdentity !== "string"))) {
    throw new Error(TYPE_PICKER_UNAVAILABLE);
  }
  if (reference.typeFamilyOwner !== undefined && (!record(reference.typeFamilyOwner)
    || typeof reference.typeFamilyOwner.identity !== "string" || !record(reference.typeFamilyOwner.type)
    || (reference.typeFamilyOwner.typeScheme !== undefined && (!record(reference.typeFamilyOwner.typeScheme)
      || !Array.isArray(reference.typeFamilyOwner.typeScheme.quantified))))) throw new Error(TYPE_PICKER_UNAVAILABLE);
  return reference as ReaderCatalogReference;
}

/** The selected row must be a member of this exact published catalogue. Its
 * producer has already bound the row to a unique entity owner (including the
 * registry's class-only records). An available family identity keeps its exact
 * round trip. Otherwise the identified declaration supplies its existing scoped
 * spelling: authoring syntax does not require a portable type-member value.
 * The destination's existing inference/membership/Save owners keep that decision. */
export async function resolveTypePickerSelection(row: AuthoringCatalogTypeEntry,
  session: () => AuthoringSession, reader: ReaderRuntime | undefined,
  options: { signal: AbortSignal; current: () => boolean }): Promise<TypePickerSelection> {
  const { facade, concrete, catalog, types, epoch, revision, key, sourceMetadata, local, needsOwner, capture } = latest(() => {
    const facade = session();
    const concrete = concreteAuthoringSession(facade);
    const catalog = facade.catalog;
    const local = reader?.kind === "local" || isInertAuthoringSession(facade);
    const needsOwner = row.entityId !== undefined;
    return { facade, concrete, catalog, types: catalog.types, epoch: sessionEpoch(), revision: reader?.revision(),
      key: draftValueFingerprint(row), sourceMetadata: captureReaderSourceMetadata(facade), local, needsOwner,
      capture: local && needsOwner ? localGuidanceCapture(reader, session) : undefined };
  });
  const current = () => latest(() => {
    if (options.signal.aborted || !options.current() || epoch !== sessionEpoch()
      || concreteAuthoringSession(session()) !== concrete || session().catalog !== catalog
      || catalog.types !== types || !types.includes(row) || draftValueFingerprint(row) !== key
      || reader?.revision() !== revision) return false;
    if (local && needsOwner) return !!capture && localGuidanceCurrent(capture, reader, session);
    try { if (sourceMetadata) assertReaderSourceMetadata(sourceMetadata, facade); }
    catch { return false; }
    return true;
  });
  if (local && needsOwner && !capture) throw new Error(LOCAL_ACTION_TOOLS_PENDING);
  if (!current()) throw new Error(LOCAL_ACTION_CHANGED);
  // Existing atom/display/syntactic choices have no declaration in the row.
  // Preserve that established spelling; never use it as an entity fallback.
  if (row.entityId === undefined) return { kind: "type", row, reference: row.name, ownership: "existing-choice" };
  if (!row.entityId) throw new Error(TYPE_PICKER_UNAVAILABLE);
  const project = async (target: string) => {
    if (!current()) throw new Error(LOCAL_ACTION_CHANGED);
    const reference = local
      ? await runLocalReaderAction(reader, session, { method: "project-reader-references", targets: [target] },
        reply => readReference(reply, target), { signal: options.signal, capture, via: "reader" })
      : readReference(projectReaderReferences([target], concrete), target);
    if (!current()) throw new Error(LOCAL_ACTION_CHANGED);
    return reference;
  };
  const first = await project(row.entityId);
  const owner = first?.entityOwner;
  if (first?.entityType === undefined
    || !owner || owner.id !== row.entityId || typeof owner.nominalIdentity !== "string" || !owner.nominalIdentity
    || (Object.hasOwn(owner, "module") && typeof owner.module !== "string")) throw new Error(TYPE_PICKER_UNAVAILABLE);
  const identity = first.typeFamilyOwner?.identity;
  if (identity !== undefined) {
    if (!identity) throw new Error(TYPE_PICKER_UNAVAILABLE);
    const exact = await project(identity);
    if (exact?.entityType === undefined || exact.typeFamilyOwner?.identity !== identity
      || exact.entityOwner?.id !== owner.id || exact.entityOwner.nominalIdentity !== owner.nominalIdentity
      || (Object.hasOwn(exact.entityOwner, "module") && typeof exact.entityOwner.module !== "string")
      || exact.entityOwner.module !== owner.module) throw new Error(TYPE_PICKER_UNAVAILABLE);
  } else if (!owner.module) {
    // A legacy reply without module metadata can still prove an exact handle;
    // it cannot establish the scope of an authored declaration spelling.
    throw new Error(TYPE_PICKER_UNAVAILABLE);
  }
  const declarationOwner = { id: owner.id, ...(owner.module === undefined ? {} : { module: owner.module }) };
  // The existing atom row may acquire entity metadata when the catalogue
  // merges its later declaration. Preserve its established spelling only
  // after it has proved to be that same actual system owner. A labelled
  // different declaration (including a civil Date) retains its own reference.
  const atom = row.category === "atom" && row.name === owner.id && owner.module === "system";
  const reference = atom ? owner.id : identity ?? owner.id;
  // Existing environment lookups accept names as well as declaration ids.
  // Refuse a competing published spelling instead of picking a label winner
  // or using structural shape equality as evidence of the selected owner.
  if (types.some(other => other !== row && other.entityId !== owner.id
    && (other.name === reference || other.entityId === reference))) throw new Error(TYPE_PICKER_UNAVAILABLE);
  return { kind: "type", row, reference,
    ownership: atom ? "existing-choice" : "reader-checked", declarationOwner };
}
