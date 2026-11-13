// A2/B3 captured-reader media transport. The pure evaluator and Fenel media
// planner own execution/refusal and bounds. Only a demanded picture crosses
// the worker boundary; no eager asset expansion or host callback is added.
import { invokeCallable, pureEvaluateContext } from "@fenel/engine/expressions";
import { dispatchEngineBody, type ReaderGlyphPicture } from "@fenel/engine/engine-bodies-dispatch";
import { peelMaybeValue, type Maybe } from "@fenel/engine/type-foundation";
import { registryTransportSnapshot } from "../../../../../../implementations/typescript/engine/src/registry-transport";
import type { AuthoringSession } from "./account-authoring-session";

export type ReaderPictureQuery = { method: "project-reader-picture"; picture: ReaderGlyphPicture };
export type ReaderPictureResult = { pictureImage?: unknown };

export function projectReaderPicture(query: ReaderPictureQuery, session: AuthoringSession): ReaderPictureResult {
  const input = registryTransportSnapshot(query, "reader picture request", "value-read");
  const picture = input.picture;
  if (!picture || typeof picture !== "object"
    || (picture.$tag !== "GlyphPictureReference" && picture.$tag !== "GlyphPictureInline")
    || (picture.$tag === "GlyphPictureReference" && typeof picture.handle !== "string"))
    throw new TypeError("This picture request could not be read.");
  const context = pureEvaluateContext(session.evaluateContext);
  const image = picture.$tag === "GlyphPictureReference"
    ? invokeCallable({ $ref: picture.handle }, [], context) : picture.image;
  const selected = peelMaybeValue(dispatchEngineBody("engine:surfaceReaderGlyphPicture", [image], context) as Maybe<ReaderGlyphPicture>);
  return registryTransportSnapshot(selected?.$tag === "GlyphPictureInline" ? { pictureImage: selected.image } : {},
    "reader picture result", "value-read");
}
