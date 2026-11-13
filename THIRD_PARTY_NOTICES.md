# Third-party notices

Fenel is released under the Apache License 2.0 (see `LICENSE`). The items below
come from others, or are based on the work of others, and keep their own terms.
npm dependencies are not stored in this repository. `bun install` downloads them
with their own licences.

## Fonts

### Rubik

- Files: `distros/narthex/solid/public/fonts/rubik/`
- Source: Google Fonts, Rubik v31, from the `google/fonts` repository.
- Licence: SIL Open Font License 1.1. The full text and the upstream copyright
  notice are in `distros/narthex/solid/public/fonts/rubik/OFL.txt`.
- The font files are not modified. Their sources and SHA-256 hashes are listed
  in the `README.md` of that folder.

### Noto Color Emoji (flags only)

- Files: `distros/narthex/solid/public/fonts/noto-color-flags/`
- Source: Google Fonts, Noto Color Emoji v50, the regional-indicator part
  supplied by Google Fonts.
- Licence: SIL Open Font License 1.1. The full text and the upstream copyright
  notice are in `distros/narthex/solid/public/fonts/noto-color-flags/OFL.txt`.
- The font file is not modified.

## Unicode emoji data

- File: `fenel/modules/encyclopedia/emoji-data.fenel`
- Source: `emoji-test.txt` of Emoji 17.0, Unicode, Inc.,
  https://www.unicode.org/Public/17.0.0/emoji/emoji-test.txt
- Licence: Unicode License v3, https://www.unicode.org/license.txt

The file holds code points, short names, groups and versions taken from that
data file. The Unicode License v3 asks that this notice be kept:

```
UNICODE LICENSE V3

COPYRIGHT AND PERMISSION NOTICE

Copyright © 1991-2026 Unicode, Inc.

NOTICE TO USER: Carefully read the following legal agreement. BY
DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.

Permission is hereby granted, free of charge, to any person obtaining a
copy of data files and any associated documentation (the "Data Files") or
software and any associated documentation (the "Software") to deal in the
Data Files or Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, and/or sell
copies of the Data Files or Software, and to permit persons to whom the
Data Files or Software are furnished to do so, provided that either (a)
this copyright and permission notice appear with all copies of the Data
Files or Software, or (b) this copyright and permission notice appear in
associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
THIRD PARTY RIGHTS.

IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall
not be used in advertising or otherwise to promote the sale, use or other
dealings in these Data Files or Software without prior written
authorization of the copyright holder.
```

## Botanical plates (public domain)

- `distros/narthex/solid/public/demo/encyclopedia/foeniculum-vulgare-koehler-148.jpg`:
  Franz Eugen Köhler, *Köhler's Medizinal-Pflanzen*, plate 148, 1897, from
  Wikimedia Commons. Public domain.
- `distros/narthex/solid/public/demo/encyclopedia/narthex-asafoetida-van-houtte.jpg`:
  a 19th-century hand-coloured lithograph from Louis van Houtte's workshop.
  Public domain.

Small copies of both plates are stored as image data in
`fenel/modules/encyclopedia/`. Details are in the `README.md` of the plates
folder.

## Patch to @solidjs/signals (MIT)

- File: `patches/@solidjs%2Fsignals@2.0.0-rc.7.patch`
- It changes the published `@solidjs/signals` 2.0.0-rc.7 package, which is
  released under the MIT License by its authors. Bun applies the patch at
  install time. The patched package keeps its MIT licence and notice.

## OpenStreetMap map tiles

No map data is stored in this repository. The map views in the web app load
tiles from OpenStreetMap servers in the visitor's browser
(`distros/narthex/solid/src/lib/field-renderer/SpatialMap.tsx`,
`distros/narthex/solid/src/routes/app/home.tsx`). Map data © OpenStreetMap
contributors, available under the Open Database License
(https://www.openstreetmap.org/copyright). Use of the tile servers follows the
OpenStreetMap tile usage policy (https://operations.osmfoundation.org/policies/tiles/).

## Facts taken from public sources

Some encyclopedia data (for example dates in `fenel/modules/encyclopedia/languages.fenel`
and rune names in `fenel/modules/encyclopedia/alphabets.fenel`) are short facts
taken from Wikipedia and GBIF. Each such row links its source.

## Portraits, a book cover, logos and a photograph shown as demo data

The demos show a few pictures of real people, of a book and of other projects
as ordinary data. These pictures are NOT licensed under the Apache License and
the copyright line of this repository does not cover them. All rights in them
stay with their owners. They are here only to show the app with real content.
Do not reuse them, and replace them in any version you publish unless their
owners allow it.

- Pictures of Romain Leclercq, Bayne and Aajonus Vonderplanitz:
  `distros/narthex/solid/public/demo/people/`, the same pictures as Image data
  in `fenel/modules/publicdemo/people-pictures.fenel`, and the portrait of
  Aajonus Vonderplanitz among the sample pictures
  (`implementations/typescript/engine/src/sample-images-extra.ts`, `PORTRAIT`).
- The cover of Aajonus Vonderplanitz's book "We Want to Live":
  `implementations/typescript/engine/src/sample-images-extra.ts`, `BOOK`.
- Logos and banners of other projects (Primal Diet, Healthfully, BayneOS,
  DripCollector, 7CatYear), with the trademarks they carry:
  `distros/narthex/solid/public/demo/projects/` and the same pictures in
  `fenel/modules/publicdemo/people-pictures.fenel`.
- The photograph supplied for the image demo:
  `distros/narthex/solid/public/demo/fennel-market.jpg` and its reduced copy in
  `fenel/examples/image-demo.fenel`.

The Fenel logo and the mascot in those files are covered by `BRAND.md`.
