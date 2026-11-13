// Asks the existing authoring worker to run `recipeCard`, then draws the
// list with RecipeFactsList. The fact order and the projections that drop
// the analysis snapshot live in fenel/modules/publicdemo/recipe-criteria.fenel.
// Solid/browser renderer allowance — same kind as the other card surfaces.
// The symbolic check must not run on the UI thread.

import { Show, createEffect, createSignal, untrack } from "solid-js";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import { authoringSessionAccountScope, type AuthoringSession } from "./expression-runner/authoring-session";
import { authoringWorkerSnapshot, evaluateExpressionInWorker } from "./expression-runner/authoring-catalog-worker";
import { sessionEpoch } from "./browser-session";
import { RecipeFactsList } from "./recipe-facts-view";
import { useReaderRuntime, type ReaderRuntime } from "./reader-runtime";

type FactsState =
  | { phase: "idle" }
  | { phase: "preparing" }
  | { phase: "checking" }
  | { phase: "ready"; value: unknown }
  | { phase: "unavailable"; message: string };

let recipeFactQueue: Promise<void> = Promise.resolve();

function enqueueRecipeFacts<T>(job: () => Promise<T>): Promise<T> {
  const run = recipeFactQueue.then(job, job);
  recipeFactQueue = run.then(() => undefined, () => undefined);
  return run;
}

function own(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function leaksAnalysis(value: unknown, depth = 0): boolean {
  if (depth > 8 || !value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => leaksAnalysis(item, depth + 1));
  for (const key of Object.keys(value)) {
    if (key === "context" || key === "snapshot" || key === "analysis") return true;
    if (leaksAnalysis(own(value, key), depth + 1)) return true;
  }
  return false;
}

function factsAreShowable(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false;
  try {
    const text = JSON.stringify(value);
    return typeof text === "string" && text.length > 0 && text.length < 200_000 && !leaksAnalysis(value);
  } catch {
    return false;
  }
}

/** The public pin card keeps its meaning: facts over every pantry. */
const EVERY_PANTRY: ExprNode = { kind: "literal", value: { $tag: "AllPantries" } };

/** B3: a Local reader names both functions through its worker references. */
function localRecipeCardNode(reader: ReaderRuntime, pinId: string): ExprNode | undefined {
  const handle = reader.referenceHandle?.("RecipeFunctions.recipeCard");
  const pinHandle = reader.referenceHandle?.(pinId);
  if (!handle || !pinHandle) return undefined;
  return { kind: "call", fnId: handle, args: [{ kind: "literal", value: { $ref: pinHandle } }, EVERY_PANTRY] };
}

function recipeCardNode(session: AuthoringSession, pinId: string): ExprNode | undefined {
  const registry = session.registry;
  const declaration = registry.getIdentifiedFunction("RecipeFunctions.recipeCard");
  const handle = declaration && registry.getUuid(declaration.id);
  if (!declaration || !handle || registry.getFunction(handle)?.id !== declaration.id) return undefined;
  const pin = registry.getFunction(pinId);
  const pinHandle = pin && registry.getUuid(pin.id);
  if (!pin || !pinHandle || registry.getFunction(pinHandle)?.id !== pin.id) return undefined;
  return { kind: "call", fnId: handle, args: [{ kind: "literal", value: { $ref: pinHandle } }, EVERY_PANTRY] };
}

function shortMessage(error: unknown): string {
  const message = error instanceof Error && error.message ? error.message : "These facts could not be checked.";
  return message.length > 240 ? message.slice(0, 240) : message;
}

/** Derived facts for one recipe pin. `preset` draws an already-checked list
 * and does not start the analyzer. Live pins share one queue. */
export function RecipeFactsCard(props: {
  pinId?: string;
  session?: () => AuthoringSession;
  preset?: unknown;
}) {
  const [state, setState] = createSignal<FactsState>({ phase: "idle" });
  const reader = useReaderRuntime();
  createEffect(() => {
    if (props.preset !== undefined) return { mode: "preset" as const };
    const pinId = props.pinId ?? "";
    // The session accessor also reads the account function list. Tracking that
    // would restart a long check whenever the list changes. The worker revision
    // and the browser session stay tracked so a reader that was still starting
    // can begin once it is ready.
    const session = untrack(() => props.session?.());
    const worker = session ? authoringWorkerSnapshot(session) : undefined;
    // B3: a Local reader's handles come from its worker (tracked while pending).
    const localNode = reader?.kind === "local" && pinId ? localRecipeCardNode(reader, pinId) : undefined;
    const localPending = reader?.kind === "local" && !!pinId && !localNode
      && (!!reader.referencePending?.("RecipeFunctions.recipeCard") || !!reader.referencePending?.(pinId));
    return { mode: "live" as const, pinId, epoch: sessionEpoch(), worker: worker !== undefined && !localPending, ready: !!session,
      localNode };
  }, (key) => {
    if (key.mode === "preset") return;
    if (!key.ready || !key.pinId) {
      setState({ phase: "unavailable", message: "These facts are not available in this reader yet." });
      return;
    }
    if (!key.worker) {
      setState({ phase: "preparing" });
      return;
    }
    const session = props.session?.();
    if (!session) {
      setState({ phase: "unavailable", message: "These facts are not available in this reader yet." });
      return;
    }
    const node = reader?.kind === "local" ? key.localNode : recipeCardNode(session, key.pinId);
    if (!node) {
      setState({ phase: "unavailable", message: "These facts are not available in this reader yet." });
      return;
    }
    setState({ phase: "checking" });
    const controller = new AbortController();
    let cancelled = false;
    const job = enqueueRecipeFacts(async () => {
      const current = props.session?.();
      if (!current) throw new Error("These facts are not available in this reader yet.");
      const evaluation = evaluateExpressionInWorker(current, node, new Map(), controller.signal,
        authoringSessionAccountScope(current), { admitInvocations: true });
      if (!evaluation) throw new Error("The reader is still preparing these facts.");
      return evaluation;
    });
    void job.then((evaluation) => {
      if (cancelled) return;
      const value = evaluation.result;
      if (!factsAreShowable(value)) {
        setState({ phase: "unavailable", message: "These facts could not be shown." });
        return;
      }
      setState({ phase: "ready", value });
    }, (error: unknown) => {
      if (cancelled || controller.signal.aborted) return;
      setState({ phase: "unavailable", message: shortMessage(error) });
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  });

  const statusMessage = (): string | undefined => {
    if (props.preset !== undefined) return undefined;
    const current = state();
    if (current.phase === "preparing") return "The reader is still preparing these facts.";
    if (current.phase === "checking") return "Checking this recipe. This can take several minutes.";
    if (current.phase === "unavailable") return current.message;
    return undefined;
  };
  const shown = (): unknown[] | undefined => {
    if (props.preset !== undefined) return factsAreShowable(props.preset) ? props.preset : undefined;
    const current = state();
    return current.phase === "ready" && factsAreShowable(current.value) ? current.value : undefined;
  };
  return <section class="recipe-facts" data-recipe-facts="true" aria-label="Derived facts">
    <Show when={statusMessage()}>{(message) => <p class="recipe-facts__status">{message()}</p>}</Show>
    <Show when={shown()}>{(rows) => <RecipeFactsList facts={rows()} session={props.session} />}</Show>
  </section>;
}
