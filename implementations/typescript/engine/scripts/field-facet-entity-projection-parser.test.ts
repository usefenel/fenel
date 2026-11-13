// C1: bounded production-declaration parser parity, without a full-file render.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse, tokenize } from "../src/fenel-parser";
import { PARSE_VIA_FENEL_FAIL, parseViaFenelParser, withInterpretedCompiledArtifacts } from "../src/engine-bodies-dispatch";

const source = readFileSync(resolve(import.meta.dir, "../../../../fenel/modules/engine/field-representations.fenel"), "utf8");
const start = source.indexOf("fieldFacetEntityDirectiveProjection rows =");
const end = source.indexOf("@category", start);
if (start < 0 || end <= start) throw new Error("entity directive production declaration is missing");
const declaration = source.slice(start, end).trimEnd();

test("the bounded entity directive projection has exact source-parser AST parity", () => {
  expect(tokenize(declaration).length).toBeLessThanOrEqual(120);
  const actual = withInterpretedCompiledArtifacts(() => parseViaFenelParser(declaration));
  expect(actual).not.toBe(PARSE_VIA_FENEL_FAIL);
  expect(JSON.stringify(actual)).toBe(JSON.stringify(parse(declaration)));
}, 180_000);
