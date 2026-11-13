// B4 wave 4 lane S (Central reader worker transport, host plumbing): the
// identity set of Local registry tokens (`createLocalRegistryToken` in
// `expression-runner/authoring-catalog-worker.ts`). Light on purpose, so a
// renderer can recognise a token without loading the worker client: a token
// has no members to read; a page-side plan over one refuses with this copy.
const tokens = new WeakSet<object>();

export const LOCAL_REGISTRY_TOOLS_PENDING = "This reader's editing tools are not ready. Prepare them and try again.";

export function markLocalRegistryToken(token: object): void { tokens.add(token); }

/** Whether `registry` is a Local reader's registry token (no page registry). */
export function isLocalRegistryToken(registry: unknown): boolean {
  return typeof registry === "object" && registry !== null && tokens.has(registry);
}
