// C1/C2 differential fixture: execute the actual pre-repair B3 host boundary.
import { beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { stdNatives, stdNativesCtx } from "../../../../fenel/modules/std/ffi/std-ffi";
import { __getHarnessForTests } from "../src/engine-bodies-dispatch";
import { invokeCallable, runtimeRepresentationInspect, type EvaluateContext } from "../src/json-logic";
import type { FenelFunction } from "../src/types";

const BASELINE_SHA256 = "e3149b02c73cb3ce5e457f5cb755e4fc1e1ee2dd90804710470201aca460907d";
const DECODER = "std:representationSnapshotConstructorFields";
const leaves = [
  "integerNatNativeFromMarker", "integerIntNativeFromMarker", "rationalNativeFromMarker",
  "typeUnionFromMarker", "taggedSingletonTypeFromMarker",
] as const;
type Leaf = typeof leaves[number];
type BaselineLeaves = Record<Leaf, (ctx: EvaluateContext, marker: unknown) => unknown>;
let baseline: BaselineLeaves;
let canonical: EvaluateContext;

beforeAll(async () => {
  // The fixture preserves the actual production primitive functions and map
  // entries, and works in shallow/exported checkouts without historical Git.
  const original = readFileSync(resolve(import.meta.dir, "fixtures/marker-leaf-native-before.txt"));
  expect(createHash("sha256").update(original).digest("hex")).toBe(BASELINE_SHA256);
  const evaluator = pathToFileURL(resolve(import.meta.dir, "../src/json-logic.ts")).href;
  const fragment = `import { invokeCallable, representationValueSnapshot } from ${JSON.stringify(evaluator)};\n`
    + original.toString("utf8");
  const javascript = new Bun.Transpiler({ loader: "ts", target: "bun" }).transformSync(fragment);
  const module = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`) as {
    originalMarkerLeaves: BaselineLeaves;
  };
  baseline = module.originalMarkerLeaves;
  canonical = __getHarnessForTests().ctx;
}, 180_000);

const names: Record<Leaf, string[]> = {
  integerNatNativeFromMarker: ["carrier"], integerIntNativeFromMarker: ["carrier"],
  rationalNativeFromMarker: ["num", "den"], typeUnionFromMarker: ["members"],
  taggedSingletonTypeFromMarker: ["base", "phantomBase", "constraint"],
};

function payloads(leaf: Leaf, digits = false): unknown[] {
  if (leaf.startsWith("integer")) return [digits
    ? { $tag: "IntegerDigits", digits: [1, 2, 3] }
    : { $tag: "IntegerSmall", value: leaf === "integerNatNativeFromMarker" ? 7 : -7 }];
  if (leaf === "rationalNativeFromMarker") return [{ $tag: "Int", digits: [1] }, { $tag: "Nat", digits: [2] }];
  if (leaf === "typeUnionFromMarker") return [[{ $ref: "Int" }, { $unit: true }]];
  return [{ $ref: "Int" }, { $unit: true }, { $tag: "SeAll" }];
}

function marker(leaf: Leaf, values: unknown[], positional = false, tagged = true): Record<string, unknown> {
  return Object.assign(tagged ? { $tag: "Marker" } : {}, Object.fromEntries(values.map((value, i) => [
    positional ? `_${i}` : names[leaf][i]!, value,
  ])));
}

function current(leaf: Leaf, value: unknown): unknown {
  const native = stdNatives[leaf];
  if (native === undefined) throw new Error(`${leaf} is absent from the plain native map`);
  return native(value);
}

type Outcome = { ok: true; value: unknown } | { ok: false; name: string; message: string };
function outcome(body: () => unknown): Outcome {
  try { return { ok: true, value: body() }; }
  catch (error) {
    if (!(error instanceof Error)) throw error;
    return { ok: false, name: error.name, message: error.message };
  }
}

function observed(value: object, label: string, events: string[], refused?: string): object {
  return new Proxy(value, {
    getPrototypeOf(target) {
      events.push(`${label}:prototype`);
      if (refused === "prototype") throw new Error("unreadable prototype");
      return Reflect.getPrototypeOf(target);
    },
    ownKeys(target) {
      events.push(`${label}:keys`);
      if (refused === "keys") throw new Error("unreadable own keys");
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, key) {
      events.push(`${label}:descriptor:${String(key)}`);
      if (refused === `descriptor:${String(key)}`) throw new Error("unreadable descriptor");
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    get(_target, key) {
      events.push(`${label}:get:${String(key)}`);
      throw new Error("raw marker properties must only be inspected by descriptor");
    },
  });
}

function checkPair(leaf: Leaf, fixture: (events: string[]) => unknown): {
  old: Outcome; repaired: Outcome; events: string[];
} {
  const oldEvents: string[] = [];
  const newEvents: string[] = [];
  const old = outcome(() => baseline[leaf](canonical, fixture(oldEvents)));
  const repaired = outcome(() => current(leaf, fixture(newEvents)));
  expect(repaired).toEqual(old);
  expect(newEvents).toEqual(oldEvents);
  expect(newEvents.some(event => event.includes(":get:"))).toBe(false);
  return { old, repaired, events: newEvents };
}

describe("fixed marker leaf native boundary", () => {
  test("all five leaves are plain natives with no context-native shadow", () => {
    for (const leaf of leaves) {
      expect(typeof stdNatives[leaf]).toBe("function");
      expect(Object.hasOwn(stdNativesCtx, leaf)).toBe(false);
    }
  });

  test("public source type builders reach the same dollar-key envelopes", () => {
    const base = { $ref: "Int" };
    const phantomBase = { $ref: "Anything" };
    const phantomValue = { note: "retained data" };
    const members = [base, { $unit: true }];
    const union = invokeCallable({ $ref: "std:typeUnion" }, [members], canonical) as { $union: unknown[] };
    expect(union).toEqual({ $union: members });
    expect(union.$union).toBe(members);
    const tagged = invokeCallable({ $ref: "std:taggedSingletonType" }, [base, phantomBase, phantomValue], canonical) as {
      $tagged: { value: unknown; phantom: { $refined: { base: unknown; set: { $tag: string; values: unknown[] } } } };
    };
    expect(tagged).toEqual({ $tagged: { value: base, phantom: { $refined: {
      base: phantomBase, set: { $tag: "SeEnum", values: [phantomValue] },
    } } } });
    expect(tagged.$tagged.value).toBe(base);
    expect(tagged.$tagged.phantom.$refined.base).toBe(phantomBase);
    expect(tagged.$tagged.phantom.$refined.set.values[0]).toBe(phantomValue);
  });

  test("named, positional and tagless payloads preserve the original results and child identities", () => {
    for (const leaf of leaves) {
      for (const positional of [false, true]) {
        for (const tagged of [false, true]) {
          const values = payloads(leaf);
          if (leaf.startsWith("integer") && positional) {
            const carrier = values[0] as { $tag: string; value: unknown };
            values[0] = { $tag: carrier.$tag, _0: carrier.value };
          }
          const input = marker(leaf, values, positional, tagged);
          expect(current(leaf, input)).toEqual(baseline[leaf](canonical, input));
          // The normal canonical caller still reaches the same bodyless leaf.
          expect(invokeCallable({ $ref: `std:${leaf}` }, [input], canonical)).toEqual(current(leaf, input));
          const result = current(leaf, input) as Record<string, unknown>;
          if (leaf === "rationalNativeFromMarker") {
            expect(result.num).toBe(values[0]);
            expect(result.den).toBe(values[1]);
          } else if (leaf === "typeUnionFromMarker") {
            expect(result.$union).toBe(values[0]);
          } else if (leaf === "taggedSingletonTypeFromMarker") {
            const taggedResult = result.$tagged as { value: unknown; phantom: { $refined: { base: unknown; set: unknown } } };
            expect(taggedResult.value).toBe(values[0]);
            expect(taggedResult.phantom.$refined.base).toBe(values[1]);
            expect(taggedResult.phantom.$refined.set).toBe(values[2]);
          }
        }
      }
      if (leaf.startsWith("integer")) {
        for (const positional of [false, true]) {
          const values = payloads(leaf, true);
          const carrier = values[0] as { $tag: string; digits: unknown[] };
          const digits = carrier.digits;
          values[0] = positional ? { $tag: carrier.$tag, _0: digits } : carrier;
          const input = marker(leaf, values, positional);
          const result = current(leaf, input) as { $tag: string; digits: unknown[] };
          expect(result as unknown).toEqual(baseline[leaf](canonical, input));
          expect(result.$tag).toBe(leaf === "integerNatNativeFromMarker" ? "Nat" : "Int");
          expect(result.digits).toBe(digits);
        }
      }
    }
  });

  test("descriptor observations preserve exact order on accepted markers", () => {
    for (const leaf of leaves) {
      const result = checkPair(leaf, events => {
        const values = payloads(leaf);
        if (leaf.startsWith("integer")) values[0] = observed(values[0] as object, "carrier", events);
        return observed(marker(leaf, values), "outer", events);
      });
      expect(result.repaired.ok).toBe(true);
      const expected = ["outer:prototype", "outer:keys", "outer:descriptor:$tag",
        ...names[leaf].map(name => `outer:descriptor:${name}`)];
      if (leaf.startsWith("integer")) expected.push(
        "carrier:descriptor:$tag", "carrier:prototype", "carrier:keys",
        "carrier:descriptor:$tag", "carrier:descriptor:value",
      );
      expect(result.events).toEqual(expected);
    }
  });

  test("missing, excess and duplicate aliases refuse at the same descriptor boundary", () => {
    for (const leaf of leaves) {
      const cases = ["missing", "excess", "duplicate", "duplicate-different", "balanced-duplicate"] as const;
      for (const kind of cases) {
        const result = checkPair(leaf, events => {
          const values = payloads(leaf);
          if (leaf.startsWith("integer")) values[0] = observed(values[0] as object, "carrier", events);
          const input = marker(leaf, values);
          if (kind === "missing") delete input[names[leaf].at(-1)!];
          if (kind === "excess") input.extra = "unexpected";
          if (kind.startsWith("duplicate") || kind === "balanced-duplicate") {
            input._0 = kind === "duplicate-different" ? "different" : values[0];
            if (kind === "balanced-duplicate" && names[leaf].length > 1) delete input[names[leaf].at(-1)!];
          }
          return observed(input, "outer", events);
        });
        expect(result.repaired).toEqual({
          ok: false, name: "TypeError", message: "Invalid constructor payload at the representation boundary",
        });
        expect(result.events.some(event => event.startsWith("carrier:"))).toBe(false);
      }
    }
  });

  test("accessors and unreadable descriptor proxies refuse without invoking getters", () => {
    for (const leaf of leaves) {
      for (const refusal of ["accessor", "prototype", "keys", "descriptor:$tag"] as const) {
        let getterCalls = 0;
        const result = checkPair(leaf, events => {
          const input = marker(leaf, payloads(leaf));
          if (refusal === "accessor") Object.defineProperty(input, names[leaf][0]!, {
            enumerable: true, get: () => { getterCalls++; throw new Error("getter must never run"); },
          });
          return observed(input, "outer", events, refusal);
        });
        expect(result.repaired.ok).toBe(false);
        expect(getterCalls).toBe(0);
        if (refusal === "prototype") expect(result.events).toEqual(["outer:prototype"]);
        if (refusal === "keys") expect(result.events).toEqual(["outer:prototype", "outer:keys"]);
        if (refusal === "descriptor:$tag") expect(result.events).toEqual([
          "outer:prototype", "outer:keys", "outer:descriptor:$tag",
        ]);
      }
    }
  });

  test("integer carrier failures retain tag-first observation and precise refusal timing", () => {
    for (const leaf of ["integerNatNativeFromMarker", "integerIntNativeFromMarker"] as const) {
      for (const kind of ["wrong-tag", "missing", "excess", "duplicate", "accessor", "unreadable"] as const) {
        let getterCalls = 0;
        const result = checkPair(leaf, events => {
          const carrier: Record<string, unknown> = { $tag: "IntegerSmall", value: 5 };
          if (kind === "wrong-tag") carrier.$tag = "Unrelated";
          if (kind === "missing") delete carrier.value;
          if (kind === "excess") carrier.extra = 1;
          if (kind === "duplicate") carrier._0 = carrier.value;
          if (kind === "accessor") Object.defineProperty(carrier, "value", {
            enumerable: true, get: () => { getterCalls++; throw new Error("carrier getter must never run"); },
          });
          const wrapped = observed(carrier, "carrier", events, kind === "unreadable" ? "keys" : undefined);
          return observed(marker(leaf, [wrapped]), "outer", events);
        });
        expect(result.repaired.ok).toBe(false);
        expect(getterCalls).toBe(0);
        expect(result.events.slice(0, 5)).toEqual([
          "outer:prototype", "outer:keys", "outer:descriptor:$tag", "outer:descriptor:carrier", "carrier:descriptor:$tag",
        ]);
        if (kind === "wrong-tag") {
          expect(result.events).toHaveLength(5);
          expect(result.repaired).toEqual({
            ok: false, name: "TypeError", message: "Invalid integer carrier constructor at the representation boundary",
          });
        }
        if (kind === "unreadable") expect(result.events).toHaveLength(7);
      }
    }
  });

  test("the fixed raw decoder bypasses hostile global and scoped Reprable lookup", () => {
    const routing = canonical._routingTable;
    const version = canonical._routingTableVersion;
    const dictionary = canonical._dictStack;
    let representationReads = 0;
    let scopedLowerCalls = 0;
    const originalTable = routing?.();
    if (originalTable === null || typeof originalTable !== "object") throw new Error("Canonical routing table is missing");
    const hostileTable = { ...originalTable };
    Object.defineProperty(hostileTable, "instanceIdx", {
      configurable: true,
      get: () => { representationReads++; throw new Error("raw decoder requested semantic Reprable lookup"); },
    });
    const scopedMethods = { native: { $ref: "Int" } } as Record<string, unknown>;
    Object.defineProperty(scopedMethods, "lower", {
      get: () => { scopedLowerCalls++; throw new Error("raw decoder requested scoped Reprable lower"); },
    });
    canonical._routingTable = () => hostileTable;
    canonical._routingTableVersion = undefined;
    canonical._dictStack = [{ typeName: "Reprable", args: ["JsRuntime", "RepresentationValueSnapshot"], methods: scopedMethods }];
    try {
      // Positive control: ordinary semantic inspection reaches this canary.
      expect(outcome(() => runtimeRepresentationInspect({ $tag: "Rational", num: 3, den: 4 }, canonical)).ok).toBe(false);
      expect(representationReads).toBe(1);
      representationReads = 0;
      for (const leaf of leaves) {
        expect(outcome(() => current(leaf, marker(leaf, payloads(leaf)))).ok).toBe(true);
        expect(outcome(() => current(leaf, marker(leaf, []))).ok).toBe(false);
      }
      expect(representationReads).toBe(0);
      expect(scopedLowerCalls).toBe(0);
    } finally {
      canonical._routingTable = routing;
      canonical._routingTableVersion = version;
      canonical._dictStack = dictionary;
    }
  });

  test("a caller override of the exact private decoder is the intentional ABI difference", () => {
    let overrideCalls = 0;
    const originalDecoder = canonical.getFunction?.(DECODER);
    if (originalDecoder === undefined) throw new Error("Canonical constructor decoder is missing");
    const caller: EvaluateContext = {
      ...canonical,
      getFunction: name => name === DECODER ? { ...originalDecoder, id: "marker-test:decoder", body: undefined } as FenelFunction
        : canonical.getFunction?.(name),
      natives: {
        ...canonical.natives,
        "marker-test:decoder": () => { overrideCalls++; return { $tag: "Just", _0: ["override-num", "override-den"] }; },
      },
    };
    const input = marker("rationalNativeFromMarker", [3, 4]);
    expect(baseline.rationalNativeFromMarker(caller, input)).toEqual({ $tag: "Rational", num: "override-num", den: "override-den" });
    expect(overrideCalls).toBe(1);
    expect(invokeCallable({ $ref: "std:rationalNativeFromMarker" }, [input], caller)).toEqual({ $tag: "Rational", num: 3, den: 4 });
    expect(overrideCalls).toBe(1);
  });
});
