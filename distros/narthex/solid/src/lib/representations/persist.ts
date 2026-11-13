// ---------------------------------------------------------------------------
// Representations persistence -- specialized helpers over the general
// dispatch Instance persistence contract. Display representations are ordinary
// Instance values with `typeName`, `args`, and `methods`; this file only keeps
// the convenience names used by the existing create flows.
//
// The dashboard /dispatch-instances endpoint refreshes the engine's
// account-scoped registry server-side so other clients see the change
// on next dispatch.
// ---------------------------------------------------------------------------

import { defaultApiClient, isReaderInstanceEncoding, type ApiClient, type RepresentationEncoding } from "~/lib/api";
import { draftToApiBody, representationPresetDraft, normalizeInstanceDraft, type InstanceDraft } from "~/lib/instances";
import { instanceFromJsonWire, instanceToJsonWire, INSTANCE_JSON_ENCODING, type InstanceJsonEncoding } from "@fenel/engine/authoring/type";
import { accountFieldRegistry } from "~/lib/account-field-registry";
import { assertCurrentSession, sessionEpoch } from "~/lib/browser-session";

type PersistedRow = {
  id: string;
  typeName: string;
  args: unknown[];
  instance: InstanceDraft;
};

async function findExistingRow(
  typeName: string,
  targetId: string,
  client: ApiClient,
): Promise<PersistedRow | null> {
  const resp = await client.apiFetch<{ dispatchInstances?: PersistedRow[]; specInstances?: PersistedRow[] }>(
    `/dispatch-instances?typeName=${encodeURIComponent(typeName)}`,
  );
  const rows = resp.dispatchInstances ?? resp.specInstances ?? [];
  return rows.find((r) => r.args[0] === targetId) ?? null;
}

export async function persistInstanceDraft(
  draft: InstanceDraft,
  existingId?: string,
  valueEncoding?: InstanceJsonEncoding,
  client: ApiClient = defaultApiClient,
  registry?: RepresentationEncoding,
  canContinue?: () => boolean,
): Promise<void> {
  if (canContinue && !canContinue()) return;
  // B4 unit E: a single Local row uses the same revision/encoding owner as
  // a representation batch. The HTTP endpoints do not carry that token.
  if (isReaderInstanceEncoding(registry) && client.writeDispatchInstances) {
    const epoch = client.epoch ?? sessionEpoch();
    const capturedRegistry = registry;
    const { root } = await client.getLocusRoot();
    assertCurrentSession(epoch);
    if (canContinue && !canContinue()) return;
    const [body] = await instanceWriteBodies([draft], valueEncoding, client, capturedRegistry);
    assertCurrentSession(epoch);
    if (canContinue && !canContinue()) return;
    await client.writeDispatchInstances([{ ...body!, ...(existingId ? { existingId } : {}) }], root.revision, capturedRegistry);
    return;
  }
  const [body] = await instanceWriteBodies([draft], valueEncoding, client, registry);
  if (canContinue && !canContinue()) return;
  if (existingId) {
    await client.api.dispatchInstanceUpdate(existingId, body.instance, body.valueEncoding);
  } else {
    await client.api.dispatchInstanceCreate(body);
  }
}

/** B4 unit E: a Local reader's worker encoding encodes the whole batch in its
 * worker (one request); a page registry encodes each draft here, as before. */
async function instanceWriteBodies(
  drafts: readonly InstanceDraft[],
  valueEncoding: InstanceJsonEncoding | undefined,
  client: ApiClient,
  registry?: RepresentationEncoding,
) {
  const encoding = valueEncoding ?? INSTANCE_JSON_ENCODING;
  const captured = registry ?? (client === defaultApiClient ? accountFieldRegistry() ?? undefined : undefined);
  const encoded = valueEncoding ? drafts
    : isReaderInstanceEncoding(captured)
      ? await captured.encodeInstances(drafts as unknown as Record<string, unknown>[], encoding) as unknown as InstanceDraft[]
      : drafts.map(draft => instanceToJsonWire(draft, captured, undefined, encoding));
  return encoded.map(draft => ({ ...draftToApiBody(draft), valueEncoding: encoding }));
}

/** Persist one display-representation Instance. POSTs when no row exists and
 * PUTs the existing row otherwise. The server refreshes its account registry
 * only after commit; this client never publishes speculative dispatch state. */
export async function persistRepresentation(
  typeName: string,
  targetId: string,
  methods: Record<string, unknown>,
  valueEncoding?: InstanceJsonEncoding,
  client: ApiClient = defaultApiClient,
  registry?: RepresentationEncoding,
  canContinue?: () => boolean,
): Promise<void> {
  if (canContinue && !canContinue()) return;
  // Capture the Local revision before the conditional create/update lookup.
  // The existing batch planner preserves the selected row and its metadata.
  if (isReaderInstanceEncoding(registry) && client.writeDispatchInstances) {
    await persistRepresentations(targetId, { [typeName]: methods }, valueEncoding, client, registry, canContinue);
    return;
  }
  const epoch = client.epoch ?? sessionEpoch();
  const capturedRegistry = registry ?? (client === defaultApiClient ? accountFieldRegistry() ?? undefined : undefined);
  const existing = await findExistingRow(typeName, targetId, client);
  assertCurrentSession(epoch);
  if (canContinue && !canContinue()) return;
  await persistInstanceDraft(
    existing
      ? normalizeInstanceDraft({ ...existing.instance, typeName, methods })
      : representationPresetDraft(typeName, targetId, methods),
    existing?.id,
    valueEncoding,
    client,
    capturedRegistry,
    canContinue,
  );
}

type RepresentationWrite = Parameters<NonNullable<ApiClient["writeDispatchInstances"]>>[0][number];

/** Encode one batch of display-representation writes against `registry`.
 * Undefined means the caller's continuation was withdrawn while reading. */
export async function representationWrites(
  targetId: string,
  representations: Readonly<Record<string, Record<string, unknown>>>,
  valueEncoding: InstanceJsonEncoding | undefined,
  client: ApiClient,
  registry: RepresentationEncoding | undefined,
  canContinue?: () => boolean,
): Promise<RepresentationWrite[] | undefined> {
  const epoch = client.epoch ?? sessionEpoch();
  const drafts: Array<{ draft: InstanceDraft; existing: PersistedRow | null }> = [];
  for (const [typeName, methods] of Object.entries(representations)) {
    const existing = await findExistingRow(typeName, targetId, client);
    assertCurrentSession(epoch);
    if (canContinue && !canContinue()) return undefined;
    drafts.push({ existing, draft: existing
      ? normalizeInstanceDraft({ ...existing.instance, typeName, methods })
      : representationPresetDraft(typeName, targetId, methods) });
  }
  const bodies = drafts.length ? await instanceWriteBodies(drafts.map(entry => entry.draft), valueEncoding, client, registry) : [];
  assertCurrentSession(epoch);
  if (canContinue && !canContinue()) return undefined;
  return bodies.map((body, index) => ({ ...body,
    ...(drafts[index]!.existing === null ? {} : { existingId: drafts[index]!.existing!.id }) }));
}

/** Decode a saved representation body for its caller's own view: a Local
 * reader's worker encoding decodes in its worker, a page registry here. */
export async function decodedRepresentationBody(
  body: { instance: Record<string, unknown>; valueEncoding?: InstanceJsonEncoding },
  registry: RepresentationEncoding | undefined,
): Promise<Record<string, unknown>> {
  if (!body.valueEncoding) return body.instance;
  if (isReaderInstanceEncoding(registry)) return (await registry.decodeInstances([{ instance: body.instance, valueEncoding: body.valueEncoding }]))[0]!;
  return instanceFromJsonWire(body.instance, registry, undefined, body.valueEncoding);
}

/** Local readers publish one checked representation batch. HTTP readers keep
 * their existing sequential acknowledged writes and first-failure behavior. */
export async function persistRepresentations(
  targetId: string,
  representations: Readonly<Record<string, Record<string, unknown>>>,
  valueEncoding?: InstanceJsonEncoding,
  client: ApiClient = defaultApiClient,
  registry?: RepresentationEncoding,
  canContinue?: () => boolean,
): Promise<void> {
  const entries = Object.entries(representations);
  if (entries.length === 0 || canContinue && !canContinue()) return;
  if (!client.writeDispatchInstances) {
    for (const [typeName, methods] of entries) {
      if (canContinue && !canContinue()) return;
      await persistRepresentation(typeName, targetId, methods, valueEncoding, client, registry, canContinue);
    }
    return;
  }
  const epoch = client.epoch ?? sessionEpoch();
  const capturedRegistry = registry ?? (client === defaultApiClient ? accountFieldRegistry() ?? undefined : undefined);
  const { root } = await client.getLocusRoot();
  assertCurrentSession(epoch);
  if (canContinue && !canContinue()) return;
  const writes = await representationWrites(targetId, representations, valueEncoding, client, capturedRegistry, canContinue);
  if (!writes) return;
  await client.writeDispatchInstances(writes, root.revision, capturedRegistry);
}
