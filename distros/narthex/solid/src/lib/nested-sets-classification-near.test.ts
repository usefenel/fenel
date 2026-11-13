import { describe, expect, test } from "bun:test";
import { createRoot } from "solid-js";
import { createNearScreen, NearScreenContext, useNearScreen, type NearEntry, type NearScreen } from "./nested-sets-classification-near";

// A stand-in for IntersectionObserver: the test decides what is near and on screen.
function fakeObserver() {
  const observed = new Set<object>();
  let callback: ((entries: NearEntry[]) => void) | undefined;
  return {
    observed,
    create: (run: (entries: NearEntry[]) => void) => {
      callback = run;
      return { observe: (target: object) => { observed.add(target); }, unobserve: (target: object) => { observed.delete(target); } };
    },
    report: (entries: NearEntry[]) => callback?.(entries),
  };
}
const onScreen = (target: object): NearEntry => ({ target, isIntersecting: true, boundingClientRect: { top: 100, bottom: 140 } });
const belowFold = (target: object): NearEntry => ({ target, isIntersecting: true, boundingClientRect: { top: 1300, bottom: 1340 } });
const far = (target: object): NearEntry => ({ target, isIntersecting: false, boundingClientRect: { top: 5000, bottom: 5040 } });

describe("marks ask for their pictures nearest the screen first", () => {
  test("the marks on screen go first, even when the document lists marks below the fold before them", () => {
    // The Tree of life: the whole Plants box (53 species) comes before Fungi and Animals in the document, while
    // Fungi and Animals sit on the first screen. Pictures decode one at a time, so the order is what a reader waits for.
    const observer = fakeObserver();
    const deferred: (() => void)[] = [];
    const gate = createNearScreen({ observer: observer.create, visibleBounds: () => ({ top: 0, bottom: 900 }), later: run => { deferred.push(run); } });
    const asked: string[] = [];
    const parsnip = {}, fungi = {}, cow = {}, oyster = {};
    gate.watch(parsnip, () => asked.push("parsnip"));
    gate.watch(fungi, () => asked.push("fungi"));
    gate.watch(cow, () => asked.push("cow"));
    gate.watch(oyster, () => asked.push("oyster"));
    observer.report([belowFold(parsnip), onScreen(fungi), onScreen(cow), far(oyster)]);
    expect(asked).toEqual(["fungi", "cow"]);
    for (const run of deferred.splice(0)) run();
    expect(asked).toEqual(["fungi", "cow", "parsnip"]);
    // The far mark waits for a scroll, then asks once.
    expect(observer.observed.has(oyster)).toBe(true);
    observer.report([onScreen(oyster)]);
    observer.report([onScreen(oyster)]);
    expect(asked).toEqual(["fungi", "cow", "parsnip", "oyster"]);
    expect(observer.observed.size).toBe(0);
  });

  test("a mark removed before it comes near never asks; without an observer every mark asks at once", () => {
    const observer = fakeObserver();
    const gate = createNearScreen({ observer: observer.create, visibleBounds: () => ({ top: 0, bottom: 900 }), later: run => run() });
    const asked: string[] = [];
    const gone = {};
    const stop = gate.watch(gone, () => asked.push("gone"));
    stop();
    observer.report([onScreen(gone)]);
    expect(asked).toEqual([]);
    expect(observer.observed.size).toBe(0);

    const plain = createNearScreen({ observer: () => undefined });
    plain.watch({}, () => asked.push("now"));
    expect(asked).toEqual(["now"]);
  });

  test("closing the gate stops watching", () => {
    const observer = fakeObserver();
    let disconnected = false;
    const gate = createNearScreen({ observer: run => ({ ...observer.create(run), disconnect: () => { disconnected = true; } }),
      visibleBounds: () => ({ top: 0, bottom: 900 }), later: run => run() });
    const asked: string[] = [];
    gate.watch({}, () => asked.push("late"));
    gate.close();
    expect(disconnected).toBe(true);
    observer.report([onScreen({})]);
    expect(asked).toEqual([]);
  });
});

// The Tree and Graph cards draw a classification's link marks outside the
// Boxes drawing, so no gate is provided there. Solid 2 treats a context whose
// default is undefined as having no default and throws ContextNotFoundError,
// which the typed reader's Errored boundary turned into the generic record
// (the Tree of life's "Tree" button, Nov 13).
describe("a mark outside the Boxes drawing", () => {
  test("reads no gate, without throwing", () => {
    const read = createRoot(dispose => { try { return { gate: useNearScreen() }; } catch (error) { return { error: String(error) }; } finally { dispose(); } });
    expect(read).toEqual({ gate: undefined });
  });
  test("reads the gate the Boxes drawing provides", () => {
    const gate = createNearScreen({ observer: () => undefined });
    let read: NearScreen | undefined | "threw";
    createRoot(dispose => {
      const rendered: unknown = NearScreenContext({ value: gate, get children() { try { read = useNearScreen(); } catch { read = "threw"; } return null; } });
      if (typeof rendered === "function") rendered();
      dispose();
    });
    expect(read).toBe(gate);
  });
});
