import { beforeAll, expect, test } from "bun:test";
import { loadFenelModule } from "@fenel/engine";
import { createAccountRegistry } from "@fenel/engine/repository-registry";
import { stdModule } from "@fenel/engine/modules/std";
import { mintAuthority, type AuthorityRef } from "@fenel/engine/authority";
import { Nothing } from "@fenel/engine/type-foundation";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { turn, type EvalState } from "./evaluator";

const functionId = "df4eef35-5ba8-4b66-8e7e-90b0d995aaeb";
let registry: ModuleRegistry;
let authority: AuthorityRef;
beforeAll(() => {
  const source = loadFenelModule(`module rootProbe where
echo : Number -> Number
echo _0 = _0
`, "rootProbe");
  registry = createAccountRegistry([stdModule], [{ ...source,
    functions: source.functions?.map(fn => ({ ...fn, id: functionId })),
    functionSignatureDeclarations: source.functionSignatureDeclarations?.map(declaration => ({ ...declaration, functionId })),
    instances: [{ typeName: "Codeable", args: [functionId], methods: { codeName: "system" } }],
  }], { identityKinds: new Map([[functionId, "function"]]) });
  authority = mintAuthority(registry, {
    envelope: registry.evaluateAuthorityFunction("authority:descriptorEnvelope", [registry.listPerformDescriptors()]),
    issuer: "test", accountId: "ctor-root", principal: null, lane: null, grant: null, mintedAt: 0,
  });
}, 60000);

const run = (exprs: unknown[]) => turn({ stack: [{ exprs, index: 0 }], env: {}, letTarget: Nothing } as EvalState,
  registry, authority);

test("durable root application refuses the record rather than invoking a global Codeable alias", () => {
  expect(run([{ call: ["system", 1] }])).toMatchObject({ outcome: "error", error: "system is a value, not a function" });
  expect(run([{ let: { value: { call: ["system", 1] } } }])).toMatchObject({ outcome: "error", error: "system is a value, not a function" });
  expect(run([{ call: [{ $ref: functionId }, 2] }])).toMatchObject({ outcome: "done", value: 2 });
});

test("durable named and held system constructor fields invoke the ordinary Function", () => {
  expect(run([{ call: ["system.Expr.ELit", 3] }])).toMatchObject({ outcome: "done", value: { $tag: "ELit", value: 3 } });
  expect(run([{ let: { held: { var: "system" } } }, { call: [{ var: "held.Expr.ELit" }, 4] }]))
    .toMatchObject({ outcome: "done", value: { $tag: "ELit", value: 4 } });
});
