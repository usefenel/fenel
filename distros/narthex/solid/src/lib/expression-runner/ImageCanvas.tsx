import { createEffect, createMemo, Show } from "solid-js";
import { imageCanvasPreview } from "./image-canvas-data";
import "./image-canvas.css";

/** Longest edge, in pixels, up to which a raster is read as pixel art. */
const PIXEL_ART_EDGE = 32;

/** The inline representation of Image is the pixel matrix itself. The first
 * version is a read-only canvas; selecting it never replaces an existing image. */
export function ImageCanvas(props: { value: unknown }) {
  let canvas!: HTMLCanvasElement;
  const preview = createMemo(() => imageCanvasPreview(props.value));
  const empty = () => !!preview() && (preview()!.image.width === 0 || preview()!.image.height === 0);
  // A small inspected raster gets a legible longer edge without changing its
  // pixel buffer. Portrait images keep the same bounded display target.
  // Only a raster whose pixels ARE the subject (pixel art, at most 32 on its
  // longer edge) is blown up to that target with hard pixels. A larger raster
  // is a picture: it is scaled smoothly and at most doubled, so a 96 px
  // photograph is not shown as 3 px blocks (Nov 11).
  const pixelArt = () => {
    const next = preview();
    return !next || Math.max(next.width, next.height) <= PIXEL_ART_EDGE;
  };
  const displayWidth = () => {
    const next = preview();
    if (!next || next.width <= 0 || next.height <= 0) return "auto";
    const longer = Math.max(next.width, next.height);
    const target = pixelArt() ? 320 : Math.min(320, longer * 2);
    return `${Math.max(next.width, target * Math.min(1, next.width / next.height))}px`;
  };
  const label = () => preview()
    ? `${preview()!.image.width} × ${preview()!.image.height} image${empty() ? " (empty)" : ""}`
    : "Image preview unavailable";

  createEffect(preview, (next) => {
    canvas.width = next?.width ?? 0;
    canvas.height = next?.height ?? 0;
    if (!next || next.width === 0 || next.height === 0) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const pixels = context.createImageData(next.width, next.height);
    pixels.data.set(next.rgba);
    context.putImageData(pixels, 0, 0);
  });

  return (
    <figure class="expr-image-canvas" data-raster={pixelArt() ? "pixels" : "picture"} style={{ "--expr-image-display-width": displayWidth() }}>
      <div class="expr-image-canvas__surface">
        <canvas ref={canvas} role="img" aria-label={label()} />
        <Show when={empty()}><span class="expr-image-canvas__empty">Empty image</span></Show>
        <Show when={!preview()}><span class="expr-image-canvas__empty">This image cannot be drawn.</span></Show>
      </div>
      <figcaption>{preview() ? `${preview()!.image.width} × ${preview()!.image.height}` : "Image preview unavailable"}</figcaption>
    </figure>
  );
}
