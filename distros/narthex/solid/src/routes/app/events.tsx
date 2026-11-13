import { For, Show, createMemo } from "solid-js";

import { getEvents } from "~/lib/api";
import { LoadingScreen } from "~/lib/loading-screen";

export default function EventsPage() {
  const data = createMemo(() => getEvents(100));

  return (
    <>
      <h1 class="page-title">Event Log</h1>
      <Show when={data()} fallback={<LoadingScreen />}>
        {(d) => (
          <div class="table-wrap">
            <Show when={d().events.length > 0} fallback={<p class="empty">No events yet</p>}>
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Aggregate</th>
                    <th>Lead</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={d().events}>
                    {(ev: any) => (
                      <tr>
                        <td>
                          <span class="badge badge-blue">{ev.type}</span>
                        </td>
                        <td class="mono text-muted truncate">
                          {ev.aggregateType ? `${ev.aggregateType}:${ev.aggregateId?.slice(0, 8)}` : "—"}
                        </td>
                        <td class="mono text-muted truncate">
                          {ev.profileId?.slice(0, 8) || "—"}
                        </td>
                        <td class="mono text-muted">
                          {new Date(ev.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </Show>
          </div>
        )}
      </Show>
    </>
  );
}
