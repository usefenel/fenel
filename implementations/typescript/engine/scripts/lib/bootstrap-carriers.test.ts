import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PARSER_BOOTSTRAP_JSON } from "../../src/generated/parser-bootstrap.generated";
import {
  bootstrapCarrierFiles,
  isBootstrapCarrierSource,
} from "./bootstrap-carriers";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../../..");

const PROSE_HITS = [
  "fenel/modules/dashboard/io.fenel",
  "fenel/modules/engine/fenel-printer.fenel",
  "fenel/modules/engine/fixity-resolve.fenel",
  "fenel/modules/engine/lexer.fenel",
  "fenel/modules/engine/normalise-to-core.fenel",
  "fenel/modules/std/native/image-native.fenel",
  "fenel/std/entities/platform-data.fenel",
] as const;

describe("parser-bootstrap carrier scan", () => {
  test("pins both intended spellings, the word boundary, and deliberate prose breadth", () => {
    expect(isBootstrapCarrierSource("value ∈ /^[A-Za-z]$/")).toBe(true);
    expect(isBootstrapCarrierSource("value in /^[A-Za-z]$/")).toBe(true);
    expect(isBootstrapCarrierSource("min / 2")).toBe(false);

    const proseBytes = readFileSync(join(REPO_ROOT, "fenel/modules/engine/lexer.fenel"), "utf8");
    expect(isBootstrapCarrierSource(proseBytes)).toBe(true);
  });

  test("keeps all seven broad prose hits in both the live scan and committed seed", () => {
    const carriers = new Set(bootstrapCarrierFiles(REPO_ROOT));
    const seed = JSON.parse(PARSER_BOOTSTRAP_JSON) as Record<string, unknown>;
    for (const path of PROSE_HITS) {
      expect(carriers.has(path), `live carrier scan omitted ${path}`).toBe(true);
      expect(Object.hasOwn(seed, path), `committed bootstrap seed omitted ${path}`).toBe(true);
    }
  }, 60_000);

  test("stores source bytes for a word boundary, never a literal backspace", () => {
    const generator = readFileSync(
      join(REPO_ROOT, "implementations/typescript/engine/scripts/lib/bootstrap-carriers.ts"),
    );
    expect(generator.indexOf(Buffer.from([0xe2, 0x88, 0x88, 0x7c, 0x5c, 0x62, 0x69, 0x6e])))
      .toBeGreaterThanOrEqual(0);
    expect(generator.indexOf(Buffer.from([0xe2, 0x88, 0x88, 0x7c, 0x08, 0x69, 0x6e])))
      .toBe(-1);
  });
});
