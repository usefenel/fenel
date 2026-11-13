import { createMemo } from "solid-js";
import type { JSX } from "@solidjs/web";
import { accountFieldRegistryState } from "./account-field-registry";
import { userFunctions } from "./user-registries";
import { AuthoringSessionContext, accountAuthoringSession, reactiveAuthoringSession } from "./expression-runner/authoring-session";
import type { AuthoringSession } from "./expression-runner/account-authoring-session";

/** The per-pane provider has the same reactive-session adapter while leaving
 * the lightweight reader entry independent of the authoring import graph. */
export function ReaderAuthoringProvider(props: {
  session: () => AuthoringSession;
  captureSourceMetadata?: AuthoringSession["captureSourceMetadata"];
  children: JSX.Element;
}) {
  const session = reactiveAuthoringSession(() => props.session(), () => props.captureSourceMetadata?.());
  return <AuthoringSessionContext value={session}>{props.children}</AuthoringSessionContext>;
}

/** The authenticated workspace shares one account catalog with every nested
 * editor. A type picker or representation editor must not accidentally boot
 * an unrelated system registry when opened. */
export default function WorkspaceAuthoringProvider(props: { children: JSX.Element }) {
  const session = createMemo(() => {
    const committed = accountFieldRegistryState();
    if (!committed) throw new Error("Editing requires the loaded account types");
    return accountAuthoringSession({ accountId: committed.accountId, functions: userFunctions() });
  });
  // Context values are read once by the provider. Keep a stable facade whose
  // fields track the current committed session in the consumer's scope; a
  // registry update must neither freeze old types nor remount unsaved editors.
  const shared = reactiveAuthoringSession(session);
  return <AuthoringSessionContext value={shared}>{props.children}</AuthoringSessionContext>;
}
