// Test-only browser entry: real HTTP/auth/cache modules and Solid's DOM sink.
import * as api from "./api";
import * as auth from "./auth";
import * as refs from "./ref-cache";
import * as session from "./browser-session";
import { browserPreviewElement } from "./markup-editor/browser-preview";
import { Dynamic, render } from "@solidjs/web";
import { createEffect, createRoot, createMemo, createSignal, flush } from "solid-js";

export const browserBoundaries = { api, auth, refs, session, browserPreviewElement, Dynamic, render, createEffect, createRoot, createMemo, createSignal, flush };
declare global {
  var fenelBrowserBoundaries: typeof browserBoundaries;
}
globalThis.fenelBrowserBoundaries = browserBoundaries;
