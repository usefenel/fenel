import { describe, expect, it } from "bun:test";

import {
  exactImmutableDataEqual,
  exactImmutableDataSnapshot,
  immutableCandidateRoster,
} from "./self-host-immutable-data";
import {
  compileConstructorSlotConflicts,
  compileConstructorSlotTable,
  isCompilerOwnedStableSlotList,
  isCompilerOwnedStableSlotTable,
} from "./compile-field-slots";
import {
  withEngineDispatchEvaluationSnapshot,
  withInterpretedResolver,
} from "./engine-bodies-dispatch";
import { exactOwnDataEqual, exactOwnDataSnapshot } from "./own-data-snapshot";

function withInheritedDescriptorMember<T>(
  key: "value" | "get" | "set", descriptor: PropertyDescriptor, run: () => T,
): T {
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, key);
  Object.defineProperty(Object.prototype, key,
    Object.setPrototypeOf({ ...descriptor, configurable: true }, null));
  try { return run(); }
  finally {
    Reflect.deleteProperty(Object.prototype, key);
    if (previous !== undefined) Object.defineProperty(Object.prototype, key, previous);
  }
}

// Compile-time contract: a freshness proof turn is necessarily synchronous,
// including when a callback's inferred result is a value/Promise union.
if (false) {
  const exactNumber: number = withEngineDispatchEvaluationSnapshot(() => 1);
  void exactNumber;
  // @ts-expect-error snapshot scopes must not cross a Promise turn
  withEngineDispatchEvaluationSnapshot(async () => 1);
  // @ts-expect-error unions containing a Promise are asynchronous too
  withEngineDispatchEvaluationSnapshot((): number | Promise<number> => 1);
}

describe("self-host immutable compiler data", () => {
  it("exports an authority-isolated deeply frozen candidate roster", () => {
    const body = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(body, "__proto__", {
      value: { literal: "hostile-own-data" },
      enumerable: true,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(body, "hidden", {
      value: { literal: 1 },
      enumerable: false,
      configurable: true,
      writable: true,
    });
    const source = { id: "demo:one", params: [], body };
    const registryRoster = [source];

    const roster = immutableCandidateRoster(registryRoster);
    const exported = roster[0]!;
    expect(roster).not.toBe(registryRoster);
    expect(exported).not.toBe(source);
    expect(exported.body).not.toBe(body);
    expect(Object.isFrozen(roster)).toBe(true);
    expect(Object.isFrozen(exported)).toBe(true);
    expect(Object.isFrozen(exported.body)).toBe(true);
    expect(Object.getPrototypeOf(exported.body)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(exported.body, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(exported.body, "hidden")?.enumerable).toBe(false);

    source.id = "demo:changed";
    (body.hidden as { literal: number }).literal = 2;
    expect(exported.id).toBe("demo:one");
    expect((exported.body.hidden as { literal: number }).literal).toBe(1);
    expect(() => Object.defineProperty(exported.body, "late", { value: true })).toThrow();
  });

  it("revalidates nested and non-enumerable own data exactly", () => {
    const input = { name: "demo", body: { literal: 1 } };
    Object.defineProperty(input.body, "hidden", {
      value: { semantic: "first" },
      enumerable: false,
      configurable: true,
      writable: true,
    });
    const first = exactImmutableDataSnapshot(input);
    const same = exactImmutableDataSnapshot(input);
    expect(first.status).toBe("ok");
    expect(same.status).toBe("ok");
    if (first.status !== "ok" || same.status !== "ok") return;
    expect(exactImmutableDataEqual(first.value, same.value)).toBe(true);

    ((input.body as unknown as Record<string, unknown>).hidden as { semantic: string })
      .semantic = "second";
    const changed = exactImmutableDataSnapshot(input);
    expect(changed.status).toBe("ok");
    if (changed.status !== "ok") return;
    expect(exactImmutableDataEqual(first.value, changed.value)).toBe(false);
  });

  it("does not invoke accessors or treat them as cacheable authority", () => {
    let reads = 0;
    const input = Object.defineProperty({}, "body", {
      enumerable: true,
      get() {
        reads += 1;
        return { literal: reads };
      },
    });
    const snapshot = exactImmutableDataSnapshot(input);
    expect(snapshot.status).toBe("uncacheable");
    expect(reads).toBe(0);
  });

  it("rejects accessors despite inherited descriptor values in snapshots and equality", () => {
    let reads = 0;
    const symbol = Symbol("accessor");
    for (const [input, key, enumerable] of [
      [{}, "body", true], [{}, "hidden", false], [{}, symbol, true], [new Array(1), "0", true],
    ] as const) {
      Object.defineProperty(input, key, {
        get() { reads++; return "live"; }, enumerable,
      });
      const otherAccessor = Array.isArray(input) ? new Array(1) : {};
      Object.defineProperty(otherAccessor, key, {
        get() { reads++; return "different"; }, enumerable,
      });
      const data = Array.isArray(input) ? new Array(1) : {};
      Object.defineProperty(data, key, { value: "counterfeit", enumerable });
      const result = withInheritedDescriptorMember("value", { value: "counterfeit" }, () => ({
        snapshot: exactImmutableDataSnapshot(input),
        accessorEqual: exactImmutableDataEqual(input, otherAccessor),
        dataEqual: exactImmutableDataEqual(input, data),
      }));
      expect(reads).toBe(0);
      expect(result.snapshot.status).toBe("uncacheable");
      expect(result.accessorEqual).toBe(false);
      expect(result.dataEqual).toBe(false);
    }
  });

  it("never reads inherited descriptor-value getters", () => {
    let sourceReads = 0, descriptorReads = 0;
    const input = Object.defineProperty({}, "body", {
      get() { sourceReads++; return "live"; }, enumerable: true,
    });
    const result = withInheritedDescriptorMember("value", {
      get() { descriptorReads++; return "counterfeit"; },
    }, () => ({ snapshot: exactImmutableDataSnapshot(input), equal: exactImmutableDataEqual(input, { body: "counterfeit" }) }));
    expect(sourceReads).toBe(0);
    expect(descriptorReads).toBe(0);
    expect(result.snapshot.status).toBe("uncacheable");
    expect(result.equal).toBe(false);
  });

  for (const key of ["get", "set"] as const) {
    it(`isolates output definition descriptors from inherited ${key}`, () => {
      let reads = 0;
      const input = { body: { literal: 1 }, params: ["value"] };
      const snapshot = withInheritedDescriptorMember(key, {
        get() { reads++; return () => undefined; },
      }, () => exactImmutableDataSnapshot(input));
      expect(reads).toBe(0);
      expect(snapshot.status).toBe("ok");
      if (snapshot.status !== "ok") return;
      expect(snapshot.value).toEqual(input);
      expect(snapshot.value).not.toBe(input);
      expect(snapshot.value.body).not.toBe(input.body);
      expect(Object.getPrototypeOf(snapshot.value)).toBe(Object.prototype);
      expect(Object.getPrototypeOf(snapshot.value.params)).toBe(Array.prototype);
      expect(Object.isFrozen(snapshot.value.body)).toBe(true);
      expect(Object.getOwnPropertyDescriptor(snapshot.value, "body")).toEqual({
        value: snapshot.value.body, enumerable: true, writable: false, configurable: false,
      });
      expect(Object.isFrozen(input.body)).toBe(false);
    });
  }

  it("keeps Proxy errors as snapshot refusals and propagates them from equality", () => {
    for (const trap of ["getPrototypeOf", "ownKeys", "getOwnPropertyDescriptor"] as const) {
      const error = new Error(`original ${trap} error`);
      const input = new Proxy({ body: "literal" }, { [trap]() { throw error; } });
      expect(exactImmutableDataSnapshot(input)).toEqual({ status: "uncacheable", reason: error.message });
      expect(() => exactImmutableDataEqual(input, { body: "literal" })).toThrow(error);
      expect(exactImmutableDataEqual(input, input)).toBe(true);
    }
  });

  it("preserves aliases, cycles, symbols and sparse array topology without freezing inputs", () => {
    const symbol = Symbol("list"), shared = { literal: -0 };
    const input = Object.create(null) as Record<PropertyKey, unknown>;
    const list = new Array(3);
    Object.defineProperty(list, "1", { value: shared, enumerable: true });
    Object.defineProperty(input, "hidden", { value: shared, enumerable: false });
    input[symbol] = list;
    input.cycle = input;
    const snapshot = exactImmutableDataSnapshot(input);
    expect(snapshot.status).toBe("ok");
    if (snapshot.status !== "ok") return;
    const copiedList = snapshot.value[symbol] as unknown[];
    expect(Object.getPrototypeOf(snapshot.value)).toBeNull();
    expect(Reflect.ownKeys(snapshot.value)).toEqual(Reflect.ownKeys(input));
    expect(snapshot.value.hidden).not.toBe(shared);
    expect(copiedList).not.toBe(list);
    expect(snapshot.value.hidden).toBe(copiedList[1]);
    expect(snapshot.value.cycle).toBe(snapshot.value);
    expect(Object.hasOwn(copiedList, "0")).toBe(false);
    expect(Object.hasOwn(copiedList, "2")).toBe(false);
    expect(Object.getOwnPropertyDescriptor(copiedList, "length")).toEqual({
      value: 3, enumerable: false, writable: false, configurable: false,
    });
    expect(Object.isFrozen(copiedList)).toBe(true);
    expect(Object.isFrozen(snapshot.value.hidden)).toBe(true);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(shared)).toBe(false);
    expect(exactImmutableDataEqual(input, snapshot.value)).toBe(true);
    shared.literal = 0;
    expect(exactImmutableDataEqual(input, snapshot.value)).toBe(false);
  });

  it("rejects cross-root alias splits through shared descendants and backedges", () => {
    const shared = { literal: 1 }, parent = { child: shared };
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const backLeft: Record<string, unknown> = {};
    const backShared = { owner: backLeft };
    backLeft.child = backShared;
    const cases: Array<readonly [unknown, unknown]> = [
      [{ first: shared, second: shared }, { first: shared, second: { literal: 1 } }],
      [{ parent, separate: shared }, { parent, separate: { literal: 1 } }],
      [{ shared: cycle, separate: cycle }, { shared: cycle, separate: { self: cycle } }],
      [backLeft, { child: backShared }],
    ];
    for (const [left, right] of cases) {
      for (const equal of [exactOwnDataEqual, exactImmutableDataEqual]) {
        expect(equal(left, right)).toBe(false);
        expect(equal(right, left)).toBe(false);
      }
      const leftCopy = exactImmutableDataSnapshot(left), rightCopy = exactImmutableDataSnapshot(right);
      expect(leftCopy.status).toBe("ok");
      expect(rightCopy.status).toBe("ok");
      if (leftCopy.status !== "ok" || rightCopy.status !== "ok") continue;
      expect(exactImmutableDataEqual(leftCopy.value, rightCopy.value)).toBe(false);
      expect(exactImmutableDataEqual(rightCopy.value, leftCopy.value)).toBe(false);
    }
  });

  it("agrees with canonical rooted graphs when the roots share arbitrary cyclic data", () => {
    // Independent oracle for this integer/two-edge-record grammar: first-discovery
    // numbering records the complete rooted graph without pairwise comparison.
    const canonical = (root: object): string => {
      const ids = new Map<object, number>([[root, 0]]), pending = [root], rows: unknown[] = [];
      const encode = (value: unknown): unknown => {
        if (value === null || typeof value !== "object") return ["scalar", value];
        let id = ids.get(value);
        if (id === undefined) { id = ids.size; ids.set(value, id); pending.push(value); }
        return ["node", id];
      };
      for (let index = 0; index < pending.length; index++) {
        rows.push(Object.entries(pending[index]!).map(([key, value]) => [key, encode(value)]));
      }
      return JSON.stringify(rows);
    };
    let seed = 0x51f15e;
    const draw = (limit: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return (seed >>> 8) % limit;
    };
    for (let fixture = 0; fixture < 512; fixture++) {
      const nodes = Array.from({ length: 6 }, () => ({ first: 0 as unknown, second: 0 as unknown }));
      for (const node of nodes) for (const key of ["first", "second"] as const) {
        const edge = draw(8);
        node[key] = edge < nodes.length ? nodes[edge] : edge - nodes.length;
      }
      const left = nodes[0]!, right = nodes[1]!;
      const expected = canonical(left) === canonical(right);
      expect(exactOwnDataEqual(left, right)).toBe(expected);
      expect(exactOwnDataEqual(right, left)).toBe(expected);
      expect(exactImmutableDataEqual(left, right)).toBe(expected);
      expect(exactImmutableDataEqual(right, left)).toBe(expected);
    }
    const first = { literal: 1 }, second = { literal: 1 };
    expect(exactOwnDataEqual({ first, second }, { first: second, second: first })).toBe(true);
  });

  it("keeps identical accessor carriers opaque while checking their own data descendants", () => {
    let reads = 0;
    const shared = { literal: 1 };
    const carrier = Object.defineProperty({ child: shared }, "accessor", {
      get() { reads++; return "live"; }, enumerable: true,
    });
    for (const equal of [exactOwnDataEqual, exactImmutableDataEqual]) {
      expect(equal({ carrier }, { carrier })).toBe(true);
      expect(equal({ carrier, other: shared }, { carrier, other: { literal: 1 } })).toBe(false);
      expect(equal({ carrier: Object.defineProperty({ child: shared }, "accessor", {
        get() { reads++; return "live"; }, enumerable: true,
      }) }, { carrier })).toBe(false);
    }
    expect(reads).toBe(0);
    expect(exactImmutableDataSnapshot(carrier).status).toBe("uncacheable");
  });

  it("observes nested identity Proxy descriptors while root identity remains trap-free", () => {
    let prototypeObservations = 0;
    const samePrototype = new Proxy({ body: "literal" }, {
      getPrototypeOf() { prototypeObservations++; throw new Error("unnecessary prototype observation"); },
    });
    for (const equal of [exactOwnDataEqual, exactImmutableDataEqual]) {
      expect(equal(samePrototype, samePrototype)).toBe(true);
      expect(equal({ shared: samePrototype }, { shared: samePrototype })).toBe(true);
    }
    expect(prototypeObservations).toBe(0);
    for (const trap of ["ownKeys", "getOwnPropertyDescriptor"] as const) {
      const error = new Error(`nested ${trap} error`);
      let observations = 0;
      const shared = new Proxy({ body: "literal" }, { [trap]() { observations++; throw error; } });
      for (const equal of [exactOwnDataEqual, exactImmutableDataEqual]) {
        const before = observations;
        expect(equal(shared, shared)).toBe(true);
        expect(observations).toBe(before);
        expect(() => equal({ shared }, { shared })).toThrow(error);
      }
      expect(exactImmutableDataSnapshot(shared)).toEqual({ status: "uncacheable", reason: error.message });
    }
  });

  it("preserves scalar and function identity without promising native hidden-slot equality", () => {
    const fn = () => undefined;
    for (const equal of [exactOwnDataEqual, exactImmutableDataEqual]) {
      expect(equal({ value: NaN, zero: -0, fn }, { value: NaN, zero: -0, fn })).toBe(true);
      expect(equal({ value: -0 }, { value: 0 })).toBe(false);
      expect(equal({ fn }, { fn: () => undefined })).toBe(false);
      // Dates remain outside snapshot admission; legacy raw comparison sees own data only.
      expect(equal(new Date(0), new Date(1))).toBe(true);
    }
    expect(exactImmutableDataSnapshot(fn).status).toBe("uncacheable");
    expect(exactImmutableDataSnapshot(new Date(0)).status).toBe("uncacheable");
  });

  it("preserves only the unforgeable frozen compiler-slot capability", () => {
    const compilerOwned = withInterpretedResolver(() =>
      compileConstructorSlotTable({ listIdentifiedEntities: () => [] })
    );
    expect(isCompilerOwnedStableSlotTable(compilerOwned)).toBe(true);
    const trusted = exactImmutableDataSnapshot({ ctorDefs: compilerOwned });
    expect(trusted.status).toBe("ok");
    if (trusted.status === "ok") {
      expect(trusted.value.ctorDefs).toBe(compilerOwned);
    }

    const callerOwned = Object.freeze(Object.create(null) as Record<string, unknown>);
    const ordinary = exactImmutableDataSnapshot({ ctorDefs: callerOwned });
    expect(ordinary.status).toBe("ok");
    if (ordinary.status === "ok") {
      expect(ordinary.value.ctorDefs).not.toBe(callerOwned);
      expect(Object.isFrozen(ordinary.value.ctorDefs)).toBe(true);
    }
  });

  it("uses identity, including private conflict state, for capable slot tables", () => {
    const noLabel = { $tag: "Nothing" as const };
    const ambiguous = withInterpretedResolver(() =>
      compileConstructorSlotTable({
        listIdentifiedEntities: () => [
          {
            id: "LeftOwner",
            type: { $variant: { cases: [{ name: "Clash", label: noLabel, fields: [] }] } },
          },
          {
            id: "RightOwner",
            type: { $variant: { cases: [{ name: "Clash", label: noLabel, fields: [] }] } },
          },
        ],
      })
    );
    // Keep the exact owner-qualified rows. Copy only their public own data,
    // without the compiler capability or private ambiguity certificate.
    const publicSnapshot = exactOwnDataSnapshot(ambiguous);
    expect(publicSnapshot.status).toBe("ok");
    if (publicSnapshot.status !== "ok") return;
    const callerOwned = publicSnapshot.value;
    expect(Reflect.ownKeys(ambiguous).length).toBeGreaterThan(0);
    expect(Object.hasOwn(ambiguous, "Clash")).toBe(false);
    expect(Reflect.ownKeys(callerOwned)).toEqual(Reflect.ownKeys(ambiguous));
    expect(Object.isFrozen(callerOwned)).toBe(true);
    expect(callerOwned).not.toBe(ambiguous);
    expect(isCompilerOwnedStableSlotTable(ambiguous)).toBe(true);
    expect(isCompilerOwnedStableSlotTable(callerOwned)).toBe(false);
    expect(exactOwnDataEqual(ambiguous, callerOwned)).toBe(true);
    expect(compileConstructorSlotConflicts(ambiguous)).toEqual(["Clash"]);
    expect(compileConstructorSlotConflicts(callerOwned)).toEqual([]);
    expect(exactImmutableDataEqual(ambiguous, ambiguous)).toBe(true);
    expect(exactImmutableDataEqual(ambiguous, callerOwned)).toBe(false);
    const slotList = Object.values(ambiguous).find(isCompilerOwnedStableSlotList);
    expect(slotList).toBeDefined();
    if (slotList === undefined) return;
    const publicList = exactOwnDataSnapshot(slotList);
    expect(publicList.status).toBe("ok");
    if (publicList.status !== "ok") return;
    expect(exactOwnDataEqual(slotList, publicList.value)).toBe(true);
    expect(exactImmutableDataEqual(slotList, publicList.value)).toBe(false);
    expect(exactImmutableDataEqual({ table: ambiguous, list: slotList }, { table: ambiguous, list: slotList })).toBe(true);
    const trusted = exactImmutableDataSnapshot({ table: ambiguous, list: slotList });
    expect(trusted.status).toBe("ok");
    if (trusted.status !== "ok") return;
    expect(trusted.value.table).toBe(ambiguous);
    expect(trusted.value.list).toBe(slotList);
  });
});
