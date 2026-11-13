import type { ExprNode } from "@fenel/engine/authoring/expression";
import {
  imgBlueChannel, imgBoxBlur, imgBrightness, imgCheckerboard, imgContrast, imgCrop, imgDifference,
  imgDither, imgEdgeDetect, imgEmboss, imgFlipHorizontal, imgFlipVertical, imgGamma, imgGaussianBlur,
  imgGradient, imgGrayscale, imgGreenChannel, imgHueRotate, imgInvert, imgMedian, imgMultiply,
  imgNoise, imgOpacity, imgOverlay, imgPixelate, imgPosterize, imgQuantize, imgRedChannel, imgResize,
  imgRotate90, imgRotate180, imgRotate270, imgSample, imgSaturate, imgScreen, imgSepia, imgSharpen,
  imgSolid, imgSwapRedBlue, imgSwapRedGreen, imgThreshold, imgTranspose, imgVignette,
} from "@fenel/engine/image-ops";
import { expressionKey } from "./saved-expression-identity";

type ImageFn = (...args: unknown[]) => unknown;
const imageFns: Record<string, ImageFn> = {
  "std:imageBlueChannel": imgBlueChannel,
  "std:imageBoxBlur": imgBoxBlur,
  "std:imageBrightness": imgBrightness,
  "std:imageCheckerboard": imgCheckerboard,
  "std:imageContrast": imgContrast,
  "std:imageCrop": imgCrop,
  "std:imageDifference": imgDifference,
  "std:imageDither": imgDither,
  "std:imageEdgeDetect": imgEdgeDetect,
  "std:imageEmboss": imgEmboss,
  "std:imageFlipHorizontal": imgFlipHorizontal,
  "std:imageFlipVertical": imgFlipVertical,
  "std:imageGamma": imgGamma,
  "std:imageGaussianBlur": imgGaussianBlur,
  "std:imageGradient": imgGradient,
  "std:imageGrayscale": imgGrayscale,
  "std:imageGreenChannel": imgGreenChannel,
  "std:imageHueRotate": imgHueRotate,
  "std:imageInvert": imgInvert,
  "std:imageMedian": imgMedian,
  "std:imageMultiply": imgMultiply,
  "std:imageNoise": imgNoise,
  "std:imageOpacity": imgOpacity,
  "std:imageOverlay": imgOverlay,
  "std:imagePixelate": imgPixelate,
  "std:imagePosterize": imgPosterize,
  "std:imageQuantize": imgQuantize,
  "std:imageRedChannel": imgRedChannel,
  "std:imageResize": imgResize,
  "std:imageRotate90": imgRotate90,
  "std:imageRotate180": imgRotate180,
  "std:imageRotate270": imgRotate270,
  "std:imageSample": imgSample,
  "std:imageSaturate": imgSaturate,
  "std:imageScreen": imgScreen,
  "std:imageSepia": imgSepia,
  "std:imageSharpen": imgSharpen,
  "std:imageSolid": imgSolid,
  "std:imageSwapRedBlue": imgSwapRedBlue,
  "std:imageSwapRedGreen": imgSwapRedGreen,
  "std:imageThreshold": imgThreshold,
  "std:imageTranspose": imgTranspose,
  "std:imageVignette": imgVignette,
};

const remembered = new Map<string, unknown>();

/** A picture already painted before the editing registry finished. */
export function readImagePipelinePreview(key: string): unknown {
  return remembered.get(key);
}

/** Run a pure `std:image*` pipeline. Anything else, including a picture render, is left for the reader. */
export function evaluateImagePipeline(
  node: ExprNode,
  saved: ReadonlyMap<string, ExprNode>,
  stack: string[] = [],
): unknown | undefined {
  if (node.kind === "literal") return node.value;
  if (node.kind === "param") return undefined;
  if (node.kind === "ref") {
    if (stack.includes(node.savedExprId)) return undefined;
    const target = saved.get(node.savedExprId);
    if (!target) return undefined;
    return evaluateImagePipeline(target, saved, [...stack, node.savedExprId]);
  }
  const fn = imageFns[node.fnId];
  if (!fn) return undefined;
  const args: unknown[] = [];
  for (const arg of node.args) {
    const value = evaluateImagePipeline(arg, saved, stack);
    if (value === undefined) return undefined;
    args.push(value);
  }
  const image = fn(...args);
  remembered.set(expressionKey(node, saved), image);
  return image;
}
