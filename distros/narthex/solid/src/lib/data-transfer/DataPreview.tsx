import { For, Loading, Match, Show, Switch, createContext, createMemo, createSignal, lazy, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { SurfaceReadValuePlan } from "@fenel/engine/authoring/surface";
import { IconByName, LUCIDE_BY_NAME, TYPE_ICON_FALLBACKS } from "../icons";
import { thumbnailMark } from "../thumbnail-glyph";
import { GlyphPictureImage, type GlyphPicture } from "../glyph-picture";
import { ImageCanvas } from "../expression-runner/ImageCanvas";
import { isInlineImageValue } from "../expression-runner/image-canvas-data";
import type { ImportedMarkup } from "./markup";
// The four shape predicates moved to a sibling `.ts` — they render nothing,
// and a non-component caller needs them. Re-exported so importers are unchanged.
import { fileData, hasDataPreview, isImageLike, isMarkup, record } from "./data-preview-shape";
import { firstFieldText, iconMarkText, ownPictureMark } from "./thumbnail-text";
import { codeName, pickDisplayName } from "../display-name";
import { DisplayNameText } from "../display-name-text";
import { isIdentityText } from "../readable-ids";
import { RecordValueRows } from "../layout-renderer/record-value-rows";
import type { FenelType } from "@fenel/engine/types";
import { webLink } from "../web-link";
import "./data-transfer.css";
import "../layout-renderer/typed-read-value.css";
export { hasDataPreview };

/** Brief browser-event feedback; the owning importer reports completion/errors. */
export function TransferFeedback(props: { sequence: number; complete?: boolean }) {
  return <Show when={props.sequence} keyed>{(_sequence) => <div
    class={`fenel-transfer-feedback${props.complete ? " fenel-transfer-feedback--complete" : ""}`}
    role="status" aria-live="polite" aria-atomic="true">
    <IconByName name={props.complete ? "check" : "clipboard"} size={20} />
    <span>{props.complete ? "Data added" : "Adding data…"}</span>
  </div>}</Show>;
}

const StructuralDataPreview = lazy(async () => ({ default: (await import("./DataValueSurface")).DataValueSurface }));

function safeHref(value: unknown): string | undefined {
  return typeof value === "string" && /^(?:https?:\/\/|mailto:|tel:|#)/i.test(value.trim()) ? value : undefined;
}

function MarkupPreview(props: { value: ImportedMarkup; depth?: number; budget: { remaining: number } }) {
  // Bound the preview DOM, keeping the complete imported value available to copy.
  if (--props.budget.remaining < 0 || (props.depth ?? 0) > 16) return <span data-tooltip="The complete value is retained">…</span>;
  if (!record(props.value)) return null;
  const child = () => "child" in props.value ? props.value.child : undefined;
  const children = () => "children" in props.value ? props.value.children : "items" in props.value ? props.value.items : [];
  const nested = () => <MarkupPreview value={child()!} depth={(props.depth ?? 0) + 1} budget={props.budget} />;
  return <Switch>
    <Match when={props.value.$tag === "Text"}>{(props.value as { content: string }).content}</Match>
    <Match when={props.value.$tag === "Bold"}><strong>{nested()}</strong></Match>
    <Match when={props.value.$tag === "Italic"}><em>{nested()}</em></Match>
    <Match when={props.value.$tag === "Link"}><a href={safeHref((props.value as { url: string }).url)} rel="noopener noreferrer">{nested()}</a></Match>
    <Match when={props.value.$tag === "Heading"}><strong class="fenel-import-heading">{nested()}</strong></Match>
    <Match when={props.value.$tag === "Image"}>
      <Show when={/^(?:https?:\/\/|data:image\/(?:png|jpeg|gif|webp|avif);base64,)/i.test((props.value as { src: string }).src)}>
        <img class="storybook-img" src={(props.value as { src: string }).src} alt={(props.value as { alt: string }).alt} loading="lazy" />
      </Show>
    </Match>
    <Match when={props.value.$tag === "List"}>
      <div class="fenel-import-list" role="list"><For each={children().slice(0, 100)}>{(node, index) => <div role="listitem">{"ordered" in props.value && props.value.ordered ? `${index() + 1}. ` : "• "}<MarkupPreview value={node}
        depth={(props.depth ?? 0) + 1} budget={props.budget} /></div>}</For></div>
    </Match>
    <Match when={props.value.$tag === "Paragraph" || props.value.$tag === "Fragment"}>
      <div class={props.value.$tag === "Paragraph" ? "fenel-import-paragraph" : undefined}>
        <For each={children().slice(0, 100)}>{(node) => <MarkupPreview value={node} depth={(props.depth ?? 0) + 1} budget={props.budget} />}</For>
      </div>
    </Match>
  </Switch>;
}

/** Presentation capabilities only; data membership is checked by the importer. */
function scalarPreview(value: unknown): string {
  if (value === undefined) return "Incomplete value";
  if (value === null) return "Empty value";
  if (typeof value === "string") return value.length > 20_000 ? `${value.slice(0, 20_000)}…` : value;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return `${value.byteLength.toLocaleString()} bytes`;
  if (typeof value === "object") return "This data cannot be previewed";
  return String(value);
}

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  const object = record(value);
  if (!object) return undefined;
  const prototype = Object.getPrototypeOf(object);
  return prototype === Object.prototype || prototype === null ? object : undefined;
}

/** Field rows for a plain record. This preview has no Labelable text, so each
 * row uses the field's code name. Nothing reads as not set. */
export function StructuralReadValue(props: { value: unknown; depth?: number }) {
  return <Show when={(props.depth ?? 0) < 6} fallback={<span class="text-muted">…</span>}>
    <Show when={!hasDataPreview(props.value)} fallback={<DataPreview value={props.value} />}>
      <Show when={typeof props.value !== "string"} fallback={<DelimitedText value={String(props.value)} />}>
        <Show when={!Array.isArray(props.value)} fallback={
          <Show when={(props.value as unknown[]).length > 0} fallback={<span class="text-muted">Empty list</span>}>
            <span class="typed-read-fields" role="list">
              <For each={(props.value as unknown[]).slice(0, 100)}>{(item) =>
                <span role="listitem"><StructuralReadValue value={item} depth={(props.depth ?? 0) + 1} /></span>}
              </For>
            </span>
          </Show>
        }>
          <Show when={plainRecord(props.value)} fallback={
            <Show when={props.value !== undefined && props.value !== null}>
              <span class="typed-read-scalar">{String(props.value)}</span>
            </Show>
          }>{(object) => <RecordFields value={object()} depth={props.depth ?? 0} />}</Show>
        </Show>
      </Show>
    </Show>
  </Show>;
}

function RecordFields(props: { value: Record<string, unknown>; depth: number }) {
  const tag = () => typeof props.value.$tag === "string" ? props.value.$tag : undefined;
  // A type declared in data is tagged by its identity, which this untyped
  // preview cannot name: it shows no heading rather than the identity.
  const shownTag = () => { const name = tag(); return name && !isIdentityText(name) ? name : undefined; };
  const keys = () => Object.keys(props.value).filter(key => !key.startsWith("$"));
  return <Show when={tag() === "Nothing" && keys().length === 0} fallback={
    <Show when={tag() === "Just" && keys().length === 1 && keys()[0] === "_0"} fallback={
      <Show when={keys().length > 0} fallback={<span class="typed-read-scalar">{shownTag() ?? ""}</span>}>
        <span class="typed-read-fields">
          <Show when={shownTag()}>{name => <DisplayNameText name={codeName(name())} />}</Show>
          {/* Record display rule: the same label: value rows as typed records. */}
          <RecordValueRows count={keys().length} mode={props.depth >= 1 ? "line" : "rows"}
            label={index => <DisplayNameText name={pickDisplayName(undefined, keys()[index]!) ?? codeName(keys()[index]!)} />}
            value={index => <StructuralReadValue value={Object.getOwnPropertyDescriptor(props.value, keys()[index]!)?.value} depth={props.depth + 1} />} />
        </span>
      </Show>
    }>
      <StructuralReadValue value={Object.getOwnPropertyDescriptor(props.value, "_0")?.value} depth={props.depth + 1} />
    </Show>
  }>
    <span class="text-muted">Not set</span>
  </Show>;
}

/** String boundaries are display marks, separate from the characters held in
 * the data. Whitespace and literal quotation marks remain untouched. */
/** A string read: quoted text, or, when it is an address the reader may open
 * (web-link.ts: decided by its type, else by the chips' address test), a link
 * that opens in a new tab. */
export function DelimitedText(props: { value: string; type?: FenelType; resolveType?: (name: string) => FenelType | undefined }) {
  const link = createMemo(() => webLink(props.value, props.type, props.resolveType));
  return <Show when={link()} fallback={<span class="fenel-string-data"><span class="fenel-string-data__delimiter" aria-hidden="true">“</span><span
    class="fenel-string-data__content">{props.value}</span><span class="fenel-string-data__delimiter" aria-hidden="true">”</span></span>}>
    {address => <a class="fenel-string-data fenel-web-link link" href={address().href} target="_blank" rel="noopener noreferrer"
      data-web-link={address().kind} data-tooltip={props.value} data-tooltip-when-cut onClick={event => event.stopPropagation()}>{props.value}</a>}
  </Show>;
}

/** Media uses a bounded preview; file content is never rendered as a data URL string. */
export function DataPreview(props: { value: unknown; thumbnail?: boolean; fallback?: JSX.Element }) {
  const file = createMemo(() => fileData(props.value));
  const image = createMemo(() => {
    return isInlineImageValue(props.value) ? props.value : undefined;
  });
  const thumbnailSource = createMemo(() => {
    const data = file();
    return data ? data.mimeType.startsWith("image/") && data.size > 0 ? data.url : undefined
      : isImageLike(props.value) ? String(props.value) : undefined;
  });
  const [thumbnailBroken, setThumbnailBroken] = createSignal(() => {
    void thumbnailSource();
    return false;
  });
  return <Show when={props.thumbnail} fallback={<Show when={file()} fallback={
    <Show when={isImageLike(props.value)} fallback={
    <Show when={image()} fallback={
    <Show when={isMarkup(props.value) && props.value} keyed fallback={<Show when={Array.isArray(props.value)}
      fallback={<Show when={plainRecord(props.value)} keyed fallback={<Show when={typeof props.value === "string"}
      fallback={<span class="fenel-import-scalar">{scalarPreview(props.value)}</span>}>
      <DelimitedText value={scalarPreview(props.value)} />
    </Show>}>{(value) => <StructuralReadValue value={value} />}</Show>}><Loading fallback={<span class="fenel-import-scalar" role="status">Preparing data…</span>}>
      <StructuralDataPreview value={props.value} hideCopy />
    </Loading></Show>}>
      {(value) => <div class="fenel-import-markup"><MarkupPreview value={value as ImportedMarkup} budget={{ remaining: 300 }} /></div>}
    </Show>
    }>
      <ImageCanvas value={props.value} />
    </Show>
    }><img class="storybook-img" src={String(props.value)} alt="" loading="lazy" /></Show>
  }>{(data) => <FilePreview data={data()} />}</Show>}>
    <Show when={thumbnailSource() && !thumbnailBroken()} fallback={
      <Show when={image() && image()!.width > 0 && image()!.height > 0} fallback={props.fallback}>
        <ImageCanvas value={props.value} />
      </Show>
    }><img class="storybook-img" src={thumbnailSource()} alt="" loading="lazy" onError={() => setThumbnailBroken(true)} /></Show>
  </Show>;
}

/** A source-selected picture uses the shared media leaf. Its same-identity
 * icon/emoji remains visible while pending or unavailable. A type-icon stays
 * the final fallback. Names stay on the item label. */
export { firstFieldText };

/** The declared field order of the records a container shows (its Table's
 * columns), when the container knows it: served data can arrive with sorted
 * keys, and a record's first field is its type's first, not alphabetical. */
export const ThumbnailFieldOrderContext = createContext<() => readonly string[] | undefined>(() => undefined);

/** True inside a tile's face (`list-tile.tsx`): a list is drawn as tiles because
 * each item's first field is a compact mark, so that field is the face, not an
 * icon every item of the type shares. */
export const ThumbnailTileFaceContext = createContext<() => boolean>(() => false);

export function DataThumbnail(props: { value: unknown; picture?: GlyphPicture; valueIcon?: string; emoji?: string; typeIcon?: string;
  /** The typed reader's existing Fenel plan supplies exact native value text.
   * The circle clips it; its ordinary hover/open surface retains the value. */
  scalarPlan?: SurfaceReadValuePlan }) {
  const fieldOrder = useContext(ThumbnailFieldOrderContext);
  const mark = createMemo(() => thumbnailMark(props.valueIcon, props.emoji, props.typeIcon, LUCIDE_BY_NAME, TYPE_ICON_FALLBACKS.Data));
  const iconName = () => { const current = mark(); return current.kind === "icon" ? current.name : undefined; };
  const emojiText = () => { const current = mark(); return current.kind === "emoji" ? current.text : undefined; };
  // A record with no picture, icon or emoji of its own (only the generic
  // mark is left) shows its first field instead, as that value shows alone:
  // a transaction reads 12, a letter reads its capital. Identical generic
  // circles told the items of a list apart by nothing.
  const tileFace = useContext(ThumbnailTileFaceContext);
  const fieldText = createMemo(() => {
    const current = mark();
    if (current.kind !== "icon") return undefined;
    // The three marks no type authored: plain data, a record, a type without an icon.
    const generic = current.name === TYPE_ICON_FALLBACKS.Data || current.name === TYPE_ICON_FALLBACKS.Record || current.name === TYPE_ICON_FALLBACKS.Type;
    return iconMarkText(props.value, { generic, valueIcon: !!props.valueIcon, tileFace: tileFace() }, fieldOrder());
  });
  // A record holding its own picture (a declared Image field with a value)
  // shows it above any icon or emoji (Person's type icon reached here as the
  // value's icon and hid every photo); only a source picture stays first.
  const ownPicture = createMemo(() => ownPictureMark(props.value, !!props.picture, fieldOrder()));
  return <span class="fenel-data-thumbnail" aria-hidden="true">
    <GlyphPictureImage picture={props.picture} fallback={<Show when={props.scalarPlan} fallback={<DataPreview value={ownPicture() ?? props.value} thumbnail fallback={<Show when={emojiText()} fallback={
      <Show when={fieldText()} fallback={<span data-thumbnail-icon={iconName()}><IconByName name={iconName()} size={24} /></span>}>
        {text => <span data-thumbnail-field>{text()}</span>}
      </Show>}>
      {(glyph) => <span data-thumbnail-emoji={glyph()}>{glyph()}</span>}
    </Show>} />}>
      {plan => <span data-thumbnail-text title={plan().text}>{plan().text}</span>}
    </Show>} />
  </span>;
}

function FilePreview(props: { data: { url: string; name: string; mimeType: string; size: number } }) {
  // Browser failure belongs to the file, even when its mounted slot is reused.
  const [broken, setBroken] = createSignal(() => {
    const file = props.data;
    void [file.url, file.mimeType, file.size];
    return false;
  });
  const empty = () => props.data.size <= 0 || /;base64,$/i.test(props.data.url);
  const showImage = () => props.data.mimeType.startsWith("image/") && !empty() && !broken();
  return <div class="fenel-import-file">
    <Show when={!empty()} fallback={<span class="fenel-import-file__name">{props.data.name}</span>}>
      <a class="fenel-import-file__name" href={props.data.url} download={props.data.name}>{props.data.name}</a>
    </Show>
    <span class="text-muted">{empty() ? "This file is empty" : `${props.data.mimeType} · ${props.data.size.toLocaleString()} bytes`}</span>
    <Show when={showImage()}>
      <img class="storybook-img" src={props.data.url} alt="" loading="lazy" onError={() => setBroken(true)} />
    </Show>
    <Show when={broken() && !empty()}><span class="text-muted">The picture could not be shown.</span></Show>
    <Show when={!empty() && props.data.mimeType.startsWith("audio/")}><audio controls preload="metadata" src={props.data.url} /></Show>
    <Show when={!empty() && props.data.mimeType.startsWith("video/")}><video controls preload="metadata" src={props.data.url} /></Show>
  </div>;
}
