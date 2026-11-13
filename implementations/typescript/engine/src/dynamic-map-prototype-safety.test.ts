import { describe, expect, test } from "bun:test";

import { stdNatives } from "../../../../fenel/modules/std/ffi/std-ffi";
import { getResolverNamespace } from "./engine-bodies-dispatch";
import { createRegistry } from "./registry";
import { dispatchModule } from "./modules/dispatch";
import { stdModule } from "./modules/std";

type DynamicMapRuntime = {
  fromEntries: (pairs: unknown) => unknown;
  mapGet: (record: unknown, key: unknown) => unknown;
};

type CompiledPatternRuntime = {
  hasOwn: (value: unknown, key: unknown) => boolean;
};

const JUST_PROTO = { $tag: "Just", _0: "proto-value" };
const JUST_CTOR = { $tag: "Just", _0: "constructor-value" };
const NOTHING = { $tag: "Nothing" };

function assertPrototypeSafeDynamicMaps(runtime: DynamicMapRuntime): void {
  const record = runtime.fromEntries([
    { key: "__proto__", value: "proto-value" },
    { key: "constructor", value: "constructor-value" },
    { key: "__proto__", value: "later-duplicate" },
  ]) as Record<string, unknown>;

  expect(Object.getPrototypeOf(record)).toBeNull();
  expect(Object.prototype.hasOwnProperty.call(record, "__proto__")).toBe(true);
  expect(Object.prototype.hasOwnProperty.call(record, "constructor")).toBe(true);
  expect(runtime.mapGet(record, "__proto__")).toEqual(JUST_PROTO);
  expect(runtime.mapGet(record, "constructor")).toEqual(JUST_CTOR);
  expect(runtime.mapGet({}, "__proto__")).toEqual(NOTHING);
  expect(runtime.mapGet({}, "constructor")).toEqual(NOTHING);
  expect(({} as Record<string, unknown>)["proto-value"]).toBeUndefined();
}

describe("dynamic semantic maps are prototype-safe", () => {
  test("canonical std mapGet/fromEntries preserve hostile own keys", () => {
    assertPrototypeSafeDynamicMaps({
      fromEntries: stdNatives["fromEntries"]!,
      mapGet: stdNatives["mapGet"]!,
    });
  });

  test("compiled parser/resolver shared runtime mirrors canonical semantics", () => {
    const registry = createRegistry([stdModule, dispatchModule], {});
    const namespace = getResolverNamespace(registry);
    expect(namespace).not.toBeNull();
    assertPrototypeSafeDynamicMaps({
      fromEntries: namespace!["fromEntries"] as DynamicMapRuntime["fromEntries"],
      mapGet: namespace!["mapGet"] as DynamicMapRuntime["mapGet"],
    });

    const { hasOwn } = namespace as unknown as CompiledPatternRuntime;
    expect(typeof hasOwn).toBe("function");
    const prototype = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(prototype, "__proto__", { value: "inherited-proto", enumerable: true });
    Object.defineProperty(prototype, "constructor", { value: "inherited-constructor", enumerable: true });
    const inherited = Object.create(prototype) as Record<string, unknown>;
    expect(hasOwn(inherited, "__proto__")).toBe(false);
    expect(hasOwn(inherited, "constructor")).toBe(false);
    Object.defineProperty(inherited, "__proto__", {
      value: "own-proto",
      enumerable: true,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(inherited, "constructor", {
      value: "own-constructor",
      enumerable: true,
      configurable: true,
      writable: true,
    });
    expect(hasOwn(inherited, "__proto__")).toBe(true);
    expect(hasOwn(inherited, "constructor")).toBe(true);
    expect(hasOwn(null, "constructor")).toBe(false);
  }, 30_000);
});
