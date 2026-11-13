import heroSrcset from "~/assets/hero.jpg?w=640;960;1200;2400&format=webp&as=srcset";
import heroFallback from "~/assets/hero.jpg?w=1200";
import heroPixels from "~/assets/hero.jpg?w=80&format=webp&inline";
import { onSettled } from "solid-js";
import "./locus-background.css";

/** The landing illustration is the shared locus backdrop until backgrounds
 *  have an authored Fenel value and an asset/fitting contract. */
export function LocusBackground(props: { pixelated?: boolean } = {}) {
  let image: HTMLImageElement | undefined;
  onSettled(() => {
    if (image?.complete && image.naturalWidth > 0) image.setAttribute("data-ready", "");
  });
  return (
    <div class="locus-background" aria-hidden="true">
      <img
        srcset={props.pixelated ? undefined : heroSrcset}
        src={props.pixelated ? heroPixels : heroFallback}
        sizes="(max-width: 1264px) calc(100vw - 4rem), 1200px"
        alt=""
        class={["locus-background__image", { "locus-background__image--pixelated": !!props.pixelated }]}
        ref={element => { image = element; }}
        onLoad={event => event.currentTarget.setAttribute("data-ready", "")}
        width="1200"
        height="665"
        decoding="async"
        draggable="false"
      />
    </div>
  );
}
