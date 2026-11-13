import { createContext, useContext } from "solid-js";

/** One lens has nothing to show yet. Its frame keeps the body in a waiting state. */
export type WorkspaceWait = { stage: 0 | 1 | 2; detail: string };

export type WorkspaceLoadApi = {
  report: (id: string, wait: WorkspaceWait | undefined) => void;
};

const absentLoad: WorkspaceLoadApi = { report() {} };

export const WorkspaceLoadContext = createContext<WorkspaceLoadApi>(absentLoad);

/** Undefined outside a workspace, so a lone reader keeps its own loading card. */
export function useWorkspaceLoad(): WorkspaceLoadApi | undefined {
  const value = useContext(WorkspaceLoadContext);
  return value === absentLoad ? undefined : value;
}
