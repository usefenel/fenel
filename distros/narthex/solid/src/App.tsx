import { pageRoutes } from "virtual:file-routes";
import { Title } from "@solidjs/meta";
import { createRouter } from "@solidjs/router";
import { fileRoutes } from "@solidjs/router/fs";
import { Errored, Loading } from "solid-js";
import { LoadingScreen } from "~/lib/loading-screen";
import { LocusBackground } from "~/lib/locus-background";
import "./global.css";

// Solid Router 2 takes one module-level router instance instead of the old
// <Router><Route/></Router> JSX tree. `fileRoutes` adapts the nested manifest
// that filesystem-routing publishes as `virtual:file-routes`, which is the
// replacement for SolidStart's <FileRoutes />.
export const Router = createRouter({
  // The addressed-data catch-all also owns `/`. One route key keeps the
  // mounted lenses and tab data through root ↔ member navigation.
  routes: fileRoutes(pageRoutes).filter(route => route.path !== "/"),
});

export const { paths } = Router;

function routeErrorMessage(error: unknown): string {
  if ((globalThis as { __fenelAuthoringTimings?: boolean }).__fenelAuthoringTimings) {
    console.error(error instanceof Error ? error.stack : error);
  }
  return error instanceof Error ? error.message : String(error);
}

export default function App() {
  return (
    <Router>
      {(props) => (
        <>
          <Title>Fenel</Title>
          {/* Solid 2: Errored replaces ErrorBoundary and its fallback receives
              an error ACCESSOR rather than the raw error value. */}
          <Errored
            fallback={(err) => (
              <>
                <LocusBackground pixelated />
                <LoadingScreen inline page errorCard
                  title="Could not load this page"
                  detail="Try again, or return to Home."
                  error={routeErrorMessage(err())}
                  actions={
                    <>
                      {/* A failed route import can remain cached for this document. */}
                      <button type="button" onClick={() => window.location.reload()}>
                        Try again
                      </button>
                      {/* A full page load: the boundary would keep showing this
                          page across an in-app navigation. */}
                      <a href="/" rel="external">Go to Home</a>
                    </>
                  }
                />
              </>
            )}
          >
            {/* Solid 2: Loading replaces Suspense for initial not-ready UI. */}
            <LocusBackground />
            <Loading fallback={<LoadingScreen inline page reserveTopbar />}>{props.children}</Loading>
          </Errored>
        </>
      )}
    </Router>
  );
}
