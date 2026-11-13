import { describe, it, expect } from "vitest";
import { defineFunction, collectFunctions, rekeyNativesById } from "./function-builder";
import { createRegistry } from "./registry";
import { createDispatchRegistry } from "./dispatch-registry";
import type { FenelModule } from "./types";
import { Nothing } from "./type-foundation";
describe("defineFunction", () => {
  it("returns a pure spec FenelFunction with no identity fields", () => {
    const { fn } = defineFunction(
      {
        id: "test:add",
        params: [
          { name: "a", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing },
          { name: "b", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing },
        ],
        returns: { $ref: "Number" },
        body: { "+": [{ var: "a" }, { var: "b" }] } as never,
      },
      { codeName: "add", label: "Add", description: "Adds two numbers", category: "math" },
    );
    expect(fn.id).toBe("test:add");
    expect(fn.params.length).toBe(2);
    expect(fn.returns).toEqual({ $ref: "Number" });
    // Identity fields must NOT leak onto the spec
    expect((fn as any).name).toBeUndefined();
    expect((fn as any).label).toBeUndefined();
    expect((fn as any).description).toBeUndefined();
    expect((fn as any).category).toBeUndefined();
  });

  it("emits a Codeable instance always (the dispatch key)", () => {
    const { instances } = defineFunction(
      { id: "test:foo", params: [], returns: { $ref: "Unit" } },
      { codeName: "foo" },
    );
    const codeable = instances.find((i) => i.typeName === "Codeable");
    expect(codeable).toBeDefined();
    expect(codeable!.args).toEqual(["test:foo"]);
    expect(codeable!.methods.codeName).toBe("foo");
  });

  it("emits Labelable / Describable / Categorizable / Iconable / Emojiable / Taggable / Aliasable as identity provides them", () => {
    const { instances } = defineFunction(
      { id: "test:full", params: [], returns: { $ref: "Unit" } },
      {
        codeName: "full",
        label: "Full",
        description: "All the metadata",
        category: "demo",
        icon: "star",
        emoji: "⭐",
        tags: ["pure", "demo"],
        aliases: { python: "full_fn", sql: "full_fn" },
      },
    );
    const classes = instances.map((i) => i.typeName).sort();
    expect(classes).toEqual([
      "Aliasable",
      "Categorizable",
      "Codeable",
      "Describable",
      "Emojiable",
      "Iconable",
      "Labelable",
      "Taggable",
    ]);
    const emojiable = instances.find((i) => i.typeName === "Emojiable");
    expect(emojiable!.args).toEqual(["test:full"]);
    expect(emojiable!.methods.emoji).toBe("⭐");
  });

  it("omits the corresponding instance when a field isn't provided", () => {
    const { instances } = defineFunction(
      { id: "test:bare", params: [], returns: { $ref: "Unit" } },
      { codeName: "bare" },
    );
    expect(instances.length).toBe(1); // only Codeable
    expect(instances[0]!.typeName).toBe("Codeable");
  });
});

describe("collectFunctions", () => {
  it("aggregates fns and instances across multiple definitions", () => {
    const a = defineFunction(
      { id: "test:a", params: [], returns: { $ref: "Unit" } },
      { codeName: "a", label: "A" },
    );
    const b = defineFunction(
      { id: "test:b", params: [], returns: { $ref: "Unit" } },
      { codeName: "b" },
    );
    const { fns, instances } = collectFunctions([a, b]);
    expect(fns.map((f) => f.id)).toEqual(["test:a", "test:b"]);
    // 2 Codeable instances + 1 Labelable instance
    expect(instances.length).toBe(3);
  });
});

describe("rekeyNativesById", () => {
  it("rewrites a name-keyed native map to id-keyed", () => {
    const natives = {
      add: (a: unknown, b: unknown) => Number(a) + Number(b),
      mul: (a: unknown, b: unknown) => Number(a) * Number(b),
    };
    const rekeyed = rekeyNativesById(natives, "test");
    expect(Object.keys(rekeyed).sort()).toEqual(["test:add", "test:mul"]);
    expect(rekeyed["test:add"]!(2, 3)).toBe(5);
    expect(rekeyed["test:mul"]!(2, 3)).toBe(6);
  });
});

describe("registry — id-based dispatch + codeName reverse lookup", () => {
  it("getFunction(id) and getFunction(codeName) both resolve to the same spec", () => {
    const a = defineFunction(
      { id: "test:greet", params: [], returns: { $ref: "Unit" } },
      { codeName: "greet", label: "Greet" },
    );
    const { fns, instances } = collectFunctions([a]);
    const mod: FenelModule = {
      name: "test",
      label: "Test",
      functions: fns,
      instances,
    };
    const reg = createRegistry([mod]);

    const byId = reg.getFunction("test:greet");
    const byCodeName = reg.getFunction("greet");
    expect(byId).toBeDefined();
    expect(byCodeName).toBeDefined();
    expect(byId).toBe(byCodeName);
  });

  it("getFunctionByCodeName resolves through the Codeable reverse-lookup map", () => {
    const a = defineFunction(
      { id: "x:hello", params: [], returns: { $ref: "Unit" } },
      { codeName: "hello" },
    );
    const { fns, instances } = collectFunctions([a]);
    const mod: FenelModule = { name: "x", label: "X", functions: fns, instances };
    const reg = createRegistry([mod]);

    const fn = reg.getFunctionByCodeName("hello");
    expect(fn?.id).toBe("x:hello");
  });

  it("evaluateContext.getFunction dispatches by codeName to the right spec", () => {
    const a = defineFunction(
      {
        id: "m:double",
        params: [{ name: "n", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing }],
        returns: { $ref: "Number" },
        body: { "*": [{ var: "n" }, 2] } as never,
      },
      { codeName: "double" },
    );
    const { fns, instances } = collectFunctions([a]);
    const mod: FenelModule = { name: "m", label: "M", functions: fns, instances };
    const reg = createRegistry([mod]);

    const ctx = reg.evaluateContext();
    const fn = ctx.getFunction?.("double");
    expect(fn?.id).toBe("m:double");
  });

  it("locale-aware codeName indexes every locale's value", () => {
    const a = defineFunction(
      { id: "lc:if", params: [], returns: { $ref: "Unit" } },
      { codeName: { en: "if", fr: "si", es: "si" } },
    );
    const { fns, instances } = collectFunctions([a]);
    const reg = createRegistry([{ name: "lc", label: "LC", functions: fns, instances }]);

    expect(reg.getFunctionByCodeName("if")?.id).toBe("lc:if");
    expect(reg.getFunctionByCodeName("si")?.id).toBe("lc:if");
  });

  it("listFunctions(category) filters via the Categorizable instances", () => {
    const a = defineFunction(
      { id: "t:add", params: [], returns: { $ref: "Unit" } },
      { codeName: "add", category: "math" },
    );
    const b = defineFunction(
      { id: "t:concat", params: [], returns: { $ref: "Unit" } },
      { codeName: "concat", category: "string" },
    );
    const { fns, instances } = collectFunctions([a, b]);
    const reg = createRegistry([{ name: "t", label: "T", functions: fns, instances }]);

    const math = reg.listFunctions("math");
    expect(math.length).toBe(1);
    expect(math[0]!.id).toBe("t:add");
  });

  it("functionOptions surfaces label / category from typeclass instances", () => {
    const a = defineFunction(
      { id: "o:add", params: [], returns: { $ref: "Unit" } },
      { codeName: "add", label: "Addition", category: "math" },
    );
    const { fns, instances } = collectFunctions([a]);
    const reg = createRegistry([{ name: "o", label: "O", functions: fns, instances }]);

    const opts = reg.functionOptions();
    expect(opts.length).toBe(1);
    expect(opts[0]!.value).toBe("add");
    expect(opts[0]!.label).toBe("Addition");
    expect(opts[0]!.category).toBe("math");
  });
});

describe("registry — live dispatchRegistry rows added after construction (rights R3a; code-name scan deleted 2026-09-25)", () => {
  // ⚠ rights R3a §6 pin 12 — THIS IS THE WITHDRAWAL, AS A NEGATIVE (brief §8.1c,
  // §12 trap 12).
  //
  // This test used to assert the opposite: a `Codeable` row added after
  // construction under `scope: "account"` resolved through
  // `getFunctionByCodeName`. Raw, that scan resolved account B's alias for EVERY
  // account — a call head is a call head and carries no frame. Fencing the scan
  // to repository rows closes the leak; the FEATURE goes with it, because there
  // is no account frame at a call head and threading one is R4-sized.
  //
  // The product statement is: ACCOUNT-AUTHORED CODE-NAME ALIASES ARE DISPLAY-
  // ONLY. Restoration would be R3a-tail's registry-identity filter (per-account
  // registries only, so inconsistent across accounts) or R4's frame-aware name
  // resolution. This is a DECLARED withdrawal, not a rule that was always true.
  //
  // Neuter: bring back a live scan of the shared dispatch registry (raw or
  // repository-only). RED: an alias resolves.
  it("pin 12 — an account-owned Codeable alias does NOT resolve by name, for anyone", () => {
    const a = defineFunction(
      { id: "live:base", params: [], returns: { $ref: "Unit" } },
      { codeName: "base" },
    );
    const { fns, instances } = collectFunctions([a]);
    const tcReg = createDispatchRegistry();
    for (const inst of instances) tcReg.addInstance(inst);

    const reg = createRegistry(
      [{ name: "live", label: "Live", functions: fns, instances }],
      { dispatchRegistry: tcReg },
    );

    // Built-in lookup still works.
    expect(reg.getFunctionByCodeName("base")?.id).toBe("live:base");

    // An ACCOUNT-OWNED alternate codeName added after construction. ⚠ The alias
    // is FRESH (`alias_base`, not `add`): a name already in `codeNameToIdMap`
    // never reaches the live scan at all, so a test using one would be green for
    // the wrong reason (§12 trap 12).
    tcReg.addInstance({
      typeName: "Codeable",
      args: ["live:base"],
      methods: { codeName: "alias_base" },
      scope: { kind: "account", accountId: "r3a-codeable-owner" },
    });

    expect(reg.getFunctionByCodeName("alias_base")).toBeUndefined();

    // The live scan is DELETED (Rom, 2026-09-19: code-name aliases are retired;
    // `f = g` is a personal name and an import is a scoped rename). So a
    // REPOSITORY-owned alias added after construction resolves nothing either:
    // this used to be the scan's positive control, and it is now the proof that
    // no scan is left to reach.
    tcReg.addInstance({
      typeName: "Codeable",
      args: ["live:base"],
      methods: { codeName: "repo_alias_base" },
      scope: { kind: "global" },
    });
    expect(reg.getFunctionByCodeName("repo_alias_base")).toBeUndefined();
    expect(reg.getFunction("repo_alias_base")).toBeUndefined();

    // POSITIVE CONTROL — the construction-time map lookup is untouched.
    expect(reg.getFunctionByCodeName("base")?.id).toBe("live:base");
  });

  it("labelFor picks up a Labelable override added after construction", () => {
    const a = defineFunction(
      { id: "live:greet", params: [], returns: { $ref: "Unit" } },
      { codeName: "greet", label: "Greet" },
    );
    const { fns, instances } = collectFunctions([a]);
    const tcReg = createDispatchRegistry();
    for (const inst of instances) tcReg.addInstance(inst);

    const reg = createRegistry(
      [{ name: "live", label: "Live", functions: fns, instances }],
      { dispatchRegistry: tcReg },
    );

    // Construction-time label wins because it's cached.
    expect(reg.functionOptions()[0]!.label).toBe("Greet");

    // For a *new* function id with no module-time Labelable, the live
    // registry is the only source.
    const liveId = "live:greet2";
    tcReg.addInstance({
      typeName: "Codeable",
      args: [liveId],
      methods: { codeName: "greet2" },
      scope: { kind: "account", accountId: "r3a-label-owner" },
    });
    tcReg.addInstance({
      typeName: "Labelable",
      args: [liveId],
      methods: { label: "Greet v2" },
      // rights R3a — the retired bare `"account"` bucket becomes the ownership
      // coordinate. It is withdrawn from DISPLAY either way (§8.1b); this
      // assertion is about the codeName BOUNDARY, which is unchanged.
      scope: { kind: "account", accountId: "r3a-label-owner" },
    });
    // Function spec itself isn't in the module — but codeName lookup still
    // resolves through Codeable, returning undefined since no FenelFunction
    // was added. This documents the boundary: per-account Codeable adds
    // dispatch routes for *existing* function ids.
    expect(reg.getFunctionByCodeName("greet2")).toBeUndefined();
  });

  // ⚠ rights R3a — THE DISPLAY WITHDRAWAL, AS A NEGATIVE (brief §8.1b).
  //
  // This test used to assert that an ACCOUNT-owned `Categorizable` row drove
  // `listFunctions(category)`. It did — for every account, because
  // `categoryFor` resolved unfiltered. Fencing the display closures to
  // repository rows closes that leak and WITHDRAWS the feature: account-authored
  // categories, labels and code names stop displaying until R3a-tail's
  // registry-identity filter (per-account registries) or R4's decider authority
  // restores them. On the dev tunnel the consequence is that the dashboard shows
  // repository labels only.
  it("pin 12b(display) — an account-owned Categorizable does NOT drive listFunctions, for anyone", () => {
    const a = defineFunction(
      { id: "live:add", params: [], returns: { $ref: "Number" } },
      { codeName: "add" },
    );
    const { fns, instances } = collectFunctions([a]);
    const tcReg = createDispatchRegistry();
    for (const inst of instances) tcReg.addInstance(inst);

    const reg = createRegistry(
      [{ name: "live", label: "Live", functions: fns, instances }],
      { dispatchRegistry: tcReg },
    );

    // No category at construction → not in any category bucket.
    expect(reg.listFunctions("math").length).toBe(0);

    // An ACCOUNT-OWNED Categorizable instance — withdrawn.
    tcReg.addInstance({
      typeName: "Categorizable",
      args: ["live:add"],
      methods: { category: "math" },
      scope: { kind: "account", accountId: "r3a-category-owner" },
    });
    expect(reg.listFunctions("math").length).toBe(0);

    // POSITIVE CONTROL — the live fallback itself still works: a REPOSITORY
    // `Categorizable` added after construction DOES drive the bucket, so what
    // changed is the ownership fence and not the fallback.
    tcReg.addInstance({
      typeName: "Categorizable",
      args: ["live:add"],
      methods: { category: "science" },
      scope: { kind: "global" },
    });
    expect(reg.listFunctions("science").length).toBe(1);
    expect(reg.listFunctions("science")[0]!.id).toBe("live:add");
  });
});
