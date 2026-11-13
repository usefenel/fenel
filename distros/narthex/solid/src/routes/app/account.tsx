import { Show, createSignal, createMemo, refresh } from "solid-js";
import { revalidate } from "@solidjs/router";
import { getAccount, api } from "~/lib/api";
import { AdminForm, registerTemplate } from "~/lib/admin-form";
import { LoadingScreen } from "~/lib/loading-screen";
import { accountForm, accountFormLayout } from "@fenel/engine/admin-forms";

registerTemplate(accountFormLayout);

export default function AccountPage() {
  const data = createMemo(() => getAccount());
  const [editing, setEditing] = createSignal(false);

  async function handleSave(formData: Record<string, unknown>) {
    await api.accountUpdate({
      name: formData.name as string,
      slug: formData.slug as string,
    });
    revalidate("account");
    await refresh(data);
    setEditing(false);
  }

  return (
    <>
      <h1 class="page-title">Account</h1>
      <Show when={data()} fallback={<LoadingScreen />}>
        {(d) => (
          <div class="card" style="max-width: 500px">
            <Show
              when={editing()}
              fallback={
                <>
                  <div class="form-row">
                    <label class="form-label">Display Name</label>
                    <p style="margin: 0; font-size: 0.9rem">{d().account.name}</p>
                  </div>
                  <div class="form-row">
                    <label class="form-label">Handle</label>
                    <p class="mono" style="margin: 0; font-size: 0.9rem">@{d().account.slug}</p>
                  </div>
                  <div class="form-row">
                    <label class="form-label">Account ID</label>
                    <p class="mono text-muted" style="margin: 0; font-size: 0.8rem">{d().account.id}</p>
                  </div>
                  <div class="form-row">
                    <label class="form-label">Created</label>
                    <p class="text-muted" style="margin: 0; font-size: 0.9rem">
                      {new Date(d().account.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <button class="btn btn-primary" onClick={() => setEditing(true)} style="margin-top: 0.5rem">
                    Edit
                  </button>
                </>
              }
            >
              <AdminForm
                definition={accountForm}
                initialValues={{ name: d().account.name, slug: d().account.slug }}
                onSubmit={handleSave}
                onCancel={() => setEditing(false)}
              />
            </Show>
          </div>
        )}
      </Show>
    </>
  );
}
