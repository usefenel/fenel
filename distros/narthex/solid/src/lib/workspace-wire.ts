// Host transport between the Fenel workspace value and the existing Locus UI.
// Defaults, validation, transitions and presentation choices remain Fenel-owned.
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { Maybe } from "@fenel/engine/type-foundation";
import type { LocusRootData } from "./locus-root-data";
import type { LocusScope } from "./locus-scope";
import type { LocusLayoutChoice } from "./locus-layout-options";
import type { LensShortcut, LensTypedSubject } from "./lens-shortcuts";
import type { WorkspaceSource, WorkspaceFocus, WorkspacePresentationTarget } from "./workspace-source-wire";
export { workspaceSourceKey, workspaceSourceFromKey, readWorkspaceDataTarget } from "./workspace-source-wire";
export type { WorkspaceSource, WorkspacePathStep, WorkspaceFocus, WorkspacePresentationTarget } from "./workspace-source-wire";
export type WorkspacePresentation = { $tag: "AutomaticPresentation" | "ValuePresentation" | "ListPresentation"
  | "TablePresentation" | "GridPresentation" | "DesktopPresentation" | "TreePresentation" | "TabsPresentation" | "CanvasPresentation"
  | "CalendarPresentation" | "TimelinePresentation" | "MapPresentation" | "ChartPresentation" | "CodePresentation" };
export type WorkspaceBar = { $tag: "WorkspaceBar"; mode: { $tag: "FloatingBar" | "DockedBar" };
  position: { $tag: "BarTop" | "BarBottom" | "BarLeft" | "BarRight" } };
export type LensPlacement = { $tag: "DockedPlacement" }
  | { $tag: "FreePlacement"; x: number; y: number; width: number; height: number };
export type LensFieldPreferences = { $tag: "LensFieldPreferences"; order: string[]; hidden: string[] };
export type WorkspaceLens = { $tag: "WorkspaceLens"; id: string; title: Maybe<string>;
  source: WorkspaceSource; focus: WorkspaceFocus; presentation: WorkspacePresentation;
  /** Missing on lenses saved before free windows existed: those stay docked. */
  placement?: LensPlacement;
  shortcuts?: Maybe<LensShortcut[]>;
  subject?: Maybe<LensTypedSubject>;
  fields?: Maybe<LensFieldPreferences> };
export type WorkspacePreferences = { $tag: "WorkspacePreferences"; lenses: WorkspaceLens[]; activeLensId: string;
  display: { $tag: "SingleLens" | "TiledLenses" } | { $tag: "VisibleLenses"; ids: string[] }
    | { $tag: "GroupedLenses"; groups: Array<{ $tag: "LensGroup"; id: string; layers: string[][]; merged?: boolean }>; activeGroupId: string }; bar: WorkspaceBar;
  presentations: Array<{ $tag: "WorkspacePresentationPreference"; target: WorkspacePresentationTarget; presentation: WorkspacePresentation }> };
/** Older checked startup snapshots have only the code; prepared publications
 * carry the canonical Fenel presentation and type-dependency fact. */
export type WorkspaceBootstrapPresentation = { $tag?: "WorkspaceBootstrapPresentation"; lensId: string; code: string;
  presentation?: WorkspacePresentation; dependsOnType?: boolean };
export type WorkspaceTilePlan = { columns: number; rows: number; lensIds: string[] };
export type WorkspaceCommand = { $tag: string; [field: string]: unknown };
export type ReadyWorkspaceBootstrap = {
  status: "ready";
  value: WorkspacePreferences;
  valueType: { $ref: string };
  itemId?: string;
  visibleLenses: WorkspaceLens[];
  activeLens: Maybe<WorkspaceLens>;
  tilePlan: WorkspaceTilePlan;
  presentations: WorkspaceBootstrapPresentation[];
};
export type WorkspaceBootstrapReply = {
  accountId: string;
  personalAccountId: string;
  accounts: Array<{ accountId: string; name: string; slug: string; role: string }>;
  root: LocusRootData;
  allDataRoot?: LocusRootData;
  workspace: ReadyWorkspaceBootstrap | { status: "deferred" };
};

export function scopeFromWorkspace(focus: WorkspaceFocus): LocusScope {
  switch (focus.$tag) {
    case "RootFocus": return { kind: "root" };
    case "ListFocus": return { kind: "view", viewId: focus.listId };
    case "ValueFocus": return { kind: "value", viewId: focus.listId, itemId: focus.itemId,
      path: focus.path.map(step => step.$tag === "IndexStep" ? step.index : step.name),
      rootItem: focus.rootItem, passThrough: focus.passThrough };
  }
}

export function scopeToWorkspace(scope: LocusScope): WorkspaceFocus {
  switch (scope.kind) {
    case "root": return { $tag: "RootFocus" };
    case "view": return { $tag: "ListFocus", listId: scope.viewId };
    case "value": return { $tag: "ValueFocus", listId: scope.viewId, itemId: scope.itemId,
      path: scope.path.map(step => typeof step === "number" ? { $tag: "IndexStep", index: step } : { $tag: "FieldStep", name: step }),
      rootItem: scope.rootItem === true, passThrough: [...scope.passThrough ?? []] };
  }
}

export function workspaceExpression(value: WorkspacePreferences): ExprNode {
  return { kind: "literal", value };
}

export function layoutFromWorkspaceCode(code: string): LocusLayoutChoice | undefined {
  return code === "auto" ? undefined : code as LocusLayoutChoice;
}
