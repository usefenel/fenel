# Fenel

Codex-Data

The programming language is the application.  
Lisp meets Haskell which enables Smalltalk, + Prolog, + Coq, + ...

The rest of the README is written by LLMs for now.

---

Fenel is a typespace: a programming language, a runtime and an app in which
one description of your data is at once its type, its interface and its
application. The idea fits in one line: types = UI = app. A type says what your
data means. The form that edits the data, the rules that check it and the way it
is shown come from that type. Functions, types and records are the same kind of
thing: data a person can open, read and change.

Fenel started as a funnel builder. It then grew to take in everything else its
author had been working on, and trying to bring together, for fifteen years.

## Today

The site is live at https://usefenel.com. The demos run entirely in your
browser. No account is needed.

A type is a set of values, and its rule belongs to the type. This one comes
from the demos:

```
HintPassword = String | length value >= 8 && containsAnUppercaseLetter value && containsADigit value && containsASpecialCharacter value && containsNoBirthYear value && repeatsNoCharacterThreeTimes value
```

In the sign-up demo, each part of the rule is its own hint while you type: met,
can still be met, or can no longer be met.
https://usefenel.com/demo/Input%20checking/Sign%20up%20with%20live%20hints

When the solver cannot decide, it says so. It solves linear equations exactly
over the rationals. Give it `x * x = target` and it answers "Undecided", which
is not the same as "no solution".
https://usefenel.com/demo/Solver/An%20unsupported%20equation

Every demo has an address of the form `/demo/<collection>/<item>`. A few more:

- A recipe written as an ordinary function, which you can read and run:
  https://usefenel.com/demo/Recipe%20functions/Sports%20formula
- Solve an equation, then change its numbers:
  https://usefenel.com/demo/Solver/Solve%20an%20equation
- The tree of life as nested sets, from all life down to species:
  https://usefenel.com/demo/Tree%20of%20life/Tree%20of%20life
- Fenel's own project record, linked to its author and to the plants it is named after:
  https://usefenel.com/demo/People%20and%20projects/Fenel

"Edit in Local" copies some demos into Local. There you make your own types,
data and functions. Local data stays in your browser. It is not synced or
backed up.

Not there yet:

- Accounts and server features are not open. "Log in" is not active.
- Fenel is early and experimental. The first visit downloads a large engine and
  takes a while. Phones work less well than desktop browsers for now.

## Where this is going

These are goals, not features you can use today.

- **One language from programming to the application.** The same values serve
  the person who writes code and the person who uses the app.
- **An interface that can author everything the language expresses.** Every
  kind of type, every expression, every instance. A new language form gets its
  interface in the same change.
- **A small core.** Types are sets, and subtyping is inclusion. Records and
  variants are layers over a few primitives. Proving, solving and checking are
  faces of one question: whether one set lies inside another.
- **One mechanism for behaviour.** Typeclasses, effects, modules, dependency
  injection and capabilities become one thing: a value found by type, in scope.
- **Values describe, frames empower.** Holding a function never gives the power
  to act. Every act on the outside world is checked against the authority of
  the context it runs in.
- **Everything has an address.** The path after the domain is the path to a
  value. The same path will give programs its API.
- **A living encyclopedia.** Reference data as typed values you can search with
  functions and cut into your own types.

Correctness comes first. Performance comes next.

## Names

- **Fenel** is the language. Its source files end in `.fenel`.
- **The engine** holds the type checker, the evaluator and the standard library.
  Much of it is written in Fenel.
- **The reference runtime** is the TypeScript implementation around the engine.
- **Narthex** is the web app at usefenel.com. Narthex is the Greek name of giant
  fennel.

## Running it

You need [Bun](https://bun.sh) 1.3.13 and Git.

```sh
git clone https://github.com/usefenel/fenel.git
cd fenel
bun install --frozen-lockfile
cd distros/narthex/solid
bun --bun run dev
```

Then open http://localhost:3100. The demos and Local run in the browser. No
API server and no database are needed for them.

To build the static site instead: `bun --bun run build` in the same folder.
It writes `dist/client`.

What this release does not support yet:

- running the API server with your own database (there is no setup script for
  a fresh database yet);
- accounts and log in;
- payments;
- the Telegram bot.

The code for these is in the repository, but there is no supported way to run
it yet.

## What is in this repository

- `fenel/`: the Fenel source. The standard library, the parts of the engine
  written in Fenel, and the demos.
- `implementations/typescript/engine/`: the engine in TypeScript, with its
  generated files in `src/generated/`.
- `implementations/typescript/runtime/`: the runtime that runs Fenel programs
  and their effects.
- `implementations/typescript/api/`: the HTTP API server.
- `implementations/typescript/core/`: code shared by the API, the bot, the
  runtime and the web app.
- `implementations/typescript/db/`: the database schema and queries
  (PostgreSQL).
- `implementations/typescript/bot/`: the Telegram bot.
- `distros/narthex/solid/`: Narthex, the web app.
- `runtime/llvm-rt.c`: C helpers called by LLVM code compiled from Fenel (used
  by the LLVM tests).
- `patches/`: a patch applied to one dependency at install time.

`AGENTS.md` lists the checks and the conventions. `CONTRIBUTING.md` says how to
contribute.

## Licence

Licensed under the Apache License 2.0. See `LICENSE`.

The name Fenel, the logo and the mascot are not covered by that licence. See
`BRAND.md`. Third-party parts are listed in `THIRD_PARTY_NOTICES.md`.

Copyright 2026 Romain Leclercq.

## Contact

- Email: contact@usefenel.com
- X: https://x.com/usefenel
- YouTube: https://youtube.com/@usefenel
- Telegram: https://t.me/usefenel
- GitHub: https://github.com/usefenel
