// ---------------------------------------------------------------------------
// home-action — the action the lightweight Home shell hands to the workspace.
//
// The shell (`home-entry.tsx`) paints and answers the CHEAP half of "+ New":
// the question "what kind of thing?" is five static buttons, so the picker opens
// on the first click with no engine loaded. Only the ANSWER needs the workspace,
// and it names which editor to open, so `HomePage` can mount straight into that
// editor instead of replaying the picker.
//
// `"new"` (bare) remains the legacy "open the picker inside the workspace" form,
// used when the workspace is already mounted.
// The object variant carries a quick type choice and optional canvas position
// without loading the engine in the lightweight shell.
// ---------------------------------------------------------------------------

import type { LocusScope } from "./locus-scope";
import type { FenelType } from "@fenel/engine/types";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { DataInspectionMode } from "./DataInspectionDialog";
import type { PlacementHint } from "./locus-view-model";

/** Inert browser placement only; never a value, source or grant. */
export type CreationCardAnchor = { x: number; y: number;
  beside?: { left: number; top: number; right: number; bottom: number } };

export type HomeAction =
  | "browse"
  | "search"
  // Go to the top-level value. The shell can SAY where you are (it reads the
  // rows) but it cannot let you move, because moving means rendering whatever
  // you land on. So the outermost crumb hands the workspace this and the
  // workspace opens at the root rather than inside the last set.
  | "root"
  | "new"
  | "new:value"
  | "new:type"
  | "new:function"
  | "new:expression"
  | "new:showcase-demo"
  | "new:recipe-demo"
  | { kind: "browse"; query: string }
  /** Open a saved row in this reader once the existing workspace is ready. */
  | { kind: "open-saved"; savedExprId: string; caption: string }
  /** Open the existing Call form for this exact authored reference. The
   * prepared reader resolves it again; the early card supplies no definition. */
  | { kind: "call-function"; target: Extract<LocusScope, { kind: "value" }>; referenceId: string; caption?: string;
      scope: LocusScope; source: string; epoch: number; rootId: string; revision: number }
  | { kind: "new:expression"; expr: ExprNode; checkpoint?: {
      typeName?: string; valueType?: FenelType; reps?: Record<string, Record<string, unknown>>;
      authored?: boolean; viewMode?: "nested" | "pipe"; submitted?: boolean;
      cardAnchor?: CreationCardAnchor; cardExpanded?: boolean; editorLens?: "simple" | "full"; placement?: PlacementHint;
      creationOccurrenceId?: string;
      createdValueId?: string; createdValueQuery?: Record<string, unknown>;
      destination?: { rootId: string; scope: LocusScope };
    } }
  | { kind: "show-code"; itemId: string; scope?: LocusScope }
  | { kind: "inspect-data"; item: import("./locus-view-model").LayoutItem; scope: LocusScope; mode: DataInspectionMode;
      /** An expression draft edited before the workspace existed. `baseline`
       * is the source expression it started from; `commit` asks the
       * workspace's own Save to run once the draft is mounted there. */
      draft?: { baseline: ExprNode; node: ExprNode; commit: boolean } }
  | { kind: "suggest-data"; itemId?: string; scope: LocusScope; source: string; epoch: number;
      rootId: string; revision: number; position: { x: number; y: number };
      producer?: ExprNode; producerType?: FenelType;
      selection?: { path: readonly (string | number)[]; value: unknown; type?: FenelType; caption?: string } }
  | { kind: "inspect-type"; type: FenelType; scope: LocusScope }
  | { kind: "new:value"; typeName: string; point?: { x: number; y: number };
      cardAnchor?: CreationCardAnchor; placement?: PlacementHint;
      preset?: { type: FenelType; value: unknown } }
  // A row picked in the shell's Browse drawer. The drawer opens long before the
  // workspace exists (it lists names, which three API reads answer in seconds),
  // so the PICK has to survive the wait the same way a paste does.
  | {
      kind: "pin";
      savedExprId?: string;
      pin?: { kind: string; routeId: string };
      caption?: string;
    };

/** The picker branches that need an authoring workspace. "Create a function
 *  call" uses the existing Browse drawer and its ordinary ready handoff. */
export type NewBranch = Extract<
  HomeAction,
  "new:value" | "new:type" | "new:function" | "new:expression" | "new:showcase-demo" | "new:recipe-demo"
>;

/** Public Demo collections that copy a Local starter when edited.
 *  The names are the collection captions in `public-locus-data.ts`.
 *  Linked data has no Demo collection, so it has no branch here. */
export function publicDemoCopyBranch(collectionName: string | undefined): "new:showcase-demo" | "new:recipe-demo" | undefined {
  if (collectionName === "People and projects") return "new:showcase-demo";
  if (collectionName === "Recipe functions") return "new:recipe-demo";
  return undefined;
}

let pendingDemoCopy: "new:showcase-demo" | "new:recipe-demo" | undefined;

/** The public page and Local are different addresses. Remember the copy across that route change. */
export function armPublicDemoCopy(branch: "new:showcase-demo" | "new:recipe-demo") {
  pendingDemoCopy = branch;
}

export function peekPublicDemoCopy(): "new:showcase-demo" | "new:recipe-demo" | undefined {
  return pendingDemoCopy;
}

export function consumePublicDemoCopy(): "new:showcase-demo" | "new:recipe-demo" | undefined {
  const branch = pendingDemoCopy;
  pendingDemoCopy = undefined;
  return branch;
}

/** Inert Local editor data only. Reader/client/validation state is reacquired. */
export type LocalCreationDraft = {
  focus: LocusScope;
  action: NewBranch | Extract<HomeAction, { kind: "new:expression" }>;
};
