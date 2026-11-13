// ---------------------------------------------------------------------------
// PageUrlCell — registered as the readComponent for the "page-url" TypeView,
// referenced by pageTableView's URL column.
//
// Shows /p/<account_slug>/<page_slug> as a clickable mono link. Looks up
// the account slug via getAccount; falls back to /<page_slug> while loading
// or on error.
// ---------------------------------------------------------------------------

import { Show, createMemo } from "solid-js";

import { getAccount } from "~/lib/api";
import type { TemplateComponentProps } from "~/lib/layout-renderer";

export function PageUrlCell(props: TemplateComponentProps) {
  // `.catch(() => null)` keeps the createMemo resolved-with-null when the
  // account endpoint rejects (e.g. unauthenticated or the showcase mounts
  // this in a non-account context). An uncaught rejection leaves Suspense
  // latched on its fallback because there's no per-cell ErrorBoundary to
  // claim it — the whole route then stays in its loading state.
  const account = createMemo(() => getAccount().catch(() => null));
  const accountSlug = () => (account() as any)?.account?.slug as string | undefined;
  const pageSlug = () => {
    const ctx = props.context as Record<string, unknown> | undefined;
    return (ctx?.slug as string | undefined) ?? String(props.value ?? "");
  };
  const url = () => {
    const a = accountSlug();
    const p = pageSlug();
    if (!a || !p) return null;
    return `/p/${a}/${p}`;
  };

  return (
    <Show
      when={url()}
      fallback={<span class="mono text-muted">/{pageSlug()}</span>}
    >
      <a
        href={url()!}
        target="_blank"
        rel="noopener"
        class="link mono"
        style="font-size: 0.8rem"
        onClick={(e) => e.stopPropagation()}
      >
        {url()}
      </a>
    </Show>
  );
}
