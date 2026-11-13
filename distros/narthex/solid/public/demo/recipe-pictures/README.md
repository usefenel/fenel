# Recipe pictures

These are the project's own pictures of the recipe demo's foods and food
groups. They were generated for Fenel with an AI image-generation tool on
2026-11-11. They are the project's own work, under the project's licence.
The files here are the 256 px versions of larger originals (reduced with a
high-quality bicubic filter, transparency kept); the originals are not
published.

| File | Stands for |
| --- | --- |
| `butter.png` | Butter |
| `coconut-cream.png` | Coconut cream |
| `cream.png` | Cream |
| `honey.png` | Honey |
| `lemon.png` | Lemon juice |
| `egg.png` | Egg |
| `tomato.png` | Tomato |
| `watermelon.png` | Watermelon |
| `cucumber.png` | Cucumber |
| `dairy.png` | `DairyFood` (round badge) |
| `plant-foods.png` | `PlantFood` (round badge) |
| `animal-foods.png` | `AnimalFood` (round badge) |
| `fruits.png` | `FruitFood` (round badge) |
| `bland-fruits.png` | `BlandFruit` (round badge) |

`provenance.json` records, for each file, the constructor or category it stands
for, its definition name, what it shows, its origin, its SHA-256, byte size,
dimensions and the size of its preview.

The `RecipeFunctions` definitions in
`fenel/modules/publicdemo/recipe-pictures.fenel` hold 64×64 previews of these
pictures as ordinary Image data: one packed RGBA word per pixel, decoded by
`std.imageFromPackedRgba` only when a reader asks for a food's Picturable
reference. The PNG files are the source of those previews; the app does not
substitute their URLs for the Image values.

Until 2026-11-11 the demo used Microsoft Fluent Emoji 3D pictures (MIT
licence). They are no longer served, and no Fluent pixel remains in the Fenel
source.
