export type PreloadStage = {
  readonly name: string;
  readonly load: () => Promise<unknown>;
};

// Scheduling hints only. The real engine barrel and module manifest still own
// completeness; adding a module does not require adding a preload entry here.
// The loader/parser/type-foundation cycle is one inseparable ESM component,
// while std, engine, reference data and the system registry are separate roots.
// Loading those roots together through the barrel makes their initialization
// one long task even though the import API returns a Promise.
const stages: readonly PreloadStage[] = [
  { name: "expressions", load: () => import("@fenel/engine/expressions") },
  { name: "type-foundation", load: () => import("@fenel/engine/type-foundation") },
  { name: "std", load: () => import("@fenel/engine/modules/std") },
  { name: "engine", load: () => import("@fenel/engine/modules/engine") },
  { name: "runtime", load: () => import("@fenel/engine/modules/runtime") },
  { name: "builtin-classes", load: () => import("@fenel/engine/builtin-classes") },
  { name: "compile-js", load: () => import("@fenel/engine/modules/compile-js") },
  { name: "system-entities", load: () => import("@fenel/engine/system-entities") },
  { name: "registry", load: () => import("@fenel/engine/registry") },
  { name: "evaluation runtime", load: async () => {
    const { prepareEngineBodyDispatch } = await import("@fenel/engine/engine-bodies-dispatch");
    await prepareEngineBodyDispatch();
  } },
];

/** How long one editor code chunk may take to download and evaluate. The dev
 * server transforms on demand, so a cold slice can take a minute or more; the
 * bound only catches a stalled or vanished server. */
export const WORKSPACE_IMPORT_LIMIT_MS = 240_000;

/** A bounded code acquisition or checked preparation has not finished.
 * Neither deadline cancels the underlying work; Retry can await it again. */
export class WorkspaceLoadTimeoutError extends Error {
  constructor(readonly stage: string, limitMs: number,
    readonly kind: "import" | "preparation" = "import") {
    const seconds = Math.round(limitMs / 1000);
    const limit = seconds < 120 ? `${seconds} seconds` : `${Math.round(seconds / 60)} minutes`;
    super(kind === "preparation"
      ? `The editing tools (${stage}) are still preparing after ${limit}. Retry to resume waiting.`
      : `The editing tools (${stage}) did not finish loading within ${limit}. `
        + "Check that the app server is running, then retry.");
    this.name = "WorkspaceLoadTimeoutError";
  }
}

/** Await `load()`, but stop waiting after `limitMs`. */
export function withinWorkspaceLimit<T>(stage: string, load: () => Promise<T>,
  limitMs: number = WORKSPACE_IMPORT_LIMIT_MS,
  kind: "import" | "preparation" = "import"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new WorkspaceLoadTimeoutError(stage, limitMs, kind)), limitMs);
    Promise.resolve().then(load).then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export function yieldToBrowser(): Promise<void> {
  const scheduler = (globalThis as {
    scheduler?: { yield?: () => Promise<void> };
  }).scheduler;
  return scheduler?.yield ? scheduler.yield() : new Promise(resolve => setTimeout(resolve, 0));
}

export async function preloadWorkspaceSlice<T>(name: string, load: () => Promise<T>,
  limitMs: number = WORKSPACE_IMPORT_LIMIT_MS): Promise<T> {
  await yieldToBrowser();
  const timed = (globalThis as { __fenelAuthoringTimings?: boolean }).__fenelAuthoringTimings === true;
  const start = timed ? performance.now() : undefined;
  try { return await withinWorkspaceLimit(name, load, limitMs); }
  finally {
    if (start !== undefined) performance.measure(`fenel:preload:${name}`, { start, end: performance.now() });
  }
}

/** Prepare hot dependency roots without an engine TLA or a second module
 * roster. Each import still executes its actual module and propagates errors.
 * ESM itself caches completed/in-flight imports. A stale caller stops scheduling
 * more work; it never publishes account state from this helper.
 *
 * Diagnostic measures include acquisition plus evaluation elapsed time. Pair
 * them with browser long-task observations when judging main-thread blocking.
 * Each stage is bounded by `limitMs` and rejects with `WorkspaceLoadTimeoutError`.
 */
export async function preloadWorkspaceModules(isCurrent: () => boolean = () => true,
  limitMs: number = WORKSPACE_IMPORT_LIMIT_MS, roster: readonly PreloadStage[] = stages): Promise<void> {
  for (const stage of roster) {
    if (!isCurrent()) return;
    await yieldToBrowser();
    if (!isCurrent()) return;
    const timed = (globalThis as { __fenelAuthoringTimings?: boolean }).__fenelAuthoringTimings === true;
    const start = timed ? performance.now() : undefined;
    try {
      await withinWorkspaceLimit(stage.name, stage.load, limitMs);
    } finally {
      if (start !== undefined) {
        performance.measure(`fenel:preload:${stage.name}`, { start, end: performance.now() });
      }
    }
  }
  // The caller may immediately import the barrel/Home graph after this returns.
  // Leave an input opportunity between it and the final narrow module's work.
  if (isCurrent()) await yieldToBrowser();
}
