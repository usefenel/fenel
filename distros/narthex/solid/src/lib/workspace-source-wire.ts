// Dependency-free source/focus transport shared by browser and bootstrap
// producers. Coordinates describe data; following them acquires a reader.
export type WorkspaceSource = { $tag: "AllDataSource" } | { $tag: "PublicSource" } | { $tag: "AccountSource"; accountId: string }
  | { $tag: "ThisTabSource" };

/** Source selector transport. The tab's occurrence/ref identity belongs to
 * its local reader; this selector never supplies an account identity. */
export function workspaceSourceKey(source: WorkspaceSource): string {
  return source.$tag === "AllDataSource" ? "all" : source.$tag === "PublicSource" ? "public" : source.$tag === "ThisTabSource" ? "local" : source.accountId;
}

export function workspaceSourceFromKey(key: string): WorkspaceSource {
  return key === "all" ? { $tag: "AllDataSource" } : key === "public" ? { $tag: "PublicSource" } : key === "local" ? { $tag: "ThisTabSource" }
    : { $tag: "AccountSource", accountId: key };
}
export type WorkspacePathStep = { $tag: "FieldStep"; name: string } | { $tag: "IndexStep"; index: number };
export type WorkspaceFocus = { $tag: "RootFocus" } | { $tag: "ListFocus"; listId: string }
  | { $tag: "ValueFocus"; listId: string; itemId: string; path: WorkspacePathStep[]; rootItem: boolean; passThrough: number[] };
export type WorkspacePresentationTarget = { $tag: "ValuePresentationTarget"; source: WorkspaceSource; focus: WorkspaceFocus }
  | { $tag: "InhabitantsPresentationTarget"; typeRef: string };

/** Decode only ordinary source/focus coordinates. Following one still enters
 * the existing reader and performs its current access check. */
export function readWorkspaceDataTarget(value: unknown): Extract<WorkspacePresentationTarget, { $tag: "ValuePresentationTarget" }> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const slot = (object: object, name: string) => {
    const descriptor = Object.getOwnPropertyDescriptor(object, name);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  };
  if (slot(value, "$tag") !== "ValuePresentationTarget") return undefined;
  const source = slot(value, "source"), focus = slot(value, "focus");
  if (!source || typeof source !== "object" || !focus || typeof focus !== "object") return undefined;
  const sourceTag = slot(source, "$tag"), focusTag = slot(focus, "$tag");
  if (!(sourceTag === "PublicSource" || sourceTag === "ThisTabSource"
    || sourceTag === "AccountSource" && typeof slot(source, "accountId") === "string" && slot(source, "accountId"))) return undefined;
  if (focusTag !== "RootFocus") return undefined;
  return value as Extract<WorkspacePresentationTarget, { $tag: "ValuePresentationTarget" }>;
}
