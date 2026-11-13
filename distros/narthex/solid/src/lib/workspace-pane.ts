import type { Accessor } from "solid-js";
import type { LocusScope } from "./locus-scope";
import type { LocusLayoutChoice } from "./locus-layout-options";
import type { WorkspaceSource, WorkspacePresentationTarget } from "./workspace-model";
import type { AccountDataOption } from "./account-data-selector";
import type { DataInspectionMode, DataInspectionSuggestions } from "./DataInspectionDialog";
import type { LensShortcut, LensTypedSubject } from "./lens-shortcuts";
import type { LocusAddressInput, LocusAddressInputRequest } from "./locus-address-inputs";
import type { LocalCreationDraft } from "./home-action";

/** New lenses reuse the existing layered layout or floating placement. */
export type WorkspaceLensOpenMode = "stack" | "split" | "float";

/** What the clicked card already shows about its destination. A lens shows it
 * at once, before the destination's reader and lens settings are ready. */
export type WorkspaceNavigationIntent = { name?: import("./display-name").DisplayNameInput; icon?: string; emoji?: string };
/** A navigation the lens shows before it commits; cancel restores the parent as it was. */
export type WorkspacePendingNavigation = WorkspaceNavigationIntent & { cancel: () => void };

/** Browser callbacks connecting the existing Locus to one persisted lens. */
export type WorkspacePane = {
  id: string;
  active: Accessor<boolean>;
  focus: Accessor<LocusScope>;
  presentation: Accessor<LocusLayoutChoice | undefined>;
  fields?: Accessor<import("./workspace-wire").LensFieldPreferences | undefined>;
  projectFields?: (identities: readonly string[]) => Promise<{ order: string[]; visible: string[] }>;
  onFields?: (fields: import("./workspace-wire").LensFieldPreferences | undefined) => Promise<void>;
  /** Transient visibility shared by this lens's early and prepared surfaces. */
  inspectionMode?: Accessor<DataInspectionMode>;
  onInspectionMode?: (mode: DataInspectionMode) => void;
  /** Keep the reader's open Browse panel across its address/reader handoff. */
  browseState?: Accessor<{ open: boolean; query: string } | undefined>;
  onBrowseChange?: (state: { open: boolean; query: string }) => void;
  /** Plain Local creation input survives replacement of its checked reader. */
  creationDraft?: Accessor<LocalCreationDraft | undefined>;
  onCreationDraft?: (draft: LocalCreationDraft | undefined, owner: import("./api").ApiClient) => void;
  shortcuts?: Accessor<readonly LensShortcut[] | undefined>;
  /** Prepared Home owns this transient query; the header keeps one menu. */
  suggestions?: Accessor<DataInspectionSuggestions | undefined>;
  registerSuggestions?: (suggestions: DataInspectionSuggestions) => () => void;
  /** Named URI literals seed the same typed Call editor after its reader is ready. */
  addressInputs?: Accessor<LocusAddressInputRequest | undefined>;
  onAddressInputsHandled?: (id: number) => void;
  onAddressInputsChanged?: (inputs: readonly LocusAddressInput[]) => void;
  subject?: Accessor<LensTypedSubject | undefined>;
  onSubjectData?: (subject: LensTypedSubject | undefined, presentation?: LocusLayoutChoice, isCurrent?: () => boolean) => void;
  shortcutRequest?: Accessor<{ id: number; shortcut: LensShortcut } | undefined>;
  onShortcut?: (shortcut: LensShortcut) => void;
  onShortcutHandled?: (id: number) => void;
  toolbarMount: Accessor<HTMLElement | undefined>;
  /** Shared data heading outlet, retained through early/prepared reader handoff. */
  summaryMount?: Accessor<HTMLElement | undefined>;
  sourceLabel: Accessor<string>;
  source: Accessor<WorkspaceSource>;
  accounts: Accessor<readonly AccountDataOption[]>;
  /** Borrow the surface's existing source transport and checked reader for creation. */
  creationSource?: (id: string) => { client: import("./api").ApiClient; ready: () => Promise<import("./reader-runtime").ReaderRuntime> };
  onFocus: (scope: LocusScope, presentation?: LocusLayoutChoice, intent?: WorkspaceNavigationIntent) => void;
  /** The destination this lens shows while its navigation commits. */
  navigationPending?: Accessor<WorkspacePendingNavigation | undefined>;
  /** Open a data of this lens (or another source's location) by its address
   * in a new tab or window; `openElsewhereUnavailable` gives the reason none can open. */
  openElsewhere?: (scope: LocusScope, place: "tab" | "window", source?: WorkspaceSource) => void;
  openElsewhereUnavailable?: (source?: WorkspaceSource) => string | undefined;
  onOpenLens: (scope: LocusScope, mode?: WorkspaceLensOpenMode, presentation?: LocusLayoutChoice) => void;
  onClose: () => void;
  onPresentation: (kind: LocusLayoutChoice) => void;
  onSource: (id: string) => void;
  onAllData?: (mode?: "stack" | "split") => void;
  onDataTarget?: (target: Extract<WorkspacePresentationTarget, { $tag: "ValuePresentationTarget" }>, mode?: WorkspaceLensOpenMode, presentation?: LocusLayoutChoice,
    intent?: WorkspaceNavigationIntent) => void;
  onSubject: (typeRef: string | undefined, label: string, kind: LocusLayoutChoice) => void;
  /** `idle` answers synchronously that `flush` has nothing to do (it would answer
   * true at once); a pane without it is always held and flushed before leaving. */
  registerFlush: (flush: (reason?: "home-check" | "home") => Promise<boolean>, idle?: () => boolean) => () => void;
};
