# Noto Color Flags webfont asset

Vendored on 2026-11-10 from the official Google Fonts Noto Color Emoji v50
stylesheet. The application serves the unmodified WOFF2 from its own origin;
visitors make no Google Fonts request.

This is the stylesheet's regional-indicator shard (`.0.woff2`), using COLRv1
color glyphs. Its exact published Unicode range is `U+1F1E6-1F1FF`. The shared
font stack selects it before Rubik only for these characters, allowing Unicode
flag sequences to render in color on Windows Chromium while ordinary text and
other emoji keep their existing fonts. It loads lazily and uses `font-display:
swap`; the system fallback may appear briefly before the font is ready.

No glyphs have been added, removed or changed. The subset was supplied by
Google Fonts; Fenel performs no local font transformation.

Source stylesheet: [Google Fonts Noto Color Emoji](https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&display=swap)
(Chrome 130 Windows user agent, retrieved 2026-11-10).
Font source: [Google Fonts v50 regional-indicator WOFF2](https://fonts.gstatic.com/s/notocoloremoji/v50/Yq6P-KqIXTD0t4D9z1ESnKM3-HpFabsE4tq3luCC7p-aXxcn.0.woff2).
Upstream font family: [google/fonts Noto Color Emoji](https://github.com/google/fonts/tree/c08cd288696d8ca30bf0296dc214d80d33a65d8f/ofl/notocoloremoji).
Redistribution license: [SIL OFL 1.1](OFL.txt), including the upstream copyright
notice; [pinned license source](https://raw.githubusercontent.com/google/fonts/c08cd288696d8ca30bf0296dc214d80d33a65d8f/ofl/notocoloremoji/OFL.txt).

| File | Bytes | SHA-256 |
|---|---:|---|
| noto-color-flags-v50.woff2 | 708608 | cefc94c2f60f784c50b48bab499b4e9b1e7c3870f92091627555a35967b30552 |
| OFL.txt | 4386 | ac564676d10054a8445923dfc2dfb13c042d97888bd27c1b6ec6dfe89a9d8d62 |

To refresh, retrieve the official stylesheet using a modern Chromium user
agent, vendor its regional-indicator shard without modifying its bytes, retain
the exact Unicode range and matching license, and update this provenance table.
Verify color flags in the actual application on Windows Chromium, with external
font requests blocked, while checking ordinary Latin, Greek and emoji text.
