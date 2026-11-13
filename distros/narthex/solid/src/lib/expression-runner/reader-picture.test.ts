import { describe, expect, test } from "bun:test";
import type { AuthoringSession } from "./account-authoring-session";
import { projectReaderPicture } from "./reader-picture";
import { isReaderExtensionMethod, runReaderExtension } from "./authoring-worker-reader-extensions";

const image = { width: 1, height: 1, pixels: [{ r: 10, g: 20, b: 30, a: 255 }] };

function sessionFor(value: unknown, reads: string[] = []): AuthoringSession {
  return { evaluateContext: { getFunction: (id: string) => {
    reads.push(id);
    return id === "picture-owner" ? { id, params: [], returns: { $ref: "Image" }, body: value } : undefined;
  } } } as unknown as AuthoringSession;
}

describe("captured reader picture transport", () => {
  test("an inline Image is read through the shared source media planner", () => {
    expect(projectReaderPicture({ method: "project-reader-picture", picture: { $tag: "GlyphPictureInline", image } }, sessionFor(undefined)))
      .toEqual({ pictureImage: image });
  });

  test("a demanded reference uses this reader's function, without an alternate registry", () => {
    const reads: string[] = [];
    expect(projectReaderPicture({ method: "project-reader-picture", picture: { $tag: "GlyphPictureReference", handle: "picture-owner" } },
      sessionFor(image, reads))).toEqual({ pictureImage: image });
    expect(reads).toContain("picture-owner");
  });

  test("empty, incomplete and oversized images do not cross as picture data", () => {
    for (const value of [{ width: 0, height: 0, pixels: [] }, { width: 1, height: 1, pixels: [] },
      { width: 129, height: 129, pixels: [] }]) {
      expect(projectReaderPicture({ method: "project-reader-picture", picture: { $tag: "GlyphPictureInline", image: value } }, sessionFor(undefined)))
        .toEqual({});
    }
  });

  test("queued cancellation does not look up or evaluate a picture", async () => {
    const reads: string[] = [];
    expect(isReaderExtensionMethod("project-reader-picture")).toBe(true);
    expect(await runReaderExtension({ method: "project-reader-picture", picture: { $tag: "GlyphPictureReference", handle: "picture-owner" } },
      sessionFor(image, reads), undefined, async () => {}, () => true)).toBeUndefined();
    expect(reads).toEqual([]);
  });
});
