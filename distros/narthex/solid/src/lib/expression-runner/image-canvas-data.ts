export type InlineRgbaPixelValue = { r: number; g: number; b: number; a: number };

export type InlineImageValue = {
  width: number;
  height: number;
  pixels: InlineRgbaPixelValue[];
};

export function emptyImageValue(): InlineImageValue {
  return { width: 0, height: 0, pixels: [] };
}

export function isInlineImageValue(value: unknown): value is InlineImageValue {
  if (!value || typeof value !== "object") return false;
  const image = value as InlineImageValue;
  if (!Number.isSafeInteger(image.width) || image.width < 0
    || !Number.isSafeInteger(image.height) || image.height < 0
    || !Array.isArray(image.pixels)
    || image.width * image.height !== image.pixels.length) return false;
  return image.pixels.every((pixel) => pixel && typeof pixel === "object"
    && [pixel.r, pixel.g, pixel.b, pixel.a].every((channel) => Number.isSafeInteger(channel) && channel >= 0));
}

/** Limit preview allocation independently of the source image's dimensions.
 * Sampling affects only the preview; the authored pixel matrix is unchanged. */
export function imageCanvasPreview(value: unknown, maximumSide = 512): {
  image: InlineImageValue;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
} | undefined {
  if (!isInlineImageValue(value)) return undefined;
  const limit = Math.max(1, Math.floor(Number.isFinite(maximumSide) ? maximumSide : 512));
  const scale = Math.min(1, limit / Math.max(value.width, value.height, 1));
  const empty = value.width === 0 || value.height === 0;
  const width = empty ? 0 : Math.max(1, Math.floor(value.width * scale));
  const height = empty ? 0 : Math.max(1, Math.floor(value.height * scale));
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sourceY = Math.floor(y * value.height / height);
    for (let x = 0; x < width; x++) {
      const sourceX = Math.floor(x * value.width / width);
      const pixel = value.pixels[sourceY * value.width + sourceX]!;
      const index = (y * width + x) * 4;
      rgba[index] = pixel.r;
      rgba[index + 1] = pixel.g;
      rgba[index + 2] = pixel.b;
      rgba[index + 3] = pixel.a;
    }
  }
  return { image: value, width, height, rgba };
}
