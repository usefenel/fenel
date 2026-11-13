// ---------------------------------------------------------------------------
// register-type-fenel-param.test.ts — forms-collapse Phase 1 proof (D-REG = B).
//
// The thesis the audit flagged to prove: a `FenelType` can be a real action
// param — the action-subsumption "params ARE the form" applied to type-authoring
// itself, so *registering a type is submitting a form whose type is FenelType*.
//
// This pins the three facts that make `register_type` (→ types:registerType)
// work end-to-end, none of which need a DB:
//
//   1. registerType declares its `schema` param as `Type` = the {$type:true}
//      universe. That is BOTH (a) what makes the editor auto-derive `TypeBuilder`
//      for the param (FieldRenderer.tsx:623 — `"$type" in type`), so the action's
//      input UX IS the FenelType editor with no fork, AND (b) what `validate`
//      accepts a type-AST against.
//   2. validate({$type:true}, <typeAST>) accepts any well-formed FenelType value
//      via isFenelType (validate.ts:427-429) — the membership rule for the
//      universe.
//   3. The dispatcher's actual validation path —
//      `paramRecordOf(fn, CONTEXT_INJECTED) ` then validate over that record (what
//      `state.validate_function_args` runs, runtime/handlers/state.ts:444) —
//      accepts `{name, schema: <typeAST>}` and passes the type-AST through
//      untouched (schema is a non-Maybe param → identity pass-through), so the
//      body receives the real FenelType as its `schema` arg.
//
// Spec: design/forms-collapse.md + workstreams/forms-collapse/roadmap.md Phase 1.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { typesModule } from "./modules/types";
import { paramRecordOf, fieldType } from "./field-meta";
import { validate } from "./validate";
import { isFenelType } from "./dependent-types";
import type { FenelType } from "./types";

// Mirrors runtime/handlers/state.ts CONTEXT_INJECTED_PARAMS — the dispatcher
// supplies adapter/accountId, so they are NOT part of the validated contract.
const CONTEXT_INJECTED = new Set(["adapter", "accountId"]);

// A realistic funnel input type: the auto-derived UX of THIS $record is the form.
const LEAD_TYPE: FenelType = {
  $record: {
    fields: [
      { name: "email", type: { $ref: "String" } },
      { name: "name", type: { $ref: "String" } },
    ],
  },
} as FenelType;

describe("forms-collapse Phase 1 — register_type takes a FenelType as a param (D-REG=B)", () => {
  const fn = typesModule.functions?.find((f) => f.id === "types:registerType");

  test("registerType is registered with a `schema` param typed as the Type universe", () => {
    expect(fn).toBeDefined();
    const schema = fn!.params.find((p) => p.name === "schema");
    expect(schema).toBeDefined();
    // {$type:true} → TypeBuilder in the editor AND isFenelType-membership in validate.
    expect(fieldType(schema!)).toEqual({ $type: true });
  });

  test("validate({$type:true}, typeAST) accepts a well-formed FenelType (the universe membership rule)", () => {
    expect(isFenelType(LEAD_TYPE)).toBe(true);
    const r = validate({ $type: true } as FenelType, LEAD_TYPE, null);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  test("the dispatcher's paramRecordOf(registerType) validates {name, schema} and passes the type-AST through untouched", () => {
    const paramRecord = paramRecordOf(fn!, CONTEXT_INJECTED);
    // adapter is context-injected → excluded from the validated contract.
    const record = paramRecord as { $record: { fields: { name: string }[] } };
    const names = record.$record.fields.map((f) => f.name);
    expect(names).toContain("name");
    expect(names).toContain("schema");
    expect(names).not.toContain("adapter");

    const r = validate(paramRecord, { name: "Lead", schema: LEAD_TYPE }, null);
    expect(r.valid).toBe(true);
    // Non-Maybe param → identity pass-through: the body gets the real FenelType.
    expect(r.data.schema).toEqual(LEAD_TYPE as unknown as Record<string, unknown>);
  });
});
