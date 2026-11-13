# Contributing to Fenel

Thank you for your interest. Fenel is early, and its development happens in a
private source tree. This public repository is a copy of that tree, released
from time to time as a new commit.

## How a contribution travels

1. You open an issue or a pull request here.
2. A maintainer reviews it on GitHub.
3. If it is accepted, the maintainer applies your commits to the private tree
   with your name and e-mail kept as the author.
4. Your change appears here in the next public release. The pull request is
   then closed with a link to that release.

So a pull request is not merged with the GitHub button. That is expected.

## Sign your commits (DCO)

Every commit must carry a `Signed-off-by` line. It certifies that you wrote
the change, or have the right to submit it, under the terms of the
[Developer Certificate of Origin 1.1](https://developercertificate.org/):

```
Signed-off-by: Your Name <you@example.com>
```

`git commit -s` adds the line for you. Use your real name. A commit without the
line cannot be applied.

Contributions are accepted under the Apache License 2.0, the licence of this
repository (see `LICENSE`, section 5).

## Before you open a pull request

- Keep a change small and about one thing.
- Run the checks listed in `AGENTS.md` that apply to the files you changed.
- Do not commit `.env` files, database dumps or credentials.
- Files under `fenel/` and `implementations/typescript/engine/src/` feed
  generated artifacts. A change there may need those artifacts to be
  regenerated. Say so in the pull request if you could not do it; a maintainer
  can.

## Reporting a security problem

Please do not open a public issue. See `SECURITY.md`.
