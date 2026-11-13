import { createSignal } from "solid-js";
import { browserAccountScope, onBrowserSessionChange, sessionEpoch } from "../browser-session";
import { LOCAL_BROWSER_SOURCE_ID } from "../browser-data-storage";
import { internalFromClipboardHtml } from "./clipboard";
import type { TransferSnapshot } from "./types";

/** Browser handoff ownership, never an authority grant. The receiving view
 * still uses its captured API reader and the server checks every write. */
export type WorkspaceTransferOwner = ({ readonly accountId: string; readonly sourceId?: undefined }
  | { readonly accountId?: undefined; readonly sourceId: string }) & {
  readonly paneId: string;
  readonly epoch: number;
};

export function workspaceTransferOwner(accountId: string | undefined, paneId: string | undefined,
  epoch = sessionEpoch(), sourceId?: string): WorkspaceTransferOwner | undefined {
  if (paneId === undefined) return undefined;
  if (!accountId && !sourceId) throw new Error("A lens transfer needs its captured data reader.");
  return Object.freeze({ ...(accountId ? { accountId } : { sourceId: sourceId! }), paneId, epoch });
}

/** An in-memory receipt for one captured browser event. */
export type WorkspaceTransferTicket = Readonly<object>;

export type PendingWorkspaceTransfer = {
  readonly ticket: WorkspaceTransferTicket;
  snapshot: TransferSnapshot;
  epoch: number;
  viewId?: string;
  point?: { x: number; y: number };
  owner?: WorkspaceTransferOwner;
};

type QueuedTransfer = PendingWorkspaceTransfer & {
  initialLocalRoot: boolean;
  migrated: boolean;
  claimed: boolean;
};
type ResumeOptions = { resumeInitialLocalRoot?: boolean };

let pending: QueuedTransfer[] = [];
// One host notification for this existing queue, including owned teardown.
// The synchronous receipt scan below remains the source of currentness.
const [transferRevision, setTransferRevision] = createSignal(0, { ownedWrite: true });
const queueChanged = () => { setTransferRevision(revision => revision + 1); };
// Session listeners run before Solid publishes sessionEpoch. Keep the plain
// epoch in step so an old listener/acknowledgement cannot publish into the new
// queue while that signal still reports the previous epoch.
let queueEpoch = sessionEpoch();
let accountObserved = browserAccountScope() !== undefined;
onBrowserSessionChange(() => {
  queueEpoch += 1;
  const mayContinueInitialLocal = !accountObserved;
  accountObserved ||= browserAccountScope() !== undefined;
  pending = mayContinueInitialLocal ? pending.filter(entry => entry.initialLocalRoot).map(entry => ({
    ...entry, epoch: queueEpoch, owner: { ...entry.owner!, epoch: queueEpoch }, claimed: false, migrated: true,
  })) : [];
  queueChanged();
});

/** Automatic initial saved-lens adoption waits for this same Local source's
 * captures at every scope, including after its first cookie response. This
 * scheduling observation does not expand which receipts survive a session. */
export function localTransfersPending(): boolean {
  transferRevision();
  return pending.some(entry => entry.epoch === queueEpoch && entry.owner?.sourceId === LOCAL_BROWSER_SOURCE_ID);
}

/** Clipboard data is captured during the event, before the lazy editor loads. */
export function queueWorkspaceTransfer(
  snapshot: TransferSnapshot,
  viewId?: string,
  point?: { x: number; y: number },
  owner?: WorkspaceTransferOwner,
  options: { initialLocalRoot?: boolean } = {},
): WorkspaceTransferTicket | undefined {
  const epoch = sessionEpoch();
  if (epoch !== queueEpoch || owner && owner.epoch !== epoch) return;
  let initialLocalRoot = options.initialLocalRoot === true && !accountObserved && viewId === undefined
    && owner?.sourceId === LOCAL_BROWSER_SOURCE_ID && !snapshot.internal && !snapshot.savedExprId && !snapshot.savedExprName;
  // Chromium can carry an internal Fenel copy in HTML instead of custom MIME.
  // Reuse its existing wire reader rather than treating private copied data as
  // an external capture that can continue after the cookie resolves.
  if (initialLocalRoot && snapshot.html) {
    try { initialLocalRoot = !internalFromClipboardHtml(snapshot.html); }
    catch { initialLocalRoot = false; }
  }
  const ticket = Object.freeze({});
  pending.push({ ticket, snapshot: { ...snapshot, files: [...snapshot.files] }, epoch, viewId,
    ...(point ? { point: { ...point } } : {}), ...(owner ? { owner: { ...owner } } : {}),
    initialLocalRoot, migrated: false, claimed: false });
  queueChanged();
  return ticket;
}

function ownedBy(entry: PendingWorkspaceTransfer, owner: WorkspaceTransferOwner | undefined): boolean {
  return owner === undefined ? entry.owner === undefined : !!entry.owner && entry.owner.accountId === owner.accountId
    && entry.owner.sourceId === owner.sourceId
    && entry.owner.paneId === owner.paneId && entry.owner.epoch === owner.epoch;
}

function availableTo(entry: QueuedTransfer, owner: WorkspaceTransferOwner | undefined, options: ResumeOptions): boolean {
  return !entry.migrated && ownedBy(entry, owner) || options.resumeInitialLocalRoot === true && entry.migrated && entry.initialLocalRoot
    && owner?.sourceId === LOCAL_BROWSER_SOURCE_ID && entry.owner?.sourceId === owner.sourceId
    && owner.epoch === queueEpoch;
}

/** Inspect queued captures without removing their retry receipt. Resuming is
 * explicit because only a newly acquired Local root may adopt a migrated root
 * capture; an ordinary sibling or nested lens retains strict pane ownership. */
export function peekWorkspaceTransfers(owner?: WorkspaceTransferOwner, options: ResumeOptions = {}): PendingWorkspaceTransfer[] {
  if (owner && owner.epoch !== queueEpoch) return [];
  const current: PendingWorkspaceTransfer[] = [];
  for (const entry of pending) {
    if (entry.epoch !== queueEpoch || !availableTo(entry, owner, options)) continue;
    if (entry.claimed) break;
    current.push(entry);
  }
  return current;
}

/** Only the first capture for this destination may start, so a slow fallback
 * cannot be overtaken by a later fast paste. The raw snapshot stays queued
 * until its publisher acknowledges in the same task as model publication. */
export function claimWorkspaceTransfer(ticket: WorkspaceTransferTicket, owner?: WorkspaceTransferOwner,
  options: ResumeOptions = {}): PendingWorkspaceTransfer | undefined {
  if (owner && owner.epoch !== queueEpoch) return;
  const entry = pending.find(entry => entry.epoch === queueEpoch && availableTo(entry, owner, options));
  if (!entry || entry.ticket !== ticket || entry.claimed) return;
  if (!ownedBy(entry, owner)) entry.owner = { ...owner! };
  entry.migrated = false;
  entry.claimed = true;
  queueChanged();
  return entry;
}

export function acknowledgeWorkspaceTransfer(ticket: WorkspaceTransferTicket, owner?: WorkspaceTransferOwner): boolean {
  const index = pending.findIndex(entry => entry.ticket === ticket && entry.epoch === queueEpoch && entry.claimed && ownedBy(entry, owner));
  if (index < 0) return false;
  pending.splice(index, 1);
  queueChanged();
  return true;
}

/** Failed fast ingress returns to the same destination's existing editor path. */
export function releaseWorkspaceTransfer(ticket: WorkspaceTransferTicket, owner?: WorkspaceTransferOwner): boolean {
  const entry = pending.find(entry => entry.ticket === ticket && entry.epoch === queueEpoch && entry.claimed && ownedBy(entry, owner));
  if (!entry) return false;
  entry.claimed = false;
  queueChanged();
  return true;
}

/** Legacy single-surface callers consume only unowned legacy handoffs. */
export function takeWorkspaceTransfers(owner?: WorkspaceTransferOwner): PendingWorkspaceTransfer[] {
  const current = peekWorkspaceTransfers(owner);
  const taken = new Set(current.map(entry => entry.ticket));
  pending = pending.filter(entry => !taken.has(entry.ticket));
  if (current.length) queueChanged();
  return current;
}

export function hasWorkspaceTransfers(owner?: WorkspaceTransferOwner): boolean {
  return pending.some(entry => entry.epoch === queueEpoch && !entry.migrated && ownedBy(entry, owner));
}

export function discardWorkspaceTransfers(owner?: WorkspaceTransferOwner): void {
  const previous = pending.length;
  pending = pending.filter(entry => entry.epoch !== queueEpoch || entry.migrated || !ownedBy(entry, owner));
  if (pending.length !== previous) queueChanged();
}
