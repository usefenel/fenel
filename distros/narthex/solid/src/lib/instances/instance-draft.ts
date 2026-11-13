import type { Instance, InstanceScope } from "@fenel/engine";
import type { Constraint, LocaleString } from "@fenel/engine/types";
import type { InstanceJsonEncoding } from "@fenel/engine/authoring/type";

export type InstanceDraft = {
  typeName: string;
  args: unknown[];
  methods: Record<string, unknown>;
  scope?: InstanceScope;
  priority?: number;
  where?: Constraint[];
  label?: LocaleString;
};

export type InstanceApiRow = {
  id?: string;
  typeName?: string;
  args?: unknown[];
  instance?: Partial<Instance> & Record<string, unknown>;
  updatedAt?: string | Date | null;
  valueEncoding?: string;
};

export type InstanceApiBody = {
  typeName: string;
  args: unknown[];
  instance: InstanceDraft;
  valueEncoding?: InstanceJsonEncoding;
};

export function normalizeInstanceDraft(input: Partial<InstanceDraft> & Record<string, unknown>): InstanceDraft {
  const typeName =
    typeof input.typeName === "string"
      ? input.typeName
      : typeof input.className === "string"
        ? input.className
        : "";
  const args = Array.isArray(input.args) ? [...input.args] : [];
  const methods =
    input.methods && typeof input.methods === "object" && !Array.isArray(input.methods)
      ? { ...(input.methods as Record<string, unknown>) }
      : {};
  const out: InstanceDraft = { typeName, args, methods };
  if (input.scope !== undefined) out.scope = input.scope as InstanceScope;
  if (typeof input.priority === "number") out.priority = input.priority;
  if (Array.isArray(input.where)) out.where = input.where as Constraint[];
  if (input.label !== undefined) out.label = input.label as LocaleString;
  return out;
}

export function apiRowToDraft(row: InstanceApiRow): InstanceDraft {
  const instance =
    row.instance && typeof row.instance === "object"
      ? row.instance
      : ({
          typeName: row.typeName,
          args: row.args,
          methods: {},
        } satisfies Partial<InstanceDraft>);
  return normalizeInstanceDraft({
    ...instance,
    typeName: instance.typeName ?? row.typeName,
    args: instance.args ?? row.args,
  });
}

export function draftToApiBody(draft: InstanceDraft): InstanceApiBody {
  const instance = normalizeInstanceDraft(draft);
  return {
    typeName: instance.typeName,
    args: [...instance.args],
    instance,
  };
}

export function representationPresetDraft(
  typeName: string,
  targetId: string,
  methods: Record<string, unknown> = {},
): InstanceDraft {
  return normalizeInstanceDraft({ typeName, args: [targetId], methods });
}

/** An instance's full identity: its class and EVERY argument. Two instances of
 *  one class that share a first argument (`Iso String Bytes`, `Iso String
 *  JsonValue`) have two keys. Draft maps are keyed by it. */
export function instanceKey(draft: InstanceDraft): string {
  return `${draft.typeName}:${JSON.stringify(draft.args)}`;
}

/** A persisted row's identity: its row id, else (a row not yet saved, such as a
 *  fixture) the instance's full identity. Never the class name or the first
 *  argument alone. */
export function instanceRowKey(row: InstanceApiRow, draft: InstanceDraft = apiRowToDraft(row)): string {
  return typeof row.id === "string" && row.id !== "" ? `row:${row.id}` : `instance:${instanceKey(draft)}`;
}

/** Group rows by class, keeping every row: several instances of one class
 *  attached to the same target are several rows. With a target, only rows
 *  whose first argument is that target are kept. */
export function rowsByClass<E extends { draft: InstanceDraft }>(
  entries: readonly E[],
  targetId?: string,
): Map<string, E[]> {
  const out = new Map<string, E[]>();
  for (const entry of entries) {
    if (targetId !== undefined && entry.draft.args[0] !== targetId) continue;
    const list = out.get(entry.draft.typeName);
    if (list) list.push(entry);
    else out.set(entry.draft.typeName, [entry]);
  }
  return out;
}

/** The pending drafts of one class, each with the key it is stored under.
 *  Read by value, so a map keyed by class name (older callers) and one keyed
 *  by full identity are read alike. */
export function pendingDraftsOf(
  drafts: Readonly<Record<string, InstanceDraft>>,
  typeName: string,
  targetId?: string,
): { key: string; draft: InstanceDraft }[] {
  const out: { key: string; draft: InstanceDraft }[] = [];
  for (const [key, raw] of Object.entries(drafts)) {
    const draft = normalizeInstanceDraft({ ...raw, typeName: raw.typeName || key });
    if (draft.typeName !== typeName) continue;
    if (targetId !== undefined && draft.args[0] !== targetId) continue;
    out.push({ key, draft });
  }
  return out;
}

/** Store a draft under its full identity, replacing the entry it was opened
 *  from (whose key may be a class name, or an identity its arguments have
 *  since changed from). `drop` removes it instead, as an emptied
 *  representation does. */
export function withDraft(
  drafts: Readonly<Record<string, InstanceDraft>>,
  previousKey: string | undefined,
  draft: InstanceDraft,
  drop = false,
): Record<string, InstanceDraft> {
  const next = { ...drafts };
  if (previousKey !== undefined) delete next[previousKey];
  const key = instanceKey(draft);
  if (drop) delete next[key];
  else next[key] = draft;
  return next;
}

/** The class's declared parameter names, from its `.fenel` declaration
 *  (`Reprable target a` gives `target`, `a`). The dispatch seed's parameters
 *  are a routing choice (Reprable's seed keeps only `a`) and are used only
 *  when the declaration is not loaded. */
export function declaredClassParams(
  declared: readonly unknown[] | undefined,
  seed: readonly { name?: string }[] | undefined,
): string[] {
  const names = (declared ?? []).flatMap((param) => {
    const name = typeof param === "string" ? param
      : param && typeof param === "object" && typeof (param as { name?: unknown }).name === "string"
        ? (param as { name: string }).name
        : "";
    return name === "" ? [] : [name];
  });
  if (names.length > 0) return names;
  return (seed ?? []).map((param) => param.name || "Type");
}

/** A new instance's arguments: one slot per declared parameter, seeded with
 *  the parameter name; with a fixed target, the target fills the first slot
 *  and the other slots stay to be chosen. */
export function seedInstanceArgs(params: readonly string[], targetId?: string): unknown[] {
  if (targetId === undefined || targetId === "") return params.map((name) => name || "Type");
  return params.length === 0 ? [targetId] : params.map((name, index) => index === 0 ? targetId : name || "Type");
}

export function isEmptyMethodValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) {
    return value.length === 0 || value.every(isEmptyMethodValue);
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (record["$tag"] === "Nothing") return true;
    if (record["$tag"] === "Just") return isEmptyMethodValue(record["_0"]);
    // A non-Maybe constructor is a deliberate method value even when its
    // payload happens to contain only empty-looking leaves.
    if (typeof record["$tag"] === "string") return false;
    const values = Object.values(record);
    if (values.length === 0) return true;
    return values.every(isEmptyMethodValue);
  }
  return false;
}

export function isEmptyMethods(methods: Record<string, unknown>): boolean {
  return Object.values(methods).every(isEmptyMethodValue);
}

export function representationMethodsToDrafts(
  methodsByTypeName: Record<string, Record<string, unknown>>,
  targetId?: string,
): Record<string, InstanceDraft> {
  const out: Record<string, InstanceDraft> = {};
  for (const [typeName, methods] of Object.entries(methodsByTypeName)) {
    const draft = normalizeInstanceDraft({
      typeName,
      args: targetId ? [targetId] : [],
      methods,
    });
    out[instanceKey(draft)] = draft;
  }
  return out;
}

/** Back to the per-class representation record; the class is the draft's own
 *  `typeName`, never its map key. */
export function draftsToRepresentationMethods(
  drafts: Record<string, InstanceDraft>,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [key, draft] of Object.entries(drafts)) {
    const typeName = draft.typeName || key;
    if (!isEmptyMethods(draft.methods)) out[typeName] = { ...draft.methods };
  }
  return out;
}
