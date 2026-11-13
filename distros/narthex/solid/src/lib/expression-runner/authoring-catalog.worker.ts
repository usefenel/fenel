// S1b worker entry (design/tcb-ledger.md row engine.memo.engine-body-replay).
// The FIRST import installs exact Proxy tracking for this realm; the import is
// relative so Vite dev never pre-bundles it together with the engine. The real
// worker (authoring-catalog-worker-main.ts) is loaded by DYNAMIC import, so no
// chunk of its graph can be hoisted above the install. Add no static import
// here: the production build refuses an entry chunk whose static closure holds
// any other module (engine-body-replay-plugin.mjs).
import "../../../../../../implementations/typescript/engine/src/proxy-tracking-install";

// Messages the host posts while the real worker loads would reach a global
// without a handler and be lost: hold them, then hand them over in order.
type Early = { readonly data: unknown };
const early: Early[] = [];
const hold = (event: Early): void => { early.push(event); };
globalThis.addEventListener("message", hold as unknown as EventListener);
const realWorker = import("./authoring-catalog-worker-main");
// The replay artifact (production or an admitted dev binding) downloads while the real worker
// loads and is installed before the first request runs; it never rejects, and
// any failure only leaves it off.
const replay = import("./engine-body-replay-boot").then(boot => boot.bootEngineBodyReplay(realWorker), () => undefined);
await realWorker;
// The real worker installed its handler; park it until the boot settles (no
// message task can run between its evaluation and this continuation).
const receiver = globalThis as unknown as { onmessage: ((event: Early) => void) | null };
const deliver = receiver.onmessage;
receiver.onmessage = null;
await replay;
globalThis.removeEventListener("message", hold as unknown as EventListener);
receiver.onmessage = deliver;
for (const event of early.splice(0)) deliver?.(event);

export {};
