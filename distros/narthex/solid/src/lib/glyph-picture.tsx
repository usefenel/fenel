// A2/B3 media host leaf. Fenel selects Picturable and bounds Image data;
// this component only requests a selected reference in its current reader,
// rasterizes with the shared image preview, and owns browser loading/errors.
import { createEffect, createSignal, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { ReaderGlyphPicture } from "@fenel/engine/engine-bodies-dispatch";
import { useReaderRuntime, type ReaderRuntime } from "./reader-runtime";
import { sessionEpoch } from "./browser-session";
import { imageCanvasPreview } from "./expression-runner/image-canvas-data";

export type GlyphPicture = ReaderGlyphPicture;
type PictureReader = { reader: ReaderRuntime; session: ReturnType<ReaderRuntime["session"]>; revision: number; epoch: number;
  worker?: ReturnType<NonNullable<ReaderRuntime["readerWorker"]>> };
type PictureCache = PictureReader & { images: Map<string, Promise<string | undefined>> };
type PictureRequest = { kind: "inline"; image: unknown } | (PictureReader & { kind: "reference"; handle: string });
// IDENTITY-KEYED media transport cache. A reader/session/revision replacement
// retires its images; an identical handle in another reader never shares data.
const pictures = new WeakMap<ReaderRuntime, PictureCache>();

function current(snapshot: PictureReader): boolean {
  try {
    return !snapshot.reader.client.signal?.aborted && snapshot.epoch === sessionEpoch()
      && snapshot.reader.epoch === snapshot.epoch && snapshot.reader.revision() === snapshot.revision
      && snapshot.reader.session() === snapshot.session
      && (!snapshot.reader.readerWorker || snapshot.reader.readerWorker() === snapshot.worker);
  } catch { return false; }
}

function imageSource(value: unknown): string | undefined {
  const preview = imageCanvasPreview(value, 64);
  if (!preview || preview.width === 0 || preview.height === 0) return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = preview.width; canvas.height = preview.height;
  const context = canvas.getContext("2d");
  if (!context) return undefined;
  const image = context.createImageData(preview.width, preview.height);
  image.data.set(preview.rgba);
  context.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}

async function readPicture(snapshot: PictureReader, handle: string): Promise<string | undefined> {
  if (!current(snapshot)) return undefined;
  const { runPreparedReaderWorker, preparedReaderWorkerForSession } = await import("./expression-runner/authoring-catalog-worker");
  if (!current(snapshot)) return undefined;
  const query = { method: "project-reader-picture" as const, picture: { $tag: "GlyphPictureReference" as const, handle } };
  const worker = snapshot.worker ?? preparedReaderWorkerForSession(snapshot.session);
  // Local's frame and Fenel projection remain exclusively in its worker.
  if (snapshot.reader.kind === "local" && !worker) return undefined;
  const result = worker ? await runPreparedReaderWorker(worker, query, snapshot.reader.client.signal)
    : (await import("./expression-runner/reader-picture")).projectReaderPicture(query, snapshot.session);
  if (!current(snapshot)) return undefined;
  return result && typeof result === "object" && "pictureImage" in result ? imageSource(result.pictureImage) : undefined;
}

/** Loading/failure keeps the same identity's icon or emoji visible. No URL
 * fetch, new dispatch rule, image membership judgment or authority is added. */
export function GlyphPictureImage(props: { picture?: GlyphPicture; fallback?: JSX.Element }) {
  const reader = useReaderRuntime();
  const [source, setSource] = createSignal<string>();
  const [broken, setBroken] = createSignal(false);
  createEffect((): PictureRequest | undefined => {
    const picture = props.picture;
    if (!picture) return undefined;
    if (picture.$tag === "GlyphPictureInline") return { kind: "inline", image: picture.image };
    if (!reader) return undefined;
    try {
      const epoch = reader.epoch, revision = reader.revision(), session = reader.session(), worker = reader.readerWorker?.();
      const handle = reader.kind === "local" ? reader.referenceHandle?.(picture.handle)
        : session.registry.getUuid(picture.handle);
      return handle ? { kind: "reference", handle, reader, epoch, revision, session, worker } : undefined;
    } catch { return undefined; }
  }, (request) => {
    let cancelled = false;
    setSource(undefined); setBroken(false);
    if (!request) return;
    if (request.kind === "inline") {
      try { setSource(imageSource(request.image)); } catch { /* retain fallback */ }
      return;
    }
    if (!current(request)) return;
    let cache = pictures.get(request.reader);
    if (!cache || cache.session !== request.session || cache.revision !== request.revision || cache.epoch !== request.epoch || cache.worker !== request.worker) {
      cache = { ...request, images: new Map() };
      pictures.set(request.reader, cache);
    }
    let pending = cache.images.get(request.handle);
    if (!pending) {
      pending = readPicture(request, request.handle).catch(() => undefined);
      cache.images.set(request.handle, pending);
    }
    void pending.then(url => { if (!cancelled && current(request)) setSource(url); });
    return () => { cancelled = true; };
  });
  return <Show when={source() && !broken()} fallback={props.fallback}>
    <img class="fenel-glyph-picture" src={source()} alt="" loading="lazy" onError={() => setBroken(true)} />
  </Show>;
}
