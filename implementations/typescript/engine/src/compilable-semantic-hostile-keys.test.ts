import { describe, expect, it } from "vitest";
import { compilableSemanticCheckNative } from "../../../../fenel/modules/prover/ffi/prover-ffi";
import { compileSourceFromUnknown } from "./compilable";
import { dispatchedNormaliseToCore } from "./engine-bodies-dispatch";

type AccessCounter = { calls: number };

function positionalSlot(): Record<string, unknown> {
  return {
    wireName: "value",
    key: { $tag: "PositionalField", index: 0 },
  };
}

function validUnknownSource(): Record<string, unknown> {
  return {
    name: "strict-ingress",
    params: [positionalSlot()],
    body: { var: "value" },
    ctorDefs: { Just: [positionalSlot()] },
    callBindings: { helper: "demo:helper" },
  };
}

function alternatingGetter(
  counter: AccessCounter,
  first: unknown,
  second: unknown,
): () => unknown {
  return () => {
    counter.calls += 1;
    return counter.calls % 2 === 1 ? first : second;
  };
}

function throwingGetter(counter: AccessCounter): () => never {
  return () => {
    counter.calls += 1;
    throw new Error("compiler ingress invoked an accessor");
  };
}

function defineAccessor(
  target: object,
  key: PropertyKey,
  get: () => unknown,
): void {
  Object.defineProperty(target, key, {
    get,
    enumerable: true,
    configurable: true,
  });
}

function expectAccessorRejection(
  source: unknown,
  counter: AccessCounter,
  path: string,
): void {
  let result: ReturnType<typeof compileSourceFromUnknown> | undefined;
  expect(() => {
    result = compileSourceFromUnknown(source);
  }).not.toThrow();
  expect(result).toMatchObject({
    $tag: "Err",
    _0: {
      $tag: "Unsupported",
      reason: expect.stringContaining(path),
    },
  });
  if (result?.$tag === "Err" && result._0.$tag === "Unsupported") {
    expect(result._0.reason).toContain("accessor");
  }
  expect(counter.calls).toBe(0);
}

describe("compilable semantic-check evaluator inputs", () => {
  it("projects prototype-hostile parameter names as own data", () => {
    const result = compilableSemanticCheckNative(
      {
        name: "hostile-parameter-names",
        paramNames: ["__proto__", "constructor"],
        body: { add: [{ var: "__proto__" }, { var: "constructor" }] },
        args: [3, 5],
      },
      "compile-js:compileFenelToJs",
    );

    expect(result).toEqual({ $tag: "Just", _0: true });
  });
});

describe("strict compiler ingress descriptor snapshots", () => {
  it("rejects source, slot, and FieldKey accessors without invoking alternating getters", () => {
    {
      const counter = { calls: 0 };
      const source = validUnknownSource();
      defineAccessor(source, "name", alternatingGetter(counter, "first", "second"));
      expectAccessorRejection(source, counter, "CompileSource.name");
    }
    {
      const counter = { calls: 0 };
      const source = validUnknownSource();
      const params = source.params as unknown[];
      defineAccessor(params, "0", alternatingGetter(counter, positionalSlot(), null));
      expectAccessorRejection(source, counter, "CompileSource.params[0]");
    }
    {
      const counter = { calls: 0 };
      const source = validUnknownSource();
      const slot = (source.params as unknown[])[0] as Record<string, unknown>;
      defineAccessor(slot, "wireName", alternatingGetter(counter, "value", 42));
      expectAccessorRejection(source, counter, "CompileSource.params[0].wireName");
    }
    {
      const counter = { calls: 0 };
      const source = validUnknownSource();
      const slot = (source.params as unknown[])[0] as Record<string, unknown>;
      const key = slot.key as Record<string, unknown>;
      defineAccessor(key, "$tag", alternatingGetter(counter, "PositionalField", "NamedField"));
      expectAccessorRejection(source, counter, "CompileSource.params[0].key.$tag");
    }
  });

  it("turns throwing source, FieldKey, and slot accessors into structured CompileError", () => {
    {
      const counter = { calls: 0 };
      const source = validUnknownSource();
      defineAccessor(source, "body", throwingGetter(counter));
      expectAccessorRejection(source, counter, "CompileSource.body");
    }
    {
      const counter = { calls: 0 };
      const source = validUnknownSource();
      const slot = (source.params as unknown[])[0] as Record<string, unknown>;
      defineAccessor(slot, "key", throwingGetter(counter));
      expectAccessorRejection(source, counter, "CompileSource.params[0].key");
    }
    {
      const counter = { calls: 0 };
      const source = validUnknownSource();
      const slot = (source.params as unknown[])[0] as Record<string, unknown>;
      slot.key = { $tag: "PositionalField", index: 0 };
      defineAccessor(slot.key as object, "index", throwingGetter(counter));
      expectAccessorRejection(source, counter, "CompileSource.params[0].key.index");
    }
    {
      const counter = { calls: 0 };
      const source = validUnknownSource();
      const slot = (source.params as unknown[])[0] as Record<string, unknown>;
      const ref = { $ref: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
      slot.key = { $tag: "NamedField", ref };
      defineAccessor(ref, "$ref", throwingGetter(counter));
      expectAccessorRejection(source, counter, "CompileSource.params[0].key.ref.$ref");
    }
  });

  it("rejects ctorDefs and callBindings accessors without invoking them", () => {
    {
      const counter = { calls: 0 };
      const source = validUnknownSource();
      defineAccessor(source.ctorDefs as object, "Just", throwingGetter(counter));
      expectAccessorRejection(source, counter, 'CompileSource.ctorDefs["Just"]');
    }
    {
      const counter = { calls: 0 };
      const source = validUnknownSource();
      const fields = (source.ctorDefs as Record<string, unknown>).Just as unknown[];
      defineAccessor(fields, "0", alternatingGetter(counter, positionalSlot(), undefined));
      expectAccessorRejection(source, counter, 'CompileSource.ctorDefs["Just"][0]');
    }
    {
      const counter = { calls: 0 };
      const source = validUnknownSource();
      defineAccessor(source.callBindings as object, "helper", throwingGetter(counter));
      expectAccessorRejection(source, counter, 'CompileSource.callBindings["helper"]');
    }
  });

  it("rejects alternating and throwing accessors anywhere in the JSON-Logic body", () => {
    const getterFactories: Array<(counter: AccessCounter) => () => unknown> = [
      (counter) => alternatingGetter(counter, "value", "other"),
      (counter) => throwingGetter(counter),
    ];
    for (const makeGetter of getterFactories) {
      const counter = { calls: 0 };
      const source = validUnknownSource();
      const body = Object.create(null) as Record<string, unknown>;
      defineAccessor(body, "var", makeGetter(counter));
      source.body = body;

      const checked = compileSourceFromUnknown(source);
      expect(checked.$tag).toBe("Ok");
      if (checked.$tag !== "Ok") throw new Error("expected outer compiler ingress to succeed");
      expect(counter.calls).toBe(0);

      let result: ReturnType<typeof dispatchedNormaliseToCore> | undefined;
      expect(() => {
        result = dispatchedNormaliseToCore(checked._0);
      }).not.toThrow();
      expect(result).toMatchObject({
        $tag: "Err",
        _0: {
          $tag: "Unsupported",
          reason: expect.stringContaining('CompileSource.body["var"]'),
        },
      });
      if (result?.$tag === "Err" && result._0.$tag === "Unsupported") {
        expect(result._0.reason).toContain("accessor");
      }
      expect(counter.calls).toBe(0);
    }
  });

  it("ignores inherited JSON-Logic tags and rejects inherited array elements", () => {
    {
      const body = Object.create({ $tag: "CeLit" }) as Record<string, unknown>;
      Object.defineProperty(body, "var", { value: "value", enumerable: true });
      const source = validUnknownSource();
      source.body = body;
      const checked = compileSourceFromUnknown(source);
      expect(checked.$tag).toBe("Ok");
      if (checked.$tag !== "Ok") throw new Error("expected outer compiler ingress to succeed");
      expect(dispatchedNormaliseToCore(checked._0).$tag).toBe("Ok");
    }

    {
      const counter = { calls: 0 };
      const call = ["helper"] as unknown[];
      call.length = 2;
      const prototype = Object.create(Array.prototype) as unknown[];
      defineAccessor(prototype, "1", throwingGetter(counter));
      Object.setPrototypeOf(call, prototype);
      const source = validUnknownSource();
      source.body = { call };
      const checked = compileSourceFromUnknown(source);
      expect(checked.$tag).toBe("Ok");
      if (checked.$tag !== "Ok") throw new Error("expected outer compiler ingress to succeed");
      const result = dispatchedNormaliseToCore(checked._0);
      expect(result).toMatchObject({
        $tag: "Err",
        _0: {
          $tag: "Unsupported",
          reason: expect.stringContaining('CompileSource.body["call"][1]'),
        },
      });
      if (result.$tag === "Err" && result._0.$tag === "Unsupported") {
        expect(result._0.reason).toContain("dense own data property");
      }
      expect(counter.calls).toBe(0);
    }
  });
});
