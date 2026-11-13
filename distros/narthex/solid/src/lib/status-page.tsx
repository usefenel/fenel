import type { JSX } from "@solidjs/web";

/** The page shown when there is no page to show: an unknown address or a
 *  route that failed. It uses the same card as the sign-in page, so it looks
 *  like the rest of the app and needs neither the workspace nor a session.
 *  Styles: `.status-page*` in `src/global.css`. */
export function StatusPage(props: {
  title: string;
  children?: JSX.Element;
  actions: JSX.Element;
}) {
  return (
    <main class="public-page-wrap">
      <div class="public-page-card status-page">
        <h1 class="public-page-title">{props.title}</h1>
        {props.children}
        <div class="status-page__actions">{props.actions}</div>
      </div>
    </main>
  );
}
