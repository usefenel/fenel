import { createContext, useContext, type Accessor } from "solid-js";
import type { WorkspaceBar } from "./workspace-model";

/** DOM outlets and the projected bar value; persisted state belongs to the
 * typed WorkspacePreferences value, not this browser binding. */
export type WorkspaceChrome = {
  mount: Accessor<HTMLElement | undefined>;
  setBar: (bar: WorkspaceBar | undefined, owner: symbol) => void;
  /** The shell reserves the fold control before the lens owner is ready. */
  setFoldBar?: (fold: (() => void) | undefined, owner: symbol) => void;
  setBeforeLeave: (prepare: (() => Promise<boolean>) | undefined, owner: symbol) => void;
  /** Optional while Home is mounting; the registered lens owner handles guards. */
  home?: () => Promise<boolean> | undefined;
  setHome?: (home: (() => Promise<boolean>) | undefined, owner: symbol) => void;
};
// null (a value) outside the application shell: Solid 2 throws on a context
// read with no provider and no default, and every reader already treats a
// missing chrome as absent (`chrome?.`).
export const WorkspaceChromeContext = createContext<WorkspaceChrome | null>(null);
export const useWorkspaceChrome = (): WorkspaceChrome | undefined => useContext(WorkspaceChromeContext) ?? undefined;
