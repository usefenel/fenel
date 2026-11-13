# Notes for coding agents and contributors

Short rules for working in this repository. `README.md` says what Fenel is.

## Layout

- `fenel/`: the Fenel source (`.fenel` files): the standard library, the engine
  parts written in Fenel, and the demo modules.
- `implementations/typescript/engine/`: the reference engine (type checker,
  evaluator, compiler steps) and its generated artifacts in `src/generated/`.
- `implementations/typescript/runtime/`, `api/`, `core/`, `db/`, `bot/`: the
  runtime, the HTTP API, shared code, the database layer and the Telegram bot.
- `distros/narthex/solid/`: Narthex, the web app (Solid and Vite).

## Conventions

- Write behaviour in Fenel. Predicates, arithmetic, parsing, validation and
  control flow belong in `.fenel` files under `fenel/modules/<area>/`.
  TypeScript is for input and output (HTTP, database, files, clock, random),
  the evaluator itself, and tests and tools.
- No null. Use `Maybe a = Nothing | Just a` and `Result e a = Err e | Ok a`.
  Variant payloads are positional: `Just x`, stored as `{$tag: "Just", _0: x}`.
- Types are sets of values. Subtyping is inclusion. To compare types, call the
  existing decider (`decideSubset`, `setAlgebraIsSubset`); do not write a new
  comparison.
- When a type cannot be decided, the answer is "unknown" (`Nothing`), never a
  wrong yes or no.
- A new language form gets its editor in the web app in the same change.
- Fixed choices are variants with nullary constructors, not string enums.

## Generated artifacts

Every byte under `fenel/` and `implementations/typescript/engine/src/`, plus a
few root files (`package.json`, `bun.lock`, `.fenel.lock`, `.gitattributes`,
`tsconfig.base.json`, the `patches/` file, and the engine's `package.json` and
`tsconfig.json`), feeds the generated files in
`implementations/typescript/engine/src/generated/`. If you change one of them:

```sh
FENEL_PARSER_LEGACY=1 bun implementations/typescript/engine/scripts/generate-parse-cache.ts --incremental
bun implementations/typescript/engine/scripts/generate-identity-artifacts.ts
```

The second command is long (an hour or more). Do not edit generated files or
their stamps by hand. Without fresh artifacts the engine still runs, through
slower interpreted paths.

## Checks

Install once:

```sh
bun install --frozen-lockfile
```

The code checks (run all five after a change to engine, runtime or `.fenel` code):

```sh
bun --no-env-file node_modules/typescript/bin/tsc --noEmit --incremental --tsBuildInfoFile .tmp-tsc/engine.tsbuildinfo -p implementations/typescript/engine/tsconfig.json
bun --no-env-file node_modules/typescript/bin/tsc --noEmit --incremental --tsBuildInfoFile .tmp-tsc/runtime.tsbuildinfo -p implementations/typescript/runtime/tsconfig.json
bun --no-env-file node_modules/typescript/bin/tsc --noEmit --incremental --tsBuildInfoFile .tmp-tsc/scripts.tsbuildinfo -p implementations/typescript/engine/tsconfig.scripts.json --pretty false
bun implementations/typescript/engine/scripts/audit-effects.ts --no-laws --ci
bun implementations/typescript/engine/scripts/ambient-read-census.ts --check
```

Run tests one file at a time, with a leading `./`:

```sh
bun test --timeout 60000 ./implementations/typescript/engine/src/<name>.test.ts
```

Do not run the whole engine test folder at once: it takes hours.

Some database tests write to the database named by `DATABASE_URL`. Never point
it at a database you care about.

## Web app

```sh
cd distros/narthex/solid
bun --bun run dev     # http://localhost:3100
bun --bun run build   # writes dist/client
```

The public pages and Local work without the API server.
