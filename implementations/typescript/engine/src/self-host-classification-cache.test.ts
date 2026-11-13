import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

import {
  buildSelfHostCandidateIndex,
  classifyFnIdsOnce,
  classifyFnIdsOnceAsync,
  memoizeAsyncFnIdClassification,
  memoizeFnIdClassification,
  projectSelfHostCandidateModule,
  projectSelfHostRosterModule,
  uniqueFnIdDefinitions,
} from "./self-host-classification-cache";
import { decidableMembershipModule } from "./modules/decidable-membership";

describe("self-host classification exactly-once boundary", () => {
  it("deduplicates a batch and process-local repeated observations", () => {
    const calls = new Map<string, number>();
    const progress: string[] = [];
    const classify = memoizeFnIdClassification((fnId: string) => {
      calls.set(fnId, (calls.get(fnId) ?? 0) + 1);
      return fnId === "demo:bad"
        ? { status: "FAIL" as const, reason: "observed mismatch" }
        : { status: "OK" as const, samplesCompared: 1 };
    });
    const rows = classifyFnIdsOnce(
      ["demo:ok", "demo:bad", "demo:ok", "demo:bad"],
      classify,
      { onProgress: (event) => progress.push(`${event.phase}:${event.fnId}`) },
    );

    expect(rows.size).toBe(2);
    expect(rows.get("demo:bad")).toEqual({
      status: "FAIL",
      reason: "observed mismatch",
    });
    expect(classify("demo:bad")).toBe(rows.get("demo:bad")!);
    expect([...calls]).toEqual([["demo:ok", 1], ["demo:bad", 1]]);
    expect(progress).toEqual([
      "start:demo:ok",
      "complete:demo:ok",
      "start:demo:bad",
      "complete:demo:bad",
    ]);
  });

  it("coalesces in-flight async observations without parallelising a batch", async () => {
    let calls = 0;
    const progress: string[] = [];
    const classify = memoizeAsyncFnIdClassification(async (fnId: string) => {
      calls += 1;
      await Promise.resolve();
      return { fnId, observation: calls };
    });

    const [a, b] = await Promise.all([classify("demo:one"), classify("demo:one")]);
    expect(a).toBe(b);
    const rows = await classifyFnIdsOnceAsync(
      ["demo:one", "demo:two", "demo:two"],
      classify,
      { onProgress: (event) => progress.push(`${event.phase}:${event.fnId}`) },
    );
    expect(rows.size).toBe(2);
    expect(calls).toBe(2);
    expect(progress).toEqual([
      "start:demo:one",
      "complete:demo:one",
      "start:demo:two",
      "complete:demo:two",
    ]);
  });

  it("collapses exact own-data definitions and rejects semantic drift", () => {
    const one = { id: "demo:one", body: 1 };
    expect(uniqueFnIdDefinitions([one, { ...one }])).toEqual([one]);
    expect(() => uniqueFnIdDefinitions([one, { ...one, body: 2 }]))
      .toThrow("conflicting definitions for demo:one");
  });

  it("isolates null-prototype, hostile-key, non-enumerable, and cyclic candidate data", () => {
    const body = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(body, "__proto__", {
      value: { literal: "own-hostile-data" },
      enumerable: true,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(body, "hidden", {
      value: { semantic: 1 },
      enumerable: false,
      configurable: true,
      writable: true,
    });
    const source: {
      id: string;
      body: Record<string, unknown>;
      self?: unknown;
    } = { id: "demo:cyclic", body };
    source.self = source;

    const [selected] = uniqueFnIdDefinitions([source]);
    expect(selected).not.toBe(source);
    expect(selected!.body).not.toBe(body);
    expect(selected!.self).toBe(selected);
    expect(Object.getPrototypeOf(selected!.body)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(selected!.body, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(selected!.body, "hidden")?.enumerable).toBe(false);
    expect(Object.isFrozen(selected)).toBe(true);
    expect(Object.isFrozen(selected!.body)).toBe(true);

    (body.hidden as { semantic: number }).semantic = 2;
    expect((selected!.body.hidden as { semantic: number }).semantic).toBe(1);
    (body.hidden as { semantic: number }).semantic = 1;

    const sameBody = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(sameBody, "__proto__", {
      value: { literal: "own-hostile-data" },
      enumerable: true,
    });
    Object.defineProperty(sameBody, "hidden", {
      value: { semantic: 1 },
      enumerable: false,
      configurable: true,
    });
    const same = { id: "demo:cyclic", body: sameBody } as {
      id: string;
      body: Record<string, unknown>;
      self?: unknown;
    };
    same.self = same;
    expect(uniqueFnIdDefinitions([source, same])).toHaveLength(1);

    Object.defineProperty(sameBody, "hidden", {
      value: { semantic: 3 },
      enumerable: false,
    });
    expect(() => uniqueFnIdDefinitions([source, same]))
      .toThrow("conflicting definitions for demo:cyclic");
  });

  it("rejects accessor-bearing candidate/module data without invoking it", () => {
    let definitionReads = 0;
    const definition = { id: "demo:accessor" } as { id: string; body?: unknown };
    Object.defineProperty(definition, "body", {
      enumerable: true,
      get() {
        definitionReads += 1;
        return { literal: definitionReads };
      },
    });
    expect(() => uniqueFnIdDefinitions([definition])).toThrow("cannot be isolated");
    expect(definitionReads).toBe(0);

    let moduleReads = 0;
    const candidateModule = Object.defineProperty({ name: "demo" }, "functions", {
      enumerable: true,
      get() {
        moduleReads += 1;
        return [definition];
      },
    }) as unknown as { name: string; functions: readonly typeof definition[] };
    expect(() => buildSelfHostCandidateIndex([candidateModule]))
      .toThrow("candidate module[0] cannot be isolated");
    expect(moduleReads).toBe(0);
  });

  it("projects exact set authority without invoking accessors or re-reading proxies", () => {
    const projected = projectSelfHostCandidateModule(decidableMembershipModule);
    const setCandidate = projected.functions?.find((fn) => fn.id.startsWith("set:"));
    expect(setCandidate).toBeDefined();
    // modules-as-values (2026-09-24): the container is named `set` like its
    // function namespace, so it declares no separate `functionNamespace`.
    expect(projected.name).toBe("set");
    expect(Object.getOwnPropertyDescriptor(projected, "functionNamespace")).toBeUndefined();

    const selected = buildSelfHostCandidateIndex([projected]);
    expect(selected.byFnId.get(setCandidate!.id)?.moduleName).toBe("set");
    expect(selected.byFnId.get(setCandidate!.id)?.functionNamespace).toBe("set");

    // A container named apart from the namespace must declare it: the retired
    // container spelling, without the policy it used to carry, owns no `set:` id.
    const stripped = { name: "decidable-membership", functions: [setCandidate!] };
    expect(() => buildSelfHostCandidateIndex([stripped]))
      .toThrow("expected namespace decidable-membership:<non-empty local name>");
    expect(() => buildSelfHostCandidateIndex([{
      name: projected.name,
      functionNamespace: "forged",
      functions: [setCandidate!],
    }])).toThrow("expected namespace forged:<non-empty local name>");

    const overrideProjection = projectSelfHostCandidateModule({
      name: "display",
      functionNamespaceOverrides: [
        { functionId: "set:bodied", namespace: "set" },
        { functionId: "legacy:bodyless", namespace: "legacy" },
      ],
      functions: [
        { id: "set:bodied", body: { literal: true } },
        { id: "legacy:bodyless" },
      ],
    });
    expect(overrideProjection.functionNamespaceOverrides).toEqual([
      { functionId: "set:bodied", namespace: "set" },
    ]);
    expect(buildSelfHostCandidateIndex([overrideProjection]).byFnId.get("set:bodied")?.functionNamespace)
      .toBe("set");

    const rosterProjection = projectSelfHostRosterModule({
      name: "display",
      functionNamespaceOverrides: [
        { functionId: "set:bodied", namespace: "set" },
        { functionId: "legacy:bodyless", namespace: "legacy" },
      ],
      functions: [
        { id: "set:bodied", body: { literal: true } },
        { id: "legacy:bodyless" },
      ],
    });
    expect(rosterProjection.functions?.map((fn) => fn.id)).toEqual([
      "set:bodied",
      "legacy:bodyless",
    ]);
    expect(rosterProjection.functionNamespaceOverrides).toEqual([
      { functionId: "set:bodied", namespace: "set" },
      { functionId: "legacy:bodyless", namespace: "legacy" },
    ]);
    const rosterIndex = buildSelfHostCandidateIndex([rosterProjection]);
    expect(rosterIndex.byFnId.get("legacy:bodyless")?.functionNamespace).toBe("legacy");

    let bodyReads = 0;
    // A container whose name is not its namespace (the `compileJs` shape).
    const accessorDefinition = Object.defineProperty({ id: "compile-js:accessor" }, "body", {
      enumerable: true,
      get() {
        bodyReads += 1;
        return { literal: true };
      },
    });
    expect(() => projectSelfHostCandidateModule({
      name: "compileJs",
      functionNamespace: "compile-js",
      functions: [accessorDefinition],
    })).toThrow("cannot be isolated");
    expect(bodyReads).toBe(0);

    let namespaceDescriptorReads = 0;
    const target = {
      name: "compileJs",
      functionNamespace: "compile-js",
      functions: [{ id: "compile-js:emitJs", body: { literal: true } }],
    };
    const timeVarying = new Proxy(target, {
      getOwnPropertyDescriptor(object, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
        if (descriptor === undefined || key !== "functionNamespace") return descriptor;
        namespaceDescriptorReads += 1;
        return {
          ...descriptor,
          value: namespaceDescriptorReads === 1 ? "compile-js" : "forged",
        };
      },
    });
    const proxySelected = buildSelfHostCandidateIndex([timeVarying]);
    expect(proxySelected.byFnId.get("compile-js:emitJs")?.functionNamespace).toBe("compile-js");
    expect(namespaceDescriptorReads).toBe(1);
  });

  it("routes all three classifiers through the shared candidate projection", () => {
    for (const target of ["js", "wasm", "llvm"]) {
      const source = readFileSync(
        new URL(`./compile-${target}-self-host-classifier.ts`, import.meta.url),
        "utf8",
      );
      expect(source, `${target} candidate projection`)
        .toContain("candidateModules.map(projectSelfHostCandidateModule)");
    }
  });

  it("gives JS, Wasm, and LLVM one fail-closed module+id ownership rule", () => {
    const one = { id: "shared:one", body: { value: 1 } };
    const sameOwner = buildSelfHostCandidateIndex([
      { name: "shared", functions: [one, { ...one }] },
    ]);
    expect(sameOwner.definitions).toEqual([one]);
    expect(sameOwner.definitions[0]).not.toBe(one);
    expect(Object.isFrozen(sameOwner.definitions[0])).toBe(true);
    one.body.value = 2;
    expect(sameOwner.definitions[0]?.body.value).toBe(1);
    expect(sameOwner.byFnId.get(one.id)).toEqual({
      moduleName: "shared",
      functionNamespace: "shared",
      fnId: one.id,
      definition: { id: "shared:one", body: { value: 1 } },
    });

    // An exact payload does not erase defining-module provenance. All target
    // classifiers call this shared projection before constructing their exact
    // fnId lookup, so none can accept even a lone wrong-owner definition.
    for (const target of ["JS", "Wasm", "LLVM"]) {
      expect(
        () => buildSelfHostCandidateIndex([
          { name: "left", functions: [{ id: "shared:one", body: { value: 1 } }] },
        ]),
        `${target} candidate ownership`,
      ).toThrow(
        "self-host classification: function shared:one is not owned by defining module left",
      );
    }
  });

  it("shares the exact compiler namespace policy for display and folded modules", () => {
    const selected = buildSelfHostCandidateIndex([
      {
        name: "compileJs",
        functionNamespace: "compile-js",
        functions: [{ id: "compile-js:emitJs", body: 1 }],
      },
      {
        name: "auth",
        functionNamespaceOverrides: [
          { functionId: "subject:accountId", namespace: "subject" },
          { functionId: "subject:actorId", namespace: "subject" },
        ],
        functions: [
          { id: "auth:issueSession", body: 2 },
          { id: "subject:accountId", body: 3 },
          { id: "subject:actorId", body: 4 },
        ],
      },
    ]);
    expect(selected.byFnId.get("compile-js:emitJs")?.functionNamespace).toBe("compile-js");
    expect(selected.byFnId.get("compile-js:emitJs")?.moduleName)
      .toBe("compileJs");
    expect(selected.byFnId.get("auth:issueSession")?.functionNamespace).toBe("auth");
    expect(selected.byFnId.get("subject:accountId")?.functionNamespace).toBe("subject");
    expect(selected.byFnId.get("subject:actorId")?.functionNamespace).toBe("subject");

    expect(() => buildSelfHostCandidateIndex([{
      name: "compileJs",
      functionNamespace: "forged",
      functions: [{ id: "compile-js:emitJs", body: 1 }],
    }])).toThrow(
      "self-host classification: function compile-js:emitJs is not owned by defining module compileJs",
    );
  });

  it("preserves valid hostile local names while rejecting bare and empty-local ids", () => {
    const hostileIds = [
      "shared:__proto__",
      "shared:constructor",
      "shared:toString",
      "shared:local:with:colons",
    ];
    const selected = buildSelfHostCandidateIndex([{
      name: "shared",
      functions: hostileIds.map((id) => ({ id, body: 1 })),
    }]);
    expect([...selected.byFnId.keys()]).toEqual(hostileIds);
    for (const id of hostileIds) expect(selected.byFnId.get(id)?.fnId).toBe(id);

    for (const id of ["shared", "shared:", "other:one"]) {
      expect(() => buildSelfHostCandidateIndex([{
        name: "shared",
        functions: [{ id, body: 1 }],
      }]), id).toThrow("is not owned by defining module shared");
    }
  });
});
