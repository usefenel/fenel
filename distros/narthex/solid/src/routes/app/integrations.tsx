import { createSignal, For, Show, createMemo, refresh } from "solid-js";
import { revalidate } from "@solidjs/router";
import { getIntegrations, getChannels, api } from "~/lib/api";
import { KNOWN_SERVICES, type ServiceInfo } from "@fenel/engine/integrations";
import { LoadingScreen } from "~/lib/loading-screen";

export default function IntegrationsPage() {
  const intData = createMemo(() => getIntegrations());
  const channelData = createMemo(() => getChannels());
  const [editing, setEditing] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);

  function getIntegration(type: string) {
    return (intData()?.integrations ?? []).find((i: any) => i.type === type);
  }

  function getTelegramChannels(): any[] {
    return (channelData()?.channels ?? []).filter(
      (ch: any) => ch.type === "telegram_group",
    );
  }

  async function handleSave(svc: ServiceInfo, form: HTMLFormElement) {
    setSaving(true);
    const fd = new FormData(form);
    const credentials: Record<string, unknown> = {};
    for (const f of svc.credentialFields) {
      const val = fd.get(f.key) as string;
      if (val) credentials[f.key] = val;
    }

    await api.integrationUpsert({
      type: svc.type,
      label: (fd.get("label") as string) || undefined,
      credentials,
    });

    revalidate("integrations");
    await refresh(intData);
    setEditing(null);
    setSaving(false);
  }

  async function handleDelete(id: string) {
    await api.integrationDelete(id);
    revalidate("integrations");
    await refresh(intData);
  }

  async function handleToggle(id: string, enabled: boolean) {
    await api.integrationUpdate(id, { enabled: !enabled });
    revalidate("integrations");
    await refresh(intData);
  }

  return (
    <>
      <h1 class="page-title">Integrations</h1>
      <Show when={intData()} fallback={<LoadingScreen />}>
        <div class="stat-grid">
          <For each={KNOWN_SERVICES}>
            {(svc) => {
              const existing = () => getIntegration(svc.type);
              const connected = () => !!existing();
              const isEditing = () => editing() === svc.type;

              return (
                <div class="card">
                  <div style="display: flex; justify-content: space-between; align-items: center">
                    <div class="card-title">{svc.label}</div>
                    <span
                      class={`badge ${connected() ? "badge-green" : "badge-gray"}`}
                    >
                      {connected() ? "Connected" : "Not connected"}
                    </span>
                  </div>
                  <p style="font-size: 0.8rem; color: #666; margin: 0.5rem 0 0">
                    {svc.description}
                  </p>

                  {/* Show masked credentials if connected */}
                  <Show when={connected() && !isEditing()}>
                    <div style="margin-top: 0.5rem; font-size: 0.8rem">
                      <For each={svc.credentialFields}>
                        {(f) => {
                          const val = () => (existing()?.credentials as any)?.[f.key];
                          return (
                            <Show when={val()}>
                              <div style="padding: 0.15rem 0; color: #555">
                                {f.label}: <span class="mono">{val()}</span>
                              </div>
                            </Show>
                          );
                        }}
                      </For>
                      <div style="margin-top: 0.5rem; display: flex; gap: 0.25rem">
                        <button
                          class="btn btn-sm"
                          onClick={() => setEditing(svc.type)}
                        >
                          Update
                        </button>
                        <button
                          class="btn btn-sm"
                          onClick={() => handleToggle(existing()!.id, existing()!.enabled)}
                        >
                          {existing()!.enabled ? "Disable" : "Enable"}
                        </button>
                        <button
                          class="btn btn-sm btn-danger"
                          onClick={() => handleDelete(existing()!.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </Show>

                  {/* Telegram channels sublist */}
                  <Show when={svc.type === "telegram_bot" && connected()}>
                    <div style="margin-top: 0.5rem; font-size: 0.8rem">
                      <For each={getTelegramChannels()}>
                        {(ch: any) => (
                          <div style="padding: 0.25rem 0; color: #555">
                            {ch.slug} — <span class="mono">{ch.config?.chat_id ?? "no chat ID"}</span>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>

                  {/* Connect / Edit form */}
                  <Show when={isEditing() || !connected()}>
                    <form
                      style="margin-top: 0.5rem; display: flex; flex-direction: column; gap: 0.35rem"
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleSave(svc, e.currentTarget);
                      }}
                    >
                      <input
                        name="label"
                        placeholder="Label (optional)"
                        value={existing()?.label ?? ""}
                        class="input input-sm"
                      />
                      <For each={svc.credentialFields}>
                        {(f) => (
                          <input
                            name={f.key}
                            placeholder={f.label}
                            type={f.secret ? "password" : "text"}
                            class="input input-sm"
                          />
                        )}
                      </For>
                      <div style="display: flex; gap: 0.25rem">
                        <button
                          class="btn btn-sm btn-primary"
                          type="submit"
                          disabled={saving()}
                        >
                          {saving() ? "Saving..." : connected() ? "Update" : "Connect"}
                        </button>
                        <Show when={isEditing()}>
                          <button
                            class="btn btn-sm"
                            type="button"
                            onClick={() => setEditing(null)}
                          >
                            Cancel
                          </button>
                        </Show>
                      </div>
                    </form>
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </>
  );
}
