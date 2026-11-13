import { expect, test } from "bun:test";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import { imgInvert, imgSample } from "@fenel/engine/image-ops";
import { evaluateImagePipeline, readImagePipelinePreview } from "./image-pipeline-preview";
import { expressionKey } from "./saved-expression-identity";

const call = (fnId: string, ...args: ExprNode[]): ExprNode => ({ kind: "call", fnId, args });
const literal = (value: unknown): ExprNode => ({ kind: "literal", value });

test("an image pipeline paints without the editing registry and a picture render does not", () => {
  const saved = new Map<string, ExprNode>();
  const photo = call("std:imageInvert", call("std:imageSample", literal(3)));
  const image = evaluateImagePipeline(photo, saved) as { width: number; height: number };
  expect(image).toEqual(imgInvert(imgSample(3)));
  expect(readImagePipelinePreview(expressionKey(photo, saved))).toBe(image);
  const ref = { kind: "ref" as const, savedExprId: "photo" };
  saved.set("photo", photo);
  expect(evaluateImagePipeline(ref, saved)).toEqual(image);
  expect(evaluateImagePipeline(call("picture:render", literal(1), literal(96), literal(96)), saved)).toBeUndefined();
});
