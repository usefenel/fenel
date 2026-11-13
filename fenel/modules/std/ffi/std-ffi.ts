// ---------------------------------------------------------------------------
// std — FFI leaf (typed-function-references Phase FM-retire-9 Step 9b, 2026-06-07).
//
// The std substrate's native bodies, spun out of engine/src/modules/std.ts
// VERBATIM (the crypto ffi/ precedent — fenel/modules/crypto/ffi/crypto-ffi.ts —
// at ~20× scale). `stdNatives` (166) + `stdNativesCtx` (17) = 183 native impls.
// std.ts re-imports both maps and `rekeyNativesById(...)`s them into the module's
// nativeImpls / nativeImplsCtx EXACTLY as before — the seam is unchanged; only the
// maps' HOME moves here. The 176 native-only `.fenel` decls (fenel/modules/std/
// native/*.fenel) supply the function specs; these are their irreducible-or-perf
// JS bodies. Pure-helper bridges (toNum/toStr/toArr/str*) + the two type-returner
// native helpers (vecOfLengthNative / lengthBoundedStringOfNative — keyed in
// stdNatives, used by the residual E specs that stay in std.ts) move with them.
//
// The `rootDir → repo-root` build-wiring (module-substrate Phase 3b) lets this
// `fenel/**/ffi/*.ts` leaf compile under the engine tsconfig. Lazy `require`s of
// ../json-logic + ../validate (inside evalExpr / validateValue) break the
// std → json-logic/validate → std load cycle, exactly as before.
// ---------------------------------------------------------------------------

// browser-engine-compat Phase 1b: browser-safe lazy engine-module lookup (was require())
import { engineRequire } from "../../../../implementations/typescript/engine/src/engine-require";
import { noteEngineBodyMemoHostRead, noteEngineBodyMemoTaint } from "../../../../implementations/typescript/engine/src/engine-body-memo";
import type { FenelType, SetExpr, FenelFunction } from "../../../../implementations/typescript/engine/src/types";
import { List, Vec } from "../../../../implementations/typescript/engine/src/type-foundation";
import { boolValueOf } from "../../../../implementations/typescript/engine/src/maybe-value";
import * as imgOps from "../../../../implementations/typescript/engine/src/image-ops";
import * as strOps from "../../../../implementations/typescript/engine/src/string-ops";
import { deepEqual, invokeCallable, runtimeFunctionRouteIsDirect, runtimeNativeInvocationKeys, runtimeRepresentationOwnerMayInspect, runtimeSourceDependencyPrecheckIsTrivial, invokeRuntimeRepresentationMethod, representationValueSnapshot, resolveRuntimeRepresentationMethod, runtimeRepresentationNativeContext, runtimeRepresentationNativeType, withRuntimeRepresentationProjection, type EvaluateContext } from "../../../../implementations/typescript/engine/src/json-logic";
import { invokeSelfHostSourceBody } from "../../../../implementations/typescript/engine/src/self-host-body-oracle";
import { frameAccount } from "../../../../implementations/typescript/engine/src/dispatch-registry";
import { parseInput as tsParseInput } from "../../../../implementations/typescript/engine/src/input-layer";
import { regexStringToPattern } from "../../../../implementations/typescript/engine/src/regex-shim";
import { isBytesNative, bytesToListNative } from "./bytes-ffi";
import { rationalPerfNativesCtx } from "./rational-ffi";
import { rationalRootPerfNativesCtx } from "./rational-root-ffi";
import { integerPerfNativesCtx } from "./integer-ffi";

const toNum = (x: unknown): number => {
  if (typeof x === "number") return x;
  noteEngineBodyMemoTaint("host numeric coercion");
  const n = Number(x);
  return isNaN(n) ? 0 : n;
};

// `toStr` / `toArr` are the OPAQUE-REPR BOUNDARY for String / List: every
// list/string native below (concat / length / slice / head / tail / drop / take /
// map / filter / chars / join / split / …) funnels through them to operate on the
// JS-string / JS-array `repr`. As of representation-substrate Phase 3 these natives
// are the law-bound opaque-repr PERFORMANCE BRANCH of `Reprable JsRuntime String` /
// `Reprable JsRuntime (List a)` (design/ts-exceptions-ledger.md B4): the language
// FACT — how a String/List encodes (the `List Char` / cons-spine pure forms ↔ the
// JS string / JS array natives) — lives in the `.fenel` instances + the
// `list-repr.fenel` / `string-repr.fenel` bridges (which ARE the `lift`/`lower`);
// these natives are the hot-path shortcut, kept honest by the round-trip laws
// (sample-discharged in list-string-repr.test.ts). Demoted, not deleted (the
// Phase-1 Bool-arm precedent — B5); the `repr`-keying retires at the Phase-5
// `$opaque` flip. [[feedback_opaque_is_optimization]]
const toStr = (x: unknown): string => (x == null ? "" : String(x));
const toArr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
// std `lt` on two keys without coercion: strings by code units, numbers
// numerically, anything else (across types, Bools, records, NaN) false.
function sortKeyLess(a: unknown, b: unknown): boolean {
  if (typeof a === "string" && typeof b === "string") return a < b;
  if (typeof a === "number" && typeof b === "number") return a < b;
  return false;
}
// The order of the Fenel body `std:sort` (hof-combine.fenel), exactly: split at
// floor(n/2), sort each half, merge taking the right head only when its key is
// `lt` the left head's (ties and incomparable keys keep encounter order). A
// fixed algorithm, so the order is a function of the keys alone on every host.
function sortKeyOrder(keys: readonly unknown[], lo: number, hi: number): number[] {
  const n = hi - lo;
  if (n === 0) return [];
  if (n === 1) return [lo];
  const half = Math.floor(n / 2);
  const left = sortKeyOrder(keys, lo, lo + half);
  const right = sortKeyOrder(keys, lo + half, hi);
  const out: number[] = [];
  let i = 0, j = 0;
  while (i < left.length && j < right.length) {
    if (sortKeyLess(keys[right[j]!], keys[left[i]!])) out.push(right[j++]!);
    else out.push(left[i++]!);
  }
  while (i < left.length) out.push(left[i++]!);
  while (j < right.length) out.push(right[j++]!);
  return out;
}
// Characters outside ASCII. Lowercasing text without them is the fixed A–Z
// mapping on every host; only other text reads the host's Unicode case tables.
const NON_ASCII = /[^\u0000-\u007f]/;
// JS truthiness that reads a Fenel Bool as itself in BOTH representations:
// `{$tag:"False"}` is an object, so plain `Boolean(x)` took it as true
// (2026-10-17). Every non-Bool keeps JS truthiness ("0" and [] stay true) —
// deliberately NOT the evaluator's `truthy`, whose fallback rejects both.
const jsTruthy = (x: unknown): boolean => boolValueOf(x) ?? Boolean(x);

const reverseOwnValue = (value: unknown, key: string): unknown => {
  if (value === null || typeof value !== "object") return undefined;
  const field = Object.getOwnPropertyDescriptor(value, key);
  return field !== undefined && "value" in field ? field.value : undefined;
};

// B4: eligibility for the existing list operation's representation shortcut.
// Selection is the complete scoped Reprable selector, as in the numeric branch;
// source bodies, parameter names and native dependency slots must still be stock.
// The private projection extent is not an automatic eligibility bypass.
function reverseShortcutAvailable(ctx: EvaluateContext, owner: "List" | "String"): boolean {
  if (ctx._routingTable === undefined) return false;
  try {
    return withRuntimeRepresentationProjection(ctx, frame => {
      const { stdModule } = engineRequire("modules/std") as typeof import("../../../../implementations/typescript/engine/src/modules/std");
      const { registryTransportSnapshot } = engineRequire("registry") as typeof import("../../../../implementations/typescript/engine/src/registry");
      const expectedOwner = frame._callSiteTyping?.reflect(owner === "List" ? [] : "");
      const identity = frame._entityNominalIdentity?.(owner);
      if (identity === undefined || expectedOwner?.identity !== identity) return false;
      const native = resolveRuntimeRepresentationMethod(frame, owner, "native");
      const nativeHandle = reverseOwnValue(native, "$ref");
      const expectedType = frame.getEntityType?.(owner);
      if (expectedType === undefined || (typeof nativeHandle === "string"
        ? frame.getEntityType?.(nativeHandle) !== expectedType : native !== expectedType)) return false;
      const crossingNames = owner === "String"
        ? { lower: "stringToCharList", lift: "charListToString" }
        : { lower: "arrayToList", lift: "listToArray" };
      const crossingHandles = new Map<string, string>();
      for (const field of ["lower", "lift"] as const) {
        const method = resolveRuntimeRepresentationMethod(frame, owner, field);
        const handle = typeof method === "string" ? method : reverseOwnValue(method, "$ref");
        const selected = typeof handle === "string" ? frame.getFunction?.(handle) : undefined;
        const canonical = stdModule.functions?.find(fn => fn.id === `std:${crossingNames[field]}`);
        if (canonical === undefined || reverseOwnValue(selected, "id") !== canonical.id) return false;
        const snapshot = registryTransportSnapshot(selected, "reverse selected representation crossing") as typeof canonical;
        if (!deepEqual(snapshot.body, canonical.body)
          || !deepEqual(snapshot.params.map(param => param.name), canonical.params.map(param => param.name))) return false;
        crossingHandles.set(crossingNames[field], handle as string);
      }
      const dependencies = owner === "String"
        ? ["reverse", "reverseOnto", "representationSelfNativeAdmission", "eq", "stringToCharList", "charListToString", "arrayToList", "listToArray", "chars", "join", "head", "drop", "concat"]
        : ["reverse", "reverseOnto", "representationSelfNativeAdmission", "eq", "arrayToList", "listToArray", "head", "drop", "concat"];
      const sourceDependencies: Record<string, readonly string[]> = {
        reverse: ["reverseOnto"], reverseOnto: ["reverseOnto"],
        representationSelfNativeAdmission: ["eq"],
        stringToCharList: ["arrayToList", "chars"], charListToString: ["join", "listToArray"],
        arrayToList: ["head", "arrayToList", "drop"], listToArray: ["concat", "listToArray"],
      };
      for (const name of dependencies) {
        const selected = frame.getFunction?.(`std:${name}`);
        const canonical = stdModule.functions?.find(fn => fn.id === `std:${name}`);
        if (canonical === undefined || reverseOwnValue(selected, "id") !== canonical.id) return false;
        const snapshot = registryTransportSnapshot(selected, "reverse performance source declaration") as typeof canonical;
        if (!deepEqual(snapshot.body, canonical.body)
          || !deepEqual(snapshot.params.map(param => param.name), canonical.params.map(param => param.name))) return false;
        const imports = frame.getFunctionImportFrame?.(canonical.id);
        const names = reverseOwnValue(imports, "names");
        for (const dependency of sourceDependencies[name] ?? []) {
          if (reverseOwnValue(names, dependency) !== `std:${dependency}`) return false;
        }
        for (const key of new Set([canonical.id, `std.${name}`, name, ...(crossingHandles.has(name) ? [crossingHandles.get(name)!] : [])])) {
          const contextual = frame.nativesCtx === undefined ? undefined : Object.getOwnPropertyDescriptor(frame.nativesCtx, key);
          const plain = frame.natives === undefined ? undefined : Object.getOwnPropertyDescriptor(frame.natives, key);
          if (contextual !== undefined && !("value" in contextual) || plain !== undefined && !("value" in plain)) return false;
          if (frame.nativesCtx !== undefined && key in frame.nativesCtx && contextual === undefined
            || frame.natives !== undefined && key in frame.natives && plain === undefined) return false;
          if (contextual?.value !== undefined && contextual.value !== stdNativesCtx[name]) return false;
          if (plain?.value !== undefined && plain.value !== stdNatives[name]) return false;
          if (frame._nativePerformDescriptors?.context[key] === true || frame._nativePerformDescriptors?.plain[key] === true) return false;
        }
        if (canonical.body === undefined
          && !(stdNativesCtx[name] !== undefined && frame.nativesCtx?.[canonical.id] === stdNativesCtx[name])
          && !(stdNatives[name] !== undefined && frame.natives?.[canonical.id] === stdNatives[name])) return false;
      }
      return true;
    });
  } catch { return false; }
}

function reverseSourceBody(ctx: EvaluateContext, value: unknown): unknown {
  const fn = ctx.getFunction?.("std:reverse") ?? ctx.getFunction?.("std.reverse");
  if (fn === undefined) throw new Error("Reverse representation branch: missing Fenel source body");
  return invokeSelfHostSourceBody(fn, [value], ctx);
}

function reverseArrayShortcutAvailable(value: unknown[]): boolean {
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== value.length + 1) return false;
    for (let index = 0; index < value.length; index++) {
      const element = descriptors[String(index)];
      if (element === undefined || !("value" in element)) return false;
    }
    return true;
  } catch { return false; }
}

function reverseNativeAdmitted(frame: EvaluateContext, owner: "List" | "String", nativeValue: unknown, native: FenelType, candidate: unknown): boolean {
  const nativeHandle = reverseOwnValue(nativeValue, "$ref");
  const identity = frame._entityNominalIdentity?.(owner);
  const reflected = frame._callSiteTyping?.reflect(owner === "List" ? [] : "");
  const ownerType = frame.getEntityType?.(owner);
  const selfNative = identity !== undefined && reflected?.identity === identity && ownerType !== undefined
    && typeof nativeHandle === "string" && frame.getEntityType?.(nativeHandle) === ownerType;
  if (!selfNative) {
    const { validateValue } = engineRequire("validate") as typeof import("../../../../implementations/typescript/engine/src/validate");
    const options = { functions: runtimeRepresentationNativeContext(frame, owner), coerce: false, strict: { primitiveTypes: true, membership: true } };
    return validateValue(native, candidate, frameAccount(frame), options).valid;
  }
  const verdict = invokeCallable({ $ref: "std:representationSelfNativeAdmission" }, [owner, representationValueSnapshot(candidate)], frame);
  if (reverseOwnValue(verdict, "$tag") !== "Just" || typeof reverseOwnValue(verdict, "_0") !== "boolean") {
    throw new Error("Reverse: native carrier admission is unreadable");
  }
  return reverseOwnValue(verdict, "_0") === true;
}

// A source List literal can retain its array form at either intermediate
// boundary. Cross the selected List representation once before Cons matching.
function reversePureList(frame: EvaluateContext, value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  const lower = resolveRuntimeRepresentationMethod(frame, "List", "lower");
  const nativeValue = resolveRuntimeRepresentationMethod(frame, "List", "native");
  const native = runtimeRepresentationNativeType(frame, "List");
  if (lower === undefined || native === undefined || !reverseNativeAdmitted(frame, "List", nativeValue, native, value)) {
    throw new Error("Reverse: intermediate List representation is unavailable");
  }
  const pure = invokeRuntimeRepresentationMethod(lower, [value], frame);
  if (Array.isArray(pure)) throw new Error("Reverse: selected List lower did not produce the pure representation");
  return pure;
}

// A2/B3/B4: existing evaluator re-entry and representation crossing only.
// The Fenel body is the list algorithm; String changes only its physical form.
function reverseRepresentationNative(ctx: EvaluateContext, value: unknown): unknown {
  const owner = typeof value === "string" ? "String" : Array.isArray(value) ? "List" : undefined;
  if (owner === undefined) return withRuntimeRepresentationProjection(ctx, frame => reverseSourceBody(frame, value));
  if ((owner === "String" || reverseArrayShortcutAvailable(value as unknown[])) && reverseShortcutAvailable(ctx, owner)) {
    if (owner === "String") return strOps.strReverse(value);
    const items = value as unknown[];
    const copied = new Array(items.length);
    for (let index = 0; index < items.length; index++) copied[index] = items[index];
    return copied.reverse();
  }
  return withRuntimeRepresentationProjection(ctx, frame => {
    const lower = resolveRuntimeRepresentationMethod(frame, owner, "lower");
    const lift = resolveRuntimeRepresentationMethod(frame, owner, "lift");
    const nativeValue = resolveRuntimeRepresentationMethod(frame, owner, "native");
    const native = runtimeRepresentationNativeType(frame, owner);
    if (lower === undefined || lift === undefined || native === undefined) throw new Error(`Reverse: Reprable JsRuntime ${owner} is unavailable`);
    if (!reverseNativeAdmitted(frame, owner, nativeValue, native, value)) throw new Error(`Reverse: input is not admitted by Reprable JsRuntime ${owner}.native`);
    const pure = reversePureList(frame, invokeRuntimeRepresentationMethod(lower, [value], frame));
    const reversed = reversePureList(frame, reverseSourceBody(frame, pure));
    const result = invokeRuntimeRepresentationMethod(lift, [reversed], frame);
    if (!reverseNativeAdmitted(frame, owner, nativeValue, native, result)) throw new Error(`Reverse: result is not admitted by Reprable JsRuntime ${owner}.native`);
    return result;
  });
}

// B3: source decides constructor wire admission and field order. The host
// only forwards the descriptor snapshot and copies the prepared payloads.
function preparedConstructorFields(value: unknown, names: string[]): unknown[] {
  const snapshot = representationValueSnapshot(value);
  // GLOBAL_ONLY: this fixed descriptor-decoder ABI has no request account,
  // caller-selected source method, type lookup or representation callback.
  // Its source judgment reads inert snapshot fields; the existing inspection
  // guard preserves raw children and keeps perform/representation selection off.
  const bridge = engineRequire("engine-bodies-dispatch") as typeof import("../../../../implementations/typescript/engine/src/engine-bodies-dispatch");
  const result = withRuntimeRepresentationProjection({}, (frame) => bridge.dispatchEngineBody(
    "std:representationSnapshotConstructorFields", [snapshot, names], frame,
  )) as { $tag?: string; _0?: unknown };
  if (result?.$tag !== "Just" || !Array.isArray(result._0)) throw new TypeError("Invalid constructor payload at the representation boundary");
  return result._0;
}

function integerMarkerNative(marker: unknown, owner: "Nat" | "Int"): unknown {
  const [carrier] = preparedConstructorFields(marker, ["carrier"]);
  const tag = Object.getOwnPropertyDescriptor(carrier as object, "$tag")?.value;
  if (tag === "IntegerSmall") return preparedConstructorFields(carrier, ["value"])[0];
  if (tag === "IntegerDigits") return { $tag: owner, digits: preparedConstructorFields(carrier, ["digits"])[0] };
  throw new TypeError("Invalid integer carrier constructor at the representation boundary");
}

// structuralEqNative — the `eq`/`neq` op-native bridge to the ONE shared
// type-discriminated structural equality (decide-substrate Phase 6, §1). The
// definition lives in json-logic.ts (`structuralEq`, the perf branch of the
// Fenel `deepEqValue`); lazy-cached require avoids the std → json-logic
// module-init cycle (the same crossing the `evaluate` / `validate` natives make
// below). Cached after first call so the hot `eq` path pays one property read.
let _structuralEq: ((a: unknown, b: unknown) => boolean) | undefined;
const structuralEqNative = (a: unknown, b: unknown): boolean => {
  if (_structuralEq === undefined) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _structuralEq = (engineRequire("json-logic") as typeof import("../../../../implementations/typescript/engine/src/json-logic")).structuralEq;
  }
  return _structuralEq(a, b);
};

// recipe-functions S1 — the B4 PERF BRANCHES of the Fenel-bodied `includes` /
// `unique` / `distinctCount` (native/collection-native.fenel, the source of
// truth). They implement EXACTLY those bodies, pinned by the differential
// parity test engine/src/collection-membership-equality.test.ts:
//   * the list view is the bodies' `isArray` guard then head/tail walk: an
//     array as is, anything else (a String included) empty — the pre-S1
//     `toArr` behaviour, kept (review S1-2);
//   * equality is `eq` (structuralEq): NaN never equal, callables by identity,
//     null and undefined equal (both are the absent leaf of `deepEqValue`);
//   * `unique` keeps first occurrences. Scalars are bucketed by exact key
//     (a number Set excluding NaN, since SameValueZero equates NaN and `eq`
//     does not; -0/+0 agree under both); a scalar is never `eq` to a
//     non-scalar, so only non-scalars need the pairwise structuralEq scan.
// The reader-aware registration below first admits the stock source/native
// dependency routes; comparison itself needs no evaluator harness per element.
const membershipView = (x: unknown): readonly unknown[] => toArr(x);
const membershipIncludes = (arr: unknown, value: unknown): boolean => {
  for (const x of membershipView(arr)) if (structuralEqNative(x, value)) return true;
  return false;
};
const membershipUnique = (arr: unknown): unknown[] => {
  const out: unknown[] = [];
  const strings = new Set<string>();
  const numbers = new Set<number>();
  const booleans = new Set<boolean>();
  const others: unknown[] = [];
  let sawAbsent = false;
  for (const x of membershipView(arr)) {
    if (typeof x === "string") {
      if (strings.has(x)) continue;
      strings.add(x);
    } else if (typeof x === "number") {
      if (x === x) {
        if (numbers.has(x)) continue;
        numbers.add(x);
      }
    } else if (typeof x === "boolean") {
      if (booleans.has(x)) continue;
      booleans.add(x);
    } else if (x === null || x === undefined) {
      if (sawAbsent) continue;
      sawAbsent = true;
    } else {
      if (others.some((kept) => structuralEqNative(kept, x))) continue;
      others.push(x);
    }
    out.push(x);
  }
  return out;
};

// B4 eligibility observes the reader's source and selected host routes. The
// collection algorithms remain the Fenel bodies; changed or unreadable facts
// fall through to those bodies in the same reader.
function membershipShortcutAvailable(ctx: EvaluateContext, rootName: string, selectedRoot: FenelFunction): boolean {
  if (ctx._routingTable === undefined) return false;
  try {
    const { stdModule } = engineRequire("modules/std") as typeof import("../../../../implementations/typescript/engine/src/modules/std");
    const { registryTransportSnapshot } = engineRequire("registry") as typeof import("../../../../implementations/typescript/engine/src/registry");
    // head/tail results are inspected as Maybe by the source patterns. A
    // changed owner or any possible scoped crossing must retain that inspection.
    if (reverseOwnValue(ctx._caseOwner, "Just") !== "Maybe" || reverseOwnValue(ctx._caseOwner, "Nothing") !== "Maybe") return false;
    if (runtimeRepresentationOwnerMayInspect(ctx, "Maybe")) return false;
    const sourceDependencies: Record<string, readonly string[]> = {
      includes: ["not", "isArray", "head", "eq", "includes", "fromMaybe", "tail"],
      unique: ["isArray", "fold", "includes", "concat", "appendItem"],
      distinctCount: ["length", "unique"],
      fold: ["head", "fold", "fromMaybe", "tail"],
      appendItem: ["concat"],
    };
    const dependencies = ["includes", "unique", "distinctCount", "isArray", "not", "head", "tail", "fromMaybe", "eq", "fold", "concat", "appendItem", "length"];
    for (const name of dependencies) {
      const canonical = stdModule.functions?.find(fn => fn.id === `std:${name}`);
      const selected = name === rootName ? selectedRoot : ctx.getFunction?.(`std:${name}`);
      if (canonical === undefined || selected === undefined || reverseOwnValue(selected, "id") !== canonical.id) return false;
      const snapshot = registryTransportSnapshot(selected, "membership performance source declaration") as typeof canonical;
      if (!deepEqual(snapshot.body, canonical.body)
        || !deepEqual(snapshot.params.map(param => param.name), canonical.params.map(param => param.name))) return false;
      if (!runtimeFunctionRouteIsDirect(ctx, canonical.id)) return false;
      const imports = ctx.getFunctionImportFrame?.(canonical.id);
      const names = reverseOwnValue(imports, "names");
      for (const dependency of sourceDependencies[name] ?? []) {
        if (reverseOwnValue(names, dependency) !== `std:${dependency}`) return false;
        const target = ctx.getFunction?.(`std:${dependency}`);
        if (target === undefined || !runtimeSourceDependencyPrecheckIsTrivial(ctx, selected, target)) return false;
      }
      for (const key of [canonical.id, `std.${name}`, name]) {
        const contextual = ctx.nativesCtx === undefined ? undefined : Object.getOwnPropertyDescriptor(ctx.nativesCtx, key);
        const plain = ctx.natives === undefined ? undefined : Object.getOwnPropertyDescriptor(ctx.natives, key);
        if (contextual !== undefined && !("value" in contextual) || plain !== undefined && !("value" in plain)) return false;
        if (ctx.nativesCtx !== undefined && key in ctx.nativesCtx && contextual === undefined
          || ctx.natives !== undefined && key in ctx.natives && plain === undefined) return false;
        if (contextual?.value !== undefined && contextual.value !== stdNativesCtx[name]) return false;
        if (plain?.value !== undefined && plain.value !== stdNatives[name]) return false;
        for (const descriptorMap of [ctx._nativePerformDescriptors?.context, ctx._nativePerformDescriptors?.plain]) {
          if (descriptorMap === undefined) continue;
          const descriptor = Object.getOwnPropertyDescriptor(descriptorMap, key);
          if (descriptor === undefined ? key in descriptorMap : !("value" in descriptor) || descriptor.value === true) return false;
        }
      }
      // A missing shortcut on a dependency would enter its own source closure.
      // Require the stock selected native instead of assuming that closure's
      // transitive environment is equivalent (fold notably accepts callbacks).
      if (stdNativesCtx[name] !== undefined) {
        if (ctx.nativesCtx?.[canonical.id] !== stdNativesCtx[name]) return false;
      } else if (stdNatives[name] !== undefined) {
        if (ctx.natives?.[canonical.id] !== stdNatives[name]) return false;
      } else if (canonical.body === undefined) return false;
    }
    return true;
  } catch { return false; }
}

// A host native map may inherit aliases. Mask only the stock handler value,
// keeping deliberate reader replacements and ordinary lookup precedence.
function membershipWithoutShortcut(ctx: EvaluateContext, shortcut: NonNullable<EvaluateContext["nativesCtx"]>[string], selectedKey: string | undefined): EvaluateContext {
  const nativesCtx = Object.create(ctx.nativesCtx ?? null) as NonNullable<EvaluateContext["nativesCtx"]>;
  const seen = new Set<PropertyKey>();
  for (let frame: object | null = ctx.nativesCtx ?? null; frame !== null; frame = Object.getPrototypeOf(frame)) {
    for (const key of Reflect.ownKeys(frame)) {
      if (seen.has(key)) continue;
      seen.add(key);
      const descriptor = Object.getOwnPropertyDescriptor(frame, key)!;
      if ("value" in descriptor ? descriptor.value === shortcut : key === selectedKey) {
        Object.defineProperty(nativesCtx, key, { value: undefined, configurable: true });
      }
    }
  }
  return { ...ctx, nativesCtx };
}

function membershipAlternativeContextRoute(ctx: EvaluateContext, key: string, shortcut: NonNullable<EvaluateContext["nativesCtx"]>[string]): boolean {
  for (let frame: object | null = ctx.nativesCtx ?? null; frame !== null; frame = Object.getPrototypeOf(frame)) {
    const descriptor = Object.getOwnPropertyDescriptor(frame, key);
    if (descriptor !== undefined) return !("value" in descriptor) || descriptor.value !== undefined && descriptor.value !== shortcut;
  }
  return false;
}

function membershipRepresentationNative(ctx: EvaluateContext, name: "includes" | "unique" | "distinctCount", args: unknown[]): unknown {
  const shortcut = stdNativesCtx[name]!;
  const invocation = runtimeNativeInvocationKeys(ctx, shortcut);
  const resolvedName = invocation?.resolvedName ?? `std:${name}`;
  const fn = ctx.getFunction?.(resolvedName);
  if (fn === undefined) throw new Error(`Membership representation branch: missing Fenel source body for ${resolvedName}`);
  const rootKeys = new Set([fn.id, resolvedName]);
  const plainRoute = [...rootKeys].some(key => ctx.natives !== undefined && key in ctx.natives
    || ctx._nativePerformDescriptors?.plain !== undefined && key in ctx._nativePerformDescriptors.plain);
  const alternateContext = resolvedName !== fn.id && (membershipAlternativeContextRoute(ctx, resolvedName, shortcut)
    || ctx._nativePerformDescriptors?.context[resolvedName] === true);
  if (plainRoute || alternateContext) {
    return invokeCallable({ $ref: invocation?.writtenName ?? resolvedName }, args, membershipWithoutShortcut(ctx, shortcut, invocation?.selectedKey));
  }
  const ordinaryArray = !Array.isArray(args[0]) || reverseArrayShortcutAvailable(args[0]);
  if (ordinaryArray && membershipShortcutAvailable(ctx, name, fn)) {
    if (name === "includes") return membershipIncludes(args[0], args[1]);
    const values = membershipUnique(args[0]);
    return name === "unique" ? values : values.length;
  }
  return invokeCallable({ $ref: invocation?.writtenName ?? resolvedName }, args, membershipWithoutShortcut(ctx, shortcut, invocation?.selectedKey));
}

// String-as-List<Char> helpers — iterate by Unicode code point so that
// surrogate pairs (emoji, non-BMP) are treated as single characters.
const strHead = (s: string): string | null => {
  const r = s[Symbol.iterator]().next();
  return r.done ? null : r.value;
};
const strTail = (s: string): string | null => {
  const r = s[Symbol.iterator]().next();
  return r.done ? null : s.slice(r.value.length);
};
const strLast = (s: string): string | null => {
  let last: string | null = null;
  for (const c of s) last = c;
  return last;
};
const strInit = (s: string): string | null => {
  if (s.length === 0) return null;
  let lastLen = 0;
  for (const c of s) lastLen = c.length;
  return s.slice(0, s.length - lastLen);
};
const strLength = (s: string): number => {
  let n = 0;
  for (const _ of s) n++;
  return n;
};

// Type-level natives (the residual E specs vecOfLength / lengthBoundedStringOf in
// std.ts dispatch through the `vecOfLength` / `lengthBoundedStringOf` keys below).
//
// array-substrate Phase 1a.5 — REDIRECTED (retire-by-migration, D3 = redirect):
// these now emit the canonical `Vec n a = $map (Fin n) a` form (total indexing),
// NOT the retired `$refined List (length==n)` shape. The late-bound `$el { call:
// ["vecOfLength", …] }` path + the self-host-matrix canary are PRESERVED — only
// the emitted shape changes (refined-List → `$map`). `lengthBoundedStringOf n` =
// `Vec n Char` (String = List Char). The runtime `n` is concrete by the time
// these fire (the `$el` evaluator resolved it from the sibling field).
function vecOfLengthNative(elemType: unknown, n: unknown): FenelType {
  if (typeof n !== "number") {
    throw new Error(`vecOfLength: expected n to be a Number, got ${typeof n}`);
  }
  return Vec(elemType as FenelType, n);
}

function lengthBoundedStringOfNative(n: unknown): FenelType {
  if (typeof n !== "number") {
    throw new Error(`lengthBoundedStringOf: expected n to be a Number, got ${typeof n}`);
  }
  return Vec({ $ref: "Char" } as FenelType, n);
}

export const stdNatives: Record<string, (...args: unknown[]) => unknown> = {
  representationValueSnapshot,
  // Bodyless B3 envelope leaves: fixed source descriptor decoding needs no
  // caller context and never applies a user callable like a higher-order native.
  integerNatNativeFromMarker: (marker) => integerMarkerNative(marker, "Nat"),
  integerIntNativeFromMarker: (marker) => integerMarkerNative(marker, "Int"),
  rationalNativeFromMarker: (marker) => {
    const [num, den] = preparedConstructorFields(marker, ["num", "den"]);
    return { $tag: "Rational", num, den };
  },
  typeUnionFromMarker: (marker): FenelType => {
    const [members] = preparedConstructorFields(marker, ["members"]);
    return { $union: members as FenelType[] };
  },
  typeFamilyFromMarker: (marker): FenelType => {
    const [family, arguments_] = preparedConstructorFields(marker, ["family", "arguments"]);
    const identity = Object.getOwnPropertyDescriptor(family as object, "$ref")?.value;
    if (typeof identity !== "string") throw new TypeError("Invalid type family reference at the representation boundary");
    return { $el: { call: [identity as string, ...(arguments_ as FenelType[])] } };
  },
  taggedSingletonTypeFromMarker: (marker): FenelType => {
    const [base, phantomBase, constraint] = preparedConstructorFields(marker, ["base", "phantomBase", "constraint"]);
    return { $tagged: { value: base as FenelType, phantom: { $refined: { base: phantomBase as FenelType, set: constraint as SetExpr } } } };
  },
  // Host floating-representation crossing: the raw sample is Anything.
  // The source decides whether it inhabits finite Number.
  integerFloatSampleFromText: (text: unknown) => Number(text),
  // Math
  add: (a, b) => toNum(a) + toNum(b),
  sub: (a, b) => toNum(a) - toNum(b),
  mul: (a, b) => toNum(a) * toNum(b),
  div: (a, b) => toNum(b) === 0 ? 0 : toNum(a) / toNum(b),
  mod: (a, b) => toNum(b) === 0 ? 0 : toNum(a) % toNum(b),
  // Phase 5b3: negate / abs / sign / clamp moved to Fenel bodies
  // (fenel/modules/std/{negate,abs,sign,clamp}.fenel). The
  // defineFunction specs carry the bodies; this map no longer
  // shadows them.
  min: (a, b) => Math.min(toNum(a), toNum(b)),
  max: (a, b) => Math.max(toNum(a), toNum(b)),
  round: (x) => Math.round(toNum(x)),
  floor: (x) => Math.floor(toNum(x)),
  ceil: (x) => Math.ceil(toNum(x)),
  pow: (base, exp) => Math.pow(toNum(base), toNum(exp)),
  sqrt: (x) => Math.sqrt(toNum(x)),
  exp: (x) => Math.exp(toNum(x)),
  log: (x) => Math.log(toNum(x)),
  sin: (x) => Math.sin(toNum(x)),
  cos: (x) => Math.cos(toNum(x)),
  tan: (x) => Math.tan(toNum(x)),

  // regexSet — irreducible regex→Pattern host leaf (Phase 3.3d). Total over real
  // input; throws with the offending regex on the unreachable null (mirrors the
  // retired TS `regexSet` in entity-typeclasses.ts / type-foundation.ts).
  regexSet: (re) => {
    const p = regexStringToPattern(toStr(re));
    if (!p) throw new Error(`std:regexSet — invalid regex /${toStr(re)}/`);
    return { $tag: "SePattern", pattern: p };
  },
  // namedSet — build the canonical SetExpr reference constructor. Total.
  namedSet: (name) => ({ $tag: "SeRef", handle: toStr(name) }),

  // String
  trim: (s) => toStr(s).trim(),
  lower: (s) => {
    const text = toStr(s);
    if (NON_ASCII.test(text)) noteEngineBodyMemoHostRead("std:lower");
    return text.toLowerCase();
  },
  upper: (s) => toStr(s).toUpperCase(),
  split: (s, d) => toStr(s).split(toStr(d)),
  join: (arr, sep) => toArr(arr).map(toStr).join(toStr(sep)),
  replace: (s, p, r) => toStr(s).replace(toStr(p), toStr(r)),
  length: (s) => typeof s === "string" ? strLength(s) : toArr(s).length,
  entries: (record) => {
    if (record == null || typeof record !== "object") return [];
    return Object.entries(record as Record<string, unknown>).map(([key, value]) => ({ key, value }));
  },
  contains: (s, sub) => toStr(s).includes(toStr(sub)),
  startsWith: (s, pre) => toStr(s).startsWith(toStr(pre)),
  endsWith: (s, suf) => toStr(s).endsWith(toStr(suf)),
  slice: (s, start, end) => toStr(s).slice(toNum(start), end == null ? undefined : toNum(end)),
  repeat: (s, n) => toStr(s).repeat(Math.max(0, toNum(n))),
  padStart: (s, len, ch) => toStr(s).padStart(toNum(len), ch == null ? " " : toStr(ch)),
  padEnd: (s, len, ch) => toStr(s).padEnd(toNum(len), ch == null ? " " : toStr(ch)),
  // Extended string ops — see ../string-ops.ts.
  replaceAll: strOps.strReplaceAll,
  // urlEncode — irreducible percent-encoding host leaf. UTF-8 percent-encoding
  // over the full code-point range is not reasonably expressible in pure Fenel
  // (it needs a byte-level char-code table), so it rides as a substrate leaf —
  // the same bridge pattern as `regexSet` / `round`. Consumed by telegram's
  // `deepLink` Fenel body (`?start=<urlEncode payload>`).
  urlEncode: (s) => encodeURIComponent(toStr(s)),
  // decodeUriComponent — the symmetric sister of urlEncode. Irreducible
  // percent-DEcoding host leaf; UTF-8 percent-decoding has no pure-Fenel form.
  // Consumed by auth:parseCookieHeader (cookie VALUES may be percent-encoded).
  decodeUriComponent: (s) => decodeURIComponent(toStr(s)),
  canonical: (v) => {
    if (typeof v === "string") return v;
    if (v && typeof v === "object") {
      // LocaleString record { en: ..., fr: ... } — prefer English then
      // first available value. Mirrors @fenel/engine/locale's canonical.
      const o = v as Record<string, unknown>;
      if (typeof o["en"] === "string") return o["en"];
      for (const k of Object.keys(o)) {
        if (typeof o[k] === "string") return o[k] as string;
      }
    }
    return v == null ? "" : String(v);
  },
  format: (tpl, args) => {
    const t = toStr(tpl);
    const a = (args ?? {}) as Record<string, unknown>;
    return t.replace(/\{(\w+)\}/g, (m, k) => {
      if (Object.prototype.hasOwnProperty.call(a, k)) {
        const v = a[k];
        if (v == null) return "";
        if (typeof v === "object") {
          try { return JSON.stringify(v); } catch { return String(v); }
        }
        return String(v);
      }
      return m;
    });
  },
  parseInput: (raw, type) => {
    return tsParseInput(raw, type as FenelType);
  },
  tryParseInt: (s) => {
    const str = toStr(s).trim();
    if (str === "") return { $tag: "Nothing" };
    const n = Number(str);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return { $tag: "Nothing" };
    return { $tag: "Just", _0: n };
  },
  // parseJsonRows — irreducible host-marshalling leaf (Phase 5a-csv). JSON.parse
  // + array-coerce: a top-level array passes through; a single object is wrapped
  // to a one-element list. Pure (deterministic, no IO). Throws on malformed JSON
  // (parity with the wrapper-side JSON.parse it replaces in imports:parseRows).
  parseJsonRows: (s) => {
    const parsed = JSON.parse(toStr(s));
    return Array.isArray(parsed) ? parsed : [parsed];
  },
  // evalExpr — the engine `evaluate` surfaced reflectively (Phase 5a-submit):
  // evaluate a stored JSON-Logic expression-value against a data record. Uses
  // the default (EMPTY_CTX) evaluate — built-in ops + `var` reads only, no
  // user-function dispatch — which is exact parity with the form-submit
  // wrapper's `evaluate(expr, data)` (no 3rd arg). Expression-as-runtime-value
  // (design/expression-mobility-and-policy.md): the canonical evaluator made
  // Fenel-callable, NOT a new dialect. Pure (deterministic, no IO). Lazy-require
  // to break the std → json-logic → std load cycle (same shape as
  // validateValue → ../validate).
  evalExpr: (expr, data) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { evaluate } = engineRequire("json-logic") as typeof import("../../../../implementations/typescript/engine/src/json-logic");
    return evaluate(expr, (data ?? {}) as Record<string, unknown>);
  },
  validateValue: (type, value) => {
    // Lazy-required to break the std → validate → system-registry →
    // std import cycle at module-load time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { validate: tsValidate } = engineRequire("validate") as typeof import("../../../../implementations/typescript/engine/src/validate");
    // rights R3a — an EXPLICIT `null`. `std:validateValue` is a PLAIN native
    // with no context parameter, so there is no frame and no request account
    // here; account named sets are not consulted through this leaf (§8.1a).
    const r = tsValidate(type as FenelType, value, null);
    if (r.valid) return { ok: true };
    // Surface the first error's path+message — callers wrap into a
    // user-facing string. Multiple errors get joined "; " so the form
    // can hint at all of them if it wants to.
    const error = r.errors
      .map((e) => (e.path ? `${e.path}: ${e.message}` : e.message))
      .join("; ");
    return { ok: false, error };
  },
  // Type-level natives (see _typeDefined for the function specs). These are
  // the late-binding implementations of the unified `$el`-substrate
  // dependent-type constructors: `Vec(elemType, { var: "n" })` parses to
  // `$el { call: ["vecOfLength", elemType, { var: "n" }] }`, and the
  // validator's `$el` resolver evaluates the call against this native.
  vecOfLength: vecOfLengthNative,
  lengthBoundedStringOf: lengthBoundedStringOfNative,
  mapSet: (record, key, value) => {
    const r = (record ?? {}) as Record<string, unknown>;
    return { ...r, [String(key)]: value };
  },
  mapDelete: (record, key) => {
    const r = (record ?? {}) as Record<string, unknown>;
    const k = String(key);
    if (!(k in r)) return { ...r };
    const out = { ...r };
    delete out[k];
    return out;
  },
  // mapGet — the O(1) READ sibling of mapSet (the opaque-map perf branch,
  // parser-substrate 7h S2). Read a record field by a DYNAMIC string key,
  // returning Maybe (Just value / Nothing) — genuinely inexpressible in `.fenel`
  // because `.field` is static-keyed. The pure ADT (assoc-list) stays the source
  // of truth; this + fromEntries are the JS-object index perf rep that makes the
  // parser's env lookups (findEntry/lookupBool/lookupVal/bodyOf) constant-time.
  mapGet: (record, key) => {
    const r = record as Record<string, unknown> | null | undefined;
    const k = String(key);
    return r != null
        && typeof r === "object"
        && Object.prototype.hasOwnProperty.call(r, k)
      ? { $tag: "Just", _0: r[k] }
      : { $tag: "Nothing" };
  },
  // fromEntries — the O(n) inverse of `entries` (build a record from a list of
  // {key, value} pairs in ONE pass). parser-substrate 7h S2: folding an index
  // with the immutable-spread `mapSet` is O(n²); fromEntries builds it O(n).
  // FIRST occurrence wins (a later duplicate key is dropped) — mirrors the
  // first-match `findEntry` assoc-list lookup it accelerates, so the index is
  // byte-identical to the linear scan even if a duplicate name ever appeared
  // (the parser's env names are unique by the bumpName/dedup invariant anyway).
  fromEntries: (pairs) => {
    // Dynamic keys are semantic data, including Object.prototype spellings.
    // A null prototype plus an own-property check preserves `__proto__` and
    // `constructor` without consulting or mutating the JS prototype chain.
    const out: Record<string, unknown> = Object.create(null);
    const arr = Array.isArray(pairs) ? pairs : [];
    for (const e of arr) {
      const k = String((e as { key: unknown }).key);
      if (!Object.prototype.hasOwnProperty.call(out, k)) {
        out[k] = (e as { value: unknown }).value;
      }
    }
    return out;
  },
  capitalize: strOps.strCapitalize,
  titleCase: strOps.strTitleCase,
  kebabCase: strOps.strKebabCase,
  snakeCase: strOps.strSnakeCase,
  camelCase: strOps.strCamelCase,
  slugify: strOps.strSlugify,
  words: strOps.strWords,
  lines: strOps.strLines,
  chars: strOps.strChars,
  at: strOps.listAt,

  // Collection — non-callable ops live here. map / filter / fold / find /
  // sort / groupBy / partition / flatMap / zipWith / takeWhile / dropWhile /
  // compose / flip dispatch a Fenel callable, so they live in
  // stdNativesCtx (ctx-aware natives) instead.
  flatten: (arr) => toArr(arr).flat(),
  sortLex: (arr) => [...toArr(arr)].sort(),
  zip: (a, b) => {
    const aa = toArr(a), bb = toArr(b);
    const len = Math.min(aa.length, bb.length);
    const result: unknown[] = [];
    for (let i = 0; i < len; i++) result.push([aa[i], bb[i]]);
    return result;
  },
  take: (n, xs) => {
    const k = Math.max(0, toNum(n));
    if (typeof xs === "string") return xs.slice(0, k);
    return toArr(xs).slice(0, k);
  },
  drop: (n, xs) => {
    const k = Math.max(0, toNum(n));
    if (typeof xs === "string") return xs.slice(k);
    return toArr(xs).slice(k);
  },
  // Function combinators with no callable args.
  // partition lives in stdNativesCtx — see ctx-aware natives below.
  sum: (arr) => toArr(arr).reduce<number>((s, v) => s + toNum(v), 0),
  avg: (arr) => {
    const a = toArr(arr);
    if (a.length === 0) return 0;
    return a.reduce<number>((s, v) => s + toNum(v), 0) / a.length;
  },
  // minimum / maximum — the ledgered PERF BRANCH of the Fenel bodies in
  // fenel/modules/std/list/extremum.fenel, which are the source of truth.
  // signature-substrate slice 3c-D2 repaired the range escape ATOMICALLY with
  // the declared type: these used to return host-`undefined` for the empty list
  // and for any pair the leaf cannot order, under a declared return of `a` —
  // a value of type `a` that is host-`undefined` violates cornerstone 7 and
  // falsifies SC-sig. The DECISIONS below are byte-for-byte the pre-repair
  // ones (incl. `toArr`'s non-array => `[]`, and a singleton returning its sole
  // element unexamined); only the RESULT REPRESENTATION changed to the tagged
  // `Maybe a`. Keep in lockstep with extremum.fenel — a divergence between the
  // two branches would make the honesty claim depend on which branch ran.
  minimum: (arr) => {
    const a = toArr(arr);
    if (a.length === 0) return { $tag: "Nothing" };
    let m: unknown = a[0];
    for (let i = 1; i < a.length; i++) {
      const x = a[i];
      if (typeof m === "number" && typeof x === "number") {
        if (x < m) m = x;
      } else if (typeof m === "string" && typeof x === "string") {
        if (x < m) m = x;
      } else {
        return { $tag: "Nothing" };
      }
    }
    return { $tag: "Just", _0: m };
  },
  maximum: (arr) => {
    const a = toArr(arr);
    if (a.length === 0) return { $tag: "Nothing" };
    let m: unknown = a[0];
    for (let i = 1; i < a.length; i++) {
      const x = a[i];
      if (typeof m === "number" && typeof x === "number") {
        if (x > m) m = x;
      } else if (typeof m === "string" && typeof x === "string") {
        if (x > m) m = x;
      } else {
        return { $tag: "Nothing" };
      }
    }
    return { $tag: "Just", _0: m };
  },
  head: (xs) => {
    if (typeof xs === "string") {
      const h = strHead(xs);
      return h !== null && h !== undefined && h !== ""
        ? { $tag: "Just", _0: h }
        : { $tag: "Nothing" };
    }
    const a = toArr(xs);
    return a.length > 0 ? { $tag: "Just", _0: a[0] } : { $tag: "Nothing" };
  },
  tail: (xs) => {
    if (typeof xs === "string") {
      const t = strTail(xs);
      return t !== null && t !== undefined
        ? { $tag: "Just", _0: t }
        : { $tag: "Nothing" };
    }
    const a = toArr(xs);
    return a.length > 0 ? { $tag: "Just", _0: a.slice(1) } : { $tag: "Nothing" };
  },
  last: (xs) => {
    if (typeof xs === "string") {
      const l = strLast(xs);
      return l !== null && l !== undefined
        ? { $tag: "Just", _0: l }
        : { $tag: "Nothing" };
    }
    const a = toArr(xs);
    return a.length > 0 ? { $tag: "Just", _0: a[a.length - 1] } : { $tag: "Nothing" };
  },
  init: (xs) => {
    if (typeof xs === "string") {
      const i = strInit(xs);
      return i !== null && i !== undefined
        ? { $tag: "Just", _0: i }
        : { $tag: "Nothing" };
    }
    const a = toArr(xs);
    return a.length > 0 ? { $tag: "Just", _0: a.slice(0, -1) } : { $tag: "Nothing" };
  },
  // The exact Fenel scheme is List a -> List a -> List a. Keep the legacy
  // two-string representation arm for established authored/perf paths without
  // collapsing nominal String into List Char in inference. Mixed runtime kinds
  // fall through to array form (a string is treated as one element).
  concat: (a, b) => {
    if (typeof a === "string" && typeof b === "string") return a + b;
    return [...toArr(a), ...toArr(b)];
  },
  mergeRecords: (a, b) => {
    const left =
      a && typeof a === "object" && !Array.isArray(a)
        ? (a as Record<string, unknown>)
        : {};
    const right =
      b && typeof b === "object" && !Array.isArray(b)
        ? (b as Record<string, unknown>)
        : {};
    return { ...left, ...right };
  },
  assocRecord: (record, key, value) => {
    const base =
      record && typeof record === "object" && !Array.isArray(record)
        ? (record as Record<string, unknown>)
        : {};
    return { ...base, [toStr(key)]: value };
  },
  lookup: (record, key) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      return { $tag: "Nothing" };
    }
    const k = toStr(key);
    const r = record as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(r, k)) {
      return { $tag: "Just", _0: r[k] };
    }
    return { $tag: "Nothing" };
  },

  // Type — returns a FenelType value. The display name comes from
  // the Codeable instance on the returned Type, not from this
  // function. Heuristic mapping: JS primitives map to their named
  // Fenel atoms; tagged values (`{$tag: …}`) preserve the tag as a
  // `$named` reference; arrays/records get structural shapes with
  // empty inner types (best-effort; full inference would require
  // walking the contents).
  typeOf: (x) => {
    if (x === null || x === undefined) return { $void: true };
    if (typeof x === "boolean") return { $ref: "Boolean" };
    if (typeof x === "number") return { $ref: "Number" };
    if (typeof x === "string") return { $ref: "String" };
    if (Array.isArray(x)) return List({ $void: true });
    if (typeof x === "object") {
      const tag = (x as { $tag?: unknown }).$tag;
      if (typeof tag === "string") return { $ref: tag };
      return { $record: { fields: [] } };
    }
    return { $void: true };
  },
  isNull: (x) => x === null || x === undefined,
  isString: (x) => typeof x === "string",
  isNumber: (x) => typeof x === "number",
  isBoolean: (x) => typeof x === "boolean",
  isArray: (x) => Array.isArray(x),
  isBytes: isBytesNative,
  bytesToList: bytesToListNative,
  toString: (x: unknown) => toStr(x),
  jsLit: (value: unknown) => JSON.stringify(value),
  toNumber: (x: unknown) => toNum(x),
  toBoolean: (x: unknown) => {
    if (x === null || x === undefined || x === false || x === 0 || x === "" || x === "0") return false;
    if (Array.isArray(x) && x.length === 0) return false;
    return true;
  },
  numberIsFinite: (x) => Number.isFinite(toNum(x)),
  utf8Bytes: (s) => Array.from(new TextEncoder().encode(toStr(s))),
  // charFromCode / charCode — ALSO the opaque-repr PERF BRANCH (+ the LIFT/LOWER)
  // of `Reprable JsRuntime Char` (representation-substrate Phase 4, ledger B4):
  // Char = $opaque { name:"Char", pure: Nat ∈ unicode-scalars }, native = a
  // 1-char JS string. charFromCode IS the instance lift (codepoint Number →
  // 1-char-string native), charCode IS the lower (1-char-string → codepoint
  // Number) — number-direct (the refined Nat surfaces as its base number repr, not
  // a Peano spine; Peano materialization stack-overflows at codepoint scale — see
  // fenel/std/dispatch-instances.fenel reprableCharJsRuntime + the Phase-4 Step-0
  // note). The instance is the language fact; these leaves are the law-bound host
  // crossing. Already ledgered (host leaf, set-algebra-to-fenel 3b-3); no new row.
  charFromCode: (n) => String.fromCodePoint(toNum(n)),
  // charCode — the irreducible host leaf mapping a Char's runtime repr (a
  // one-character string) to its Unicode code point. `.codePointAt(0)` reads
  // the first code point (surrogate-pair aware); the empty string yields 0.
  // The inverse of charFromCode; the substrate pure-Fenel charLt / strCompare
  // (ord.fenel) build on to order Char/String lexically. No `.fenel` body can
  // author it — the host alone knows a Char-repr → ordinal mapping (same
  // category as utf8Bytes / charFromCode). set-algebra-to-fenel Phase 3b-3.
  charCode: (c) => toStr(c).codePointAt(0) ?? 0,
  numberToHex: (n, minDigits) => toNum(n).toString(16).toUpperCase().padStart(toNum(minDigits), "0"),

  // Logic
  // eq / neq — TYPE-DISCRIMINATED STRUCTURAL equality (decide-substrate Phase 6,
  // §1). The shared source of truth is `structuralEq` in json-logic.ts (itself
  // the perf branch of the Fenel `deepEqValue`); the two op-native sites (here +
  // `_eq`/`_neq` in json-logic.ts) route through it so they cannot drift.
  // Lazy-cached require to avoid the std → json-logic module-init cycle (the
  // same boundary the `evaluate` / `validate` natives below cross). The
  // pre-Phase-6 impl was JS-loose (`a == b`) — an unsound leak of JS coercion
  // into language equality (§0: not transitive, not a congruence). This is an
  // extension of the EXISTING ledger B4 op-native row (see the ledger note).
  eq: (a, b) => structuralEqNative(a, b),
  neq: (a, b) => !structuralEqNative(a, b),
  // lt / gt / lte / gte — the SANCTIONED OPAQUE-REPR PERF BRANCH (ledger B4):
  // when BOTH operands are strings they compare via JS lexical `<`/`>` (the
  // repr-level fast path for String = $opaque { repr: "string", pure: List Char }).
  // The PURE SOURCE OF TRUTH is `std:strCompare` (ord.fenel) — a code-point fold
  // over `List Char` via the `charCode` host leaf; `a < b` is its byte-equivalent
  // repr shortcut, NOT an independent definition. set-algebra-to-fenel Phase 3b-3
  // (string-ordering enabler): before this, `toNum("b")` was NaN so every string
  // comparison returned false.
  // decide-substrate Phase 6 (§1.2): the order family is now SAME-TYPE —
  // both-strings ⇒ lexical, both-numbers ⇒ numeric, CROSS-TYPE ⇒ `false` (no
  // order relation between distinct types; booleans / objects ⇒ false too). The
  // old coercing `toNum` cross-type path (`lte("5",5)=true`) is what broke
  // antisymmetry and blocked the §3 nonstrict-cycle equality derivation.
  gt: (a, b) => (typeof a === "string" && typeof b === "string") ? a > b : (typeof a === "number" && typeof b === "number") ? toNum(a) > toNum(b) : false,
  gte: (a, b) => (typeof a === "string" && typeof b === "string") ? a >= b : (typeof a === "number" && typeof b === "number") ? toNum(a) >= toNum(b) : false,
  lt: (a, b) => (typeof a === "string" && typeof b === "string") ? a < b : (typeof a === "number" && typeof b === "number") ? toNum(a) < toNum(b) : false,
  lte: (a, b) => (typeof a === "string" && typeof b === "string") ? a <= b : (typeof a === "number" && typeof b === "number") ? toNum(a) <= toNum(b) : false,
  and: (a, b) => jsTruthy(a) && jsTruthy(b),
  or: (a, b) => jsTruthy(a) || jsTruthy(b),
  truthy: (x) => jsTruthy(x),
  substr: (s, start, len) => {
    const str = toStr(s);
    const st = toNum(start);
    if (len == null) return str.substring(st);
    const ln = toNum(len);
    return ln < 0 ? str.substring(st, str.length + ln) : str.substring(st, st + ln);
  },
  // elem — a bodyless native (the compiled parser/resolver owners require it as
  // a host leaf), specified in Fenel terms by logic-native.fenel: `contains
  // haystack (toString needle)` on a String (except that the needle converts
  // by JS `String`: null -> "null", undefined -> "undefined"), exactly
  // `includes haystack needle` under stock structural equality (recipe-functions S1) on a
  // List, else False. This fixed bootstrap leaf does not follow reader overrides.
  // Stock-profile parity is tested against the `includes` body and
  // `contains` / `toString`. Retained bootstrap debt (ts-exceptions ledger S1).
  elem: (needle, haystack) => {
    // JS `String`, not `toStr`: null/undefined convert to "null"/"undefined"
    // (pre-S1 behaviour, as legacy JSON Logic `in`; review S1-1).
    if (typeof haystack === "string") return haystack.includes(String(needle));
    if (Array.isArray(haystack)) return membershipIncludes(haystack, needle);
    return false;
  },
  merge: (...args) => args.flatMap((a) => (Array.isArray(a) ? a : [a])),
  bitAnd: (a, b) => toNum(a) & toNum(b),
  bitOr:  (a, b) => toNum(a) | toNum(b),
  bitXor: (a, b) => toNum(a) ^ toNum(b),
  bitNot: (a) => ~toNum(a),
  shiftLeft:  (a, n) => toNum(a) << toNum(n),
  shiftRight: (a, n) => toNum(a) >> toNum(n),
  shiftRightU: (a, n) => toNum(a) >>> toNum(n),
  float64ToBytesLE: (n) => {
    const arr = new ArrayBuffer(8);
    new Float64Array(arr)[0] = toNum(n);
    const view = new Uint8Array(arr);
    const out: number[] = [];
    for (let i = 0; i < 8; i++) out.push(view[i]!);
    return out;
  },
  float32ToBytesLE: (n) => {
    const arr = new ArrayBuffer(4);
    new Float32Array(arr)[0] = toNum(n);
    const view = new Uint8Array(arr);
    const out: number[] = [];
    for (let i = 0; i < 4; i++) out.push(view[i]!);
    return out;
  },

  // Date
  now: () => new Date(Date.now()).toISOString(),
  addDays: (d, n) => {
    const date = new Date(toStr(d));
    date.setDate(date.getDate() + toNum(n));
    return date.toISOString();
  },
  addHours: (d, n) => {
    const date = new Date(toStr(d));
    date.setHours(date.getHours() + toNum(n));
    return date.toISOString();
  },
  diffDays: (a, b) => {
    const da = new Date(toStr(a)).getTime();
    const db = new Date(toStr(b)).getTime();
    return Math.round((da - db) / (1000 * 60 * 60 * 24));
  },
  formatDate: (d, fmt) => {
    const date = new Date(toStr(d));
    const f = toStr(fmt) || "iso";
    if (f === "iso") return date.toISOString();
    if (f === "short") return date.toLocaleDateString();
    if (f === "long") return date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    return date.toISOString();
  },
  parseDate: (s) => new Date(toStr(s)).toISOString(),

  // Markup constructors
  element: (tag, attrs, children) => ({
    $tag: "Element",
    tag: toStr(tag),
    attrs: Array.isArray(attrs) ? attrs : [],
    children: Array.isArray(children) ? children : [],
  }),
  text: (value) => ({
    $tag: "Text",
    value: toStr(value),
  }),
  attr: (key, value) => ({ key: toStr(key), value: toStr(value) }),

  // Image processing — sourced from `../image-ops.ts`. Pure pixel-matrix
  // transforms; the dashboard storybook evaluates these live.
  // Overlay and Gaussian/box blur intentionally retain approved performance
  // mirrors of the complete bodies in native/image-native.fenel; parity is
  // pinned by scripts/tests/image-source.test.ts.
  imageGrayscale: imgOps.imgGrayscale,
  imageInvert: imgOps.imgInvert,
  imageBrightness: imgOps.imgBrightness,
  imageContrast: imgOps.imgContrast,
  imageSaturate: imgOps.imgSaturate,
  imageHueRotate: imgOps.imgHueRotate,
  imageSepia: imgOps.imgSepia,
  imageThreshold: imgOps.imgThreshold,
  imagePosterize: imgOps.imgPosterize,
  imageGamma: imgOps.imgGamma,
  imageOpacity: imgOps.imgOpacity,
  imageCrop: imgOps.imgCrop,
  imageResize: imgOps.imgResize,
  imageFlipHorizontal: imgOps.imgFlipHorizontal,
  imageFlipVertical: imgOps.imgFlipVertical,
  imageRotate90: imgOps.imgRotate90,
  imageRotate180: imgOps.imgRotate180,
  imageRotate270: imgOps.imgRotate270,
  imageTranspose: imgOps.imgTranspose,
  imagePixelate: imgOps.imgPixelate,
  imageBoxBlur: imgOps.imgBoxBlur,
  imageGaussianBlur: imgOps.imgGaussianBlur,
  imageSharpen: imgOps.imgSharpen,
  imageEmboss: imgOps.imgEmboss,
  imageEdgeDetect: imgOps.imgEdgeDetect,
  imageMedian: imgOps.imgMedian,
  imageRedChannel: imgOps.imgRedChannel,
  imageGreenChannel: imgOps.imgGreenChannel,
  imageBlueChannel: imgOps.imgBlueChannel,
  imageSwapRedBlue: imgOps.imgSwapRedBlue,
  imageSwapRedGreen: imgOps.imgSwapRedGreen,
  imageOverlay: imgOps.imgOverlay,
  imageMultiply: imgOps.imgMultiply,
  imageScreen: imgOps.imgScreen,
  imageDifference: imgOps.imgDifference,
  imageSample: imgOps.imgSample,
  imageSolid: imgOps.imgSolid,
  imageGradient: imgOps.imgGradient,
  imageNoise: imgOps.imgNoise,
  imageCheckerboard: imgOps.imgCheckerboard,
  imageVignette: imgOps.imgVignette,
  imageDither: imgOps.imgDither,
};

// ---------------------------------------------------------------------------
// Ctx-aware native implementations — higher-order builtins and reader-aware
// B4 representation selectors (including collection membership). The selectors
// admit their own stock dependency routes or fall through to source. Higher-order
// builtins receive the context to re-enter the evaluator per element.
//
// effect-visibility Phase 3 — THE PURITY-GATED PERF BRANCH (the intentional
// dual, NOT the forbidden accidental TS shadow). Every higher-order fn below
// also has a Fenel body in fenel/modules/std/hof.fenel — THAT is the source of truth;
// this map is its opaque-repr-for-functions performance branch (the same
// ledger kind as fenel-parser.ts). The explicit SELECTOR:
//   • pure evaluator (json-logic.ts invokeFunction): nativesCtx dispatches
//     BEFORE spec.body — always the native. Sound because a HOF call is only
//     reached inside a closure the structural purity gate already proved
//     fully pure (an effectful callable routes the whole caller durable).
//   • durable turn (runtime/src/evaluator.ts yieldsIO): gates every
//     $arrow-typed argument; ALL provably pure ⇒ this native runs inline;
//     ANY not provably pure ⇒ the call yields to the Fenel body
//     (registerFenelBodyDispatchers), which steps per-element IO properly.
// invokeCallable CANNOT yield mid-native — an effectful callable reaching
// one of these impls inline-nulls at the IO leaf (json-logic.ts:2094); the
// selector exists so that never happens on the durable path.
// ---------------------------------------------------------------------------

export const stdNativesCtx: Record<
  string,
  (ctx: EvaluateContext, ...args: unknown[]) => unknown
> = {
  ...rationalPerfNativesCtx,
  ...rationalRootPerfNativesCtx,
  ...integerPerfNativesCtx,
  reverse: reverseRepresentationNative,
  // B4: a changed reader dependency falls through to its Fenel source body.
  includes: (ctx, arr, value) => membershipRepresentationNative(ctx, "includes", [arr, value]),
  unique: (ctx, arr) => membershipRepresentationNative(ctx, "unique", [arr]),
  distinctCount: (ctx, arr) => membershipRepresentationNative(ctx, "distinctCount", [arr]),
  map: (ctx, fn, xs) => {
    if (typeof xs === "string") {
      let out = "";
      for (const c of xs) out += String(invokeCallable(fn, [c], ctx));
      return out;
    }
    return toArr(xs).map((v) => invokeCallable(fn, [v], ctx));
  },
  filter: (ctx, fn, xs) => {
    if (typeof xs === "string") {
      let out = "";
      for (const c of xs) if (jsTruthy(invokeCallable(fn, [c], ctx))) out += c;
      return out;
    }
    return toArr(xs).filter((v) => jsTruthy(invokeCallable(fn, [v], ctx)));
  },
  fold: (ctx, fn, init, xs) => {
    let acc = init;
    if (typeof xs === "string") {
      for (const c of xs) acc = invokeCallable(fn, [acc, c], ctx);
      return acc;
    }
    for (const v of toArr(xs)) acc = invokeCallable(fn, [acc, v], ctx);
    return acc;
  },
  find: (ctx, fn, xs) => {
    for (const v of toArr(xs)) {
      if (jsTruthy(invokeCallable(fn, [v], ctx))) return { $tag: "Just", _0: v };
    }
    return { $tag: "Nothing" };
  },
  findIndex: (ctx, fn, xs) => {
    const arr = toArr(xs);
    for (let i = 0; i < arr.length; i++) {
      if (jsTruthy(invokeCallable(fn, [arr[i]], ctx))) return i;
    }
    return -1;
  },
  all: (ctx, xs, fn) => {
    for (const v of toArr(xs)) {
      if (!jsTruthy(invokeCallable(fn, [v], ctx))) return false;
    }
    return true;
  },
  some: (ctx, xs, fn) => {
    for (const v of toArr(xs)) {
      if (jsTruthy(invokeCallable(fn, [v], ctx))) return true;
    }
    return false;
  },
  none: (ctx, xs, fn) => {
    for (const v of toArr(xs)) {
      if (jsTruthy(invokeCallable(fn, [v], ctx))) return false;
    }
    return true;
  },
  // The perf branch of the Fenel body `std:sort` (hof-combine.fenel), mirroring
  // it exactly (2026-10-30): each element's key is computed once, in order,
  // then `sortKeyOrder` applies the body's split and `lt` merge. Incomparable
  // keys are a tie, so the order no longer depends on the host's sort or on a
  // text conversion; numbers-only (no NaN) and strings-only orders are the
  // ordinary stable ascending ones, as before.
  sort: (ctx, fn, xs) => {
    const items = [...toArr(xs)];
    const keys = items.map((item) => invokeCallable(fn, [item], ctx));
    return sortKeyOrder(keys, 0, keys.length).map((i) => items[i]);
  },
  // A4 bridge (extends ledgered exception A4): std code reaches the existing
  // exact equality owner, which must run in the curated harness with its
  // exact-equality natives. No comparison logic here; the verdict is returned
  // verbatim, and a harness exception is an undecided comparison (Nothing),
  // mirroring the owner's own natives. It evaluates no caller callable.
  exactValueEqual: (ctx, left, right) => {
    try {
      const bridge = engineRequire("engine-bodies-dispatch") as typeof import("../../../../implementations/typescript/engine/src/engine-bodies-dispatch");
      const verdict = bridge.dispatchEngineBody("engine:deepEqValueTri", [left, right], ctx) as { $tag?: unknown; _0?: unknown } | null | undefined;
      if (verdict?.$tag === "Just" && typeof verdict._0 === "boolean") return verdict;
      return { $tag: "Nothing" };
    } catch { return { $tag: "Nothing" }; }
  },
  groupBy: (ctx, fn, xs) => {
    const out: Record<string, unknown[]> = Object.create(null);
    for (const v of toArr(xs)) {
      const key = String(invokeCallable(fn, [v], ctx));
      if (!out[key]) out[key] = [];
      out[key]!.push(v);
    }
    return out;
  },
  partition: (ctx, fn, xs) => {
    const yes: unknown[] = [], no: unknown[] = [];
    for (const v of toArr(xs)) {
      if (jsTruthy(invokeCallable(fn, [v], ctx))) yes.push(v); else no.push(v);
    }
    return [yes, no];
  },
  flatMap: (ctx, fn, xs) => {
    const out: unknown[] = [];
    for (const v of toArr(xs)) {
      const piece = invokeCallable(fn, [v], ctx);
      if (Array.isArray(piece)) out.push(...piece);
      else if (piece !== null && piece !== undefined) out.push(piece);
    }
    return out;
  },
  zipWith: (ctx, fn, xs, ys) => {
    const aa = toArr(xs), bb = toArr(ys);
    const n = Math.min(aa.length, bb.length);
    const out: unknown[] = [];
    for (let i = 0; i < n; i++) out.push(invokeCallable(fn, [aa[i], bb[i]], ctx));
    return out;
  },
  takeWhile: (ctx, fn, xs) => {
    const out: unknown[] = [];
    for (const v of toArr(xs)) {
      if (!jsTruthy(invokeCallable(fn, [v], ctx))) break;
      out.push(v);
    }
    return out;
  },
  dropWhile: (ctx, fn, xs) => {
    const arr = toArr(xs);
    let i = 0;
    while (i < arr.length && jsTruthy(invokeCallable(fn, [arr[i]], ctx))) i++;
    return arr.slice(i);
  },
  // compose / flip return new closures that capture their callable args via
  // the closure's `closure` map; the body re-invokes them via `call`.
  compose: (_ctx, f, g) => ({
    __fenelFn: true,
    params: ["__x"],
    body: { call: [{ var: "__f" }, { call: [{ var: "__g" }, { var: "__x" }] }] },
    closure: { __f: f, __g: g },
  }),
  flip: (_ctx, fn) => ({
    __fenelFn: true,
    params: ["__a", "__b"],
    body: { call: [{ var: "__fn" }, { var: "__b" }, { var: "__a" }] },
    closure: { __fn: fn },
  }),
};
