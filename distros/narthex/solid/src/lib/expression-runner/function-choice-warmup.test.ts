// C1: actual root preparation and explicit picker request boundaries. No
// registry, browser, compatibility policy or ranking verdict is initialized.
import { describe, expect, test } from "bun:test";

const source = await Bun.file(new URL("./index.tsx", import.meta.url)).text();
const region = (start: string, end: string) => {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  if (first < 0 || last <= first) throw new Error("Function-choice demand boundary moved: " + start);
  return new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(first, last));
};
const preparation = region("  const isTypeField = createMemo(", "  const expectedRecordFields");
const pickerRequest = region("  const suggestionRequest = createMemo(", "  const ranked = createMemo(");

function fixture(defer: boolean) {
  let expected: unknown = { $ref: "Image" }, reference = false, choosing = false, code = false;
  const props = { deferFunctionChoices: defer };
  const session = { registry: { owner: "captured registry" }, owner: "captured reader" };
  const accountScope = { owner: "captured scope" };
  const candidates = [{ id: "checked-a" }, { id: "checked-b" }];
  const queued = new Map<number, () => void>(), effects: Array<{ read: () => unknown; apply: (value: unknown) => (() => void) | undefined; cleanup?: () => void }> = [];
  const calls: unknown[][] = [];
  let timerId = 0;
  const bindings = {
    props, pathCtx: { depth: 0 }, session,
    createMemo: (read: () => unknown) => read,
    createEffect: (read: () => unknown, apply: (value: unknown) => (() => void) | undefined) => effects.push({ read, apply }),
    expectedScheme: () => undefined, resolvedFieldType: () => expected,
    isTypeMetaType: () => false, peelArrowType: () => reference ? { $arrow: {} } : undefined,
    needsChoice: () => choosing, codeView: () => code,
    setTimeout: (callback: () => void) => { const id = ++timerId; queued.set(id, callback); return id; },
    clearTimeout: (id: number) => queued.delete(id),
    warmFunctionChoices: (...args: unknown[]) => calls.push(["unsolicited-root-warmup", ...args]),
  };
  new Function(...Object.keys(bindings), preparation)(...Object.values(bindings));
  const settleRoot = () => {
    for (const effect of effects) { effect.cleanup?.(); effect.cleanup = effect.apply(effect.read()) ?? undefined; }
    for (const callback of queued.values()) callback(); queued.clear();
  };
  const openPicker = async (options: { referenceMode?: boolean; inputScheme?: unknown } = {}) => {
    const createAsyncValue = (request: () => unknown, fetch: (input: unknown) => Promise<unknown>) => fetch(request());
    const rank = (...args: unknown[]) => { calls.push(args); return Promise.resolve([]); };
    const mount = new Function("createMemo", "createAsyncValue", "pickerModel", "expected", "props", "callCandidates",
      "rankSuggestionsForEditor", "authoringSessionAccountScope", "editorContainment", pickerRequest + "; return suggestions;");
    // B4 F2: an Account owner keeps its own registry in the ranking options.
    return mount((read: () => unknown) => read, createAsyncValue, () => ({ owner: session }), () => expected,
      options, () => candidates, rank, () => accountScope, (owner: typeof session) => ({ registry: owner.registry }));
  };
  return { props, session, accountScope, candidates, calls, queued, settleRoot, openPicker,
    replaceExpected: (value: unknown) => { expected = value; },
    setMode: (values: { reference?: boolean; choosing?: boolean; code?: boolean }) => {
      reference = values.reference ?? reference; choosing = values.choosing ?? choosing; code = values.code ?? code;
    } };
}

describe("function choices follow the existing picker demand", () => {
  for (const defer of [false, true]) test(`filled root paint and type changes launch no ranking (legacy defer=${defer})`, () => {
    const h = fixture(defer);
    h.settleRoot(); h.replaceExpected({ $ref: "Number" }); h.settleRoot();
    h.setMode({ reference: true }); h.settleRoot();
    expect(h.calls).toEqual([]); expect(h.queued.size).toBe(0);
  });

  test("explicit typed call choices retain the exact current owner, candidates and requirement", async () => {
    const h = fixture(false), expected = { quantified: [], body: { $ref: "Image" } };
    h.replaceExpected(expected); h.settleRoot(); expect(h.calls).toEqual([]);
    const receipt = await h.openPicker();
    expect(h.calls).toEqual([[h.session, h.candidates, expected, { registry: h.session.registry, mode: "call", inputScheme: undefined }, h.accountScope]]);
    expect(receipt).toEqual({ request: expect.objectContaining({ owner: h.session, expected, candidates: h.candidates }), rows: [] });
  });

  test("explicit function references and inserted-call inputs keep their existing ranking options", async () => {
    const h = fixture(true), expected = { $arrow: { params: [], returns: { $ref: "Image" } } }, inputScheme = { quantified: [], body: { $ref: "Image" } };
    h.replaceExpected(expected); h.setMode({ reference: true }); h.settleRoot();
    expect(h.calls).toEqual([]);
    await h.openPicker({ referenceMode: true, inputScheme });
    expect(h.calls).toEqual([[h.session, h.candidates, expected,
      { registry: h.session.registry, mode: "reference", inputScheme }, h.accountScope]]);
  });
});
