// ---------------------------------------------------------------------------
// /app/instances — unified instance browser.
//
// In Fenel, every kind of "thing that exists" is an instance of something:
//   - Entity records  (a profile row, an item row, a user-defined entity)   ← instances of an entity TYPE
//   - Function instances (a running flow)                                    ← instances of a FUNCTION
//   - Interface instances (per-account method overrides like PhoneFormat<US>) ← instances of an interface
//
// This page is the cross-cutting view. Each section is a summary that
// links out to the full drill-in surface for that kind.
// ---------------------------------------------------------------------------

import { For, Show, createMemo, refresh } from "solid-js";
import { revalidate } from "@solidjs/router";
import {
  systemEntities,
  getLabel,
  getDescription,
  shortIdOf,
} from "@fenel/engine";
import { canonical } from "@fenel/engine/locale";
import {
  api,
  getDispatchInstances,
  getFunctionInstances,
  getFunctions,
  getTypes,
} from "~/lib/api";
import { confirmDialog } from "~/lib/confirm-modal";
import { InstanceEditor, type InstanceApiRow } from "~/lib/instances";
import { reloadUserRegistries } from "~/lib/user-registries";

export default function InstancesPage() {
  return (
    <>
      <h1 class="page-title">Instances</h1>
      <p class="text-muted" style="margin-bottom: 1.25rem; font-size: 0.85rem">
        Cross-cutting view of every kind of instance in the system: entity records (rows), running function invocations, and interface dispatch instances.
      </p>

      <EntityRecordsSection />
      <FunctionInstancesSection />
      <DispatchInstancesSection />
    </>
  );
}

// ---------------------------------------------------------------------------
// Entity records — list every entity type with a link to its instance list.
// ---------------------------------------------------------------------------

function EntityRecordsSection() {
  const userTypes = createMemo(() => getTypes().catch(() => null));

  const cards = createMemo(() => {
    const out: { name: string; label: string; description: string; system: boolean }[] = [];
    for (const e of systemEntities) {
      out.push({
        name: e.id,
        label: canonical(getLabel(e.id) ?? e.id),
        description: canonical(getDescription(e.id) ?? `${e.id} entity`),
        system: true,
      });
    }
    const user = ((userTypes() as any)?.types ?? []) as { name: string; label?: string; description?: string; isSystem?: boolean }[];
    for (const t of user) {
      if (t.isSystem) continue;
      out.push({
        name: t.name,
        label: t.label ?? t.name,
        description: t.description ?? "",
        system: false,
      });
    }
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  });

  return (
    <section style="margin-bottom: 2rem">
      <h2 style="font-size: 1rem; font-weight: 600; margin: 0 0 0.5rem">
        Entity Records
        <span class="badge badge-gray" style="margin-left: 0.5rem; font-size: 0.7rem">{cards().length}</span>
      </h2>
      <p class="text-muted" style="font-size: 0.78rem; margin-bottom: 0.75rem">
        Every entity type — system and user-defined. Click to browse, create, and edit records.
      </p>
      <div class="entity-type-grid">
        <For each={cards()}>
          {(c) => (
            <a href={`/app/types/entity:${c.name}`} class="entity-type-card">
              <div class="entity-type-card__header">
                <span class="entity-type-card__name">{c.label}</span>
                <div class="entity-type-card__badges">
                  <span class={`badge ${c.system ? "badge-gray" : "badge-green"}`}>
                    {c.system ? "system" : "user"}
                  </span>
                </div>
              </div>
              <Show when={c.description}>
                <p class="entity-type-card__desc">{c.description}</p>
              </Show>
              <div class="entity-type-card__meta">
                <span class="mono">{c.name}</span>
              </div>
            </a>
          )}
        </For>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Function instances — recent running invocations, joined with function name.
// ---------------------------------------------------------------------------

function FunctionInstancesSection() {
  const data = createMemo(() => getFunctionInstances().catch(() => ({ instances: [] }) as any));
  const fns = createMemo(() => getFunctions().catch(() => ({ functions: [] }) as any));

  // Function-definition lookup by id. The instance's name/icon override these
  // when present (value-level dispatch wins over type-level).
  const fnById = createMemo(() => {
    const map = new Map<string, { name: string; label?: string; icon?: string; description?: string }>();
    for (const f of (fns() as any)?.functions ?? []) map.set(f.id, f);
    return map;
  });

  type Row = {
    id: string;
    functionId: string;
    profileId: string;
    status: string;
    currentStepPath: string | null;
    startedAt: string | null;
    name: string | null;
    icon: string | null;
    fnName: string | null;
    label: string;
    iconText: string | null;
    description: string | null;
  };

  const rows = createMemo<Row[]>(() => {
    const list = (data() as any)?.instances ?? [];
    return list.map((inst: any): Row => {
      const fn = fnById().get(inst.functionId);
      // 9a-3b — a running-fn instance's identity IS its function's
      // Codeable/Labelable: read it off the function definition (fn?.label
      // / fn?.icon / fn?.description), not by sniffing magic name fields off
      // the instance row. The retired value-level field-sniffing never
      // contributed here — function_instances.name/icon (migration 0028) are
      // never populated by any insert path — so this is behavior-identical.
      const label =
        fn?.label ??
        fn?.name ??
        shortIdOf(inst) ??
        "(instance)";
      const iconText = fn?.icon ?? null;
      const description = fn?.description ?? null;
      return {
        id: inst.id,
        functionId: inst.functionId,
        profileId: inst.profileId,
        status: inst.status,
        currentStepPath: inst.currentStepPath ?? null,
        startedAt: inst.startedAt ?? null,
        name: inst.name ?? null,
        icon: inst.icon ?? null,
        fnName: fn?.name ?? null,
        label,
        iconText,
        description,
      };
    });
  });

  return (
    <section style="margin-bottom: 2rem">
      <h2 style="font-size: 1rem; font-weight: 600; margin: 0 0 0.5rem">
        Function Instances
        <span class="badge badge-gray" style="margin-left: 0.5rem; font-size: 0.7rem">{rows().length}</span>
      </h2>
      <p class="text-muted" style="font-size: 0.78rem; margin-bottom: 0.75rem">
        Most recent invocations across every function. Each row is a first-class instance — name and icon override the function's defaults when set. Click to drill into the timeline, variables, and current step.
      </p>
      <Show when={rows().length > 0} fallback={<p class="text-muted" style="font-size: 0.85rem">No function instances yet.</p>}>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Instance</th>
                <th>Function</th>
                <th>Profile</th>
                <th>Status</th>
                <th>Current step</th>
                <th>Started</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <For each={rows()}>
                {(r) => (
                  <tr>
                    <td>
                      <div style="display: flex; align-items: center; gap: 0.4rem">
                        <Show when={r.iconText}>
                          <span style="font-size: 0.95rem; line-height: 1">{r.iconText}</span>
                        </Show>
                        <div style="display: flex; flex-direction: column; min-width: 0">
                          <Show
                            when={r.fnName}
                            fallback={<span class="mono" style="font-weight: 500">{r.label}</span>}
                          >
                            <a
                              href={`/app/functions/${r.fnName}/instances/${r.id}`}
                              style="font-weight: 500"
                            >
                              {r.label}
                            </a>
                          </Show>
                          <Show when={r.description}>
                            <span class="text-muted" style="font-size: 0.7rem; line-height: 1.2">{r.description}</span>
                          </Show>
                        </div>
                      </div>
                    </td>
                    <td>
                      <Show
                        when={r.fnName}
                        fallback={<span class="mono text-muted">{shortIdOf({ id: r.functionId })}</span>}
                      >
                        <a href={`/app/functions/${r.fnName}`} class="mono">{r.fnName}</a>
                      </Show>
                    </td>
                    <td>
                      <Show when={r.profileId} fallback={<span class="text-muted">—</span>}>
                        <a href={`/app/types/entity:profile/${r.profileId}`} class="mono">
                          {shortIdOf({ id: r.profileId })}
                        </a>
                      </Show>
                    </td>
                    <td><span class={`badge ${statusBadge(r.status)}`}>{r.status}</span></td>
                    <td class="mono text-muted">{r.currentStepPath ?? "—"}</td>
                    <td class="text-muted">{r.startedAt ? new Date(r.startedAt).toLocaleString() : "—"}</td>
                    <td style="white-space: nowrap">
                      <Show when={r.fnName}>
                        <a
                          href={`/app/functions/${r.fnName}/instances/${r.id}`}
                          class="btn"
                          style="padding: 0.15rem 0.4rem; font-size: 0.7rem; text-decoration: none"
                        >
                          open
                        </a>
                      </Show>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </section>
  );
}

function statusBadge(status: string): string {
  switch (status) {
    case "running": return "badge-green";
    case "completed": return "badge-blue";
    case "failed": return "badge-red";
    case "cancelled": return "badge-gray";
    default: return "badge-yellow";
  }
}

function DispatchInstancesSection() {
  const data = createMemo(() => getDispatchInstances().catch(() => ({ dispatchInstances: [] }) as any));

  const rows = () => (((data() as any)?.dispatchInstances ?? (data() as any)?.specInstances ?? []) as InstanceApiRow[]);

  async function handleSave(
    body: { typeName: string; args: unknown[]; instance: Record<string, unknown>; valueEncoding?: import("@fenel/engine/authoring/type").InstanceJsonEncoding },
    row?: InstanceApiRow,
  ) {
    if (row?.id) await api.dispatchInstanceUpdate(row.id, body.instance, body.valueEncoding);
    else await api.dispatchInstanceCreate(body);
    revalidate("dispatchInstances");
    await getDispatchInstances();
    await refresh(data);
    await reloadUserRegistries();
  }

  async function handleDelete(row: InstanceApiRow) {
    if (!row.id) return;
    if (!(await confirmDialog({
      message: "Delete this dispatch instance?",
      variant: "danger",
      confirmLabel: "Delete",
    }))) return;
    await api.dispatchInstanceDelete(row.id);
    revalidate("dispatchInstances");
    await getDispatchInstances();
    await refresh(data);
    await reloadUserRegistries();
  }

  return (
    <section style="margin-bottom: 2rem">
      <h2 style="font-size: 1rem; font-weight: 600; margin: 0 0 0.5rem">
        Dispatch Instances
        <span class="badge badge-gray" style="margin-left: 0.5rem; font-size: 0.7rem">{rows().length}</span>
      </h2>
      <p class="text-muted" style="font-size: 0.78rem; margin-bottom: 0.75rem">
        Per-account instances for interface dispatch. Create, edit, or remove arbitrary interface instances here.
      </p>
      <InstanceEditor
        title="Interface Instances"
        rows={rows()}
        onSave={handleSave}
        onDelete={handleDelete}
      />
    </section>
  );
}
