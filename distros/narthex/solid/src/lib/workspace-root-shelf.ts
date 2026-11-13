import { createContext, useContext } from "solid-js";

/** Browse and New on the global bar start at the selected data source's root.
 *  The same buttons inside a lens start wherever that lens is focused. */
export type RootShelfAction = "browse" | "new" | "new:value" | "new:type" | "new:function" | "new:expression" | "new:showcase-demo" | "new:recipe-demo";

export type RootShelfHandler = {
  paneId: string;
  sourceKey: () => string;
  isRoot: () => boolean;
  isActive: () => boolean;
  accountId: () => string | undefined;
  canCreate: () => boolean;
  creationResolved: () => boolean;
  /** Engine-free kind selection only; this never supplies a write verdict. */
  canChooseCreation?: () => boolean;
  /** Hold a current kind picker while its existing owner hands off. */
  pendingCreationPicker?: () => boolean;
  run: (action: RootShelfAction) => void;
};

export type WorkspaceRootShelf = {
  request: (action: RootShelfAction) => void;
  cancel: (paneId?: string) => void;
  register: (handler: RootShelfHandler) => () => void;
};

const absentShelf: WorkspaceRootShelf = { request() {}, cancel() {}, register: () => () => {} };
export const WorkspaceRootShelfContext = createContext<WorkspaceRootShelf>(absentShelf);

export function useWorkspaceRootShelf(): WorkspaceRootShelf | undefined {
  const shelf = useContext(WorkspaceRootShelfContext);
  return shelf === absentShelf ? undefined : shelf;
}
