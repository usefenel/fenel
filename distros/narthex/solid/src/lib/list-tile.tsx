import { Errored, Loading, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { ValueHoverPreview } from "./value-hover-preview";
import { DataThumbnail, ThumbnailFieldOrderContext, ThumbnailTileFaceContext } from "./data-transfer/DataPreview";
import type { DisplayNameInput } from "./display-name";
import { tileCornerLabel, tileMarkScale } from "./list-tile-model";
import "./list-tile.css";

/** One item of a focused list drawn as a key: its thumbnail (the same mark its
 * circle shows, passed as `children`) enlarged in the middle, and its next
 * piece of identity in the top-left corner. It is the same data as the item's
 * card: the caller passes that card's open, menu and hover-preview owners. */
export function ListTile(props: {
  itemId: string;
  value: unknown;
  /** The item's own caption; a generated position is not passed. */
  caption?: string;
  /** The items' declared field order (their Table's columns), when known. */
  fieldOrder?: readonly string[];
  label: DisplayNameInput;
  menuOpen?: boolean;
  preview: () => JSX.Element;
  onOpen?: () => void;
  onContextMenu?: (event: MouseEvent) => void;
  children: JSX.Element;
}) {
  const corner = () => tileCornerLabel(props.value, props.caption, props.fieldOrder);
  return <div class={["list-tile", { "list-tile--menu-open": !!props.menuOpen }]} data-locus-item={props.itemId}
    data-tile-scale={tileMarkScale(props.value, props.fieldOrder)}>
    <ValueHoverPreview class="list-tile__key" label={props.label} preview={props.preview}
      onOpen={props.onOpen} onContextMenu={props.onContextMenu}>
      <Show when={corner()}>{text => <span class="list-tile__corner">{text()}</span>}</Show>
      <div class="list-tile__mark" inert>
        <Errored fallback={() => <DataThumbnail value={undefined} />}>
          <Loading fallback={<DataThumbnail value={undefined} />}>
            <ThumbnailFieldOrderContext value={() => props.fieldOrder}>
              <ThumbnailTileFaceContext value={() => true}>{props.children}</ThumbnailTileFaceContext>
            </ThumbnailFieldOrderContext>
          </Loading>
        </Errored>
      </div>
    </ValueHoverPreview>
  </div>;
}
