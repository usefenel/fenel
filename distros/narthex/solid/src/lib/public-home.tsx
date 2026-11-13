import { Show, createMemo } from "solid-js";
import HomePage from "~/routes/app/home";
import { AuthoringSessionContext, reactiveAuthoringSession } from "./expression-runner/authoring-session";
import { FieldPresentationRegistryProvider } from "./field-renderer/field-presentation-context";
import { preparePublicLocusData } from "./public-locus-data";

/** The repository is an anonymous reader's data source, never an account. */
export default function PublicHome() {
  const data = createMemo(() => preparePublicLocusData());
  const session = reactiveAuthoringSession(() => data().session);
  return <Show when={data()}><AuthoringSessionContext value={session}>
    <FieldPresentationRegistryProvider registry={data().registry}>
      <HomePage publicData={data()} />
    </FieldPresentationRegistryProvider>
  </AuthoringSessionContext></Show>;
}
