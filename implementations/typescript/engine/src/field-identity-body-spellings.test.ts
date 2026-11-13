import { describe, expect, test } from "bun:test";
import {
  collectBodyFieldSpellings,
  FieldIdentityBodyWalkError,
  tryValidateBodyFieldSpellings,
  validateBodyFieldSpellings,
  type BodyFieldSpellingTarget,
} from "./field-identity";
import {
  __engineHarnessResolverArtifactFreshForTests,
  setResolverInterpreted,
  withInterpretedResolver,
} from "./engine-bodies-dispatch";
import { createAccountRegistry } from "./repository-registry";
import { getSystemRegistry } from "./system-registry";
import { Nothing } from "./type-foundation";
import type { FenelModule } from "./types";

const targets: readonly BodyFieldSpellingTarget[] = [
  { kind: "constructor", target: "Just", candidates: ["value"] },
  { kind: "constructor", target: "Pair", candidates: ["left", "right"] },
  { kind: "function", target: "demo:combine", candidates: ["first", "second"] },
];

describe("field-identity body spelling walk", () => {
  test("collects named constructor patterns, literals, and call records with stable paths", () => {
    const occurrences = collectBodyFieldSpellings([{
      owner: "demo:owner",
      path: "body",
      expression: {
        do: [
          {
            match: [
              { var: "input" },
              { $tag: "Just", value: { $bind: "value" }, _0: { $bind: "pos" } },
              {
                construct: ["Pair", {
                  right: { var: "value" },
                  left: 1,
                }],
              },
            ],
          },
          { call: ["demo:combine", { second: 2, first: 1 }] },
          // A positional constructor expression is not a named record merely
          // because its argument is represented by an object node.
          { construct: ["Just", { var: "value" }] },
        ],
      },
    }]);

    expect(occurrences).toEqual([
      {
        owner: "demo:owner",
        target: "Just",
        spelling: "value",
        path: 'body["do"][0]["match"][1]["value"]',
        kind: "constructor-pattern",
      },
      {
        owner: "demo:owner",
        target: "Pair",
        spelling: "right",
        path: 'body["do"][0]["match"][2]["construct"][1]["right"]',
        kind: "constructor-literal",
      },
      {
        owner: "demo:owner",
        target: "Pair",
        spelling: "left",
        path: 'body["do"][0]["match"][2]["construct"][1]["left"]',
        kind: "constructor-literal",
      },
      {
        owner: "demo:owner",
        target: "demo:combine",
        spelling: "second",
        path: 'body["do"][1]["call"][1]["second"]',
        kind: "named-call",
      },
      {
        owner: "demo:owner",
        target: "demo:combine",
        spelling: "first",
        path: 'body["do"][1]["call"][1]["first"]',
        kind: "named-call",
      },
    ]);
    expect(Object.isFrozen(occurrences)).toBe(true);
    expect(occurrences.every(Object.isFrozen)).toBe(true);
  });

  test("walks guarded and anonymous patterns to nested named constructors", () => {
    expect(collectBodyFieldSpellings([{
      owner: "demo:guarded",
      expression: {
        match: [
          { var: "input" },
          {
            $guard: [
              { wrapper: { $tag: "Just", value: { $bind: "x" } } },
              { call: ["gt", { var: "x" }, 0] },
            ],
          },
          { var: "x" },
        ],
      },
    }])).toEqual([{
      owner: "demo:guarded",
      target: "Just",
      spelling: "value",
      path: '$["match"][1]["$guard"][0]["wrapper"]["value"]',
      kind: "constructor-pattern",
    }]);
  });

  test("preserves prototype-hostile spellings and never invokes accessors", () => {
    const pattern = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(pattern, "$tag", {
      value: "Pair",
      enumerable: true,
    });
    Object.defineProperty(pattern, "__proto__", {
      value: { $bind: "x" },
      enumerable: true,
    });
    expect(collectBodyFieldSpellings([{
      owner: "demo:hostile",
      expression: { match: [0, pattern, 1] },
    }])[0]).toEqual({
      owner: "demo:hostile",
      target: "Pair",
      spelling: "__proto__",
      path: '$["match"][1]["__proto__"]',
      kind: "constructor-pattern",
    });

    let reads = 0;
    const hostile = { $tag: "Just" } as Record<string, unknown>;
    Object.defineProperty(hostile, "value", {
      enumerable: true,
      get() {
        reads += 1;
        return { $bind: "x" };
      },
    });
    expect(() => collectBodyFieldSpellings([{
      owner: "demo:accessor",
      expression: { match: [0, hostile, 1] },
    }])).toThrow(FieldIdentityBodyWalkError);
    expect(reads).toBe(0);
  });
});

describe("Fenel-owned body spelling validation", () => {
  test("accepts current spellings in one batch", () => {
    const occurrences = validateBodyFieldSpellings([{
      owner: "demo:valid",
      expression: {
        do: [
          {
            match: [
              { var: "input" },
              { $tag: "Just", value: { $bind: "value" } },
              { var: "value" },
            ],
          },
          { construct: ["Just", { value: 1 }] },
          { call: ["demo:combine", { second: 2, first: 1 }] },
        ],
      },
    }], targets);
    expect(occurrences).toHaveLength(4);
  }, 90_000);

  test("an unambiguous pattern miss returns the structural diagnostic", () => {
    const occurrence = collectBodyFieldSpellings([{
      owner: "demo:typo",
      path: "body",
      expression: { match: [{ var: "x" }, { $tag: "Just", vaule: { $bind: "v" } }, 1] },
    }]);
    const result = tryValidateBodyFieldSpellings(occurrence, targets);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      $tag: "UnresolvedFieldSpelling",
      message:
        'field-identity: unresolved constructor-pattern field spelling "vaule" for Just in demo:typo at body["match"][1]["vaule"]',
      owner: "demo:typo",
      path: 'body["match"][1]["vaule"]',
      spelling: "vaule",
      candidates: ["value"],
      kind: "unresolved",
    });
  }, 90_000);

  test("the certified compiled resolver and forced interpreted resolver agree", () => {
    const valid = collectBodyFieldSpellings([{
      owner: "demo:resolver-parity-valid",
      expression: { match: [0, { $tag: "Just", value: { $bind: "v" } }, 1] },
    }]);
    const invalid = collectBodyFieldSpellings([{
      owner: "demo:resolver-parity-invalid",
      expression: { match: [0, { $tag: "Just", vaule: { $bind: "v" } }, 1] },
    }]);

    setResolverInterpreted(false);
    try {
      expect(__engineHarnessResolverArtifactFreshForTests()).toBe(true);
      expect(tryValidateBodyFieldSpellings(valid, targets)).toEqual(
        withInterpretedResolver(() => tryValidateBodyFieldSpellings(valid, targets)),
      );
      expect(tryValidateBodyFieldSpellings(invalid, targets)).toEqual(
        withInterpretedResolver(() => tryValidateBodyFieldSpellings(invalid, targets)),
      );
    } finally {
      setResolverInterpreted(null);
    }
  }, 90_000);

  test("record payload misses stay positional until the Phase-5 classifier", () => {
    const occurrences = collectBodyFieldSpellings([{
      owner: "demo:positional-records",
      expression: {
        do: [
          { construct: ["Just", { botId: 1 }] },
          { call: ["demo:combine", { first: 1, payload: 2 }] },
          { call: ["demo:combine", { payload: 2 }] },
        ],
      },
    }]);
    expect(tryValidateBodyFieldSpellings(occurrences, targets)).toEqual({
      ok: true,
      value: occurrences,
    });
  }, 90_000);

  test("repository-sized batches remain stack-safe", () => {
    const base = collectBodyFieldSpellings([{
      owner: "demo:large-batch",
      expression: {
        match: [
          { var: "input" },
          { $tag: "Just", value: { $bind: "value" } },
          { var: "value" },
        ],
      },
    }])[0]!;
    const occurrences = Array.from({ length: 5_000 }, (_, index) => ({
      ...base,
      path: `body[${index}]`,
    }));
    expect(tryValidateBodyFieldSpellings(occurrences, targets)).toEqual({
      ok: true,
      value: occurrences,
    });
  }, 90_000);

  test("unknown and ambiguous targets are lenient and namespaces stay separate", () => {
    const occurrences = collectBodyFieldSpellings([{
      owner: "demo:lenient",
      expression: {
        do: [
          { construct: ["Unknown", { typo: 1 }] },
          { construct: ["Clash", { typo: 1 }] },
          { call: ["Just", { callOnly: 1 }] },
        ],
      },
    }]);
    const result = tryValidateBodyFieldSpellings(occurrences, [
      ...targets,
      { kind: "constructor", target: "Clash", candidates: ["left"] },
      { kind: "constructor", target: "Clash", candidates: ["right"] },
      { kind: "function", target: "Just", candidates: ["callOnly"] },
    ]);
    expect(result).toEqual({ ok: true, value: occurrences });
  }, 90_000);
});

describe("registry body-spelling integration", () => {
  test("the strict repository corpus completes one clean body-walk", () => {
    const registry = getSystemRegistry();
    // This public product registry is narrower than the migration generator's
    // 4,199-function fixture union; the assertion only needs a real corpus.
    expect(registry.listFunctions().length).toBeGreaterThan(800);
  }, 300_000);

  test("account bundle registration rejects an unambiguous stale pattern", () => {
    const fieldId = "9c6bf4be-0b50-4f48-8ba8-a69e25ca4bb4";
    const moduleFor = (spelling: string): FenelModule => ({
      name: `phase4b-account-${spelling}`,
      label: "Phase 4b account body walk",
      entities: [{
        id: "Phase4bAccountBox",
        type: {
          $variant: {
            cases: [{
              name: "Phase4bAccountBoxed",
              label: Nothing,
              fields: [{
                name: "payload",
                key: { $tag: "NamedField", ref: { $ref: fieldId } },
                type: { $ref: "String" },
                label: Nothing,
                ui: Nothing,
                meta: {},
              }],
            }],
          },
        },
      }],
      functions: [{
        id: `phase4b-account-${spelling}:probe`,
        params: [],
        returns: { $ref: "String" },
        body: {
          match: [
            { var: "box" },
            { $tag: "Phase4bAccountBoxed", [spelling]: { $bind: "value" } },
            { var: "value" },
          ],
        },
      }],
    });
    const options = {
      externalFields: [{ id: fieldId, currentCodeName: "payload" }],
      identityKinds: new Map([[fieldId, "field"]]),
    };

    expect(() => createAccountRegistry([], [moduleFor("payload")], options)).not.toThrow();
    expect(() => createAccountRegistry([], [moduleFor("oldPayload")], options)).toThrow(
      /UnresolvedFieldSpelling|unresolved constructor-pattern field spelling/,
    );
  }, 300_000);
});
