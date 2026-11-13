import { authoringWorkerHostFixtureBindings } from "./authoring-worker-host.fixture";
import { describe, expect, test } from "bun:test";
import { createAuthoringEnvironment, inferAuthoringExpressionWithLiteralWitnesses, judgeAuthoringSchemeCompatibility } from "@fenel/engine/authoring/environment";
import { inferScopedAuthoringExpression, literalMembershipFor } from "./literal-membership";
import { judgeAuthoringResult } from "./result-judgment";
import { LIVE_INFERENCE_BATCH_LIMIT } from "./live-guidance-limits";
import type { ExpressionInferenceItem } from "./authoring-worker-protocol";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { ModuleRegistry } from "@fenel/engine/registry";
import type { FenelType } from "@fenel/engine/types";
import { Anything, Just, List, Maybe, Nothing } from "@fenel/engine/type-foundation";
import type { FieldDef } from "@fenel/engine/types";
import { draftSaveIssue, draftSaveValidation, functionBodySaveIssue } from "./creation-validation";
import { registryTransportSnapshot } from "../../../../../../implementations/typescript/engine/src/registry-transport";
import { evaluate, evaluateWithTrace, dynamicConstructorTableInForce, readerSourceMetadataEvaluateContext, withEvaluationStepObserver, withInstance, withImports, type EvaluateContext } from "@fenel/engine/expressions";
import { concreteAuthoringSession, createAccountAuthoringSession, createLocalAuthoringSession, localAuthoringScopeForSession, registerAuthoringSessionFacade, type AccountAuthoringScope, type AuthoringSession } from "./account-authoring-session";
import { peelListForAuthoring, resolveValueType } from "@fenel/engine/authoring/type";
import { authoringExpressionAdmissionRequired, authoringExpressionSites, authoringExpressionSourceEntries, evaluateAuthoringExpressionInSession, reachedSavedSources, transferableTrace } from "./expression-evaluation";
import { assertReaderSourceMetadata, captureReaderSourceMetadata, type ReaderSourceMetadata } from "../reader-source-metadata";
import { readerSourceMetadataNative } from "../../../../../../fenel/modules/view/ffi/source-metadata";
import type { AuthoringWorkerLifecycle, AuthoringWorkerMessage, AuthoringWorkerRequest, AuthoringWorkerResponse, AuthoringWorkerResult } from "./authoring-worker-protocol";
import type { DataSuggestionInput } from "../data-suggestions";
import { scopedExpectedType, scopedResultRequirement } from "../data-suggestions";
import { expressionMediaScheduling } from "../saved-expression-identity";
import { mintAnonymousAuthority } from "../../../../../../implementations/typescript/runtime/src/authority-mint";
import { authenticateAuthority } from "@fenel/engine/authority";
import { restoreSavedExpressionDeclaration, restoreSavedExpressionDeclarations, savedExpressionDeclaration, savedExpressionDeclarationEntries } from "../saved-expression-map";

// Run both production message handlers with only browser Worker and registry
// acquisition controlled. Codec, evaluator and account overlays are real.
const clientSource = await Bun.file(new URL("./authoring-catalog-worker.ts", import.meta.url)).text();
const workerSource = await Bun.file(new URL("./authoring-catalog-worker-main.ts", import.meta.url)).text();
const repositoryMemoSource = await Bun.file(new URL("../repository-namespaces.ts", import.meta.url)).text();
const transpiler = new Bun.Transpiler({ loader: "ts" });
const clientCode = transpiler.transformSync(clientSource.replace(/^import[\s\S]*?;\r?\n/gm, "")
  .replace(/^export \{[^}]*\} from [^;]+;\r?\n/gm, ""))
  .replace(/^export /gm, "").replaceAll("import.meta.url", '"https://fixture.test/worker-client.js"');
const workerCode = transpiler.transformSync(workerSource.slice(workerSource.indexOf("const scope =")))
  .replaceAll("import.meta.env.BASE_URL", JSON.stringify("/"));
const repositoryMemoCode = transpiler.transformSync(repositoryMemoSource.slice(repositoryMemoSource.indexOf("let prepared:")))
  .replace(/^export /gm, "");
const literal = (value: unknown): ExprNode => ({ kind: "literal", value });
const call = (fnId: string, ...args: ExprNode[]): ExprNode => ({ kind: "call", fnId, args });
const workerMetadataPacket = (generation: string): ReaderSourceMetadata => ({ $tag: "ReaderSourceMetadata",
  source: { $tag: "ThisTabSource" }, rootId: "worker-source", generation, expressions: [], occurrences: [], callableLabels: [] });
const startedLifecycle = (id: number) => ({ id, event: "started" as const, startedAt: expect.any(Number) });

function mediaSchedulingHarness() {
  const definitions = new Map(["picture:render", "sound:renderSound", "movie:renderMovie"].map(id => [id, { id,
    params: ["field", "width", "height"].map(name => ({ name, type: Anything, label: Nothing, ui: Nothing, meta: {} })), returns: Anything }]));
  const handles = new Map<string, string>([["pictureRender", "picture:render"], ["picture-uuid", "picture:render"],
    ["renderSound", "sound:renderSound"], ["sound-uuid", "sound:renderSound"]]);
  const getFunction = (id: string) => definitions.get(handles.get(id) ?? id);
  const replies: AuthoringWorkerResponse[] = [];
  const lifecycle: AuthoringWorkerLifecycle[] = [];
  const samples: Array<{ kind: string; at: unknown }> = [];
  const events: string[] = [];
  const turns: Array<() => void> = [];
  const metadataReads: Array<{ phase: string; frame: EvaluateContext; packet?: unknown; node?: ExprNode }> = [];
  const observePacket = (phase: string, frame: EvaluateContext, node?: ExprNode) => {
    const value = readerSourceMetadataNative(frame);
    const packet = value.$tag === "Just" ? value._0 : undefined;
    metadataReads.push({ phase, frame, packet, node });
    return packet as ReaderSourceMetadata | undefined;
  };
  const session = { mode: "detached", registry: { getFunction }, catalog: {},
    environment: { functionCodeName: (id: string) => id, constructorCodeName: () => undefined },
    evaluateContext: { getFunction, natives: {
      "fixture:field": () => { events.push("field"); return "field"; },
      "fixture:width": () => { events.push("width"); return 2; },
      "fixture:height": () => { events.push("height"); return 2; },
      "fixture:throw": () => { events.push("throw"); throw new Error("Field refused"); },
    }, nativesCtx: {
      "fixture:packet": (context: EvaluateContext) => observePacket("native-packet", context)?.generation ?? "no packet",
      "picture:render": () => { events.push("render"); return "ordinary render"; },
      "sound:renderSound": () => { events.push("render"); return "ordinary sound"; },
      "picture:sample": (context: EvaluateContext, _picture: unknown, point: unknown) => {
        observePacket("sample-picture", context); samples.push({ kind: "picture", at: point }); return "pixel"; },
      "sound:sampleSound": (context: EvaluateContext, _sound: unknown, point: unknown) => {
        observePacket("sample-sound", context); samples.push({ kind: "sound", at: point }); return "amplitude"; },
    } },
  } as unknown as AuthoringSession;
  const workerScope = { onmessage: undefined as ((event: { data: AuthoringWorkerRequest }) => void) | undefined,
    postMessage: (message: AuthoringWorkerMessage) => {
      if ("event" in message) {
        if (message.event === "storage-settled") throw new Error("Unexpected storage receipt in expression fixture");
        if (message.event === "started") expect(Number.isFinite(message.startedAt)).toBe(true);
        lifecycle.push(message);
      }
      else replies.push(message);
    } };
  let tick = 0;
  const imports = {
    isReaderExtensionMethod: () => false,
    runReaderExtension: () => { throw new Error("No reader extension in this fixture."); },
    globalThis: workerScope, initialSession: session, readerSourceMetadataEvaluateContext, restoreSavedExpressionDeclaration, restoreSavedExpressionDeclarations, authoringExpressionAdmissionRequired,
    expressionMediaScheduling: (...args: Parameters<typeof expressionMediaScheduling>) => {
      observePacket("schedule", args[2].evaluateContext, args[0]); return expressionMediaScheduling(...args); },
    evaluateAuthoringExpressionInSession: (...args: Parameters<typeof evaluateAuthoringExpressionInSession>) => {
      observePacket("evaluate", args[2].evaluateContext, args[0]); return evaluateAuthoringExpressionInSession(...args); },
    performance: { timeOrigin: 0, now: () => tick += 16 }, setTimeout: (resume: () => void) => { turns.push(resume); } };
  const api = new Function(...Object.keys(imports), `${workerCode}; base = initialSession; return {
    weight, prepareEvaluation, startSlice, run, pump, waiting, active, cancelled, parked, contexts, currentBase: () => base };`)(...Object.values(imports)) as {
    weight: (job: AuthoringWorkerRequest) => number;
    startSlice: (job: AuthoringWorkerRequest) => { step: () => boolean } | string;
    pump: () => Promise<void>;
    waiting: AuthoringWorkerRequest[];
    active: Set<number>;
    cancelled: Set<number>;
    parked: Array<{ id: number }>;
    prepareEvaluation: (job: AuthoringWorkerRequest) => { session?: AuthoringSession; sourceMetadata?: { packet: ReaderSourceMetadata; session: AuthoringSession } };
    run: (job: AuthoringWorkerRequest) => Promise<void>;
    contexts: Map<number, AuthoringSession>;
    currentBase: () => AuthoringSession | undefined;
  };
  const job = (id: number, node: ExprNode, savedExpressions: readonly (readonly [string, ExprNode])[] = [],
    sourceMetadata?: ReaderSourceMetadata): Extract<AuthoringWorkerRequest, { method: "evaluate-expression" }> =>
    ({ id, method: "evaluate-expression", contextId: 0, node, savedExpressions, ...(sourceMetadata ? { sourceMetadata } : {}) });
  const resume = async () => { turns.shift()?.(); await Promise.resolve(); await Promise.resolve(); };
  return { ...api, session, workerScope, replies, lifecycle, samples, events, job, turns, resume, metadataReads };
}

describe("media scheduling in the production worker", () => {
  test("per-job metadata overlays leave cached contexts and the frozen base unchanged, including absence", async () => {
    const h = mediaSchedulingHarness();
    const stale = workerMetadataPacket("base-packet"), first = workerMetadataPacket("job-a"), second = workerMetadataPacket("job-b");
    h.session.evaluateContext._readerSourceMetadata = stale;
    Object.freeze(h.session.evaluateContext);
    Object.freeze(h.session);
    h.contexts.set(7, h.session);
    const descriptors = Object.getOwnPropertyDescriptors(h.session.evaluateContext);
    const requests = [h.job(1, call("fixture:packet"), [], first), h.job(2, call("fixture:packet"), [], second),
      h.job(3, call("fixture:packet"))].map(job => ({ ...job, contextId: 7 }));
    for (const [index, job] of requests.entries()) {
      const prepared = h.prepareEvaluation(job);
      expect(h.prepareEvaluation(job)).toBe(prepared);
      expect(prepared.session).not.toBe(h.session);
      expect(Object.isFrozen(prepared.session)).toBe(true);
      expect(Object.isFrozen(prepared.session!.evaluateContext)).toBe(true);
      expect(prepared.session!.captureSourceMetadata).toBeUndefined();
      expect(readerSourceMetadataNative(prepared.session!.evaluateContext)).toEqual(index < 2
        ? { $tag: "Just", _0: index === 0 ? first : second } : Nothing);
      if (index < 2) {
        expect(prepared.sourceMetadata?.session).toBe(prepared.session);
        expect(prepared.sourceMetadata?.packet).toBe(index === 0 ? first : second);
      } else expect(prepared.sourceMetadata).toBeUndefined();
      const pending = h.run(job);
      await h.resume(); await pending;
      expect(h.replies.at(-1)).toMatchObject({ id: index + 1, ok: true,
        result: { result: index === 0 ? "job-a" : index === 1 ? "job-b" : "no packet" } });
      expect(h.lifecycle.filter(event => event.id === job.id)).toEqual([
        startedLifecycle(job.id), { id: job.id, event: "finished" },
      ]);
      expect(h.contexts.get(7)).toBe(h.session);
      expect(h.currentBase()).toBe(h.session);
      expect(Object.getOwnPropertyDescriptors(h.session.evaluateContext)).toEqual(descriptors);
      expect(h.session.evaluateContext._readerSourceMetadata).toBe(stale);
      expect(h.session.captureSourceMetadata).toBeUndefined();
    }
    expect(h.metadataReads.filter(read => read.phase === "schedule")).toHaveLength(3);
    expect(h.metadataReads.filter(read => read.phase === "native-packet").map(read => read.packet)).toEqual([first, second, undefined]);
  });

  test("interleaved sound, picture and ordinary jobs keep their one packet through scheduling, field evaluation and samples", async () => {
    const h = mediaSchedulingHarness();
    const soundPacket = workerMetadataPacket("sound-a"), picturePacket = workerMetadataPacket("picture-b"), ordinaryPacket = workerMetadataPacket("ordinary-c");
    const soundField = call("fixture:packet"), pictureField = call("fixture:packet"), ordinary = call("fixture:packet");
    const sound = h.job(1, call("sound-uuid", soundField, literal(3), literal(3)), [], soundPacket);
    const picture = h.job(2, call("picture-uuid", pictureField, literal(2), literal(2)), [], picturePacket);
    const plain = h.job(3, ordinary, [], ordinaryPacket);
    h.waiting.push(sound);
    const pending = h.pump();
    expect(h.samples.some(sample => sample.kind === "sound")).toBe(true);
    h.waiting.push(picture, plain);
    for (let count = 0; count < 40 && h.turns.length; count++) await h.resume();
    await pending;
    expect(h.replies.map(reply => reply.id)).toEqual([3, 2, 1]);
    expect(h.lifecycle).toEqual([
      startedLifecycle(1), startedLifecycle(2), startedLifecycle(3),
      { id: 3, event: "finished" }, { id: 2, event: "finished" }, { id: 1, event: "finished" },
    ]);
    expect(h.replies[0]).toMatchObject({ id: 3, ok: true, result: { result: "ordinary-c" } });
    expect(h.metadataReads.filter(read => read.phase === "sample-sound")).toHaveLength(9);
    expect(h.metadataReads.filter(read => read.phase === "sample-picture")).toHaveLength(4);
    for (const read of h.metadataReads.filter(read => read.phase === "sample-sound")) expect(read.packet).toBe(soundPacket);
    for (const read of h.metadataReads.filter(read => read.phase === "sample-picture")) expect(read.packet).toBe(picturePacket);
    for (const [root, field, packet] of [[sound.node, soundField, soundPacket], [picture.node, pictureField, picturePacket],
      [ordinary, ordinary, ordinaryPacket]] as const) {
      const scheduling = h.metadataReads.filter(read => read.phase === "schedule" && read.node === root);
      expect(scheduling).toHaveLength(1);
      expect(scheduling[0]!.packet).toBe(packet);
      const evaluation = h.metadataReads.filter(read => read.phase === "evaluate" && read.node === field);
      expect(evaluation).toHaveLength(1);
      expect(evaluation[0]!.packet).toBe(packet);
      expect(evaluation[0]!.frame).toBe(scheduling[0]!.frame);
    }
    expect(h.metadataReads.filter(read => read.phase === "native-packet").map(read => read.packet)).toEqual([soundPacket, ordinaryPacket, picturePacket]);
    expect(h.currentBase()).toBe(h.session);
    expect(h.contexts.size).toBe(0);
    expect(Object.hasOwn(h.session.evaluateContext, "_readerSourceMetadata")).toBe(false);
    expect(h.session.captureSourceMetadata).toBeUndefined();
  });

  test("cancelling a metadata-bearing sound slice cannot sample again or contaminate the next picture", () => {
    const h = mediaSchedulingHarness();
    const soundPacket = workerMetadataPacket("cancelled-sound"), picturePacket = workerMetadataPacket("next-picture");
    const sound = h.startSlice(h.job(1, call("sound-uuid", call("fixture:packet"), literal(3), literal(3)), [], soundPacket));
    if (typeof sound === "string") throw new Error("Metadata-bearing sound missed its cooperative slice");
    expect(sound.step()).toBe(false);
    const sampled = h.samples.length;
    h.workerScope.onmessage?.({ data: { id: 1, method: "cancel" } });
    expect(sound.step()).toBe(true);
    expect(h.samples).toHaveLength(sampled);
    expect(h.replies).toHaveLength(0);
    expect(h.lifecycle).toEqual([startedLifecycle(1), { id: 1, event: "finished" }]);
    const picture = h.startSlice(h.job(2, call("picture-uuid", call("fixture:packet"), literal(2), literal(2)), [], picturePacket));
    if (typeof picture === "string") throw new Error("Replacement picture missed its cooperative slice");
    while (!picture.step()) { /* Drive the real next slice after cancellation. */ }
    expect(h.replies).toHaveLength(1);
    expect(h.replies[0]).toMatchObject({ id: 2, ok: true });
    expect(h.lifecycle.filter(event => event.id === 2)).toEqual([
      startedLifecycle(2), { id: 2, event: "finished" },
    ]);
    expect(h.metadataReads.filter(read => read.phase === "sample-picture").every(read => read.packet === picturePacket)).toBe(true);
    expect(h.metadataReads.filter(read => read.phase === "sample-sound").every(read => read.packet === soundPacket)).toBe(true);
    expect(Object.hasOwn(h.session.evaluateContext, "_readerSourceMetadata")).toBe(false);
  });

  test("named, identity and saved-reference picture/sound calls enter the same slices", () => {
    const h = mediaSchedulingHarness();
    for (const [index, [head, weight]] of ([["picture:render", 1], ["pictureRender", 1], ["picture-uuid", 1],
      ["sound:renderSound", 2], ["renderSound", 2], ["sound-uuid", 2]] as const).entries()) {
      const expression = call(head, literal("field"), literal(3), literal(3));
      const job = h.job(index + 1, { kind: "ref", savedExprId: "saved" }, [["saved", expression]]);
      expect(h.weight(job)).toBe(weight);
      const slice = h.startSlice(job);
      expect(typeof slice).toBe("object");
      if (typeof slice === "string") throw new Error("An admitted render missed its slice");
      while (!slice.step()) { /* Drive this deterministic host time slice. */ }
      expect(h.replies.at(-1)).toMatchObject({ id: index + 1, ok: true });
    }
  });

  test("cancellation stops an active identity sound slice and a later picture completes", () => {
    const h = mediaSchedulingHarness();
    const sound = h.job(1, call("sound-uuid", literal("field"), literal(3), literal(3)));
    const soundSlice = h.startSlice(sound);
    if (typeof soundSlice === "string") throw new Error("Sound did not enter its cooperative slice");
    expect(soundSlice.step()).toBe(false);
    const before = h.samples.length;
    h.workerScope.onmessage?.({ data: { id: 1, method: "cancel" } });
    expect(soundSlice.step()).toBe(true);
    expect(h.samples.length).toBe(before);
    expect(h.replies).toHaveLength(0);
    expect(h.lifecycle).toEqual([startedLifecycle(1), { id: 1, event: "finished" }]);
    const pictureSlice = h.startSlice(h.job(2, call("picture-uuid", literal("field"), literal(2), literal(2))));
    if (typeof pictureSlice === "string") throw new Error("The next picture did not enter its slice");
    while (!pictureSlice.step()) { /* Complete the next independent request. */ }
    expect(h.replies).toEqual([{ id: 2, ok: true, result: { result: { width: 2, height: 2, pixels: ["pixel", "pixel", "pixel", "pixel"] }, trace: [] } }]);
  });

  test("an ordinary card and then a picture run before queued identity sound", async () => {
    const h = mediaSchedulingHarness();
    h.waiting.push(h.job(1, call("sound-uuid", literal("field"), literal(3), literal(3))),
      h.job(2, literal("photo")), h.job(3, call("picture-uuid", literal("field"), literal(2), literal(2))));
    const pending = h.pump();
    await h.resume();
    expect(h.replies[0]).toMatchObject({ id: 2, ok: true, result: { result: "photo" } });
    for (let count = 0; count < 30 && h.turns.length; count++) await h.resume();
    await pending;
    expect(h.replies.map(reply => reply.id)).toEqual([2, 3, 1]);
    expect(h.samples.findIndex(sample => sample.kind === "sound")).toBe(4);
  });

  test("computed dimensions retain ordinary argument order and each expression runs once", async () => {
    const h = mediaSchedulingHarness();
    const job = h.job(1, call("picture-uuid", call("fixture:field"), call("fixture:width"), call("fixture:height")));
    expect(h.weight(job)).toBe(1);
    expect(h.startSlice(job)).toBe("plain");
    expect(h.lifecycle).toEqual([startedLifecycle(1)]);
    expect(h.events).toEqual([]);
    h.waiting.push(job);
    const pending = h.pump();
    await h.resume(); await pending;
    expect(h.events).toEqual(["field", "width", "height", "render"]);
    expect(h.replies).toEqual([{ id: 1, ok: true, result: { result: "ordinary render", trace: [] } }]);
    expect(h.lifecycle).toEqual([startedLifecycle(1), { id: 1, event: "finished" }]);
  });

  test("a throwing first argument never evaluates dimensions or retries the field", async () => {
    const h = mediaSchedulingHarness();
    const job = h.job(1, call("picture-uuid", call("fixture:throw"), call("fixture:width"), call("fixture:height")));
    expect(h.startSlice(job)).toBe("plain");
    expect(h.events).toEqual([]);
    h.waiting.push(job);
    const pending = h.pump();
    await h.resume(); await pending;
    expect(h.events).toEqual(["throw"]);
    expect(h.replies).toEqual([{ id: 1, ok: false, error: "Field refused" }]);
    expect(h.lifecycle).toEqual([startedLifecycle(1), { id: 1, event: "finished" }]);
    const sliced = mediaSchedulingHarness();
    expect(sliced.startSlice(sliced.job(2, call("picture-uuid", call("fixture:throw"), literal(2), literal(2))))).toBe("finished");
    expect(sliced.events).toEqual(["throw"]);
    expect(sliced.replies).toEqual([{ id: 2, ok: false, error: "Field refused" }]);
    expect(sliced.lifecycle).toEqual([startedLifecycle(2), { id: 2, event: "finished" }]);
  });

  test("literal-dimension slices evaluate the field once and unavailable samplers fall back before evaluation", async () => {
    const sliced = mediaSchedulingHarness();
    const slice = sliced.startSlice(sliced.job(1, call("picture-uuid", call("fixture:field"), literal(2), literal(2))));
    if (typeof slice === "string") throw new Error("Literal dimensions did not enter a slice");
    while (!slice.step()) { /* Source checked dimensions; field was already evaluated once. */ }
    expect(sliced.events).toEqual(["field"]);
    const fallback = mediaSchedulingHarness();
    delete fallback.session.evaluateContext.nativesCtx!["picture:sample"];
    const job = fallback.job(2, call("picture-uuid", call("fixture:field"), literal(2), literal(2)));
    expect(fallback.startSlice(job)).toBe("plain");
    expect(fallback.events).toEqual([]);
    fallback.waiting.push(job);
    const pending = fallback.pump();
    await fallback.resume(); await pending;
    expect(fallback.events).toEqual(["field", "render"]);
    expect(fallback.replies).toEqual([{ id: 2, ok: true, result: { result: "ordinary render", trace: [] } }]);
    expect(fallback.lifecycle).toEqual([startedLifecycle(2), { id: 2, event: "finished" }]);
  });

  test("a sampler failure in the real pump finishes its selected slice", async () => {
    const h = mediaSchedulingHarness();
    h.session.evaluateContext.nativesCtx!["picture:sample"] = () => { throw new Error("Sample refused"); };
    h.waiting.push(h.job(1, call("picture-uuid", literal("field"), literal(2), literal(2))));
    await h.pump();
    expect(h.replies).toEqual([{ id: 1, ok: false, error: "Sample refused" }]);
    expect(h.lifecycle).toEqual([startedLifecycle(1), { id: 1, event: "finished" }]);
    expect(h.active.size).toBe(0);
  });

  test("a plain job cancelled at its pre-evaluation yield finishes without executing", async () => {
    const h = mediaSchedulingHarness();
    const pending = h.run(h.job(1, call("fixture:field")));
    expect(h.lifecycle).toEqual([startedLifecycle(1)]);
    h.workerScope.onmessage?.({ data: { id: 1, method: "cancel" } });
    await h.resume();
    await pending;
    expect(h.events).toEqual([]);
    expect(h.replies).toEqual([]);
    expect(h.lifecycle).toEqual([startedLifecycle(1), { id: 1, event: "finished" }]);
    expect(h.active.size).toBe(0);
  });

  test("cancelling a queued job finishes its lifetime without starting or evaluating it", () => {
    const h = mediaSchedulingHarness();
    h.waiting.push(h.job(1, call("fixture:field")));
    h.workerScope.onmessage?.({ data: { id: 1, method: "cancel" } });
    expect(h.waiting).toEqual([]);
    expect(h.events).toEqual([]);
    expect(h.replies).toEqual([]);
    expect(h.lifecycle).toEqual([{ id: 1, event: "finished" }]);
    expect(h.active.size).toBe(0);
    expect(h.cancelled.size).toBe(0);
  });

  test("cancelling a classified queued job finishes its preparation lifetime without evaluating it", () => {
    const h = mediaSchedulingHarness();
    const job = h.job(1, call("fixture:field"));
    h.waiting.push(job);
    expect(h.weight(job)).toBe(0);
    expect(h.lifecycle).toEqual([startedLifecycle(1)]);
    expect([...h.active]).toEqual([1]);
    expect(h.events).toEqual([]);
    h.workerScope.onmessage?.({ data: { id: 1, method: "cancel" } });
    expect(h.waiting).toEqual([]);
    expect(h.events).toEqual([]);
    expect(h.replies).toEqual([]);
    expect(h.lifecycle).toEqual([startedLifecycle(1), { id: 1, event: "finished" }]);
    expect(h.active.size).toBe(0);
    expect(h.cancelled.size).toBe(0);
  });

  test("the real pump retains overlapping parked jobs and finishes both cancelled sounds", async () => {
    const h = mediaSchedulingHarness();
    const firstPacket = workerMetadataPacket("parked-first"), secondPacket = workerMetadataPacket("parked-second");
    const sound = (id: number, packet: ReaderSourceMetadata) =>
      h.job(id, call("sound-uuid", call("fixture:packet"), literal(3), literal(3)), [], packet);
    const picture = (id: number) => h.job(id, call("picture-uuid", literal("field"), literal(2), literal(2)));
    const resumeUntil = async (ready: () => boolean, label: string) => {
      for (let count = 0; count < 24 && !ready(); count++) {
        if (!h.turns.length) throw new Error("The production pump stopped before " + label);
        await h.resume();
      }
      expect(ready()).toBe(true);
    };
    h.waiting.push(sound(1, firstPacket));
    const pending = h.pump();
    expect([...h.active]).toEqual([1]);
    h.waiting.push(picture(2), sound(3, secondPacket));
    await h.resume();
    expect(h.parked.map(job => job.id)).toEqual([1]);
    // Weight classification has begun the queued sound's real preparation,
    // even though the selected picture has not yet finished rendering.
    expect([...h.active].sort()).toEqual([1, 2, 3]);
    expect(h.metadataReads.filter(read => read.phase === "sample-sound" && read.packet === secondPacket)).toEqual([]);
    await resumeUntil(() => h.metadataReads.some(read => read.phase === "sample-sound" && read.packet === secondPacket),
      "the second sound sampled");
    expect(h.parked.map(job => job.id)).toEqual([1]);
    expect([...h.active].sort()).toEqual([1, 3]);

    h.waiting.push(picture(4));
    await resumeUntil(() => h.active.has(4), "the second picture started");
    expect(h.parked.map(job => job.id)).toEqual([1, 3]);
    expect([...h.active].sort()).toEqual([1, 3, 4]);
    const soundSamples = () => h.metadataReads.filter(read => read.phase === "sample-sound"
      && (read.packet === firstPacket || read.packet === secondPacket)).length;
    const sampled = soundSamples();
    for (const id of [1, 3]) h.workerScope.onmessage?.({ data: { id, method: "cancel" } });
    for (let count = 0; count < 40 && h.turns.length; count++) await h.resume();
    await pending;

    expect(soundSamples()).toBe(sampled);
    expect(h.replies.map(reply => reply.id)).toEqual([2, 4]);
    for (const id of [1, 2, 3, 4]) {
      expect(h.lifecycle.filter(event => event.id === id)).toEqual([
        startedLifecycle(id), { id, event: "finished" },
      ]);
    }
    expect(h.active.size).toBe(0);
    expect(h.cancelled.size).toBe(0);
    expect(h.parked).toEqual([]);
  });
});

function harness(options: { environment?: ReturnType<typeof createAuthoringEnvironment>; localRegistry?: object;
  /** B4 wave 4 lane S: mark an expression as rendering sampled media. */
  sampled?: (node: ExprNode) => boolean } = {}) {
  const catalog = { types: [], functions: [], capabilities: [], catalogTypes: [], operatorCodeNameByNotation: new Map() };
  const environment = options.environment ?? createAuthoringEnvironment(catalog);
  const workers: TestWorker[] = [];
  const workerSelections: string[][] = [];
  const repositoryProjection = {
    namespaces: new Set(["std", "authority", "subject", "representation-bridge"]),
    entities: [
      { id: "Animation", module: "animation", params: ["a"], type: Anything },
      { id: "Animation", module: "telegram", type: { $ref: "String" } as const },
    ],
    identifiedEntities: [
      { id: "Animation", module: "animation", params: ["a"], type: Anything },
      { id: "Animation", module: "telegram", type: { $ref: "String" } as const },
    ],
  };
  const projectionReply = () => ({ repositoryNamespaces: [...repositoryProjection.namespaces],
    repositoryEntities: repositoryProjection.entities, identifiedRepositoryEntities: repositoryProjection.identifiedEntities });
  const publications: Array<{ kind: "raw" | "identified"; value: unknown }> = [];
  const workerPublications: unknown[] = [];
  const transportFreezes: Array<{ raw: boolean; identified: boolean }> = [];
  const acquisitionOrder: string[] = [];
  let enginePreparations = 0;
  let holdingEnginePreparation = false;
  let releaseEnginePreparation!: () => void;
  let refuseEnginePreparation!: (reason: Error) => void;
  const enginePreparation = new Promise<void>((resolve, reject) => {
    releaseEnginePreparation = resolve; refuseEnginePreparation = reject;
  });
  let markEnginePreparationStarted!: () => void;
  const enginePreparationStarted = new Promise<void>(resolve => { markEnginePreparationStarted = resolve; });
  let epoch = 1;
  let holding = false;
  let holdingInitialization = false;
  let holdingNamespaces = false;
  let namespaceReads = 0;
  let evaluations = 0;
  let repositoryBuilds = 0;
  const evaluationFrames: EvaluateContext[] = [];
  const discoveries: Array<{ session: AuthoringSession; input: DataSuggestionInput; options: unknown; signal: AbortSignal }> = [];
  let holdingDiscovery = false;
  let releaseDiscovery!: () => void;
  let markDiscoveryStarted!: () => void;
  const discoveryStarted = new Promise<void>(resolve => { markDiscoveryStarted = resolve; });
  let nextDeadline = 0;
  const deadlines = new Map<number, () => void>();
  class TestWorker {
    onmessage?: (event: { data: AuthoringWorkerMessage }) => void;
    onerror?: (event: { message: string }) => void;
    onmessageerror?: () => void;
    readonly sent: AuthoringWorkerRequest[] = [];
    readonly held: AuthoringWorkerRequest[] = [];
    readonly replies: AuthoringWorkerResponse[] = [];
    readonly lifecycle: AuthoringWorkerLifecycle[] = [];
    terminated = false;
    readonly scope: { onmessage?: (event: { data: AuthoringWorkerRequest }) => void; postMessage: (data: AuthoringWorkerMessage) => void };
    constructor() {
      workers.push(this);
      this.scope = { postMessage: (value) => {
        const copy = structuredClone(value);
        if ("event" in copy) {
          if (copy.event === "storage-settled") throw new Error("Unexpected storage receipt in expression fixture");
          if (copy.event === "started") expect(Number.isFinite(copy.startedAt)).toBe(true);
          this.lifecycle.push(copy);
        }
        else {
          this.replies.push(copy);
          if (copy.ok && "repositoryEntities" in copy.result) transportFreezes.push({
            raw: Object.isFrozen(copy.result.repositoryEntities[0]!.params),
            identified: Object.isFrozen(copy.result.identifiedRepositoryEntities[0]!.type),
          });
        }
        queueMicrotask(() => { if (!this.terminated) this.onmessage?.({ data: copy }); });
      } };
      const imports = {
        // B4 unit C: the worker's own source selection, recorded per call.
        authoringExpressionSourceEntries: (...args: Parameters<typeof authoringExpressionSourceEntries>) => {
          const entries = authoringExpressionSourceEntries(...args);
          workerSelections.push(entries.map(([id]) => id));
          return entries;
        },
        isReaderExtensionMethod: () => false,
        runReaderExtension: () => { throw new Error("No reader extension in this fixture."); },
        globalThis: this.scope, readerSourceMetadataEvaluateContext,
        expressionMediaScheduling: (...args: Parameters<typeof expressionMediaScheduling>) => {
          const facts = expressionMediaScheduling(...args);
          return options.sampled?.(args[0]) ? { ...facts, sampled: true } : facts;
        }, restoreSavedExpressionDeclaration, restoreSavedExpressionDeclarations, authoringExpressionAdmissionRequired,
        yieldToInput: () => new Promise<void>(resolve => setTimeout(resolve, 0)),
        registerCatalogEntities: (value: unknown) => { workerPublications.push(value); }, modulesFor: () => [], dispatchRegistry: {},
        createAccountFieldRegistry: () => ({}), buildReaderFieldRegistry: async () => ({}),
        createRepositoryRegistry: () => { repositoryBuilds++; return { evaluateAuthorityFunction: (name: string) => name === "authority:emptyEnvelope" ? { $void: true } : Nothing }; }, mintAnonymousAuthority,
        repositorySourceModuleProjection: () => { namespaceReads++; return repositoryProjection; },
        buildSessionCatalog: () => catalog, environmentForCatalog: () => environment,
        createDetachedAuthoringEnvironment: (value: unknown) => value,
        evaluateContextForCatalog: () => ({ natives: { "fixture:uncloneable": () => () => "host callable" } }),
        getCatalog: () => [], createAccountAuthoringSession, draftSaveIssue, functionBodySaveIssue, registryTransportSnapshot,
        // A Local initialization (B4 parity): the checked catalogue and the
        // Local registry are controlled; the scoped session is the real one.
        createLocalAuthoringSession, peelListForAuthoring, resolveValueType,
        realmRepositoryCatalogue: () => undefined, repositoryCatalogueRealmKey: () => "fixture-realm", repositoryCatalogueIndex: {},
        // The public worker's build-owned index (Lane S); `initialize` reads the binding for every reader.
        publicRepositoryCatalogueIndex: {}, REPOSITORY_CATALOGUE_SOURCE_ID: "fenel-repository",
        repositoryOnlyCatalogue: async () => ({ catalog, displayCatalog: [] }),
        // The reader-scoped wrappers and the creation check the worker calls today (real owners).
        inferScopedAuthoringExpression, scopedResultRequirement, scopedExpectedType, draftSaveValidation,
        buildLocalReaderFieldRegistry: async () => options.localRegistry ?? {}, LOCAL_BROWSER_SOURCE_ID: "fixture-local",
        localCatalogue: async () => ({ catalog, displayCatalog: [] }),
        // B4 slice 2: live guidance runs the real inference, membership and judgment.
        inferAuthoringExpressionWithLiteralWitnesses, literalMembershipFor, judgeAuthoringResult, LIVE_INFERENCE_BATCH_LIMIT,
        // B4 F2: a picker's compatibility, judged with the worker's registry;
        // a live trace as transferable data.
        judgeAuthoringSchemeCompatibility, transferableTrace,
        evaluateAuthoringExpressionInSession: (...args: Parameters<typeof evaluateAuthoringExpressionInSession>) => {
          evaluations++; evaluationFrames.push(args[2].evaluateContext); return evaluateAuthoringExpressionInSession(...args);
        },
        discoverDataSuggestions: async (session: AuthoringSession, input: DataSuggestionInput, options: unknown,
          control: { signal: AbortSignal; yieldControl: () => Promise<void> }) => {
          discoveries.push({ session, input, options, signal: control.signal });
          markDiscoveryStarted();
          await control.yieldControl();
          control.signal.throwIfAborted();
          if (holdingDiscovery) await new Promise<void>((resolve, reject) => {
            releaseDiscovery = resolve;
            control.signal.addEventListener("abort", () => reject(control.signal.reason), { once: true });
            if (control.signal.aborted) reject(control.signal.reason);
          });
          control.signal.throwIfAborted();
          // The policy result is inert fixture data. This harness checks the
          // production transport and current reader, not discovery semantics.
          return { revision: input.revision, checkedFunction: session.evaluateContext.getFunction?.("fixture:answer")?.body };
        },
      };
      new Function(...Object.keys(imports), workerCode)(...Object.values(imports));
    }
    postMessage(value: AuthoringWorkerRequest) {
      const data = structuredClone(value);
      this.sent.push(data);
      if (holding && data.method === "evaluate-expression" || holdingInitialization && data.method === "initialize"
        || holdingNamespaces && data.method === "repository-namespaces") { this.held.push(data); return; }
      queueMicrotask(() => { if (!this.terminated) this.scope.onmessage?.({ data }); });
    }
    release() {
      for (const data of this.held.splice(0)) this.scope.onmessage?.({ data });
    }
    terminate() { this.terminated = true; }
  }
  const assertCurrentSession = (captured: number) => { if (captured !== epoch) throw new Error("Stale session"); };
  const repositoryMemo = new Function("assertCurrentSession", `${repositoryMemoCode}; return {
    retainCheckedRepositoryNamespaces, checkedRepositoryNamespaces, clearCheckedRepositoryNamespaces };`)(assertCurrentSession);
  const imports = { Worker: TestWorker, concreteAuthoringSession, localAuthoringScopeForSession, LIVE_INFERENCE_BATCH_LIMIT, ...repositoryMemo,
    assertReaderSourceMetadata, captureReaderSourceMetadata, authoringExpressionSourceEntries, reachedSavedSources, savedExpressionDeclaration, savedExpressionDeclarationEntries,
    createSignal: () => [() => 0, () => {}],
    setTimeout: (callback: () => void) => { const id = ++nextDeadline; deadlines.set(id, callback); return id; },
    clearTimeout: (id: number) => { deadlines.delete(id); },
    sessionEpoch: () => epoch, assertCurrentSession,
    onBrowserSessionChange: () => () => {}, closeRegistryPreparationWorker: () => {}, installPreparedWorkspaceCatalog: () => {}, accountFieldRegistryState: () => undefined,
    prepareEngineBodyDispatch: async () => {
      enginePreparations++; acquisitionOrder.push("engine-preparation"); markEnginePreparationStarted();
      if (holdingEnginePreparation) await enginePreparation;
      acquisitionOrder.push("engine-ready");
    },
    registerCatalogEntities: (value: unknown) => { acquisitionOrder.push("raw"); publications.push({ kind: "raw", value }); },
    registerIdentifiedCatalogEntity: (value: unknown) => { acquisitionOrder.push("identified"); publications.push({ kind: "identified", value }); } };
  Object.assign(imports, authoringWorkerHostFixtureBindings(imports));
  const api = new Function(...Object.keys(imports), `${clientCode}; return {
    prepareCatalogInWorker, prepareRepositoryCatalogInWorker, attachPreparedAuthoringWorker, discardPreparedAuthoringWorker, discardPreparedAuthoringCatalog,
    evaluateExpressionInWorker, expressionSaveIssueInWorker, inferExpressionsInWorker, discoverDataSuggestionsInWorker, authoringWorkerSnapshot, disposePreparedAuthoringWorkers, checkedRepositoryNamespaces,
    runAuthoringWorker };`)(...Object.values(imports)) as
    Pick<typeof import("./authoring-catalog-worker"), "prepareCatalogInWorker" | "prepareRepositoryCatalogInWorker" | "attachPreparedAuthoringWorker" | "runAuthoringWorker"
      | "discardPreparedAuthoringWorker" | "discardPreparedAuthoringCatalog" | "evaluateExpressionInWorker" | "expressionSaveIssueInWorker" | "inferExpressionsInWorker" | "discoverDataSuggestionsInWorker" | "authoringWorkerSnapshot" | "disposePreparedAuthoringWorkers" | "checkedRepositoryNamespaces">;
  const baseSession = (registry: ModuleRegistry): AuthoringSession => ({ mode: "detached", registry,
    environment, catalog: environment.catalog, evaluateContext: {} });
  async function reader(accountId: string, answer: string) {
    const registry = {} as ModuleRegistry;
    const base = baseSession(registry);
    const catalog = await api.prepareCatalogInWorker(accountId, { owners: [], fields: [], facets: [] }, [], [], { independent: true });
    api.attachPreparedAuthoringWorker(registry, catalog, base);
    const scope: AccountAuthoringScope = { accountId, functions: [
      { id: "fixture:answer", params: [], returns: { $ref: "String" } as const, body: answer },
      { id: "fixture:identity", params: [{ name: "input", type: Anything, label: Nothing, ui: Nothing, meta: {} }], returns: Anything, body: { var: "input" } },
    ] };
    return { registry, scope, session: createAccountAuthoringSession(base, scope), worker: workers.at(-1)! };
  }
  return { ...api, reader, workers, workerSelections, baseSession, projectionReply, publications, workerPublications, transportFreezes,
    acquisitionOrder, enginePreparations: () => enginePreparations,
    holdEnginePreparation: () => { holdingEnginePreparation = true; },
    enginePreparationStarted, releaseEnginePreparation, refuseEnginePreparation,
    hold: (value: boolean) => { holding = value; },
    holdInitialization: () => { holdingInitialization = true; },
    holdNamespaces: () => { holdingNamespaces = true; }, namespaceReads: () => namespaceReads,
    evaluations: () => evaluations, advanceEpoch: () => { epoch++; },
    repositoryBuilds: () => repositoryBuilds, evaluationFrames,
    discoveries, discoveryStarted, holdDiscovery: () => { holdingDiscovery = true; },
    releaseDiscovery: () => { holdingDiscovery = false; releaseDiscovery?.(); },
    expireRequests: () => { for (const callback of [...deadlines.values()]) callback(); } };
}

describe("expression evaluation in the exact reader worker", () => {
  const suggestionInput = (revision: string): DataSuggestionInput => ({ expression: literal("selected"),
    type: Anything, value: "selected", savedExpressions: [["selected-source", literal("selected")]], revision });

  test("public repository tools evaluate in their own worker under anonymous authority", async () => {
    const h = harness();
    try {
      const registry = {} as ModuleRegistry, session = h.baseSession(registry);
      const catalog = await h.prepareRepositoryCatalogInWorker();
      h.attachPreparedAuthoringWorker(registry, catalog, session);
      expect(await h.evaluateExpressionInWorker(session, literal("public result"), new Map())).toEqual({ result: "public result", trace: [] });
      expect(h.repositoryBuilds()).toBe(1);
      expect(authenticateAuthority(h.evaluationFrames[0]!._authority)?.accountId).toBeNull();
      expect(authenticateAuthority(h.evaluationFrames[0]!._authority)?.envelope).toEqual({ $void: true });
      expect(h.evaluationFrames[0]!._activeTags).toBeUndefined();
      expect(h.workers[0]!.sent[0]).toMatchObject({ method: "initialize", repositoryOnly: true, snapshot: { owners: [], fields: [], facets: [] } });
      // Discovery is controlled inert oracle data in this transport harness,
      // rather than the production policy's DataSuggestionBatch shape.
      expect<unknown>(await h.discoverDataSuggestionsInWorker(session, suggestionInput("public"))).toEqual({ revision: "public", checkedFunction: undefined });
      const privateScope = { accountId: "private", functions: [] };
      const unrelated = createAccountAuthoringSession(session, privateScope);
      expect(h.evaluateExpressionInWorker(unrelated, literal("private"), new Map(), undefined, privateScope)).toBeUndefined();
      h.disposePreparedAuthoringWorkers();
      expect(() => h.authoringWorkerSnapshot(session)).toThrow("replaced");
    } finally { h.disposePreparedAuthoringWorkers(); }
  });

  test("repository-only initialization rejects authored account/source/function inputs", async () => {
    const h = harness();
    try {
      for (const options of [{ repositoryOnly: true }, { repositoryOnly: true, localSourceId: "tab" }]) {
        await expect(h.prepareCatalogInWorker("private", { owners: [], fields: [], facets: [] }, [], [], options)).rejects.toThrow("repository data only");
      }
      await expect(h.prepareCatalogInWorker(undefined, { owners: [], fields: [], facets: [] }, [], [
        { id: "private:answer", params: [], returns: Anything, body: "private" },
      ], { repositoryOnly: true })).rejects.toThrow("repository data only");
      expect(h.repositoryBuilds()).toBe(0);
    } finally { h.disposePreparedAuthoringWorkers(); }
  });

  test("discovery uses the same exact reader, options and inert input without evaluating targets", async () => {
    const h = harness();
    try {
      const left = await h.reader("left", "left declaration"), right = await h.reader("right", "right declaration");
      const input = suggestionInput("subject-1");
      const options = { maxOperations: 24, maxSuggestions: 7, maxArity: 4 };
      expect<unknown>(await h.discoverDataSuggestionsInWorker(left.session, input, options, undefined, left.scope))
        .toEqual({ revision: "subject-1", checkedFunction: "left declaration" });
      expect<unknown>(await h.discoverDataSuggestionsInWorker(right.session, suggestionInput("subject-2"), {}, undefined, right.scope))
        .toEqual({ revision: "subject-2", checkedFunction: "right declaration" });
      expect(h.discoveries[0]!.input).toEqual(input);
      expect(h.discoveries[0]!.input).not.toBe(input);
      expect(h.discoveries[0]!.options).toEqual(options);
      expect(h.discoveries[0]!.session).not.toBe(h.discoveries[1]!.session);
      expect(h.evaluations()).toBe(0);
      const publicSession = h.baseSession({} as ModuleRegistry);
      expect(h.discoverDataSuggestionsInWorker(publicSession, input)).toBeUndefined();
      expect(h.discoveries).toHaveLength(2);
    } finally { h.disposePreparedAuthoringWorkers(); }
  });

  test("discovery abort reaches the active worker job and permits the next request", async () => {
    const h = harness();
    try {
      const reader = await h.reader("reader", "current declaration");
      h.holdDiscovery();
      const abort = new AbortController();
      const pending = h.discoverDataSuggestionsInWorker(reader.session, suggestionInput("cancelled"), {}, abort.signal, reader.scope)!;
      void pending.catch(() => {});
      await h.discoveryStarted;
      abort.abort(new Error("Suggestion menu closed"));
      await expect(pending).rejects.toThrow("Suggestion menu closed");
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(h.discoveries[0]!.signal.aborted).toBe(true);
      expect(reader.worker.sent.at(-1)?.method).toBe("cancel");
      h.releaseDiscovery();
      expect<unknown>(await h.discoverDataSuggestionsInWorker(reader.session, suggestionInput("next"), {}, undefined, reader.scope))
        .toEqual({ revision: "next", checkedFunction: "current declaration" });
      expect(h.evaluations()).toBe(0);
    } finally { h.disposePreparedAuthoringWorkers(); }
  });

  test("discovery refuses uncloneable data, retired readers and a completed stale epoch", async () => {
    const h = harness();
    try {
      const reader = await h.reader("reader", "private declaration");
      await expect(h.discoverDataSuggestionsInWorker(reader.session,
        { ...suggestionInput("bad-carrier"), value: () => "host callback" }, {}, undefined, reader.scope)!).rejects.toThrow();
      expect(h.discoveries).toHaveLength(0);
      h.holdDiscovery();
      const pending = h.discoverDataSuggestionsInWorker(reader.session, suggestionInput("stale"), {}, undefined, reader.scope)!;
      void pending.catch(() => {});
      await h.discoveryStarted;
      h.advanceEpoch();
      h.releaseDiscovery();
      await expect(pending).rejects.toThrow("Stale session");
      h.discardPreparedAuthoringWorker(reader.registry);
      await expect(h.discoverDataSuggestionsInWorker(reader.session, suggestionInput("retired"), {}, undefined, reader.scope)!).rejects.toThrow("replaced");
      expect(h.discoveries).toHaveLength(1);
      expect(h.evaluations()).toBe(0);
    } finally { h.disposePreparedAuthoringWorkers(); }
  });

  test("repository names become reusable only after successful initialization and resist callback/copy/duplicate contamination", async () => {
    const h = harness(); h.holdInitialization();
    let resolveNamespaces!: () => void;
    const namespacesReady = new Promise<void>(resolve => { resolveNamespaces = resolve; });
    try {
      const pending = h.prepareCatalogInWorker("reader", { owners: [], fields: [], facets: [] }, [], [],
        { independent: true, sourceModules: [{ id: "private-source", slug: "private-source", version: "1", source: "module Private where" }],
          onRepositoryNamespaces: names => {
            (names as Set<string>).clear(); (names as Set<string>).add("private-source"); resolveNamespaces();
          } });
      await namespacesReady;
      expect(h.checkedRepositoryNamespaces()).toBeUndefined();
      const worker = h.workers[0]!;
      worker.release();
      const catalog = await pending;
      const expected = ["std", "authority", "subject", "representation-bridge"];
      const first = h.checkedRepositoryNamespaces() as Set<string>;
      expect([...first]).toEqual(expected);
      first.clear(); first.add("private-source");
      expect([...h.checkedRepositoryNamespaces()!]).toEqual(expected);
      worker.onmessage?.({ data: { id: 1, ok: true, result: { ...h.projectionReply(), repositoryNamespaces: ["private-source"] } } });
      expect([...h.checkedRepositoryNamespaces()!]).toEqual(expected);
      h.discardPreparedAuthoringCatalog(catalog);
      expect(worker.terminated).toBe(true);
      expect([...h.checkedRepositoryNamespaces()!]).toEqual(expected);
      h.advanceEpoch();
      expect(h.checkedRepositoryNamespaces()).toBeUndefined();
    } finally { h.disposePreparedAuthoringWorkers(); }
    expect(h.checkedRepositoryNamespaces()).toBeUndefined();
  });

  for (const retirement of ["epoch", "abort", "dispose", "initialization-error", "timeout"] as const) {
    test(`${retirement} after namespace publication cannot retain a reusable projection`, async () => {
      const h = harness(); h.holdInitialization();
      const abort = new AbortController();
      let resolveNamespaces!: () => void;
      const namespacesReady = new Promise<void>(resolve => { resolveNamespaces = resolve; });
      try {
        const pending = h.prepareCatalogInWorker("reader", { owners: [], fields: [], facets: [] }, [], [],
          { independent: true, sourceModules: [{ id: "source", slug: "source", version: "1", source: "module Source where" }],
            signal: abort.signal, onRepositoryNamespaces: () => { resolveNamespaces(); } });
        void pending.catch(() => {});
        await namespacesReady;
        expect(h.checkedRepositoryNamespaces()).toBeUndefined();
        const worker = h.workers[0]!;
        if (retirement === "epoch") { h.advanceEpoch(); worker.release(); }
        else if (retirement === "abort") abort.abort(new Error("Reader closed after namespace publication"));
        else if (retirement === "dispose") h.disposePreparedAuthoringWorkers();
        else if (retirement === "timeout") h.expireRequests();
        else worker.onmessage?.({ data: { id: 2, ok: false, error: "Checked initialization refused" } });
        await expect(pending).rejects.toThrow(retirement === "epoch" ? "Stale session"
          : retirement === "abort" ? "Reader closed after namespace publication"
          : retirement === "dispose" ? "snapshot changed" : retirement === "timeout" ? "too long" : "Checked initialization refused");
        expect(h.checkedRepositoryNamespaces()).toBeUndefined();
        expect(worker.terminated).toBe(true);
        worker.release();
        expect(h.checkedRepositoryNamespaces()).toBeUndefined();
      } finally { h.disposePreparedAuthoringWorkers(); }
    });
  }

  test("checked namespaces arrive from the exact request before catalog completion without changing captured inputs", async () => {
    const h = harness(); h.holdNamespaces(); h.holdInitialization();
    try {
      const sources = [{ id: "source", slug: "source", version: "1", source: "module Original where" }];
      const entities = [{ id: "Original", type: Anything }];
      const functions = [{ id: "fixture:original", params: [], returns: Anything, body: 1 }];
      let resolveNamespaces!: (value: ReadonlySet<string>) => void;
      let publicationOrderAtNamespace: string[] = [];
      const projected = new Promise<ReadonlySet<string>>(resolve => { resolveNamespaces = resolve; });
      const pending = h.prepareCatalogInWorker("reader", { owners: [], fields: [], facets: [] }, entities, functions,
        { independent: true, sourceModules: sources, onRepositoryNamespaces: names => {
          publicationOrderAtNamespace = h.publications.map(value => value.kind); resolveNamespaces(names);
        } });
      const worker = h.workers.at(-1)!;
      expect(worker.sent.map(request => request.method)).toEqual(["repository-namespaces"]);
      worker.onmessage?.({ data: { id: 999, ok: true, result: { ...h.projectionReply(), repositoryNamespaces: ["wrong-request"] } } });
      expect(h.publications).toHaveLength(0);
      expect(h.enginePreparations()).toBe(0);
      sources[0]!.source = "module Replaced where"; entities[0]!.id = "Replaced"; functions[0]!.body = 2;
      worker.release();
      expect([...(await projected)]).toEqual(["std", "authority", "subject", "representation-bridge"]);
      expect(h.namespaceReads()).toBe(1);
      expect(h.enginePreparations()).toBe(1);
      expect(h.acquisitionOrder).toEqual(["engine-preparation", "engine-ready", "raw", "identified", "identified"]);
      expect(publicationOrderAtNamespace).toEqual(["raw", "identified", "identified"]);
      expect(h.publications).toEqual([
        { kind: "raw", value: h.projectionReply().repositoryEntities },
        ...h.projectionReply().identifiedRepositoryEntities.map(value => ({ kind: "identified" as const, value })),
      ]);
      expect((h.publications[0]!.value as Array<{ id: string; module: string; params?: string[] }>).map(value => [value.id, value.module, value.params]))
        .toEqual([["Animation", "animation", ["a"]], ["Animation", "telegram", undefined]]);
      const initialization = worker.sent.find(request => request.method === "initialize")!;
      if (initialization.method !== "initialize") throw new Error("Initialization request missing");
      expect(initialization.id).toBe(2);
      expect(initialization.sourceModules?.[0]?.source).toBe("module Original where");
      expect(initialization.entities[0]?.id).toBe("Original");
      expect(initialization.functions?.[0]?.body).toBe(1);
      worker.release();
      await pending;
      expect(h.workerPublications).toEqual([initialization.entities]);
      expect(h.publications[0]!.value).not.toContainEqual(initialization.entities[0]);
    } finally { h.disposePreparedAuthoringWorkers(); }
  });

  test("empty source does not acquire namespace-only metadata", async () => {
    const h = harness();
    try {
      let projected = false;
      await h.prepareCatalogInWorker("reader", { owners: [], fields: [], facets: [] }, [], [],
        { independent: true, sourceModules: [], onRepositoryNamespaces: () => { projected = true; } });
      expect(projected).toBe(false);
      expect(h.namespaceReads()).toBe(0);
      expect(h.enginePreparations()).toBe(0);
      expect(h.publications).toHaveLength(0);
      expect(h.workers[0]!.sent.map(request => request.method)).toEqual(["initialize"]);
    } finally { h.disposePreparedAuthoringWorkers(); }
  });

  test("repository publication waits for the original engine preparation before releasing namespaces", async () => {
    const h = harness(); h.holdEnginePreparation();
    try {
      const pending = h.prepareCatalogInWorker("reader", { owners: [], fields: [], facets: [] }, [], [],
        { sourceModules: [{ id: "source", slug: "source", version: "1", source: "module Source where" }],
          onRepositoryNamespaces: () => { h.acquisitionOrder.push("namespaces"); } });
      await h.enginePreparationStarted;
      expect(h.publications).toHaveLength(0);
      expect(h.acquisitionOrder).toEqual(["engine-preparation"]);
      expect(h.workers[0]!.sent.map(request => request.method)).toEqual(["repository-namespaces"]);
      h.releaseEnginePreparation();
      await pending;
      expect(h.acquisitionOrder).toEqual(["engine-preparation", "engine-ready", "raw", "identified", "identified", "namespaces"]);
      expect(h.workers[0]!.sent.map(request => request.method)).toEqual(["repository-namespaces", "initialize"]);
    } finally { h.releaseEnginePreparation(); h.disposePreparedAuthoringWorkers(); }
  });

  for (const retirement of ["epoch", "abort", "dispose", "preparation-error"] as const) {
    test(`${retirement} during engine preparation prevents repository publication and account initialization`, async () => {
      const h = harness(); h.holdEnginePreparation();
      const abort = new AbortController();
      try {
        let projected = false;
        const pending = h.prepareCatalogInWorker("reader", { owners: [], fields: [], facets: [] }, [], [],
          { sourceModules: [{ id: "source", slug: "source", version: "1", source: "module Source where" }],
            signal: abort.signal, onRepositoryNamespaces: () => { projected = true; } });
        void pending.catch(() => {});
        await h.enginePreparationStarted;
        expect(h.publications).toHaveLength(0);
        if (retirement === "epoch") h.advanceEpoch();
        else if (retirement === "abort") abort.abort(new Error("Reader closed during engine preparation"));
        else if (retirement === "dispose") h.disposePreparedAuthoringWorkers();
        else h.refuseEnginePreparation(new Error("Engine preparation refused"));
        if (retirement !== "preparation-error") h.releaseEnginePreparation();
        await expect(pending).rejects.toThrow(retirement === "epoch" ? "Stale session"
          : retirement === "abort" ? "Reader closed during engine preparation"
          : retirement === "dispose" ? "replaced" : "Engine preparation refused");
        expect(projected).toBe(false);
        expect(h.publications).toHaveLength(0);
        expect(h.workers[0]!.terminated).toBe(true);
        expect(h.workers[0]!.sent.filter(request => request.method === "initialize")).toHaveLength(0);
      } finally { h.releaseEnginePreparation(); h.disposePreparedAuthoringWorkers(); }
    });
  }

  test("published repository graphs regain recursive immutability after actual worker transport", async () => {
    const h = harness();
    try {
      await h.prepareCatalogInWorker("reader", { owners: [], fields: [], facets: [] }, [], [],
        { sourceModules: [{ id: "private-source", slug: "private-source", version: "1", source: "module Private where" }],
          onRepositoryNamespaces: () => {} });
      expect(h.transportFreezes).toEqual([{ raw: false, identified: false }]);
      const raw = h.publications[0]!.value as Array<{ id: string; params: string[]; type: object }>;
      const identified = h.publications[1]!.value as { type: object };
      const before = structuredClone(raw);
      expect(Object.isFrozen(raw)).toBe(true);
      expect(Object.isFrozen(raw[0]!.params)).toBe(true);
      expect(Object.isFrozen(raw[0]!.type)).toBe(true);
      expect(Object.isFrozen(identified.type)).toBe(true);
      expect(Reflect.set(raw[0]!.params, "0", "changed")).toBe(false);
      expect(Reflect.set(raw[0]!.type, "$ref", "changed")).toBe(false);
      expect(Reflect.set(identified.type, "$ref", "changed")).toBe(false);
      const nested = Object.values(raw[0]!.type).find(value => value !== null && typeof value === "object");
      if (!nested) throw new Error("The fixture's repository type has no nested graph");
      expect(Object.isFrozen(nested)).toBe(true);
      expect(Reflect.set(nested, "changed", true)).toBe(false);
      expect(raw).toEqual(before);
    } finally { h.disposePreparedAuthoringWorkers(); }
  });

  test("transport preserves shared cyclic type graphs and the original copied Bytes leaf exception", async () => {
    const h = harness();
    try {
      const bytes = new Uint8Array([7]);
      const type: FenelType = { $tuple: [] };
      type.$tuple.push(type, { $refined: { base: { $ref: "Bytes" }, set: { $tag: "SeEnum", values: [bytes] } } });
      h.projectionReply().repositoryEntities[0]!.type = type;
      h.projectionReply().identifiedRepositoryEntities[0]!.type = type;
      await h.prepareCatalogInWorker("reader", { owners: [], fields: [], facets: [] }, [], [],
        { sourceModules: [{ id: "private-source", slug: "private-source", version: "1", source: "module Private where" }],
          onRepositoryNamespaces: () => {} });
      const raw = h.publications[0]!.value as Array<{ type: typeof type }>;
      const identified = h.publications[1]!.value as { type: typeof type };
      expect(raw[0]!.type.$tuple[0]).toBe(raw[0]!.type);
      expect(identified.type).toBe(raw[0]!.type);
      expect(Object.isFrozen(raw[0]!.type.$tuple)).toBe(true);
      const member = raw[0]!.type.$tuple[1] as Extract<FenelType, { $refined: unknown }>;
      const set = member.$refined.set as Extract<typeof member.$refined.set, { $tag: "SeEnum" }>;
      const publishedBytes = set.values[0] as Uint8Array;
      expect(publishedBytes).not.toBe(bytes);
      expect(Object.isFrozen(publishedBytes)).toBe(false);
      publishedBytes[0] = 99;
      expect(bytes[0]).toBe(7);
    } finally { h.disposePreparedAuthoringWorkers(); }
  });

  test("cancellation of namespace preflight retires only its exact pending worker", async () => {
    const h = harness();
    try {
      const current = await h.reader("reader", "current");
      h.holdNamespaces();
      const abort = new AbortController();
      let projected = false;
      const pending = h.prepareCatalogInWorker("reader", { owners: [], fields: [], facets: [] }, [], [],
        { independent: true, sourceModules: [{ id: "source", slug: "source", version: "1", source: "module Source where" }],
          signal: abort.signal, onRepositoryNamespaces: () => { projected = true; } });
      void pending.catch(() => {});
      const abandoned = h.workers.at(-1)!;
      abort.abort(new Error("Namespace reader closed"));
      await expect(pending).rejects.toThrow("Namespace reader closed");
      abandoned.release();
      expect(projected).toBe(false);
      expect(h.publications).toHaveLength(0);
      expect(abandoned.terminated).toBe(true);
      expect(abandoned.sent.filter(request => request.method === "initialize")).toHaveLength(0);
      expect(current.worker.terminated).toBe(false);
    } finally { h.disposePreparedAuthoringWorkers(); }
  });

  test("old login epochs refuse namespace projection and never initialize a stale catalog", async () => {
    const h = harness(); h.holdNamespaces();
    try {
      let projected = false;
      const pending = h.prepareCatalogInWorker("reader", { owners: [], fields: [], facets: [] }, [], [],
        { sourceModules: [{ id: "source", slug: "source", version: "1", source: "module Source where" }],
          onRepositoryNamespaces: () => { projected = true; } });
      void pending.catch(() => {});
      h.advanceEpoch(); h.workers[0]!.release();
      await expect(pending).rejects.toThrow("Stale session");
      expect(projected).toBe(false);
      expect(h.publications).toHaveLength(0);
      expect(h.workers[0]!.terminated).toBe(true);
      expect(h.workers[0]!.sent.filter(request => request.method === "initialize")).toHaveLength(0);
    } finally { h.disposePreparedAuthoringWorkers(); }
  });

  test("retiring a client after its reply but before continuation prevents namespace publication", async () => {
    const h = harness(); h.holdNamespaces();
    try {
      let projected = false;
      const pending = h.prepareCatalogInWorker("reader", { owners: [], fields: [], facets: [] }, [], [],
        { sourceModules: [{ id: "source", slug: "source", version: "1", source: "module Source where" }],
          onRepositoryNamespaces: () => { projected = true; } });
      void pending.catch(() => {});
      h.workers[0]!.onmessage?.({ data: { id: 1, ok: true, result: h.projectionReply() } });
      h.disposePreparedAuthoringWorkers();
      await expect(pending).rejects.toThrow("replaced");
      expect(projected).toBe(false);
      expect(h.publications).toHaveLength(0);
      expect(h.workers[0]!.sent.filter(request => request.method === "initialize")).toHaveLength(0);
    } finally { h.disposePreparedAuthoringWorkers(); }
  });

  test("unreadable namespace replies and preflight deadlines refuse without a fallback registry", async () => {
    const sparse = Object.assign(new Array<string>(1), { extra: "std" });
    for (const invalid of ["wrong-result", "sparse", "non-string", "worker-error", "deadline"] as const) {
      const h = harness(); h.holdNamespaces();
      try {
        let projected = false;
        const pending = h.prepareCatalogInWorker("reader", { owners: [], fields: [], facets: [] }, [], [],
          { sourceModules: [{ id: "source", slug: "source", version: "1", source: "module Source where" }],
            onRepositoryNamespaces: () => { projected = true; } });
        void pending.catch(() => {});
        if (invalid === "deadline") h.expireRequests();
        else if (invalid === "worker-error") h.workers[0]!.onmessage?.({ data: { id: 1, ok: false, error: "Checked names refused" } });
        else h.workers[0]!.onmessage?.({ data: { id: 1, ok: true, result: invalid === "wrong-result"
          ? { catalog: {} as never } : { ...h.projectionReply(), repositoryNamespaces: invalid === "sparse" ? sparse : ["std", 1 as never] } } });
        await expect(pending).rejects.toThrow(invalid === "deadline" ? "took too long"
          : invalid === "worker-error" ? "Checked names refused" : "namespace projection");
        expect(projected).toBe(false);
        expect(h.publications).toHaveLength(0);
        expect(h.enginePreparations()).toBe(0);
        expect(h.checkedRepositoryNamespaces()).toBeUndefined();
        expect(h.workers[0]!.terminated).toBe(true);
        expect(h.workers[0]!.sent.filter(request => request.method === "initialize")).toHaveLength(0);
      } finally { h.disposePreparedAuthoringWorkers(); }
    }
  });

  test("an unreadable row anywhere in repository metadata prevents every global publication", async () => {
    let getterReads = 0;
    const row = { id: "RepositoryOnly", module: "repository", type: Anything };
    const sparse = new Array(1);
    const accessorArray = Object.defineProperty([row], "0", { get: () => { getterReads++; return row; }, enumerable: true });
    const accessorRow = Object.defineProperty({ id: "RepositoryOnly" }, "type", { get: () => { getterReads++; return Anything; }, enumerable: true });
    const inheritedRow = Object.create(row);
    const nestedAccessor = Object.defineProperty({}, "type", { get: () => { getterReads++; return Anything; }, enumerable: true });
    const cases: Array<{ name: string; change: (reply: Record<string, unknown>) => void }> = [
      { name: "missing raw rows", change: reply => { delete reply.repositoryEntities; } },
      { name: "missing identified rows", change: reply => { delete reply.identifiedRepositoryEntities; } },
      { name: "sparse raw array", change: reply => { reply.repositoryEntities = sparse; } },
      { name: "sparse identified array", change: reply => { reply.identifiedRepositoryEntities = sparse; } },
      { name: "accessor array entry", change: reply => { reply.repositoryEntities = accessorArray; } },
      { name: "accessor row property", change: reply => { reply.repositoryEntities = [accessorRow]; } },
      { name: "inherited row properties", change: reply => { reply.repositoryEntities = [inheritedRow]; } },
      { name: "empty id", change: reply => { reply.repositoryEntities = [{ ...row, id: "" }]; } },
      { name: "missing type", change: reply => { reply.repositoryEntities = [{ id: row.id }]; } },
      { name: "non-object type", change: reply => { reply.repositoryEntities = [{ ...row, type: "String" }]; } },
      { name: "array type", change: reply => { reply.repositoryEntities = [{ ...row, type: [] }]; } },
      { name: "non-string module", change: reply => { reply.repositoryEntities = [{ ...row, module: 1 }]; } },
      { name: "non-array parameters", change: reply => { reply.repositoryEntities = [{ ...row, params: "a" }]; } },
      { name: "sparse parameters", change: reply => { reply.repositoryEntities = [{ ...row, params: sparse }]; } },
      { name: "late invalid identified row", change: reply => { reply.identifiedRepositoryEntities = [row, { ...row, id: "" }]; } },
      { name: "nested raw type accessor", change: reply => { reply.repositoryEntities = [{ ...row, type: { nested: nestedAccessor } }]; } },
      { name: "late nested identified type accessor", change: reply => { reply.identifiedRepositoryEntities = [row, { ...row, type: { nested: nestedAccessor } }]; } },
      { name: "accessor projection property", change: reply => {
        Object.defineProperty(reply, "identifiedRepositoryEntities", { get: () => { getterReads++; return [row]; }, enumerable: true });
      } },
    ];
    for (const invalid of cases) {
      const h = harness(); h.holdNamespaces();
      try {
        let projected = false;
        const pending = h.prepareCatalogInWorker("reader", { owners: [], fields: [], facets: [] }, [], [],
          { sourceModules: [{ id: "private-source", slug: "private-source", version: "1", source: "module Private where" }],
            onRepositoryNamespaces: () => { projected = true; } });
        void pending.catch(() => {});
        const reply: Record<string, unknown> = { ...h.projectionReply() };
        invalid.change(reply);
        h.workers[0]!.onmessage?.({ data: { id: 1, ok: true, result: reply as AuthoringWorkerResult } });
        await expect(pending).rejects.toThrow("namespace projection");
        expect(h.publications, invalid.name).toHaveLength(0);
        expect(projected, invalid.name).toBe(false);
        expect(h.checkedRepositoryNamespaces(), invalid.name).toBeUndefined();
        expect(h.workers[0]!.sent.filter(request => request.method === "initialize"), invalid.name).toHaveLength(0);
        expect(h.workers[0]!.terminated, invalid.name).toBe(true);
      } finally { h.disposePreparedAuthoringWorkers(); }
    }
    expect(getterReads).toBe(0);
  });

  test("an abandoned preparation terminates before any catalog or registry was returned", async () => {
    const h = harness();
    try {
      const current = await h.reader("reader", "current");
      h.holdInitialization();
      const abort = new AbortController();
      const pending = h.prepareCatalogInWorker("reader", { owners: [], fields: [], facets: [] }, [], [],
        { independent: true, signal: abort.signal });
      void pending.catch(() => {});
      const abandoned = h.workers.at(-1)!;
      expect(abandoned.terminated).toBe(false);
      abort.abort(new Error("Reader closed during preparation"));
      expect(abandoned.terminated).toBe(true);
      await expect(pending).rejects.toThrow("Reader closed during preparation");
      expect(current.worker.terminated).toBe(false);
      expect(await h.evaluateExpressionInWorker(current.session, call("fixture:answer"), new Map(), undefined, current.scope))
        .toEqual({ result: "current", trace: [] });
      abandoned.release();
      expect(abandoned.terminated).toBe(true);
    } finally { h.disposePreparedAuthoringWorkers(); }
  });

  test("an unbound completed catalog remains cancellable and an attached worker transfers ownership", async () => {
    const h = harness();
    try {
      const abort = new AbortController();
      const catalog = await h.prepareCatalogInWorker("reader", { owners: [], fields: [], facets: [] }, [], [],
        { independent: true, signal: abort.signal });
      const unbound = h.workers.at(-1)!;
      abort.abort();
      expect(unbound.terminated).toBe(true);
      expect(() => h.attachPreparedAuthoringWorker({} as ModuleRegistry, catalog, h.baseSession({} as ModuleRegistry))).toThrow("unavailable");

      const attachedAbort = new AbortController();
      const attachedCatalog = await h.prepareCatalogInWorker("reader", { owners: [], fields: [], facets: [] }, [], [],
        { independent: true, signal: attachedAbort.signal });
      const attached = h.workers.at(-1)!;
      const registry = {} as ModuleRegistry;
      h.attachPreparedAuthoringWorker(registry, attachedCatalog, h.baseSession(registry));
      attachedAbort.abort();
      expect(attached.terminated).toBe(false);
      h.discardPreparedAuthoringWorker(registry);
      expect(attached.terminated).toBe(true);
    } finally { h.disposePreparedAuthoringWorkers(); }
  });

  test("a previously aborted preparation allocates no worker", async () => {
    const h = harness();
    const abort = new AbortController(); abort.abort(new Error("Already closed"));
    await expect(h.prepareCatalogInWorker("reader", { owners: [], fields: [], facets: [] }, [], [],
      { independent: true, signal: abort.signal })).rejects.toThrow("Already closed");
    expect(h.workers).toHaveLength(0);
  });

  test("discarding an unbound source catalog preserves the current reader worker", async () => {
    const h = harness();
    try {
      const current = await h.reader("reader", "current");
      const stale = await h.prepareCatalogInWorker("reader", { owners: [], fields: [], facets: [] }, [], [], { independent: true });
      const abandoned = h.workers.at(-1)!;
      h.discardPreparedAuthoringCatalog(stale);
      expect(abandoned.terminated).toBe(true);
      expect(current.worker.terminated).toBe(false);
      expect(await h.evaluateExpressionInWorker(current.session, call("fixture:answer"), new Map(), undefined, current.scope)).toEqual({ result: "current", trace: [] });
      expect(() => h.attachPreparedAuthoringWorker({} as ModuleRegistry, stale, h.baseSession({} as ModuleRegistry))).toThrow("unavailable");
    } finally { h.disposePreparedAuthoringWorkers(); }
  });

  test("account overlays and saved references retain their reader and completed data", async () => {
    const h = harness();
    try {
      const left = await h.reader("left", "left result"), right = await h.reader("right", "right result");
      const saved = new Map([["saved", call("fixture:answer")]]);
      const node: ExprNode = { kind: "ref", savedExprId: "saved" };
      expect(await h.evaluateExpressionInWorker(left.session, node, saved, undefined, left.scope)).toEqual({ result: "left result", trace: [] });
      expect(await h.evaluateExpressionInWorker(right.session, node, saved, undefined, right.scope)).toEqual({ result: "right result", trace: [] });
      const data = { $tag: "FixtureData", marker: { __record: { fields: [] } }, bytes: new Uint8Array([4, 9]) };
      const output = await h.evaluateExpressionInWorker(left.session, call("fixture:identity", literal(data)), new Map(), undefined, left.scope);
      expect(output).toEqual({ result: data, trace: [] });
      expect((output!.result as typeof data).bytes).toBeInstanceOf(Uint8Array);
      expect(data.bytes.byteLength).toBe(2);
    } finally { h.disposePreparedAuthoringWorkers(); }
  });

  test("opt-in capture returns exact repeated-name sites from one root worker run", async () => {
    const h = harness();
    try {
      const reader = await h.reader("reader", "current");
      const first = call("fixture:identity", literal("first"));
      const second = call("fixture:identity", literal("second"));
      const root = literal({ __list: [first, second] });
      const output = await h.evaluateExpressionInWorker(reader.session, root, new Map(), undefined, reader.scope, { capture: true });
      const sites = authoringExpressionSites(root, undefined, reader.session).sites;
      expect(output!.result).toEqual(["first", "second"]);
      expect(output!.trace).toEqual([]);
      expect(output!.captures?.find(capture => capture.site === sites.findIndex(site => site.node === first))?.value).toBe("first");
      expect(output!.captures?.find(capture => capture.site === sites.findIndex(site => site.node === second))?.value).toBe("second");
      expect(h.evaluations()).toBe(1);
      expect(reader.worker.sent.filter(request => request.method === "evaluate-expression")).toHaveLength(1);
      const other = await h.reader("other", "other result");
      const answer = call("fixture:answer");
      const left = await h.evaluateExpressionInWorker(reader.session, answer, new Map(), undefined, reader.scope, { capture: true });
      const right = await h.evaluateExpressionInWorker(other.session, answer, new Map(), undefined, other.scope, { capture: true });
      expect(left!.captures?.[0]?.value).toBe("current");
      expect(right!.captures?.[0]?.value).toBe("other result");
    } finally { h.disposePreparedAuthoringWorkers(); }
  });

  test("capture unless-sampled records an ordinary run and leaves a sampled-media run unrecorded (B4 wave 4 lane S)", async () => {
    // The worker reads a copy of the request: mark the media root by content.
    const h = harness({ sampled: node => node.kind === "call" && node.args[0]?.kind === "literal" && node.args[0].value === "media" });
    try {
      const reader = await h.reader("reader", "current");
      const ordinary = call("fixture:identity", literal("ordinary"));
      const recorded = await h.evaluateExpressionInWorker(reader.session, ordinary, new Map(), undefined, reader.scope, { capture: "unless-sampled" });
      expect(recorded!.result).toBe("ordinary");
      expect(recorded!.captures?.length).toBeGreaterThan(0);
      const media = call("fixture:identity", literal("media"));
      const plain = await h.evaluateExpressionInWorker(reader.session, media, new Map(), undefined, reader.scope, { capture: "unless-sampled" });
      expect(plain!.result).toBe("media");
      expect(plain!.captures).toBeUndefined();
      // An explicit capture still records, whatever the media facts.
      const explicit = await h.evaluateExpressionInWorker(reader.session, media, new Map(), undefined, reader.scope, { capture: true });
      expect(explicit!.captures?.length).toBeGreaterThan(0);
      const requests = reader.worker.sent.filter(request => request.method === "evaluate-expression") as Array<{ capture?: unknown }>;
      expect(requests.map(request => request.capture)).toEqual(["unless-sampled", "unless-sampled", true]);
    } finally { h.disposePreparedAuthoringWorkers(); }
  });

  test("a public session never selects an existing private worker", async () => {
    const h = harness();
    try {
      const privateReader = await h.reader("private", "secret");
      const publicSession = h.baseSession({} as ModuleRegistry);
      expect(h.authoringWorkerSnapshot(publicSession)).toBeUndefined();
      expect(h.evaluateExpressionInWorker(publicSession, call("fixture:answer"), new Map())).toBeUndefined();
      expect(privateReader.worker.sent.filter(request => request.method === "evaluate-expression")).toHaveLength(0);
      expect(h.evaluations()).toBe(0);
    } finally { h.disposePreparedAuthoringWorkers(); }
  });

  test("abort, retired snapshots and clone failures reject without a synchronous rerun", async () => {
    const h = harness();
    try {
      const reader = await h.reader("reader", "current");
      h.hold(true);
      const abort = new AbortController();
      const pending = h.evaluateExpressionInWorker(reader.session, call("fixture:answer"), new Map(), abort.signal, reader.scope)!;
      void pending.catch(() => {});
      abort.abort(new Error("Cancelled by test"));
      await expect(pending).rejects.toThrow("Cancelled by test");
      expect(h.evaluations()).toBe(0);
      h.hold(false);
      await expect(h.evaluateExpressionInWorker(reader.session, literal(() => "not data"), new Map(), undefined, reader.scope)!).rejects.toThrow();
      expect(h.evaluations()).toBe(0);
      await expect(h.evaluateExpressionInWorker(reader.session, call("fixture:uncloneable"), new Map(), undefined, reader.scope)!).rejects.toThrow();
      expect(h.evaluations()).toBe(1);
      h.discardPreparedAuthoringWorker(reader.registry);
      expect(() => h.authoringWorkerSnapshot(reader.session)).toThrow("replaced");
      await expect(h.evaluateExpressionInWorker(reader.session, call("fixture:answer"), new Map(), undefined, reader.scope)!).rejects.toThrow("replaced");
      expect(h.evaluations()).toBe(1);
    } finally { h.disposePreparedAuthoringWorkers(); }
  });

  test("an evaluation deadline retires its worker without evaluating on the input thread", async () => {
    const h = harness();
    try {
      const reader = await h.reader("reader", "current");
      h.hold(true);
      const pending = h.evaluateExpressionInWorker(reader.session, call("fixture:answer"), new Map(), undefined, reader.scope)!;
      void pending.catch(() => {});
      h.expireRequests();
      await expect(pending).rejects.toThrow("took too long");
      expect(h.evaluations()).toBe(0);
      expect(reader.worker.terminated).toBe(true);
    } finally { h.disposePreparedAuthoringWorkers(); }
  });

  test("a completed result from an earlier authentication epoch is refused", async () => {
    const h = harness();
    try {
      const reader = await h.reader("reader", "old data");
      h.hold(true);
      const pending = h.evaluateExpressionInWorker(reader.session, call("fixture:answer"), new Map(), undefined, reader.scope)!;
      void pending.catch(() => {});
      h.advanceEpoch();
      expect(() => h.authoringWorkerSnapshot(reader.session)).toThrow("Stale session");
      reader.worker.release();
      await expect(pending).rejects.toThrow("Stale session");
      expect(h.evaluations()).toBe(1);
    } finally { h.disposePreparedAuthoringWorkers(); }
  });

  test("snapshot inspection is inert and a replacement client invalidates the cache stamp", async () => {
    const h = harness();
    try {
      const reader = await h.reader("reader", "current");
      const before = h.authoringWorkerSnapshot(reader.session);
      expect(before).toBeDefined();
      expect(h.authoringWorkerSnapshot(reader.session)).toBe(before);
      expect(reader.worker.sent.filter(request => request.method === "evaluate-expression")).toHaveLength(0);
      const nextCatalog = await h.prepareCatalogInWorker("reader", { owners: [], fields: [], facets: [] }, [], [], { independent: true });
      h.attachPreparedAuthoringWorker(reader.registry, nextCatalog, h.baseSession(reader.registry));
      expect(h.authoringWorkerSnapshot(reader.session)).not.toBe(before);
      expect(h.evaluations()).toBe(0);
    } finally { h.disposePreparedAuthoringWorkers(); }
  });
});

describe("Save admission in the exact reader worker keeps page parity", () => {
  // B4 slice 1. The page's `draftSaveIssue` (and, for `evaluate`, its own
  // evaluation) is the oracle; the worker answer crosses the real client,
  // structured-clone transport and production worker branch.
  const number: FenelType = { $ref: "Number" };
  const maybe = Maybe(number);
  const valueParam: FieldDef = { name: "_0", key: { $tag: "PositionalField", index: 0 }, type: number, label: Nothing, ui: Nothing, meta: {} };
  const radius: FenelType = { $refined: { base: number, set: { $tag: "SeInterval", interval: {
    lo: Just({ value: 2, inclusive: true }), hi: Just({ value: 12, inclusive: true }) } } } };
  const bounded = { ...valueParam, type: radius };
  const parityEnvironment = createAuthoringEnvironment({ types: [], functions: [{
    id: "test:wrap", targetId: "test:wrap", label: "wrap", description: "", kind: "function",
    params: [valueParam], returns: maybe, scheme: { quantified: [], body: { $arrow: { params: [valueParam], returns: maybe } } },
    signatureOutcome: { $tag: "Solved" },
  }, {
    id: "test:bounded", targetId: "test:bounded", label: "bounded", description: "", kind: "function",
    params: [bounded], returns: number, scheme: { quantified: [], body: { $arrow: { params: [bounded], returns: number } } },
    signatureOutcome: { $tag: "Solved" },
  }], capabilities: [], catalogTypes: [], operatorCodeNameByNotation: new Map() });
  const one: FenelType = { $refined: { base: number, set: { $tag: "SeEnum", values: [1] } } };
  type Options = Parameters<typeof draftSaveIssue>[2] & { evaluate?: boolean };
  const declared = restoreSavedExpressionDeclaration(literal(2), { type: number });
  // A saved alias declared callable that no longer evaluates to a callable:
  // only its restored declaration lets the evaluation refuse.
  const declaredCallable = restoreSavedExpressionDeclaration(literal(2),
    { scheme: { quantified: [], body: { $arrow: { params: [valueParam], returns: number } } } });
  const saved = new Map<string, ExprNode>([["one", literal(1)], ["two", literal(2)], ["declared", declared], ["text", literal("hello")], ["declared-callable", declaredCallable]]);
  const cases: Array<{ name: string; node: ExprNode; options: Options; expect: (issue: string | undefined) => void }> = [
    { name: "an Invalid inference diagnostic", node: call("test:wrap", literal("wrong")), options: { expectedType: maybe },
      expect: issue => expect(issue).toBeDefined() },
    { name: "a literal-membership mismatch with the selected type name", node: literal(3),
      options: { expectedType: { $ref: "String" }, expectedTypeName: "String" }, expect: issue => expect(issue).toContain("Finish with String") },
    { name: "an empty slot", node: literal({ __record: { fields: [{ name: "x", value: literal(undefined) }] } }), options: {},
      expect: issue => expect(issue).toContain("Complete the empty value slots") },
    { name: "a Solved result incompatible with the expected scheme", node: literal(2),
      options: { expectedType: maybe, expectedScheme: { quantified: [], body: maybe }, expectedTypeName: "Maybe" }, expect: issue => expect(issue).toBeDefined() },
    { name: "an undecided relationship admits", node: literal(1), options: { expectedType: { $ref: "UnknownAccountType" } },
      expect: issue => expect(issue).toBeUndefined() },
    { name: "an evaluated saved reference against a refinement stays undecided in a frame without validators", node: { kind: "ref", savedExprId: "two" },
      options: { expectedType: one, evaluate: true }, expect: issue => expect(issue).toBeUndefined() },
    { name: "a refined membership admission through evaluation", node: { kind: "ref", savedExprId: "one" }, options: { expectedType: one, evaluate: true },
      expect: issue => expect(issue).toBeUndefined() },
    { name: "a refined call argument with an evaluated result", node: call("test:bounded", literal(13)), options: { expectedType: number, evaluate: true },
      expect: issue => expect(issue).toContain("refinement") },
    { name: "a saved reference through its declaration", node: { kind: "ref", savedExprId: "declared" }, options: { expectedType: number, evaluate: true },
      expect: () => {} },
    { name: "a saved reference whose callable declaration no longer holds", node: { kind: "ref", savedExprId: "declared-callable" },
      options: { expectedType: number, evaluate: true }, expect: () => {} },
    { name: "a saved text reference against a Number target", node: { kind: "ref", savedExprId: "text" }, options: { expectedType: number, evaluate: true },
      expect: issue => expect(issue).toBeDefined() },
    { name: "a binding-name issue", node: literal({ __where: { body: { kind: "param", name: "x" },
      bindings: [{ name: "x", expr: literal(1) }, { name: "x", expr: literal(2) }] } }), options: {},
      expect: issue => expect(issue).toContain("x is repeated in this scope") },
    { name: "a Bytes literal", node: literal(new Uint8Array([1, 2, 3])), options: { expectedType: number, evaluate: true },
      expect: issue => expect(issue).toBeDefined() },
    { name: "a Date literal", node: literal(new Date(0)), options: { expectedType: number, evaluate: true },
      expect: issue => expect(issue).toBeDefined() },
  ];

  async function prepared() {
    const h = harness({ environment: parityEnvironment });
    const registry = {} as ModuleRegistry, base = h.baseSession(registry);
    const catalog = await h.prepareCatalogInWorker("parity", { owners: [], fields: [], facets: [] }, [], [], { independent: true });
    h.attachPreparedAuthoringWorker(registry, catalog, base);
    // The worker's account frame for this fixture (`evaluateContextForCatalog`).
    const page = { ...base, registry: {} as ModuleRegistry, evaluateContext: { natives: {} } } as unknown as AuthoringSession;
    return { h, base, page };
  }
  // B4 fix round: a Local reader's scoped frame. Its user function and the
  // `Scores` alias exist only in the Local scope/registry, so a worker that
  // answered from its unscoped base context would answer differently.
  const hot: FenelType = { $refined: { base: number, set: { $tag: "SeInterval", interval: {
    lo: Just({ value: 20, inclusive: true }), hi: Just({ value: 30, inclusive: true }) } } } };
  const localScope = { sourceId: "tab", functions: [{ id: "tab:hot", params: [], returns: hot, body: 25 }] };
  const localRegistry = {
    evaluateAuthorityFunction: (name: string) => name === "authority:emptyEnvelope" ? { $void: true } : Nothing,
    getIdentifiedEntity: (name: string) => name === "Scores" ? { id: "Scores", type: List(number) } : undefined,
  };
  async function preparedLocal() {
    const h = harness({ environment: parityEnvironment, localRegistry });
    const registry = localRegistry as unknown as ModuleRegistry, base = h.baseSession(registry);
    const catalog = await h.prepareCatalogInWorker(undefined, { owners: [], fields: [], facets: [] }, [], [],
      { independent: true, localSourceId: "tab" });
    h.attachPreparedAuthoringWorker(registry, catalog, base);
    const session = createLocalAuthoringSession(base, localScope as never);
    const page = createLocalAuthoringSession({ ...base, evaluateContext: { natives: {} } } as unknown as AuthoringSession, localScope as never);
    return { h, session, page };
  }
  const localCases: Array<{ name: string; node: ExprNode; options: Options & { expectedListType?: FenelType }; expect: (issue: string | undefined) => void }> = [
    { name: "a Local user function's refined result passed to a narrower parameter", node: call("test:bounded", call("tab:hot")),
      options: { expectedType: number }, expect: issue => expect(issue).toContain("refinement") },
    { name: "a Local user function's refined result against another refinement", node: call("tab:hot"),
      options: { expectedType: radius }, expect: issue => expect(issue).toBeDefined() },
    { name: "a destination list alias peeled with the Local registry", node: literal("text"),
      options: { expectedListType: { $ref: "Scores" } }, expect: issue => expect(issue).toContain("Finish with Number") },
  ];
  for (const entry of localCases) test(`Local scope: ${entry.name}: the worker answer equals the page answer`, async () => {
    const { h, session, page } = await preparedLocal();
    try {
      const { expectedListType, ...options } = entry.options;
      const resolveSavedExpr = (id: string) => saved.get(id);
      // The page oracle peels the list type exactly as Home did before B4.
      const element = expectedListType && peelListForAuthoring(resolveValueType(expectedListType,
        name => (page.registry as unknown as typeof localRegistry).getIdentifiedEntity(name)?.type))?.elem;
      const pageAnswer = outcome(() => draftSaveIssue(entry.node, page.environment, { ...options,
        ...(element ? { expectedType: element } : {}), registry: page.registry, evaluateContext: page.evaluateContext, resolveSavedExpr }));
      const workerAnswer = await h.expressionSaveIssueInWorker(session, entry.node, saved,
        { ...options as Record<string, unknown>, ...(expectedListType ? { expectedListType } : {}) })!
        .then(reply => ({ issue: reply.issue }), (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }));
      expect(workerAnswer).toEqual(pageAnswer);
      if ("error" in pageAnswer) throw new Error(pageAnswer.error);
      entry.expect(pageAnswer.issue);
      const sent = h.workers.at(-1)!.sent.find(request => request.method === "expression-save-issue")!;
      expect((sent as { scope?: { sourceId?: string } }).scope?.sourceId).toBe("tab");
    } finally { h.disposePreparedAuthoringWorkers(); }
  });

  const outcome = (run: () => string | undefined) => {
    try { return { issue: run() }; } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  };

  for (const entry of cases) test(`${entry.name}: the worker answer equals the page answer`, async () => {
    const { h, base, page } = await prepared();
    try {
      const { evaluate, ...options } = entry.options;
      const resolveSavedExpr = (id: string) => saved.get(id);
      const pageAnswer = outcome(() => draftSaveIssue(entry.node, page.environment, { ...options, registry: page.registry,
        evaluateContext: page.evaluateContext, resolveSavedExpr,
        ...(evaluate ? { evaluatedValue: evaluateAuthoringExpressionInSession(entry.node, resolveSavedExpr, page, {}, { trace: false }).result } : {}) }));
      const workerAnswer = await h.expressionSaveIssueInWorker(base, entry.node, saved, { ...options as Record<string, unknown>, ...(evaluate ? { evaluate } : {}) })!
        .then(reply => ({ issue: reply.issue }), (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }));
      expect(workerAnswer).toEqual(pageAnswer);
      if (entry.name.includes("callable declaration")) expect(pageAnswer).toEqual({ error: "This saved function no longer evaluates to a callable value." });
      if ("error" in pageAnswer) expect(entry.name).toContain("declaration");
      else entry.expect(pageAnswer.issue);
      const sent = h.workers.at(-1)!.sent.find(request => request.method === "expression-save-issue")!;
      expect(sent).toBeDefined();
      expect(Object.hasOwn(sent, "evaluate")).toBe(evaluate === true);
    } finally { h.disposePreparedAuthoringWorkers(); }
  });

  test("Bytes and Date literals cross intact, and the evaluated value never crosses back", async () => {
    const { h, base } = await prepared();
    try {
      for (const value of [new Uint8Array([4, 9]), new Date(86_400_000)]) {
        await h.expressionSaveIssueInWorker(base, literal(value), saved, { expectedType: number, evaluate: true });
        const sent = h.workers.at(-1)!.sent.filter(request => request.method === "expression-save-issue").at(-1)!;
        expect((sent as unknown as { node: { value: unknown } }).node.value).toEqual(value);
        const reply = h.workers.at(-1)!.replies.at(-1)!;
        expect(reply.ok).toBe(true);
        expect(Object.keys((reply as { result: object }).result).every(key => key === "issue")).toBe(true);
      }
    } finally { h.disposePreparedAuthoringWorkers(); }
  });

  test("an uncloneable request, a retired reader or a stale epoch refuses without evaluating", async () => {
    const { h, base } = await prepared();
    try {
      await expect((async () => h.expressionSaveIssueInWorker(base, literal(() => "host callable"), saved, { evaluate: true }))()).rejects.toThrow();
      h.advanceEpoch();
      await expect((async () => h.expressionSaveIssueInWorker(base, literal(1), saved, {}))()).rejects.toThrow();
      expect(h.evaluations()).toBe(0);
    } finally { h.disposePreparedAuthoringWorkers(); }
  });

  // B4 slice 2: live guidance. The page oracle is the editor's own inference
  // context (literal-witness inference with the page's membership judge) and
  // the shared result judgment; for checked evaluation, the page's evaluation
  // followed by its `draftSaveIssue` of that value.
  const ground = (body: FenelType) => ({ quantified: [], body });
  const pageInference = (page: AuthoringSession, item: ExpressionInferenceItem) => {
    const context = { ...page.environment, literalMembership: literalMembershipFor(page.environment,
      { registry: page.registry, evaluateContext: page.evaluateContext }), bindings: item.bindings ?? {}, resolveSavedExpr: (id: string) => saved.get(id) };
    const result = inferAuthoringExpressionWithLiteralWitnesses(item.node, context, item.expectedScheme ? { expectedScheme: item.expectedScheme } : {});
    return { outcome: result.outcome, type: result.type, scheme: result.scheme,
      ...(item.judge ? { judgment: judgeAuthoringResult(item.node, item.judge.expected, item.judge.scheme, item.judge.label, result, page) } : {}) };
  };
  const inferenceCases: Array<{ name: string; item: ExpressionInferenceItem; expect: (reply: ReturnType<typeof pageInference>) => void }> = [
    { name: "a Solved compatible result", item: { node: call("test:wrap", literal(2)), expectedScheme: ground(maybe),
      judge: { expected: maybe, scheme: ground(maybe), label: "Maybe" } },
      expect: reply => { expect(reply.outcome.$tag).toBe("Solved"); expect(reply.judgment?.mismatch).toBe(false); } },
    { name: "a Solved incompatible result with its message", item: { node: { kind: "ref", savedExprId: "text" },
      judge: { expected: number, label: "Number" } },
      expect: reply => { expect(reply.judgment?.mismatch).toBe(true); expect(reply.judgment?.message).toBeDefined(); } },
    { name: "an Invalid diagnostic", item: { node: call("test:wrap", literal("wrong")), judge: { expected: maybe, label: "Maybe" } },
      expect: reply => { expect(reply.outcome.$tag).toBe("Invalid"); expect(reply.judgment?.mismatch).toBe(true); } },
    { name: "an undecided requirement stays no-issue", item: { node: literal(1), judge: { expected: { $ref: "UnknownAccountType" }, label: "UnknownAccountType" } },
      expect: reply => { expect(reply.judgment?.mismatch).toBe(false); expect(reply.judgment?.message).toBeUndefined(); } },
    { name: "a literal witness against a refined parameter", item: { node: call("test:bounded", literal(13)) },
      expect: reply => expect(reply.outcome.$tag).toBe("Invalid") },
    { name: "lambda bindings", item: { node: { kind: "param", name: "x" }, bindings: { x: number } },
      expect: reply => { expect(reply.outcome.$tag).toBe("Solved"); expect(reply.type).toEqual(number); } },
    { name: "an annotation", item: { node: literal({ __ann: { expr: literal(2), type: number } }) },
      expect: reply => expect(reply.outcome.$tag).toBe("Solved") },
  ];
  test("infer-expression: every corpus item in one batch equals the page's inference and judgment", async () => {
    const { h, base, page } = await prepared();
    try {
      const replies = await h.inferExpressionsInWorker(base, inferenceCases.map(entry => entry.item), saved, { priority: "guidance" })!;
      expect(replies).toHaveLength(inferenceCases.length);
      inferenceCases.forEach((entry, index) => {
        const oracle = pageInference(page, entry.item);
        expect({ name: entry.name, reply: replies[index] }).toEqual({ name: entry.name, reply: oracle });
        entry.expect(oracle);
      });
      const sent = h.workers.at(-1)!.sent.filter(request => request.method === "infer-expression");
      expect(sent).toHaveLength(1);
      expect((sent[0] as { priority?: string }).priority).toBe("guidance");
      // Only the saved sources the items read cross, once for the batch.
      expect((sent[0] as unknown as { savedExpressions: Array<[string]> }).savedExpressions.map(([id]) => id)).toEqual(["text"]);
    } finally { h.disposePreparedAuthoringWorkers(); }
  });
  test("latency: live inference on an idle worker, post to reply (reported)", async () => {
    const { h, base } = await prepared();
    try {
      const judge = { expected: maybe, scheme: ground(maybe), label: "Maybe" };
      await h.inferExpressionsInWorker(base, [inferenceCases[0]!.item], saved)!;
      const measure = async (size: number, rounds: number) => {
        const samples: number[] = [];
        for (let round = 0; round < rounds; round++) {
          const items = Array.from({ length: size }, (_, index) => ({ node: call("test:wrap", literal(round * 100 + index)), judge }));
          const started = performance.now();
          await h.inferExpressionsInWorker(base, items, saved, { priority: "guidance" })!;
          samples.push(performance.now() - started);
        }
        samples.sort((a, b) => a - b);
        return { median: samples[Math.floor(rounds / 2)]!.toFixed(1), p90: samples[Math.floor(rounds * 0.9)]!.toFixed(1) };
      };
      // An edited path (the edited node and two ancestors) is its own batch.
      const one = await measure(1, 15), path = await measure(3, 15), batch = await measure(64, 5);
      console.log(`[b4g] live inference post->reply on an idle in-process worker: 1 item median ${one.median} ms (p90 ${one.p90}); edited path of 3 items median ${path.median} ms (p90 ${path.p90}); 64 items median ${batch.median} ms (p90 ${batch.p90})`);
    } finally { h.disposePreparedAuthoringWorkers(); }
  }, 180_000);
  test("infer-expression in a Local scope answers with the scoped environment, and a scope mismatch would show", async () => {
    const { h, session, page } = await preparedLocal();
    try {
      // tab:hot exists only in the reader's Local scope.
      const item: ExpressionInferenceItem = { node: call("tab:hot"), judge: { expected: radius, label: "Radius" } };
      const [reply] = await h.inferExpressionsInWorker(session, [item], saved, { priority: "guidance" })!;
      const scoped = pageInference(page, item);
      const unscoped = pageInference({ ...page, environment: parityEnvironment } as AuthoringSession, item);
      expect(reply).toEqual(scoped);
      expect(scoped).not.toEqual(unscoped);
      const sent = h.workers.at(-1)!.sent.find(request => request.method === "infer-expression")!;
      expect((sent as { scope?: { sourceId?: string } }).scope?.sourceId).toBe("tab");
    } finally { h.disposePreparedAuthoringWorkers(); }
  });
  // B4 F2: the saved-value picker's compatibility filter, judged in the worker.
  test("infer-expression with compatibility equals the page's judgment of the inferred scheme", async () => {
    const { h, base, page } = await prepared();
    try {
      const wanted: FenelType[] = [maybe, number, { $ref: "String" }];
      const nodes: ExprNode[] = [literal(2), literal("text"), call("test:wrap", literal(2)), { kind: "ref", savedExprId: "one" }];
      const items: ExpressionInferenceItem[] = nodes.flatMap(node => wanted.map(expected => ({ node, expectedScheme: ground(expected), compatibility: expected })));
      const replies = await h.inferExpressionsInWorker(base, items, saved)!;
      const verdicts = items.map(item => {
        // The page's judgment with its registry; one it cannot compute (this
        // fixture's registry knows no named type) abstains, as in the worker.
        const scheme = pageInference(page, item).scheme;
        if (scheme === undefined) return "unknown";
        try { return judgeAuthoringSchemeCompatibility(scheme, item.compatibility!, { registry: page.registry }); }
        catch { return "unknown"; }
      });
      expect(replies.map(reply => reply.compatibility)).toEqual(verdicts);
      expect(verdicts).toContain("compatible");
      expect(verdicts.some(verdict => verdict !== "compatible")).toBe(true);
      // Without the field the reply carries no verdict (slice 2 unchanged).
      const [plain] = await h.inferExpressionsInWorker(base, [{ node: literal(2) }], saved)!;
      expect(Object.hasOwn(plain!, "compatibility")).toBe(false);
    } finally { h.disposePreparedAuthoringWorkers(); }
  });
  // B4 F2: a Local live trace asks the worker for the same run's trace steps.
  test("evaluate-expression with trace returns the page's trace; without it, none", async () => {
    const { h, base, page } = await prepared();
    try {
      let steps = 0;
      for (const node of [call("test:bounded", literal(13)), { kind: "ref", savedExprId: "one" } as ExprNode, literal(4)]) {
        const resolve = (id: string) => saved.get(id);
        const pageRun = outcome(() => JSON.stringify(evaluateAuthoringExpressionInSession(node, resolve, page)));
        const traced = await h.evaluateExpressionInWorker(base, node, saved, undefined, undefined, { trace: true })!
          .then(reply => ({ issue: JSON.stringify({ result: reply.result, trace: reply.trace }) }),
            (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }));
        expect(traced as unknown).toEqual(pageRun);
        if (pageRun.issue) steps += (JSON.parse(pageRun.issue) as { trace: unknown[] }).trace.length;
        const plain = await h.evaluateExpressionInWorker(base, node, saved)!.catch(() => undefined);
        if (plain) expect(plain.trace).toEqual([]);
      }
      expect(steps).toBeGreaterThan(0);
      const sent = h.workers.at(-1)!.sent.filter(request => request.method === "evaluate-expression");
      expect(sent.filter(request => (request as { trace?: true }).trace === true)).toHaveLength(3);
    } finally { h.disposePreparedAuthoringWorkers(); }
  });
  test("infer-expression refuses more than 64 items before sending", async () => {
    const { h, base } = await prepared();
    try {
      const items = Array.from({ length: 65 }, () => ({ node: literal(1) }));
      await expect(h.inferExpressionsInWorker(base, items, saved)!).rejects.toThrow("Too many live inference items");
      expect(h.workers.at(-1)!.sent.some(request => request.method === "infer-expression")).toBe(false);
    } finally { h.disposePreparedAuthoringWorkers(); }
  });

  const admissionCases: Array<{ name: string; node: ExprNode; admission: { expectedType?: FenelType; expectedTypeName?: string };
    expect: (issue: string | undefined) => void }> = [
    { name: "a refined call argument", node: call("test:bounded", literal(13)), admission: { expectedType: number },
      expect: issue => expect(issue).toContain("refinement") },
    { name: "a saved text reference against Number", node: { kind: "ref", savedExprId: "text" }, admission: { expectedType: number },
      expect: issue => expect(issue).toBeDefined() },
    { name: "a refined membership admission", node: { kind: "ref", savedExprId: "one" }, admission: { expectedType: one },
      expect: issue => expect(issue).toBeUndefined() },
    { name: "a literal against the selected type name", node: literal(3), admission: { expectedType: { $ref: "String" }, expectedTypeName: "String" },
      expect: issue => expect(issue).toContain("Finish with String") },
    { name: "an undecided relationship stays no-issue", node: literal(1), admission: { expectedType: { $ref: "UnknownAccountType" } },
      expect: issue => expect(issue).toBeUndefined() },
  ];
  for (const entry of admissionCases) test(`evaluate-expression with admission: ${entry.name} equals the page's value and issue`, async () => {
    const { h, base, page } = await prepared();
    try {
      const resolveSavedExpr = (id: string) => saved.get(id);
      const value = evaluateAuthoringExpressionInSession(entry.node, resolveSavedExpr, page, {}, { trace: false }).result;
      const issue = draftSaveIssue(entry.node, page.environment, { ...entry.admission, registry: page.registry,
        evaluateContext: page.evaluateContext, resolveSavedExpr, evaluatedValue: value });
      const reply = await h.evaluateExpressionInWorker(base, entry.node, saved, undefined, undefined,
        { admission: entry.admission, priority: "guidance" })!;
      expect({ result: reply.result, issue: reply.issue }).toEqual({ result: value, issue });
      entry.expect(issue);
      const sent = h.workers.at(-1)!.sent.filter(request => request.method === "evaluate-expression").at(-1)!;
      expect((sent as { admission?: unknown }).admission).toEqual(entry.admission);
    } finally { h.disposePreparedAuthoringWorkers(); }
  });
  // B4 slice 2 fix round: the page's Inspection body check passed a saved
  // resolver inside its environment, but `functionBodySaveIssue` never reads
  // it (the signature path lowers without a resolver; the legacy path's
  // `draftSaveIssue` takes the resolver from its options). The worker's
  // unchanged operation therefore already answers exactly as the page did.
  const signatureDefinition = { id: "inspect-body", params: [], returns: number, body: 1, signatureDeclaration: {
    functionId: "inspect-body", declarationName: "inspectBody", codeName: "inspectBody", params: [],
    returns: { $tag: "Authored", source: { $tag: "HostSpec", module: "inspection-fixture" } },
    scheme: { quantified: [], body: { $arrow: { params: [], returns: number } } } } };
  const legacyDefinition = { id: "inspect-body", params: [], returns: number, body: 1 };
  for (const [name, node] of [["a saved text reference", { kind: "ref", savedExprId: "text" }],
    ["a saved number reference", { kind: "ref", savedExprId: "two" }],
    ["a call over a saved reference", call("test:wrap", { kind: "ref", savedExprId: "text" })]] as Array<[string, ExprNode]>)
  for (const [kind, bodyDefinition] of [["declared signature", signatureDefinition], ["legacy", legacyDefinition]] as const)
  test(`function-body-save-issue (${kind}): ${name} answers as the page's Inspection check did`, async () => {
    const { h, base, page } = await prepared();
    try {
      const resolveSavedExpr = (id: string) => saved.get(id);
      const pageIssue = functionBodySaveIssue(node, bodyDefinition as never, { ...page.environment, resolveSavedExpr },
        { registry: page.registry, evaluateContext: page.evaluateContext });
      const reply = await h.runAuthoringWorker(base, { method: "function-body-save-issue", node, definition: bodyDefinition as never })! as { issue?: string };
      expect(reply.issue).toBe(pageIssue);
    } finally { h.disposePreparedAuthoringWorkers(); }
  });

  test("evaluate-expression with admission: a Local list alias is peeled with the Local registry", async () => {
    const { h, session, page } = await preparedLocal();
    try {
      const node = literal("text");
      const element = peelListForAuthoring(resolveValueType({ $ref: "Scores" },
        name => (page.registry as unknown as typeof localRegistry).getIdentifiedEntity(name)?.type))?.elem;
      const issue = draftSaveIssue(node, page.environment, { expectedType: element, registry: page.registry,
        evaluateContext: page.evaluateContext, resolveSavedExpr: id => saved.get(id), evaluatedValue: "text" });
      const reply = await h.evaluateExpressionInWorker(session, node, saved, undefined, undefined,
        { admission: { expectedListType: { $ref: "Scores" } }, priority: "guidance" })!;
      expect(reply.issue).toBe(issue);
      expect(issue).toContain("Finish with Number");
    } finally { h.disposePreparedAuthoringWorkers(); }
  });

  // B4 unit C: a Local reader's saved sources are lowered in its worker. The
  // page session handed to the client is a facade whose registry, evaluator,
  // catalogue and environment all throw; routing still reaches the concrete
  // session. The page's former selection (`authoringExpressionSourceEntries`
  // with a working page session) is the oracle for what the worker selects.
  const library = new Map<string, ExprNode>([...saved,
    ["via", call("test:wrap", { kind: "ref", savedExprId: "one" })],
    ["chain", call("test:bounded", { kind: "ref", savedExprId: "via" })],
    ["unused", call("test:bounded", literal(3))]]);
  function throwingFacade(session: AuthoringSession) {
    const reads: string[] = [];
    const refuse = (key: string) => { reads.push(key); throw new Error(`Page ${key} read for a Local reader`); };
    const facade = {
      get mode() { return session.mode; }, get sourceModule() { return session.sourceModule; },
      get registry() { return refuse("registry"); }, get catalog() { return refuse("catalog"); },
      get environment() { return refuse("environment"); }, get evaluateContext() { return refuse("evaluateContext"); },
      get captureSourceMetadata() { return undefined; },
    } as unknown as AuthoringSession;
    registerAuthoringSessionFacade(facade, () => session);
    return { facade, reads };
  }
  const unitCNodes: Array<[string, ExprNode]> = [
    ["a saved source holding a call over another saved source", { kind: "ref", savedExprId: "via" }],
    ["a call over a two-step saved chain", call("test:wrap", { kind: "ref", savedExprId: "chain" })],
    ["a Local user function", call("tab:hot")],
    ["a declared saved source", { kind: "ref", savedExprId: "declared" }],
    ["a saved source whose callable declaration no longer holds", { kind: "ref", savedExprId: "declared-callable" }],
    ["no saved source", literal(2)],
  ];
  const sentOf = (h: ReturnType<typeof harness>, method: string) =>
    h.workers.at(-1)!.sent.filter(request => request.method === method).at(-1) as unknown as
      { savedExpressions: Array<[string]>; savedDeclarations?: Array<[string]>; selectSavedSources?: true };
  for (const [name, node] of unitCNodes) test(`unit C, Local: ${name}: Save admission lowers in the worker, never the page`, async () => {
    const { h, session, page } = await preparedLocal();
    try {
      const { facade, reads } = throwingFacade(session);
      const resolveSavedExpr = (id: string) => library.get(id);
      const pageAnswer = outcome(() => draftSaveIssue(node, page.environment, { expectedType: number, registry: page.registry,
        evaluateContext: page.evaluateContext, resolveSavedExpr }));
      const workerAnswer = await h.expressionSaveIssueInWorker(facade, node, library, { expectedType: number })!
        .then(reply => ({ issue: reply.issue }), (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }));
      expect(workerAnswer).toEqual(pageAnswer);
      expect(reads).toEqual([]);
      const sent = sentOf(h, "expression-save-issue");
      expect(sent.selectSavedSources).toBe(true);
      // B4 unit C fix: only the sources the node reaches travel (never the
      // whole library); the worker's own lowering selects among them.
      const worker = authoringExpressionSourceEntries(node, library, page).map(([id]) => id);
      expect(new Set(sent.savedExpressions.map(([id]) => id))).toEqual(new Set(worker));
      expect(sent.savedExpressions.some(([id]) => id === "unused" || id === "text")).toBe(false);
      expect(h.workerSelections.at(-1)).toEqual(authoringExpressionSourceEntries(node, library, page).map(([id]) => id));
    } finally { h.disposePreparedAuthoringWorkers(); }
  });
  test("unit C, Local: evaluation keeps only the reached declarations, as the page's selection did", async () => {
    const { h, session, page } = await preparedLocal();
    try {
      const { facade, reads } = throwingFacade(session);
      for (const node of [{ kind: "ref", savedExprId: "one" } as ExprNode, { kind: "ref", savedExprId: "declared-callable" } as ExprNode]) {
        const selected = authoringExpressionSourceEntries(node, library, page);
        const workerAnswer = await h.evaluateExpressionInWorker(facade, node, library)!
          .then(reply => ({ value: reply.result }), (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }));
        // The page's former request: only the selected sources and their declarations.
        const declarations = savedExpressionDeclarationEntries(selected);
        const pageRequest = await h.runAuthoringWorker(session, { method: "evaluate-expression", node, savedExpressions: selected,
          ...(declarations.length ? { savedDeclarations: declarations } : {}) })!
          .then(reply => ({ value: (reply as { result: unknown }).result }), (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }));
        expect(workerAnswer).toEqual(pageRequest);
        expect(h.workerSelections.at(-1)).toEqual(selected.map(([id]) => id));
      }
      expect(reads).toEqual([]);
    } finally { h.disposePreparedAuthoringWorkers(); }
  });
  test("unit C, Local: one inference batch selects the union of its items' sources in the worker", async () => {
    const { h, session, page } = await preparedLocal();
    try {
      const { facade, reads } = throwingFacade(session);
      const items: ExpressionInferenceItem[] = unitCNodes.map(([, node]) => ({ node, judge: { expected: number, label: "Number" } }));
      const replies = await h.inferExpressionsInWorker(facade, items, library, { priority: "guidance" })!;
      const oracle = items.map(item => {
        const context = { ...page.environment, literalMembership: literalMembershipFor(page.environment,
          { registry: page.registry, evaluateContext: page.evaluateContext }), bindings: {}, resolveSavedExpr: (id: string) => library.get(id) };
        const result = inferAuthoringExpressionWithLiteralWitnesses(item.node, context);
        return { outcome: result.outcome, type: result.type, scheme: result.scheme,
          judgment: judgeAuthoringResult(item.node, item.judge!.expected, undefined, item.judge!.label, result, page) };
      });
      expect(replies).toEqual(oracle);
      expect(reads).toEqual([]);
      const union = new Map<string, ExprNode>();
      for (const item of items) for (const [id, source] of authoringExpressionSourceEntries(item.node, library, page)) union.set(id, source);
      expect([...new Set(h.workerSelections.slice(-items.length).flat())]).toEqual([...union.keys()]);
      expect(sentOf(h, "infer-expression").selectSavedSources).toBe(true);
    } finally { h.disposePreparedAuthoringWorkers(); }
  });
  test("unit C, Account: the page still selects the sources it lowers and sends no library", async () => {
    const { h, base, page } = await prepared();
    try {
      const node = call("test:wrap", { kind: "ref", savedExprId: "chain" });
      await h.expressionSaveIssueInWorker(base, node, library, { expectedType: number });
      const sent = sentOf(h, "expression-save-issue");
      expect(Object.hasOwn(sent, "selectSavedSources")).toBe(false);
      expect(sent.savedExpressions.map(([id]) => id)).toEqual(authoringExpressionSourceEntries(node, library, page).map(([id]) => id));
      expect(h.workerSelections).toEqual([]);
    } finally { h.disposePreparedAuthoringWorkers(); }
  });
});

describe("existing evaluator observations carry exact source identity", () => {
  const catalog = { types: [], functions: [], capabilities: [], catalogTypes: [], operatorCodeNameByNotation: new Map() };
  const environment = createAuthoringEnvironment(catalog);
  const session = (evaluateContext: AuthoringSession["evaluateContext"]): AuthoringSession => ({ mode: "detached",
    registry: {} as ModuleRegistry, catalog: environment.catalog, environment, evaluateContext });
  const observed = (root: ExprNode, child: ExprNode, reader: AuthoringSession, result: ReturnType<typeof evaluateAuthoringExpressionInSession>) => {
    const sites = authoringExpressionSites(root, undefined, reader).sites;
    return result.captures?.find(capture => capture.site === sites.findIndex(site => site.node === child));
  };

  test("same function in different lexical data captures different actual inputs and runs once", () => {
    let executions = 0;
    const reports: unknown[] = [];
    const reader = session({ natives: { mark: value => { executions++; return value; } },
      onStep: (_step, source) => reports.push(source) });
    const firstInput: ExprNode = { kind: "param", name: "x" };
    const secondInput: ExprNode = { kind: "param", name: "x" };
    const first = call("mark", firstInput), second = call("mark", secondInput);
    const local = (value: number, body: ExprNode) => literal({ __do: [
      literal({ __let: { bindings: [{ name: "x", expr: literal(value) }] } }), body,
    ] });
    const root = literal({ __list: [local(10, first), local(20, second)] });
    const result = evaluateAuthoringExpressionInSession(root, undefined, reader, {}, { trace: false, capture: true });
    expect(result.result).toEqual([10, 20]);
    expect(observed(root, first, reader, result)?.value).toBe(10);
    expect(observed(root, second, reader, result)?.value).toBe(20);
    expect(observed(root, firstInput, reader, result)?.value).toBe(10);
    expect(observed(root, secondInput, reader, result)?.value).toBe(20);
    expect(executions).toBe(2);
    expect(reports).toHaveLength(2);
    expect(reports[0]).not.toBe(reports[1]);
  });

  test("capture never runs a skipped lazy branch and keeps caller observer failures", () => {
    let executions = 0;
    const reader = session({ natives: { mark: value => { executions++; return value; } } });
    const admitted = call("mark", literal("yes")), skipped = call("mark", literal("no"));
    const root = call("if", literal(true), admitted, skipped);
    const result = evaluateAuthoringExpressionInSession(root, undefined, reader, {}, { trace: false, capture: true });
    expect(result.result).toBe("yes");
    expect(observed(root, admitted, reader, result)?.value).toBe("yes");
    expect(observed(root, skipped, reader, result)).toBeUndefined();
    expect(executions).toBe(1);
    const refuses = session({ natives: { mark: value => value }, onStep: () => { throw new Error("Observer refused"); } });
    expect(() => evaluateAuthoringExpressionInSession(admitted, undefined, refuses, {}, { capture: true })).toThrow("Observer refused");
  });

  test("unsupported values refuse snapshots without changing the completed computation", () => {
    const reader = session({ natives: { host: () => () => "callable", finish: () => "finished" } });
    const child = call("host");
    const root = call("finish", child);
    const result = evaluateAuthoringExpressionInSession(root, undefined, reader, {}, { trace: false, capture: true });
    expect(result.result).toBe("finished");
    expect(observed(root, child, reader, result)?.unavailable).toContain("cannot be captured");
    expect(observed(root, child, reader, result)?.value).toBeUndefined();
  });

  test("capture preserves the immutable reader frame used by representation checks", () => {
    const frames: EvaluateContext[] = [];
    const reader = session(Object.freeze({ nativesCtx: { frozenFrame: (context: EvaluateContext) => {
      frames.push(context);
      return { frozen: Object.isFrozen(context), sameReaderNatives: context.nativesCtx === reader.evaluateContext.nativesCtx };
    } } }));
    const original = Object.getOwnPropertyDescriptors(reader.evaluateContext);
    const root = call("frozenFrame");
    const ordinary = evaluateAuthoringExpressionInSession(root, undefined, reader, {}, { trace: false });
    const captured = evaluateAuthoringExpressionInSession(root, undefined, reader, {}, { trace: false, capture: true });
    expect(ordinary.result).toEqual({ frozen: true, sameReaderNatives: true });
    expect(captured.result).toEqual(ordinary.result);
    const traced = evaluateAuthoringExpressionInSession(root, undefined, reader, {}, { capture: true });
    expect(traced.result).toEqual(ordinary.result);
    expect(traced.trace).toHaveLength(1);
    expect(traced.captures?.[0]?.value).toEqual(ordinary.result);
    // Per-run invocation hooks may derive a carrier. Its reader slots and
    // frozen posture must survive, and the supplied reader is never mutated.
    expect(frames).toHaveLength(3);
    for (const frame of frames) expect(Object.getOwnPropertyDescriptor(frame, "nativesCtx")).toEqual(original.nativesCtx);
    expect(Object.getOwnPropertyDescriptors(reader.evaluateContext)).toEqual(original);
  });

  test("capture reads existing dynamic constructors and installs fresh declarations on the exact frame", () => {
    const definition = { name: "D", constructors: [{ name: "D", fields: [{ name: "new" }] }] };
    const frame = Object.freeze({ _constructors: Object.freeze({ D: Object.freeze(["old"]) as unknown as string[] }) });
    const reader = session(frame);
    evaluate({ type_def: [definition] }, {}, frame);
    const root = literal({ construct: ["D", { new: 5 }] });
    const ordinary = evaluateAuthoringExpressionInSession(root, undefined, reader, {}, { trace: false });
    const captured = evaluateAuthoringExpressionInSession(root, undefined, reader, {}, { trace: false, capture: true });
    expect(ordinary.result).toEqual({ $tag: "D", new: 5 });
    expect(captured.result).toEqual(ordinary.result);
    expect(evaluateAuthoringExpressionInSession(root, undefined, reader, {}, { capture: true }).result).toEqual(ordinary.result);
    const fresh = session(Object.freeze({ _constructors: Object.freeze({ D: Object.freeze(["old"]) as unknown as string[] }) }));
    expect(dynamicConstructorTableInForce(fresh.evaluateContext)).toBe(false);
    const program = literal({ __do: [literal({ type_def: [definition] }), root] });
    const created = evaluateAuthoringExpressionInSession(program, undefined, fresh, {}, { trace: false, capture: true });
    expect(created.result).toEqual({ $tag: "D", new: 5 });
    expect(dynamicConstructorTableInForce(fresh.evaluateContext)).toBe(true);
    expect(evaluateAuthoringExpressionInSession(root, undefined, fresh, {}, { trace: false }).result).toEqual(created.result);
  });

  test("legacy pipe stages do not replace its actual final data at a parent input", () => {
    const reader = session({ natives: { first: value => Number(value) + 1, second: value => Number(value) * 2, finish: value => value } });
    const pipe = literal({ __pipe: { value: literal(3), steps: [literal("first"), literal("second")] } });
    const root = call("finish", pipe);
    const result = evaluateAuthoringExpressionInSession(root, undefined, reader, {}, { trace: false, capture: true });
    expect(result.result).toBe(8);
    expect(observed(root, pipe, reader, result)?.value).toBe(8);
  });

  test("nested observer extents retire after throws and leave ordinary caller hooks unchanged", () => {
    const output: string[] = [];
    const frame: EvaluateContext = { natives: { identity: value => value }, onStep: () => { output.push("caller"); } };
    expect(() => withEvaluationStepObserver(frame, () => { output.push("outer"); }, () => {
      withEvaluationStepObserver(frame, () => { output.push("inner"); }, () => evaluate({ call: ["identity", 1] }, {}, frame));
      throw new Error("Stop observing");
    })).toThrow("Stop observing");
    expect(output).toEqual(["caller", "inner"]);
    evaluate({ call: ["identity", 2] }, {}, frame);
    expect(output).toEqual(["caller", "inner", "caller"]);
  });

  test("caller hook re-entry with the same raw source cannot contaminate this captured run", () => {
    const source = { call: ["identity", { var: "x" }] };
    let reenter = true;
    const output: unknown[] = [];
    const frame: EvaluateContext = { natives: { identity: value => value }, onStep: () => {
      if (!reenter) return;
      reenter = false;
      evaluate(source, { x: "unrelated reader" }, frame);
    } };
    const result = withEvaluationStepObserver(frame, step => { output.push(step.result); }, () => evaluate(source, { x: "current reader" }, frame));
    expect(result).toBe("current reader");
    expect(output).toEqual(["current reader"]);
  });

  test("native re-entry cannot capture the same lambda source under another reader", () => {
    const child = call("identity", { kind: "param", name: "x" });
    const callback = literal({ __lambda: { params: ["x"], body: child } });
    const root = call("probe", callback);
    const foreign: EvaluateContext = { natives: { identity: value => value } };
    const reader = session({ natives: {
      identity: value => value,
      probe: callback => {
        evaluate((callback as { body: unknown }).body, { x: "foreign reader" }, foreign);
        return "current root result";
      },
    } });
    const result = evaluateAuthoringExpressionInSession(root, undefined, reader, {}, { trace: false, capture: true });
    expect(result.result).toBe("current root result");
    expect(observed(root, child, reader, result)).toBeUndefined();
  });

  test("dictionary forks retain recording ownership while a foreign registry callback refuses it", () => {
    // Opaque marker fixture only; no authority act is performed or admitted.
    const authority = {} as NonNullable<EvaluateContext["_authority"]>;
    const frame: EvaluateContext = { _authority: authority, natives: { identity: value => value }, getFunction: () => undefined };
    const foreign: EvaluateContext = { ...frame, getFunction: () => undefined };
    const source = { call: ["identity", 1] };
    const seen: unknown[] = [];
    withEvaluationStepObserver(frame, step => { seen.push(step.result); }, () => {
      withInstance(frame, { typeName: "Fixture", args: [], methods: {} }, child => evaluate(source, {}, child));
      evaluate(source, {}, foreign);
    });
    expect(seen).toEqual([1]);
  });

  test("ordinary trace keeps unminted lexical, import and dictionary forks while snapshots stay strict", () => {
    const caller: string[] = [];
    const snapshots: string[] = [];
    const fn = { id: "reviewFn", params: [{ name: "x", type: Anything, label: Nothing, ui: Nothing, meta: {} }],
      returns: Anything, body: { call: ["add", { var: "x" }, 1] } };
    const frame: EvaluateContext = { getFunction: name => name === "reviewFn" ? fn : undefined,
      getFunctionImportFrame: () => ({ names: {}, aliases: {} }), onStep: step => { caller.push(step.fnName); } };
    const result = evaluateWithTrace({ call: ["reviewFn", 4] }, {}, frame, step => { snapshots.push(step.fnName); });
    expect(result.result).toBe(5);
    expect(caller).toEqual(["add", "reviewFn"]);
    expect(result.trace.map(step => step.fnName)).toEqual(caller);
    expect(snapshots).toEqual(["reviewFn"]);
    const imported = evaluateWithTrace({ withInstance: [{ typeName: "Fixture", args: [], methods: {} },
      { call: ["add", 1, 2] }] }, {}, frame);
    expect(imported.result).toBe(3);
    expect(imported.trace.map(step => step.fnName)).toEqual(["add"]);
    const explicit = withImports(frame, { names: {}, aliases: {} }, child => evaluateWithTrace({ call: ["add", 1, 2] }, {}, child));
    expect(explicit.trace.map(step => step.fnName)).toEqual(["add"]);
    const noSnapshots: string[] = [];
    const dict = evaluateWithTrace({ withInstance: [{ typeName: "Fixture", args: [], methods: {} },
      { call: ["add", 1, 2] }] }, {}, frame, step => { noSnapshots.push(step.fnName); });
    expect(dict.trace).toHaveLength(1);
    expect(noSnapshots).toEqual([]);
  });

  test("values are snapshotted at observation rather than retaining a later-mutated host reference", () => {
    const data = { value: "before" };
    const reader = session({ natives: { produce: () => data, mutate: () => { data.value = "after"; return "finished"; } } });
    const child = call("produce");
    const root = call("mutate", child);
    const result = evaluateAuthoringExpressionInSession(root, undefined, reader, {}, { capture: true });
    expect(result.result).toBe("finished");
    expect(observed(root, child, reader, result)?.value).toEqual({ value: "before" });
    expect(data.value).toBe("after");
  });
});
