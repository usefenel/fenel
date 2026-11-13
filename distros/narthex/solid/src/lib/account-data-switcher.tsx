import { createMemo, createSignal } from "solid-js";
import { useLocation, useNavigate } from "@solidjs/router";
import { AccountDataSelector } from "./account-data-selector";
import { accountSelectionPending, isAuthenticated, listAccessibleAccounts, setAccountSelectionPending, subject, switchAccount } from "./auth";
import { sessionEpoch } from "./browser-session";
import { createAsyncValue } from "./async-value";
import { LocusNotifications, type LocusNotice } from "./locus-notifications";

// Choosing repository data changes the viewed root, never the authenticated
// principal. A new session forgets the previous session's viewing preference.
const [publicSelection, setPublicSelection] = createSignal<number>();
export const publicDataSelected = () => !isAuthenticated() || publicSelection() === sessionEpoch();

/** Account roots are selected independently of the path within their data.
 * The containing editor owns the save barrier before its identity is revoked. */
export function AccountDataSwitcher(props: {
  beforeChange?: () => void | Promise<void>;
  disabled?: boolean;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const accountId = () => {
    const current = subject();
    return current?.$tag === "User" ? current.accountId : undefined;
  };
  const accounts = createAsyncValue(() => accountId() ? sessionEpoch() : false, listAccessibleAccounts);
  const [selecting, setSelecting] = createSignal(false);
  const [saveError, setSaveError] = createSignal<string>();
  const [dismissed, setDismissed] = createSignal(false);
  const options = createMemo(() => [
    { id: "public", label: "Fenel", icon: "globe" },
    ...(accounts() ?? (accountId() ? [{ accountId: accountId()!, name: "Your account", slug: "" }] : []))
      .map((account) => ({ id: account.accountId, label: account.name || account.slug })),
  ]);
  const notices = createMemo<LocusNotice[]>(() => dismissed() ? [] : accounts.error
    ? [{ id: "accounts", tone: "error", message: "Could not load your account choices.",
      retry: { label: "Retry", run: () => { void accounts.refetch(); } } }]
    : saveError() ? [{ id: "account-save", tone: "error", message: saveError()! }] : []);

  async function change(nextId: string) {
    if (accountSelectionPending() || selecting() || props.disabled
      || nextId === (publicDataSelected() ? "public" : accountId())) return;
    const epoch = sessionEpoch();
    setAccountSelectionPending(true);
    setSelecting(true);
    setDismissed(false);
    setSaveError(undefined);
    try {
      await props.beforeChange?.();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Save your current changes before changing account data.");
      setSelecting(false);
      setAccountSelectionPending(false);
      return;
    }
    try {
      if (epoch !== sessionEpoch()) return;
      if (nextId === "public") {
        setPublicSelection(epoch);
        if (/^\/app\/home\/?$/.test(location.pathname)) navigate("/app");
      }
      else {
        if (nextId !== accountId()) await switchAccount(nextId);
        setPublicSelection(undefined);
      }
    }
    catch { /* The auth module reports failures across the identity remount. */ }
    finally { setSelecting(false); setAccountSelectionPending(false); }
  }

  return <>
    <AccountDataSelector options={options()} value={publicDataSelected() ? "public" : accountId() ?? ""}
      disabled={props.disabled || accountSelectionPending() || selecting()} onChange={(id) => { void change(id); }} />
    <LocusNotifications notices={notices()} onDismiss={() => setDismissed(true)} />
  </>;
}
