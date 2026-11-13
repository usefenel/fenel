import { describe, expect, test } from "bun:test";
import { evaluate } from "../json-logic";
import { createRegistry } from "../registry";
import { stdModule } from "./std";
import { pictureModule } from "./picture";
import { soundModule } from "./sound";
import { animationModule } from "./animation";
import { movieModule } from "./movie";
import { eventsModule } from "./events";
import { gamesModule } from "./games";

// Launch demo 2: `games:imageGame` (fenel/modules/games/types.fenel) turns an
// Image into a finite game clip whose player sprite is that image. The clip is
// a pure function of the image, so a live reference re-renders it on edit.

type Pixel = { r: number; g: number; b: number; a: number };
type Image = { width: number; height: number; pixels: Pixel[] };
type Clip = { fps: number; frames: Image[] };

const reg = createRegistry([
  stdModule,
  pictureModule,
  soundModule,
  animationModule,
  movieModule,
  eventsModule,
  gamesModule,
]);
const ctx = reg.evaluateContext();

function call(name: string, ...args: unknown[]): unknown {
  return evaluate({ call: [name, ...args] }, {}, ctx);
}

/** An asymmetric 24 x 16 test image: a diagonal gradient with a red block in
 *  the top-left corner, so a horizontal flip visibly changes it. */
function testImage(): Image {
  const pixels: Pixel[] = [];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 24; x++) {
      pixels.push(x < 8 && y < 6
        ? { r: 230, g: 20, b: 20, a: 255 }
        : { r: 10 * x % 256, g: 15 * y % 256, b: 120, a: 255 });
    }
  }
  return { width: 24, height: 16, pixels };
}

/** Every top-left corner where `sprite` appears pixel for pixel in `frame`. */
function findSprite(frame: Image, sprite: Image): Array<{ x: number; y: number }> {
  const found: Array<{ x: number; y: number }> = [];
  for (let y = 0; y + sprite.height <= frame.height; y++) {
    for (let x = 0; x + sprite.width <= frame.width; x++) {
      let same = true;
      for (let sy = 0; same && sy < sprite.height; sy++) {
        for (let sx = 0; same && sx < sprite.width; sx++) {
          const a = frame.pixels[(y + sy) * frame.width + x + sx]!;
          const b = sprite.pixels[sy * sprite.width + sx]!;
          same = a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
        }
      }
      if (same) found.push({ x, y });
    }
  }
  return found;
}

describe("image game (demo 2)", () => {
  test("imageGame is an ordinary Image -> FrameSequence function", () => {
    const fn = reg.getFunctionByCodeName("imageGame");
    expect(fn).toBeTruthy();
    expect(fn!.params.map((param) => param.type)).toEqual([{ $ref: "Image" }]);
    expect(fn!.body).toBeDefined();
  });

  test("the clip has 24 frames at 8 fps and its sprite is the image, shrunk once", () => {
    const image = testImage();
    const started = performance.now();
    const clip = call("games:imageGame", image) as Clip;
    console.log(`imageGame 24x16: ${(performance.now() - started).toFixed(0)} ms`);
    expect(clip.fps).toBe(8);
    expect(clip.frames).toHaveLength(24);
    for (const frame of clip.frames) {
      expect(frame.width).toBe(64);
      expect(frame.height).toBe(48);
      expect(frame.pixels).toHaveLength(64 * 48);
    }
    const sprite = call("std:imageResize", image, 16, 11) as Image;
    expect(call("games:imageGameSprite", image)).toEqual(sprite);
    // Move 0 (a step right from x = 4) happens at t = 0, so frame 0 shows it.
    expect(findSprite(clip.frames[0]!, sprite)).toEqual([{ x: 8, y: 18 }]);
    // Eight steps right, then four down: the sprite travels with the moves.
    expect(findSprite(clip.frames[7]!, sprite)).toEqual([{ x: 36, y: 18 }]);
    expect(findSprite(clip.frames[11]!, sprite)).toEqual([{ x: 36, y: 34 }]);
    // Walls stop it: four steps right from x = 36 end at 64 - 16 = 48.
    expect(findSprite(clip.frames[15]!, sprite)).toEqual([{ x: 48, y: 34 }]);
    // Coins were collected: the score bar is drawn along the top edge.
    expect(clip.frames[0]!.pixels[1 * 64 + 1]).toEqual({ r: 24, g: 32, b: 56, a: 255 });
    expect(clip.frames[23]!.pixels[1 * 64 + 1]).toEqual({ r: 240, g: 240, b: 240, a: 255 });
  }, 600_000);

  test("editing the source image (a flip) changes the game's frames", () => {
    const image = testImage();
    const flipped = call("std:imageFlipHorizontal", image) as Image;
    const original = call("games:imageGame", image) as Clip;
    const edited = call("games:imageGame", flipped) as Clip;
    expect(edited.frames).toHaveLength(24);
    expect(edited.frames[0]).not.toEqual(original.frames[0]);
    const flippedSprite = call("std:imageResize", flipped, 16, 11) as Image;
    expect(findSprite(edited.frames[0]!, flippedSprite)).toEqual([{ x: 8, y: 18 }]);
    // Same moves, same coins: only the sprite's own pixels differ.
    expect(edited.frames[23]!.pixels[1 * 64 + 1]).toEqual(original.frames[23]!.pixels[1 * 64 + 1]);
  }, 600_000);
});
