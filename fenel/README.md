# fenel/

This folder holds the Fenel source of the project: the standard library, the
domain modules, the parts of the engine that are written in Fenel, and the
example programs. The TypeScript engine in `implementations/typescript/engine/`
loads these files; behaviour lives here and the TypeScript side supplies the
host actions Fenel cannot perform itself.

## Layout

```
fenel/
  modules/<area>/   one module per area: std, engine, time, codec, view, ...
    *.fenel         the module's types, functions and instances
    ffi/*.ts        host leaves for the module's @native declarations
  std/              core types and classes: foundation types, interfaces,
                    algebra (Functor, Monad, ...), dispatch instances,
                    and the system entity types under std/entities/
  examples/         example programs; the solver and image examples are
                    also loaded as public demos
```

Some areas worth knowing:

- `modules/std/` is the standard library (numbers, text, lists, documents and images).
- `modules/engine/` is engine logic written in Fenel: the lexer and grammar,
  type checking and inference, the set judgment behind subtyping, and the
  compilers' passes.
- `modules/publicdemo/` and `modules/encyclopedia/` are the data and functions
  of the public demos.

## What a module looks like

Most files start with a module header such as `module std where`; for a file
without one, the TypeScript loader that reads it supplies the module name.
Each function has an optional label, description and tags, a type signature,
and a body. This is
`modules/std/clamp.fenel`, without its comment header:

```fenel
module std where

@label "Clamp"
@description "Constrain a number between min and max"
@tags "numeric" "constraint"
clamp : (x: Number) -> (lo: Number) -> (hi: Number) -> Number
clamp x lo hi = if lt x lo then lo else if gt x hi then hi else x
```

Types are declared the same way, for example
`Shape = Circle radius: Number | Rect width: Number height: Number` in
`examples/demo.fenel`. A declaration marked `@native` has a signature and no
body; its implementation is a single host action in the module's `ffi/` folder
(for example `modules/time/ffi/time-ffi.ts` reads the clock).

## How the engine loads it

1. A TypeScript module in `implementations/typescript/engine/src/modules/`
   imports the source text (`import SRC from ".../clamp.fenel?raw"`).
2. `loadFenelModule` or `loadFenelModuleUnion` (`engine/src/fenel-module.ts`)
   parses the text into a module value: its functions, types and instances.
   Labels and descriptions become instances that the app shows.
3. `createRegistry` (`engine/src/registry.ts`) indexes the modules, and the
   evaluator runs the bodies.

Parse results are kept in a generated cache
(`engine/src/generated/parse-cache.generated.ts`), so unchanged sources are not
parsed again at start-up. After editing a `.fenel` file, refresh it with
`FENEL_PARSER_LEGACY=1 bun implementations/typescript/engine/scripts/generate-parse-cache.ts --incremental`.

Files here are stored with LF line endings (`.gitattributes`), because the
generated artifacts are keyed by the exact bytes of each source.
