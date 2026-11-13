// B3/host-runtime reflection leaf. The caller admits one inert packet before
// evaluation; this leaf reads only that own frame slot and marshals Maybe.
import { ownDataRead } from "../../../../implementations/typescript/engine/src/json-logic";
import { Just, Nothing, type Maybe } from "../../../../implementations/typescript/engine/src/type-foundation";

export function readerSourceMetadataNative(context: unknown): Maybe<unknown> {
  if (context === null || typeof context !== "object") return Nothing;
  try {
    const packet = ownDataRead(context, "_readerSourceMetadata");
    if (!packet.found || packet.value === null || typeof packet.value !== "object") return Nothing;
    const tag = ownDataRead(packet.value, "$tag");
    return tag.found && tag.value === "ReaderSourceMetadata" ? Just(packet.value) : Nothing;
  } catch { return Nothing; }
}

export const sourceMetadataNativesCtx = { readerSourceMetadata: readerSourceMetadataNative };
