import { createSignal } from "solid-js";

export type IOCallState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "success"; value: unknown }
  | { kind: "error"; message: string; value?: unknown }
  | { kind: "suspended"; instanceId: string; status: string; suspensionId?: string | null };

type Response = { ok: boolean; value?: unknown; error?: string; stopped?: boolean;
  suspended?: boolean; instanceId?: string; status?: string; suspensionId?: string | null };

/** Shared browser controller for IO call cards and their deployment handles. */
export function createIOCallController<A>(options: {
  info: () => { fnId: string; args: A[]; stopAction?: unknown } | null;
  /** B4 wave 4 lane H: a Local reader's arguments are evaluated in its worker (a promise). */
  evaluate: (arg: A) => unknown | Promise<unknown>;
  invoke: (fnId: string, args: unknown[], mode: "run" | "stop") => Promise<Response>;
}) {
  const [state, setState] = createSignal<IOCallState>({ kind: "idle" });
  const [handle, setHandle] = createSignal<{ fnId: string; value: unknown }>();
  const [invokedFnId, setInvokedFnId] = createSignal<string>();
  const currentHandle = () => {
    const info = options.info();
    const previous = state();
    return info && previous.kind === "success" && invokedFnId() === info.fnId
      ? { fnId: info.fnId, value: previous.value }
      : handle()?.fnId === info?.fnId ? handle() : undefined;
  };
  const canStop = () => !!options.info()?.stopAction && state().kind !== "running"
    && state().kind !== "suspended"
    && currentHandle() !== undefined;

  async function dispatch(mode: "run" | "stop") {
    const info = options.info();
    if (!info || state().kind === "running" || state().kind === "suspended") return;
    const previousHandle = currentHandle();
    if (mode === "stop" && (!info.stopAction || !previousHandle)) return;
    if (previousHandle) setHandle(previousHandle);
    setInvokedFnId(info.fnId);
    setState({ kind: "running" });
    try {
      const args = mode === "stop" ? [previousHandle!.value] : await Promise.all(info.args.map(options.evaluate));
      const response = await options.invoke(info.fnId, args, mode);
      if (!response.ok) throw new Error(response.error ?? "Unknown error");
      if (response.suspended && response.instanceId) {
        setState({ kind: "suspended", instanceId: response.instanceId,
          status: response.status ?? "awaiting_choice", suspensionId: response.suspensionId ?? null });
      } else if (mode === "stop") {
        if (response.stopped !== true) {
          setState({ kind: "error", message: response.error ?? "Stop did not confirm successful completion.", value: response.value });
          return;
        }
        setHandle(undefined);
        setState({ kind: "idle" });
      } else {
        setHandle({ fnId: info.fnId, value: response.value });
        setState({ kind: "success", value: response.value });
      }
    } catch (error) {
      setState({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { state, setState, dispatch, canStop };
}
