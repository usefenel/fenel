// parser-substrate Phase 4 — the DECLARATION-grammar differential for the
// Fenel declaration grammar (`fenel/modules/engine/decl-grammar.fenel`). brief:
// `workstreams/parser-substrate/briefs/phase-4-declaration-grammar.md`.
//
// THE DECL-LEVEL ORACLE (the Phase-4 parity contract, one level BELOW
// FenelModule):
//   fenelSide = parseProgToks table null (layoutTokens (lexAll src)) ⇒ Just [{frame, directives}]
//   tsSide    = flattenProgram(parse src), normalised:
//                 def  ⇒ body compared in Syntax space (dispatchedJsonLogicToSyntax, no ctorDefs)
//                 sig  ⇒ type compared via the marker→`$`-key marshal (walkType, below)
//                 directives / module ⇒ `$`-free, compared directly
//   assert deepEqual(fenelSide.map(normFenel), tsSide)
//
// THE TYPE MARSHAL (`walkType`) — sanctioned test-harness TS (TS-ledger
// category (c)) AND the deliberate PROTOTYPE of Phase 5's ONE ledgered loader
// `$`-key marshal: a Fenel body cannot author `$`-prefixed keys (the
// expr-substrate barrier), so the decl grammar emits a plain-record TYPE-MARKER
// tree (`{mk, …}`) and this walker resolves it to the `$`-keyed FenelType. The
// marker vocabulary (ref / app / arrow / tuple / record) is the Phase-5 marshal
// CONTRACT. Maybe/List/Result applications EXPAND via the type-foundation
// helpers (VERIFIED byte-identical to `parse`, Step-0 pin); an unregistered
// head ⇒ `{$el:{call:…}}`; `Type` ⇒ `{$type:true}`. `flattenProgram` (the
// loader's frame unwrap, fenel-module.ts:619) is replicated here (test-local).
//
// FENCES (pinned + corpus-counted, deliberately out — see the .fenel header):
// imports (0 corpus + the `qualified` parser quirk), fixity decls (0 corpus,
// nothing consumes), the registered-type-application expansion beyond
// Maybe/List/Result (the general registry resolution is Phase-5's loader
// marshal), `where` in type position, def-where bodies. (`::` is not syntax;
// the `( Expr : Type )` annotation in a def body is covered by
// modules-as-values-phase-2d-annotation-syntax.test.ts's loader family.)
//
// Inputs are TINY (sig parses PRUNE the Expr env after step 1, def-body parses
// PRUNE the Type env — neither pays the full merged-env quadratic per token).
// Throughput is logged (a Phase-6 input). TS ledger: this test file (tests +
// the marker walker + frame-compare helpers) + the roster bump in
// module-migrate-engine.test.ts + matrix regen — NOTHING ELSE.

import { describe, it, expect } from "vitest";
import { parse } from "./fenel-parser";
import { Maybe, List, Result, Id } from "./type-foundation";
import {
  dispatchEngineBody,
  dispatchedJsonLogicToSyntax,
  marshalParsedFrames,
  setParserInterpreted,
} from "./engine-bodies-dispatch";
import { isSetExpr } from "./types";
import type { SetExpr } from "./types";
import { setExprToDollarKey } from "./set-marker";

// set-algebra-to-fenel Phase 3b-2 — the producer flip changed the OUTPUT FORM
// (`$`-key → `$tag`) of nested SetExprs (here the `EntityRef<"X">` ⇒ `Id<X>`
// phantom `$refined.set.$enum`). The Fenel-parser path goes through the flipped
// `Id` builder while the TS-parser oracle still emits `$`-key — a FORM-only
// divergence. `cf` deeply lowers ANY-form SetExpr back to `$`-key so the
// byte-parity assertion stays a STRUCTURE/VALUE check (setExprToDollarKey
// rewrites only the discriminator). Applied to BOTH sides per the oracle
// byte-parity rule; a no-op on the non-SetExpr frames.
function cf(x: unknown): unknown {
  if (x instanceof Map) return new Map([...x].map(([k, v]) => [cf(k), cf(v)]));
  if (Array.isArray(x)) return x.map(cf);
  if (x && typeof x === "object") {
    const sx = isSetExpr(x) ? setExprToDollarKey(x as SetExpr) : x;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(sx as object)) out[k] = cf(v);
    return out;
  }
  return x;
}

const TO = 120000;
const NOTHING = { $tag: "Nothing" };
const POSITIONAL_KEY = (index: number) => ({
  $tag: "PositionalField",
  index,
});

const TABLE = dispatchEngineBody("engine:defaultFixityTable", []);
const lexAll = (s: string): unknown => dispatchEngineBody("engine:lexAll", [s]);
// parser-substrate Phase 4i — the SetExpr refinement slice pre-pass (no-op on
// the non-refinement decl cases here; keeps the pipeline identical to production).
const spliceSetBodies = (src: string, toks: unknown): unknown =>
  dispatchEngineBody("engine:spliceSetBodies", [src, toks]);
const layoutTokens = (t: unknown): unknown =>
  dispatchEngineBody("engine:layoutTokens", [t]);
const parseProgToks = (toks: unknown): { $tag: string; _0?: unknown } =>
  dispatchEngineBody("engine:parseProgToks", [TABLE, null, toks]) as {
    $tag: string;
    _0?: unknown;
  };

// --- the TYPE-MARKER walker (the Phase-5 loader-marshal prototype) -----------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function walkType(m: any): unknown {
  // fenel-surface-extensions Phase 8 — a VALUE-level dependent type-arg leaf.
  // A raw numeric arg (`Vec a 0`) is a non-marker — passed through verbatim
  // (mirrors the production `walkType`'s `isMarker` guard on the app-arm arg map).
  // A parenthesised value-expr (`Vec a (n + 1)`) rides as a `{mk:"valexpr"}`
  // marker — lowered to `$`-free JSON-Logic via the same `syntaxToJsonLogic` the
  // production frame-lowering (`lowerValExprs`) applies before the marshal.
  if (m === null || typeof m !== "object") return m;
  if (m.mk === "valexpr")
    return dispatchEngineBody("engine:syntaxToJsonLogic", [m.syntax]);
  if (m.mk === "var") return { $var: m.name };
  if (m.mk === "value") return { var: m.name };
  if (m.mk === "ref") return m.name === "Type" ? { $type: true } : { $ref: m.name };
  if (m.mk === "app") {
    // Phase 7a — EntityRef<"X"> string-literal arg ⇒ the `Id<X>` $tagged
    // envelope (mirrors engine-bodies-dispatch `walkType`; handled before the
    // arg-map since a strlit is not a type marker).
    if (m.head === "EntityRef" && m.args.length === 1 && m.args[0]?.mk === "strlit")
      return Id(m.args[0].value);
    const args = m.args.map(walkType);
    if (m.head === "Maybe") return Maybe(args[0] as never);
    if (m.head === "List") return List(args[0] as never);
    if (m.head === "Result") return Result(args[0] as never, args[1] as never);
    return { $el: { call: [m.head, ...args] } };
  }
  if (m.mk === "arrow")
    return {
      $arrow: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        params: m.params.map((p: any, i: number) =>
          p.named
            ? { name: p.name, label: NOTHING, type: walkType(p.type), ui: NOTHING }
            : {
                name: "_" + i,
                key: POSITIONAL_KEY(i),
                label: NOTHING,
                type: walkType(p.type),
                ui: NOTHING,
                meta: {},
              },
        ),
        returns: walkType(m.ret),
      },
    };
  if (m.mk === "tuple") return { $tuple: m.items.map(walkType) };
  if (m.mk === "record")
    return {
      $record: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fields: m.fields.map((f: any) => ({
          name: f.name,
          ...(f.key === undefined ? {} : { key: f.key }),
          label: NOTHING,
          type: walkType(f.type),
          ui: NOTHING,
          meta: {},
        })),
      },
    };
  return { $UNKNOWN_MARKER: m };
}

// canonTypedef — the SHARED canonical type_def compare record, built
// identically from the TS type_def frame (types already $-keyed) and the Fenel
// typedef frame (types walkType'd). Key PRESENCE mirrors the parser's frame
// exactly (params/alias/opaque/discriminator only when present) — the discriminator
// SLOT is the loader lift (Phase-5 seam), reproduced here from the directive.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function canonTypedef(td: any, directives: any[]): unknown {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const o: any = { kind: "typedef", name: td.name };
  if (td.constructors) o.constructors = td.constructors;
  if (td.params && td.params.length) o.params = td.params;
  if (td.alias !== undefined) o.alias = td.alias;
  if (td.opaque) o.opaque = td.opaque;
  if (td.discriminator) o.discriminator = td.discriminator;
  // fenel-surface-extensions Phase 7 (D-G) — the dependent-ADT `data` kindSig
  // (`$arrow` FenelType). TS side: already `$`-keyed from `parse`. Fenel side:
  // `walkType`'d in normFenel. Present only for `data` decls.
  if (td.kindSig !== undefined) o.kindSig = td.kindSig;
  o.directives = directives;
  return o;
}

// --- fenelSide: parse ⇒ frames, normalised to the flat compare records -------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normFenel(el: any): unknown {
  const f = el.frame;
  const dirs = el.directives ?? [];
  if (f.kind === "sig")
    return { kind: "sig", name: f.name, type: walkType(f.ty), directives: dirs };
  if (f.kind === "def")
    return { kind: "def", name: f.name, params: f.params, body: f.body, directives: dirs };
  if (f.kind === "module")
    return { kind: "module", name: f.name, directives: dirs };
  // signature-substrate P4-prep (D0b) — the structured selective import.
  if (f.kind === "import")
    return { kind: "import", module: f.module, names: f.names };
  if (f.kind === "typedef") {
    // Signature-substrate Phase 2 — parseProgToks deliberately returns the
    // spelling frame. Program-frame lowering owns explicit typedef binding;
    // apply that same Fenel body before comparing with the sanctioned mirror.
    const bound = dispatchEngineBody("engine:sourceBindTypeDefinition", [f]) as {
      frame: typeof f;
    };
    const tf = bound.frame;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const td: any = { name: tf.name };
    if (tf.ctors)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      td.constructors = tf.ctors.map((c: any) => ({
        name: c.name,
        label: NOTHING,
        // fenel-surface-extensions Phase 7 (D-G) — a `data` ctor carries a full
        // `type` sig marker; walkType it (mirrors the loader-marshal). Normal
        // variant ctors have no `type` slot.
        ...(c.type !== undefined ? { type: walkType(c.type) } : {}),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fields: c.fields.map((fl: any) => ({
          name: fl.name,
          ...(fl.key === undefined ? {} : { key: fl.key }),
          label: NOTHING,
          type: walkType(fl.type),
        })),
      }));
    // fenel-surface-extensions Phase 7 (D-G) — the `data` kind signature marker.
    if (tf.kindSig !== undefined) td.kindSig = walkType(tf.kindSig);
    if (tf.params && tf.params.length) td.params = tf.params;
    if (tf.alias !== undefined) td.alias = walkType(tf.alias);
    if (tf.opaque) td.opaque = tf.opaque;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const disc = dirs.find((d: any) => d.name === "discriminator");
    if (disc) td.discriminator = disc.args[0];
    return canonTypedef(td, dirs);
  }
  return { $UNKNOWN_FRAME: f };
}

const fenelFrames = (src: string): unknown => {
  const toks = layoutTokens(spliceSetBodies(src, lexAll(src)));
  const r = parseProgToks(toks);
  if (r.$tag !== "Just") return { $NOTHING: src };
  return (r._0 as unknown[]).map(normFenel);
};

// --- tsSide: flattenProgram(parse) + the same normalisation ------------------
// flattenProgram replica (fenel-module.ts:619) — unwrap {program} or a single
// bare decl, keep the SIX frame kinds (D1 produces sig/def/module).
function flattenProgram(ast: unknown): unknown[] {
  if (ast == null) return [];
  const isFrame = (d: unknown): boolean =>
    typeof d === "object" &&
    d !== null &&
    ("def" in d || "type_sig" in d || "type_def" in d || "fixity" in d || "module_decl" in d || "import_decl" in d);
  if (typeof ast === "object" && "program" in (ast as object))
    return (ast as { program: unknown[] }).program.filter(isFrame);
  return isFrame(ast) ? [ast] : [];
}

const tsFrames = (src: string): unknown[] =>
  flattenProgram(parse(src)).map((d) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dd = d as any;
    if (dd.type_sig)
      return { kind: "sig", name: dd.type_sig.name, type: dd.type_sig.type, directives: dd.type_sig.directives ?? [] };
    if (dd.def) {
      const body = dispatchedJsonLogicToSyntax(dd.def.body) as { $tag: string; _0?: unknown };
      return {
        kind: "def",
        name: dd.def.name,
        params: dd.def.params,
        body: body.$tag === "Ok" ? body._0 : { $BODYERR: body },
        directives: dd.def.directives ?? [],
      };
    }
    if (dd.type_def) return canonTypedef(dd.type_def, dd.type_def.directives ?? []);
    if (dd.module_decl) return { kind: "module", name: dd.module_decl.name, directives: [] };
    // signature-substrate P4-prep (D0b) — the structured selective import
    // (the only import form both parsers admit; bare/`as`/`hiding` stay
    // TS-pinned FENCED, see the decl-grammar FENCES note).
    if (dd.import_decl)
      return { kind: "import", module: dd.import_decl.module, names: dd.import_decl.names ?? [] };
    return { $UNHANDLED: dd };
  });

// =========================================================================
// D1 — the TypeExpr sub-language (read through `f : <T>` sigs). Bare refs (any
// case + `Type`), registered-type applications (Maybe/List/Result EXPAND),
// unregistered application (⇒ `$el`), arrows (bare-param + named-param +
// curried + multi-param paren-group), tuples, record types, parens, nesting.
// =========================================================================
const D1_TYPES: { name: string; src: string }[] = [
  { name: "named type ref", src: "f : Number\nf x = x" },
  { name: "type var (bound lowercase ⇒ $var)", src: "f : a\nf x = x" },
  { name: "entity ref (Bot)", src: "f : Bot\nf x = x" },
  { name: "Type ⇒ $type:true", src: "f : Type\nf x = x" },
  { name: "registered app Maybe (expand)", src: "f : Maybe a\nf x = x" },
  { name: "registered app List (expand)", src: "f : List String\nf x = x" },
  { name: "registered app Result (expand)", src: "f : Result String Number\nf x = x" },
  { name: "nested registered app", src: "f : Maybe (Maybe a)\nf x = x" },
  { name: "unregistered app ⇒ $el", src: "f : Foo a\nf x = x" },
  { name: "unregistered app two args ⇒ $el", src: "f : Foo a b\nf x = x" },
  { name: "arrow (bare param + meta)", src: "f : Number -> String\nf x = x" },
  { name: "arrow curried", src: "f : Number -> String -> Bool\nf x y = x" },
  { name: "arrow named param (no meta)", src: "f : (tk: a) -> String\nf x = x" },
  { name: "arrow curried named params", src: "f : (s: String) -> (i: a) -> a\nf x y = x" },
  { name: "arrow multi-param paren group", src: "f : (A, B) -> C\nf x = x" },
  { name: "arrow with app param (expand)", src: "f : Maybe a -> List a\nf x = x" },
  { name: "arrow with el param", src: "f : Foo a -> b\nf x = x" },
  { name: "tuple type", src: "f : (Number, String)\nf x = x" },
  { name: "record type", src: "f : { name: String, fields: List String }\nf x = x" },
  { name: "paren transparent", src: "f : (Maybe a)\nf x = x" },
  // Phase 4h S2 — legacy `<>` angle-bracket generics (≡ juxtaposition).
  { name: "angle generic Maybe<String>", src: "f : Maybe < String >\nf x = x" },
  { name: "angle generic unregistered Foo<a>", src: "f : Foo < a >\nf x = x" },
  { name: "angle generic two-arg Result<E, A>", src: "f : Result < String, Number >\nf x = x" },
  // Phase 7a — the EntityRef<"X"> string-literal type-arg ⇒ the `Id<X>` $tagged
  // envelope (the ONLY `<>` arg that is a string, not a type).
  { name: "EntityRef string-arg (sig)", src: 'f : EntityRef<"profile">\nf x = x' },
  { name: "EntityRef string-arg (spaced)", src: 'f : EntityRef < "Bot" >\nf x = x' },
  { name: "EntityRef in ctor field", src: 'Foo = Foo botId: EntityRef<"Bot"> n: Int' },
  { name: "EntityRef + Maybe<X> ctor fields", src: 'Foo = Foo p: EntityRef<"profile"> q: Maybe<Date>' },
  // fenel-surface-extensions Phase 8 (D-G follow-up) — VALUE-level dependent
  // type-args (`tyArgAtom` superset, ONLY in the juxtaposition arg list). A
  // numeric literal rides as a raw number; a paren value-expr `(n + 1)` lowers via
  // `lowerValExprs`. The type-shaped paren controls MUST stay type-apps (D2).
  { name: "value-arg numeric (Vec a 0)", src: "f : Vec a 0\nf x = x" },
  { name: "value-arg paren expr (Vec a (n + 1))", src: "f : Vec a (n + 1)\nf x = x" },
  { name: "value-arg mixed (Foo a 3 b)", src: "f : Foo a 3 b\nf x = x" },
  { name: "control: paren type-ctor (Vec a (Succ n))", src: "f : Vec a (Succ n)\nf x = x" },
  { name: "control: paren type (Vec a (Maybe b))", src: "f : Vec a (Maybe b)\nf x = x" },
];

describe("decl-grammar D1 — the TypeExpr sub-language (sig differential vs flattenProgram + marshal)", () => {
  for (const { name, src } of D1_TYPES) {
    it(name, () => expect(cf(fenelFrames(src))).toEqual(cf(tsFrames(src))), TO);
  }
});

// =========================================================================
// D1 — directives (the `@name args` prefix list, attached to the FOLLOWING
// decl) + the module header + Program assembly (header-less / headered /
// header-only). Directives are `$`-free; compared directly.
// =========================================================================
const D1_DECLS: { name: string; src: string }[] = [
  { name: "sig + @label directive", src: '@label "My Fn"\nf : Number\nf x = x' },
  { name: "multi-directive prefix", src: '@label "My Fn"\n@description "does things"\n@tags "a" "b"\nf : Number\nf x = x' },
  { name: "directive on a def (no sig)", src: '@label "x"\nf x = x' },
  { name: "module header + decls", src: "module engine where\nf : Number\nf x = x" },
  { name: "module header only", src: "module engine where" },
  { name: "module header + two decls", src: "module foo where\nf x = x\ng y = y" },
];

describe("decl-grammar D1 — directives + module header + Program assembly", () => {
  for (const { name, src } of D1_DECLS) {
    it(name, () => expect(cf(fenelFrames(src))).toEqual(cf(tsFrames(src))), TO);
  }
});

// =========================================================================
// signature-substrate P4-prep (D0b) — STRUCTURED imports (the selective form,
// any-case module head). The lowercase heads are the permissions source
// imports; the differential runs both parsers and compares the normalized
// frames. Bare/`as`/`hiding` forms stay TS-pinned FENCED (0 corpus — the
// decl-grammar FENCES note); a directive-carrying import REJECTS on both
// sides (TS throws "Directives only apply…"; the Fenel side emits the frame
// the loader marshal rejects).
// =========================================================================
const IMPORT_DECLS: { name: string; src: string }[] = [
  { name: "lowercase selective import (the permissions shape)", src: "module permtest where\nimport engine (SetExpr)\nimport subject (Subject)\nProbe = Probe name: String" },
  { name: "lowercase selective two names", src: "module permtest where\nimport subject (Subject, Other)\nf x = x" },
  { name: "uppercase selective import", src: "module permtest where\nimport Telegram (run, stop)\nf x = x" },
  { name: "empty selective list (TS-mirror accept, names = [])", src: "module permtest where\nimport engine ()\nf x = x" },
  { name: "headerless selective import", src: "import engine (SetExpr)\nf x = x" },
];

describe("decl-grammar P4-prep — structured selective imports (both-parser differential)", () => {
  for (const { name, src } of IMPORT_DECLS) {
    it(name, () => expect(cf(fenelFrames(src))).toEqual(cf(tsFrames(src))), TO);
  }

  it("a directive-carrying import REJECTS on both sides (parity of rejection)", () => {
    const src = 'module permtest where\n@label "x"\nimport engine (SetExpr)\nf x = x';
    expect(() => parse(src)).toThrow(/Directives only apply/);
    // The Fenel-side rejection lives on the PRODUCTION route: the
    // directive-carrying import element lowers (elementToFrame) to an empty
    // frame the loader marshal rejects — the program cannot load through
    // either parser. (The grammar-level `fenelFrames` normalizer above never
    // marshals, so the production pipeline is exercised explicitly here.)
    const toks = layoutTokens(spliceSetBodies(src, lexAll(src)));
    const r = parseProgToks(toks) as { $tag: string; _0?: unknown };
    expect(r.$tag).toBe("Just");
    const frames = dispatchEngineBody("engine:programToFrames", [r._0]);
    expect(() => marshalParsedFrames(frames as unknown[])).toThrow(
      /exactly one own-data frame discriminator/,
    );
  }, TO);

  it("a bare lowercase `import foo` decl is NOT an import frame on either side", () => {
    const src = "module permtest where\nimport foo\nf x = x";
    // TS: the guard rejects the lowercase bare form, so `import foo` parses
    // as an application EXPRESSION statement — which the decl level rejects
    // structurally on both sides (no bare-expression decl arm).
    expect(() => parse(src)).toThrow();
    const fenelResult = (() => {
      try {
        return fenelFrames(src);
      } catch {
        return { $NOTHING: src };
      }
    })();
    // Either a failed Program parse ($NOTHING) or a thrown marshal — never an
    // import_decl frame.
    expect(JSON.stringify(fenelResult)).not.toContain("import_decl");
  }, TO);
});

// =========================================================================
// D1 — def bodies (the def frame reuses the ENTIRE Expr/Stmts/Params machinery;
// body compared in Syntax space). Kept few + small (the slow tier — full Expr
// env). The sig+def PAIR stays two SEPARATE frames (pairing = the loader's job).
// =========================================================================
const D1_DEFS: { name: string; src: string }[] = [
  { name: "def var body", src: "f x = x" },
  { name: "def operator body", src: "f x = x + 1" },
  { name: "def no params", src: "answer = 42" },
  { name: "def application body", src: "f x = g x" },
  { name: "def multi-stmt body (let block)", src: "f x =\n  let y = 1\n  add x y" },
  { name: "sig + def pair (two frames)", src: "f : Number -> Number\nf x = x + 1" },
];

describe("decl-grammar D1 — def bodies (Syntax-space body differential)", () => {
  for (const { name, src } of D1_DEFS) {
    it(name, () => expect(cf(fenelFrames(src))).toEqual(cf(tsFrames(src))), TO);
  }
});

// =========================================================================
// D2 — type DEFS. Variants (nullary + bare-positional + named + brace-record
// + [T] list-sugar fields), type params, opaque ctor-form + alias-form,
// @discriminator (the directive lifts to the discriminator slot). FENCED:
// refinement-form (`Base | value ∈ …` / `Base | predicate`) — the SetExpr
// sub-grammar is Phase 5/6 (ctor heads require uppercase, so a lowercase
// predicate RHS makes the grammar REJECT the refined form rather than
// mis-parse it). The ctor-field elem grouping (name: markers + atoms) is the
// no-lookahead encoding of `chars: List Char` (one app field) vs
// `lo: Number hi: Number` (two atom fields).
// =========================================================================
const D2_DEFS: { name: string; src: string }[] = [
  { name: "nullary variant (3 ctors)", src: "Color = Red | Green | Blue" },
  { name: "single nullary ctor", src: "Status = Active" },
  { name: "parametric Maybe", src: "Maybe a = Nothing | Just a" },
  { name: "parametric Either (positional)", src: "Either a b = Left a | Right b" },
  { name: "explicit uppercase binders", src: "Upper F A = Upper value: F A" },
  { name: "single ctor one bare field", src: "Wrapper = Wrap Number" },
  { name: "single ctor two bare fields", src: "Pair = Pair a b" },
  { name: "mixed explicit positional + named origin", src: "Mixed = Mixed :Number named: String" },
  { name: "brace record-type field", src: "Bot = Bot { token: String, name: String }" },
  { name: "corpus shape — mixed nullary + named fields", src: "JsonLogic = JlNull | JlBool value: a | JlNum n: Number" },
  { name: "multiple named atom fields", src: "IssuedSession = IssuedSession token: String sessionId: String userId: String" },
  { name: "named app-typed field (Maybe Number)", src: "AIError = NetworkError message: String | RateLimit retryAfter: Maybe Number" },
  { name: "list-sugar field [Image]", src: "FrameSequence = FrameSequence fps: Number frames: [Image]" },
  { name: "paren app field (Maybe a)", src: "Wrap = Wrap (Maybe a)" },
  { name: "multi-line variant (vsemi before pipe)", src: "Color =\n  Red\n  | Green\n  | Blue" },
  { name: "opaque ctor-form", src: 'opaque "string" String = Str chars: List Char' },
  { name: "opaque alias-form", src: 'opaque "string" Str = List Char' },
  { name: "@discriminator (lifts to slot)", src: '@discriminator "type"\nShape = Circle r: Number | Square s: Number' },
  { name: "typedef + def mixed file", src: "Color = Red | Blue\nf x = x" },
];

describe("decl-grammar D2 — type DEFS (variant/record/opaque/alias/discriminator differential)", () => {
  for (const { name, src } of D2_DEFS) {
    it(name, () => expect(cf(fenelFrames(src))).toEqual(cf(tsFrames(src))), TO);
  }
});

describe("decl-grammar D2 — source binding diagnostic parity", () => {
  const diagnosticProjection = (diagnostics: unknown): unknown =>
    (diagnostics as Array<{ code: string; path: string[]; spelling: string }>).map(
      ({ code, path, spelling }) => ({ code, path, spelling }),
    );

  for (const src of [
    "Choice = First value: a | Middle value: b | Last value: a",
    "Kinds f a b = K0 value: f | K1 value: f a | K2 value: f b",
  ]) {
    it(src, () => {
      const tokens = layoutTokens(spliceSetBodies(src, lexAll(src)));
      const parsed = parseProgToks(tokens);
      expect(parsed.$tag).toBe("Just");
      const frame = (parsed._0 as Array<{ frame: unknown }>)[0]!.frame;
      const fenel = dispatchEngineBody("engine:sourceBindTypeDefinition", [frame]) as {
        binding: { diagnostics: unknown };
      };
      const tsFrame = flattenProgram(parse(src))[0] as {
        type_def: { binding: { diagnostics: unknown } };
      };
      expect(diagnosticProjection(fenel.binding.diagnostics)).toEqual(
        diagnosticProjection(tsFrame.type_def.binding.diagnostics),
      );
    }, TO);
  }
});

// =========================================================================
// The P2 decl-level layout-pin promotions — pins 1 (function body) + 13
// (top-level decl siblings) become grammar-proven here (the deferred decl-level
// layout-parity proof; the expression pins landed in P3c). Pin 9
// (where-bindings) stays FENCED (def-where ⇒ adapter Err — D3 records it).
// =========================================================================
const P2_DECL_PINS: { name: string; src: string }[] = [
  { name: "P2 pin 1 — function body (= opener ⇒ vopen Stmts vclose)", src: "f x = x + 1" },
  { name: "P2 pin 1 — multi-stmt function body", src: "f x =\n  let y = 1\n  add x y" },
  { name: "P2 pin 13 — top-level decl siblings (vsemi)", src: "f x = x\ng y = y" },
  { name: "P2 pin 13 — mixed sig + def siblings", src: "f : Number\nf x = x\ng y = y" },
];

describe("decl-grammar — P2 decl-level layout-pin promotions (pins 1, 13 grammar-proven)", () => {
  for (const { name, src } of P2_DECL_PINS) {
    it(name, () => expect(cf(fenelFrames(src))).toEqual(cf(tsFrames(src))), TO);
  }
});

// =========================================================================
// Phase 7b — the fence-closure grammar classes: the `(op)` operator-def head
// (S1), the typedef LHS angle-PARAMS (S2), and indented constructor-field
// CONTINUATIONS (S3). Pinned by RUNNING `parse(src)`. (S4 named-field
// SHORTHAND lives in the marshal test — jsonLogicToSyntax is lossy for it.)
// =========================================================================
const PHASE_7B: { name: string; src: string }[] = [
  // S1 — the `(op)` operator-def form (the FM-retire-9c precondition).
  { name: "S1 op-sig (.)", src: "(.) : (b -> c) -> (a -> b) -> (a -> c)" },
  { name: "S1 op-def (.)", src: "(.) f g = " + String.fromCharCode(92) + "x -> f (g x)" },
  { name: "S1 op-sig ($)", src: "($) : (a -> b) -> a -> b" },
  { name: "S1 op-def ($)", src: "($) f x = f x" },
  { name: "S1 op sig+def pair", src: "($) : (a -> b) -> a -> b\n($) f x = f x" },
  // S2 — typedef LHS angle-params (≡ juxtaposition params).
  { name: "S2 LHS angle one param", src: "EventEntry<a> = EventEntry timestamp: Number payload: a" },
  { name: "S2 LHS angle two params", src: "Pair<a, b> = Pair x: a y: b" },
  { name: "S2 LHS angle ≡ juxtaposition", src: "Box<a> = Box v: a" },
  // S3 — indented named fields continue the preceding constructor.
  {
    name: "S3 ctor + continuation fields (session)",
    src: "ResolvedSession = ResolvedSession subject: Subject\n  sessionId: String\n  userId: String\n  accountId: String",
  },
  {
    name: "S3 empty ctor + continuation fields (validate)",
    src: "ValNumSchema = ValNumSchema\n  isNaN : a\n  numValue : a",
  },
];

describe("decl-grammar — (op) head (S1) + LHS angle-params (S2) + constructor layout continuation (S3)", () => {
  for (const { name, src } of PHASE_7B) {
    it(name, () => expect(cf(fenelFrames(src))).toEqual(cf(tsFrames(src))), TO);
  }
});

// =========================================================================
// fenel-surface-extensions Phase 7 (D-G) — the dependent-ADT `data … where`
// declaration. The decl-grammar differential (the `dataDecl` production ≡ the
// oracle's `parseDataDecl`): kindSig (`$arrow`, walkType'd) + per-ctor `type`
// sig + `arrowToFields` field decomposition. The `->`-layout-opener deferred-
// vclose nest (the kindSig arrows close PAST the where-block) is exercised by
// every kindSig case. Dependent indices are EITHER Peano-style type-ctor args
// (`Vec a Zero` / `Vec a (Succ n)`) OR — as of Phase 8 (D-G follow-up) —
// value-level numeric/arithmetic indices (`Vec a 0` / `Vec a (n + 1)`), the
// canonical dependent-vector surface the Phase-7 fence blocked.
// =========================================================================
const PHASE_7_DATA: { name: string; src: string }[] = [
  {
    name: "Vec — kindSig + Peano dependent indices",
    src: "data Vec : Type -> Type where\n  Nil : Vec a Zero\n  Cons : a -> Vec a n -> Vec a (Succ n)",
  },
  {
    name: "Vec — two-arrow kindSig",
    src: "data Vec : Type -> Number -> Type where\n  Nil : Vec a n\n  Cons : a -> Vec a n -> Vec a n",
  },
  { name: "Color — no kindSig, nullary ctors", src: "data Color where\n  Red : Color\n  Green : Color" },
  { name: "Box — single arrow ctor + kindSig", src: "data Box : Type -> Type where\n  MkBox : a -> Box a" },
  { name: "Foo — no kindSig, arrow + nullary", src: "data Foo where\n  A : Number -> Foo\n  B : Foo" },
  { name: "U — single nullary ctor", src: "data U where\n  Only : U" },
  { name: "Expr — curried multi-field ctor + uppercase index", src: "data Expr : Type -> Type where\n  Lit : Number -> Expr Number\n  Pair : a -> b -> Expr Bool" },
  { name: "mixed named/positional ctor params", src: "data Mixed where\n  MkMixed : (named: String) -> Number -> Mixed" },
  // mixed-file: a `data` decl + a following def (sibling decl, no over-capture).
  { name: "data + def mixed file", src: "data Color where\n  Red : Color\nf x = x" },
  // Phase 8 (D-G follow-up) — the canonical dependent vector with VALUE-level
  // numeric (`Vec a 0`) + arithmetic (`Vec a (n + 1)`) return indices.
  {
    name: "Vec — value-level numeric/arithmetic indices (Phase 8)",
    src: "data Vec : Type -> Type where\n  Nil : Vec a 0\n  Cons : a -> Vec a n -> Vec a (n + 1)",
  },
];

describe("decl-grammar Phase 7 — dependent-ADT `data … where` (kindSig + per-ctor sig + arrowToFields)", () => {
  for (const { name, src } of PHASE_7_DATA) {
    it(name, () => expect(cf(fenelFrames(src))).toEqual(cf(tsFrames(src))), TO);
  }
});

// =========================================================================
// Throughput — the interpreted tok/sec, a Phase-6 budget input (logged).
// =========================================================================
describe("decl-grammar — throughput (logged)", () => {
  it(
    "D1 sample tok/sec",
    () => {
      const sample = ["f : Number\nf x = x", "f : Maybe a -> b\nf x = x", "module engine where\nf x = x"];
      let toks = 0;
      const t0 = performance.now();
      for (const src of sample) {
        const ts = layoutTokens(lexAll(src)) as unknown[];
        toks += ts.length;
        parseProgToks(ts);
      }
      const ms = performance.now() - t0;
      // eslint-disable-next-line no-console
      console.log(
        `[decl-grammar D1] ${sample.length} cases / ${toks} tokens in ${ms.toFixed(0)} ms = ${((toks / ms) * 1000).toFixed(0)} tok/sec`,
      );
      expect(toks).toBeGreaterThan(0);
    },
    TO,
  );
});

// =========================================================================
// Dual-path (parser-substrate Phase 6a) — the differentials above run on the
// COMPILED artifact. This block keeps the INTERPRETED decl-grammar bodies
// always-exercised on a representative subset (incl. the opaque arms whose
// `mapSet {} "repr" …` idiom replaced the compile-divergent `{ repr = … }`
// single-key record) and asserts compiled ≡ interpreted ≡ TS oracle. Tiny
// inputs — the interpreted merged decl+expr env is ~1 tok/sec.
// =========================================================================
const DUAL_SUBSET = [
  "x = 1",
  "f x = x",
  "Foo = Bar",
  "Foo = Bar | Baz",
  "Color = Red | Green | Blue",
  'opaque "string" Email = String',
  'opaque "number" Count = Nat',
  "n : Number",
  "id x = x",
  "k = 5",
  "Pair = Pair a b",
  "Maybe2 = None | Some a",
  // Multi-constructor continuation exercises appendFieldsToLastCtor's
  // recursive branch. A compiled Just _ guard previously compared the next
  // constructor to the literal "_", losing the entire constructor roster.
  [
    "DocReadPart = DocReadMarkup markup: Markup",
    "  | DocReadSection heading: Markup children: List DocReadPart",
    "  | DocReadNote children: List DocReadPart",
    "  | DocReadEmbed value: a type: Type caption: Markup",
  ].join("\n"),
  // fenel-surface-extensions Phase 7 (D-G) — a `data … where` decl through the
  // INTERPRETED bodies (the deferred-vclose kindSig nest + the recursive
  // KindWhere), asserting compiled ≡ interpreted ≡ TS oracle (the Phase-4
  // `PEpsV Nothing` interpreter-divergence lesson — the dual-path is the guard).
  "data Box : Type -> Type where\n  MkBox : a -> Box a",
  "data Color where\n  Red : Color\n  Green : Color",
  // fenel-surface-extensions Phase 8 (D-G follow-up) — VALUE-level dependent
  // type-args through the INTERPRETED bodies (the `tyArgAtom` numeric arm + the
  // `( Expr )` value-paren fallback + the `lowerValExprs` deep-walk), asserting
  // compiled ≡ interpreted ≡ TS oracle (the dual-path is the guard for the new
  // value-paren parser fn + the lowering).
  "f : Vec a 0\nf x = x",
  "f : Vec a (n + 1)\nf x = x",
];
describe("decl-grammar — dual-path (interpreted bodies + compiled byte-equality)", () => {
  for (const src of DUAL_SUBSET) {
    it(
      src,
      () => {
        setParserInterpreted(true);
        let interp: unknown;
        try {
          interp = fenelFrames(src);
        } finally {
          setParserInterpreted(null);
        }
        const compiled = fenelFrames(src);
        expect(interp).toEqual(compiled); // compiled artifact ≡ interpreted bodies
        expect(cf(interp)).toEqual(cf(tsFrames(src))); // interpreted bodies ≡ TS oracle (form-agnostic)
      },
      TO,
    );
  }
});
