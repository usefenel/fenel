import { describe, expect, test } from "bun:test";
import {
  constructorDeclaredFieldNames,
  dynamicConstructorTableInForce,
  evaluate,
  noPerformEvaluateContext,
  type EvaluateContext,
  type ImportFrame,
} from "./json-logic";
import { frameAccount } from "./authority";
import {
  mintTestAuthorityForAccount,
  testDescriptorEnvelope,
} from "./authority-test-support";

describe("checking frame retains its reader while disabling perform", () => {
  test("copies descriptors without invoking accessors and preserves authority and frozen posture", () => {
    const authority = mintTestAuthorityForAccount("reader-account", testDescriptorEnvelope(["test:whereAct"]));
    const imports: ImportFrame[] = [{ names: { inspect: "reader:inspect" }, aliases: {} }];
    const dictionary: NonNullable<EvaluateContext["_dictStack"]> = [];
    const localData = { value: 42 };
    const prototype = { readerPrototype: true };

    for (const frozen of [false, true]) {
      let getterReads = 0;
      const unread = () => {
        getterReads++;
        throw new Error("checking-frame creation invoked a reader accessor");
      };
      const reader: EvaluateContext = Object.assign(Object.create(prototype), {
        _authority: authority,
        _activeScopeToken: "reader-scope",
        _activeTags: ["reader-tag"],
        _dictStack: dictionary,
        _importStack: imports,
        _sourceFunction: "reader:source",
        natives: Object.create(null),
        nativesCtx: Object.create(null),
      });
      Object.defineProperties(reader, {
        getFunction: { get: unread, enumerable: false, configurable: true },
        _readerSourceMetadata: { get: unread, enumerable: true, configurable: true },
        _performTable: { get: unread, enumerable: true, configurable: true },
        _ioHandlerContext: { get: unread, enumerable: true, configurable: true },
        _authoringInvocation: { get: unread, enumerable: true, configurable: true },
        onStep: { get: unread, enumerable: true, configurable: true },
      });
      if (frozen) Object.freeze(reader);

      const checking = noPerformEvaluateContext(reader, localData);
      expect(checking).not.toBe(reader);
      expect(getterReads).toBe(0);
      const declaration = { _sourceFunction: "owned:predicate", _importStack: [{ names: { check: "owned:check" }, aliases: {} }] };
      const scoped = noPerformEvaluateContext(reader, localData, declaration);
      expect(scoped._sourceFunction).toBe(declaration._sourceFunction);
      expect(scoped._importStack).toBe(declaration._importStack);
      expect(scoped._authority).toBe(authority);
      expect(frameAccount(scoped)).toBe("reader-account");
      expect(Object.isFrozen(scoped)).toBe(frozen);
      expect(getterReads).toBe(0);
      expect(Object.getPrototypeOf(checking)).toBe(prototype);
      expect(Object.isFrozen(checking)).toBe(frozen);
      for (const key of [
        "getFunction", "_readerSourceMetadata", "_authority", "_activeScopeToken", "_activeTags",
        "_dictStack", "_importStack", "_sourceFunction", "natives", "nativesCtx",
      ]) {
        expect(Object.getOwnPropertyDescriptor(checking, key)).toEqual(Object.getOwnPropertyDescriptor(reader, key));
      }
      expect(checking._authority).toBe(authority);
      expect(frameAccount(checking)).toBe("reader-account");
      expect(checking._dictStack).toBe(dictionary);
      expect(checking._importStack).toBe(imports);
      expect(checking._localData).toBe(localData);
      for (const key of ["_performTable", "_ioHandlerContext", "_authoringInvocation", "onStep"]) {
        const descriptor = Object.getOwnPropertyDescriptor(checking, key);
        expect(descriptor).toHaveProperty("value", undefined);
        expect(descriptor).not.toHaveProperty("get");
      }
      expect(getterReads).toBe(0);
    }
  }, 120_000);

  test("shares dynamic constructor state with the actual reader in both directions", () => {
    const reader: EvaluateContext = Object.freeze({});
    const checking = noPerformEvaluateContext(reader, undefined, { _sourceFunction: "owned:predicate", _importStack: [] });
    expect(dynamicConstructorTableInForce(reader)).toBe(false);
    expect(dynamicConstructorTableInForce(checking)).toBe(false);

    evaluate({ type_def: { name: "ReaderType", constructors: [{ name: "ReaderCtor", fields: [{ name: "payload" }] }] } }, {}, reader);
    expect(dynamicConstructorTableInForce(reader)).toBe(true);
    expect(dynamicConstructorTableInForce(checking)).toBe(true);
    expect(constructorDeclaredFieldNames(checking, "ReaderCtor")).toEqual(["payload"]);

    const nestedChecking = noPerformEvaluateContext(checking);
    evaluate({ type_def: { name: "CheckingType", constructors: [{ name: "CheckingCtor", fields: [{ name: "other" }] }] } }, {}, nestedChecking);
    expect(constructorDeclaredFieldNames(reader, "CheckingCtor")).toEqual(["other"]);
    expect(constructorDeclaredFieldNames(checking, "CheckingCtor")).toEqual(["other"]);
  });
});
