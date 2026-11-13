// A2/B3 browser-worker invocation boundary. Fenel owns every operation below;
// this module acquires no registry, reader, authority, worker or retained state.
import type { FenelType } from "@fenel/engine/types";
import type { Maybe } from "@fenel/engine/type-foundation";
import type { LocalTabData, LocalSavedValueRow, LocalRepresentationRow, LocalIngestResult, TabCommand } from "./local-locus-data";
import type { LocusRootCommand, LocusRootData } from "./locus-root-data";
import type { TransferItem } from "./data-transfer/types";
import type { ReaderSourceMetadataRoster } from "./reader-source-metadata";
import type { WorkspaceModel } from "./workspace-model-loader";
import type { WorkspacePreferences, WorkspaceCommand, WorkspaceLens, WorkspacePresentation, WorkspaceSource,
  WorkspaceFocus, WorkspaceTilePlan, LensPlacement, WorkspacePresentationTarget, WorkspaceBootstrapPresentation } from "./workspace-wire";
import type { LensShortcut } from "./lens-shortcuts";

type Verdict<T> = { $tag: "Ok"; _0: T } | { $tag: "Err"; _0: string };
type ListPatch = { name?: string; view?: Record<string, unknown>; active?: boolean; expectedRootRevision?: number };
type CallableLabels = readonly { id: string; label: string }[];
type AddressMember = { id: string; name: string; aliases: string[]; position: number };
type PreferenceEntry = { id: string; value: WorkspacePreferences };
export type WorkspaceRenderPacket = { $tag: "WorkspaceBootstrapPlan"; value: WorkspacePreferences; itemId: Maybe<string>;
  visibleLenses: WorkspaceLens[]; activeLens: Maybe<WorkspaceLens>; tilePlan: WorkspaceTilePlan;
  presentations: WorkspaceBootstrapPresentation[];
  /** Absent on checked startup data until its ordinary projection is ready. */
  shortcuts?: Array<{ lensId: string; shortcuts: LensShortcut[] }> };
export type LocalOrdinaryPublicationOptions = { callableLabels?: CallableLabels; earlyTypeDescriptions?: boolean };
export type LocalOrdinaryPublication = {
  state: LocalTabData; root: LocusRootData; savedValues: LocalSavedValueRow[];
  representations: LocalRepresentationRow[]; metadataTargets: string[]; ordinarySnapshot: LocalTabData;
  dependencyRoster?: ReaderSourceMetadataRoster;
};

// Each entry is one existing body or existing model wrapper. Unknown data in
// admission slots stays unknown until its Fenel owner checks it.
type Operations = {
  validateTabData: [[unknown], Verdict<LocalTabData>];
  defaultLocalTabData: [[string], LocalTabData];
  tabDataCheckRoot: [[LocalTabData, string], Verdict<boolean>];
  tabDataWithClipboard: [[LocalTabData], LocalTabData];
  applyTabDataCommands: [[LocalTabData, number, readonly TabCommand[]], Verdict<LocalTabData>];
  tabDataRootCommand: [[LocusRootCommand], TabCommand];
  browserDataListCommand: [[string, ListPatch], TabCommand];
  tabDataRoot: [[LocalTabData, FenelType], LocusRootData];
  tabDataValues: [[LocalTabData], LocalSavedValueRow[]];
  tabDataValue: [[LocalTabData, string], Maybe<LocalSavedValueRow>];
  tabDataSavedQueryBaseline: [[LocalTabData, string], Verdict<unknown>];
  tabDataCheckSavedQueryKeys: [[Verdict<string>, Verdict<string>], Verdict<boolean>];
  tabDataRepresentationRows: [[LocalTabData, string], LocalRepresentationRow[]];
  tabDataMetadataTargets: [[LocalTabData], string[]];
  browserDataList: [[LocalTabData, string], Maybe<LocusRootData["lists"][number]>];
  browserDataActiveList: [[LocalTabData], Maybe<LocusRootData["lists"][number]>];
  browserDataStorageSnapshot: [[LocalTabData], LocalTabData];
  browserDataRestoreSnapshot: [[LocalTabData, LocalTabData], Verdict<LocalTabData>];
  tabClipboardCopy: [[LocalTabData, string, unknown, string, string, number, number, string], Verdict<LocalTabData>];
  tabClipboardPreserved: [[LocalTabData, LocalTabData], boolean];
  tabExternalTransferCandidate: [[{ files: readonly unknown[]; internal: string; html: string; savedExprId?: string }], boolean];
  tabExternalTransferTypes: [[readonly TransferItem[]], Maybe<Array<{ owner: string; name: string }>>];
  tabExternalTransferCommands: [[readonly TransferItem[], readonly string[], readonly FenelType[]],
    { items: LocalIngestResult["items"]; commands: TabCommand[]; notes: string[] }];
  dependencyMetadataRoster: [[LocusRootData, readonly LocalSavedValueRow[], CallableLabels], ReaderSourceMetadataRoster];
  publication: [[LocalTabData, FenelType, LocalOrdinaryPublicationOptions?], LocalOrdinaryPublication];
  validateWorkspacePreferences: [[unknown], Verdict<WorkspacePreferences>];
  applyWorkspaceCommands: [[WorkspacePreferences, readonly WorkspaceCommand[]], Verdict<WorkspacePreferences>];
  workspaceDefaultForAccount: [[string, Maybe<string>], WorkspacePreferences];
  workspacePresentationCode: [[WorkspacePresentation], string];
  workspacePresentationFromCode: [[string], Verdict<WorkspacePresentation>];
  workspacePreferencesFromValue: [[unknown], Maybe<WorkspacePreferences>];
  workspaceReadPreferences: [[unknown], Verdict<Maybe<WorkspacePreferences>>];
  workspacePreferenceEntry: [[readonly { id: string; value: unknown }[]], Verdict<Maybe<PreferenceEntry>>];
  workspaceBootstrapReady: [[WorkspacePreferences, Maybe<string>, number], WorkspaceRenderPacket];
  workspaceRenderPublication: [[WorkspacePreferences, Maybe<string>, number], WorkspaceRenderPacket];
  workspacePresentationProjection: [[WorkspacePreferences, WorkspaceLens, Maybe<string>], { presentation: WorkspacePresentation; code: string }];
  workspaceActiveLens: [[WorkspacePreferences], Maybe<WorkspaceLens>];
  workspaceVisibleLenses: [[WorkspacePreferences], WorkspaceLens[]];
  workspaceTilePlan: [[WorkspacePreferences, number], WorkspaceTilePlan];
  defaultWorkspaceLens: [[string, WorkspaceSource], WorkspaceLens];
  workspaceFocusEqual: [[WorkspaceFocus, WorkspaceFocus], boolean];
  workspaceSourceEqual: [[WorkspaceSource, WorkspaceSource], boolean];
  workspaceLensWithFocus: [[WorkspaceLens, WorkspaceFocus], WorkspaceLens];
  workspaceLensWithPresentation: [[WorkspaceLens, WorkspacePresentation], WorkspaceLens];
  workspaceLensWithPlacement: [[WorkspaceLens, LensPlacement], WorkspaceLens];
  workspaceGroupedDisplay: [[WorkspacePreferences], WorkspacePreferences["display"]];
  workspacePresentationFor: [[WorkspacePreferences, WorkspaceLens, Maybe<string>], WorkspacePresentation];
  workspaceLensShortcuts: [[WorkspaceLens], LensShortcut[]];
  workspaceFieldProjection: [[readonly string[], NonNullable<WorkspaceLens["fields"]>], { order: string[]; visible: string[] }];
  allDataRootTargets: [[readonly WorkspaceSource[]], WorkspacePresentationTarget[]];
  addressMemberIndex: [[readonly AddressMember[], string, boolean], Verdict<number>];
  addressMemberSegment: [[readonly AddressMember[], number, boolean], Verdict<string>];
  sourceTypeReference: [[string, string], ReturnType<WorkspaceModel["sourceTypeReference"]>];
  workspaceValueType: [[], ReturnType<WorkspaceModel["workspaceValueType"]>];
  allDataRootTypes: [[], ReturnType<WorkspaceModel["allDataRootTypes"]>];
  allDataRootDescriptions: [[LocusRootData], ReturnType<WorkspaceModel["allDataRootDescriptions"]>];
};
export type LocalOrdinaryOperation = { [K in keyof Operations]: { kind: K; args: Readonly<Operations[K][0]> } }[keyof Operations];
export type LocalOrdinaryResult<O extends LocalOrdinaryOperation> = Operations[O["kind"]][1];

const arities: { readonly [K in keyof Operations]: readonly number[] } = {
  validateTabData: [1], defaultLocalTabData: [1], tabDataCheckRoot: [2], tabDataWithClipboard: [1],
  applyTabDataCommands: [3], tabDataRootCommand: [1], browserDataListCommand: [2], tabDataRoot: [2],
  tabDataSavedQueryBaseline: [2], tabDataCheckSavedQueryKeys: [2],
  tabDataValues: [1], tabDataValue: [2], tabDataRepresentationRows: [2], tabDataMetadataTargets: [1],
  browserDataList: [2], browserDataActiveList: [1], browserDataStorageSnapshot: [1], browserDataRestoreSnapshot: [2],
  tabClipboardCopy: [8], tabClipboardPreserved: [2], tabExternalTransferCandidate: [1], tabExternalTransferTypes: [1],
  tabExternalTransferCommands: [3], dependencyMetadataRoster: [3], publication: [2, 3],
  validateWorkspacePreferences: [1], applyWorkspaceCommands: [2], workspaceDefaultForAccount: [2],
  workspacePresentationCode: [1], workspacePresentationFromCode: [1], workspacePreferencesFromValue: [1],
  workspaceReadPreferences: [1], workspacePreferenceEntry: [1], workspaceBootstrapReady: [3], workspaceActiveLens: [1],
  workspaceRenderPublication: [3], workspacePresentationProjection: [3],
  workspaceVisibleLenses: [1], workspaceTilePlan: [2], defaultWorkspaceLens: [2], workspaceFocusEqual: [2],
  workspaceSourceEqual: [2], workspaceLensWithFocus: [2], workspaceLensWithPresentation: [2], workspaceLensWithPlacement: [2],
  workspaceGroupedDisplay: [1], workspacePresentationFor: [3], workspaceLensShortcuts: [1], workspaceFieldProjection: [2], allDataRootTargets: [1],
  addressMemberIndex: [3], addressMemberSegment: [3], sourceTypeReference: [2], workspaceValueType: [0],
  allDataRootTypes: [0], allDataRootDescriptions: [1],
};

function envelope(input: unknown, allowed: readonly string[]): asserts input is Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error("Invalid Local ordinary operation envelope.");
  for (const key of Reflect.ownKeys(input)) {
    const slot = Object.getOwnPropertyDescriptor(input, key)!;
    if (typeof key !== "string" || !allowed.includes(key) || !("value" in slot) || !slot.enumerable)
      throw new Error("Invalid Local ordinary operation envelope.");
  }
}

/** Read host array slots without consulting an authored iterator or getter.
 * The returned host slots are validation observations, never a payload copy
 * used for invocation or graph publication. */
function arraySlots(input: unknown): unknown[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype)
    throw new Error("Invalid Local ordinary operation array.");
  const length = Object.getOwnPropertyDescriptor(input, "length")!.value as number;
  if (Reflect.ownKeys(input).length !== length + 1) throw new Error("Invalid Local ordinary operation array.");
  const slots: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const slot = Object.getOwnPropertyDescriptor(input, String(index));
    if (!slot || !("value" in slot) || !slot.enumerable) throw new Error("Invalid Local ordinary operation array.");
    slots.push(slot.value);
  }
  return slots;
}

/** Checks the host command envelope and exact arity only. Payload admission is
 * still Fenel-owned; this is not a substitute for validateTabData, etc. */
export function assertLocalOrdinaryOperation(input: unknown): asserts input is LocalOrdinaryOperation {
  envelope(input, ["kind", "args"]);
  if (!Object.hasOwn(input, "kind") || !Object.hasOwn(input, "args") || typeof input.kind !== "string"
    || !Object.hasOwn(arities, input.kind)) throw new Error("Invalid Local ordinary operation or argument count.");
  const args = arraySlots(input.args);
  if (!arities[input.kind as keyof Operations].includes(args.length)) throw new Error("Invalid Local ordinary operation or argument count.");
  if (input.kind === "publication" && args.length === 3 && args[2] !== undefined) {
    const options = args[2];
    envelope(options, ["callableLabels", "earlyTypeDescriptions"]);
    if (Object.hasOwn(options, "earlyTypeDescriptions") && typeof options.earlyTypeDescriptions !== "boolean")
      throw new Error("Invalid Local publication description flag.");
    if (Object.hasOwn(options, "callableLabels")) {
      const labels = arraySlots(Object.getOwnPropertyDescriptor(options, "callableLabels")!.value);
      for (let index = 0; index < labels.length; index++) {
        const label = labels[index];
        envelope(label, ["id", "label"]);
        if (!Object.hasOwn(label, "id") || !Object.hasOwn(label, "label") || typeof label.id !== "string" || typeof label.label !== "string")
          throw new Error("Invalid Local publication callable labels.");
      }
    }
  }
}

export function runLocalOrdinaryOperation<O extends LocalOrdinaryOperation>(model: WorkspaceModel, operation: O): LocalOrdinaryResult<O> {
  assertLocalOrdinaryOperation(operation);
  let result: unknown;
  switch (operation.kind) {
    case "workspaceRenderPublication": {
      const plan = model.workspaceCall<WorkspaceRenderPacket>("workspaceBootstrapReady", ...operation.args);
      result = { ...plan, shortcuts: plan.visibleLenses.map(lens => ({ lensId: lens.id,
        shortcuts: model.workspaceCall<LensShortcut[]>("workspaceLensShortcuts", lens) })) } satisfies WorkspaceRenderPacket;
      break;
    }
    case "workspacePresentationProjection": {
      const presentation = model.workspaceCall<WorkspacePresentation>("workspacePresentationFor", ...operation.args);
      result = { presentation, code: model.workspaceCall<string>("workspacePresentationCode", presentation) };
      break;
    }
    case "publication": {
      const [state, rootType, options] = operation.args;
      const projected = model.workspaceCall<LocusRootData>("tabDataRoot", state, rootType);
      const root = options?.earlyTypeDescriptions ? { ...projected, typeDescriptions: model.allDataRootDescriptions(projected) } : projected;
      const savedValues = model.workspaceCall<LocalSavedValueRow[]>("tabDataValues", state);
      result = { state, root, savedValues,
        representations: model.workspaceCall<LocalRepresentationRow[]>("tabDataRepresentationRows", state, ""),
        metadataTargets: model.workspaceCall<string[]>("tabDataMetadataTargets", state),
        ordinarySnapshot: model.workspaceCall<LocalTabData>("browserDataStorageSnapshot", state),
        ...(options?.callableLabels === undefined ? {} : { dependencyRoster:
          model.workspaceCall<ReaderSourceMetadataRoster>("dependencyMetadataRoster", root, savedValues, options.callableLabels) }),
      } satisfies LocalOrdinaryPublication;
      break;
    }
    case "sourceTypeReference": result = model.sourceTypeReference(...operation.args); break;
    case "workspaceValueType": result = model.workspaceValueType(); break;
    case "allDataRootTypes": result = model.allDataRootTypes(); break;
    case "allDataRootDescriptions": result = model.allDataRootDescriptions(...operation.args); break;
    case "validateTabData": result = model.workspaceCall("validateTabData", ...operation.args); break;
    case "defaultLocalTabData": result = model.workspaceCall("defaultLocalTabData", ...operation.args); break;
    case "tabDataCheckRoot": result = model.workspaceCall("tabDataCheckRoot", ...operation.args); break;
    case "tabDataWithClipboard": result = model.workspaceCall("tabDataWithClipboard", ...operation.args); break;
    case "applyTabDataCommands": result = model.workspaceCall("applyTabDataCommands", ...operation.args); break;
    case "tabDataRootCommand": result = model.workspaceCall("tabDataRootCommand", ...operation.args); break;
    case "browserDataListCommand": result = model.workspaceCall("browserDataListCommand", ...operation.args); break;
    case "tabDataRoot": result = model.workspaceCall("tabDataRoot", ...operation.args); break;
    case "tabDataValues": result = model.workspaceCall("tabDataValues", ...operation.args); break;
    case "tabDataValue": result = model.workspaceCall("tabDataValue", ...operation.args); break;
    case "tabDataSavedQueryBaseline": result = model.workspaceCall("tabDataSavedQueryBaseline", ...operation.args); break;
    case "tabDataCheckSavedQueryKeys": result = model.workspaceCall("tabDataCheckSavedQueryKeys", ...operation.args); break;
    case "tabDataRepresentationRows": result = model.workspaceCall("tabDataRepresentationRows", ...operation.args); break;
    case "tabDataMetadataTargets": result = model.workspaceCall("tabDataMetadataTargets", ...operation.args); break;
    case "browserDataList": result = model.workspaceCall("browserDataList", ...operation.args); break;
    case "browserDataActiveList": result = model.workspaceCall("browserDataActiveList", ...operation.args); break;
    case "browserDataStorageSnapshot": result = model.workspaceCall("browserDataStorageSnapshot", ...operation.args); break;
    case "browserDataRestoreSnapshot": result = model.workspaceCall("browserDataRestoreSnapshot", ...operation.args); break;
    case "tabClipboardCopy": result = model.workspaceCall("tabClipboardCopy", ...operation.args); break;
    case "tabClipboardPreserved": result = model.workspaceCall("tabClipboardPreserved", ...operation.args); break;
    case "tabExternalTransferCandidate": result = model.workspaceCall("tabExternalTransferCandidate", ...operation.args); break;
    case "tabExternalTransferTypes": result = model.workspaceCall("tabExternalTransferTypes", ...operation.args); break;
    case "tabExternalTransferCommands": result = model.workspaceCall("tabExternalTransferCommands", ...operation.args); break;
    case "dependencyMetadataRoster": result = model.workspaceCall("dependencyMetadataRoster", ...operation.args); break;
    case "validateWorkspacePreferences": result = model.workspaceCall("validateWorkspacePreferences", ...operation.args); break;
    case "applyWorkspaceCommands": result = model.workspaceCall("applyWorkspaceCommands", ...operation.args); break;
    case "workspaceDefaultForAccount": result = model.workspaceCall("workspaceDefaultForAccount", ...operation.args); break;
    case "workspacePresentationCode": result = model.workspaceCall("workspacePresentationCode", ...operation.args); break;
    case "workspacePresentationFromCode": result = model.workspaceCall("workspacePresentationFromCode", ...operation.args); break;
    case "workspacePreferencesFromValue": result = model.workspaceCall("workspacePreferencesFromValue", ...operation.args); break;
    case "workspaceReadPreferences": result = model.workspaceCall("workspaceReadPreferences", ...operation.args); break;
    case "workspacePreferenceEntry": result = model.workspaceCall("workspacePreferenceEntry", ...operation.args); break;
    case "workspaceBootstrapReady": result = model.workspaceCall("workspaceBootstrapReady", ...operation.args); break;
    case "workspaceActiveLens": result = model.workspaceCall("workspaceActiveLens", ...operation.args); break;
    case "workspaceVisibleLenses": result = model.workspaceCall("workspaceVisibleLenses", ...operation.args); break;
    case "workspaceTilePlan": result = model.workspaceCall("workspaceTilePlan", ...operation.args); break;
    case "defaultWorkspaceLens": result = model.workspaceCall("defaultWorkspaceLens", ...operation.args); break;
    case "workspaceFocusEqual": result = model.workspaceCall("workspaceFocusEqual", ...operation.args); break;
    case "workspaceSourceEqual": result = model.workspaceCall("workspaceSourceEqual", ...operation.args); break;
    case "workspaceLensWithFocus": result = model.workspaceCall("workspaceLensWithFocus", ...operation.args); break;
    case "workspaceLensWithPresentation": result = model.workspaceCall("workspaceLensWithPresentation", ...operation.args); break;
    case "workspaceLensWithPlacement": result = model.workspaceCall("workspaceLensWithPlacement", ...operation.args); break;
    case "workspaceGroupedDisplay": result = model.workspaceCall("workspaceGroupedDisplay", ...operation.args); break;
    case "workspacePresentationFor": result = model.workspaceCall("workspacePresentationFor", ...operation.args); break;
    case "workspaceLensShortcuts": result = model.workspaceCall("workspaceLensShortcuts", ...operation.args); break;
    case "workspaceFieldProjection": result = model.workspaceCall("workspaceFieldProjection", ...operation.args); break;
    case "allDataRootTargets": result = model.workspaceCall("allDataRootTargets", ...operation.args); break;
    case "addressMemberIndex": result = model.workspaceCall("addressMemberIndex", ...operation.args); break;
    case "addressMemberSegment": result = model.workspaceCall("addressMemberSegment", ...operation.args); break;
    default: { const exhaustive: never = operation; throw new Error(`Unknown Local ordinary operation ${String(exhaustive)}`); }
  }
  return result as LocalOrdinaryResult<O>;
}
