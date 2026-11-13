// Run with --conditions=browser --conditions=development for Solid 2 scheduling.
import { describe, expect, test } from "bun:test";
import { createMemo, createRoot, createSignal, flush, onSettled, untrack } from "solid-js";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { FenelType } from "@fenel/engine/types";
import type { ApiClient } from "./api";
import type { HomeAction, LocalCreationDraft } from "./home-action";
import { scopeKey, type LocusScope } from "./locus-scope";
import { cloneDraftValue } from "./native-draft";
import type { WorkspaceSource } from "./workspace-source-wire";

// Execute the production ownership/publication bodies. No registry, admission
// result, permission verdict or storage implementation is replaced by this test.
const surface = (await Bun.file(new URL("./workspace-surface.tsx", import.meta.url)).text()).replace(/\r\n/g, "\n");
const home = (await Bun.file(new URL("../routes/app/home.tsx", import.meta.url)).text()).replace(/\r\n/g, "\n");
const transpiler = new Bun.Transpiler({ loader: "tsx" });
function between(source: string, startMarker: string, endMarker: string, offset = 0, suffix = "", prefix = "") {
  const start = source.indexOf(startMarker, offset);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end <= start) throw new Error(`The Local draft production boundary changed: ${startMarker}`);
  return transpiler.transformSync(prefix + source.slice(start, end) + suffix);
}
const ownerBody = between(surface, "  const localCreationDrafts =", "  const [shortcutRequests,");
const modalStart = home.indexOf("function NewValueModal(");
const markerBody = between(home, "  let createdValueId:", "  onSettled(() => () => { dismissed = true; });", modalStart);
const retainBody = between(home, "  function retainDraft(", "  onSettled(() => { retainDraft(); });", modalStart);
const creationOccurrenceBody = between(home, "  const creationOccurrence =", "  let createdValueId:", modalStart);
const cardPresentationSetup = between(home, "  // Presentation state belongs to the same retained typed draft.", "  /** A Create was tried:", modalStart);
const togglePresentationBody = between(home, "  function toggleComposerPresentation()", "  function positionCreationCard()", modalStart);
const updateBody = between(home, "  function updateDraft(", "  // Representation drafts captured", modalStart);
const closeBody = between(home, "  function close()", "  function openCreationScope(", modalStart);
const typeBody = between(home, "  function pickTopType(", "  function drillQuickType(", modalStart);
const repBody = between(home, "  function setRepMethod(", "  function showExpressionStep()", modalStart);
const representationHelpers = between(home, "function isBlankRepresentationValue(", "function knownTypeIconName(");
const scopePrefix = between(home, "  async function chooseCreationScope(", "    const generation = ++scopeGeneration;", modalStart, "\n}");
const issueBody = between(home, "  const draftIssue = createMemo(() => {", "  const inferredType = createMemo", modalStart);
// B4 slice 2: Save keeps these synchronous preconditions; draftIssue starts with them.
const preconditionBody = between(home, "  /** The synchronous preconditions every Save keeps", "  const draftIssue = createMemo(() => {", modalStart);
const uncertainBody = between(home, "  const [uncertainSubmission,", "  function retainDraft(", modalStart);
const saveOffset = home.indexOf("  async function save()", modalStart);
const saveGuard = between(home, "  async function save()", "    // No name is required.", saveOffset, '\nreturn "reached checked save";\n}');
const uncertainCatch = between(home, "      if (!dismissed && submissionStarted && !createdValueId)", "    } finally {", saveOffset);
const destinationSetup = between(home, "  const initialCreation = untrack(() => props.creation);", "  let scopeGeneration = 0;", modalStart);
const destinationChoice = between(home, "  async function chooseCreationScope(", "  onSettled(() => {\n    if (!initialCreation", modalStart);
const destinationRestore = between(home, "  onSettled(() => {\n    if (!initialCreation", "  // Refs in the draft are inlined", modalStart);
// This slice starts after the current reader's checks. It tests only when the
// retry marker is published relative to the existing create/update API boundary.
const publicationBody = between(home, "      const payload = {", "      target?.assertCurrent();", saveOffset, "\n}",
  "async function publishCreation() { const submittedDraft = cloneDraftValue(draft()); const submittedType = cloneDraftValue(chosenValueType());\n");

type ExpressionAction = Extract<HomeAction, { kind: "new:expression" }>;
type Checkpoint = NonNullable<ExpressionAction["checkpoint"]>;
const LOCAL: WorkspaceSource = { $tag: "ThisTabSource" };
const ROOT: LocusScope = { kind: "root" };
const literal = (value: unknown): ExprNode => ({ kind: "literal", value });
const checkpoint = (expr: ExprNode, focus: LocusScope = ROOT): LocalCreationDraft => ({
  focus, action: { kind: "new:expression", expr },
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

function ownership() {
  const [session, setSession] = createSignal(8);
  let surfaceEpoch = 8;
  let surfaceClosed = false;
  const runtimes = new Map<string, { client: ApiClient }>();
  const controllers = new Map<ApiClient, AbortController>();
  let dispose!: () => void;
  const env = {
    createSignal, cloneDraftValue, scopeKey, runtimes, sessionEpoch: session,
    props: { get epoch() { return surfaceEpoch; } },
    get surfaceClosed() { return surfaceClosed; },
  };
  const owner = createRoot(end => {
    dispose = end;
    return new Function("env", `with (env) { ${ownerBody}; return { retainCreationDraft, creationDraft, hasLocalCreationDrafts }; }`)(env) as {
      retainCreationDraft: (id: string, source: WorkspaceSource, draft: LocalCreationDraft | undefined, client: ApiClient) => void;
      creationDraft: (id: string, source: WorkspaceSource, focus: LocusScope) => LocalCreationDraft | undefined;
      hasLocalCreationDrafts: () => boolean;
    };
  });
  const client = () => {
    const controller = new AbortController();
    const result = { epoch: surfaceEpoch, signal: controller.signal } as ApiClient;
    controllers.set(result, controller);
    runtimes.set("local", { client: result });
    return result;
  };
  const publish = (client: ApiClient, value: LocalCreationDraft | undefined, source = LOCAL, id = "local-lens") =>
    owner.retainCreationDraft(id, source, value, client);
  return {
    ...owner, client, publish,
    read: (source = LOCAL, focus = ROOT, id = "local-lens") => owner.creationDraft(id, source, focus),
    nextSession: () => { surfaceEpoch += 1; setSession(surfaceEpoch); flush(); },
    setSurfaceEpoch: (epoch: number) => { surfaceEpoch = epoch; },
    setSessionEpoch: (epoch: number) => { setSession(epoch); flush(); },
    abort: (client: ApiClient) => controllers.get(client)!.abort(),
    closeSurface: () => { surfaceClosed = true; },
    dispose,
  };
}

function composer(options: { publish?: (action: ExpressionAction | undefined) => void; restored?: Checkpoint; kind?: "local" | "account";
  cardAnchor?: Checkpoint["cardAnchor"]; placement?: Checkpoint["placement"] } = {}) {
  let dispose!: () => void;
  const publications: Array<ExpressionAction | undefined> = [];
  const creates: Array<Record<string, unknown>> = [];
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const receipt = deferred<{ query: { id: string; query: Record<string, unknown> } }>();
  let closed = 0;
  let committed = false;
  let apiEntered: Checkpoint | undefined;
  const initialExpr = literal("before");
  const initialType: FenelType = { $ref: "String" };
  const result = createRoot(end => {
    dispose = end;
    const [draft, setDraft] = createSignal(initialExpr);
    const [chosenType, setChosenType] = createSignal("String");
    const [chosenValueType, setChosenValueType] = createSignal<FenelType | undefined>(initialType);
    const [reps, setReps] = createSignal<Record<string, Record<string, unknown>>>({ Labelable: { label: "Draft" } });
    const [authoredDraft, setAuthoredDraft] = createSignal(true);
    const [viewMode] = createSignal<"nested" | "pipe">("pipe");
    const [saving, setSaving] = createSignal(false);
    const [saveError, setSaveError] = createSignal<string | null>(null);
    const props = {
      checkpoint: options.restored,
      cardAnchor: options.cardAnchor,
      placement: options.restored?.placement ?? options.placement,
      onClose: () => { closed += 1; },
      onDraftChange: (action: ExpressionAction | undefined) => {
        const copied = cloneDraftValue(action);
        publications.push(copied);
        options.publish?.(copied);
      },
    };
    const saveClient = { drafts: undefined, api: {
      savedQueryCreate: async (payload: Record<string, unknown>) => {
        apiEntered = cloneDraftValue(publications.at(-1)?.checkpoint);
        creates.push(cloneDraftValue(payload));
        // The controlled API boundary records acceptance before yielding its
        // receipt. It does not stand in for Fenel's Local transaction checker.
        committed = true;
        return receipt.promise;
      },
      savedQueryUpdate: async (id: string, patch: Record<string, unknown>) => {
        updates.push({ id, patch: cloneDraftValue(patch) });
        return { query: { id, query: cloneDraftValue(patch.query as Record<string, unknown>) } };
      },
    } };
    const env = {
      props, reader: { kind: options.kind ?? "local" }, untrack, createMemo, createSignal, ROOT_SCOPE: ROOT,
      draft, setDraft, chosenType, setChosenType, chosenValueType, setChosenValueType,
      reps, setReps, authoredDraft, setAuthoredDraft, viewMode, saveError, setSaveError, saving, setSaving,
      initialCreation: options.cardAnchor || options.restored?.cardAnchor ? {} : undefined,
      genId: () => { if (options.restored?.creationOccurrenceId) throw new Error("Restoration must reuse its retained occurrence"); return "creation-occurrence"; },
      // Demo 1 (Nov 8): the simple form's Create-attempt and refusal marks.
      setCheckRefusal: () => {}, setCreateTried: () => {},
      cloneDraftValue, scopeGeneration: 0,
      showExpressionStep: () => {}, setQuickpickParent: () => {},
      // The authored draft branch must never reseed or read an old session.
      seedExpressionForType: () => { throw new Error("Unexpected draft reseeding"); },
      expectedTypeForName: () => { throw new Error("Unexpected type resolution"); },
      authoringSession: () => { throw new Error("Unexpected retained authoring session"); },
      n: "Draft", description: () => "", newValueSlug: () => "draft", saveClient,
      // B4 slice 2: a Local reader's live guidance (answered, no issue).
      guidanceReader: () => ({ kind: options.kind ?? "local" }),
      composerLocalAnswer: () => (options.kind ?? "local") === "local" ? {} : undefined,
      composerGuidance: { touch() {}, cancel() {}, read() {}, dispose() {} },
    };
    return new Function("env", `with (env) {
      ${creationOccurrenceBody}
      ${markerBody}
      ${cardPresentationSetup}
      ${uncertainBody}
      ${retainBody}
      ${togglePresentationBody}
      ${updateBody}
      ${closeBody}
      ${typeBody}
      ${representationHelpers}
      ${repBody}
      ${scopePrefix}
      ${publicationBody}
      async function publishWithCatch() { try { await publishCreation(); } catch (e) { ${uncertainCatch} } }
      ${preconditionBody}
      function draftIssue() { ${issueBody}; return draftIssue(); }
      ${saveGuard}
      return { retainDraft, updateDraft, pickTopType, setRepMethod, close, chooseCreationScope, publishCreation,
        draft, saveError, submission: () => ({ submitted: submissionStarted, createdValueId, createdValueQuery }),
        restoredIssue: () => { ${issueBody}; return draftIssue(); },
        publishWithCatch, save, toggleComposerPresentation,
        occurrence: () => creationOccurrence?.id,
        presentation: () => ({ cardAnchor, cardExpanded: cardExpanded(), editorLens: editorLens(), inline: inlineCard() }),
        snapshot: () => ({ draft: draft(), type: chosenValueType(), reps: reps() }),
        pending: (inFlight, visible) => { saveInFlight = inFlight; setSaving(visible); },
        retire: () => { dismissed = true; } };
    }`)(env) as {
      retainDraft: (next?: Partial<Checkpoint> & { expr?: ExprNode }) => void;
      updateDraft: (expr: ExprNode) => void;
      pickTopType: (name: string) => void;
      setRepMethod: (type: string, method: string, value: unknown) => void;
      close: () => void;
      chooseCreationScope: (place: { sourceId: string; accountId: string; rootId?: string; kind?: "root" | "list"; listId?: string; scope?: LocusScope }) => Promise<void>;
      publishCreation: () => Promise<void>;
      publishWithCatch: () => Promise<void>;
      save: () => Promise<unknown>;
      draft: () => ExprNode;
      saveError: () => string | null;
      submission: () => Checkpoint;
      restoredIssue: () => string;
      toggleComposerPresentation: () => void;
      occurrence: () => string | undefined;
      presentation: () => { cardAnchor: Checkpoint["cardAnchor"]; cardExpanded: boolean; editorLens: "simple" | "full"; inline: boolean };
      snapshot: () => { draft: ExprNode; type: FenelType | undefined; reps: Record<string, Record<string, unknown>> };
      pending: (inFlight: boolean, visible: boolean) => void;
      retire: () => void;
    };
  });
  flush();
  return { ...result, publications, creates, updates, receipt, dispose,
    closed: () => closed, committed: () => committed, apiEntered: () => apiEntered };
}

function destinationHarness(restored?: Checkpoint, publish?: (action: ExpressionAction) => void) {
  let dispose!: () => void;
  let epoch = 8;
  let reads = 0;
  let oldVerdicts = 0;
  const ready = deferred<unknown>();
  const requests: Array<{ rootId?: string; scope?: LocusScope }> = [];
  const publications: ExpressionAction[] = [];
  const result = createRoot(end => {
    dispose = end;
    const [saveError, setSaveError] = createSignal<string | null>(null);
    const current = { place: { sourceId: "local", accountId: "", rootId: "root", kind: "list", listId: "A",
      scope: { kind: "view", viewId: "A" } }, assertCurrent: () => { oldVerdicts += 1; throw new Error("Old A verdict must not authorize B"); } };
    const props = { checkpoint: restored, creation: { current }, onDraftChange: (action: ExpressionAction) => {
      publications.push(cloneDraftValue(action)); publish?.(action);
    } };
    const env = {
      props, createSignal, createMemo, untrack, onSettled, cloneDraftValue, scopeKey, ROOT_SCOPE: ROOT,
      reader: { kind: "local" }, sessionEpoch: () => epoch, creationEpoch: epoch, genId: () => "scope-occurrence",
      draft: () => literal("kept"), chosenType: () => "", chosenValueType: () => undefined,
      reps: () => ({}), authoredDraft: () => true, viewMode: () => "nested", setSaveError, saveError,
      setCheckRefusal: () => {}, setCreateTried: () => {},
      // B4 slice 2: a Local reader's live guidance (answered, no issue).
      composerLocalAnswer: () => ({}),
      creationSource: (place: { rootId?: string; scope?: LocusScope }) => {
        requests.push(cloneDraftValue(place));
        return { ready: () => ready.promise, client: {
          getLocusRoot: { uncached: async () => { reads += 1; return { root: { id: "root", canEdit: false } }; } },
          getSavedQueries: { uncached: async () => ({ queries: [] }) },
        } };
      },
    };
    return new Function("env", `with (env) {
      ${destinationSetup}
      let scopeGeneration = 0;
      ${creationOccurrenceBody}
      ${markerBody}
      ${cardPresentationSetup}
      ${retainBody}
      ${destinationChoice}
      ${destinationRestore}
      return { destination, preparingScope, chooseCreationScope, saveError,
        issue: () => { const interruptedSubmission = false, uncertainSubmission = () => false;
          ${preconditionBody}
          ${issueBody}; return draftIssue(); } };
    }`)(env) as {
      destination: () => unknown;
      preparingScope: () => boolean;
      chooseCreationScope: (place: { sourceId: string; accountId: string; rootId: string; kind: "list"; listId: string; scope: LocusScope }) => Promise<void>;
      saveError: () => string | null;
      issue: () => string;
    };
  });
  return { ...result, ready, requests, publications, dispose,
    reads: () => reads, oldVerdicts: () => oldVerdicts, nextSession: () => { epoch += 1; } };
}

describe("Local New draft reader ownership", () => {
  test("the last ExprNode publishes before Solid commits its signal, and a fresh reader retrieves it", () => {
    const h = ownership();
    const old = h.client();
    const modal = composer({ publish: action => h.publish(old, action && { focus: ROOT, action }) });
    try {
      const value = { text: "last input", missing: undefined, negativeZero: -0, large: 2n ** 70n,
        special: NaN, bytes: new Uint8Array([0, 128, 255]) };
      const next = literal(value);
      modal.updateDraft(next);
      expect(modal.draft()).toEqual(literal("before"));
      expect(h.read()?.action).toMatchObject({ kind: "new:expression", expr: next });
      h.nextSession(); h.client();
      const retained = h.read()!.action as ExpressionAction;
      expect(retained.expr).toEqual(next);
      expect(retained.expr).not.toBe(next);
      expect(retained.checkpoint).toMatchObject({ authored: true, typeName: "String", valueType: { $ref: "String" },
        reps: { Labelable: { label: "Draft" } }, viewMode: "pipe", submitted: false });
      expect(Object.keys(retained.checkpoint!).sort()).toEqual([
        "authored", "cardAnchor", "cardExpanded", "createdValueId", "createdValueQuery", "creationOccurrenceId", "destination", "editorLens",
        "placement", "reps", "submitted", "typeName", "valueType", "viewMode",
      ]);
      value.bytes[0] = 77;
      expect(retained.expr).toMatchObject({ value: { bytes: new Uint8Array([0, 128, 255]) } });
      expect(h.hasLocalCreationDrafts()).toBe(true);
    } finally { modal.dispose(); h.dispose(); }
  });

  test("prior epochs cannot publish or clear a fresh reader's snapshot", () => {
    const h = ownership();
    try {
      const old = h.client(); h.publish(old, checkpoint(literal("old")));
      h.nextSession();
      const fresh = h.client(); h.publish(fresh, checkpoint(literal("fresh")));
      h.publish(old, checkpoint(literal("late"))); h.publish(old, undefined);
      expect((h.read()!.action as ExpressionAction).expr).toEqual(literal("fresh"));
      h.setSurfaceEpoch(fresh.epoch! + 1);
      h.publish(fresh, checkpoint(literal("wrong surface"))); h.publish(fresh, undefined);
      expect((h.read()!.action as ExpressionAction).expr).toEqual(literal("fresh"));
      h.setSurfaceEpoch(fresh.epoch!); h.setSessionEpoch(fresh.epoch! + 1);
      h.publish(fresh, checkpoint(literal("wrong session"))); h.publish(fresh, undefined);
      expect((h.read()!.action as ExpressionAction).expr).toEqual(literal("fresh"));
    } finally { h.dispose(); }
  });

  test("a replaced client in the same epoch cannot publish or clear", () => {
    const h = ownership();
    try {
      const old = h.client(); h.publish(old, checkpoint(literal("old")));
      const fresh = h.client(); h.publish(fresh, checkpoint(literal("fresh")));
      expect(old.epoch).toBe(fresh.epoch); expect(old.signal.aborted).toBe(false);
      h.publish(old, checkpoint(literal("late"))); h.publish(old, undefined);
      expect((h.read()!.action as ExpressionAction).expr).toEqual(literal("fresh"));
      h.abort(fresh); h.publish(fresh, undefined);
      expect(h.read()).toBeDefined();
      const current = h.client(); h.closeSurface(); h.publish(current, undefined);
      expect(h.read()).toBeDefined();
    } finally { h.dispose(); }
  });

  test("account/public sources do not retain drafts, and retrieval matches the exact Local focus", () => {
    const h = ownership();
    try {
      const current = h.client();
      const focus: LocusScope = { kind: "value", viewId: "list", itemId: "item", path: [1] };
      h.publish(current, checkpoint(literal("local"), focus));
      for (const source of [{ $tag: "AccountSource", accountId: "account" }, { $tag: "PublicSource" }] as WorkspaceSource[]) {
        h.publish(current, checkpoint(literal("private")), source); h.publish(current, undefined, source);
        expect(h.read(source, focus)).toBeUndefined();
      }
      expect(h.read(LOCAL, ROOT)).toBeUndefined();
      expect(h.read(LOCAL, { ...focus, path: ["1"] })).toBeUndefined();
      expect((h.read(LOCAL, focus)!.action as ExpressionAction).expr).toEqual(literal("local"));
      expect(h.read(LOCAL, focus, "other-lens")).toBeUndefined();
    } finally { h.dispose(); }
  });

  test("explicit Close clears the current Local draft", () => {
    const h = ownership(); const current = h.client();
    const modal = composer({ publish: action => h.publish(current, action && { focus: ROOT, action }) });
    try {
      modal.updateDraft(literal("cancel me"));
      expect(h.read()).toBeDefined();
      modal.close();
      expect(h.read()).toBeUndefined(); expect(h.hasLocalCreationDrafts()).toBe(false); expect(modal.closed()).toBe(1);
    } finally { modal.dispose(); h.dispose(); }
  });
});


describe("the retained typed creation card", () => {
  test("expanding publishes the next presentation before Solid commits, with the exact draft and type unchanged", () => {
    const owner = ownership(), client = owner.client();
    const anchor = { x: 420, y: 240 }, placement = { afterId: "existing-person-type" };
    const modal = composer({ cardAnchor: anchor, placement,
      publish: action => owner.publish(client, action && { focus: ROOT, action }) });
    try {
      modal.updateDraft(literal({ name: "Taylor", phone: "+1" })); flush();
      const before = modal.snapshot();
      modal.toggleComposerPresentation();
      // Publication is immediate; the UI signals intentionally still read old values.
      expect(modal.presentation()).toEqual({ cardAnchor: anchor, cardExpanded: false, editorLens: "simple", inline: true });
      const expanded = owner.read()!.action as ExpressionAction;
      expect(expanded).toMatchObject({ expr: before.draft, checkpoint: {
        cardAnchor: anchor, cardExpanded: true, editorLens: "full", placement,
        valueType: before.type, reps: before.reps,
      } });
      flush();
      expect(modal.presentation()).toEqual({ cardAnchor: anchor, cardExpanded: true, editorLens: "full", inline: false });
      expect(modal.snapshot().draft).toBe(before.draft);
      expect(modal.snapshot().type).toBe(before.type);
      expect(modal.snapshot().reps).toBe(before.reps);

      modal.toggleComposerPresentation();
      expect((owner.read()!.action as ExpressionAction).checkpoint).toMatchObject({
        cardExpanded: false, editorLens: "simple", cardAnchor: anchor, placement,
      });
      flush();
      expect(modal.presentation().inline).toBe(true);
      expect(modal.snapshot().draft).toBe(before.draft);
      expect(modal.snapshot().type).toBe(before.type);
      expect(modal.snapshot().reps).toBe(before.reps);
      expect(modal.creates).toEqual([]); expect(modal.updates).toEqual([]);
    } finally { modal.dispose(); owner.dispose(); }
  });

  test("reader replacement retains inert card coordinates, presentation and placement with the authored data", () => {
    const owner = ownership(), client = owner.client();
    const modal = composer({ cardAnchor: { x: 400, y: 220 }, placement: { afterId: "existing" },
      publish: action => owner.publish(client, action && { focus: ROOT, action }) });
    let restored: ReturnType<typeof composer> | undefined;
    try {
      const value = literal({ name: "Taylor", phone: "+14155552671" });
      modal.updateDraft(value); flush(); modal.toggleComposerPresentation(); flush();
      owner.nextSession(); owner.client();
      const retrieved = owner.read()!.action as ExpressionAction;
      expect(retrieved.expr).toEqual(value);
      expect(retrieved.checkpoint).toMatchObject({ cardAnchor: { x: 400, y: 220 }, cardExpanded: true,
        editorLens: "full", placement: { afterId: "existing" }, creationOccurrenceId: modal.occurrence() });
      expect(modal.occurrence()).toBe("creation-occurrence");
      // The fixture splices the production presentation setup, not a restore copy.
      restored = composer({ restored: retrieved.checkpoint });
      expect(restored.presentation()).toEqual({ cardAnchor: { x: 400, y: 220 }, cardExpanded: true,
        editorLens: "full", inline: false });
      expect(restored.occurrence()).toBe(modal.occurrence());
      restored.toggleComposerPresentation(); flush();
      expect(restored.presentation().inline).toBe(true);
      expect(modal.creates).toEqual([]); expect(modal.updates).toEqual([]);
    } finally { restored?.dispose(); modal.dispose(); owner.dispose(); }
  });

  test("a pending or retired creation cannot change presentation or publish another checkpoint", () => {
    for (const pending of [[true, false], [false, true], [true, true]] as const) {
      const modal = composer({ cardAnchor: { x: 120, y: 180 } });
      try {
        modal.retainDraft();
        const count = modal.publications.length, before = modal.presentation();
        modal.pending(pending[0], pending[1]); flush();
        modal.toggleComposerPresentation(); flush();
        expect(modal.presentation()).toEqual(before);
        expect(modal.publications).toHaveLength(count);
        expect(modal.creates).toEqual([]); expect(modal.updates).toEqual([]);
      } finally { modal.dispose(); }
    }
    const modal = composer({ cardAnchor: { x: 120, y: 180 } });
    try {
      modal.retainDraft(); const count = modal.publications.length, before = modal.presentation();
      modal.retire(); modal.toggleComposerPresentation(); flush();
      expect(modal.presentation()).toEqual(before);
      expect(modal.publications).toHaveLength(count);
    } finally { modal.dispose(); }
  });
});

describe("NewValueModal inert snapshots and interrupted submission", () => {
  test("choosing B retains B before preparation; restoration discards A and requires a fresh editable-root check", async () => {
    const owner = ownership(); const old = owner.client();
    const first = destinationHarness(undefined, action => owner.publish(old, { focus: ROOT, action }));
    let restored: ReturnType<typeof destinationHarness> | undefined;
    try {
      const b: LocusScope = { kind: "view", viewId: "B" };
      const pending = first.chooseCreationScope({ sourceId: "local", accountId: "", rootId: "root", kind: "list", listId: "B", scope: b });
      expect(first.requests).toHaveLength(1); expect(first.reads()).toBe(0);
      expect((owner.read()!.action as ExpressionAction).checkpoint?.destination).toEqual({ rootId: "root", scope: b });
      first.nextSession(); owner.nextSession(); owner.client();
      first.ready.resolve({}); await pending;
      expect(first.reads()).toBe(0); expect(first.oldVerdicts()).toBe(0);

      const retained = (owner.read()!.action as ExpressionAction).checkpoint!;
      restored = destinationHarness(retained);
      expect(restored.destination()).toBeUndefined(); expect(restored.preparingScope()).toBe(true);
      expect(restored.issue()).toContain("Choose an editable scope");
      flush(); await Promise.resolve(); flush(); await Promise.resolve();
      expect(restored.requests.at(-1)).toMatchObject({ rootId: "root", scope: b });
      expect(restored.oldVerdicts()).toBe(0);
      restored.ready.resolve({});
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); flush();
      expect(restored.reads()).toBe(1);
      expect(restored.saveError()).toBe("This scope is no longer editable.");
      expect(restored.destination()).toBeUndefined();
      expect(restored.issue()).toContain("Choose an editable scope");
    } finally { restored?.dispose(); first.dispose(); owner.dispose(); }
  });

  test("type and representation changes publish their next values, and account destinations clear retention", async () => {
    const modal = composer();
    const account = composer({ kind: "account" });
    try {
      modal.updateDraft(literal("authored")); flush();
      modal.pickTopType("Text");
      expect(modal.publications.at(-1)).toMatchObject({ expr: literal("authored"), checkpoint: { typeName: "Text", valueType: undefined } });
      flush(); modal.setRepMethod("Describable", "description", "kept");
      expect(modal.publications.at(-1)?.checkpoint?.reps).toEqual({ Labelable: { label: "Draft" }, Describable: { description: "kept" } });
      await modal.chooseCreationScope({ sourceId: "account", accountId: "account" });
      expect(modal.publications.at(-1)).toBeUndefined();
      modal.updateDraft(literal("only in account")); expect(modal.publications.at(-1)).toBeUndefined();
      account.updateDraft(literal("private")); expect(account.publications).toEqual([undefined]);
    } finally { account.dispose(); modal.dispose(); }
  });

  test("before publication the draft remains unsubmitted and needs no retained execution state", () => {
    const modal = composer();
    try {
      modal.retainDraft();
      expect(modal.publications.at(-1)?.checkpoint).toMatchObject({ submitted: false, createdValueId: undefined, createdValueQuery: undefined });
      expect(modal.creates).toEqual([]); expect(modal.updates).toEqual([]); expect(modal.committed()).toBe(false);
    } finally { modal.dispose(); }
  });

  test("submission is marked before create; a retired editor cannot turn a delayed receipt into a new checkpoint", async () => {
    const h = ownership(); const old = h.client();
    const modal = composer({ publish: action => h.publish(old, action && { focus: ROOT, action }) });
    try {
      const pending = modal.publishCreation();
      expect(modal.committed()).toBe(true);
      expect(modal.apiEntered()).toMatchObject({ submitted: true, createdValueId: undefined });
      const beforeReceipt = (h.read()!.action as ExpressionAction).checkpoint!;
      expect(beforeReceipt).toMatchObject({ submitted: true, createdValueId: undefined });
      h.nextSession(); h.client(); modal.retire();
      modal.receipt.resolve({ query: { id: "accepted-before-sign-in", query: modal.creates[0]!.query as Record<string, unknown> } });
      await pending;
      expect((h.read()!.action as ExpressionAction).checkpoint).toEqual(beforeReceipt);
      expect(modal.submission().createdValueId).toBeUndefined();
    } finally { modal.dispose(); h.dispose(); }
  });

  test("an acknowledged same-mounted retry updates its known identity and retains its exact expected query", async () => {
    const modal = composer();
    try {
      const first = modal.publishCreation();
      const query = modal.creates[0]!.query as Record<string, unknown>;
      modal.receipt.resolve({ query: { id: "already-created", query } }); await first;
      expect(modal.publications.at(-1)?.checkpoint).toMatchObject({ submitted: true, createdValueId: "already-created", createdValueQuery: query });
      await modal.publishCreation();
      expect(modal.creates).toHaveLength(1); expect(modal.updates).toHaveLength(1);
      expect(modal.updates[0]).toMatchObject({ id: "already-created", patch: { expectedQuery: query } });
    } finally { modal.dispose(); }
  });

  test("an unknown create outcome fences a same-mounted second save before its checked save body", async () => {
    const modal = composer();
    try {
      const pending = modal.publishWithCatch();
      expect(modal.committed()).toBe(true);
      modal.receipt.reject(new Error("Receipt unavailable after acceptance")); await pending; flush();
      expect(modal.saveError()).toContain("may already be saved");
      expect(modal.restoredIssue()).toContain("may already be saved");
      expect(await modal.save()).toBeUndefined();
      expect(modal.creates).toHaveLength(1); expect(modal.updates).toHaveLength(0);
      expect(modal.submission()).toMatchObject({ submitted: true, createdValueId: undefined });
    } finally { modal.dispose(); }
  });

  test("restored submitted checkpoints stay fenced, including a known acknowledged identity", () => {
    for (const knownId of [undefined, "already-created"]) {
      const restored = composer({ restored: { submitted: true, createdValueId: knownId } });
      try {
        // This actual early refusal must run before consulting any fresh
        // session, destination, evaluation or type-check result.
        expect(restored.restoredIssue()).toContain("may already be saved");
        expect(restored.submission()).toMatchObject({ submitted: true, createdValueId: knownId });
      } finally { restored.dispose(); }
    }
  });
});
