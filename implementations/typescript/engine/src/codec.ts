// ---------------------------------------------------------------------------
// Codec — Encodable / Decodable / Iso / Lens typeclasses
//
// The first signal-bearing instance of the meta-pattern from
// design/structural-introspection.md (Instance 2):
//
//   A piece of behavior is a function. A typeclass attaches structural
//   metadata. The metadata enables reasoning — composition gives both
//   directions and the round-trip proof for free; synthesis is decidable
//   for the regular fragment; fusion via supercompilation is open.
//
// Conventions (apply throughout this module):
//
//   Iso<s, a>      — s is the SERIALIZED form (string/bytes/wire),
//                    a is the STRUCTURED form (typed Fenel value).
//   encode : a -> Result EncodeError s    — structured → serialized
//   decode : s -> Result DecodeError a    — serialized → structured
//
// So `IsoBase64 : Iso<String, Bytes>` reads as "Bytes are the structured
// values, Base64 String is the serialized form; encode produces a base64
// string from raw bytes; decode parses a base64 string back into bytes".
//
// Phase 2 commits to `Iso` and `Lens` only; `Prism` / `PartialIso` /
// resourceful lenses (Boomerang) are deferred until a use case demands
// them — see design/structural-introspection.md Instance 2 → Open Q4.
// ---------------------------------------------------------------------------

import type { FenelType, FieldDef, Interface, Instance } from "./types";
import { Result } from "./type-foundation";
import { callableHead } from "./migration";

// ---------------------------------------------------------------------------
// Error types — small records carrying the failure shape. Phase 2 keeps
// these as `String` for simplicity; future phases can refine to a richer
// ADT (per-codec error variants, source-position info, suggestions).
// Encoded as `$named` references so consumers can register an Exemplifiable
// / Codeable instance against the name without restructuring this module.
// ---------------------------------------------------------------------------

const EncodeError = { $ref: "String" } as const;
const DecodeError = { $ref: "String" } as const;

// The function-typed methods of Encodable, Decodable, Iso and Lens, written out
// as data exactly as their `.fenel` declarations (`fenel/std/interfaces.fenel`)
// parse: flattened positional parameters, and `Result String s` inlined as the
// variant the parser emits. Pinned against `seedFromType` of those declarations
// in `modules-as-values-phase-2b.test.ts` (Encodable, Lens) and
// `modules-as-values-phase-2d-codec-migration.test.ts` (Decodable, Iso).
// Seed data (ts-exceptions-ledger A2).
const NO_LABEL = { $tag: "Nothing" } as const;
const S_ARG_0: FieldDef = { name: "_0", key: { $tag: "PositionalField", index: 0 }, label: NO_LABEL, type: { $var: "s" }, ui: NO_LABEL, meta: {} };
const A_ARG_0: FieldDef = { name: "_0", key: { $tag: "PositionalField", index: 0 }, label: NO_LABEL, type: { $var: "a" }, ui: NO_LABEL, meta: {} };
const A_ARG_1: FieldDef = { name: "_1", key: { $tag: "PositionalField", index: 1 }, label: NO_LABEL, type: { $var: "a" }, ui: NO_LABEL, meta: {} };
/** `Result <error> <ok>` as the parser inlines it: `Err _0 | Ok _0`. */
const resultVariant = (error: FenelType, ok: FenelType): FenelType => ({
  $variant: {
    cases: [
      {
        name: "Err",
        label: NO_LABEL,
        fields: [{ name: "_0", key: { $tag: "PositionalField", index: 0 }, label: NO_LABEL, type: error, meta: {}, ui: NO_LABEL }],
      },
      {
        name: "Ok",
        label: NO_LABEL,
        fields: [{ name: "_0", key: { $tag: "PositionalField", index: 0 }, label: NO_LABEL, type: ok, meta: {}, ui: NO_LABEL }],
      },
    ],
  },
});
const RESULT_ENCODE_ERROR_S: FenelType = resultVariant(EncodeError, { $var: "s" });
const RESULT_DECODE_ERROR_A: FenelType = resultVariant(DecodeError, { $var: "a" });

// ---------------------------------------------------------------------------
// Encodable s a — total-but-fallible encode from a → s
// ---------------------------------------------------------------------------

/**
 * `Encodable s a` — values of `a` can be encoded into the representation
 * `s`. Encoding may fail with a structured `EncodeError` (e.g. a value
 * outside the encodable subset, an over-long input, etc.). Successful
 * encodings carry no extra information — they're just `Ok s`.
 *
 * Method `encode : a -> Result EncodeError s`. The field holds the encoding
 * function itself: a `.fenel` instance writes
 * `encode = compileJs.serializeJsModule`, loaded as the reference
 * `{$ref: "compileJs.serializeJsModule"}` (modules-as-values Phase 2b). `a`
 * is not the class's first parameter, so `encode` stays at return position.
 */
export const encodable: Interface = {
  name: "Encodable",
  description:
    "Types `a` that can be encoded into a representation `s`. Total but fallible — encoding may produce a structured EncodeError. Pair with Decodable for a (possibly lossy) bidirection; pair with Iso for a bijective one.",
  params: [{ name: "s" }, { name: "a" }],
  methods: [
    {
      name: "encode",
      description:
        "The encode function, `a -> Result EncodeError s`.",
      params: [A_ARG_0],
      returns: RESULT_ENCODE_ERROR_S,
    },
  ],
};

// ---------------------------------------------------------------------------
// Decodable s a — partial decode from s → a
// ---------------------------------------------------------------------------

/**
 * `Decodable s a` — representations of `s` can be parsed into values of
 * `a`. Decoding is partial — invalid encodings produce a structured
 * `DecodeError`. Pair with Encodable for a bidirection; pair with
 * Iso when both directions are total + roundtrip.
 *
 * Method `decode : s -> Result DecodeError a`. The field holds the decoding
 * function itself: `decode = codec.decodeJsonInt` loads as the reference
 * `{$ref: "codec.decodeJsonInt"}` (modules-as-values Phase 2d). Two class
 * parameters, so `decode` stays at return position: the instance is selected
 * by its complete type, never by one argument's type.
 */
export const decodable: Interface = {
  name: "Decodable",
  description:
    "Representations `s` that can be decoded back into values of type `a`. Partial — invalid encodings yield a structured DecodeError. Compose via Kleisli (Result-chained) to build longer parse pipelines from primitive decoders.",
  params: [{ name: "s" }, { name: "a" }],
  methods: [
    {
      name: "decode",
      description:
        "The decode function, `s -> Result DecodeError a`.",
      params: [S_ARG_0],
      returns: RESULT_DECODE_ERROR_A,
    },
  ],
};

// ---------------------------------------------------------------------------
// Iso s a — bijective codec
// ---------------------------------------------------------------------------

/**
 * `Iso s a` — bijective codec between the serialized form `s` and the
 * structured form `a`. Both directions are total-but-fallible (e.g. base64
 * encoding can technically fail on systems with broken Buffer); the laws
 * pin down what "bijective" means.
 *
 * Both fields hold the functions themselves (`encode = codec.base64Encode`,
 * loaded as a `{$ref}` reference — modules-as-values Phase 2d). Two class
 * parameters, so both methods stay at return position: the instance is
 * selected by its complete type (`Iso String Bytes` vs `Iso String
 * JsonValue`), never by one argument's type.
 *
 * `Iso` declares NO superclass. It is meant as Encodable + Decodable + the
 * round-trip laws, but that restructuring is a later change: today an
 * `Iso s a` instance does not make `Encodable s a` or `Decodable s a`
 * resolve (the dispatch registry has no superclass logic), so the seed
 * carries no `supers` claim.
 *
 * Laws (machine-checkable per Phase 9.2 — see law-validation.ts):
 *
 *   1. iso-decode-encode-roundtrip
 *      For every x : a,  decode(encode(x)) = Ok x
 *      (i.e. the serialize → parse round-trip is identity)
 *
 *   2. iso-encode-decode-roundtrip
 *      For every s : s,  case decode(s) of
 *                          Ok x  -> encode(x) = Ok s
 *                          Err _ -> True (vacuous — invalid encodings
 *                                  are not in the bijection's range)
 *      (i.e. the parse → serialize round-trip is identity on the
 *      decodable subset)
 *
 * Composition: see `composeIso` below — `Iso<a,b> ∘ Iso<b,c> -> Iso<a,c>`
 * derives both directions and the composed proof.
 */
export const iso: Interface = {
  name: "Iso",
  description:
    "Bijective codec between a serialized form `s` (string/bytes/wire) and a structured form `a` (typed Fenel value). Round-trip in both directions (both laws). Compose via Iso ∘ Iso — both directions and the round-trip proof fall out.",
  params: [{ name: "s" }, { name: "a" }],
  methods: [
    {
      name: "encode",
      description:
        "The encode function, `a -> Result EncodeError s`.",
      params: [A_ARG_0],
      returns: RESULT_ENCODE_ERROR_S,
    },
    {
      name: "decode",
      description:
        "The decode function, `s -> Result DecodeError a`.",
      params: [S_ARG_0],
      returns: RESULT_DECODE_ERROR_A,
    },
  ],
  laws: [
    {
      name: "iso-decode-encode-roundtrip",
      description:
        "Round-trip via the structured side: decode(encode(x)) = Ok x for every x : a. Sample-tested in Phase 9.2 by iterating Exemplifiable<a> samples.",
      // Quantified over a value of type `a` (the second typeclass arg).
      // The law-validator's quantified-iteration path (Phase 9.2) reads
      // this rich form, looks up Exemplifiable samples for `a`, and runs
      // the property once per sample. Bare-string forall entries (`["a"]`)
      // remain a backward-compat shape that's marked uncheckable.
      forall: [{ name: "x", type: "a" }],
      property: {
        // case encode(x) of
        //   Err _ -> True       -- encode failed; vacuously satisfied
        //   Ok s  -> decode(s) ≡ Ok x
        match: [
          { call: [{ var: "encode" }, { var: "x" }] },
          { $tag: "Err" },
          true,
          { $tag: "Ok", _0: { $bind: "_s" } },
          {
            deepEq: [
              { call: [{ var: "decode" }, { var: "_s" }] },
              { construct: ["Ok", { var: "x" }] },
            ],
          },
        ],
      },
    },
    {
      name: "iso-encode-decode-roundtrip",
      description:
        "Round-trip via the serialized side: for every s : s where decode(s) succeeds, encode(decode(s)) = Ok s. Sample-tested over Exemplifiable<s>; failures (decode = Err) are vacuously satisfied.",
      forall: [{ name: "s", type: "s" }],
      property: {
        match: [
          { call: [{ var: "decode" }, { var: "s" }] },
          { $tag: "Err" },
          true,
          { $tag: "Ok", _0: { $bind: "_x" } },
          {
            deepEq: [
              { call: [{ var: "encode" }, { var: "_x" }] },
              { construct: ["Ok", { var: "s" }] },
            ],
          },
        ],
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Lens ctx s a — lossy projection with context-providing reverse
// ---------------------------------------------------------------------------

/**
 * `Lens ctx s a` — lossy specialization of `Iso` where the reverse
 * direction needs explicit context. Classical lens shape:
 *
 *   view : s -> a                 (lossy projection)
 *   put  : (s, a) -> s            (write the focus back into a whole)
 *
 * For a record-field lens, `ctx = s` (the existing record provides the
 * untouched fields). For schema-augmented codecs (e.g. Lens<Schema, JSON,
 * CSV>), `ctx` carries the metadata that the lossy `view` direction
 * dropped. Both fields hold the functions themselves (`view =
 * codec.recordFirstNameView`, loaded as a `{$ref}` reference — modules-as-values
 * Phase 2b). `put` takes its two arguments together, the arity of the
 * functions that implement it, and neither method mentions `ctx` in an
 * argument, so both stay at return position (selected by instance lookup).
 * The curried `put : s -> a -> s` waits for the validator's arity fix (it
 * counts an arrow's written arity, not the flattened one).
 *
 * Lens laws (Phase 8 — mechanised via the existing Phase 9.2 sample-
 * iteration + kernel SampleTestResult path; see `design/laws-and-proofs.md`):
 *
 *   - GetPut: put(s, view(s)) = s                    — putting back
 *             what you got out is a no-op
 *   - PutGet: view(put(s, a)) = a                     — what you put in
 *             is what you get out
 *   - PutPut: put(put(s, a1), a2) = put(s, a2)        — second put wins
 *
 * The laws below use the record-field-lens shape where `ctx = s` — the
 * existing record provides the context for `put`. Instances over more
 * exotic shapes (e.g. `Lens<Schema, JSON, CSV>` with `ctx ≠ s`) would
 * carry their own context samples; the laws below sample-test `s` and
 * thread it as both the context and the focus.
 *
 * Resourceful lenses (Boomerang-style) and induction-based law proofs are
 * future-phase concerns; the SampleTested epistemic status the kernel
 * attaches to the iteration outcome is sufficient for instances whose
 * lawfulness is observable on a small finite sample (as is the case
 * for `lensFirstName`).
 */
export const lens: Interface = {
  name: "Lens",
  description:
    "Lossy bidirectional pair: `view : s -> a` projects (drops information), `put : (s, a) -> s` writes a focus back into a whole, which carries what `view` dropped. Generalises Iso to cases where the reverse direction needs extra information. The three classical lens laws (GetPut / PutGet / PutPut) are sample-tested via Phase 4's Prover surface and promoted to SampleTested epistemic status by the kernel.",
  params: [{ name: "ctx" }, { name: "s" }, { name: "a" }],
  methods: [
    {
      name: "view",
      description:
        "The projection, `s -> a`. Lossy — information that doesn't make it into `a` must come from the whole `put` writes into.",
      params: [S_ARG_0],
      returns: { $var: "a" },
    },
    {
      name: "put",
      description:
        "The write-back, `(s, a) -> s`: the whole `s` carries what the lossy `view` direction dropped.",
      params: [S_ARG_0, A_ARG_1],
      returns: { $var: "s" },
    },
  ],
  laws: [
    {
      name: "lens-get-put",
      description:
        "GetPut: setting the focus to its current value is a no-op — `put(s, view(s)) = s`. Sample-tested over record samples carrying the focus field; instances whose `view` collapses absence to a sentinel (e.g. `lensFirstName` returning `\"\"` when no `firstName` exists) are lawful only on records where the field is present, which is the intended domain — the samples reflect that.",
      forall: [
        {
          name: "s",
          samples: [
            { firstName: "Ada" },
            { firstName: "Grace", lastName: "Hopper" },
            { firstName: "Linus", age: 54, email: "linus@example.com" },
            { firstName: "" },
            { firstName: "Augusta", lastName: "Lovelace", age: 36 },
          ],
        },
      ],
      property: {
        deepEq: [
          {
            call: [
              { var: "put" },
              { var: "s" },
              { call: [{ var: "view" }, { var: "s" }] },
            ],
          },
          { var: "s" },
        ],
      },
    },
    {
      name: "lens-put-get",
      description:
        "PutGet: reading after writing returns what was written — `view(put(s, a)) = a`. Sample-tested over a cartesian product of record and focus samples; holds unconditionally for record-field lenses (put always installs the field).",
      forall: [
        {
          name: "s",
          samples: [
            { firstName: "Ada" },
            { firstName: "Grace", lastName: "Hopper" },
            {},
            { lastName: "X" },
            { firstName: "", lastName: "Edge", age: 0 },
          ],
        },
        {
          name: "a",
          samples: ["Bob", "Alice", "Lovelace", "", "Linus", "Ada"],
        },
      ],
      property: {
        deepEq: [
          {
            call: [
              { var: "view" },
              { call: [{ var: "put" }, { var: "s" }, { var: "a" }] },
            ],
          },
          { var: "a" },
        ],
      },
    },
    {
      name: "lens-put-put",
      description:
        "PutPut: writing twice equals writing the second value — `put(put(s, a1), a2) = put(s, a2)`. Sample-tested over (s, a1, a2) triples; holds unconditionally for record-field lenses (the second put overwrites the first).",
      forall: [
        {
          name: "s",
          samples: [
            { firstName: "Ada" },
            { firstName: "Grace", lastName: "Hopper" },
            {},
          ],
        },
        {
          name: "a1",
          samples: ["First", "Old", ""],
        },
        {
          name: "a2",
          samples: ["Second", "New", "Final"],
        },
      ],
      property: {
        deepEq: [
          {
            call: [
              { var: "put" },
              { call: [{ var: "put" }, { var: "s" }, { var: "a1" }] },
              { var: "a2" },
            ],
          },
          {
            call: [
              { var: "put" },
              { var: "s" },
              { var: "a2" },
            ],
          },
        ],
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Composition helpers
// ---------------------------------------------------------------------------

/**
 * Compose two `Iso` instances pointwise.
 *
 *   composeIso(i1: Iso<s, t>, i2: Iso<t, a>) : Iso<s, a>
 *
 * Both directions and the composed proof derive from the inputs:
 *
 *   composed.encode = \x -> i1.encode(x) >>= i2.encode    -- where >>= is
 *                                                            Result Kleisli
 *   composed.decode = \s -> i2.decode(s) >>= i1.decode
 *
 * NOTE the encode chain runs i1.encode FIRST then i2.encode (left-to-right
 * in the type's a → s direction, which is *opposite* to the encode arrow).
 * Easier reading: read the type as "Iso<s, t> ∘ Iso<t, a>" and the encode
 * pipeline goes a → t → s, so i2.encode (a → t) runs first, then i1.encode
 * (t → s). Wait — that's the OTHER reading. Standard math composition:
 *
 *   Iso<s, t>.encode : t → Result E s
 *   Iso<t, a>.encode : a → Result E t
 *
 * So composed.encode : a → Result E s  is  i1.encode ∘ i2.encode (i2 first).
 *
 * The implementation reflects this directly — not what's "intuitive" but
 * what the types demand.
 *
 * The helper builds the composed instance with inline `{fn: [...]}` lambdas
 * as method values that call i1's and i2's functions. A method value may be
 * a function reference (`{$ref}`, what the authored instances hold since
 * modules-as-values Phase 2d), a function id string, or an inline closure (a
 * previously composed Iso); anything else throws.
 *
 * The composed instance gets a `priority: -1` by default so explicitly-
 * registered instances on the same `(s, a)` pair always win — composed
 * instances are derived, not authoritative.
 */
export function composeIso(
  i1: Instance,
  i2: Instance,
  options: { args?: Instance["args"]; label?: string } = {},
): Instance {
  if (i1.typeName !== "Iso" || i2.typeName !== "Iso") {
    throw new Error(
      `composeIso: both inputs must be Iso instances (got ${i1.typeName}, ${i2.typeName})`,
    );
  }
  const i1Encode = callableHead(i1.methods["encode"], "composeIso: the first Iso's `encode`");
  const i1Decode = callableHead(i1.methods["decode"], "composeIso: the first Iso's `decode`");
  const i2Encode = callableHead(i2.methods["encode"], "composeIso: the second Iso's `encode`");
  const i2Decode = callableHead(i2.methods["decode"], "composeIso: the second Iso's `decode`");

  // composed.encode : a → Result E s
  //   step 1 = i2.encode(a)        : Result E t
  //   step 2 (when Ok t) = i1.encode(t) : Result E s
  //   propagate Err.
  const composedEncode = {
    fn: [
      "_a",
      {
        match: [
          { call: [i2Encode, { var: "_a" }] },
          { $tag: "Err", _0: { $bind: "_err" } },
          { construct: ["Err", { var: "_err" }] }, // propagate the error unchanged
          { $tag: "Ok", _0: { $bind: "_t" } },
          { call: [i1Encode, { var: "_t" }] },
        ],
      },
    ],
  };

  // composed.decode : s → Result E a
  //   step 1 = i1.decode(s)        : Result E t
  //   step 2 (when Ok t) = i2.decode(t) : Result E a
  const composedDecode = {
    fn: [
      "_s",
      {
        match: [
          { call: [i1Decode, { var: "_s" }] },
          { $tag: "Err", _0: { $bind: "_err" } },
          { construct: ["Err", { var: "_err" }] }, // propagate the error unchanged
          { $tag: "Ok", _0: { $bind: "_t" } },
          { call: [i2Decode, { var: "_t" }] },
        ],
      },
    ],
  };

  return {
    typeName: "Iso",
    args: options.args ?? [
      ...(i1.args.slice(0, 1)), // s from i1
      ...(i2.args.slice(1, 2)), // a from i2
    ],
    methods: {
      encode: composedEncode,
      decode: composedDecode,
    },
    priority: -1,
    ...(options.label !== undefined ? { label: options.label } : {}),
  };
}

/**
 * Compose two `Decodable` instances via Kleisli (Result-chained):
 *
 *   composeDecodable(d1: Decodable<s, t>, d2: Decodable<t, a>) : Decodable<s, a>
 *
 *   composed.decode = \s -> d1.decode(s) >>= d2.decode
 *
 * Standard monadic composition. Errors from the first decoder propagate
 * through unchanged; the second decoder only runs on Ok values.
 *
 * No matching `Encodable` direction — Decodable is one-way, so
 * composition is one-way. Bidirectional composition lives on `composeIso`.
 * Method values are read as in `composeIso` (a reference, a function id or
 * an inline closure); anything else throws.
 */
export function composeDecodable(
  d1: Instance,
  d2: Instance,
  options: { args?: Instance["args"]; label?: string } = {},
): Instance {
  if (d1.typeName !== "Decodable" || d2.typeName !== "Decodable") {
    throw new Error(
      `composeDecodable: both inputs must be Decodable instances (got ${d1.typeName}, ${d2.typeName})`,
    );
  }
  const d1Decode = callableHead(d1.methods["decode"], "composeDecodable: the first Decodable's `decode`");
  const d2Decode = callableHead(d2.methods["decode"], "composeDecodable: the second Decodable's `decode`");
  const composedDecode = {
    fn: [
      "_s",
      {
        match: [
          { call: [d1Decode, { var: "_s" }] },
          { $tag: "Err", _0: { $bind: "_err" } },
          { construct: ["Err", { var: "_err" }] }, // propagate the error unchanged
          { $tag: "Ok", _0: { $bind: "_t" } },
          { call: [d2Decode, { var: "_t" }] },
        ],
      },
    ],
  };
  return {
    typeName: "Decodable",
    args: options.args ?? [
      ...(d1.args.slice(0, 1)),
      ...(d2.args.slice(1, 2)),
    ],
    methods: {
      decode: composedDecode,
    },
    priority: -1,
    ...(options.label !== undefined ? { label: options.label } : {}),
  };
}

// ---------------------------------------------------------------------------
// Aggregator exports — consumed by builtin-classes.ts to merge the codec
// typeclasses into the global `builtinTypeclasses` array. Instance
// registration happens via the codec module (modules/codec.ts) — its
// per-instance Iso / Lens declarations ride along with the per-function
// Codeable / Labelable etc. instances through the SYSTEM_MODULES loop in
// system-entities.ts.
// ---------------------------------------------------------------------------

export const codecTypeclasses: Interface[] = [encodable, decodable, iso, lens];

// Re-export the error-type tokens so the codec module can reference the
// same names without re-declaring the (Phase 2: trivial) shape.
export { EncodeError, DecodeError };

// Suppress lint warnings for the imported helper that's not used yet.
void Result;
