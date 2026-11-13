import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { SAMPLE_ANIMATIONS, SAMPLE_MOVIES, SAMPLE_SOUNDS, SAMPLE_TRACKS } from "./sample-media";

// The media examples are dispatch-pool data: the pool digest keys the
// engine-body replay artifact recorded in Bun and replayed in Chrome, so the
// samples must be bit-identical on every JavaScript engine. These digests were
// checked equal under Bun (JavaScriptCore) and Node (V8) on 2026-10-25; with
// Math.sin the Sound/Movie/Track digests differed between the two engines.
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

describe("sample media are engine-independent data", () => {
  test("the generated samples keep their cross-engine digests", () => {
    expect({
      animations: digest(SAMPLE_ANIMATIONS),
      movies: digest(SAMPLE_MOVIES),
      sounds: digest(SAMPLE_SOUNDS),
      tracks: digest(SAMPLE_TRACKS),
    }).toEqual({
      animations: "6c3f653c050d4951",
      movies: "a6a3572b32481494",
      sounds: "8a4c0c9503060496",
      tracks: "8a14d89b097f10b7",
    });
  });

  test("no engine-approximated transcendental function generates them", () => {
    const source = readFileSync(new URL("./sample-media.ts", import.meta.url), "utf8")
      .replace(/\/\/.*$/gm, "");
    expect(source).not.toMatch(/Math\.(sin|cos|tan|exp|expm1|log|log1p|log2|log10|pow|atan2?|asin|acos|sinh|cosh|tanh|hypot|cbrt)\s*\(/);
  });
});
