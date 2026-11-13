// modules-as-values Phase 2d, review fix R-C.1 — `Just <reference>` under a
// `Maybe (arrow)` field is lowered on the SHARED registration path.
//
// The loader gives `backward = Just back` the same JSON as the record literal
// `Just { var = "back" }`: `{$tag:"Just", var:"back"}`. The dispatch registry's
// `addInstance` (every row, whatever registers it) lowers it by the class's
// declared field type to `{$tag:"Just", _0:{$ref:"back"}}`, and a source
// module's registry binds that reference in the DECLARING module's scope, as it
// binds a top-level reference. Before the fix only the migration seam lowered
// it, and the source-module binder turned the whole Just into a bare reference.
//
// Pinned here, without calling the lowering by hand:
//   (A) source-module Migration instances with `backward = Just back` (a
//       module-local name another module also declares), `Just Other.x` (an
//       import alias only the declaring module has) and `Just AcctMigOther.x`
//       load, register with a Just-wrapped reference, and run their backward
//       direction (applied, and through the migration reader `roundtripCheck`);
//   (B) an ordinary record with a field named `var` under a non-arrow field
//       stays exactly as loaded, in a source module and in a plain registry;
//   (C) the account path (`applyAccountSpecInstances`) and a row registered
//       before its class get the same lowering.
import { beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import { createDispatchRegistry } from "./dispatch-registry";
import { applyAccountSpecInstances } from "./account-registries";
import { evaluate, type EvaluateContext } from "./json-logic";
import { loadFenelModule } from "./fenel-module";
import { migration as migrationSeed } from "./migration";
import { roundtripCheckNative } from "./modules/migration";
import { prepareSourceModule, sourceModuleRegistry } from "./authoring/source-module";
import type { ModuleRegistry } from "./registry";
import type { DispatchRegistry } from "./dispatch-registry";
import type { Instance, Interface } from "./types";

const LONG = 600_000;

// `back` is declared in BOTH modules: only the declaring module's scope makes
// `Just back` the inverse (a registry-global `back` is ambiguous), and the
// alias `Other` exists only in AcctMigLocal's scope. `AcctMigOther.back` is
// the identity on numbers.
const OTHER = String.raw`module AcctMigOther where

back : Number -> Number
back v = v

narrowBack : ProfileDemoV2 -> Result MigrationError ProfileDemoV1
narrowBack v = Ok ({ firstName = v.firstName, lastName = v.lastName })
`;

const LOCAL = String.raw`module AcctMigLocal where
import AcctMigOther as Other

fwd : ProfileDemoV1 -> Result MigrationError ProfileDemoV2
fwd v = Ok ({ firstName = v.firstName, lastName = v.lastName, email = "" })

back : ProfileDemoV2 -> Result MigrationError ProfileDemoV1
back v = Ok ({ firstName = v.firstName, lastName = v.lastName })

localBack : Migration ProfileDemoV1 ProfileDemoV2
localBack = Migration {
  forward = fwd,
  backward = Just back,
  losslessness = Lossless,
  roundtripSamples = [{ firstName = "Ada", lastName = "Lovelace" }],
  label = "acct local"
}

aliasBack : Migration ProfileDemoV1 ProfileDemoV2
aliasBack = Migration {
  forward = fwd,
  backward = Just Other.narrowBack,
  losslessness = Lossless,
  roundtripSamples = [{ firstName = "Grace", lastName = "Hopper" }],
  label = "acct alias"
}

moduleBack : Migration ProfileDemoV1 ProfileDemoV2
moduleBack = Migration {
  forward = fwd,
  backward = Just AcctMigOther.narrowBack,
  losslessness = Lossless,
  roundtripSamples = [{ firstName = "Edge", lastName = "Case" }],
  label = "acct qualified"
}

Note = Note var: String
Tagged a = Tagged note: Maybe Note
taggedNumber : Tagged Number
taggedNumber = Tagged { note = Just { var = "hello" } }
`;

let registry: ModuleRegistry;
let ctx: EvaluateContext;
let spec: DispatchRegistry;

beforeAll(() => {
  registry = sourceModuleRegistry([
    prepareSourceModule(OTHER, "AcctMigOther", undefined, randomUUID),
    prepareSourceModule(LOCAL, "AcctMigLocal", undefined, randomUUID),
  ]);
  ctx = registry.evaluateContext();
  spec = ctx._specRegistry as DispatchRegistry;
}, LONG);

const byLabel = (label: string): Instance => {
  const rows = spec.listInstances("Migration").filter((row) => row.label === label);
  expect(rows).toHaveLength(1);
  return rows[0]!;
};
const methodsOf = (inst: Instance) => inst.methods as Record<string, unknown>;
const apply = (f: unknown, x: unknown, context: EvaluateContext = ctx) =>
  evaluate({ call: [{ var: "f" }, { var: "x" }] }, { f, x }, context);

const v1 = { firstName: "Ada", lastName: "Lovelace" };
const v2 = { ...v1, email: "" };

describe("(A) a source-module instance's `backward = Just <reference>`", () => {
  const runsBackward = (label: string, bound: string) => {
    const m = methodsOf(byLabel(label));
    const backward = m.backward as Record<string, unknown>;
    // Just is kept; its payload is a reference bound in the declaring module.
    expect(Object.keys(backward).sort()).toEqual(["$tag", "_0"]);
    expect(backward.$tag).toBe("Just");
    expect(backward._0).toEqual({ $ref: bound });
    expect(apply(backward._0, v2)).toEqual({ $tag: "Ok", _0: v1 });
    // The migration reader runs forward then backward over the samples.
    expect(roundtripCheckNative(ctx, m.forward, m.backward, m.losslessness, m.roundtripSamples))
      .toEqual({ $tag: "Just", _0: true });
  };

  test("a module-local name (`back`, which another module also declares)", () => {
    runsBackward("acct local", "AcctMigLocal:back");
  }, LONG);

  test("an alias-qualified name (`Other.narrowBack`, visible only in the declaring module)", () => {
    runsBackward("acct alias", "AcctMigOther:narrowBack");
  }, LONG);

  test("a module-qualified name (`AcctMigOther.narrowBack`)", () => {
    const m = methodsOf(byLabel("acct qualified"));
    // Registry-global qualified names need no scope; the binder keeps it.
    expect(m.backward).toEqual({ $tag: "Just", _0: { $ref: "AcctMigOther.narrowBack" } });
    expect(apply((m.backward as { _0: unknown })._0, v2)).toEqual({ $tag: "Ok", _0: v1 });
    expect(roundtripCheckNative(ctx, m.forward, m.backward, m.losslessness, m.roundtripSamples))
      .toEqual({ $tag: "Just", _0: true });
  }, LONG);
});

describe("(B) an ordinary record with a field named `var` is untouched", () => {
  test("in a source module, under a `Maybe Note` field", () => {
    const rows = spec.listInstances("Tagged");
    expect(rows).toHaveLength(1);
    expect(methodsOf(rows[0]!).note).toEqual({ $tag: "Just", var: "hello" });
  }, LONG);

  test("in a plain registry, under a record field and a `Maybe` of a record", () => {
    const reg = createDispatchRegistry();
    const noteType = { $ref: "Note" };
    reg.defineClass({
      name: "Boxed",
      params: [{ name: "a" }],
      methods: [
        { name: "item", params: [], returns: noteType },
        {
          name: "maybeItem",
          params: [],
          returns: {
            $variant: {
              cases: [
                { name: "Nothing", fields: [] },
                { name: "Just", fields: [{ name: "_0", key: { $tag: "PositionalField", index: 0 }, type: noteType, label: { $tag: "Nothing" } }] },
              ],
            },
          } as never,
        },
      ],
    } as Interface);
    const inst: Instance = {
      typeName: "Boxed",
      args: ["Number"],
      methods: { item: { var: "hello" }, maybeItem: { $tag: "Just", var: "hello" } },
    };
    reg.addInstance(inst);
    expect(reg.listInstances("Boxed")[0]).toBe(inst);
  });
});

describe("(C) every registration path lowers by the declared type", () => {
  // The loader's own output for the demo instance, before any lowering.
  const loaderShaped = (): Instance => {
    const loaded = loadFenelModule(String.raw`module loweringProbe where
probe : Migration ProfileDemoV1 ProfileDemoV2
probe = Migration {
  forward = AcctMigLocal.fwd,
  backward = Just AcctMigLocal.back,
  losslessness = Lossless,
  roundtripSamples = []
}
`, "loweringProbe", { dispatchInstanceFile: true });
    const inst = loaded.instances?.find((i) => i.typeName === "Migration");
    expect(inst).toBeDefined();
    // An uppercase qualifier in argument position is a nullary construct.
    expect(methodsOf(inst!).backward).toEqual({ $tag: "Just", _0: { $tag: "AcctMigLocal.back" } });
    return inst!;
  };
  const lowered = { $tag: "Just", _0: { $ref: "AcctMigLocal.back" } };

  test("an account-owned row", () => {
    const reg = createDispatchRegistry();
    reg.defineClass(migrationSeed);
    applyAccountSpecInstances(reg, "acct-nested-refs", [loaderShaped()]);
    const [row] = reg.listInstances("Migration");
    expect(methodsOf(row!).backward).toEqual(lowered);
    expect(row!.scope).toEqual({ kind: "account", accountId: "acct-nested-refs" });
    const m = methodsOf(row!);
    expect(apply((m.backward as { _0: unknown })._0, v2)).toEqual({ $tag: "Ok", _0: v1 });
    expect(roundtripCheckNative(ctx, { $ref: "AcctMigLocal:fwd" }, m.backward, { $tag: "Lossless" }, [v1]))
      .toEqual({ $tag: "Just", _0: true });
  });

  test("a row registered before its class", () => {
    const reg = createDispatchRegistry();
    const inst = loaderShaped();
    reg.addInstance(inst);
    // modules-as-values Phase 5a — dispatch ingress registers the loaded
    // instance without its `declaration` carrier: a carrier-free copy that
    // shares the very `methods` object, so the registered row is still the
    // lowered instance.
    const registered = reg.listInstances("Migration")[0];
    expect(registered).toEqual(inst);
    expect(registered!.methods).toBe(inst.methods);
    const before = reg.version();
    reg.defineClass(migrationSeed);
    expect(methodsOf(reg.listInstances("Migration")[0]!).backward).toEqual(lowered);
    expect(reg.version()).toBeGreaterThan(before);
    // Redefining the class keeps the lowered row as it is.
    const row = reg.listInstances("Migration")[0];
    reg.defineClass(migrationSeed);
    expect(reg.listInstances("Migration")[0]).toBe(row);
  });
});
