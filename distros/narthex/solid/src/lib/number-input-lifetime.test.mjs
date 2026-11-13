import { describe, expect, test } from "bun:test";
import { For, createRoot, createSignal, createMemo, createEffect, createRenderEffect, createUniqueId, flush, isPending, latest, onSettled } from "../../node_modules/solid-js/dist/solid.dev.js";

// Actual DOM-leaf lifecycle and event bodies with the input element controlled.
// No numeric parser or source decision is reimplemented by this fixture.
const source = (await Bun.file(new URL("./number-input.tsx", import.meta.url)).text()).replaceAll("\r\n", "\n");
const begin = source.indexOf("  let input!"), end = source.indexOf("  return <>", begin);
const inputBegin = source.indexOf("      onInput={() => {", end);
const inputEnd = source.indexOf("      }}\n      onBlur", inputBegin);
const blurBegin = source.indexOf("      onBlur={() => {", inputEnd);
const blurEnd = source.indexOf("      }}\n    />", blurBegin);
if ([begin, end, inputBegin, inputEnd, blurBegin, blurEnd].some(index => index < 0)) throw new Error("NumberInput fixture boundary moved.");
const transpiler = new Bun.Transpiler({ loader: "ts" });
const body = source.slice(begin, end).replace("let input!: HTMLInputElement;", "let input = fixtureInput;");
const events = `const edit = () => { ${source.slice(inputBegin + "      onInput={() => {".length, inputEnd)} };
  const blur = () => { ${source.slice(blurBegin + "      onBlur={() => {".length, blurEnd)} };`;
const code = transpiler.transformSync(`${body}\n${events}\nreturn { edit, blur, invalid, showError, frame: inputFrame };`);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const ok = value => ({ ok: true, value });
const err = error => ({ ok: false, error });
async function settle() { for (let tick = 0; tick < 10; tick++) { await Promise.resolve(); flush(); } }
function controlledCodec() {
  const requests = [];
  const request = (method, value, signal) => { const held = deferred(); requests.push({ method, value, signal, ...held }); return held.promise; };
  return { requests, codec: { decode: (value, signal) => request("decode", value, signal), encode: (value, signal) => request("encode", value, signal) } };
}
function fixture(options = {}) {
  let dispose;
  const root = createRoot(close => {
    dispose = close;
    const [value, setValue] = createSignal(options.value);
    const [codec, setCodec] = createSignal(options.codec);
    const [readonly, setReadonly] = createSignal(false);
    const writes = [], assignments = [];
    let text = "", customValidity = "";
    const input = { get value() { return text; }, set value(next) { text = next; assignments.push(next); },
      valueAsNumber: Number.NaN, validity: { badInput: false }, setCustomValidity: message => { customValidity = message; } };
    const [publisher, setPublisher] = createSignal({ callback: next => { writes.push(next); if (options.echo) setValue(() => options.echo(next)); } });
    const setOnChange = next => { setPublisher({ callback: next }); };
    const props = { get value() { return options.valueRead ? options.valueRead() : value(); }, get textCodec() { return codec(); }, get readonly() { return readonly(); },
      get onChange() { return publisher().callback; } };
    const imports = { fixtureInput: input, props, createMemo, createEffect, createSignal, createUniqueId, isPending, latest, onSettled };
    const api = new Function(...Object.keys(imports), code)(...Object.values(imports));
    createEffect(() => ({ invalid: api.invalid(), showError: api.showError() }), () => {});
    return { api, writes, assignments, input, value, setValue, setCodec, setReadonly, setOnChange,
      validity: () => customValidity, text: () => text,
      edit: next => { text = next; api.edit(); }, blur: () => api.blur() };
  });
  return { ...root, dispose: () => { dispose(); flush(); } };
}

describe("NumberInput scoped async codec lifetime", () => {
  test("a queued cloned For row crosses only the owned inert input frame", async () => {
    const c = controlledCodec(), cells = []; let dispose, replace;
    createRoot(close => {
      dispose = close;
      const [rows, setRows] = createSignal([{ id: "row", value: undefined }]); replace = setRows;
      const list = For({ get each() { return rows(); }, keyed: false, children: item => {
        const cell = fixture({ codec: c.codec, valueRead: () => item().value }); cells.push(cell); return cell;
      } });
      createEffect(list, () => {});
    });
    try {
      await settle(); const cell = cells[0]; cell.edit("first");
      replace([{ id: "row", value: undefined }]);
      expect(() => cell.edit("second")).not.toThrow();
      await settle(); expect(c.requests[0].signal.aborted).toBe(true);
      c.requests[0].resolve(ok({ exact: "obsolete" })); c.requests[1].resolve(ok({ exact: "current" })); await settle();
      c.requests[2].resolve(ok("current")); await settle(); expect(cell.writes).toEqual([{ exact: "current" }]);
    } finally { for (const cell of cells) cell.dispose(); dispose(); flush(); }
  });
  test("synchronous codecs preserve immediate publication and exponent drafts", async () => {
    const calls = [], carrier = { exact: "hundred" };
    const codec = { decode: text => { calls.push(["decode", text]); return text === "1e2" ? ok(carrier) : err("Incomplete exponent"); },
      encode: value => { calls.push(["encode", value]); return ok("100"); } };
    const h = fixture({ codec, echo: value => ({ ...value }) });
    try {
      await settle(); h.edit("1e2");
      expect(h.writes).toEqual([carrier]);
      await settle(); expect(h.text()).toBe("1e2");
      h.edit("1e"); h.blur(); await settle();
      expect(h.text()).toBe("1e"); expect(h.writes).toHaveLength(1);
      expect(h.validity()).toBe("Incomplete exponent"); expect(h.api.showError()).toBe(true);
    } finally { h.dispose(); }
  });

  test("newer typing aborts and fences older decode and encode replies", async () => {
    const c = controlledCodec(), h = fixture({ codec: c.codec, echo: value => value });
    try {
      await settle(); h.edit("1"); const first = c.requests[0];
      h.edit("2"); const second = c.requests[1];
      expect(first.signal.aborted).toBe(true);
      first.resolve(ok({ exact: "one" })); await settle(); expect(c.requests).toHaveLength(2);
      const two = { exact: "two" }; second.resolve(ok(two)); await settle();
      expect(c.requests[2].method).toBe("encode");
      h.edit("3"); expect(c.requests[2].signal.aborted).toBe(true);
      c.requests[2].resolve(ok("2")); await settle(); expect(h.writes).toEqual([]);
      c.requests[3].resolve(ok({ exact: "three" })); await settle();
      c.requests[4].resolve(ok("3")); await settle();
      expect(h.writes).toEqual([{ exact: "three" }]); expect(h.text()).toBe("3");
    } finally { h.dispose(); }
  });

  test("a cloned model echo preserves Rational text and a later incomplete lexeme", async () => {
    const c = controlledCodec(), h = fixture({ codec: c.codec, echo: value => ({ ...value }) });
    try {
      await settle(); h.edit("2/6"); c.requests[0].resolve(ok({ numerator: 1, denominator: 3 })); await settle();
      c.requests[1].resolve(ok("1/3")); await settle();
      expect(c.requests[2].method).toBe("encode"); expect(h.text()).toBe("2/6");
      h.edit("1/"); c.requests[3].resolve(err("Complete the fraction")); await settle();
      c.requests[2].resolve(ok("1/3")); await settle();
      expect(h.text()).toBe("1/"); expect(h.writes).toHaveLength(1); expect(h.api.showError()).toBe(false);
      h.blur(); await settle(); expect(h.api.showError()).toBe(true); expect(c.requests).toHaveLength(4);
    } finally { h.dispose(); }
  });

  test("external replacement wins over an old draft waiting on model encoding", async () => {
    const c = controlledCodec(), h = fixture({ codec: c.codec });
    try {
      await settle(); h.edit("old"); const typed = c.requests[0];
      h.setValue({ exact: "replacement" }); await settle(); const replacement = c.requests[1];
      typed.resolve(ok({ exact: "old" })); await settle(); expect(h.writes).toEqual([]);
      replacement.resolve(ok("replacement")); await settle();
      expect(typed.signal.aborted).toBe(true); expect(h.text()).toBe("replacement"); expect(h.writes).toEqual([]);
      expect(c.requests).toHaveLength(2);
    } finally { h.dispose(); }
  });

  test("typing after an external replacement starts retains its new-model draft", async () => {
    const c = controlledCodec(), h = fixture({ codec: c.codec });
    try {
      await settle(); h.setValue({ exact: "replacement" }); await settle();
      h.edit("fresh"); c.requests[0].resolve(ok("replacement")); await settle();
      expect(h.text()).toBe("fresh");
      c.requests[1].resolve(ok({ exact: "fresh" })); await settle();
      c.requests[2].resolve(ok("fresh")); await settle(); expect(h.writes).toEqual([{ exact: "fresh" }]);
    } finally { h.dispose(); }
  });

  test("blur waits for pending validation and never republishes a completed draft", async () => {
    const c = controlledCodec(), h = fixture({ codec: c.codec });
    try {
      await settle(); h.edit("1e"); h.blur(); expect(h.api.showError()).toBe(false);
      c.requests[0].resolve(err("Incomplete exponent")); await settle(); expect(h.api.showError()).toBe(true);
      h.edit("-0"); c.requests[1].resolve(ok(-0)); await settle(); c.requests[2].resolve(ok("0")); await settle();
      expect(Object.is(h.writes[0], -0)).toBe(true); expect(h.text()).toBe("-0");
      h.blur(); await settle(); expect(h.writes).toHaveLength(1); expect(c.requests).toHaveLength(3);
    } finally { h.dispose(); }
  });

  test("transport rejection after decode refuses publication while source encode Err keeps its existing semantics", async () => {
    for (const transport of [true, false]) {
      const c = controlledCodec(), h = fixture({ codec: c.codec });
      try {
        await settle(); h.edit("typed"); c.requests[0].resolve(ok({ exact: "typed" })); await settle();
        if (transport) c.requests[1].reject(new Error("The reader was replaced"));
        else c.requests[1].resolve(err("Source declined formatting"));
        await settle();
        expect(h.writes).toEqual(transport ? [] : [{ exact: "typed" }]);
        if (transport) { expect(h.validity()).toBe("The reader was replaced"); expect(h.api.showError()).toBe(true); }
      } finally { h.dispose(); }
    }
  });

  // Demo 1 (Nov 8): reopening the editor showed CalendarDate parts empty with
  // the worker's raw "Encodable.encode: Encodable String Int cannot be
  // selected…" text, while the draft held 2026 / 11 / 3.
  test("a held number its codec cannot print keeps its decimal text and shows no codec error", async () => {
    for (const refusal of ["err", "reject"]) {
      const c = controlledCodec(), h = fixture({ codec: c.codec, value: 2026 });
      try {
        await settle(); expect(c.requests[0]?.method).toBe("encode");
        const text = "Encodable.encode: Encodable String Int cannot be selected by its complete type here";
        if (refusal === "err") c.requests[0].resolve(err(text)); else c.requests[0].reject(new Error(text));
        await settle();
        expect(h.text()).toBe("2026");
        expect(h.api.invalid()).toBe(""); expect(h.api.showError()).toBe(false);
        expect(h.writes).toEqual([]);
      } finally { h.dispose(); }
    }
  });

  test("a held model that is no number keeps the codec's refusal", async () => {
    const c = controlledCodec(), h = fixture({ codec: c.codec, value: { exact: "1/3" } });
    try {
      await settle(); c.requests[0].resolve(err("Source declined formatting")); await settle();
      expect(h.text()).toBe(""); expect(h.api.invalid()).toBe("Source declined formatting");
    } finally { h.dispose(); }
  });

  test("a pending gesture retains the callback captured before a later plan callback", async () => {
    const c = controlledCodec(), h = fixture({ codec: c.codec }), later = [];
    try {
      await settle(); h.edit("typed"); c.requests[0].resolve(ok({ exact: "typed" })); await settle();
      h.setOnChange(value => later.push(value)); await settle();
      c.requests[1].resolve(ok("typed")); await settle();
      expect(h.writes).toEqual([{ exact: "typed" }]); expect(later).toEqual([]);
    } finally { h.dispose(); }
  });

  test("a queued callback read captures inert data without executing a callback as an updater", async () => {
    const accepted = { exact: "accepted" }, later = [];
    const h = fixture({ codec: { decode: () => ok(accepted), encode: () => ok("accepted") } });
    try {
      await settle(); h.setOnChange(value => later.push(value));
      h.edit("accepted");
      expect(h.writes).toEqual([]); expect(later).toEqual([accepted]);
      await settle(); expect(later).toEqual([accepted]);
    } finally { h.dispose(); }
  });

  test("native blur and input after disposal cannot start another codec request", async () => {
    const c = controlledCodec(), h = fixture({ codec: c.codec });
    await settle(); h.edit("typed"); h.dispose();
    h.blur(); h.edit("post-dispose"); await settle();
    expect(c.requests).toHaveLength(1); expect(c.requests[0].signal.aborted).toBe(true);
    c.requests[0].resolve(ok({ exact: "typed" })); await settle(); expect(h.writes).toEqual([]);
  });

  for (const change of ["model", "codec", "readonly", "dispose"]) test(`${change} prevents late decoded writes`, async () => {
    const c = controlledCodec(), h = fixture({ codec: c.codec });
    try {
      await settle(); h.edit("old"); const old = c.requests[0];
      if (change === "model") h.setValue({ exact: "replacement" });
      else if (change === "codec") h.setCodec({ decode: () => err("new codec"), encode: () => ok("new model") });
      else if (change === "readonly") h.setReadonly(true);
      else h.dispose();
      await settle(); old.resolve(ok({ exact: "old" }));
      if (change === "model") c.requests[1].resolve(ok("replacement"));
      await settle(); expect(h.writes).toEqual([]);
    } finally { if (change !== "dispose") h.dispose(); }
  });
});


// Run with --conditions=browser --conditions=development: the Solid wrapper's
// explicit dev filename alone does not select the signals package's dev build.
// The matching native reconcileArrays proof is recorded in the performance roadmap.
describe("NumberInput shows a refused part when it is left during a pending transition", () => {
  // Nov 13: a refused decode looked fine because blur returned early while
  // the model was pending, so the draft's refusal was never marked shown.
  test("leaving a refused part while its model is pending shows the refusal", async () => {
    const held = deferred(), codec = { decode: text => text === "1x" ? err("Enter a whole number.") : ok(Number(text)), encode: value => ok(String(value)) };
    let disposeModel, setGeneration, h;
    createRoot(end => {
      disposeModel = end;
      const [generation, update] = createSignal(0); setGeneration = update;
      const model = createMemo(() => generation() === 0 ? undefined : held.promise);
      h = fixture({ codec, valueRead: model });
    });
    try {
      await settle();
      h.edit("1x"); await settle();
      expect(h.api.invalid()).toBe("Enter a whole number."); expect(h.api.showError()).toBe(false);
      setGeneration(1); await settle();
      expect(isPending(() => latest(h.api.frame))).toBe(true);
      h.blur(); await settle();
      expect(h.api.showError()).toBe(true); expect(h.writes).toEqual([]);
    } finally { held.resolve(undefined); h?.dispose(); disposeModel(); flush(); }
  });
});

describe("NumberInput pending native blur in a render effect", () => {
  for (const touched of [false, true]) test(
    `pending blur preserves the ${touched ? "edited" : "untouched"} leaf and settled editing resumes`, async () => {
    const held = deferred(), codec = {
      decode: text => text === "5" ? ok(5) : text === "7" ? ok(7) : err("Unexpected fixture text"),
      encode: value => ok(String(value)),
    };
    let disposeModel, setGeneration, h;
    createRoot(end => {
      disposeModel = end;
      const [generation, update] = createSignal(0); setGeneration = update;
      const model = createMemo(() => generation() === 0 ? 0 : held.promise);
      h = fixture({ codec, valueRead: model });
    });
    let disposeNativeEffect;
    try {
      await settle();
      if (touched) { h.edit("5"); expect(h.writes).toEqual([5]); }
      const text = h.text(), before = [...h.writes];
      setGeneration(1); await settle();
      expect(isPending(h.api.frame)).toBe(true);
      const failures = []; let applyReached = false, pendingInApply = false;
      // A renderer may dispatch native blur while applying DOM reconciliation.
      // Initial render effects run independently of the held model transition.
      createRoot(end => {
        disposeNativeEffect = end;
        createRenderEffect(() => true, () => {
          applyReached = true;
          try { h.blur(); } catch (error) { failures.push(error); }
          pendingInApply = isPending(() => latest(h.api.frame));
        });
      });
      expect(applyReached).toBe(true); expect(pendingInApply).toBe(true);
      expect(failures).toEqual([]); expect(h.writes).toEqual(before); expect(h.text()).toBe(text);
      held.resolve(0); await settle();
      expect(isPending(() => latest(h.api.frame))).toBe(false);
      h.edit("7"); h.blur(); await settle();
      expect(h.writes).toEqual(touched ? [5, 7] : [7]); expect(h.text()).toBe("7");
    } finally {
      held.resolve(0); disposeNativeEffect?.(); h?.dispose(); disposeModel(); flush();
    }
  });
});
