// Parses the build-owned repository catalogue for early function choices, so
// its chunk parse and decode never run on the page's main thread.
import { readRepositoryCatalogueCollection, repositoryFunctionChoices } from "./authoring-catalogue-transport";

const scope = globalThis as unknown as { onmessage: (event: { data: { method: string } }) => void; postMessage: (value: unknown) => void };
scope.onmessage = event => {
  if (event.data.method !== "function-choices") return;
  void readRepositoryCatalogueCollection(["catalog", "functions"]).then(
    entries => scope.postMessage({ choices: entries && repositoryFunctionChoices(entries) }),
    error => scope.postMessage({ error: error instanceof Error ? error.message : String(error) }));
};
