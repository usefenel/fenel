// modules-as-values Phase 2d, slice S3 — the durable runtime and written types.
//
// `turn` no longer evaluates a statement-level `ann[0]` alone: an annotated IO
// `{call}` keeps its effect (yielded or hoisted), and an annotated typed method
// call reaches the engine WITH its written type, whose names resolve in the
// durable function's own module (the source-function coordinate `turn` sets
// from its function id). Under ANF hoisting `{ann:[{method…}, T]}` stays whole;
// only its effectful arguments are lifted, and the written type survives a JSON
// checkpoint.
import { beforeAll, describe, expect, it } from "bun:test";
import { dispatchRegistry, loadFenelModule } from "@fenel/engine";
import { mintAuthority } from "@fenel/engine/authority";
import { parse } from "@fenel/engine/fenel-parser";
import { modulesFor } from "@fenel/engine/module-manifest";
import { createAccountRegistry } from "@fenel/engine/repository-registry";
import { Nothing } from "@fenel/engine/type-foundation";
import type { FenelModule, FenelType } from "@fenel/engine/types";
import { resumeAfterIO, turn, type EvalState } from "./evaluator";

const LONG = 600_000;

// Module s3a imports JsonValue from codec, so `Result String JsonValue`
// resolves in its bodies and in a durable run of its functions; detached, the
// unqualified JsonValue does not resolve. Account-authored parameters are
// positional (`_n`).
const MODULE_A = String.raw`module s3a where
import codec (JsonValue)
decodeHere : String -> Result String JsonValue
decodeHere _0 = (Iso.decode _0 : Result String JsonValue)
`;
const FUNCTION_ID = "s3a:decodeHere";

function positionalParams(mod: FenelModule): FenelModule {
  return {
    ...mod,
    functions: (mod.functions ?? []).map((fn) => ({
      ...fn,
      params: fn.params.map((param, index) => ({
        ...param,
        key: { $tag: "PositionalField", index } as const,
      })),
    })),
  };
}

type Registry = ReturnType<typeof createAccountRegistry>;
let reg: Registry;

beforeAll(() => {
  reg = createAccountRegistry(
    modulesFor("execute"),
    [positionalParams(loadFenelModule(MODULE_A, "s3a", { bootstrapParser: "typescript" }))],
    { dispatchRegistry },
  );
}, LONG);

function authority(registry: Registry) {
  return mintAuthority(registry, {
    envelope: registry.evaluateAuthorityFunction(
      "authority:descriptorEnvelope",
      [registry.listPerformDescriptors()],
    ),
    issuer: "test",
    accountId: "mav2d-s3-durable",
    principal: null,
    lane: null,
    grant: null,
    mintedAt: 0,
  });
}

const state = (exprs: unknown[]): EvalState => ({ stack: [{ exprs, index: 0 }], env: {}, letTarget: Nothing });
const typeOf = (source: string): FenelType =>
  (parse(`(x : ${source})`) as { ann: [unknown, FenelType] }).ann[1];
const decodeAs = (argument: unknown, type = "Result String JsonValue") =>
  ({ ann: [{ method: ["Iso", "decode", argument] }, typeOf(type)] });
const OK_42 = { $tag: "Ok", _0: { $tag: "JsonNumber", value: 42 } };
/** A durable checkpoint is JSON. */
const checkpoint = (value: EvalState): EvalState => JSON.parse(JSON.stringify(value));

describe("durable turns and written types", () => {
  it("a typed pure call as a statement resolves in the durable function's module", () => {
    const done = turn(state([decodeAs("42")]), reg, authority(reg), FUNCTION_ID);
    expect(done).toMatchObject({ outcome: "done", value: OK_42 });
    // Detached (no function id), the unqualified JsonValue does not resolve,
    // and the failure is an error outcome, never a silently dropped value.
    const detached = turn(state([decodeAs("42")]), reg, authority(reg));
    expect(detached.outcome).toBe("error");
    if (detached.outcome === "error") {
      expect(detached.error).toMatch(/the type JsonValue is not visible without a source function/);
    }
  }, LONG);

  it("a typed pure call in a let", () => {
    const done = turn(state([{ let: { x: decodeAs("42") } }, { var: "x" }]), reg, authority(reg), FUNCTION_ID);
    expect(done).toMatchObject({ outcome: "done", value: OK_42 });
  }, LONG);

  it("a typed call after an IO step: suspend, JSON checkpoint, resume", () => {
    const first = turn(
      state([{ let: { input: { call: ["read", { type: "text" }] } } }, decodeAs({ var: "input" })]),
      reg,
      authority(reg),
      FUNCTION_ID,
    );
    expect(first.outcome).toBe("io");
    if (first.outcome !== "io") return;
    expect(first.request.action).toBe("read");
    const resumed = resumeAfterIO(checkpoint(first.state), "42", reg, authority(reg), FUNCTION_ID);
    expect(resumed).toMatchObject({ outcome: "done", value: OK_42 });
  }, LONG);

  it("a typed call before an IO step keeps its value across the suspension", () => {
    const first = turn(
      state([{ let: { x: decodeAs("42") } }, { call: ["wait", { duration: "1h" }] }, { var: "x" }]),
      reg,
      authority(reg),
      FUNCTION_ID,
    );
    expect(first.outcome).toBe("io");
    if (first.outcome !== "io") return;
    expect(first.request.action).toBe("wait");
    const resumed = resumeAfterIO(checkpoint(first.state), null, reg, authority(reg), FUNCTION_ID);
    expect(resumed).toMatchObject({ outcome: "done", value: OK_42 });
  }, LONG);

  it("an annotated IO {call} statement keeps its effect", () => {
    const yielded = turn(
      state([{ ann: [{ call: ["wait", { duration: "1h" }] }, typeOf("Unit")] }]),
      reg,
      authority(reg),
      FUNCTION_ID,
    );
    expect(yielded.outcome).toBe("io");
    if (yielded.outcome === "io") expect(yielded.request.action).toBe("wait");
  }, LONG);

  it("an effectful argument hoists while the annotation stays with its method", () => {
    const first = turn(
      state([decodeAs({ call: ["read", { type: "text" }] })]),
      reg,
      authority(reg),
      FUNCTION_ID,
    );
    expect(first.outcome).toBe("io");
    if (first.outcome !== "io") return;
    expect(first.request.action).toBe("read");
    // The pending statement is still the annotated method, its argument a
    // hoisted variable.
    const pending = JSON.stringify(first.state.stack);
    expect(pending).toMatch(/"ann":\[\{"method":\["Iso","decode",\{"var":"_h\d+"\}\]\}/);
    const resumed = resumeAfterIO(checkpoint(first.state), "42", reg, authority(reg), FUNCTION_ID);
    expect(resumed).toMatchObject({ outcome: "done", value: OK_42 });
  }, LONG);

  it("a typed call the written type cannot select is an error outcome", () => {
    const unannotated = turn(state([{ method: ["Iso", "decode", "42"] }]), reg, authority(reg), FUNCTION_ID);
    expect(unannotated.outcome).toBe("error");
    if (unannotated.outcome === "error") {
      expect(unannotated.error).toMatch(/Iso\.decode: the class parameter a is not fixed by the arguments; write the type, or select the instance/);
    }
    const wrong = turn(state([decodeAs("42", "Maybe JsonValue")]), reg, authority(reg), FUNCTION_ID);
    expect(wrong.outcome).toBe("error");
    if (wrong.outcome === "error") expect(wrong.error).toMatch(/inference\.constructor-mismatch/);
  }, LONG);
});
