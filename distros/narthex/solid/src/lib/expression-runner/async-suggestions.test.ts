import { expect, test } from "bun:test";
import { rankAuthoringFunctionSuggestions, inferAuthoringExpressionWithLiteralWitnesses, judgeAuthoringSchemeCompatibility } from "@fenel/engine/authoring/environment";
import type { AuthoringFunctionEntry } from "@fenel/engine/authoring/expression";
import type { FenelType } from "@fenel/engine/types";
import { rankSuggestionsForEditor, readWrappingInputInference } from "./async-suggestions";

import { contains } from "@fenel/engine/set-algebra";
import { typeToSetExpr } from "@fenel/engine/fenel-check";
import { Anything } from "@fenel/engine/type-foundation";
import type { ExpressionInferenceItem, ExpressionInferenceReply } from "./authoring-worker-protocol";

const number: FenelType = { $ref: "Number" };
const string: FenelType = { $ref: "String" };
const entry = (id: string, returns: FenelType): AuthoringFunctionEntry => ({
  id, params: [], returns, signatureOutcome: { $tag: "Solved" },
  scheme: { quantified: [], body: { $arrow: { params: [], returns } } },
});

test("yielded suggestions retain every canonical compatibility judgment and ordering", async () => {
  const entries = Array.from({ length: 160 }, (_, index) => entry(`candidate${index}`, index % 2 ? string : number));
  const expected = { quantified: [], body: number };
  const canonical = rankAuthoringFunctionSuggestions(entries, expected);
  let inputRan = false;
  setTimeout(() => { inputRan = true; }, 0);
  const pending = rankSuggestionsForEditor({}, entries, expected, {});
  const actual = await pending;
  expect(actual).toEqual(canonical);
  expect(inputRan).toBe(true);
}, 180_000);

test("prepared results belong to an immutable session and contextual type", async () => {
  const scope = {};
  const entries = [entry("number", number), entry("text", string)];
  const first = rankSuggestionsForEditor(scope, entries, number, {});
  expect(rankSuggestionsForEditor(scope, entries, number, {})).toBe(first);
  expect(rankSuggestionsForEditor({}, entries, number, {})).not.toBe(first);
  const other = await rankSuggestionsForEditor(scope, entries, string, {});
  expect(other[0]?.entry.id).toBe("text");
  expect((await first)[0]?.entry.id).toBe("number");
}, 180_000);

const inferWrappingRequest = (request: ExpressionInferenceItem): ExpressionInferenceReply => {
  const inferred = inferAuthoringExpressionWithLiteralWitnesses(request.node, {
    literalMembership: (value, expected) => contains(typeToSetExpr(expected.body), value, null),
  }, request.expectedScheme ? { expectedScheme: request.expectedScheme } : {});
  return request.compatibility ? { ...inferred, compatibility: inferred.scheme
    ? judgeAuthoringSchemeCompatibility(inferred.scheme, request.compatibility) : "unknown" } : inferred;
};

test("wrapping input waits for contextual checking when independent inference does not fit", () => {
  const item: ExpressionInferenceItem = { node: { kind: "literal", value: 21 },
    expectedScheme: { quantified: [], body: string } };
  let ready = false;
  const reads: ExpressionInferenceItem[] = [];
  const infer = (request: ExpressionInferenceItem): ExpressionInferenceReply | undefined => {
    reads.push(request);
    return request.expectedScheme && !ready ? undefined : inferWrappingRequest(request);
  };
  expect(readWrappingInputInference(item, infer)).toBeUndefined();
  expect(reads).toEqual([{ node: item.node, compatibility: item.expectedScheme }, item]);
  ready = true;
  const answer = readWrappingInputInference(item, infer);
  expect(answer?.outcome.$tag).toBe("Solved");
  expect(answer?.scheme?.body).toEqual(number);
});

test("wrapping input keeps its actual Number scheme when the destination requires String", () => {
  const item: ExpressionInferenceItem = { node: { kind: "literal", value: 21 },
    expectedScheme: { quantified: [], body: string } };
  const reads: ExpressionInferenceItem[] = [];
  const outcomes: string[] = [];
  const result = readWrappingInputInference(item, request => {
    reads.push(request);
    const inferred = inferWrappingRequest(request);
    outcomes.push(inferred.outcome.$tag);
    return inferred;
  });
  expect(outcomes).toEqual(["Solved", "Invalid"]);
  expect(reads).toEqual([{ node: item.node, compatibility: item.expectedScheme }, item]);
  expect(result?.scheme?.body).toEqual(number);
  expect(item.expectedScheme?.body).toEqual(string);
});

test("wrapping into Anything retains Number instead of widening to a contextual witness", () => {
  const item: ExpressionInferenceItem = { node: { kind: "literal", value: 21 },
    expectedScheme: { quantified: [], body: Anything } };
  // This real contextual control exhibits why contextual-first is too broad.
  const widened = inferWrappingRequest(item);
  expect(widened.outcome.$tag).toBe("Solved");
  expect(widened.scheme?.body).toEqual(Anything);
  const reads: ExpressionInferenceItem[] = [];
  const actual = readWrappingInputInference(item, request => {
    reads.push(request);
    return inferWrappingRequest(request);
  });
  expect(actual?.outcome.$tag).toBe("Solved");
  expect(actual?.compatibility).toBe("compatible");
  expect(actual?.scheme?.body).toEqual(number);
  expect(reads).toEqual([{ node: item.node, compatibility: item.expectedScheme }]);
});
