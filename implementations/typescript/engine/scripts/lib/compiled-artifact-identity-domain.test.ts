import { expect, test } from "bun:test";
import { resolveCompiledIdentityDomain, resolveCompiledIdentityDomainFamily,
  resolveGeneratedCompiledIdentityDomain, decodeCompiledIdentityDomain,
  decodeCompiledOwnerIdentityScope } from "./compiled-artifact-identity-domain";
import * as wire from "./artifact-wire-json";
const h = (character: string) => character.repeat(64);
const all = { schema: "fenel.compiled-identity-input.v1", owner: "compiled-parser", kind: "all", digest: h("a") };
const scope = { digest: h("a"), policyDigest: h("b"), anchorDigest: h("c"), finitePlanDigest: h("d") };
const owner = { ...all, kind: "owner", ...scope };
const current = { owner: "compiled-parser" as const, fullDigest: h("a"), scope };
test("all and owner never share cache identity even for equal row digests", () => {
  expect(resolveCompiledIdentityDomain(all, current).cacheIdentity).not.toBe(resolveCompiledIdentityDomain(owner, current).cacheIdentity);
  expect(() => resolveCompiledIdentityDomainFamily(all, [owner], current)).toThrow();
});
test("owner coordinate, plan and anchor are mandatory; legacy trust refuses", () => {
  for (const carrier of [undefined, {}, { ...owner, owner: "compiled-resolver" },
    { ...owner, anchorDigest: h("e") }, { ...owner, finitePlanDigest: h("e") },
    { ...owner, extra: true }]) expect(() => resolveCompiledIdentityDomain(carrier, current)).toThrow();
  let reads = 0;
  const getter = { ...all };
  Object.defineProperty(getter, "digest", { get() { reads++; return h("a"); } });
  expect(() => resolveCompiledIdentityDomain(getter, current)).toThrow();
  expect(reads).toBe(0);
});
test("an artifact iterator cannot conceal a mismatched shard", () => {
  const shards = [owner];
  Object.defineProperty(shards, Symbol.iterator, { value: function* () {} });
  expect(() => resolveCompiledIdentityDomainFamily(all, shards, current)).toThrow();
  const getter = [all];
  Object.defineProperty(getter, "0", { get() { throw new Error("must not invoke"); } });
  expect(() => resolveCompiledIdentityDomainFamily(all, getter, current)).toThrow();
});

test("the generated boundary checks unrequested shards and refuses legacy/browser defaults", () => {
  const generated = { PARSER_IDENTITY_DOMAIN: all, PARSER_SHARDS: {
    first: { identityDomain: all }, later: { identityDomain: owner },
  } };
  expect(() => resolveGeneratedCompiledIdentityDomain(generated, current)).toThrow();
  expect(() => resolveGeneratedCompiledIdentityDomain({ PARSER_SHARDS: {} }, current)).toThrow();
  expect(() => resolveGeneratedCompiledIdentityDomain({ ...generated, PARSER_SHARDS: {
    first: { identityDomain: all }, later: {},
  } }, current)).toThrow();
  expect(() => resolveGeneratedCompiledIdentityDomain({ RESOLVER_IDENTITY_DOMAIN: all,
    RESOLVER_SHARDS: {} }, current)).toThrow();
  const coherent = { PARSER_IDENTITY_DOMAIN: owner, PARSER_SHARDS: { first: { identityDomain: owner } } };
  expect(resolveGeneratedCompiledIdentityDomain(coherent, current).cacheIdentity)
    .toBe(resolveCompiledIdentityDomain(owner, current).cacheIdentity);
  let reads = 0;
  Object.defineProperty(coherent.PARSER_SHARDS, "hidden", { get() { reads++; return { identityDomain: owner }; } });
  expect(() => resolveGeneratedCompiledIdentityDomain(coherent, current)).toThrow();
  expect(reads).toBe(0);
});

test("generated scope slots bind their own coordinate and require complete own SHA256 fields", () => {
  const generated = { schema: "fenel.owner-identity-scope.v1", owner: "compiled-parser", ...scope } as const;
  expect(decodeCompiledOwnerIdentityScope(generated, "compiled-parser")).toEqual(generated);
  for (const value of [{ ...generated, owner: "compiled-resolver" }, { ...generated, digest: "bad" },
    { ...generated, extra: true }, { ...generated, finitePlanDigest: undefined }]) {
    expect(() => decodeCompiledOwnerIdentityScope(value, "compiled-parser")).toThrow();
  }
  let reads = 0;
  Object.defineProperty(generated, "digest", { get() { reads++; return h("a"); } });
  expect(() => decodeCompiledOwnerIdentityScope(generated, "compiled-parser")).toThrow();
  expect(reads).toBe(0);
});

// Keep assertion/framework work outside the temporary descriptor pollution.
function observeWithInheritedDescriptorValue(inherited: PropertyDescriptor, operation: () => unknown) {
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, "value");
  let result: unknown, error: unknown;
  Object.defineProperty(Object.prototype, "value", Object.assign(Object.create(null), inherited, { configurable: true }));
  try { result = operation(); } catch (caught) { error = caught; }
  finally {
    if (previous === undefined) delete (Object.prototype as { value?: unknown }).value;
    else Object.defineProperty(Object.prototype, "value", Object.assign(Object.create(null), previous));
  }
  return { result, error };
}

test("identity and scope carriers refuse inherited descriptor values without reading getters", () => {
  for (const scopeCarrier of [false, true]) for (const throwingInheritedGetter of [false, true]) {
    let carrierReads = 0, inheritedReads = 0;
    const carrier = scopeCarrier
      ? { schema: "fenel.owner-identity-scope.v1", owner: "compiled-parser", ...scope }
      : { ...all };
    Object.defineProperty(carrier, "digest", { get() { carrierReads++; return h("e"); } });
    const observed = observeWithInheritedDescriptorValue(throwingInheritedGetter
      ? { get() { inheritedReads++; throw new Error("inherited descriptor getter"); } }
      : { value: h("a") }, () => scopeCarrier
      ? decodeCompiledOwnerIdentityScope(carrier, "compiled-parser")
      : resolveCompiledIdentityDomain(carrier, current));
    expect(observed.error).toBeInstanceOf(Error);
    expect((observed.error as Error).message).toBe("identity domain has an accessor");
    expect(carrierReads).toBe(0); expect(inheritedReads).toBe(0);
  }
});

test("generated common, table, row and domain accessors cannot borrow descriptor values", () => {
  for (const slotKind of ["common", "table", "row", "domain"] as const) {
    const row = { identityDomain: all };
    const table = { first: row };
    const generated = { PARSER_IDENTITY_DOMAIN: all, PARSER_SHARDS: table };
    const [carrier, key, inherited] = slotKind === "common" ? [generated, "PARSER_IDENTITY_DOMAIN", all] as const
      : slotKind === "table" ? [generated, "PARSER_SHARDS", table] as const
      : slotKind === "row" ? [table, "first", row] as const : [row, "identityDomain", all] as const;
    let reads = 0;
    Object.defineProperty(carrier, key, { get() { reads++; return inherited; } });
    const observed = observeWithInheritedDescriptorValue({ value: inherited },
      () => resolveGeneratedCompiledIdentityDomain(generated, current));
    expect(observed.error).toBeInstanceOf(Error);
    expect((observed.error as Error).message).toBe("generated identity metadata is missing or accessor-backed");
    expect(reads).toBe(0);
  }
});

test("shard-family index accessors refuse inherited data and throwing descriptor getters", () => {
  for (const throwingInheritedGetter of [false, true]) {
    let carrierReads = 0, inheritedReads = 0;
    const shards = [all];
    Object.defineProperty(shards, "0", { get() { carrierReads++; return all; } });
    const observed = observeWithInheritedDescriptorValue(throwingInheritedGetter
      ? { get() { inheritedReads++; throw new Error("inherited descriptor getter"); } }
      : { value: all }, () => resolveCompiledIdentityDomainFamily(all, shards, current));
    expect(observed.error).toBeInstanceOf(Error);
    expect((observed.error as Error).message).toBe("shard domain is missing or accessor-backed");
    expect(carrierReads).toBe(0); expect(inheritedReads).toBe(0);
  }
});

test("descriptor Proxy failures keep their exception and observation order", () => {
  const failure = new Error("descriptor refused");
  const observed: string[] = [];
  const carrier = new Proxy({ ...all }, {
    getPrototypeOf(target) { observed.push("prototype"); return Reflect.getPrototypeOf(target); },
    ownKeys(target) { observed.push("keys"); return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) {
      observed.push(String(key));
      if (key === "digest") throw failure;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  let error: unknown;
  try { resolveCompiledIdentityDomain(carrier, current); } catch (caught) { error = caught; }
  expect(error).toBe(failure);
  expect(observed).toEqual(["prototype", "keys", "schema", "owner", "kind", "digest"]);
});

// C1/C2 source-executed actual boundary. Observe existing codec calls without
// exposing private provenance or changing carrier/current/family behavior.
const boundarySource = await Bun.file(new URL("./compiled-artifact-identity-domain.ts", import.meta.url)).text();
const executableBoundary = new Bun.Transpiler({ loader: "ts" }).transformSync(
  boundarySource.replace(/^import[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""));
const constructBoundary = new Function("encodeCanonicalJson", "expectClosedKeys", "expectSha256", "expectWireLiteral", "expectWireRecord",
  executableBoundary + "; return { decodeCompiledIdentityDomain, resolveCompiledIdentityDomain, resolveGeneratedCompiledIdentityDomain };");
function isolatedBoundary() {
  let encodes = 0, records = 0, closedKeys = 0;
  const boundary = constructBoundary((value: unknown) => { encodes++; return wire.encodeCanonicalJson(value); },
    (...args: Parameters<typeof wire.expectClosedKeys>) => { closedKeys++; return wire.expectClosedKeys(...args); },
    wire.expectSha256, wire.expectWireLiteral,
    (...args: Parameters<typeof wire.expectWireRecord>) => { records++; return wire.expectWireRecord(...args); }) as {
      decodeCompiledIdentityDomain: typeof decodeCompiledIdentityDomain;
      resolveCompiledIdentityDomain: typeof resolveCompiledIdentityDomain;
      resolveGeneratedCompiledIdentityDomain: typeof resolveGeneratedCompiledIdentityDomain;
    };
  return { ...boundary, encodes: () => encodes, shapeChecks: () => ({ records, closedKeys }) };
}

test("only exact decoder outputs skip shape inspection while every result stays fresh", () => {
  for (const carrier of [all, owner]) {
    const boundary = isolatedBoundary();
    const first = boundary.resolveCompiledIdentityDomain(carrier, current);
    expect(boundary.shapeChecks()).toEqual({ records: 1, closedKeys: 1 });
    const next = boundary.resolveCompiledIdentityDomain(first.domain, current);
    expect(boundary.shapeChecks()).toEqual({ records: 1, closedKeys: 1 });
    expect(next).toEqual(first); expect(next).not.toBe(first); expect(next.domain).not.toBe(first.domain);
    expect(Object.isFrozen(next)).toBe(true); expect(Object.isFrozen(next.domain)).toBe(true);
    for (const foreign of [carrier, { ...next.domain }, Object.freeze({ ...next.domain }), new Proxy(next.domain, {})]) {
      const before = boundary.shapeChecks();
      expect(boundary.resolveCompiledIdentityDomain(foreign, current)).toEqual(first);
      expect(boundary.shapeChecks()).toEqual({ records: before.records + 1, closedKeys: before.closedKeys + 1 });
    }
    const revoked = Proxy.revocable(next.domain, {}); revoked.revoke();
    expect(() => boundary.resolveCompiledIdentityDomain(revoked.proxy, current)).toThrow();
    const malformed: Record<string, unknown> = { ...next.domain, extra: true };
    expect(() => boundary.resolveCompiledIdentityDomain(malformed, current)).toThrow("unknown property");
    delete malformed.extra;
    const before = boundary.shapeChecks();
    expect(boundary.resolveCompiledIdentityDomain(malformed, current)).toEqual(first);
    expect(boundary.shapeChecks()).toEqual({ records: before.records + 1, closedKeys: before.closedKeys + 1 });
    for (const value of [null, undefined, false, 5, "identity", []]) {
      expect(() => boundary.resolveCompiledIdentityDomain(value, current)).toThrow("identity domain is missing or unreadable");
    }
  }
});

function restoreOwnProperty(target: object, key: string, descriptor: PropertyDescriptor | undefined) {
  if (descriptor === undefined) Reflect.deleteProperty(target, key);
  else Object.defineProperty(target, key, descriptor);
}

test("producer shapes retain scalar callback inputs, order, refusal and exception identity", () => {
  const boundary = isolatedBoundary();
  const produced = boundary.decodeCompiledIdentityDomain(owner, current.owner);
  const previous = Object.getOwnPropertyDescriptor(String.prototype, "isWellFormed");
  const observations: string[][] = [];
  for (const carrier of [owner, produced]) {
    const seen: string[] = [];
    try {
      Object.defineProperty(String.prototype, "isWellFormed", { configurable: true,
        value() { seen.push(String(this)); return true; } });
      boundary.decodeCompiledIdentityDomain(carrier, current.owner);
    } finally { restoreOwnProperty(String.prototype, "isWellFormed", previous); }
    observations.push(seen);
  }
  expect(observations[1]).toEqual(observations[0]);
  expect(observations[0]).toEqual(["owner", all.schema, current.owner,
    scope.digest, scope.policyDigest, scope.anchorDigest, scope.finitePlanDigest]);
  const failure = new Error("scalar callback refused");
  for (const mode of ["false", "throw"] as const) {
    const failures: unknown[] = [];
    for (const carrier of [owner, produced]) {
      try {
        Object.defineProperty(String.prototype, "isWellFormed", { configurable: true, value() {
          if (String(this) !== scope.policyDigest) return true;
          if (mode === "throw") throw failure;
          return false;
        } });
        try { boundary.decodeCompiledIdentityDomain(carrier, current.owner); } catch (caught) { failures.push(caught); }
      } finally { restoreOwnProperty(String.prototype, "isWellFormed", previous); }
    }
    expect(failures).toHaveLength(2);
    if (mode === "throw") {
      expect(failures[0]).toBe(failure);
      expect(failures[1]).toBe(failure);
    }
    else {
      expect(failures[0]).toBeInstanceOf(wire.ArtifactWireJsonError);
      expect((failures[1] as Error).message).toBe((failures[0] as Error).message);
    }
  }
});

test("producer shapes do not certify current inputs, owner coordinates or shard families", () => {
  const boundary = isolatedBoundary();
  const producedAll = boundary.resolveCompiledIdentityDomain(all, current).domain;
  const producedOwner = boundary.resolveCompiledIdentityDomain(owner, current).domain;
  expect(() => boundary.resolveCompiledIdentityDomain(producedAll, { ...current, fullDigest: h("e") }))
    .toThrow("full identity domain is stale");
  for (const key of ["digest", "policyDigest", "anchorDigest", "finitePlanDigest"] as const) {
    expect(() => boundary.resolveCompiledIdentityDomain(producedOwner, { ...current, scope: { ...scope, [key]: h("e") } }))
      .toThrow("owner identity domain lacks its exact current reviewed scope");
  }
  expect(() => boundary.resolveCompiledIdentityDomain(producedOwner, { ...current, scope: undefined }))
    .toThrow("owner identity domain lacks its exact current reviewed scope");
  expect(() => boundary.resolveCompiledIdentityDomain(producedAll, { ...current, owner: "compiled-resolver" }))
    .toThrow("$identityDomain.owner");
  expect(() => boundary.resolveGeneratedCompiledIdentityDomain({ PARSER_IDENTITY_DOMAIN: producedAll,
    PARSER_SHARDS: { first: { identityDomain: producedAll }, unrequested: { identityDomain: producedOwner } } }, current))
    .toThrow("common/shard identity domains disagree");
});

test("replacement freeze results never acquire decoder provenance", () => {
  const boundary = isolatedBoundary();
  const originalFreeze = Object.freeze;
  for (const mode of ["mutable", "substituted", "mutated-then-frozen"] as const) {
    let returned: object | undefined, receiver: unknown, result: unknown;
    try {
      Object.freeze = (function (this: unknown, value: object) {
        receiver = this;
        if (mode === "mutable") returned = value;
        else if (mode === "substituted") returned = { ...value, extra: true };
        else { Object.defineProperty(value, "extra", { value: true, enumerable: true }); returned = originalFreeze(value); }
        return returned;
      }) as typeof Object.freeze;
      result = boundary.decodeCompiledIdentityDomain(all, current.owner);
    } finally { Object.freeze = originalFreeze; }
    expect(receiver).toBe(Object); expect(result).toBe(returned);
    if (mode === "mutable") Object.assign(returned!, { extra: true });
    expect(() => boundary.decodeCompiledIdentityDomain(result, current.owner)).toThrow("$identityDomain.extra: unknown property");
  }
  const failure = new Error("freeze refused");
  let observed: unknown;
  try {
    Object.freeze = () => { throw failure; };
    try { boundary.decodeCompiledIdentityDomain(all, current.owner); } catch (caught) { observed = caught; }
  } finally { Object.freeze = originalFreeze; }
  expect(observed).toBe(failure);
});

test("owner callbacks cannot replace the already selected freeze or its receiver", () => {
  const boundary = isolatedBoundary();
  const originalFreeze = Object.freeze;
  const previousWellFormed = Object.getOwnPropertyDescriptor(String.prototype, "isWellFormed");
  for (const initiallyNative of [false, true]) {
    const calls: string[] = [], receivers: unknown[] = [];
    const initial = function (this: unknown, value: object) { calls.push("initial"); receivers.push(this); return originalFreeze(value); };
    const later = function (this: unknown, value: object) { calls.push("later"); receivers.push(this); return originalFreeze(value); };
    let result: ReturnType<typeof decodeCompiledIdentityDomain> | undefined;
    try {
      Object.freeze = initiallyNative ? originalFreeze : initial as typeof Object.freeze;
      Object.defineProperty(String.prototype, "isWellFormed", { configurable: true, value() {
        if (String(this) === scope.policyDigest) Object.freeze = later as typeof Object.freeze;
        return true;
      } });
      result = boundary.resolveCompiledIdentityDomain(owner, current).domain;
    } finally {
      Object.freeze = originalFreeze;
      restoreOwnProperty(String.prototype, "isWellFormed", previousWellFormed);
    }
    // The result wrapper reads freeze after the domain's scalar callbacks.
    expect(calls).toEqual(initiallyNative ? ["later"] : ["initial", "later"]);
    expect(receivers.every(value => value === Object)).toBe(true);
    const before = boundary.shapeChecks();
    expect(boundary.decodeCompiledIdentityDomain(result, current.owner)).toEqual(result);
    expect(boundary.shapeChecks()).toEqual(initiallyNative ? before
      : { records: before.records + 1, closedKeys: before.closedKeys + 1 });
  }
});

test("captured provenance and invocation primitives ignore later method tampering", () => {
  const boundary = isolatedBoundary();
  const originalHas = WeakSet.prototype.has, originalAdd = WeakSet.prototype.add;
  const originalIsFrozen = Object.isFrozen, originalApply = Reflect.apply;
  let exposed = false, invalidError: unknown;
  let result: ReturnType<typeof decodeCompiledIdentityDomain> | undefined;
  try {
    WeakSet.prototype.has = () => true;
    WeakSet.prototype.add = function () { exposed = true; return this; };
    Object.isFrozen = () => false;
    Reflect.apply = () => { throw new Error("replacement apply"); };
    try { boundary.decodeCompiledIdentityDomain({ ...all, extra: true }, current.owner); } catch (caught) { invalidError = caught; }
    result = boundary.decodeCompiledIdentityDomain(all, current.owner);
  } finally {
    WeakSet.prototype.has = originalHas; WeakSet.prototype.add = originalAdd;
    Object.isFrozen = originalIsFrozen; Reflect.apply = originalApply;
  }
  expect(exposed).toBe(false); expect((invalidError as Error).message).toBe("$identityDomain.extra: unknown property");
  expect(Object.isFrozen(result)).toBe(true);
  const before = boundary.shapeChecks();
  expect(boundary.decodeCompiledIdentityDomain(result, current.owner)).toEqual(result);
  expect(boundary.shapeChecks()).toEqual(before);
});

test("repeated fresh valid clones share only canonical text; returned objects remain fresh", () => {
  const boundary = isolatedBoundary();
  let previous = boundary.resolveCompiledIdentityDomain({ ...all }, current);
  for (let index = 0; index < 100; index++) {
    const next = boundary.resolveCompiledIdentityDomain({ ...all }, current);
    expect(next.cacheIdentity).toBe(new TextDecoder().decode(wire.encodeCanonicalJson(next.domain)));
    expect(next).not.toBe(previous); expect(next.domain).not.toBe(previous.domain);
    expect(Object.isFrozen(next)).toBe(true); expect(Object.isFrozen(next.domain)).toBe(true);
    previous = next;
  }
  expect(boundary.encodes()).toBe(1);
});

test("warmed content never hides same-carrier mutation or unreadable descriptors", () => {
  const mutations: Array<(value: Record<PropertyKey, unknown>) => void> = [
    value => { value.digest = h("b"); }, value => { value.kind = "owner"; },
    value => { value.owner = "compiled-resolver"; }, value => { value.extra = true; },
    value => { value[Symbol("hidden")] = true; }, value => { Object.setPrototypeOf(value, { exotic: true }); },
  ];
  for (const mutate of mutations) {
    const boundary = isolatedBoundary(), carrier = { ...all };
    boundary.resolveCompiledIdentityDomain(carrier, current); mutate(carrier);
    expect(() => boundary.resolveCompiledIdentityDomain(carrier, current)).toThrow();
    expect(boundary.encodes()).toBe(1);
  }
  const boundary = isolatedBoundary(), carrier = { ...all }; let getterCalls = 0;
  boundary.resolveCompiledIdentityDomain(carrier, current);
  Object.defineProperty(carrier, "digest", { get() { getterCalls++; return h("a"); } });
  expect(() => boundary.resolveCompiledIdentityDomain(carrier, current)).toThrow();
  expect(getterCalls).toBe(0);
  const { proxy, revoke } = Proxy.revocable({ ...all }, {});
  boundary.resolveCompiledIdentityDomain(proxy, current); revoke();
  expect(() => boundary.resolveCompiledIdentityDomain(proxy, current)).toThrow();
});

test("fresh current-input comparisons still refuse stale digest and every scope coordinate", () => {
  const boundary = isolatedBoundary();
  boundary.resolveCompiledIdentityDomain(all, current);
  expect(() => boundary.resolveCompiledIdentityDomain(all, { ...current, fullDigest: h("e") })).toThrow();
  boundary.resolveCompiledIdentityDomain(owner, current);
  for (const key of ["digest", "policyDigest", "anchorDigest", "finitePlanDigest"] as const) {
    const changed = { ...scope, [key]: h("e") };
    expect(() => boundary.resolveCompiledIdentityDomain(owner, { ...current, scope: changed })).toThrow();
  }
  expect(() => boundary.resolveCompiledIdentityDomain(owner, { ...current, scope: undefined })).toThrow();
  expect(boundary.encodes()).toBe(2);
});

test("warm generated families still inspect unrequested shards, hidden slots and common replacements", () => {
  const boundary = isolatedBoundary();
  const generated = { PARSER_IDENTITY_DOMAIN: { ...all }, PARSER_SHARDS: {
    first: { identityDomain: { ...all } }, later: { identityDomain: { ...all } },
  } };
  boundary.resolveGeneratedCompiledIdentityDomain(generated, current);
  expect(boundary.encodes()).toBe(1);
  generated.PARSER_SHARDS.later.identityDomain.digest = h("b");
  expect(() => boundary.resolveGeneratedCompiledIdentityDomain(generated, current)).toThrow();
  generated.PARSER_SHARDS.later.identityDomain = { ...all };
  Object.defineProperty(generated.PARSER_SHARDS.later, "identityDomain", { get() { throw new Error("must not execute"); } });
  expect(() => boundary.resolveGeneratedCompiledIdentityDomain(generated, current)).toThrow();
  const missing = { PARSER_IDENTITY_DOMAIN: all, PARSER_SHARDS: { first: {} } };
  expect(() => boundary.resolveGeneratedCompiledIdentityDomain(missing, current)).toThrow();
  let reads = 0;
  const hidden = { PARSER_IDENTITY_DOMAIN: all, PARSER_SHARDS: {} };
  Object.defineProperty(hidden.PARSER_SHARDS, "later", { get() { reads++; return { identityDomain: all }; } });
  expect(() => boundary.resolveGeneratedCompiledIdentityDomain(hidden, current)).toThrow(); expect(reads).toBe(0);
  expect(() => boundary.resolveGeneratedCompiledIdentityDomain({ PARSER_IDENTITY_DOMAIN: { ...all, extra: true }, PARSER_SHARDS: {} }, current)).toThrow();
});

test("owner, kind and all reviewed-scope fields retain distinct canonical identities", () => {
  const boundary = isolatedBoundary();
  const results = [boundary.resolveCompiledIdentityDomain(all, current), boundary.resolveCompiledIdentityDomain(owner, current),
    boundary.resolveCompiledIdentityDomain({ ...all, owner: "compiled-resolver" }, { ...current, owner: "compiled-resolver" })];
  for (const key of ["policyDigest", "anchorDigest", "finitePlanDigest"] as const) {
    const nextScope = { ...scope, [key]: h("e") };
    results.push(boundary.resolveCompiledIdentityDomain({ ...owner, ...nextScope }, { ...current, scope: nextScope }));
  }
  expect(new Set(results.map(result => result.cacheIdentity)).size).toBe(results.length);
  for (const result of results) expect(result.cacheIdentity).toBe(new TextDecoder().decode(wire.encodeCanonicalJson(result.domain)));
});

test("bounded FIFO eviction recomputes canonical text and never bypasses stale rejection", () => {
  const boundary = isolatedBoundary();
  for (let index = 0; index < 33; index++) {
    const digest = index.toString(16).padStart(64, "0");
    boundary.resolveCompiledIdentityDomain({ ...all, digest }, { ...current, fullDigest: digest });
  }
  expect(boundary.encodes()).toBe(33);
  const digest = "0".repeat(64), first = { ...all, digest };
  expect(boundary.resolveCompiledIdentityDomain(first, { ...current, fullDigest: digest }).cacheIdentity)
    .toBe(new TextDecoder().decode(wire.encodeCanonicalJson(first)));
  expect(boundary.encodes()).toBe(34);
  expect(() => boundary.resolveCompiledIdentityDomain(first, current)).toThrow();
  expect(boundary.encodes()).toBe(34);
});

test("oversize runtime owner strings remain exact but uncached", () => {
  const boundary = isolatedBoundary();
  const coordinate = ("compiled-parser" + "x".repeat(3000)) as typeof current.owner;
  const carrier = { ...all, owner: coordinate }, input = { ...current, owner: coordinate };
  const first = boundary.resolveCompiledIdentityDomain(carrier, input);
  const second = boundary.resolveCompiledIdentityDomain(carrier, input);
  expect(second.cacheIdentity).toBe(first.cacheIdentity); expect(boundary.encodes()).toBe(2);
});
