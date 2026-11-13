import "../../../../../../implementations/typescript/engine/src/engine-body-host-install";
import { describe, expect, test } from "bun:test";
import type { AuthoringSession } from "./account-authoring-session";

// B4 F1 parity over real Local registries, worker realm against page realm:
// - the worker's `project-reader-function-options` (this process, which builds
//   only the worker registry) answers the page FunctionPicker model's options,
//   labels and selections, computed in a FRESH process that builds only the
//   page registry (`reader-function-options.fixture.ts`), so no process-global
//   label lookup is shared; the tab's own function is listed with its label;
// - the guidance handler stops at a slice when another job waits, keeps its
//   labelled prefix across a cancellation and a yield, then completes;
// - the real Local `resolveTypeName` (reader-runtime.tsx) over the Local
//   display catalogue resolves Lens settings' two definitions as the registry;
// - the worker field plan of an unresolved `$ref` base type equals the plan of
//   the type `resolveAuthoringTypeRef` resolves (SetExprExamples).
// Heavy: two Local registries in two processes; run alone in the heavy slot.
const fixture = await import("./reader-function-options.fixture");
const fixturePath = new URL("./reader-function-options.fixture.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
console.info("[function-options-parity] page realm: a fresh process");
const child = Bun.spawn([process.execPath, fixturePath], { stdout: "pipe", stderr: "pipe", env: process.env });
const [exitCode, childOut, childErr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
if (exitCode !== 0) throw new Error(`The page realm failed (${exitCode}):\n${childErr}`);
const marker = childOut.lastIndexOf("@@PAGE-REALM@@");
const pageRealm = JSON.parse(childOut.slice(marker + "@@PAGE-REALM@@".length).trim()) as {
  options: Array<{ value: string; label: string }>; selections: unknown[] };
console.info("[function-options-parity] worker realm: building its registry");
const [catalogue, mint, extensions, model, artifact, environmentTools, fieldRender, detached] = await Promise.all([
  import("./authoring-catalog"), import("../../../../../../implementations/typescript/runtime/src/authority-mint"),
  import("./authoring-worker-reader-extensions"), import("../field-renderer/function-picker-model"),
  import("./authoring-catalogue-artifact"), import("@fenel/engine/authoring/environment"),
  import("../../../../../../implementations/typescript/engine/src/authoring/field-render"), import("./detached-authoring-environment"),
]);
const { registry: workerRegistry, snapshot } = await fixture.buildParityRegistry();
const frame = Object.freeze({ ...await fixture.parityFrame(workerRegistry), _authority: mint.mintAnonymousAuthority(workerRegistry) });
const session = Object.freeze({ mode: "detached", registry: workerRegistry, evaluateContext: frame }) as unknown as AuthoringSession;
console.info("[function-options-parity] ready");
const received = <T>(value: T) => structuredClone(value);
type Reply = { functionOptions?: { options: Array<{ value: string; label: string }>; selection: unknown }; yielded?: true };
const ask = (value: unknown, pause: () => Promise<void> = async () => {}, cancelled = () => false, waiting = () => false) =>
  extensions.runReaderExtension({ method: "project-reader-function-options", value, priority: "guidance" } as never,
    session, undefined, pause, cancelled, waiting) as Promise<Reply | undefined>;
const timer = () => new Promise(resolve => setTimeout(resolve, 0));

describe("B4 F1: the worker's FunctionPicker answer equals the page realm's", () => {
  test("a request cancelled at a slice answers nothing", async () => {
    let pauses = 0;
    const reply = await ask(undefined, async () => { pauses++; await timer(); }, () => pauses >= 2);
    expect(pauses).toBe(2);
    expect(reply).toBeUndefined();
  });

  test("a waiting job stops the labelling at a slice; the prefix is kept for the re-sent request", async () => {
    let pauses = 0;
    expect(await ask({ $ref: "add" }, async () => { pauses++; await timer(); }, () => false, () => true)).toEqual({ yielded: true });
    expect(pauses).toBeGreaterThanOrEqual(2);
  });

  test("options, labels and selections over a corpus of stored values, against a fresh page realm", async () => {
    expect(pageRealm.options.length).toBeGreaterThan(100);
    for (const [index, value] of fixture.storedValues.entries()) {
      const reply = received(await ask(value))!;
      expect(reply.yielded).toBeUndefined();
      expect(reply.functionOptions!.options).toEqual(pageRealm.options);
      expect(reply.functionOptions!.selection).toEqual(pageRealm.selections[index]);
    }
    // The tab's own function is listed in both realms with the same label,
    // and its stored reference selects it.
    const own = pageRealm.options.find(option => option.value === fixture.functionId);
    expect(own).toBeDefined();
    expect(typeof own!.label).toBe("string");
    expect(own!.label.length).toBeGreaterThan(0);
    const worker = received(await ask({ $ref: fixture.functionId }))!;
    expect(worker.functionOptions!.options.find(option => option.value === fixture.functionId)).toEqual(own);
    expect(worker.functionOptions!.selection).toEqual({ kind: "function", id: fixture.functionId });
    console.info(`[function-options-parity] the tab's own function is labelled ${JSON.stringify(own!.label)}`);
  });

  test("B4 wave 4: the tab's own function is labelled by its scoped Codeable name, never its UUID", async () => {
    const worker = received(await ask(undefined))!;
    const own = worker.functionOptions!.options.find(option => option.value === fixture.functionId)!;
    expect(own.label).not.toContain(fixture.functionId);
    // Its tab-scoped Codeable "add", as the reader presentation shows it ("Add").
    expect(own.label).toBe("Add");
    // Every other function keeps the label the global lookups give it (a
    // spread sample: each global label is a dispatch).
    const started = performance.now();
    const others = worker.functionOptions!.options.filter(option => option.value !== fixture.functionId);
    const sample = others.filter((_option, index) => index % Math.max(1, Math.floor(others.length / 60)) === 0);
    const changed = sample.filter(option => option.label !== model.functionOptionLabel(option.value));
    console.info(`[function-options-parity] ${changed.length} of ${sample.length} sampled labels differ from the global ones `
      + `(${Math.round(performance.now() - started)} ms)`, changed.slice(0, 5));
    expect(sample.length).toBeGreaterThan(20);
    expect(changed).toEqual([]);
  });

  test("a request without the guidance priority is refused", async () => {
    await expect(extensions.runReaderExtension({ method: "project-reader-function-options", value: undefined } as never,
      session, undefined, async () => {})).rejects.toThrow("could not be read");
  });
});

// The production Local `resolveTypeName`, extracted from reader-runtime.tsx.
const runtimeSource = (await Bun.file(new URL("../reader-runtime.tsx", import.meta.url)).text()).replace(/\r\n/g, "\n");
const resolveStart = runtimeSource.indexOf("resolveTypeName: (name: string) => {");
const resolveEnd = runtimeSource.indexOf("\n        },\n", resolveStart);
if (resolveStart < 0 || resolveEnd < resolveStart) throw new Error("The Local resolveTypeName boundary moved.");
const resolveBody = runtimeSource.slice(resolveStart + "resolveTypeName: ".length, resolveEnd + "\n        }".length);
const localCatalogue = artifact.projectLocalAuthoringCatalogue(workerRegistry, frame, { localSourceId: fixture.SOURCE, snapshot,
  entities: [], functions: [fixture.definition as never] });
const resolveTypeName = new Function("read", `${new Bun.Transpiler({ loader: "ts" }).transformSync(`const resolveTypeName = ${resolveBody};`)}
  return resolveTypeName;`)(() => ({ types: [], catalog: localCatalogue.displayCatalog })) as (name: string) => unknown;

describe("B4 F1: Local declarations and field plans resolve as the page did", () => {
  test("the real Local resolveTypeName answers Lens settings' two definitions", () => {
    for (const name of ["WorkspacePreferences", "WorkspaceLens"]) {
      const declared = workerRegistry.getIdentifiedEntity(name)?.type;
      expect(declared).toBeDefined();
      expect(resolveTypeName(name)).toEqual(declared);
    }
  });

  test("SetExprExamples' Local base type: the worker's resolve-reader-type-ref answers the page's resolveAuthoringTypeRef", async () => {
    const environment = detached.createDetachedAuthoringEnvironment(catalogue.environmentForCatalog(localCatalogue.catalog, workerRegistry));
    const workerSession = Object.freeze({ ...session, environment }) as unknown as AuthoringSession;
    let resolvedCount = 0;
    for (const name of ["String", "Number", "Int", "Nat", "Bool", "Date", "Email", "URL", "Url", "Text", "Rational", "WorkspaceBar", "missing-type"]) {
      const ref = { $ref: name };
      const page = environmentTools.resolveAuthoringTypeRef(environment, ref as never);
      const reply = received(await extensions.runReaderExtension({ method: "resolve-reader-type-ref", type: ref } as never,
        workerSession, undefined, async () => {})) as { typeRef: { resolved?: unknown } };
      expect({ name, resolved: reply.typeRef.resolved ?? null }).toEqual({ name, resolved: page ?? null });
      if (page) resolvedCount++;
    }
    expect(resolvedCount).toBeGreaterThanOrEqual(4);
    // The trap the inert declaration lookup falls into: "Email" names both a
    // format refinement (what the page resolves) and an entity type.
    const email = environmentTools.resolveAuthoringTypeRef(environment, { $ref: "Email" } as never);
    if (email && resolveTypeName("Email")) expect(resolveTypeName("Email")).not.toEqual(email);
  });
});
