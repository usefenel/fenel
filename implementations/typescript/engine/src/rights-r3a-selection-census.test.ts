// ---------------------------------------------------------------------------
// rights R3a §6 pin 3 — THE CLOSED SELECTION CENSUS, SCAN-BUILT.
//
// The REQUIRED visibility parameter on `resolve` / `listMatchingInstances` /
// `satisfies` / `implementedBy` is a FLOOR, not the fence (brief Ruling 2). It
// proves requiredness over an API's callers; it says nothing about the
// production sites that select straight out of `listInstances`, and nothing at
// all about HAND-TYPED STRUCTURAL FACADES — a two-argument `resolve` written out
// inline in an object literal or a structural type does not fail `tsc` when the
// real registry gains a third parameter.
//
// So this test SCANS the production tree and classifies every occurrence. A new
// raw selector, or a new two-argument facade, lands in no class and reddens it.
//
// ⚠ THE SCAN ROOTS MATTER. `engine/src` alone leaves
// `fenel/modules/prover/ffi/prover-ffi.ts` invisible to BOTH the compiler and
// this pin, which is exactly the hole Ruling 2 names.
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const REPO = resolve(import.meta.dir, "../../../..");

/** Ruling 2's four roots, verbatim. */
const ROOTS = [
  "implementations/typescript/engine/src",
  "implementations/typescript/runtime/src",
  "fenel/modules",
  "distros/narthex/solid/src",
] as const;

/** Only `ffi/` TypeScript counts under `fenel/modules` — the content gate
 *  permits `.ts` there and nowhere else beneath it. */
function underScan(rel: string): boolean {
  const p = rel.split(sep).join("/");
  if (p.startsWith("fenel/modules/")) return p.includes("/ffi/");
  return true;
}

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git" || entry === "generated") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    // A TEST is not a production selection site. The production fence is what
    // this pin is for; a test that selects raw is selecting from its own fixture.
    if (/\.(test|spec)\.tsx?$/.test(entry)) continue;
    if (/fixture\.tsx?$/.test(entry)) continue;
    if (/\.probe\.tsx?$/.test(entry)) continue;
    const rel = relative(REPO, full);
    if (underScan(rel)) out.push(rel.split(sep).join("/"));
  }
  return out;
}

const FILES = ROOTS.flatMap((root) => walk(join(REPO, root), []));

// ---------------------------------------------------------------------------
// Occurrence scanning. Comments and string literals are blanked first, so a call
// written inside prose is not a call.
// ---------------------------------------------------------------------------

/** ONE scanner, TWO masks.
 *
 *  ⚠ THEY MUST BE THE SAME MACHINE (review round 8, Astra). Round 6 added a
 *  separate comment-only mask written as a naive pass that stepped OVER a whole
 *  template literal, so a comment inside an INTERPOLATION was never blanked:
 *  `` `${reg.resolve("T", "Codeable", /* no third arg *\/)}` `` classified
 *  `required` and the whole census stayed green. Template TEXT is opaque and
 *  `${…}` is code — that distinction has to hold in both masks, and the only
 *  way to keep it true in both is to have one implementation.
 *
 *  `blankStrings` is the ONLY difference: the separator scan wants literals
 *  gone (a comma inside a string is not an argument boundary), and the
 *  emptiness scan wants them kept (a string IS an argument; a comment is not).
 *  Length-preserving either way, so indices stay comparable with the raw text.
 */
function maskSource(src: string, blankStrings: boolean): string {
  const out = src.split("");
  const n = src.length;
  let i = 0;
  // A stack of template-literal depths. `code` means ordinary code (possibly
  // inside a `${…}`); `text` means template-literal TEXT.
  const modes: string[] = ["code"];
  const braces: number[] = [0];
  const blank = (at: number): void => {
    if (src[at] !== "\n") out[at] = " ";
  };
  const blankIfStrings = (at: number): void => {
    if (blankStrings) blank(at);
  };
  while (i < n) {
    const mode = modes[modes.length - 1]!;
    const c = src[i]!;
    if (mode === "text") {
      if (c === "\\") { blankIfStrings(i); blankIfStrings(i + 1); i += 2; continue; }
      if (c === "`") { blankIfStrings(i); modes.pop(); braces.pop(); i += 1; continue; }
      if (c === "$" && src[i + 1] === "{") {
        // the interpolation is CODE — leave it for the code branch
        blankIfStrings(i); blankIfStrings(i + 1);
        modes.push("code"); braces.push(1);
        i += 2; continue;
      }
      blankIfStrings(i); i += 1; continue;
    }
    // ---- code mode ----
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") { blank(i); i += 1; }
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const e = src.indexOf("*/", i + 2);
      const stop = e < 0 ? n : e + 2;
      while (i < stop) { blank(i); i += 1; }
      continue;
    }
    if (c === '"' || c === "'") {
      // A quoted literal cannot span a line; an apostrophe that never closes on
      // its line is not a string opener (most often a regex character class),
      // and treating it as one inverts the parity for the whole rest of the
      // file.
      let j = i + 1;
      let closed = false;
      while (j < n && src[j] !== "\n") {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === c) { closed = true; break; }
        j += 1;
      }
      if (!closed) { i += 1; continue; }
      while (i <= j) { blankIfStrings(i); i += 1; }
      continue;
    }
    if (c === "`") {
      blankIfStrings(i); modes.push("text"); braces.push(0); i += 1; continue;
    }
    if (c === "{") { braces[braces.length - 1] = (braces[braces.length - 1] ?? 0) + 1; i += 1; continue; }
    if (c === "}") {
      braces[braces.length - 1] = (braces[braces.length - 1] ?? 0) - 1;
      if (braces[braces.length - 1] === 0 && modes.length > 1) {
        // the interpolation closes; back to template TEXT
        blankIfStrings(i);
        modes.pop(); braces.pop();
      }
      i += 1; continue;
    }
    i += 1;
  }
  return out.join("");
}

/** Comments AND literals blanked — the view the SEPARATOR scan reads. */
function masked(src: string): string {
  return maskSource(src, true);
}

/** Comments blanked, literal content kept — the view the EMPTINESS tests read.
 *  A comment is not an argument; a string is. */
function maskComments(src: string): string {
  return maskSource(src, false);
}

/** ⚠ BOTH OF THESE TAKE THE MASKED SOURCE (review round 5, Grok). Run over raw
 *  source, a comma inside a STRING was an argument separator:
 *  `reg.resolve("T, extra", "Codeable")` counted THREE and was classified
 *  `required`, so a hand-typed two-argument facade — exactly the shape the
 *  compiler floor cannot see, and the whole reason this census exists — shipped
 *  green. A `)` inside a string would have ended the call early the same way.
 *  The mask is length-preserving, so indices stay comparable with the raw text
 *  that `text` / `justification` are sliced from. */
/** The call or bracket group a STRING LITERAL sits inside, with its callee.
 *
 *  ⚠ A FEW LINES OF CONTEXT IS STILL A WINDOW (review round 12, Astra). The
 *  previous version gave a string-literal occurrence the three lines around it,
 *  so a literal placed immediately BEFORE the guarded call borrowed its
 *  exemption —
 *
 *      const selector = "resolve";                 // ← classified `raw`
 *      const resolve = requireProviderOwnDataMethod<…>(provider, "resolve", …);
 *      legacy[selector]("T", "Codeable");           // ← no occurrence at all
 *
 *  — nine occurrences, zero unclassified, and a two-argument facade through the
 *  computed property. That is the indirect variant of round 10's finding with no
 *  runtime name assembly in it at all. An exemption has to bind to the literal's
 *  OWN role, which is its argument position.
 *
 *  Backwards to the nearest UNMATCHED `(` or `[`, stopping at a `;` or a brace
 *  (a literal in a statement is in no call, and must be classified on its own
 *  terms); forwards to that opener's match; then the callee run in front of it,
 *  including a generic argument list, so `requireProviderOwnDataMethod<…>` is
 *  part of the context and a bare `(…)` group is not mistaken for it. */
function enclosingCallOrGroup(src: string, at: number): string {
  let i = at;
  let depth = 0;
  let opener = -1;
  while (i > 0) {
    const c = src[i - 1]!;
    if (c === ")" || c === "]") depth += 1;
    else if (c === "(" || c === "[") {
      if (depth === 0) { opener = i - 1; break; }
      depth -= 1;
    } else if (c === ";" || c === "{" || c === "}") break;
    i -= 1;
  }
  if (opener < 0) return "";
  const open = src[opener]!;
  const close = open === "(" ? ")" : "]";
  let d = 0;
  let end = opener;
  for (; end < src.length; end += 1) {
    const c = src[end]!;
    if (c === open) d += 1;
    else if (c === close) { d -= 1; if (d === 0) break; }
  }
  // the callee in front of the opener: whitespace, an optional `<…>` generic,
  // then a dotted identifier run
  let head = opener;
  while (head > 0 && /\s/.test(src[head - 1]!)) head -= 1;
  if (src[head - 1] === ">") {
    let g = 1;
    let j = head - 1;
    while (j > 0 && g > 0) {
      j -= 1;
      if (src[j] === ">") g += 1;
      else if (src[j] === "<") g -= 1;
    }
    head = j;
  }
  while (head > 0 && /[A-Za-z0-9_$.]/.test(src[head - 1]!)) head -= 1;
  return src.slice(head, end < src.length ? end + 1 : src.length);
}

function callEnd(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i]!;
    if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}


/** ⚠ TWO SOURCES, AND THEY ARE NOT INTERCHANGEABLE (review rounds 5 and 6).
 *  The SEPARATORS must be counted on the FULL mask, or a comma inside a string
 *  is an argument boundary. The EMPTINESS tests read the COMMENT-ONLY mask, for
 *  the two reasons `maskComments` gives above. */
function topLevelArgCount(masked: string, raw: string, open: number, close: number): number {
  let depth = 0;
  let commas = 0;
  let lastComma = -1;
  for (let i = open; i < close; i += 1) {
    const c = masked[i]!;
    if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") depth -= 1;
    else if (c === "," && depth === 1) { commas += 1; lastComma = i; }
  }
  if (raw.slice(open + 1, close).trim() === "") return 0;
  // ⚠ A TRAILING COMMA IS NOT AN ARGUMENT (review round 4, Astra).
  // `reg.resolve("T", "Codeable",)` counted as THREE and was accepted as
  // carrying a visibility, which it does not.
  if (lastComma >= 0 && raw.slice(lastComma + 1, close).trim() === "") return commas;
  return commas + 1;
}

type Occurrence = {
  readonly file: string;
  readonly line: number;
  readonly name: string;
  readonly args: number;
  readonly spread: boolean;
  readonly text: string;
  readonly statement: string;
  readonly justification: string;
};

/** The STATEMENT the call sits in, INCLUDING the block it heads.
 *
 *  Backwards: to the previous `;` / `{` / `}` / `,` at depth 0 — the start of
 *  the statement. Forwards: to the next depth-0 `;` or `,`, or — if the
 *  statement opens a block — through that block's matching `}`.
 *
 *  ⚠ THE DEPTH-0 COMMA IS A BOUNDARY (review round 5, Grok), and leaving it out
 *  was a live hole on a real production site. `authoring-catalog.ts` spreads
 *  TWO enumerations into one array literal —
 *
 *      ...dispatchRegistry.listInstances("Infixable")
 *        .filter((instance) => instanceVisible(instance, GLOBAL_ONLY)) … ,
 *      ...dispatchRegistry.listInstances("Prefixable")
 *        .filter((instance) => instanceVisible(instance, GLOBAL_ONLY)) … ,
 *
 *  — and without the comma the backward walk ran from the Prefixable call
 *  straight through the comma into the Infixable element and stopped only at
 *  the array's `[`. Infixable's filter then fenced Prefixable's enumeration:
 *  DELETING the Prefixable `.filter(...)` left this pin GREEN while account B's
 *  `Prefixable "+"` row entered every account's editor grammar. An
 *  enumeration's fence has to be in its OWN element.
 *
 *  ⚠ THE BLOCK HALF IS LOAD-BEARING. `for (const x of reg.listInstances(T)) {
 *  if (!instanceVisible(x, v)) continue; … }` puts the enumeration in the head
 *  and the filter in the BODY; a statement that stopped at the head's `)` would
 *  call that raw. Two depth-0 closers are tolerated on the way (the for-head's
 *  `)`, a wrapping call's `)`), which is what keeps it from running away into
 *  the next statement — the failure mode of the line-window this replaced. */
function enclosingStatement(src: string, callStart: number, callEnd: number): string {
  let from = callStart;
  let depth = 0;
  while (from > 0) {
    const c = src[from - 1]!;
    if (c === ")" || c === "]" || c === "}") depth += 1;
    else if (c === "(" || c === "[" || c === "{") {
      if (depth === 0) break;
      depth -= 1;
    } else if ((c === ";" || c === ",") && depth === 0) break;
    from -= 1;
  }
  let to = callEnd + 1;
  let depth2 = 0;
  let outerClosers = 0;
  while (to < src.length) {
    const c = src[to]!;
    if (c === "{") {
      if (depth2 === 0) {
        const close = matchingBrace(src, to);
        return src.slice(from, close < 0 ? src.length : close + 1);
      }
      depth2 += 1;
    } else if (c === "(" || c === "[") depth2 += 1;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth2 === 0) {
        outerClosers += 1;
        if (outerClosers > 2) break;
      } else depth2 -= 1;
    } else if ((c === ";" || c === ",") && depth2 === 0) { to += 1; break; }
    to += 1;
  }
  return src.slice(from, to);
}

function matchingBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i]!;
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** `@fenel/db` exports an unrelated `listInstances(accountId, typeName?)` that
 *  reads DATABASE rows. These files import it; a bare `listInstances(` in them
 *  is that function, not the registry's. Enumerated rather than inferred from
 *  the dot, because the dot also hid three real spellings of a raw selector. */
const DB_LIST_INSTANCES_FILES = new Set<string>([
  "implementations/typescript/runtime/src/handlers/dispatch.ts",
  "implementations/typescript/runtime/src/handlers/state.ts",
]);

/** `const { listInstances } = reg;` / `const { resolve, satisfies } = reg;` — a
 *  destructuring that lifts a selector off a registry.
 *
 *  ⚠ THE WINDOW IS THE ENCLOSING STATEMENT, not a line count and not a byte
 *  count (review round 4, Astra). Two lines missed the multiline spelling
 *  entirely —
 *
 *      const {
 *        version,
 *        listInstances: rows,
 *      } = registry;
 *
 *  — so the destructure rule depended on FORMATTING. A 200-character lookback
 *  was the other failure: it matched a function PARAMETER LIST, because
 *  `(set: SetExpr, resolve?: RefResolve)` sits inside an enclosing `{`. The
 *  statement walk is bounded by the previous `;` / `}` / `{` at depth 0, which
 *  is exactly the construct a destructuring is. */
const DESTRUCTURE_RE = /(?:const|let|var)\s*\{[^}]*$/;

function lineWindowBefore(src: string, at: number): string {
  let from = at;
  let depth = 0;
  while (from > 0) {
    const c = src[from - 1]!;
    if (c === "}" || c === ")" || c === "]") depth += 1;
    else if (c === "{" || c === "(" || c === "[") {
      if (depth === 0) break;
      depth -= 1;
    } else if (c === ";" && depth === 0) break;
    from -= 1;
  }
  // include the opener itself, which is what `DESTRUCTURE_RE` matches on
  const opener = src.lastIndexOf("{", from);
  const start = opener >= 0 && opener > from - 400 ? opener - 12 : from;
  return src.slice(Math.max(0, start), at);
}

const SELECTORS = [
  "listInstances",
  "resolve",
  "satisfies",
  "listMatchingInstances",
  "implementedBy",
] as const;

/** `args` sentinel for a bracket access in TYPE position. It selects nothing —
 *  it names a member type — and is distinguished from an ALIAS (`-1`), which
 *  is a selection in waiting. */
const TYPE_POSITION = -2;

/** The arity at which a selection API call carries its REQUIRED visibility. */
const REQUIRED_ARITY: Record<string, number> = {
  resolve: 3,
  satisfies: 3,
  listMatchingInstances: 3,
  implementedBy: 2,
};

function occurrences(file: string): Occurrence[] {
  const src = readFileSync(join(REPO, file), "utf8");
  const scan = masked(src);
  const noComments = maskComments(src);
  const found: Occurrence[] = [];
  // ⚠ THE BRACKET SPELLING IS AN OCCURRENCE TOO. `reg["listInstances"](…)`
  // would otherwise be invisible: the name sits inside a string literal, which
  // the mask blanks.
  const unmasked = src;
  for (const name of SELECTORS) {
    // NO RECEIVER REQUIREMENT. Demanding an identifier before the `[` made
    // the detector NARROWER than the one it replaced — `(expr)["resolve"](…)`
    // has a `)` there — and a detector a parenthesis defeats is not one.
    const bracketRanges: Array<readonly [number, number]> = [];
    for (const m of unmasked.matchAll(
      new RegExp('\\[\\s*["\']' + name + '["\']\\s*\\]', "g"),
    )) {
      const at = m.index ?? 0;
      const end = at + m[0].length;
      bracketRanges.push([at, end]);
      const line = src.slice(0, at).split("\n").length;
      let k = end;
      while (k < src.length && /\s/.test(src[k]!)) k += 1;
      if (src[k] === "(") {
        // ⚠ A BRACKET CALL IS A CALL, AND ITS ARITY IS REAL (review round 7,
        // Grok). Recording `args: 0` made `reg["resolve"]("T","Codeable")` —
        // a two-argument facade the compiler floor cannot see — classify
        // `not-dispatch`, the same bucket as `path.resolve`. Planted in
        // `prover-ffi.ts` it left this pin green while account B's row would be
        // selected for every caller.
        const close = callEnd(scan, k);
        found.push({
          file, line, name,
          args: close < 0 ? -1 : topLevelArgCount(scan, noComments, k, close),
          spread: close >= 0 && scan.slice(k + 1, close).trim().startsWith("..."),
          text: src.slice(at, close < 0 ? at + 120 : Math.min(close + 1, at + 240)),
          statement: close < 0 ? "" : enclosingStatement(scan, at, close),
          justification: "",
        });
        continue;
      }
      // Not called. A TYPE ARGUMENT — `Parameters<DispatchRegistry["resolve"]>`,
      // `requireProviderOwnDataMethod<ConstraintProvider["resolve"]>` — selects
      // nothing: walking back over the receiver IDENTIFIER lands on a `<`.
      // Anything else is a VALUE-position alias and gets the alias treatment,
      // which means it must be enumerated or it is unclassified.
      const head = src.slice(0, at).replace(/\s+$/, "").replace(/[A-Za-z_$][\w$]*$/, "");
      found.push({
        file, line, name,
        args: head.endsWith("<") ? TYPE_POSITION : -1,
        spread: false,
        text: src.slice(at, at + 120),
        statement: "",
        justification: "",
      });
    }

    // ⚠ A SELECTOR NAME HELD IN A STRING IS A SELECTOR NAME (review round 9,
    // Grok). Round 8 taught pin 21 exactly this and the census did not get the
    // lesson: the bracket rule above wants the name INSIDE the brackets, and the
    // identifier scan runs on the full mask, which blanks string literals — so
    //
    //     const sel = "resolve";
    //     mod.dispatchRegistry[sel](aggName, "Aggregable");
    //
    // was invisible to both, a two-argument facade the compiler floor cannot see
    // either, and account B's `Aggregable` row would be selected for every
    // proof. Resolving `sel` needs dataflow, which a scan does not have; NAMING
    // the selector is the shape it can see, and there are nine such literals in
    // the whole production tree, of which seven are the bracket spelling already
    // reported above. The residue is stated rather than hidden: a name assembled
    // at runtime (`"res" + "olve"`, a ternary) still escapes, and no scan can
    // close that — the REQUIRED parameter is the floor underneath it.
    // ⚠ A TEMPLATE LITERAL IS AN EXACT NAME (review round 11, Grok). The
    // quote class was `["']` only, and the identifier scan runs on the FULL
    // mask, which blanks template text — so `const sel = `resolve`; reg[sel](…)`
    // was invisible to both halves. That is not the assembly residue named
    // below; it is the same exact name in the third spelling JavaScript has for
    // writing one.
    for (const m of noComments.matchAll(new RegExp('["\'`]' + name + '["\'`]', "g"))) {
      const at = m.index ?? 0;
      if (bracketRanges.some(([a, b]) => at >= a && at < b)) continue;
      // ⚠ THE TEXT IS JUST THE LITERAL; THE CONTEXT IS A FEW LINES (review
      // round 10, Astra). A ±60-character text window plus the
      // non-distinguishing fragment `'"resolve",'` exempted ANY occurrence
      // near it in that file — `legacy.resolve("resolve", "Codeable")`
      // classified `raw`, a two-argument facade waved through by an exemption
      // meant for a method name three lines away.
      //
      // Two changes, and the second is the one that matters: the raw-stay
      // fragments are now DISTINGUISHING (`requireProviderOwnDataMethod`, not
      // a bare literal), so that planted call's own CALL occurrence — which is
      // found and classified separately — carries nothing that matches and
      // reddens on its own terms. The context is read from the COMMENT-ONLY
      // mask because these fragments are string CONTENT, which the full mask
      // blanks; `enclosingStatement` is the wrong scope here because its
      // depth-0 comma boundary cuts an argument list down to the single
      // argument, and a LINE WINDOW is the wrong scope because a literal
      // borrows its neighbour's exemption (round 12) — see
      // `enclosingCallOrGroup`.
      found.push({
        file, line: src.slice(0, at).split("\n").length, name,
        args: -1, spread: false,
        text: src.slice(at, at + m[0].length),
        statement: enclosingCallOrGroup(noComments, at),
        justification: "",
      });
    }
    let i = 0;
    for (;;) {
      i = scan.indexOf(name, i);
      if (i < 0) break;
      const before = i > 0 ? src[i - 1]! : " ";
      const after = src[i + name.length] ?? " ";
      if (/[A-Za-z0-9_$]/.test(before) && before !== ".") { i += name.length; continue; }
      if (/[A-Za-z0-9_$]/.test(after)) { i += name.length; continue; }
      // ⚠ A BARE REFERENCE IS STILL A SELECTION (review round 1, Fable).
      // Requiring `.name(` meant a destructured `const { listInstances } = reg`,
      // an alias `const sel = reg.listInstances`, or `reg["listInstances"](…)`
      // was never an OCCURRENCE at all — a raw selector could be written in any
      // of those three spellings and the census would not see it.
      //
      // The one thing the dot DID buy is separating the registry's
      // `listInstances` from `@fenel/db`'s unrelated
      // `listInstances(accountId, typeName)`. That is now an explicit
      // exclusion: a file that imports the db surface declares it.
      // ⚠ A DESTRUCTURED BINDING IS AN ALIAS (review round 3, Grok).
      // `const { listInstances } = dispatchRegistry;` has no dot, so the alias
      // rule below never saw it — and in the two db-import files the bare-name
      // skip then swallowed the call it created. A `{ … listInstances … } =`
      // pattern is reported wherever it appears.
      if (before !== "." && DESTRUCTURE_RE.test(lineWindowBefore(src, i))) {
        const line = src.slice(0, i).split("\n").length;
        found.push({
          file, line, name, args: -1, spread: false,
          // a WIDE window: a destructuring's identifying text (`const { … } =
          // await import(…)`) sits to the LEFT of the name.
          text: src.slice(Math.max(0, i - 200), i + name.length + 40),
          statement: enclosingStatement(scan, i, i + name.length),
          justification: "",
        });
        i += name.length;
        continue;
      }
      if (before !== "." && name === "listInstances" && DB_LIST_INSTANCES_FILES.has(file)) {
        i += name.length;
        continue;
      }
      let j = i + name.length;
      while (j < src.length && /\s/.test(src[j]!)) j += 1;
      if (src[j] !== "(") {
        // ⚠ AN ALIASED REFERENCE IS A SELECTION IN WAITING (review round 1,
        // Fable). `const sel = reg.listInstances; … sel("Describable")` never
        // spells the selector at a call site, so a scan that only looks at
        // `name(` sees nothing at all. A PROPERTY ACCESS that is not immediately
        // called is an alias; it lands unclassified unless enumerated, which is
        // the same fence every other spelling gets.
        if (before === "." && !src.slice(j, j + 2).startsWith("]")) {
          const line = src.slice(0, i).split("\n").length;
          found.push({
            file, line, name, args: -1, spread: false,
            text: src.slice(Math.max(0, i - 40), i + name.length + 20),
            statement: enclosingStatement(src, i, i + name.length),
            justification: "",
          });
        }
        i += name.length;
        continue;
      }
      const close = callEnd(scan, j);
      if (close < 0) { i += name.length; continue; }
      const args = topLevelArgCount(scan, noComments, j, close);
      const spread = scan.slice(j + 1, close).trim().startsWith("...");
      const line = src.slice(0, i).split("\n").length;
      const lines = src.split("\n");
      found.push({
        file,
        line,
        name,
        args,
        spread,
        text: src.slice(i, Math.min(close + 1, i + 240)),
        // ⚠ THE ENCLOSING STATEMENT, NOT A LINE WINDOW (review round 1, Fable).
        // A 25-line proximity window classified a raw selector as fenced
        // whenever ANY `instanceVisible(` appeared nearby — so a raw
        // `listInstances` planted ten lines from a fenced one shipped green.
        // The statement is delimited by the previous and next `;` at depth 0
        // from the call, which is what actually ties a filter to ITS
        // enumeration.
        // ⚠ THE STATEMENT IS READ FROM THE MASKED SOURCE (review round 2,
        // Astra). Slicing raw source let a COMMENT fence a call: appending
        // `/* instanceVisible(inst, visibility) */` to a raw enumeration
        // classified it `frame`. Prose cannot filter anything.
        statement: enclosingStatement(scan, i, close),
        // The JUSTIFICATION comment still lives above the call, and it is a
        // different question from whether the call is filtered.
        justification: lines.slice(Math.max(0, line - 13), line).join("\n"),
      });
      i = close;
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// The classes.
// ---------------------------------------------------------------------------

/** RAW-STAYS — a SMALL enumerated literal. Each entry is (file, a distinguishing
 *  source fragment) so it survives line drift, and each says why the occurrence
 *  is not a selection. Growing this list is the thing a reviewer should look at. */
const RAW_STAYS: ReadonlyArray<readonly [string, string, string]> = [
  // ⚠ THE DB DESTRUCTURES, NAMED. `@fenel/db` exports an unrelated
  // `listInstances(accountId, typeName?)` that reads DATABASE rows, and these
  // two files import it by destructuring. The alias rule reports every
  // destructured binding of a selector name — which is what it is for — so the
  // two db imports are enumerated here rather than skipped by a file rule that
  // would also swallow a REGISTRY destructure in the same file.
  [
    "implementations/typescript/runtime/src/handlers/dispatch.ts",
    "const { listInstances } = await import(",
    "the `@fenel/db` database reader, not the dispatch registry's enumeration",
  ],
  [
    "implementations/typescript/runtime/src/handlers/state.ts",
    "const { listInstances } = await import(",
    "the `@fenel/db` database reader, not the dispatch registry's enumeration",
  ],
  [
    "implementations/typescript/engine/src/dispatch-registry.ts",
    "listInstances(typeName?: string): Instance[]",
    "the API DECLARATION and its implementation — the enumeration itself, which every classified selector reads",
  ],
  [
    "implementations/typescript/engine/src/registry.ts",
    "dispatchRegistry.listInstances(typeName)",
    "the context-egress FACADE — it forwards the raw enumeration and every consumer of it is classified here on its own terms",
  ],
  [
    "implementations/typescript/engine/src/registry.ts",
    "dispatchRegistry.listInstances();",
    "the ROUTING PROJECTION — it projects every row WITH its scope and the Fenel resolver filters downstream; filtering here would hide a row from the twin the parity pin compares against",
  ],
  [
    "implementations/typescript/engine/src/system-entities.ts",
    // ⚠ NO STRING LITERAL IN A FRAGMENT: the statement is read from the MASKED
    // source, where literals are blanked, and the raw `text` slice starts at
    // the NAME rather than at the receiver.
    'listInstances("Representational")',
    "BOOT — the marker loop that registers class entities at construction, before any frame exists",
  ],
  [
    "implementations/typescript/engine/src/authoring/source-module.ts",
    "base.listInstances()) local.addInstance(instance);",
    "REGISTRY CONSTRUCTION — the per-account private copy's build loop, not a selection",
  ],
  [
    "implementations/typescript/engine/src/set-algebra.ts",
    "registry.listInstances(ACCOUNT_MEMBERSHIP_CLASS))",
    "OWNER-SCOPED ENUMERATION — `clearAccountNamedSets` walks one account's own `account:<id>:` prefix and removes with that owner",
  ],
  [
    "implementations/typescript/engine/src/set-algebra.ts",
    "accountSpecRegistry().listInstances(ACCOUNT_MEMBERSHIP_CLASS))",
    "OWNER-SCOPED ENUMERATION — `listAccountNamedSets` is the diagnostic 'what does account X have', already keyed by that account's prefix",
  ],
  // ⚠ THE TWO "FRAME-FILTERED ONE LINE BELOW" EXEMPTIONS ARE GONE (review round
  // 3, Grok). The census reads ONE STATEMENT, so an exemption for a filter on
  // the NEXT line was load-bearing: deleting the filter from both FFI
  // enumerations left this pin green, while `field-providers.fenel`'s
  // `getProvider` / `listBindings` would have run another account's provider.
  // The production code chains the filter instead. A fence that needs an
  // exception is not a fence.
  // ⚠ THE TWO SELECTOR NAMES THAT ARE NOT SELECTORS (review round 9, Grok).
  // The string-literal rule above is deliberately blunt — it reports the NAME,
  // because resolving a variable that holds it needs dataflow — so the two
  // places where one of these names is a method name rather than a registry
  // selector are enumerated here, with what they actually are.
  [
    "implementations/typescript/engine/src/engine-bodies-dispatch.ts",
    "requireProviderOwnDataMethod",
    "a ConstraintProvider METHOD NAME handed to the own-data guard, not the dispatch registry's selector",
  ],
  [
    "implementations/typescript/runtime/src/evaluator.ts",
    'HasStateIO", "listInstances',
    "the ACTION_TO_TYPECLASS row for `state.list_instances` — a typeclass METHOD name, not the registry's enumeration",
  ],
  // TS fix re-review (2026-10-03, astra C2 item 2) — the durable purity gate's
  // class-method judgment.
  [
    "implementations/typescript/runtime/src/evaluator.ts",
    "rtJudgedRowsOfClass = registry.listInstances(typeName)",
    "the durable PURITY GATE's over-approximation — every row of the class, whatever its visibility, is JUDGED and none is invoked or returned; reading a row the frame cannot select only makes the placement verdict more conservative, and keeps it independent of the frame's account",
  ],
  [
    "distros/narthex/solid/src/lib/expression-runner/authoring-session-scope.ts",
    "source.listInstances(typeName)",
    "the browser read-only FACADE — it forwards the raw enumeration and every consumer of it is classified here on its own terms, exactly like the engine-side context-egress facade",
  ],
];

function rawStaysReason(o: Occurrence): string | undefined {
  for (const [file, fragment, why] of RAW_STAYS) {
    if (o.file !== file) continue;
    if (o.statement.includes(fragment) || o.text.includes(fragment)) return why;
  }
  return undefined;
}

function classify(o: Occurrence): "required" | "globalOnly" | "frame" | "raw" | "not-dispatch" | "UNCLASSIFIED" {
  // A TYPE-POSITION member access names a type; it selects nothing.
  if (o.args === TYPE_POSITION) return "not-dispatch";
  // An ALIASED reference (args === -1) is never "required" — nothing typechecks
  // it into a visibility — so it must be enumerated or it is unclassified.
  if (o.args < 0) return rawStaysReason(o) !== undefined ? "raw" : "UNCLASSIFIED";
  // ⚠ A SPREAD IS ONLY COMPILER-COVERED WHEN IT IS A TYPED FORWARD (review
  // rounds 2 and 4, Astra). Two ways it is not:
  //   * the callee has no visibility parameter for the tuple to carry —
  //     `registry.listInstances(...["Codeable"] as [string])` is a raw
  //     enumeration wearing a spread;
  //   * the spread is an INLINE ARRAY LITERAL rather than a forwarded
  //     `Parameters<…>` tuple — `reg.resolve(...["T","Codeable"] as [string,
  //     string])` typechecks against a two-parameter structural facade with
  //     zero diagnostics and then throws at runtime reading `visibility.kind`.
  // The covered shape is `f(...args)` where `args` is a BARE IDENTIFIER: that
  // is the forwarder whose tuple type gained the third slot and which therefore
  // breaks at `tsc` like any other caller.
  if (o.spread) {
    const inner = o.text.slice(o.text.indexOf("(") + 1, o.text.lastIndexOf(")")).trim();
    const bareForward = /^\.\.\.[A-Za-z_$][\w$]*$/.test(inner);
    if (bareForward && REQUIRED_ARITY[o.name] !== undefined) return "required";
    return rawStaysReason(o) !== undefined ? "raw" : "UNCLASSIFIED";
  }
  const required = REQUIRED_ARITY[o.name];
  if (required !== undefined) {
    // A one-argument `.resolve(` is a Promise deferral, a template-registry
    // lookup or `path.resolve` — not a dispatch selection at all.
    if (o.args < required - 1) return "not-dispatch";
    if (o.args >= required) {
      return /GLOBAL_ONLY|"globalOnly"/.test(o.text) ? "globalOnly" : "required";
    }
    // EXACTLY one short: a hand-typed facade the compiler cannot see.
    return rawStaysReason(o) !== undefined ? "raw" : "UNCLASSIFIED";
  }
  // `listInstances` — a raw enumeration. It is a selection unless it is filtered
  // or enumerated as a raw-stay.
  // ⚠ THE FILTER MUST BE IN THIS CALL'S OWN STATEMENT.
  if (/instanceVisible\s*\(/.test(o.statement)) {
    return /GLOBAL_ONLY/.test(o.statement) ? "globalOnly" : "frame";
  }
  return rawStaysReason(o) !== undefined ? "raw" : "UNCLASSIFIED";
}

describe("rights R3a — the closed selection census", () => {
  test("pin 3 — every selection occurrence in the production tree is classified", () => {
    // NOT VACUOUS: the four roots really do carry hundreds of these.
    const all = FILES.flatMap(occurrences);
    expect(all.length).toBeGreaterThan(40);

    const unclassified = all
      .filter((o) => classify(o) === "UNCLASSIFIED")
      .map((o) => `${o.file}:${o.line} ${o.name}/${o.args} — ${o.text.split("\n")[0]}`);
    expect(unclassified).toEqual([]);
  }, 200_000);

  // The brief is a private planning document: a public checkout skips this
  // drift check (reported as skipped) instead of passing it.
  const R3A_BRIEF = join(REPO, "workstreams/rights/briefs/r3a-account-partitioned-dispatch.md");
  test.skipIf(!existsSync(R3A_BRIEF))("pin 3 — the GLOBAL_ONLY set is DERIVED from the scan, and every fenced file is named in the brief", () => {
    const all = FILES.flatMap(occurrences);
    const fenced = [...new Set(all.filter((o) => classify(o) === "globalOnly").map((o) => o.file))].sort();

    // NOT VACUOUS: the phase declares fences at more than a handful of files.
    expect(fenced.length).toBeGreaterThanOrEqual(10);

    // ⚠ DERIVED, NOT HAND-COPIED. The brief's §4.5 table is the human-readable
    // census; this asserts the SCAN and the TABLE have not drifted apart, by
    // requiring every fenced file to be named somewhere in the brief. A new
    // fence that nobody wrote down reddens here rather than shipping silently.
    const brief = readFileSync(R3A_BRIEF, "utf8");
    const undocumented = fenced.filter((file) => {
      const base = file.split("/").pop()!;
      return !brief.includes(base);
    });
    expect(undocumented).toEqual([]);
  }, 200_000);

  test("pin 3 — every `raw-stays` entry still matches a real occurrence", () => {
    // A stale exception is the dangerous direction: it silently widens the
    // class the next time a raw selector lands in that file.
    const all = FILES.flatMap(occurrences);
    // ⚠ THE SAME MATCH `rawStaysReason` USES (review round 10, Astra). This
    // tested `justification || text` while the classifier tests
    // `statement || text`, so a live exemption could read STALE here — and did,
    // the moment the string-literal occurrences (whose `text` is just the
    // literal) got their context in `statement`. A liveness check that does not
    // ask the classifier's question is checking a different exemption set.
    const unmatched = RAW_STAYS.filter(([file, fragment]) =>
      !all.some((o) => o.file === file && (
        o.statement.includes(fragment) || o.text.includes(fragment) ||
        o.justification.includes(fragment)
      )),
    ).map(([file, fragment]) => `${file} :: ${fragment}`);
    expect(unmatched).toEqual([]);
  }, 200_000);
});
