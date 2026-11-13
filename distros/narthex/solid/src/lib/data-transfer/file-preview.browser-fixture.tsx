// C1: mount the shared renderer once and replace the file at that same slot.
import { createSignal, createStore, flush } from "solid-js";
import { render } from "@solidjs/web";
import { DataPreview } from "./DataPreview";

type PreviewFile = { url: string; name: string; mimeType: string; size: number };
function Fixture() {
  const [mutable, setMutable] = createStore<PreviewFile>({
    url: "https://fenel.test/mutable-broken.png", name: "mutable.png", mimeType: "image/png", size: 120,
  });
  const [value, setValue] = createSignal<PreviewFile>({
    url: "https://fenel.test/broken.png", name: "broken.png", mimeType: "image/png", size: 120,
  });
  globalThis.filePreviewFixture = {
    replace(file) { setValue(file); flush(); },
    useMutable() { setValue(mutable); flush(); },
    replaceUrl(url) { setMutable(draft => { draft.url = url; }); flush(); },
  };
  return <main><h1>File preview</h1><p>A replacement file in the same data slot</p><section id="preview"><DataPreview value={value()} /></section></main>;
}

declare global {
  var filePreviewFixture: { replace(file: PreviewFile): void; useMutable(): void; replaceUrl(url: string): void };
}

render(() => <Fixture />, document.body);
