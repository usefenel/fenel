// C1: exercise the production Fenel plan and action boundary. No browser
// normalization or test-local equality supplies the expected list behavior.
import { describe, expect, test } from "bun:test";
import type { FieldDef, FenelType } from "../types";
import { Just, List, Nothing } from "../type-foundation";
import { dispatchEngineBody, withInterpretedCompiledArtifacts } from "../engine-bodies-dispatch";
import { fieldEditPlan } from "./field-render";
import * as fieldRender from "./field-render";
import type { EvaluateContext } from "../json-logic";
import { mintAuthority } from "../authority";

const butter = { $tag: "Butter" };
const honey = { $tag: "Honey" };
const egg = { $tag: "Egg" };
const options = [butter, honey, egg].map(value => ({ value, label: value.$tag }));
const food: FenelType = { $variant: { cases: options.map(option => ({ name: option.label, label: Nothing, fields: [] })) } };
const field = (type: FenelType): FieldDef => ({ name: "foods", type, label: Nothing, ui: Nothing, meta: {} });

describe("finite nullary list chips", () => {
  test("offers the same ordered list data through chips and rows", () => withInterpretedCompiledArtifacts(() => {
    const current = [egg, butter, { $tag: "Egg" }];
    const plan = fieldEditPlan({ field: field(List(food)), value: current });
    expect(plan.editor.kind).toBe("list");
    expect((plan.editor as any).choices?.map((choice: any) => choice.value)).toEqual([butter, honey, egg]);
    expect((plan.editor as any).canonical).toBe(false);
    expect(current).toEqual([egg, butter, { $tag: "Egg" }]);
  }));

  test("retains the row editor for payload constructors and large constructor sets", () => withInterpretedCompiledArtifacts(() => {
    const payload: FenelType = { $variant: { cases: [{ name: "Food", label: Nothing, fields: [field({ $ref: "String" })] }] } };
    const large: FenelType = { $variant: { cases: Array.from({ length: 17 }, (_, index) => ({ name: `Choice${index}`, label: Nothing, fields: [] })) } };
    for (const itemType of [payload, large]) {
      const plan = fieldEditPlan({ field: field(List(itemType)), value: [] });
      expect(plan.editor.kind).toBe("list");
      expect((plan.editor as any).choices).toBeUndefined();
    }
  }));

  test("append preserves duplicate occurrences and removal targets one position", () => withInterpretedCompiledArtifacts(() => {
    const appended = dispatchEngineBody("engine:fieldListChipsCandidate", [options, [egg, butter, egg],
      { $tag: "FieldListAppendChoice", index: 0, expected: butter }, Nothing, Nothing]);
    expect(appended).toEqual({ $tag: "Ok", _0: [egg, butter, egg, butter] });
    const removed = dispatchEngineBody("engine:fieldListChipsCandidate", [options, [egg, butter, egg],
      { $tag: "FieldListRemoveOccurrence", index: 0, expected: egg }, Nothing, Nothing]);
    expect(removed).toEqual({ $tag: "Ok", _0: [butter, egg] });
    const throughBoundary = fieldRender.fieldListChipsEditPlan(List(food), [egg, butter, egg],
      { $tag: "FieldListAppendChoice", index: 0, expected: butter });
    expect(throughBoundary).toEqual({ $tag: "Ok", _0: [egg, butter, egg, butter] });
  }));

  test("canonical toggles cannot be requested with absent or unchecked rank data", () => withInterpretedCompiledArtifacts(() => {
    const absent = dispatchEngineBody("engine:fieldListChipsCandidate", [options, [egg],
      { $tag: "FieldListToggleChoice", index: 0, expected: butter }, Nothing, Nothing]) as any;
    expect(absent?.$tag).toBe("Err");
    // A checked-looking record is still data: the live checker owns admission.
    const forged = dispatchEngineBody("engine:fieldListCanonicalPlan", [Just({ snapshot: {}, declaration: {} }), Just(true)]) as any;
    expect(forged).toEqual(Nothing);
  }));

  test("whole-list refusal and undecided membership retain the original draft", () => withInterpretedCompiledArtifacts(() => {
    const candidate = { $tag: "Ok", _0: [butter, egg] };
    for (const membership of [Just(false), Nothing]) {
      const verdict = dispatchEngineBody("engine:fieldListChipsAdmission", [candidate, membership]) as any;
      expect(verdict?.$tag).toBe("Err");
    }
    expect(dispatchEngineBody("engine:fieldListChipsAdmission", [candidate, Just(true)])).toEqual(candidate);
  }));

  test("stale option ordinals and moved occurrences refuse instead of changing another value", () => withInterpretedCompiledArtifacts(() => {
    for (const action of [
      { $tag: "FieldListAppendChoice", index: 0, expected: egg },
      { $tag: "FieldListRemoveOccurrence", index: 0, expected: butter },
    ]) {
      const verdict = dispatchEngineBody("engine:fieldListChipsCandidate", [options, [egg, butter], action, Nothing, Nothing]) as any;
      expect(verdict?.$tag).toBe("Err");
    }
    expect(dispatchEngineBody("engine:fieldListChipsSelectionPlan", [options, [egg, butter, egg]])).toEqual({
      occurrences: [Just(2), Just(0), Just(2)], selected: [true, false, true],
    });
  }));

  test("canonical insertion and removal use admitted rank order", () => withInterpretedCompiledArtifacts(() => {
    const foods = [butter, honey, egg].map((value, rank) => ({ value, rank }));
    expect(dispatchEngineBody("engine:fieldListToggleChoice", [[butter, egg], foods, honey])).toEqual({
      $tag: "Ok", _0: [butter, honey, egg],
    });
    expect(dispatchEngineBody("engine:fieldListToggleChoice", [[butter, honey, egg], foods, butter])).toEqual({
      $tag: "Ok", _0: [honey, egg],
    });
  }));

  test("an installed reader's failed type resolution cannot use a structural fallback", () => withInterpretedCompiledArtifacts(() => {
    let memberships = 0;
    const caller = { _callSiteTyping: {
      resolveType: () => ({ ok: false, message: "The type is unavailable in this reader." }),
      member: () => { memberships++; return "yes"; },
    } } as unknown as EvaluateContext;
    const current = [butter];
    const edited = fieldRender.fieldListChipsEditPlan(List(food), current,
      { $tag: "FieldListAppendChoice", index: 1, expected: honey }, caller);
    expect(edited.$tag).toBe("Err");
    expect(memberships).toBe(0);
    expect(current).toEqual([butter]);
  }));

  test("an absent draft may start a list while malformed existing data is preserved", () => withInterpretedCompiledArtifacts(() => {
    const action = { $tag: "FieldListAppendChoice", index: 0, expected: butter };
    expect(dispatchEngineBody("engine:fieldListChipsChoicesCandidate", [Just(options), undefined, action,
      Nothing, Nothing, true])).toEqual({ $tag: "Ok", _0: [butter] });
    const malformed = dispatchEngineBody("engine:fieldListChipsChoicesCandidate", [Just(options), "damaged list", action,
      Nothing, Nothing, false]) as any;
    expect(malformed?.$tag).toBe("Err");
  }));

  test("the authenticated reader owns the account coordinate of whole-list admission", () => withInterpretedCompiledArtifacts(() => {
    const authority = mintAuthority({ evaluateAuthorityFunction: () => Nothing }, {
      envelope: {}, issuer: "test", accountId: "chips-reader", principal: null, lane: null, grant: null, mintedAt: 0,
    });
    const accounts: Array<string | null> = [];
    const type = List(food);
    const caller = { _authority: authority, _callSiteTyping: {
      resolveType: () => ({ ok: true, type: { quantified: [], body: type } }),
      member: (_expected: unknown, _value: unknown, account: string | null) => {
        accounts.push(account);
        return account === "chips-reader" ? "no" : "yes";
      },
    } } as unknown as EvaluateContext;
    const edited = fieldRender.fieldListChipsEditPlan(type, [butter],
      { $tag: "FieldListAppendChoice", index: 1, expected: honey }, caller);
    expect(edited.$tag).toBe("Err");
    expect(accounts).toEqual(["chips-reader"]);
  }));

  test("membership cannot acquire the live reader's perform table", () => withInterpretedCompiledArtifacts(() => {
    const performTable = {};
    const type = List(food);
    let observed: EvaluateContext | undefined;
    const caller = { _performTable: performTable, _callSiteTyping: {
      resolveType: () => ({ ok: true, type: { quantified: [], body: type } }),
      member: (_expected: unknown, _value: unknown, _account: unknown, frame: EvaluateContext) => {
        observed = frame;
        if (frame._performTable !== undefined) throw new Error("Membership received host exercise power");
        return "yes";
      },
    } } as unknown as EvaluateContext;
    const edited = fieldRender.fieldListChipsEditPlan(type, [butter],
      { $tag: "FieldListAppendChoice", index: 1, expected: honey }, caller);
    expect(edited).toEqual({ $tag: "Ok", _0: [butter, honey] });
    expect(observed).toBeDefined();
    expect(observed?._performTable).toBeUndefined();
    expect(Object.is(caller._performTable, performTable)).toBe(true);
  }));
});
