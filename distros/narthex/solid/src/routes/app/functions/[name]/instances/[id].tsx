// ---------------------------------------------------------------------------
// /app/functions/:name/instances/:id — drill-in for one running
// instance. Same InstanceDetail component the inline expand uses.
// ---------------------------------------------------------------------------

import { Show, Loading, createMemo } from "solid-js";
import { useParams, useSearchParams } from "@solidjs/router";
import { getFunctionByName } from "~/lib/api";
import { InstanceDetail } from "~/lib/instance-detail";

export default function InstanceDetailPage() {
  const params = useParams();
  const [search] = useSearchParams();
  const typeFilter = () => {
    const v = search.type;
    return Array.isArray(v) ? v[0] : v;
  };
  const fnRow = createMemo(async () => {
    try { return (await getFunctionByName(params.name!)).definition; }
    catch { return null; }
  });

  return (
    <div style="padding: 1rem">
      <a href={`/app/functions/${params.name}`} class="text-muted" style="font-size: 0.8rem; text-decoration: none">
        ← {params.name}
      </a>
      <h1 class="page-title" style="margin: 0.5rem 0 0.25rem; font-size: 1.1rem">
        Instance <span class="mono" style="font-size: 0.85rem; color: #64748b">{params.id?.slice(0, 8)}…</span>
      </h1>
      <p class="text-muted" style="font-size: 0.78rem; margin-bottom: 1rem">
        Live state of one invocation. Switch tabs to see the timeline, runtime variables, or current step.
      </p>

      <Show when={fnRow()} fallback={<p class="text-muted">Loading function spec…</p>}>
        {(row) => (
          <InstanceDetail
            fnId={(row() as any).id}
            fnName={(row() as any).name}
            instanceId={params.id!}
            typeFilter={typeFilter()}
          />
        )}
      </Show>
    </div>
  );
}
