// Existing B3/browser-source boundary: capture one admitted immutable source,
// transport only canonical executable-slot facts, and retain its exact lifetime.
import { observeExprNode, type ExprNode } from "@fenel/engine/authoring/expression";
import { ownDataRead } from "@fenel/engine/expressions";
import type { Maybe } from "@fenel/engine/type-foundation";
import { concreteAuthoringSession, type AuthoringSession } from "./expression-runner/account-authoring-session";
import type { WorkspaceSource } from "./workspace-source-wire";

export type SourceExecutableSlot = { $tag: "SourceReference" | "SourceCall" | "SourceConstructor" | "SourceCodeReference"; identity: string }
  | { $tag: "SourceFieldReference"; identity: string; field: string }
  | { $tag: "SourceApplication" | "SourceLiteral" | "SourceParameter" } | { $tag: "SourceUnknown"; issue: string };
export type SourceExpressionMetadata = { $tag: "SourceExpressionMetadata"; id: string; label: string; slots: SourceExecutableSlot[] };
export type SourceOccurrenceMetadata = { $tag: "SourceOccurrenceMetadata"; id: string; label: string;
  expressionId: string; referenceId: Maybe<string> };
export type ReaderSourceMetadata = { $tag: "ReaderSourceMetadata"; source: WorkspaceSource; rootId: string; generation: string;
  expressions: SourceExpressionMetadata[]; occurrences: SourceOccurrenceMetadata[];
  callableLabels: Array<{ $tag: "DependencyNode"; id: string; label: string }> };
export type DependencySourceLocator = { $tag: "DependencySourceLocator"; source: WorkspaceSource; rootId: string; occurrenceId: string };
export type ReaderSourceMetadataCapture = { readonly session: AuthoringSession; readonly packet: ReaderSourceMetadata;
  /** Opaque host cache identity; this token never enters a Fenel value. */
  readonly generationToken: object; readonly current: () => boolean };
export type ReaderSourceMetadataRoster = { expressions: Array<{ id: string; label: string; expression: ExprNode }>;
  occurrences: SourceOccurrenceMetadata[]; callableLabels: ReaderSourceMetadata["callableLabels"] };

/** The canonical codec decides executable slots. Raw literals, annotation
 * types and defaults are never traversed or copied by this transport. */
export function sourceExecutableSlots(expression: ExprNode): SourceExecutableSlot[] {
  const slots: SourceExecutableSlot[] = [];
  // The codec notifies children before their parent: each literal's emitted
  // carrier is known when an enclosing application asks about its head.
  const lowered = new WeakMap<object, unknown>();
  const occurrence = (child: unknown): boolean => {
    if (child === null || typeof child !== "object") return false;
    const kind = ownDataRead(child as object, "kind");
    if (!kind.found) return false;
    if (kind.value === "ref" || kind.value === "param" || kind.value === "call") return true;
    if (kind.value !== "literal" || !lowered.has(child as object)) return false;
    const value = ownDataRead(child as object, "value");
    const logic = lowered.get(child as object);
    return value.found && logic !== value.value && logic !== null && typeof logic === "object";
  };
  // A callable position may name its function by code identity (`{$ref}`),
  // which the codec keeps as literal data: transport that retained identity.
  const codeIdentity = (child: unknown): string | undefined => {
    if (child === null || typeof child !== "object") return undefined;
    const kind = ownDataRead(child as object, "kind");
    if (!kind.found || kind.value !== "literal") return undefined;
    const value = ownDataRead(child as object, "value");
    if (!value.found || value.value === null || typeof value.value !== "object" || Array.isArray(value.value)
      || Object.keys(value.value).length !== 1) return undefined;
    const handle = ownDataRead(value.value as object, "$ref");
    return handle.found && typeof handle.value === "string" && handle.value !== "" ? handle.value : undefined;
  };
  try {
    const fields = referenceFields(expression);
    observeExprNode(expression, { resolver: () => undefined, onExpression: (node, logic) => {
      if (node.kind === "literal") lowered.set(node, logic);
      if (node.kind === "ref") {
        const names = fields.get(node);
        if (names === undefined) slots.push({ $tag: "SourceReference", identity: node.savedExprId });
        else for (const field of names) slots.push({ $tag: "SourceFieldReference", identity: node.savedExprId, field });
      }
      else if (node.kind === "call") slots.push({ $tag: "SourceCall", identity: node.fnId });
      else if (node.kind === "literal") {
        // A lowered operator marker, or an application whose callable is
        // neither an occurrence nor a code identity, has no retained callable
        // identity. Keep that coverage gap rather than inventing one from a
        // dynamically evaluated callable. This inspects only the codec's
        // emitted root keys, the construct tag and the application's direct
        // callable children; it never walks payloads.
        const emitted = logic !== node.value && logic !== null && typeof logic === "object" && !Array.isArray(logic);
        const carrier = node.value !== null && typeof node.value === "object" && !Array.isArray(node.value) ? node.value : undefined;
        const operation = carrier !== undefined ? ownDataRead(carrier, "__operator") : undefined;
        const operator = operation?.found === true;
        // The short-circuit forms are language structure: they name no
        // callable, and their operands are codec children that report their
        // own slots. Any other operator key keeps the refusal below.
        const operationKey = operator && operation.value !== null && typeof operation.value === "object"
          ? ownDataRead(operation.value as object, "op") : undefined;
        const structural = operationKey?.found === true && typeof operationKey.value === "string"
          && SHORT_CIRCUIT_FORMS.has(operationKey.value);
        // A named-field construction keeps the codec's retained constructor
        // tag; its field slots were already reported. Fenel decides its node.
        const construct = carrier !== undefined ? ownDataRead(carrier, "__construct") : undefined;
        const tag = construct?.found && construct.value !== null && typeof construct.value === "object"
          ? ownDataRead(construct.value, "tag") : undefined;
        const constructor = emitted && ownDataRead(logic as object, "construct").found
          && tag?.found && typeof tag.value === "string" && tag.value !== "" ? tag.value : undefined;
        // A record's safe wire constructor is codec plumbing, not an authored
        // call. Its actual field occurrences were already reported above.
        const record = carrier !== undefined && ownDataRead(carrier, "__record").found;
        const head = emitted && !record && (["call", "construct", "apply", "method", "pipe", "|>"].some(key => ownDataRead(logic as object, key).found) || operator);
        // An application's callable positions (the apply target, the pipe
        // stages) are codec children. When each is an executable occurrence,
        // its own slots already carry the head's references and calls; a
        // code-identity head is transported as the call it makes. Fenel
        // decides what each slot draws. Anything else keeps the refusal.
        const apply = carrier !== undefined ? ownDataRead(carrier, "__apply") : undefined;
        const pipe = carrier !== undefined ? ownDataRead(carrier, "__pipe") : undefined;
        const target = apply?.found && apply.value !== null && typeof apply.value === "object"
          ? ownDataRead(apply.value as object, "target") : undefined;
        const stages = pipe?.found && pipe.value !== null && typeof pipe.value === "object"
          ? ownDataRead(pipe.value as object, "steps") : undefined;
        const callables = target?.found ? [target.value]
          : stages?.found && Array.isArray(stages.value) ? stages.value : undefined;
        const application = head && !operator && callables !== undefined
          && callables.every(child => occurrence(child) || codeIdentity(child) !== undefined);
        if (application && constructor === undefined) for (const child of callables) {
          const identity = occurrence(child) ? undefined : codeIdentity(child);
          if (identity !== undefined) slots.push({ $tag: "SourceCall", identity });
        }
        // A code identity held as a value (a function bound or passed by
        // `{$ref}`) is transported as such; Fenel decides what it draws.
        const code = emitted ? undefined : codeIdentity(node);
        slots.push(constructor !== undefined ? { $tag: "SourceConstructor", identity: constructor }
          : application || head && structural ? { $tag: "SourceApplication" }
          : head ? { $tag: "SourceUnknown", issue: "This executable source head has no retained callable identity." }
          : code !== undefined ? { $tag: "SourceCodeReference", identity: code }
          : { $tag: "SourceLiteral" });
      }
      else if (node.kind === "param") slots.push({ $tag: "SourceParameter" });
    } });
  } catch (error) { slots.push({ $tag: "SourceUnknown", issue: error instanceof Error ? error.message : String(error) }); }
  return slots;
}

/** The evaluator's short-circuit control forms (`KNOWN_OPS` in the engine's
 * `json-logic.ts`; the codec emits them as structural keys). `match` has its
 * own marker and never arrives as an operator. */
const SHORT_CIRCUIT_FORMS: ReadonlySet<string> = new Set(["if", "?:", "and", "or"]);

/** Each reference under a field of the expression's own record, keyed by its
 * node, with its outermost field names: the relations a link can be named
 * by. Only the codec's construct/record/list carriers are followed; literal
 * payloads are never read. A malformed carrier simply names nothing. */
function referenceFields(expression: ExprNode): WeakMap<object, Set<string>> {
  const fields = new WeakMap<object, Set<string>>();
  const own = (value: unknown, key: string): unknown => {
    if (value === null || typeof value !== "object") return undefined;
    const read = ownDataRead(value as object, key);
    return read.found ? read.value : undefined;
  };
  const entries = (node: unknown): Array<{ name: unknown; value: unknown }> => {
    if (own(node, "kind") !== "literal") return [];
    const carrier = own(node, "value");
    for (const key of ["__construct", "__record"]) {
      const rows = own(own(carrier, key), "fields");
      if (Array.isArray(rows)) return rows.map(row => ({ name: own(row, "name"), value: own(row, "value") }));
    }
    return [];
  };
  const children = (node: unknown): unknown[] => {
    const items = own(own(node, "value"), "__list");
    return own(node, "kind") !== "literal" ? [] : Array.isArray(items) ? items : entries(node).map(entry => entry.value);
  };
  const mark = (node: unknown, field: string, depth: number) => {
    if (depth > 64 || node === null || typeof node !== "object") return;
    if (own(node, "kind") === "ref") {
      const names = fields.get(node) ?? new Set<string>();
      names.add(field); fields.set(node, names); return;
    }
    for (const child of children(node)) mark(child, field, depth + 1);
  };
  for (const entry of entries(expression)) if (typeof entry.name === "string" && entry.name !== "") mark(entry.value, entry.name, 0);
  return fields;
}

/** B3 marker construction only. Fenel owns the roster, target matching,
 * dependency filtering, labels, deduplication and graph construction. */
export function readerSourceMetadataPacket(source: WorkspaceSource, rootId: string, generation: string,
  roster: ReaderSourceMetadataRoster): ReaderSourceMetadata {
  const coordinate: WorkspaceSource = source.$tag === "AccountSource"
    ? { $tag: "AccountSource", accountId: source.accountId } : { $tag: source.$tag };
  const packet: ReaderSourceMetadata = { $tag: "ReaderSourceMetadata", source: coordinate, rootId, generation,
    expressions: roster.expressions.map(row => ({ $tag: "SourceExpressionMetadata", id: row.id,
      label: row.label, slots: sourceExecutableSlots(row.expression) })),
    occurrences: roster.occurrences.map(row => ({ $tag: "SourceOccurrenceMetadata", id: row.id, label: row.label,
      expressionId: row.expressionId, referenceId: row.referenceId.$tag === "Just"
        ? { $tag: "Just", _0: row.referenceId._0 } : { $tag: "Nothing" } })),
    callableLabels: roster.callableLabels.map(row => ({ $tag: "DependencyNode", id: row.id, label: row.label })) };
  // Host snapshot immutability applies only to this payload-free metadata.
  // The original source expressions and literal/image data never enter it.
  Object.freeze(packet.source);
  for (const expression of packet.expressions) {
    for (const slot of expression.slots) Object.freeze(slot);
    Object.freeze(expression.slots); Object.freeze(expression);
  }
  for (const occurrence of packet.occurrences) { Object.freeze(occurrence.referenceId); Object.freeze(occurrence); }
  for (const callable of packet.callableLabels) Object.freeze(callable);
  Object.freeze(packet.expressions); Object.freeze(packet.occurrences); Object.freeze(packet.callableLabels);
  return Object.freeze(packet);
}

export function assertReaderSourceMetadata(capture: ReaderSourceMetadataCapture, supplied: AuthoringSession): void {
  if (capture.session !== concreteAuthoringSession(supplied) || !capture.current()) {
    throw new Error("This source metadata no longer belongs to the current reader. Reopen the data and try again.");
  }
}

/** Absence is authoritative: a generic or retired reader receives no packet. */
export function captureReaderSourceMetadata(supplied: AuthoringSession): ReaderSourceMetadataCapture | undefined {
  const captured = supplied.captureSourceMetadata?.();
  if (captured) assertReaderSourceMetadata(captured, supplied);
  return captured;
}

/** A frame overlay always shadows a previous packet, including on absence. */
export function readerSourceMetadataFrame(capture?: ReaderSourceMetadataCapture): { _readerSourceMetadata: ReaderSourceMetadata | undefined } {
  return { _readerSourceMetadata: capture?.packet };
}
