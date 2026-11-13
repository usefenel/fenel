import { createContext, useContext, type Accessor } from "solid-js";

export type WorkspaceReadiness = {
  request: () => void;
  ready: Accessor<boolean>;
  loading: Accessor<boolean>;
  stage: Accessor<string | null>;
  error: Accessor<string | null>;
  retry: () => void;
  /** Reload is required when a held public document belongs to another build. */
  retryLabel?: Accessor<string>;
  /** Initial server/session handshake, before a reader can be selected. */
  startup?: {
    stage: Accessor<string>;
    error: Accessor<string | undefined>;
    retry: () => void;
  };
};

export const WorkspaceReadinessContext = createContext<WorkspaceReadiness>();

export function useWorkspaceReadiness(): WorkspaceReadiness {
  const workspace = useContext(WorkspaceReadinessContext);
  if (!workspace) throw new Error("Workspace readiness requires the authenticated application shell");
  return workspace;
}
