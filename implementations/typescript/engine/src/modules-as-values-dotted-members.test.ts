// ---------------------------------------------------------------------------
// modules-as-values Phase 1 — dotted members are values.
//
// design/module-system.md §3: a module is an ordinary value, and reaching a
// member is projection. `telegram.run_collector` used as a VALUE resolves to
// the target the call `telegram.run_collector x` reaches, as the typed
// reference every function value is. A local binding named like a module
// shadows it entirely. A bare name used as a value consults the import frame,
// as a call head does.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { loadFenelModule } from "./fenel-module";
import { createRegistry } from "./registry";
import { evaluate, withImports } from "./json-logic";
import { parse } from "./fenel-parser";
import type { FenelModule } from "./types";

// A lowercase module name, like every module in the corpus (`module telegram where`).
const telegramSrc = `module telegram where
run_collector a = a
stop_collector a = "stopped"
`;

const reg = createRegistry([loadFenelModule(telegramSrc, "x")]);
const ctx = reg.evaluateContext();

describe("a dotted member used as a value", () => {
  test("parses as a variable read, not a call", () => {
    expect(parse("telegram.run_collector")).toEqual({ var: "telegram.run_collector" });
  });

  test("resolves to the member's typed reference", () => {
    expect(evaluate(parse("telegram.run_collector"), {}, ctx)).toEqual({ $ref: "telegram:run_collector" });
  });

  test("names the target the applied call reaches", () => {
    const ref = evaluate(parse("telegram.stop_collector"), {}, ctx);
    expect(evaluate({ call: [ref, 1] }, {}, ctx)).toBe("stopped");
    expect(evaluate(parse("telegram.stop_collector 1"), {}, ctx)).toBe("stopped");
  });

  test("is callable through a local binding", () => {
    // The loader rewrites a local application head to `{var}` (FM-retire-11),
    // so a body's `g 5` with `g` local arrives in this form.
    const ref = evaluate(parse("telegram.run_collector"), {}, ctx);
    expect(evaluate({ call: [{ var: "g" }, 5] }, { g: ref }, ctx)).toBe(5);
  });
});

describe("a local binding named like a module shadows the module", () => {
  test("a bound head reads its own field", () => {
    expect(evaluate(parse("telegram.run_collector"), { telegram: { run_collector: 42 } }, ctx)).toBe(42);
  });

  test("a bound head without that field is a miss, never the module member", () => {
    expect(evaluate(parse("telegram.run_collector"), { telegram: { other: 1 } }, ctx)).toBeNull();
    expect(evaluate({ var: ["telegram.run_collector", 9] }, { telegram: {} }, ctx)).toBe(9);
  });

  test("a bound head holding null is a miss", () => {
    expect(evaluate(parse("telegram.run_collector"), { telegram: null }, ctx)).toBeNull();
  });
});

describe("misses stay misses", () => {
  test("an unknown member", () => {
    expect(evaluate(parse("telegram.ghost"), {}, ctx)).toBeNull();
  });

  test("an explicit default still answers the miss", () => {
    expect(evaluate({ var: ["telegram.ghost", 9] }, {}, ctx)).toBe(9);
  });

  test("a head that names no module", () => {
    expect(evaluate(parse("nosuch.run_collector"), {}, ctx)).toBeNull();
  });

  test("three segments are not a member path", () => {
    expect(evaluate(parse("telegram.run_collector.x"), {}, ctx)).toBeNull();
  });

  test("a context without a registry finds nothing", () => {
    expect(evaluate(parse("telegram.run_collector"), {})).toBeNull();
  });
});

describe("an `as` alias names the module", () => {
  const frame = reg.buildImportFrame([{ module: "telegram", as: "tg" }]);

  test("`tg.run_collector` under the alias frame is the member", () => {
    expect(withImports(ctx, frame, (c) => evaluate(parse("tg.run_collector"), {}, c))).toEqual({
      $ref: "telegram:run_collector",
    });
  });

  test("without the frame, `tg` names nothing", () => {
    expect(evaluate(parse("tg.run_collector"), {}, ctx)).toBeNull();
  });
});

describe("a bare name used as a value consults the import frame", () => {
  const fooSrc = `module Foo where
helper x = "foo"
other x = "foo-other"
`;
  const barSrc = `module Bar where
helper x = "bar"
`;
  const reg2 = createRegistry([loadFenelModule(fooSrc, "x"), loadFenelModule(barSrc, "x")]);
  const ctx2 = reg2.evaluateContext();

  test("the imported binding wins, as it does for the call head", () => {
    const frame = reg2.buildImportFrame([{ module: "Bar", names: ["helper"] }]);
    expect(withImports(ctx2, frame, (c) => evaluate(parse("helper"), {}, c))).toEqual({ $ref: "Bar:helper" });
    expect(withImports(ctx2, frame, (c) => evaluate(parse("helper 0"), {}, c))).toBe("bar");
  });

  test("a local binding still wins over the import frame", () => {
    const frame = reg2.buildImportFrame([{ module: "Bar", names: ["helper"] }]);
    expect(withImports(ctx2, frame, (c) => evaluate(parse("helper"), { helper: 3 }, c))).toBe(3);
  });

  test("with no frame, a unique name falls back to the flat-global lookup", () => {
    expect(evaluate(parse("other"), {}, ctx2)).toEqual({ $ref: "Foo:other" });
  });
});

describe("a member of a module whose name is not its functions' namespace", () => {
  // `modules/auth.ts` folds the `subject` header group into the `auth` module
  // and keeps the `subject:*` ids through `functionNamespaceOverrides`, so the
  // member `auth.accountId` IS the function `subject:accountId`. The same fold,
  // small. The dotted value used to be `{$ref: "auth:accountId"}` — a spelling
  // the member index resolves, but not the function's identity, so it never
  // equalled the reference any other route builds for it.
  const subject = loadFenelModule(`module subject where
@codeName "subjectAccountId"
accountId : String -> String
accountId s = s
`, "subject");
  const authPart = loadFenelModule(`module auth where
issue x = x
`, "auth");
  const folded: FenelModule = {
    ...authPart,
    functionNamespaceOverrides: (subject.functions ?? []).map((fn) => ({
      functionId: fn.id,
      namespace: subject.name,
    })),
    functions: [...(authPart.functions ?? []), ...(subject.functions ?? [])],
    functionSignatureDeclarations: [
      ...(authPart.functionSignatureDeclarations ?? []),
      ...(subject.functionSignatureDeclarations ?? []),
    ],
    entities: [...(authPart.entities ?? []), ...(subject.entities ?? [])],
    instances: [...(authPart.instances ?? []), ...(subject.instances ?? [])],
  };
  const reg3 = createRegistry([folded]);
  const ctx3 = reg3.evaluateContext();
  // The reference every other route builds: the function's own id, or the UUID
  // the registry's lock maps that id to.
  const canonical = { $ref: ctx3._uuidBySlug?.get("subject:accountId") ?? "subject:accountId" };

  test("the member index lands on `subject:accountId`", () => {
    expect(reg3.getFunction("auth:accountId")?.id).toBe("subject:accountId");
  });

  test("the dotted value is the function's own reference", () => {
    expect(evaluate(parse("auth.accountId"), {}, ctx3)).toEqual(canonical);
    expect(evaluate({ method: ["auth", "accountId"] }, {}, ctx3)).toEqual(canonical);
    // ... the same value its codeName reaches.
    expect(evaluate(parse("subjectAccountId"), {}, ctx3)).toEqual(canonical);
  });

  test("a dotted call still reaches it", () => {
    expect(evaluate(parse('auth.accountId "acct-1"'), {}, ctx3)).toBe("acct-1");
    expect(evaluate({ method: ["auth", "accountId", "acct-2"] }, {}, ctx3)).toBe("acct-2");
    const ref = evaluate(parse("auth.accountId"), {}, ctx3);
    expect(evaluate({ call: [ref, "acct-3"] }, {}, ctx3)).toBe("acct-3");
  });
});
