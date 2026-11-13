import type { FenelType } from "@fenel/engine/types";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { LayoutItem, LocusViewRow } from "./locus-view-model";
import type { ReaderMetadataProjection } from "./api";
import type { LocusTypeDescription } from "../../../../../implementations/typescript/engine/src/authoring/locus-type-presentation";

/** HTTP projection of a single persisted List Anything expression. `items` and
 * `lists` are render adapters over expr, never separately writable datasets. */
export type LocusRootData = {
  id: string;
  name: string;
  type: FenelType;
  expr: ExprNode;
  revision: number;
  persisted: boolean;
  /** Actor capability from the live authority judgment, never persisted with
   * data. Absence is read-only. The write is checked again at execution. */
  canEdit?: boolean;
  layout: { kind: "grid" | "list" | "tree" | "tabs"; axis?: "horizontal" | "vertical" };
  items: LayoutItem[];
  lists: (LocusViewRow & { referenceId: string; sourceReferenceId: string; rootRevision: number; valueType: FenelType; derivedCanvas: boolean;
    /** A plain data set's entries (id beside value), which a keyed canvas references. */
    entriesReferenceId?: string })[];
  expressions: Record<string, ExprNode>;
  referenceId: string;
  /** Inert repository presentation facts for the early reader. Account reads
   * use the existing authenticated reader-metadata endpoint instead. */
  previewMetadata?: ReaderMetadataProjection;
  /** Existing formatter results from this exact authorized read. The early
   * renderer consumes inert facts until its own checked reader is available. */
  typeDescriptions?: readonly LocusTypeDescription[];
};
export type LocusRootSingleCommand =
  | { kind: "append"; item: LayoutItem }
  | { kind: "replace"; itemId: string; item: LayoutItem }
  | { kind: "remove"; itemId: string }
  | { kind: "reorder"; itemIds: string[] }
  | { kind: "layout"; layout: LocusRootData["layout"] };
export type LocusRootCommand = LocusRootSingleCommand | { kind: "batch"; commands: LocusRootSingleCommand[] };

export function rootDataRow(root: LocusRootData): LocusViewRow {
  return { id: root.id, name: root.name, active: false, view: { ...root.layout, items: root.items } };
}
