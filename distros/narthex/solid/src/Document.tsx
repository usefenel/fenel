import type { ParentProps } from "solid-js";
import { HydrationScript } from "@solidjs/web";

// The document shell — the HTML that used to live inside StartServer's
// `document` prop in src/entry-server.tsx. Start mode picks this up by the
// src/Document.* convention and wraps the app in its generated entries.
// It renders the full <html>; head tags belong here.
//
// In client mode <HydrationScript /> is stripped from the prerendered shell and
// only activates if this app ever flips to `ssr: true` in vite.config.ts.
//
// The SolidStart-era `assets` / `scripts` props and the `<div id="app">` mount
// wrapper are gone: the generated entry injects the client script itself.
export default function Document(props: ParentProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" type="image/png" sizes="64x64" href="/favicon.png" />
        <title>Fenel</title>
        <meta name="description" content="The programming language is the application. Create and use any data, with the full power of functional programming, in one universal app. Alpha preview." />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://usefenel.com/" />
        <meta property="og:title" content="Fenel" />
        <meta property="og:description" content="The programming language is the application. Create and use any data, with the full power of functional programming, in one universal app. Alpha preview." />
        <meta property="og:image" content="https://usefenel.com/og.jpg" />
        <meta name="twitter:card" content="summary_large_image" />

        <link
          rel="preload"
          href="/fonts/rubik/rubik-latin.woff2"
          as="font"
          type="font/woff2"
          crossorigin=""
        />
        <link rel="stylesheet" href="/fonts/rubik/rubik.css" />
        <HydrationScript />
      </head>
      <body>{props.children}</body>
    </html>
  );
}
